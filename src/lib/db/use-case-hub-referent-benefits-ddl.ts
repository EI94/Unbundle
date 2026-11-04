/**
 * Area «Use case», rilascio 5.1 «L'impatto, per ogni beneficio»: DDL del self-heal della 0027.
 *
 * Sono gli stessi statement di `drizzle/0027_use_case_referent_benefits.sql`, nello stesso ordine, dopo
 * le due righe di apertura del file (`lock_timeout` e l'advisory lock {@link REFERENT_BENEFITS_ADVISORY_LOCK},
 * che il self-heal prende da sé in `runUseCaseReferentBenefitsDdl`):
 * 1. controllo che la 0026 ci sia (la conferma del referente, a cui le risposte per beneficio appartengono);
 * 2. `use_case_referent_checks.benefits`: la conferma ha una risposta per ogni voce di «Benefici e costi»
 *    (falso: la stima del tempo del rilascio 5, una sola);
 * 3. `use_case_referent_check_benefits`: una riga per voce, con l'istantanea della cifra del team che il
 *    referente ha visto (volte e minuti per «ore», euro per «euro», niente per «qualitativo»), la sua
 *    risposta («Non so» vale su ogni voce, senza numeri), i suoi numeri facoltativi, un commento breve e
 *    l'esito del team (usata o tenuta);
 * 4. per ultimo il CHECK dell'invio della 0026 (`use_case_referent_checks_submitted_check`) diventa più
 *    largo, con lo stesso nome: una conferma inviata con le risposte per beneficio non ha la stima del
 *    tempo del rilascio 5. Ogni riga che la 0026 accetta resta accettata, e il codice del rilascio 5 non
 *    scrive mai `benefits`: dopo un ritorno indietro le sue scritture incontrano la regola di prima.
 *
 * Il punto 4 è l'unico statement non solo additivo (DROP CONSTRAINT e ADD CONSTRAINT dello stesso nome,
 * `NOT VALID` e poi `VALIDATE`, che non può fallire: la condizione nuova è quella di prima in OR), dentro un
 * blocco che lo fa solo quando la definizione non nomina ancora `benefits` (idempotente). Nessun dato
 * scritto, nessuna colonna cambiata, nessuna tabella tolta.
 *
 * `src/lib/db/use-case-hub-referent-benefits-ddl.test.ts` controlla che la migrazione li contenga tutti,
 * nello stesso ordine, che i CHECK siano gli elenchi qui sotto e che la sonda copra ogni oggetto.
 * Modulo puro, senza import: lo caricano anche gli script di verifica.
 */

// ─── Vocabolario ─────────────────────────────────────────────────────

/** I tipi di voce di «Benefici e costi» (gli stessi di `VALUE_COMPONENT_KINDS`, value-model.ts). */
export const REFERENT_BENEFIT_KINDS = ["ore", "euro", "qualitativo"] as const;
export type ReferentBenefitKind = (typeof REFERENT_BENEFIT_KINDS)[number];

/**
 * La risposta del referente a una voce: «Sì», «È di meno», «È di più» su una cifra del team; «Sì», «No» su
 * un beneficio senza cifra; «Non so» su ogni voce (decisione del titolare del 04/11/2026), sempre senza
 * numeri. Nessuna risposta (NULL) quando il team non ha i numeri di una voce «ore» e il referente scrive
 * i suoi due numeri; oppure «Non so» al posto dei numeri.
 */
export const REFERENT_BENEFIT_ANSWERS = ["si", "meno", "piu", "no", "non_so"] as const;
export type ReferentBenefitAnswer = (typeof REFERENT_BENEFIT_ANSWERS)[number];

/** Cosa ha fatto il team della risposta su una voce: usata, oppure tenuta la propria (o vista). */
export const REFERENT_BENEFIT_OUTCOMES = ["adottata", "tenuta"] as const;
export type ReferentBenefitOutcome = (typeof REFERENT_BENEFIT_OUTCOMES)[number];

/** I limiti delle colonne: quelli di `value-model.ts` e della 0026 (le volte al mese × 12 restano nel volume). */
export const REFERENT_BENEFIT_LIMITS = Object.freeze({
  components: 6,
  key: 40,
  label: 120,
  comment: 500,
  timesPerMonthMax: 8_333_333,
  minutesEachMax: 100_000,
  eurYearMax: 1_000_000_000,
});

/** La chiave dell'advisory lock della 0027: la stessa nel file e in `runUseCaseReferentBenefitsDdl`. */
export const REFERENT_BENEFITS_ADVISORY_LOCK = "unbundle:use-case-referent-benefits-ddl";

/** Quanto aspetta ogni lock della 0027 prima di fermarsi senza cambiare nulla. */
export const REFERENT_BENEFITS_LOCK_TIMEOUT = "3s";

/** Errore della 0027 su un database senza la 0026. */
export const MISSING_CHECK_FOR_BENEFITS_MESSAGE = "use_case_referent_benefits: manca la 0026. Applica prima drizzle/0026_use_case_referent_check.sql.";

/** Il CHECK dell'invio della 0026, che la 0027 allarga tenendo il nome. */
export const SUBMITTED_CHECK_NAME = "use_case_referent_checks_submitted_check";

/** Le colonne che la 0027 aggiunge a tabelle che c'erano già, nell'ordine (per il test delle colonne Drizzle). */
export const REFERENT_BENEFITS_ADDED_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  use_case_referent_checks: Object.freeze(["benefits"]),
});

// ─── Composizione del testo SQL ──────────────────────────────────────

/** `'a', 'b'`: valori noti, scritti qui sopra (nessun apice dentro). */
const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
const L = REFERENT_BENEFIT_LIMITS;

/** La condizione dell'invio dopo la 0027: quella della 0026 con `benefits` in OR. */
export const SUBMITTED_CHECK_0027 = `submitted_at IS NULL OR (
      confirm IS NOT NULL AND (confirm = 'si' OR confirm_note IS NOT NULL OR purged_at IS NOT NULL)
      AND (benefits OR (team_component_key IS NOT NULL AND estimate IS NOT NULL) OR (team_component_key IS NULL AND times_per_month IS NOT NULL AND minutes_each IS NOT NULL)))`;

/** Gli statement della 0027 dopo le due righe di apertura, nell'ordine del file. */
export const USE_CASE_REFERENT_BENEFITS_DDL: readonly string[] = [
  `DO $$ BEGIN
  IF to_regclass('public.use_case_referent_checks') IS NULL THEN
    RAISE EXCEPTION '${MISSING_CHECK_FOR_BENEFITS_MESSAGE}';
  END IF;
END $$;`,
  `ALTER TABLE use_case_referent_checks ADD COLUMN IF NOT EXISTS benefits boolean NOT NULL DEFAULT false;`,
  `CREATE TABLE IF NOT EXISTS use_case_referent_check_benefits (
  request_id uuid NOT NULL REFERENCES use_case_referent_checks(request_id) ON DELETE CASCADE,
  component_key varchar(${L.key}) NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  position smallint NOT NULL CONSTRAINT use_case_referent_check_benefits_position_check CHECK (position BETWEEN 1 AND ${L.components}),
  kind varchar(12) NOT NULL CONSTRAINT use_case_referent_check_benefits_kind_check CHECK (kind IN (${quoted(REFERENT_BENEFIT_KINDS)})),
  label varchar(${L.label}) NOT NULL,
  team_volume_year numeric(14,2) CONSTRAINT use_case_referent_check_benefits_team_volume_check CHECK (team_volume_year IS NULL OR team_volume_year >= 0),
  team_minutes numeric(12,2) CONSTRAINT use_case_referent_check_benefits_team_minutes_check CHECK (team_minutes IS NULL OR team_minutes >= 0),
  team_eur_year numeric(14,2) CONSTRAINT use_case_referent_check_benefits_team_eur_check CHECK (team_eur_year IS NULL OR team_eur_year >= 0),
  answer varchar(8) CONSTRAINT use_case_referent_check_benefits_answer_check CHECK (answer IS NULL OR answer IN (${quoted(REFERENT_BENEFIT_ANSWERS)})),
  times_per_month numeric(12,2) CONSTRAINT use_case_referent_check_benefits_times_check CHECK (times_per_month IS NULL OR times_per_month BETWEEN 0 AND ${L.timesPerMonthMax}),
  minutes_each numeric(10,2) CONSTRAINT use_case_referent_check_benefits_minutes_check CHECK (minutes_each IS NULL OR minutes_each BETWEEN 0 AND ${L.minutesEachMax}),
  eur_year numeric(14,2) CONSTRAINT use_case_referent_check_benefits_eur_check CHECK (eur_year IS NULL OR eur_year BETWEEN 0 AND ${L.eurYearMax}),
  comment varchar(${L.comment}),
  outcome varchar(8) CONSTRAINT use_case_referent_check_benefits_outcome_check CHECK (outcome IS NULL OR outcome IN (${quoted(REFERENT_BENEFIT_OUTCOMES)})),
  outcome_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_referent_check_benefits_pkey PRIMARY KEY (request_id, component_key),
  CONSTRAINT use_case_referent_check_benefits_shape_check CHECK (
    (kind = 'ore' AND team_volume_year IS NOT NULL AND team_minutes IS NOT NULL AND team_eur_year IS NULL AND eur_year IS NULL)
    OR (kind = 'euro' AND team_eur_year IS NOT NULL AND team_volume_year IS NULL AND team_minutes IS NULL AND times_per_month IS NULL AND minutes_each IS NULL)
    OR (kind = 'qualitativo' AND team_volume_year IS NULL AND team_minutes IS NULL AND team_eur_year IS NULL AND times_per_month IS NULL AND minutes_each IS NULL AND eur_year IS NULL)),
  CONSTRAINT use_case_referent_check_benefits_form_check CHECK (answer IS NULL
    OR answer = 'non_so'
    OR (answer IN ('si', 'meno', 'piu') AND ((kind = 'ore' AND team_volume_year > 0 AND team_minutes > 0) OR (kind = 'euro' AND team_eur_year > 0)))
    OR (answer IN ('si', 'no') AND (kind = 'qualitativo' OR (kind = 'euro' AND team_eur_year = 0)))),
  CONSTRAINT use_case_referent_check_benefits_numbers_check CHECK ((times_per_month IS NULL AND minutes_each IS NULL AND eur_year IS NULL)
    OR (answer IS NOT NULL AND answer IN ('meno', 'piu'))
    OR (answer IS NULL AND kind = 'ore' AND NOT (team_volume_year > 0 AND team_minutes > 0))),
  CONSTRAINT use_case_referent_check_benefits_outcome_pair_check CHECK ((outcome IS NULL) = (outcome_at IS NULL))
);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_check_benefits_workspace_idx ON use_case_referent_check_benefits (workspace_id);`,
  `DO $$ BEGIN
  PERFORM set_config('lock_timeout', '${REFERENT_BENEFITS_LOCK_TIMEOUT}', true);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.use_case_referent_checks'::regclass AND conname = '${SUBMITTED_CHECK_NAME}'
      AND pg_get_constraintdef(oid) LIKE '%benefits%') THEN
    ALTER TABLE use_case_referent_checks DROP CONSTRAINT IF EXISTS ${SUBMITTED_CHECK_NAME};
    ALTER TABLE use_case_referent_checks ADD CONSTRAINT ${SUBMITTED_CHECK_NAME} CHECK (${SUBMITTED_CHECK_0027}) NOT VALID;
    ALTER TABLE use_case_referent_checks VALIDATE CONSTRAINT ${SUBMITTED_CHECK_NAME};
  END IF;
END $$;`,
];

// ─── Pulizia (cron e RUNBOOK §10.10 punto 6) ─────────────────────────

/**
 * Le tre pulizie dopo un ritorno indietro (RUNBOOK §10.10 punto 6), le stesse che il cron fa ogni giorno
 * dopo quelle della 0026: idempotenti, sul codice nuovo non trovano niente da fare.
 * 1. i commenti per beneficio delle richieste cancellate (`purged_at`: la cancellazione dei dati o i 12 mesi);
 * 2. le risposte per beneficio delle richieste finite senza invio (bozze del referente);
 * 3. il segno `benefits` sulle stesse conferme non inviate.
 */
export const REFERENT_BENEFITS_SWEEP_SQL: readonly string[] = Object.freeze([
  `UPDATE use_case_referent_check_benefits b SET comment = NULL, updated_at = now()
  FROM use_case_referent_requests r WHERE b.request_id = r.id AND r.purged_at IS NOT NULL AND b.comment IS NOT NULL;`,
  `DELETE FROM use_case_referent_check_benefits b USING use_case_referent_checks c, use_case_referent_requests r
  WHERE b.request_id = c.request_id AND c.request_id = r.id AND c.submitted_at IS NULL AND r.status <> 'inviata';`,
  `UPDATE use_case_referent_checks c SET benefits = false, updated_at = now()
  FROM use_case_referent_requests r WHERE c.request_id = r.id AND c.submitted_at IS NULL AND r.status <> 'inviata' AND c.benefits;`,
]);

// ─── Sonda ───────────────────────────────────────────────────────────

/** La tabella della 0027. */
export const REFERENT_BENEFITS_TABLES = ["use_case_referent_check_benefits"] as const;

/** Gli indici della 0027, per nome (oltre alla chiave primaria). */
export const REFERENT_BENEFITS_INDEXES = ["use_case_referent_check_benefits_workspace_idx"] as const;

/** I vincoli con nome della tabella nuova (`CONSTRAINT <nome>`), per la sonda. */
export const REFERENT_BENEFITS_NAMED_CONSTRAINTS = [
  "use_case_referent_check_benefits_position_check",
  "use_case_referent_check_benefits_kind_check",
  "use_case_referent_check_benefits_team_volume_check",
  "use_case_referent_check_benefits_team_minutes_check",
  "use_case_referent_check_benefits_team_eur_check",
  "use_case_referent_check_benefits_answer_check",
  "use_case_referent_check_benefits_times_check",
  "use_case_referent_check_benefits_minutes_check",
  "use_case_referent_check_benefits_eur_check",
  "use_case_referent_check_benefits_outcome_check",
  "use_case_referent_check_benefits_pkey",
  "use_case_referent_check_benefits_shape_check",
  "use_case_referent_check_benefits_form_check",
  "use_case_referent_check_benefits_numbers_check",
  "use_case_referent_check_benefits_outcome_pair_check",
] as const;

/**
 * Espressione booleana per la sonda di `ensureDbSchema()` e di `referentStoreReady`: vera solo se tutto
 * il DDL della 0027 è presente (la tabella, il suo indice e i suoi vincoli con nome, la colonna
 * `benefits`, il CHECK dell'invio già allargato).
 */
export const USE_CASE_REFERENT_BENEFITS_PROBE_SQL = `(
  ${REFERENT_BENEFITS_TABLES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND ${REFERENT_BENEFITS_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid = to_regclass('public.use_case_referent_check_benefits')
      AND conname IN (${quoted(REFERENT_BENEFITS_NAMED_CONSTRAINTS)})
  ) = ${REFERENT_BENEFITS_NAMED_CONSTRAINTS.length}
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'use_case_referent_checks' AND column_name = 'benefits'
  )
  AND EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = to_regclass('public.use_case_referent_checks') AND conname = '${SUBMITTED_CHECK_NAME}'
      AND pg_get_constraintdef(oid) LIKE '%benefits%'
  )
)`;
