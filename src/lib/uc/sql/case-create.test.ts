import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { UcExecutor, UcRow } from "../../db/uc-executor.ts";
import { createCaseFromTemplate, type CreateCaseFromTemplateInput } from "../../db/queries/uc-templates.ts";
import { buildCaseRows, initialReadiness } from "../template/case-build.ts";
import { planTemplateLoad, type TemplateLoadPlan } from "../template/load.ts";
import {
  CASE_CREATE_CHUNKS,
  caseCodeStateSql,
  caseCreateBatches,
  deleteOwnIncompleteCaseSql,
  deleteStaleIncompleteCaseSql,
  type CaseCreateHeader,
} from "./case-create.ts";
import type { UcStatement } from "./statement.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_ID = "33333333-3333-4333-8333-333333333333";
const CASE_ID = "44444444-4444-4444-8444-444444444444";

const exampleText = readFileSync(new URL("../../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
function examplePlan(): TemplateLoadPlan {
  const r = planTemplateLoad(exampleText);
  assert.ok(r.ok);
  return r.plan;
}

function counter(prefix = "aaaaaaaa-0000-4000-8000-") {
  let n = 0;
  return () => `${prefix}${String(n++).padStart(12, "0")}`;
}

function header(plan: TemplateLoadPlan): CaseCreateHeader {
  return {
    caseId: CASE_ID,
    workspaceId: WS,
    templateId: TEMPLATE_ID,
    templateHash: plan.hash,
    templateKey: plan.key,
    templateVersion: plan.version,
    code: "ES-01",
    title: "Caso d'esempio",
    oneLiner: null,
    perimeterLabel: null,
    levers: ["tempo"],
    portfolioUseCaseId: null,
    description: { in_breve: "x" },
    settings: { client_text: false },
    actorUserId: ACTOR,
  };
}

/** Every `$n` placeholder has a parameter and vice versa. */
function assertPlaceholders(s: UcStatement): void {
  const used = new Set([...s.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  assert.equal(used.size, s.params.length, s.text.slice(0, 80));
  for (let i = 1; i <= s.params.length; i++) assert.ok(used.has(i), `$${i} unused`);
}

const jsonParams = (s: UcStatement): unknown[] =>
  s.params.filter((p): p is string => typeof p === "string" && /^[[{]/.test(p)).map((p) => JSON.parse(p) as unknown);

test("batches: header first, items in chunks of 500, links in chunks of 2000, blockers and map, then the final check", () => {
  const plan = examplePlan();
  const build = buildCaseRows(plan.definition, { newId: counter() });
  const batches = caseCreateBatches(header(plan), build, initialReadiness(build, new Date(0)));
  assert.equal(batches.length, 5);
  for (const batch of batches) for (const s of batch) assertPlaceholders(s);

  const first = batches[0].map((s) => s.text);
  assert.match(first[0], /workspace_non_trovato/);
  assert.match(first[1], /attore_non_membro/);
  assert.match(first[2], /status = 'pubblicato'[\s\S]*restricted_to_workspace_id IS NULL OR/);
  assert.match(first[3], /scheda_non_trovata/);
  assert.match(first[4], /INSERT INTO uc_cases[\s\S]*ON CONFLICT \(workspace_id, code\) DO NOTHING[\s\S]*codice_in_uso/);
  assert.doesNotMatch(first[4], /setup_completed_at/, "the case starts incomplete");
  assert.match(first[5], /INSERT INTO uc_case_members[\s\S]*'ls_lead'/);
  assert.match(first[6], /INSERT INTO uc_blockers/);
  assert.match(first[7], /INSERT INTO uc_events/);
  const [created] = jsonParams(batches[0][7]) as Record<string, unknown>[];
  assert.deepEqual(created, { code: "ES-01", template_key: "esempio.minimo", template_version: "1.0.0", items: 50, links: 49, blockers: 6 });

  for (const batch of batches.slice(1, -1)) assert.match(batch[0].text, /caso_non_in_creazione/);
  const [items] = jsonParams(batches[1][1]) as Record<string, unknown>[][];
  assert.equal(items.length, 50);
  assert.ok(items.every((r) => typeof r.id === "string" && typeof r.key === "string" && !("case_id" in r)));
  const [links] = jsonParams(batches[2][1]) as unknown[][];
  assert.equal(links.length, 49);
  assert.match(batches[3][1].text, /INSERT INTO uc_item_blockers/);
  assert.match(batches[3][2].text, /INSERT INTO uc_maps[\s\S]*'template'/);

  const final = batches[4];
  assert.match(final[0].text, /creazione_incompleta/);
  assert.deepEqual(final[0].params.filter((p) => typeof p === "number"), [50, 49, 6, 11, 1]);
  assert.match(final[1].text, /SET setup_completed_at = now\(\), readiness = [\s\S]*setup_completed_at IS NULL/);
  assert.match(final[2].text, /INSERT INTO uc_events/);
  const imported = jsonParams(final[2]).find((p) => (p as Record<string, unknown>).counts) as Record<string, unknown>;
  assert.deepEqual(imported, { count: 50, counts: { da_chiedere: 41, bloccata: 9 } });
});

test("chunk sizes split large catalogues", () => {
  const plan = examplePlan();
  const def = plan.definition;
  const extra = Array.from({ length: CASE_CREATE_CHUNKS.items + 30 }, (_, i) => ({
    ...def.items.find((x) => x.key === "dv.team_assegnato")!,
    key: `dv.extra_${i}`,
    links: [],
  }));
  const big = { ...def, items: [...def.items, ...extra] };
  const build = buildCaseRows(big, { newId: counter() });
  const batches = caseCreateBatches(header(plan), build, initialReadiness(build, new Date(0)));
  const itemBatches = batches.filter((b) => b.some((s) => s.text.includes("INSERT INTO uc_items")));
  assert.equal(itemBatches.length, 2);
  const sizes = itemBatches.map((b) => (jsonParams(b[1])[0] as unknown[]).length);
  assert.deepEqual(sizes, [500, 50 + 30]);
});

test("cleanup statements only touch incomplete cases of the same workspace", () => {
  const stale = deleteStaleIncompleteCaseSql(WS, "ES-01", CASE_ID);
  assert.match(stale.text, /setup_completed_at IS NULL AND created_at < now\(\) - interval '10 minutes'/);
  assert.match(stale.text, /workspace_id = \$2::uuid/);
  const own = deleteOwnIncompleteCaseSql(WS, CASE_ID);
  assert.match(own.text, /DELETE FROM uc_cases[\s\S]*setup_completed_at IS NULL/);
  assert.deepEqual(own.params, [CASE_ID, WS]);
  const state = caseCodeStateSql(WS, "ES-01");
  assert.deepEqual(state.params, [WS, "ES-01"]);
  for (const s of [stale, own, state]) assertPlaceholders(s);
});

// ── createCaseFromTemplate with a fake executor ───────────────────────

type Handler = (s: UcStatement) => UcRow[];

function fakeExecutor(handler: Handler): { executor: UcExecutor; calls: UcStatement[][] } {
  const calls: UcStatement[][] = [];
  return {
    calls,
    executor: {
      async batch(statements) {
        calls.push([...statements]);
        return statements.map((s) => handler(s));
      },
    },
  };
}

function templateHandler(plan: TemplateLoadPlan, codeState: UcRow[] = [], overrides: Partial<Record<string, unknown>> = {}): Handler {
  return (s) => {
    if (s.text.includes("t.definition, t.definition_hash")) {
      return [{ id: TEMPLATE_ID, key: plan.key, version: plan.version, definition: plan.definition, definition_hash: plan.hash, restricted: false, ...overrides }];
    }
    if (s.text.includes("AS stale")) return codeState;
    return [];
  };
}

function input(extra: Partial<CreateCaseFromTemplateInput> = {}): CreateCaseFromTemplateInput {
  return {
    workspaceId: WS,
    actorUserId: ACTOR,
    template: { key: "esempio.minimo", version: "1.0.0" },
    code: "ES-01",
    title: "Caso d'esempio",
    newId: counter("bbbbbbbb-0000-4000-8000-"),
    now: () => new Date("2026-10-07T10:00:00Z"),
    ...extra,
  };
}

test("createCaseFromTemplate reads the visible template, checks the code, then runs every batch", async () => {
  const plan = examplePlan();
  const { executor, calls } = fakeExecutor(templateHandler(plan));
  const result = await createCaseFromTemplate(executor, input({ levers: ["tempo", "costi"], oneLiner: "Una frase" }));
  assert.ok(result.ok, result.ok ? "" : result.message);
  assert.equal(result.value.code, "ES-01");
  assert.equal(result.value.counts.items, 50);
  assert.equal(result.value.replacedIncompleteCaseId, null);
  assert.equal(calls.length, 2 + 5);
  assert.match(calls[0][0].text, /t\.status = 'pubblicato' AND \(t\.restricted_to_workspace_id IS NULL OR t\.restricted_to_workspace_id = \$\d::uuid\)/);
  const caseInsert = calls[2].find((s) => s.text.includes("INSERT INTO uc_cases"))!;
  assert.ok(caseInsert.params.includes("Una frase"));
  const json = jsonParams(caseInsert);
  assert.deepEqual(json[0], { in_breve: plan.definition.description });
  assert.deepEqual(json[1], ["tempo", "costi"]);
  assert.deepEqual(json[2], {
    gate_policy: { scope: "request_modules", default_serves_for: ["modello"], default_perimeter: "in_contratto", confirmed: null },
    client_text: false,
  });
  const readiness = jsonParams(calls.at(-1)![1])[0] as Record<string, unknown>;
  assert.equal(readiness.computed_at, "2026-10-07T10:00:00.000Z");
  assert.deepEqual((readiness.G1 as Record<string, unknown>).required, 7);
});

test("the gate policy can be chosen at creation", async () => {
  const plan = examplePlan();
  const { executor } = fakeExecutor(templateHandler(plan));
  const result = await createCaseFromTemplate(executor, input({ gatePolicyScope: "unione" }));
  assert.ok(result.ok);
  assert.equal(result.value.policy.scope, "unione");
  assert.equal(result.value.counts.g1Required, 20);
});

test("a code already used, or a creation in progress, stops before any write", async () => {
  const plan = examplePlan();
  const used = fakeExecutor(templateHandler(plan, [{ id: CASE_ID, complete: true, stale: true }]));
  const r1 = await createCaseFromTemplate(used.executor, input());
  assert.equal(r1.ok ? null : r1.code, "codice_in_uso");
  assert.equal(used.calls.length, 2);

  const running = fakeExecutor(templateHandler(plan, [{ id: CASE_ID, complete: false, stale: false }]));
  const r2 = await createCaseFromTemplate(running.executor, input());
  assert.equal(r2.ok ? null : r2.code, "creazione_in_corso");
  assert.equal(running.calls.length, 2);
});

test("an incomplete case older than 10 minutes is deleted, then the case is created again", async () => {
  const plan = examplePlan();
  const { executor, calls } = fakeExecutor(templateHandler(plan, [{ id: CASE_ID, complete: false, stale: true }]));
  const result = await createCaseFromTemplate(executor, input());
  assert.ok(result.ok);
  assert.equal(result.value.replacedIncompleteCaseId, CASE_ID);
  assert.match(calls[2][0].text, /DELETE FROM uc_cases/);
  assert.equal(calls.length, 3 + 5);
});

test("a failed batch returns the uc code and deletes the incomplete case", async () => {
  const plan = examplePlan();
  const base = templateHandler(plan);
  const { executor, calls } = fakeExecutor((s) => {
    if (s.text.includes("INSERT INTO uc_item_links")) throw new Error("uc:caso_non_in_creazione");
    return base(s);
  });
  const result = await createCaseFromTemplate(executor, input());
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.code, "caso_non_in_creazione");
  const last = calls.at(-1)!;
  assert.match(last[0].text, /DELETE FROM uc_cases[\s\S]*setup_completed_at IS NULL/);
  assert.equal(last[0].params[0], result.ok ? null : calls[2].find((s) => s.text.includes("INSERT INTO uc_cases"))!.params[0]);
});

test("an unexpected error is rethrown after the cleanup attempt", async () => {
  const plan = examplePlan();
  const base = templateHandler(plan);
  const { executor, calls } = fakeExecutor((s) => {
    if (s.text.includes("INSERT INTO uc_items")) throw new Error("rete non raggiungibile");
    return base(s);
  });
  await assert.rejects(createCaseFromTemplate(executor, input()), /rete non raggiungibile/);
  assert.match(calls.at(-1)![0].text, /DELETE FROM uc_cases/);
});

test("the first batch failing leaves nothing to clean", async () => {
  const plan = examplePlan();
  const base = templateHandler(plan);
  const { executor, calls } = fakeExecutor((s) => {
    if (s.text.includes("codice_in_uso")) throw new Error("uc:codice_in_uso");
    return base(s);
  });
  const result = await createCaseFromTemplate(executor, input());
  assert.equal(result.ok ? null : result.code, "codice_in_uso");
  assert.equal(calls.length, 3);
});

test("template not visible, tampered or invalid input", async () => {
  const plan = examplePlan();
  const missing = fakeExecutor(() => []);
  const r1 = await createCaseFromTemplate(missing.executor, input());
  assert.equal(r1.ok ? null : r1.code, "template_non_trovato");

  const tampered = fakeExecutor(templateHandler(plan, [], { definition_hash: "0".repeat(64) }));
  const r2 = await createCaseFromTemplate(tampered.executor, input());
  assert.equal(r2.ok ? null : r2.code, "template_non_valido");

  const broken = fakeExecutor(templateHandler(plan, [], { definition: { schema: "altro" } }));
  const r3 = await createCaseFromTemplate(broken.executor, input());
  assert.equal(r3.ok ? null : r3.code, "template_non_valido");

  const none = fakeExecutor(templateHandler(plan));
  for (const bad of [{ code: "es-01" }, { title: " " }, { levers: ["fortuna"] as never }, { workspaceId: "x" }, { portfolioUseCaseId: "y" }]) {
    const r = await createCaseFromTemplate(none.executor, input(bad));
    assert.equal(r.ok ? null : r.code, "dati_non_validi", JSON.stringify(bad));
  }
  assert.equal(none.calls.length, 0);
  const badId = await createCaseFromTemplate(none.executor, input({ template: { templateId: "non-uuid" } }));
  assert.equal(badId.ok ? null : badId.code, "template_non_trovato");
  assert.equal(none.calls.length, 0);
});
