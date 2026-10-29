import test from "node:test";
import assert from "node:assert/strict";
import { COST_BANDS, DEFAULT_COST_BANDS_CONFIG } from "./cost-bands.ts";
import type { ContributorUseCase, UseCaseViewer } from "./permissions.ts";
import type { ValuationModel } from "./valuation.ts";
import { DEFAULT_VALUE_PARAMS, valueModelSchema } from "./value-model.ts";
import {
  EXPORT_COLUMNS,
  HUB_PARAM_KEYS,
  HUB_SHOW_PARAMS,
  HUB_VIEWS,
  HUB_VIEW_ALIASES,
  RUNS_PER_YEAR,
  applyHubFilters,
  bandText,
  buildDecideList,
  buildPriority,
  claudeHoursPerYear,
  decideCount,
  defaultHubView,
  exportRow,
  hasActiveFilters,
  matchesSearch,
  monthLabel,
  parseHubParams,
  pendingValueTotal,
  projectHubItem,
  projectUseCaseDetail,
  quarterOfItem,
  roadmapGroupKey,
  roadmapGroupLabel,
  roadmapTotals,
  romeDay,
  shownChart,
  toEstimateLabel,
  totalsNote,
  waitingDays,
  waitingLabel,
  waitingStart,
  workspaceValuationModel,
  type DetailSourceRow,
  type HubContext,
  type HubItem,
  type HubParams,
  type HubSourceRow,
} from "./views.ts";

// docs/use-case/DESIGN.md §4.2-4.7, §4.10, §7.2, §7.5; PIANO-LAVORI H2b. Dati inventati:
// codici XX-0000, email solo in domini .test.

const TODAY = "2026-10-14"; // T4 2026

const MODEL: ValuationModel = {
  dimensions: {
    impact: [{ id: "efficiency", weight: 1 }, { id: "profitability", weight: 1 }],
    feasibility: [{ id: "effort", weight: 1, direction: "lower_better" }],
    esg: [{ id: "environmental", weight: 1 }],
  },
  overall: { impact: 0.5, feasibility: 0.3, esg: 0.2 },
  thresholds: { highImpact: 3.5, midImpact: 2.5, highFeasibility: 3.5 },
};
const CTX: HubContext = { model: MODEL, esgEnabled: false, today: TODAY };

/** Fasce di un workspace diverse dalle predefinite (D15). */
const WORKSPACE_BANDS = {
  limits: [15_000, 40_000, 90_000, 200_000],
  labels: ["Piccolo", "Medio", "Grande", "Molto grande", "Enorme"],
  topReferenceEur: 300_000,
};

let seq = 0;
function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function row(o: Partial<HubSourceRow> = {}): HubSourceRow {
  seq += 1;
  return {
    id: uuid(seq),
    code: `XX-${String(seq).padStart(4, "0")}`,
    title: `Use case di prova ${String(seq).padStart(3, "0")}`,
    description: "Smistare le richieste in arrivo alla persona giusta.",
    origin: "adoption",
    portfolioKind: "use_case_ai",
    status: "proposed",
    portfolioReviewStatus: "in_review",
    reviewedBy: null,
    publicNote: null,
    intake: null,
    reviewBy: null,
    targetQuarter: null,
    customScores: null,
    aiSuggestion: null,
    valueEurYear: null,
    costEurOnce: null,
    costBand: null,
    source: "web_proposed",
    aiLab: null,
    submittedAt: new Date("2026-10-01T10:00:00Z"),
    createdAt: new Date("2026-10-01T10:00:00Z"),
    statusChangedAt: new Date("2026-10-13T10:00:00Z"),
    version: 1,
    impactEconomic: null,
    impactTime: null,
    impactQuality: null,
    impactCoordination: null,
    impactSocial: null,
    feasibilityData: null,
    feasibilityWorkflow: null,
    feasibilityRisk: null,
    feasibilityTech: null,
    feasibilityTeam: null,
    esgEnvironmental: null,
    esgSocial: null,
    esgGovernance: null,
    reopenedOn: null,
    realizedOn: null,
    ...o,
  };
}

function item(o: Partial<HubSourceRow> = {}, ctx: HubContext = CTX): HubItem {
  return projectHubItem(row(o), ctx, null);
}

/** Valore alto (team): due KPI d'impatto a 4. */
const HIGH = { impact: { efficiency: 4, profitability: 4 } };
/** Valore medio (team). */
const MID = { impact: { efficiency: 3, profitability: 3 } };
/** Valore basso (team). */
const LOW = { impact: { efficiency: 2, profitability: 2 } };

const viewer = (role: string | null, isLateralSpace = false): UseCaseViewer => ({
  userId: uuid(9000),
  email: "persona.prova@cliente.test",
  emailVerified: true,
  role,
  isLateralSpace,
});

const contributorItem = (o: Partial<ContributorUseCase> & { title: string }): ContributorUseCase =>
  ({ id: uuid(8000 + (seq += 1)), phase: "da_valutare", subState: "nuova", phaseLabel: "Da valutare · Nuova", quando: null, own: false, ...o }) as ContributorUseCase;

// ─── parseHubParams (§4.2, §4.7, §11) ────────────────────────────────

test("parseHubParams: solo le chiavi dell'elenco, con valori validi; ogni altro parametro si ignora", () => {
  const params = parseHubParams(
    {
      vista: "priorita",
      tipo: "diffondere",
      mostra: "lista",
      origine: "transformation",
      q: "  smistamento   richieste ",
      canale: "slack_proposed",
      area: "Finanza",
      agente: "LIBRA",
      lab: "AI Lab Prova",
      trimestre: "2027-Q1",
      stima: "mancante",
      info: "da-verificare",
      apri: uuid(1).toUpperCase(),
      nuovo: "1",
      thanks: "1",
      created: uuid(2),
      joined: "upgraded",
      proponente: "persona.prova@cliente.test",
      proposedBy: "persona.prova@cliente.test",
      autore: "x",
      persona: "x",
      ordina: "proponente",
      raggruppa: "autore",
    },
    viewer("transformation_lead", true),
  );
  assert.deepEqual(Object.keys(params), [...HUB_PARAM_KEYS]);
  // `vista=priorita` vale la Panoramica; «Da diffondere» resta, senza grafico né «da stimare» (`legacyPriority`).
  assert.deepEqual(params, {
    vista: "panoramica",
    tipo: "diffondere",
    mostra: null,
    origine: "transformation",
    q: "smistamento richieste",
    canale: "slack_proposed",
    area: "Finanza",
    agente: "LIBRA",
    lab: "AI Lab Prova",
    trimestre: "2027-Q1",
    stima: null,
    info: "da_verificare",
    apri: uuid(1),
    nuovo: true,
    thanks: true,
    created: uuid(2),
    joined: "upgraded",
  } satisfies HubParams);
});

test("parseHubParams: valori fuori elenco diventano null, anche da URLSearchParams e con parametri ripetuti", () => {
  const lead = viewer("function_lead");
  const params = parseHubParams(
    new URLSearchParams("vista=tutte&tipo=altro&mostra=griglia&origine=entrambe&q=a&canale=email&agente=libra&trimestre=2027-Q5&stima=si&info=bloccate&apri=12&nuovo=1&thanks=2&created=x&joined=0"),
    lead,
  );
  for (const key of HUB_PARAM_KEYS) {
    if (key === "nuovo" || key === "thanks") assert.equal(params[key], false, key);
    else assert.equal(params[key], null, key);
  }
  // `nuovo=1` è solo del pannello rapido di Lateral Space: l'AI Builder del cliente apre il modulo completo.
  assert.equal(parseHubParams({ nuovo: "1" }, lead).nuovo, false);
  assert.equal(parseHubParams({ vista: ["roadmap", "priorita"], q: ["ab", "cd"] }, lead).vista, "panoramica");
  assert.equal(parseHubParams({ q: "x".repeat(101) }, lead).q, null, "oltre 100 caratteri");
  assert.equal(parseHubParams({ q: "x".repeat(100) }, lead).q, "x".repeat(100));
  assert.equal(parseHubParams({ trimestre: "piu-avanti" }, lead).trimestre, "piu-avanti");
});

test("parseHubParams: al contributore restano vista (non «Cosa serve»), ricerca, apri e ricevute", () => {
  const contributor = viewer("contributor");
  const params = parseHubParams(
    { vista: "priorita", tipo: "costruire", mostra: "matrice", origine: "adoption", q: "prezzi", canale: "learning", area: "Finanza", agente: "LIBRA", lab: "Lab", trimestre: "2027-Q1", stima: "mancante", info: "senza-risposta", nuovo: "1", thanks: "1", created: uuid(3), apri: uuid(4) },
    contributor,
  );
  assert.equal(params.vista, "panoramica", "i vecchi nomi valgono la Panoramica");
  for (const key of ["tipo", "mostra", "origine", "canale", "area", "agente", "lab", "trimestre", "stima", "info"] as const) assert.equal(params[key], null, key);
  assert.equal(params.nuovo, false);
  assert.equal(params.q, "prezzi");
  assert.equal(params.thanks, true);
  assert.equal(params.created, uuid(3));
  assert.equal(params.apri, uuid(4));
  assert.equal(parseHubParams({ vista: "da-decidere" }, contributor).vista, "da-decidere");
  assert.equal(parseHubParams({ vista: "roadmap" }, contributor).vista, "panoramica");
  assert.equal(parseHubParams({ vista: "panoramica" }, contributor).vista, "panoramica");
  assert.equal(parseHubParams({ vista: "cosa-serve" }, contributor).vista, null, "«Cosa serve» non è per i contributori");
  // Chi non entra nell'area non ha filtri.
  assert.equal(parseHubParams({ origine: "adoption" }, viewer("learner")).origine, null);
  assert.equal(parseHubParams({ vista: "cosa-serve" }, viewer("learner")).vista, null);
});

test("parseHubParams: «Cosa serve» resta ai revisori", () => {
  for (const role of ["function_lead", "analyst", "transformation_lead", "exec_sponsor"]) {
    assert.equal(parseHubParams({ vista: "cosa-serve" }, viewer(role)).vista, "cosa-serve", role);
  }
  assert.equal(parseHubParams({ vista: "cosa-serve" }, viewer("transformation_lead", true)).vista, "cosa-serve", "Lateral Space");
});

test("hasActiveFilters: vista, apri e ricevute non sono filtri", () => {
  const lead = viewer("function_lead");
  assert.equal(hasActiveFilters(parseHubParams({ vista: "panoramica", apri: uuid(5), thanks: "1" }, lead)), false);
  assert.equal(hasActiveFilters(parseHubParams({ origine: "adoption" }, lead)), true);
  assert.equal(hasActiveFilters(parseHubParams({ q: "prezzi" }, lead)), true);
  assert.equal(hasActiveFilters(parseHubParams({ vista: "panoramica", tipo: "diffondere" }, lead)), true);
  // «Raccolta informazioni» è un filtro (Parte 2).
  assert.equal(hasActiveFilters(parseHubParams({ info: "in-attesa" }, lead)), true);
  // «Agente» è un filtro (rilascio «Panoramica»), anche «Altri use case».
  assert.equal(hasActiveFilters(parseHubParams({ agente: "LIBRA" }, lead)), true);
  assert.equal(hasActiveFilters(parseHubParams({ agente: "altri" }, lead)), true);
  assert.equal(hasActiveFilters(parseHubParams({ agente: "libra" }, lead)), false, "le minuscole non valgono");
  assert.equal(hasActiveFilters(parseHubParams({ info: "bloccate" }, lead)), false, "un valore sconosciuto non vale");
});

test("parseHubParams: «info» solo per i revisori e solo con i valori noti", () => {
  for (const [raw, state] of [
    ["da-chiedere", "da_chiedere"],
    ["in-attesa", "in_attesa"],
    ["da-verificare", "da_verificare"],
    ["senza-risposta", "senza_risposta"],
    ["complete", "complete"],
  ] as const) {
    assert.equal(parseHubParams({ info: raw }, viewer("function_lead")).info, state, raw);
  }
  for (const raw of ["da_verificare", "bloccate", "", "DA-VERIFICARE"]) assert.equal(parseHubParams({ info: raw }, viewer("function_lead")).info, null, raw);
  assert.equal(parseHubParams({ info: "complete" }, viewer("contributor")).info, null);
  assert.equal(parseHubParams({ info: "complete" }, viewer("learner")).info, null);
});

test("hasActiveFilters: sulle due matrici il tipo non è un filtro (ignoreKind)", () => {
  const lead = viewer("function_lead");
  assert.equal(hasActiveFilters(parseHubParams({ vista: "panoramica", mostra: "matrice", tipo: "diffondere" }, lead), { ignoreKind: true }), false);
  assert.equal(hasActiveFilters(parseHubParams({ tipo: "costruire" }, lead), { ignoreKind: true }), false);
  assert.equal(
    hasActiveFilters(parseHubParams({ vista: "panoramica", mostra: "matrice", tipo: "diffondere", origine: "adoption" }, lead), { ignoreKind: true }),
    true,
  );
});

test("i vecchi link di «Priorità» e «Roadmap» valgono la Panoramica", () => {
  const lead = viewer("function_lead");
  const read = (raw: Record<string, string>) => {
    const params = parseHubParams(raw, lead);
    return { vista: params.vista, tipo: params.tipo, mostra: params.mostra, stima: params.stima };
  };
  // «Priorità»: «Da costruire | Da diffondere» sceglieva la lista; il chip «N da stimare» apre la matrice.
  for (const [raw, expected] of [
    [{ vista: "priorita" }, { tipo: null, mostra: null, stima: null }],
    [{ vista: "priorita", tipo: "costruire" }, { tipo: null, mostra: null, stima: null }],
    [{ vista: "priorita", tipo: "diffondere", mostra: "matrice", stima: "mancante" }, { tipo: "diffondere", mostra: null, stima: null }],
    [{ vista: "priorita", mostra: "matrice" }, { tipo: null, mostra: "matrice", stima: null }],
    [{ vista: "priorita", tipo: "costruire", stima: "mancante" }, { tipo: null, mostra: "matrice", stima: "mancante" }],
    [{ vista: "priorita", mostra: "lista", stima: "fuori-matrice" }, { tipo: null, mostra: "matrice", stima: "fuori-matrice" }],
  ] as const) {
    assert.deepEqual(read(raw), { vista: "panoramica", ...expected }, JSON.stringify(raw));
  }
  // «Roadmap»: ogni parametro resta com'è.
  const roadmap = parseHubParams(
    { vista: "roadmap", tipo: "costruire", origine: "adoption", q: "fatture", canale: "team_mcp", trimestre: "2027-Q1", info: "in-attesa", apri: uuid(6), thanks: "1", created: uuid(7) },
    lead,
  );
  assert.deepEqual(
    [roadmap.vista, roadmap.tipo, roadmap.origine, roadmap.q, roadmap.canale, roadmap.trimestre, roadmap.info, roadmap.apri, roadmap.thanks, roadmap.created],
    ["panoramica", "costruire", "adoption", "fatture", "team_mcp", "2027-Q1", "in_attesa", uuid(6), true, uuid(7)],
  );
  // `mostra=lista` non vale più: la Panoramica con le corsie.
  assert.equal(parseHubParams({ mostra: "lista" }, lead).mostra, null);
  // Il contributore non ha grafici.
  const contributor = parseHubParams({ vista: "priorita", mostra: "matrice" }, viewer("contributor"));
  assert.deepEqual([contributor.vista, contributor.mostra], ["panoramica", null]);
  const fromSearch = parseHubParams(new URLSearchParams(`vista=priorita&apri=${uuid(8)}`), lead);
  assert.deepEqual([fromSearch.vista, fromSearch.apri], ["panoramica", uuid(8)]);
  // Solo i nomi esatti: niente maiuscole, niente chiavi ereditate.
  for (const vista of ["toString", "__proto__", "Roadmap", "PRIORITA", "hasOwnProperty"]) assert.equal(parseHubParams({ vista }, lead).vista, null, vista);
});

test("HUB_VIEW_ALIASES: le chiavi non sono viste, i valori sì", () => {
  assert.equal(HUB_VIEWS[0], "panoramica", "la Panoramica è la prima vista");
  assert.deepEqual(Object.keys(HUB_VIEW_ALIASES).sort(), ["priorita", "roadmap"]);
  for (const [alias, view] of Object.entries(HUB_VIEW_ALIASES)) {
    assert.ok(!(HUB_VIEWS as readonly string[]).includes(alias), alias);
    assert.ok(HUB_VIEWS.includes(view), view);
  }
  assert.ok(Object.isFrozen(HUB_VIEW_ALIASES));
  assert.deepEqual([...HUB_SHOW_PARAMS], ["matrice", "benefici", "curva", "agenti"]);
});

test("shownChart: il grafico del menu «⋯» che la Panoramica apre", () => {
  assert.equal(shownChart(null, []), null);
  assert.equal(shownChart("agenti", ["matrice", "benefici", "curva"]), null, "per agente non è un grafico");
  assert.equal(shownChart("matrice", []), "matrice", "anche senza use case da mettere in ordine");
  assert.equal(shownChart("benefici", ["matrice"]), "matrice", "un vecchio link senza «Benefici e costi»");
  assert.equal(shownChart("benefici", ["matrice", "benefici"]), "benefici");
  assert.equal(shownChart("curva", ["matrice"]), null, "senza curva le corsie");
  assert.equal(shownChart("curva", ["matrice", "curva"]), "curva");
});

test("defaultHubView: revisori «Da decidere» se c'è qualcosa, altrimenti la Panoramica; sponsor del cliente e contributori la Panoramica", () => {
  assert.equal(defaultHubView(viewer("transformation_lead", true), 3), "da-decidere");
  assert.equal(defaultHubView(viewer("transformation_lead", true), 0), "panoramica");
  assert.equal(defaultHubView(viewer("function_lead"), 2), "da-decidere");
  assert.equal(defaultHubView(viewer("analyst"), 0), "panoramica");
  assert.equal(defaultHubView(viewer("exec_sponsor"), 5), "panoramica", "sponsor del cliente");
  assert.equal(defaultHubView(viewer("exec_sponsor", true), 5), "da-decidere", "sponsor di Lateral Space");
  assert.equal(defaultHubView(viewer("contributor"), 5), "panoramica");
  // «Cosa serve» non è mai la vista di partenza, un vecchio nome nemmeno.
  for (const role of ["exec_sponsor", "transformation_lead", "function_lead", "analyst", "contributor", "learner", null]) {
    for (const lateral of [false, true]) {
      for (const count of [0, 4]) {
        const view = defaultHubView(viewer(role, lateral), count);
        assert.notEqual(view, "cosa-serve", `${role} ${lateral} ${count}`);
        assert.ok(!Object.hasOwn(HUB_VIEW_ALIASES, view), `${role} ${lateral} ${count}`);
      }
    }
  }
});

// ─── Ricerca e filtri (§4.7) ─────────────────────────────────────────

test("ricerca dei revisori: titolo e codice, senza maiuscole né accenti", () => {
  const it = item({ code: "XX-0042", title: "Qualità delle offerte" });
  assert.equal(matchesSearch(it, "QUALITA"), true);
  assert.equal(matchesSearch(it, "xx-0042"), true);
  assert.equal(matchesSearch(it, "0042"), true);
  assert.equal(matchesSearch(it, "fatture"), false);
  assert.equal(matchesSearch(it, null), true);
});

test("ricerca del contributore: il titolo, e il codice solo delle proprie proposte", () => {
  const own = contributorItem({ title: "Riepilogo turni", own: true, code: "XX-0101", publicNote: null });
  const other = contributorItem({ title: "Controllo fatture" });
  assert.equal(matchesSearch(own, "XX-0101"), true, "il codice di una propria proposta");
  assert.equal(matchesSearch(own, "turni"), true);
  assert.equal(matchesSearch(other, "fatture"), true);
  // La proiezione altrui non ha il codice: anche cercandolo, non trova nulla.
  assert.equal(matchesSearch(other, "XX-0102"), false);
  const params = parseHubParams({ q: "XX-01" }, viewer("contributor"));
  assert.deepEqual(applyHubFilters([own, other], params), [own]);
});

test("filtri dei revisori: origine, tipo, canale, area, AI Lab, trimestre, da stimare", () => {
  const lead = viewer("function_lead");
  const a = item({ origin: "adoption", source: null, intake: { area: "Finanza" }, aiLab: "AI Lab Prova", customScores: HIGH, costEurOnce: 10_000 });
  const b = item({ origin: "transformation", portfolioKind: "best_practice", source: "slack_proposed", status: "accepted", targetQuarter: "2027-Q1" });
  const c = item({ origin: "adoption", status: "accepted", targetQuarter: null, source: "web_proposed" });
  const all = [a, b, c];
  const filter = (raw: Record<string, string>) => applyHubFilters(all, parseHubParams(raw, lead)).map((i) => i.id);
  assert.deepEqual(filter({ origine: "transformation" }), [b.id]);
  assert.deepEqual(filter({ tipo: "diffondere" }), [b.id]);
  assert.deepEqual(filter({ tipo: "costruire" }), [a.id, c.id], "NULL e use_case_ai sono «Da costruire»");
  assert.deepEqual(filter({ canale: "activity_mapping" }), [a.id], "source NULL vale Activity mapping");
  assert.deepEqual(filter({ area: "finanza" }), [a.id]);
  assert.deepEqual(filter({ lab: "ai lab prova" }), [a.id]);
  assert.deepEqual(filter({ trimestre: "2027-Q1" }), [b.id]);
  assert.deepEqual(filter({ trimestre: "piu-avanti" }), [c.id]);
  assert.deepEqual(filter({ stima: "mancante" }), [b.id, c.id]);
  // Sulle due matrici il tipo non filtra.
  assert.deepEqual(
    applyHubFilters(all, parseHubParams({ tipo: "diffondere" }, lead), { ignoreKind: true }).map((i) => i.id),
    [a.id, b.id, c.id],
  );
});

test("filtro «Agente»: il prefisso del titolo, «altri» senza; i contributori restano come sono", () => {
  const lead = viewer("function_lead");
  const l1 = item({ title: "LIBRA L1 · Lettura delle fatture estere" });
  const l2 = item({ title: "LIBRA L2 · Riconciliazione dei pagamenti" });
  const auto = item({ title: "AUTO H1 · Cedolini consegnati" });
  const plain = item({ title: "Smistamento delle richieste" });
  const all = [l1, auto, plain, l2];
  const filter = (raw: Record<string, string>) => applyHubFilters(all, parseHubParams(raw, lead)).map((i) => i.id);
  assert.deepEqual(filter({ agente: "LIBRA" }), [l1.id, l2.id]);
  assert.deepEqual(filter({ agente: "AUTO" }), [auto.id]);
  assert.deepEqual(filter({ agente: "altri" }), [plain.id], "gli use case senza prefisso");
  assert.deepEqual(filter({ agente: "SIRIO" }), [], "un agente che non c'è");
  assert.deepEqual(filter({ agente: "libra" }), [l1.id, auto.id, plain.id, l2.id], "un valore non valido non filtra");
  assert.deepEqual(filter({ agente: "LIBRA", q: "pagamenti" }), [l2.id], "con la ricerca");
  // Le righe dei contributori non si filtrano (e il contributore non ha «Agente»).
  const own = contributorItem({ title: "Smistamento turni" });
  assert.deepEqual(applyHubFilters([own], parseHubParams({ agente: "LIBRA" }, lead)), [own]);
  assert.equal(parseHubParams({ agente: "LIBRA" }, viewer("contributor")).agente, null);
  assert.equal(parseHubParams({ agente: "LIBRA" }, viewer("learner")).agente, null);
});

test("HUB_PARAM_KEYS: «agente» subito dopo «area», nell'ordine degli indirizzi", () => {
  assert.equal(HUB_PARAM_KEYS.indexOf("agente"), HUB_PARAM_KEYS.indexOf("area") + 1);
});

test("filtro «Informazioni»: lo stato derivato della scheda, i contributori restano come sono", () => {
  const lead = viewer("function_lead");
  const a = item({});
  const b = item({});
  const c = item({});
  const states: Record<string, "da_verificare" | "in_attesa"> = { [a.id]: "da_verificare", [b.id]: "in_attesa" };
  const infoOf = (id: string) => states[id] ?? null;
  const filter = (raw: Record<string, string>) => applyHubFilters([a, b, c], parseHubParams(raw, lead), { infoOf }).map((i) => i.id);
  assert.deepEqual(filter({ info: "da-verificare" }), [a.id], "corrisponde");
  assert.deepEqual(filter({ info: "in-attesa" }), [b.id]);
  assert.deepEqual(filter({ info: "complete" }), [], "nessuna scheda con quello stato");
  assert.deepEqual(filter({}), [a.id, b.id, c.id], "senza filtro tutte");
  // Senza `infoOf` (nessuno stato letto) il filtro non trova niente, invece di mostrare tutto.
  assert.deepEqual(applyHubFilters([a, b, c], parseHubParams({ info: "da-verificare" }, lead)).map((i) => i.id), []);
  const own = contributorItem({ title: "Riepilogo turni" });
  assert.deepEqual(applyHubFilters([own], parseHubParams({ info: "da-verificare" }, lead), { infoOf }), [own], "le righe dei contributori non si filtrano");
});

// ─── Giorni di attesa (D8) ───────────────────────────────────────────

test("giorni di attesa: dall'ultimo «Riapri», altrimenti dall'arrivo; «Da rivedere» dalla data di revisione", () => {
  assert.equal(waitingStart({ subState: "nuova", reviewBy: null, reopenedOn: null, arrivedOn: "2026-10-01" }), "2026-10-01");
  assert.equal(waitingStart({ subState: "nuova", reviewBy: null, reopenedOn: "2026-10-10", arrivedOn: "2026-09-01" }), "2026-10-10");
  assert.equal(waitingStart({ subState: "da_rivedere", reviewBy: "2026-10-12", reopenedOn: null, arrivedOn: "2026-08-01" }), "2026-10-12");
  assert.equal(waitingDays("2026-10-08", TODAY), 6);
  assert.equal(waitingDays("2026-10-14", TODAY), 0);
  assert.equal(waitingDays("2026-10-20", TODAY), 0, "mai negativi");
  assert.equal(waitingDays("2025-12-31", "2026-01-02"), 2, "cambio d'anno");
  assert.equal(waitingLabel(0), "oggi");
  assert.equal(waitingLabel(1), "da 1 giorno");
  assert.equal(waitingLabel(6), "da 6 giorni");
});

test("giorni di attesa: mai dall'ultimo cambio di stato; arrivo da submitted_at, poi created_at, a Roma", () => {
  const base = { submittedAt: new Date("2026-09-30T22:30:00Z"), createdAt: new Date("2026-09-01T10:00:00Z") };
  const a = item({ ...base, statusChangedAt: new Date("2026-10-13T10:00:00Z") });
  const b = item({ ...base, statusChangedAt: new Date("2026-09-30T10:00:00Z") });
  assert.equal(a.arrivedOn, "2026-10-01", "le 22:30 UTC del 30 settembre sono già il 1° ottobre a Roma");
  assert.equal(a.waitingSince, "2026-10-01");
  assert.equal(b.waitingSince, a.waitingSince, "salvare una valutazione non azzera l'attesa");
  const noSubmit = item({ submittedAt: null, createdAt: new Date("2026-09-15T08:00:00Z") });
  assert.equal(noSubmit.waitingSince, "2026-09-15");
  const reopened = item({ ...base, reopenedOn: "2026-10-11" });
  assert.equal(reopened.waitingSince, "2026-10-11");
  const dueReview = item({ ...base, portfolioReviewStatus: "scored", reviewBy: "2026-10-12" });
  assert.equal(dueReview.subState, "da_rivedere");
  assert.equal(dueReview.waitingSince, "2026-10-12");
});

test("romeDay: istanti al giorno di Roma, giorni già pronti passano com'è", () => {
  assert.equal(romeDay(new Date("2026-06-30T22:30:00Z")), "2026-07-01");
  assert.equal(romeDay("2026-10-14"), "2026-10-14");
  assert.equal(romeDay("2026-02-30"), null);
  assert.equal(romeDay(null), null);
});

// ─── «Da decidere» (§4.3) ────────────────────────────────────────────

test("«Da decidere»: dai giorni di attesa, «Serve info» sotto il divisore, contatore senza «Serve info»", () => {
  const old = item({ submittedAt: new Date("2026-09-01T10:00:00Z") });
  const recent = item({ submittedAt: new Date("2026-10-12T10:00:00Z") });
  const reopened = item({ submittedAt: new Date("2026-08-01T10:00:00Z"), reopenedOn: "2026-10-13" });
  const evaluated = item({ portfolioReviewStatus: "scored", submittedAt: new Date("2026-09-20T10:00:00Z") });
  const duplicate = item({ intake: { possibleDuplicateOf: "XX-0001" }, submittedAt: new Date("2026-10-05T10:00:00Z") });
  const needInfo = item({ portfolioReviewStatus: "needs_inputs", reviewedBy: uuid(77), publicNote: "Quante richieste a settimana?", submittedAt: new Date("2026-08-15T10:00:00Z") });
  const postponed = item({ reviewBy: "2026-12-01" });
  const due = item({ portfolioReviewStatus: "scored", reviewBy: "2026-10-10", submittedAt: new Date("2026-07-01T10:00:00Z") });
  const approved = item({ status: "accepted" });
  const list = buildDecideList([recent, needInfo, old, postponed, evaluated, reopened, approved, duplicate, due]);
  assert.deepEqual(
    list.waiting.map((i) => i.id),
    [old.id, evaluated.id, duplicate.id, due.id, recent.id, reopened.id],
  );
  assert.deepEqual(list.needInfo.map((i) => i.id), [needInfo.id]);
  assert.equal(list.count, 6);
  assert.equal(decideCount([recent, needInfo, old, postponed, approved]), 2);
  assert.equal(postponed.subState, "rimandata");
  assert.equal(list.waiting.includes(postponed), false, "una «Rimandata» resta fuori finché la data non arriva");
});

test("«In valutazione» del contributore: tutta la fase «Da valutare», nell'ordine del server, senza divisore né contatore (H4p)", () => {
  // Delle proposte altrui il contributore non riceve il sotto-stato: tutte stanno nella stessa lista.
  const a = contributorItem({ title: "B", subState: null, phaseLabel: "Da valutare" });
  const b = contributorItem({ title: "A", subState: "serve_info", phaseLabel: "Da valutare · Serve info" });
  const c = contributorItem({ title: "C" });
  const d = contributorItem({ title: "D", phase: "approvato", subState: "piu_avanti", phaseLabel: "Approvato · Più avanti", quando: "Più avanti" });
  const e = contributorItem({ title: "E", subState: "rimandata", phaseLabel: "Da valutare · Rimandata al 14 gen" });
  const list = buildDecideList([a, b, c, d, e]);
  assert.deepEqual(list.waiting, [a, b, c, e]);
  assert.deepEqual(list.needInfo, []);
  assert.equal(list.count, 0);
  assert.equal(decideCount([a, b, c, d, e]), 0, "i contributori non decidono: nessun contatore");
});

test("«In valutazione»: le proprie proposte restano dove le mette il server, nessun ordine per proponente (art. 15.4)", () => {
  const a = contributorItem({ title: "A" });
  const mine1 = contributorItem({ title: "B", own: true, code: "XX-0101", publicNote: null } as Partial<ContributorUseCase> & { title: string });
  const b = contributorItem({ title: "C" });
  const mine2 = contributorItem({ title: "D", own: true, code: "XX-0102", publicNote: null } as Partial<ContributorUseCase> & { title: string });
  assert.deepEqual(buildDecideList([a, mine1, b, mine2]).waiting, [a, mine1, b, mine2]);
});

test("D17: «answered» solo dopo una risposta a «Serve info» non ancora decisa", () => {
  const risposte = [{ at: "2026-10-10T09:00:00.000Z", text: "Circa 40 visite al mese." }];
  const intake = { risposte, rispostaInAttesa: risposte[0].at };
  assert.equal(item({ intake }).answered, true, "tornata in «Da decidere»");
  const asked = item({ intake, portfolioReviewStatus: "needs_inputs", reviewedBy: uuid(9001), publicNote: "Altra domanda?" });
  assert.equal(asked.subState, "serve_info");
  assert.equal(asked.answered, false, "di nuovo in «Serve info»");
  assert.equal(item({ intake, status: "accepted", targetQuarter: "2027-Q1" }).answered, false, "già deciso");
  assert.equal(item({}).answered, false, "senza risposte");
  // Una decisione toglie il segno: rimandata, o riaperta con le risposte vecchie, non è «Risposta ricevuta».
  const postponed = item({ intake: { risposte }, reviewBy: "2027-01-14" });
  assert.equal(postponed.subState, "rimandata");
  assert.equal(postponed.answered, false, "rimandata");
  assert.equal(item({ intake: { risposte }, reviewBy: "2026-01-14" }).answered, false, "da rivedere");
  const reopened = item({ intake: { risposte } });
  assert.equal(reopened.subState, "nuova");
  assert.equal(reopened.answered, false, "riaperta dopo «Non avviare»");
});

// ─── Matrice Valore × Costo e zone (§4.4, §7.4) ───────────────────────

test("matrice Valore × Costo: «Da costruire», zona, poi Valore, poi Costo; «da stimare» in fondo; punti per i soli stimati", () => {
  const subito = item({ customScores: HIGH, costEurOnce: 18_000 });
  const subitoCheaper = item({ customScores: HIGH, costEurOnce: 9_000 });
  const pianificare = item({ customScores: HIGH, costEurOnce: 120_000, status: "accepted", targetQuarter: "2027-Q1" });
  const seAvanza = item({ customScores: MID, costBand: 1 });
  const nonOra = item({ customScores: LOW, costEurOnce: 300_000 });
  const missingCost = item({ customScores: HIGH });
  const missingValue = item({ costEurOnce: 20_000 });
  const postponed = item({ customScores: HIGH, costEurOnce: 5_000, reviewBy: "2026-12-01" });
  const bestPractice = item({ customScores: HIGH, costEurOnce: 5_000, portfolioKind: "best_practice", status: "accepted" });
  const started = item({ customScores: HIGH, costEurOnce: 5_000, status: "in_progress" });
  const view = buildPriority([nonOra, missingCost, seAvanza, subito, pianificare, missingValue, subitoCheaper, postponed, bestPractice, started]);
  // A parità di zona e Valore, costo crescente; tra i «da stimare» prima chi ha il Valore.
  assert.deepEqual(
    view.list.map((i) => i.id),
    [subitoCheaper.id, subito.id, pianificare.id, seAvanza.id, nonOra.id, missingCost.id, missingValue.id],
  );
  assert.deepEqual(view.list.map((i) => i.zone), ["subito", "subito", "da_pianificare", "se_avanza_tempo", "non_ora", null, null]);
  assert.deepEqual(view.toEstimate.map((i) => i.id), [missingCost.id, missingValue.id], "l'elenco «da stimare», nell'ordine della matrice");
  assert.deepEqual(view.offMatrix, { items: [], withoutBenefit: 0 }, "nessuna scheda con «Benefici e costi»");
  assert.equal(view.points.length, 5);
  const point = view.points.find((p) => p.id === pianificare.id)!;
  assert.equal(point.approved, true, "pieno se approvato");
  assert.equal(view.points.find((p) => p.id === subito.id)!.approved, false, "vuoto se da decidere");
  assert.ok(point.x > 3 && point.x < 4, "120.000 € nella terza fascia predefinita");
  assert.equal(point.y, 4);
  assert.equal(view.points.find((p) => p.id === seAvanza.id)!.x, 1, "una fascia sta al centro");
  for (const excluded of [postponed, bestPractice, started]) assert.equal(view.list.includes(excluded), false);
  assert.equal(toEstimateLabel(view.toEstimate.length), "2 da stimare");
});

test("stima di Claude (§7.5): minuti × volte all'anno × persone, alle decine; null con un dato mancante", () => {
  assert.equal(claudeHoursPerYear({ timeSavedMinutesPerRun: 15, frequency: "giornaliera", beneficiaries: 3 }), 180);
  assert.equal(claudeHoursPerYear({ timeSavedMinutesPerRun: 240, frequency: "mensile", beneficiaries: 2 }), 100);
  assert.equal(claudeHoursPerYear({ timeSavedMinutesPerRun: 30, frequency: "settimanale", beneficiaries: 1 }), 20);
  assert.equal(claudeHoursPerYear({ timeSavedMinutesPerRun: 30, frequency: "ad_hoc", beneficiaries: 1 }), null);
  assert.equal(claudeHoursPerYear({ frequency: "giornaliera", beneficiaries: 1 }), null);
  assert.equal(claudeHoursPerYear(null), null);
  // Una stima piccola ma vera non diventa zero: 30 min × 1 volta × 5 persone = 2,5 ore.
  assert.equal(claudeHoursPerYear({ timeSavedMinutesPerRun: 30, frequency: "una_tantum", beneficiaries: 5 }), 10);
  // Zero ore non è una stima: niente «circa 0 ore all'anno».
  assert.equal(claudeHoursPerYear({ timeSavedMinutesPerRun: 0, frequency: "giornaliera", beneficiaries: 4 }), null);
  assert.equal(claudeHoursPerYear({ timeSavedMinutesPerRun: 20, frequency: "settimanale", beneficiaries: 0 }), null);
  assert.deepEqual(Object.keys(RUNS_PER_YEAR), ["giornaliera", "settimanale", "mensile", "trimestrale", "una_tantum"]);
});

test("zone e costo con le fasce e le soglie del workspace (D15, D18)", () => {
  // Una config di prima: 40.000 € è il confine della seconda fascia del workspace.
  const model = workspaceValuationModel(MODEL, { costBands: WORKSPACE_BANDS, thresholds: { costLowMaxEur: 40_000 } });
  assert.equal(model.thresholds?.costLowBand, 2);
  const ctx = { ...CTX, model };
  const amount = item({ customScores: HIGH, costEurOnce: 30_000 }, ctx);
  assert.equal(amount.cost?.band, 2, "30.000 € nella seconda fascia del workspace");
  assert.equal(amount.cost?.bandLabel, "Medio");
  assert.equal(amount.zone, "subito", "costo basso fino a 40.000 € in questo workspace");
  const band = item({ customScores: HIGH, costBand: 3 }, ctx);
  assert.equal(band.cost?.bandLabel, "Grande", "la fascia salvata si legge con l'etichetta del workspace");
  assert.equal(band.cost?.referenceEur, 90_000);
  assert.equal(band.zone, "da_pianificare");
  const top = item({ customScores: HIGH, costBand: 5 }, ctx);
  assert.equal(top.cost?.referenceEur, 300_000, "la quinta vale il riferimento del workspace");
  const effort = item({ customScores: { ...HIGH, feasibility: { effort: 3 } } }, ctx);
  assert.equal(effort.cost?.source, "sforzo");
  assert.equal(effort.cost?.referenceEur, 65_000, "nei totali lo sforzo vale l'importo stimato");
  assert.equal(effort.cost?.band, 3, "65.000 € nella terza fascia del workspace");
  // Senza fasce del workspace valgono le predefinite.
  assert.equal(item({ costEurOnce: 30_000 }).cost?.bandLabel, COST_BANDS[1].label);
});

test("workspaceValuationModel: la config normalizzata vince, le chiavi nuove arrivano dal jsonb; il costo basso è sempre una fascia (D18)", () => {
  const raw = { scoringVersion: 2, costKpiId: "sforzo", thresholds: { costLowMaxEur: 30_000 }, costBands: DEFAULT_COST_BANDS_CONFIG };
  const model = workspaceValuationModel(MODEL, raw);
  assert.equal(model.scoringVersion, 2);
  assert.equal(model.costKpiId, "sforzo");
  assert.equal(model.thresholds?.costLowBand, 2, "30.000 € è nella seconda fascia");
  assert.equal("costLowMaxEur" in (model.thresholds ?? {}), false);
  assert.equal(model.thresholds?.highImpact, 3.5);
  assert.equal(model.costBands, DEFAULT_COST_BANDS_CONFIG);
  const already = workspaceValuationModel({ ...MODEL, scoringVersion: 1, thresholds: { ...MODEL.thresholds, costLowBand: 3 } }, raw);
  assert.equal(already.scoringVersion, 1);
  assert.equal(already.thresholds?.costLowBand, 3, "la fascia della config normalizzata vince");
  // La soglia in euro della config normalizzata ha un predefinito: conta solo quella del jsonb.
  const injected = workspaceValuationModel({ ...MODEL, thresholds: { ...MODEL.thresholds, costLowMaxEur: 200_000 } }, raw);
  assert.equal(injected.thresholds?.costLowBand, 2);
  assert.equal(workspaceValuationModel({ ...MODEL, thresholds: { ...MODEL.thresholds, costLowMaxEur: 25_000 } }, { costBands: WORKSPACE_BANDS }).thresholds?.costLowBand, 1);
  const bare = workspaceValuationModel(MODEL, null);
  assert.equal(bare.scoringVersion, undefined);
  assert.equal(bare.costBands, undefined);
  assert.equal(bare.thresholds?.costLowBand, 1, "predefinita la fascia 1");
  assert.equal(workspaceValuationModel(MODEL, { scoringVersion: "2", thresholds: { costLowMaxEur: -5 } }).scoringVersion, undefined);
  assert.equal(workspaceValuationModel(MODEL, { thresholds: { costLowMaxEur: -5 } }).thresholds?.costLowBand, 1);
});

// ─── Trimestri e cifre della Panoramica (§4.5) ───────────────────────
// Le corsie stanno in lanes.test.ts; qui le chiavi dei trimestri, che leggono anche la testa della
// Panoramica, le due matrici del menu «⋯» e il riepilogo in campanella.

test("trimestri rispetto a oggi: «Scaduti», questo, il prossimo, i successivi, «Più avanti»", () => {
  const quarters = ["2026-Q3", "2026-Q4", "2027-Q1", "2027-Q2", "2027-Q3", null] as const;
  assert.deepEqual(
    quarters.map((quarter) => {
      const key = roadmapGroupKey(quarter, TODAY);
      return [key, roadmapGroupLabel(key, TODAY)];
    }),
    [
      ["scaduti", "Scaduti"],
      ["questo_trimestre", "Questo trimestre · T4 2026"],
      ["prossimo_trimestre", "Prossimo trimestre · T1 2027"],
      ["2027-Q2", "T2 2027"],
      ["2027-Q3", "T3 2027"],
      ["piu_avanti", "Più avanti"],
    ],
  );
  assert.equal(roadmapGroupKey("2026-Q4", "2027-01-02"), "scaduti", "a gennaio il T4 2026 è passato");
  assert.equal(roadmapGroupLabel("questo_trimestre", "2027-01-02"), "Questo trimestre · T1 2027");
  // Il trimestre del contributore viene dall'etichetta di «Quando»; senza trimestre «Più avanti».
  const own = contributorItem({ title: "Zeta", phase: "approvato", subState: "trimestre", phaseLabel: "Approvato · T3 2026", quando: "T3 2026" });
  const later = contributorItem({ title: "Gamma", phase: "approvato", subState: "piu_avanti", phaseLabel: "Approvato · Più avanti", quando: "Più avanti" });
  assert.equal(quarterOfItem(own), "2026-Q3");
  assert.equal(quarterOfItem(later), null);
  assert.equal(quarterOfItem(item({ status: "accepted", targetQuarter: "2027-Q1" })), "2027-Q1");
  // Il mese di «Realizzati»: senza Storia, l'ultimo cambio di stato.
  const doneNoEvent = item({ status: "implemented", statusChangedAt: new Date("2026-09-15T10:00:00Z") });
  assert.equal(doneNoEvent.realizedOn, "2026-09-15");
  assert.equal(item({ status: "implemented", realizedOn: "2026-10-02" }).realizedOn, "2026-10-02");
});

test("cifre della Panoramica: «su N use case · M da fascia», quota delle origini; nessuna cifra senza use case", () => {
  const items = [
    item({ status: "accepted", targetQuarter: "2026-Q4", valueEurYear: 60_000, costEurOnce: 40_000 }),
    item({ status: "accepted", origin: "transformation", valueEurYear: 40_000, costBand: 2 }),
    item({ status: "accepted", customScores: { feasibility: { effort: 4 } } }),
    item({ status: "accepted", portfolioKind: "best_practice", valueEurYear: 1_000, costEurOnce: 99_000 }),
    item({ status: "in_progress", portfolioKind: "best_practice", costEurOnce: 1_000 }),
    item({ valueEurYear: 500_000, costEurOnce: 500_000 }),
    item({ status: "implemented", valueEurYear: 500_000, costEurOnce: 500_000 }),
  ];
  const totals = roadmapTotals(items);
  assert.deepEqual(totals.expectedValue, {
    amountEur: 101_000,
    count: 3,
    fromBand: 0,
    share: { adoption: 60, transformation: 40 },
    note: "su 3 use case",
  });
  // 40.000 (importo) + 65.000 (fascia 2) + 130.000 (sforzo 4): gli approvati «Da costruire», l'avvio
  // che le card scrivono nelle corsie. La best practice approvata no, e nemmeno quella in realizzazione.
  assert.deepEqual(totals.committedCost, {
    amountEur: 235_000,
    count: 3,
    fromBand: 2,
    share: { adoption: 72, transformation: 28 },
    note: "su 3 use case · 2 da fascia",
  });
  assert.deepEqual(roadmapTotals([item({}), item({ status: "implemented", valueEurYear: 1 })]), { expectedValue: null, committedCost: null });
  // Uno use case «Da costruire» che apre il suo dossier è già partito: il suo avvio esce dalla cifra,
  // come esce dalla sua card, e il suo valore resta contato.
  const approved = item({ status: "accepted", valueEurYear: 9_000, costEurOnce: 560 });
  const started = item({ status: "in_progress", valueEurYear: 9_000, costEurOnce: 560 });
  assert.equal(roadmapTotals([approved]).committedCost?.amountEur, 560);
  assert.deepEqual(roadmapTotals([started]), { expectedValue: roadmapTotals([approved]).expectedValue, committedCost: null });
  assert.equal(roadmapTotals([approved, started]).committedCost?.note, "su 1 use case");
  assert.equal(totalsNote(9), "su 9 use case");
  assert.equal(totalsNote(7, 2), "su 7 use case · 2 da fascia");
});

test("cifre della Panoramica: la somma delle cifre delle card, arrotondate una a una; solo euro maggiori di zero", () => {
  const items = [
    item({ status: "accepted", targetQuarter: "2026-Q4", valueEurYear: 10.5 }),
    item({ status: "in_progress", valueEurYear: 0.5 }),
    item({ status: "accepted", valueEurYear: 0 }),
    item({ status: "accepted", valueEurYear: -3 }),
  ];
  // 11 € + 1 €, come le due card li scrivono; lo zero e il negativo non sono cifre (non lo sono neanche nelle corsie).
  const value = roadmapTotals(items).expectedValue;
  assert.deepEqual([value?.amountEur, value?.count, value?.note], [12, 2, "su 2 use case"]);
  const cost = roadmapTotals([item({ status: "accepted", costEurOnce: 0.5 }), item({ status: "accepted", costEurOnce: 1.5 })]).committedCost;
  assert.equal(cost?.amountEur, 3, "1 € + 2 €, non 2 €");
  // «fino a»: due «fino a 4.043 €» fanno 8.086 €, non 8.085 €.
  const ctx: HubContext = { ...CTX, valueParams: { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-10" } };
  const half = valueModelSchema.parse({
    v: 1,
    primary: "ricavi",
    components: [{ key: "ricavi", lever: "ricavi", label: "Più preventivi chiusi", kind: "euro", eurYear: 4_042.5, confidence: "da_misurare" }],
  });
  const pendingTwo = [item({ status: "accepted", valueModel: half }, ctx), item({ status: "in_progress", valueModel: half }, ctx)];
  assert.equal(pendingTwo[0].value.benefits?.pendingEur, 4_042.5);
  assert.deepEqual(pendingValueTotal(pendingTwo), { amountEur: 8_086, count: 2, note: "su 2 use case" });
});

test("«fino a» della Panoramica: i «da misurare» delle card approvate e in realizzazione con un modello; null senza", () => {
  const ctx: HubContext = { ...CTX, valueParams: { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-10" } };
  // Solo da misurare: «da misurare · fino a 1.200 €».
  const onlyPending = valueModelSchema.parse({
    v: 1,
    primary: "ricavi",
    components: [{ key: "ricavi", lever: "ricavi", label: "Più preventivi chiusi", kind: "euro", eurYear: 1_200, confidence: "da_misurare" }],
  });
  // Contato, con una parte da misurare: 535 € contati, 2.000 € fuori dal totale.
  const partly = valueModelSchema.parse({
    v: 1,
    primary: "costi",
    components: [
      { key: "costi", lever: "costi", label: "Meno licenze", kind: "euro", eurYear: 535, confidence: "ipotesi" },
      { key: "ricavi", lever: "ricavi", label: "Più rinnovi", kind: "euro", eurYear: 2_000, confidence: "da_misurare" },
    ],
  });
  const approved = item({ status: "accepted", targetQuarter: "2026-Q4", valueModel: onlyPending }, ctx);
  const building = item({ status: "in_progress", valueModel: partly }, ctx);
  assert.equal(approved.value.benefits?.state, "da_misurare");
  assert.equal(building.value.benefits?.state, "contato");
  const ignored = [
    item({ valueModel: onlyPending }, ctx),
    item({ status: "implemented", valueModel: partly }, ctx),
    item({ status: "accepted", valueEurYear: 5_000 }, ctx),
  ];
  assert.deepEqual(pendingValueTotal([approved, building, ...ignored]), { amountEur: 3_200, count: 2, note: "su 2 use case" });
  assert.equal(pendingValueTotal(ignored), null, "da valutare, realizzate e senza modello non contano");
  assert.equal(pendingValueTotal([]), null);
  // Il workspace conta anche le voci da misurare: non ne resta nessuna.
  const counted: HubContext = { ...ctx, valueParams: { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-10", includeUnmeasured: true } };
  const all = [item({ status: "accepted", valueModel: onlyPending }, counted), item({ status: "in_progress", valueModel: partly }, counted)];
  assert.equal(pendingValueTotal(all), null);
});

// ─── Proiezione e scheda dei revisori ────────────────────────────────

test("riga dei revisori: fase, Quando, fonti, rischio, dossier e anteprima del problema", () => {
  const dossier = { caseId: uuid(500), code: "XX-0500", status: "raccolta" as const, readiness: { required: 245, ok: 12 } };
  const started = projectHubItem(row({ status: "accepted", targetQuarter: "2027-Q1" }), CTX, dossier);
  assert.equal(started.phase, "in_realizzazione");
  assert.equal(started.phaseLabel, "In realizzazione · In preparazione");
  assert.equal(started.quando, null, "«Quando» solo in fase Approvato");
  assert.deepEqual(started.dossier, dossier);
  const approved = item({ status: "accepted", targetQuarter: "2027-Q1" });
  assert.equal(approved.quando, "T1 2027");
  assert.equal(approved.targetQuarter, "2027-Q1");
  const later = item({ status: "accepted" });
  assert.equal(later.quando, "Più avanti");
  const flagged = item({
    intake: { flags: { personalData: true, outsideFoundation: true }, hiddenFromSearch: true, area: "Acquisti" },
    origin: "transformation",
    description: `${"parola ".repeat(80)}fine`,
    aiSuggestion: { scores: { impact: { efficiency: 4 } }, rationale: "Prova" },
  });
  assert.deepEqual(flagged.risks, ["ai_board", "dati_personali"]);
  assert.equal(flagged.hiddenFromSearch, true);
  assert.equal(flagged.area, "Acquisti");
  assert.equal(flagged.origin, "transformation");
  assert.ok(flagged.problemPreview!.length <= 280 && flagged.problemPreview!.endsWith("…"));
  assert.equal(flagged.value.score, null, "in v1 il suggerimento dell'AI non conta");
  const v2 = projectHubItem(row({ aiSuggestion: { scores: { impact: { efficiency: 4 } } } }), { ...CTX, model: { ...MODEL, scoringVersion: 2 } }, null);
  assert.equal(v2.value.source, "ai");
  assert.equal(v2.value.word, "alto");
  const doubled = item({ portfolioReviewStatus: "archived", intake: { archiveReason: "duplicato", duplicateOfCode: "XX-0007" } });
  assert.equal(doubled.phaseLabel, "Chiuso · Doppione di XX-0007", "i revisori vedono il codice dell'altro");
});

test("scheda dei revisori: testi, intake ridotto, suggerimento dell'AI senza la copia della v1", () => {
  const source: DetailSourceRow = {
    ...row({
      intake: { area: "Finanza", frequency: "giornaliera", possibleDuplicateOf: "XX-0003", altraChiave: "fuori" },
      aiSuggestion: { scores: { impact: { efficiency: 3 } }, rationale: "Motivazione", model: "prova", at: "2026-10-01T00:00:00Z", kind: "auto", v1Backup: { customScores: null, reviewNotes: "x", at: "y" } },
      costBand: 2,
    }),
    flowDescription: "Come funziona",
    humanInTheLoop: "Chi controlla",
    guardrails: "Limiti",
    businessCase: "Impatto atteso",
    dataRequirements: "Dati",
    sustainabilityImpact: null,
    reviewNotes: "Nota interna",
    timeline: "",
    requirements: ["Accesso al gestionale", 3 as unknown as string],
    dataDependencies: null,
  };
  const detail = projectUseCaseDetail(source, CTX, null);
  assert.deepEqual(detail.intake, { area: "Finanza", frequency: "giornaliera", possibleDuplicateOf: "XX-0003" });
  assert.equal(detail.possibleDuplicateOf, "XX-0003");
  assert.deepEqual(detail.aiSuggestion, { scores: { impact: { efficiency: 3 } }, rationale: "Motivazione", model: "prova", at: "2026-10-01T00:00:00Z", kind: "auto" });
  assert.equal(detail.costBand, 2);
  assert.equal(detail.timeline, null);
  assert.deepEqual(detail.requirements, ["Accesso al gestionale"]);
  assert.equal(detail.reviewNotes, "Nota interna");
  assert.equal(detail.flowDescription, "Come funziona");
});

// ─── Export «Use case» (§4.1) ────────────────────────────────────────

test("riga dell'export: colonne di §4.1, fasce del workspace, «da stimare» dove manca una cifra", () => {
  const model = workspaceValuationModel(MODEL, { costBands: WORKSPACE_BANDS });
  const it = item({ customScores: HIGH, costBand: 2, valueEurYear: 60_000, status: "accepted", targetQuarter: "2027-Q1", aiLab: "AI Lab Prova", source: "slack_proposed", intake: { area: "Finanza" }, publicNote: "Nota per chi conosce il codice", submittedAt: new Date("2026-10-01T10:00:00Z") }, { ...CTX, model });
  const texts = { description: "Problema", flowDescription: "Come", humanInTheLoop: "Chi", guardrails: "Limiti", dataRequirements: "Dati" };
  const out = exportRow(it, texts);
  assert.deepEqual(Object.keys(out), [...EXPORT_COLUMNS]);
  assert.equal(out.Origine, "AI Adoption");
  assert.equal(out.Tipo, "Da costruire");
  assert.equal(out.Fase, "Approvato · T1 2027");
  assert.equal(out.Quando, "T1 2027");
  assert.equal(out.Valore, "Alto");
  assert.equal(out.Punteggio, 4);
  assert.equal(out["Fonte del valore"], "team");
  assert.equal(out["Valore all'anno"], 60_000);
  assert.equal(out.Costo, null);
  assert.equal(out.Fascia, "€€ · Medio", "etichetta delle fasce del workspace");
  assert.equal(out["Fonte del costo"], "fascia del team");
  // D18: senza una soglia salvata il costo basso è fino alla fascia 1, anche con le fasce del workspace.
  assert.equal(out.Zona, "Da pianificare");
  const upTo2 = workspaceValuationModel(MODEL, { costBands: WORKSPACE_BANDS, thresholds: { costLowBand: 2 } });
  assert.equal(exportRow(item({ customScores: HIGH, costBand: 2 }, { ...CTX, model: upTo2 }), texts).Zona, "Subito");
  assert.equal(out.Canale, "Slack");
  assert.equal(out.Area, "Finanza");
  assert.equal(out["Mese di arrivo"], "ott 2026");
  assert.equal(out.Problema, "Problema");
  const bare = exportRow(item({ portfolioKind: "best_practice" }), { description: null, flowDescription: null, humanInTheLoop: null, guardrails: null, dataRequirements: null });
  assert.equal(bare.Valore, "da stimare");
  assert.equal(bare["Fonte del costo"], "da stimare");
  assert.equal(bare.Zona, "da stimare");
  assert.equal(bare.Fascia, "");
  assert.equal(bare.Tipo, "Da diffondere");
  assert.equal(monthLabel("2027-01-31"), "gen 2027");
  // Senza `bandLabel` (figure costruite altrove) vale l'etichetta di `bands`.
  assert.equal(bandText({ ...it.cost!, bandLabel: undefined }), `€€ · ${COST_BANDS[1].label}`);
});
