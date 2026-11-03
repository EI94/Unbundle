/**
 * Area «Use case», «Referente in un tocco» (rilascio 5): DDL del self-heal della 0026.
 *
 * Sono gli stessi statement di `drizzle/0026_use_case_referent_check.sql`, nello stesso ordine, dopo le
 * due righe di apertura del file (`lock_timeout` e l'advisory lock {@link REFERENT_CHECK_ADVISORY_LOCK},
 * che il self-heal prende da sé in `runUseCaseReferentCheckDdl`):
 * 1. controllo che la 0024 ci sia (le richieste ai referenti e le risposte);
 * 2. `use_case_referent_checks`: la conferma dello use case e la stima del tempo del referente, una
 *    riga per richiesta al referente (la riga c'è da quando la richiesta parte: segna la richiesta
 *    come «al referente»), con l'istantanea della stima del team che il referente ha visto;
 * 3. `file_required` sulle domande di una richiesta («Serve un file», lo sceglie chi chiede);
 * 4. `comment` e `already_attached` sulle risposte («Chi potrebbe saperlo?», il commento, «È già
 *    allegato»);
 * 5. per ultimo l'unico CHECK nuovo su una tabella che c'era già: il commento solo sulle righe del
 *    referente (`NOT VALID`, poi `VALIDATE`, che non può fallire su una colonna tutta NULL).
 *
 * Tutti idempotenti e solo additivi: nessun DROP, nessun dato scritto, nessuna colonna cambiata. Il
 * codice di prima ignora la tabella e le colonne nuove (i suoi INSERT lasciano i default, le sue
 * SELECT nominano le colonne) e nessuna sua scrittura può violare il CHECK nuovo (non scrive mai
 * `comment`, non cambia mai `source`). Le altre regole delle colonne nuove (`dont_know` e
 * `already_attached` che si escludono, il commento solo con una chiusura senza testo) stanno nel
 * codice, con i test: la regola di §0 della SPEC, così il codice del rilascio 4 funziona anche dopo un
 * ritorno indietro.
 *
 * `src/lib/db/use-case-hub-referent-check-ddl.test.ts` controlla che la migrazione li contenga tutti,
 * nello stesso ordine, che i CHECK siano gli elenchi qui sotto e che la sonda copra ogni oggetto.
 * Modulo puro: importa solo `./use-case-hub-referents-ddl.ts`; lo caricano anche gli script di verifica.
 */
import type { ReferentEntrySource } from "./use-case-hub-referents-ddl.ts";

/** Le righe del referente: le uniche che possono avere un commento. */
export const COMMENT_SOURCE: ReferentEntrySource = "referente";

// ─── Vocabolario ─────────────────────────────────────────────────────

/** La risposta del referente al passo «Lo use case»: «Sì, è così» o «Correggi». */
export const REFERENT_CHECK_CONFIRMS = ["si", "correggi"] as const;
export type ReferentCheckConfirm = (typeof REFERENT_CHECK_CONFIRMS)[number];

/** La risposta del referente alla stima del team: «Sì», «È di meno», «È di più». */
export const REFERENT_CHECK_ESTIMATES = ["si", "meno", "piu"] as const;
export type ReferentCheckEstimate = (typeof REFERENT_CHECK_ESTIMATES)[number];

/** Cosa ha fatto il team della stima del referente: usata, oppure tenuta la propria. */
export const REFERENT_CHECK_OUTCOMES = ["adottata", "tenuta"] as const;
export type ReferentCheckOutcome = (typeof REFERENT_CHECK_OUTCOMES)[number];

/** I limiti dei numeri del referente (SPEC §3.3): `times_per_month × 12` resta nel `volumeYearMax`. */
export const REFERENT_CHECK_LIMITS = Object.freeze({ timesPerMonthMax: 8_333_333, minutesEachMax: 100_000, noteMax: 1000, commentMax: 1000 });

/** La chiave dell'advisory lock della 0026: la stessa nel file e in `runUseCaseReferentCheckDdl`. */
export const REFERENT_CHECK_ADVISORY_LOCK = "unbundle:use-case-referent-check-ddl";

/** Quanto aspetta ogni lock della 0026 prima di fermarsi senza cambiare nulla. */
export const REFERENT_CHECK_LOCK_TIMEOUT = "3s";

/** Errore della 0026 su un database senza la 0024. */
export const MISSING_REFERENTS_FOR_CHECK_MESSAGE = "use_case_referent_check: manca la 0024. Applica prima drizzle/0024_use_case_referents.sql.";

/** Il CHECK nuovo su `use_case_need_answers` (l'unico su una tabella che c'era già). */
export const ANSWER_COMMENT_CHECK_NAME = "use_case_need_answers_comment_check";

/** Le colonne che la 0026 aggiunge a tabelle della 0024, nell'ordine (per il test delle colonne Drizzle). */
export const REFERENT_CHECK_ADDED_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  use_case_referent_request_items: Object.freeze(["file_required"]),
  use_case_need_answers: Object.freeze(["comment", "already_attached"]),
});

// ─── Composizione del testo SQL ──────────────────────────────────────

/** `'a', 'b'`: valori noti, scritti qui sopra (nessun apice dentro). */
const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/** Gli statement della 0026 dopo le due righe di apertura, nell'ordine del file. */
export const USE_CASE_REFERENT_CHECK_DDL: readonly string[] = [
  `DO $$ BEGIN
  IF to_regclass('public.use_case_referent_requests') IS NULL OR to_regclass('public.use_case_need_answers') IS NULL THEN
    RAISE EXCEPTION '${MISSING_REFERENTS_FOR_CHECK_MESSAGE}';
  END IF;
END $$;`,
  `CREATE TABLE IF NOT EXISTS use_case_referent_checks (
  request_id uuid PRIMARY KEY REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  confirm varchar(8) CONSTRAINT use_case_referent_checks_confirm_check CHECK (confirm IS NULL OR confirm IN (${quoted(REFERENT_CHECK_CONFIRMS)})),
  confirm_note varchar(1000),
  team_component_key varchar(40),
  team_volume_year numeric(14,2) CONSTRAINT use_case_referent_checks_team_volume_check CHECK (team_volume_year IS NULL OR team_volume_year >= 0),
  team_minutes numeric(12,2) CONSTRAINT use_case_referent_checks_team_minutes_check CHECK (team_minutes IS NULL OR team_minutes >= 0),
  estimate varchar(6) CONSTRAINT use_case_referent_checks_estimate_check CHECK (estimate IS NULL OR estimate IN (${quoted(REFERENT_CHECK_ESTIMATES)})),
  times_per_month numeric(12,2) CONSTRAINT use_case_referent_checks_times_check CHECK (times_per_month IS NULL OR times_per_month BETWEEN 0 AND ${REFERENT_CHECK_LIMITS.timesPerMonthMax}),
  minutes_each numeric(10,2) CONSTRAINT use_case_referent_checks_minutes_check CHECK (minutes_each IS NULL OR minutes_each BETWEEN 0 AND ${REFERENT_CHECK_LIMITS.minutesEachMax}),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  correction_done_at timestamptz,
  estimate_outcome varchar(8) CONSTRAINT use_case_referent_checks_outcome_check CHECK (estimate_outcome IS NULL OR estimate_outcome IN (${quoted(REFERENT_CHECK_OUTCOMES)})),
  estimate_outcome_at timestamptz,
  purged_at timestamptz,
  CONSTRAINT use_case_referent_checks_note_check CHECK (confirm = 'correggi' OR confirm_note IS NULL),
  CONSTRAINT use_case_referent_checks_team_check CHECK ((team_component_key IS NULL) = (team_volume_year IS NULL) AND (team_volume_year IS NULL) = (team_minutes IS NULL)),
  CONSTRAINT use_case_referent_checks_estimate_team_check CHECK (estimate IS NULL OR team_component_key IS NOT NULL),
  CONSTRAINT use_case_referent_checks_yes_check CHECK (estimate IS DISTINCT FROM 'si' OR (times_per_month IS NULL AND minutes_each IS NULL)),
  CONSTRAINT use_case_referent_checks_submitted_check CHECK (submitted_at IS NULL OR (
    confirm IS NOT NULL AND (confirm = 'si' OR confirm_note IS NOT NULL OR purged_at IS NOT NULL)
    AND ((team_component_key IS NOT NULL AND estimate IS NOT NULL) OR (team_component_key IS NULL AND times_per_month IS NOT NULL AND minutes_each IS NOT NULL)))),
  CONSTRAINT use_case_referent_checks_review_check CHECK ((correction_done_at IS NULL AND estimate_outcome IS NULL) OR submitted_at IS NOT NULL),
  CONSTRAINT use_case_referent_checks_correction_check CHECK (correction_done_at IS NULL OR confirm = 'correggi'),
  CONSTRAINT use_case_referent_checks_outcome_pair_check CHECK ((estimate_outcome IS NULL) = (estimate_outcome_at IS NULL)),
  CONSTRAINT use_case_referent_checks_purged_check CHECK (purged_at IS NULL OR confirm_note IS NULL)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_checks_use_case_idx ON use_case_referent_checks (use_case_id);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_checks_workspace_idx ON use_case_referent_checks (workspace_id);`,
  `ALTER TABLE use_case_referent_request_items ADD COLUMN IF NOT EXISTS file_required boolean NOT NULL DEFAULT false;`,
  `ALTER TABLE use_case_need_answers ADD COLUMN IF NOT EXISTS comment varchar(1000);`,
  `ALTER TABLE use_case_need_answers ADD COLUMN IF NOT EXISTS already_attached boolean NOT NULL DEFAULT false;`,
  `DO $$ BEGIN
  PERFORM set_config('lock_timeout', '${REFERENT_CHECK_LOCK_TIMEOUT}', true);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.use_case_need_answers'::regclass AND conname = '${ANSWER_COMMENT_CHECK_NAME}') THEN
    ALTER TABLE use_case_need_answers ADD CONSTRAINT ${ANSWER_COMMENT_CHECK_NAME}
      CHECK (comment IS NULL OR source = 'referente') NOT VALID;
    ALTER TABLE use_case_need_answers VALIDATE CONSTRAINT ${ANSWER_COMMENT_CHECK_NAME};
  END IF;
END $$;`,
];

// ─── Pulizia (cron e RUNBOOK §10.9 punto 6) ──────────────────────────

/**
 * Le tre pulizie dopo un ritorno indietro (RUNBOOK §10.9 punto 6), le stesse che il cron fa ogni giorno
 * dopo la conservazione: idempotenti, sul codice nuovo non trovano niente da fare.
 * 1. i commenti delle risposte già tolte (il codice di prima toglie il testo ma non il commento);
 * 2. le note di conferma delle richieste cancellate (`purged_at`), con il segno sulla riga;
 * 3. le bozze della conferma e della stima delle richieste finite senza invio.
 */
export const REFERENT_CHECK_SWEEP_SQL: readonly string[] = Object.freeze([
  `UPDATE use_case_need_answers SET comment = NULL, updated_at = now() WHERE comment IS NOT NULL AND removed_at IS NOT NULL;`,
  `UPDATE use_case_referent_checks c SET confirm_note = NULL, purged_at = coalesce(c.purged_at, now()), updated_at = now()
  FROM use_case_referent_requests r WHERE c.request_id = r.id AND r.purged_at IS NOT NULL AND c.confirm_note IS NOT NULL;`,
  `UPDATE use_case_referent_checks c SET confirm = NULL, confirm_note = NULL, estimate = NULL, times_per_month = NULL, minutes_each = NULL, updated_at = now()
  FROM use_case_referent_requests r WHERE c.request_id = r.id AND c.submitted_at IS NULL AND r.status <> 'inviata'
  AND (c.confirm IS NOT NULL OR c.confirm_note IS NOT NULL OR c.estimate IS NOT NULL OR c.times_per_month IS NOT NULL OR c.minutes_each IS NOT NULL);`,
]);

// ─── Sonda ───────────────────────────────────────────────────────────

/** La tabella della 0026. */
export const REFERENT_CHECK_TABLES = ["use_case_referent_checks"] as const;

/** Gli indici della 0026, per nome. */
export const REFERENT_CHECK_INDEXES = ["use_case_referent_checks_use_case_idx", "use_case_referent_checks_workspace_idx"] as const;

/** I vincoli con nome della tabella nuova (`CONSTRAINT <nome>`), per la sonda. */
export const REFERENT_CHECK_NAMED_CONSTRAINTS = [
  "use_case_referent_checks_confirm_check",
  "use_case_referent_checks_team_volume_check",
  "use_case_referent_checks_team_minutes_check",
  "use_case_referent_checks_estimate_check",
  "use_case_referent_checks_times_check",
  "use_case_referent_checks_minutes_check",
  "use_case_referent_checks_outcome_check",
  "use_case_referent_checks_note_check",
  "use_case_referent_checks_team_check",
  "use_case_referent_checks_estimate_team_check",
  "use_case_referent_checks_yes_check",
  "use_case_referent_checks_submitted_check",
  "use_case_referent_checks_review_check",
  "use_case_referent_checks_correction_check",
  "use_case_referent_checks_outcome_pair_check",
  "use_case_referent_checks_purged_check",
] as const;

/**
 * Espressione booleana per la sonda di `ensureDbSchema()` e di `referentStoreReady`: vera solo se tutto
 * il DDL della 0026 è presente (la tabella, i suoi indici e vincoli con nome, le tre colonne nuove, il
 * CHECK del commento).
 */
export const USE_CASE_REFERENT_CHECK_PROBE_SQL = `(
  ${REFERENT_CHECK_TABLES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND ${REFERENT_CHECK_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid = to_regclass('public.use_case_referent_checks')
      AND conname IN (${quoted(REFERENT_CHECK_NAMED_CONSTRAINTS)})
  ) = ${REFERENT_CHECK_NAMED_CONSTRAINTS.length}
  AND (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name = 'use_case_referent_request_items' AND column_name = 'file_required')
        OR (table_name = 'use_case_need_answers' AND column_name IN ('comment', 'already_attached')))
  ) = 3
  AND EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = to_regclass('public.use_case_need_answers') AND conname = '${ANSWER_COMMENT_CHECK_NAME}'
  )
)`;
