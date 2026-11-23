import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../../db/uc-executor.ts";
import { applyTemplateLoad, createCaseFromTemplate, ensureFromUseCaseTemplate, listTemplatesForWorkspace } from "../../db/queries/uc-templates.ts";
import { planReschema, reschemaCase } from "../../db/queries/uc-reschema.ts";
import { loadOverview } from "../../db/queries/uc-overview.ts";
import { cardSyncStatements } from "../../use-cases/case-alerts/sql.ts";
import { FROM_USE_CASE_TEMPLATE, NEED_TOPICS } from "./from-use-case.ts";
import { planTemplateLoad } from "./load.ts";
import { command as reschemaCommand } from "../../../../scripts/use-case-admin/reschema.ts";
import type { AdminContext, AdminRow } from "../../use-cases/admin/cli.ts";

// Opt-in suite (docs/dossier/SCHEMA-DI-PARTENZA.md R1-R5), on the isolated local harness only:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/<copy> UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test src/lib/uc/template/from-use-case.integration.test.ts
// Invented data only (the repository is public).
const url = process.env.UC_TEST_DATABASE_URL;
const enabled = Boolean(url);
if (url) {
  const parsed = new URL(url);
  if (process.env.UC_TEST_ISOLATED !== "true" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("uc DB tests require an explicitly isolated loopback database (UC_TEST_ISOLATED=true)");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== url) throw new Error("DATABASE_URL must be unset or equal to UC_TEST_DATABASE_URL");
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") throw new Error("Preload scripts/uc-test/local-neon.cjs");
}
const opts = { skip: !enabled };

const sql = url ? neon(url) : null;
const exec: UcExecutor | null = sql ? createUcExecutor(sql) : null;
const q = (text: string, params: unknown[] = []) => sql!.query(text, params) as Promise<Record<string, unknown>[]>;
const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0] ?? {};

const suffix = randomBytes(3).toString("hex").toUpperCase();
const ids = { org: randomUUID(), ws: randomUUID(), lead: randomUUID(), ucA: randomUUID(), ucB: randomUUID(), ucC: randomUUID(), ucD: randomUUID() };
const exampleText = readFileSync(new URL("../../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
let sectorTemplateId = "";

async function useCase(id: string, title: string) {
  await q(`INSERT INTO use_cases (id, workspace_id, title, status, portfolio_kind) VALUES ($1::uuid, $2::uuid, $3, 'accepted', 'use_case_ai')`, [id, ids.ws, title]);
}

/** A «requisito» need linked to a use case. */
async function need(useCaseId: string, title: string, status: string, sortOrder: number, extra: { archived?: boolean; type?: string; kind?: string } = {}) {
  const row = await one(
    `INSERT INTO use_case_needs (workspace_id, type, kind, title, status, sort_order, archived_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() ELSE NULL END) RETURNING id`,
    [ids.ws, extra.type ?? "requisito", extra.kind ?? "dato", title, status, sortOrder, extra.archived === true],
  );
  await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [row.id, useCaseId]);
  return String(row.id);
}

async function create(useCaseId: string, code: string, templateId: string) {
  const created = await createCaseFromTemplate(exec!, { workspaceId: ids.ws, template: { templateId }, actorUserId: ids.lead, code, title: `Prova ${code}`, portfolioUseCaseId: useCaseId });
  assert.ok(created.ok, created.ok ? "" : created.message);
  return created.value.caseId;
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova schema', $2)`, [ids.org, `uc-schema-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova schema di partenza')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $2, now())`, [ids.lead, `schema-lead-${suffix.toLowerCase()}@ls.test`]);
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $2::uuid, 'transformation_lead')`, [ids.lead, ids.org]);
  await useCase(ids.ucA, "Ricerca settimanale di contatti per una fiera inventata");
  await useCase(ids.ucB, "Riepilogo inventato delle richieste del mese");
  await useCase(ids.ucC, "Controllo inventato delle bozze di contratto");
  await useCase(ids.ucD, "Prova inventata del comando operatore");
  // A sector template restricted to the workspace, under a test-only key (cleaned by cascade).
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.settore_${suffix.toLowerCase()}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok);
  sectorTemplateId = loaded.value.templateId;
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1::uuid`, [ids.lead]);
});

test("«Dal caso d'uso» is a public, published row created once (idempotent) and listed for the workspace", opts, async () => {
  const first = await ensureFromUseCaseTemplate(exec!);
  const second = await ensureFromUseCaseTemplate(exec!);
  assert.ok(first.ok && second.ok);
  assert.equal(first.value.id, second.value.id);
  const row = await one(`SELECT status, restricted_to_workspace_id, count(*) OVER () AS n FROM uc_templates WHERE key = $1`, [FROM_USE_CASE_TEMPLATE.key]);
  assert.equal(row.status, "pubblicato");
  assert.equal(row.restricted_to_workspace_id, null);
  assert.equal(Number(row.n), 1);
  const listed = await listTemplatesForWorkspace(exec!, ids.ws);
  assert.ok(listed.some((t) => t.key === FROM_USE_CASE_TEMPLATE.key && !t.restricted));
});

test("createCaseFromTemplate with «Dal caso d'uso»: items = non-archived needs with their statuses, 6 di 6, no map or rules", opts, async () => {
  for (let k = 1; k <= 6; k++) await need(ids.ucA, `Informazione inventata ${k}`, "validata", k * 10);
  await need(ids.ucA, "Facoltativa: un esempio inventato in più", "da_chiedere", 20);
  await need(ids.ucA, "Voce archiviata inventata", "chiesta", 30, { archived: true });
  await need(ids.ucA, "Passo inventato", "proposta", 40, { type: "passo" });
  const t = await ensureFromUseCaseTemplate(exec!);
  assert.ok(t.ok);
  const caseId = await create(ids.ucA, `XX-${suffix}1`, t.value.id);

  const items = await q(`SELECT kind, status, priority, deleted_at, shared_item_id, template_item_key, validated_answer_id FROM uc_items WHERE case_id = $1::uuid ORDER BY sort_order`, [caseId]);
  assert.equal(items.length, 7, "6 required + 1 optional; archived need and step left out");
  assert.ok(items.every((i) => i.kind === "domanda" && i.deleted_at === null && i.shared_item_id !== null && String(i.template_item_key).startsWith("need.")));
  assert.equal(items.filter((i) => i.status === "validata" && i.validated_answer_id !== null).length, 6);
  assert.equal(items.filter((i) => i.priority === "must").length, 6, "indispensabili: not «Facoltativa:» and not sort 500-900");
  assert.equal(Number((await one(`SELECT count(*) AS n FROM uc_maps WHERE case_id = $1::uuid`, [caseId])).n), 0, "map: «Da disegnare»");
  assert.equal(Number((await one(`SELECT count(*) AS n FROM uc_items WHERE case_id = $1::uuid AND kind <> 'domanda'`, [caseId])).n), 0, "no entities, rules, formulas or sources");

  // R5: the Panoramica counters count the dossier's own items: «6 di 6», topics from «Cosa serve».
  const overview = await loadOverview(exec!, { workspaceId: ids.ws, caseId });
  assert.ok(overview);
  assert.equal(overview.required.length, 6);
  assert.equal(overview.required.filter((r) => r.ok).length, 6);
  assert.deepEqual(new Set(overview.modules.map((m) => m.title)), new Set(NEED_TOPICS.map((x) => x.title)));
});

test("a need change reaches its linked item through the need write path's sync (status, archive, new need)", opts, async () => {
  const needId = await need(ids.ucB, "Informazione inventata da seguire", "validata", 10);
  const t = await ensureFromUseCaseTemplate(exec!);
  assert.ok(t.ok);
  const caseId = await create(ids.ucB, `XX-${suffix}2`, t.value.id);
  const item = async () => one(`SELECT status, deleted_at, validated_answer_id, status_reason FROM uc_items WHERE case_id = $1::uuid AND shared_item_id = $2::uuid`, [caseId, needId]);
  assert.equal((await item()).status, "validata");
  const revision = Number((await one(`SELECT catalog_revision FROM uc_cases WHERE id = $1::uuid`, [caseId])).catalog_revision);

  // The statements every need write appends (`cardSyncStatements`), run after the write in one transaction.
  const sync = () => cardSyncStatements({ workspaceId: ids.ws, useCaseIds: [ids.ucB], needId, actorUserId: ids.lead, readiness: null });
  await exec!.batch([{ text: `UPDATE use_case_needs SET status = 'mancante' WHERE id = $1::uuid`, params: [needId] }, ...sync()]);
  const now = await item();
  assert.equal(now.status, "mancante");
  assert.equal(now.validated_answer_id, null);
  assert.ok(String(now.status_reason).length > 0);
  assert.ok(Number((await one(`SELECT catalog_revision FROM uc_cases WHERE id = $1::uuid`, [caseId])).catalog_revision) > revision, "the readiness cache becomes stale");

  await exec!.batch([{ text: `UPDATE use_case_needs SET status = 'validata' WHERE id = $1::uuid`, params: [needId] }, ...sync()]);
  assert.equal((await item()).status, "validata");

  await exec!.batch([{ text: `UPDATE use_case_needs SET archived_at = now() WHERE id = $1::uuid`, params: [needId] }, ...sync()]);
  assert.notEqual((await item()).deleted_at, null, "archived needs stay out");
  await exec!.batch([{ text: `UPDATE use_case_needs SET archived_at = NULL WHERE id = $1::uuid`, params: [needId] }, ...sync()]);
  assert.equal((await item()).deleted_at, null);

  const later = await need(ids.ucB, "Informazione inventata aggiunta dopo", "chiesta", 20);
  await exec!.batch(cardSyncStatements({ workspaceId: ids.ws, useCaseIds: [ids.ucB], actorUserId: ids.lead, readiness: null }));
  const added = await one(`SELECT status FROM uc_items WHERE case_id = $1::uuid AND shared_item_id = $2::uuid`, [caseId, later]);
  assert.equal(added.status, "chiesta");

  // Nothing changed: no rows touched, no revision bump.
  const before = Number((await one(`SELECT catalog_revision FROM uc_cases WHERE id = $1::uuid`, [caseId])).catalog_revision);
  await exec!.batch(sync());
  assert.equal(Number((await one(`SELECT catalog_revision FROM uc_cases WHERE id = $1::uuid`, [caseId])).catalog_revision), before);
});

test("reschema to «Dal caso d'uso» keeps the dossier, project, packages and tasks (same ids) and is a no-op when repeated", opts, async () => {
  for (let k = 1; k <= 3; k++) await need(ids.ucC, `Informazione inventata C${k}`, k === 1 ? "validata" : "da_chiedere", k * 10);
  const caseId = await create(ids.ucC, `XX-${suffix}3`, sectorTemplateId);
  const project = await one(`INSERT INTO use_case_projects (use_case_id, workspace_id, version) VALUES ($1::uuid, $2::uuid, 1) RETURNING id`, [ids.ucC, ids.ws]);
  const pkg = await one(
    `INSERT INTO use_case_packages (use_case_id, workspace_id, version, content_hash, files, source) VALUES ($1::uuid, $2::uuid, 1, $3, '{"PACCHETTO.md":"inventato","BRIEF.md":"inventato","VERSIONE":"1"}'::jsonb, 'generato') RETURNING id`,
    [ids.ucC, ids.ws, "a".repeat(64)],
  );
  const task = await one(`INSERT INTO use_case_tasks (use_case_id, workspace_id, ref, title, source) VALUES ($1::uuid, $2::uuid, 'T-1', 'Compito inventato', 'progetto') RETURNING id`, [ids.ucC, ids.ws]);
  const before = await one(`SELECT code, title, template_id FROM uc_cases WHERE id = $1::uuid`, [caseId]);
  assert.ok(Number((await one(`SELECT count(*) AS n FROM uc_items WHERE case_id = $1::uuid`, [caseId])).n) > 10);

  const changed = await reschemaCase(exec!, { workspaceId: ids.ws, caseId, actorUserId: ids.lead, to: "dal_caso" });
  assert.ok(changed.ok, changed.ok ? "" : changed.message);
  assert.equal(changed.value.changed, true);
  const after = await one(`SELECT c.code, c.title, t.key FROM uc_cases c JOIN uc_templates t ON t.id = c.template_id WHERE c.id = $1::uuid`, [caseId]);
  assert.equal(after.code, before.code);
  assert.equal(after.title, before.title);
  assert.equal(after.key, FROM_USE_CASE_TEMPLATE.key);
  const items = await q(`SELECT status FROM uc_items WHERE case_id = $1::uuid`, [caseId]);
  assert.equal(items.length, 3);
  assert.equal(items.filter((i) => i.status === "validata").length, 1);
  assert.equal(Number((await one(`SELECT count(*) AS n FROM uc_maps WHERE case_id = $1::uuid`, [caseId])).n), 0);
  assert.equal(Number((await one(`SELECT count(*) AS n FROM uc_case_members WHERE case_id = $1::uuid`, [caseId])).n), 1, "members kept");
  assert.equal((await one(`SELECT id FROM use_case_projects WHERE use_case_id = $1::uuid`, [ids.ucC])).id, project.id);
  assert.equal((await one(`SELECT id FROM use_case_packages WHERE use_case_id = $1::uuid`, [ids.ucC])).id, pkg.id);
  assert.equal((await one(`SELECT id FROM use_case_tasks WHERE use_case_id = $1::uuid`, [ids.ucC])).id, task.id);
  const events = await q(`SELECT actor_type, actor_user_id, created_at FROM uc_events WHERE case_id = $1::uuid AND event_type = 'caso.schema_cambiato'`, [caseId]);
  assert.equal(events.length, 1);
  assert.equal(events[0].actor_user_id, ids.lead);

  const again = await reschemaCase(exec!, { workspaceId: ids.ws, caseId, actorUserId: ids.lead, to: "dal_caso" });
  assert.ok(again.ok);
  assert.equal(again.value.changed, false);
  assert.equal(Number((await one(`SELECT count(*) AS n FROM uc_events WHERE case_id = $1::uuid AND event_type = 'caso.schema_cambiato'`, [caseId])).n), 1);
  assert.equal((await q(`SELECT 1 FROM uc_items WHERE case_id = $1::uuid`, [caseId])).length, 3);
});

test("reschema is blocked and names the items with answers, files, requests or assignees", opts, async () => {
  const caseId = await create(ids.ucD, `XX-${suffix}4`, sectorTemplateId);
  const [first, second] = await q(`SELECT id, key FROM uc_items WHERE case_id = $1::uuid AND kind = 'domanda' ORDER BY sort_order LIMIT 2`, [caseId]);
  await q(`INSERT INTO uc_answers (case_id, item_id, version, kind, value, source_kind, responder_user_id) VALUES ($1::uuid, $2::uuid, 1, 'valore', '{"testo":"inventato"}'::jsonb, 'lateral_space', $3::uuid)`, [
    caseId,
    first.id,
    ids.lead,
  ]);
  await q(`UPDATE uc_items SET ls_owner_user_id = $2::uuid WHERE id = $1::uuid`, [second.id, ids.lead]);
  const plan = await planReschema(exec!, { workspaceId: ids.ws, caseId, to: "dal_caso" });
  assert.ok(plan.ok);
  const byKey = new Map(plan.value.blockers.map((b) => [b.key, b.reasons]));
  assert.deepEqual(byKey.get(String(first.key)), ["risposte"]);
  assert.deepEqual(byKey.get(String(second.key)), ["assegnazione"]);
  const refused = await reschemaCase(exec!, { workspaceId: ids.ws, caseId, actorUserId: ids.lead, to: "dal_caso" });
  assert.equal(refused.ok, false);
  assert.equal(refused.ok ? "" : refused.code, "bloccato");
  const key = await one(`SELECT t.key FROM uc_cases c JOIN uc_templates t ON t.id = c.template_id WHERE c.id = $1::uuid`, [caseId]);
  assert.notEqual(key.key, FROM_USE_CASE_TEMPLATE.key, "nothing written");
});

test("operator command `reschema`: the dry run prints the plan and writes nothing, --apply changes the schema", opts, async () => {
  await need(ids.ucD, "Informazione inventata per l'operatore", "parziale", 10);
  const altUc = randomUUID();
  await useCase(altUc, "Use case inventato per l'operatore");
  await need(altUc, "Informazione inventata dell'operatore", "chiesta", 10);
  const code = `XX-${suffix}5`;
  const caseId = await create(altUc, code, sectorTemplateId);
  const printed: unknown[] = [];
  const ctxFor = (apply: boolean, values: Record<string, string>): AdminContext =>
    ({
      command: "reschema",
      scope: { kind: "workspace", workspaceId: ids.ws },
      apply,
      value: (option: string) => values[option] ?? null,
      flag: () => false,
      db: {
        async read(text: string, params: readonly unknown[] = []) {
          const results = await sql!.transaction([sql!.query("SET TRANSACTION READ ONLY"), sql!.query(text, [...params])], { readOnly: true });
          return (results[1] ?? []) as AdminRow[];
        },
        async write(statements: readonly { text: string; params: readonly unknown[] }[]) {
          if (!apply) throw new Error("dry run must not write");
          if (statements.length === 0) return [];
          return (await sql!.transaction(statements.map((s) => sql!.query(s.text, [...s.params])))) as AdminRow[][];
        },
      },
      lsEmailDomains: null,
      hubWorkspaces: new Set([ids.ws]),
      featureEnv: {},
      readJsonFile: () => null,
      print: (output: unknown) => printed.push(output),
    }) as unknown as AdminContext;

  const dry = await reschemaCommand.run(ctxFor(false, { case: code, to: "dal_caso" }));
  assert.equal(dry.output.status, "DRY_RUN");
  const plans = dry.output.piani as { code: string; vociDopo: number; bloccano: unknown[] }[];
  assert.equal(plans[0].code, code);
  assert.equal(plans[0].vociDopo, 1);
  assert.deepEqual(plans[0].bloccano, []);
  assert.notEqual((await one(`SELECT t.key FROM uc_cases c JOIN uc_templates t ON t.id = c.template_id WHERE c.id = $1::uuid`, [caseId])).key, FROM_USE_CASE_TEMPLATE.key);

  await assert.rejects(() => reschemaCommand.run(ctxFor(true, { case: code, to: "dal_caso" })), /--actor/);
  const applied = await reschemaCommand.run(ctxFor(true, { case: code, to: "dal_caso", actor: ids.lead }));
  assert.equal(applied.output.status, "APPLIED", JSON.stringify(applied.output));
  assert.equal(printed.length, 1, "the plan is printed before writing");
  assert.equal((await one(`SELECT t.key FROM uc_cases c JOIN uc_templates t ON t.id = c.template_id WHERE c.id = $1::uuid`, [caseId])).key, FROM_USE_CASE_TEMPLATE.key);
  const again = await reschemaCommand.run(ctxFor(true, { case: code, to: "dal_caso", actor: ids.lead }));
  assert.deepEqual((again.output.risultati as { esito: string }[]).map((r) => r.esito), ["già_così"]);
});
