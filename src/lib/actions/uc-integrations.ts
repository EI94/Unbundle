"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { loadCaseCore } from "@/lib/db/queries/uc-cases";
import { revokeCaseReadToken } from "@/lib/db/queries/uc-mcp";
import { loadCaseSettings } from "@/lib/db/queries/uc-people-view";
import { createWorkspaceIntegrationToken } from "@/lib/db/queries/workspace-integrations";
import {
  CASE_TOKEN_TTL_DAYS,
  GRANTABLE_CASE_SCOPES,
  buildCaseTokenScopes,
  buildCasiInstallCommand,
  buildCasiStarterPrompt,
  normalizeApiBaseUrl,
  type GrantableCaseScope,
} from "@/lib/uc/mcp-access";
import { CASE_LAYOUT_PATH, openUcCase, ucFailure, type UcActionResult } from "./uc-action-context";
import { UUID } from "@/lib/uc/ids";

/**
 * Token Claude in sola lettura per un dossier (PIANO §5.8; DESIGN §3.13.2,
 * pannello «Sviluppo con Claude» dal menu «⋯»).
 *
 * - Prima `requireWorkspaceAccess(workspaceId)`, poi il ruolo di caso `ls_lead`
 *   (che vale solo per un utente Lateral Space con email verificata): non basta
 *   gestire il workspace, perché può farlo anche un utente del cliente.
 * - Solo dopo il via allo sviluppo (catalogo congelato) e mai su un caso chiuso.
 * - Il nome proposto è «Dossier · XX-0012 · sola lettura», con il codice dello
 *   use case (§2.1); il comando e la prima richiesta usano il codice del
 *   dossier, quello che conosce il server `unbundle-casi`.
 * - Scope scelti tra le sole letture dell'MVP, più il marcatore `uc:case:<id>`;
 *   scadenza 180 giorni, prefisso `ub_mcp_`. Il token si mostra una volta.
 * - «Revoca tutti i link» e la chiusura del caso revocano anche questi token.
 */

export interface CaseReadTokenCreated {
  tokenId: string;
  /** Mostrato una volta sola: nel database resta solo l'hash. */
  token: string;
  tokenPrefix: string;
  label: string;
  scopes: GrantableCaseScope[];
  caseId: string;
  caseCode: string;
  apiUrl: string;
  expiresAt: string;
  createdAt: string;
  installCommand: string;
  starterPrompt: string;
}

const CreateSchema = z.object({
  scopes: z.array(z.string()).min(1, "Scegli almeno una lettura per Claude.").max(GRANTABLE_CASE_SCOPES.length * 2),
  label: z.string().trim().max(80, "Il nome può avere al massimo 80 caratteri.").optional(),
});

const RevokeSchema = z.object({ tokenId: z.string().regex(UUID, "Accesso non valido.") });

/** Nome proposto per l'accesso (DESIGN §8.3 WP6): «Dossier · XX-0012 · sola lettura». */
function caseAccessLabel(code: string): string {
  return `Dossier · ${code} · sola lettura`;
}

async function appBaseUrl(): Promise<string> {
  const configured =
    normalizeApiBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeApiBaseUrl(process.env.APP_URL) ??
    normalizeApiBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalizeApiBaseUrl(process.env.VERCEL_URL);
  if (configured) return configured;
  const headerStore = await headers();
  const host = headerStore.get("host") ?? "localhost:3000";
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

function refreshCasePages(workspaceId: string): void {
  revalidatePath(CASE_LAYOUT_PATH, "layout");
  revalidatePath(`/dashboard/${workspaceId}/settings`);
}

/**
 * Il nome che «Crea un accesso» dà quando il campo resta vuoto, per il
 * segnaposto del pannello: la stessa regola di `createCaseReadTokenAction`
 * (codice dello use case, altrimenti del dossier), così il nome proposto e
 * quello salvato non divergono. Solo lettura.
 */
export async function proposedCaseAccessLabelAction(workspaceId: string, caseId: string): Promise<UcActionResult<{ label: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  const opened = await openUcCase({ session, access, workspaceId, caseId, allow: ["ls_lead"], write: false });
  if (!opened.ok) return opened.result;
  const { executor, caseAccess } = opened.value;
  const settings = await loadCaseSettings(executor, { workspaceId, caseId: caseAccess.caseId });
  if (!settings) return ucFailure("non_trovato", "Dossier non trovato o non accessibile.");
  return { ok: true, data: { label: caseAccessLabel(settings.displayCode) } };
}

/** «Crea un accesso»: token in sola lettura limitato a questo dossier. */
export async function createCaseReadTokenAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<CaseReadTokenCreated>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  const opened = await openUcCase({ session, access, workspaceId, caseId, allow: ["ls_lead"] });
  if (!opened.ok) return opened.result;
  const { executor, caseAccess } = opened.value;
  if (!caseAccess.user.isLateralSpace) return ucFailure("ruolo_solo_lateral_space", "Solo il responsabile Lateral Space crea l'accesso per Claude.");

  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return ucFailure("input_non_valido", parsed.error.issues[0]?.message ?? "Controlla i campi.");
  const scopes = buildCaseTokenScopes(caseAccess.caseId, parsed.data.scopes);
  if (!scopes.ok) return ucFailure(scopes.code, scopes.message);

  const [core, settings] = await Promise.all([loadCaseCore(executor, workspaceId, caseAccess.caseId), loadCaseSettings(executor, { workspaceId, caseId: caseAccess.caseId })]);
  if (!core) return ucFailure("non_trovato", "Dossier non trovato o non accessibile.");
  if (core.status === "chiuso") return ucFailure("caso_chiuso", "Il dossier è chiuso: non si creano nuovi accessi.");
  if (core.catalogVersion < 1) return ucFailure("gate_non_approvato", "L'accesso per Claude si crea dopo il via allo sviluppo.");

  const label = parsed.data.label || caseAccessLabel(settings?.displayCode ?? core.code);
  const expiresAt = new Date(Date.now() + CASE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { token, row } = await createWorkspaceIntegrationToken({
    workspaceId,
    label,
    createdByUserId: session.user.id,
    scopes: scopes.value,
    expiresAt,
  });
  const apiUrl = await appBaseUrl();
  refreshCasePages(workspaceId);
  const granted = GRANTABLE_CASE_SCOPES.filter((s) => scopes.value.includes(s));
  return {
    ok: true,
    message: "Accesso creato. Copia ora il comando: la chiave non si vedrà più.",
    data: {
      tokenId: row.id,
      token,
      tokenPrefix: row.tokenPrefix,
      label: row.label,
      scopes: granted,
      caseId: core.id,
      caseCode: core.code,
      apiUrl,
      expiresAt: expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      installCommand: buildCasiInstallCommand({ apiUrl, token, caseCode: core.code }),
      starterPrompt: buildCasiStarterPrompt(core.code),
    },
  };
}

/** Revoca un accesso Claude di questo dossier. */
export async function revokeCaseReadTokenAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ tokenId: string }>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  const opened = await openUcCase({ session, access, workspaceId, caseId, allow: ["ls_lead"] });
  if (!opened.ok) return opened.result;
  const parsed = RevokeSchema.safeParse(input);
  if (!parsed.success) return ucFailure("input_non_valido", "Accesso non valido.");
  const revoked = await revokeCaseReadToken(opened.value.executor, { workspaceId, caseId: opened.value.caseAccess.caseId, tokenId: parsed.data.tokenId });
  if (!revoked) return ucFailure("non_trovato", "Accesso non trovato o già revocato.");
  refreshCasePages(workspaceId);
  return { ok: true, data: { tokenId: parsed.data.tokenId }, message: "Accesso revocato: Claude non legge più il dossier con questa chiave." };
}
