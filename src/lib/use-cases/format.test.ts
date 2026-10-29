import test from "node:test";
import assert from "node:assert/strict";
import { COST_BANDS, resolveCostBands } from "./cost-bands.ts";
import {
  costBandLabel,
  costBandLongText,
  costBandSymbol,
  costLongText,
  costShortText,
  costSourceText,
  costTextParts,
  formatDate,
  formatDayInYear,
  formatDayMonth,
  formatEuro,
  formatMonthYear,
  formatScore,
  lowerFirst,
  perYearText,
  phaseTone,
  startCostParts,
  valueEurSourceText,
  valueLongText,
  valueSourceText,
  valueWordText,
  type CostParts,
} from "./format.ts";
import { COST_SOURCES } from "./labels.ts";
import { PHASES, SUB_STATES, type CostBand } from "./types.ts";
import { costFigure, valueFigure, type ValuationModel } from "./valuation.ts";

// Testi di docs/use-case/DESIGN.md §4.5, §4.6, §6.3, §7.1, §7.2, §14.3 e §14.5 (PIANO-LAVORI H2d).

const ISO = /\d{4}-\d{2}-\d{2}/;

test("importi (§14.5): «40.000 €», senza decimali, il punto delle migliaia anche sotto 10.000", () => {
  assert.equal(formatEuro(40_000), "40.000 €");
  assert.equal(formatEuro(4_000), "4.000 €");
  assert.equal(formatEuro(18_500), "18.500 €");
  assert.equal(formatEuro(18_500.4), "18.500 €", "il ROI del dossier può avere i centesimi");
  assert.equal(formatEuro(18_500.5), "18.501 €");
  // Nessun arrotondamento ai centesimi prima dell'euro: sotto la metà resta sotto.
  assert.equal(formatEuro(1_234.497), "1.234 €");
  assert.equal(formatEuro(2.4951), "2 €");
  // Una coda di virgola mobile sotto la metà esatta non sposta la cifra.
  assert.equal(formatEuro(4_042.4999999999995), "4.043 €");
  assert.equal(formatEuro(400_000), "400.000 €");
  assert.equal(formatEuro(100_000_000), "100.000.000 €");
  assert.equal(formatEuro(999), "999 €");
  assert.equal(formatEuro(0), "0 €");
  assert.equal(formatEuro(-0.4), "0 €");
  assert.equal(formatEuro(-1_200), "-1.200 €");
  assert.equal(formatEuro(Number.NaN), "da stimare");
  assert.equal(formatEuro(Number.POSITIVE_INFINITY), "da stimare");
});

test("punteggi: «3,8» con la virgola", () => {
  assert.equal(formatScore(3.8), "3,8");
  assert.equal(formatScore(3.75), "3,8");
  assert.equal(formatScore(4), "4,0");
  assert.equal(formatScore(Number.NaN), "da stimare");
});

test("date (§14.5): it-IT nel fuso di Roma, mai ISO", () => {
  assert.equal(formatDayMonth("2026-10-14"), "14 ott");
  assert.equal(formatDate("2026-10-14"), "14 ott 2026");
  assert.equal(formatMonthYear("2026-10-14"), "ott 2026");
  assert.equal(formatDate("2027-01-14"), "14 gen 2027");
  assert.equal(formatDayMonth("2026-11-01"), "1 nov");
  // Un istante si legge a Roma: le 23:30 UTC del 13 sono già il 14.
  assert.equal(formatDate("2026-10-13T23:30:00Z"), "14 ott 2026");
  assert.equal(formatDate(new Date("2026-10-13T23:30:00Z")), "14 ott 2026");
  assert.equal(formatDate("2026-07-31T21:59:00.000Z"), "31 lug 2026");
  // Un giorno di calendario resta quel giorno.
  assert.equal(formatDate("2026-03-29"), "29 mar 2026", "cambio dell'ora legale");
  assert.equal(formatDate("2026-12-31"), "31 dic 2026");
  // Niente ISO a schermo: una data illeggibile non si scrive.
  for (const bad of ["2026-02-30", "2026-13-01", "14/10/2026", "ieri", "", "   ", null, undefined, new Date(Number.NaN)]) {
    assert.equal(formatDate(bad), null, String(bad));
    assert.equal(formatDayMonth(bad), null, String(bad));
    assert.equal(formatMonthYear(bad), null, String(bad));
  }
  for (const value of ["2026-10-14", "2026-10-13T23:30:00Z", new Date("2026-05-02T10:00:00Z")]) {
    for (const out of [formatDayMonth(value), formatDate(value), formatMonthYear(value), formatDayInYear(value, "2026-10-14")]) {
      assert.ok(out && !ISO.test(out), `«${out}» non è ISO`);
    }
  }
});

test("timestamp come li dà Postgres: con la zona, anche «+00» e i microsecondi", () => {
  for (const value of [
    "2026-10-13 23:30:00+00",
    "2026-10-13 23:30:00.123456+00",
    "2026-10-13T23:30:00+00",
    "2026-10-13T23:30:00.123456+00",
    "2026-10-13 23:30:00+0000",
    "2026-10-13 23:30:00+00:00",
    "2026-10-13 23:30:00z",
    "2026-10-13 23:30+00",
    "2026-10-14 01:30:00+02",
    "2026-10-13 18:30:00-05:00",
  ]) {
    assert.equal(formatDate(value), "14 ott 2026", value);
    assert.equal(formatDayMonth(value), "14 ott", value);
    assert.equal(formatMonthYear(value), "ott 2026", value);
    assert.equal(formatDayInYear(value, "2026-10-14"), "14 ott", value);
  }
  assert.equal(formatDate("2026-07-31 21:59:00+00"), "31 lug 2026");
  assert.equal(formatDate("2026-12-31 23:30:00+00"), "1 gen 2027");
  for (const bad of ["2026-02-30 10:00:00+00", "2026-10-14 24:00:00+00", "2026-10-14 10:60:00Z", "2026-10-14 10:00:00+0", "2026-10-14 10:00:00 Europe/Rome", "2026-10-14T10"]) {
    assert.equal(formatDate(bad), null, bad);
  }
});

test("timestamp senza zona: si legge come UTC, lo stesso giorno in ogni fuso del processo", () => {
  const previous = process.env.TZ;
  const read = (tz: string) => {
    process.env.TZ = tz;
    return ["2026-10-13 23:30:00", "2026-10-13T23:30:00.123456", "2026-10-14 21:30:00"].map((value) => [formatDate(value), formatDayMonth(value)]);
  };
  try {
    const expected = [
      ["14 ott 2026", "14 ott"],
      ["14 ott 2026", "14 ott"],
      ["14 ott 2026", "14 ott"],
    ];
    for (const tz of ["UTC", "Europe/Rome", "America/Los_Angeles", "Asia/Tokyo"]) assert.deepEqual(read(tz), expected, tz);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("date nelle righe: l'anno solo quando non è quello di oggi", () => {
  assert.equal(formatDayInYear("2026-11-14", "2026-10-14"), "14 nov");
  assert.equal(formatDayInYear("2027-01-14", "2026-10-14"), "14 gen 2027");
  assert.equal(formatDayInYear("2025-12-31", new Date("2026-10-14T10:00:00Z")), "31 dic 2025");
  // L'anno di oggi si legge a Roma: il 31 dicembre alle 23:30 UTC a Roma è già l'anno dopo.
  assert.equal(formatDayInYear("2027-01-01", new Date("2026-12-31T23:30:00Z")), "1 gen");
  assert.equal(formatDayInYear("nessuna", "2026-10-14"), null);
});

test("fonti (§7.2, §14.3): corte e lunghe, «dossier» e «dal dossier», mai «da dossier»", () => {
  const short = Object.fromEntries(COST_SOURCES.map((s) => [s, costSourceText(s, "corta")]));
  const long = Object.fromEntries(COST_SOURCES.map((s) => [s, costSourceText(s, "lunga")]));
  assert.deepEqual(short, { dossier: "dossier", stima: "team", team_importo: "team", team_fascia: "team", sforzo: "stimato" });
  assert.deepEqual(long, {
    dossier: "dal dossier",
    stima: "stima del team",
    team_importo: "importo del team",
    team_fascia: "fascia del team",
    sforzo: "stimato dall'impegno",
  });
  assert.equal(valueSourceText("team"), "team");
  assert.equal(valueSourceText("ai"), "AI");
  assert.equal(valueEurSourceText("dossier", "corta"), "dossier");
  assert.equal(valueEurSourceText("dossier", "lunga"), "dal dossier");
  assert.equal(valueEurSourceText("team", "corta"), "team");
  assert.equal(valueEurSourceText("team", "lunga"), "team");
  const every = [...Object.values(short), ...Object.values(long), valueEurSourceText("dossier", "corta"), valueEurSourceText("dossier", "lunga")];
  for (const text of every) assert.doesNotMatch(text, /\bda dossier\b/i, text);
});

const MODEL: ValuationModel = {
  dimensions: {
    impact: [{ id: "efficiency" }, { id: "profitability" }],
    feasibility: [{ id: "effort", direction: "lower_better" }],
    esg: [],
  },
  scoringVersion: 2,
};

test("forma corta del costo (§4.6, §7.2): le quattro fonti e «da stimare»", () => {
  const cases: Array<[CostParts | null, string]> = [
    [{ source: "team_importo", amount: 40_000, band: 2, fromBand: false }, "€€ · 40.000 € · team"],
    [{ source: "team_fascia", amount: null, band: 2, fromBand: true }, "€€ · fascia · team"],
    [{ source: "sforzo", amount: null, band: 3, fromBand: true }, "€€€ · fascia · stimato"],
    [{ source: "dossier", amount: 18_500, band: 1, fromBand: false }, "€ · 18.500 € · dossier"],
    [null, "da stimare"],
  ];
  for (const [cost, text] of cases) assert.equal(costShortText(cost), text);
  assert.deepEqual(costTextParts(null, "corta"), { figure: "da stimare", figureParts: ["da stimare"], source: null, estimated: true });
  assert.deepEqual(costTextParts(cases[0][0], "corta"), { figure: "€€ · 40.000 €", figureParts: ["€€ · 40.000 €"], source: "team", estimated: false });
  // «Benefici e costi»: due pezzi che non si spezzano, uniti da « · » nella cifra intera.
  assert.deepEqual(costTextParts({ source: "stima", amount: 6_450, band: 1, fromBand: false, runEurYear: 1_200 }, "corta"), {
    figure: "avvio 6.450 € · ricorrenti 1.200 €/anno",
    figureParts: ["avvio 6.450 €", "ricorrenti 1.200 €/anno"],
    source: null,
    estimated: false,
  });
  assert.deepEqual(costTextParts({ source: "stima", amount: 280, band: 1, fromBand: false, runEurYear: 0 }, "corta").figureParts, ["avvio 280 €"]);
});

test("forma corta del costo: la stessa stringa per la riga e per la card della Roadmap (§4.5, §4.6)", () => {
  // Gli esempi della riga (§4.6, §7.2) e della card (§4.5) passano dalla stessa funzione,
  // con i costi calcolati da `costFigure` come li riceve la pagina.
  const fromRow = {
    "€€ · 40.000 € · team": costFigure({ costEurOnce: 40_000 }, MODEL),
    "€€ · fascia · team": costFigure({ costBand: 2 }, MODEL),
    // Con le fasce predefinite lo sforzo 4 cade in €€€ (§7.2).
    "€€€ · fascia · stimato": costFigure({ customScores: { feasibility: { effort: 4 } } }, MODEL),
    "€ · 18.500 € · dossier": costFigure({ dossierImplementationEur: 18_500, costEurOnce: 40_000 }, MODEL),
    "da stimare": costFigure({}, MODEL),
  };
  const fromRoadmapCard = ["€€ · 40.000 € · team", "€€ · fascia · team", "€€€ · fascia · stimato"];
  for (const [text, cost] of Object.entries(fromRow)) assert.equal(costShortText(cost), text);
  for (const text of fromRoadmapCard) assert.equal(costShortText(fromRow[text as keyof typeof fromRow]), text);
});

test("forma lunga del costo (§6.3, §7.2): importo, oppure «fascia» con l'etichetta del workspace in minuscolo", () => {
  assert.equal(costLongText({ source: "team_importo", amount: 40_000, band: 2, fromBand: false }), "€€ · 40.000 €");
  assert.equal(costLongText({ source: "team_fascia", amount: null, band: 2, fromBand: true }), "€€ · fascia da 25.000 a 65.000 €");
  assert.equal(costLongText({ source: "sforzo", amount: null, band: 1, fromBand: true }), "€ · fascia fino a 25.000 €");
  assert.equal(costLongText({ source: "team_fascia", amount: null, band: 5, fromBand: true }), "€€€€€ · fascia 250.000 € e oltre");
  assert.equal(costLongText(null), "da stimare");
  assert.deepEqual(costTextParts({ source: "team_fascia", amount: null, band: 3, fromBand: true }, "lunga"), {
    figure: "€€€ · fascia da 65.000 a 130.000 €",
    figureParts: ["€€€ · fascia da 65.000 a 130.000 €"],
    source: "fascia del team",
    estimated: false,
  });
  assert.deepEqual(costTextParts({ source: "dossier", amount: 18_500, band: 1, fromBand: false }, "lunga").source, "dal dossier");
});

const CUSTOM_BANDS = resolveCostBands({
  costBands: {
    limits: [15_000, 40_000, 90_000, 200_000],
    labels: ["Piccolo progetto", "Da 15.000 a 40.000 €", "Da 40.000 a 90.000 €", "SAP e integrazioni", "Oltre 200.000 €"],
    topReferenceEur: 300_000,
  },
});

test("forma lunga di una fascia (D15): etichette predefinite e etichette diverse passate in `bands`", () => {
  assert.notEqual(CUSTOM_BANDS, COST_BANDS, "le fasce del workspace sono valide");
  // Predefinite.
  const defaults: Record<CostBand, string> = {
    1: "fascia fino a 25.000 €",
    2: "fascia da 25.000 a 65.000 €",
    3: "fascia da 65.000 a 130.000 €",
    4: "fascia da 130.000 a 250.000 €",
    5: "fascia 250.000 € e oltre",
  };
  for (const band of [1, 2, 3, 4, 5] as const) {
    assert.equal(costBandLongText(band), defaults[band]);
    assert.equal(costBandLongText(band, COST_BANDS), defaults[band]);
    assert.equal(costBandLabel(band), COST_BANDS[band - 1].label);
    assert.equal(costBandSymbol(band), "€".repeat(band));
  }
  // Del workspace: lo stesso indice si legge con l'etichetta nuova; una sigla in testa resta maiuscola.
  assert.equal(costBandLongText(1, CUSTOM_BANDS), "fascia piccolo progetto");
  assert.equal(costBandLongText(2, CUSTOM_BANDS), "fascia da 15.000 a 40.000 €");
  assert.equal(costBandLongText(4, CUSTOM_BANDS), "fascia SAP e integrazioni");
  assert.equal(costBandLongText(5, CUSTOM_BANDS), "fascia oltre 200.000 €");
  assert.equal(costBandLabel(4, CUSTOM_BANDS), "SAP e integrazioni");
  assert.equal(costBandSymbol(4, CUSTOM_BANDS), "€€€€", "i simboli non cambiano");
  // Nel costo: la fascia del team si legge con l'etichetta del workspace, da `bands` o da `bandLabel`.
  const teamBand: CostParts = { source: "team_fascia", amount: null, band: 2, fromBand: true };
  assert.equal(costLongText(teamBand, CUSTOM_BANDS), "€€ · fascia da 15.000 a 40.000 €");
  assert.equal(costLongText(teamBand), "€€ · fascia da 25.000 a 65.000 €");
  const model = { ...MODEL, costBands: { limits: [15_000, 40_000, 90_000, 200_000], labels: CUSTOM_BANDS.map((b) => b.label), topReferenceEur: 300_000 } };
  const fromValuation = costFigure({ costBand: 1 }, model);
  assert.equal(costLongText(fromValuation), "€ · fascia piccolo progetto", "`bandLabel` di costFigure vince sulle predefinite");
  // Lo stesso importo trova la fascia del workspace: 30.000 € è €€ con le fasce del workspace, €€ anche con le predefinite.
  assert.equal(costShortText(costFigure({ costEurOnce: 30_000 }, model)), "€€ · 30.000 € · team");
  assert.equal(costShortText(costFigure({ costEurOnce: 20_000 }, model)), "€€ · 20.000 € · team");
  assert.equal(costShortText(costFigure({ costEurOnce: 20_000 }, MODEL)), "€ · 20.000 € · team");
});

test("costo d'avvio nelle card della Panoramica: «avvio 30.000 €» con la fonte, «avvio €€ · fascia»; senza costo niente", () => {
  assert.deepEqual(startCostParts({ source: "stima", amount: 700, band: 1, fromBand: false, runEurYear: 1_200 }), { figure: "avvio 700 €", source: null }, "«Benefici e costi»: la fonte la dice la scheda");
  assert.deepEqual(startCostParts({ source: "team_importo", amount: 30_000, band: 2, fromBand: false }), { figure: "avvio 30.000 €", source: "team" });
  assert.deepEqual(startCostParts({ source: "dossier", amount: 18_500, band: 1, fromBand: false }), { figure: "avvio 18.500 €", source: "dossier" });
  // Una fascia con le fasce del workspace: il simbolo non cambia, l'etichetta non si scrive.
  const teamBand = costFigure({ costBand: 2 }, { ...MODEL, costBands: { limits: [15_000, 40_000, 90_000, 200_000], labels: CUSTOM_BANDS.map((b) => b.label), topReferenceEur: 300_000 } });
  assert.deepEqual(startCostParts(teamBand, CUSTOM_BANDS), { figure: "avvio €€ · fascia", source: "team" });
  assert.deepEqual(startCostParts({ source: "sforzo", amount: null, band: 3, fromBand: true }), { figure: "avvio €€€ · fascia", source: "stimato" });
  assert.equal(startCostParts(null), null);
  assert.equal(startCostParts(undefined), null);
});

test("iniziale minuscola: le sigle in testa restano", () => {
  assert.equal(lowerFirst("Fino a 25.000 €"), "fino a 25.000 €");
  assert.equal(lowerFirst("250.000 € e oltre"), "250.000 € e oltre");
  assert.equal(lowerFirst("SAP e integrazioni"), "SAP e integrazioni");
  assert.equal(lowerFirst("IT"), "IT");
  assert.equal(lowerFirst("A piccoli passi"), "a piccoli passi");
  assert.equal(lowerFirst("Èlite"), "èlite");
  assert.equal(lowerFirst(""), "");
});

test("Valore (§6.3, §7.1): parola, cifra lunga, euro all'anno", () => {
  const high = valueFigure({ customScores: { impact: { efficiency: 4, profitability: 3.6 } }, valueEurYear: 60_000 }, MODEL);
  assert.equal(valueWordText(high), "Alto");
  assert.equal(valueLongText(high), "Alto · 3,8");
  assert.equal(high.source, "team");
  assert.equal(perYearText(high.perYear), "60.000 € all'anno");
  const ai = valueFigure({ aiScores: { impact: { efficiency: 3 } } }, MODEL);
  assert.equal(valueWordText(ai), "Medio");
  assert.equal(ai.source, "ai");
  assert.equal(valueSourceText(ai.source!), "AI");
  const none = valueFigure({ dossierAnnualBenefitEur: 12_000 }, MODEL);
  assert.equal(valueWordText(none), "da stimare");
  assert.equal(valueLongText(none), "da stimare");
  assert.equal(perYearText(none.perYear), "12.000 € all'anno");
  assert.equal(none.perYear?.source, "dossier");
  assert.equal(valueWordText(null), "da stimare");
  assert.equal(perYearText(null), null);
});

test("tono della pillola: «Da rivedere» giallo, il resto il tono della fase", () => {
  assert.equal(phaseTone("da_valutare", "da_rivedere"), "giallo");
  assert.equal(phaseTone("da_valutare", "nuova"), "grigio");
  assert.equal(phaseTone("approvato", "trimestre"), "blu");
  assert.equal(phaseTone("in_realizzazione"), "blu");
  assert.equal(phaseTone("realizzato", "diffusa"), "verde");
  assert.equal(phaseTone("chiuso", "doppione"), "grigio");
  for (const phase of PHASES) for (const sub of SUB_STATES[phase]) assert.ok(["grigio", "giallo", "blu", "verde"].includes(phaseTone(phase, sub)));
});

test("nessun testo di format è ISO, né «da dossier»", () => {
  const outputs = [
    ...COST_SOURCES.flatMap((s) => [costSourceText(s, "corta"), costSourceText(s, "lunga")]),
    ...([1, 2, 3, 4, 5] as const).flatMap((band) => [
      costBandLongText(band),
      costBandLongText(band, CUSTOM_BANDS),
      costShortText({ source: "team_fascia", amount: null, band, fromBand: true }),
      costLongText({ source: "sforzo", amount: null, band, fromBand: true }, CUSTOM_BANDS),
    ]),
  ];
  for (const text of outputs) {
    assert.doesNotMatch(text, ISO, text);
    assert.doesNotMatch(text, /\bda dossier\b/i, text);
  }
});
