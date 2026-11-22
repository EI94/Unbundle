"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { dispatchDue } from "@/lib/db/queries/uc-notifications-dispatch";
import { createCiKey, revokeCiKeys, rotateCiKey, type CiKeyIssued } from "@/lib/db/queries/use-case-ci-keys";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { ucLogError } from "@/lib/uc/log";
import type { Result } from "@/lib/uc/types";
import { CI_KEY_ACTION_TEXT } from "@/lib/use-cases/ci/keys";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { ucFailure, ucSectionAvailable, type UcActionResult } from "./uc-action-context";

/**
 * La chiave della CI di un repository, dalla riga della famiglia nella pagina «Agent Factory» (rilascio 8.2b,
 * docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.2, §2.5, §2.6): «Collega la CI» › «Crea la chiave», «Ruota la chiave»,
 * «Revoca la chiave».
 *
 * - **Chi (D6):** solo Lateral Space, chi gestisce il workspace o è responsabile di un caso aperto del repository. Mai
 *   sviluppatori e analisti di Lateral Space, chi costruisce da fuori, il cliente, anche chiamando l'azione direttamente:
 *   l'accesso al workspace per prima cosa (`requireWorkspaceAccess`, la regola di workspace-isolation.test.ts), poi
 *   l'e-mail verificata di Lateral Space, e la regola intera la rilegge l'SQL della scrittura (`ciKeyManagerSql`).
 * - **La chiave si vede una volta:** solo nella risposta di «Crea» e «Ruota»; in Unbundle restano l'impronta e il
 *   prefisso. Mai nei log, mai nel percorso della pagina.
 * - Le e-mail `chiave_ci_creata` (a chi gestisce le chiavi, tranne chi agisce) partono subito dopo la risposta; se non
 *   partono, le riprende il cron.
 */

/** La chiave appena creata o ruotata, da mostrare **una volta** con i passi per GitHub. */
export interface CiKeyShown {
  /** La chiave (`ub_ci_…`): in questa risposta e mai più. */
  key: string;
  /** `owner/nome`, come è registrato. */
  repo: string;
  /** `ub_ci_ab12`. */
  prefix: string;
  /** ISO: «Vale fino al …». */
  expiresAt: string;
  /** Dopo una rotazione: fino a quando vale al massimo la vecchia (ISO); null per una chiave nuova. */
  oldUntil: string | null;
}

type WorkspaceAccess = Awaited<ReturnType<typeof requireWorkspaceAccess>>;

async function guard(workspaceId: string, { session, access }: WorkspaceAccess): Promise<{ ok: true; actorUserId: string } | { ok: false; result: UcActionResult<never> }> {
  if (!isUseCaseHubWorkspace(workspaceId) || process.env.UC_ENABLED !== "true") return { ok: false, result: ucFailure("non_disponibile", CI_KEY_ACTION_TEXT.non_disponibile) };
  const available = await ucSectionAvailable(workspaceId);
  if (!available.ok) return { ok: false, result: available };
  // Prima di toccare il database: chi non è di Lateral Space (e-mail verificata) non gestisce mai la chiave.
  if (!viewerFromSession(session.user, access.role).isLateralSpace) return { ok: false, result: ucFailure("permesso_negato", CI_KEY_ACTION_TEXT.permesso_negato) };
  return { ok: true, actorUserId: session.user.id };
}

function repoOf(input: unknown): unknown {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>).repo : undefined;
}

/** Le e-mail della chiave nuova, subito dopo la risposta. */
function sendAfter(workspaceId: string, noticeIds: readonly string[]): void {
  for (const notificationId of noticeIds) {
    after(async () => {
      try {
        await dispatchDue({ notificationId });
      } catch (error) {
        ucLogError({ area: "ci", op: "email_chiave_creata", workspaceId }, error);
      }
    });
  }
}

function shown(issued: CiKeyIssued): CiKeyShown {
  return {
    key: issued.key,
    repo: issued.repo,
    prefix: issued.prefix,
    expiresAt: issued.expiresAt.toISOString(),
    oldUntil: issued.replaced ? issued.replaced.until.toISOString() : null,
  };
}

async function issue(workspaceId: string, input: unknown, op: "chiave_crea" | "chiave_ruota"): Promise<UcActionResult<CiKeyShown>> {
  const workspace = await requireWorkspaceAccess(workspaceId);
  const g = await guard(workspaceId, workspace);
  if (!g.ok) return g.result;
  let result: Result<CiKeyIssued>;
  try {
    await ensureDbSchema();
    const executor = await getAppUcExecutor();
    const run = op === "chiave_crea" ? createCiKey : rotateCiKey;
    result = await run(executor, { workspaceId, repo: repoOf(input), actor: { userId: g.actorUserId }, lsDomains: ucLsDomains() });
  } catch (error) {
    ucLogError({ area: "ci", op, workspaceId }, error);
    return ucFailure("non_riuscito", CI_KEY_ACTION_TEXT.non_riuscito);
  }
  if (!result.ok) return ucFailure(result.code, result.message);
  revalidatePath(`/dashboard/${workspaceId}/agent-factory`);
  sendAfter(workspaceId, result.value.noticeIds);
  return { ok: true, data: shown(result.value), message: CI_KEY_ACTION_TEXT.creata };
}

/** «Collega la CI» › «Crea la chiave»: una chiave per il repository (`{ repo: "owner/nome" }`), se non ne ha una viva. */
export async function createCiKeyAction(workspaceId: string, input: unknown): Promise<UcActionResult<CiKeyShown>> {
  return issue(workspaceId, input, "chiave_crea");
}

/** «Ruota la chiave»: una chiave nuova; la vecchia vale fino al primo invio con la nuova, al massimo 7 giorni. */
export async function rotateCiKeyAction(workspaceId: string, input: unknown): Promise<UcActionResult<CiKeyShown>> {
  return issue(workspaceId, input, "chiave_ruota");
}

/** «Revoca la chiave»: da subito, le chiavi del repository. Su GitHub il segreto si toglie a mano. */
export async function revokeCiKeyAction(workspaceId: string, input: unknown): Promise<UcActionResult<{ repo: string; revoked: number }>> {
  const workspace = await requireWorkspaceAccess(workspaceId);
  const g = await guard(workspaceId, workspace);
  if (!g.ok) return g.result;
  try {
    await ensureDbSchema();
    const executor = await getAppUcExecutor();
    const result = await revokeCiKeys(executor, { workspaceId, repo: repoOf(input), actor: { userId: g.actorUserId }, lsDomains: ucLsDomains() });
    if (!result.ok) return ucFailure(result.code, result.message);
    revalidatePath(`/dashboard/${workspaceId}/agent-factory`);
    return { ok: true, data: result.value, message: CI_KEY_ACTION_TEXT.revocata };
  } catch (error) {
    ucLogError({ area: "ci", op: "chiave_revoca", workspaceId }, error);
    return ucFailure("non_riuscito", CI_KEY_ACTION_TEXT.non_riuscito);
  }
}
