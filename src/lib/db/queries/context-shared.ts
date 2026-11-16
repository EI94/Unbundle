import "server-only";
/**
 * Aiuti comuni alle funzioni di «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.4): gli esiti, il
 * controllo di chi chiama, la riga di storia, e le due cose che servono a una transazione senza passi interattivi
 * (`neon-http`): una condizione che annulla tutto il batch, e la lettura dell'errore che ne esce.
 *
 * Ogni funzione di `context-*.ts` rifà da sé il controllo di chi chiama (`gate`): le pagine e le rotte non sono l'unico
 * controllo. Ogni query porta `workspace_id` su ogni tabella che tocca: un id di un altro workspace risponde «non trovato».
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { contextStoreReady } from "@/lib/db/queries/context-store";
import { contextEvents } from "@/lib/db/schema";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities, type ContextAbilities, type ContextActor } from "@/lib/context/visibility";
import type { ContextChannel, ContextEventAction } from "@/lib/context/vocab";
import type { SqlExecutor } from "@/lib/connector/rate-limit";
import { romeDate } from "@/lib/uc/calendar";
import { isUuid } from "@/lib/uc/ids";
import type { ServiceError, ServiceResult } from "@/lib/use-cases/types";

export { isUuid };

// ─── Esiti ───────────────────────────────────────────────────────────

export function ok<T>(value: T): ServiceResult<T> {
  return { ok: true, value };
}

export function failure<T = never>(error: ServiceError, message: string, fieldErrors?: Record<string, string>): ServiceResult<T> {
  return fieldErrors && Object.keys(fieldErrors).length > 0 ? { ok: false, error, message, fieldErrors } : { ok: false, error, message };
}

export const denied = <T = never>() => failure<T>("permesso_mancante", CONTEXT_TEXT.errors.denied);
export const notFound = <T = never>() => failure<T>("non_trovato", CONTEXT_TEXT.errors.notFound);
export const stale = <T = never>() => failure<T>("versione_superata", CONTEXT_TEXT.errors.stale);
export const notReady = <T = never>() => failure<T>("area_spenta", CONTEXT_TEXT.errors.notReady);
export const retry = <T = never>() => failure<T>("riprova", CONTEXT_TEXT.errors.retry);
export const invalid = <T = never>(fieldErrors: Record<string, string> = {}, message: string = CONTEXT_TEXT.errors.invalid) =>
  failure<T>("dati_non_validi", message, fieldErrors);

// ─── Chi chiama ──────────────────────────────────────────────────────

/**
 * Il controllo di ogni scrittura e di ogni lettura riservata: gli id sono UUID, chi chiama ha la capacità chiesta
 * (`contextAbilities`), la 0038 c'è. Nell'ordine: `permesso_mancante`, poi `area_spenta`.
 */
export async function gate(actor: ContextActor, ability: keyof ContextAbilities): Promise<ServiceResult<true>> {
  if (!actor || !isUuid(actor.workspaceId) || !isUuid(actor.userId)) return denied();
  if (!contextAbilities(actor)[ability]) return denied();
  if (!(await contextStoreReady())) return notReady();
  return ok(true);
}

/** Come `gate`, per le letture: vero se chi chiama può, e l'archivio c'è. */
export async function canRead(actor: ContextActor, ability: keyof ContextAbilities): Promise<boolean> {
  return (await gate(actor, ability)).ok;
}

// ─── Storia ──────────────────────────────────────────────────────────

export interface ContextEventInput {
  workspaceId: string;
  action: ContextEventAction;
  channel: ContextChannel;
  /** Chi ha agito: per appunti e fatti («chi ha confermato che cosa»); nullo per impegni e domande. */
  actorUserId?: string | null;
  sourceId?: string | null;
  factId?: string | null;
  commitmentId?: string | null;
  questionId?: string | null;
  /** Solo codici e numeri: mai un testo. */
  detail?: Record<string, string | number | boolean | null>;
}

/** L'INSERT di una riga di `context_events`, da mettere in un batch. `when`: una condizione in più (la scrittura è avvenuta). */
export function eventStatement(e: ContextEventInput, when?: SQL) {
  const detail = JSON.stringify(e.detail ?? {});
  return db.execute(sql`
    INSERT INTO context_events (workspace_id, action, channel, actor_user_id, source_id, fact_id, commitment_id, question_id, detail)
    SELECT ${e.workspaceId}::uuid, ${e.action}, ${e.channel}, ${e.actorUserId ?? null}::uuid, ${e.sourceId ?? null}::uuid, ${e.factId ?? null}::uuid,
      ${e.commitmentId ?? null}::uuid, ${e.questionId ?? null}::uuid, ${detail}::jsonb
    WHERE ${when ?? sql`true`}`);
}

/**
 * «In breve» lo legge anche il cliente, ed è fatto dei soli fatti «Per tutti» attivi (§4.3). Quando un fatto «Per tutti»
 * esce da lì (diventa «Solo Lateral Space», cambia testo, si ritira, è sostituito da una conferma) la riga si cancella
 * nella stessa transazione: il blocco non si vede finché non si riscrive (`refreshContextBrief`, dopo la risposta o di
 * notte). `when`: una condizione in più (la scrittura è avvenuta). Nel batch va dopo l'UPDATE del fatto: una
 * riscrittura in corso prende i fatti con un lock condiviso, così o la sua riga si scrive prima e questa la toglie, o
 * vede il fatto cambiato e non scrive.
 */
export function dropBriefStatement(workspaceId: string, when?: SQL) {
  return db.execute(sql`DELETE FROM context_briefs WHERE workspace_id = ${workspaceId}::uuid AND ${when ?? sql`true`}`);
}

/** La CTE `chain(id, supersedes_id)`: questi fatti e tutte le loro versioni di prima (la storia di `supersedes_id`). */
export function factChainCte(workspaceId: string, factIds: readonly string[]): SQL {
  return sql`chain AS (
    SELECT f.id, f.supersedes_id FROM context_facts f WHERE f.workspace_id = ${workspaceId}::uuid AND f.id = ANY(${uuidArray(factIds)})
    UNION
    SELECT f.id, f.supersedes_id FROM context_facts f JOIN chain c ON f.id = c.supersedes_id WHERE f.workspace_id = ${workspaceId}::uuid
  )`;
}

/**
 * Un fatto che cambia testo, è ritirato o è sostituito da una conferma cambia il «Prima» delle proposte aperte che lo
 * toccano (o che toccano una sua versione di prima): la loro versione si alza, così chi le ha davanti come erano prima
 * riceve `versione_superata` e le rilegge, invece di confermare su un fatto che non ha visto. Le righe si prendono in
 * ordine di id, come nella conferma: due scritture sugli stessi fatti si mettono in fila. `except`: le proposte che la
 * stessa transazione sta decidendo. Da mettere nel batch prima delle scritture sui fatti.
 */
export function bumpProposalsOnFactsStatement(workspaceId: string, factIds: readonly string[], except: readonly string[] = []) {
  return db.execute(sql`
    WITH RECURSIVE ${factChainCte(workspaceId, factIds)},
    locked AS (
      SELECT p.id FROM context_proposals p
      WHERE p.workspace_id = ${workspaceId}::uuid AND p.status = 'aperta' AND p.target_fact_id IN (SELECT id FROM chain)
        AND NOT (p.id = ANY(${uuidArray(except)}))
      ORDER BY p.id
      FOR UPDATE OF p
    )
    UPDATE context_proposals p SET version = p.version + 1, updated_at = now() FROM locked WHERE p.id = locked.id`);
}

/** Una riga di storia scritta da sola (fuori da un batch). */
export async function writeEvent(e: ContextEventInput): Promise<void> {
  await db.insert(contextEvents).values({
    workspaceId: e.workspaceId,
    action: e.action,
    channel: e.channel,
    actorUserId: e.actorUserId ?? null,
    sourceId: e.sourceId ?? null,
    factId: e.factId ?? null,
    commitmentId: e.commitmentId ?? null,
    questionId: e.questionId ?? null,
    detail: e.detail ?? {},
  });
}

// ─── Transazioni senza passi interattivi ─────────────────────────────

const CTX_CODE = /^[a-z_]{2,40}$/;

/**
 * Dentro un batch (`db.batch`, una transazione sola): se `condition` è falsa, lo statement fallisce e tutto il batch
 * si annulla. L'errore porta `ctx:<codice>` (`ctxErrorCode`). Il cast sta fuori dal CASE: così si valuta solo quando
 * serve, mai mentre il database prepara la query.
 */
export function requireSql(condition: SQL, code: string): SQL {
  if (!CTX_CODE.test(code)) throw new Error("requireSql: codice non valido");
  return sql`SELECT (CASE WHEN ${condition} THEN '1' ELSE ${`ctx:${code}`}::text END)::int AS ok`;
}

type PgLikeError = { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };

/** Codice e vincolo dell'errore del database, anche dentro `cause` (Drizzle avvolge gli errori delle query singole). */
export function pgErrorOf(error: unknown): { code: string | null; constraint: string | null; message: string } {
  let current = error as PgLikeError | null | undefined;
  for (let depth = 0; current && typeof current === "object" && depth < 4; depth++) {
    if (typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code)) {
      return {
        code: current.code,
        constraint: typeof current.constraint === "string" ? current.constraint : null,
        message: typeof current.message === "string" ? current.message : "",
      };
    }
    current = current.cause as PgLikeError | null | undefined;
  }
  const message = error instanceof Error ? error.message : "";
  return { code: null, constraint: null, message };
}

/** Il codice `ctx:<codice>` di un batch annullato da `requireSql`, oppure null. */
export function ctxErrorCode(error: unknown): string | null {
  let current = error as PgLikeError | null | undefined;
  for (let depth = 0; current && typeof current === "object" && depth < 4; depth++) {
    const match = typeof current.message === "string" ? /ctx:([a-z_]{2,40})/.exec(current.message) : null;
    if (match) return match[1];
    current = current.cause as PgLikeError | null | undefined;
  }
  return null;
}

/** Vero se l'errore è la violazione di quell'indice o vincolo unico. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = pgErrorOf(error);
  return pg.code === "23505" && (constraint === undefined || pg.constraint === constraint);
}

// ─── Limiti di richieste ─────────────────────────────────────────────

/** L'esecutore dei limiti di «Contesto» (`connector_rate_limits`, come il connettore e l'MCP del team). */
export const contextRateLimitExec: SqlExecutor = async (text, params) => (await db.$client.query(text, params)) as Array<Record<string, unknown>>;

/** Il fuso dei secchi giornalieri: il giorno ricomincia a mezzanotte in Italia. */
export const CONTEXT_DAY_TIME_ZONE = "Europe/Rome";

// ─── Piccole cose ────────────────────────────────────────────────────

/** Un elenco di id come array di Postgres. Entrano solo UUID: ogni altro valore si scarta. */
export function uuidArray(ids: readonly string[]): SQL {
  const safe = ids.filter(isUuid);
  return sql`${`{${safe.join(",")}}`}::uuid[]`;
}

/** Gli use case di questo workspace tra quelli chiesti. */
export async function knownUseCases(workspaceId: string, ids: readonly string[]): Promise<Set<string>> {
  const safe = [...new Set(ids.filter(isUuid))];
  if (safe.length === 0) return new Set();
  const rows = rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM use_cases WHERE workspace_id = ${workspaceId}::uuid AND id = ANY(${uuidArray(safe)})`));
  return new Set(rows.map((r) => r.id));
}

/** Oggi a Roma, `AAAA-MM-GG`. */
export function romeToday(now: Date = new Date()): string {
  return romeDate(now);
}

/** Le righe di un `db.execute`, qualunque forma abbia il risultato. */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  const rows = (result as { rows?: unknown } | null | undefined)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/** Un `timestamptz` letto con SQL scritto a mano (testo o Date) come Date, oppure null. */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** Una `date` letta dal database (`AAAA-MM-GG`, o una Date) come `AAAA-MM-GG`. */
export function toIsoDate(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return "";
}

/** Un array `uuid[]` letto con SQL scritto a mano. */
export function toUuidArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value.startsWith("{")) return value.slice(1, -1).split(",").filter(Boolean);
  return [];
}
