import "server-only";
import { eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { useCases, workspaces } from "@/lib/db/schema";
import { dossierStates } from "@/lib/db/queries/use-case-dossiers";
import { logSafeError } from "@/lib/log/safe-error";
import { digestCounts, dueHubSignalTypes, hubWeeklySignals, type DigestRow, type HubSignal, type HubSignalType } from "@/lib/use-cases/digest";
import { romeToday } from "@/lib/use-cases/quarter";
import { hubRollout, hubWorkspaceIds, hubWorkspacesAmong } from "@/lib/use-cases/rollout";

/**
 * Il passo dell'hub nel cron `weekly-pulse` (docs/use-case/DESIGN.md §14.3; PIANO-LAVORI
 * H4d): per ogni workspace con l'area accesa (`USE_CASE_HUB_WORKSPACES`, `*` = tutti quelli
 * che esistono, meno `USE_CASE_HUB_EXCLUDE`) scrive in
 * `weekly_signals` il riepilogo `use_case_digest` e, il primo lunedì del trimestre,
 * `use_case_quarter` (testi e conti in `src/lib/use-cases/digest.ts`). Un workspace senza use
 * case non riceve nessuno dei due.
 *
 * - Nessun modello: qui non si importa l'SDK AI. Il cron lo chiama **prima** del ciclo AI
 *   di oggi, che non ha `try/catch`: un errore del modello non ferma più il riepilogo.
 * - Un `try/catch` per workspace: un workspace che si rompe non ferma gli altri, e il passo
 *   intero non lancia mai (il ciclo AI parte comunque).
 * - Solo i workspace dell'elenco che esistono: un UUID di un workspace cancellato si salta.
 *   Con `*` si leggono tutti i workspace del database, e gli esclusi si saltano.
 * - Si legge il minimo: le colonne della fase, l'arrivo, l'ultimo «Riapri» dalla Storia e,
 *   di `intake`, i tre campi tecnici del connettore. Nessun titolo, testo o proponente; i
 *   segnali portano solo numeri e nessuna scheda collegata.
 * - Una volta al giorno: se il cron riparte lo stesso giorno (Roma), un segnale dello
 *   stesso tipo già scritto per il workspace non si scrive di nuovo. Controllo e scrittura
 *   stanno in una transazione con un lock per workspace e tipo: due giri sovrapposti (Vercel
 *   può consegnare due volte lo stesso cron) ne scrivono uno solo.
 * - Il riepilogo nuovo prende il posto del vecchio: i segnali dei giorni prima dello stesso
 *   tipo passano a letti, anche quando oggi non si scrive niente (zero da decidere).
 * - Nei log solo nome e codice dell'errore (`logSafeError`), mai id, testi o valori.
 */

const LOG_SCOPE = "use-case-hub";

type Env = Readonly<Record<string, string | undefined>>;

// ─── Letture ─────────────────────────────────────────────────────────

/** Ultimo «Riapri»: riga `decisione` della Storia con la fase di prima in «Chiuso», giorno a Roma (come `use-case-hub.ts`). */
const REOPENED_ON: SQL<string | null> = sql`(SELECT to_char(max(e.at) AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD')
  FROM use_case_events e
  WHERE e.use_case_id = use_cases.id AND e.action = 'decisione' AND e.phase_before LIKE 'chiuso.%')`;

/**
 * Un campo tecnico di `intake`, solo se è un testo (come lo legge `connectorStatus`). La
 * chiave è una delle tre costanti qui sotto, scritta nella query come letterale.
 */
function intakeText(key: "possibleDuplicateOf" | "archiveReason" | "duplicateOfCode"): SQL<string | null> {
  const field = sql.raw(`'${key}'`);
  return sql<string | null>`CASE WHEN jsonb_typeof(${useCases.intake} -> ${field}) = 'string' THEN ${useCases.intake} ->> ${field} END`;
}

/** Le schede del workspace con le sole colonne che servono a fase e attesa. */
export async function readDigestRows(workspaceId: string): Promise<DigestRow[]> {
  const rows = await db
    .select({
      id: useCases.id,
      status: useCases.status,
      portfolioReviewStatus: useCases.portfolioReviewStatus,
      reviewedBy: useCases.reviewedBy,
      publicNote: useCases.publicNote,
      reviewBy: useCases.reviewBy,
      portfolioKind: useCases.portfolioKind,
      targetQuarter: useCases.targetQuarter,
      submittedAt: useCases.submittedAt,
      createdAt: useCases.createdAt,
      possibleDuplicateOf: intakeText("possibleDuplicateOf"),
      archiveReason: intakeText("archiveReason"),
      duplicateOfCode: intakeText("duplicateOfCode"),
      reopenedOn: REOPENED_ON,
    })
    .from(useCases)
    .where(eq(useCases.workspaceId, workspaceId));
  return rows.map(({ possibleDuplicateOf, archiveReason, duplicateOfCode, ...row }) => {
    const intake: Record<string, unknown> = {};
    if (possibleDuplicateOf !== null) intake.possibleDuplicateOf = possibleDuplicateOf;
    if (archiveReason !== null) intake.archiveReason = archiveReason;
    if (duplicateOfCode !== null) intake.duplicateOfCode = duplicateOfCode;
    return { ...row, intake };
  });
}

/** I workspace dell'elenco che esistono, nell'ordine del database. */
async function existingWorkspaces(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.select({ id: workspaces.id }).from(workspaces).where(inArray(workspaces.id, [...ids]));
  return rows.map((row) => row.id).sort();
}

/** Con `*`: ogni workspace del database, tranne gli esclusi. */
async function everyHubWorkspace(env: Env): Promise<string[]> {
  const rows = await db.select({ id: workspaces.id }).from(workspaces);
  return hubWorkspacesAmong(rows.map((row) => row.id), env).sort();
}

// ─── Scritture ───────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/**
 * Giorno a Roma di `weekly_signals.created_at`, un `timestamp` senza fuso scritto in UTC
 * (come lo scrive Drizzle e come lo legge `romeDay`).
 */
const SIGNAL_ROME_DAY = sql.raw(`to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD')`);

/** I segnali di `signalType` dei giorni prima di oggi (Roma), non ancora letti, passano a letti. */
function retireOlder(workspaceId: string, signalType: HubSignalType, today: string) {
  return db.execute(sql`UPDATE weekly_signals SET is_read = true
    WHERE workspace_id = ${workspaceId}::uuid AND signal_type = ${signalType} AND is_read = false
      AND ${SIGNAL_ROME_DAY} < ${today}`);
}

/**
 * Rinnova un tipo di segnale del workspace e restituisce quante righe ha scritto (0 o 1).
 * Senza segnale nuovo passa a letti i vecchi e basta. Con un segnale, in una transazione:
 * il lock per workspace e tipo (chi arriva secondo aspetta), i vecchi a letti, poi la riga
 * nuova solo se oggi non c'è già. Dopo il lock ogni istruzione legge il database di quel
 * momento (READ COMMITTED), quindi il secondo giro vede la riga del primo.
 */
async function renewSignal(
  workspaceId: string,
  signalType: HubSignalType,
  signal: HubSignal | null,
  now: Date,
  today: string,
): Promise<number> {
  if (!signal) {
    await retireOlder(workspaceId, signalType, today);
    return 0;
  }
  const lockKey = `use-case-digest:${workspaceId}:${signalType}`;
  const results = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}::text))`),
    retireOlder(workspaceId, signalType, today),
    db.execute(sql`INSERT INTO weekly_signals (workspace_id, signal_type, title, description, created_at)
      SELECT ${workspaceId}::uuid, ${signalType}::varchar, ${signal.title}::varchar, ${signal.description}::text, ${now.toISOString()}::timestamp
      WHERE NOT EXISTS (
        SELECT 1 FROM weekly_signals
        WHERE workspace_id = ${workspaceId}::uuid AND signal_type = ${signalType}
          AND created_at >= ${new Date(now.getTime() - 2 * DAY_MS).toISOString()}::timestamp
          AND ${SIGNAL_ROME_DAY} = ${today}
      )
      RETURNING id`),
  ]);
  return results[2].rows.length;
}

/** Rinnova i tipi di oggi (`dueHubSignalTypes`) con i segnali da scrivere. Restituisce quanti ne ha scritti. */
async function writeSignals(workspaceId: string, signals: readonly HubSignal[], now: Date, today: string): Promise<number> {
  let written = 0;
  for (const signalType of dueHubSignalTypes(today)) {
    const signal = signals.find((candidate) => candidate.signalType === signalType) ?? null;
    written += await renewSignal(workspaceId, signalType, signal, now, today);
  }
  return written;
}

// ─── Il passo ────────────────────────────────────────────────────────

/**
 * Riepilogo di un workspace acceso: legge, conta, scrive. Restituisce quanti segnali ha
 * scritto. Lancia se qualcosa si rompe: il `try/catch` sta in `runUseCaseDigestStep`.
 */
export async function digestWorkspace(workspaceId: string, now: Date): Promise<number> {
  const today = romeToday(now);
  const rows = await readDigestRows(workspaceId);
  // Senza use case non c'è niente da decidere né una roadmap da rivedere: nessun segnale, neanche
  // «Nuovo trimestre» (con `*` sono molti i workspace vuoti o di sola Formazione). I segnali dei
  // giorni prima dei tipi di oggi passano a letti lo stesso.
  if (rows.length === 0) return writeSignals(workspaceId, [], now, today);
  const dossiers = await dossierStates(
    workspaceId,
    rows.map((row) => row.id),
  );
  // «spenta»: nessun dossier, e va bene. «errore»: lo stato non si sa (null).
  const lookup = dossiers.ok
    ? (useCaseId: string) => dossiers.states.get(useCaseId.toLowerCase()) ?? null
    : dossiers.motivo === "spenta"
      ? () => null
      : null;
  return writeSignals(workspaceId, hubWeeklySignals(digestCounts(rows, today, lookup), today), now, today);
}

export interface UseCaseDigestStepResult {
  /** Workspace accesi ed esistenti. */
  workspaces: number;
  /** Segnali scritti. */
  signals: number;
  /** Workspace in cui il riepilogo non è riuscito. */
  failed: number;
}

export interface UseCaseDigestStepOptions {
  now?: Date;
  /** Le variabili da cui leggere `USE_CASE_HUB_WORKSPACES` e `USE_CASE_HUB_EXCLUDE`; predefinita `process.env`. */
  env?: Env;
  /** Il riepilogo di un workspace; predefinito `digestWorkspace` (le prove lo avvolgono). */
  digest?: (workspaceId: string, now: Date) => Promise<number>;
}

/**
 * Il passo dell'hub del cron: un riepilogo per ogni workspace acceso, ognuno nel suo
 * `try/catch`. Non lancia mai: un guasto prima del ciclo (schema, elenco dei workspace)
 * si registra e il passo finisce con zero workspace.
 */
export async function runUseCaseDigestStep(opts: UseCaseDigestStepOptions = {}): Promise<UseCaseDigestStepResult> {
  const now = opts.now ?? new Date();
  const digest = opts.digest ?? digestWorkspace;
  const result: UseCaseDigestStepResult = { workspaces: 0, signals: 0, failed: 0 };
  const env = opts.env ?? process.env;
  const all = hubRollout(env).all;
  const enabled = all ? [] : [...hubWorkspaceIds(env)];
  if (!all && enabled.length === 0) return result;
  let ids: string[];
  try {
    await ensureDbSchema();
    ids = all ? await everyHubWorkspace(env) : await existingWorkspaces(enabled);
  } catch (error) {
    logSafeError(LOG_SCOPE, "digest_step_failed", error, { op: "digest" });
    return result;
  }
  result.workspaces = ids.length;
  for (const workspaceId of ids) {
    try {
      result.signals += await digest(workspaceId, now);
    } catch (error) {
      result.failed += 1;
      logSafeError(LOG_SCOPE, "digest_failed", error, { op: "digest" });
    }
  }
  return result;
}
