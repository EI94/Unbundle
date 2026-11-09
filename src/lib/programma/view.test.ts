import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_VALUE_PARAMS, valueModelSchema, type ValueModel, type ValueParams } from "../use-cases/value-model.ts";
import type { HubItem } from "../use-cases/views.ts";
import { NO_PROGRAM_COSTS } from "./curve.ts";
import { salFileName, salPdf } from "./sal-pdf.ts";
import { PROGRAM_TEXT, nextStepText, salChangeText } from "./text.ts";
import { buildProgramView, snapshotMetrics, type ProgramInput, type ProgramSettings } from "./view.ts";

// La pagina «Programma» dai dati letti (rilascio 7): numeri, permessi, privacy, SAL. Dati sintetici.

const TODAY = "2026-11-09";
const PARAMS: ValueParams = { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-11", dayCostEur: 500, hourlyCostEur: 40, horizonMonths: 12, buildMonths: 2, rampMonths: 1 };

function model(eurYear: number): ValueModel {
  return valueModelSchema.parse({
    v: 1,
    primary: "costi",
    components: [{ key: "costi", lever: "costi", label: "Meno licenze", kind: "euro", eurYear, confidence: "ipotesi" }],
    costs: { devDays: 10, internalHours: 20, runCostEurYear: 1200 },
  });
}

function item(over: Partial<HubItem> & Pick<HubItem, "id" | "phase">): HubItem {
  const valueModel = over.valueModel === undefined ? null : over.valueModel;
  const amount = valueModel ? valueModel.components.reduce((s, c) => s + (c.kind === "euro" ? c.eurYear : 0), 0) : null;
  return {
    code: `XX-${over.id}`,
    title: `Use case ${over.id}`,
    kind: "da_costruire",
    targetQuarter: null,
    value: { score: null, word: null, source: null, perYear: amount === null ? null : { amount, source: "stima" } },
    cost: null,
    realizedOn: null,
    subState: "valutata",
    reviewBy: null,
    ...over,
    valueModel,
  } as unknown as HubItem;
}

const SETTINGS: ProgramSettings = {
  employees: null,
  employeesSource: null,
  revenueEur: null,
  revenueSource: null,
  costs: { ...NO_PROGRAM_COSTS, caseDev: new Map() },
  weights: null,
  asks: [],
  lastSalOn: null,
  updatedAt: null,
};

function input(over: Partial<ProgramInput> = {}): ProgramInput {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    companyName: "Azienda Demo",
    today: TODAY,
    items: [
      item({ id: "1", phase: "realizzato", realizedOn: "2026-08-10" as HubItem["realizedOn"], valueModel: model(3000) }),
      item({ id: "2", phase: "in_realizzazione", valueModel: model(24_000) }),
      item({ id: "3", phase: "approvato", targetQuarter: "2026-Q4", valueModel: model(12_000) }),
      item({ id: "4", phase: "approvato", targetQuarter: "2027-Q1", valueModel: model(9_600) }),
      item({ id: "5", phase: "da_valutare", valueModel: model(90_000) }),
    ],
    params: PARAMS,
    settings: SETTINGS,
    training: { trained: 17, hours: 12, sessions: 8, exercises: 9 },
    readiness: { threshold: 5, respondents: 30, thresholdMet: true, overall: 1.95, pillars: { adoption: 2.5, technology: 1.6 }, levels: [...Array(20).fill(2), ...Array(8).fill(3), 1, 4], areas: [{ unit: "Operations", respondents: 3, met: false, pillars: {} }] },
    goals: [],
    checkins: [],
    krLinks: [],
    kpis: [],
    kpiValues: [],
    snapshots: [],
    viewer: { isLateralSpace: false, canEdit: false },
    ...over,
  };
}

test("i risultati e le iniziative dalla pagina «Use case»: da valutare non conta", () => {
  const view = buildProgramView(input());
  assert.equal(view.results.estimated, 3000 + 24_000 + 12_000 + 9_600);
  assert.equal(view.results.inUse, 3000);
  assert.deepEqual(view.initiatives.map((r) => [r.stage, r.count]), [["in_uso", 1], ["in_realizzazione", 1], ["da_avviare", 2]]);
  assert.equal(view.costs.coverage.total, 4);
  assert.equal(view.curve.base.months[view.curve.base.today], "2026-11");
});

test("senza dipendenti: il prossimo passo li chiede, il pilastro «Persone» non conta, l'adozione viene dall'AI Readiness", () => {
  const view = buildProgramView(input());
  assert.equal(view.nextSteps[0].kind, "dipendenti");
  assert.equal(nextStepText(view.nextSteps[0], "Azienda Demo"), "Indicare quante persone lavorano in Azienda Demo");
  const by = Object.fromEntries(view.index.pillars.map((p) => [p.pillar, p]));
  assert.equal(by.persone.gap, "dipendenti");
  assert.equal(by.adozione.score, 50);
  assert.equal(by.adozione.source, "ai_readiness");
  assert.notEqual(view.index.value, null);
});

test("l'AI Readiness sotto soglia non entra: niente adozione, niente media, niente aree", () => {
  const view = buildProgramView(input({ readiness: { threshold: 5, respondents: 4, thresholdMet: false, overall: 3, pillars: { adoption: 4 }, levels: [1, 2, 3, 4], areas: [] } }));
  assert.equal(view.people.readiness, null);
  assert.equal(view.people.levels, null);
  assert.equal(view.index.pillars.find((p) => p.pillar === "adozione")?.gap, "adozione");
  assert.deepEqual(buildProgramView(input()).people.areas, [], "un'area sotto 5 risposte non si mostra");
});

test("i livelli: solo gruppi di almeno 5; un gruppo più piccolo toglie la distribuzione", () => {
  // Un solo rispondente al livello 1 e uno al livello 4: per livello o a coppie si ricaverebbe la persona.
  assert.equal(buildProgramView(input()).people.levels, null);
  const readiness = { threshold: 5, respondents: 30, thresholdMet: true, overall: 2, pillars: { adoption: 2.5 }, levels: [...Array(20).fill(2), ...Array(10).fill(3)], areas: [] };
  const levels = buildProgramView(input({ readiness })).people.levels!;
  assert.equal(levels.grouped, false);
  assert.deepEqual(levels.bars.map((b) => [b.label, b.count]), [["Livello 0", 0], ["Livello 1", 0], ["Livello 2", 20], ["Livello 3", 10], ["Livello 4", 0], ["Livello 5", 0]]);
});

test("al cliente niente impostazioni di Lateral Space: né la percentuale né lo sviluppo per use case", () => {
  const caseDev = new Map([["3", { mode: "percentuale" as const, amountEur: null }]]);
  const settings = { ...SETTINGS, costs: { supportMonthEur: 4000, supportFrom: "2026-10" as const, supportTo: null, devPct: 15, caseDev } };
  const client = buildProgramView(input({ settings }));
  assert.equal(client.ls, null);
  const json = JSON.stringify(client);
  assert.doesNotMatch(json, /devPct|caseDev|"mode"|percentuale/);
  assert.doesNotMatch(json, /\bquota\b|\bfee\b|proposta a valore/i);
  // Le cifre sì: lo sviluppo dentro il costo di avvio, il canone su una riga sua.
  const card = client.initiatives.flatMap((r) => r.cards).find((c) => c.id === "3")!;
  assert.equal(card.lsDev, 1800);
  assert.equal(client.costs.support?.monthNow, 4000);
  const ls = buildProgramView(input({ settings, viewer: { isLateralSpace: true, canEdit: true } }));
  assert.equal(ls.ls?.devPct, 15);
  assert.equal(ls.ls?.caseDev.find((d) => d.id === "3")?.mode, "percentuale");
});

test("il canone: costo del mese e parte di ogni use case partito, in proporzione al valore; la parte solo a Lateral Space", () => {
  const settings = { ...SETTINGS, costs: { supportMonthEur: 2700, supportFrom: "2026-11" as const, supportTo: null, devPct: null, caseDev: new Map() } };
  const view = buildProgramView(input({ settings, viewer: { isLateralSpace: true, canEdit: true } }));
  const cards = Object.fromEntries(view.initiatives.flatMap((r) => r.cards).map((c) => [c.id, c]));
  // Partiti oggi davvero: l'1 (in uso, 3.000 €) e il 2 (in realizzazione, 24.000 €). Il 3 (T4 2026) è approvato
  // con l'avvio previsto a novembre, ma non è ancora partito: niente canone; il 4 (T1 2027) nemmeno.
  const total = 3000 + 24_000;
  assert.ok(Math.abs(cards["1"].supportYear - (2700 * 12 * 3000) / total) < 1e-6);
  assert.ok(Math.abs(cards["2"].supportYear - (2700 * 12 * 24_000) / total) < 1e-6);
  assert.equal(cards["3"].supportYear, 0);
  assert.equal(cards["4"].supportYear, 0);
  assert.equal(view.costs.support?.perYear, 2700 * 12);
  const client = buildProgramView(input({ settings }));
  assert.ok(client.initiatives.flatMap((r) => r.cards).every((c) => c.supportYear === 0), "al cliente nessuna parte per use case");
  assert.equal(client.costs.support?.perYear, 2700 * 12, "il canone sì");
});

test("il SAL: delta dei riquadri e cosa è cambiato, dalle fotografie", () => {
  const snapshots = [{ kind: "sal" as const, period: "2026-10-06", metrics: { valore_stimato: 30_000, valore_in_uso: 0, indice_ai_native: 10, use_case_in_uso: 0, persone_formate: 17 } }];
  const view = buildProgramView(input({ snapshots, settings: { ...SETTINGS, lastSalOn: "2026-10-06" } }));
  assert.equal(view.lastSal?.on, "2026-10-06");
  assert.equal(view.lastSal?.estimated, 30_000);
  const keys = view.sal.changes.map((c) => c.key);
  assert.ok(keys.includes("valore_stimato") && keys.includes("use_case_in_uso"));
  assert.ok(!keys.includes("persone_formate"), "uguale: non è un cambiamento");
  assert.equal(salChangeText(view.sal.changes.find((c) => c.key === "valore_stimato")!), "Valore stimato all'anno: +18.600 €");
  assert.equal(salChangeText({ key: "use_case_in_uso", from: 0, to: 1 }), "Use case in uso: da 0 a 1");
  assert.ok(!view.nextSteps.some((s) => s.kind === "primo_sal"));
});

test("la fotografia del mese: le metriche, i KPI e il pareggio", () => {
  const metrics = snapshotMetrics(buildProgramView(input()));
  assert.equal(metrics.valore_in_uso, 3000);
  assert.equal(metrics.use_case_da_avviare, 2);
  assert.deepEqual(metrics.kpis, {});
  assert.ok("pareggio" in metrics);
  for (const v of Object.values(metrics)) assert.notEqual(typeof v, "string" === typeof v && /@/.test(String(v)) ? "string" : "x");
});

test("gli obiettivi: risultati chiave con base, adesso e obiettivo; gli use case collegati", () => {
  const goals = [
    { id: "g", parentId: null, type: "goal" as const, title: "Crescere", direction: null, targetValue: null, currentValue: null, kpiUnit: null, timeframe: null },
    { id: "o", parentId: "g", type: "objective" as const, title: "Sbloccare valore", direction: null, targetValue: null, currentValue: null, kpiUnit: null, timeframe: "2027" },
    { id: "k", parentId: "o", type: "key_result" as const, title: "Valore in uso", direction: "increase" as const, targetValue: 100, currentValue: 10, kpiUnit: "k€", timeframe: null },
  ];
  const checkins = [
    { goalId: "k", kind: "base" as const, value: 0, recordedOn: "2026-09-01" },
    { goalId: "k", kind: "aggiornamento" as const, value: 40, recordedOn: "2026-11-01" },
  ];
  const view = buildProgramView(input({ goals, checkins, krLinks: [{ useCaseId: "2", keyResultId: "k" }] }));
  assert.equal(view.objectives.length, 1);
  const kr = view.objectives[0].keyResults[0];
  assert.deepEqual([kr.base, kr.now, kr.target, kr.progress], [0, 40, 100, 40]);
  assert.deepEqual(kr.useCases.map((u) => u.id), ["2"]);
  assert.equal(view.objectives[0].goal, "Crescere");
});

test("il PDF del SAL: si genera, è un PDF, e il nome è quello dell'azienda e del giorno", () => {
  const view = buildProgramView(input());
  const pdf = salPdf(view);
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(pdf.byteLength > 1000);
  assert.equal(salFileName(view), "sal-azienda-demo-2026-11-09.pdf");
});

// ─── Le parole ───────────────────────────────────────────────────────

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

test("nella pagina mai «quota», «fee», «proposta a valore», «ondata» o «wave»", () => {
  const scope = [...files("src/lib/programma"), ...files("src/components/programma"), ...files("src/app/(dashboard)/dashboard/[workspaceId]/programma")];
  assert.ok(scope.length >= 8);
  for (const path of scope) {
    const text = readFileSync(join(ROOT, path), "utf8");
    // I commenti citano la decisione («mai "wave" o "ondata"»): si guarda il codice e le stringhe, non i commenti.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\bquota\b|\bfee\b|proposta a valore|\bondat[ae]\b|\bwaves?\b/i, path);
  }
  assert.match(PROGRAM_TEXT.subtitle("Azienda Demo"), /AI-native di Azienda Demo$/);
});
