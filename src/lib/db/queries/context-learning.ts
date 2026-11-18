import "server-only";
/**
 * `unbundle impara` (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.5, §3.2, D10): una cosa imparata
 * costruendo un caso, che il coding agent manda solo dopo il sì della persona (la CLI non chiama senza `--si`).
 *
 * - **Nessun modello.** Unbundle crea una fonte «Imparato costruendo XX-0012» (appunti, origine `cli`, già letta,
 *   `external_id` «impara:» e il suo id) e una proposta: «nuovo», «detto», «Solo Lateral Space», sezione `sistemi` se non
 *   è detta, legata allo use case. In «Da confermare» non è mai preselezionata (`isLearnedSource`): la conferma Lateral
 *   Space, come sempre.
 * - **La stessa frase** di un fatto attivo che chi impara vede (`normalizeStatement`) è una riconferma; la stessa frase
 *   di una proposta aperta che chi impara può conoscere è «già proposta» e non scrive niente: per Lateral Space ogni
 *   proposta aperta, per chi costruisce da fuori solo le altre cose imparate (mai un oracolo sulle proposte riservate).
 * - **I controlli:** da 10 a 200 caratteri, `scanStatement` (nomi, contatti, dati sanitari); 30 al giorno per workspace
 *   (secchio `ctx:ws:<id>:impara:day`). Chi costruisce il caso lo controlla la rotta; qui `canOpen`.
 *
 * Nei log solo id e numeri: mai la frase.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { consumeRateLimits, rateLimitBucket } from "@/lib/connector/rate-limit";
import { cut, normalizeStatement, oneLine } from "@/lib/context/normalize";
import { scanStatement } from "@/lib/context/scan";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities, type ContextActor } from "@/lib/context/visibility";
import { CONTEXT_LIMITS, CONTEXT_SECTIONS, LEARNED_SOURCE_PREFIX, type ContextSection } from "@/lib/context/vocab";
import { AGENT_CONTEXT_TEXT } from "@/lib/context/work/agent-text";
import { db } from "@/lib/db";
import { logSafeError } from "@/lib/log/safe-error";
import type { ServiceResult } from "@/lib/use-cases/types";
import { CONTEXT_DAY_TIME_ZONE, contextRateLimitExec, eventStatement, gate, invalid, isUuid, notFound, notReady, ok, retry, romeToday, rowsOf, uuidArray } from "./context-shared";
import { contextWorkReady } from "./context-store";

const LOG_SCOPE = "context/learning";

/**
 * Com'è andata. `proposta`: una proposta nuova; `riconferma`: la stessa frase di un fatto in memoria, una proposta di
 * riconferma; `gia_proposta`: la stessa frase è già tra le proposte aperte, niente si scrive; `limite`: il tetto del
 * giorno (la rotta risponde 429 con `Retry-After`).
 */
export type LearningOutcome =
  | { esito: "proposta" | "riconferma"; proposalId: string }
  | { esito: "gia_proposta" }
  | { esito: "limite"; retryAfterSeconds: number };

/** Il codice di uno use case per il titolo della fonte, se lo use case non ne ha uno: lettere, cifre e trattini. */
const CODE = /^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/;

/**
 * `unbundle impara` (§2.5). Chi costruisce: il controllo del caso lo fa la rotta, qui `canOpen` e `scanStatement`.
 * Evento `cosa_imparata`. `dati_non_validi` per una frase corta, lunga o con dati personali; `non_trovato` per uno use
 * case di un altro workspace; `area_spenta` senza la 0041 (la rotta risponde 503).
 */
export async function addLearning(
  actor: ContextActor,
  input: { useCaseId: string; code: string; text: string; section?: ContextSection },
): Promise<ServiceResult<LearningOutcome>> {
  const allowed = await gate(actor, "canOpen");
  if (!allowed.ok) return allowed;
  const L = AGENT_CONTEXT_TEXT.learn;
  const text = oneLine(typeof input?.text === "string" ? input.text : "");
  if (text.length < CONTEXT_LIMITS.learnMin) return invalid({ testo: L.tooShort }, L.tooShort);
  if (text.length > CONTEXT_LIMITS.learnMax) return invalid({ testo: L.tooLong }, L.tooLong);
  // Un nome, un contatto, un dato sanitario non entrano nemmeno come proposta: le persone si indicano per ruolo.
  const scan = scanStatement(text);
  if (!scan.ok) return invalid({ testo: scan.message }, scan.message);
  const section = input.section ?? "sistemi";
  if (!(CONTEXT_SECTIONS as readonly string[]).includes(section)) return invalid({ sezione: CONTEXT_TEXT.errors.sectionMissing }, CONTEXT_TEXT.errors.sectionMissing);
  if (!isUuid(input?.useCaseId)) return notFound();
  const ws = actor.workspaceId;
  const lateralSpace = contextAbilities(actor).seesLateralSpace;
  try {
    if (!(await contextWorkReady())) return notReady();
    const [useCase] = rowsOf<{ code: string | null; title: string }>(
      await db.execute(sql`SELECT code, title FROM use_cases WHERE id = ${input.useCaseId}::uuid AND workspace_id = ${ws}::uuid`),
    );
    if (!useCase) return notFound();
    // Il titolo della fonte: il codice dello use case (quello che la rotta ha risolto, se lo use case non ne ha), o il suo titolo.
    const given = typeof input.code === "string" ? input.code.trim() : "";
    const title = cut(CONTEXT_TEXT.notes.learnedTitle(useCase.code ?? (CODE.test(given) ? given : oneLine(useCase.title))), CONTEXT_LIMITS.titleMax);

    const limit = await consumeRateLimits(contextRateLimitExec, [
      { bucket: rateLimitBucket("ctx", "ws", ws, "impara", "day"), window: "day", limit: CONTEXT_LIMITS.learnsPerDayWorkspace, timeZone: CONTEXT_DAY_TIME_ZONE },
    ]);
    if (!limit.ok) return ok({ esito: "limite", retryAfterSeconds: limit.retryAfterSeconds });

    const key = normalizeStatement(text);
    const [openRows, factRows] = await Promise.all([
      // Le proposte aperte con la stessa frase. A chi non è di Lateral Space solo quelle delle cose imparate (`impara:`):
      // le proposte dagli appunti e dai documenti sono «Solo Lateral Space», e «È già tra le proposte» le rivelerebbe.
      db.execute(sql`
        SELECT p.statement FROM context_proposals p JOIN context_sources s ON s.id = p.source_id AND s.workspace_id = p.workspace_id
        WHERE p.workspace_id = ${ws}::uuid AND p.status = 'aperta'
          AND (${lateralSpace} OR (s.origin = 'cli' AND s.external_id LIKE ${`${LEARNED_SOURCE_PREFIX}%`}))
        ORDER BY p.created_at DESC LIMIT 1000`),
      // Solo i fatti che chi impara vede: a chi costruisce da fuori un fatto «Solo Lateral Space» non si rivela.
      db.execute(sql`
        SELECT id, statement FROM context_facts
        WHERE workspace_id = ${ws}::uuid AND status = 'attivo' AND (${lateralSpace} OR visibility = 'tutti')
        ORDER BY last_confirmed_at DESC, id LIMIT 5000`),
    ]);
    if (rowsOf<{ statement: string }>(openRows).some((row) => normalizeStatement(row.statement) === key)) return ok({ esito: "gia_proposta" });
    const same = rowsOf<{ id: string; statement: string }>(factRows).find((row) => normalizeStatement(row.statement) === key) ?? null;

    const sourceId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const kind = same ? "conferma" : "nuovo";
    const created = sql`EXISTS (SELECT 1 FROM context_sources x WHERE x.id = ${sourceId}::uuid)`;
    const results = await db.batch([
      // La stessa frase due volte insieme: il lock la mette in fila, e la seconda trova la proposta della prima.
      db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`unbundle:context-learn:${ws}:${createHash("sha256").update(key).digest("hex")}`}))`),
      db.execute(sql`
        INSERT INTO context_sources (id, workspace_id, kind, origin, title, occurred_on, body, body_chars, external_id, visibility, read_status, read_at, parts_total, parts_read, added_by_user_id)
        SELECT ${sourceId}::uuid, ${ws}::uuid, 'appunti', 'cli', ${title}, ${romeToday()}::date, ${text}, ${text.length},
          ${`${LEARNED_SOURCE_PREFIX}${sourceId}`}, 'ls', 'letto', now(), 1, 1, ${actor.userId}::uuid
        WHERE NOT EXISTS (
          SELECT 1 FROM context_proposals p JOIN context_sources s ON s.id = p.source_id
          WHERE p.workspace_id = ${ws}::uuid AND p.status = 'aperta' AND s.origin = 'cli' AND s.external_id LIKE ${`${LEARNED_SOURCE_PREFIX}%`}
            AND lower(btrim(p.statement)) = lower(${text})
        )`),
      db.execute(sql`
        INSERT INTO context_proposals (id, workspace_id, source_id, position, kind, statement, basis, section, visibility, target_fact_id, use_case_ids)
        SELECT ${proposalId}::uuid, ${ws}::uuid, ${sourceId}::uuid, 1, ${kind}, ${text}, 'detto', ${section}, 'ls', ${same?.id ?? null}::uuid, ${uuidArray([input.useCaseId])}
        WHERE ${created}`),
      eventStatement(
        { workspaceId: ws, action: "cosa_imparata", channel: actor.channel, actorUserId: actor.userId, sourceId, detail: { esito: same ? "riconferma" : "proposta", sezione: section } },
        created,
      ),
      db.execute(sql`SELECT ${created} AS created`),
    ]);
    if (rowsOf<{ created: boolean }>(results[4])[0]?.created !== true) return ok({ esito: "gia_proposta" });
    return ok({ esito: same ? "riconferma" : "proposta", proposalId });
  } catch (error) {
    logSafeError(LOG_SCOPE, "cosa_imparata_non_salvata", error, { workspaceId: ws, useCaseId: input.useCaseId });
    return retry();
  }
}
