import test from "node:test";
import assert from "node:assert/strict";
import {
  CHANGE_EVENT_FIELD,
  COST_AMOUNT_ERROR,
  COST_BAND_ERROR,
  COST_BOTH_ERROR,
  COST_EUR_ONCE_MAX,
  costColumns,
  KPI_SCORE_ERROR,
  KPI_UNKNOWN_ERROR,
  NO_CHANGES_ERROR,
  normalizeUseCaseCode,
  parseCostInput,
  parseEuroAmount,
  PUBLIC_NOTE_REQUIRED_ERROR,
  QUICK_CREATE_LIMITS,
  TEXT_LIMITS,
  TITLE_MIN_LENGTH,
  UNKNOWN_FIELD_ERROR,
  VALUE_AMOUNT_ERROR,
  VALUE_EUR_YEAR_MAX,
  validatePublicNote,
  validateQuickCreate,
  validateUseCaseChanges,
  validateValuation,
} from "./inputs.ts";
import { EVENT_FIELDS } from "./labels.ts";

// Limiti dei campi (docs/use-case/DESIGN.md §6.2, §6.4, §5.2) e campo costo (§5.4, D5).
// Testi sintetici.

const text = (n: number) => "a".repeat(n);

// ─── §6.2: limiti di «Cosa è» ────────────────────────────────────────

test("limiti di §6.2: titolo 200, testi lunghi 4.000, gli altri 2.000, area 80, AI Lab 120; nota pubblica 1.000", () => {
  assert.deepEqual(TEXT_LIMITS, {
    title: 200,
    description: 4000,
    flowDescription: 4000,
    humanInTheLoop: 2000,
    guardrails: 2000,
    businessCase: 2000,
    dataRequirements: 2000,
    sustainabilityImpact: 2000,
    area: 80,
    aiLab: 120,
    publicNote: 1000,
  });
});

test("ogni testo: al limite passa, un carattere in più no, con il messaggio in italiano", () => {
  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    const ok = validateUseCaseChanges({ [field]: text(max) });
    assert.equal(ok.ok, true, `${field} a ${max}`);
    const ko = validateUseCaseChanges({ [field]: text(max + 1) });
    assert.equal(ko.ok, false, `${field} a ${max + 1}`);
    if (!ko.ok) assert.match(ko.fieldErrors[field], /^Massimo [0-9.]+ caratteri\.$/);
  }
  const long = validateUseCaseChanges({ description: text(4001) });
  assert.deepEqual(long, { ok: false, fieldErrors: { description: "Massimo 4.000 caratteri." } });
  const note = validateUseCaseChanges({ publicNote: text(1001) });
  assert.deepEqual(note, { ok: false, fieldErrors: { publicNote: "Massimo 1.000 caratteri." } });
});

test("i limiti contano dopo aver tolto gli spazi in testa e in coda", () => {
  const result = validateUseCaseChanges({ title: `  ${text(200)}  `, aiLab: "  AI Lab Finanza · 12 ott  " });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.changes.title, text(200));
    assert.equal(result.changes.aiLab, "AI Lab Finanza · 12 ott");
  }
});

test("il titolo non si svuota e ha almeno 3 caratteri", () => {
  assert.equal(TITLE_MIN_LENGTH, 3);
  for (const title of ["", "  ", "ab", null]) assert.equal(validateUseCaseChanges({ title }).ok, false, String(title));
  assert.equal(validateUseCaseChanges({ title: "abc" }).ok, true);
});

test("gli altri testi si svuotano: vuoto o null vuol dire nessun valore", () => {
  const result = validateUseCaseChanges({ guardrails: "   ", description: null, publicNote: "" });
  assert.deepEqual(result, {
    ok: true,
    changes: { guardrails: null, description: null, publicNote: null },
    // Nell'ordine dei campi della scheda, non in quello dell'input.
    fields: ["problema", "limiti", "nota_pubblica"],
  });
});

test("area: con l'elenco della guida del connettore solo una voce dell'elenco, altrimenti testo di 80", () => {
  assert.equal(validateUseCaseChanges({ area: "Acquisti" }, { areaOptions: ["acquisti", "vendite"] }).ok, false);
  assert.equal(validateUseCaseChanges({ area: "acquisti" }, { areaOptions: ["acquisti", "vendite"] }).ok, true);
  assert.equal(validateUseCaseChanges({ area: null }, { areaOptions: ["acquisti"] }).ok, true, "si può togliere");
  assert.equal(validateUseCaseChanges({ area: "Acquisti" }).ok, true);
  assert.equal(validateUseCaseChanges({ area: "Acquisti" }, { areaOptions: [] }).ok, true, "elenco vuoto = testo libero");
});

test("origine, tipo e «Possibile doppione di»", () => {
  assert.equal(validateUseCaseChanges({ origin: "transformation", kind: "da_diffondere" }).ok, true);
  assert.equal(validateUseCaseChanges({ origin: "top-down" }).ok, false);
  assert.equal(validateUseCaseChanges({ kind: "best_practice" }).ok, false, "il tipo dell'area, non portfolio_kind");
  const dup = validateUseCaseChanges({ possibleDuplicateOf: " xx-0007 " });
  assert.equal(dup.ok && dup.changes.possibleDuplicateOf, "XX-0007");
  assert.equal(validateUseCaseChanges({ possibleDuplicateOf: "" }).ok && true, true);
  assert.deepEqual(validateUseCaseChanges({ possibleDuplicateOf: "doppione" }), {
    ok: false,
    fieldErrors: { possibleDuplicateOf: "Scrivi un codice come XX-0012." },
  });
  assert.equal(normalizeUseCaseCode("ab-12345"), "AB-12345");
  assert.equal(normalizeUseCaseCode("A-0001"), null);
  assert.equal(normalizeUseCaseCode(7), null);
});

test("campi fuori elenco rifiutati, e nessuna modifica è un errore", () => {
  assert.deepEqual(validateUseCaseChanges({ title: "Titolo", status: "accepted" }), {
    ok: false,
    fieldErrors: { status: UNKNOWN_FIELD_ERROR },
  });
  assert.deepEqual(validateUseCaseChanges({}), { ok: false, fieldErrors: { payload: NO_CHANGES_ERROR } });
  assert.equal(validateUseCaseChanges(null).ok, false);
});

test("la Storia registra solo i nomi dei campi, dall'elenco del CHECK della 0020", () => {
  const all = validateUseCaseChanges({
    title: "Titolo",
    description: "Problema",
    flowDescription: "Come",
    humanInTheLoop: "Chi",
    guardrails: "Limiti",
    businessCase: "Impatto",
    dataRequirements: "Dati",
    area: "Area",
    aiLab: "Lab",
    origin: "adoption",
    kind: "da_costruire",
    publicNote: "Nota",
    possibleDuplicateOf: "XX-0001",
    sustainabilityImpact: "ESG",
  });
  assert.equal(all.ok, true);
  if (all.ok) {
    assert.deepEqual(all.fields, [
      "titolo",
      "problema",
      "come_funziona",
      "chi_controlla",
      "limiti",
      "impatto_atteso",
      "dati",
      "area",
      "ai_lab",
      "origine",
      "tipo",
      "nota_pubblica",
      "possibile_doppione",
    ]);
    for (const field of all.fields) assert.ok((EVENT_FIELDS as readonly string[]).includes(field), field);
  }
  for (const field of Object.values(CHANGE_EVENT_FIELD)) {
    if (field !== null) assert.ok((EVENT_FIELDS as readonly string[]).includes(field), field);
  }
});

test("«Impatto ambientale e sociale» non ha un nome nel CHECK della 0020: la modifica del solo ESG non nomina campi", () => {
  // Punto aperto di §10.3 (vedi CHANGE_EVENT_FIELD). Quando l'elenco avrà un nome, questo test cambia.
  const keys = Object.keys(CHANGE_EVENT_FIELD).filter((key) => CHANGE_EVENT_FIELD[key as keyof typeof CHANGE_EVENT_FIELD] === null);
  assert.deepEqual(keys, ["sustainabilityImpact"]);
  assert.deepEqual(validateUseCaseChanges({ sustainabilityImpact: "Meno carta stampata." }), {
    ok: true,
    changes: { sustainabilityImpact: "Meno carta stampata." },
    fields: [],
  });
});

// ─── §6.4: nota pubblica ─────────────────────────────────────────────

test("nota pubblica: al massimo 1.000 caratteri, obbligatoria per «Serve info» e «Non avviare»", () => {
  assert.deepEqual(validatePublicNote("  Serve il volume mensile.  ", { required: true }), { ok: true, value: "Serve il volume mensile." });
  assert.deepEqual(validatePublicNote("  ", { required: true }), { ok: false, message: PUBLIC_NOTE_REQUIRED_ERROR });
  assert.deepEqual(validatePublicNote(null, { required: true }), { ok: false, message: PUBLIC_NOTE_REQUIRED_ERROR });
  assert.deepEqual(validatePublicNote(null, { required: false }), { ok: true, value: null });
  assert.deepEqual(validatePublicNote(text(1000), { required: true }), { ok: true, value: text(1000) });
  assert.deepEqual(validatePublicNote(text(1001), { required: true }), { ok: false, message: "Massimo 1.000 caratteri." });
  assert.equal(validatePublicNote(42, { required: false }).ok, false);
});

// ─── §5.4: costo di realizzazione ────────────────────────────────────

test("importo «40.000»: i punti delle migliaia si tolgono prima del controllo", () => {
  assert.deepEqual(parseEuroAmount("40.000", COST_EUR_ONCE_MAX), { ok: true, value: 40_000 });
  assert.deepEqual(parseEuroAmount("40000", COST_EUR_ONCE_MAX), { ok: true, value: 40_000 });
  assert.deepEqual(parseEuroAmount(" 1.250.000 ", COST_EUR_ONCE_MAX), { ok: true, value: 1_250_000 });
  assert.deepEqual(parseEuroAmount("100.000.000", COST_EUR_ONCE_MAX), { ok: true, value: 100_000_000 });
  assert.deepEqual(parseEuroAmount(40_000, COST_EUR_ONCE_MAX), { ok: true, value: 40_000 });
  assert.deepEqual(parseCostInput({ eurOnce: "40.000" }), { ok: true, value: { eurOnce: 40_000 } });
});

test("importo: intero da 0 a 100.000.000, senza decimali", () => {
  assert.equal(COST_EUR_ONCE_MAX, 100_000_000);
  assert.deepEqual(parseEuroAmount("0", COST_EUR_ONCE_MAX), { ok: true, value: 0 });
  for (const bad of ["40,5", "40.5", "40.000,50", "4.00", "40.0000", "-1", "1e5", "40 000", "€ 40000", "quaranta", "100.000.001", 100_000_001, 40_000.5, -1, Number.NaN, true, {}]) {
    assert.deepEqual(parseEuroAmount(bad, COST_EUR_ONCE_MAX), { ok: false }, String(bad));
  }
});

test("messaggio d'errore esatto di §5.4", () => {
  assert.equal(COST_AMOUNT_ERROR, "Scrivi un importo in euro, senza decimali (es. 40000).");
  for (const eurOnce of ["40,5", "-3", "molto", 100_000_001, 12.5]) {
    assert.deepEqual(parseCostInput({ eurOnce }), { ok: false, message: COST_AMOUNT_ERROR }, String(eurOnce));
    assert.deepEqual(validateValuation({ cost: { eurOnce } }), { ok: false, fieldErrors: { cost: COST_AMOUNT_ERROR } }, String(eurOnce));
  }
});

test("importo e fascia si escludono: mai tutti e due", () => {
  assert.deepEqual(parseCostInput({ eurOnce: 40_000, band: 3 }), { ok: false, message: COST_BOTH_ERROR });
  assert.deepEqual(parseCostInput({ eurOnce: "40.000", band: "3" }), { ok: false, message: COST_BOTH_ERROR });
  assert.deepEqual(validateValuation({ cost: { eurOnce: 1, band: 5 } }), { ok: false, fieldErrors: { cost: COST_BOTH_ERROR } });
  // Salvare un importo azzera la fascia, salvare una fascia azzera l'importo.
  assert.deepEqual(costColumns({ eurOnce: 40_000 }), { costEurOnce: 40_000, costBand: null });
  assert.deepEqual(costColumns({ band: 2 }), { costEurOnce: null, costBand: 2 });
  assert.deepEqual(costColumns(null), { costEurOnce: null, costBand: null });
});

test("fascia: una delle 5, anche come testo del RadioGroup", () => {
  for (const band of [1, 2, 3, 4, 5]) assert.deepEqual(parseCostInput({ band }), { ok: true, value: { band } });
  assert.deepEqual(parseCostInput({ band: "3" }), { ok: true, value: { band: 3 } });
  for (const band of [0, 6, 2.5, "6", "tre"]) assert.deepEqual(parseCostInput({ band }), { ok: false, message: COST_BAND_ERROR }, String(band));
});

test("campo vuoto e nessuna fascia: nessun costo del team; «Togli il costo» è null", () => {
  for (const raw of [null, { eurOnce: "" }, { eurOnce: "  " }, { eurOnce: null }, {}]) {
    assert.deepEqual(parseCostInput(raw), { ok: true, value: null }, JSON.stringify(raw));
  }
  assert.deepEqual(parseCostInput({ eurOnce: 40_000, extra: 1 }), { ok: false, message: UNKNOWN_FIELD_ERROR });
  assert.equal(parseCostInput([40_000]).ok, false);
});

// ─── Valutazione (§6.3) ──────────────────────────────────────────────

test("valutazione: KPI da 1 a 5 o «Nessun valore», valore all'anno, costo; la Storia nomina solo i campi", () => {
  const result = validateValuation({
    kpis: { impact: { efficiency: 4, profitability: null }, feasibility: { effort: "2" } },
    valueEurYear: "60.000",
    cost: { band: 2 },
  });
  assert.deepEqual(result, {
    ok: true,
    valuation: {
      kpis: { impact: { efficiency: 4, profitability: null }, feasibility: { effort: 2 } },
      valueEurYear: 60_000,
      cost: { band: 2 },
    },
    fields: ["kpi", "valore", "costo"],
  });
  assert.deepEqual(validateValuation({ cost: null }), { ok: true, valuation: { cost: null }, fields: ["costo"] });
  assert.deepEqual(validateValuation({ valueEurYear: "" }), { ok: true, valuation: { valueEurYear: null }, fields: ["valore"] });
});

test("valutazione: punteggi fuori scala, KPI fuori modello, importi non validi", () => {
  for (const score of [0, 6, 0.5, "alto", true]) {
    assert.deepEqual(
      validateValuation({ kpis: { impact: { efficiency: score } } }),
      { ok: false, fieldErrors: { "kpis.impact.efficiency": KPI_SCORE_ERROR } },
      String(score),
    );
  }
  const kpiIds = { impact: ["efficiency"], feasibility: ["effort"], esg: [] };
  assert.deepEqual(validateValuation({ kpis: { impact: { inventato: 3 } } }, { kpiIds }), {
    ok: false,
    fieldErrors: { "kpis.impact.inventato": KPI_UNKNOWN_ERROR },
  });
  assert.deepEqual(validateValuation({ kpis: { esg: { environmental: 3 } } }, { kpiIds }), {
    ok: false,
    fieldErrors: { "kpis.esg.environmental": KPI_UNKNOWN_ERROR },
  });
  assert.equal(validateValuation({ kpis: { impact: { efficiency: 3 } } }, { kpiIds }).ok, true);
  assert.equal(VALUE_EUR_YEAR_MAX, 1_000_000_000);
  assert.deepEqual(validateValuation({ valueEurYear: 1_000_000_001 }), { ok: false, fieldErrors: { valueEurYear: VALUE_AMOUNT_ERROR } });
  assert.deepEqual(validateValuation({ valueEurYear: "12,5" }), { ok: false, fieldErrors: { valueEurYear: VALUE_AMOUNT_ERROR } });
  assert.deepEqual(validateValuation({}), { ok: false, fieldErrors: { payload: NO_CHANGES_ERROR } });
  assert.deepEqual(validateValuation({ reviewNotes: "x" }), { ok: false, fieldErrors: { reviewNotes: UNKNOWN_FIELD_ERROR } });
});

// ─── §5.2: pannello rapido ───────────────────────────────────────────

test("pannello rapido: titolo 3-200, problema in una riga 3-300, AI Lab fino a 120; AI Transformation e Da costruire predefiniti", () => {
  assert.deepEqual(QUICK_CREATE_LIMITS, { title: { min: 3, max: 200 }, problem: { min: 3, max: 300 }, aiLab: { max: 120 } });
  assert.deepEqual(validateQuickCreate({ title: " Smistamento richieste ", problem: "Le richieste arrivano in tre caselle." }), {
    ok: true,
    value: { title: "Smistamento richieste", problem: "Le richieste arrivano in tre caselle.", origin: "transformation", kind: "da_costruire" },
  });
  const full = validateQuickCreate({ title: text(200), problem: text(300), aiLab: text(120), origin: "adoption", kind: "da_diffondere" });
  assert.equal(full.ok, true);
  for (const bad of [
    { title: "ab", problem: "abc" },
    { title: text(201), problem: "abc" },
    { title: "abc", problem: "ab" },
    { title: "abc", problem: text(301) },
    { title: "abc", problem: "abc", aiLab: text(121) },
    { title: "abc", problem: "abc", source: "manual" },
  ]) {
    assert.equal(validateQuickCreate(bad).ok, false, JSON.stringify(bad).slice(0, 60));
  }
});
