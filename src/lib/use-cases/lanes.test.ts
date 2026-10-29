import test from "node:test";
import assert from "node:assert/strict";
import { agentParamOf } from "./agents.ts";
import { formatEuro, type ValueParts } from "./format.ts";
import {
  LANE_BAR_MIN,
  LANE_KEYS,
  LANE_PREVIEW,
  PANORAMA_SECTION_ID,
  QUALITATIVE_RETURN_LABEL,
  agentGroups,
  buildLanes,
  compareLaneItems,
  countedEurOf,
  laneBarScale,
  laneBarWidth,
  laneCountedText,
  laneMoreLabel,
  laneSummaryText,
  laneValueAmount,
  laneValueRank,
  laneValueView,
} from "./lanes.ts";
import type { ContributorUseCase } from "./permissions.ts";
import { roadmapTotals, type HubItem } from "./views.ts";

// Le corsie della Panoramica (rilascio «Panoramica»): tre corsie per trimestre, l'ordine per euro,
// le barre, i testi e i gruppi «Per agente». Dati inventati: codici XX-0000.

const TODAY = "2026-10-29"; // T4 2026

let seq = 0;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const NO_VALUE: ValueParts = { score: null, word: null, source: null, perYear: null, benefits: null };
const counted = (amount: number): ValueParts => ({ ...NO_VALUE, perYear: { amount, source: "team" } });
const pending = (pendingEur: number): ValueParts => ({ ...NO_VALUE, benefits: { state: "da_misurare", benefitEur: 0, pendingEur, hours: 0 } });
const word = (value: "alto" | "medio" | "basso", score: number): ValueParts => ({ ...NO_VALUE, word: value, score, source: "team" });
const QUALITATIVE: ValueParts = { ...NO_VALUE, benefits: { state: "qualitativo", benefitEur: 0, pendingEur: 0, hours: 0 } };

/** Una scheda dei revisori con solo i campi che le corsie leggono, più quelli di `roadmapTotals`. */
function hub(o: Partial<HubItem> = {}): HubItem {
  seq += 1;
  return {
    id: uuid(seq),
    code: `XX-${String(1000 + seq).padStart(4, "0")}`,
    title: `Use case ${String(seq).padStart(3, "0")}`,
    origin: "adoption",
    kind: "da_costruire",
    phase: "approvato",
    subState: "trimestre",
    phaseLabel: "Approvato · T4 2026",
    tone: "blu",
    quando: "T4 2026",
    targetQuarter: "2026-Q4",
    value: NO_VALUE,
    cost: null,
    claudeHoursPerYear: null,
    realizedOn: null,
    ...o,
  } as HubItem;
}

const contributor = (o: Partial<ContributorUseCase> & { title: string }): ContributorUseCase =>
  ({ id: uuid(8000 + (seq += 1)), phase: "approvato", subState: "trimestre", phaseLabel: "Approvato · T4 2026", quando: "T4 2026", own: false, ...o }) as ContributorUseCase;

test("tre corsie: gli scaduti in cima a «Questo trimestre» con il loro trimestre, i trimestri dopo il prossimo in «Più avanti»", () => {
  const past = hub({ title: "Scaduto", targetQuarter: "2026-Q3" });
  const current = hub({ title: "Ora", targetQuarter: "2026-Q4", value: counted(12_250) });
  const next = hub({ title: "Dopo", targetQuarter: "2027-Q1" });
  const q2 = hub({ title: "Q2", targetQuarter: "2027-Q2" });
  const q3 = hub({ title: "Q3", targetQuarter: "2027-Q3" });
  const none = hub({ title: "Senza trimestre", targetQuarter: null });
  const best = hub({ title: "Best practice", kind: "da_diffondere", targetQuarter: "2027-Q1" });
  const decide = hub({ title: "Da decidere", phase: "da_valutare", targetQuarter: null });
  const building = hub({ title: "Zeta in realizzazione", phase: "in_realizzazione" });
  const building2 = hub({ title: "Alfa in realizzazione", phase: "in_realizzazione" });
  const doneOld = hub({ title: "Fatto prima", phase: "realizzato", realizedOn: "2026-05-10" });
  const doneNew = hub({ title: "Fatto dopo", phase: "realizzato", realizedOn: "2026-09-10" });
  const lanes = buildLanes([decide, q3, none, q2, next, current, past, best, building, building2, doneOld, doneNew], TODAY);

  assert.deepEqual(
    lanes.lanes.map((lane) => [lane.key, lane.label, lane.short]),
    [
      ["questo_trimestre", "Questo trimestre · T4 2026", "T4"],
      ["prossimo_trimestre", "Prossimo trimestre · T1 2027", "T1"],
      ["piu_avanti", "Più avanti", "Più avanti"],
    ],
  );
  const [now, soon, later] = lanes.lanes;
  assert.deepEqual(
    now.entries.map((entry) => [entry.item.title, entry.expired, entry.quarterNote]),
    [
      ["Scaduto", true, "T3 2026"],
      ["Ora", false, null],
    ],
    "lo scaduto prima, anche senza euro",
  );
  assert.deepEqual(new Set(soon.entries.map((entry) => entry.item.title)), new Set(["Dopo", "Best practice"]), "le best practice ci sono");
  assert.ok(soon.entries.every((entry) => !entry.expired && entry.quarterNote === null));
  assert.deepEqual(
    later.entries.map((entry) => [entry.item.title, entry.quarterNote]).sort(),
    [
      ["Q2", "T2 2027"],
      ["Q3", "T3 2027"],
      ["Senza trimestre", null],
    ],
  );
  assert.ok(!lanes.lanes.some((lane) => lane.entries.some((entry) => entry.item === decide)), "solo gli approvati");
  assert.deepEqual(lanes.inProgress, [building2, building], "per titolo");
  assert.deepEqual(lanes.done, [doneNew, doneOld], "dal più recente");
  assert.equal(now.countedEurYear, 12_250);
  assert.equal(soon.countedEurYear, 0);
});

test("le tre corsie ci sono sempre; a gennaio il T4 2026 è scaduto in «Questo trimestre · T1 2027»", () => {
  const empty = buildLanes([], TODAY);
  assert.deepEqual(
    empty.lanes.map((lane) => [lane.key, lane.entries.length]),
    LANE_KEYS.map((key) => [key, 0]),
  );
  const q4 = hub({ title: "Del T4", targetQuarter: "2026-Q4" });
  const january = buildLanes([q4], "2027-01-02");
  assert.equal(january.lanes[0].label, "Questo trimestre · T1 2027");
  assert.equal(january.lanes[1].label, "Prossimo trimestre · T2 2027");
  assert.deepEqual(
    january.lanes[0].entries.map((entry) => [entry.item, entry.expired, entry.quarterNote]),
    [[q4, true, "T4 2026"]],
  );
  assert.deepEqual(PANORAMA_SECTION_ID, { approvati: "panoramica-approvati", inRealizzazione: "panoramica-in-realizzazione", realizzati: "panoramica-realizzati" });
  assert.ok(Object.isFrozen(PANORAMA_SECTION_ID));
  assert.equal(LANE_PREVIEW, 5);
});

test("l'ordine della corsia: euro contati, poi «fino a», poi il Valore in parola, poi il resto; a pari cifra il codice", () => {
  const a = hub({ title: "A", value: counted(5_000) });
  const b = hub({ title: "B", value: counted(12_250) });
  const c = hub({ title: "C", value: pending(5_840) });
  const d = hub({ title: "D", value: pending(31_500) });
  const e = hub({ title: "E", value: word("basso", 2) });
  const f = hub({ title: "F", value: word("alto", 4) });
  const g = hub({ title: "G", value: QUALITATIVE, code: "XX-0010" });
  const h = hub({ title: "H", value: NO_VALUE, code: "XX-0002" });
  const noCode = hub({ title: "Alfa senza codice", value: NO_VALUE, code: null });
  const lane = buildLanes([noCode, h, g, f, e, d, c, b, a], TODAY).lanes[0];
  assert.deepEqual(
    lane.entries.map((entry) => entry.item.title),
    ["B", "A", "D", "C", "F", "E", "H", "G", "Alfa senza codice"],
  );
  // Stesso codice: il titolo, poi l'id.
  const t1 = hub({ title: "Beta", code: null });
  const t2 = hub({ title: "Alfa", code: null });
  const t3 = hub({ title: "Alfa", code: null });
  assert.deepEqual([t1, t3, t2].sort(compareLaneItems), [t2, t3, t1]);
  assert.deepEqual(
    [laneValueRank(counted(1)), laneValueRank(pending(1)), laneValueRank(pending(0)), laneValueRank(word("medio", 3)), laneValueRank(QUALITATIVE), laneValueRank(counted(0))],
    [0, 1, 3, 2, 3, 3],
    "0 € e «fino a 0 €» non sono cifre",
  );
  assert.deepEqual([laneValueAmount(counted(12_250)), laneValueAmount(pending(5_840)), laneValueAmount(word("alto", 4))], [12_250, 5_840, 0]);
});

test("due best practice a pari Valore: prima chi ha più ore nella stima di Claude, senza ore in fondo", () => {
  const few = hub({ title: "Poche ore", kind: "da_diffondere", claudeHoursPerYear: 120 });
  const many = hub({ title: "Tante ore", kind: "da_diffondere", claudeHoursPerYear: 900 });
  const none = hub({ title: "Alfa senza ore", kind: "da_diffondere", claudeHoursPerYear: null });
  assert.deepEqual(
    buildLanes([none, few, many], TODAY).lanes[0].entries.map((entry) => entry.item.title),
    ["Tante ore", "Poche ore", "Alfa senza ore"],
  );
});

test("contributori: le stesse corsie per titolo, senza «Scaduto», trimestre a parte né euro", () => {
  const zeta = contributor({ title: "Zeta", phaseLabel: "Approvato · T3 2026", quando: "T3 2026" });
  const beta = contributor({ title: "Beta", phaseLabel: "Approvato · T1 2027", quando: "T1 2027" });
  const alfa = contributor({ title: "Alfa", phaseLabel: "Approvato · T1 2027", quando: "T1 2027" });
  const later = contributor({ title: "Gamma", phaseLabel: "Approvato · T3 2027", quando: "T3 2027" });
  const lanes = buildLanes([zeta, beta, later, alfa], TODAY);
  assert.deepEqual(
    lanes.lanes.map((lane) => lane.entries.map((entry) => entry.item.title)),
    [["Zeta"], ["Alfa", "Beta"], ["Gamma"]],
  );
  for (const lane of lanes.lanes) {
    assert.equal(lane.countedEurYear, null, lane.key);
    for (const entry of lane.entries) assert.deepEqual([entry.expired, entry.quarterNote], [false, null], entry.item.title);
  }
  assert.equal(lanes.inProgressCountedEurYear, null);
});

test("testi della corsia: «1 use case · 12.250 € contati all'anno», «Mostra l'altro», «Mostra gli altri 4»", () => {
  assert.equal(laneSummaryText(1, 12_250), "1 use case · 12.250 € contati all'anno");
  assert.equal(laneSummaryText(3, 0), "3 use case");
  assert.equal(laneSummaryText(3, null), "3 use case");
  assert.equal(laneMoreLabel(1), "Mostra l'altro");
  assert.equal(laneMoreLabel(4), "Mostra gli altri 4");
});

test("il Valore della card: euro con la barra piena, «fino a» con la tratteggiata, «ritorno qualitativo», altrimenti la parola", () => {
  assert.deepEqual(laneValueView(counted(12_250)), { text: "12.250 € all'anno", bar: { kind: "contato", amount: 12_250 } });
  assert.deepEqual(laneValueView(pending(5_840)), { text: "da misurare · fino a 5.840 €", bar: { kind: "da_misurare", amount: 5_840 } });
  assert.deepEqual(laneValueView(QUALITATIVE), { text: QUALITATIVE_RETURN_LABEL, bar: null });
  assert.equal(QUALITATIVE_RETURN_LABEL, "ritorno qualitativo");
  assert.deepEqual(laneValueView(word("alto", 4)), { text: null, bar: null });
  assert.deepEqual(laneValueView(NO_VALUE), { text: null, bar: null });
});

test("le barre: la scala sugli approvati, «fino a» compresi; dal 4% al 100%", () => {
  const items = [
    hub({ value: counted(12_250) }),
    hub({ value: pending(31_500) }),
    hub({ phase: "in_realizzazione", value: counted(90_000) }),
    hub({ phase: "da_valutare", value: counted(80_000) }),
  ];
  assert.equal(laneBarScale(items), 31_500, "né in realizzazione né da decidere");
  assert.equal(laneBarScale([]), 0);
  assert.equal(laneBarWidth(12_250, 31_500), "38.9%");
  assert.equal(laneBarWidth(31_500, 31_500), "100.0%");
  assert.equal(laneBarWidth(90_000, 31_500), "100.0%", "mai oltre la scala");
  assert.equal(laneBarWidth(10, 31_500), `${(LANE_BAR_MIN * 100).toFixed(1)}%`);
  assert.equal(laneBarWidth(10, 31_500), "4.0%");
  assert.equal(laneBarWidth(0, 31_500), null);
  assert.equal(laneBarWidth(12_250, 0), null);
});

test("gli euro delle corsie e di «In realizzazione» sono il «Valore atteso all'anno»", () => {
  const items = [
    hub({ targetQuarter: "2026-Q3", value: counted(3_000) }),
    hub({ targetQuarter: "2026-Q4", value: counted(12_250) }),
    hub({ targetQuarter: "2027-Q1", value: counted(5_000), kind: "da_diffondere" }),
    hub({ targetQuarter: null, value: counted(700) }),
    hub({ targetQuarter: null, value: counted(1_000.5) }),
    hub({ targetQuarter: null, value: pending(9_000) }),
    hub({ phase: "in_realizzazione", value: counted(8_000) }),
    hub({ phase: "realizzato", value: counted(40_000) }),
  ];
  const lanes = buildLanes(items, TODAY);
  const lanesEur = lanes.lanes.reduce((sum, lane) => sum + (lane.countedEurYear ?? 0), 0);
  assert.equal(lanesEur, 21_951, "1.000,5 € conta come la card lo scrive, 1.001 €");
  assert.equal(lanes.inProgressCountedEurYear, 8_000);
  assert.equal(lanesEur + (lanes.inProgressCountedEurYear ?? 0), roadmapTotals(items).expectedValue?.amountEur);
});

test("le cifre a schermo si sommano: le card fanno la corsia, le corsie e «In realizzazione» la cifra in testa, «Per agente» le corsie dell'agente", () => {
  const items = [
    hub({ title: "LIBRA L1 · Fatture estere", targetQuarter: "2026-Q4", value: counted(4_042.5) }),
    hub({ title: "LIBRA L2 · Pagamenti", targetQuarter: "2026-Q4", value: counted(12_250) }),
    hub({ title: "LIBRA L3 · Riconciliazione", targetQuarter: "2027-Q1", value: counted(11_042.5) }),
    hub({ title: "SPICA P1 · Tesoreria", targetQuarter: "2027-Q1", value: counted(3_700.25) }),
    hub({ title: "SPICA P2 · Cassa", targetQuarter: null, value: counted(2_365) }),
    hub({ title: "ORSA O1 · Solleciti", phase: "in_realizzazione", value: counted(2_719.5) }),
    hub({ title: "DENEB D1 · Onboarding", targetQuarter: "2027-Q1" }),
    hub({ title: "Archivio", phase: "realizzato", value: counted(9_000.5) }),
  ];
  const lanes = buildLanes(items, TODAY);
  // Ogni card arrotonda la sua cifra: 4.043 + 12.250, 11.043 + 3.700, 2.365; in realizzazione 2.720.
  assert.deepEqual(
    lanes.lanes.map((lane) => lane.countedEurYear),
    [16_293, 14_743, 2_365],
  );
  assert.equal(lanes.inProgressCountedEurYear, 2_720);
  assert.equal(laneCountedText(16_293), "16.293 € contati all'anno");
  // La cifra in testa: 36.121 €, la somma delle parti (sommando prima e arrotondando dopo era 36.120 €).
  const total = roadmapTotals(items).expectedValue?.amountEur;
  assert.equal(total, 36_121);
  assert.equal(lanes.lanes.reduce((sum, lane) => sum + (lane.countedEurYear ?? 0), 0) + (lanes.inProgressCountedEurYear ?? 0), total);
  const groups = agentGroups(lanes.lanes);
  assert.deepEqual(
    groups.map((group) => [group.param, group.perYearEur]),
    [
      ["LIBRA", 27_336],
      ["SPICA", 6_065],
      ["DENEB", 0],
    ],
  );
  assert.equal(groups.reduce((sum, group) => sum + group.perYearEur, 0) + (lanes.inProgressCountedEurYear ?? 0), total, "«Per agente» e «In realizzazione» fanno la cifra in testa");
  // Le corsie di un agente (dopo un clic in «Per agente», `?agente=LIBRA`) fanno la sua card.
  for (const group of groups) {
    const own = buildLanes(
      items.filter((item) => agentParamOf(item.title) === group.param),
      TODAY,
    );
    assert.equal(
      own.lanes.reduce((sum, lane) => sum + (lane.countedEurYear ?? 0), 0),
      group.perYearEur,
      group.label,
    );
  }
});

test("countedEurOf: la somma delle cifre delle card, arrotondate una a una; solo gli euro a schermo", () => {
  assert.equal(countedEurOf([]), 0);
  assert.equal(countedEurOf([{ value: counted(0.5) }, { value: counted(0.5) }]), 2, "due card da «1 €»");
  assert.equal(countedEurOf([{ value: counted(2_183.4999999999995) }]), 2_184, "la tolleranza di `roundAmount`");
  assert.equal(countedEurOf([{ value: counted(0) }, { value: counted(Number.NaN) }, { value: counted(-5) }, { value: NO_VALUE }, { value: pending(9_000) }]), 0);
  // Una card sola: la cifra della corsia è la cifra della card.
  for (let x = 0; x <= 20; x += 0.25) assert.equal(formatEuro(countedEurOf([{ value: counted(x) }])), formatEuro(x), String(x));
});

test("«Per agente»: un gruppo per agente del titolo, chi ha più euro in testa, «Altri use case» in fondo", () => {
  const items = [
    hub({ title: "LIBRA L1 · Fatture estere", targetQuarter: "2026-Q4", value: counted(12_250) }),
    hub({ title: "LIBRA L2 · Pagamenti", targetQuarter: "2026-Q3", value: counted(5_000) }),
    hub({ title: "LIBRA L3 · Riconciliazione", targetQuarter: null, value: pending(9_000) }),
    hub({ title: "ORSA O1 · Solleciti", targetQuarter: "2027-Q1", value: counted(3_000) }),
    hub({ title: "DENEB D1 · Onboarding", targetQuarter: "2027-Q1" }),
    hub({ title: "AUTO H1 · Cedolini", targetQuarter: "2027-Q3" }),
    hub({ title: "AUTO H2 · Presenze", targetQuarter: "2027-Q1" }),
    hub({ title: "Smistamento delle richieste", targetQuarter: "2026-Q4", value: counted(90_000) }),
    hub({ title: "SIRIO S1 · Cassa", phase: "in_realizzazione", value: counted(60_000) }),
  ];
  const lanes = buildLanes(items, TODAY).lanes;
  const groups = agentGroups(lanes);
  assert.deepEqual(
    groups.map((group) => [group.param, group.agent, group.label, group.count, group.perYearEur, group.counted]),
    [
      ["LIBRA", "LIBRA", "LIBRA", 3, 17_250, 2],
      ["ORSA", "ORSA", "ORSA", 1, 3_000, 1],
      ["AUTO", "AUTO", "AUTO", 2, 0, 0],
      ["DENEB", "DENEB", "DENEB", 1, 0, 0],
      ["altri", null, "Altri use case", 1, 90_000, 1],
    ],
    "«Altri use case» in fondo anche con più euro; a pari euro più use case, poi il nome; in realizzazione no",
  );
  assert.deepEqual(groups[0].lanes, [
    { key: "questo_trimestre", short: "T4", label: "Questo trimestre · T4 2026", count: 2 },
    { key: "piu_avanti", short: "Più avanti", label: "Più avanti", count: 1 },
  ]);
  assert.deepEqual(
    groups.find((group) => group.param === "AUTO")?.lanes.map((lane) => [lane.key, lane.count]),
    [
      ["prossimo_trimestre", 1],
      ["piu_avanti", 1],
    ],
  );
  // Né uno use case né un euro di più o di meno delle corsie.
  assert.equal(
    groups.reduce((sum, group) => sum + group.count, 0),
    lanes.reduce((sum, lane) => sum + lane.entries.length, 0),
  );
  assert.equal(
    groups.reduce((sum, group) => sum + group.perYearEur, 0),
    lanes.reduce((sum, lane) => sum + (lane.countedEurYear ?? 0), 0),
  );
  for (const group of groups) assert.equal(group.lanes.reduce((sum, lane) => sum + lane.count, 0), group.count, group.label);
  assert.deepEqual(agentGroups(buildLanes([], TODAY).lanes), []);
});
