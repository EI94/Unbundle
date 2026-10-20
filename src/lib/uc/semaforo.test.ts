import test from "node:test";
import assert from "node:assert/strict";
import type { GateItem } from "./gates.ts";
import {
  SEMAFORO_ORDER,
  STATUS_COLOR,
  STATUS_LABEL,
  UNASSIGNED_LABEL,
  WORST_FIRST,
  computeReadiness,
  gateLineText,
  openCountsByAssignee,
  semaforoCounts,
  worstStatus,
} from "./semaforo.ts";
import { ITEM_STATUSES, type ItemStatus } from "./vocab.ts";

const NOW = new Date("2026-10-07T10:00:00Z");

test("bar order, worst-first order, colors and labels cover every status once", () => {
  assert.deepEqual([...SEMAFORO_ORDER].sort(), [...ITEM_STATUSES].sort());
  assert.deepEqual([...WORST_FIRST].sort(), [...ITEM_STATUSES].sort());
  assert.deepEqual(STATUS_COLOR, {
    da_chiedere: "grigio", chiesta: "grigio", mancante: "rosso", parziale: "giallo",
    in_verifica: "giallo", validata: "verde", non_applicabile: "blu", bloccata: "lucchetto",
  });
  // Vocabulary of DESIGN §2.6: the detailed states as Lateral Space reads them.
  assert.deepEqual(STATUS_LABEL, {
    da_chiedere: "Non ancora chiesta", chiesta: "Chiesta, in attesa", mancante: "Manca il dato", parziale: "Risposta parziale",
    in_verifica: "Da verificare", validata: "A posto", non_applicabile: "Non si applica", bloccata: "Bloccata",
  });
  assert.equal(new Set(Object.values(STATUS_LABEL)).size, ITEM_STATUSES.length, "every detailed state has its own label");
});

test("counts and green percentage", () => {
  const s = semaforoCounts(["validata", "validata", "non_applicabile", "in_verifica", "da_chiedere", "da_chiedere"]);
  assert.equal(s.total, 6);
  assert.equal(s.counts.validata, 2);
  assert.equal(s.counts.mancante, 0);
  assert.equal(s.greenPct, 50);
  assert.equal(semaforoCounts(["validata", "chiesta", "chiesta"]).greenPct, 33);
  assert.equal(semaforoCounts(["validata", "validata", "chiesta"]).greenPct, 67);
  assert.deepEqual(semaforoCounts([]), { counts: Object.fromEntries(ITEM_STATUSES.map((x) => [x, 0])), total: 0, greenPct: 0 });
});

test("the worst status colors a map node", () => {
  assert.equal(worstStatus([]), null);
  assert.equal(worstStatus(["validata", "in_verifica", "mancante"]), "mancante");
  assert.equal(worstStatus(["validata", "bloccata", "da_chiedere"]), "bloccata");
  assert.equal(worstStatus(["validata", "non_applicabile"]), "non_applicabile");
  assert.equal(worstStatus(["validata"]), "validata");
});

test("open items per referent: only counts, alphabetical, no ranking", () => {
  const items = [
    { assigneeLabel: "Responsabile commerciale", ok: false },
    { assigneeLabel: "Operativo", ok: false },
    { assigneeLabel: "Operativo", ok: false },
    { assigneeLabel: "Operativo", ok: true },
    { assigneeLabel: "Amministrazione", ok: true },
    { assigneeLabel: "Èlite (esempio con accento)", ok: false },
    { assigneeLabel: null, ok: false },
    { assigneeLabel: "  ", ok: false },
  ];
  assert.deepEqual(openCountsByAssignee(items), [
    { label: "Èlite (esempio con accento)", open: 1 },
    { label: "Operativo", open: 2 },
    { label: "Responsabile commerciale", open: 1 },
    { label: UNASSIGNED_LABEL, open: 2 },
  ]);
  assert.deepEqual(openCountsByAssignee([{ assigneeLabel: "A", ok: true }]), []);
});

test("gate line under the bar, as in the prototype", () => {
  assert.equal(gateLineText({ required: 245, ok: 0, ready: false, available: true }), "Per avviare lo sviluppo servono verdi le 245 voci obbligatorie: ora 0.");
  assert.equal(gateLineText({ required: 3, ok: 3, ready: true, available: true }), "Tutte le voci obbligatorie sono verdi. Il team Lateral Space può avviare lo sviluppo.");
  assert.match(gateLineText({ required: 3, ok: 3, ready: false, available: true }), /altre condizioni/);
  assert.equal(gateLineText({ required: 3, ok: 0, ready: false, available: false }), "Gate non disponibile in questa versione.");
});

function gi(id: string, status: ItemStatus, over: Partial<GateItem> = {}): GateItem {
  return {
    id, key: `q.area.${id}`, kind: "domanda", status, priority: "must", perimeter: "in_contratto", servesFor: ["modello"],
    inGateScope: true, privacyClass: "nessuna", responseType: "numero", requestModuleKey: "mod.a", ownerRoleKey: "resp",
    responderRoleKey: "resp", confirmedByRoleKey: null, answerTextHash: "h", answerVersion: 1, staleAt: null, naApprovedAt: null,
    waiver: null, waiverApprovedAt: null, fallback: null, fallbackApprovedAt: null, activeBlockerKeys: status === "bloccata" ? ["a8"] : [],
    openClarification: false,
    // As created from a template: questions get serves_for and perimeter from the gate rule.
    defaultsApplied: "requestModuleKey" in over && over.requestModuleKey === null ? [] : ["serves_for", "perimeter"],
    ...over,
  };
}

test("readiness: header counts module items, G1 numbers, coverage and gate to reconfirm", () => {
  const items = [
    gi("1", "validata"),
    gi("2", "in_verifica"),
    gi("3", "bloccata"),
    gi("4", "da_chiedere", { priority: "should" }),
    gi("f1", "da_chiedere", { kind: "campo", key: "ent_a.campo", requestModuleKey: null, inGateScope: false }),
    gi("f2", "validata", { kind: "campo", key: "ent_a.altro", requestModuleKey: null, inGateScope: false, deleted: true }),
  ];
  const links = [{ fromItemId: "1", toItemId: "f1", relation: "precisa" as const }];
  const base = { items, links, datasets: [], blockers: [], now: NOW, catalogRevision: 7, caseCode: "ES-001", caseStatus: "raccolta" as const, statusBeforeSuspension: null, policy: { scope: "request_modules" as const } };
  const { readiness, g1, coverage } = computeReadiness(base);
  assert.equal(readiness.computed_at, NOW.toISOString());
  assert.equal(readiness.catalog_revision, 7);
  assert.equal(readiness.scope_total, 4);
  assert.equal(readiness.per_stato.validata, 1);
  assert.equal(readiness.per_stato.da_chiedere, 1);
  assert.equal(readiness.green_pct, 25);
  assert.deepEqual(readiness.G1, { required: 3, ok: 1, ready: false, should: { total: 1, ok: 0 }, waivers: { used: 0, cap: 0 } });
  assert.deepEqual(readiness.coverage_model, { literal_required: 1, covered_by_questions: 1, ok: 1 });
  assert.equal(readiness.gate_reconfirm, false);
  assert.equal(g1.missing.length, 2);
  assert.equal(coverage.uncovered.length, 0);
  // Past G1 and no longer ready: «Gate da riconfermare» (the case status does not change by itself).
  assert.equal(computeReadiness({ ...base, caseStatus: "in_sviluppo" }).readiness.gate_reconfirm, true);
  assert.equal(computeReadiness({ ...base, caseStatus: "sospeso", statusBeforeSuspension: "pronto_sviluppo" }).readiness.gate_reconfirm, true);
  const allGreen = items.map((x) => ({ ...x, status: "validata" as const, activeBlockerKeys: [] }));
  assert.equal(computeReadiness({ ...base, items: allGreen, caseStatus: "in_sviluppo" }).readiness.gate_reconfirm, false);
  // The readiness cache is plain JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(readiness)), readiness);
});
