/**
 * Area «Use case», «Pronto da avviare» e «Autorizza i fornitori»: DDL del self-heal della 0025.
 *
 * Sono gli stessi statement di `drizzle/0025_use_case_alerts.sql`, nello stesso ordine, dopo le due
 * righe di apertura del file (`lock_timeout` e l'advisory lock {@link ALERTS_ADVISORY_LOCK}, che il
 * self-heal prende da sé in `runUseCaseAlertsDdl`):
 * 1. controllo che la 0024 ci sia (la campanella degli use case e «Informazioni complete»);
 * 2. `pronto` e `fornitori` nell'elenco chiuso dei tipi di `use_case_notifications`: un blocco `DO`
 *    come quello della Storia (`eventFieldsWideningDdl`), che non restringe mai l'elenco;
 * 3. `use_case_ready_state`: da quando uno use case è pronto da avviare e per quale trimestre, così
 *    la campanella parla una volta per passaggio;
 * 4. la coda delle email dei due avvisi (`use_case_alert_emails`, al massimo una al giorno per
 *    persona e tipo) e le voci di «Pronto da avviare» (`use_case_alert_email_items`);
 * 5. per ultimo il seme: gli use case già pronti al momento della migrazione si segnano subito, così
 *    nessuno riceve notizie vecchie (come il seme di `use_case_info_state` della 0024).
 *
 * Tutti idempotenti e solo additivi; l'unica scrittura di dati è il seme (`ON CONFLICT DO NOTHING`).
 * Il codice di prima ignora le tabelle nuove e il CHECK più largo. I moduli che scrivono queste righe
 * controllano prima che le tabelle ci siano (`CASE_ALERTS_TABLES_PRESENT_SQL`): senza la 0025 una
 * riga `pronto` violerebbe il CHECK di prima e annullerebbe la scrittura della persona.
 *
 * `src/lib/db/use-case-hub-alerts-ddl.test.ts` controlla che la migrazione li contenga tutti, nello
 * stesso ordine, che i CHECK siano gli elenchi qui sotto e che la sonda copra ogni oggetto. Modulo
 * puro: importa solo `./use-case-hub-referents-ddl.ts`; lo caricano anche gli script di verifica.
 */
import { CLIENT_SIDE_SQL, INFO_DONE_STATUSES, REQUESTER_EMAIL_STATUSES, USE_CASE_NOTIFICATION_KINDS } from "./use-case-hub-referents-ddl.ts";

// ─── Vocabolario ─────────────────────────────────────────────────────

/** I due avvisi della 0025: «Pronto da avviare» (a Lateral Space) e «Autorizza i fornitori» (al cliente). */
export const CASE_ALERT_KINDS = ["pronto", "fornitori"] as const;
export type CaseAlertKind = (typeof CASE_ALERT_KINDS)[number];

/** I tipi di `use_case_notifications` dopo la 0025 (quelli della 0024 restano com'erano, per il suo test). */
export const USE_CASE_NOTIFICATION_KINDS_0025 = [...USE_CASE_NOTIFICATION_KINDS, ...CASE_ALERT_KINDS] as const;
export type UseCaseNoticeKind = (typeof USE_CASE_NOTIFICATION_KINDS_0025)[number];

/** Gli stati di una riga della coda: quelli degli avvisi a chi ha chiesto. */
export const CASE_ALERT_EMAIL_STATUSES = REQUESTER_EMAIL_STATUSES;
export type CaseAlertEmailStatus = (typeof CASE_ALERT_EMAIL_STATUSES)[number];

/** Il vincolo che la 0025 allarga (nato con la 0024). */
export const NOTIFICATION_KINDS_CHECK_NAME = "use_case_notifications_kind_check";

/** La chiave dell'advisory lock della 0025: la stessa nel file e in `runUseCaseAlertsDdl`. */
export const ALERTS_ADVISORY_LOCK = "unbundle:use-case-alerts-ddl";

/** Quanto aspetta ogni lock della 0025 prima di fermarsi senza cambiare nulla. */
export const ALERTS_LOCK_TIMEOUT = "3s";

/** Errore della 0025 su un database senza la 0024. */
export const MISSING_REFERENTS_MESSAGE = "use_case_alerts: manca la 0024. Applica prima drizzle/0024_use_case_referents.sql.";

/** WARNING della 0025 quando una riga esce dall'elenco: il vincolo resta NOT VALID. */
export const KINDS_NOT_VALIDATED_WARNING =
  "use_case_notifications: righe con tipi fuori elenco, use_case_notifications_kind_check resta NOT VALID (vale per le righe nuove).";

// ─── «Pronto da avviare» in SQL ──────────────────────────────────────

/** Il trimestre di adesso a Roma, `AAAA-Qn`, dall'orologio del database. */
export const ROME_QUARTER_NOW_SQL = `(to_char(now() AT TIME ZONE 'Europe/Rome', 'YYYY') || '-Q' || to_char(now() AT TIME ZONE 'Europe/Rome', 'Q'))`;

const ALIAS = /^[a-z][a-z0-9_]{0,20}$/;
/** Un'espressione SQL di trimestre: quella di adesso o un letterale `'AAAA-Qn'`. */
const QUARTER_SQL = /^'[0-9]{4}-Q[1-4]'$/;

/**
 * Lo use case `alias` è pronto da avviare (la regola di `isReadyToStart`, `readiness.ts`): approvato
 * (non archiviato, nessun dossier completo collegato), «Da costruire», un trimestre da `fromQuarter`
 * in poi (e fino a `toQuarter`, se dato), nessuna informazione del cliente ancora aperta. Con
 * `dossiers` falso (tabelle dei dossier assenti) il controllo del dossier non c'è.
 */
export function readyCardPredicate(alias: string, o: { fromQuarter: string; toQuarter?: string | null; dossiers: boolean }): string {
  if (!ALIAS.test(alias)) throw new Error("Alias non valido");
  for (const q of [o.fromQuarter, o.toQuarter ?? null]) {
    if (q !== null && q !== ROME_QUARTER_NOW_SQL && !QUARTER_SQL.test(q)) throw new Error("Trimestre non valido");
  }
  const a = alias;
  const upTo = o.toQuarter ? `\n  AND ${a}.target_quarter <= ${o.toQuarter}` : "";
  const dossier = o.dossiers
    ? `\n  AND NOT EXISTS (SELECT 1 FROM uc_cases rc WHERE rc.portfolio_use_case_id = ${a}.id AND rc.workspace_id = ${a}.workspace_id AND rc.setup_completed_at IS NOT NULL)`
    : "";
  const done = INFO_DONE_STATUSES.map((s) => `'${s}'`).join(", ");
  return `(${a}.status = 'accepted'
  AND ${a}.portfolio_review_status IS DISTINCT FROM 'archived'
  AND ${a}.portfolio_kind IS DISTINCT FROM 'best_practice'
  AND ${a}.target_quarter IS NOT NULL AND ${a}.target_quarter >= ${o.fromQuarter}${upTo}${dossier}
  AND NOT EXISTS (SELECT 1 FROM use_case_needs rn JOIN use_case_need_links rl ON rl.need_id = rn.id
                  WHERE rl.use_case_id = ${a}.id AND rn.workspace_id = ${a}.workspace_id AND rn.type = 'requisito'
                    AND rn.archived_at IS NULL AND ${CLIENT_SIDE_SQL("rn")} AND rn.status NOT IN (${done})))`;
}

// ─── Composizione del testo SQL ──────────────────────────────────────

/** `'a', 'b'`: valori noti, scritti qui sopra (nessun apice dentro). */
const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
/** `ARRAY['a', 'b']::text[]`. */
const array = (values: readonly string[]) => `ARRAY[${quoted(values)}]::text[]`;

/**
 * Il blocco `DO` che allarga il CHECK dei tipi di `use_case_notifications` all'elenco `wanted` (mai
 * restringe): la stessa regola di `eventFieldsWideningDdl`. Con `lock_timeout` di 3s, poi i nomi che
 * il vincolo ammette già (`'nome'::character varying` in `pg_get_constraintdef`) dopo quelli voluti;
 * `DROP`/`ADD … NOT VALID` solo se manca un nome, poi `VALIDATE` se nessuna riga esce dall'elenco.
 */
export function notificationKindsWideningDdl(wanted: readonly string[]): string {
  return `DO $$
DECLARE
  wanted text[] := ${array(wanted)};
  current_def text;
  current_valid boolean;
  allowed text[];
BEGIN
  -- Mai in coda dietro una transazione lunga: ogni lock aspetta al massimo 3s, poi ci si ferma.
  PERFORM set_config('lock_timeout', '${ALERTS_LOCK_TIMEOUT}', true);
  SELECT pg_get_constraintdef(c.oid), c.convalidated INTO current_def, current_valid
    FROM pg_constraint c
   WHERE c.conrelid = 'public.use_case_notifications'::regclass AND c.conname = '${NOTIFICATION_KINDS_CHECK_NAME}';
  -- Mai restringere: ai tipi voluti seguono quelli che il vincolo di adesso ammette già.
  allowed := wanted || coalesce((
    SELECT array_agg(found.name ORDER BY found.first_at)
      FROM (SELECT r.m[1] AS name, min(r.n) AS first_at
              FROM regexp_matches(coalesce(current_def, ''), '''([a-z0-9_]+)''::', 'g') WITH ORDINALITY AS r(m, n)
             GROUP BY r.m[1]) AS found
     WHERE found.name <> ALL (wanted)
  ), '{}'::text[]);
  IF current_def IS NULL
     OR EXISTS (SELECT 1 FROM unnest(wanted) AS w(name) WHERE position(quote_literal(w.name) || '::' IN current_def) = 0) THEN
    ALTER TABLE use_case_notifications DROP CONSTRAINT IF EXISTS ${NOTIFICATION_KINDS_CHECK_NAME};
    EXECUTE 'ALTER TABLE use_case_notifications ADD CONSTRAINT ${NOTIFICATION_KINDS_CHECK_NAME} CHECK (kind IN ('
      || (SELECT string_agg(quote_literal(a.name), ', ' ORDER BY a.n) FROM unnest(allowed) WITH ORDINALITY AS a(name, n))
      || ')) NOT VALID';
    current_valid := false;
  END IF;
  IF NOT current_valid THEN
    IF EXISTS (SELECT 1 FROM use_case_notifications n WHERE NOT (n.kind = ANY (allowed))) THEN
      RAISE WARNING '${KINDS_NOT_VALIDATED_WARNING}';
    ELSE
      ALTER TABLE use_case_notifications VALIDATE CONSTRAINT ${NOTIFICATION_KINDS_CHECK_NAME};
    END IF;
  END IF;
END $$;`;
}

/** Il seme: con le tabelle dei dossier il controllo del dossier, senza no (lo decide il database). */
function seedDdl(): string {
  const insert = (dossiers: boolean) => `INSERT INTO use_case_ready_state (use_case_id, workspace_id, ready_since, ready_quarter)
      SELECT u.id, u.workspace_id, now(), u.target_quarter
      FROM use_cases u
      WHERE ${readyCardPredicate("u", { fromQuarter: ROME_QUARTER_NOW_SQL, dossiers }).replace(/\n/g, "\n      ")}
      ON CONFLICT (use_case_id) DO NOTHING`;
  return `DO $$ BEGIN
  IF to_regclass('public.uc_cases') IS NOT NULL THEN
    EXECUTE $seed$${insert(true)}$seed$;
  ELSE
    EXECUTE $seed$${insert(false)}$seed$;
  END IF;
END $$;`;
}

/** Gli statement della 0025 dopo le due righe di apertura, nell'ordine del file. */
export const USE_CASE_ALERTS_DDL: readonly string[] = [
  `DO $$ BEGIN
  IF to_regclass('public.use_case_notifications') IS NULL OR to_regclass('public.use_case_info_state') IS NULL THEN
    RAISE EXCEPTION '${MISSING_REFERENTS_MESSAGE}';
  END IF;
END $$;`,
  notificationKindsWideningDdl(USE_CASE_NOTIFICATION_KINDS_0025),
  `CREATE TABLE IF NOT EXISTS use_case_ready_state (
  use_case_id uuid PRIMARY KEY REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ready_since timestamptz,
  ready_quarter varchar(7)
    CONSTRAINT use_case_ready_state_quarter_check CHECK (ready_quarter IS NULL OR ready_quarter ~ '^[0-9]{4}-Q[1-4]$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_ready_state_pair_check CHECK ((ready_since IS NULL) = (ready_quarter IS NULL))
);`,
  `CREATE INDEX IF NOT EXISTS use_case_ready_state_workspace_idx
  ON use_case_ready_state (workspace_id) WHERE ready_since IS NOT NULL;`,
  `CREATE TABLE IF NOT EXISTS use_case_alert_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(10) NOT NULL
    CONSTRAINT use_case_alert_emails_kind_check CHECK (kind IN (${quoted(CASE_ALERT_KINDS)})),
  send_on date NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'in_coda'
    CONSTRAINT use_case_alert_emails_status_check CHECK (status IN (${quoted(CASE_ALERT_EMAIL_STATUSES)})),
  hold_reason varchar(40),
  cancel_reason varchar(40),
  last_error_code varchar(60),
  attempts smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_alert_emails_attempts_check CHECK (attempts BETWEEN 0 AND 3),
  scheduled_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  lease_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_alert_emails_day_unique UNIQUE (workspace_id, recipient_user_id, kind, send_on),
  CONSTRAINT use_case_alert_emails_sent_check CHECK ((status = 'inviata') = (sent_at IS NOT NULL))
);`,
  `CREATE INDEX IF NOT EXISTS use_case_alert_emails_due_idx
  ON use_case_alert_emails (scheduled_at) WHERE status IN ('in_coda', 'errore');`,
  `CREATE INDEX IF NOT EXISTS use_case_alert_emails_workspace_idx
  ON use_case_alert_emails (workspace_id, kind, created_at);`,
  `CREATE INDEX IF NOT EXISTS use_case_alert_emails_gc_idx
  ON use_case_alert_emails (created_at);`,
  `CREATE TABLE IF NOT EXISTS use_case_alert_email_items (
  email_id uuid NOT NULL REFERENCES use_case_alert_emails(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ready_since timestamptz NOT NULL,
  CONSTRAINT use_case_alert_email_items_pkey PRIMARY KEY (email_id, use_case_id)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_alert_email_items_use_case_idx
  ON use_case_alert_email_items (use_case_id);`,
  // Gli use case già pronti al momento della migrazione: nessun «Pronto da avviare» per dati vecchi.
  seedDdl(),
];

// ─── Sonda ───────────────────────────────────────────────────────────

/** Le tabelle della 0025. */
export const ALERTS_TABLES = ["use_case_ready_state", "use_case_alert_emails", "use_case_alert_email_items"] as const;

/** Gli indici della 0025, per nome. */
export const ALERTS_INDEXES = [
  "use_case_ready_state_workspace_idx",
  "use_case_alert_emails_due_idx",
  "use_case_alert_emails_workspace_idx",
  "use_case_alert_emails_gc_idx",
  "use_case_alert_email_items_use_case_idx",
] as const;

/** I vincoli con nome della 0025 (`CONSTRAINT <nome>`), per la sonda. */
export const ALERTS_NAMED_CONSTRAINTS = [
  "use_case_ready_state_quarter_check",
  "use_case_ready_state_pair_check",
  "use_case_alert_emails_kind_check",
  "use_case_alert_emails_status_check",
  "use_case_alert_emails_attempts_check",
  "use_case_alert_emails_day_unique",
  "use_case_alert_emails_sent_check",
  "use_case_alert_email_items_pkey",
] as const;

/**
 * Le tabelle della 0025 ci sono e il CHECK dei tipi ammette i due avvisi: chi scrive le righe nuove
 * lo controlla prima (una volta per processo). Colonna `ok`.
 */
export const CASE_ALERTS_TABLES_PRESENT_SQL = `SELECT (${ALERTS_TABLES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join(" AND ")}
  AND EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.use_case_notifications') AND c.conname = '${NOTIFICATION_KINDS_CHECK_NAME}'
      AND position('''pronto''' IN pg_get_constraintdef(c.oid)) > 0 AND position('''fornitori''' IN pg_get_constraintdef(c.oid)) > 0
  )) AS ok`;

/**
 * Espressione booleana per la sonda di `ensureDbSchema()`: vera solo se tutto il DDL della 0025 è
 * presente (tabelle, indici, vincoli con nome, e il CHECK dei tipi con `pronto` e `fornitori`).
 */
export const USE_CASE_ALERTS_PROBE_SQL = `(
  ${ALERTS_TABLES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND ${ALERTS_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN (${ALERTS_TABLES.map((name) => `to_regclass('public.${name}')`).join(", ")})
      AND conname IN (${quoted(ALERTS_NAMED_CONSTRAINTS)})
  ) = ${ALERTS_NAMED_CONSTRAINTS.length}
  AND EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.use_case_notifications')
      AND c.conname = '${NOTIFICATION_KINDS_CHECK_NAME}'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(${array(USE_CASE_NOTIFICATION_KINDS_0025)}) AS w(name)
        WHERE position(quote_literal(w.name) || '::' IN pg_get_constraintdef(c.oid)) = 0
      )
  )
)`;
