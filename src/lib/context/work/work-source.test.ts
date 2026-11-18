import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Le letture del contesto nel lavoro sul sorgente (RILASCIO-9b-COSTRUZIONE.md §4.3, D1, §2.12): agli agenti e ai prompt
// solo i fatti «Per tutti», mai una citazione; il blocco dei prompt solo dopo l'ok; l'MCP non conta come una visita. Le
// prove sul database stanno in work.integration.test.ts.

const source = readFileSync(new URL("../../db/queries/context-work.ts", import.meta.url), "utf8");
const memory = readFileSync(new URL("../../db/queries/context-memory.ts", import.meta.url), "utf8");

/** Il corpo di una funzione di primo livello, dalla firma alla graffa che la chiude. */
function topLevelFunction(text: string, signature: string): string {
  const start = text.indexOf(signature);
  assert.notEqual(start, -1, `manca: ${signature}`);
  const end = text.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `fine non trovata: ${signature}`);
  return text.slice(start, end + 2);
}

/** Ogni SELECT su una tabella con la visibilità, dentro un pezzo di sorgente: il testo fino alla fine della sua query. */
function queriesOn(text: string, table: string): string[] {
  return [...text.matchAll(new RegExp(`FROM ${table}\\b[\\s\\S]*?\`\\)`, "g"))].map((match) => match[0]);
}

const AGENT_PARTS = [
  "async function agentFacts(",
  "async function perimeterCounts(",
  "export async function loadAgentContext(",
  "export async function contextDeltaSince(",
  "export async function loadPromptContext(",
].map((signature) => [signature, topLevelFunction(source, signature)] as const);

test("agli agenti, al pacchetto e ai prompt solo «Per tutti»: ogni lettura di fatti, impegni e domande lo dice", () => {
  let checked = 0;
  for (const [signature, body] of AGENT_PARTS) {
    assert.doesNotMatch(body, /seesLateralSpace|isLateralSpace|contextAbilities/, `${signature}: non dipende da chi chiede`);
    for (const table of ["context_facts", "context_commitments", "context_questions"]) {
      for (const query of queriesOn(body, table)) {
        checked += 1;
        assert.match(query, /\bvisibility = 'tutti'/, `${signature}: ${table} senza il filtro «Per tutti»`);
      }
    }
  }
  assert.ok(checked >= 6, `${checked} letture controllate`);
});

test("agli agenti e ai prompt mai una citazione, mai chi ha confermato", () => {
  for (const [signature, body] of AGENT_PARTS) {
    assert.doesNotMatch(body, /\bquote\b|confirmed_by_user_id|FACT_COLUMNS/, signature);
  }
});

test("il blocco dei prompt: prima l'ok ai sub-responsabili, poi le letture; senza l'ok niente", () => {
  const body = topLevelFunction(source, "export async function loadPromptContext(");
  const consent = body.indexOf('i.consent === "now" ? await contextAiConsentNow(workspaceId) : await contextAiConsent(workspaceId)');
  assert.ok(consent > 0, "l'ok, riletto per i cron");
  assert.ok(body.indexOf("if (!consent || !(await contextStoreReady())) return \"\";") > consent);
  assert.ok(body.indexOf("db.execute(") > consent, "nessuna lettura prima dell'ok");
  assert.ok(body.indexOf("briefLines(") > consent);
  assert.match(body, /catch \(error\) \{\s+logSafeError\(LOG_SCOPE, "blocco_prompt_non_letto"[\s\S]*?return "";/, "non lancia");
});

test("la scheda e il dossier leggono per chi guarda; l'MCP legge la memoria senza contare una visita", () => {
  const useCase = topLevelFunction(source, "export async function loadUseCaseContext(");
  assert.match(useCase, /\(\$\{lateralSpace\} OR f\.visibility = 'tutti'\)/);
  assert.match(useCase, /const lateralSpace = abilities\.seesLateralSpace;/);
  const load = topLevelFunction(memory, "export async function loadContextMemory(");
  assert.match(load, /const previous = opts\.touchSeen === false \? null : await touchContextSeen\(actor, now\);/);
  assert.match(load, /toCheck: Number\(rowsOf<\{ n: number \}>\(toCheck\)\[0\]\?\.n \?\? 0\)/);
  // «Da verificare» si conta solo per Lateral Space.
  assert.match(load, /lateralSpace\s+\? db\.execute\(sql`SELECT count\(\*\)::int AS n FROM context_facts WHERE workspace_id = \$\{ws\}::uuid AND status = 'attivo' AND needs_check`\)/);
});

test("la notte: dopo i passi della 9a segna i fatti da verificare e toglie i legami orfani, e lo dice nei conti", () => {
  const nightly = readFileSync(new URL("../../db/queries/context-nightly.ts", import.meta.url), "utf8");
  const body = topLevelFunction(nightly, "export async function runContextNightly(");
  const order = ["await readPendingSources(", "await refreshStaleBriefs(", "await purgeExpiredNoteText(o.now)", "await markStaleFacts(o.now)", "await purgeOrphanNeedLinks()"].map((call) => body.indexOf(call));
  assert.ok(order.every((at) => at > 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "nell'ordine");
  assert.match(body, /return \{ \.\.\.reads, briefs, purged, toCheck, links \};/);
  const cron = readFileSync(new URL("../../../app/api/cron/contesto/route.ts", import.meta.url), "utf8");
  assert.match(cron, /toCheck: counts\.toCheck,\s+links: counts\.links,/);
});
