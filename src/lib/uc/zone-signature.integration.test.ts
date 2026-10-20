import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { decideCaseApproval, loadCaseApprovals } from "../db/queries/uc-approvals.ts";
import { addCaseMember, commandContextFor, createCase, loadUserContext, proposePersonalZoneAccess, revokePersonalZoneAccess, signPersonalZoneAccess, type UcCommandContext } from "../db/queries/uc-cases.ts";
import { resolveBlocker } from "../db/queries/uc-gates.ts";
import type { PersonalZoneGrant } from "./permissions.ts";
import { planTemplateLoad } from "./template/load.ts";
import { zoneApprovalHash } from "./views/approvals.ts";

// Opt-in integration suite (DESIGN §8.3 WP13): the signature on a personal-data access
// checks the text the signer read against the grant it signs, in the same command. On the
// isolated local harness only, with the same guard as the other uc suites:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/zone-signature.integration.test.ts
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
const ids = { org: randomUUID(), ws: randomUUID(), lead: randomUUID(), analyst: randomUUID(), privacy: randomUUID(), file: randomUUID() };
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state = { caseId: "" };

async function ctxFor(userId: string): Promise<UcCommandContext> {
  const r = await commandContextFor(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId, lsDomains: LS_DOMAINS });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

/** The grant on the analyst's row, as /firme and the approval link read it. */
async function grantHash(): Promise<string> {
  const [row] = await q(`SELECT personal_zone_grant AS g FROM uc_case_members WHERE case_id = $1::uuid AND user_id = $2::uuid AND personal_zone_grant IS NOT NULL`, [state.caseId, ids.analyst]);
  assert.ok(row, "a grant to sign");
  return zoneApprovalHash(row.g as PersonalZoneGrant);
}

async function access(): Promise<boolean> {
  const [row] = await q(`SELECT bool_or(personal_zone_access) AS a FROM uc_case_members WHERE case_id = $1::uuid AND user_id = $2::uuid`, [state.caseId, ids.analyst]);
  return row.a === true;
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova zona', $2)`, [ids.org, `uc-zona-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova zona')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, email_verified, name) VALUES ($1::uuid, $4, now(), 'Lead di prova'), ($2::uuid, $5, now(), 'Analista di prova'), ($3::uuid, $6, now(), 'Privacy di prova')`, [
    ids.lead,
    ids.analyst,
    ids.privacy,
    `zona-lead-${suffix}@ls.test`,
    `zona-analista-${suffix}@ls.test`,
    `zona-privacy-${suffix}@cliente.test`,
  ]);
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $4::uuid, 'transformation_lead'), ($2::uuid, $4::uuid, 'analyst'), ($3::uuid, $4::uuid, 'contributor')`, [
    ids.lead,
    ids.analyst,
    ids.privacy,
    ids.org,
  ]);
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.zona_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const leadUser = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, { workspaceId: ids.ws, user: leadUser!, canReviewWorkspacePortfolio: true, input: { templateId: loaded.value.templateId, code: `zona-${suffix}`, title: "Caso della zona" } });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  const lead = await ctxFor(ids.lead);
  for (const [userId, role] of [
    [ids.analyst, "ls_analista"],
    [ids.privacy, "approvatore_privacy"],
  ] as const) {
    const r = await addCaseMember(exec!, lead, { userId, role });
    assert.ok(r.ok, r.ok ? "" : r.message);
  }
  await q(
    `INSERT INTO uc_files (id, workspace_id, case_id, file_name, mime, size_bytes, sha256, privacy_class, max_size_bytes, scan_status, content_scanned)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'scheda-privacy.pdf', 'application/pdf', 100, $4, 'riservato_azienda', 1000, 'pulito', true)`,
    [ids.file, ids.ws, state.caseId, "e".repeat(64)],
  );
  // The privacy sheet, signed by both sides: the personal zone can open.
  const [a8] = await q(`SELECT id FROM uc_blockers WHERE case_id = $1::uuid AND key = 'a8'`, [state.caseId]);
  const evidence = {
    documento: "Scheda privacy di prova",
    versione: "1.0",
    data: "2026-10-01",
    approvatori_per_ruolo: ["approvatore_privacy"],
    file_id: ids.file,
    titolo_art_15_2: true,
    regione_dati_verificata: true,
    accesso_zona_personale: [ids.analyst],
  };
  const first = await resolveBlocker(exec!, lead, { blockerId: String(a8.id), evidence });
  assert.ok(first.ok, first.ok ? "" : first.message);
  const second = await resolveBlocker(exec!, await ctxFor(ids.privacy), { blockerId: String(a8.id) });
  assert.ok(second.ok && second.value.complete, second.ok ? "" : second.message);
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid)`, [ids.lead, ids.analyst, ids.privacy]);
});

test("personal-data access: a grant proposed again after the reading is not signed with the old text; the text read is", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const privacy = await ctxFor(ids.privacy);
  assert.ok((await proposePersonalZoneAccess(exec!, lead, { userId: ids.analyst })).ok);
  const read = await grantHash();
  // Lateral Space proposes the access again while the approver is reading: a new text.
  await new Promise((r) => setTimeout(r, 5));
  assert.ok((await proposePersonalZoneAccess(exec!, lead, { userId: ids.analyst })).ok);
  const now = await grantHash();
  assert.notEqual(now, read);

  const stale = await signPersonalZoneAccess(exec!, privacy, { userId: ids.analyst }, undefined, { expectedTextHash: read });
  assert.equal(stale.ok ? null : stale.code, "testo_cambiato");
  assert.equal(await access(), false, "nothing signed");

  const signed = await signPersonalZoneAccess(exec!, privacy, { userId: ids.analyst }, undefined, { expectedTextHash: now });
  assert.ok(signed.ok && signed.value.active, signed.ok ? "" : signed.message);
  assert.equal(await access(), true);
});

test("/firme: a grant proposed again between the reading and the signature gets «testo_cambiato»; the text read again is signed", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const privacy = await ctxFor(ids.privacy);
  if (await access()) assert.ok((await revokePersonalZoneAccess(exec!, lead, { userId: ids.analyst })).ok);
  assert.ok((await proposePersonalZoneAccess(exec!, lead, { userId: ids.analyst })).ok);
  const pending = await loadCaseApprovals(exec!, { workspaceId: ids.ws, caseId: state.caseId, roles: ["approvatore_privacy"] });
  const shown = pending!.approvals.find((a) => a.kind === "zona_personale" && a.targetId === ids.analyst);
  assert.ok(shown, "the approver reads the proposal on /firme");
  const decision = { kind: "zona_personale", target_id: ids.analyst, decision: "approvo", read: true };
  // Lateral Space proposes the access again right after the command has compared the text read: the signature must not land on the new text.
  let raced = false;
  const racing: UcExecutor = {
    async batch(statements) {
      const rows = await exec!.batch(statements);
      if (!raced) {
        raced = true;
        await new Promise((r) => setTimeout(r, 5));
        assert.ok((await proposePersonalZoneAccess(exec!, lead, { userId: ids.analyst })).ok);
      }
      return rows;
    },
  };
  const stale = await decideCaseApproval(racing, privacy, { ...decision, text_hash: shown.textHash });
  assert.ok(raced, "the grant changed after the reading");
  assert.equal(stale.ok ? null : stale.code, "testo_cambiato");
  assert.equal(await access(), false, "nothing signed");

  const again = await loadCaseApprovals(exec!, { workspaceId: ids.ws, caseId: state.caseId, roles: ["approvatore_privacy"] });
  const current = again!.approvals.find((a) => a.kind === "zona_personale" && a.targetId === ids.analyst);
  assert.ok(current && current.textHash !== shown.textHash);
  const signed = await decideCaseApproval(exec!, privacy, { ...decision, text_hash: current.textHash });
  assert.ok(signed.ok && signed.value.complete, signed.ok ? "" : signed.message);
  assert.equal(await access(), true);
});
