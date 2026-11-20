-- Rilascio 8.0d-1 «Porte» (docs/rilascio-8/RILASCIO-8.0d-ESTERNI-FASE-2.md §2.6, §4.1, §4.2).
-- «Solo questo use case»: una persona di un'altra azienda, o dell'IT del cliente, costruisce un solo use case e del
-- workspace del cliente vede solo quel caso. La 8.0d-1 porta il codice che conosce il valore e chiude ogni porta; nessuno
-- può ancora ricevere il ruolo (l'invito arriva con la 8.0d-2).
--
-- Questa migrazione aggiunge:
--   - il valore 'esterno_caso' in coda all'enum member_role. NON SI TOGLIE PIÙ: PostgreSQL non ha un comando per
--     togliere un valore da un enum. Per questo mai da un'anteprima di Vercel (usano il database di produzione) e il
--     codice dalla 8.0d-1 in poi lo tiene chiuso per default. Il valore non si usa nella stessa transazione;
--   - use_case_builder_invites: il caso di un invito «Solo questo use case» (un invito, un caso). Chi invita e quando
--     stanno già nell'invito e poi nella concessione (use_case_external_builders, 0037).
-- Cambia solo il catalogo di PostgreSQL: nessuna riscrittura, nessun dato scritto, nessuna colonna cambiata, nessun CHECK
-- toccato. Il DDL uc (0018) e la sua impronta non cambiano; la 0037 non cambia. Il codice di prima ignora il valore e la
-- tabella.
-- Scritta a mano, idempotente. In produzione la applica il self-heal dell'app al primo avvio dopo il deploy (mai da
-- un'anteprima): gli stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-case-only-ddl.ts
-- (ensureDbSchema, dopo la 0042, ENSURE_VERSION 37). Solo come strada di riserva, a mano (mai drizzle-kit, mai db:push):
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0043_solo_questo_use_case.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:case-only-ddl'));

ALTER TYPE member_role ADD VALUE IF NOT EXISTS 'esterno_caso';

CREATE TABLE IF NOT EXISTS use_case_builder_invites (
  invitation_id uuid NOT NULL REFERENCES workspace_invitations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_builder_invites_pkey PRIMARY KEY (invitation_id)
);

CREATE INDEX IF NOT EXISTS use_case_builder_invites_use_case_idx ON use_case_builder_invites (use_case_id);
