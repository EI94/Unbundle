"use server";

/**
 * La conferma del login della CLI nel browser (rilascio 8.0b, RILASCIO-8.0b-COSTRUZIONE.md §3): «Collega questa
 * CLI» per un workspace dove la persona ha accesso, oppure «Non l'ho chiesto io». Si decide solo un codice vivo e
 * in attesa; il token lo ritira la CLI, mai il browser.
 */
import { auth } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { cliStoreReady, decideCliLogin } from "@/lib/db/queries/use-case-cli-auth";
import { getAppUcExecutor } from "@/lib/db/uc-executor";

export type CliLoginDecision = { ok: true; message: string } | { ok: false; message: string };

const NOT_READY: CliLoginDecision = { ok: false, message: "Il collegamento della CLI non è ancora disponibile: riprova tra qualche minuto." };

/** «Collega questa CLI» al workspace scelto. */
export async function confirmCliLoginAction(userCode: string, workspaceId: string): Promise<CliLoginDecision> {
  const { session } = await requireWorkspaceAccess(workspaceId);
  await ensureDbSchema();
  const executor = await getAppUcExecutor();
  if (!(await cliStoreReady(executor))) return NOT_READY;
  const decided = await decideCliLogin(executor, { userCode, userId: session.user.id, workspaceId, confirm: true });
  if (!decided.ok) return { ok: false, message: decided.message };
  return { ok: true, message: "Fatto: la CLI è collegata. Torna al terminale." };
}

/** «Non l'ho chiesto io»: il codice non vale più. */
export async function denyCliLoginAction(userCode: string): Promise<CliLoginDecision> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: "Accedi per decidere." };
  await ensureDbSchema();
  const executor = await getAppUcExecutor();
  if (!(await cliStoreReady(executor))) return NOT_READY;
  const decided = await decideCliLogin(executor, { userCode, userId: session.user.id, workspaceId: null, confirm: false });
  if (!decided.ok) return { ok: false, message: decided.message };
  return { ok: true, message: "Il codice non vale più: nessuna CLI è stata collegata." };
}
