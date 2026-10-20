/**
 * Letture del database per i tool del connettore (prompt WP5), con SQL esplicito e
 * parametri: chiave di idempotenza già completata, esistenza di un codice collegato,
 * ricerca dei simili e stato per codice.
 *
 * Ogni lettura è chiusa nel workspace del principal (`workspace_id = $1`): un tool
 * non vede mai un altro workspace. Le colonne restituite sono solo quelle del
 * contratto: mai `proposed_by`, email, note interne, punteggi o date esatte nella
 * ricerca; mai punteggi, `review_notes`, revisori o chi propone nello stato.
 *
 * Lo stato si calcola con `connectorStatus` (`status.ts`); `review_by` si legge come
 * `to_jsonb(u) ->> 'review_by'`, così la query vale prima e dopo la migrazione 0020
 * dell'hub (PIANO-LAVORI §2.6, punto 3). Il dossier dei Casi d'uso avviato dalla
 * segnalazione (`linkedCaseCode`, stato AVVIATA_COME_CASO) arriva da `linked-case.ts`:
 * solo con `UC_ENABLED`, con la tabella presente (`to_regclass`, letto nella stessa
 * query) e con il dossier completo. Ricerca e stato lo usano allo stesso modo, così lo
 * stato di una segnalazione è lo stesso nei due tool. Gli agenti corrispondenti della
 * ricerca (`matchingAgents`) sono in `matching-agents.ts`: non toccano il database.
 *
 * Modulo puro: il database arriva come `SqlExecutor` (nell'app `db.$client.query`
 * dopo il self-heal); gira con `node --test` e con il database locale di prova.
 */
import { connectorSearchVectorSql } from "../db/connector-ddl.ts";
import { CONTRACT_CODE_PATTERN, type FindSimilarInput } from "./contract.ts";
import { isTrue, linkedCases, UC_CASES_PRESENT_SQL, type LinkedCase, type LinkedCaseOptions } from "./linked-case.ts";
import type { SqlExecutor } from "./rate-limit.ts";
import {
  connectorStatus,
  type ConnectorStatusCode,
  type UseCaseLifecycleStatus,
  type UseCaseReviewStatus,
} from "./status.ts";
import { decideExistingSubmission } from "../portfolio/idempotency.ts";

const CODE = new RegExp(CONTRACT_CODE_PATTERN);

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  return s.trim() === "" ? null : s;
}

/** Solo un codice nel formato del contratto esce da `intake`: mai testo libero. */
function codeOrNull(value: unknown): string | null {
  const s = text(value)?.trim();
  return s && CODE.test(s) ? s : null;
}

// ─── Stato di una riga ───────────────────────────────────────────────────────

/** Colonne che servono a `connectorStatus`, con l'alias `u` di `use_cases`. */
const STATUS_COLUMNS = `u.status::text AS status,
       u.portfolio_review_status::text AS review_status,
       u.reviewed_by::text AS reviewed_by,
       u.public_note,
       u.intake ->> 'possibleDuplicateOf' AS possible_duplicate_of,
       u.intake ->> 'archiveReason' AS archive_reason,
       u.intake ->> 'duplicateOfCode' AS duplicate_of_code,
       to_jsonb(u) ->> 'review_by' AS review_by`;

type Row = Record<string, unknown>;

/** Senza `UC_ENABLED` nessun dossier: è il valore delle letture chiamate senza opzioni. */
const NO_LINKED_CASES: LinkedCaseOptions = Object.freeze({ enabled: false });

function statusOfRow(row: Row, linkedCaseCode: string | null) {
  const intake: { possibleDuplicateOf?: string; archiveReason?: string; duplicateOfCode?: string } = {};
  const possible = text(row.possible_duplicate_of);
  const reason = text(row.archive_reason);
  const duplicateOf = text(row.duplicate_of_code);
  if (possible) intake.possibleDuplicateOf = possible;
  if (reason) intake.archiveReason = reason;
  if (duplicateOf) intake.duplicateOfCode = duplicateOf;
  return connectorStatus({
    status: String(row.status) as UseCaseLifecycleStatus,
    portfolioReviewStatus: String(row.review_status) as UseCaseReviewStatus,
    reviewedBy: text(row.reviewed_by),
    publicNote: text(row.public_note),
    intake,
    reviewBy: text(row.review_by),
    linkedCaseCode,
  });
}

/**
 * I dossier delle righe lette (per id della segnalazione). Le righe portano `id` e
 * `uc_present` (`UC_CASES_PRESENT_SQL`); senza sezione o senza tabella nessuna query.
 */
async function linkedCasesOfRows(exec: SqlExecutor, workspaceId: string, rows: readonly Row[], opts: LinkedCaseOptions) {
  return linkedCases(
    exec,
    { workspaceId, useCaseIds: rows.map((row) => String(row.id ?? "")), ucPresent: rows.some((row) => isTrue(row.uc_present)) },
    opts
  );
}

function linkedOf(row: Row, linked: ReadonlyMap<string, LinkedCase>): LinkedCase | null {
  return linked.get(String(row.id ?? "").toLowerCase()) ?? null;
}

// ─── Idempotenza: lettura senza scrivere ─────────────────────────────────────

export const COMPLETED_SUBMISSION_SQL = `SELECT request_hash, status, use_case_id::text AS use_case_id, reserved_use_case_id::text AS reserved_use_case_id
  FROM external_contribution_submissions
 WHERE workspace_id = $1 AND principal_key = $2 AND idempotency_key = $3
 LIMIT 1`;

/**
 * Passo 3 di `submit_contribution`: se la chiave esiste già, con lo stesso contenuto
 * e una segnalazione collegata, l'id di quella segnalazione (il duplicato si
 * restituisce senza consumare il limite). Altrimenti null: decide la presa in carico.
 */
export async function findCompletedSubmissionUseCaseId(
  exec: SqlExecutor,
  params: { workspaceId: string; principalKey: string; idempotencyKey: string; requestHash: string }
): Promise<string | null> {
  const [row] = await exec(COMPLETED_SUBMISSION_SQL, [params.workspaceId, params.principalKey, params.idempotencyKey]);
  if (!row) return null;
  const useCaseId = text(row.use_case_id);
  const decision = decideExistingSubmission(
    {
      status: String(row.status),
      requestHash: String(row.request_hash),
      useCaseId,
      reservedUseCaseId: text(row.reserved_use_case_id),
      ageSeconds: 0,
    },
    params.requestHash
  );
  return decision.kind === "duplicate" ? useCaseId : null;
}

// ─── Codice collegato ────────────────────────────────────────────────────────

export const RELATED_CODE_SQL = `SELECT 1 AS found FROM use_cases WHERE workspace_id = $1 AND code = $2 LIMIT 1`;

/** Il codice esiste nel workspace del principal (mai in un altro). */
export async function relatedCodeExists(exec: SqlExecutor, workspaceId: string, code: string): Promise<boolean> {
  if (!CODE.test(code)) return false;
  const rows = await exec(RELATED_CODE_SQL, [workspaceId, code]);
  return rows.length > 0;
}

// ─── Ricerca dei simili ──────────────────────────────────────────────────────

/** Parole al massimo nella ricerca (le istruzioni chiedono 3-6 parole chiave). */
export const SEARCH_MAX_WORDS = 12;
const SEARCH_MAX_WORD_CHARS = 60;

/**
 * Parole della ricerca: lettere e cifre Unicode (le accentate restano), l'apostrofo
 * diventa uno spazio («dell'aereo» → «dell», «aereo»), senza doppioni.
 */
export function searchWords(query: string): string[] {
  const words = query
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => [...w].slice(0, SEARCH_MAX_WORD_CHARS).join(""));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words) {
    const key = word.toLocaleLowerCase("it");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length === SEARCH_MAX_WORDS) break;
  }
  return out;
}

/**
 * Le parole in OR per `websearch_to_tsquery('italian', …)`: senza simboli non c'è
 * sintassi da interpretare, e le stopword le toglie la configurazione `italian`.
 */
export function searchQueryText(words: readonly string[]): string {
  return words.join(" or ");
}

/**
 * Stessa espressione dell'indice GIN in coda alla 0019 (`use_cases_search_italian_unaccent_idx`,
 * decisione del 19/10/2026): titolo e descrizione senza accenti (`public.connector_unaccent`),
 * poi la configurazione `italian`. La ricerca passa dalla stessa funzione
 * (`SEARCH_TSQUERY_SQL`), così «qualita» trova «qualità» e viceversa.
 */
export const SEARCH_VECTOR_SQL = connectorSearchVectorSql("u.");

/** La query della ricerca, senza accenti come il documento: `$2` sono le parole in OR. */
export const SEARCH_TSQUERY_SQL = `websearch_to_tsquery('italian', public.connector_unaccent($2))`;

/**
 * Momento dell'invio in ora italiana, per il mese della ricerca. `submitted_at` e
 * `created_at` sono `timestamp without time zone` con l'ora UTC (come li scrive drizzle):
 * prima si leggono come UTC, poi si portano a Europe/Rome, come il giorno di
 * `statusChangedAt`. Un invio del 31/10 alle 23:30 UTC (1/11 alle 00:30 in Italia) è di
 * novembre.
 */
export const SUBMITTED_ROME = `((coalesce(u.submitted_at, u.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome')`;

export const SEARCH_CONTRIBUTIONS_SQL = `WITH q AS (SELECT ${SEARCH_TSQUERY_SQL} AS query, ${UC_CASES_PRESENT_SQL} AS uc_present)
SELECT u.id::text AS id,
       q.uc_present,
       u.code,
       u.title,
       u.intake ->> 'area' AS area,
       u.portfolio_kind AS kind,
       to_char(${SUBMITTED_ROME}, 'YYYY-MM') AS month,
       u.intake ->> 'relatedAgent' AS related_agent,
       ${STATUS_COLUMNS},
       ts_rank_cd(${SEARCH_VECTOR_SQL}, q.query) AS rank
  FROM use_cases u, q
 WHERE u.workspace_id = $1
   AND u.code IS NOT NULL
   AND ${SEARCH_VECTOR_SQL} @@ q.query
   AND NOT (u.portfolio_review_status = 'archived' AND coalesce(u.intake ->> 'archiveReason', '') <> 'duplicato')
   AND coalesce(u.intake ->> 'hiddenFromSearch', '') <> 'true'
   AND ($3::text IS NULL OR u.intake ->> 'area' = $3)
   AND ($4::text IS NULL OR u.portfolio_kind = $4)
 ORDER BY rank DESC, coalesce(u.submitted_at, u.created_at) DESC, u.code
 LIMIT $5`;

export interface SimilarContribution {
  code: string;
  title: string;
  area: string | null;
  kind: string | null;
  statusCode: ConnectorStatusCode;
  statusLabel: string;
  /** Mese di invio, `AAAA-MM`: mai la data esatta. */
  month: string | null;
  relatedAgent: string | null;
}

/**
 * Segnalazioni del workspace simili alla ricerca, per `ts_rank_cd`. Escluse quelle
 * senza codice, quelle nascoste dalla ricerca e le archiviate che non sono doppioni.
 * Lo stato tiene conto del dossier avviato (AVVIATA_COME_CASO), come lo stato per codice.
 */
export async function searchContributions(
  exec: SqlExecutor,
  params: { workspaceId: string; input: FindSimilarInput },
  opts: LinkedCaseOptions = NO_LINKED_CASES
): Promise<SimilarContribution[]> {
  const words = searchWords(params.input.query);
  if (!words.length) return [];
  const rows = await exec(SEARCH_CONTRIBUTIONS_SQL, [
    params.workspaceId,
    searchQueryText(words),
    params.input.area ?? null,
    params.input.kind ?? null,
    params.input.limit,
  ]);
  const linked = await linkedCasesOfRows(exec, params.workspaceId, rows, opts);
  return rows.flatMap((row) => {
    const code = codeOrNull(row.code);
    if (!code) return [];
    const { statusCode, statusLabel } = statusOfRow(row, linkedOf(row, linked)?.code ?? null);
    return [
      {
        code,
        title: String(row.title ?? ""),
        area: text(row.area),
        kind: text(row.kind),
        statusCode,
        statusLabel,
        month: text(row.month),
        relatedAgent: text(row.related_agent),
      },
    ];
  });
}

// ─── Stato per codice ────────────────────────────────────────────────────────

const STATUS_VIEW_COLUMNS = `u.id::text AS id,
       ${UC_CASES_PRESENT_SQL} AS uc_present,
       u.code,
       u.title,
       u.portfolio_kind AS kind,
       u.intake ->> 'area' AS area,
       u.intake ->> 'hiddenFromSearch' AS hidden_from_search,
       to_char(u.status_changed_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') AS status_changed_on,
       ${STATUS_COLUMNS}`;

export const STATUS_BY_CODE_SQL = `SELECT ${STATUS_VIEW_COLUMNS}
  FROM use_cases u
 WHERE u.workspace_id = $1 AND u.code = $2
 LIMIT 1`;

export const RECENT_OF_IDENTITY_SQL = `SELECT ${STATUS_VIEW_COLUMNS}
  FROM use_cases u
 WHERE u.workspace_id = $1 AND u.submitted_by_user_id = $2 AND u.code IS NOT NULL
 ORDER BY coalesce(u.submitted_at, u.created_at) DESC
 LIMIT $3`;

/** Nota pubblica restituita al massimo (CHECK della colonna). */
export const PUBLIC_NOTE_MAX_CHARS = 1000;

export interface ContributionStatusView {
  code: string;
  title: string | null;
  kind: string | null;
  area: string | null;
  statusCode: ConnectorStatusCode;
  statusLabel: string;
  /** Giorno dell'ultimo cambio di stato (`AAAA-MM-GG`, ora italiana). */
  statusChangedAt: string | null;
  publicNote: string | null;
  linkedCaseCode: string | null;
  duplicateOfCode: string | null;
}

/**
 * Vista dello stato. Una segnalazione nascosta dalla ricerca esce ridotta: solo
 * codice, stato e data del cambio; gli altri campi sono null (anche `linkedCaseCode`:
 * lo stato dice già AVVIATA_COME_CASO). `linkedCaseCode` è il codice del dossier
 * completo, letto con `linked-case.ts`.
 *
 * `statusChangedAt` è il giorno di `status_changed_at`; per una segnalazione
 * AVVIATA_COME_CASO è il giorno in cui il dossier è stato avviato (`setup_completed_at`,
 * decisione di Pierpaolo del 19/10/2026): avviare un caso non cambia `use_cases.status`.
 * Se lo stato è un altro (per esempio REALIZZATA, che vince sul dossier), resta il
 * giorno della scheda.
 */
export function statusViewOfRow(row: Row, linked: LinkedCase | null = null): ContributionStatusView | null {
  const code = codeOrNull(row.code);
  if (!code) return null;
  const linkedCaseCode = linked?.code ?? null;
  const { statusCode, statusLabel } = statusOfRow(row, linkedCaseCode);
  const statusChangedAt = statusCode === "AVVIATA_COME_CASO" && linked?.startedOn ? linked.startedOn : text(row.status_changed_on);
  if (text(row.hidden_from_search) === "true") {
    return {
      code,
      title: null,
      kind: null,
      area: null,
      statusCode,
      statusLabel,
      statusChangedAt,
      publicNote: null,
      linkedCaseCode: null,
      duplicateOfCode: null,
    };
  }
  const note = text(row.public_note);
  return {
    code,
    title: text(row.title),
    kind: text(row.kind),
    area: text(row.area),
    statusCode,
    statusLabel,
    statusChangedAt,
    publicNote: note ? [...note].slice(0, PUBLIC_NOTE_MAX_CHARS).join("") : null,
    linkedCaseCode,
    duplicateOfCode: codeOrNull(row.duplicate_of_code),
  };
}

/** Lo stato della segnalazione con questo codice nel workspace, oppure null. */
export async function contributionStatusByCode(
  exec: SqlExecutor,
  params: { workspaceId: string; code: string },
  opts: LinkedCaseOptions = NO_LINKED_CASES
): Promise<ContributionStatusView | null> {
  if (!CODE.test(params.code)) return null;
  const [row] = await exec(STATUS_BY_CODE_SQL, [params.workspaceId, params.code]);
  if (!row) return null;
  const linked = await linkedCasesOfRows(exec, params.workspaceId, [row], opts);
  return statusViewOfRow(row, linkedOf(row, linked));
}

/** Fase 2 (identità verificata): le ultime segnalazioni della persona, al massimo 10. */
export async function recentContributionsOfIdentity(
  exec: SqlExecutor,
  params: { workspaceId: string; identityId: string; limit?: number },
  opts: LinkedCaseOptions = NO_LINKED_CASES
): Promise<ContributionStatusView[]> {
  const rows = await exec(RECENT_OF_IDENTITY_SQL, [params.workspaceId, params.identityId, params.limit ?? 10]);
  const linked = await linkedCasesOfRows(exec, params.workspaceId, rows, opts);
  return rows.flatMap((row) => {
    const view = statusViewOfRow(row, linkedOf(row, linked));
    return view ? [view] : [];
  });
}
