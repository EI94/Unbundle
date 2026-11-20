import test, { before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { installAppModules } from "../../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { parseQuestionFilter, questionDefaults, type QuestionFilter } from "../../../lib/uc/views/catalog-filter.ts";
import { questionFilterFields } from "../../../lib/uc/views/question-bar.ts";
import { questionSegmentItems, questionTopicGroups, type QuestionGroupView, type QuestionRowView } from "../../../lib/uc/views/rows.ts";
import type { CaseFileRow } from "../../../lib/uc/views/documents.ts";

// (Rilascio 10, ondata 5a, docs/ui-10/PROPOSTA-10.md §3.5 «Domande») Domande, il pannello della domanda, il pannello
// «File» e «Verifica una alla volta», resi in HTML con react-dom/server. Le azioni del server sono finte; il pannello
// con l'indirizzo si rende in linea (il vero sta in un portale, che il server non disegna). Dati inventati: codici
// XX-00NN, «Cliente Demo».

const ok = `async () => ({ ok: true, data: { byStatus: {}, total: 0, truncated: false } })`;
await installAppModules({
  "@/lib/actions/uc-catalog-selection": `export const selectCatalogItemsAction = ${ok};`,
  "@/lib/actions/uc-catalog": [
    "markMissingAction",
    "markPartialAction",
    "proposeFallbackAction",
    "proposeNaAction",
    "proposeWaiverAction",
    "recordLsAnswerAction",
    "reopenItemAction",
    "requestClarificationAction",
    "validateItemAction",
    "setItemsDueAction",
    "transitionItemsAction",
    "addCommentAction",
    "resolveCommentAction",
  ]
    .map((name) => `export const ${name} = ${ok};`)
    .join("\n"),
  "@/lib/actions/uc-people": ["assignItemsAction", "requestConfirmationAction", "sendRequestsAction"].map((name) => `export const ${name} = ${ok};`).join("\n"),
  "@/lib/actions/uc-files": ["createDatasetAction", "deleteFileAction", "reviewQuarantinedFileAction", "validateDatasetAction"].map((name) => `export const ${name} = ${ok};`).join("\n"),
  // Il pannello con l'indirizzo, in linea: titolo, descrizione, contenuto e piede.
  "@/components/uc/catalog/address-sheet": `export function AddressSheet(p) {
  const h = globalThis.__domandeReact.createElement;
  return h("section", { "data-test-sheet": p.title }, h("h2", null, p.title), p.description ? h("p", null, p.description) : null, p.children, p.footer ? h("footer", null, p.footer) : null);
}
export function withoutSheet() { return ""; }`,
});

const WS = "00000000-0000-4000-8000-0000000000f1";
const CASE = "00000000-0000-4000-8000-000000000c12";
const base = `/dashboard/${WS}/casi-duso/${CASE}/domande`;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Html = (element: unknown) => string;
let html: Html;
let h: (type: unknown, props: unknown, ...children: unknown[]) => unknown;
let list: typeof import("./question-list.tsx");
let sections: typeof import("./item-sections.tsx");
let actions: typeof import("./item-actions.tsx");
let review: typeof import("./review-mode.tsx");
let files: typeof import("../documents/file-panel.tsx");

before(async () => {
  await enableTsxImports();
  const react = await import("react");
  (globalThis as { __domandeReact?: unknown }).__domandeReact = react;
  h = (type, props, ...children) => react.createElement(type as never, props as never, ...(children as never[]));
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as { AppRouterContext: import("react").Context<object | null> };
  const { PathnameContext, SearchParamsContext } = (await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js")) as unknown as {
    PathnameContext: import("react").Context<string | null>;
    SearchParamsContext: import("react").Context<URLSearchParams | null>;
  };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  html = (element) =>
    renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, h(PathnameContext.Provider, { value: base }, h(SearchParamsContext.Provider, { value: new URLSearchParams() }, element))))
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
  list = await import("./question-list.tsx");
  sections = await import("./item-sections.tsx");
  actions = await import("./item-actions.tsx");
  review = await import("./review-mode.tsx");
  files = await import("../documents/file-panel.tsx");
});

/** Il testo visibile: niente tag, niente testo per i soli lettori di schermo. */
const textOf = (markup: string) =>
  markup
    .replace(/<span class="sr-only">[^<]*<\/span>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const words = (markup: string) => textOf(markup).split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
/** I controlli, come li conta l'harness: link, pulsanti, campi. */
const controls = (markup: string) => (markup.match(/<(?:a|button|input|select|textarea)\b/g) ?? []).length;
/** I pulsanti pieni: `[data-slot=button]` con la classe `bg-primary`, come nell'harness delle schermate. */
const filled = (markup: string) =>
  [...markup.matchAll(/<(?:a|button)\b[^>]*>/g)].map(([tag]) => tag).filter((tag) => tag.includes('data-slot="button"') && (/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? []).includes("bg-primary"));

const PREP = questionDefaults("raccolta", null, "ls");
const MODULES = [
  { key: "m.volumi", title: "Volumi e tempi", roleKey: "resp_operativo" },
  { key: "m.sistemi", title: "Sistemi", roleKey: "resp_it" },
  { key: "m.eccezioni", title: "Eccezioni", roleKey: null },
];
const ROLES = { resp_operativo: "Responsabile operativo", resp_it: "Responsabile dei sistemi" };
const COUNTS = {
  "m.volumi": { total: 40, ok: 10, daFare: 12, daVerificare: 3, bloccate: 2 },
  "m.sistemi": { total: 30, ok: 5, daFare: 9, daVerificare: 0, bloccate: 0 },
  "m.eccezioni": { total: 20, ok: 4, daFare: 6, daVerificare: 1, bloccate: 0 },
};
const SEGMENTS = { "da-fare": 27, "da-verificare": 4, bloccate: 2, "a-posto": 19, tutte: 90 };

function listProps(filter: QuestionFilter, over: Record<string, unknown> = {}) {
  const fields = questionFilterFields(filter, PREP, "ls", {
    contacts: [{ id: id(901), name: "Referente Demo" }],
    modules: MODULES.map((m) => ({ key: m.key, title: m.title })),
    roles: Object.entries(ROLES).map(([key, label]) => ({ key, label })),
    contract: false,
    catalogSize: 2812,
    kindCounts: null,
    unassigned: 137,
  });
  return {
    workspaceId: WS,
    caseId: CASE,
    basePath: base,
    audience: "ls",
    filter,
    defaults: PREP,
    segments: questionSegmentItems({ audience: "ls", counts: SEGMENTS, active: filter.vista, defaultSegment: PREP.vista }),
    fields,
    collapsed: true,
    topics: questionTopicGroups({ counts: COUNTS, modules: MODULES, roleLabels: ROLES, vista: filter.vista, plain: (t) => t }),
    waiting: filter.vista === "da-fare" ? SEGMENTS.bloccate : 0,
    rows: [] as QuestionRowView[],
    groups: [] as QuestionGroupView[],
    total: SEGMENTS[filter.vista],
    files: 6,
    permissions: { any: true, assign: true, setDue: true, outcomes: true, proposeNa: true, send: true },
    contacts: [],
    reviewHref: null,
    openId: null,
    ...over,
  };
}

test("Domande, Lateral Space, no filter: three segments, the bar, the «In attesa» group on top, closed topics with only their count; no rows, no filled button", () => {
  const page = html(h(list.QuestionList, listProps(parseQuestionFilter({}, "ls", PREP))));
  const nav = /<nav[^>]*aria-label="Domande per stato"[\s\S]*?<\/nav>/.exec(page)?.[0] ?? "";
  assert.ok(nav, page);
  assert.deepEqual([...nav.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => textOf(m[1]).replace(/ \d+$/, "")), ["Da fare", "Da verificare", "Tutte"]);
  assert.doesNotMatch(textOf(nav), /Bloccate|A posto|Documenti/);
  // La barra: «Cerca» · «Filtri» · «Seleziona» · «File (6)».
  assert.match(page, /<form role="search"[^>]*action="[^"]*\/domande"/);
  assert.match(page, />Filtri<\/button>|Filtri<\/button>/);
  assert.match(textOf(page), /Seleziona/);
  const file = /<a [^>]*href="([^"]*apri=file[^"]*)"[^>]*>[\s\S]*?<\/a>/.exec(page);
  assert.ok(file && textOf(file[0]).includes("File (6)"), "«File (6)» opens the panel by its address");
  // I gruppi: «In attesa» in cima, poi gli argomenti nell'ordine dello schema, con il ruolo in grigio e il conteggio.
  const groups = [...page.matchAll(/<li[^>]*data-slot="question-group"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]));
  assert.deepEqual(groups, ["In attesa Ferme per un blocco 2", "Volumi e tempi Responsabile operativo 12", "Sistemi Responsabile dei sistemi 9", "Eccezioni 6"]);
  assert.match(page, new RegExp(`href="${base}\\?vista=bloccate"`), "the waiting group opens like yesterday's links");
  assert.match(page, new RegExp(`href="${base}\\?argomento=m\\.volumi"`), "a topic opens with its filter");
  assert.doesNotMatch(page, /data-slot="question-row"/);
  assert.deepEqual(filled(page), [], "the only filled button is the header's step");
  assert.doesNotMatch(textOf(page), /senza referente ·|Affida a… ›|Verifica una alla volta|1–50/);
  // §3.14: Domande ≤250 parole e ≤30 controlli (qui senza la testata).
  assert.ok(words(page) <= 60, `${words(page)} parole`);
  assert.ok(controls(page) <= 30, `${controls(page)} controlli`);
});

test("Domande with a filter: the rows, by topic; one grey line per row, the role only in the group, the due date only when past; the row carries the list's query", () => {
  const filter = parseQuestionFilter({ argomento: "m.volumi", pagina: "2" }, "ls", PREP);
  const rows: QuestionRowView[] = [
    { id: id(1), status: "chiesta", title: "Quante richieste arrivano al giorno?", tone: "blu", label: "Da fare", line: "Referente Demo", missing: false, overdue: "scaduta il 10 nov", personal: false, moduleKey: "m.volumi", value: null },
    { id: id(2), status: "da_chiedere", title: "Quanto dura una pratica?", tone: "grigio", label: "Da fare", line: "Senza referente", missing: true, overdue: null, personal: true, moduleKey: "m.volumi", value: null },
  ];
  const groups: QuestionGroupView[] = [{ key: "m.volumi", title: "Volumi e tempi", role: "Responsabile operativo", count: 12, rowIds: rows.map((r) => r.id) }];
  const page = html(h(list.QuestionList, listProps(filter, { collapsed: false, topics: [], rows, groups, total: 62, reviewHref: null })));
  const items = [...page.matchAll(/<li[^>]*data-slot="question-row"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(items.length, 2);
  assert.equal(textOf(items[0]), "Quante richieste arrivano al giorno? Referente Demo · scaduta il 10 nov");
  assert.match(items[0], /class="text-uc-rosso">scaduta il 10 nov/);
  assert.equal(textOf(items[1]), "Quanto dura una pratica? Senza referente");
  assert.doesNotMatch(items.join(""), /Responsabile operativo|Indispensabile|Fuori contratto/, "the role is in the group only");
  assert.match(page, /<h2[^>]*>[\s\S]*Volumi e tempi[\s\S]*Responsabile operativo[\s\S]*· 12[\s\S]*<\/h2>/);
  assert.match(items[0], new RegExp(`href="${base}/${id(1)}\\?argomento=m\\.volumi&pagina=2"`), "the full page brings back filters and page");
  assert.match(page, /aria-label="Pagine"/);
  assert.match(textOf(page), /51–62 di 62/);
  assert.match(page, /Argomento: Volumi e tempi/, "the open topic is a chip with ✕");
  assert.deepEqual(filled(page), []);
});

test("«Da verificare»: «Verifica una alla volta» is a quiet link only when the header's button does not lead there", () => {
  const filter = parseQuestionFilter({ vista: "da-verificare" }, "ls", PREP);
  const quiet = html(h(list.QuestionList, listProps(filter, { reviewHref: `${base}/verifica` })));
  assert.match(quiet, new RegExp(`<a [^>]*data-slot="text-action"[^>]*href="${base}/verifica"|<a [^>]*href="${base}/verifica"[^>]*data-slot="text-action"`));
  assert.deepEqual(filled(quiet), [], "never a second button for the same destination");
  const none = html(h(list.QuestionList, listProps(filter, { reviewHref: null })));
  assert.doesNotMatch(none, /Verifica una alla volta/);
});

test("the client: «Da rispondere · In verifica · Tutte»; the referent filter offers only «Senza referente»", () => {
  const filter = parseQuestionFilter({}, "cliente", PREP);
  const fields = questionFilterFields(filter, PREP, "cliente", { contacts: [{ id: id(901), name: "Referente Demo" }], modules: [], roles: [], contract: false, catalogSize: null, kindCounts: null, unassigned: 3 });
  assert.deepEqual(fields.find((f) => f.key === "referente")?.options.map((o) => o.label), ["Senza referente (3)"]);
  assert.deepEqual(fields.find((f) => f.key === "stato")?.options.map((o) => o.label), ["A posto"]);
  assert.deepEqual(fields.find((f) => f.key === "mostra")?.options.map((o) => o.label), ["Documenti"]);
  assert.ok(!fields.some((f) => ["riservatezza", "tipo"].includes(f.key)));
  const page = html(
    h(list.QuestionList, {
      ...listProps(filter),
      audience: "cliente",
      fields,
      segments: questionSegmentItems({ audience: "cliente", counts: SEGMENTS, active: "da-fare", defaultSegment: "da-fare" }),
      permissions: { any: true, assign: true, setDue: false, outcomes: false, proposeNa: false, send: false },
    }),
  );
  const nav = /<nav[^>]*aria-label="Domande per stato"[\s\S]*?<\/nav>/.exec(page)?.[0] ?? "";
  assert.deepEqual([...nav.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => textOf(m[1]).replace(/ \d+$/, "")), ["Da rispondere", "In verifica", "Tutte"]);
});

const PANEL_BASE = {
  workspaceId: WS,
  caseId: CASE,
  itemId: id(7),
  key: "q.volumi.01",
  title: "Quante richieste arrivano al giorno?",
  topic: "Volumi e tempi",
  status: { tone: "giallo", label: "Da verificare", sublabel: null },
  must: true,
  personal: false,
  outOfContract: false,
  client: false,
  roles: ["ls_lead"],
  blocked: null,
  reason: null,
  notice: null,
  firmeHref: `/dashboard/${WS}/casi-duso/${CASE}/firme`,
  answer: { summary: null, value: { kind: "value", text: "120 al giorno" }, declared: false, byLine: "Referente Demo · 2 giorni fa", checks: [], details: [], previous: [] },
  files: null,
  about: { explanation: "Le richieste che arrivano allo sportello.", why: "Serve per dimensionare il servizio.", example: null, help: null },
  activity: { entries: [{ id: "e1", kind: "commento", title: "Commento", body: "Va bene.", meta: null, internal: false, clarification: false, open: false, commentId: null }], visibilities: [], canResolve: false },
  tech: null,
  linked: [],
  side: { assignee: "Referente Demo", roleLabel: null, due: null },
  fullHref: `${base}/${id(7)}`,
};

function panelActions(over: Record<string, unknown> = {}) {
  return {
    workspaceId: WS,
    caseId: CASE,
    itemId: id(7),
    plan: { primary: ["validate", "clarify"], more: ["record", "partial", "missing", "proposeNa", "proposeWaiver", "proposeFallback"] },
    actions: { validate: { ok: true }, recordValue: { ok: true }, proposeWaiver: { ok: true } },
    askAgainLabel: "Chiedi al referente",
    responseType: "numero",
    options: [],
    requiresValidity: false,
    reassign: null,
    ...over,
  };
}

test("the question panel: one state in the head with «Apri a tutta pagina» as an icon; the answer on top, then the actions (one filled); «La domanda» and «Attività · N» closed", () => {
  const model = { ...PANEL_BASE, status: { tone: "blu", label: "Da fare", sublabel: "Chiesta, in attesa" }, actions: panelActions() };
  const head = html(h(sections.QuestionPanelHead, { model }));
  assert.match(textOf(head), /^Chiesta, in attesa · Indispensabile/);
  assert.doesNotMatch(textOf(head), /Da fare/, "one state, not «Da fare · Chiesta, in attesa»");
  assert.match(head, new RegExp(`<a [^>]*href="${base}/${id(7)}"[^>]*aria-label="Apri a tutta pagina"|<a [^>]*aria-label="Apri a tutta pagina"[^>]*href="${base}/${id(7)}"`));
  assert.doesNotMatch(head, /<(?:div|section|p)\b/, "inline only: it sits in the panel's description");
  const body = html(h(sections.QuestionPanelBody, { model }));
  const answerAt = body.indexOf("120 al giorno");
  const validateAt = body.indexOf(">Valida<");
  assert.ok(answerAt > 0 && validateAt > answerAt, "the answer comes before the actions");
  assert.equal(filled(body).length, 1, "one filled button: «Valida»");
  assert.match(filled(body)[0], /type="button"/);
  for (const [title, closed] of [
    ["La domanda", true],
    ["Attività · 1", true],
  ] as const) {
    const fold = new RegExp(`<button[^>]*aria-expanded="${String(!closed)}"[^>]*>[\\s\\S]*?${title}[\\s\\S]*?</button>`).exec(body);
    assert.ok(fold, `«${title}» is a fold, ${closed ? "closed" : "open"}`);
  }
  assert.doesNotMatch(textOf(body), /Apri a tutta pagina/, "the full page is the icon in the head");
  // Senza risposta «La domanda» resta aperta.
  const unanswered = html(h(sections.QuestionPanelBody, { model: { ...model, answer: null } }));
  assert.match(unanswered, /<button[^>]*aria-expanded="true"[^>]*>[\s\S]*?La domanda/);
});

test("«⋯ › Proponi…»: two or three proposals become one entry with a choice step; one stays by name; the rest keeps its order", () => {
  const { keys, proposals } = actions.questionMenuKeys(["record", "partial", "missing", "proposeNa", "proposeWaiver", "proposeFallback"]);
  assert.deepEqual(keys, ["record", "partial", "missing", "propose"]);
  assert.deepEqual(proposals, ["proposeNa", "proposeWaiver", "proposeFallback"]);
  assert.deepEqual(actions.questionMenuKeys(["reopen", "proposeNa"]).keys, ["reopen", "proposeNa"], "one proposal: by its name, no step");
  assert.deepEqual(actions.questionMenuKeys(["proposeWaiver", "partial", "proposeNa"]).keys, ["propose", "partial"]);
  const source = readFileSync(new URL("./item-actions.tsx", import.meta.url), "utf8");
  assert.match(source, /<legend className="mb-1 text-sm font-medium">\{A\.proposeStep\}<\/legend>/, "the choice step asks «Che cosa proponi?»");
  assert.match(source, /onChoose=\{\(k\) => setForm\(k\)\}/, "then the form of the chosen proposal");
});

test("«Inserisci il valore»: Valore and Fonte in view, the rest in «Altri dettagli»; visible labels, 44 px fields, no warning", () => {
  const source = readFileSync(new URL("./item-actions.tsx", import.meta.url), "utf8");
  const form = source.slice(source.indexOf("function RecordValueForm("));
  const more = form.indexOf("{R.more}");
  assert.ok(more > 0, "«Altri dettagli»");
  for (const visible of ["{R.value}", "{R.source}", "{R.sourceRef}"]) assert.ok(form.indexOf(visible) > 0 && form.indexOf(visible) < more, `${visible} in view`);
  for (const later of ["{R.basis}", "{R.confidence}", "{R.note}"]) assert.ok(form.indexOf(later) > more, `${later} in «Altri dettagli»`);
  assert.match(form, /\{requiresValidity && validity\}[\s\S]*\{R\.more\}[\s\S]*\{!requiresValidity && validity\}/, "a mandatory date stays in view");
  assert.doesNotMatch(form, /className="sr-only">(?:Da dove viene|Affidabilità)/, "the selects have a visible label");
  assert.doesNotMatch(form, /Niente dati personali|Chi inserisce il valore non lo può validare/);
  assert.ok(form.includes("es. 1.200 € IVA esclusa a pezzo"), "the example of ondata 0 stays");
});

const fileRow = (n: number, over: Partial<CaseFileRow> = {}): CaseFileRow => ({
  id: id(100 + n),
  name: `listino-${n}.xlsx`,
  meta: "Controllato · 3 nov",
  size: "2 MB",
  zone: "standard",
  usable: true,
  findings: [],
  preview: null,
  item: null,
  dataset: null,
  actions: { download: true, createDataset: false, decide: null, decideBlocked: false, delete: true },
  ...over,
});

test("the «File» panel: the files to check on top, three files then «Vedi tutti (N)», «Documenti richiesti (N)» to the filter; «Carica un file» is the panel's filled button; no declaration box", () => {
  const review = { id: id(200), name: "verbale.pdf", size: 1000, createdAt: "2026-11-18T10:00:00Z", itemKey: null, fromReferent: true, uploadedByMe: false, canReview: true, reviewReason: null };
  const panel = html(
    h(files.FilePanel, {
      workspaceId: WS,
      caseId: CASE,
      questionsBase: base,
      files: [1, 2, 3, 4, 5].map((n) => fileRow(n)),
      datasetsWithoutFile: [],
      upload: { allowed: true, reason: null, clientMode: true, targets: [{ id: null, title: null, personal: false }] },
      manage: { reviews: [review], candidates: [], controller: "Cliente Demo", sources: [] },
      personalNote: true,
      required: { count: 4, href: `${base}?vista=tutte&indispensabili=no&mostra=documenti` },
    }),
  );
  const text = textOf(panel);
  assert.ok(text.indexOf("Da controllare · 1") < text.indexOf("File caricati"), "the header step «Controlla N file» lands on top");
  assert.equal((panel.match(/listino-\d\.xlsx<\/span>/g) ?? []).length, 3);
  assert.match(text, /Vedi tutti \(5\)/);
  assert.match(panel, new RegExp(`<a [^>]*href="${base}\\?vista=tutte&indispensabili=no&mostra=documenti"[^>]*>Documenti richiesti \\(4\\)`));
  const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(panel)?.[1] ?? "";
  assert.equal(textOf(summary), "listino-1.xlsx Controllato · 3 nov", "name, state and date in the row");
  assert.match(panel, /<\/summary><div[^>]*>[\s\S]*?2 MB/, "the size waits in the details, closed");
  const footer = /<footer>([\s\S]*?)<\/footer>/.exec(panel)?.[1] ?? "";
  assert.equal(filled(footer).length, 1);
  assert.match(textOf(footer), /Carica un file/);
  assert.equal(filled(panel).length, 1, "one filled button in the panel");
  assert.doesNotMatch(panel, /type="checkbox"/);
  assert.doesNotMatch(text, /quarantena|non contiene dati|Codice:/i);
  assert.match(text, /I file della zona personale mostrano solo i dati del file, mai il contenuto\./);
  // Chi non carica non ha il pulsante.
  const reader = html(h(files.FilePanel, { workspaceId: WS, caseId: CASE, questionsBase: base, files: [], datasetsWithoutFile: [], upload: null, manage: null, personalNote: false, required: { count: 0, href: base } }));
  assert.deepEqual(filled(reader), []);
  assert.match(textOf(reader), /Nessun file caricato\./);
  assert.doesNotMatch(textOf(reader), /Documenti richiesti/, "zero is not shown");
});

test("«Verifica una alla volta» stays as it is, plus a switch that turns the shortcuts off (WCAG 2.1.4)", () => {
  const page = html(
    h(review.ReviewMode, {
      baseHref: `${base}/verifica`,
      exitHref: `${base}?vista=da-verificare`,
      panoramicaHref: `/dashboard/${WS}/casi-duso/${CASE}`,
      position: { currentId: id(7), index: 3, total: 160, nextId: id(8), prevId: id(6) },
      card: h("p", null, "La scheda"),
      actions: null,
      canValidate: true,
      mineNote: null,
    }),
  );
  assert.match(page, /role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/);
  assert.match(textOf(page), /Tasti rapidi V valida · C chiarimento · → salta · ← indietro/);
  assert.match(textOf(page), /Verifica · 3 di 160/);
  const source = readFileSync(new URL("./review-mode.tsx", import.meta.url), "utf8");
  assert.match(source, /reviewKeyAction\(\{[^}]*enabled: keys \}\)/, "the keys obey the switch");
  assert.match(source, /aria-keyshortcuts=\{keys \? "ArrowRight" : undefined\}/);
  assert.match(source, /window\.localStorage\.setItem\(REVIEW_SHORTCUTS_KEY, on \? "si" : "no"\)/, "the choice stays from one card to the next");
});

test("(release 10, §8.2) yesterday's Documenti page is a route that redirects; Domande has no page of its own for it", () => {
  const dir = new URL("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/domande/documenti/", import.meta.url);
  assert.equal(existsSync(new URL("page.tsx", dir)), false);
  const route = readFileSync(new URL("route.ts", dir), "utf8");
  assert.match(route, /export function GET\(request: NextRequest\)/);
  assert.match(route, /legacyCaseRouteFromPath\(request\.nextUrl\.pathname, request\.nextUrl\.searchParams\)/);
  assert.match(route, /permanentRedirect\(target\)/);
  assert.equal(existsSync(new URL("../../documents/documents-view.tsx", import.meta.url)), false, "the archive lives in the «File» panel only");
});

test("Domande's sources: no browser dialogs, no «collega», the panel opens by its address (`?apri=`)", () => {
  const page = readFileSync(new URL("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/domande/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const FILE_PANEL = "file";/);
  assert.match(page, /apri && UUID\.test\(apri\) \? loadItemDetail/);
  assert.match(page, /<AddressSheet title=\{panel\.title\}/);
  assert.doesNotMatch(page, /variant="default"|<Button\b/, "no button of its own: the filled one is the header's");
  for (const file of ["./question-list.tsx", "./catalog-filters.tsx", "./item-actions.tsx", "./item-sections.tsx", "./review-mode.tsx", "./bulk-actions.tsx", "./address-sheet.tsx", "../documents/file-panel.tsx", "../documents/file-management.tsx", "../documents/upload-panel.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /window\.(?:confirm|prompt|alert)\(/, file);
    assert.doesNotMatch(source, /"[^"\n]*\bcolleg(?:a|hi|he)\b[^"\n]*"/i, `${file}: neutral gender`);
  }
});
