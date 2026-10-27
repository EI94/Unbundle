"use server";

import { refresh } from "next/cache";
import { auth } from "@/lib/auth";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { markBellSeen, setReferentEmails } from "@/lib/db/queries/bell-state";
import { markSignalsReadForUser } from "@/lib/db/queries/signals";
import { isUcEnabledFor } from "@/lib/db/queries/uc-access";
import { markUseCaseNotificationsRead } from "@/lib/db/queries/use-case-notifications";
import { logSafeError } from "@/lib/log/safe-error";
import { BELL_TEXT, parseUpTo, type BellPayload } from "@/lib/notifications/bell";
import { loadBellPayload } from "@/lib/notifications/bell-data";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { getCollaboratorAccess } from "@/lib/workspace-access";

/**
 * Le due azioni rare ed esplicite della campanella (SPEC §P2.3.8): «Segna tutte come lette» e la
 * scelta sulle email. Aprire la campanella e aprire una riga passano dalla rotta POST
 * `/api/workspaces/<ws>/bell`, fuori dalla coda delle action della pagina.
 */

export type BellActionResult =
  | { ok: true; payload: BellPayload }
  | { ok: false; code: "non_autenticato" | "non_disponibile" | "dati_non_validi" | "riprova"; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Caller = { ok: true; userId: string; role: string | null } | Extract<BellActionResult, { ok: false }>;

async function caller(workspaceId: string, valid: boolean): Promise<Caller> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "non_autenticato", message: BELL_TEXT.errors.session };
  if (typeof workspaceId !== "string" || !UUID.test(workspaceId) || !valid) return { ok: false, code: "dati_non_validi", message: BELL_TEXT.errors.unavailable };
  const access = await getCollaboratorAccess(userId, workspaceId);
  if (!access) return { ok: false, code: "non_disponibile", message: BELL_TEXT.errors.unavailable };
  return { ok: true, userId, role: access.role ?? null };
}

async function payloadFor(workspaceId: string, c: { userId: string; role: string | null }): Promise<BellPayload> {
  return loadBellPayload({ workspaceId, userId: c.userId, role: c.role, useCaseHub: isUseCaseHubWorkspace(workspaceId) });
}

/** `upTo` = il `latestAt` del payload che la persona ha visto (null: niente da segnare, solo «visto»). */
export async function markAllBellReadAction(workspaceId: string, upTo: string | null): Promise<BellActionResult> {
  const limit = upTo === null ? null : parseUpTo(upTo);
  const c = await caller(workspaceId, upTo === null || limit !== null);
  if (!c.ok) return c;
  try {
    if (limit) {
      await markSignalsReadForUser({ workspaceId, userId: c.userId, role: c.role, signalIds: null, upTo: limit });
      await markUseCaseNotificationsRead({ userId: c.userId, workspaceId, id: null, upTo: limit });
      if (isUcEnabledFor(workspaceId)) {
        const { markBellRead } = await import("@/lib/db/queries/uc-notifications-dispatch");
        await markBellRead(await getAppUcExecutor(), { userId: c.userId, workspaceId, notificationId: null });
      }
    }
    await markBellSeen(workspaceId, c.userId);
  } catch (error) {
    logSafeError("bell", "segna_tutte", error, { workspaceId });
    return { ok: false, code: "riprova", message: BELL_TEXT.errors.readAll };
  }
  refresh();
  return { ok: true, payload: await payloadFor(workspaceId, c) };
}

export async function setBellEmailAlertsAction(workspaceId: string, on: boolean): Promise<BellActionResult> {
  const c = await caller(workspaceId, typeof on === "boolean");
  if (!c.ok) return c;
  try {
    await setReferentEmails(workspaceId, c.userId, on);
  } catch (error) {
    logSafeError("bell", "email_scelta", error, { workspaceId });
    return { ok: false, code: "riprova", message: BELL_TEXT.errors.preference };
  }
  return { ok: true, payload: await payloadFor(workspaceId, c) };
}
