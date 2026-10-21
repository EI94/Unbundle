"use server";

/**
 * Azioni della card «Claude per il team» (Impostazioni › Integrazioni; docs/use-case/DESIGN.md
 * §9.4 «Token personali», §1.2 punto 8; decisione D9; PIANO-LAVORI H5b):
 * - `createTeamMcpTokenAction`: «Crea il tuo token», per sé, con etichetta e «Solo lettura».
 *   Il token in chiaro esce solo in questa risposta, una volta;
 * - `revokeTeamMcpTokenAction`: «Revoca» di un proprio token;
 * - `revokeAllTeamMcpTokensAction`: «Revoca tutti» i token del MCP del team del workspace,
 *   solo per chi gestisce il workspace.
 *
 * Ogni azione è un endpoint raggiungibile con una POST diretta, quindi rifà da sé tutto:
 * ingresso validato con zod, sessione (`requireSession`), accesso al workspace
 * (`getCollaboratorAccess`, che esclude chi segue solo un corso), area accesa per il
 * workspace e permessi dell'area (`abilitiesForUseCase`: token solo per chi ha un ruolo da
 * revisore, «Revoca tutti» solo per chi gestisce il workspace). Il proprietario è sempre chi
 * è in sessione: un token non si crea né si revoca per un altro.
 *
 * Nei log solo nome e codice dell'errore (`logSafeError`): mai token, etichette o persone.
 *
 * Nessuna azione riceve lo stato precedente della card: dopo una creazione quello stato ha il
 * token in chiaro, e React lo manderebbe al server come argomento (Next scrive gli argomenti
 * delle server function nel terminale in sviluppo). La card chiama le azioni con i soli dati
 * del modulo (`cardAction` in `team-mcp-card.tsx`).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { formatItalianDay } from "@/lib/connector/settings-view";
import {
  createTeamMcpToken,
  isReadOnlyScopes,
  revokeAllTeamMcpTokens,
  revokeOwnTeamMcpToken,
} from "@/lib/db/queries/team-mcp-tokens";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { logSafeError } from "@/lib/log/safe-error";
import { abilitiesForUseCase, type UseCaseAbilities } from "@/lib/use-cases/permissions";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { getCollaboratorAccess, type WorkspaceAccess } from "@/lib/workspace-access";

export type TeamMcpActionState<Data = unknown> = {
  ok: boolean;
  message?: string | null;
  fieldErrors?: Record<string, string>;
  data?: Data;
};

export type CreateTeamMcpTokenData = {
  tokenId: string;
  /** Il token in chiaro: questa è l'unica volta che esce dal server. */
  token: string;
  tokenPrefix: string;
  label: string;
  readOnly: boolean;
  expiresOn: string;
};

export type RevokeTeamMcpTokenData = { tokenId: string };

export type RevokeAllTeamMcpTokensData = { revoked: number };

const LABEL_MAX = 80;
const NOT_FOUND = "Workspace non trovato o non accessibile.";
const AREA_OFF = "L'area «Use case» non è accesa per questo workspace.";
const NOT_REVIEWER = "I token per Claude li crea solo chi valuta gli use case, per sé.";
const NOT_MANAGER = "Solo chi gestisce il workspace revoca i token di tutti.";
const FAILED = "Non è stato possibile salvare. Riprova tra poco.";

const workspaceIdInput = z.uuid();
const createInput = z
  .object({
    workspaceId: workspaceIdInput,
    label: z
      .string({ error: "Scrivi un'etichetta." })
      .trim()
      .min(1, { error: "Scrivi un'etichetta." })
      .max(LABEL_MAX, { error: `Scrivi un'etichetta di massimo ${LABEL_MAX} caratteri.` }),
    readOnly: z.boolean(),
  })
  .strict();
const revokeInput = z.object({ workspaceId: workspaceIdInput, tokenId: z.uuid() }).strict();

function fail<Data>(message: string, fieldErrors: Record<string, string> = {}): TeamMcpActionState<Data> {
  return { ok: false, message, fieldErrors };
}

/**
 * I permessi dell'area di chi è in sessione, con l'accesso al workspace appena riletto da chi
 * chiama (`getCollaboratorAccess`, nel corpo di ogni azione), oppure il messaggio di rifiuto.
 * Creare vuole l'area accesa; revocare no: togliere un accesso va sempre bene.
 */
function teamMcpAbilities(
  workspaceId: string,
  user: { id: string; email: string | null; emailVerified: boolean },
  access: WorkspaceAccess | null,
  opts: { needsArea: boolean }
): { ok: true; abilities: UseCaseAbilities } | { ok: false; message: string } {
  if (!access) return { ok: false, message: NOT_FOUND };
  if (opts.needsArea && !isUseCaseHubWorkspace(workspaceId)) return { ok: false, message: AREA_OFF };
  return { ok: true, abilities: abilitiesForUseCase(viewerFromSession(user, access.role)) };
}

function revalidateSettings(workspaceId: string) {
  revalidatePath(`/dashboard/${workspaceId}/settings`);
}

/** «Crea il tuo token»: 90 giorni, per chi è in sessione; in chiaro una sola volta. */
export async function createTeamMcpTokenAction(workspaceId: string, formData: FormData): Promise<TeamMcpActionState<CreateTeamMcpTokenData>> {
  const label = formData.get("label");
  const parsed = createInput.safeParse({
    workspaceId,
    label: typeof label === "string" ? label : undefined,
    readOnly: formData.get("readOnly") === "on",
  });
  if (!parsed.success) {
    const labelIssue = parsed.error.issues.find((issue) => issue.path[0] === "label");
    return labelIssue ? fail("Controlla l'etichetta.", { label: labelIssue.message }) : fail("Richiesta non valida.");
  }
  const session = await requireSession();
  const access = await getCollaboratorAccess(session.user.id, parsed.data.workspaceId);
  const checked = teamMcpAbilities(parsed.data.workspaceId, session.user, access, { needsArea: true });
  if (!checked.ok) return fail(checked.message);
  if (!checked.abilities.canUseTeamMcp) return fail(NOT_REVIEWER);

  try {
    const { token, row } = await createTeamMcpToken({
      workspaceId: parsed.data.workspaceId,
      ownerUserId: session.user.id,
      label: parsed.data.label,
      readOnly: parsed.data.readOnly,
    });
    revalidateSettings(parsed.data.workspaceId);
    return {
      ok: true,
      message: "Token creato. Copialo ora: non sarà più mostrato.",
      data: {
        tokenId: row.id,
        token,
        tokenPrefix: row.tokenPrefix,
        label: row.label,
        readOnly: isReadOnlyScopes(row.scopes),
        expiresOn: formatItalianDay(row.expiresAt) ?? "",
      },
    };
  } catch (error) {
    logSafeError("team-mcp-tokens", "create_failed", error);
    return fail(FAILED);
  }
}

/** «Revoca» di un proprio token: Claude non può più usarlo. */
export async function revokeTeamMcpTokenAction(workspaceId: string, formData: FormData): Promise<TeamMcpActionState<RevokeTeamMcpTokenData>> {
  const tokenId = formData.get("tokenId");
  const parsed = revokeInput.safeParse({ workspaceId, tokenId: typeof tokenId === "string" ? tokenId : undefined });
  if (!parsed.success) return fail("Token non valido.");
  const session = await requireSession();
  const access = await getCollaboratorAccess(session.user.id, parsed.data.workspaceId);
  const checked = teamMcpAbilities(parsed.data.workspaceId, session.user, access, { needsArea: false });
  if (!checked.ok) return fail(checked.message);
  // Ognuno revoca i propri token anche se non è più revisore o l'area è spenta: il MCP del
  // team li rifiuterebbe comunque, e togliere un accesso va sempre bene.

  try {
    const revoked = await revokeOwnTeamMcpToken({
      workspaceId: parsed.data.workspaceId,
      ownerUserId: session.user.id,
      tokenId: parsed.data.tokenId,
    });
    if (!revoked) return fail("Token non trovato o già revocato.");
    revalidateSettings(parsed.data.workspaceId);
    return { ok: true, message: "Token revocato. Claude non può più usarlo.", data: { tokenId: revoked.id } };
  } catch (error) {
    logSafeError("team-mcp-tokens", "revoke_failed", error);
    return fail(FAILED);
  }
}

/** «Revoca tutti»: ogni token del MCP del team del workspace, di chiunque sia. Solo chi gestisce il workspace. */
export async function revokeAllTeamMcpTokensAction(workspaceId: string): Promise<TeamMcpActionState<RevokeAllTeamMcpTokensData>> {
  const parsed = workspaceIdInput.safeParse(workspaceId);
  if (!parsed.success) return fail("Richiesta non valida.");
  const session = await requireSession();
  const access = await getCollaboratorAccess(session.user.id, parsed.data);
  const checked = teamMcpAbilities(parsed.data, session.user, access, { needsArea: false });
  if (!checked.ok) return fail(checked.message);
  if (!checked.abilities.managesWorkspace) return fail(NOT_MANAGER);

  try {
    const revoked = await revokeAllTeamMcpTokens({ workspaceId: parsed.data });
    revalidateSettings(parsed.data);
    return {
      ok: true,
      message: revoked === 0 ? "Nessun token attivo da revocare." : revoked === 1 ? "Revocato 1 token." : `Revocati ${revoked} token.`,
      data: { revoked },
    };
  } catch (error) {
    logSafeError("team-mcp-tokens", "revoke_all_failed", error);
    return fail(FAILED);
  }
}
