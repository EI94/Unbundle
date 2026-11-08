/**
 * Area «Use case», rilascio 6 «Il filo con il referente»: DDL del self-heal della 0028.
 *
 * Sono gli stessi statement di `drizzle/0028_use_case_referent_thread.sql`, nello stesso ordine, dopo le
 * due righe di apertura del file (`lock_timeout` e l'advisory lock {@link REFERENT_THREAD_ADVISORY_LOCK},
 * che il self-heal prende da sé in `runUseCaseReferentThreadDdl`):
 * 1. controllo che la 0027 ci sia (le richieste, le conferme e le risposte per beneficio a cui il filo si attacca);
 * 2. `use_case_referent_messages`: il filo di una richiesta, un messaggio per riga, attaccato a una domanda,
 *    a una voce di «Benefici e costi» o a «Generale»; chi scrive (il team o il referente), il tipo
 *    (chiarimento, dubbio, risposta, aggiunta), il testo, quando l'altra parte l'ha visto e quando l'ha
 *    gestito; la cancellazione e la conservazione svuotano il testo;
 * 3. `use_case_referent_suggestions`: le domande che l'AI propone al team dopo una risposta (mai al
 *    referente: una tabella a parte, che la pagina pubblica non legge), con il loro stato;
 * 4. colonne nuove, tutte con un default: `reopened_at` e `renewed_at` sulle richieste (riaperta dopo
 *    «Invia», link rinnovato), `follow_up` sulle domande («Nuove domande», arrivate dopo «Invia»),
 *    `edited_at` sulle risposte (il referente l'ha cambiata), `clarifications` e `replies` sulle voci
 *    delle email al referente, `questions` sulle voci delle email a chi ha chiesto;
 * 5. due CHECK allargati con lo stesso nome (`NOT VALID` poi `VALIDATE`, che non può fallire: la condizione
 *    nuova è quella di prima in OR, o l'elenco di prima più un nome): i tipi della campanella con `domanda`
 *    («Il referente ha chiesto qualcosa», sotto l'advisory lock della 0025 che lo ha allargato per prima) e
 *    le novità delle email a chi ha chiesto con `questions > 0`.
 *
 * Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto. Il codice
 * del rilascio 5.1 ignora tabelle e colonne nuove (i suoi INSERT lasciano i default) e non scrive mai i
 * valori nuovi dei CHECK allargati.
 *
 * `src/lib/db/use-case-hub-referent-thread-ddl.test.ts` controlla che la migrazione li contenga tutti, nello
 * stesso ordine, che i CHECK siano gli elenchi qui sotto e che la sonda copra ogni oggetto.
 * Modulo puro: importa solo moduli DDL puri; lo caricano anche gli script di verifica.
 */
import { ALERTS_ADVISORY_LOCK, NOTIFICATION_KINDS_CHECK_NAME, USE_CASE_NOTIFICATION_KINDS_0025, notificationKindsWideningDdl } from "./use-case-hub-alerts-ddl.ts";

// ─── Vocabolario ─────────────────────────────────────────────────────

/** A che cosa è attaccato un messaggio: una domanda della richiesta, una voce di «Benefici e costi», «Generale». */
export const REFERENT_THREAD_ANCHORS = ["domanda", "beneficio", "generale"] as const;
export type ReferentThreadAnchor = (typeof REFERENT_THREAD_ANCHORS)[number];

/** Chi scrive: il team (un revisore dalla scheda) o il referente (dalla sua pagina). */
export const REFERENT_THREAD_SIDES = ["team", "referente"] as const;
export type ReferentThreadSide = (typeof REFERENT_THREAD_SIDES)[number];

/**
 * Il tipo: «chiarimento» (il team chiede di più su una risposta), «dubbio» (il referente chiede qualcosa al
 * team), «risposta» (una parte risponde a un messaggio dell'altra), «aggiunta» (il referente aggiunge a
 * una risposta già inviata).
 */
export const REFERENT_THREAD_KINDS = ["chiarimento", "dubbio", "risposta", "aggiunta"] as const;
export type ReferentThreadKind = (typeof REFERENT_THREAD_KINDS)[number];

/** I tipi di ogni parte. */
export const REFERENT_THREAD_KINDS_BY_SIDE: Readonly<Record<ReferentThreadSide, readonly ReferentThreadKind[]>> = Object.freeze({
  team: Object.freeze(["chiarimento", "risposta"] as const),
  referente: Object.freeze(["dubbio", "risposta", "aggiunta"] as const),
});

/** Perché un testo è stato tolto: la conservazione di 12 mesi o «Cancella i dati di questa persona». */
export const REFERENT_THREAD_REMOVE_REASONS = ["conservazione", "cancellazione"] as const;
export type ReferentThreadRemoveReason = (typeof REFERENT_THREAD_REMOVE_REASONS)[number];

/**
 * Lo stato di una proposta dell'AI: «da_fare» (da calcolare), «proposta» (c'è una domanda), «nessuna» (la
 * risposta basta, o l'AI non c'è), «errore» (tre tentativi falliti), poi «usata» (il team l'ha chiesta) o
 * «scartata» («Lascia stare»).
 */
export const REFERENT_SUGGESTION_STATUSES = ["da_fare", "proposta", "nessuna", "usata", "scartata", "errore"] as const;
export type ReferentSuggestionStatus = (typeof REFERENT_SUGGESTION_STATUSES)[number];

/** I tipi della campanella dopo la 0028: quelli della 0025 più «Il referente ha chiesto qualcosa». */
export const USE_CASE_NOTIFICATION_KINDS_0028 = [...USE_CASE_NOTIFICATION_KINDS_0025, "domanda"] as const;
export type UseCaseNoticeKind0028 = (typeof USE_CASE_NOTIFICATION_KINDS_0028)[number];

/** I limiti delle colonne. */
export const REFERENT_THREAD_LIMITS = Object.freeze({
  /** Il testo di un messaggio (una riga del team; il referente scrive di più). */
  body: 1000,
  /** La domanda proposta dall'AI. */
  suggestion: 300,
  /** Il nome del modello. */
  model: 100,
  /** La chiave di una voce di «Benefici e costi» (`VALUE_MODEL_LIMITS.key`). */
  key: 40,
  /** I tentativi di una proposta dell'AI. */
  attempts: 3,
  /** Le novità di una voce di un'email al referente (come `new_questions`). */
  emailNews: 20,
  /** Le domande del referente in una voce dell'email a chi ha chiesto (come `answers`). */
  requesterQuestions: 999,
});

/** La chiave dell'advisory lock della 0028: la stessa nel file e in `runUseCaseReferentThreadDdl`. */
export const REFERENT_THREAD_ADVISORY_LOCK = "unbundle:use-case-referent-thread-ddl";

/** Quanto aspetta ogni lock della 0028 prima di fermarsi senza cambiare nulla. */
export const REFERENT_THREAD_LOCK_TIMEOUT = "3s";

/** Errore della 0028 su un database senza la 0027. */
export const MISSING_BENEFITS_FOR_THREAD_MESSAGE = "use_case_referent_thread: manca la 0027. Applica prima drizzle/0027_use_case_referent_benefits.sql.";

/** Il CHECK delle novità delle email a chi ha chiesto (nato con la 0024), che la 0028 allarga tenendo il nome. */
export const REQUESTER_NEWS_CHECK_NAME = "use_case_requester_email_items_news_check";

/** La condizione delle novità dopo la 0028: quella della 0024 con le domande del referente in OR. */
export const REQUESTER_NEWS_CHECK_0028 = "answers > 0 OR unknowns > 0 OR documents > 0 OR follow_up IS NOT NULL OR questions > 0";

/** Le colonne che la 0028 aggiunge a tabelle che c'erano già, nell'ordine (per il test delle colonne Drizzle). */
export const REFERENT_THREAD_ADDED_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  use_case_referent_requests: Object.freeze(["reopened_at", "renewed_at"]),
  use_case_referent_request_items: Object.freeze(["follow_up"]),
  use_case_need_answers: Object.freeze(["edited_at"]),
  use_case_referent_email_items: Object.freeze(["clarifications", "replies"]),
  use_case_requester_email_items: Object.freeze(["questions"]),
});

// ─── Composizione del testo SQL ──────────────────────────────────────

/** `'a', 'b'`: valori noti, scritti qui sopra (nessun apice dentro). */
const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
const L = REFERENT_THREAD_LIMITS;

/** La forma dell'ancora: una domanda con la sua esigenza, una voce con la sua chiave, «Generale» senza niente. */
const anchorShape = (name: string) => `CONSTRAINT ${name} CHECK (
    (anchor = 'domanda' AND need_id IS NOT NULL AND component_key IS NULL)
    OR (anchor = 'beneficio' AND component_key IS NOT NULL AND need_id IS NULL)
    OR (anchor = 'generale' AND need_id IS NULL AND component_key IS NULL))`;

/** Gli statement della 0028 dopo le due righe di apertura, nell'ordine del file. */
export const USE_CASE_REFERENT_THREAD_DDL: readonly string[] = [
  `DO $$ BEGIN
  IF to_regclass('public.use_case_referent_check_benefits') IS NULL THEN
    RAISE EXCEPTION '${MISSING_BENEFITS_FOR_THREAD_MESSAGE}';
  END IF;
END $$;`,
  `CREATE TABLE IF NOT EXISTS use_case_referent_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  anchor varchar(10) NOT NULL CONSTRAINT use_case_referent_messages_anchor_check CHECK (anchor IN (${quoted(REFERENT_THREAD_ANCHORS)})),
  need_id uuid REFERENCES use_case_needs(id) ON DELETE CASCADE,
  component_key varchar(${L.key}),
  side varchar(10) NOT NULL CONSTRAINT use_case_referent_messages_side_check CHECK (side IN (${quoted(REFERENT_THREAD_SIDES)})),
  kind varchar(12) NOT NULL CONSTRAINT use_case_referent_messages_kind_check CHECK (kind IN (${quoted(REFERENT_THREAD_KINDS)})),
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reply_to_id uuid REFERENCES use_case_referent_messages(id) ON DELETE CASCADE,
  body varchar(${L.body}),
  created_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz,
  handled_at timestamptz,
  handled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  removed_at timestamptz,
  removed_reason varchar(14) CONSTRAINT use_case_referent_messages_removed_reason_check CHECK (removed_reason IS NULL OR removed_reason IN (${quoted(REFERENT_THREAD_REMOVE_REASONS)})),
  CONSTRAINT use_case_referent_messages_pkey PRIMARY KEY (id),
  ${anchorShape("use_case_referent_messages_shape_check")},
  CONSTRAINT use_case_referent_messages_side_kind_check CHECK ((side = 'team' AND kind IN (${quoted(REFERENT_THREAD_KINDS_BY_SIDE.team)}))
    OR (side = 'referente' AND kind IN (${quoted(REFERENT_THREAD_KINDS_BY_SIDE.referente)}))),
  CONSTRAINT use_case_referent_messages_author_check CHECK (side = 'team' OR author_user_id IS NULL),
  CONSTRAINT use_case_referent_messages_reply_check CHECK ((kind = 'risposta') = (reply_to_id IS NOT NULL)),
  CONSTRAINT use_case_referent_messages_body_check CHECK ((removed_at IS NULL) = (body IS NOT NULL) AND (body IS NULL OR length(btrim(body)) > 0)),
  CONSTRAINT use_case_referent_messages_removed_check CHECK ((removed_at IS NULL) = (removed_reason IS NULL)),
  CONSTRAINT use_case_referent_messages_handled_check CHECK (handled_by_user_id IS NULL OR handled_at IS NOT NULL)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_messages_request_idx ON use_case_referent_messages (request_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_messages_use_case_idx ON use_case_referent_messages (use_case_id);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_messages_workspace_idx ON use_case_referent_messages (workspace_id);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_messages_open_idx ON use_case_referent_messages (request_id) WHERE handled_at IS NULL AND removed_at IS NULL;`,
  `CREATE TABLE IF NOT EXISTS use_case_referent_suggestions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  anchor varchar(10) NOT NULL CONSTRAINT use_case_referent_suggestions_anchor_check CHECK (anchor IN (${quoted(REFERENT_THREAD_ANCHORS)})),
  need_id uuid REFERENCES use_case_needs(id) ON DELETE CASCADE,
  component_key varchar(${L.key}),
  source_at timestamptz NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'da_fare' CONSTRAINT use_case_referent_suggestions_status_check CHECK (status IN (${quoted(REFERENT_SUGGESTION_STATUSES)})),
  body varchar(${L.suggestion}),
  model varchar(${L.model}),
  attempts smallint NOT NULL DEFAULT 0 CONSTRAINT use_case_referent_suggestions_attempts_check CHECK (attempts BETWEEN 0 AND ${L.attempts}),
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT use_case_referent_suggestions_pkey PRIMARY KEY (id),
  ${anchorShape("use_case_referent_suggestions_shape_check")},
  CONSTRAINT use_case_referent_suggestions_body_check CHECK ((status IN ('proposta', 'usata', 'scartata')) = (body IS NOT NULL) AND (body IS NULL OR length(btrim(body)) > 0)),
  CONSTRAINT use_case_referent_suggestions_decided_check CHECK ((status IN ('usata', 'scartata')) = (decided_at IS NOT NULL) AND (decided_by_user_id IS NULL OR decided_at IS NOT NULL))
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS use_case_referent_suggestions_target_unique ON use_case_referent_suggestions (request_id, anchor, coalesce(need_id::text, ''), coalesce(component_key, ''), source_at);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_suggestions_use_case_idx ON use_case_referent_suggestions (use_case_id);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_suggestions_workspace_idx ON use_case_referent_suggestions (workspace_id);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_suggestions_pending_idx ON use_case_referent_suggestions (created_at) WHERE status IN ('da_fare', 'errore');`,
  `ALTER TABLE use_case_referent_requests ADD COLUMN IF NOT EXISTS reopened_at timestamptz;`,
  `ALTER TABLE use_case_referent_requests ADD COLUMN IF NOT EXISTS renewed_at timestamptz;`,
  `ALTER TABLE use_case_referent_request_items ADD COLUMN IF NOT EXISTS follow_up boolean NOT NULL DEFAULT false;`,
  `ALTER TABLE use_case_need_answers ADD COLUMN IF NOT EXISTS edited_at timestamptz;`,
  `ALTER TABLE use_case_referent_email_items ADD COLUMN IF NOT EXISTS clarifications smallint NOT NULL DEFAULT 0 CONSTRAINT use_case_referent_email_items_clarifications_check CHECK (clarifications BETWEEN 0 AND ${L.emailNews});`,
  `ALTER TABLE use_case_referent_email_items ADD COLUMN IF NOT EXISTS replies smallint NOT NULL DEFAULT 0 CONSTRAINT use_case_referent_email_items_replies_check CHECK (replies BETWEEN 0 AND ${L.emailNews});`,
  `ALTER TABLE use_case_requester_email_items ADD COLUMN IF NOT EXISTS questions smallint NOT NULL DEFAULT 0 CONSTRAINT use_case_requester_email_items_questions_check CHECK (questions BETWEEN 0 AND ${L.requesterQuestions});`,
  `DO $$ BEGIN
  PERFORM set_config('lock_timeout', '${REFERENT_THREAD_LOCK_TIMEOUT}', true);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.use_case_requester_email_items'::regclass AND conname = '${REQUESTER_NEWS_CHECK_NAME}'
      AND pg_get_constraintdef(oid) LIKE '%questions%') THEN
    ALTER TABLE use_case_requester_email_items DROP CONSTRAINT IF EXISTS ${REQUESTER_NEWS_CHECK_NAME};
    ALTER TABLE use_case_requester_email_items ADD CONSTRAINT ${REQUESTER_NEWS_CHECK_NAME} CHECK (${REQUESTER_NEWS_CHECK_0028}) NOT VALID;
    ALTER TABLE use_case_requester_email_items VALIDATE CONSTRAINT ${REQUESTER_NEWS_CHECK_NAME};
  END IF;
END $$;`,
  // I tipi della campanella: lo stesso blocco della 0025, sotto il suo advisory lock (file e self-heal della
  // 0025 e della 0028 uno alla volta sullo stesso vincolo; l'ordine è sempre 0028 poi 0025, quindi niente stallo).
  `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`,
  notificationKindsWideningDdl(USE_CASE_NOTIFICATION_KINDS_0028),
];

// ─── Pulizia (cron e RUNBOOK §10.15) ─────────────────────────────────

/**
 * Le due pulizie dopo un ritorno indietro (RUNBOOK §10.15), le stesse che il cron fa ogni giorno dopo quelle
 * della 0027: idempotenti, sul codice nuovo non trovano niente da fare. Il codice del rilascio 5.1 non
 * conosce il filo: la sua «Cancella i dati di questa persona» e la sua conservazione di 12 mesi lasciano i
 * testi dei messaggi e le proposte dell'AI delle richieste che svuota (`purged_at`).
 * 1. i testi dei messaggi delle richieste cancellate (motivo della cancellazione: la richiesta revocata per
 *    «cancellazione»; altrimenti la conservazione);
 * 2. le proposte dell'AI delle stesse richieste.
 */
export const REFERENT_THREAD_SWEEP_SQL: readonly string[] = Object.freeze([
  `UPDATE use_case_referent_messages m SET body = NULL, removed_at = now(),
  removed_reason = CASE WHEN r.revoked_reason = 'cancellazione' THEN 'cancellazione' ELSE 'conservazione' END
  FROM use_case_referent_requests r WHERE m.request_id = r.id AND r.purged_at IS NOT NULL AND m.removed_at IS NULL;`,
  `DELETE FROM use_case_referent_suggestions s USING use_case_referent_requests r WHERE s.request_id = r.id AND r.purged_at IS NOT NULL;`,
]);

// ─── Sonda ───────────────────────────────────────────────────────────

/** Le tabelle della 0028. */
export const REFERENT_THREAD_TABLES = ["use_case_referent_messages", "use_case_referent_suggestions"] as const;

/** Gli indici della 0028, per nome (oltre alle chiavi primarie). */
export const REFERENT_THREAD_INDEXES = [
  "use_case_referent_messages_request_idx",
  "use_case_referent_messages_use_case_idx",
  "use_case_referent_messages_workspace_idx",
  "use_case_referent_messages_open_idx",
  "use_case_referent_suggestions_target_unique",
  "use_case_referent_suggestions_use_case_idx",
  "use_case_referent_suggestions_workspace_idx",
  "use_case_referent_suggestions_pending_idx",
] as const;

/** I vincoli con nome delle tabelle nuove (`CONSTRAINT <nome>`), per la sonda. */
export const REFERENT_THREAD_NAMED_CONSTRAINTS = [
  "use_case_referent_messages_anchor_check",
  "use_case_referent_messages_side_check",
  "use_case_referent_messages_kind_check",
  "use_case_referent_messages_removed_reason_check",
  "use_case_referent_messages_pkey",
  "use_case_referent_messages_shape_check",
  "use_case_referent_messages_side_kind_check",
  "use_case_referent_messages_author_check",
  "use_case_referent_messages_reply_check",
  "use_case_referent_messages_body_check",
  "use_case_referent_messages_removed_check",
  "use_case_referent_messages_handled_check",
  "use_case_referent_suggestions_anchor_check",
  "use_case_referent_suggestions_status_check",
  "use_case_referent_suggestions_attempts_check",
  "use_case_referent_suggestions_pkey",
  "use_case_referent_suggestions_shape_check",
  "use_case_referent_suggestions_body_check",
  "use_case_referent_suggestions_decided_check",
] as const;

/** I vincoli con nome delle colonne nuove su tabelle che c'erano già, con la loro tabella. */
export const REFERENT_THREAD_COLUMN_CONSTRAINTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  use_case_referent_email_items: Object.freeze(["use_case_referent_email_items_clarifications_check", "use_case_referent_email_items_replies_check"]),
  use_case_requester_email_items: Object.freeze(["use_case_requester_email_items_questions_check"]),
});

/**
 * Espressione booleana per la sonda di `ensureDbSchema()`, di `referentStoreReady` e del doctor: vera solo
 * se tutto il DDL della 0028 è presente (le due tabelle, i loro indici e i loro vincoli con nome, ogni
 * colonna nuova con il suo vincolo, il CHECK delle novità già allargato, `domanda` nei tipi della campanella).
 */
export const USE_CASE_REFERENT_THREAD_PROBE_SQL = `(
  ${REFERENT_THREAD_TABLES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND ${REFERENT_THREAD_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN (${REFERENT_THREAD_TABLES.map((name) => `to_regclass('public.${name}')`).join(", ")})
      AND conname IN (${quoted(REFERENT_THREAD_NAMED_CONSTRAINTS)})
  ) = ${REFERENT_THREAD_NAMED_CONSTRAINTS.length}
  AND ${Object.entries(REFERENT_THREAD_ADDED_COLUMNS)
    .map(
      ([table, columns]) => `(
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '${table}' AND column_name IN (${quoted(columns)})
  ) = ${columns.length}`,
    )
    .join("\n  AND ")}
  AND ${Object.entries(REFERENT_THREAD_COLUMN_CONSTRAINTS)
    .map(
      ([table, names]) => `(
    SELECT count(*) FROM pg_constraint
    WHERE conrelid = to_regclass('public.${table}') AND conname IN (${quoted(names)})
  ) = ${names.length}`,
    )
    .join("\n  AND ")}
  AND EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = to_regclass('public.use_case_requester_email_items') AND conname = '${REQUESTER_NEWS_CHECK_NAME}'
      AND pg_get_constraintdef(oid) LIKE '%questions%'
  )
  AND EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.use_case_notifications') AND c.conname = '${NOTIFICATION_KINDS_CHECK_NAME}'
      AND position('''domanda''' IN pg_get_constraintdef(c.oid)) > 0
  )
)`;
