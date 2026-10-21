import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { COST_BANDS } from "../cost-bands.ts";
import type { HubItem, UseCaseDetail } from "../views.ts";
import { cardOutput, costOutput, guideAreaOptions, searchItemOutput, valueOutput, waitingDaysOutput, zoneLabel } from "./output.ts";

// Le uscite del MCP del team (docs/use-case/DESIGN.md §9.4): etichette accanto ai codici, come
// nella pagina (§7.1, §7.2, §7.4; «stimato dall'impegno» di H4p), giorni di attesa solo per «Da
// decidere» (D8, §4.3, §4.6) e aree della guida del connettore (§6.2).

const TODAY = "2026-10-19";

function item(over: Partial<HubItem> = {}): HubItem {
  return {
    id: randomUUID(),
    code: "XX-0042",
    title: "Smistamento richieste",
    origin: "adoption",
    kind: "da_costruire",
    phase: "da_valutare",
    subState: "nuova",
    phaseLabel: "Da valutare · Nuova",
    tone: "grigio",
    quando: null,
    targetQuarter: null,
    reviewBy: null,
    value: { score: null, word: null, source: null, perYear: null },
    cost: null,
    zone: null,
    risks: [],
    claudeHoursPerYear: null,
    source: "web_proposed",
    area: null,
    aiLab: null,
    hiddenFromSearch: false,
    publicNote: null,
    answered: false,
    problemPreview: null,
    arrivedOn: "2025-09-01",
    waitingSince: "2025-09-01",
    realizedOn: null,
    dossier: null,
    version: 1,
    ...over,
  };
}

test("giorni di attesa solo per «Da decidere»: null per approvati, in realizzazione, realizzati, chiusi e rimandate non ancora scadute", () => {
  const waiting = (over: Partial<HubItem>) => waitingDaysOutput(item(over), TODAY);
  for (const subState of ["nuova", "possibile_doppione", "valutata", "serve_info", "da_rivedere"] as const) {
    assert.equal(waiting({ subState }), 413, subState);
  }
  assert.equal(waiting({ subState: "rimandata" }), null, "rimandata non ancora scaduta");
  assert.equal(waiting({ phase: "approvato", subState: "trimestre" }), null);
  assert.equal(waiting({ phase: "approvato", subState: "piu_avanti" }), null);
  assert.equal(waiting({ phase: "in_realizzazione", subState: "dossier" }), null);
  assert.equal(waiting({ phase: "realizzato", subState: "realizzato" }), null);
  assert.equal(waiting({ phase: "chiuso", subState: "archiviato" }), null);
  assert.equal(searchItemOutput(item({ phase: "realizzato", subState: "realizzato" }), COST_BANDS, TODAY).waitingDays, null);
  assert.equal(searchItemOutput(item(), COST_BANDS, TODAY).waitingDays, 413);
});

test("Valore, costo e zona hanno l'etichetta della pagina accanto al codice; il costo dall'impegno è «stimato dall'impegno»", () => {
  assert.deepEqual(valueOutput({ score: 4.04, word: "alto", source: "ai", perYear: null }), { word: "alto", wordLabel: "Alto", score: 4, source: "ai", sourceLabel: "AI" });
  assert.deepEqual(valueOutput({ score: null, word: null, source: null, perYear: null }), { word: null, wordLabel: "da stimare", score: null, source: null, sourceLabel: null });
  const effort = costOutput({ source: "sforzo", amount: null, band: 3, fromBand: true, position: 3, referenceEur: 50_000 }, COST_BANDS);
  assert.equal(effort?.source, "sforzo");
  assert.equal(effort?.sourceLabel, "stimato dall'impegno");
  assert.equal(JSON.stringify(effort).includes("da sforzo"), false);
  assert.equal(costOutput({ source: "dossier", amount: 30_000, band: 2, fromBand: false, position: 2, referenceEur: 30_000 }, COST_BANDS)?.sourceLabel, "dal dossier");
  assert.equal(costOutput({ source: "team_importo", amount: 30_000, band: 2, fromBand: false, position: 2, referenceEur: 30_000 }, COST_BANDS)?.sourceLabel, "importo del team");
  assert.equal(zoneLabel("se_avanza_tempo"), "Se avanza tempo");
  assert.equal(zoneLabel(null), "da stimare");
});

test("la scheda di get_use_case: etichette nella valutazione, euro all'anno con la fonte, aree della guida, attesa null fuori da «Da decidere»", () => {
  const base = item({
    phase: "approvato",
    subState: "trimestre",
    value: { score: 3, word: "medio", source: "team", perYear: { amount: 80_000, source: "dossier" } },
    cost: { source: "team_fascia", amount: null, band: 2, fromBand: true, position: 2, referenceEur: 25_000 },
    zone: "da_pianificare",
  });
  const detail = {
    ...base,
    description: "Problema",
    flowDescription: null,
    humanInTheLoop: null,
    guardrails: null,
    businessCase: null,
    dataRequirements: null,
    sustainabilityImpact: null,
    intake: null,
    possibleDuplicateOf: null,
    customScores: null,
    aiSuggestion: null,
    valueEurYear: null,
    costEurOnce: null,
    costBand: 2,
    reviewNotes: null,
    timeline: null,
    requirements: null,
    dataDependencies: null,
  } as UseCaseDetail;
  const areaOptions = [{ id: "operazioni", label: "Operazioni" }];
  const out = cardOutput(detail, {
    model: { dimensions: { impact: [], feasibility: [], esg: [] } },
    costBands: COST_BANDS,
    esgEnabled: false,
    today: TODAY,
    dossierRead: "ok",
    link: "https://www.theunbundle.com/dashboard/x/use-cases/y",
    areaOptions,
  });
  assert.equal(out.waitingDays, null);
  assert.deepEqual(out.areaOptions, areaOptions);
  assert.equal(out.valuation.valore.wordLabel, "Medio");
  assert.deepEqual(out.valuation.valore.perYear, { amount: 80_000, source: "dossier", sourceLabel: "dal dossier" });
  assert.equal(out.valuation.costo?.sourceLabel, "fascia del team");
  assert.equal(out.valuation.zoneLabel, "Da pianificare");
  const free = cardOutput(detail, { model: { dimensions: { impact: [], feasibility: [], esg: [] } }, costBands: COST_BANDS, esgEnabled: false, today: TODAY, dossierRead: "ok", link: "x" });
  assert.equal(free.areaOptions, null, "senza elenco l'area è un testo libero");
});

test("aree della guida: stringhe o oggetti con id e titolo in label, nome o name; doppioni e voci vuote fuori; senza elenco null", () => {
  assert.deepEqual(
    guideAreaOptions({
      areas: ["operazioni", { id: "vendite", label: " Vendite e clienti " }, { id: "hr", nome: "Persone" }, { id: "it", name: "Sistemi" }, { id: "solo_id" }, "operazioni", "", { label: "senza id" }, 42],
    }),
    [
      { id: "operazioni", label: "operazioni" },
      { id: "vendite", label: "Vendite e clienti" },
      { id: "hr", label: "Persone" },
      { id: "it", label: "Sistemi" },
      { id: "solo_id", label: "solo_id" },
    ],
  );
  assert.equal(guideAreaOptions(null), null);
  assert.equal(guideAreaOptions({}), null);
  assert.equal(guideAreaOptions({ areas: "operazioni" }), null);
  assert.equal(guideAreaOptions({ areas: [] }), null);
  assert.equal(guideAreaOptions([{ id: "x" }]), null);
});
