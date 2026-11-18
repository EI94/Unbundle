import "server-only";
/**
 * (9b) «Contesto» per l'MCP del team (docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.7, §5.7): quello che la Memoria non
 * porta e che `get_context` e `list_context_commitments` restituiscono o filtrano. Per i fatti, gli impegni e le domande
 * che `loadContextMemory` ha già letto per chi guarda: gli use case legati a ognuno e, per un fatto, il giorno in cui è
 * nata la sua versione attiva (`since`: «nuovi o cambiati da quel giorno»; una riconferma non conta).
 *
 * Rifà da sé il controllo di chi chiama: solo chi apre «Contesto», solo il workspace di chi chiama, e per chi non è di
 * Lateral Space solo le righe «Per tutti» (un id «Solo Lateral Space» non dice niente). Degli use case solo quelli del
 * workspace. Mai citazioni, mai chi ha confermato o aggiunto. Non lancia: un errore va nel log (solo id) e la lettura
 * risponde null, come senza archivio.
 */
import { sql } from "drizzle-orm";
import { contextAbilities, type ContextActor } from "@/lib/context/visibility";
import { db } from "@/lib/db";
import { logSafeError } from "@/lib/log/safe-error";
import { romeDate } from "@/lib/uc/calendar";
import { isUuid, rowsOf, toDate, toUuidArray, uuidArray } from "./context-shared";
import { contextStoreReady } from "./context-store";

const LOG_SCOPE = "context/team";

/** Id al massimo per elenco: quanti ne legge `loadContextMemory` (1.000 fatti, 200 impegni, 200 domande). */
const IDS_MAX = 1000;

/** Uno use case citato: il codice e il titolo (il titolo serve solo a uno use case senza codice). */
export interface ContextUseCaseRef {
  code: string | null;
  title: string;
}

export interface ContextLinks {
  /** Gli use case citati qui sotto, per id in minuscolo. Solo quelli del workspace. */
  useCases: Record<string, ContextUseCaseRef>;
  /** Per id di fatto in minuscolo: gli use case legati e il giorno (Roma, AAAA-MM-GG) in cui è nata la versione attiva. */
  facts: Record<string, { useCaseIds: string[]; createdOn: string }>;
  /** Per id di impegno in minuscolo: gli use case. */
  commitments: Record<string, string[]>;
  /** Per id di domanda in minuscolo: gli use case. */
  questions: Record<string, string[]>;
}

/** Gli id da cercare: solo UUID, in minuscolo, senza doppioni, al massimo `IDS_MAX`. */
function idsOf(list: readonly string[]): string[] {
  return [...new Set(list.filter(isUuid).map((id) => id.toLowerCase()))].slice(0, IDS_MAX);
}

/**
 * Gli use case di fatti, impegni e domande attivi e visibili a chi guarda, e il giorno in cui è nato ogni fatto. Un id
 * che non c'è, di un altro workspace o «Solo Lateral Space» per chi non è di Lateral Space, non compare. null: chi guarda
 * non apre «Contesto», archivio non pronto, o un errore.
 */
export async function loadContextLinks(
  actor: ContextActor,
  ids: { factIds: readonly string[]; commitmentIds: readonly string[]; questionIds: readonly string[] },
): Promise<ContextLinks | null> {
  const abilities = contextAbilities(actor);
  if (!abilities.canOpen || !isUuid(actor.workspaceId) || !(await contextStoreReady())) return null;
  const ws = actor.workspaceId;
  const lateralSpace = abilities.seesLateralSpace;
  const factIds = idsOf(ids.factIds);
  const commitmentIds = idsOf(ids.commitmentIds);
  const questionIds = idsOf(ids.questionIds);
  const none = Promise.resolve({ rows: [] });
  try {
    const [factRows, commitmentRows, questionRows] = await Promise.all([
      factIds.length > 0
        ? db.execute(sql`
            SELECT f.id, f.created_at,
              coalesce(array_agg(l.use_case_id ORDER BY l.use_case_id) FILTER (WHERE l.use_case_id IS NOT NULL), '{}'::uuid[]) AS use_case_ids
            FROM context_facts f
            LEFT JOIN context_fact_links l ON l.fact_id = f.id AND l.workspace_id = f.workspace_id AND l.use_case_id IS NOT NULL
            WHERE f.workspace_id = ${ws}::uuid AND f.id = ANY(${uuidArray(factIds)}) AND f.status = 'attivo' AND (${lateralSpace} OR f.visibility = 'tutti')
            GROUP BY f.id, f.created_at`)
        : none,
      commitmentIds.length > 0
        ? db.execute(sql`
            SELECT c.id, c.use_case_ids FROM context_commitments c
            WHERE c.workspace_id = ${ws}::uuid AND c.id = ANY(${uuidArray(commitmentIds)}) AND c.status = 'aperto' AND (${lateralSpace} OR c.visibility = 'tutti')`)
        : none,
      questionIds.length > 0
        ? db.execute(sql`
            SELECT q.id, q.use_case_ids FROM context_questions q
            WHERE q.workspace_id = ${ws}::uuid AND q.id = ANY(${uuidArray(questionIds)}) AND q.status = 'aperta' AND (${lateralSpace} OR q.visibility = 'tutti')`)
        : none,
    ]);

    const lower = (list: unknown) => toUuidArray(list).map((id) => id.toLowerCase());
    const facts = rowsOf<{ id: string; created_at: unknown; use_case_ids: unknown }>(factRows).map((row) => {
      const created = toDate(row.created_at);
      return { id: row.id.toLowerCase(), useCaseIds: lower(row.use_case_ids), createdOn: created ? romeDate(created) : "" };
    });
    const commitments = rowsOf<{ id: string; use_case_ids: unknown }>(commitmentRows).map((row) => ({ id: row.id.toLowerCase(), useCaseIds: lower(row.use_case_ids) }));
    const questions = rowsOf<{ id: string; use_case_ids: unknown }>(questionRows).map((row) => ({ id: row.id.toLowerCase(), useCaseIds: lower(row.use_case_ids) }));

    // Gli use case citati, solo di questo workspace: un id che non c'è più (o di un altro workspace) si toglie.
    const cited = [...new Set([...facts, ...commitments, ...questions].flatMap((row) => row.useCaseIds))].filter(isUuid);
    const useCases: Record<string, ContextUseCaseRef> = {};
    if (cited.length > 0) {
      const rows = rowsOf<{ id: string; code: string | null; title: string }>(
        await db.execute(sql`SELECT id, code, title FROM use_cases WHERE workspace_id = ${ws}::uuid AND id = ANY(${uuidArray(cited)})`),
      );
      for (const row of rows) useCases[row.id.toLowerCase()] = { code: row.code ?? null, title: row.title };
    }
    const known = (list: string[]) => list.filter((id) => Object.hasOwn(useCases, id));
    return {
      useCases,
      facts: Object.fromEntries(facts.map((row) => [row.id, { useCaseIds: known(row.useCaseIds), createdOn: row.createdOn }])),
      commitments: Object.fromEntries(commitments.map((row) => [row.id, known(row.useCaseIds)])),
      questions: Object.fromEntries(questions.map((row) => [row.id, known(row.useCaseIds)])),
    };
  } catch (error) {
    logSafeError(LOG_SCOPE, "legami_non_letti", error, { workspaceId: ws });
    return null;
  }
}
