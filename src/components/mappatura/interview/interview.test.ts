import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";
import { copyScopeOfFile, findHubForbidden } from "../../../lib/use-cases/copy-guard.ts";
import { parseCss } from "../../theme/test-support/board-css.ts";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { WIDE_QUERY } from "../board/prefs.ts";

// (Rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7) L'«Intervista iniziale», prima «Discovery», allo stesso indirizzo: la
// stessa chat dell'assistente della board, nella sua grafica, con il riepilogo accanto (un foglio dove non sta). La
// conversazione resta quella di sempre (`leadership_setup`), con i suoi messaggi salvati, la stessa rotta e lo stesso
// caricamento dei documenti. Resa sul server con il Chat vero di AI SDK; il router e l'azione dell'ok sono finti.

await installAppModules({
  "@/lib/actions/uc-subprocessors": `export async function declareSubprocessorsAction() { return { ok: true }; }`,
  "next/navigation": `export function useRouter() { return { refresh() {}, push() {} }; }`,
});
await enableTsxImports();
const { Interview, SUMMARY_SHEET, acceptSummarySheet } = await import("./interview.tsx");
const { InterviewSummary, SUMMARY_ROWS, goalTagText, summaryEmpty, summaryFromRoute } = await import("./summary.tsx");
const { INTERVIEW_ACCEPT, uploadInterviewDocument } = await import("./documents.tsx");
const { INTERVIEW_CONVERSATION, createInterviewChat, interviewSeed } = await import("./session.ts");
const { INTERVIEW_TEXT, INTERVIEW_TOOL_LABELS } = await import("./text.ts");
const { TOOL_LABELS } = await import("../../agent/chat-view.ts");
const { MessageView } = await import("../companion/companion.tsx");

const WS = "8a6f3c2e-1b4d-4e5f-9a7b-0c1d2e3f4a5b";
const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const h = <P extends object>(type: (props: P) => ReactNode, props: Omit<P, "children"> | null = null, ...children: ReactNode[]) =>
  createElement(type as unknown as FunctionComponent<Omit<P, "children">>, props, ...children);
const decode = (text: string) => text.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => decode(renderToStaticMarkup(element));
/** Il testo che si legge: senza tag. */
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const interview = (initialMessages: Array<{ id: string; role: "user" | "assistant"; content: string }> = []) => html(h(Interview, { workspaceId: WS, initialMessages, initialSheet: null }));

// ─── Le scritte ──────────────────────────────────────────────────────

test("le scritte: il benvenuto in una riga, tre risposte pronte, il promemoria; in italiano, senza le parole vietate", () => {
  assert.doesNotMatch(INTERVIEW_TEXT.welcome, /\n/);
  assert.match(INTERVIEW_TEXT.welcome, /\*\*[^*]+\?\*\*$/, "la domanda in grassetto");
  assert.equal(INTERVIEW_TEXT.suggestions.length, 3);
  assert.equal(INTERVIEW_TEXT.title, "Intervista iniziale");
  assert.equal(INTERVIEW_TEXT.nudge, "Rispondi per continuare l'intervista.");
  const all = [
    INTERVIEW_TEXT.title,
    INTERVIEW_TEXT.welcome,
    ...INTERVIEW_TEXT.suggestions,
    INTERVIEW_TEXT.nudge,
    INTERVIEW_TEXT.documents.upload,
    INTERVIEW_TEXT.documents.uploading,
    INTERVIEW_TEXT.documents.failed("piano.pdf"),
    INTERVIEW_TEXT.summary.title,
    INTERVIEW_TEXT.summary.empty,
    INTERVIEW_TEXT.summary.value,
    INTERVIEW_TEXT.summary.goals,
    INTERVIEW_TEXT.summary.differs("logistica, assistenza"),
    INTERVIEW_TEXT.summary.showAll(5),
  ];
  for (const text of all) {
    assert.deepEqual(findHubForbidden(text, "area"), [], text);
    assert.doesNotMatch(text, /\b(discovery|value thesis|leadership|enterprise|scaling|upload|doc)\b/i, text);
  }
});

test("le etichette dei tool: quelle di sempre, con l'italiano semplice al posto di «value thesis» e «terminologia»", () => {
  for (const name of ["saveCompanyFacts", "saveCompanyValueThesis", "saveSystemBoundary", "saveUnitTerminology", "createDepartment", "saveStrategicGoal"]) {
    const labels = INTERVIEW_TOOL_LABELS[name];
    assert.ok(labels, name);
    for (const text of [labels.active, labels.done]) assert.doesNotMatch(text, /\b(value thesis|thesis|terminologia|intent)\b/i, `${name}: ${text}`);
  }
  assert.deepEqual(INTERVIEW_TOOL_LABELS.createDepartment, TOOL_LABELS.createDepartment, "le altre restano quelle di sempre");
  assert.match(TOOL_LABELS.saveCompanyValueThesis.done, /value thesis/i, "fuori dall'intervista nulla cambia");
});

test("la guardia delle parole controlla l'intervista: la rotta e i suoi componenti stanno nell'area", () => {
  for (const file of [
    "src/app/(dashboard)/dashboard/[workspaceId]/setup/leadership/page.tsx",
    "src/app/(dashboard)/dashboard/[workspaceId]/setup/leadership/layout.tsx",
    "src/components/mappatura/interview/interview.tsx",
    "src/components/mappatura/interview/summary.tsx",
    "src/components/mappatura/interview/text.ts",
  ]) {
    assert.equal(copyScopeOfFile(file), "area", file);
  }
});

test("una risposta con i tool dell'intervista: le etichette in italiano semplice, finito con la spunta", () => {
  const message = {
    id: "a1",
    role: "assistant" as const,
    parts: [
      { type: "text" as const, text: "Ho salvato." },
      { type: "tool-saveCompanyValueThesis", toolCallId: "t1", state: "output-available", input: {}, output: { success: true } },
      { type: "tool-saveUnitTerminology", toolCallId: "t2", state: "input-available", input: {} },
    ],
  };
  const out = html(h(MessageView, { message: message as never, arriving: true, labels: INTERVIEW_TOOL_LABELS }));
  assert.match(out, /Valore dell'azienda salvato/);
  assert.match(out, /Salvo come chiamate le unità/);
  assert.doesNotMatch(out, /value thesis|terminologia/i);
});

// ─── La conversazione ────────────────────────────────────────────────

test("la conversazione parte dai messaggi salvati, o dal benvenuto", () => {
  assert.deepEqual(interviewSeed([]), [{ id: "welcome", role: "assistant", parts: [{ type: "text", text: INTERVIEW_TEXT.welcome }] }]);
  assert.deepEqual(interviewSeed([{ id: "m1", role: "user", content: "Siamo un'officina" }]), [{ id: "m1", role: "user", parts: [{ type: "text", text: "Siamo un'officina" }] }]);
});

test("una risposta va alla rotta di sempre, con il workspace e il tipo della Discovery; niente unità, solo il testo dei turni", async () => {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const chat = createInterviewChat({ workspaceId: WS, initialMessages: [], fetch: fakeFetch });
  await chat.sendMessage({ role: "user", parts: [{ type: "text", text: "Siamo un'azienda manifatturiera" }] }).catch(() => undefined);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "/api/ai/chat");
  assert.equal(INTERVIEW_CONVERSATION, "leadership_setup");
  assert.equal(sent[0].body.workspaceId, WS);
  assert.equal(sent[0].body.conversationType, "leadership_setup");
  assert.equal("departmentId" in sent[0].body, false);
  assert.deepEqual(sent[0].body.messages, [
    { role: "assistant", content: INTERVIEW_TEXT.welcome },
    { role: "user", content: "Siamo un'azienda manifatturiera" },
  ]);
});

// ─── La pagina ───────────────────────────────────────────────────────

test("la pagina: il percorso «Contesto › Intervista iniziale», il titolo, la chat della board con il benvenuto e tre risposte, «Carica documenti»", () => {
  const out = interview();
  assert.match(out, /^<div class="b-board b-iv" data-b="interview">/, "una board: valgono le sue regole del tocco (44 px, campi a 16 px)");
  assert.match(out, new RegExp(`<a href="/dashboard/${WS}/contesto">Contesto</a><span class="b-x" aria-hidden="true">›</span><span class="b-path-here" aria-current="page">Intervista iniziale</span></nav>`));
  assert.doesNotMatch(out, /vista=processi/, "l'intervista non sta nei Processi");
  assert.match(out, /<h1 class="b-title" style="margin-top:8px"><span data-b="title">Intervista iniziale<\/span><\/h1>/);
  assert.equal(out.match(/<h1\b/g)?.length, 1);
  assert.match(out, /<div class="b-iv-chat" data-b="interview-chat"><div class="b-comp" data-b="companion">/);
  assert.match(out, /Partiamo dall'azienda: <strong>come si chiama e di cosa si occupa\?<\/strong>/);
  assert.equal(out.match(/class="b-fchip"/g)?.length, 3);
  for (const suggestion of INTERVIEW_TEXT.suggestions) assert.ok(out.includes(`>${suggestion}</button>`), suggestion);
  assert.match(out, /<input type="file" accept="\.pdf,\.docx,\.xlsx,\.pptx,\.csv,\.tsv,\.txt,\.md" multiple="" hidden="" tabindex="-1" aria-hidden="true" data-b="interview-files"\/>/);
  assert.match(out, /data-action="upload"[^>]*>Carica documenti<\/button>/);
  assert.match(out, /<textarea class="b-input b-comp-input" rows="1" aria-label="Messaggio per l'assistente" placeholder="Scrivi qui…"/);
});

test("un solo pulsante pieno: «Invia», perché rispondere è il prossimo passo; «Riepilogo» e «Carica documenti» contornati", () => {
  const out = interview();
  assert.equal(out.match(/data-variant="primary"/g)?.length, 1);
  assert.match(out, /<button aria-label="Invia" title="Invia" data-action="send" type="submit" class="b-btn b-primary" data-b="button" data-variant="primary">/);
  assert.match(out, /<button aria-haspopup="dialog" aria-expanded="false" data-action="summary" type="button" class="b-btn b-small b-iv-open" data-b="button" data-variant="outline">Riepilogo<\/button>/);
});

test("il riepilogo: una colonna accanto alla chat con il suo titolo (letto dopo l'apertura); il foglio è chiuso", () => {
  const out = interview();
  assert.match(out, /<aside class="b-iv-side" aria-labelledby="([^"]+)" data-b="interview-side"><h2 class="b-iv-side-t" id="\1">Riepilogo<\/h2><div class="b-iv-sum" aria-busy="true" data-b="summary"><\/div><\/aside>/);
  assert.doesNotMatch(out, /data-b="drawer"/);
  assert.equal(acceptSummarySheet(SUMMARY_SHEET), "riepilogo");
  assert.equal(acceptSummarySheet("altro"), null);
  assert.equal(acceptSummarySheet(null), null);
});

test("una conversazione salvata: i messaggi com'erano, senza benvenuto né risposte pronte", () => {
  const out = interview([
    { id: "m1", role: "assistant", content: "Come si chiama l'azienda?" },
    { id: "m2", role: "user", content: "Cliente Demo" },
  ]);
  assert.match(out, /data-role="user"><div class="b-comp-text"><p>Cliente Demo<\/p>/);
  assert.doesNotMatch(out, /Partiamo dall'azienda|b-fchip/);
});

test("in vista: niente inglese, niente codici, poche parole", () => {
  const out = interview();
  const text = words(out);
  assert.deepEqual(findHubForbidden(text, "area"), []);
  assert.doesNotMatch(text, /\b(Discovery|Value Thesis|leadership|KR|upload|doc)\b/);
  assert.ok(text.split(" ").length <= 60, `${text.split(" ").length} parole`);
});

// ─── Il riepilogo ────────────────────────────────────────────────────

const ROUTE = {
  thesis: { coreValueProposition: "Ricambi su misura per le officine, in 24 ore", strategicNodes: ["preventivi rapidi", "magazzino"] },
  departments: [
    { id: "u1", name: "Officina", mappingStatus: "mapped", teamSize: 12 },
    { id: "u2", name: "Magazzino", mappingStatus: "not_started", teamSize: null },
    { id: "u3", name: "Amministrazione", mappingStatus: "not_started", teamSize: 1 },
    { id: "u4", name: "Vendite", mappingStatus: "not_started", teamSize: 4 },
    { id: "u5", name: "Acquisti", mappingStatus: "not_started", teamSize: 2 },
  ],
  goals: [
    { id: "g1", title: "Consegne in 24 ore", type: "objective" },
    { id: "g2", title: "Preventivi entro un'ora", type: "key_result" },
  ],
  term: { singular: "reparto", plural: "reparti" },
};

test("la risposta della rotta, letta con prudenza: un campo che manca vale vuoto", () => {
  const data = summaryFromRoute(ROUTE);
  assert.ok(data);
  assert.equal(data.value, "Ricambi su misura per le officine, in 24 ore");
  assert.deepEqual(data.differs, ["preventivi rapidi", "magazzino"]);
  assert.equal(data.unitsTitle, "Reparti");
  assert.deepEqual(data.units[1], { id: "u2", name: "Magazzino", people: null });
  assert.equal(summaryFromRoute(null), null);
  const empty = summaryFromRoute({ thesis: null, departments: "?", goals: [{ id: "g", title: "" }] });
  assert.ok(empty && summaryEmpty(empty));
  assert.equal(empty?.unitsTitle, "Unità");
  assert.deepEqual([goalTagText("objective"), goalTagText("key_result"), goalTagText("goal")], ["Obiettivo", "Risultato chiave", "Obiettivo"]);
});

test("il riepilogo: dove crea valore, le unità e gli obiettivi; tre righe, poi «Vedi tutti (N)»; i conteggi solo se ci sono", () => {
  const out = html(h(InterviewSummary, { state: { loaded: true, data: summaryFromRoute(ROUTE) } }));
  assert.match(out, /<h3 class="b-sh">Dove crea valore<\/h3><p class="b-iv-text">Ricambi su misura per le officine, in 24 ore<\/p><p class="b-iv-text b-iv-mute">Dove fa la differenza: preventivi rapidi, magazzino<\/p>/);
  assert.match(out, /<h3 class="b-sh">Reparti<small>5<\/small><\/h3><ul class="b-iv-list" aria-label="Reparti">/);
  assert.equal(SUMMARY_ROWS, 3);
  assert.match(out, /<li><span>Officina<\/span><small>12 persone<\/small><\/li><li><span>Magazzino<\/span><\/li><li><span>Amministrazione<\/span><small>1 persona<\/small><\/li><\/ul>/);
  assert.doesNotMatch(out, /Vendite|Acquisti/, "dopo tre righe, a richiesta");
  assert.match(out, /<button aria-expanded="false" data-action="more" type="button" class="b-btn b-ghost b-small" data-b="button" data-variant="ghost">Vedi tutti \(5\)<\/button>/);
  assert.match(out, /<h3 class="b-sh">Obiettivi<small>2<\/small><\/h3>/);
  assert.match(out, /<li><span class="b-tag b-line"[^>]*>Obiettivo<\/span><span>Consegne in 24 ore<\/span><\/li><li><span class="b-tag b-line"[^>]*>Risultato chiave<\/span><span>Preventivi entro un'ora<\/span><\/li>/);
  assert.equal(out.match(/data-action="more"/g)?.length, 1, "due obiettivi: niente «Vedi tutti»");
  assert.doesNotMatch(words(out), /\b(Value Thesis|Nodi|KR|Discovery)\b/);
});

test("senza niente da mostrare una frase sola, senza sezioni vuote; prima della lettura niente", () => {
  const empty = html(h(InterviewSummary, { state: { loaded: true, data: summaryFromRoute({ thesis: null, departments: [], goals: [], term: { singular: "unità", plural: "unità" } }) } }));
  assert.equal(empty, `<div class="b-iv-sum" data-b="summary"><p class="b-iv-empty">${INTERVIEW_TEXT.summary.empty}</p></div>`);
  const failed = html(h(InterviewSummary, { state: { loaded: true, data: null } }));
  assert.match(failed, /b-iv-empty/);
  assert.equal(html(h(InterviewSummary, { state: { loaded: false } })), '<div class="b-iv-sum" aria-busy="true" data-b="summary"></div>');
  // Solo il valore: le altre sezioni non ci sono.
  const value = html(h(InterviewSummary, { state: { loaded: true, data: summaryFromRoute({ thesis: { coreValueProposition: "Ricambi in 24 ore" }, departments: [], goals: [] }) } }));
  assert.doesNotMatch(value, /Obiettivi|<ul/);
});

// ─── I documenti ─────────────────────────────────────────────────────

test("«Carica documenti»: un invio per file con il solo workspace, come la Discovery; il motivo del rifiuto della rotta, mai il suo codice", async () => {
  assert.equal(INTERVIEW_ACCEPT, ".pdf,.docx,.xlsx,.pptx,.csv,.tsv,.txt,.md");
  const forms: FormData[] = [];
  const answer = (status: number, body: unknown) =>
    (async (_url: string | URL | Request, init?: RequestInit) => {
      forms.push(init?.body as FormData);
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  const file = new File(["testo"], "piano.pdf", { type: "application/pdf" });
  const ok = await uploadInterviewDocument(file, { workspaceId: WS, fetch: answer(200, { id: "d1", sourceId: "s1", fileName: "piano.pdf", summary: "", textRead: true, ai: "ok_mancante" }) });
  assert.deepEqual(ok, { fileName: "piano.pdf", ok: true, doc: { fileName: "piano.pdf", ai: "ok_mancante" } });
  assert.deepEqual([...forms[0].keys()].sort(), ["file", "workspaceId"]);
  assert.equal(forms[0].get("workspaceId"), WS);
  const refused = await uploadInterviewDocument(file, { workspaceId: WS, fetch: answer(400, { error: "troppo_grande", message: "Il file è troppo grande." }) });
  assert.deepEqual(refused, { fileName: "piano.pdf", ok: false, message: "Il file è troppo grande." });
  const bare = await uploadInterviewDocument(file, { workspaceId: WS, fetch: answer(500, { error: "riprova" }) });
  assert.deepEqual(bare, { fileName: "piano.pdf", ok: false, message: "piano.pdf: caricamento non riuscito. Riprova." });
  const offline = await uploadInterviewDocument(file, { workspaceId: WS, fetch: (async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch });
  assert.equal(offline.ok, false);
});

// ─── La rotta, la radice della board, il foglio ──────────────────────

const W = "src/app/(dashboard)/dashboard/[workspaceId]/setup/leadership";

test("la rotta resta `/setup/leadership`: chi è nel workspace, la conversazione di sempre, i messaggi salvati, `?apri=` per il foglio", () => {
  const page = read(`${W}/page.tsx`);
  assert.match(page, /await requireWorkspacePage\(workspaceId\);/);
  assert.match(page, /getActiveConversation\(workspaceId, "leadership_setup"\)/);
  assert.match(page, /conversation \? await getMessages\(conversation\.id\) : \[\]/);
  assert.match(page, /<Interview workspaceId=\{workspaceId\} initialMessages=\{initialMessages\} initialSheet=\{typeof apri === "string" \? apri : null\} \/>/);
  assert.match(page, /export const metadata = \{ title: INTERVIEW_TEXT\.title \};/);
  assert.doesNotMatch(page, /ChatInterface|LeadershipSidebar|DocumentUpload|Discovery"|Compass/);
});

test("la radice della board: i tre fogli e il serif, come il layout della mappatura", () => {
  const layout = read(`${W}/layout.tsx`);
  for (const sheet of ["board.css", "board-views.css", "board-companion.css"]) assert.ok(layout.includes(`import "@/components/mappatura/${sheet}";`), sheet);
  const serif = /Instrument_Serif\(\{ weight: "400", style: \["normal", "italic"\], subsets: \["latin"\], display: "swap", variable: "--font-board-serif" \}\)/;
  assert.match(layout, serif);
  assert.match(read("src/app/(dashboard)/dashboard/[workspaceId]/mapping/layout.tsx"), serif, "lo stesso serif");
  assert.match(layout, /<div data-board-root="" className=\{boardSerif\.variable\}>/);
});

test("alta quanto lo schermo, la conversazione che scorre da sé; il riepilogo accanto da 1280 px, sotto un foglio", () => {
  const views = parseCss(read("src/components/mappatura/board-views.css"));
  const rule = (selector: string, at: string | null = null) => views.find((item) => item.at === at && item.selector === `[data-board-root] ${selector}`)?.declarations;
  assert.equal(rule(".b-iv")?.get("height"), "calc(100dvh - var(--board-shell-top))");
  assert.deepEqual([rule(".b-iv-chat")?.get("overflow-y"), rule(".b-iv-chat")?.get("min-height")], ["auto", "0"]);
  assert.equal(rule(".b-iv-side")?.get("display"), "none");
  const docked = rule(".b-iv-side", `@media ${WIDE_QUERY}`);
  assert.deepEqual([docked?.get("display"), docked?.get("width"), docked?.get("flex")], ["block", "380px", "0 0 380px"]);
  assert.equal(rule(".b-iv-open", `@media ${WIDE_QUERY}`)?.get("display"), "none", "accanto, il bottone del foglio non serve");
  // Il foglio: il drawer della board, con l'indirizzo `?apri=riepilogo`, chiuso dove la colonna sta accanto.
  const source = read("src/components/mappatura/interview/interview.tsx");
  assert.match(source, /const sheetOpen = sheet === SUMMARY_SHEET && !wide;/);
  assert.match(source, /<Drawer open=\{sheetOpen\} onClose=\{\(\) => setSheet\(null\)\} context=\{T\.title\} title=\{T\.summary\.title\}>/);
  assert.match(source, /useSheetParam\(\{ initial: p\.initialSheet \?\? null, accept: acceptSummarySheet \}\)/);
});
