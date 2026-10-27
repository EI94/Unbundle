import "server-only";
import { getBellState, type BellState } from "@/lib/db/queries/bell-state";
import { getSignalsForBell } from "@/lib/db/queries/signals";
import { isUcEnabledFor } from "@/lib/db/queries/uc-access";
import { listUseCaseBellRows } from "@/lib/db/queries/use-case-notifications";
import { referentAskEnabled } from "@/lib/use-cases/referent/availability";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import {
  BELL_DOSSIER_LIMIT,
  BELL_SIGNALS_LIMIT,
  BELL_USE_CASE_DAYS,
  BELL_USE_CASE_LIMIT,
  dossierEntry,
  mergeBell,
  noticeEntry,
  signalEntry,
  type BellEntry,
  type BellPayload,
} from "./bell";

/**
 * La campanella di una persona in un workspace (SPEC §P2.3.3): segnali del portafoglio letti per
 * persona, righe dei dossier (solo Lateral Space, con la sezione accesa), notifiche degli use case
 * (revisori, area accesa), lo stato «visto fino a». Una fonte che non si legge resta vuota: la
 * barra in alto non si ferma mai per la campanella.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function source<T>(name: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    console.error(`[bell] ${name} non letta`, error instanceof Error ? error.name : "errore");
    return fallback;
  }
}

export async function loadBellPayload(i: {
  workspaceId: string;
  userId: string | null;
  role: string | null;
  useCaseHub: boolean;
  now?: Date;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<BellPayload> {
  const now = i.now ?? new Date();
  const env = i.env ?? process.env;
  const userId = i.userId && UUID.test(i.userId) ? i.userId.toLowerCase() : null;
  const reviewer = canReviewWorkspacePortfolio(i.role);
  const noState: BellState = { seenAt: null, referentEmails: true, hasRequested: false };

  const [signals, dossier, useCase, state] = await Promise.all([
    source<BellEntry[]>(
      "segnali",
      async () => (await getSignalsForBell({ workspaceId: i.workspaceId, role: i.role, userId, limit: BELL_SIGNALS_LIMIT })).map((s) => signalEntry(i.workspaceId, s, i.useCaseHub)),
      [],
    ),
    source<BellEntry[]>(
      "dossier",
      async () => {
        if (!userId || !isUcEnabledFor(i.workspaceId)) return [];
        const { unreadForUser } = await import("@/lib/db/queries/uc-notifications-dispatch");
        return (await unreadForUser(userId, { workspaceId: i.workspaceId, limit: BELL_DOSSIER_LIMIT, now })).map((item) => dossierEntry(item, i.useCaseHub));
      },
      [],
    ),
    source<BellEntry[]>(
      "use_case",
      async () => {
        if (!i.useCaseHub || !reviewer || !userId) return [];
        const rows = await listUseCaseBellRows({ userId, workspaceId: i.workspaceId, limit: BELL_USE_CASE_LIMIT, days: BELL_USE_CASE_DAYS, now });
        return rows.map((n) => noticeEntry(i.workspaceId, n, now));
      },
      [],
    ),
    source<BellState>("stato", async () => (userId ? getBellState(i.workspaceId, userId) : noState), noState),
  ]);

  return mergeBell({
    workspaceId: i.workspaceId,
    signals,
    dossier,
    useCase,
    seenAt: state.seenAt,
    emailAlerts: { shown: i.useCaseHub && reviewer && referentAskEnabled(i.workspaceId, env) && state.hasRequested, on: state.referentEmails },
    now,
  });
}
