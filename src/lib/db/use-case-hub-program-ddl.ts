/**
 * Rilascio 7 «Programma»: DDL del self-heal della 0029 (docs/programma/RILASCIO-7-PROGETTO.md §5).
 *
 * Sono gli stessi statement di `drizzle/0029_program.sql`, nello stesso ordine, dopo le due righe di
 * apertura del file (`lock_timeout` e l'advisory lock {@link PROGRAM_ADVISORY_LOCK}, che il self-heal
 * prende da sé in `runProgramDdl`):
 * 1. controllo che la 0028 ci sia (il rilascio 6);
 * 2. `program_settings`: una riga per workspace con i dipendenti e il ricavo (e da dove vengono: la chat di
 *    Discovery o a mano), i costi di Lateral Space (canone di supporto al mese, da quale mese e fino a
 *    quale, la percentuale dello sviluppo), i pesi dell'indice AI-native, le decisioni per la leadership e
 *    il giorno dell'ultimo SAL;
 * 3. `program_case_costs`: lo sviluppo di Lateral Space di uno use case, a percentuale del suo valore o a
 *    importo fisso (si cancella con lo use case);
 * 4. `program_snapshots`: le fotografie dei numeri aggregati, una al mese (il cron) e una per SAL chiuso;
 * 5. `program_kpis` e `program_kpi_values`: i KPI attivati (dal catalogo, a mano o con una formula) e i
 *    valori scritti a mano o dal Brain mese per mese;
 * 6. `strategic_goal_checkins`: la base e gli aggiornamenti dei risultati chiave (una base al massimo per
 *    risultato chiave). `strategic_goals` non cambia: le sue letture di oggi leggono tutte le colonne, e una
 *    colonna in più le romperebbe finché la 0029 non c'è;
 * 7. il CHECK dei tipi della campanella allargato con `da_rivedere` (uno use case in uso che rende poco più
 *    di quanto costa tenerlo acceso), sotto l'advisory lock della 0025, come la 0028.
 *
 * Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto. Il codice
 * del rilascio 6 ignora tabelle e colonne nuove e non scrive mai `da_rivedere`.
 *
 * `src/lib/db/use-case-hub-program-ddl.test.ts` controlla che la migrazione li contenga tutti, nello stesso
 * ordine, che i CHECK siano gli elenchi qui sotto e che la sonda copra ogni oggetto.
 * Modulo puro: importa solo moduli DDL puri; lo caricano anche gli script di verifica.
 */
import { ALERTS_ADVISORY_LOCK, NOTIFICATION_KINDS_CHECK_NAME, notificationKindsWideningDdl } from "./use-case-hub-alerts-ddl.ts";
import { USE_CASE_NOTIFICATION_KINDS_0028 } from "./use-case-hub-referent-thread-ddl.ts";

// ─── Vocabolario ─────────────────────────────────────────────────────

/** Da dove vengono dipendenti e ricavo: la chat di Discovery o un campo della pagina. */
export const PROGRAM_FACT_SOURCES = ["discovery", "manuale"] as const;
export type ProgramFactSource = (typeof PROGRAM_FACT_SOURCES)[number];

/** Lo sviluppo di Lateral Space di uno use case: a percentuale del valore all'anno o a importo fisso. */
export const PROGRAM_CASE_COST_MODES = ["percentuale", "importo"] as const;
export type ProgramCaseCostMode = (typeof PROGRAM_CASE_COST_MODES)[number];

/** Le fotografie: una al mese, una per SAL. */
export const PROGRAM_SNAPSHOT_KINDS = ["mese", "sal"] as const;
export type ProgramSnapshotKind = (typeof PROGRAM_SNAPSHOT_KINDS)[number];

/** Il tipo di un KPI: «Risultato» (gli obiettivi si fissano qui) o «Iniziativa» (spiega i risultati). */
export const PROGRAM_KPI_KINDS = ["risultato", "iniziativa"] as const;
export type ProgramKpiKind = (typeof PROGRAM_KPI_KINDS)[number];

/** Da dove viene il valore di un KPI: calcolato dall'app, scritto a mano mese per mese, oppure una formula. */
export const PROGRAM_KPI_SOURCES = ["automatico", "manuale", "formula"] as const;
export type ProgramKpiSource = (typeof PROGRAM_KPI_SOURCES)[number];

/** Verso dove deve andare un KPI. */
export const PROGRAM_KPI_DIRECTIONS = ["su", "giu"] as const;
export type ProgramKpiDirection = (typeof PROGRAM_KPI_DIRECTIONS)[number];

/** Chi ha scritto il valore di un KPI a mano: una persona dalla pagina o il Brain (contratto del Monitor di Nativa). */
export const PROGRAM_KPI_VALUE_SOURCES = ["manuale", "brain"] as const;
export type ProgramKpiValueSource = (typeof PROGRAM_KPI_VALUE_SOURCES)[number];

/** I tipi della campanella dopo la 0029: quelli della 0028 più «Da rivedere». */
export const USE_CASE_NOTIFICATION_KINDS_0029 = [...USE_CASE_NOTIFICATION_KINDS_0028, "da_rivedere"] as const;
export type UseCaseNoticeKind0029 = (typeof USE_CASE_NOTIFICATION_KINDS_0029)[number];

/** I limiti delle colonne. */
export const PROGRAM_LIMITS = Object.freeze({
  employeesMax: 10_000_000,
  revenueEurMax: 1_000_000_000_000,
  supportMonthEurMax: 10_000_000,
  caseAmountEurMax: 100_000_000,
  kpiKey: 40,
  kpiLabel: 120,
  kpiUnit: 16,
  kpiFormula: 300,
  checkinNote: 300,
  /** Le decisioni per la leadership: quante e quanto lunghe (le controlla l'app, il CHECK solo il tipo). */
  asksMax: 8,
  askText: 200,
});

/** La chiave dell'advisory lock della 0029: la stessa nel file e in `runProgramDdl`. */
export const PROGRAM_ADVISORY_LOCK = "unbundle:use-case-program-ddl";

/** Quanto aspetta ogni lock della 0029 prima di fermarsi senza cambiare nulla. */
export const PROGRAM_LOCK_TIMEOUT = "3s";

/** Errore della 0029 su un database senza la 0028. */
export const MISSING_THREAD_FOR_PROGRAM_MESSAGE = "program: manca la 0028. Applica prima drizzle/0028_use_case_referent_thread.sql.";

/** Un check-in di un risultato chiave: la base (una al massimo) o un aggiornamento. */
export const GOAL_CHECKIN_KINDS = ["base", "aggiornamento"] as const;
export type GoalCheckinKind = (typeof GOAL_CHECKIN_KINDS)[number];

// ─── Composizione del testo SQL ──────────────────────────────────────

/** `'a', 'b'`: valori noti, scritti qui sopra (nessun apice dentro). */
const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
const L = PROGRAM_LIMITS;
const MONTH_RE = "^[0-9]{4}-(0[1-9]|1[0-2])$";
const DAY_RE = "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$";

/** Gli statement della 0029 dopo le due righe di apertura, nell'ordine del file. */
export const PROGRAM_DDL: readonly string[] = [
  `DO $$ BEGIN
  IF to_regclass('public.use_case_referent_messages') IS NULL THEN
    RAISE EXCEPTION '${MISSING_THREAD_FOR_PROGRAM_MESSAGE}';
  END IF;
END $$;`,
  `CREATE TABLE IF NOT EXISTS program_settings (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  employees integer CONSTRAINT program_settings_employees_check CHECK (employees IS NULL OR employees BETWEEN 1 AND ${L.employeesMax}),
  employees_source varchar(10) CONSTRAINT program_settings_employees_source_check CHECK (employees_source IS NULL OR employees_source IN (${quoted(PROGRAM_FACT_SOURCES)})),
  revenue_eur bigint CONSTRAINT program_settings_revenue_check CHECK (revenue_eur IS NULL OR revenue_eur BETWEEN 1 AND ${L.revenueEurMax}),
  revenue_source varchar(10) CONSTRAINT program_settings_revenue_source_check CHECK (revenue_source IS NULL OR revenue_source IN (${quoted(PROGRAM_FACT_SOURCES)})),
  support_month_eur numeric(12,2) CONSTRAINT program_settings_support_check CHECK (support_month_eur IS NULL OR support_month_eur BETWEEN 0 AND ${L.supportMonthEurMax}),
  support_from varchar(7) CONSTRAINT program_settings_support_from_check CHECK (support_from IS NULL OR support_from ~ '${MONTH_RE}'),
  support_to varchar(7) CONSTRAINT program_settings_support_to_check CHECK (support_to IS NULL OR support_to ~ '${MONTH_RE}'),
  dev_pct numeric(5,2) CONSTRAINT program_settings_dev_pct_check CHECK (dev_pct IS NULL OR dev_pct BETWEEN 0 AND 100),
  index_weights jsonb CONSTRAINT program_settings_index_weights_check CHECK (index_weights IS NULL OR jsonb_typeof(index_weights) = 'object'),
  leadership_asks jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT program_settings_asks_check CHECK (jsonb_typeof(leadership_asks) = 'array'),
  last_sal_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT program_settings_pkey PRIMARY KEY (workspace_id),
  CONSTRAINT program_settings_sources_check CHECK ((employees IS NULL) = (employees_source IS NULL) AND (revenue_eur IS NULL) = (revenue_source IS NULL)),
  CONSTRAINT program_settings_support_range_check CHECK (support_from IS NULL OR support_to IS NULL OR support_to >= support_from)
);`,
  `CREATE TABLE IF NOT EXISTS program_case_costs (
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mode varchar(12) NOT NULL CONSTRAINT program_case_costs_mode_check CHECK (mode IN (${quoted(PROGRAM_CASE_COST_MODES)})),
  amount_eur numeric(12,2) CONSTRAINT program_case_costs_amount_check CHECK (amount_eur IS NULL OR amount_eur BETWEEN 0 AND ${L.caseAmountEurMax}),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT program_case_costs_pkey PRIMARY KEY (use_case_id),
  CONSTRAINT program_case_costs_shape_check CHECK ((mode = 'importo') = (amount_eur IS NOT NULL))
);`,
  `CREATE INDEX IF NOT EXISTS program_case_costs_workspace_idx ON program_case_costs (workspace_id);`,
  `CREATE TABLE IF NOT EXISTS program_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind varchar(4) NOT NULL CONSTRAINT program_snapshots_kind_check CHECK (kind IN (${quoted(PROGRAM_SNAPSHOT_KINDS)})),
  period varchar(10) NOT NULL,
  metrics jsonb NOT NULL CONSTRAINT program_snapshots_metrics_check CHECK (jsonb_typeof(metrics) = 'object'),
  taken_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT program_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT program_snapshots_period_check CHECK ((kind = 'mese' AND period ~ '${MONTH_RE}') OR (kind = 'sal' AND period ~ '${DAY_RE}'))
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS program_snapshots_period_unique ON program_snapshots (workspace_id, kind, period);`,
  `CREATE TABLE IF NOT EXISTS program_kpis (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key varchar(${L.kpiKey}) NOT NULL CONSTRAINT program_kpis_key_check CHECK (key ~ '^[a-z][a-z0-9_]{1,${L.kpiKey - 1}}$'),
  label varchar(${L.kpiLabel}) NOT NULL CONSTRAINT program_kpis_label_check CHECK (length(btrim(label)) > 0),
  unit varchar(${L.kpiUnit}) NOT NULL DEFAULT '',
  kind varchar(10) NOT NULL CONSTRAINT program_kpis_kind_check CHECK (kind IN (${quoted(PROGRAM_KPI_KINDS)})),
  source varchar(10) NOT NULL CONSTRAINT program_kpis_source_check CHECK (source IN (${quoted(PROGRAM_KPI_SOURCES)})),
  formula varchar(${L.kpiFormula}),
  base_value double precision,
  target_value double precision,
  direction varchar(3) NOT NULL DEFAULT 'su' CONSTRAINT program_kpis_direction_check CHECK (direction IN (${quoted(PROGRAM_KPI_DIRECTIONS)})),
  key_result_id uuid REFERENCES strategic_goals(id) ON DELETE SET NULL,
  position smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT program_kpis_pkey PRIMARY KEY (id),
  CONSTRAINT program_kpis_formula_check CHECK ((source = 'formula') = (formula IS NOT NULL))
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS program_kpis_key_unique ON program_kpis (workspace_id, key);`,
  `CREATE TABLE IF NOT EXISTS program_kpi_values (
  kpi_id uuid NOT NULL REFERENCES program_kpis(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period varchar(7) NOT NULL CONSTRAINT program_kpi_values_period_check CHECK (period ~ '${MONTH_RE}'),
  value double precision NOT NULL,
  source varchar(7) NOT NULL DEFAULT 'manuale' CONSTRAINT program_kpi_values_source_check CHECK (source IN (${quoted(PROGRAM_KPI_VALUE_SOURCES)})),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT program_kpi_values_pkey PRIMARY KEY (kpi_id, period)
);`,
  `CREATE INDEX IF NOT EXISTS program_kpi_values_workspace_idx ON program_kpi_values (workspace_id);`,
  `CREATE TABLE IF NOT EXISTS strategic_goal_checkins (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES strategic_goals(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind varchar(13) NOT NULL CONSTRAINT strategic_goal_checkins_kind_check CHECK (kind IN (${quoted(GOAL_CHECKIN_KINDS)})),
  value double precision NOT NULL,
  recorded_on date NOT NULL,
  note varchar(${L.checkinNote}),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT strategic_goal_checkins_pkey PRIMARY KEY (id)
);`,
  `CREATE INDEX IF NOT EXISTS strategic_goal_checkins_goal_idx ON strategic_goal_checkins (goal_id, recorded_on);`,
  `CREATE INDEX IF NOT EXISTS strategic_goal_checkins_workspace_idx ON strategic_goal_checkins (workspace_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS strategic_goal_checkins_base_unique ON strategic_goal_checkins (goal_id) WHERE kind = 'base';`,
  // I tipi della campanella: lo stesso blocco della 0025, sotto il suo advisory lock (file e self-heal della
  // 0025, della 0028 e della 0029 uno alla volta sullo stesso vincolo; l'ordine è sempre 0029 poi 0025).
  `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`,
  notificationKindsWideningDdl(USE_CASE_NOTIFICATION_KINDS_0029),
];

// ─── Pulizia (RUNBOOK §10.16) ────────────────────────────────────────

/**
 * Dopo un ritorno indietro al rilascio 6 (RUNBOOK §10.16): il codice di prima non conosce «Da rivedere» e
 * la scriverebbe senza testo nella campanella. Idempotente; sul codice nuovo non serve.
 */
export const PROGRAM_ROLLBACK_SWEEP_SQL: readonly string[] = Object.freeze([`DELETE FROM use_case_notifications WHERE kind = 'da_rivedere';`]);

// ─── Sonda ───────────────────────────────────────────────────────────

/** Le tabelle della 0029. */
export const PROGRAM_TABLES = ["program_settings", "program_case_costs", "program_snapshots", "program_kpis", "program_kpi_values", "strategic_goal_checkins"] as const;

/** Gli indici della 0029, per nome (oltre alle chiavi primarie). */
export const PROGRAM_INDEXES = [
  "program_case_costs_workspace_idx",
  "program_snapshots_period_unique",
  "program_kpis_key_unique",
  "program_kpi_values_workspace_idx",
  "strategic_goal_checkins_goal_idx",
  "strategic_goal_checkins_workspace_idx",
  "strategic_goal_checkins_base_unique",
] as const;

/** I vincoli con nome delle tabelle nuove (`CONSTRAINT <nome>`), per la sonda. */
export const PROGRAM_NAMED_CONSTRAINTS = [
  "program_settings_employees_check",
  "program_settings_employees_source_check",
  "program_settings_revenue_check",
  "program_settings_revenue_source_check",
  "program_settings_support_check",
  "program_settings_support_from_check",
  "program_settings_support_to_check",
  "program_settings_dev_pct_check",
  "program_settings_index_weights_check",
  "program_settings_asks_check",
  "program_settings_pkey",
  "program_settings_sources_check",
  "program_settings_support_range_check",
  "program_case_costs_mode_check",
  "program_case_costs_amount_check",
  "program_case_costs_pkey",
  "program_case_costs_shape_check",
  "program_snapshots_kind_check",
  "program_snapshots_metrics_check",
  "program_snapshots_pkey",
  "program_snapshots_period_check",
  "program_kpis_key_check",
  "program_kpis_label_check",
  "program_kpis_kind_check",
  "program_kpis_source_check",
  "program_kpis_direction_check",
  "program_kpis_pkey",
  "program_kpis_formula_check",
  "program_kpi_values_period_check",
  "program_kpi_values_source_check",
  "program_kpi_values_pkey",
  "strategic_goal_checkins_kind_check",
  "strategic_goal_checkins_pkey",
] as const;

/**
 * Espressione booleana per la sonda di `ensureDbSchema()`, di `programStoreReady` e del doctor: vera solo se
 * tutto il DDL della 0029 è presente (le sei tabelle, i loro indici e vincoli con nome, `da_rivedere` nei
 * tipi della campanella).
 */
export const PROGRAM_PROBE_SQL = `(
  ${PROGRAM_TABLES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND ${PROGRAM_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN (${PROGRAM_TABLES.map((name) => `to_regclass('public.${name}')`).join(", ")})
      AND conname IN (${quoted(PROGRAM_NAMED_CONSTRAINTS)})
  ) = ${PROGRAM_NAMED_CONSTRAINTS.length}
  AND EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.use_case_notifications') AND c.conname = '${NOTIFICATION_KINDS_CHECK_NAME}'
      AND position('''da_rivedere''' IN pg_get_constraintdef(c.oid)) > 0
  )
)`;
