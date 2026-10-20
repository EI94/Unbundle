import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { addCaseMember, commandContextFor, createCase, loadCaseReadiness, loadUserContext, refreshReadinessCache, type UcCommandContext } from "../db/queries/uc-cases.ts";
import {
  listStartablePortfolioCards,
  loadCaseMembers,
  loadDescriptionData,
  loadMemberCandidates,
  loadProgressExtras,
  loadSignerDesignations,
  loadUsableCaseFiles,
  recordAuditExport,
  updateDescriptionBlock,
} from "../db/queries/uc-shell.ts";
import { loadActivityPage } from "../db/queries/uc-events.ts";
import { loadCaseHeader } from "../db/queries/uc-header.ts";
import { loadNextStepInput, loadNextStepInputs } from "../db/queries/uc-next-step.ts";
import { loadPendingSignatures, signatureSegment, toPendingSignatures } from "../db/queries/uc-signatures.ts";
import { isRequired } from "./gates.ts";
import { planTemplateLoad } from "./template/load.ts";
import { parseAuditFilter } from "./views/audit.ts";
import { descriptionVersions, stableJson } from "./views/description.ts";
import { caseNextSteps, nextStepFor } from "./views/next-step.ts";
import type { CaseRole, Perimeter, Phase, Priority } from "./vocab.ts";

// Opt-in integration suite for the WP8 read views (people, description, progress,
// the export event of Attività; Privacy and Attività themselves are in
// activity.integration.test.ts), on the isolated local harness only. Same guard as the
// other uc integration suites:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/shell.integration.test.ts
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

const LS_DOMAINS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  otherWs: randomUUID(),
  lead: randomUUID(),
  analyst: randomUUID(),
  owner: randomUUID(),
  privacy: randomUUID(),
  learner: randomUUID(),
  contact: randomUUID(),
  card: randomUUID(),
  cleanFile: randomUUID(),
  quarantinedFile: randomUUID(),
  personalFile: randomUUID(),
};
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state: { caseId: string; items: Map<string, string> } = { caseId: "", items: new Map() };

async function ctxFor(userId: string): Promise<UcCommandContext> {
  const r = await commandContextFor(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId, lsDomains: LS_DOMAINS });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

async function event(type: string, actor: { type: "utente"; userId: string } | { type: "referente" } | { type: "sistema" }, at: string, payload: Record<string, unknown> = {}) {
  await q(
    `INSERT INTO uc_events (workspace_id, case_id, actor_type, actor_user_id, actor_contact_id, event_type, payload, created_at)
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6, $7::jsonb, $8::timestamptz)`,
    [ids.ws, state.caseId, actor.type, actor.type === "utente" ? actor.userId : null, actor.type === "referente" ? ids.contact : null, type, JSON.stringify(payload), at],
  );
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova guscio', $2)`, [ids.org, `uc-shell-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova guscio'), ($2::uuid, $3::uuid, 'Altro guscio')`, [ids.ws, ids.otherWs, ids.org]);
  await q(
    `INSERT INTO users (id, email, email_verified, name) VALUES
       ($1::uuid, $6, now(), 'Lead di prova'), ($2::uuid, $7, now(), 'Analista di prova'), ($3::uuid, $8, now(), 'Owner di prova'),
       ($4::uuid, $9, now(), 'Privacy di prova'), ($5::uuid, $10, now(), 'Partecipante di prova')`,
    [
      ids.lead,
      ids.analyst,
      ids.owner,
      ids.privacy,
      ids.learner,
      `shell-lead-${suffix}@ls.test`,
      `shell-analista-${suffix}@ls.test`,
      `shell-owner-${suffix}@cliente.test`,
      `shell-privacy-${suffix}@cliente.test`,
      `shell-learner-${suffix}@cliente.test`,
    ],
  );
  await q(
    `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $5::uuid, 'transformation_lead'), ($2::uuid, $5::uuid, 'analyst'),
       ($3::uuid, $5::uuid, 'contributor'), ($4::uuid, $5::uuid, 'contributor')`,
    [ids.lead, ids.analyst, ids.owner, ids.privacy, ids.org],
  );
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'learner')`, [ids.ws, ids.learner]);
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.guscio_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const leadUser = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, { workspaceId: ids.ws, user: leadUser!, canReviewWorkspacePortfolio: true, input: { templateId: loaded.value.templateId, code: `GUSCIO-${suffix}`.toUpperCase(), title: "Caso del guscio" } });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  for (const r of await q(`SELECT id, key FROM uc_items WHERE case_id = $1::uuid`, [state.caseId])) state.items.set(String(r.key), String(r.id));
  const lead = await ctxFor(ids.lead);
  for (const [userId, role] of [
    [ids.analyst, "ls_analista"],
    [ids.owner, "owner_cliente"],
    [ids.privacy, "approvatore_privacy"],
    [ids.lead, "osservatore"],
  ] as const) {
    const r = await addCaseMember(exec!, lead, { userId, role });
    assert.ok(r.ok, r.ok ? "" : r.message);
  }
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email, template_role_key) VALUES ($1::uuid, $2::uuid, 'Referente del guscio', $3, 'resp_servizio')`, [
    ids.contact,
    ids.ws,
    `shell-ref-${suffix}@cliente.test`,
  ]);
  await q(`INSERT INTO use_cases (id, workspace_id, title, status) VALUES ($1::uuid, $2::uuid, 'Scheda accettata del guscio', 'accepted')`, [ids.card, ids.ws]);
  const sha = "a".repeat(64);
  await q(
    `INSERT INTO uc_files (id, workspace_id, case_id, file_name, mime, size_bytes, sha256, privacy_class, max_size_bytes, scan_status, content_scanned)
     VALUES ($1::uuid, $3::uuid, $4::uuid, 'verbale.pdf', 'application/pdf', 100, $5, 'nessuna', 1000, 'pulito', true),
            ($2::uuid, $3::uuid, $4::uuid, 'in-attesa.pdf', NULL, NULL, NULL, 'nessuna', 1000, 'in_quarantena', false)`,
    [ids.cleanFile, ids.quarantinedFile, ids.ws, state.caseId, sha],
  );
  await q(
    `INSERT INTO uc_files (id, workspace_id, case_id, item_id, file_name, mime, size_bytes, sha256, storage_zone, encryption_key_ref, privacy_class, max_size_bytes, scan_status, content_scanned)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'turni-nome-cognome.csv', 'text/csv', 50, $5, 'personale', 'UC_PERSONAL_ZONE_KEY/v1/hkdf', 'personale', 1000, 'pulito', true)`,
    [ids.personalFile, ids.ws, state.caseId, state.items.get("q.servizio.01"), sha],
  );
  await q(`INSERT INTO uc_milestones (case_id, key, title, planned_label, is_proposal, to_confirm, sort_order) VALUES ($1::uuid, 'fase_1', 'Specifiche', 'settimana 2', true, false, 1)`, [state.caseId]);

  // Registro: eventi di persone, del sistema e del referente, su più giorni.
  await event("caso.stato_cambiato", { type: "utente", userId: ids.lead }, "2026-10-01T08:00:00Z", { from: "bozza", to: "raccolta" });
  await event("link.aperto", { type: "utente", userId: ids.lead }, "2026-10-01T09:00:00Z");
  await event("informativa.vista", { type: "referente" }, "2026-10-01T09:05:00Z", { notice_version: "v1" });
  for (let n = 0; n < 5; n++) await event("risposta.inviata", { type: "referente" }, `2026-10-02T0${n}:10:00Z`, { item_key: "q.servizio.01", version: n + 1 });
  for (let n = 0; n < 2; n++) await event("risposta.inviata", { type: "referente" }, `2026-10-03T0${n}:10:00Z`, { item_key: "q.servizio.02", version: n + 1 });
  await event("risposta.letta_personale", { type: "utente", userId: ids.analyst }, "2026-10-04T10:00:00Z", { item_key: "q.servizio.01", version: 1 });
  await event("file.scaricato", { type: "utente", userId: ids.analyst }, "2026-10-04T11:00:00Z", { zona: "personale", mime: "text/csv" });
  await event("file.scaricato", { type: "utente", userId: ids.analyst }, "2026-10-04T11:30:00Z", { zona: "standard", mime: "application/pdf" });
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1::uuid, $2::uuid)`, [ids.ws, ids.otherWs]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)`, [ids.lead, ids.analyst, ids.owner, ids.privacy, ids.learner]);
});

test("members: one row per role, Lateral Space from the verified domain, nothing from another workspace", opts, async () => {
  const rows = await loadCaseMembers(exec!, { workspaceId: ids.ws, caseId: state.caseId, lsDomains: LS_DOMAINS });
  const byUser = (id: string) => rows.filter((r) => r.userId === id).map((r) => r.role).sort();
  assert.deepEqual(byUser(ids.lead), ["ls_lead", "osservatore"]);
  assert.deepEqual(byUser(ids.owner), ["owner_cliente"]);
  assert.equal(rows.find((r) => r.userId === ids.lead)?.isLateralSpace, true);
  assert.equal(rows.find((r) => r.userId === ids.owner)?.isLateralSpace, false);
  assert.deepEqual(await loadCaseMembers(exec!, { workspaceId: ids.otherWs, caseId: state.caseId, lsDomains: LS_DOMAINS }), []);
});

test("member candidates are the workspace collaborators, never course participants", opts, async () => {
  const c = await loadMemberCandidates(exec!, { workspaceId: ids.ws, lsDomains: LS_DOMAINS });
  const ours: string[] = [ids.lead, ids.analyst, ids.owner, ids.privacy, ids.learner];
  const mine = c.filter((x) => ours.includes(x.userId));
  assert.deepEqual(mine.map((x) => x.userId).sort(), [ids.lead, ids.analyst, ids.owner, ids.privacy].sort());
  assert.equal(mine.find((x) => x.userId === ids.analyst)?.isLateralSpace, true);
});

test("usable files for evidence: clean standard files only", opts, async () => {
  const files = await loadUsableCaseFiles(exec!, { workspaceId: ids.ws, caseId: state.caseId });
  assert.deepEqual(
    files.map((f) => f.id),
    [ids.cleanFile],
  );
  assert.deepEqual(await loadUsableCaseFiles(exec!, { workspaceId: ids.otherWs, caseId: state.caseId }), []);
});

test("description: one block changes, the others stay, history grows and a stale editor gets a conflict", opts, async () => {
  const before = await loadDescriptionData(exec!, { workspaceId: ids.ws, caseId: state.caseId });
  assert.ok(before);
  const lead = await ctxFor(ids.lead);
  const base = stableJson(before.description.uso_previsto ?? null);
  const r = await updateDescriptionBlock(exec!, lead, { block: "uso_previsto", value: "Lo usa il servizio clienti; decide sempre una persona.", base });
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.deepEqual(r.value.blocks, ["uso_previsto"]);
  const stale = await updateDescriptionBlock(exec!, lead, { block: "uso_previsto", value: "Altro testo", base });
  assert.equal(stale.ok, false);
  assert.equal(stale.ok ? "" : stale.code, "conflitto");
  const health = await updateDescriptionBlock(exec!, lead, { block: "problema", value: "Serve la visita medica dei piloti.", base: stableJson(before.description.problema ?? null) });
  assert.equal(health.ok, false, "the text scan still applies");
  const owner = await ctxFor(ids.owner);
  const denied = await updateDescriptionBlock(exec!, owner, { block: "problema", value: "Testo", base: stableJson(before.description.problema ?? null) });
  assert.equal(denied.ok, false);
  const after = await loadDescriptionData(exec!, { workspaceId: ids.ws, caseId: state.caseId });
  assert.ok(after);
  assert.equal(after.description.in_breve, before.description.in_breve);
  assert.equal(after.history.length, before.history.length + 1);
  const versions = descriptionVersions(after.description, after.history);
  assert.deepEqual(versions[0].changed, ["uso_previsto"]);
  assert.equal(after.authors.get(ids.lead), "Lead di prova");
});

test("progress extras: milestones, the G1 rule from the template and contact names", opts, async () => {
  const p = await loadProgressExtras(exec!, { workspaceId: ids.ws, caseId: state.caseId });
  assert.ok(p);
  assert.deepEqual(
    p.milestones.map((m) => [m.key, m.isProposal, m.done]),
    [["fase_1", true, false]],
  );
  assert.equal(p.gate.label, "Pronto per lo sviluppo");
  assert.deepEqual(p.gate.approvers, ["ls_lead", "owner_cliente"]);
  assert.equal(p.contactNames.get(ids.contact), "Referente del guscio");
  assert.equal(await loadProgressExtras(exec!, { workspaceId: ids.otherWs, caseId: state.caseId }).then((x) => x?.milestones.length ?? 0), 0);
});

test("audit export: one event with the format and the row count, only for a case of the workspace", opts, async () => {
  await recordAuditExport(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.owner, rows: 12 });
  const rows = await q(`SELECT actor_type, actor_user_id, target_type, payload FROM uc_events WHERE case_id = $1::uuid AND event_type = 'registro.esportato'`, [state.caseId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor_type, "utente");
  assert.equal(rows[0].actor_user_id, ids.owner);
  assert.deepEqual(rows[0].payload, { format: "csv", count: 12 });
  await assert.rejects(recordAuditExport(exec!, { workspaceId: ids.otherWs, caseId: state.caseId, userId: ids.owner, rows: 1 }));
  const after = await q(`SELECT count(*)::int AS n FROM uc_events WHERE case_id = $1::uuid AND event_type = 'registro.esportato'`, [state.caseId]);
  assert.equal(after[0].n, 1, "no event for a case of another workspace");
  const page = await loadActivityPage(exec!, { workspaceId: ids.ws, caseId: state.caseId, filter: parseAuditFilter({ tipo: "registro" }, true), clientView: true, lsDomains: [] });
  assert.deepEqual(page.rows.map((r) => r.type), ["registro.esportato"]);
});

test("signer designations come with the evidence file name, never a person", opts, async () => {
  assert.deepEqual(await loadSignerDesignations(exec!, { workspaceId: ids.ws, caseId: state.caseId }), {});
  await q(`UPDATE uc_cases SET signers_designation = $1::jsonb WHERE id = $2::uuid`, [
    JSON.stringify({ owner: { contact_id: ids.contact, evidence_file_id: ids.cleanFile, designated_by_user_id: ids.lead, at: "2026-10-05T08:00:00.000Z" }, altro: { contact_id: ids.contact } }),
    state.caseId,
  ]);
  const d = await loadSignerDesignations(exec!, { workspaceId: ids.ws, caseId: state.caseId });
  assert.deepEqual(d, { owner: { contactId: ids.contact, evidenceFileId: ids.cleanFile, evidenceFileName: "verbale.pdf", at: "2026-10-05T08:00:00.000Z" } });
  assert.deepEqual(await loadSignerDesignations(exec!, { workspaceId: ids.otherWs, caseId: state.caseId }), {});
  await q(`UPDATE uc_cases SET signers_designation = '{}'::jsonb WHERE id = $1::uuid`, [state.caseId]);
});

test("accepted portfolio cards without a case can start one", opts, async () => {
  const cards = await listStartablePortfolioCards(exec!, ids.ws);
  assert.deepEqual(
    cards.map((c) => c.id),
    [ids.card],
  );
  await q(`UPDATE uc_cases SET portfolio_use_case_id = $1::uuid WHERE id = $2::uuid`, [ids.card, state.caseId]);
  assert.deepEqual(await listStartablePortfolioCards(exec!, ids.ws), []);
});

// ── Testata, prossimo passo e firme (WP1) ─────────────────────────────

/** Esecutore che conta i giri: la testata ne fa uno solo (DESIGN §3.3). */
function countingExecutor(): { executor: UcExecutor; calls: () => number } {
  let calls = 0;
  return {
    executor: {
      batch(statements) {
        calls++;
        return exec!.batch(statements);
      },
    },
    calls: () => calls,
  };
}

async function hasUseCaseCode(): Promise<boolean> {
  const r = await q(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'use_cases' AND column_name = 'code'`);
  return r.length > 0;
}

test("header: one round-trip with the cached readiness, the parent card and its code read with to_jsonb", opts, async () => {
  await q(`UPDATE uc_cases SET portfolio_use_case_id = NULL WHERE id = $1::uuid`, [state.caseId]);
  const counted = countingExecutor();
  const started = performance.now();
  const head = await loadCaseHeader(counted.executor, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.lead, roles: ["ls_lead"] });
  console.log(`[uc] header: ${counted.calls()} round-trip, ${Math.round(performance.now() - started)} ms`);
  assert.equal(counted.calls(), 1, "one batch, one round-trip");
  assert.ok(head);
  assert.equal(head.case.title, "Caso del guscio");
  assert.equal(head.parent, null, "without a parent card the trail keeps «‹ Casi d'uso»");
  const [cached] = await q(`SELECT readiness FROM uc_cases WHERE id = $1::uuid`, [state.caseId]);
  const readiness = cached.readiness as { G1: { ok: number; required: number } };
  assert.deepEqual({ ok: head.progress?.ok, required: head.progress?.required }, { ok: readiness.G1.ok, required: readiness.G1.required }, "progress from the cache");

  await q(`UPDATE uc_cases SET portfolio_use_case_id = $1::uuid WHERE id = $2::uuid`, [ids.card, state.caseId]);
  const linked = await loadCaseHeader(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.lead, roles: ["ls_lead"] });
  assert.equal(linked?.parent?.id, ids.card);
  assert.equal(linked?.parent?.title, "Scheda accettata del guscio");
  if (await hasUseCaseCode()) {
    await q(`UPDATE use_cases SET code = 'GU-0001' WHERE id = $1::uuid`, [ids.card]);
    const withCode = await loadCaseHeader(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.lead, roles: ["ls_lead"] });
    assert.equal(withCode?.parent?.code, "GU-0001");
    await q(`UPDATE use_cases SET code = NULL WHERE id = $1::uuid`, [ids.card]);
  } else {
    assert.equal(linked?.parent?.code, null, "no code column before 0019: NULL, and the query still works");
  }
  assert.equal(await loadCaseHeader(exec!, { workspaceId: ids.otherWs, caseId: state.caseId, userId: ids.lead, roles: ["ls_lead"] }), null, "never across workspaces");

  // An URL with the uuid in upper case opens the same dossier.
  const upper = await loadCaseHeader(exec!, { workspaceId: ids.ws.toUpperCase(), caseId: state.caseId.toUpperCase(), userId: ids.lead.toUpperCase(), roles: ["ls_lead"] });
  assert.equal(upper?.case.id, state.caseId);
  assert.ok(await loadNextStepInput(exec!, { workspaceId: ids.ws, caseId: state.caseId.toUpperCase(), userId: ids.lead, roles: ["ls_lead"] }));
  const bulkUpper = await loadNextStepInputs(exec!, { workspaceId: ids.ws, caseIds: [state.caseId.toUpperCase()], userId: ids.lead, rolesByCase: new Map([[state.caseId.toUpperCase(), ["ls_lead"] as CaseRole[]]]) });
  assert.deepEqual([...bulkUpper.keys()], [state.caseId]);
});

test("header: right after a command the cache is behind, so the header reads the readiness live", opts, async () => {
  await refreshReadinessCache(exec!, ids.ws, state.caseId);
  const fresh = countingExecutor();
  const before = await loadCaseHeader(fresh.executor, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.lead, roles: ["ls_lead"] });
  assert.equal(fresh.calls(), 1, "a current cache: one round-trip");
  assert.ok(before?.progress);

  // What a command does: the catalog changes and catalog_revision goes up; the cache is refreshed only in after().
  const rows = await q(
    `SELECT id, in_gate_scope AS "inGateScope", priority, perimeter, serves_for AS "servesFor" FROM uc_items WHERE case_id = $1::uuid AND deleted_at IS NULL ORDER BY key`,
    [state.caseId],
  );
  const must = rows.find((r) =>
    isRequired({ inGateScope: r.inGateScope === true, priority: r.priority as Priority | null, perimeter: r.perimeter as Perimeter | null, servesFor: (r.servesFor as Phase[] | null) ?? [] }, "G1"),
  );
  assert.ok(must, "the example template has an indispensable question");
  await q(`UPDATE uc_items SET priority = 'should' WHERE id = $1::uuid`, [must.id]);
  await q(`UPDATE uc_cases SET catalog_revision = catalog_revision + 1 WHERE id = $1::uuid`, [state.caseId]);
  try {
    const stale = countingExecutor();
    const head = await loadCaseHeader(stale.executor, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.lead, roles: ["ls_lead"] });
    assert.equal(stale.calls(), 2, "the cache is behind: one more round-trip for the live readiness");
    const live = await loadCaseReadiness(exec!, ids.ws, state.caseId);
    assert.equal(head?.progress?.required, before.progress.required - 1, "the new count, not the one of the previous command");
    assert.deepEqual({ ok: head?.progress?.ok, required: head?.progress?.required }, { ok: live?.readiness.G1.ok, required: live?.readiness.G1.required });
    assert.equal(head?.nextStep.g1.required, live?.readiness.G1.required, "the engine reads the same numbers");
    assert.equal(head?.nextStep.g1.ready, live?.readiness.G1.ready);
    assert.equal(head?.readiness?.catalog_revision, live?.readiness.catalog_revision);

    await refreshReadinessCache(exec!, ids.ws, state.caseId);
    const after = countingExecutor();
    const refreshed = await loadCaseHeader(after.executor, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.lead, roles: ["ls_lead"] });
    assert.equal(after.calls(), 1, "once after() has refreshed the cache, one round-trip again");
    assert.equal(refreshed?.progress?.required, head?.progress?.required);
  } finally {
    await q(`UPDATE uc_items SET priority = 'must' WHERE id = $1::uuid`, [must.id]);
    await q(`UPDATE uc_cases SET catalog_revision = catalog_revision + 1 WHERE id = $1::uuid`, [state.caseId]);
    await refreshReadinessCache(exec!, ids.ws, state.caseId);
  }
});

test("next step input: counts of the indispensable questions, four eyes and the engine's first step", opts, async () => {
  const rows = await q(
    `SELECT id, key, status, in_gate_scope AS "inGateScope", priority, perimeter, serves_for AS "servesFor", assignee_contact_id AS assignee
     FROM uc_items WHERE case_id = $1::uuid AND deleted_at IS NULL`,
    [state.caseId],
  );
  const required = rows.filter((r) =>
    isRequired({ inGateScope: r.inGateScope === true, priority: r.priority as Priority | null, perimeter: r.perimeter as Perimeter | null, servesFor: (r.servesFor as Phase[] | null) ?? [] }, "G1"),
  );
  assert.ok(required.length > 0, "the example template has indispensable questions");
  const input = await loadNextStepInput(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.lead, roles: ["ls_lead"] });
  assert.ok(input);
  assert.equal(input.unsentMust, required.filter((r) => r.status === "da_chiedere").length);
  assert.equal(input.unassignedMust, required.filter((r) => r.status === "da_chiedere" && r.assignee === null).length);
  assert.equal(input.g1.byGroup.a_posto, required.filter((r) => r.status === "validata" || r.status === "non_applicabile").length);
  assert.equal(input.toVerifyForMe, 0);

  // An answer of the analyst waiting for a check: the lead verifies it, the analyst does not (four eyes).
  const itemId = state.items.get("q.servizio.02")!;
  const answerId = randomUUID();
  await q(
    `INSERT INTO uc_answers (id, case_id, item_id, version, kind, value, source_kind, responder_user_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'valore', '"Telefono ed email"'::jsonb, 'lateral_space', $4::uuid)`,
    [answerId, state.caseId, itemId, ids.analyst],
  );
  await q(`UPDATE uc_items SET status = 'in_verifica', current_answer_id = $1::uuid WHERE id = $2::uuid`, [answerId, itemId]);
  const forLead = await loadNextStepInput(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.lead, roles: ["ls_lead"] });
  const forAnalyst = await loadNextStepInput(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.analyst, roles: ["ls_analista"] });
  assert.equal(forLead?.toVerifyForMe, 1);
  assert.equal(forLead?.toVerifyTotal, 1);
  assert.ok(forLead?.oldestToVerifyAt instanceof Date);
  assert.equal(forAnalyst?.toVerifyForMe, 0, "the analyst answered: someone else verifies");
  assert.equal(forAnalyst?.toVerifyTotal, 1);
  const isMust = required.some((r) => r.id === itemId);
  assert.equal(forLead?.toVerifyMust, isMust ? 1 : 0);
  assert.equal(forLead?.g1.byGroup.da_verificare, isMust ? 1 : 0);
  assert.ok(!caseNextSteps(forAnalyst!, { roles: ["ls_analista"] }).some((s) => s.id === "verifica"), "nothing for the analyst to verify");
  assert.ok(caseNextSteps(forLead!, { roles: ["ls_lead"] }).some((s) => s.id === "verifica" && s.owner === "me"));

  // The bulk read gives the same input, in one round-trip, and skips other workspaces.
  const counted = countingExecutor();
  const bulk = await loadNextStepInputs(counted.executor, {
    workspaceId: ids.ws,
    caseIds: [state.caseId, randomUUID()],
    userId: ids.lead,
    rolesByCase: new Map([[state.caseId, ["ls_lead"] as CaseRole[]]]),
  });
  assert.equal(counted.calls(), 1);
  assert.deepEqual([...bulk.keys()], [state.caseId]);
  assert.equal(bulk.get(state.caseId)?.toVerifyForMe, 1);
  assert.equal((await loadNextStepInputs(exec!, { workspaceId: ids.otherWs, caseIds: [state.caseId], userId: ids.lead, rolesByCase: new Map() })).size, 0);
  assert.equal(await loadNextStepInput(exec!, { workspaceId: ids.otherWs, caseId: state.caseId, userId: ids.lead, roles: ["ls_lead"] }), null);

  // A partial answer is «Da fare» (DESIGN §2.6, «Risposta parziale»), not «Da verificare»: «Verifica N risposte» does not count it.
  const partial = required.find((r) => r.id !== itemId && r.status === "da_chiedere");
  assert.ok(partial, "another indispensable question to answer partially");
  const partialAnswer = randomUUID();
  await q(
    `INSERT INTO uc_answers (id, case_id, item_id, version, kind, value, source_kind, responder_user_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'valore', '"Solo il telefono"'::jsonb, 'lateral_space', $4::uuid)`,
    [partialAnswer, state.caseId, partial.id, ids.analyst],
  );
  await q(`UPDATE uc_items SET status = 'parziale', current_answer_id = $1::uuid WHERE id = $2::uuid`, [partialAnswer, partial.id]);
  try {
    const withPartial = await loadNextStepInput(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.lead, roles: ["ls_lead"] });
    assert.equal(withPartial?.toVerifyForMe, 1, "only the answer in verification");
    assert.equal(withPartial?.toVerifyTotal, 1);
    assert.equal(withPartial?.toVerifyMust, forLead?.toVerifyMust);
    assert.equal(withPartial?.g1.byGroup.da_verificare, forLead?.g1.byGroup.da_verificare);
    assert.equal(withPartial?.g1.byGroup.da_fare, forLead?.g1.byGroup.da_fare, "still to do, now to complete");
  } finally {
    await q(`UPDATE uc_items SET status = 'da_chiedere', current_answer_id = NULL WHERE id = $1::uuid`, [partial.id]);
  }
});

test("pending signatures: each side sees only what still misses its own signature, with titles and no keys", opts, async () => {
  const itemId = state.items.get("q.servizio.03")!;
  await q(`UPDATE uc_items SET na_reason = 'Il servizio non lo usa', na_proposed_at = now(), na_proposed_by_user_id = $1::uuid WHERE id = $2::uuid`, [ids.analyst, itemId]);
  const lead = await loadPendingSignatures(exec!, { workspaceId: ids.ws, caseId: state.caseId, roles: ["ls_lead"] });
  const owner = await loadPendingSignatures(exec!, { workspaceId: ids.ws, caseId: state.caseId, roles: ["owner_cliente"] });
  assert.deepEqual(
    lead.map((s) => [s.kind, s.side, s.otherSideSigned, s.itemId]),
    [["non_si_applica", "ls", false, itemId]],
  );
  assert.deepEqual(
    owner.map((s) => [s.kind, s.side, s.otherSideSigned]),
    [["non_si_applica", "cliente", false]],
  );
  assert.ok(!/q\.servizio/.test(lead[0].title), "titles, never keys");
  assert.equal(signatureSegment(lead[0]), `domande/${itemId}`);

  await q(`UPDATE uc_items SET na_approved_by_user_id = $1::uuid WHERE id = $2::uuid`, [ids.lead, itemId]);
  assert.deepEqual(await loadPendingSignatures(exec!, { workspaceId: ids.ws, caseId: state.caseId, roles: ["ls_lead"] }), []);
  const ownerAfter = await loadPendingSignatures(exec!, { workspaceId: ids.ws, caseId: state.caseId, roles: ["owner_cliente"] });
  assert.equal(ownerAfter[0]?.otherSideSigned, true, "«Lateral Space ha già firmato»");
  assert.deepEqual(toPendingSignatures(ownerAfter), [{ kind: "altro", otherSideSigned: true }]);

  // A personal zone access waits only for the privacy approver.
  await q(`UPDATE uc_case_members SET personal_zone_grant = $1::jsonb WHERE case_id = $2::uuid AND user_id = $3::uuid AND role = 'ls_analista'`, [
    JSON.stringify({ beneficiary_user_id: ids.analyst, proposed_by_user_id: ids.lead, at: "2026-10-05T08:00:00.000Z", approvals: [] }),
    state.caseId,
    ids.analyst,
  ]);
  const privacy = await loadPendingSignatures(exec!, { workspaceId: ids.ws, caseId: state.caseId, roles: ["approvatore_privacy"] });
  assert.deepEqual(
    privacy.map((s) => [s.kind, s.title]),
    [["zona_personale", "Accesso ai dati personali: Analista di prova"]],
  );
  assert.equal(signatureSegment(privacy[0]), "privacy");
  assert.ok(!(await loadPendingSignatures(exec!, { workspaceId: ids.ws, caseId: state.caseId, roles: ["ls_lead"] })).some((s) => s.kind === "zona_personale"));
  assert.deepEqual(await loadPendingSignatures(exec!, { workspaceId: ids.otherWs, caseId: state.caseId, roles: ["owner_cliente"] }), [], "never across workspaces");

  // The header carries the same list for the menu and the engine (rule 4).
  const head = await loadCaseHeader(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.owner, roles: ["owner_cliente"] });
  assert.equal(head?.signatures.length, 1);
  assert.equal(head?.nextStep.mySignaturesPending.length, 1);
  assert.equal(nextStepFor(caseNextSteps(head!.nextStep, { roles: ["owner_cliente"] }))?.id, "firma");

  await q(`UPDATE uc_case_members SET personal_zone_grant = NULL WHERE case_id = $1::uuid`, [state.caseId]);
  await q(`UPDATE uc_items SET na_reason = NULL, na_proposed_at = NULL, na_proposed_by_user_id = NULL, na_approved_by_user_id = NULL WHERE id = $1::uuid`, [itemId]);
});
