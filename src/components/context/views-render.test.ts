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
});
await enableTsxImports();
const { MemoryView } = await import("./memory-view.tsx");
const { ConfirmView } = await import("./confirm-view.tsx");
const { NotesView } = await import("./notes-view.tsx");
const { ContextPage } = await import("./context-page.tsx");

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
    counts: { facts: 2, openProposals: 12, unreadSources: 2, pendingSourceIds: ["s1", "s2"] },
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

test("la Memoria per Lateral Space: le righe di servizio, «In breve», «Novità», «Prossimi passi», le sezioni con qualcosa, «Domande aperte»", () => {
  const html = render(createElement(MemoryView, memoryProps({ consentNotice: NOTICE, granola: createElement("p", null, "riga di Granola"), reader: createElement("p", null, "riga di lettura") })));
  const text = textOf(html);
  assert.ok(text.includes("12 proposte da confermare"));
  assert.match(html, new RegExp(`href="/dashboard/${WS}/contesto/conferma"`));
  assert.ok(text.includes("riga di lettura") && text.includes("riga di Granola"));
  assert.match(html, /data-testid="ai-consent-notice"/);
  // «In breve» con la data, «Novità per te» con il segno e «e altre 3».
  assert.ok(text.includes("In breve") && text.includes("Aggiornato il 14 nov") && text.includes("Produce cucine su misura."));
  assert.ok(text.includes("Novità per te") && text.includes("Cambiato") && text.includes("e altre 3"));
  // «Prossimi passi»: i due gruppi, le scadenze, «Fatto» per ogni riga.
  assert.ok(text.includes("Prossimi passi") && text.includes("Nostri") && text.includes("Del cliente"));
  assert.ok(text.includes("entro il 30 nov") && text.includes("scaduto il 2 nov"));
  assert.equal(text.filter((t) => t === "Fatto").length, 2);
  // Le sezioni: solo quelle con qualcosa, nell'ordine; la Discovery prima dei fatti; i segni solo quando servono.
  const headings = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ["In breve", "Novità per te", "Prossimi passi", "Azienda", "Sistemi e dati", "Domande aperte"]);
  assert.ok(text.includes("Discovery") && text.includes("Call 14 nov") && text.includes("Scritto a mano"));
  assert.ok(text.includes("dedotto") && text.includes("da verificare"));
  assert.ok(text.includes("Solo Lateral Space"), "il lucchetto ha il testo per i lettori di schermo");
  // «Domande aperte» con a chi chiederle e «Chiusa».
  assert.ok(text.includes("Da chiedere a: Direttore operativo") && text.includes("Chiusa"));
});

test("la Memoria per il cliente: niente righe di servizio, niente «Fatto» né «Chiusa»", () => {
  const html = render(createElement(MemoryView, memoryProps({ lateralSpace: false, canEditMemory: false, consentNotice: NOTICE, granola: createElement("p", null, "riga di Granola"), reader: createElement("p", null, "riga di lettura") })));
  const text = textOf(html);
  assert.equal(text.includes("12 proposte da confermare"), false);
  assert.equal(text.includes("riga di Granola") || text.includes("riga di lettura"), false);
  assert.doesNotMatch(html, /ai-consent-notice/);
  assert.equal(text.includes("Fatto") || text.includes("Chiusa"), false);
  assert.ok(text.includes("Il gestionale è SAP Business One."));
});

test("la Memoria vuota: il titolo e la frase di chi guarda; per Lateral Space «Aggiungi appunti» lì, nella pagina", () => {
  const empty = memory({
    sections: memory().sections.map((s) => ({ ...s, live: [], facts: [] })),
    nextSteps: { nostri: [], cliente: [] },
    questions: [],
    brief: null,
    novelties: null,
    counts: { facts: 0, openProposals: 0, unreadSources: 0, pendingSourceIds: [] },
  });
  const forClient = textOf(render(createElement(MemoryView, memoryProps({ lateralSpace: false, canEditMemory: false, memory: empty }))));
  assert.ok(forClient.includes("Ancora niente in memoria") && forClient.includes("Qui compare quello che sappiamo dell'azienda, con la fonte di ogni cosa."));
  const page = render(
    pageWith({ workspaceId: WS, workspaceName: "Cliente di prova", today: TODAY, tab: "memoria", lateralSpace: true, canEditMemory: true, addNotesInHeader: false, useCaseOptions: [], consentNotice: null }, createElement(MemoryView, memoryProps({ memory: empty }))),
  );
  const text = textOf(page);
  assert.ok(text.includes("Aggiungi gli appunti di una call: Unbundle li legge e propone i fatti. Confermi con un clic."));
  assert.equal(text.filter((t) => t === "Aggiungi appunti").length, 1, "un solo «Aggiungi appunti»: nella Memoria vuota, non nella testata");
});

// ─── La testata e le schede ──────────────────────────────────────────

test("la testata: per Lateral Space «Aggiungi appunti», «Scrivi un fatto» e le schede «Memoria» · «Appunti»; per il cliente «Documenti» e nient'altro", () => {
  const shell = (lateralSpace: boolean) =>
    render(pageWith({ workspaceId: WS, workspaceName: "Cliente di prova", today: TODAY, tab: "memoria", lateralSpace, canEditMemory: lateralSpace, addNotesInHeader: true, useCaseOptions: [], consentNotice: null }, createElement("p", null, "vista")));
  const ls = shell(true);
  const lsText = textOf(ls);
  assert.ok(lsText.includes("Cliente di prova") && lsText.includes("Contesto"));
  assert.deepEqual([lsText.includes("Aggiungi appunti"), lsText.includes("Scrivi un fatto"), lsText.includes("Appunti"), lsText.includes("Documenti")], [true, true, true, false]);
  assert.match(ls, /placeholder="Fai una domanda sul cliente"/);
  assert.match(ls, new RegExp(`href="/dashboard/${WS}/contesto\\?vista=appunti"`));
  assert.match(ls, /aria-current="page"[^>]*>(<[^>]+>)*Memoria/);
  const client = shell(false);
  const clientText = textOf(client);
  assert.deepEqual([clientText.includes("Aggiungi appunti"), clientText.includes("Scrivi un fatto"), clientText.includes("Appunti"), clientText.includes("Documenti")], [false, false, false, true]);
  assert.match(client, /placeholder="Fai una domanda"/);
  assert.ok(clientText.includes("Chiedi"));
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
    sources: [{ id: "s1", title: "Call di avvio", occurredOn: "2026-11-14", skipped: { persone: 2 } }],
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
  assert.deepEqual(headings, ["Nuovi", "Cambiano", "Conflitti", "Impegni", "Domande"]);
  // Spuntate: la «detto», il cambio, l'impegno, la domanda, e le riconferme. Non la «dedotto», non quella con il nome.
  assert.ok(text.includes("Conferma (5)"), text.join(" | "));
  const checkboxes = [...html.matchAll(/<(?:button|span)[^>]*role="checkbox"[^>]*>/g)].map((m) => m[0]);
  assert.equal(checkboxes.length, 7, "sei righe con la casella (il conflitto no) e la riga delle riconferme");
  assert.equal(checkboxes.filter((tag) => /aria-checked="true"/.test(tag)).length, 5);
  assert.equal(checkboxes.filter((tag) => /aria-disabled="true"|data-disabled/.test(tag)).length, 1, "la riga con il nome non si spunta finché non si corregge");
  // «Cambiano» con «Prima»; il conflitto con «Prima» e «Ora» e le due scelte, nessuna scelta di partenza.
  assert.ok(text.includes("Prima: Gli ordini sono 30 al giorno. (Call, 3 nov)"));
  assert.ok(text.includes("Prima: Il CRM è Salesforce. (Documento, 21 ott)") && text.includes("Ora: Il CRM è HubSpot. (Call 14 nov)"));
  assert.ok(text.includes("Tieni “Prima”") && text.includes("Passa a “Ora”") && text.includes("Scegli quale tenere."));
  assert.equal((html.match(/role="radio" aria-checked="true"/g) ?? []).length, 0);
  // I segni, l'impegno, la domanda, il problema da correggere, le riconferme, i non riportati.
  assert.ok(text.includes("dedotto") && text.includes("Nostro") && text.includes("Responsabile del progetto") && text.includes("entro il 30 nov"));
  assert.ok(text.includes("Da chiedere a: Direttore operativo"));
  assert.ok(text.includes("Non scrivere nomi di persone: indica il ruolo."));
  assert.ok(text.includes("1 fatto riconfermato: si aggiorna la data") && text.includes("Hanno due stabilimenti."));
  assert.ok(text.includes("2 passaggi non riportati: parlavano di persone"));
  assert.match(html, /<q>il gestionale è SAP<\/q>/, "la citazione tra virgolette");
});

test("«Da confermare» senza niente da spuntare: «Conferma (0)» spento; vuota: «Niente da confermare.» e il link alla Memoria", () => {
  const onlyInferred: OpenProposals = { sources: [{ id: "s1", title: "Call", occurredOn: "2026-11-14", skipped: {} }], proposals: [proposal({ basis: "dedotto", preselected: false })], reconfirmed: [] };
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

test("la vista «Appunti» per Lateral Space: Granola in alto, ogni fonte con data, origine, stato e chi vede un documento", () => {
  const html = render(createElement(NotesView, { workspaceId: WS, today: TODAY, lateralSpace: true, sources: [source(), doc], granola: createElement("p", null, "blocco di Granola"), initialSourceId: null }));
  const text = textOf(html);
  assert.equal(text[0], "blocco di Granola");
  assert.ok(text.includes("Call di avvio") && text.includes("Granola") && text.includes("Da confermare (4)"));
  assert.ok(text.includes("Organigramma") && text.includes("Documento") && text.includes("Letto") && text.includes("Per tutti"));
  assert.equal(text.includes("Carica documento"), false, "Lateral Space carica da «Aggiungi appunti»");
  assert.ok(textOf(render(createElement(NotesView, { workspaceId: WS, today: TODAY, lateralSpace: true, sources: [], initialSourceId: null }))).includes("Nessun appunto ancora."));
});

test("la vista «Documenti» del cliente: i documenti con nome, data e dimensione, «Togli» solo a chi può, «Carica documento»", () => {
  const mine = source({ ...doc, id: "d2", canRemove: true, document: { id: "doc2", fileName: "listino.xlsx", fileType: "x", fileSize: 340 * 1024 } });
  const html = render(createElement(NotesView, { workspaceId: WS, today: TODAY, lateralSpace: false, sources: [doc, mine], initialSourceId: "s1" }));
  const text = textOf(html);
  assert.ok(text.includes("Carica documento"));
  assert.ok(text.includes("organigramma.pdf") && text.includes("14 nov · 1,2 MB"));
  assert.ok(text.includes("listino.xlsx") && text.includes("14 nov · 340 KB"));
  assert.equal(text.filter((t) => t === "Togli").length, 1);
  assert.equal(text.includes("Da confermare (4)") || text.includes("Letto"), false, "niente stati della lettura per il cliente");
  assert.ok(textOf(render(createElement(NotesView, { workspaceId: WS, today: TODAY, lateralSpace: false, sources: [], initialSourceId: null }))).includes("Nessun documento ancora."));
});
