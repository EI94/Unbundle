/**
 * Le email dell'AI Readiness (la metà email di «ogni funzione arriva con le sue notifiche», dopo la campanella
 * dell'ondata 7b): DDL del self-heal della 0044.
 *
 * Sono gli stessi statement di `drizzle/0044_avvisi_ai_readiness.sql`, nello stesso ordine, dopo le due righe di
 * apertura del file (`lock_timeout` e l'advisory lock {@link AIR_EMAIL_ADVISORY_LOCK}, che il self-heal prende da sé in
 * `runAirEmailDdl`):
 * 1. il controllo che ci siano la 0024 (`workspace_bell_state`) e le tabelle dell'AI Readiness;
 * 2. la coda delle email (`ai_readiness_alert_emails`), una tabella sorella di `use_case_alert_emails` (0025): i due
 *    tipi dell'AI Readiness hanno bisogno della rilevazione, e la 0025 ha un CHECK dei tipi e una chiave del giorno
 *    senza rilevazione, che restano come sono;
 * 3. gli indici: una sola riga in attesa per rilevazione, persona e tipo; la riga «i risultati ci sono» una volta sola
 *    per rilevazione e persona; l'invio, la coppia rilevazione-persona, la pulizia;
 * 4. per ultima, la scelta della persona, «Avvisami per email sull'AI Readiness»: una colonna in `workspace_bell_state`,
 *    accanto a quella delle email delle richieste al referente, accesa per default (`NOT NULL DEFAULT true` con un valore
 *    costante: PostgreSQL non riscrive la tabella). Per ultima perché il suo lock esclusivo sulla campanella di tutti
 *    dura fino al commit: prima si aspettano le tabelle delle chiavi esterne della coda, poi la si blocca un istante.
 *
 * Solo aggiunte: nessuna riscrittura, nessun dato scritto, nessuna colonna cambiata, nessun CHECK toccato. Il codice di
 * prima ignora la colonna (le sue scritture di `workspace_bell_state` nominano le colonne, e la nuova prende il valore
 * di default) e la tabella (nessun suo cron la legge).
 *
 * `src/lib/db/ai-readiness-email-ddl.test.ts` controlla che la migrazione contenga questi statement, nello stesso
 * ordine e nient'altro, che la sonda copra ogni oggetto e che Drizzle abbia le stesse colonne.
 * Modulo puro.
 */

/** La chiave dell'advisory lock della 0044: la stessa nel file e in `runAirEmailDdl`. */
export const AIR_EMAIL_ADVISORY_LOCK = "unbundle:ai-readiness-email-ddl";

/** La tabella della coda. */
export const AIR_EMAIL_TABLE = "ai_readiness_alert_emails";

/** La colonna della scelta della persona, in `workspace_bell_state` (0024). */
export const AIR_EMAIL_SWITCH_COLUMN = "ai_readiness_emails";

/** La colonna che la 0044 aggiunge a una tabella che c'era già (la 0024), per il test delle colonne Drizzle. */
export const AIR_EMAIL_ADDED_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  workspace_bell_state: Object.freeze([AIR_EMAIL_SWITCH_COLUMN]),
});

/** I due avvisi: le risposte nuove (al massimo uno al giorno) e i risultati disponibili (una volta). */
export const AIR_EMAIL_KINDS = ["risposte", "risultati"] as const;
export type AirEmailKind = (typeof AIR_EMAIL_KINDS)[number];

/** Gli stati di una riga: quelli delle altre code delle email. */
export const AIR_EMAIL_STATUSES = ["in_coda", "inviata", "errore", "annullata"] as const;
export type AirEmailStatus = (typeof AIR_EMAIL_STATUSES)[number];

/**
 * Errore della 0044 su un database senza la 0024 o senza le tabelle AI Readiness (0009). Senza apostrofi: sta dentro un
 * letterale SQL.
 */
export const AIR_EMAIL_MISSING_MESSAGE =
  "ai_readiness_alert_emails: mancano la 0024 o le tabelle AI Readiness. Applica prima drizzle/0024_use_case_referents.sql e drizzle/0009_ai_readiness_core.sql.";

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/** Gli stati di una riga in attesa (`in_coda`, o `errore` con un altro tentativo davanti). */
export const AIR_EMAIL_PENDING_SQL = `status IN ('in_coda', 'errore')`;

/** Gli statement della 0044 dopo le due righe di apertura, nell'ordine del file. */
export const AIR_EMAIL_DDL: readonly string[] = Object.freeze([
  `DO $$ BEGIN
  IF to_regclass('public.workspace_bell_state') IS NULL OR to_regclass('public.ai_readiness_assessments') IS NULL THEN
    RAISE EXCEPTION '${AIR_EMAIL_MISSING_MESSAGE}';
  END IF;
END $$;`,
  `CREATE TABLE IF NOT EXISTS ${AIR_EMAIL_TABLE} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES ai_readiness_assessments(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(10) NOT NULL
    CONSTRAINT ai_readiness_alert_emails_kind_check CHECK (kind IN (${quoted(AIR_EMAIL_KINDS)})),
  status varchar(10) NOT NULL DEFAULT 'in_coda'
    CONSTRAINT ai_readiness_alert_emails_status_check CHECK (status IN (${quoted(AIR_EMAIL_STATUSES)})),
  hold_reason varchar(40),
  cancel_reason varchar(40),
  last_error_code varchar(60),
  attempts smallint NOT NULL DEFAULT 0
    CONSTRAINT ai_readiness_alert_emails_attempts_check CHECK (attempts BETWEEN 0 AND 3),
  counts_from timestamptz NOT NULL,
  counted_until timestamptz,
  scheduled_at timestamptz NOT NULL,
  lease_until timestamptz,
  attempt_started_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_readiness_alert_emails_sent_check CHECK ((status = 'inviata') = (sent_at IS NOT NULL))
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ai_readiness_alert_emails_pending_unique
  ON ${AIR_EMAIL_TABLE} (assessment_id, recipient_user_id, kind) WHERE ${AIR_EMAIL_PENDING_SQL};`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ai_readiness_alert_emails_results_once
  ON ${AIR_EMAIL_TABLE} (assessment_id, recipient_user_id) WHERE kind = 'risultati';`,
  `CREATE INDEX IF NOT EXISTS ai_readiness_alert_emails_due_idx
  ON ${AIR_EMAIL_TABLE} (scheduled_at) WHERE ${AIR_EMAIL_PENDING_SQL};`,
  `CREATE INDEX IF NOT EXISTS ai_readiness_alert_emails_pair_idx
  ON ${AIR_EMAIL_TABLE} (assessment_id, recipient_user_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS ai_readiness_alert_emails_workspace_idx
  ON ${AIR_EMAIL_TABLE} (workspace_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS ai_readiness_alert_emails_gc_idx
  ON ${AIR_EMAIL_TABLE} (created_at);`,
  // Per ultima: il lock esclusivo su `workspace_bell_state` (la campanella di tutti) si prende solo qui, dopo le attese
  // per le tabelle delle chiavi esterne, e dura fino al commit, un istante.
  `ALTER TABLE workspace_bell_state ADD COLUMN IF NOT EXISTS ${AIR_EMAIL_SWITCH_COLUMN} boolean NOT NULL DEFAULT true;`,
]);

// ─── Sonda ───────────────────────────────────────────────────────────

/** Gli indici della 0044. */
export const AIR_EMAIL_INDEXES = [
  "ai_readiness_alert_emails_pending_unique",
  "ai_readiness_alert_emails_results_once",
  "ai_readiness_alert_emails_due_idx",
  "ai_readiness_alert_emails_pair_idx",
  "ai_readiness_alert_emails_workspace_idx",
  "ai_readiness_alert_emails_gc_idx",
] as const;

/** I vincoli con nome della 0044. */
export const AIR_EMAIL_NAMED_CONSTRAINTS = [
  "ai_readiness_alert_emails_kind_check",
  "ai_readiness_alert_emails_status_check",
  "ai_readiness_alert_emails_attempts_check",
  "ai_readiness_alert_emails_sent_check",
] as const;

/**
 * Vera solo con tutta la 0044: la colonna della scelta, la tabella, gli indici e i vincoli con nome. Per
 * `ensureDbSchema()`, le letture e le scritture delle email dell'AI Readiness (`airEmailStoreReady`) e il doctor.
 * Finché è falsa nessuna email dell'AI Readiness si mette in coda, l'interruttore non si vede e la campanella va avanti
 * come prima.
 */
export const AIR_EMAIL_PROBE_SQL = `(
  EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = to_regclass('public.workspace_bell_state') AND a.attname = '${AIR_EMAIL_SWITCH_COLUMN}' AND NOT a.attisdropped
  )
  AND to_regclass('public.${AIR_EMAIL_TABLE}') IS NOT NULL
  AND ${AIR_EMAIL_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid = to_regclass('public.${AIR_EMAIL_TABLE}')
      AND conname IN (${quoted(AIR_EMAIL_NAMED_CONSTRAINTS)})
  ) = ${AIR_EMAIL_NAMED_CONSTRAINTS.length}
)`;
