import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { commandContextFor, createCase, loadUserContext, runCommand, type UcCommandContext } from "../db/queries/uc-cases.ts";
import { loadExportSnapshot, recordCatalogExport } from "../db/queries/uc-export.ts";
import { importTestCases, TEST_CASES_MESSAGES } from "../db/queries/uc-test-cases.ts";
import { exportAllowed } from "./export/request.ts";
import { snapshotHash } from "./snapshot.ts";
import { testCasesImportStatements } from "./sql/test-cases.ts";
import { planTemplateLoad } from "./template/load.ts";

// Opt-in integration suite for WP12b (catalog export, test cases import), on the
// isolated local harness only. Same guard as commands.integration.test.ts:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/export.integration.test.ts
// Never in parallel with database.integration.test.ts (it narrows a vocabulary CHECK on purpose).
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
const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0];

const LS_DOMAINS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), lead: randomUUID(), analyst: randomUUID() };
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state = { caseId: "", code: "" };

async function ctxFor(userId: string): Promise<UcCommandContext> {
  const r = await commandContextFor(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId, lsDomains: LS_DOMAINS });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova export', $2)`, [ids.org, `uc-exp-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova export')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $3, now()), ($2::uuid, $4, now())`, [
    ids.lead,
    ids.analyst,
    `exp-lead-${suffix}@ls.test`,
    `exp-analista-${suffix}@ls.test`,
  ]);
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $3::uuid, 'transformation_lead'), ($2::uuid, $3::uuid, 'analyst')`, [
    ids.lead,
    ids.analyst,
    ids.org,
  ]);
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.export_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const leadCtx = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, {
    workspaceId: ids.ws,
    user: leadCtx!,
    canReviewWorkspacePortfolio: true,
    input: { templateId: loaded.value.templateId, code: `exp-${suffix}`, title: "Caso dell'export" },
  });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  state.code = created.value.code;
  await q(`INSERT INTO uc_case_members (case_id, user_id, role, added_by_user_id) VALUES ($1::uuid, $2::uuid, 'ls_analista', $3::uuid)`, [
    state.caseId,
    ids.analyst,
    ids.lead,
  ]);
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, [ids.lead, ids.analyst]);
});

const cases = (atteso2 = "Strategia B") =>
  JSON.stringify([
    { key: "caso.sintetico.01", input: { richiesta: "Due persone, sabato" }, expected: { atteso: "Strategia A", regole: ["rule.servizio.urgenti_prima"] }, covers: ["dato mancante"] },
    { key: "caso.sintetico.02", input: "Richiesta in testo", atteso: atteso2, serve_per: ["backtest"] },
  ]);

test("test cases import: insert, unchanged re-import, update resets result and approval, one event each", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const first = await importTestCases(exec!, lead, { text: cases() });
  assert.ok(first.ok, first.ok ? "" : JSON.stringify(first));
  assert.deepEqual([first.value.inserted, first.value.updated, first.value.unchanged], [2, 0, 0]);

  const again = await importTestCases(exec!, lead, { text: cases() });
  assert.ok(again.ok);
  assert.deepEqual([again.value.inserted, again.value.updated, again.value.unchanged], [0, 0, 2]);

  await q(`UPDATE uc_test_cases SET last_result = 'superato', approved_at = now() WHERE case_id = $1::uuid AND key = 'caso.sintetico.02'`, [state.caseId]);
  const changed = await importTestCases(exec!, lead, { text: cases("Strategia C") });
  assert.ok(changed.ok);
  assert.deepEqual([changed.value.inserted, changed.value.updated, changed.value.unchanged], [0, 1, 1]);
  const row = await one(`SELECT kind, expected, last_result, approved_at, created_by_user_id FROM uc_test_cases WHERE case_id = $1::uuid AND key = 'caso.sintetico.02'`, [
    state.caseId,
  ]);
  assert.deepEqual(row.expected, { atteso: "Strategia C", regole: [] });
  assert.equal(row.last_result, "non_eseguito");
  assert.equal(row.approved_at, null);
  assert.equal(row.created_by_user_id, ids.lead);

  const events = await q(`SELECT payload, actor_user_id, target_id FROM uc_events WHERE case_id = $1::uuid AND event_type = 'casi_prova.importati' ORDER BY created_at`, [state.caseId]);
  assert.deepEqual(
    events.map((e) => e.payload),
    [
      { count: 2, format: "json", counts: { nuovi: 2, aggiornati: 0, invariati: 0 } },
      { count: 2, format: "json", counts: { nuovi: 0, aggiornati: 0, invariati: 2 } },
      { count: 2, format: "json", counts: { nuovi: 0, aggiornati: 1, invariati: 1 } },
    ],
  );
  assert.ok(events.every((e) => e.actor_user_id === ids.lead && e.target_id === state.caseId));
  assert.ok(!JSON.stringify(events).includes("Strategia"));
});

test("test cases import: refusals leave nothing behind", opts, async () => {
  const before = Number((await one(`SELECT count(*)::int AS n FROM uc_test_cases WHERE case_id = $1::uuid`, [state.caseId])).n);
  const analyst = await importTestCases(exec!, await ctxFor(ids.analyst), { text: cases() });
  assert.equal(analyst.ok ? "" : analyst.code, "attore_non_ammesso");

  const lead = await ctxFor(ids.lead);
  const pseudo = await importTestCases(exec!, lead, { text: JSON.stringify([{ key: "caso.reale.01", kind: "pseudonimizzato", input: { a: 1 }, atteso: "x" }]) });
  assert.equal(pseudo.ok ? "" : pseudo.code, "casi_prova_non_validi");
  assert.equal(pseudo.ok ? "" : pseudo.errors?.[0]?.code, "a8_non_sciolto");

  // The A.8 guard holds in the database too, even if the parser were bypassed.
  const bypass = await runCommand(
    exec!,
    testCasesImportStatements({
      workspaceId: ids.ws,
      caseId: state.caseId,
      actorUserId: ids.lead,
      rows: [{ key: "caso.reale.02", kind: "pseudonimizzato", input: { a: 1 }, expected: { atteso: "x", regole: [] }, covers: [], serve_per: [] }],
      format: "json",
    }),
    TEST_CASES_MESSAGES,
  );
  assert.equal(bypass.ok ? "" : bypass.code, "a8_non_sciolto");

  const health = await importTestCases(exec!, lead, { text: JSON.stringify([{ key: "caso.03", input: { nota: "il pilota ha la visita medica scaduta" }, atteso: "x" }]) });
  assert.equal(health.ok ? "" : health.code, "casi_prova_non_validi");
  assert.ok(!JSON.stringify(health).includes("visita medica"));

  const after = Number((await one(`SELECT count(*)::int AS n FROM uc_test_cases WHERE case_id = $1::uuid`, [state.caseId])).n);
  assert.equal(after, before);
});

test("export: live draft, then frozen versions by number, never another workspace, and an audit event", opts, async () => {
  const item = await one(`SELECT id FROM uc_items WHERE case_id = $1::uuid AND key = 'q.servizio.01'`, [state.caseId]);
  const answerId = randomUUID();
  await q(
    `INSERT INTO uc_answers (id, case_id, item_id, version, kind, value, source_kind, source_ref) VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'valore', '{"text":"Valore di prova"}', 'lateral_space', 'documento di prova')`,
    [answerId, state.caseId, item.id],
  );
  await q(`UPDATE uc_items SET current_answer_id = $1::uuid, status = 'in_verifica' WHERE id = $2::uuid`, [answerId, item.id]);

  const none = await loadExportSnapshot(exec!, { workspaceId: ids.ws, caseId: state.caseId, version: { kind: "ultima" } });
  assert.equal(none.ok ? "" : none.code, "nessuna_versione");

  const draft = await loadExportSnapshot(exec!, { workspaceId: ids.ws, caseId: state.caseId, version: { kind: "bozza" } });
  assert.ok(draft.ok, draft.ok ? "" : draft.message);
  const count = Number((await one(`SELECT count(*)::int AS n FROM uc_items WHERE case_id = $1::uuid AND deleted_at IS NULL`, [state.caseId])).n);
  assert.equal(draft.value.items.length, count);
  assert.equal(draft.value.version, "bozza");
  const answered = draft.value.items.find((i) => i.key === "q.servizio.01");
  assert.deepEqual(answered?.answer?.value, { text: "Valore di prova" });
  assert.equal(answered?.answer?.validated, false);
  assert.equal(draft.value.gate?.key, "G1");

  const frozen = { ...draft.value, version: 1, frozen_at: new Date().toISOString() };
  await q(
    `INSERT INTO uc_catalog_versions (case_id, version, reason, diff, snapshot, snapshot_hash, approved_by) VALUES ($1::uuid, 1, 'gate', '{}', $2::jsonb, $3, '[]')`,
    [state.caseId, JSON.stringify(frozen), snapshotHash(frozen as never)],
  );
  const latest = await loadExportSnapshot(exec!, { workspaceId: ids.ws, caseId: state.caseId, version: { kind: "ultima" } });
  assert.ok(latest.ok, latest.ok ? "" : latest.message);
  assert.equal(latest.value.version, 1);
  const v2 = await loadExportSnapshot(exec!, { workspaceId: ids.ws, caseId: state.caseId, version: { kind: "numero", version: 2 } });
  assert.equal(v2.ok ? "" : v2.code, "versione_assente");
  const otherWorkspace = await loadExportSnapshot(exec!, { workspaceId: randomUUID(), caseId: state.caseId, version: { kind: "ultima" } });
  assert.equal(otherWorkspace.ok, false);

  await recordCatalogExport(exec!, { workspaceId: ids.ws, caseId: state.caseId, actor: { type: "utente", userId: ids.lead }, format: "md", version: 1 });
  const event = await one(`SELECT payload, target_type FROM uc_events WHERE case_id = $1::uuid AND event_type = 'catalogo.esportato' ORDER BY created_at DESC LIMIT 1`, [state.caseId]);
  assert.deepEqual(event.payload, { format: "md", version: 1 });
  assert.equal(event.target_type, "catalogo");
});

test("export per role: the client lead's draft exists only before the via, checked in the same round-trip as the items", opts, async () => {
  const draft = { kind: "bozza" } as const;
  const read = (over: Partial<Parameters<typeof loadExportSnapshot>[1]> = {}) =>
    loadExportSnapshot(exec!, { workspaceId: ids.ws, caseId: state.caseId, version: draft, requireBeforeVia: true, ...over });
  await q(`UPDATE uc_cases SET catalog_version = 0 WHERE id = $1::uuid`, [state.caseId]);
  assert.equal(exportAllowed(["owner_cliente"], draft, 0).ok, true);
  const before = await read();
  assert.ok(before.ok, before.ok ? "" : before.message);
  assert.equal(before.value.version, "bozza");

  // The via freezes version 1 (the snapshot row exists from the previous test): the draft is Lateral Space's again.
  await q(`UPDATE uc_cases SET catalog_version = 1 WHERE id = $1::uuid`, [state.caseId]);
  const after = await read();
  assert.equal(after.ok ? "" : after.code, "bozza_non_ammessa");
  assert.equal(after.ok ? "" : after.message, "Dopo il via allo sviluppo si scarica il catalogo validato.");
  const lateralSpace = await read({ requireBeforeVia: false });
  assert.ok(lateralSpace.ok, "Lateral Space keeps the draft after the via");
  assert.equal(exportAllowed(["owner_cliente"], { kind: "ultima" }, 1).ok, true);

  for (const other of [{ workspaceId: randomUUID() }, { caseId: randomUUID() }, { caseId: "not-a-uuid" }]) {
    const r = await read(other);
    assert.equal(r.ok ? "" : r.code, "non_trovato");
  }
});