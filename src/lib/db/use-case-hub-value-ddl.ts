/**
 * Area «Use case», benefici e «Cosa serve»: DDL del self-heal della 0022.
 *
 * Sono gli stessi statement di `drizzle/0022_use_case_value.sql`, nello stesso ordine:
 * 1. controllo che la 0020 ci sia (il trigger nuovo scrive `use_cases.version`);
 * 2. `use_cases.value_model` (jsonb, NULL quando la scheda non ha un modello dei benefici);
 * 3. un trigger separato che alza `version` quando cambia `value_model`. La funzione della
 *    0020 (`use_cases_bump_version`) non si tocca: i due trigger `BEFORE UPDATE` partono in
 *    ordine alfabetico, prima quello della 0020 e poi questo, e una scrittura che cambia
 *    `value_model` e un'altra colonna alza la versione di uno solo;
 * 4. le esigenze (`use_case_needs`: requisiti e prossimi passi) e i loro legami con le
 *    schede (`use_case_need_links`). Le esigenze non si cancellano: si archiviano.
 * `src/lib/db/use-case-hub-value-ddl.test.ts` controlla che la migrazione li contenga tutti,
 * nello stesso ordine, e che la sonda copra ogni oggetto.
 *
 * Tutti idempotenti e solo additivi: `ensureDbSchema()` li applica in una sola transazione,
 * dopo il DDL della 0020, sui database che non hanno ricevuto la migrazione. Le ipotesi di
 * calcolo del workspace non chiedono colonne: stanno in
 * `workspace_scoring_models.config.valueParams` (src/lib/use-cases/value-model.ts).
 *
 * Gli elenchi qui sotto sono la fonte dei CHECK: il testo SQL si compone da loro.
 * Modulo puro: importa solo `../uc/vocab.ts`; lo caricano anche gli script di verifica.
 */
import { ITEM_STATUSES } from "../uc/vocab.ts";

// ─── Elenchi chiusi delle esigenze ───────────────────────────────────

/** Requisito (serve per far avanzare uno use case) oppure prossimo passo. */
export const USE_CASE_NEED_TYPES = ["requisito", "passo"] as const;
export type UseCaseNeedType = (typeof USE_CASE_NEED_TYPES)[number];

/** Di che cosa si tratta: le aree della tabella «Cosa serve» si compongono da qui. */
export const USE_CASE_NEED_KINDS = ["accesso", "dato", "documento", "regola", "decisione", "persona", "contratto", "altro"] as const;
export type UseCaseNeedKind = (typeof USE_CASE_NEED_KINDS)[number];

/** Da che parte sta chi se ne occupa. */
export const USE_CASE_NEED_OWNER_SIDES = ["cliente", "lateral_space", "fornitore", "insieme"] as const;
export type UseCaseNeedOwnerSide = (typeof USE_CASE_NEED_OWNER_SIDES)[number];

/** Stati di un requisito: gli 8 stati delle voci dei dossier (`ITEM_STATUSES`). */
export const USE_CASE_NEED_REQUIREMENT_STATUSES = ITEM_STATUSES;
/** Stati di un prossimo passo. */
export const USE_CASE_NEED_STEP_STATUSES = ["proposta", "confermata", "fatta"] as const;
export type UseCaseNeedStatus = (typeof USE_CASE_NEED_REQUIREMENT_STATUSES)[number] | (typeof USE_CASE_NEED_STEP_STATUSES)[number];

/** Quando serve: subito, oppure dopo la scheda A.8. */
export const USE_CASE_NEED_AVAILABILITIES = ["subito", "dopo_a8"] as const;
export type UseCaseNeedAvailability = (typeof USE_CASE_NEED_AVAILABILITIES)[number];

/** Errore della 0022 su un database senza la 0020: il trigger nuovo scrive `use_cases.version`. */
export const MISSING_0020_MESSAGE = "use_cases: manca la 0020 (version). Applica prima drizzle/0020_use_case_hub.sql.";

// ─── Composizione del testo SQL ──────────────────────────────────────

/** `'a', 'b'`: valori noti, scritti qui sopra (nessun apice dentro). */
const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

export const USE_CASE_VALUE_DDL: readonly string[] = [
  // 1. La colonna che il trigger del punto 3 scrive nasce con la 0020. PL/pgSQL non controlla
  //    i campi di NEW e OLD quando crea la funzione: senza la 0020 il DDL passerebbe e poi ogni
  //    UPDATE di value_model fallirebbe. Nel self-heal non scatta mai: il DDL della 0020 viene prima.
  `DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'use_cases' AND column_name = 'version'
  ) THEN
    RAISE EXCEPTION '${MISSING_0020_MESSAGE}';
  END IF;
END $$;`,
  // 2. Modello dei benefici della scheda; NULL = nessun modello (la scheda resta come oggi).
  `ALTER TABLE use_cases
  ADD COLUMN IF NOT EXISTS value_model jsonb
    CONSTRAINT use_cases_value_model_check CHECK (value_model IS NULL OR jsonb_typeof(value_model) = 'object');`,
  // 3. Versione: sale anche quando cambia il modello dei benefici. Trigger e funzione separati
  //    da quelli della 0020, che non cambiano; parte dopo use_cases_bump_version (ordine dei
  //    nomi), quindi chi scrive version a mano continua a non cambiarla.
  `CREATE OR REPLACE FUNCTION use_cases_value_model_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.value_model IS DISTINCT FROM OLD.value_model THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END
$$;`,
  `CREATE OR REPLACE TRIGGER use_cases_value_model_version
  BEFORE UPDATE OF value_model ON use_cases
  FOR EACH ROW EXECUTE FUNCTION use_cases_value_model_version();`,
  // 4. Esigenze: requisiti e prossimi passi del workspace. Stato secondo il tipo; chiave di
  //    importazione unica per workspace (più righe senza chiave sono ammesse).
  `CREATE TABLE IF NOT EXISTS use_case_needs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type varchar(12) NOT NULL
    CONSTRAINT use_case_needs_type_check CHECK (type IN (${quoted(USE_CASE_NEED_TYPES)})),
  kind varchar(20) NOT NULL DEFAULT 'altro'
    CONSTRAINT use_case_needs_kind_check CHECK (kind IN (${quoted(USE_CASE_NEED_KINDS)})),
  title varchar(300) NOT NULL,
  detail varchar(4000),
  owner_label varchar(120),
  owner_side varchar(20)
    CONSTRAINT use_case_needs_owner_side_check CHECK (owner_side IS NULL OR owner_side IN (${quoted(USE_CASE_NEED_OWNER_SIDES)})),
  status varchar(20) NOT NULL,
  availability varchar(12)
    CONSTRAINT use_case_needs_availability_check CHECK (availability IS NULL OR availability IN (${quoted(USE_CASE_NEED_AVAILABILITIES)})),
  due_on date,
  due_label varchar(80),
  due_is_proposal boolean NOT NULL DEFAULT false,
  for_label varchar(200),
  sort_order integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  import_key varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  archived_at timestamptz,
  archive_reason varchar(300),
  CONSTRAINT use_case_needs_status_check CHECK (
    (type = 'requisito' AND status IN (${quoted(USE_CASE_NEED_REQUIREMENT_STATUSES)}))
    OR (type = 'passo' AND status IN (${quoted(USE_CASE_NEED_STEP_STATUSES)}))
  ),
  CONSTRAINT use_case_needs_archive_check CHECK (archive_reason IS NULL OR archived_at IS NOT NULL),
  CONSTRAINT use_case_needs_import_key_unique UNIQUE (workspace_id, import_key)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_needs_workspace_idx
  ON use_case_needs (workspace_id, type, sort_order);`,
  // Legami tra esigenze e schede: spariscono con l'una o con l'altra.
  `CREATE TABLE IF NOT EXISTS use_case_need_links (
  need_id uuid NOT NULL REFERENCES use_case_needs(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  CONSTRAINT use_case_need_links_pkey PRIMARY KEY (need_id, use_case_id)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_need_links_use_case_idx
  ON use_case_need_links (use_case_id);`,
];

/** Vincoli con nome del DDL, per la sonda. */
const NAMED_CONSTRAINTS = [
  "use_cases_value_model_check",
  "use_case_needs_type_check",
  "use_case_needs_kind_check",
  "use_case_needs_owner_side_check",
  "use_case_needs_availability_check",
  "use_case_needs_status_check",
  "use_case_needs_archive_check",
  "use_case_needs_import_key_unique",
  "use_case_need_links_pkey",
] as const;

/** Colonne della tabella delle esigenze, nell'ordine del DDL, per la sonda. */
export const USE_CASE_NEED_COLUMNS = [
  "id",
  "workspace_id",
  "type",
  "kind",
  "title",
  "detail",
  "owner_label",
  "owner_side",
  "status",
  "availability",
  "due_on",
  "due_label",
  "due_is_proposal",
  "for_label",
  "sort_order",
  "version",
  "import_key",
  "created_at",
  "updated_at",
  "done_at",
  "archived_at",
  "archive_reason",
] as const;

/**
 * Espressione booleana per la sonda di `ensureDbSchema()`: vera solo se tutto il DDL della
 * 0022 è presente (colonna, vincoli, tabelle e loro colonne, indici, funzione, trigger).
 * Senza, un database con la 0020 e senza la 0022 sembrerebbe aggiornato e Drizzle
 * chiederebbe `value_model`, che non c'è.
 */
export const USE_CASE_VALUE_PROBE_SQL = `(
  to_regclass('public.use_case_needs') IS NOT NULL
  AND to_regclass('public.use_case_need_links') IS NOT NULL
  AND to_regclass('public.use_case_needs_workspace_idx') IS NOT NULL
  AND to_regclass('public.use_case_need_links_use_case_idx') IS NOT NULL
  AND to_regprocedure('public.use_cases_value_model_version()') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'use_cases'
      AND column_name = 'value_model'
  )
  AND (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'use_case_needs'
      AND column_name IN (${quoted(USE_CASE_NEED_COLUMNS)})
  ) = ${USE_CASE_NEED_COLUMNS.length}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN (to_regclass('public.use_cases'), to_regclass('public.use_case_needs'), to_regclass('public.use_case_need_links'))
      AND conname IN (${quoted(NAMED_CONSTRAINTS)})
  ) = ${NAMED_CONSTRAINTS.length}
  AND EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'use_cases'
      AND t.tgname = 'use_cases_value_model_version'
      AND NOT t.tgisinternal
  )
)`;
