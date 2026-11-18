/**
 * Il contesto della settimana (rilascio 9b «Contesto nel lavoro», docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.9, §5.8,
 * D6): i numeri di «Contesto» di ogni workspace per il blocco «Contesto» del riepilogo del lunedì
 * (`riepilogo_settimanale`, `queries/uc-notifications-dispatch.ts`). È l'unico posto del riepilogo che legge le tabelle
 * `context_*`.
 *
 * - **Per workspace, mai per persona** (art. 15.4): le novità (i fatti attivi nati negli ultimi 7 giorni, tutti e solo
 *   quelli «Per tutti»), le proposte da confermare, i fatti da verificare, gli impegni aperti scaduti o in scadenza nei
 *   7 giorni (nostri e del cliente), e fino a tre impegni del cliente «Per tutti» con il testo e la scadenza.
 * - **Ogni query porta `workspace_id`**: le righe di un altro workspace non si contano mai.
 * - **Nessun testo di un fatto.** Il testo degli impegni per l'Owner passa ancora una volta da `scanPersonalData`: va al
 *   cliente per e-mail, e un testo con i dati di una persona resta fuori (lo ferma già la scrittura).
 * - **Non lancia**: senza l'archivio di «Contesto» (la 0038) o con un errore del database il riepilogo parte senza il
 *   blocco; l'errore va nel log con il solo nome e codice.
 * - Che cosa vede ogni pubblico lo decide `planWeekly` (`src/lib/uc/notify/dispatch.ts`): a Lateral Space i numeri e il
 *   link, all'Owner del cliente solo quello che è «Per tutti».
 *
 * Modulo senza import dell'app (`@/…`, `server-only`), come `uc-notifications-dispatch.ts` che lo chiama: l'esecutore
 * arriva da fuori, così lo provano i test sul harness locale.
 */
import { scanPersonalData } from "../../context/scan.ts";
import { CONTEXT_LIMITS } from "../../context/vocab.ts";
import { logSafeError } from "../../log/safe-error.ts";
import { addCalendarDays, romeDate } from "../../uc/calendar.ts";
import { isUuid } from "../../uc/ids.ts";
import type { WeeklyContext } from "../../uc/notify/dispatch.ts";
import { WEEKLY_CONTEXT_COMMITMENTS_MAX } from "../../uc/notify/email-templates.ts";
import { rowBool, rowJson, rowNumber, rowString, type Row } from "../../uc/sql/readiness.ts";
import { cast, raw, toStatement, ucSql, type UcStatement } from "../../uc/sql/statement.ts";
import type { UcExecutor } from "../uc-executor.ts";

export type { WeeklyContext } from "../../uc/notify/dispatch.ts";

const LOG_SCOPE = "context/weekly";
const DAY_MS = 86_400_000;

/** La settimana del riepilogo: le novità sono i fatti nati negli ultimi 7 giorni. */
export const WEEKLY_NOVELTY_DAYS = 7;

/** Gli impegni del cliente letti per l'Owner prima del controllo dei dati personali: ne restano al massimo tre. */
const OWNER_COMMITMENT_CANDIDATES = 10;

/** L'archivio di «Contesto» (la 0038) c'è? Senza le sue tabelle la lettura non parte. */
export const WEEKLY_CONTEXT_PROBE_SQL =
  "to_regclass('public.context_facts') IS NOT NULL AND to_regclass('public.context_proposals') IS NOT NULL AND to_regclass('public.context_commitments') IS NOT NULL";

const CIVIL_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * I numeri della settimana di questi workspace: una riga per workspace, anche senza niente (zeri). Ogni sottoquery porta
 * `workspace_id = w.id`. `since`: da quando un fatto è una novità; `dueBy`: l'ultimo giorno (di Roma) di un impegno «in
 * scadenza», quelli scaduti compresi.
 */
export function weeklyContextSql(i: { workspaceIds: readonly string[]; since: Date; dueBy: string }): UcStatement {
  const since = cast(i.since.toISOString(), "timestamptz");
  const dueBy = cast(i.dueBy, "date");
  return toStatement(ucSql`WITH w AS (SELECT DISTINCT unnest(${cast([...i.workspaceIds], "uuid[]")}) AS id)
SELECT w.id AS workspace_id, facts.novelties_all, facts.novelties_shared, facts.to_check, proposals.to_confirm,
  due.ours AS due_ours, due.theirs AS due_theirs, coalesce(shared.items, '[]'::jsonb) AS theirs_shared
FROM w
CROSS JOIN LATERAL (
  SELECT count(*) FILTER (WHERE f.created_at >= ${since})::int AS novelties_all,
    count(*) FILTER (WHERE f.created_at >= ${since} AND f.visibility = 'tutti')::int AS novelties_shared,
    count(*) FILTER (WHERE f.needs_check)::int AS to_check
  FROM context_facts f WHERE f.workspace_id = w.id AND f.status = 'attivo'
) facts
CROSS JOIN LATERAL (
  SELECT count(*)::int AS to_confirm FROM context_proposals p WHERE p.workspace_id = w.id AND p.status = 'aperta'
) proposals
CROSS JOIN LATERAL (
  SELECT count(*) FILTER (WHERE c.party = 'nostra')::int AS ours, count(*) FILTER (WHERE c.party = 'cliente')::int AS theirs
  FROM context_commitments c WHERE c.workspace_id = w.id AND c.status = 'aperto' AND c.due_on <= ${dueBy}
) due
CROSS JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object('statement', x.statement, 'dueOn', to_char(x.due_on, 'YYYY-MM-DD'), 'visibility', x.visibility) ORDER BY x.due_on, x.created_at, x.id) AS items
  FROM (
    SELECT c.statement, c.due_on, c.visibility, c.created_at, c.id FROM context_commitments c
    WHERE c.workspace_id = w.id AND c.status = 'aperto' AND c.party = 'cliente' AND c.visibility = 'tutti' AND c.due_on <= ${dueBy}
    ORDER BY c.due_on, c.created_at, c.id
    LIMIT ${cast(OWNER_COMMITMENT_CANDIDATES, "int")}
  ) x
) shared
ORDER BY w.id`);
}

/** Un conto della riga: un intero non negativo. */
function countOf(value: unknown): number {
  const n = rowNumber(value);
  return n !== null && Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Gli impegni del cliente per l'Owner: solo «Per tutti», con il testo e una scadenza valida, e senza i dati di una
 * persona (`scanPersonalData`, come per ogni testo che esce da Lateral Space). Al massimo tre, nell'ordine della query.
 */
function sharedCommitments(value: unknown): WeeklyContext["theirsShared"] {
  const items = rowJson<unknown[]>(value);
  if (!Array.isArray(items)) return [];
  const out: { statement: string; dueOn: string; visibility: "tutti" }[] = [];
  for (const item of items) {
    if (out.length >= WEEKLY_CONTEXT_COMMITMENTS_MAX) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const { statement, dueOn, visibility } = item as Record<string, unknown>;
    if (visibility !== "tutti" || typeof statement !== "string" || statement.trim() === "" || typeof dueOn !== "string" || !CIVIL_DAY.test(dueOn)) continue;
    if (!scanPersonalData(statement).ok) continue;
    out.push({ statement, dueOn, visibility });
  }
  return out;
}

/** Una riga di `weeklyContextSql`: il workspace e i suoi numeri, o null se la riga non ha un workspace. */
export function rowToWeeklyContext(row: Row): { workspaceId: string; context: WeeklyContext } | null {
  const workspaceId = rowString(row.workspace_id)?.toLowerCase() ?? null;
  if (!isUuid(workspaceId)) return null;
  return {
    workspaceId,
    context: {
      novelties: { all: countOf(row.novelties_all), shared: countOf(row.novelties_shared) },
      toConfirm: countOf(row.to_confirm),
      toCheck: countOf(row.to_check),
      due: { ours: countOf(row.due_ours), theirs: countOf(row.due_theirs) },
      theirsShared: sharedCommitments(row.theirs_shared),
    },
  };
}

/** Una volta vera, la sonda resta così nel processo: le tabelle della 0038 non spariscono. */
let tablesReady = false;

/**
 * Il contesto della settimana di questi workspace, a `now`: una voce per workspace (zeri se non c'è niente). Una mappa
 * vuota senza l'archivio di «Contesto» o con un errore del database: il riepilogo parte senza il blocco. Non lancia.
 */
export async function loadWeeklyContext(executor: UcExecutor, workspaceIds: readonly string[], now: Date): Promise<Map<string, WeeklyContext>> {
  const ids = [...new Set((Array.isArray(workspaceIds) ? workspaceIds : []).filter(isUuid).map((id) => id.toLowerCase()))];
  if (ids.length === 0 || !(now instanceof Date) || Number.isNaN(now.getTime())) return new Map();
  try {
    if (!tablesReady) {
      const [[probe]] = await executor.batch([toStatement(ucSql`SELECT ${raw(WEEKLY_CONTEXT_PROBE_SQL)} AS ok`)]);
      if (!rowBool(probe?.ok)) return new Map();
      tablesReady = true;
    }
    const since = new Date(now.getTime() - WEEKLY_NOVELTY_DAYS * DAY_MS);
    const dueBy = addCalendarDays(romeDate(now), CONTEXT_LIMITS.weeklyDueDays);
    const [rows] = await executor.batch([weeklyContextSql({ workspaceIds: ids, since, dueBy })]);
    const out = new Map<string, WeeklyContext>();
    for (const row of rows) {
      const parsed = rowToWeeklyContext(row);
      if (parsed && ids.includes(parsed.workspaceId)) out.set(parsed.workspaceId, parsed.context);
    }
    return out;
  } catch (error) {
    logSafeError(LOG_SCOPE, "contesto_settimana_non_letto", error, { workspaces: ids.length });
    return new Map();
  }
}
