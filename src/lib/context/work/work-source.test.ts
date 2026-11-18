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
  "function perimeterNow(",
  "export async function loadAgentContext(",
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
  assert.ok(checked >= 5, `${checked} letture controllate`);
});

test("`--dal` conta i fatti che chi legge il caso vede adesso e quelli che vedeva allora, anche cambiati sul posto: solo «Per tutti»", () => {
  const now = topLevelFunction(source, "function perimeterNow(");
  assert.match(now, /f\.status = 'attivo' AND f\.visibility = 'tutti' AND \(f\.section IN \('regole', 'parole'\) OR \$\{linkedTo\(workspaceId, useCaseId\)\}\)/);
  const then = topLevelFunction(source, "function perimeterAt(");
  // Com'era il fatto allora: la prima modifica sul posto dopo la data dice com'era (`da`), altrimenti com'è adesso.
  assert.match(then, /AND coalesce\(\$\{firstChange\("visibilita_cambiata"\)\}, f\.visibility\) = 'tutti'/);
  assert.match(then, /coalesce\(\$\{firstChange\("sezione_cambiata"\)\}, f\.section\) IN \('regole', 'parole'\)/);
  assert.match(then, /e\.action IN \('use_case_aggiunto', 'use_case_tolto'\)/);
  assert.match(then, /CASE \$\{linkChange\} WHEN 'use_case_tolto' THEN true WHEN 'use_case_aggiunto' THEN false/);
  assert.doesNotMatch(then, /seesLateralSpace|isLateralSpace|contextAbilities|\bquote\b/);
  // I conti passano solo da quei due perimetri: mai un fatto «Solo Lateral Space» contato come nuovo.
  const counts = topLevelFunction(source, "async function perimeterCounts(");
  assert.match(counts, /count\(\*\) FILTER \(WHERE \$\{now\} AND CASE WHEN f\.created_at >= \$\{after\} THEN f\.supersedes_id IS NULL ELSE NOT \$\{then\} END\)::int AS added/);
  assert.match(counts, /count\(\*\) FILTER \(WHERE \$\{now\} AND f\.created_at >= \$\{after\} AND f\.supersedes_id IS NOT NULL\)::int AS changed/);
  assert.match(counts, /count\(\*\) FILTER \(WHERE f\.status <> 'superato' AND \$\{then\} AND NOT \$\{now\}\)::int AS retired/);
  // «Modifica» scrive nella storia ogni use case legato o slegato sul posto.
  const edit = topLevelFunction(memory, "export async function editFact(");
  assert.match(edit, /\["use_case_aggiunto", id\] as const/);
  assert.match(edit, /\["use_case_tolto", id\] as const/);
  assert.match(edit, /detail: \{ use_case: useCase \}/);
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

// ─── (9b) Gli avvisi in campanella (§2.8) ───────────────────────────

const notices = readFileSync(new URL("../../db/queries/context-notices.ts", import.meta.url), "utf8");
const proposals = readFileSync(new URL("../../db/queries/context-proposals.ts", import.meta.url), "utf8");

test("«Il contesto è cambiato»: chi costruisce e il responsabile dei dossier aperti, mai chi ha agito; da fuori solo per «Per tutti»", () => {
  assert.match(notices, /caseRecipientsSql\(FACTORY_BUILDER_ROLES, i\.scope\)/);
  assert.match(notices, /AND c\.status <> 'chiuso' AND c\.archived_at IS NULL/);
  assert.match(notices, /AND r\.user_id IS DISTINCT FROM \$\{cast\(i\.actorUserId, "uuid"\)\}/);
  assert.match(notices, /ON CONFLICT \(recipient_user_id, use_case_id, kind, rome_day\) DO UPDATE SET last_event_at = now\(\), read_at = NULL/);
  // Chi costruisce da fuori entra solo per gli use case toccati da un fatto «Per tutti».
  assert.match(notices, /bool_or\(f\.visibility = 'tutti'\) AS shared/);
  assert.match(notices, /useCaseIds: shared, scope: await loadBuilderScope\(executor, ucLsDomains\(\)\)/);
  assert.match(notices, /useCaseIds: internal, scope: NO_EXTERNAL_BUILDERS/);
  // «Una risposta per «Cosa serve»»: ai revisori, come «Risposte arrivate».
  assert.match(notices, /notifyReviewersSql\(\{ workspaceId: ws, useCaseId, kind: "dalla_call", actorUserId \}\)/, "l'orologio è quello del database");
  // Non lanciano: senza la 0041 niente, un errore nel log.
  for (const signature of ["export async function notifyContextChange(", "export async function notifyUseCasesContextChange(", "export async function notifyNeedAnswered("]) {
    const body = topLevelFunction(notices, signature);
    assert.match(body, /if \(!\(await contextWorkReady\(\)\)\) return;/, signature);
    assert.match(body, /\} catch \(error\) \{\s+logSafeError\(LOG_SCOPE, /, signature);
    assert.ok(!/\bthrow\b/.test(body), signature);
  }
});

test("le scritture che cambiano un fatto avvisano dopo il batch riuscito; una riconferma no", () => {
  const after = (body: string, call: string) => {
    const batch = body.lastIndexOf("await db.batch(", body.indexOf(call));
    assert.ok(batch > 0 && body.indexOf(call) > batch, `${call}: dopo il batch`);
  };
  const write = topLevelFunction(memory, "export async function writeFact(");
  after(write, "await notifyContextChange({ workspaceId: ws, actorUserId: actor.userId, factIds: [factId] });");
  const edit = topLevelFunction(memory, "export async function editFact(");
  // «Modifica»: solo gli use case la cui vista cambia, letti prima del batch (anche quelli che la modifica toglie).
  after(edit, "await notifyUseCasesContextChange({ workspaceId: ws, actorUserId: actor.userId, targets: noticeTargets(true) });");
  after(edit, "await notifyUseCasesContextChange({ workspaceId: ws, actorUserId: actor.userId, targets: noticeTargets(false) });");
  assert.ok(edit.indexOf("const linkedBefore = [...(await linkedUseCases(ws, factId))];") < edit.indexOf("await db.batch("), "i legami di prima, prima del batch");
  assert.match(edit, /editNoticeTargets\(\{\s+before: \{ visibility: current\.visibility, useCaseIds: linkedBefore \},\s+after: \{ visibility: next\.visibility, useCaseIds: next\.useCaseIds \?\? linkedBefore \},\s+textChanged,/);
  assert.doesNotMatch(edit, /notifyContextChange\(/, "mai tutti gli use case del fatto");
  const retire = topLevelFunction(memory, "export async function retireFact(");
  after(retire, "await notifyContextChange({ workspaceId: ws, actorUserId: actor.userId, factIds: [factId] });");
  const reconfirm = topLevelFunction(memory, "export async function reconfirmFact(");
  assert.doesNotMatch(reconfirm, /notifyContextChange/, "una riconferma non è un cambio");
  const confirm = topLevelFunction(proposals, "export async function confirmProposals(");
  const batch = confirm.indexOf("await db.batch(statements");
  const notify = confirm.indexOf("if (newFacts.size > 0) await notifyContextChange({ workspaceId: ws, actorUserId: actor.userId, factIds: [...newFacts.keys()] });");
  assert.ok(batch > 0 && notify > batch, "la conferma avvisa dopo il batch, solo con fatti scritti");
});

// ─── (9b) I legami con «Cosa serve» (§2.2, §3.2) ─────────────────────

test("«Una call risponde»: solo i revisori, solo un fatto «Per tutti» attivo, solo richieste aperte del cliente; si decide solo un legame aperto", () => {
  const needs = readFileSync(new URL("../../db/queries/context-needs.ts", import.meta.url), "utf8");
  const list = topLevelFunction(needs, "export async function listNeedLinks(");
  assert.match(list, /if \(!contextAbilities\(actor\)\.canSeeReviewerSources /);
  // Il fatto è la versione attiva in testa alla sua storia (un testo corretto non fa sparire la riga), sempre «Per tutti».
  assert.match(list, /\$\{headsCte\(ws, sql`SELECT link_id, fact_id FROM open_links`\)\}/);
  assert.match(list, /JOIN context_facts f ON f\.id = h\.fact_id AND f\.workspace_id = \$\{ws\}::uuid AND f\.status = 'attivo' AND f\.visibility = 'tutti'/);
  assert.match(list, /WHERE l\.workspace_id = \$\{ws\}::uuid AND l\.status = 'aperta'/);
  const heads = topLevelFunction(needs, "function headsCte(");
  assert.match(heads, /JOIN context_facts f ON f\.supersedes_id = c\.fact_id AND f\.workspace_id = \$\{workspaceId\}::uuid WHERE c\.depth < 500/);
  assert.match(heads, /JOIN context_facts h ON h\.id = c\.fact_id AND h\.workspace_id = \$\{workspaceId\}::uuid AND h\.status = 'attivo'/);
  assert.match(list, /n\.type = 'requisito' AND n\.archived_at IS NULL AND \$\{sql\.raw\(CLIENT_SIDE_SQL\("n"\)\)\}/);
  assert.match(list, /n\.status = ANY\(\$\{`\{\$\{OPEN_NEED_STATUSES\.join\(","\)\}\}`\}::text\[\]\)/);
  const decide = topLevelFunction(needs, "async function decideNeedLink(");
  assert.match(decide, /const allowed = await gate\(actor, "canSeeReviewerSources"\);/);
  assert.match(decide, /if \(!\(await contextWorkReady\(\)\)\) return notReady\(\);/);
  assert.match(decide, /WHERE l\.id = \$\{linkId\}::uuid AND l\.workspace_id = \$\{ws\}::uuid AND l\.status = 'aperta'/);
  assert.match(decide, /const factId = link\.head_id \?\? link\.fact_id;/, "chi decide decide sulla versione attiva");
  assert.match(decide, /actorUserId: null/, "nella storia senza chi ha deciso");
});

// ─── (9b) `unbundle impara`, `unbundle nota`, le fonti nuove (§2.5, §3.2, §4.5) ──

test("`impara`: una fonte «impara:» già letta e una proposta «Solo Lateral Space», detta, senza citazione; il tetto del giorno per workspace", () => {
  const learning = readFileSync(new URL("../../db/queries/context-learning.ts", import.meta.url), "utf8");
  const body = topLevelFunction(learning, "export async function addLearning(");
  assert.match(body, /const allowed = await gate\(actor, "canOpen"\);/);
  assert.match(body, /const scan = scanStatement\(text\);\s+if \(!scan\.ok\) return invalid\(/);
  assert.match(body, /const section = input\.section \?\? "sistemi";/);
  assert.match(body, /rateLimitBucket\("ctx", "ws", ws, "impara", "day"\), window: "day", limit: CONTEXT_LIMITS\.learnsPerDayWorkspace/);
  assert.match(body, /'appunti', 'cli', \$\{title\}/);
  assert.match(body, /\$\{`\$\{LEARNED_SOURCE_PREFIX\}\$\{sourceId\}`\}, 'ls', 'letto'/);
  assert.match(body, /INSERT INTO context_proposals \(id, workspace_id, source_id, position, kind, statement, basis, section, visibility, target_fact_id, use_case_ids\)/);
  assert.match(body, /\$\{kind\}, \$\{text\}, 'detto', \$\{section\}, 'ls'/);
  assert.doesNotMatch(body, /\bquote\b/, "nessuna citazione");
  // Un fatto «Solo Lateral Space» non si rivela a chi non è di Lateral Space; nemmeno una proposta riservata.
  assert.match(body, /WHERE workspace_id = \$\{ws\}::uuid AND status = 'attivo' AND \(\$\{lateralSpace\} OR visibility = 'tutti'\)/);
  assert.match(body, /AND \(\$\{lateralSpace\} OR \(s\.origin = 'cli' AND s\.external_id LIKE \$\{`\$\{LEARNED_SOURCE_PREFIX\}%`\}\)\)/);
  // Il controllo dentro la transazione guarda già solo le cose imparate.
  assert.match(body, /WHERE p\.workspace_id = \$\{ws\}::uuid AND p\.status = 'aperta' AND s\.origin = 'cli' AND s\.external_id LIKE \$\{`\$\{LEARNED_SOURCE_PREFIX\}%`\}/);
});

test("«Da confermare»: le proposte delle risposte del referente e delle cose imparate non sono mai preselezionate", () => {
  const view = topLevelFunction(proposals, "async function loadViewContext(");
  assert.match(view, /isClientSource\(\{ kind: src\.kind, visibility: src\.visibility, addedByLateralSpace: [\s\S]*?\}\) \|\|\s+isLearnedSource\(\{ origin: src\.origin, externalId: src\.external_id \}\)/);
  assert.match(proposals, /learned: isLearnedSource\(\{ origin: j\.origin, externalId: j\.externalId \}\),/);
});

test("`nota` ammette l'origine «cli»; una fonte di risposte non ha «Togli» e non si toglie", () => {
  const sources = readFileSync(new URL("../../db/queries/context-sources.ts", import.meta.url), "utf8");
  assert.match(sources, /origin: "web" \| "claude" \| "granola" \| "cli";/);
  assert.match(sources, /if \(origin !== "web" && origin !== "claude" && origin !== "granola" && origin !== "cli"\) fieldErrors\.origin/);
  assert.match(sources, /: row\.kind === "risposta" \? false : lateralSpace,/);
  const remove = topLevelFunction(sources, "export async function removeContextSource(");
  assert.match(remove, /if \(source\.kind === "risposta"\) return denied\(\);/);
});

// ─── (9b, D2) «Chiedi al contesto»: le risposte del referente ────────

test("«Chiedi al contesto» e ask_context: una risposta del referente solo con l'informativa che lo permette e data dopo averla accettata", () => {
  const ask = readFileSync(new URL("../../db/queries/context-ask.ts", import.meta.url), "utf8");
  assert.match(ask, /LEFT JOIN use_case_referent_requests r ON r\.id = a\.request_id AND r\.workspace_id = a\.workspace_id/);
  assert.match(ask, /r\.privacy_notice_version = ANY\(\$\{`\{\$\{REFERENT_CONTEXT_NOTICE_VERSIONS\.join\(","\)\}\}`\}::text\[\]\)/);
  assert.match(ask, /AND coalesce\(a\.edited_at, a\.submitted_at\) >= r\.privacy_accepted_at\)\)/);
  assert.match(ask, /rows\.filter\(\(row\) => row\.source === "revisore" \|\| noticeAllowsContext\(row\.notice\)\)/);
});
