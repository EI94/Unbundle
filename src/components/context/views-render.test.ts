import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import type { MemoryView as MemoryData } from "../../lib/db/queries/context-memory.ts";
import type { OpenProposals, ProposalView } from "../../lib/db/queries/context-proposals.ts";
import type { SourceListItem } from "../../lib/db/queries/context-sources.ts";
import type { AiConsentNoticeData } from "../../lib/db/queries/context-consent.ts";
import type { ContextPageProps } from "./context-page.tsx";

// Le viste della pagina «Contesto» rese sul server (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §7): che cosa vede Lateral
// Space e che cosa vede il cliente, i blocchi che spariscono quando sono vuoti, «Da confermare» con la preselezione e
// il conto del pulsante, la vista «Appunti» e quella «Documenti». Router, link, avvisi e azioni sono finti; le regole
// stanno in view-model.ts, con i loro test: qui si controlla che i componenti le usino.

const REACT = import.meta.resolve("react");
await installAppModules({
  "next/navigation": `export function useRouter() { return { push() {}, refresh() {}, replace() {} }; }
    export function usePathname() { return "/"; }
    export function useSearchParams() { return new URLSearchParams(); }`,
  "next/link": `import React from ${JSON.stringify(REACT)};
    export default function Link({ href, children, prefetch, scroll, replace, ...rest }) { return React.createElement("a", { href: String(href), ...rest }, children); }
    export function useLinkStatus() { return { pending: false }; }`,
  sonner: `export const toast = Object.assign(() => {}, { success() {}, error() {} });`,
  "@/lib/actions/context": [
    "confirmProposalsAction",
    "editProposalAction",
    "discardProposalsAction",
    "writeFactAction",
    "editFactAction",
    "reconfirmFactAction",
    "retireFactAction",
    "closeCommitmentAction",
    "reopenCommitmentAction",
    "closeQuestionAction",
    "addQuestionAction",
    "removeSourceAction",
    "setDocumentVisibilityAction",
  ]
    .map((name) => `export async function ${name}() { return { ok: true, value: true }; }`)
    .join("\n"),
  "@/lib/actions/uc-subprocessors": `export async function declareSubprocessorsAction() { return { ok: true, data: null, message: "" }; }`,
  // (Rilascio 10, §3.7) «Aggiungi un'unità» nella vista «Processi».
  "@/lib/actions/mappatura-units": `export async function addUnitAction() { return { ok: false, message: "" }; }`,
  // (9b) «Cerca una persona» nella vista «Appunti» (people-search.tsx).
  "@/lib/actions/context-people": ["searchPersonAction", "erasePersonAction"].map((name) => `export async function ${name}() { return { ok: false, error: "riprova", message: "" }; }`).join("\n"),
});
await enableTsxImports();
const { MemoryView } = await import("./memory-view.tsx");
const { ConfirmView } = await import("./confirm-view.tsx");
const { NotesView } = await import("./notes-view.tsx");
const { ContextPage } = await import("./context-page.tsx");
const { ProcessesView } = await import("../mappatura/board/processes-view.tsx");
const { fixtureUnits } = await import("../../lib/mappatura/board-fixture.ts");

const WS = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-11-16";

/** Il testo visibile, un pezzo per elemento, con le entità decodificate. */
function textOf(html: string): string[] {
  return html
    .split(/<[^>]+>/)
    .map((piece) => piece.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").trim())
    .filter(Boolean);
}
const render = (element: ReactElement) => renderToStaticMarkup(element);
/** I pulsanti pieni: `[data-slot=button]` con la classe `bg-primary`, come nell'harness delle schermate. */
function filledButtons(html: string): string[] {
  return [...html.matchAll(/<(?:a|button)\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes('data-slot="button"') && (/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? []).includes("bg-primary"));
}
/** La pagina intorno a una vista: i figli come terzo argomento, come li passa React. */
const pageWith = (props: Omit<ContextPageProps, "children">, child: ReactElement) => createElement(ContextPage, props as ContextPageProps, child);

// ─── La Memoria ──────────────────────────────────────────────────────

function memory(over: Partial<MemoryData> = {}): MemoryData {
  return {
    sections: [
      { section: "azienda", live: [{ key: "tesi", section: "azienda", text: "Cucine su misura per il mercato italiano.", tag: null }], facts: [] },
      { section: "persone", live: [], facts: [] },
      { section: "lavoro", live: [], facts: [] },
      {
        section: "sistemi",
        live: [],
        facts: [
          { id: "f1", version: 1, kind: "fatto", section: "sistemi", statement: "Il gestionale è SAP Business One.", basis: "detto", visibility: "tutti", needsCheck: false, sourceKind: "call", sourceLabel: "Call 14 nov", lastConfirmedOn: "2026-11-14" },
          { id: "f2", version: 1, kind: "fatto", section: "sistemi", statement: "I prezzi li decide il commerciale.", basis: "dedotto", visibility: "ls", needsCheck: true, sourceKind: "manuale", sourceLabel: "Scritto a mano", lastConfirmedOn: "2026-11-10" },
        ],
      },
      { section: "obiettivi", live: [], facts: [] },
      { section: "regole", live: [], facts: [] },
      { section: "parole", live: [], facts: [] },
    ],
    nextSteps: {
      nostri: [{ id: "c1", version: 1, statement: "Mandare il preventivo.", party: "nostra", roleLabel: "Responsabile del progetto", dueOn: "2026-11-30", overdue: false, visibility: "ls" }],
      cliente: [{ id: "c2", version: 1, statement: "Mandare l'elenco dei fornitori.", party: "cliente", roleLabel: null, dueOn: "2026-11-02", overdue: true, visibility: "tutti" }],
    },
    questions: [{ id: "q1", version: 1, question: "Chi approva gli ordini sopra i 10.000 euro?", askWhom: "Direttore operativo", visibility: "tutti" }],
    brief: { lines: ["Produce cucine su misura.", "Usa SAP Business One."], updatedOn: "2026-11-14" },
    novelties: { items: [{ factId: "f1", statement: "Il gestionale è SAP Business One.", section: "sistemi", tag: "cambiato" }], more: 3 },
    counts: { facts: 2, openProposals: 12, unreadSources: 2, pendingSourceIds: ["s1", "s2"], toCheck: 0 },
    ...over,
  };
}

const NOTICE: AiConsentNoticeData = {
  workspaceId: WS,
  companyName: "Cliente di prova",
  declarer: "lateral_space",
  listVersion: "2026-10",
  statement: "Lateral Space registra l'autorizzazione per conto del cliente.",
  suppliers: ["Anthropic"],
  buttonLabel: "Registra l'ok di Cliente di prova",
  settingsHref: `/dashboard/${WS}/settings#sub-responsabili`,
};

const memoryProps = (over: Record<string, unknown> = {}) => ({ workspaceId: WS, today: TODAY, lateralSpace: true, canEditMemory: true, memory: memory(), useCaseOptions: [], consentNotice: null, ...over });
const headerProps = (over: Partial<ContextPageProps>): Omit<ContextPageProps, "children"> => ({
  workspaceId: WS,
  today: TODAY,
  tab: "memoria",
  lateralSpace: true,
  canEditMemory: true,
  canUpload: true,
  useCaseOptions: [],
  consentNotice: null,
  ...over,
});

/** I titoli H2, anche quelli delle pieghe (il titolo sta dentro il pulsante): il testo senza i tag. */
function headingsOf(html: string): string[] {
  return [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => textOf(m[1])[0] ?? "");
}
/** Il testo di una piega: il titolo e la riga grigia. */
function foldsOf(html: string): Array<{ title: string; summary: string; expanded: boolean }> {
  return [...html.matchAll(/<section[^>]*data-slot="fold"[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => {
    const [title, summary = ""] = textOf(m[1]);
    return { title, summary, expanded: /aria-expanded="true"/.test(m[1]) };
  });
}

const UNIT = "22222222-2222-4222-8222-222222222222";

test("(rilascio 10, §3.7, S6) la Memoria per Lateral Space: «Chiedi al contesto», una riga di stato, «In breve», «Impegni», «Novità», le sezioni chiuse", () => {
  const html = render(createElement(MemoryView, memoryProps({ consentNotice: NOTICE, granola: createElement("p", null, "riga di Granola"), reader: createElement("p", null, "riga di lettura") })));
  const text = textOf(html);
  // «Chiedi al contesto» in alto, con l'esempio.
  assert.match(html, /placeholder="Per esempio: che gestionale usano\?"/);
  assert.ok(html.indexOf('placeholder="Per esempio') < html.indexOf("In breve"), "la domanda prima di tutto");
  // Una sola riga di stato: le righe restano montate (la lettura e il giro di Granola partono da sé), si vede la prima.
  const status = /<div data-slot="status-row" class="([^"]*)">([\s\S]*?)<\/div>\s*<section/.exec(html);
  assert.ok(status, "la riga di stato c'è");
  assert.match(status[1], /\[&amp;&gt;\*:not\(:first-child\)\]:hidden/, "si vede solo la prima");
  const order = ["riga di lettura", "ai-consent-notice", "riga di Granola"].map((needle) => status[2].indexOf(needle));
  assert.ok(order.every((at) => at >= 0) && order[0] < order[1] && order[1] < order[2], `ordine ${order}`);
  // (Rilascio 10, §3.7) Le proposte da confermare sono il pulsante pieno della testata: qui non si ripetono.
  assert.ok(!text.includes("12 proposte da confermare"));
  // «In breve» con la data.
  assert.ok(text.includes("In breve") && text.includes("Aggiornato il 14 nov") && text.includes("Produce cucine su misura."));
  // «Impegni»: una lista sola, la parte davanti alla frase, prima lo scaduto; «Fatto» fantasma con la frase per i lettori di schermo.
  assert.ok(text.includes("Impegni"));
  assert.ok(text.indexOf("Mandare l'elenco dei fornitori.") < text.indexOf("Mandare il preventivo."), "lo scaduto prima");
  assert.ok(text.includes("Del cliente ·") && text.includes("Nostri ·"));
  assert.ok(text.includes("entro il 30 nov") && text.includes("scaduto il 2 nov"));
  const done = [...html.matchAll(/<button\b[^>]*>Fatto<\/button>/g)].map(([tag]) => tag);
  assert.equal(done.length, 2);
  for (const tag of done) assert.match(tag, /aria-describedby="[^"]+"/);
  // «Novità»: il segno, la frase e la fonte del fatto; «e altre 3».
  assert.ok(text.includes("Novità") && !text.includes("Novità per te") && text.includes("Cambiato") && text.includes("e altre 3"));
  assert.ok(text.includes("Call 14 nov"));
  // Le sezioni chiuse, con quante voci hanno, nell'ordine; «Domande aperte» in fondo, chiusa anche lei.
  assert.deepEqual(headingsOf(html), ["In breve", "Impegni", "Novità", "Azienda", "Sistemi e dati", "Domande aperte"]);
  assert.deepEqual(foldsOf(html), [
    { title: "Azienda", summary: "1", expanded: false },
    { title: "Sistemi e dati", summary: "2", expanded: false },
    { title: "Domande aperte", summary: "1", expanded: false },
  ]);
  // Dentro le pieghe (nascoste finché chiuse): i fatti con i loro segni, la Discovery come «Intervista iniziale», «Chiudi».
  assert.ok(text.includes("Intervista iniziale") && text.includes("Scritto a mano"));
  assert.ok(text.includes("dedotto") && text.includes("da verificare"));
  assert.ok(text.includes("Solo Lateral Space"), "il lucchetto ha il testo per i lettori di schermo");
  assert.ok(text.includes("Da chiedere a: Direttore operativo") && text.includes("Chiudi") && !text.includes("Chiusa"));
  assert.match(html, /<button\b[^>]*aria-describedby="[^"]+"[^>]*>Chiudi<\/button>/);
});

test("(rilascio 10, §3.7) la Memoria: al massimo tre impegni e tre novità in vista, poi «Vedi tutti (N)»; tre righe di «In breve»", () => {
  const commitment = (i: number) => ({ id: `c${i}`, version: 1, statement: `Impegno numero ${i}.`, party: "nostra" as const, roleLabel: null, dueOn: `2026-11-2${i}`, overdue: false, visibility: "tutti" as const });
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ factId: `n${i}`, statement: `Novità numero ${i}.`, section: "sistemi" as const, tag: "nuovo" as const }));
  const html = render(
    createElement(
      MemoryView,
      memoryProps({
        memory: memory({
          nextSteps: { nostri: [1, 2, 3, 4, 5].map(commitment), cliente: [] },
          novelties: { items: items(5), more: 2 },
          brief: { lines: ["Uno.", "Due.", "Tre.", "Quattro.", "Cinque."], updatedOn: "2026-11-14" },
        }),
      }),
    ),
  );
  const text = textOf(html);
  assert.deepEqual([1, 2, 3, 4, 5].map((i) => text.includes(`Impegno numero ${i}.`)), [true, true, true, false, false]);
  assert.ok(text.includes("Vedi tutti (5)"));
  assert.deepEqual([0, 1, 2, 3].map((i) => text.includes(`Novità numero ${i}.`)), [true, true, true, false]);
  assert.ok(text.includes("e altre 4"), "le due oltre le tre e le due che la pagina non ha");
  assert.deepEqual(["Uno.", "Tre.", "Quattro."].map((line) => text.includes(line)), [true, true, false]);
  assert.ok(text.includes("Mostra tutto"));
});

test("(rilascio 10, §3.7) «Come lavorano» porta alle board, «Obiettivi e priorità» alla pagina degli obiettivi", () => {
  const sections = memory().sections.map((s) =>
    s.section === "lavoro"
      ? { ...s, live: [{ key: `unita:${UNIT}`, section: "lavoro" as const, text: "Acquisti · 4 persone · 7 passi mappati", tag: null }] }
      : s.section === "obiettivi"
        ? { ...s, live: [{ key: "obiettivo:g1", section: "obiettivi" as const, text: "Rispondere in giornata", tag: "Obiettivo" }] }
        : s,
  );
  const html = render(createElement(MemoryView, memoryProps({ memory: memory({ sections }) })));
  assert.match(html, new RegExp(`<a href="/dashboard/${WS}/mapping/${UNIT}"[^>]*>`));
  assert.deepEqual(foldsOf(html).find((fold) => fold.title === "Come lavorano"), { title: "Come lavorano", summary: "1 unità", expanded: false });
  assert.equal((html.match(new RegExp(`href="/dashboard/${WS}/strategy"`, "g")) ?? []).length, 2, "la riga dell'obiettivo e il link «Obiettivi»");
});

test("la Memoria per il cliente: niente riga di stato, niente «Fatto» né «Chiudi»", () => {
  const html = render(createElement(MemoryView, memoryProps({ lateralSpace: false, canEditMemory: false, consentNotice: NOTICE, granola: createElement("p", null, "riga di Granola"), reader: createElement("p", null, "riga di lettura") })));
  const text = textOf(html);
  assert.equal(text.includes("12 proposte da confermare"), false);
  assert.equal(text.includes("riga di Granola") || text.includes("riga di lettura"), false);
  assert.doesNotMatch(html, /ai-consent-notice|status-row/);
  assert.equal(text.includes("Fatto") || text.includes("Chiudi"), false);
  assert.ok(text.includes("Il gestionale è SAP Business One."));
  assert.match(html, /placeholder="Per esempio: che gestionale usiamo\?"/);
});

test("la Memoria vuota: una frase sola, senza pulsante (l'azione è «Aggiungi», nella testata)", () => {
  const empty = memory({
    sections: memory().sections.map((s) => ({ ...s, live: [], facts: [] })),
    nextSteps: { nostri: [], cliente: [] },
    questions: [],
    brief: null,
    novelties: null,
    counts: { facts: 0, openProposals: 0, unreadSources: 0, pendingSourceIds: [], toCheck: 0 },
  });
  const client = render(createElement(MemoryView, memoryProps({ lateralSpace: false, canEditMemory: false, memory: empty })));
  assert.ok(textOf(client).includes("Qui compare quello che sappiamo dell'azienda, con le fonti."));
  const page = render(pageWith(headerProps({}), createElement(MemoryView, memoryProps({ memory: empty }))));
  const text = textOf(page);
  assert.ok(text.includes("Aggiungi gli appunti di una call: Unbundle propone i fatti."));
  assert.equal(filledButtons(page).length, 1, "un solo pulsante pieno: «Aggiungi»");
  assert.match(filledButtons(page)[0], /data-action="context-add"/);
  assert.match(page, /data-slot="empty-state"/);
});

// ─── La testata comune e le viste ────────────────────────────────────


test("(rilascio 10, §3.7, S6) la testata: H1 «Contesto», «Aggiungi», le tre viste; niente nome del workspace né «Scrivi un fatto» a parte", () => {
  const ls = render(pageWith(headerProps({ menu: [{ key: "intervista", label: "Intervista iniziale", href: `/dashboard/${WS}/setup/leadership` }] }), createElement("p", null, "vista")));
  const text = textOf(ls);
  assert.match(ls, /<h1[^>]*>Contesto<\/h1>/);
  assert.ok(!text.includes("Cliente di prova") && !text.includes("Scrivi un fatto") && !text.includes("Aggiungi appunti"));
  assert.ok(text.includes("Aggiungi") && !text.includes("Aggiungi un file"));
  // Le viste: Memoria · Processi · Fonti.
  assert.deepEqual(["Memoria", "Processi", "Fonti"].map((label) => text.includes(label)), [true, true, true]);
  assert.match(ls, new RegExp(`href="/dashboard/${WS}/contesto\\?vista=fonti"`));
  assert.match(ls, /aria-current="page"[^>]*>(<[^>]+>)*Memoria/);
  // Il «⋯» con il suo nome per i lettori di schermo; le voci si aprono a richiesta.
  assert.match(ls, /aria-label="Altre azioni"/);
  // Senza un passo della vista, «Aggiungi» è il pulsante pieno.
  assert.equal(filledButtons(ls).length, 1);
  assert.match(filledButtons(ls)[0], /data-action="context-add"/);
  // Il cliente aggiunge solo file: «Aggiungi un file», niente «⋯» senza voci.
  const client = render(pageWith(headerProps({ lateralSpace: false, canEditMemory: false }), createElement("p", null, "vista")));
  assert.ok(textOf(client).includes("Aggiungi un file"));
  assert.doesNotMatch(client, /aria-label="Altre azioni"/);
  assert.match(client, /data-slot="upload-document"/, "la scelta del file è nella pagina");
});

test("(rilascio 10, §3.7) con proposte da confermare il pulsante pieno è «Conferma N proposte» con il «?», e «Aggiungi» è bordato", () => {
  const step = { kind: "link" as const, icon: "check" as const, label: "Conferma 3 proposte", why: "Unbundle le ha lette dalle fonti: confermale, correggile o scartale.", href: `/dashboard/${WS}/contesto/conferma` };
  const html = render(pageWith(headerProps({ step }), createElement("p", null, "vista")));
  const filled = filledButtons(html);
  assert.equal(filled.length, 1, "un solo pulsante pieno");
  assert.match(filled[0], new RegExp(`href="/dashboard/${WS}/contesto/conferma"`));
  assert.ok(textOf(html).includes("Prossimo passo") && textOf(html).includes("Conferma 3 proposte"));
  assert.match(html, /aria-label="Perché questo passo"/);
  const add = /<button\b[^>]*data-action="context-add"[^>]*>/.exec(html)?.[0] ?? "";
  assert.match(add, /\bbg-background\b/, "«Aggiungi» bordato");
  // Il passo sta sotto il titolo e sopra le viste, nella prima schermata.
  assert.ok(html.indexOf("Conferma 3 proposte") < html.indexOf(">Memoria<") || html.indexOf("Conferma 3 proposte") < html.indexOf("Memoria"));
});

// ─── «Da confermare» ─────────────────────────────────────────────────

let n = 0;
function proposal(over: Partial<ProposalView> = {}): ProposalView {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    version: 1,
    sourceId: "s1",
    kind: "nuovo",
    statement: `Frase numero ${n}.`,
    quote: null,
    basis: "detto",
    section: "sistemi",
    visibility: "tutti",
    preselected: true,
    issue: null,
    issueMessage: null,
    before: null,
    useCases: [],
    party: null,
    roleLabel: null,
    dueOn: null,
    closesQuestion: null,
    ...over,
  };
}

const confirmProps = (open: OpenProposals) => ({ workspaceId: WS, today: TODAY, open, useCaseOptions: [], filteredBySource: true });

test("«Da confermare»: i gruppi nell'ordine, «dedotto» e conflitti senza spunta, «Conferma (n)» con le sole spuntate", () => {
  const open: OpenProposals = {
    sources: [{ id: "s1", kind: "appunti", origin: "web", title: "Call di avvio", occurredOn: "2026-11-14", skipped: { persone: 2 } }],
    proposals: [
      proposal({ statement: "Il gestionale è SAP Business One.", quote: "il gestionale è SAP" }),
      proposal({ statement: "Il magazzino cambierà.", basis: "dedotto", preselected: false }),
      proposal({ kind: "cambia", statement: "Gli ordini sono 40 al giorno.", before: { factId: "f9", statement: "Gli ordini sono 30 al giorno.", sourceLabel: "Call", date: "3 nov" } }),
      proposal({ kind: "conflitto", statement: "Il CRM è HubSpot.", preselected: false, before: { factId: "f8", statement: "Il CRM è Salesforce.", sourceLabel: "Documento", date: "21 ott" } }),
      proposal({ kind: "impegno", section: null, statement: "Mandare il preventivo.", party: "nostra", roleLabel: "Responsabile del progetto", dueOn: "2026-11-30" }),
      proposal({ kind: "domanda", section: null, statement: "Chi approva gli ordini?", roleLabel: "Direttore operativo" }),
      proposal({ statement: "Mario Rossi decide.", issue: "nome_persona", issueMessage: "Non scrivere nomi di persone: indica il ruolo.", preselected: false }),
    ],
    reconfirmed: [proposal({ kind: "conferma", before: { factId: "f7", statement: "Hanno due stabilimenti.", sourceLabel: "Call", date: "1 nov" } })],
  };
  const html = render(createElement(ConfirmView, confirmProps(open)));
  const text = textOf(html);
  assert.ok(text.includes("Da confermare") && text.includes("Dagli appunti «Call di avvio» del 14 nov"));
  const headings = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
  // (Rilascio 10, §3.7) I gruppi con una forma sola.
  assert.deepEqual(headings, ["Nuovi", "Cambiati", "In conflitto", "Impegni", "Domande"]);
  // Spuntate: la «detto», il cambio, l'impegno, la domanda, e le riconferme. Non la «dedotto», non quella con il nome.
  assert.ok(text.includes("Conferma (5)"), text.join(" | "));
  const checkboxes = [...html.matchAll(/<(?:button|span)[^>]*role="checkbox"[^>]*>/g)].map((m) => m[0]);
  assert.equal(checkboxes.length, 7, "sei righe con la casella (il conflitto no) e la riconferma, con la sua");
  assert.equal(checkboxes.filter((tag) => /aria-checked="true"/.test(tag)).length, 5);
  assert.equal(checkboxes.filter((tag) => /aria-disabled="true"|data-disabled/.test(tag)).length, 1, "la riga con il nome non si spunta finché non si corregge");
  // «Cambiano» con «Prima»; il conflitto con «Prima» e «Ora» e le due scelte, nessuna scelta di partenza.
  assert.ok(text.includes("Prima: Gli ordini sono 30 al giorno. (Call, 3 nov)"));
  assert.ok(text.includes("Prima: Il CRM è Salesforce. (Documento, 21 ott)") && text.includes("Ora: Il CRM è HubSpot. (Call 14 nov)"));
  assert.ok(text.includes("Tieni quello di prima") && text.includes("Passa al nuovo") && text.includes("Scegli quale tenere."));
  assert.doesNotMatch(html, /“|”/, "le virgolette dell'app sono «»");
  assert.equal((html.match(/role="radio" aria-checked="true"/g) ?? []).length, 0);
  // I segni, l'impegno, la domanda, il problema da correggere, le riconferme, i non riportati.
  assert.ok(text.includes("dedotto") && text.includes("Nostro") && text.includes("Responsabile del progetto") && text.includes("entro il 30 nov"));
  assert.ok(text.includes("Da chiedere a: Direttore operativo"));
  assert.ok(text.includes("Non scrivere nomi di persone: indica il ruolo."));
  // Un solo blocco di riconferme, chiuso, con il suo conteggio.
  assert.ok(text.includes("Riconfermati") && text.includes("1 · si aggiorna la data") && text.includes("Hanno due stabilimenti."));
  assert.match(html, /<section id="conferma-riconferme"[^>]*data-slot="fold"/);
  assert.ok(text.includes("2 passaggi non riportati: parlavano di persone"));
  // La citazione si apre a richiesta: «Citazione», e il testo nascosto finché non si tocca.
  assert.match(html, /<p id="[^"]+" hidden="" class="[^"]*"><q>il gestionale è SAP<\/q><\/p>/, "la citazione chiusa");
  assert.ok(text.includes("Citazione"));
  // Chi la vede: il lucchetto solo per «Solo Lateral Space», mai «Per tutti».
  assert.equal(text.includes("Per tutti"), false);
  // La riga si modifica toccando la frase; «Scarta» sta nel «⋯» della riga (le voci si aprono a richiesta).
  assert.match(html, /<button type="button" id="[^"]+" aria-expanded="false" class="[^"]*">Il gestionale è SAP Business One\.<\/button>/);
  assert.equal((html.match(/data-action="proposal-menu"/g) ?? []).length, 7);
  assert.equal(text.includes("Scarta") || text.includes("Modifica"), false, "nel «⋯», chiuso");
});

test("«Da confermare»: un solo blocco di riconferme, una casella per fatto: la «detto» spuntata, la «dedotto» no", () => {
  const open: OpenProposals = {
    sources: [{ id: "s1", kind: "appunti", origin: "web", title: "Call di avvio", occurredOn: "2026-11-14", skipped: {} }],
    proposals: [],
    reconfirmed: [
      proposal({ kind: "conferma", before: { factId: "f7", statement: "Hanno due stabilimenti.", sourceLabel: "Call", date: "1 nov" } }),
      proposal({ kind: "conferma", basis: "dedotto", preselected: false, before: { factId: "f6", statement: "Il magazzino è piccolo.", sourceLabel: "Call", date: "2 nov" } }),
    ],
  };
  const html = render(createElement(ConfirmView, confirmProps(open)));
  const text = textOf(html);
  assert.ok(text.includes("2 · si aggiorna la data"), text.join(" | "));
  assert.ok(text.includes("Hanno due stabilimenti.") && text.includes("Il magazzino è piccolo."));
  assert.ok(text.includes("Conferma (1)"), "parte solo la riconferma «detto»");
  const checkboxes = [...html.matchAll(/<(?:button|span)[^>]*role="checkbox"[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(checkboxes.map((tag) => /aria-checked="true"/.test(tag)), [true, false], "la «detto» spuntata, la «dedotto» no");
});

test("«Da confermare»: un conflitto che viene da un documento dice «Documento 14 nov», non «Call»", () => {
  const open: OpenProposals = {
    sources: [{ id: "s1", kind: "documento", origin: "web", title: "Organigramma", occurredOn: "2026-11-14", skipped: {} }],
    proposals: [proposal({ kind: "conflitto", statement: "Il CRM è HubSpot.", preselected: false, before: { factId: "f8", statement: "Il CRM è Salesforce.", sourceLabel: "Call", date: "21 ott" } })],
    reconfirmed: [],
  };
  const text = textOf(render(createElement(ConfirmView, confirmProps(open))));
  assert.ok(text.includes("Ora: Il CRM è HubSpot. (Documento 14 nov)"), text.join(" | "));
});

test("«Da confermare» senza niente da spuntare: «Conferma (0)» spento; vuota: «Niente da confermare.» e il link alla Memoria", () => {
  const onlyInferred: OpenProposals = { sources: [{ id: "s1", kind: "appunti", origin: "web", title: "Call", occurredOn: "2026-11-14", skipped: {} }], proposals: [proposal({ basis: "dedotto", preselected: false })], reconfirmed: [] };
  const html = render(createElement(ConfirmView, confirmProps(onlyInferred)));
  assert.match(html, /<button[^>]*disabled=""[^>]*>Conferma \(0\)<\/button>/);
  const empty = render(createElement(ConfirmView, confirmProps({ sources: [], proposals: [], reconfirmed: [] })));
  const text = textOf(empty);
  assert.ok(text.includes("Niente da confermare.") && text.includes("Torna alla memoria"));
  assert.equal(text.some((t) => t.startsWith("Conferma (")), false);
});

// ─── Appunti e documenti ─────────────────────────────────────────────

function source(over: Partial<SourceListItem> = {}): SourceListItem {
  return { id: "s1", kind: "appunti", origin: "granola", title: "Call di avvio", occurredOn: "2026-11-14", state: "da_confermare", readReason: null, openProposals: 4, visibility: "ls", document: null, canRemove: true, ...over };
}
const doc = source({ id: "d1", kind: "documento", origin: "web", title: "Organigramma", state: "letto", openProposals: 0, visibility: "tutti", document: { id: "doc1", fileName: "organigramma.pdf", fileType: "application/pdf", fileSize: 1_258_291 }, canRemove: false });

test("(rilascio 10, §3.7) le Fonti per Lateral Space: Granola in alto; l'origine è un'icona, la data e la lettura in grigio, il lucchetto solo per «Solo Lateral Space»", () => {
  const html = render(createElement(NotesView, { workspaceId: WS, today: TODAY, lateralSpace: true, sources: [source(), doc], granola: createElement("p", null, "blocco di Granola"), initialSourceId: null }));
  const text = textOf(html);
  assert.equal(text[0], "blocco di Granola");
  // L'origine: un'icona, e il suo nome solo per i lettori di schermo.
  assert.match(html, /<span class="sr-only">Granola: <\/span>Call di avvio/);
  assert.match(html, /<span class="sr-only">Documento: <\/span>Organigramma/);
  assert.ok(text.includes("14 nov") && text.includes("Da confermare (4)") && text.includes("Letto"));
  // La visibilità solo quando è «Solo Lateral Space»: il lucchetto sulla call, niente «Per tutti» sul documento.
  assert.equal(text.includes("Per tutti"), false);
  assert.equal(text.filter((t) => t === "Solo Lateral Space").length, 1);
  assert.equal(text.includes("Carica documento"), false, "Lateral Space aggiunge da «Aggiungi», nella testata");
  // Ogni riga apre il pannello della fonte.
  assert.equal((html.match(/aria-haspopup="dialog"/g) ?? []).length, 2);
  assert.ok(textOf(render(createElement(NotesView, { workspaceId: WS, today: TODAY, lateralSpace: true, sources: [], initialSourceId: null }))).includes("Nessun appunto ancora."));
});

test("la vista «Documenti» del cliente: i documenti con nome, data e dimensione, «Togli» solo a chi può, «Carica documento»", () => {
  const mine = source({ ...doc, id: "d2", canRemove: true, document: { id: "doc2", fileName: "listino.xlsx", fileType: "x", fileSize: 340 * 1024 } });
  const html = render(createElement(NotesView, { workspaceId: WS, today: TODAY, lateralSpace: false, sources: [doc, mine], initialSourceId: "s1" }));
  const text = textOf(html);
  // (Rilascio 10, §3.7) Il cliente aggiunge un file da «Aggiungi un file», nella testata comune.
  assert.equal(text.includes("Carica documento"), false);
  assert.ok(text.includes("organigramma.pdf") && text.includes("14 nov · 1,2 MB"));
  assert.ok(text.includes("listino.xlsx") && text.includes("14 nov · 340 KB"));
  // «Togli» dice ai lettori di schermo il nome del documento.
  assert.equal((html.match(/>Togli<span class="sr-only"> listino\.xlsx<\/span><\/button>/g) ?? []).length, 1);
  assert.equal(text.includes("Da confermare (4)") || text.includes("Letto"), false, "niente stati della lettura per il cliente");
  assert.ok(textOf(render(createElement(NotesView, { workspaceId: WS, today: TODAY, lateralSpace: false, sources: [], initialSourceId: null }))).includes("Nessun documento ancora."));
});

// ─── (Rilascio 10, §3.7) I Processi ──────────────────────────────────

test("(rilascio 10, §3.7) i Processi: un numero, una riga per unità con lo stato in parole e i conteggi senza zeri; il passo nella testata", () => {
  const units = fixtureUnits();
  const step = { kind: "link" as const, icon: "continue" as const, label: `Continua: ${units[1].name}`, why: "È l'unità in corso: riprendi da dove è rimasta.", href: `/dashboard/${WS}/mapping/${units[1].id}` };
  const html = render(pageWith(headerProps({ tab: "processi", step, canAddUnit: true }), createElement(ProcessesView, { workspaceId: WS, units, interviewHref: null })));
  const text = textOf(html);
  // Un numero solo, «1 di 3» unità mappate.
  assert.match(html, /data-slot="big-number-value"[^>]*>1 di 3</);
  assert.ok(text.includes("unità mappate"));
  // Una riga per unità: tutta la riga porta alla board; lo stato è un puntino e una parola.
  for (const unit of units) assert.match(html, new RegExp(`<a href="/dashboard/${WS}/mapping/${unit.id}"[^>]*data-row="unit"`));
  assert.ok(text.includes("Mappatura completa") && text.includes("In corso") && text.includes("Da iniziare"));
  assert.ok(text.includes("6 passi · 28,5 h a settimana · 2 da validare · 1 da classificare"));
  assert.equal(text.some((t) => /\b0 passi\b|0 h a settimana/.test(t)), false, "lo zero non si vede");
  // Il passo della vista è il solo pulsante pieno; «Aggiungi un'unità» resta qui, tranquillo; «Aggiungi» è bordato.
  const filled = filledButtons(html);
  assert.equal(filled.length, 1);
  assert.match(filled[0], new RegExp(`href="/dashboard/${WS}/mapping/${units[1].id}"`));
  assert.ok(text.includes("Continua: Magazzino") || text.some((t) => t.startsWith("Continua: ")));
  assert.ok(text.includes("Aggiungi un'unità"));
  assert.match(/<button\b[^>]*data-action="context-add"[^>]*>/.exec(html)?.[0] ?? "", /\bbg-background\b/);
});

test("(rilascio 10, §3.7) i Processi senza unità: una frase e «Racconta l'azienda»; il passo pieno è «Aggiungi un'unità»", () => {
  const step = { kind: "action" as const, action: "add-unit" as const, label: "Aggiungi un'unità", why: "Ogni unità ha la sua mappa: i processi, i passi, chi li fa." };
  const html = render(pageWith(headerProps({ tab: "processi", step, canAddUnit: true }), createElement(ProcessesView, { workspaceId: WS, units: [], interviewHref: `/dashboard/${WS}/setup/leadership` })));
  const text = textOf(html);
  assert.ok(text.includes("Nessuna unità, per ora."));
  assert.match(html, new RegExp(`<a[^>]*href="/dashboard/${WS}/setup/leadership"[^>]*>Racconta l(?:'|&#x27;)azienda</a>`));
  const filled = filledButtons(html);
  assert.equal(filled.length, 1);
  assert.match(filled[0], /data-action="next-step"/);
  assert.ok(text.includes("Aggiungi un'unità"));
  assert.doesNotMatch(html, /data-slot="big-number"/, "lo zero non si mostra");
  // Senza l'Intervista iniziale (chi non è revisore): la sola frase.
  assert.doesNotMatch(render(createElement(ProcessesView, { workspaceId: WS, units: [], interviewHref: null })), /setup\/leadership/);
});
