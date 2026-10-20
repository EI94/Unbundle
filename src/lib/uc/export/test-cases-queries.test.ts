import test from "node:test";
import assert from "node:assert/strict";
import type { UcExecutor, UcRow } from "../../db/uc-executor.ts";
import type { UcCommandContext } from "../../db/queries/uc-cases.ts";
import { importTestCases } from "../../db/queries/uc-test-cases.ts";
import type { UcStatement } from "../sql/statement.ts";
import type { CaseRole } from "../vocab.ts";

// Esecutore finto: risponde alle letture riconoscendo la SQL e registra i batch.
// Le prove sul database vero stanno nei test di integrazione del harness.

const CASE = "11111111-1111-4111-8111-111111111111";
const WS = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

type Responder = (s: UcStatement, index: number, batch: readonly UcStatement[]) => UcRow[];

function fakeExecutor(respond: Responder, onBatch?: (batch: readonly UcStatement[]) => void): UcExecutor & { batches: UcStatement[][] } {
  const batches: UcStatement[][] = [];
  return {
    batches,
    async batch(statements) {
      batches.push([...statements]);
      onBatch?.(statements);
      return statements.map((s, i) => respond(s, i, statements));
    },
  };
}

const ctx = (roles: CaseRole[] = ["ls_lead"]): UcCommandContext => ({
  workspaceId: WS,
  caseId: CASE,
  actor: { type: "utente", userId: USER, roles },
  user: { userId: USER, emailVerified: true, emailDomain: "ls.test", isLateralSpace: true },
  lsDomains: ["ls.test"],
});

function importExecutor(o: { status?: string | null; a8?: string | null; keys?: string[]; fail?: string; result?: UcRow } = {}) {
  return fakeExecutor(
    (s) => {
      if (/^SELECT status FROM uc_cases/.test(s.text)) return o.status === null ? [] : [{ status: o.status ?? "raccolta" }];
      if (/^SELECT status FROM uc_blockers/.test(s.text)) return o.a8 === null ? [] : [{ status: o.a8 ?? "attivo" }];
      if (/^SELECT key FROM uc_items/.test(s.text)) return (o.keys ?? ["rule.esempio.priorita"]).map((key) => ({ key }));
      if (/^WITH incoming AS/.test(s.text)) return [o.result ?? { inserted: 1, updated: 0 }];
      return [{ ok: true }];
    },
    (batch) => {
      if (o.fail && batch.some((s) => /uc_require/.test(s.text))) throw new Error(`uc:${o.fail}`);
    },
  );
}

const csv = (rows: string[]) => ["key;kind;input;atteso;regole;covers;serve_per", ...rows].join("\n");

test("test cases import: only the case lead, only on an open case", async () => {
  const notLead = importExecutor();
  const r1 = await importTestCases(notLead, ctx(["ls_analista"]), { text: csv(["c1;;x;y;;;"]) });
  assert.equal(r1.ok ? "" : r1.code, "attore_non_ammesso");
  assert.equal(notLead.batches.length, 0);
  const missing = await importTestCases(importExecutor({ status: null }), ctx(), { text: csv(["c1;;x;y;;;"]) });
  assert.equal(missing.ok ? "" : missing.code, "non_trovato");
  const closed = await importTestCases(importExecutor({ status: "chiuso" }), ctx(), { text: csv(["c1;;x;y;;;"]) });
  assert.equal(closed.ok ? "" : closed.code, "caso_chiuso");
});

test("test cases import: health text, unknown rules and pseudonymized rows before A.8 stop everything, without echoing the text", async () => {
  const exec = importExecutor();
  const r = await importTestCases(exec, ctx(), {
    text: csv(["c1;sintetico;Il pilota ha la visita medica scaduta;Strategia A;;;", "c2;sintetico;Richiesta normale;Strategia B;rule.esempio.assente;;", "c3;pseudonimizzato;Altra richiesta;Strategia C;;;"]),
    format: "csv",
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "casi_prova_non_validi");
  const codes = (r.errors ?? []).map((e) => `${e.row}:${e.code}`);
  assert.ok(codes.includes("1:testo_non_ammesso"), codes.join(","));
  assert.ok(codes.includes("2:regola_assente"), codes.join(","));
  assert.ok(codes.includes("3:a8_non_sciolto"), codes.join(","));
  assert.ok(!JSON.stringify(r).includes("visita medica"));
  assert.equal(exec.batches.length, 1, "only the reads, no write batch");
});

test("test cases import: one write batch with guards, upsert and event; the summary counts unchanged rows", async () => {
  const exec = importExecutor({ a8: "sciolto", result: { inserted: 1, updated: 1 } });
  const text = JSON.stringify([
    { key: "caso.01", input: { richiesta: "Due persone, sabato" }, expected: { atteso: "Strategia A", regole: ["rule.esempio.priorita"] } },
    { key: "caso.02", kind: "pseudonimizzato", input: { richiesta: "Richiesta ricostruita" }, atteso: "Strategia B" },
    { key: "caso.03", input: "Richiesta in testo", atteso: "Strategia C" },
  ]);
  const r = await importTestCases(exec, ctx(), { text });
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r));
  assert.deepEqual({ ...r.value, warnings: r.value.warnings.length }, { total: 3, inserted: 1, updated: 1, unchanged: 1, warnings: 0 });
  assert.equal(exec.batches.length, 2);
  const write = exec.batches[1];
  assert.equal(write.length, 4, "case, lead and A.8 guards, then the upsert");
  assert.ok(write[3].params.includes('{"count":3,"format":"json"}'));
});

test("test cases import: a guard lost to a concurrent change becomes a clear message", async () => {
  const r = await importTestCases(importExecutor({ a8: "sciolto", fail: "a8_non_sciolto" }), ctx(), {
    text: JSON.stringify([{ key: "caso.02", kind: "pseudonimizzato", input: { a: 1 }, atteso: "x" }]),
  });
  assert.deepEqual(r, { ok: false, code: "a8_non_sciolto", message: "I casi pseudonimizzati si caricano solo dopo l'approvazione della scheda A.8." });
});
