/**
 * «Pronto da avviare» e «Autorizza i fornitori» (drizzle/0025): i costruttori SQL puri condivisi
 * dalla campanella (`queries/use-case-notifications.ts`), dalle scritture che li mettono nello
 * stesso batch dell'evento (`needs-service.ts`, `service.ts`, i moduli di «Chiedi al referente») e
 * dal cron. Restituiscono frammenti o `{ text, params }`.
 *
 * - `readyNowSql`: lo use case è pronto da avviare adesso, la regola di `isReadyToStart`
 *   (`../readiness.ts`) in SQL; la prova di parità sul database le confronta.
 * - `cardSyncStatements`: al posto di `infoCompleteSyncStatements` in fondo a ogni scrittura che può
 *   cambiare la regola: [il lock per scheda di «Informazioni complete», il passaggio a «pronto»,
 *   «Informazioni complete»]. Il passaggio si riconosce confrontando lo stato salvato
 *   (`use_case_ready_state`) con la regola dentro la transazione, sotto lo stesso lock per scheda:
 *   due scritture insieme avvisano una volta, uno use case che resta pronto non avvisa più.
 * - `lsReviewerRecipientsSql`: i revisori di Lateral Space del workspace (ruolo da revisore, email
 *   verificata di un dominio di `UC_LS_EMAIL_DOMAINS`), mai chi ha agito.
 *
 * Art. 15.4: nessun ORDER BY, GROUP BY o conteggio per persona (i conteggi sono di schede).
 *
 * Modulo puro: import relativi `.ts`.
 */
import { ROME_QUARTER_NOW_SQL, readyCardPredicate } from "../../db/use-case-hub-alerts-ddl.ts";
import { SUBPROCESSORS_VERSION } from "../../uc/legal/subprocessors.ts";
import { cast, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import { PORTFOLIO_REVIEWER_ROLES } from "../../workspace-permissions.ts";
import { currentQuarter, nextQuarter } from "../quarter.ts";
import { READINESS_LATER_RULE } from "../readiness.ts";
import type { AlertSchedule } from "../referent/alerts.ts";
import { infoCompleteSyncStatements, uuidOf } from "../referent/sql.ts";

const ALIAS = /^[a-z][a-z0-9_]{0,20}$/;
const DOMAIN = /^[a-z0-9.-]{1,253}$/;

const id = (value: string, what: string) => cast(uuidOf(value, what), "uuid");

/** L'istante dell'evento: `now()` del database, oppure (solo nei test) l'istante dato. */
function clockOf(clock: Date | undefined): SqlFragment {
  return ucSql`coalesce(${cast(clock ? clock.toISOString() : null, "timestamptz")}, now())`;
}

/** Il trimestre di adesso a Roma come espressione SQL: dall'orologio del database, o da `clock`. */
function quarterNowSql(clock: Date | undefined): string {
  return clock ? `'${currentQuarter(clock)}'` : ROME_QUARTER_NOW_SQL;
}

/**
 * Lo use case `alias` è pronto da avviare: approvato, «Da costruire», un trimestre da quello di
 * adesso (a Roma, dall'orologio del database o, solo nei test, da `clock`), nessun dossier completo
 * collegato (con `dossiers`, cioè con le tabelle dei dossier), ogni informazione del cliente a posto.
 */
export function readyNowSql(alias: string, o: { clock?: Date; dossiers: boolean }): SqlFragment {
  if (!ALIAS.test(alias)) throw new Error("Alias non valido");
  const lanes = READINESS_LATER_RULE === "oltre_il_prossimo";
  const from = lanes ? `'${currentQuarter(o.clock ?? new Date())}'` : quarterNowSql(o.clock);
  const to = lanes ? `'${nextQuarter(currentQuarter(o.clock ?? new Date()))}'` : null;
  return raw(readyCardPredicate(alias, { fromQuarter: from, toQuarter: to, dossiers: o.dossiers }));
}

/** C'è l'«ok sui sub-responsabili» del workspace `workspace` (un'espressione) per l'elenco di adesso. */
export function subprocessorsAckSql(workspace: SqlFragment): SqlFragment {
  return ucSql`EXISTS (SELECT 1 FROM uc_subprocessor_acks ak WHERE ak.workspace_id = ${workspace} AND ak.list_version = ${raw(`'${SUBPROCESSORS_VERSION.replace(/[^0-9a-z-]/gi, "")}'`)})`;
}

/** I domini di Lateral Space come parametro `text[]`, solo nomi di dominio in minuscolo. */
function domainsParam(lsDomains: readonly string[]): SqlFragment {
  return cast(
    lsDomains.map((d) => d.trim().toLowerCase()).filter((d) => DOMAIN.test(d)),
    "text[]",
  );
}

/** Il dominio dell'email di `ru` è uno di quelli di Lateral Space (falso senza domini). */
function lsDomainSql(lsDomains: readonly string[]): SqlFragment {
  return ucSql`coalesce(lower(substring(btrim(ru.email) from '@([^@]+)$')) = ANY(${domainsParam(lsDomains)}), false)`;
}

/** Il ruolo di `ru` nel workspace `rw`: prima quello nell'organizzazione, poi quello nel workspace. */
const ROLE_SQL = raw(`coalesce(
    (SELECT rm2.role::text FROM memberships rm2 WHERE rm2.user_id = ru.id AND rm2.organization_id = rw.organization_id LIMIT 1),
    (SELECT rwm2.role::text FROM workspace_memberships rwm2 WHERE rwm2.user_id = ru.id AND rwm2.workspace_id = rw.id LIMIT 1)
  )`);

/**
 * I revisori di Lateral Space del workspace (ruolo da revisore, prima nell'organizzazione poi nel
 * workspace; email verificata di un dominio di Lateral Space), tranne chi ha agito: le stesse persone
 * di `reviewerRecipientsSql` con in più il controllo dell'email. Mai un revisore del cliente, un
 * contributore o un'email di Lateral Space non verificata. Alias propri, per un `CROSS JOIN LATERAL`.
 * Nessun ORDER BY, nessun conteggio; 200 al massimo.
 */
export function lsReviewerRecipientsSql(workspace: SqlFragment, exceptUserId: string | null, lsDomains: readonly string[]): SqlFragment {
  return ucSql`SELECT ru.id AS user_id
FROM workspaces rw
JOIN users ru ON ru.id IN (
  SELECT rm.user_id FROM memberships rm WHERE rm.organization_id = rw.organization_id
  UNION SELECT rwm.user_id FROM workspace_memberships rwm WHERE rwm.workspace_id = rw.id
)
WHERE rw.id = ${workspace} AND ru.id IS DISTINCT FROM ${cast(exceptUserId ? uuidOf(exceptUserId, "persona") : null, "uuid")}
  AND ${ROLE_SQL} = ANY(${cast([...PORTFOLIO_REVIEWER_ROLES], "text[]")})
  AND ru.email_verified IS NOT NULL AND ${lsDomainSql(lsDomains)}
LIMIT 200`;
}

/**
 * Le schede del controllo: gli use case dati e quelli collegati all'esigenza `needId`, del workspace.
 * (È la stessa regola di `infoCompleteSyncStatements`, così il lock per scheda copre le stesse schede.)
 */
function targetCards(i: { workspaceId: string; useCaseIds?: readonly string[]; needId?: string | null }): SqlFragment {
  const ids = (i.useCaseIds ?? []).map((x) => uuidOf(x, "use case"));
  return ucSql`u.workspace_id = ${id(i.workspaceId, "workspace")}
    AND (u.id = ANY(${cast(ids, "uuid[]")}) OR u.id IN (SELECT l.use_case_id FROM use_case_need_links l WHERE l.need_id = ${cast(i.needId ? uuidOf(i.needId, "esigenza") : null, "uuid")}))`;
}

/** Quello che serve al controllo di «Pronto da avviare»: lo legge chi scrive (`readinessSyncFor`). */
export interface ReadinessSync {
  /** `UC_LS_EMAIL_DOMAINS`: senza domini nessuno è Lateral Space e nessuno riceve l'avviso. */
  lsDomains: readonly string[];
  /** Le tabelle dei dossier ci sono: uno use case con un dossier completo non è pronto. */
  dossiers: boolean;
  /** Il giorno e l'ora dell'email (`alertSchedule(now)`). */
  schedule: AlertSchedule;
  now: Date;
  /** Solo nei test: l'istante dell'evento al posto di `now()` del database. */
  clock?: Date;
}

/**
 * Il passaggio a «pronto», in un solo statement, dopo il lock per scheda: la regola dentro la
 * transazione contro lo stato salvato. Lo stato vale solo se il suo trimestre non è passato: uno use
 * case scaduto che torna su un trimestre valido avvisa di nuovo. Lo stato si aggiorna per ogni scheda
 * (pronta da `ready_since`, o non pronta); per le schede che diventano pronte: una riga «pronto» per
 * ogni revisore di Lateral Space tranne chi ha agito (lo stesso giorno torna non letta), e la voce
 * nell'email di quella persona (quella di oggi se è ancora in coda, altrimenti quella del prossimo
 * giorno lavorativo alle 9). Restituisce `announced`, quante schede sono diventate pronte.
 */
export function readinessSyncSql(i: {
  workspaceId: string;
  useCaseIds?: readonly string[];
  needId?: string | null;
  actorUserId: string | null;
  readiness: ReadinessSync;
}): UcStatement {
  const r = i.readiness;
  const ts = clockOf(r.clock);
  const quarter = raw(quarterNowSql(r.clock));
  const now = cast(r.now.toISOString(), "timestamptz");
  const today = cast(r.schedule.today, "date");
  const inWindow = cast(r.schedule.inWindow, "boolean");
  return toStatement(ucSql`WITH target AS (
  SELECT u.id AS use_case_id, u.workspace_id, u.target_quarter, ${readyNowSql("u", { clock: r.clock, dossiers: r.dossiers })} AS ready
  FROM use_cases u
  WHERE ${targetCards(i)}
), prev AS (
  SELECT t.use_case_id, s.ready_since, s.use_case_id IS NOT NULL AS stored,
    (s.ready_since IS NOT NULL AND s.ready_quarter IS NOT NULL AND s.ready_quarter >= ${quarter}) AS valid
  FROM target t LEFT JOIN use_case_ready_state s ON s.use_case_id = t.use_case_id
), mark AS (
  INSERT INTO use_case_ready_state (use_case_id, workspace_id, ready_since, ready_quarter, updated_at)
  SELECT t.use_case_id, t.workspace_id,
    CASE WHEN t.ready THEN (CASE WHEN p.valid THEN p.ready_since ELSE ${ts} END) END,
    CASE WHEN t.ready THEN t.target_quarter END,
    ${ts}
  FROM target t JOIN prev p ON p.use_case_id = t.use_case_id
  WHERE t.ready OR p.stored
  ON CONFLICT (use_case_id) DO UPDATE SET
    ready_since = EXCLUDED.ready_since, ready_quarter = EXCLUDED.ready_quarter, updated_at = EXCLUDED.updated_at
  RETURNING use_case_id
), became AS (
  SELECT t.use_case_id, t.workspace_id FROM target t JOIN prev p ON p.use_case_id = t.use_case_id
  WHERE t.ready AND NOT p.valid
), who AS (
  SELECT b.workspace_id, b.use_case_id, rc.user_id
  FROM became b CROSS JOIN LATERAL (${lsReviewerRecipientsSql(raw("b.workspace_id"), i.actorUserId, r.lsDomains)}) rc
), bell AS (
  INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day, first_event_at, last_event_at)
  SELECT w.workspace_id, w.use_case_id, w.user_id, 'pronto', (${ts} AT TIME ZONE 'Europe/Rome')::date, ${ts}, ${ts}
  FROM who w
  ON CONFLICT (recipient_user_id, use_case_id, kind, rome_day) DO UPDATE SET
    last_event_at = greatest(use_case_notifications.last_event_at, EXCLUDED.last_event_at), read_at = NULL
  RETURNING 1
), people AS (
  SELECT DISTINCT w.workspace_id, w.user_id FROM who w
), slot AS (
  SELECT pe.workspace_id, pe.user_id,
    CASE WHEN ${inWindow} AND t.ok THEN ${today} ELSE ${cast(r.schedule.nextDay, "date")} END AS send_on,
    CASE WHEN ${inWindow} AND t.ok THEN ${now} ELSE ${cast(r.schedule.nextAt.toISOString(), "timestamptz")} END AS scheduled_at
  FROM people pe
  CROSS JOIN LATERAL (
    SELECT EXISTS (SELECT 1 FROM use_case_alert_emails e
           WHERE e.workspace_id = pe.workspace_id AND e.recipient_user_id = pe.user_id AND e.kind = 'pronto' AND e.send_on = ${today}
             AND (e.status = 'in_coda' OR (e.status = 'errore' AND e.attempts < 3)) AND (e.lease_until IS NULL OR e.lease_until <= ${now})) AS ok
  ) t
), em AS (
  INSERT INTO use_case_alert_emails (workspace_id, recipient_user_id, kind, send_on, scheduled_at, due_at)
  SELECT sl.workspace_id, sl.user_id, 'pronto', sl.send_on, sl.scheduled_at, sl.scheduled_at FROM slot sl
  ON CONFLICT (workspace_id, recipient_user_id, kind, send_on) DO UPDATE SET
    scheduled_at = least(use_case_alert_emails.scheduled_at, EXCLUDED.scheduled_at),
    updated_at = now()
  RETURNING id, workspace_id, recipient_user_id, status
), items AS (
  INSERT INTO use_case_alert_email_items (email_id, use_case_id, workspace_id, ready_since)
  SELECT em.id, w.use_case_id, w.workspace_id, ${ts}
  FROM who w JOIN em ON em.workspace_id = w.workspace_id AND em.recipient_user_id = w.user_id
  WHERE em.status IN ('in_coda', 'errore')
  ON CONFLICT (email_id, use_case_id) DO UPDATE SET ready_since = EXCLUDED.ready_since
  RETURNING 1
)
SELECT (SELECT count(*)::int FROM became) AS announced`);
}

/**
 * In fondo a ogni scrittura che può cambiare «Informazioni complete» o «Pronto da avviare», al posto
 * di `infoCompleteSyncStatements`: [il lock per scheda, il passaggio a «pronto» (solo con
 * `readiness`), «Informazioni complete» (con `info`, il predefinito)]. Con il passaggio a «pronto»
 * nello stesso batch, un revisore di Lateral Space non riceve anche «Informazioni complete» per la
 * stessa scheda e lo stesso evento: «Pronto da avviare» lo dice già. Senza `readiness` (0025 assente,
 * area spenta, anteprima) è esattamente `infoCompleteSyncStatements`.
 */
export function cardSyncStatements(i: {
  workspaceId: string;
  useCaseIds?: readonly string[];
  needId?: string | null;
  actorUserId: string | null;
  readiness: ReadinessSync | null;
  info?: boolean;
  clock?: Date;
}): UcStatement[] {
  // L'orologio di prova passa così com'è (solo i test lo danno): in produzione è `now()` del database.
  const clock = i.clock ?? i.readiness?.clock;
  const [lock, info] = infoCompleteSyncStatements({
    workspaceId: i.workspaceId,
    useCaseIds: i.useCaseIds,
    needId: i.needId,
    actorUserId: i.actorUserId,
    afterReadyNotice: i.readiness !== null,
    ...(clock ? { clock } : {}),
  });
  const out: UcStatement[] = [lock];
  if (i.readiness) out.push(readinessSyncSql({ workspaceId: i.workspaceId, useCaseIds: i.useCaseIds, needId: i.needId, actorUserId: i.actorUserId, readiness: i.readiness }));
  if (i.info !== false) out.push(info);
  return out;
}
