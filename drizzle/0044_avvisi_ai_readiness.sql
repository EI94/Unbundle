-- Le email dell'AI Readiness (la metà email di «ogni funzione arriva con le sue notifiche», dopo la campanella
-- dell'ondata 7b del rilascio 10): le risposte nuove, al massimo un'email al giorno per rilevazione e persona, solo
-- conteggi; i risultati disponibili, un'email una volta. A chi gestisce il workspace, con un'email verificata, e solo a
-- chi non le ha spente in «Il tuo account» › «Notifiche via email».
--
-- Questa migrazione aggiunge:
--   - workspace_bell_state.ai_readiness_emails: la scelta «Avvisami per email sull'AI Readiness», accesa per default,
--     accanto a referent_emails (0024). Un valore di default costante: PostgreSQL non riscrive la tabella;
--   - ai_readiness_alert_emails: la coda delle email, sorella di use_case_alert_emails (0025), con la rilevazione. Una
--     sola riga in attesa per rilevazione, persona e tipo; «i risultati ci sono» una volta sola per rilevazione e persona.
-- Solo aggiunte: nessuna riscrittura, nessun dato scritto, nessuna colonna cambiata, nessun CHECK toccato. Il codice di
-- prima ignora la colonna (scrive workspace_bell_state nominando le colonne: la nuova prende il default) e la tabella
-- (nessun cron di prima la legge, quindi non manda né annulla le sue righe: le annulla il codice nuovo, troppo vecchie).
-- Scritta a mano, idempotente. In produzione la applica il self-heal dell'app al primo avvio dopo il deploy (mai da
-- un'anteprima): gli stessi statement, nello stesso ordine, sono in src/lib/db/ai-readiness-email-ddl.ts
-- (ensureDbSchema, dopo la 0043, ENSURE_VERSION 38). Solo come strada di riserva, a mano (mai drizzle-kit, mai db:push):
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0044_avvisi_ai_readiness.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:ai-readiness-email-ddl'));

DO $$ BEGIN
  IF to_regclass('public.workspace_bell_state') IS NULL OR to_regclass('public.ai_readiness_assessments') IS NULL THEN
    RAISE EXCEPTION 'ai_readiness_alert_emails: mancano la 0024 o le tabelle AI Readiness. Applica prima drizzle/0024_use_case_referents.sql e drizzle/0009_ai_readiness_core.sql.';
  END IF;
END $$;

ALTER TABLE workspace_bell_state ADD COLUMN IF NOT EXISTS ai_readiness_emails boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS ai_readiness_alert_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES ai_readiness_assessments(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(10) NOT NULL
    CONSTRAINT ai_readiness_alert_emails_kind_check CHECK (kind IN ('risposte', 'risultati')),
  status varchar(10) NOT NULL DEFAULT 'in_coda'
    CONSTRAINT ai_readiness_alert_emails_status_check CHECK (status IN ('in_coda', 'inviata', 'errore', 'annullata')),
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
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_readiness_alert_emails_pending_unique
  ON ai_readiness_alert_emails (assessment_id, recipient_user_id, kind) WHERE status IN ('in_coda', 'errore');

CREATE UNIQUE INDEX IF NOT EXISTS ai_readiness_alert_emails_results_once
  ON ai_readiness_alert_emails (assessment_id, recipient_user_id) WHERE kind = 'risultati';

CREATE INDEX IF NOT EXISTS ai_readiness_alert_emails_due_idx
  ON ai_readiness_alert_emails (scheduled_at) WHERE status IN ('in_coda', 'errore');

CREATE INDEX IF NOT EXISTS ai_readiness_alert_emails_pair_idx
  ON ai_readiness_alert_emails (assessment_id, recipient_user_id, created_at);

CREATE INDEX IF NOT EXISTS ai_readiness_alert_emails_workspace_idx
  ON ai_readiness_alert_emails (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS ai_readiness_alert_emails_gc_idx
  ON ai_readiness_alert_emails (created_at);
