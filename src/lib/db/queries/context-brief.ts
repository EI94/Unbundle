import "server-only";
/**
 * «In breve» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.4.8, §4.3): al massimo sei righe in cima alla
 * Memoria, riscritte a ogni conferma dai soli fatti «Per tutti» attivi e dai dati della Discovery. Le vede anche il
 * cliente: un fatto «Solo Lateral Space» non entra mai nel prompt.
 *
 * Si riscrive solo se serve (l'impronta dei fatti è cambiata) e solo con l'ok ai sub-responsabili. Non lancia.
 */
import { sql } from "drizzle-orm";
import { CONTEXT_BRIEF_TIMEOUT_MS, ClaudeRefusalError, logClaudeTimeout, stoppedByDeadline } from "@/lib/ai/models";
import { generateContextBrief } from "@/lib/context/brief/generate";
import { briefFactsHash, buildBriefPrompt, cleanBriefLines, BRIEF_FACTS_IN_PROMPT } from "@/lib/context/brief/prompt";
import { liveLines } from "@/lib/context/live";
import { CONTEXT_LIMITS, type ContextSection } from "@/lib/context/vocab";
import { db } from "@/lib/db";
import { logSafeError } from "@/lib/log/safe-error";
import { contextAiConsentNow } from "./context-consent";
import { loadLiveDiscovery } from "./context-discovery";
import { isUuid, rowsOf, toDate } from "./context-shared";
import { contextStoreReady } from "./context-store";
import { getWorkspaceById } from "./workspaces";

const LOG_SCOPE = "context/brief";

export type BriefRefresh = "aggiornato" | "invariato" | "ok_mancante" | "vuoto" | "recente" | "non_riuscito";

/** Chi legge «In breve» può essere chiunque apra la pagina: i dati della Discovery entrano senza le cifre dei revisori. */
const EVERYONE = { role: "contributor", isLateralSpace: false } as const;

/**
 * Riscrive «In breve» dai fatti «Per tutti» attivi e dai dati della Discovery. `invariato`: l'impronta
 * (`facts_hash`) è quella di prima. `vuoto`: meno di 3 voci, la riga si cancella. `recente`: scritto da meno di
 * 10 minuti e `force` non è vero. Non lancia.
 */
export async function refreshContextBrief(workspaceId: string, opts: { force?: boolean; timeoutMs?: number } = {}): Promise<BriefRefresh> {
  try {
    if (!isUuid(workspaceId) || !(await contextStoreReady())) return "non_riuscito";
    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) return "non_riuscito";
    const [factRows, live, briefRows] = await Promise.all([
      db.execute(sql`
        SELECT id, version, section, statement FROM context_facts
        WHERE workspace_id = ${workspaceId}::uuid AND status = 'attivo' AND visibility = 'tutti'
        ORDER BY last_confirmed_at DESC, id LIMIT ${BRIEF_FACTS_IN_PROMPT}`),
      loadLiveDiscovery(workspace, EVERYONE),
      db.execute(sql`SELECT facts_hash, generated_at FROM context_briefs WHERE workspace_id = ${workspaceId}::uuid`),
    ]);
    const facts = rowsOf<{ id: string; version: number; section: ContextSection; statement: string }>(factRows);
    const lines = liveLines(live);
    const [current] = rowsOf<{ facts_hash: string; generated_at: unknown }>(briefRows);

    // Troppo poco per un riassunto: il blocco non si vede.
    if (facts.length + lines.length < CONTEXT_LIMITS.briefMinItems) {
      if (current) await db.execute(sql`DELETE FROM context_briefs WHERE workspace_id = ${workspaceId}::uuid`);
      return "vuoto";
    }
    const hash = briefFactsHash(facts.map((f) => ({ id: f.id, version: Number(f.version) })), lines);
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
    await db.execute(sql`
      INSERT INTO context_briefs (workspace_id, lines, facts_hash, generated_at)
      VALUES (${workspaceId}::uuid, ${JSON.stringify(clean)}::jsonb, ${hash}, now())
      ON CONFLICT (workspace_id) DO UPDATE SET lines = EXCLUDED.lines, facts_hash = EXCLUDED.facts_hash, generated_at = EXCLUDED.generated_at`);
    return "aggiornato";
  } catch (error) {
    logSafeError(LOG_SCOPE, "riassunto_non_riuscito", error, { workspaceId });
    return "non_riuscito";
  }
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
    // I workspace con un fatto «Per tutti» cambiato dopo l'ultimo riassunto, o senza riassunto.
    workspaces = rowsOf<{ workspace_id: string }>(
      await db.execute(sql`
        SELECT f.workspace_id FROM context_facts f LEFT JOIN context_briefs b ON b.workspace_id = f.workspace_id
        WHERE f.visibility = 'tutti' AND (b.workspace_id IS NULL OR f.updated_at > b.generated_at)
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
