import "server-only";
/**
 * La freschezza dei fatti (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.10, D9).
 *
 * - **La notte** (`markStaleFacts`): ogni fatto attivo non riconfermato da 6 mesi (`last_confirmed_at` prima della
 *   mezzanotte di Roma di sei mesi fa, `staleBefore`) diventa «da verificare» (`needs_check`), anche quelli scritti a
 *   mano. Non tocca `version` né `updated_at`: «In breve» non si riscrive per questo, e chi ha davanti il fatto non riceve
 *   «versione superata». Un evento per workspace, `fatti_da_verificare`, con il numero.
 * - **La pagina «Da verificare»** (solo Lateral Space): `listFactsToCheck` e `reconfirmFacts` («Ancora veri (n)»). «Non
 *   più vero» resta `retireFact`, una riga per volta.
 *
 * «Ancora vero» e una riconferma da appunti tolgono il segno (lo facevano già). Nessun modello. Nei log solo id e numeri.
 */
import { sql } from "drizzle-orm";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { ContextActor } from "@/lib/context/visibility";
import { CONTEXT_LIMITS } from "@/lib/context/vocab";
import { staleBefore } from "@/lib/context/work/freshness";
import { db } from "@/lib/db";
import { logSafeError } from "@/lib/log/safe-error";
import type { ServiceResult } from "@/lib/use-cases/types";
import { FACT_COLUMNS, disputedFacts, factViewOf, type FactRow, type FactView } from "./context-memory";
import { canRead, gate, invalid, isUuid, notFound, ok, retry, romeToday, rowsOf, uuidArray } from "./context-shared";
import { contextStoreReady } from "./context-store";

const LOG_SCOPE = "context/freshness";

/** Quanti fatti la pagina «Da verificare» mostra, al massimo: i più vecchi prima. */
const TO_CHECK_SHOWN = 200;

/**
 * La notte: segna «da verificare» i fatti attivi con l'ultima conferma prima di `staleBefore(now)`, in ogni workspace.
 * Le righe si prendono in ordine di id saltando quelle che una conferma sta toccando (la prossima notte le rivede): niente
 * attese e niente deadlock con chi conferma. Restituisce quanti fatti ha segnato; zero senza archivio o con un errore (nel
 * log).
 */
export async function markStaleFacts(now: Date = new Date()): Promise<number> {
  try {
    if (!(await contextStoreReady())) return 0;
    const cutoff = staleBefore(now).toISOString();
    const result = await db.execute(sql`
      WITH candidates AS (
        SELECT id FROM context_facts
        WHERE status = 'attivo' AND NOT needs_check AND last_confirmed_at < ${cutoff}::timestamptz
        ORDER BY id
        FOR UPDATE SKIP LOCKED
      ), marked AS (
        UPDATE context_facts f SET needs_check = true
        FROM candidates c
        WHERE f.id = c.id AND f.status = 'attivo' AND NOT f.needs_check
        RETURNING f.workspace_id
      ), logged AS (
        INSERT INTO context_events (workspace_id, action, channel, detail)
        SELECT workspace_id, 'fatti_da_verificare', 'cron', jsonb_build_object('n', count(*)) FROM marked GROUP BY workspace_id
        RETURNING id
      )
      SELECT (SELECT count(*)::int FROM marked) AS marked, (SELECT count(*)::int FROM logged) AS workspaces`);
    return Number(rowsOf<{ marked: number }>(result)[0]?.marked ?? 0);
  } catch (error) {
    logSafeError(LOG_SCOPE, "fatti_da_verificare_non_segnati", error);
    return 0;
  }
}

/**
 * I fatti attivi segnati «da verificare» nel workspace, i più vecchi prima (al massimo 200), con la fonte e l'ultima
 * conferma. null a chi non è di Lateral Space (o senza archivio): la pagina risponde `notFound()`. Un errore del database
 * dà una lista vuota (nel log).
 */
export async function listFactsToCheck(actor: ContextActor): Promise<FactView[] | null> {
  if (!(await canRead(actor, "canEditMemory"))) return null;
  const ws = actor.workspaceId;
  try {
    const [rows, disputed] = await Promise.all([
      db.execute(sql`
        SELECT ${FACT_COLUMNS} FROM context_facts f LEFT JOIN context_sources s ON s.id = f.source_id
        WHERE f.workspace_id = ${ws}::uuid AND f.status = 'attivo' AND f.needs_check
        ORDER BY f.last_confirmed_at, f.id
        LIMIT ${TO_CHECK_SHOWN}`),
      disputedFacts(ws),
    ]);
    const today = romeToday();
    return rowsOf<FactRow>(rows).map((row) => factViewOf(row, today, disputed));
  } catch (error) {
    logSafeError(LOG_SCOPE, "fatti_da_verificare_non_letti", error, { workspaceId: ws });
    return [];
  }
}

/**
 * «Ancora veri (n)»: la data dell'ultima conferma si rinfresca e il segno «da verificare» si toglie, per i fatti scelti
 * (da 1 a 75) ancora attivi in questo workspace. Una riga di storia per fatto (`fatto_riconfermato`). Solo Lateral Space.
 * Non è un cambio: niente campanella, niente versione nuova. `non_trovato` se nessuno dei fatti è attivo qui.
 */
export async function reconfirmFacts(actor: ContextActor, factIds: readonly string[]): Promise<ServiceResult<{ reconfirmed: number }>> {
  const allowed = await gate(actor, "canEditMemory");
  if (!allowed.ok) return allowed;
  const T = CONTEXT_TEXT.verify;
  const ids = [...new Set(Array.isArray(factIds) ? factIds : [])];
  if (ids.length === 0) return invalid({}, T.none);
  if (ids.length > CONTEXT_LIMITS.confirmMax) return invalid({}, T.tooMany(CONTEXT_LIMITS.confirmMax));
  if (ids.some((id) => !isUuid(id))) return invalid();
  const ws = actor.workspaceId;
  try {
    const results = await db.batch([
      // Prese in ordine di id, come la conferma e «In breve»: chi le tocca insieme aspetta, invece di bloccarsi.
      db.execute(sql`SELECT f.id FROM context_facts f WHERE f.workspace_id = ${ws}::uuid AND f.id = ANY(${uuidArray(ids)}) ORDER BY f.id FOR UPDATE OF f`),
      db.execute(sql`
        UPDATE context_facts SET last_confirmed_at = now(), needs_check = false, confirmed_by_user_id = ${actor.userId}::uuid, updated_at = now()
        WHERE workspace_id = ${ws}::uuid AND status = 'attivo' AND id = ANY(${uuidArray(ids)})
        RETURNING id`),
      db.execute(sql`
        INSERT INTO context_events (workspace_id, action, channel, actor_user_id, fact_id)
        SELECT ${ws}::uuid, 'fatto_riconfermato', ${actor.channel}, ${actor.userId}::uuid, f.id FROM context_facts f
        WHERE f.workspace_id = ${ws}::uuid AND f.status = 'attivo' AND f.id = ANY(${uuidArray(ids)}) AND f.last_confirmed_at = now()`),
    ]);
    const reconfirmed = rowsOf(results[1]).length;
    return reconfirmed > 0 ? ok({ reconfirmed }) : notFound();
  } catch (error) {
    logSafeError(LOG_SCOPE, "fatti_non_riconfermati", error, { workspaceId: ws, n: ids.length });
    return retry();
  }
}
