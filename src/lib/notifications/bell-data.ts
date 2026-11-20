import "server-only";
import { getBellState, type BellState } from "@/lib/db/queries/bell-state";
import { getSignalsForBell } from "@/lib/db/queries/signals";
import { isUcEnabledFor } from "@/lib/db/queries/uc-access";
import { listUseCaseBellRows } from "@/lib/db/queries/use-case-notifications";
import { referentEmailChoice } from "@/lib/shell/account";
import { referentAskEnabled } from "@/lib/use-cases/referent/availability";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import {
  BELL_DOSSIER_LIMIT,
  BELL_SIGNALS_LIMIT,
  BELL_USE_CASE_DAYS,
  BELL_USE_CASE_LIMIT,
  bellSourcesFor,
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

/** (8.0d) Gli use case che «Solo questo use case» costruisce adesso (il predicato); nessuno se la lettura non riesce. */
async function caseOnlyUseCaseIds(workspaceId: string, userId: string): Promise<string[]> {
  if (!isUcEnabledFor(workspaceId)) return [];
  const [{ builtUseCaseIds }, { getAppUcExecutor }, { ucLsDomains }] = await Promise.all([
    import("@/lib/db/queries/use-case-builders"),
    import("@/lib/db/uc-executor"),
    import("@/lib/db/queries/uc-access"),
  ]);
  return builtUseCaseIds(await getAppUcExecutor(), { workspaceId, userId, lsDomains: ucLsDomains() });
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
  // (8.0d) Per elenco (`bellSourcesFor`): «Solo questo use case» ha solo i tipi di chi costruisce (`CASE_TEAM_BELL_KINDS`)
  // dei casi che costruisce adesso; niente segnali del workspace, niente righe dei dossier. Un ruolo sconosciuto, niente.
  const sources = bellSourcesFor(i.role);
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
        if (!userId || !sources.dossier || !isUcEnabledFor(i.workspaceId)) return [];
        const { unreadForUser } = await import("@/lib/db/queries/uc-notifications-dispatch");
        return (await unreadForUser(userId, { workspaceId: i.workspaceId, limit: BELL_DOSSIER_LIMIT, now })).map((item) => dossierEntry(item, i.useCaseHub));
      },
      [],
    ),
    source<BellEntry[]>(
      "use_case",
      async () => {
        if (!i.useCaseHub || !userId) return [];
        // (8.0a) Chi non rivede il portafoglio vede solo le righe dell'Agent Factory: arrivano per il ruolo nel team
        // del caso (il responsabile del cliente, l'AI Board, uno sviluppatore), non per il ruolo nel workspace.
        if (sources.useCaseKinds !== null && sources.useCaseKinds.length === 0) return [];
        const useCaseIds = sources.onlyOwnCases ? await caseOnlyUseCaseIds(i.workspaceId, userId) : undefined;
        const rows = await listUseCaseBellRows({ userId, workspaceId: i.workspaceId, limit: BELL_USE_CASE_LIMIT, days: BELL_USE_CASE_DAYS, now, kinds: sources.useCaseKinds ?? undefined, useCaseIds });
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
    // (Rilascio 10) La scelta sta nel foglio «Il tuo account»: la stessa regola, in un posto solo.
    emailAlerts: referentEmailChoice({ useCaseHub: i.useCaseHub, reviewer, askEnabled: referentAskEnabled(i.workspaceId, env), hasRequested: state.hasRequested, on: state.referentEmails }),
    now,
  });
}
