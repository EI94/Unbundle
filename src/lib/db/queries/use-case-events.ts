import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import {
  USE_CASE_NEEDS_EVENT_FIELD,
  type UseCaseEventAction,
  type UseCaseEventActorKind,
  type UseCaseEventChannel,
  type UseCaseEventField,
} from "@/lib/db/use-case-hub-ddl";
import { REFERENT_EVENT_FIELD } from "@/lib/db/use-case-hub-referents-ddl";

/**
 * La Storia di uno use case, senza testi (docs/use-case/DESIGN.md §6.6, §10.3; PIANO-LAVORI
 * H2a).
 *
 * - **Scrittura.** Le righe le scrive solo il servizio (`src/lib/use-cases/service.ts`), nello
 *   stesso statement dell'aggiornamento della scheda (§9.1 passo 4): `insertUseCaseEventFrom`
 *   restituisce l'INSERT … SELECT che legge la riga aggiornata da una CTE. La creazione la
 *   scrive il trigger `use_cases_created_event` della 0020, mai il servizio. Le righe di «Cosa
 *   serve» (campo `cosa_serve`, drizzle/0023) le scrive il servizio delle esigenze
 *   (`needs-service.ts`), nello statement dell'esigenza, su ogni use case collegato.
 * - **Nessun testo.** Una riga ha chi del team ha agito (solo per le persone), canale,
 *   azione, nomi dei campi da un elenco chiuso (CHECK) e codici chiusi in `phase_before` e
 *   `phase_after`: di fase (`da_valutare.nuova`) o, nelle righe di «Cosa serve», di tipo e stato
 *   dell'esigenza (`aggiunta.requisito.da_chiedere`, `needs-history.ts`). Mai un valore, né
 *   prima né dopo. Chi legge le fasi filtra su `action` (`decisione`).
 * - **Nessuna vista per persona.** Le letture filtrano per scheda e ordinano per data; nessun
 *   filtro, ordinamento, raggruppamento o conteggio per chi ha agito (art. 15.4).
 */

/**
 * Chi ha agito, come lo scrive il servizio. «proponente» lo scrivono il trigger di creazione e
 * la risposta a «Serve info» (D17): sempre senza persona, la Storia non dice chi propone.
 */
export type ServiceEventActorKind = UseCaseEventActorKind;

/** Le azioni che scrive il servizio: «creato» è solo del trigger di creazione. */
export type ServiceEventAction = Exclude<UseCaseEventAction, "creato">;

/** Una riga della Storia scritta dal servizio. */
export interface UseCaseEventInput {
  /** Solo per `actorKind = "persona"` (CHECK `use_case_events_actor_check`). */
  actorUserId: string | null;
  actorKind: ServiceEventActorKind;
  channel: UseCaseEventChannel;
  action: ServiceEventAction;
  /** Nomi dei campi toccati, mai i valori. */
  fields: readonly UseCaseEventField[];
  /** Codici di fase, es. `da_valutare.nuova` (al massimo 40 caratteri). */
  phaseBefore: string | null;
  phaseAfter: string | null;
}

const CTE_NAME = /^[a-z_][a-z0-9_]{0,30}$/;

/**
 * `INSERT INTO use_case_events … SELECT … FROM <cte>`: una riga di Storia per ogni riga
 * restituita dalla CTE (che deve avere `id` e `workspace_id` della scheda). Se la CTE non
 * restituisce righe (versione superata, scheda di un altro workspace) non si scrive niente:
 * aggiornamento e Storia vanno insieme o non vanno.
 */
export function insertUseCaseEventFrom(cte: string, event: UseCaseEventInput): SQL {
  if (!CTE_NAME.test(cte)) throw new RangeError("Nome della CTE non valido");
  const actorUserId = event.actorKind === "persona" ? event.actorUserId : null;
  return sql`INSERT INTO use_case_events
      (workspace_id, use_case_id, actor_user_id, actor_kind, channel, action, fields, phase_before, phase_after)
    SELECT workspace_id, id, ${actorUserId}::uuid, ${event.actorKind}, ${event.channel}, ${event.action},
      ${sql.param([...event.fields])}::text[], ${event.phaseBefore}, ${event.phaseAfter}
    FROM ${sql.raw(cte)}`;
}

// ─── Lettura (capitolo «Storia», §6.6) ───────────────────────────────

/** Una riga della Storia come la legge la scheda. */
export interface UseCaseEventRow {
  id: string;
  at: Date;
  actorKind: UseCaseEventActorKind;
  /** Nome della persona del team, solo per `actorKind = "persona"`; null se l'utente non c'è più. */
  actorName: string | null;
  channel: UseCaseEventChannel;
  action: UseCaseEventAction;
  fields: UseCaseEventField[];
  phaseBefore: string | null;
  phaseAfter: string | null;
}

export interface UseCaseEventList {
  /** Dalla più recente; al massimo `limit`. */
  events: UseCaseEventRow[];
  /** Ci sono righe più vecchie oltre `limit` («Mostra tutto»). */
  hasMore: boolean;
  /** Data della prima riga della scheda («La storia parte dal …»); null senza righe. */
  startedAt: Date | null;
}

export const USE_CASE_EVENTS_DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

/**
 * Le righe di «Cosa serve» (campo `cosa_serve`, drizzle/0023) e di «Chiedi al referente» (campo
 * `richiesta_referente`, drizzle/0024) solo con `withNeeds`: le esigenze e le richieste le vedono
 * solo i revisori (`canSeeNeeds`), e così le loro righe. Senza, la Storia è quella di prima, anche
 * per «Mostra tutto» e «La storia parte dal».
 */
function needsRows(withNeeds: boolean): SQL {
  return withNeeds ? sql`` : sql` AND NOT (fields && ARRAY[${USE_CASE_NEEDS_EVENT_FIELD}, ${REFERENT_EVENT_FIELD}]::text[])`;
}

/**
 * Le ultime righe della Storia di una scheda del workspace, dalla più recente. Una scheda di
 * un altro workspace, o un id che non è un UUID, non ha righe. Le righe di «Cosa serve» solo
 * con `opts.withNeeds` (chi guarda ha `canSeeNeeds`).
 */
export async function listUseCaseEvents(
  workspaceId: string,
  useCaseId: string,
  limit: number = USE_CASE_EVENTS_DEFAULT_LIMIT,
  opts: { withNeeds?: boolean } = {},
): Promise<UseCaseEventList> {
  if (!UUID.test(workspaceId) || !UUID.test(useCaseId)) return { events: [], hasMore: false, startedAt: null };
  await ensureDbSchema();
  const size = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), MAX_LIMIT) : USE_CASE_EVENTS_DEFAULT_LIMIT;
  const needs = needsRows(opts.withNeeds === true);
  const [list, first] = await Promise.all([
    db.execute(sql`SELECT e.id, e.at, e.actor_kind AS "actorKind",
        CASE WHEN e.actor_kind = 'persona' THEN u.name END AS "actorName",
        e.channel, e.action, e.fields, e.phase_before AS "phaseBefore", e.phase_after AS "phaseAfter"
      FROM use_case_events e
      LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.workspace_id = ${workspaceId}::uuid AND e.use_case_id = ${useCaseId}::uuid${needs}
      ORDER BY e.at DESC, e.id DESC
      LIMIT ${size + 1}`),
    db.execute(sql`SELECT min(at) AS "startedAt"
      FROM use_case_events
      WHERE workspace_id = ${workspaceId}::uuid AND use_case_id = ${useCaseId}::uuid${needs}`),
  ]);
  const rows = list.rows as Array<Record<string, unknown>>;
  const events = rows.slice(0, size).map(
    (row): UseCaseEventRow => ({
      id: String(row.id),
      at: toDate(row.at),
      actorKind: row.actorKind as UseCaseEventActorKind,
      actorName: typeof row.actorName === "string" && row.actorName.trim() ? row.actorName : null,
      channel: row.channel as UseCaseEventChannel,
      action: row.action as UseCaseEventAction,
      fields: Array.isArray(row.fields) ? (row.fields as UseCaseEventField[]) : [],
      phaseBefore: typeof row.phaseBefore === "string" ? row.phaseBefore : null,
      phaseAfter: typeof row.phaseAfter === "string" ? row.phaseAfter : null,
    }),
  );
  const startedAt = (first.rows[0] as { startedAt?: unknown } | undefined)?.startedAt;
  return {
    events,
    hasMore: rows.length > size,
    startedAt: startedAt === null || startedAt === undefined ? null : toDate(startedAt),
  };
}
