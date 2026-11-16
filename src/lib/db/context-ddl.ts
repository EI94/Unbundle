/**
 * Rilascio 9a «Contesto»: DDL del self-heal della 0038 (docs/contesto/RILASCIO-9a-COSTRUZIONE.md §2).
 *
 * Sono gli stessi statement di `drizzle/0038_contesto.sql`, nello stesso ordine, dopo le due righe di apertura del
 * file (`lock_timeout` e l'advisory lock {@link CONTEXT_ADVISORY_LOCK}, che il self-heal prende da sé in
 * `runContextDdl`):
 * 1. il controllo che la 0037 ci sia;
 * 2. `context_sources`, `context_proposals`: gli appunti (e i documenti come fonti) e le proposte da confermare;
 * 3. `context_facts`, `context_fact_links`, `context_entities`, `context_relations`: i fatti con la loro storia
 *    (`supersedes_id`), i legami con gli use case, i nodi e i collegamenti della Mappa;
 * 4. `context_commitments`, `context_questions`: gli impegni (per parte e per ruolo, mai per persona) e le domande aperte;
 * 5. `context_events`, `context_seen`, `context_briefs`: la storia, «Novità per te», «In breve»;
 * 6. `context_granola_*`: il collegamento a Granola di una persona di Lateral Space, le regole per workspace, le
 *    decisioni sulle call (di una call che non è di un cliente solo l'id);
 * 7. `workspaces.company_value_thesis`: la tesi del valore per workspace, riempita una volta sola, quando la colonna
 *    nasce, da quella dell'organizzazione (un solo workspace, oppure l'unico con un messaggio di Discovery a non più
 *    di 10 minuti dal salvataggio);
 * 8. gli indici GIN per la ricerca in italiano su `document_chunks` e `conversation_memory`.
 *
 * Solo aggiunte: nessuna tabella tolta, nessun CHECK più stretto, nessuna colonna cambiata. L'unico `ALTER TABLE` e
 * l'unico `UPDATE` stanno nel blocco della tesi, dentro `IF NOT EXISTS`. Il DDL uc (0018) non cambia.
 *
 * La colonna `workspaces.company_value_thesis` non è dichiarata nella tabella Drizzle `workspaces`: senza la 0038 il
 * resto dell'app non se ne accorge. La leggono e la scrivono solo le funzioni di `src/lib/db/queries/value-thesis.ts`.
 *
 * `src/lib/db/context-ddl.test.ts` controlla che la migrazione li contenga tutti, nello stesso ordine, e nient'altro,
 * e che la sonda copra tabelle, indici unici, indici GIN, chiavi e la colonna.
 * Modulo puro.
 */

/** La chiave dell'advisory lock della 0038: la stessa nel file e in `runContextDdl`. */
export const CONTEXT_ADVISORY_LOCK = "unbundle:context-ddl";

/** Gli statement della 0038 dopo le due righe di apertura, nell'ordine del file. */
export const CONTEXT_DDL: readonly string[] = [
  `DO $$ BEGIN
  IF to_regclass('public.use_case_external_builders') IS NULL THEN
    RAISE EXCEPTION 'contesto: manca la 0037. Applica prima drizzle/0037_costruttori_esterni.sql.';
  END IF;
END $$;`,
  `CREATE TABLE IF NOT EXISTS context_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind varchar(12) NOT NULL CONSTRAINT context_sources_kind_check CHECK (kind IN ('appunti', 'trascrizione', 'documento')),
  origin varchar(8) NOT NULL CONSTRAINT context_sources_origin_check CHECK (origin IN ('web', 'granola', 'claude', 'cli')),
  title varchar(200) NOT NULL CONSTRAINT context_sources_title_check CHECK (char_length(btrim(title)) >= 1),
  occurred_on date NOT NULL,
  participants varchar(500),
  link varchar(500) CONSTRAINT context_sources_link_check CHECK (link IS NULL OR link ~ '^https://'),
  body text,
  body_chars integer NOT NULL DEFAULT 0 CONSTRAINT context_sources_chars_check CHECK (body_chars BETWEEN 0 AND 300000),
  body_hash char(64) CONSTRAINT context_sources_hash_check CHECK (body_hash IS NULL OR body_hash ~ '^[0-9a-f]{64}$'),
  document_id uuid REFERENCES uploaded_documents(id) ON DELETE CASCADE,
  external_id varchar(120),
  external_updated_at timestamptz,
  visibility varchar(5) NOT NULL DEFAULT 'ls' CONSTRAINT context_sources_visibility_check CHECK (visibility IN ('tutti', 'ls')),
  read_status varchar(10) NOT NULL DEFAULT 'da_leggere' CONSTRAINT context_sources_read_status_check CHECK (read_status IN ('da_leggere', 'in_lettura', 'letto', 'non_letto')),
  read_reason varchar(16) CONSTRAINT context_sources_read_reason_check CHECK (read_reason IS NULL OR read_reason ~ '^[a-z_]{2,16}$'),
  read_attempts smallint NOT NULL DEFAULT 0,
  read_started_at timestamptz,
  read_at timestamptz,
  parts_total smallint NOT NULL DEFAULT 1 CONSTRAINT context_sources_parts_total_check CHECK (parts_total BETWEEN 1 AND 3),
  parts_read smallint NOT NULL DEFAULT 0,
  skipped jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT context_sources_skipped_check CHECK (jsonb_typeof(skipped) = 'object'),
  text_purged_at timestamptz,
  added_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_sources_pkey PRIMARY KEY (id),
  CONSTRAINT context_sources_document_check CHECK ((kind = 'documento') = (document_id IS NOT NULL)),
  CONSTRAINT context_sources_notes_ls_check CHECK (kind = 'documento' OR visibility = 'ls'),
  CONSTRAINT context_sources_parts_read_check CHECK (parts_read BETWEEN 0 AND parts_total)
);`,
  `CREATE INDEX IF NOT EXISTS context_sources_workspace_idx ON context_sources (workspace_id, occurred_on DESC, created_at DESC);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS context_sources_external_unique ON context_sources (workspace_id, origin, external_id) WHERE external_id IS NOT NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS context_sources_document_unique ON context_sources (document_id) WHERE document_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS context_sources_pending_idx ON context_sources (read_status, created_at) WHERE read_status IN ('da_leggere', 'in_lettura');`,
  `CREATE INDEX IF NOT EXISTS context_sources_hash_idx ON context_sources (workspace_id, body_hash) WHERE body_hash IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS context_sources_fts_idx ON context_sources USING gin (to_tsvector('italian', coalesce(title, '') || ' ' || coalesce(body, '')));`,
  `CREATE TABLE IF NOT EXISTS context_facts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind varchar(9) NOT NULL DEFAULT 'fatto' CONSTRAINT context_facts_kind_check CHECK (kind IN ('fatto', 'decisione')),
  section varchar(10) NOT NULL CONSTRAINT context_facts_section_check CHECK (section IN ('azienda', 'persone', 'lavoro', 'sistemi', 'obiettivi', 'regole', 'parole')),
  statement varchar(200) NOT NULL CONSTRAINT context_facts_statement_check CHECK (char_length(btrim(statement)) >= 3),
  basis varchar(7) NOT NULL CONSTRAINT context_facts_basis_check CHECK (basis IN ('detto', 'dedotto')),
  visibility varchar(5) NOT NULL CONSTRAINT context_facts_visibility_check CHECK (visibility IN ('tutti', 'ls')),
  status varchar(8) NOT NULL DEFAULT 'attivo' CONSTRAINT context_facts_status_check CHECK (status IN ('attivo', 'superato', 'ritirato')),
  origin varchar(8) NOT NULL CONSTRAINT context_facts_origin_check CHECK (origin IN ('fonte', 'manuale')),
  source_id uuid REFERENCES context_sources(id) ON DELETE SET NULL,
  quote varchar(400),
  supersedes_id uuid REFERENCES context_facts(id) ON DELETE SET NULL,
  needs_check boolean NOT NULL DEFAULT false,
  last_confirmed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ended_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_facts_pkey PRIMARY KEY (id),
  CONSTRAINT context_facts_manual_check CHECK (origin = 'fonte' OR source_id IS NULL),
  CONSTRAINT context_facts_ended_check CHECK ((status = 'attivo') = (ended_at IS NULL))
);`,
  `CREATE INDEX IF NOT EXISTS context_facts_workspace_idx ON context_facts (workspace_id, status, section, last_confirmed_at DESC);`,
  `CREATE INDEX IF NOT EXISTS context_facts_source_idx ON context_facts (source_id) WHERE source_id IS NOT NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS context_facts_supersedes_unique ON context_facts (supersedes_id) WHERE supersedes_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS context_facts_fts_idx ON context_facts USING gin (to_tsvector('italian', statement));`,
  `CREATE TABLE IF NOT EXISTS context_entities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type varchar(10) NOT NULL CONSTRAINT context_entities_type_check CHECK (type IN ('ruolo', 'unita', 'processo', 'sistema', 'dato', 'fornitore', 'obiettivo', 'use_case')),
  name varchar(120) NOT NULL CONSTRAINT context_entities_name_check CHECK (char_length(btrim(name)) >= 1),
  name_key varchar(120) NOT NULL CONSTRAINT context_entities_key_check CHECK (char_length(name_key) >= 1 AND name_key = lower(name_key)),
  aliases text[] NOT NULL DEFAULT '{}'::text[],
  department_id uuid REFERENCES departments(id) ON DELETE CASCADE,
  goal_id uuid REFERENCES strategic_goals(id) ON DELETE CASCADE,
  use_case_id uuid REFERENCES use_cases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_entities_pkey PRIMARY KEY (id),
  CONSTRAINT context_entities_key_unique UNIQUE (workspace_id, type, name_key),
  CONSTRAINT context_entities_ref_check CHECK ((department_id IS NULL OR type = 'unita') AND (goal_id IS NULL OR type = 'obiettivo') AND (use_case_id IS NULL OR type = 'use_case'))
);`,
  `CREATE TABLE IF NOT EXISTS context_fact_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  fact_id uuid NOT NULL REFERENCES context_facts(id) ON DELETE CASCADE,
  use_case_id uuid REFERENCES use_cases(id) ON DELETE CASCADE,
  entity_id uuid REFERENCES context_entities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_fact_links_pkey PRIMARY KEY (id),
  CONSTRAINT context_fact_links_target_check CHECK ((use_case_id IS NULL) <> (entity_id IS NULL))
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS context_fact_links_use_case_unique ON context_fact_links (fact_id, use_case_id) WHERE use_case_id IS NOT NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS context_fact_links_entity_unique ON context_fact_links (fact_id, entity_id) WHERE entity_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS context_fact_links_by_use_case_idx ON context_fact_links (use_case_id) WHERE use_case_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS context_fact_links_by_entity_idx ON context_fact_links (entity_id) WHERE entity_id IS NOT NULL;`,
  `CREATE TABLE IF NOT EXISTS context_relations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_entity_id uuid NOT NULL REFERENCES context_entities(id) ON DELETE CASCADE,
  verb varchar(10) NOT NULL CONSTRAINT context_relations_verb_check CHECK (verb IN ('usa', 'gestisce', 'decide', 'dipende_da', 'alimenta', 'fornisce', 'riguarda')),
  to_entity_id uuid NOT NULL REFERENCES context_entities(id) ON DELETE CASCADE,
  fact_id uuid NOT NULL REFERENCES context_facts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_relations_pkey PRIMARY KEY (id),
  CONSTRAINT context_relations_unique UNIQUE (from_entity_id, verb, to_entity_id, fact_id),
  CONSTRAINT context_relations_ends_check CHECK (from_entity_id <> to_entity_id)
);`,
  `CREATE INDEX IF NOT EXISTS context_relations_workspace_idx ON context_relations (workspace_id);`,
  `CREATE INDEX IF NOT EXISTS context_relations_to_idx ON context_relations (to_entity_id);`,
  `CREATE INDEX IF NOT EXISTS context_relations_fact_idx ON context_relations (fact_id);`,
  `CREATE TABLE IF NOT EXISTS context_commitments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  statement varchar(200) NOT NULL CONSTRAINT context_commitments_statement_check CHECK (char_length(btrim(statement)) >= 3),
  party varchar(8) NOT NULL CONSTRAINT context_commitments_party_check CHECK (party IN ('nostra', 'cliente')),
  role_label varchar(80),
  due_on date,
  status varchar(9) NOT NULL DEFAULT 'aperto' CONSTRAINT context_commitments_status_check CHECK (status IN ('aperto', 'fatto', 'annullato')),
  visibility varchar(5) NOT NULL CONSTRAINT context_commitments_visibility_check CHECK (visibility IN ('tutti', 'ls')),
  origin varchar(8) NOT NULL CONSTRAINT context_commitments_origin_check CHECK (origin IN ('fonte', 'manuale')),
  source_id uuid REFERENCES context_sources(id) ON DELETE SET NULL,
  quote varchar(400),
  use_case_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_commitments_pkey PRIMARY KEY (id),
  CONSTRAINT context_commitments_closed_check CHECK ((status = 'aperto') = (closed_at IS NULL))
);`,
  `CREATE INDEX IF NOT EXISTS context_commitments_workspace_idx ON context_commitments (workspace_id, status, due_on);`,
  `CREATE TABLE IF NOT EXISTS context_questions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  question varchar(200) NOT NULL CONSTRAINT context_questions_question_check CHECK (char_length(btrim(question)) >= 3),
  ask_whom varchar(80),
  status varchar(8) NOT NULL DEFAULT 'aperta' CONSTRAINT context_questions_status_check CHECK (status IN ('aperta', 'chiusa', 'ritirata')),
  visibility varchar(5) NOT NULL CONSTRAINT context_questions_visibility_check CHECK (visibility IN ('tutti', 'ls')),
  origin varchar(8) NOT NULL CONSTRAINT context_questions_origin_check CHECK (origin IN ('fonte', 'manuale', 'chiedi')),
  source_id uuid REFERENCES context_sources(id) ON DELETE SET NULL,
  quote varchar(400),
  use_case_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  closed_by_fact_id uuid REFERENCES context_facts(id) ON DELETE SET NULL,
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_questions_pkey PRIMARY KEY (id),
  CONSTRAINT context_questions_closed_check CHECK ((status = 'aperta') = (closed_at IS NULL))
);`,
  `CREATE INDEX IF NOT EXISTS context_questions_workspace_idx ON context_questions (workspace_id, status, created_at);`,
  `CREATE TABLE IF NOT EXISTS context_proposals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES context_sources(id) ON DELETE CASCADE,
  position smallint NOT NULL,
  kind varchar(10) NOT NULL CONSTRAINT context_proposals_kind_check CHECK (kind IN ('nuovo', 'cambia', 'conferma', 'conflitto', 'decisione', 'impegno', 'domanda')),
  statement varchar(400) NOT NULL CONSTRAINT context_proposals_statement_check CHECK (char_length(btrim(statement)) >= 1),
  quote varchar(400),
  basis varchar(7) NOT NULL CONSTRAINT context_proposals_basis_check CHECK (basis IN ('detto', 'dedotto')),
  section varchar(10) CONSTRAINT context_proposals_section_check CHECK (section IS NULL OR section IN ('azienda', 'persone', 'lavoro', 'sistemi', 'obiettivi', 'regole', 'parole')),
  visibility varchar(5) NOT NULL CONSTRAINT context_proposals_visibility_check CHECK (visibility IN ('tutti', 'ls')),
  target_fact_id uuid REFERENCES context_facts(id) ON DELETE SET NULL,
  question_id uuid REFERENCES context_questions(id) ON DELETE SET NULL,
  use_case_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  party varchar(8) CONSTRAINT context_proposals_party_check CHECK (party IS NULL OR party IN ('nostra', 'cliente')),
  role_label varchar(80),
  due_on date,
  entities jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT context_proposals_entities_check CHECK (jsonb_typeof(entities) = 'array'),
  relations jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT context_proposals_relations_check CHECK (jsonb_typeof(relations) = 'array'),
  issue varchar(16) CONSTRAINT context_proposals_issue_check CHECK (issue IS NULL OR issue ~ '^[a-z_]{2,16}$'),
  status varchar(10) NOT NULL DEFAULT 'aperta' CONSTRAINT context_proposals_status_check CHECK (status IN ('aperta', 'confermata', 'scartata', 'superata')),
  edited boolean NOT NULL DEFAULT false,
  result_id uuid,
  decided_at timestamptz,
  decided_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_proposals_pkey PRIMARY KEY (id),
  CONSTRAINT context_proposals_section_kind_check CHECK ((kind IN ('impegno', 'domanda')) = (section IS NULL)),
  CONSTRAINT context_proposals_party_kind_check CHECK (kind <> 'impegno' OR party IS NOT NULL),
  CONSTRAINT context_proposals_decided_check CHECK ((status = 'aperta') = (decided_at IS NULL))
);`,
  `CREATE INDEX IF NOT EXISTS context_proposals_open_idx ON context_proposals (workspace_id, status, source_id, position);`,
  `CREATE INDEX IF NOT EXISTS context_proposals_source_idx ON context_proposals (source_id);`,
  `CREATE TABLE IF NOT EXISTS context_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  action varchar(24) NOT NULL CONSTRAINT context_events_action_check CHECK (action ~ '^[a-z_]{3,24}$'),
  channel varchar(8) NOT NULL CONSTRAINT context_events_channel_check CHECK (channel IN ('web', 'claude', 'granola', 'cron')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source_id uuid,
  fact_id uuid,
  commitment_id uuid,
  question_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT context_events_detail_check CHECK (jsonb_typeof(detail) = 'object'),
  CONSTRAINT context_events_pkey PRIMARY KEY (id)
);`,
  `CREATE INDEX IF NOT EXISTS context_events_workspace_idx ON context_events (workspace_id, at DESC);`,
  `CREATE INDEX IF NOT EXISTS context_events_fact_idx ON context_events (fact_id, at) WHERE fact_id IS NOT NULL;`,
  `CREATE TABLE IF NOT EXISTS context_seen (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  previous_seen_at timestamptz,
  CONSTRAINT context_seen_pkey PRIMARY KEY (workspace_id, user_id)
);`,
  `CREATE TABLE IF NOT EXISTS context_briefs (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lines jsonb NOT NULL CONSTRAINT context_briefs_lines_check CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) BETWEEN 1 AND 6),
  facts_hash char(64) NOT NULL CONSTRAINT context_briefs_hash_check CHECK (facts_hash ~ '^[0-9a-f]{64}$'),
  generated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_briefs_pkey PRIMARY KEY (workspace_id)
);`,
  `CREATE TABLE IF NOT EXISTS context_granola_connections (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tokens_sealed text NOT NULL CONSTRAINT context_granola_connections_tokens_check CHECK (char_length(tokens_sealed) BETWEEN 100 AND 20000),
  access_expires_at timestamptz,
  client_id varchar(500) NOT NULL,
  account_email varchar(320),
  plan varchar(40),
  status varchar(14) NOT NULL DEFAULT 'attiva' CONSTRAINT context_granola_connections_status_check CHECK (status IN ('attiva', 'da_ricollegare')),
  refreshing_until timestamptz,
  syncing_until timestamptz,
  synced_through timestamptz,
  last_sync_at timestamptz,
  last_sync_ok_at timestamptz,
  last_error varchar(40) CONSTRAINT context_granola_connections_error_check CHECK (last_error IS NULL OR last_error ~ '^[a-z0-9_]{2,40}$'),
  unsorted_count integer NOT NULL DEFAULT 0 CONSTRAINT context_granola_connections_unsorted_check CHECK (unsorted_count >= 0),
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_granola_connections_pkey PRIMARY KEY (user_id)
);`,
  `CREATE TABLE IF NOT EXISTS context_granola_oauth_states (
  state_hash char(64) NOT NULL CONSTRAINT context_granola_oauth_states_hash_check CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  verifier_sealed text NOT NULL,
  client_id varchar(500) NOT NULL,
  redirect_uri varchar(300) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CONSTRAINT context_granola_oauth_states_pkey PRIMARY KEY (state_hash)
);`,
  `CREATE INDEX IF NOT EXISTS context_granola_oauth_states_expiry_idx ON context_granola_oauth_states (expires_at);`,
  `CREATE TABLE IF NOT EXISTS context_granola_clients (
  issuer varchar(200) NOT NULL,
  redirect_uri varchar(300) NOT NULL,
  client_id varchar(500) NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_granola_clients_pkey PRIMARY KEY (issuer, redirect_uri)
);`,
  `CREATE TABLE IF NOT EXISTS context_granola_rules (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  emails text[] NOT NULL DEFAULT '{}'::text[],
  domains text[] NOT NULL DEFAULT '{}'::text[],
  title_words text[],
  want_transcript boolean NOT NULL DEFAULT false,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_granola_rules_pkey PRIMARY KEY (workspace_id),
  CONSTRAINT context_granola_rules_sizes_check CHECK (cardinality(emails) <= 100 AND cardinality(domains) <= 30 AND (title_words IS NULL OR cardinality(title_words) <= 20))
);`,
  `CREATE TABLE IF NOT EXISTS context_granola_links (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  folder_id varchar(120),
  folder_name varchar(200),
  last_imported_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_granola_links_pkey PRIMARY KEY (user_id, workspace_id)
);`,
  `CREATE TABLE IF NOT EXISTS context_granola_meetings (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_id varchar(120) NOT NULL,
  decision varchar(8) NOT NULL CONSTRAINT context_granola_meetings_decision_check CHECK (decision IN ('entrata', 'fuori', 'bloccata')),
  decided_by varchar(8) NOT NULL CONSTRAINT context_granola_meetings_by_check CHECK (decided_by IN ('regola', 'persona')),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  source_id uuid REFERENCES context_sources(id) ON DELETE SET NULL,
  meeting_updated_at timestamptz,
  block_code varchar(24),
  decided_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_granola_meetings_pkey PRIMARY KEY (user_id, meeting_id),
  CONSTRAINT context_granola_meetings_workspace_check CHECK (decision = 'fuori' OR workspace_id IS NOT NULL)
);`,
  `CREATE INDEX IF NOT EXISTS context_granola_meetings_workspace_idx ON context_granola_meetings (workspace_id) WHERE workspace_id IS NOT NULL;`,
  `DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = 'company_value_thesis'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN company_value_thesis jsonb;
    UPDATE workspaces w
       SET company_value_thesis = o.company_value_thesis
      FROM organizations o
     WHERE o.id = w.organization_id
       AND o.company_value_thesis IS NOT NULL
       AND (
         (SELECT count(*) FROM workspaces x WHERE x.organization_id = o.id) = 1
         OR w.id = (
           SELECT CASE WHEN count(DISTINCT c.workspace_id) = 1 THEN (array_agg(DISTINCT c.workspace_id))[1] END
             FROM conversations c
             JOIN messages m ON m.conversation_id = c.id
             JOIN workspaces x ON x.id = c.workspace_id
            WHERE x.organization_id = o.id
              AND c.type = 'leadership_setup'
              AND m.created_at BETWEEN o.updated_at - interval '10 minutes' AND o.updated_at + interval '10 minutes'
         )
       );
  END IF;
END $$;`,
  `CREATE INDEX IF NOT EXISTS document_chunks_fts_idx ON document_chunks USING gin (to_tsvector('italian', content));`,
  `CREATE INDEX IF NOT EXISTS conversation_memory_fts_idx ON conversation_memory USING gin (to_tsvector('italian', content));`,
];

// ─── Sonda ───────────────────────────────────────────────────────────

/** Le 17 tabelle della 0038, nell'ordine del file. */
export const CONTEXT_TABLES: readonly string[] = Object.freeze([
  "context_sources",
  "context_facts",
  "context_entities",
  "context_fact_links",
  "context_relations",
  "context_commitments",
  "context_questions",
  "context_proposals",
  "context_events",
  "context_seen",
  "context_briefs",
  "context_granola_connections",
  "context_granola_oauth_states",
  "context_granola_clients",
  "context_granola_rules",
  "context_granola_links",
  "context_granola_meetings",
]);

/** I 5 indici unici che la sonda cerca: una fonte per call e per documento, una sola versione dopo un fatto, un legame per coppia. */
export const CONTEXT_UNIQUE_INDEXES: readonly string[] = Object.freeze([
  "context_sources_external_unique",
  "context_sources_document_unique",
  "context_facts_supersedes_unique",
  "context_fact_links_use_case_unique",
  "context_fact_links_entity_unique",
]);

/** I 4 indici GIN della ricerca in italiano: due sulle tabelle nuove, due su quelle della chat. */
export const CONTEXT_FTS_INDEXES: readonly string[] = Object.freeze([
  "context_sources_fts_idx",
  "context_facts_fts_idx",
  "document_chunks_fts_idx",
  "conversation_memory_fts_idx",
]);

/** Le 19 chiavi con un nome: le 17 chiavi primarie e i due vincoli unici (entità per chiave, collegamento per fatto). */
export const CONTEXT_NAMED_CONSTRAINTS: readonly string[] = Object.freeze([
  "context_sources_pkey",
  "context_facts_pkey",
  "context_entities_pkey",
  "context_entities_key_unique",
  "context_fact_links_pkey",
  "context_relations_pkey",
  "context_relations_unique",
  "context_commitments_pkey",
  "context_questions_pkey",
  "context_proposals_pkey",
  "context_events_pkey",
  "context_seen_pkey",
  "context_briefs_pkey",
  "context_granola_connections_pkey",
  "context_granola_oauth_states_pkey",
  "context_granola_clients_pkey",
  "context_granola_rules_pkey",
  "context_granola_links_pkey",
  "context_granola_meetings_pkey",
]);

/** La colonna della tesi del valore per workspace (fuori dalla tabella Drizzle `workspaces`). */
export const CONTEXT_THESIS_COLUMN = "company_value_thesis";

const regclass = (names: readonly string[]) => names.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ");
const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * Vera solo se ci sono le 17 tabelle, i 5 indici unici, i 4 indici GIN, le 19 chiavi e la colonna della tesi. Finché
 * è falsa «Contesto» dice che si sta preparando (`contextStoreReady`) e la tesi resta quella dell'organizzazione.
 */
export const CONTEXT_PROBE_SQL = `(
  ${regclass(CONTEXT_TABLES)}
  AND ${regclass(CONTEXT_UNIQUE_INDEXES)}
  AND ${regclass(CONTEXT_FTS_INDEXES)}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conname IN (${quoted(CONTEXT_NAMED_CONSTRAINTS)})
  ) = ${CONTEXT_NAMED_CONSTRAINTS.length}
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = '${CONTEXT_THESIS_COLUMN}'
  )
)`;
