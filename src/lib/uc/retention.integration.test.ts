import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { createCase, loadUserContext } from "../db/queries/uc-cases.ts";
import { dispatchAcrossWorkspaces, runFreshnessCron } from "../db/queries/uc-cron.ts";
import { dispatchQueue } from "../db/queries/uc-notifications-dispatch.ts";
import { anonymizeContactAsOperator, expireRetainedFiles, forgetPersonalFiles, loadPersonalFilesPlan, loadPurgePlan, purgeCase } from "../db/queries/uc-retention.ts";
import { buildCaseTokenScopes } from "./mcp-access.ts";
import { ucBlobPath } from "./files/filename.ts";
import type { DispatchSummary, UcMailer } from "./notify/dispatch.ts";
import { ucStore } from "./storage.ts";
import { planTemplateLoad } from "./template/load.ts";

// Opt-in integration suite for retention and case deletion (DESIGN §7.1 P0-8), on the
// isolated local harness only, with the same guard as the other uc suites:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/retention.integration.test.ts
// Files go to a temporary local folder (UC_LOCAL_STORAGE_DIR), never to a real store. Invented content only.
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
const hex64 = () => randomBytes(32).toString("hex");

const LS_DOMAINS = ["ls.test"];
const storeDir = mkdtempSync(join(tmpdir(), "uc-retention-it-"));
const ENV = { UC_LOCAL_STORAGE_DIR: storeDir };
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), lead: randomUUID(), token: randomUUID() };
// Referents of the workspace (invented): only in this case, only in its audit, also in another case, in no case.
const contacts = { only: randomUUID(), audit: randomUUID(), shared: randomUUID(), unrelated: randomUUID() };
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state = { caseId: "", code: "", otherCaseId: "", files: { standard: "", personal: "", quarantined: "", proof: "", orphanPath: "" } };

/** Objects under the case prefixes of the local store, both zones. */
function caseObjects(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (full.includes(state.caseId)) out.push(full);
    }
  };
  walk(storeDir);
  return out;
}

async function insertFile(zone: "standard" | "personale", opts2: { quarantine?: boolean } = {}): Promise<{ id: string; path: string }> {
  const id = randomUUID();
  const area = opts2.quarantine ? "quarantena" : zone === "personale" ? "personale" : "standard";
  const path = ucBlobPath(area, ids.ws, state.caseId, id);
  await ucStore(zone === "personale" ? "personale" : "standard", ENV)!.put(path, new Uint8Array(Buffer.from(`contenuto inventato ${id}`)));
  await q(
    `INSERT INTO uc_files (id, workspace_id, case_id, file_name, mime, size_bytes, sha256, storage_zone, blob_path, quarantine_path, encryption_key_ref,
       privacy_class, max_size_bytes, scan_status, content_scanned)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'prova.csv', 'text/csv', 10, $4, $5, $6, $7, $8, $9, 1000, $10, $11)`,
    [
      id,
      ids.ws,
      state.caseId,
      hex64(),
      zone,
      opts2.quarantine ? null : path,
      opts2.quarantine ? path : null,
      zone === "personale" ? "kek:1" : null,
      zone === "personale" ? "personale" : "riservato_azienda",
      opts2.quarantine ? "in_quarantena" : "pulito",
      !opts2.quarantine,
    ],
  );
  return { id, path };
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova conservazione', $2)`, [ids.org, `uc-ret-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova conservazione')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $2, now())`, [ids.lead, `ret-lead-${suffix}@ls.test`]);
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $2::uuid, 'transformation_lead')`, [ids.lead, ids.org]);
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.conservazione_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const leadCtx = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, {
    workspaceId: ids.ws,
    user: leadCtx!,
    canReviewWorkspacePortfolio: true,
    input: { templateId: loaded.value.templateId, code: `ret-${suffix}`, title: "Caso per la conservazione" },
  });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  state.code = created.value.code;

  state.files.standard = (await insertFile("standard")).id;
  state.files.personal = (await insertFile("personale")).id;
  state.files.quarantined = (await insertFile("standard", { quarantine: true })).id;
  state.files.proof = (await insertFile("standard")).id;
  // A written proof of the case: it stays until the case is deleted.
  await q(
    `INSERT INTO uc_gate_reviews (case_id, gate_key, computed, catalog_revision, summary_text_hash, written_evidence_file_id) VALUES ($1::uuid, 'G1', '{}', 0, $2, $3::uuid)`,
    [state.caseId, hex64(), state.files.proof],
  );
  // An object with no row (an upload that never registered): only the purge finds it, by prefix.
  state.files.orphanPath = ucBlobPath("standard", ids.ws, state.caseId, randomUUID());
  await ucStore("standard", ENV)!.put(state.files.orphanPath, new Uint8Array(Buffer.from("orfano inventato")));

  // Referents: one assigned only here (with a queued workspace email), one only in this case's audit,
  // one also owner of a second case of the workspace, one in no case.
  for (const [key, id] of Object.entries(contacts)) {
    await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, role_label, email, phone_e164) VALUES ($1::uuid, $2::uuid, $3, 'Referente dati', $4, '+390000000000')`, [
      id,
      ids.ws,
      `Persona inventata ${key}`,
      `ret-${key}-${suffix}@cliente.test`,
    ]);
  }
  const [item] = await q(`SELECT id FROM uc_items WHERE case_id = $1::uuid ORDER BY key LIMIT 1`, [state.caseId]);
  await q(`UPDATE uc_items SET assignee_contact_id = $2::uuid WHERE id = $1::uuid`, [item.id, contacts.only]);
  const [item2] = await q(`SELECT id FROM uc_items WHERE case_id = $1::uuid AND id <> $2::uuid ORDER BY key LIMIT 1`, [state.caseId, item.id]);
  await q(`UPDATE uc_items SET assignee_contact_id = $2::uuid WHERE id = $1::uuid`, [item2.id, contacts.shared]);
  await q(`INSERT INTO uc_events (workspace_id, case_id, actor_type, actor_contact_id, event_type) VALUES ($1::uuid, $2::uuid, 'referente', $3::uuid, 'referente.aperto')`, [
    ids.ws,
    state.caseId,
    contacts.audit,
  ]);
  await q(`INSERT INTO uc_notifications (workspace_id, recipient_contact_id, channel, template_key, dedupe_key) VALUES ($1::uuid, $2::uuid, 'email', 'riepilogo_settimanale', $3)`, [
    ids.ws,
    contacts.only,
    `ret-${suffix}-riepilogo`,
  ]);
  const other = await createCase(exec!, {
    workspaceId: ids.ws,
    user: leadCtx!,
    canReviewWorkspacePortfolio: true,
    input: { templateId: loaded.value.templateId, code: `ret2-${suffix}`, title: "Altro caso dello stesso workspace" },
  });
  assert.ok(other.ok, other.ok ? "" : other.message);
  state.otherCaseId = other.value.caseId;
  await q(`UPDATE uc_cases SET client_owner_contact_id = $2::uuid WHERE id = $1::uuid`, [other.value.caseId, contacts.shared]);

  const scopes = buildCaseTokenScopes(state.caseId, ["cases:read"]);
  assert.ok(scopes.ok);
  await q(
    `INSERT INTO workspace_integration_tokens (id, workspace_id, label, provider, token_hash, token_prefix, scopes, created_by_user_id, expires_at)
     VALUES ($1::uuid, $2::uuid, 'Prova conservazione', 'claude_mcp', $3, 'ub_mcp_prova...', $4::jsonb, $5::uuid, (now() AT TIME ZONE 'UTC') + interval '180 days')`,
    [ids.token, ids.ws, createHash("sha256").update(`ub_mcp_${ids.token}`).digest("hex"), JSON.stringify(scopes.value), ids.lead],
  );
});

after(async () => {
  rmSync(storeDir, { recursive: true, force: true });
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1::uuid`, [ids.lead]);
});

const live = async () =>
  (await q(`SELECT id FROM uc_files WHERE case_id = $1::uuid AND deleted_at IS NULL ORDER BY id`, [state.caseId])).map((r) => String(r.id));

test("crons follow the switched-on list: a workspace off gets no readiness refresh", opts, async () => {
  const off = await runFreshnessCron(exec!, { env: ENV, lsDomains: LS_DOMAINS, workspaceId: ids.ws, workspaceIds: [randomUUID()], dispatch: false });
  assert.equal(off.readinessRefreshed, 0);
  const on = await runFreshnessCron(exec!, { env: ENV, lsDomains: LS_DOMAINS, workspaceId: ids.ws, workspaceIds: [ids.ws], dispatch: false });
  assert.ok(on.readinessRefreshed >= 1);
  // The case is open: retention leaves every file alone.
  assert.deepEqual(on.retention, { files: 0, objects: 0, failed: 0, unreachable: 0, deferred: false });
  assert.equal((await live()).length, 4);
});

test("the cron dispatch shares one budget across the switched-on workspaces, on the real queue", opts, async () => {
  const ws2 = randomUUID();
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova invio')`, [ws2, ids.org]);
  try {
    for (const ws of [ids.ws, ws2]) {
      for (let i = 0; i < 3; i++) {
        await q(`INSERT INTO uc_notifications (workspace_id, channel, template_key, dedupe_key) VALUES ($1::uuid, 'email', 'prova_invio', $2)`, [ws, `ret-${suffix}-invio-${ws}-${i}`]);
      }
    }
    // Email configured with invented values and a fake transport: never Resend.
    const env = { RESEND_API_KEY: "re_prova", UC_EMAIL_FROM: "Prova <avvisi@example.test>", NEXT_PUBLIC_APP_URL: "https://app.example.test" };
    const mailer: UcMailer = { send: async () => ({ ok: true }) };
    const processed: Record<string, number> = {};
    const result = await dispatchAcrossWorkspaces(
      [ids.ws, ws2],
      async (workspaceId, limit) => {
        const part: DispatchSummary = await dispatchQueue(exec!, { env, lsDomains: LS_DOMAINS, workspaceId, limit, mailer, sendIntervalMs: 0 });
        processed[workspaceId] = part.sent + part.failed + part.held + part.cancelled;
        return part;
      },
      { limit: 4, timeLeft: () => true, rateLimited: () => false },
    );
    assert.deepEqual(processed, { [ids.ws]: 2, [ws2]: 2 }, "each workspace claims its share of the round's budget");
    assert.equal(result.summary.sent + result.summary.failed + result.summary.held + result.summary.cancelled, 4);
  } finally {
    await q(`DELETE FROM uc_notifications WHERE dedupe_key LIKE $1`, [`ret-${suffix}-invio-%`]);
    await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ws2]);
  }
});

test("retention: files of a closed case go 30 days after closure, written proofs stay", opts, async () => {
  await q(`UPDATE uc_cases SET status = 'chiuso', closed_reason = 'prova', closed_at = now() - interval '10 days' WHERE id = $1::uuid`, [state.caseId]);
  let s = await expireRetainedFiles(exec!, ENV, { workspaceId: ids.ws });
  assert.equal(s.files, 0, "inside the 30 days nothing goes");
  assert.equal(caseObjects().length, 5);

  await q(`UPDATE uc_cases SET closed_at = now() - interval '40 days' WHERE id = $1::uuid`, [state.caseId]);
  // Without a configured store the rows are skipped and counted, not failed: they do not use up the night's limit.
  s = await expireRetainedFiles(exec!, {}, { workspaceId: ids.ws, limit: 1 });
  assert.deepEqual(s, { files: 0, objects: 0, failed: 0, unreachable: 3, deferred: false });
  assert.equal(caseObjects().length, 5);
  s = await expireRetainedFiles(exec!, ENV, { workspaceId: ids.ws });
  assert.equal(s.files, 3);
  assert.equal(s.objects, 3);
  assert.equal(s.failed, 0);
  assert.deepEqual(await live(), [state.files.proof]);
  const rows = await q(`SELECT id, blob_path, quarantine_path, deletion_reason FROM uc_files WHERE case_id = $1::uuid AND deleted_at IS NOT NULL`, [state.caseId]);
  for (const r of rows) {
    assert.equal(r.blob_path, null);
    assert.equal(r.quarantine_path, null);
    assert.equal(r.deletion_reason, "conservazione_scaduta");
  }
  const events = await q(`SELECT payload FROM uc_events WHERE case_id = $1::uuid AND event_type = 'file.cancellato'`, [state.caseId]);
  assert.equal(events.length, 3);
  for (const e of events) assert.equal((typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload).motivo, "conservazione_scaduta");
  // Proof and orphan object are still in the store.
  assert.equal(caseObjects().length, 2);

  // A recorded retention date wins over closure + 30 days.
  await q(`UPDATE uc_files SET retention_until = (now() + interval '5 days')::date WHERE id = $1::uuid`, [state.files.proof]);
  s = await expireRetainedFiles(exec!, ENV, { workspaceId: ids.ws });
  assert.equal(s.files, 0);
  assert.equal((await expireRetainedFiles(exec!, ENV, { workspaceId: ids.ws })).files, 0, "a second night finds nothing new");
});

test("purge refuses to touch the database when a store cannot be reached", opts, async () => {
  const plan = await loadPurgePlan(exec!, state.caseId);
  assert.ok(plan);
  const result = await purgeCase(exec!, plan, {});
  assert.equal(result.ok ? null : result.code, "archivio");
  assert.ok(await loadPurgePlan(exec!, state.caseId), "the case is still there");
});

test("purge: 0 uc rows and 0 objects of the case afterwards, its own referents anonymised; the audit and the workspace stay", opts, async () => {
  const plan = await loadPurgePlan(exec!, state.caseId);
  assert.ok(plan);
  assert.equal(plan.code, state.code);
  assert.equal(plan.status, "chiuso");
  assert.equal(plan.rows.uc_cases, 1);
  assert.ok(plan.rows.uc_items > 0);
  assert.equal(plan.rows.uc_files, 4);
  assert.ok(plan.totalRows > plan.rows.uc_items);
  assert.ok(plan.eventsKept > 0);
  assert.equal(plan.activeTokens, 1);
  assert.deepEqual(plan.objects.standard.length + plan.objects.personale.length, 1, "only the proof still has a path");
  assert.deepEqual(plan.contactsToAnonymize, [contacts.only, contacts.audit].sort(), "used by no other case; the shared and the unrelated stay");

  const result = await purgeCase(exec!, plan, ENV);
  assert.ok(result.ok, result.ok ? "" : result.message);
  assert.deepEqual(result.remaining, {});
  assert.equal(result.tokensRevoked, 1);
  assert.equal(result.objectsDeleted, 2, "the proof and the orphan found by prefix");
  assert.equal(result.eventsKept, plan.eventsKept);
  assert.equal(result.contactsAnonymized, 2);
  const people = await q(`SELECT id, display_name, email, phone_e164, is_active, anonymized_at FROM uc_contacts WHERE workspace_id = $1::uuid`, [ids.ws]);
  const person = (id: string) => people.find((r) => r.id === id)!;
  for (const id of [contacts.only, contacts.audit]) {
    assert.equal(person(id).display_name, "Referente dati", "the name becomes the role label");
    assert.equal(person(id).email, null);
    assert.equal(person(id).phone_e164, null);
    assert.equal(person(id).is_active, false);
    assert.ok(person(id).anonymized_at);
  }
  for (const id of [contacts.shared, contacts.unrelated]) assert.equal(person(id).anonymized_at, null);
  const [queued] = await q(`SELECT status FROM uc_notifications WHERE recipient_contact_id = $1::uuid`, [contacts.only]);
  assert.equal(queued.status, "annullata", "a queued workspace email to the referent is cancelled");
  assert.deepEqual(caseObjects(), []);
  assert.equal(await loadPurgePlan(exec!, state.caseId), null);
  const [token] = await q(`SELECT revoked_at FROM workspace_integration_tokens WHERE id = $1::uuid`, [ids.token]);
  assert.ok(token.revoked_at);
  const [ws] = await q(`SELECT count(*)::int AS n FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  assert.equal(ws.n, 1);
  // A second run on a plan of a case that is gone changes nothing.
  const again = await purgeCase(exec!, plan, ENV);
  assert.equal(again.ok ? null : again.code, "caso_cambiato");
});

test("anonymize-contact: the operator anonymises a referent of closed cases, with the rules of the people page", opts, async () => {
  const refused = await anonymizeContactAsOperator(exec!, { caseId: state.otherCaseId, contactId: contacts.shared });
  assert.equal(refused.ok ? null : refused.code, "firmatario_designato", "still the designated owner of an open case");
  await q(`UPDATE uc_cases SET status = 'chiuso', closed_reason = 'prova', closed_at = now() WHERE id = $1::uuid`, [state.otherCaseId]);
  const done = await anonymizeContactAsOperator(exec!, { caseId: state.otherCaseId, contactId: contacts.shared });
  assert.deepEqual(done, { ok: true, workspaceId: ids.ws });
  const [row] = await q(`SELECT display_name, email, phone_e164, anonymized_at FROM uc_contacts WHERE id = $1::uuid`, [contacts.shared]);
  assert.equal(row.display_name, "Referente dati");
  assert.equal(row.email, null);
  assert.equal(row.phone_e164, null);
  assert.ok(row.anonymized_at);
  const again = await anonymizeContactAsOperator(exec!, { caseId: state.otherCaseId, contactId: contacts.shared });
  assert.equal(again.ok ? null : again.code, "conflitto", "already anonymised");
  const elsewhere = await anonymizeContactAsOperator(exec!, { caseId: randomUUID(), contactId: contacts.unrelated });
  assert.equal(elsewhere.ok ? null : elsewhere.code, "caso_non_trovato");
  const [untouched] = await q(`SELECT anonymized_at FROM uc_contacts WHERE id = $1::uuid`, [contacts.unrelated]);
  assert.equal(untouched.anonymized_at, null);
});

test("forget-personal-files: rows of a removed personal store close without their object", opts, async () => {
  const fileId = randomUUID();
  await q(
    `INSERT INTO uc_files (id, workspace_id, case_id, file_name, mime, size_bytes, sha256, storage_zone, blob_path, encryption_key_ref, privacy_class, max_size_bytes, scan_status, content_scanned)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'prova.csv', 'text/csv', 10, $4, 'personale', $5, 'kek:1', 'personale', 1000, 'pulito', true)`,
    [fileId, ids.ws, state.otherCaseId, hex64(), ucBlobPath("personale", ids.ws, state.otherCaseId, fileId)],
  );
  // Only this workspace: the shared harness may hold personal files of other suites and fixtures.
  const ours = (await loadPersonalFilesPlan(exec!)).cases.filter((c) => c.workspaceId === ids.ws);
  assert.deepEqual(ours, [{ workspaceId: ids.ws, caseId: state.otherCaseId, files: 1 }]);
  assert.equal(await forgetPersonalFiles(exec!, { cases: ours, files: 1 }), 1);
  const [row] = await q(`SELECT blob_path, deleted_at, deletion_reason FROM uc_files WHERE id = $1::uuid`, [fileId]);
  assert.equal(row.blob_path, null);
  assert.ok(row.deleted_at);
  assert.equal(row.deletion_reason, "archivio_rimosso");
  const [event] = await q(`SELECT payload FROM uc_events WHERE target_id = $1::uuid AND event_type = 'file.cancellato'`, [fileId]);
  assert.equal((typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload).motivo, "archivio_rimosso");
  assert.deepEqual((await loadPersonalFilesPlan(exec!)).cases.filter((c) => c.workspaceId === ids.ws), []);
});
