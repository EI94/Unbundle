/**
 * Rilascio 9b «Contesto nel lavoro»: DDL del self-heal della 0041 (docs/contesto/RILASCIO-9b-COSTRUZIONE.md §3).
 *
 * Sono gli stessi statement di `drizzle/0041_contesto_nel_lavoro.sql`, nello stesso ordine, dopo le due righe di
 * apertura del file (`lock_timeout` e l'advisory lock {@link CONTEXT_WORK_ADVISORY_LOCK}, che il self-heal prende da sé
 * in `runContextWorkDdl`):
 * 1. il controllo che la 0038 («Contesto») e «Cosa serve» ci siano;
 * 2. tre CHECK della 0038 allargati con lo stesso nome: `context_sources.kind` (+ `risposta`: le risposte del referente
 *    come fonte), `context_sources.origin` (+ `rispondi`), `context_events.channel` (+ `cli`, `rispondi`). Ogni blocco
 *    `DO` toglie e rimette il suo vincolo solo se manca un valore nuovo, e la lista nuova contiene tutta quella della
 *    0038: un CHECK non si restringe mai;
 * 3. `context_need_links`: un fatto che risponde a una richiesta di «Cosa serve». `proposta` nasce con la lettura (vale
 *    finché la sua proposta è aperta), `aperta` alla conferma di un fatto «Per tutti», `usata` con «Chiudi con questo»,
 *    `scartata` con «Non risponde» o quando il fatto non può arrivare al cliente;
 * 4. i quattro indici: una proposta un legame, un fatto una volta per richiesta, i legami aperti, i fatti da verificare;
 * 5. per ultimo, sotto l'advisory lock della 0025, il CHECK dei tipi della campanella allargato con `contesto_nuovo` e
 *    `dalla_call` (lo stesso blocco della 0025, che non restringe mai).
 *
 * Solo aggiunte: nessuna tabella tolta, nessuna colonna cambiata, nessun dato scritto, nessun CHECK più stretto. Il codice
 * di prima ignora la tabella e i valori nuovi. Il DDL uc (0018) non cambia.
 *
 * `src/lib/db/context-work-ddl.test.ts` controlla che la migrazione contenga questi statement, nello stesso ordine e
 * nient'altro, che le liste nuove contengano quelle della 0038 e quelle del vocabolario, e che la sonda copra ogni oggetto.
 * Modulo puro: importa solo i moduli puri della campanella; lo caricano anche gli script di verifica (il doctor).
 */
import { ALERTS_ADVISORY_LOCK, NOTIFICATION_KINDS_CHECK_NAME, notificationKindsWideningDdl } from "./use-case-hub-alerts-ddl.ts";
import { USE_CASE_NOTIFICATION_KINDS_0036 } from "./use-case-hub-evals-ddl.ts";

// ─── Vocabolario ─────────────────────────────────────────────────────

/** La chiave dell'advisory lock della 0041: la stessa nel file e in `runContextWorkDdl`. */
export const CONTEXT_WORK_ADVISORY_LOCK = "unbundle:context-work-ddl";

/** Errore della 0041 su un database senza la 0038 (o senza «Cosa serve»). */
export const MISSING_CONTEXT_FOR_WORK_MESSAGE = "contesto nel lavoro: manca la 0038. Applica prima drizzle/0038_contesto.sql.";

/** I due tipi nuovi della campanella (al massimo 16 caratteri): «Il contesto è cambiato», «Una risposta per «Cosa serve»». */
export const CONTEXT_WORK_NOTICE_KINDS = ["contesto_nuovo", "dalla_call"] as const;
export type ContextWorkNoticeKind = (typeof CONTEXT_WORK_NOTICE_KINDS)[number];

/** I tipi della campanella dopo la 0041: quelli della 0036 (dalla 0037 alla 0040 nessuna ne aggiunge) più i due nuovi. */
export const USE_CASE_NOTIFICATION_KINDS_0041 = [...USE_CASE_NOTIFICATION_KINDS_0036, ...CONTEXT_WORK_NOTICE_KINDS] as const;
export type UseCaseNoticeKind0041 = (typeof USE_CASE_NOTIFICATION_KINDS_0041)[number];

/** Gli stati di un legame tra un fatto e una richiesta di «Cosa serve» (`context_need_links.status`). */
export const NEED_LINK_STATUSES_0041 = ["proposta", "aperta", "usata", "scartata"] as const;

/**
 * I tre CHECK della 0038 che la 0041 allarga, con la lista intera di dopo (le stesse di `src/lib/context/vocab.ts`) e i
 * valori nuovi che la sonda cerca. L'ordine è quello del file.
 */
export const CONTEXT_WORK_WIDENED_CHECKS = Object.freeze([
  Object.freeze({
    table: "context_sources",
    constraint: "context_sources_kind_check",
    column: "kind",
    values: Object.freeze(["appunti", "trascrizione", "documento", "risposta"]),
    added: Object.freeze(["risposta"]),
  }),
  Object.freeze({
    table: "context_sources",
    constraint: "context_sources_origin_check",
    column: "origin",
    values: Object.freeze(["web", "granola", "claude", "cli", "rispondi"]),
    added: Object.freeze(["rispondi"]),
  }),
  Object.freeze({
    table: "context_events",
    constraint: "context_events_channel_check",
    column: "channel",
    values: Object.freeze(["web", "claude", "granola", "cron", "cli", "rispondi"]),
    added: Object.freeze(["cli", "rispondi"]),
  }),
]) satisfies ReadonlyArray<{ table: string; constraint: string; column: string; values: readonly string[]; added: readonly string[] }>;

// ─── Composizione del testo SQL ──────────────────────────────────────

/** `'a', 'b'`: valori noti, scritti qui sopra (nessun apice dentro). */
const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/** Il valore cercato nel testo del vincolo (`pg_get_constraintdef` lo scrive `'valore'::character varying`). */
const mentions = (value: string, oid: string) => `position('''${value}''' IN pg_get_constraintdef(${oid})) > 0`;

/**
 * Un CHECK della 0038 allargato con lo stesso nome: si toglie e si rimette solo se manca un valore nuovo. La lista nuova
 * contiene quella di prima, così le righe di prima restano valide e il vincolo si controlla subito (niente NOT VALID).
 */
function widenedCheckDdl(c: (typeof CONTEXT_WORK_WIDENED_CHECKS)[number]): string {
  return `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${c.constraint}' AND conrelid = 'public.${c.table}'::regclass
                 AND ${c.added.map((value) => mentions(value, "oid")).join(" AND ")}) THEN
    ALTER TABLE ${c.table} DROP CONSTRAINT IF EXISTS ${c.constraint};
    ALTER TABLE ${c.table} ADD CONSTRAINT ${c.constraint} CHECK (${c.column} IN (${quoted(c.values)}));
  END IF;
END $$;`;
}

/** Gli statement della 0041 dopo le due righe di apertura, nell'ordine del file (11). */
export const CONTEXT_WORK_DDL: readonly string[] = Object.freeze([
  `DO $$ BEGIN
  IF to_regclass('public.context_sources') IS NULL OR to_regclass('public.use_case_needs') IS NULL THEN
    RAISE EXCEPTION '${MISSING_CONTEXT_FOR_WORK_MESSAGE}';
  END IF;
END $$;`,
  ...CONTEXT_WORK_WIDENED_CHECKS.map(widenedCheckDdl),
  `CREATE TABLE IF NOT EXISTS context_need_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  need_id uuid NOT NULL REFERENCES use_case_needs(id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES context_proposals(id) ON DELETE SET NULL,
  fact_id uuid REFERENCES context_facts(id) ON DELETE CASCADE,
  status varchar(9) NOT NULL DEFAULT 'proposta' CONSTRAINT context_need_links_status_check CHECK (status IN (${quoted(NEED_LINK_STATUSES_0041)})),
  decided_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_need_links_pkey PRIMARY KEY (id),
  CONSTRAINT context_need_links_fact_check CHECK (status IN ('proposta', 'scartata') OR fact_id IS NOT NULL),
  CONSTRAINT context_need_links_decided_check CHECK ((status IN ('usata', 'scartata')) = (decided_at IS NOT NULL))
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS context_need_links_proposal_unique ON context_need_links (proposal_id) WHERE proposal_id IS NOT NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS context_need_links_fact_unique ON context_need_links (need_id, fact_id) WHERE fact_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS context_need_links_open_idx ON context_need_links (workspace_id, need_id) WHERE status = 'aperta';`,
  `CREATE INDEX IF NOT EXISTS context_facts_to_check_idx ON context_facts (workspace_id) WHERE needs_check AND status = 'attivo';`,
  // I tipi della campanella: lo stesso blocco della 0025, sotto il suo advisory lock (l'ordine è sempre 0041 poi 0025).
  `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`,
  notificationKindsWideningDdl(USE_CASE_NOTIFICATION_KINDS_0041),
]);

// ─── Pulizia (RUNBOOK §10.22, ritorno indietro e ritorno in avanti) ──

/** Il prefisso dell'`external_id` di una cosa imparata costruendo (`LEARNED_SOURCE_PREFIX` di `context/vocab.ts`). */
const LEARNED_PREFIX = "impara:";

/**
 * Il ritorno indietro, statement per statement: prima del Promote e di nuovo subito dopo (fino a che il Promote non è
 * attivo il deploy nuovo continua a scrivere). Idempotenti; sul codice nuovo non servono.
 * 1. La campanella: il codice di prima non conosce `contesto_nuovo` e `dalla_call` e li mostrerebbe senza testo.
 * 2. Le proposte aperte delle risposte del referente (`risposta`) e delle cose imparate (`impara:`) diventano «superate»:
 *    il codice di prima conta come fonte del cliente solo un documento (`isClientSource`) e in «Da confermare» le
 *    mostrerebbe già spuntate, come appunti di Lateral Space.
 */
export const CONTEXT_WORK_ROLLBACK_SWEEP_STATEMENTS: readonly string[] = Object.freeze([
  `DELETE FROM use_case_notifications WHERE kind IN (${quoted(CONTEXT_WORK_NOTICE_KINDS)});`,
  `UPDATE context_proposals p SET status = 'superata', decided_at = now(), updated_at = now(), version = p.version + 1 FROM context_sources s WHERE s.id = p.source_id AND s.workspace_id = p.workspace_id AND p.status = 'aperta' AND (s.kind = 'risposta' OR (s.origin = 'cli' AND s.external_id LIKE '${LEARNED_PREFIX}%'));`,
]);
/** Gli stessi statement in un testo solo, da incollare in `psql` (RUNBOOK §10.22). */
export const CONTEXT_WORK_ROLLBACK_SWEEP_SQL = CONTEXT_WORK_ROLLBACK_SWEEP_STATEMENTS.join("\n");

/** Le fonti delle risposte di una richiesta cancellata (conservazione dei 12 mesi o «Cancella i dati di questa persona»). */
const PURGED_ANSWER_SOURCES =
  "SELECT s.id FROM context_sources s JOIN use_case_referent_requests r ON r.workspace_id = s.workspace_id AND r.id::text = s.external_id WHERE s.origin = 'rispondi' AND s.kind = 'risposta' AND r.purged_at IS NOT NULL";

/**
 * Il ritorno in avanti, statement per statement e nell'ordine. Idempotenti.
 * 1-6. Con il codice di prima «Cancella i dati di questa persona» e la conservazione dei 12 mesi non toccano «Contesto»:
 *    la fonte delle risposte di una richiesta cancellata (`purged_at`) prende `text_purged_at` (con la riga di storia),
 *    le sue proposte aperte diventano «superate», e le citazioni (`quote`) delle proposte, dei fatti, degli impegni e delle
 *    domande nati da lei diventano nulle, come fa il codice nuovo (`referentSourcesEraseStatements`). I fatti restano.
 * 7. Le fonti delle risposte che il codice di prima ha letto senza testo (`vuoto`) tornano da leggere.
 */
export const CONTEXT_WORK_ROLL_FORWARD_STATEMENTS: readonly string[] = Object.freeze([
  `WITH purged AS (UPDATE context_sources s SET text_purged_at = now(), read_started_at = NULL, updated_at = now(), version = s.version + 1, read_status = CASE WHEN s.read_status IN ('da_leggere', 'in_lettura') THEN 'non_letto' ELSE s.read_status END, read_reason = CASE WHEN s.read_status IN ('da_leggere', 'in_lettura') THEN 'vuoto' ELSE s.read_reason END WHERE s.text_purged_at IS NULL AND s.id IN (${PURGED_ANSWER_SOURCES}) RETURNING s.id, s.workspace_id) INSERT INTO context_events (workspace_id, action, channel, source_id) SELECT workspace_id, 'testo_cancellato', 'rispondi', id FROM purged;`,
  `UPDATE context_proposals p SET status = 'superata', decided_at = now(), quote = NULL, updated_at = now(), version = p.version + 1 WHERE p.status = 'aperta' AND p.source_id IN (${PURGED_ANSWER_SOURCES});`,
  ...["context_proposals", "context_facts", "context_commitments", "context_questions"].map(
    (table) => `UPDATE ${table} x SET quote = NULL WHERE x.quote IS NOT NULL AND x.source_id IN (${PURGED_ANSWER_SOURCES});`,
  ),
  "UPDATE context_sources SET read_status = 'da_leggere', read_reason = NULL, read_attempts = 0 WHERE origin = 'rispondi' AND read_reason = 'vuoto' AND text_purged_at IS NULL;",
]);
/** Gli stessi statement in un testo solo, da incollare in `psql` dopo il ritorno in avanti (RUNBOOK §10.22). */
export const CONTEXT_WORK_ROLL_FORWARD_SQL = CONTEXT_WORK_ROLL_FORWARD_STATEMENTS.join("\n");

// ─── Sonda ───────────────────────────────────────────────────────────

/** La tabella della 0041. */
export const CONTEXT_WORK_TABLE = "context_need_links";

/** Gli indici della 0041, per nome: i due unici, i legami aperti, i fatti da verificare. */
export const CONTEXT_WORK_INDEXES = Object.freeze([
  "context_need_links_proposal_unique",
  "context_need_links_fact_unique",
  "context_need_links_open_idx",
  "context_facts_to_check_idx",
] as const);

/** I vincoli con nome della tabella nuova: la chiave e i tre CHECK. */
export const CONTEXT_WORK_NAMED_CONSTRAINTS = Object.freeze([
  "context_need_links_status_check",
  "context_need_links_pkey",
  "context_need_links_fact_check",
  "context_need_links_decided_check",
] as const);

/** Il vincolo `name` della tabella `table` c'è e nomina tutti i `values`. */
const constraintMentions = (table: string, name: string, values: readonly string[]) => `EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.${table}') AND c.conname = '${name}'
      AND ${values.map((value) => mentions(value, "c.oid")).join(" AND ")}
  )`;

/**
 * Vera solo con tutto il DDL della 0041: la tabella con la sua chiave e i suoi CHECK, i quattro indici, i tre CHECK di
 * «Contesto» con i valori nuovi, la campanella con `contesto_nuovo` e `dalla_call`. Per `ensureDbSchema()`, per
 * `contextWorkReady()` e per il doctor (`migrazione0041`).
 */
export const CONTEXT_WORK_PROBE_SQL = `(
  to_regclass('public.${CONTEXT_WORK_TABLE}') IS NOT NULL
  AND ${CONTEXT_WORK_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid = to_regclass('public.${CONTEXT_WORK_TABLE}')
      AND conname IN (${quoted(CONTEXT_WORK_NAMED_CONSTRAINTS)})
  ) = ${CONTEXT_WORK_NAMED_CONSTRAINTS.length}
  AND ${CONTEXT_WORK_WIDENED_CHECKS.map((c) => constraintMentions(c.table, c.constraint, c.added)).join("\n  AND ")}
  AND ${constraintMentions("use_case_notifications", NOTIFICATION_KINDS_CHECK_NAME, CONTEXT_WORK_NOTICE_KINDS)}
)`;
