import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../../db/uc-executor.ts";
import { applyTemplateLoad, createCaseFromTemplate, getTemplateForCase, listTemplatesForWorkspace } from "../../db/queries/uc-templates.ts";
import { planTemplateLoad, type TemplateLoadPlan } from "./load.ts";

// Opt-in integration suite for template loading and case creation (PIANO §4.3,
// §4.6), on the isolated local harness only. Same guard as
// src/lib/uc/database.integration.test.ts:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test src/lib/uc/template/template-db.integration.test.ts
const url = process.env.UC_TEST_DATABASE_URL;
const enabled = Boolean(url);
if (url) {
  const parsed = new URL(url);
  if (process.env.UC_TEST_ISOLATED !== "true" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("uc DB tests require an explicitly isolated loopback database (UC_TEST_ISOLATED=true)");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== url) {
    throw new Error("DATABASE_URL must be unset or equal to UC_TEST_DATABASE_URL for the uc DB tests");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs (NODE_OPTIONS=--require=…) to reach the local harness");
  }
}
const opts = { skip: !enabled };

const sql = url ? neon(url) : null;
const exec: UcExecutor | null = sql ? createUcExecutor(sql) : null;
const q = (text: string, params: unknown[] = []) => sql!.query(text, params) as Promise<Record<string, unknown>[]>;
const count = async (text: string, params: unknown[] = []) => Number((await q(text, params))[0].n);

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), org2: randomUUID(), ws: randomUUID(), ws2: randomUUID(), lead: randomUUID(), outsider: randomUUID() };
const exampleText = readFileSync(new URL("../../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");

/** The invented example under a test-only key, restricted to the test workspace (cleaned by cascade). */
function testPlan(mutate?: (t: Record<string, unknown>) => void, restrict: string = ids.ws): TemplateLoadPlan {
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.esempio_${suffix}`;
  mutate?.(value);
  const r = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: restrict });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.plan;
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova template', $2), ($3::uuid, 'Org prova template B', $4)`, [
    ids.org,
    `uc-tpl-${ids.org}`,
    ids.org2,
    `uc-tpl-${ids.org2}`,
  ]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova template A'), ($3::uuid, $4::uuid, 'Prova template B')`, [
    ids.ws,
    ids.org,
    ids.ws2,
    ids.org2,
  ]);
  await q(`INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $3, now()), ($2::uuid, $4, now())`, [
    ids.lead,
    ids.outsider,
    `tpl-lead-${suffix}@ls.test`,
    `tpl-out-${suffix}@altro.test`,
  ]);
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $2::uuid, 'transformation_lead')`, [ids.lead, ids.org]);
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1::uuid, $2::uuid)`, [ids.ws, ids.ws2]);
  await q(`DELETE FROM organizations WHERE id IN ($1::uuid, $2::uuid)`, [ids.org, ids.org2]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, [ids.lead, ids.outsider]);
});

test("loader: draft, publish, then ALREADY_LOADED with no writes; changed content refused", opts, async () => {
  const plan = testPlan();
  const first = await applyTemplateLoad(exec!, plan, { actorUserId: ids.lead, publish: false });
  assert.ok(first.ok, first.ok ? "" : first.message);
  assert.equal(first.value.status, "LOADED");
  assert.equal(first.value.templateStatus, "bozza");

  const published = await applyTemplateLoad(exec!, plan, { actorUserId: ids.lead, publish: true });
  assert.ok(published.ok);
  assert.equal(published.value.status, "PUBLISHED");

  const before = await count(`SELECT count(*) AS n FROM uc_events WHERE target_id = $1::uuid`, [first.value.templateId]);
  const again = await applyTemplateLoad(exec!, plan, { actorUserId: ids.lead, publish: true });
  assert.ok(again.ok);
  assert.equal(again.value.status, "ALREADY_LOADED");
  assert.equal(again.value.templateId, first.value.templateId);
  assert.equal(await count(`SELECT count(*) AS n FROM uc_events WHERE target_id = $1::uuid`, [first.value.templateId]), before);
  assert.equal(before, 2, "one event to load, one to publish");
  assert.equal(await count(`SELECT count(*) AS n FROM uc_templates WHERE key = $1`, [plan.key]), 1);

  const [row] = await q(`SELECT status, definition, definition_hash, restricted_to_workspace_id, published_at FROM uc_templates WHERE id = $1::uuid`, [
    first.value.templateId,
  ]);
  assert.equal(row.status, "pubblicato");
  assert.equal(row.definition_hash, plan.hash);
  assert.equal(row.restricted_to_workspace_id, ids.ws);
  assert.ok(row.published_at);
  assert.equal((row.definition as Record<string, unknown>).status, undefined);

  const changed = await applyTemplateLoad(exec!, testPlan((t) => (t.name = "Esempio cambiato")), { actorUserId: ids.lead, publish: true });
  assert.equal(changed.ok ? null : changed.code, "stessa_versione_diversa");
  const elsewhere = await applyTemplateLoad(exec!, testPlan(undefined, ids.ws2), { actorUserId: ids.lead, publish: true });
  assert.equal(elsewhere.ok ? null : elsewhere.code, "attore_non_membro");
  const stranger = await applyTemplateLoad(exec!, plan, { actorUserId: randomUUID(), publish: true });
  assert.equal(stranger.ok ? null : stranger.code, "attore_non_trovato");
});

test("template reads: visible only to the restricted workspace, hash re-checked after the jsonb round trip", opts, async () => {
  const plan = testPlan();
  const mine = await getTemplateForCase(exec!, ids.ws, { key: plan.key, version: plan.version });
  assert.ok(mine.ok, mine.ok ? "" : mine.message);
  assert.equal(mine.value.hash, plan.hash);
  assert.equal(mine.value.restricted, true);
  const other = await getTemplateForCase(exec!, ids.ws2, { key: plan.key, version: plan.version });
  assert.equal(other.ok ? null : other.code, "template_non_trovato");
  const list = await listTemplatesForWorkspace(exec!, ids.ws);
  const entry = list.find((t) => t.key === plan.key);
  assert.ok(entry);
  assert.equal(entry.items, 50);
  assert.equal(entry.questions, 16);
  assert.equal(entry.restricted, true);
  assert.equal((await listTemplatesForWorkspace(exec!, ids.ws2)).some((t) => t.key === plan.key), false);
});

test("case creation: all rows copied, visible only at the end, with its events", opts, async () => {
  const plan = testPlan();
  const code = `ES-${suffix.toUpperCase()}`;
  const created = await createCaseFromTemplate(exec!, {
    workspaceId: ids.ws,
    template: { key: plan.key, version: plan.version },
    actorUserId: ids.lead,
    code,
    title: "Caso d'esempio",
    levers: ["tempo", "qualita"],
  });
  assert.ok(created.ok, created.ok ? "" : `${created.code}: ${created.message}`);
  const caseId = created.value.caseId;

  const [c] = await q(`SELECT status, setup_completed_at, organization_id, template_version, levers, settings, readiness, description FROM uc_cases WHERE id = $1::uuid`, [caseId]);
  assert.equal(c.status, "bozza");
  assert.ok(c.setup_completed_at);
  assert.equal(c.organization_id, ids.org);
  assert.deepEqual(c.levers, ["tempo", "qualita"]);
  assert.equal(((c.settings as Record<string, unknown>).gate_policy as Record<string, unknown>).scope, "request_modules");
  assert.equal(((c.readiness as Record<string, unknown>).G1 as Record<string, unknown>).required, 7);
  assert.ok((c.description as Record<string, unknown>).in_breve);

  assert.equal(await count(`SELECT count(*) AS n FROM uc_items WHERE case_id = $1::uuid`, [caseId]), 50);
  assert.equal(await count(`SELECT count(*) AS n FROM uc_items WHERE case_id = $1::uuid AND key = template_item_key`, [caseId]), 50);
  assert.equal(await count(`SELECT count(*) AS n FROM uc_item_links WHERE case_id = $1::uuid`, [caseId]), 49);
  assert.equal(await count(`SELECT count(*) AS n FROM uc_item_blockers ib JOIN uc_items i ON i.id = ib.item_id WHERE i.case_id = $1::uuid`, [caseId]), 11);
  assert.equal(await count(`SELECT count(*) AS n FROM uc_items WHERE case_id = $1::uuid AND status = 'bloccata'`, [caseId]), 9);
  assert.equal(await count(`SELECT count(*) AS n FROM uc_items WHERE case_id = $1::uuid AND in_gate_scope`, [caseId]), 16);
  assert.equal(await count(`SELECT count(*) AS n FROM uc_blockers WHERE case_id = $1::uuid AND key = 'sanitario' AND status = 'permanente'`, [caseId]), 1);
  assert.equal(await count(`SELECT count(*) AS n FROM uc_maps WHERE case_id = $1::uuid AND is_current AND kind = 'soluzione'`, [caseId]), 1);
  assert.equal(await count(`SELECT count(*) AS n FROM uc_case_members WHERE case_id = $1::uuid AND user_id = $2::uuid AND role = 'ls_lead'`, [caseId, ids.lead]), 1);
  assert.equal(
    await count(
      `SELECT count(*) AS n FROM uc_items f JOIN uc_items p ON p.id = f.parent_item_id WHERE f.case_id = $1::uuid AND p.case_id = $1::uuid AND f.kind = 'campo' AND p.key = 'ent.' || split_part(f.key, '.', 1)`,
      [caseId],
    ),
    10,
  );
  const events = await q(`SELECT event_type, actor_type, payload FROM uc_events WHERE case_id = $1::uuid ORDER BY created_at, event_type`, [caseId]);
  assert.deepEqual(events.map((e) => e.event_type).sort(), ["caso.creato", "voce.stato_importato"]);
  const imported = events.find((e) => e.event_type === "voce.stato_importato")!;
  assert.equal(imported.actor_type, "sistema");
  assert.deepEqual(imported.payload, { count: 50, counts: { da_chiedere: 41, bloccata: 9 } });

  const duplicate = await createCaseFromTemplate(exec!, { workspaceId: ids.ws, template: { key: plan.key, version: plan.version }, actorUserId: ids.lead, code, title: "Di nuovo" });
  assert.equal(duplicate.ok ? null : duplicate.code, "codice_in_uso");
});

test("case creation refuses outsiders and invisible templates, and leaves nothing behind", opts, async () => {
  const plan = testPlan();
  const code = `NO-${suffix.toUpperCase()}`;
  const outsider = await createCaseFromTemplate(exec!, { workspaceId: ids.ws, template: { key: plan.key, version: plan.version }, actorUserId: ids.outsider, code, title: "No" });
  assert.equal(outsider.ok ? null : outsider.code, "attore_non_membro");
  const invisible = await createCaseFromTemplate(exec!, { workspaceId: ids.ws2, template: { key: plan.key, version: plan.version }, actorUserId: ids.lead, code, title: "No" });
  assert.equal(invisible.ok ? null : invisible.code, "template_non_trovato");
  assert.equal(await count(`SELECT count(*) AS n FROM uc_cases WHERE code = $1`, [code]), 0);
});

test("a batch failing midway deletes the incomplete case; a stale incomplete case is replaced", opts, async () => {
  const plan = testPlan();
  const code = `KO-${suffix.toUpperCase()}`;
  const failing: UcExecutor = {
    async batch(statements) {
      if (statements.some((s) => s.text.includes("INSERT INTO uc_item_links"))) {
        return exec!.batch([...statements.slice(0, 1), { text: "SELECT uc_require(false, 'prova_interrotta')", params: [] }]);
      }
      return exec!.batch(statements);
    },
  };
  const broken = await createCaseFromTemplate(failing, { workspaceId: ids.ws, template: { key: plan.key, version: plan.version }, actorUserId: ids.lead, code, title: "Interrotto" });
  assert.equal(broken.ok ? null : broken.code, "prova_interrotta");
  assert.equal(await count(`SELECT count(*) AS n FROM uc_cases WHERE workspace_id = $1::uuid AND code = $2`, [ids.ws, code]), 0);

  // Failing at the very end: rows of active blockers already exist and go with the cascade.
  const lastFails: UcExecutor = {
    async batch(statements) {
      if (statements.some((s) => s.text.includes("creazione_incompleta"))) {
        return exec!.batch([{ text: "SELECT uc_require(false, 'prova_interrotta')", params: [] }]);
      }
      return exec!.batch(statements);
    },
  };
  const late = await createCaseFromTemplate(lastFails, { workspaceId: ids.ws, template: { key: plan.key, version: plan.version }, actorUserId: ids.lead, code, title: "Interrotto tardi" });
  assert.equal(late.ok ? null : late.code, "prova_interrotta");
  assert.equal(await count(`SELECT count(*) AS n FROM uc_cases WHERE workspace_id = $1::uuid AND code = $2`, [ids.ws, code]), 0);
  assert.equal(
    await count(`SELECT count(*) AS n FROM uc_item_blockers ib WHERE NOT EXISTS (SELECT 1 FROM uc_items i WHERE i.id = ib.item_id)`),
    0,
  );

  // An old incomplete case with the same code (a crash without cleanup) is replaced; a recent one is not.
  const [template] = await q(`SELECT id FROM uc_templates WHERE key = $1`, [plan.key]);
  const stale = randomUUID();
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, template_id, template_version, code, title, created_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, '1.0.0', $5, 'Rimasto a metà', now() - interval '20 minutes')`,
    [stale, ids.ws, ids.org, template.id, code],
  );
  const replaced = await createCaseFromTemplate(exec!, { workspaceId: ids.ws, template: { key: plan.key, version: plan.version }, actorUserId: ids.lead, code, title: "Rifatto" });
  assert.ok(replaced.ok, replaced.ok ? "" : replaced.message);
  assert.equal(replaced.value.replacedIncompleteCaseId, stale);
  assert.equal(await count(`SELECT count(*) AS n FROM uc_cases WHERE id = $1::uuid`, [stale]), 0);

  const recentCode = `RC-${suffix.toUpperCase()}`;
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, template_id, template_version, code, title)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, '1.0.0', $5, 'In creazione')`,
    [randomUUID(), ids.ws, ids.org, template.id, recentCode],
  );
  const busy = await createCaseFromTemplate(exec!, { workspaceId: ids.ws, template: { key: plan.key, version: plan.version }, actorUserId: ids.lead, code: recentCode, title: "No" });
  assert.equal(busy.ok ? null : busy.code, "creazione_in_corso");
});
