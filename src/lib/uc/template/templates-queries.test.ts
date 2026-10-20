// Tests for src/lib/db/queries/uc-templates.ts (loader and template reads) with
// a fake executor. Kept under src/lib/uc so that `npm run test:uc` runs them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { UcExecutor, UcRow } from "../../db/uc-executor.ts";
import {
  applyTemplateLoad,
  getTemplateForCase,
  listTemplatesForWorkspace,
  listTemplatesSql,
  templateInsertSql,
  templatePublishSql,
} from "../../db/queries/uc-templates.ts";
import { planTemplateLoad, type TemplateLoadPlan } from "./load.ts";
import type { UcStatement } from "../sql/statement.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_ID = "33333333-3333-4333-8333-333333333333";
const exampleText = readFileSync(new URL("../../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");

function plan(restrict: string | null = null, mutate?: (t: Record<string, unknown>) => void): TemplateLoadPlan {
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  mutate?.(value);
  const r = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: restrict });
  assert.ok(r.ok);
  return r.plan;
}

type Handler = (s: UcStatement) => UcRow[];
function fake(handler: Handler): { executor: UcExecutor; statements: UcStatement[] } {
  const statements: UcStatement[] = [];
  return {
    statements,
    executor: {
      async batch(list) {
        statements.push(...list);
        return list.map((s) => handler(s));
      },
    },
  };
}

const PRE_OK = { actor_exists: true, workspace_exists: true, actor_member: true };
const writes = (statements: UcStatement[]) => statements.filter((s) => /INSERT|UPDATE|DELETE/.test(s.text));

function loader(p: TemplateLoadPlan, opts: { existing?: UcRow[]; inserted?: UcRow[]; afterRace?: UcRow[]; pre?: UcRow } = {}) {
  let lookups = 0;
  return fake((s) => {
    if (s.text.includes("AS actor_exists")) return [opts.pre ?? PRE_OK];
    if (s.text.includes("FROM uc_templates WHERE key =")) return lookups++ === 0 ? (opts.existing ?? []) : (opts.afterRace ?? opts.existing ?? []);
    if (s.text.includes("INSERT INTO uc_templates")) return opts.inserted ?? [{ id: TEMPLATE_ID, status: "pubblicato" }];
    return [];
  });
}

test("first load inserts the template with its event; the definition has no status", async () => {
  const p = plan();
  const { executor, statements } = loader(p);
  const r = await applyTemplateLoad(executor, p, { actorUserId: ACTOR, publish: true });
  assert.ok(r.ok);
  assert.deepEqual(r.value, { status: "LOADED", templateId: TEMPLATE_ID, templateStatus: "pubblicato" });
  const insert = statements.find((s) => s.text.includes("INSERT INTO uc_templates"))!;
  assert.match(insert.text, /ON CONFLICT \(key, version, language\) DO NOTHING/);
  assert.match(insert.text, /ev AS \(INSERT INTO uc_events/);
  assert.ok(insert.params.includes("pubblicato"));
  assert.ok(insert.params.includes(p.hash));
  const definition = JSON.parse(insert.params.find((x) => typeof x === "string" && x.startsWith('{"schema"')) as string) as Record<string, unknown>;
  assert.equal(definition.status, undefined);
  const payload = insert.params.find((x) => typeof x === "string" && x.includes('"hash"')) as string;
  assert.deepEqual(JSON.parse(payload), { key: "esempio.minimo", version: "1.0.0", hash: p.hash, items: 50 });
});

test("loading the same version twice writes nothing the second time", async () => {
  const p = plan();
  const { executor, statements } = loader(p, { existing: [{ id: TEMPLATE_ID, definition_hash: p.hash, status: "pubblicato", restricted_to_workspace_id: null }] });
  const r = await applyTemplateLoad(executor, p, { actorUserId: ACTOR, publish: true });
  assert.ok(r.ok);
  assert.equal(r.value.status, "ALREADY_LOADED");
  assert.deepEqual(writes(statements), []);
});

test("same version with different content, or with another restriction, is refused", async () => {
  const p = plan();
  const differs = loader(p, { existing: [{ id: TEMPLATE_ID, definition_hash: "f".repeat(64), status: "bozza", restricted_to_workspace_id: null }] });
  const r1 = await applyTemplateLoad(differs.executor, p, { actorUserId: ACTOR, publish: true });
  assert.equal(r1.ok ? null : r1.code, "stessa_versione_diversa");
  assert.deepEqual(writes(differs.statements), []);

  const restricted = plan(WS);
  const other = loader(restricted, { existing: [{ id: TEMPLATE_ID, definition_hash: restricted.hash, status: "pubblicato", restricted_to_workspace_id: null }] });
  const r2 = await applyTemplateLoad(other.executor, restricted, { actorUserId: ACTOR, publish: false });
  assert.equal(r2.ok ? null : r2.code, "riserva_diversa");
});

test("a draft with the same hash is published on request", async () => {
  const p = plan();
  const { executor, statements } = loader(p, { existing: [{ id: TEMPLATE_ID, definition_hash: p.hash, status: "bozza", restricted_to_workspace_id: null }] });
  const r = await applyTemplateLoad(executor, p, { actorUserId: ACTOR, publish: true });
  assert.ok(r.ok);
  assert.equal(r.value.status, "PUBLISHED");
  const [update] = writes(statements);
  assert.match(update.text, /UPDATE uc_templates SET status = 'pubblicato'[\s\S]*status = 'bozza' AND definition_hash = /);
  assert.match(update.text, /uc_require\(count\(\*\) = 1, 'conflitto'\)/);

  const again = loader(p, { existing: [{ id: TEMPLATE_ID, definition_hash: p.hash, status: "bozza", restricted_to_workspace_id: null }] });
  const r2 = await applyTemplateLoad(again.executor, p, { actorUserId: ACTOR, publish: false });
  assert.ok(r2.ok);
  assert.equal(r2.value.status, "ALREADY_LOADED");
  assert.equal(r2.value.templateStatus, "bozza");
});

test("a concurrent load of the same version is re-read and compared", async () => {
  const p = plan();
  const { executor } = loader(p, {
    inserted: [],
    afterRace: [{ id: TEMPLATE_ID, definition_hash: p.hash, status: "pubblicato", restricted_to_workspace_id: null }],
  });
  const r = await applyTemplateLoad(executor, p, { actorUserId: ACTOR, publish: true });
  assert.ok(r.ok);
  assert.equal(r.value.status, "ALREADY_LOADED");
});

test("actor and restricted workspace are checked first", async () => {
  const p = plan(WS);
  for (const [pre, code] of [
    [{ ...PRE_OK, actor_exists: false }, "attore_non_trovato"],
    [{ ...PRE_OK, workspace_exists: false }, "workspace_non_trovato"],
    [{ ...PRE_OK, actor_member: false }, "attore_non_membro"],
  ] as const) {
    const { executor, statements } = loader(p, { pre });
    const r = await applyTemplateLoad(executor, p, { actorUserId: ACTOR, publish: true });
    assert.equal(r.ok ? null : r.code, code);
    assert.deepEqual(writes(statements), []);
  }
  const { executor } = loader(p);
  const bad = await applyTemplateLoad(executor, p, { actorUserId: "nessuno", publish: false });
  assert.equal(bad.ok ? null : bad.code, "attore_non_valido");
});

test("the restricted template event goes to its workspace; a public one has no workspace", () => {
  const restricted = templateInsertSql(plan(WS), { actorUserId: ACTOR, publish: false });
  assert.ok(restricted.params.filter((x) => x === WS).length >= 2, "restriction column and event workspace");
  assert.ok(restricted.params.includes("bozza"));
  const publish = templatePublishSql(plan(), TEMPLATE_ID, ACTOR);
  assert.ok(publish.params.includes(TEMPLATE_ID));
});

test("template reads for case creation filter on published and visible, and re-check the hash", async () => {
  const p = plan();
  const visible = fake(() => [{ id: TEMPLATE_ID, key: p.key, version: p.version, definition: p.definition, definition_hash: p.hash, restricted: false }]);
  const r = await getTemplateForCase(visible.executor, WS, { templateId: TEMPLATE_ID });
  assert.ok(r.ok);
  assert.equal(r.value.hash, p.hash);
  assert.equal(r.value.definition.items.length, 50);
  assert.match(visible.statements[0].text, /t\.id = \$1::uuid AND t\.status = 'pubblicato' AND \(t\.restricted_to_workspace_id IS NULL OR t\.restricted_to_workspace_id = \$2::uuid\)/);

  const asText = fake(() => [{ id: TEMPLATE_ID, key: p.key, version: p.version, definition: JSON.stringify(p.definition), definition_hash: p.hash, restricted: true }]);
  const r2 = await getTemplateForCase(asText.executor, WS, { key: p.key, version: p.version });
  assert.ok(r2.ok);
  assert.equal(r2.value.restricted, true);
  assert.deepEqual(asText.statements[0].params.slice(0, 3), [p.key, p.version, "it"]);

  const none = fake(() => []);
  const r3 = await getTemplateForCase(none.executor, WS, { templateId: TEMPLATE_ID });
  assert.equal(r3.ok ? null : r3.code, "template_non_trovato");
  const invalidWs = await getTemplateForCase(none.executor, "x", { templateId: TEMPLATE_ID });
  assert.equal(invalidWs.ok ? null : invalidWs.code, "template_non_trovato");
});

test("the template list never selects the definition itself", async () => {
  const sql = listTemplatesSql(WS);
  assert.doesNotMatch(sql.text, /t\.definition\s*(,|$|\n|FROM)/);
  assert.match(sql.text, /t\.status = 'pubblicato'/);
  const { executor } = fake(() => [
    { id: TEMPLATE_ID, key: "esempio.minimo", version: "1.0.0", language: "it", name: "Esempio", archetype: "x", industry: null, function_area: null, restricted: false, items: "50", questions: "16", published_at: new Date("2026-10-01T00:00:00Z") },
  ]);
  const list = await listTemplatesForWorkspace(executor, WS);
  assert.deepEqual(list, [
    { id: TEMPLATE_ID, key: "esempio.minimo", version: "1.0.0", language: "it", name: "Esempio", archetype: "x", industry: null, functionArea: null, restricted: false, items: 50, questions: 16, publishedAt: "2026-10-01T00:00:00.000Z" },
  ]);
  assert.deepEqual(await listTemplatesForWorkspace(executor, "non-uuid"), []);
});
