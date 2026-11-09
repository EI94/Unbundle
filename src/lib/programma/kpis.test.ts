import test from "node:test";
import assert from "node:assert/strict";
import { FORMULA_ERRORS, KPI_CATALOG, PROGRAM_METRIC_KEYS, WEEKLY_USE_KPI, catalogKpi, evaluateFormula, isMetricKey, kpiKeyOf, kpiProgress, kpiRows, parseFormula, type ProgramMetrics, type StoredKpi } from "./kpis.ts";

// I KPI di «Programma» (rilascio 7b): catalogo, formule senza eval, valori e andamento. Dati sintetici.

const METRICS = Object.fromEntries(PROGRAM_METRIC_KEYS.map((k) => [k, null])) as Record<string, number | null>;
Object.assign(METRICS, { valore_in_uso: 120_000, dipendenti: 400, valore_stimato: 500_000, indice_ai_native: 40 });

const known = (k: string) => isMetricKey(k) || k === "altro";

test("il catalogo: chiavi valide e uniche, i KPI automatici hanno una metrica, «uso settimanale» è a mano", () => {
  const keys = KPI_CATALOG.map((k) => k.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of KPI_CATALOG) {
    assert.match(k.key, /^[a-z][a-z0-9_]{1,39}$/);
    if (k.source === "automatico") assert.ok(k.metric && isMetricKey(k.metric), k.key);
  }
  assert.equal(catalogKpi(WEEKLY_USE_KPI)?.source, "manuale");
  assert.equal(catalogKpi("nessuno"), null);
});

test("le formule: numeri, nomi, + - * / e parentesi; la virgola decimale va bene", () => {
  const p = parseFormula("valore_in_uso / dipendenti", known);
  assert.ok(p.ok);
  assert.equal(evaluateFormula(p.node, (k) => METRICS[k] ?? null), 300);
  const q = parseFormula("(valore_stimato - valore_in_uso) * 0,5 + -10", known);
  assert.ok(q.ok);
  assert.equal(evaluateFormula(q.node, (k) => METRICS[k] ?? null), 190_000 - 10);
  assert.deepEqual(q.ok && q.refs.sort(), ["valore_in_uso", "valore_stimato"]);
});

test("una formula sbagliata non si salva e dice perché; niente eval", () => {
  assert.deepEqual(parseFormula("", known), { ok: false, error: FORMULA_ERRORS.empty });
  assert.deepEqual(parseFormula("valore_in_uso /", known), { ok: false, error: FORMULA_ERRORS.syntax });
  assert.deepEqual(parseFormula("process.exit(1)", known), { ok: false, error: FORMULA_ERRORS.syntax });
  assert.deepEqual(parseFormula("Math.max(1)", known), { ok: false, error: FORMULA_ERRORS.syntax });
  assert.deepEqual(parseFormula("sconosciuto * 2", known), { ok: false, error: FORMULA_ERRORS.unknown.replace("{k}", "sconosciuto") });
  assert.deepEqual(parseFormula("altro + 1", known, "altro"), { ok: false, error: FORMULA_ERRORS.self });
});

test("divisione per zero o un nome senza valore: nessun valore, mai un numero inventato", () => {
  const p = parseFormula("valore_in_uso / 0", known);
  assert.ok(p.ok && evaluateFormula(p.node, (k) => METRICS[k] ?? null) === null);
  const q = parseFormula("persone_formate * 2", known);
  assert.ok(q.ok && evaluateFormula(q.node, (k) => METRICS[k] ?? null) === null);
});

test("l'avanzamento verso l'obiettivo, nel verso giusto, tra 0 e 100", () => {
  assert.equal(kpiProgress(0, 50, 100, "su"), 50);
  assert.equal(kpiProgress(10, 4, 0, "giu"), 60);
  assert.equal(kpiProgress(0, 150, 100, "su"), 100);
  assert.equal(kpiProgress(0, -5, 100, "su"), 0);
  assert.equal(kpiProgress(null, 5, 10, "su"), null);
  assert.equal(kpiProgress(5, 5, 5, "su"), null);
});

const kpi = (over: Partial<StoredKpi> & Pick<StoredKpi, "id" | "key" | "source">): StoredKpi => ({
  label: over.key,
  unit: "",
  kind: "risultato",
  formula: null,
  base: null,
  target: null,
  direction: "su",
  keyResultId: null,
  position: 0,
  ...over,
});

test("i KPI del workspace: automatici dalle metriche, a mano dall'ultimo valore, formule anche su altri KPI", () => {
  const kpis = [
    kpi({ id: "1", key: "valore_in_uso", source: "automatico", base: 0, target: 240_000, position: 0 }),
    kpi({ id: "2", key: WEEKLY_USE_KPI, source: "manuale", position: 1 }),
    kpi({ id: "3", key: "per_testa", source: "formula", formula: "valore_in_uso / dipendenti", position: 2 }),
    kpi({ id: "4", key: "doppio_uso", source: "formula", formula: "uso_settimanale_ai * 2", position: 3 }),
  ];
  const values = [
    { kpiId: "2", period: "2026-09", value: 20, source: "manuale" as const },
    { kpiId: "2", period: "2026-10", value: 30, source: "brain" as const },
  ];
  const history = [
    { period: "2026-09", metrics: { valore_in_uso: 60_000 }, kpis: { per_testa: 150 } },
    { period: "2026-10", metrics: { valore_in_uso: 90_000 }, kpis: { per_testa: 225 } },
  ];
  const rows = kpiRows(kpis, values, METRICS as ProgramMetrics, history);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.valore_in_uso.now, 120_000);
  assert.equal(by.valore_in_uso.progress, 50);
  assert.deepEqual(by.valore_in_uso.history, [{ period: "2026-09", value: 60_000 }, { period: "2026-10", value: 90_000 }]);
  assert.equal(by[WEEKLY_USE_KPI].now, 30);
  assert.equal(by[WEEKLY_USE_KPI].lastPeriod, "2026-10");
  assert.equal(by[WEEKLY_USE_KPI].lastSource, "brain");
  assert.equal(by.per_testa.now, 300);
  assert.deepEqual(by.per_testa.history.map((h) => h.value), [150, 225]);
  assert.equal(by.doppio_uso.now, 60);
  assert.equal(by.doppio_uso.broken, false);
});

test("una formula che usa un KPI tolto si segna rotta e non ha valore", () => {
  const rows = kpiRows([kpi({ id: "9", key: "rotto", source: "formula", formula: "tolto * 2" })], [], METRICS as ProgramMetrics, []);
  assert.equal(rows[0].broken, true);
  assert.equal(rows[0].now, null);
});

test("la chiave di un KPI personalizzato: dal nome, mai una metrica o una chiave già usata", () => {
  assert.equal(kpiKeyOf("Costo per ticket", new Set()), "costo_per_ticket");
  assert.equal(kpiKeyOf("Costo per ticket", new Set(["costo_per_ticket"])), "costo_per_ticket_2");
  assert.equal(kpiKeyOf("Valore in uso", new Set()), "valore_in_uso_2");
  assert.equal(kpiKeyOf("Qualità è più alta", new Set()), "qualita_e_piu_alta");
  assert.equal(kpiKeyOf("123 pratiche", new Set()), "k_123_pratiche");
  assert.equal(kpiKeyOf("A", new Set()), "kpi_a", "almeno due caratteri, come vuole la CHECK");
  assert.equal(kpiKeyOf("Uso settimanale AI", new Set()), "uso_settimanale_ai_2", "mai la chiave di un KPI del catalogo");
  assert.match(kpiKeyOf("!!!", new Set()), /^[a-z][a-z0-9_]{1,39}$/);
});
