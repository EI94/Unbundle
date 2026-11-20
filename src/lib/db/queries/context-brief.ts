import "server-only";
/**
 * «In breve» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.4.8, §4.3): al massimo sei righe in cima alla
 * Memoria, riscritte a ogni conferma dai soli fatti «Per tutti» attivi e dai dati della Discovery. Le vede anche il
 * cliente: un fatto «Solo Lateral Space» non entra mai nel prompt.
 *
 * Si riscrive solo se serve (l'impronta dei fatti è cambiata) e solo con l'ok ai sub-responsabili. Non lancia.
 *
 * Tra la lettura dei fatti e la scrittura passa la chiamata al modello (secondi). Se nel frattempo un fatto letto esce
 * da «Per tutti» (diventa «Solo Lateral Space», è ritirato, riscritto o sostituito), le righe non si scrivono: la
 * scrittura prende i fatti letti con un lock condiviso e controlla che siano ancora quelli, nella stessa transazione.
 * Chi cambia un fatto lo aggiorna prima di togliere la riga di «In breve» (`dropBriefStatement`): o aspetta questa
 * scrittura e poi toglie la riga, o questa scrittura vede il fatto cambiato e non scrive. `generated_at` è il momento
 * della lettura, non della scrittura: un fatto cambiato dopo la lettura è più recente del riassunto, e la notte lo
 * riscrive; tra due riscritture vince quella che ha letto per ultima.
 */
import { sql } from "drizzle-orm";
import { CONTEXT_BRIEF_TIMEOUT_MS, ClaudeRefusalError, logClaudeTimeout, stoppedByDeadline } from "@/lib/ai/models";
import { generateContextBrief } from "@/lib/context/brief/generate";
import { briefFactsHash, buildBriefPrompt, cleanBriefLines, BRIEF_FACTS_IN_PROMPT } from "@/lib/context/brief/prompt";
import { buildLiveRows, liveHashLines, liveLines } from "@/lib/context/live";
import { CONTEXT_LIMITS, type ContextSection } from "@/lib/context/vocab";
import { db } from "@/lib/db";
import { logSafeError } from "@/lib/log/safe-error";
import { contextAiConsentNow } from "./context-consent";
import { loadLiveDiscoveryData } from "./context-discovery";
import { ctxErrorCode, isUuid, requireSql, rowsOf, toDate } from "./context-shared";
import { contextStoreReady } from "./context-store";
import { getWorkspaceById } from "./workspaces";

const LOG_SCOPE = "context/brief";

/** `cambiato`: un fatto letto è cambiato durante la riscrittura, o un'altra ha letto dopo; niente si scrive. */
export type BriefRefresh = "aggiornato" | "invariato" | "ok_mancante" | "vuoto" | "recente" | "cambiato" | "non_riuscito";

/** Chi legge «In breve» può essere chiunque apra la pagina: i dati della Discovery entrano senza le cifre dei revisori. */
const EVERYONE = { role: "contributor", isLateralSpace: false } as const;

/**
 * Riscrive «In breve» dai fatti «Per tutti» attivi e dai dati della Discovery. `invariato`: l'impronta
 * (`facts_hash`) è quella di prima. `vuoto`: meno di 3 voci, la riga si cancella. `recente`: scritto da meno di
 * 10 minuti e `force` non è vero. `cambiato`: un fatto letto è cambiato mentre il modello scriveva, o un'altra
 * riscrittura ha letto dopo: niente si scrive. Non lancia.
 */
export async function refreshContextBrief(workspaceId: string, opts: { force?: boolean; timeoutMs?: number } = {}): Promise<BriefRefresh> {
  try {
    if (!isUuid(workspaceId) || !(await contextStoreReady())) return "non_riuscito";
    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) return "non_riuscito";
    const [factRows, live, briefRows] = await Promise.all([
      // I fatti e il momento della lettura, nella stessa istantanea.
      db.execute(sql`
        SELECT now()::text AS as_of,
          coalesce(json_agg(json_build_object('id', f.id, 'version', f.version, 'section', f.section, 'statement', f.statement) ORDER BY f.last_confirmed_at DESC, f.id), '[]'::json) AS facts
        FROM (
          SELECT id, version, section, statement, last_confirmed_at FROM context_facts
          WHERE workspace_id = ${workspaceId}::uuid AND status = 'attivo' AND visibility = 'tutti'
          ORDER BY last_confirmed_at DESC, id LIMIT ${BRIEF_FACTS_IN_PROMPT}
        ) f`),
      loadLiveDiscoveryData(workspace, EVERYONE),
      db.execute(sql`SELECT facts_hash, generated_at FROM context_briefs WHERE workspace_id = ${workspaceId}::uuid`),
    ]);
    const [read] = rowsOf<{ as_of: string; facts: unknown }>(factRows);
    if (!read?.as_of) return "non_riuscito";
    const facts = factsOf(read.facts);
    const lines = live ? liveLines(buildLiveRows(live)) : [];
    const [current] = rowsOf<{ facts_hash: string; generated_at: unknown }>(briefRows);

    // Troppo poco per un riassunto: il blocco non si vede.
    if (facts.length + lines.length < CONTEXT_LIMITS.briefMinItems) {
      if (current) await db.execute(sql`DELETE FROM context_briefs WHERE workspace_id = ${workspaceId}::uuid`);
      return "vuoto";
    }
    // (Rilascio 10) L'impronta con le etichette ferme della Discovery: un'etichetta a schermo nuova non riscrive «In breve».
    const hash = briefFactsHash(facts.map((f) => ({ id: f.id, version: Number(f.version) })), live ? liveHashLines(live) : []);
    if (current?.facts_hash === hash) return "invariato";
    const generated = toDate(current?.generated_at);
    if (!opts.force && generated && Date.now() - generated.getTime() < CONTEXT_LIMITS.briefMinMinutes * 60_000) return "recente";
    // L'ok ai sub-responsabili, subito prima del modello.
    if (!(await contextAiConsentNow(workspaceId))) return "ok_mancante";

    const { system, prompt } = buildBriefPrompt({ clientName: workspace.name, facts, live: lines });
    const timeoutMs = opts.timeoutMs ?? CONTEXT_BRIEF_TIMEOUT_MS;
    const abortSignal = AbortSignal.timeout(timeoutMs);
    let output;
    try {
      output = await generateContextBrief({ system, prompt, abortSignal, workspaceId });
    } catch (error) {
      // Un rifiuto è già nel log (throwIfRefused).
      if (stoppedByDeadline(error, abortSignal)) logClaudeTimeout(LOG_SCOPE, { timeoutMs });
      else if (!(error instanceof ClaudeRefusalError)) logSafeError(LOG_SCOPE, "riassunto_non_riuscito", error, { workspaceId });
      return "non_riuscito";
    }
    // Zero righe buone: la riga di prima resta com'è.
    const clean = cleanBriefLines(output?.righe);
    if (clean.length === 0) return "non_riuscito";
    return (await writeBrief(workspaceId, facts, clean, hash, read.as_of)) ? "aggiornato" : "cambiato";
  } catch (error) {
    if (ctxErrorCode(error) === "fatti_cambiati") return "cambiato";
    logSafeError(LOG_SCOPE, "riassunto_non_riuscito", error, { workspaceId });
    return "non_riuscito";
  }
}

type BriefFact = { id: string; version: number; section: ContextSection; statement: string };

/** I fatti letti per «In breve» (`json_agg`), come righe. */
function factsOf(value: unknown): BriefFact[] {
  const list = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const row = item as Partial<BriefFact> | null;
    return row && isUuid(row.id) && typeof row.statement === "string" ? [{ id: row.id, version: Number(row.version), section: row.section as ContextSection, statement: row.statement }] : [];
  });
}

/**
 * Scrive le righe, in una transazione, solo se i fatti letti sono ancora tutti attivi, «Per tutti» e alla stessa
 * versione (presi con un lock condiviso: chi li cambia aspetta, o li ha già cambiati e allora non si scrive niente), e
 * solo se nessuna riscrittura ha letto dopo di questa (`generated_at`, il momento della lettura). Vero se ha scritto.
 * I fatti si prendono in ordine di id, come li prende una conferma (`confirmProposals`): le due aspettano, non si
 * bloccano a vicenda.
 */
async function writeBrief(workspaceId: string, facts: readonly BriefFact[], clean: readonly string[], hash: string, asOf: string): Promise<boolean> {
  const expected = JSON.stringify(facts.map((f) => ({ id: f.id, version: f.version })));
  const results = await db.batch([
    db.execute(sql`
      WITH expected AS (
        SELECT x.id, x.version FROM jsonb_to_recordset(${expected}::jsonb) AS x(id uuid, version integer)
      ),
      held AS MATERIALIZED (
        SELECT f.id, f.version, f.status, f.visibility FROM context_facts f
        WHERE f.workspace_id = ${workspaceId}::uuid AND f.id IN (SELECT id FROM expected)
        ORDER BY f.id
        FOR SHARE OF f
      )
      ${requireSql(sql`(SELECT count(*) FROM held h JOIN expected e ON e.id = h.id AND e.version = h.version WHERE h.status = 'attivo' AND h.visibility = 'tutti') = ${facts.length}`, "fatti_cambiati")}`),
    db.execute(sql`
      INSERT INTO context_briefs (workspace_id, lines, facts_hash, generated_at)
      VALUES (${workspaceId}::uuid, ${JSON.stringify(clean)}::jsonb, ${hash}, ${asOf}::timestamptz)
      ON CONFLICT (workspace_id) DO UPDATE SET lines = EXCLUDED.lines, facts_hash = EXCLUDED.facts_hash, generated_at = EXCLUDED.generated_at
      WHERE context_briefs.generated_at <= EXCLUDED.generated_at
      RETURNING workspace_id`),
  ]);
  return rowsOf(results[1]).length === 1;
}

/** Sotto questo tempo un riassunto non parte: non finirebbe. */
const BRIEF_MIN_BUDGET_MS = 15_000;

/** Il giro della notte: i workspace con l'ok e un'impronta cambiata. Restituisce quanti «In breve» ha riscritto. */
export async function refreshStaleBriefs(o: { budgetMs: number }): Promise<number> {
  if (!(await contextStoreReady())) return 0;
  const started = Date.now();
  let written = 0;
  let workspaces: Array<{ workspace_id: string }>;
  try {
    // I workspace con un fatto cambiato dopo l'ultimo riassunto, o senza riassunto. Qualunque fatto: uno che è appena
    // uscito da «Per tutti» è proprio quello che il riassunto non deve più dire. `generated_at` è il momento in cui il
    // riassunto ha letto i fatti: un fatto cambiato mentre il modello scriveva è più recente. L'impronta decide se
    // riscrivere.
    workspaces = rowsOf<{ workspace_id: string }>(
      await db.execute(sql`
        SELECT f.workspace_id FROM context_facts f LEFT JOIN context_briefs b ON b.workspace_id = f.workspace_id
        WHERE b.workspace_id IS NULL OR f.updated_at > b.generated_at
        GROUP BY f.workspace_id ORDER BY max(f.updated_at) LIMIT 200`),
    );
  } catch (error) {
    logSafeError(LOG_SCOPE, "giro_non_riuscito", error);
    return 0;
  }
  for (const { workspace_id: workspaceId } of workspaces) {
    const left = o.budgetMs - (Date.now() - started);
    if (left < BRIEF_MIN_BUDGET_MS) break;
    const outcome = await refreshContextBrief(workspaceId, { force: true, timeoutMs: Math.min(CONTEXT_BRIEF_TIMEOUT_MS, left - 2_000) });
    if (outcome === "aggiornato") written += 1;
  }
  return written;
}
