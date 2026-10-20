import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BASELINE,
  DEFAULT_TARGET,
  KPI_GROUP_PAGE,
  KPI_READINESS_VIEW,
  buildKpis,
  groupKpisByLever,
  groupViews,
  groupsOpen,
  kpiQuery,
  kpiReadiness,
  pagesOfOpen,
  toggleGroup,
  kpiWords,
  kpiView,
  kpisInView,
  parseKpiParams,
  pnlOf,
  pnlText,
  rowToKpiRow,
  vanityText,
  withGroupPage,
  type KpiRow,
} from "./kpi.ts";
import { linkRow, modelRow } from "./view.fixtures.ts";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("profit and loss line, control KPI or still to indicate", () => {
  assert.deepEqual(pnlOf({ pnl_line: "Ricavi da noleggio" }), { kind: "riga", text: "Ricavi da noleggio" });
  assert.deepEqual(pnlOf({ kpi_controllo: "sì" }), { kind: "controllo" });
  assert.deepEqual(pnlOf({ kpi_controllo: "no" }), { kind: "da_indicare" });
  assert.deepEqual(pnlOf({}), { kind: "da_indicare" });
  assert.equal(pnlText({ kind: "controllo" }), "KPI di controllo");
  assert.equal(pnlText({ kind: "da_indicare" }), "Da indicare");
});

test("the words of the starting schema follow the vocabulary in the starting value and target", () => {
  assert.equal(kpiWords("dopo la baseline"), "dopo il valore di partenza");
  assert.equal(kpiWords("La baseline si misura a gennaio"), "Il valore di partenza si misura a gennaio");
  assert.equal(kpiWords("-10% sulla baseline"), "-10% sul valore di partenza");
  assert.equal(kpiWords("Baseline da misurare"), "Valore di partenza da misurare");
  assert.equal(kpiWords("dopo il backtest"), "dopo la prova sul passato");
  assert.equal(kpiWords("18 €"), "18 €");
});

test("«baseline» and «backtest» take the gender and number of the new words, with articles, prepositions and adjectives", () => {
  const cases: [string, string][] = [
    // «baseline» is feminine, «valore di partenza» masculine.
    ["prima della baseline", "prima del valore di partenza"],
    ["Della baseline si sa poco", "Del valore di partenza si sa poco"],
    ["confronto con la baseline, alla baseline e dalla baseline", "confronto con il valore di partenza, al valore di partenza e dal valore di partenza"],
    ["nella baseline", "nel valore di partenza"],
    ["serve una baseline", "serve un valore di partenza"],
    ["la sua baseline", "il suo valore di partenza"],
    ["una nuova baseline", "un nuovo valore di partenza"],
    ["questa baseline e quella baseline", "questo valore di partenza e quel valore di partenza"],
    ["della stessa baseline", "dello stesso valore di partenza"],
    ["dell'ultima baseline", "dell'ultimo valore di partenza"],
    ["un'altra baseline", "un altro valore di partenza"],
    ["le baseline", "i valori di partenza"],
    ["tutte le baseline", "tutti i valori di partenza"],
    ["sulle baseline storiche", "sui valori di partenza storici"],
    ["due nuove baseline", "due nuovi valori di partenza"],
    ["la baseline misurata a gennaio", "il valore di partenza misurato a gennaio"],
    ["nessuna baseline", "nessun valore di partenza"],
    // «backtest» is masculine, «prova sul passato» feminine.
    ["misurata nel backtest", "misurata nella prova sul passato"],
    ["Nel backtest di marzo", "Nella prova sul passato di marzo"],
    ["del backtest", "della prova sul passato"],
    ["dal backtest", "dalla prova sul passato"],
    ["al backtest", "alla prova sul passato"],
    ["sul backtest", "sulla prova sul passato"],
    ["col backtest", "con la prova sul passato"],
    ["un backtest", "una prova sul passato"],
    ["un ultimo backtest", "un'ultima prova sul passato"],
    ["lo stesso backtest", "la stessa prova sul passato"],
    ["quel backtest", "quella prova sul passato"],
    ["i backtest", "le prove sul passato"],
    ["dei backtest", "delle prove sul passato"],
    ["tutti i backtest eseguiti", "tutte le prove sul passato eseguite"],
    ["il backtest eseguito su 3 mesi", "la prova sul passato eseguita su 3 mesi"],
    ["3 backtest", "3 prove sul passato"],
    ["Backtest positivo", "Prova sul passato positiva"],
  ];
  for (const [from, to] of cases) assert.equal(kpiWords(from), to, from);
});

test("the vocabulary leaves alone what does not agree with the word, and keys", () => {
  assert.equal(kpiWords("i dati del backtest eseguiti"), "i dati della prova sul passato eseguiti", "the participle goes with «dati», not with the word");
  assert.equal(kpiWords("la baseline prima del via"), "il valore di partenza prima del via", "«prima» after the word means «before»");
  assert.equal(kpiWords("prima la baseline, poi il backtest"), "prima il valore di partenza, poi la prova sul passato");
  assert.equal(kpiWords("rispetto a baseline"), "rispetto a valore di partenza");
  assert.equal(kpiWords("kpi.baseline.x e baseline_mesi"), "kpi.baseline.x e baseline_mesi");
  assert.equal(kpiWords("baselines"), "baselines");
  assert.equal(kpiWords("1 baseline"), "1 valore di partenza");
});

test("one dot per KPI: ready, to confirm or to define", () => {
  assert.equal(kpiReadiness({ definitionOk: true, dataOk: true, hasFormula: true }), "pronto");
  assert.equal(kpiReadiness({ definitionOk: true, dataOk: false, hasFormula: false }), "da_confermare");
  assert.equal(kpiReadiness({ definitionOk: false, dataOk: true, hasFormula: false }), "da_confermare");
  assert.equal(kpiReadiness({ definitionOk: false, dataOk: false, hasFormula: true }), "da_confermare");
  assert.equal(kpiReadiness({ definitionOk: false, dataOk: false, hasFormula: false }), "da_definire");
  assert.deepEqual(KPI_READINESS_VIEW.pronto, { label: "Pronto", tone: "verde" });
  assert.deepEqual(KPI_READINESS_VIEW.da_confermare, { label: "Da confermare", tone: "giallo" });
  assert.deepEqual(KPI_READINESS_VIEW.da_definire, { label: "Da definire", tone: "grigio" });
});

test("the full KPI for the panel: semaphores, dot, anti-vanity and defaults for the starting value and target", () => {
  const items = [
    modelRow({ id: "k1", key: "kpi.servizio.tempo", spec: { formula: "media dei minuti", unit: "minuti", direzione: "più basso è meglio", dimensioni: ["canale"] } }),
    modelRow({ id: "k3", key: "kpi.servizio.attesa", spec: { target: "dopo la baseline" } }),
    modelRow({ id: "k2", key: "kpi.costi.richiesta", priority: "should", status: "validata", spec: { pnl_line: "Costi del servizio", baseline: "18 €", target: "15 €" } }),
  ];
  const links = [
    linkRow({ from_item_id: "k1", to_item_id: "s1", relation: "alimentato_da", t_key: "src.crm.richieste", t_title: "Export", t_kind: "fonte", t_availability: ["oggi_export"] }),
    linkRow({ from_item_id: "q1", to_item_id: "k1", relation: "precisa", f_key: "q.servizio.09", f_title: "La formula è giusta?", f_kind: "domanda", f_status: "in_verifica", f_response_type: "conferma_formula", t_key: "kpi.servizio.tempo", t_kind: "kpi" }),
    linkRow({ from_item_id: "k2", to_item_id: "s2", relation: "alimentato_da", t_key: "src.erp.costi", t_title: "Costi", t_kind: "fonte", t_availability: ["da_chiedere"] }),
  ];
  const [k1, k3, k2] = buildKpis({
    itemRows: items,
    linkRows: links,
    measurementRows: [
      { item_id: "k2", phase: "baseline", period_start: "2026-01-01", period_end: "2026-03-31", value: "17.5", unit: "€", suppressed: false, status: "provvisorio" },
      { item_id: "k2", phase: "backtest", period_start: "2026-04-01", period_end: "2026-04-30", value: null, unit: "€", suppressed: true, status: "provvisorio" },
    ],
    roles: ["owner_cliente"],
    roleLabels: {},
  });
  assert.equal(k3.target, "dopo il valore di partenza");
  assert.equal(k1.formula, "media dei minuti");
  assert.equal(k1.unit, "minuti");
  assert.equal(k1.dimensions, "canale");
  assert.equal(k1.baseline, DEFAULT_BASELINE);
  assert.equal(k1.target, DEFAULT_TARGET);
  assert.equal(DEFAULT_TARGET, "dopo il valore di partenza", "no «baseline» in the interface");
  assert.equal(k1.definition.ok, false, "the formula question is not validated yet");
  assert.equal(k1.data.ok, true);
  assert.equal(k1.readiness, "da_confermare");
  assert.equal(k1.vanity, true);
  assert.deepEqual(k1.confirmQuestions.map((q) => q.key), ["q.servizio.09"]);
  assert.deepEqual(k1.sources.map((s) => s.key), ["src.crm.richieste"]);
  assert.equal(k2.definition.ok, true);
  assert.equal(k2.data.ok, false);
  assert.equal(k2.readiness, "da_confermare");
  assert.equal(k2.data.label, "Fonte da verificare");
  assert.equal(k2.vanity, false);
  assert.equal(k2.baseline, "18 €");
  assert.equal(k2.measurements.length, 2);
  assert.equal(k2.measurements[0].phase, "Valore di partenza");
  assert.equal(k2.measurements[0].value, "17,5 €");
  assert.equal(k2.measurements[1].phase, "Prova sul passato");
  assert.equal(k2.measurements[1].value, null);
  assert.equal(k2.measurements[1].suppressed, true);
});

const kpiDbRow = (over: Record<string, unknown>) => ({
  id: ID(1),
  key: "kpi.servizio.tempo",
  title: "Tempo medio di risposta",
  explanation: "Minuti dalla richiesta alla risposta.",
  status: "da_chiedere",
  priority: "must",
  levers: ["tempo", "qualita", "non_una_leva"],
  spec: { formula: "media dei minuti" },
  formula_confirmed: false,
  data_ready: false,
  ...over,
});

test("the light row: dot from the database signs, linked to the account by a P&L line or by a line of the account", () => {
  const none = new Set<string>();
  const plain = rowToKpiRow(kpiDbRow({}), none);
  assert.deepEqual(plain.levers, ["tempo", "qualita"]);
  assert.equal(plain.readiness, "da_confermare");
  assert.equal(plain.linked, false);
  assert.equal(plain.vanity, true, "an indispensable KPI with no link to the account");
  const usedByAccount = rowToKpiRow(kpiDbRow({}), new Set(["kpi.servizio.tempo"]));
  assert.equal(usedByAccount.linked, true);
  assert.equal(usedByAccount.vanity, false);
  const pnl = rowToKpiRow(kpiDbRow({ spec: { pnl_line: "Costi del personale" } }), none);
  assert.equal(pnl.linked, true);
  assert.equal(pnl.readiness, "da_definire", "no formula and nothing confirmed");
  const control = rowToKpiRow(kpiDbRow({ spec: { kpi_controllo: true } }), none);
  assert.equal(control.linked, false);
  assert.equal(control.vanity, false, "a control KPI is not vanity");
  const ready = rowToKpiRow(kpiDbRow({ formula_confirmed: true, data_ready: "t" }), none);
  assert.equal(ready.readiness, "pronto");
  const validated = rowToKpiRow(kpiDbRow({ status: "validata", data_ready: true }), none);
  assert.equal(validated.readiness, "pronto");
  assert.equal(rowToKpiRow(kpiDbRow({ title: "  ", priority: "should" }), none).title, "kpi.servizio.tempo", "the key only when the title is missing");
  assert.equal(rowToKpiRow(kpiDbRow({ priority: "should" }), none).vanity, false);
});

test("the titles of the light row and of the panel follow the vocabulary", () => {
  assert.equal(rowToKpiRow(kpiDbRow({ title: "Scostamento dalla baseline" }), new Set()).title, "Scostamento dal valore di partenza");
  const [k] = buildKpis({ itemRows: [modelRow({ id: "k1", key: "kpi.a.b", title: "Esito del backtest" })], linkRows: [], measurementRows: [], roles: ["owner_cliente"], roleLabels: {} });
  assert.equal(k.item.title, "Esito della prova sul passato");
});

test("URL parameters: view, search and panel; everything else is ignored", () => {
  assert.deepEqual(parseKpiParams({}), { vista: null, q: null, apri: null, gruppi: [], pagine: {} });
  assert.deepEqual(parseKpiParams({ vista: "tutti", q: "  tempo   medio ", apri: ID(7), area: "servizio", priorita: "must" }), {
    vista: "tutti",
    q: "tempo medio",
    apri: ID(7),
    gruppi: [],
    pagine: {},
  });
  assert.deepEqual(parseKpiParams({ vista: "boh", q: "", apri: "k1" }), { vista: null, q: null, apri: null, gruppi: [], pagine: {} });
  assert.deepEqual(parseKpiParams({ pagine: "ricavi-3,costi-1,boh-2,altri-2,tempo-x,nuove_capacita-12,rischio-99999" }).pagine, { ricavi: 3, altri: 2, nuove_capacita: 12 });
  assert.deepEqual(parseKpiParams({ gruppi: "boh, tempo,altri,costi" }).gruppi, ["tempo"], "one open group: the first that exists");
  assert.deepEqual(parseKpiParams({ gruppi: "boh" }).gruppi, []);
  assert.equal(parseKpiParams({ q: "x".repeat(300) }).q?.length, 100);
  assert.equal(parseKpiParams({ vista: ["conto", "tutti"] }).vista, "conto");
  assert.equal(kpiQuery({ vista: "conto", q: "tempo medio", apri: ID(2) }), `?vista=conto&q=tempo+medio&apri=${ID(2)}`);
  assert.equal(kpiQuery({ vista: "tutti", gruppi: ["tempo", "altri"] }), "?vista=tutti&gruppi=tempo%2Caltri");
  assert.equal(kpiQuery({ vista: null, q: null, apri: null }), "");
  assert.equal(kpiQuery({ gruppi: ["ricavi", "costi"], pagine: { ricavi: 3, costi: 1 }, apri: ID(2) }), `?gruppi=ricavi%2Ccosti&pagine=ricavi-3&apri=${ID(2)}`);
  assert.deepEqual(withGroupPage({ ricavi: 3 }, "costi", 2), { ricavi: 3, costi: 2 });
  assert.deepEqual(withGroupPage({ ricavi: 3 }, "ricavi", 1), {}, "the first page is not written");
  assert.deepEqual(pagesOfOpen({ ricavi: 3, costi: 2 }, ["costi"]), { costi: 2 }, "a group that closes starts again from the first page");
});

test("the default view is «linked to the account» when there is one, «to fix» only for Lateral Space", () => {
  assert.equal(kpiView(null, { linked: 3, ls: false }), "conto");
  assert.equal(kpiView(null, { linked: 0, ls: true }), "tutti");
  assert.equal(kpiView("tutti", { linked: 3, ls: false }), "tutti");
  assert.equal(kpiView("conto", { linked: 0, ls: false }), "conto", "asked explicitly: an empty view, not a different one");
  assert.equal(kpiView("da-sistemare", { linked: 3, ls: true }), "da-sistemare");
  assert.equal(kpiView("da-sistemare", { linked: 3, ls: false }), "tutti");
  const rows = [rowToKpiRow(kpiDbRow({ id: ID(1) }), new Set()), rowToKpiRow(kpiDbRow({ id: ID(2), spec: { pnl_line: "Ricavi" } }), new Set())];
  assert.deepEqual(kpisInView(rows, "conto").map((k) => k.id), [ID(2)]);
  assert.deepEqual(kpisInView(rows, "da-sistemare").map((k) => k.id), [ID(1)]);
  assert.equal(kpisInView(rows, "tutti").length, 2);
});

test("groups by the main lever, in the order of the levers, KPIs without a lever last and titles in order", () => {
  const row = (id: number, title: string, levers: string[]): KpiRow => rowToKpiRow(kpiDbRow({ id: ID(id), key: `kpi.a.k${id}`, title, levers }), new Set());
  const groups = groupKpisByLever([row(1, "Zeta", ["qualita"]), row(2, "Ålfa", []), row(3, "Beta", ["tempo", "qualita"]), row(4, "Alfa", ["tempo"]), row(5, "Gamma", ["rischio"])]);
  assert.deepEqual(
    groups.map((g) => [g.lever, g.items.map((k) => k.title)]),
    [
      ["tempo", ["Alfa", "Beta"]],
      ["qualita", ["Zeta"]],
      ["rischio", ["Gamma"]],
      [null, ["Ålfa"]],
    ],
  );
  assert.deepEqual(groupKpisByLever([]), []);
});

test("groups: all open with a few KPIs or a search that finds a few, otherwise the one in the address, one at a time", () => {
  assert.equal(groupsOpen({ shown: 12, searching: false, requested: [] }), "tutti");
  assert.deepEqual(groupsOpen({ shown: 13, searching: false, requested: [] }), []);
  assert.equal(groupsOpen({ shown: 40, searching: true, requested: [] }), "tutti");
  assert.deepEqual(groupsOpen({ shown: 184, searching: true, requested: ["costi"] }), ["costi"], "a search that finds everything stays short");
  assert.deepEqual(groupsOpen({ shown: 184, searching: false, requested: ["tempo"] }), ["tempo"]);
  assert.deepEqual(groupsOpen({ shown: 184, searching: false, requested: [] }), []);
  assert.deepEqual(toggleGroup(["tempo"], "costi"), ["costi"], "opening a group closes the other");
  assert.deepEqual(toggleGroup(["tempo"], "tempo"), []);
  assert.deepEqual(toggleGroup([], "tempo"), ["tempo"]);
});

test("an open group sends at most one page of rows; the header keeps the count and a page past the last is the last", () => {
  const rows = Array.from({ length: 51 }, (_, i) =>
    rowToKpiRow(kpiDbRow({ id: ID(i + 1), key: `kpi.r.k${String(i + 1).padStart(2, "0")}`, title: `Ricavo ${String(i + 1).padStart(2, "0")}`, levers: ["ricavi"] }), new Set()),
  );
  const other = rowToKpiRow(kpiDbRow({ id: ID(100), key: "kpi.t.k", title: "Tempo", levers: ["tempo"] }), new Set());
  const groups = groupKpisByLever([...rows, other]);
  assert.equal(KPI_GROUP_PAGE, 20);
  const [tempo, ricavi] = groupViews(groups, ["ricavi"], {});
  assert.deepEqual([tempo.key, tempo.total, tempo.rows, tempo.from], ["tempo", 1, null, 0], "a closed group sends no rows");
  assert.deepEqual([ricavi.key, ricavi.total, ricavi.page, ricavi.pages, ricavi.from, ricavi.to], ["ricavi", 51, 1, 3, 1, 20]);
  assert.equal(ricavi.rows?.length, 20);
  assert.equal(ricavi.rows?.[0].title, "Ricavo 01");
  const last = groupViews(groups, ["ricavi"], { ricavi: 3 })[1];
  assert.deepEqual([last.page, last.from, last.to, last.rows?.length], [3, 41, 51, 11]);
  assert.equal(last.rows?.[0].title, "Ricavo 41");
  assert.equal(groupViews(groups, ["ricavi"], { ricavi: 9 })[1].page, 3, "past the last page: the last one");
  const all = groupViews(groups, "tutti", {});
  assert.deepEqual(
    all.map((g) => g.rows?.length),
    [1, 20],
    "with every group open (a few KPIs or a search) the page cap still holds",
  );
});

test("the grey anti-vanity line", () => {
  assert.equal(vanityText(1), "1 KPI indispensabile senza una voce del conto");
  assert.equal(vanityText(1200), "1.200 KPI indispensabili senza una voce del conto");
});
