/**
 * Area «Use case», «Cosa serve» nella Storia: DDL del self-heal della 0023.
 *
 * È lo stesso statement di `drizzle/0023_use_case_needs_history.sql`: allarga il CHECK
 * `use_case_events_fields_check` della 0020 (l'elenco chiuso dei nomi dei campi della Storia)
 * con `cosa_serve`, così le scritture delle esigenze (`needs-service.ts`) lasciano una riga nella
 * Storia di ogni use case collegato. Nessun testo entra nella Storia: il CHECK resta un elenco
 * chiuso di nomi.
 *
 * Un solo blocco `DO`, idempotente e sicuro su un database con righe:
 * 0. `lock_timeout` di {@link HISTORY_LOCK_TIMEOUT} per il resto della transazione
 *    (`set_config(…, true)`, come `SET LOCAL`), poi l'advisory lock {@link HISTORY_ADVISORY_LOCK},
 *    lo stesso del self-heal: file e self-heal non sostituiscono il CHECK insieme. `DROP` e
 *    `ADD CONSTRAINT` prendono un ACCESS EXCLUSIVE su `use_case_events` fino alla fine della
 *    transazione, `VALIDATE` compreso: dietro una transazione lunga metterebbero in coda ogni
 *    lettura e scrittura della Storia, anche il trigger «creato» di un nuovo use case. Con il
 *    timeout ci si ferma («canceling statement due to lock timeout») senza cambiare nulla: il
 *    file si rilancia, il self-heal riprova al prossimo avvio (`ensureDbSchema` rilascia la
 *    promessa fallita);
 * 1. senza `use_case_events` (manca la 0020) si ferma con il suo messaggio;
 * 2. se il vincolo ammette già ogni nome dell'elenco non lo tocca (una seconda volta, o dopo una
 *    migrazione che lo allarga ancora): non si restringe mai;
 * 3. altrimenti lo sostituisce (`DROP CONSTRAINT IF EXISTS`, `ADD CONSTRAINT … NOT VALID`) con
 *    l'elenco più i nomi che il vincolo di prima ammetteva già, nello stesso ordine;
 * 4. poi `VALIDATE CONSTRAINT`, solo se nessuna riga esce dall'elenco: con una riga fuori elenco
 *    (possibile solo se qualcuno ha tolto il vincolo a mano) non si ferma, il vincolo resta
 *    NOT VALID e vale per ogni riga nuova o modificata, con un WARNING. `NOT VALID` serve a
 *    questo, non ad accorciare il lock: nella stessa transazione l'ACCESS EXCLUSIVE resta.
 * Le righe della Storia restano tutte com'erano. `ensureDbSchema()` lo applica in una sola
 * transazione, dopo il DDL della 0020 e della 0022, sui database che non hanno ricevuto la
 * migrazione; `src/lib/db/use-case-hub-history-ddl.test.ts` controlla che la migrazione lo
 * contenga e che la sonda guardi lo stesso elenco.
 *
 * Gli elenchi sono la fonte del testo SQL. Modulo puro: importa solo `./use-case-hub-ddl.ts`;
 * lo caricano anche gli script di verifica.
 */
import { USE_CASE_EVENT_FIELDS, USE_CASE_NEEDS_EVENT_FIELD } from "./use-case-hub-ddl.ts";

/** I nomi dei campi della Storia dopo la 0023: quelli della 0020 e `cosa_serve`. */
export const USE_CASE_EVENT_FIELDS_0023 = [...USE_CASE_EVENT_FIELDS, USE_CASE_NEEDS_EVENT_FIELD] as const;

/** Il vincolo che la 0023 allarga (nato con la 0020). */
export const FIELDS_CHECK_NAME = "use_case_events_fields_check";

/** Errore della 0023 su un database senza la 0020: la Storia non c'è. */
export const MISSING_EVENTS_MESSAGE = "use_case_events: manca la 0020. Applica prima drizzle/0020_use_case_hub.sql.";

/** Quanto aspetta ogni lock della 0023 (file e self-heal) prima di fermarsi senza cambiare nulla. */
export const HISTORY_LOCK_TIMEOUT = "3s";

/** La chiave dell'advisory lock della 0023: la stessa nel file e in `runUseCaseHistoryDdl`. */
export const HISTORY_ADVISORY_LOCK = "unbundle:use-case-history-ddl";

/** WARNING della 0023 quando una riga esce dall'elenco: il vincolo resta NOT VALID. */
export const FIELDS_NOT_VALIDATED_WARNING =
  "use_case_events: righe con campi fuori elenco, use_case_events_fields_check resta NOT VALID (vale per le righe nuove).";

/** `ARRAY['a', 'b']`: valori noti, scritti qui sopra (nessun apice dentro). */
const array = (values: readonly string[]) => `ARRAY[${values.map((value) => `'${value}'`).join(", ")}]::text[]`;

/**
 * Il blocco `DO` che allarga il CHECK della Storia all'elenco `wanted` (mai restringe): lo stesso
 * della 0023, con l'elenco come parametro. La 0024 lo riusa con `richiesta_referente`
 * (`use-case-hub-referents-ddl.ts`); per l'elenco della 0023 il testo è identico a quello del file.
 */
export function eventFieldsWideningDdl(wanted: readonly string[]): string {
  return `DO $$
DECLARE
  wanted text[] := ${array(wanted)};
  current_def text;
  current_valid boolean;
  allowed text[];
BEGIN
  -- Mai in coda dietro una transazione lunga: ogni lock aspetta al massimo 3s, poi ci si ferma.
  PERFORM set_config('lock_timeout', '${HISTORY_LOCK_TIMEOUT}', true);
  -- Lo stesso advisory lock del self-heal: file e self-heal uno alla volta.
  PERFORM pg_advisory_xact_lock(hashtext('${HISTORY_ADVISORY_LOCK}'));
  IF to_regclass('public.use_case_events') IS NULL THEN
    RAISE EXCEPTION '${MISSING_EVENTS_MESSAGE}';
  END IF;
  SELECT pg_get_constraintdef(c.oid), c.convalidated INTO current_def, current_valid
    FROM pg_constraint c
   WHERE c.conrelid = 'public.use_case_events'::regclass AND c.conname = '${FIELDS_CHECK_NAME}';
  -- Mai restringere: ai nomi voluti seguono quelli che il vincolo di adesso ammette già.
  allowed := wanted || coalesce((
    SELECT array_agg(found.name ORDER BY found.first_at)
      FROM (SELECT r.m[1] AS name, min(r.n) AS first_at
              FROM regexp_matches(coalesce(current_def, ''), '''([a-z0-9_]+)''::text', 'g') WITH ORDINALITY AS r(m, n)
             GROUP BY r.m[1]) AS found
     WHERE found.name <> ALL (wanted)
  ), '{}'::text[]);
  IF current_def IS NULL
     OR EXISTS (SELECT 1 FROM unnest(wanted) AS w(name) WHERE position(quote_literal(w.name) || '::text' IN current_def) = 0) THEN
    ALTER TABLE use_case_events DROP CONSTRAINT IF EXISTS ${FIELDS_CHECK_NAME};
    EXECUTE 'ALTER TABLE use_case_events ADD CONSTRAINT ${FIELDS_CHECK_NAME} CHECK (fields <@ ARRAY['
      || (SELECT string_agg(quote_literal(a.name), ', ' ORDER BY a.n) FROM unnest(allowed) WITH ORDINALITY AS a(name, n))
      || ']::text[]) NOT VALID';
    current_valid := false;
  END IF;
  IF NOT current_valid THEN
    IF EXISTS (SELECT 1 FROM use_case_events e WHERE NOT (e.fields <@ allowed)) THEN
      RAISE WARNING '${FIELDS_NOT_VALIDATED_WARNING}';
    ELSE
      ALTER TABLE use_case_events VALIDATE CONSTRAINT ${FIELDS_CHECK_NAME};
    END IF;
  END IF;
END $$;`;
}

export const USE_CASE_HISTORY_DDL: readonly string[] = [eventFieldsWideningDdl(USE_CASE_EVENT_FIELDS_0023)];

/**
 * Espressione booleana per la sonda di `ensureDbSchema()`: vera solo se il CHECK della Storia
 * ammette ogni nome della 0023, con la stessa regola del blocco `DO` (il nome tra apici, seguito
 * da `::text`, nella definizione di `pg_get_constraintdef`). Senza, un database con la 0022 e
 * senza la 0023 sembrerebbe aggiornato e la prima riga «Cosa serve» fallirebbe sul CHECK.
 * Non guarda `convalidated`: un vincolo lasciato NOT VALID dal punto 4 vale già per le righe
 * nuove, e il self-heal non ripartirebbe a ogni avvio. L'elenco è un parametro: la 0024 usa la
 * stessa sonda con `richiesta_referente` (`use-case-hub-referents-ddl.ts`).
 */
export function eventFieldsProbeSql(wanted: readonly string[]): string {
  return `(
  EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.use_case_events')
      AND c.conname = '${FIELDS_CHECK_NAME}'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(${array(wanted)}) AS w(name)
        WHERE position(quote_literal(w.name) || '::text' IN pg_get_constraintdef(c.oid)) = 0
      )
  )
)`;
}

export const USE_CASE_HISTORY_PROBE_SQL = eventFieldsProbeSql(USE_CASE_EVENT_FIELDS_0023);
