import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { declareSubprocessors, loadSubprocessorAck } from "../db/queries/uc-subprocessors.ts";
import { SUBPROCESSORS_VERSION, subprocessorsRecordText } from "./legal/subprocessors.ts";

// Opt-in integration suite for the sub-processor authorization (GDPR art. 28, par. 2),
// on the isolated local harness only:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/subprocessors.integration.test.ts
// It creates its own synthetic organizations, workspaces and users and deletes them at the end.
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

const LS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  org2: randomUUID(),
  ws: randomUUID(),
  ws2: randomUUID(),
  wsGone: randomUUID(),
  ws3: randomUUID(),
  builder: randomUUID(),
  unverified: randomUUID(),
  analyst: randomUUID(),
  learner: randomUUID(),
  lsLead: randomUUID(),
  orgLead: randomUUID(),
  orgContributor: randomUUID(),
};
const COMPANY = "Cliente Sottoresponsabili";

const declare = (userId: string, over: { workspaceId?: string; listVersion?: unknown; confirmed?: unknown } = {}) =>
  declareSubprocessors(exec!, {
    workspaceId: over.workspaceId ?? ids.ws,
    userId,
    lsDomains: LS,
    listVersion: "listVersion" in over ? over.listVersion : SUBPROCESSORS_VERSION,
    confirmed: "confirmed" in over ? over.confirmed : true,
  });
const codeOf = (r: Awaited<ReturnType<typeof declare>>) => (r.ok ? "ok" : r.code);
const rowsFor = (workspaceId: string) => q(`SELECT * FROM uc_subprocessor_acks WHERE workspace_id = $1::uuid ORDER BY declared_at`, [workspaceId]);

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org sub-responsabili', $3), ($2::uuid, 'Org altra', $4)`, [
    ids.org,
    ids.org2,
    `uc-sub-${ids.org}`,
    `uc-sub-${ids.org2}`,
  ]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $4::uuid, $5), ($2::uuid, $6::uuid, 'Altro cliente'), ($3::uuid, $4::uuid, 'Da cancellare')`, [
    ids.ws,
    ids.ws2,
    ids.wsGone,
    ids.org,
    COMPANY,
    ids.org2,
  ]);
  await q(
    `INSERT INTO users (id, name, email, email_verified) VALUES
       ($1::uuid, 'Builder di prova', $6, now()),
       ($2::uuid, NULL, $7, NULL),
       ($3::uuid, NULL, $8, now()),
       ($4::uuid, NULL, $9, now()),
       ($5::uuid, NULL, $10, now())`,
    [
      ids.builder,
      ids.unverified,
      ids.analyst,
      ids.learner,
      ids.lsLead,
      `sub-builder-${suffix}@cliente.test`,
      `sub-nonverificato-${suffix}@cliente.test`,
      `sub-analista-${suffix}@cliente.test`,
      `sub-corsista-${suffix}@cliente.test`,
      `sub-lead-${suffix}@ls.test`,
    ],
  );
  // The client people are invited into the workspaces; Lateral Space belongs to the organization.
  await q(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES
       ($1::uuid, $3::uuid, 'function_lead'), ($2::uuid, $3::uuid, 'function_lead'),
       ($1::uuid, $4::uuid, 'function_lead'), ($1::uuid, $5::uuid, 'analyst'), ($1::uuid, $6::uuid, 'learner')`,
    [ids.ws, ids.wsGone, ids.builder, ids.unverified, ids.analyst, ids.learner],
  );
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $2::uuid, 'transformation_lead')`, [ids.lsLead, ids.org]);
  // Two client people of the organization, as in getWorkspaceAccessForUser: the organization role wins.
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Terzo workspace')`, [ids.ws3, ids.org]);
  await q(`INSERT INTO users (id, name, email, email_verified) VALUES ($1::uuid, NULL, $3, now()), ($2::uuid, NULL, $4, now())`, [
    ids.orgLead,
    ids.orgContributor,
    `sub-org-lead-${suffix}@cliente.test`,
    `sub-org-contributore-${suffix}@cliente.test`,
  ]);
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $3::uuid, 'function_lead'), ($2::uuid, $3::uuid, 'contributor')`, [
    ids.orgLead,
    ids.orgContributor,
    ids.org,
  ]);
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'function_lead')`, [ids.ws3, ids.orgContributor]);
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`, [ids.ws, ids.ws2, ids.wsGone, ids.ws3]);
  await q(`DELETE FROM organizations WHERE id IN ($1::uuid, $2::uuid)`, [ids.org, ids.org2]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.builder, ids.unverified, ids.analyst, ids.learner, ids.lsLead, ids.orgLead, ids.orgContributor]]);
});

test("refused: Lateral Space, a learner, an analyst, an unverified email, another workspace, an old list, an unticked box", opts, async () => {
  assert.equal(codeOf(await declare(ids.lsLead)), "non_autorizzato", "Lateral Space only reads, whatever its role");
  assert.equal(codeOf(await declare(ids.learner)), "non_autorizzato");
  assert.equal(codeOf(await declare(ids.analyst)), "non_autorizzato");
  assert.equal(codeOf(await declare(ids.unverified)), "non_autorizzato");
  assert.equal(codeOf(await declare(ids.builder, { workspaceId: ids.ws2 })), "non_trovato", "no access to another client's workspace");
  assert.equal(codeOf(await declare(ids.builder, { workspaceId: randomUUID() })), "non_trovato");
  assert.equal(codeOf(await declare(ids.builder, { listVersion: "2025-01" })), "versione_superata");
  assert.equal(codeOf(await declare(ids.builder, { listVersion: undefined })), "versione_superata");
  assert.equal(codeOf(await declare(ids.builder, { confirmed: false })), "conferma_mancante");
  assert.equal(codeOf(await declare(ids.builder, { confirmed: "true" })), "conferma_mancante");
  assert.equal((await rowsFor(ids.ws)).length, 0);
  assert.equal((await rowsFor(ids.ws2)).length, 0);
  assert.equal(await loadSubprocessorAck(exec!, ids.ws), null);
});

test("the organization role wins: an organization function lead may declare, an organization contributor may not", opts, async () => {
  assert.equal(codeOf(await declare(ids.orgContributor, { workspaceId: ids.ws3 })), "non_autorizzato", "contributor in the organization, function lead in the workspace");
  const r = await declare(ids.orgLead, { workspaceId: ids.ws3 });
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.equal(r.value.ack.declaredByRole, "function_lead", "function lead in the organization only, no workspace invitation");
  assert.equal((await rowsFor(ids.ws3)).length, 1);
});

test("a client function lead authorizes: one row with the approved text, the role and the person", opts, async () => {
  const r = await declare(ids.builder);
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.equal(r.value.created, true);
  assert.equal(r.value.ack.listVersion, SUBPROCESSORS_VERSION);
  assert.equal(r.value.ack.declaredByName, "Builder di prova");
  assert.equal(r.value.ack.declaredByRole, "function_lead");

  const rows = await rowsFor(ids.ws);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].list_version, SUBPROCESSORS_VERSION);
  assert.equal(rows[0].statement_text, subprocessorsRecordText(COMPANY));
  assert.match(String(rows[0].statement_text), /^Per conto di Cliente Sottoresponsabili, titolare del trattamento, autorizzo Lateral Space/);
  assert.equal(rows[0].declared_by_user_id, ids.builder);
  assert.equal(rows[0].declared_by_role, "function_lead");

  const ack = await loadSubprocessorAck(exec!, ids.ws);
  assert.equal(ack?.declaredByName, "Builder di prova");
  assert.equal(await loadSubprocessorAck(exec!, ids.ws2), null, "the other workspace is not authorized");
});

test("declaring the same version again succeeds without a second row", opts, async () => {
  const again = await declare(ids.builder);
  assert.ok(again.ok);
  assert.equal(again.value.created, false);
  assert.equal(again.value.ack.declaredByName, "Builder di prova");
  assert.equal((await rowsFor(ids.ws)).length, 1);
  // Two at once: still one row.
  const both = await Promise.all([declare(ids.builder), declare(ids.builder)]);
  assert.ok(both.every((x) => x.ok));
  assert.equal((await rowsFor(ids.ws)).length, 1);
  // Lateral Space is refused even once the workspace is authorized.
  assert.equal(codeOf(await declare(ids.lsLead)), "non_autorizzato");
});

test("the authorization is append-only: no UPDATE, no DELETE, the declaring user cannot be deleted", opts, async () => {
  const [row] = await rowsFor(ids.ws);
  await assert.rejects(() => q(`UPDATE uc_subprocessor_acks SET list_version = 'x' WHERE id = $1::uuid`, [row.id]), /uc:sola_aggiunta/);
  await assert.rejects(() => q(`UPDATE uc_subprocessor_acks SET statement_text = 'altro' WHERE id = $1::uuid`, [row.id]), /uc:sola_aggiunta/);
  await assert.rejects(() => q(`DELETE FROM uc_subprocessor_acks WHERE id = $1::uuid`, [row.id]), /uc:sola_aggiunta/);
  await assert.rejects(() => q(`DELETE FROM users WHERE id = $1::uuid`, [ids.builder]), /foreign key|violates/i);
  assert.equal((await rowsFor(ids.ws)).length, 1);
  assert.equal((await rowsFor(ids.ws))[0].statement_text, subprocessorsRecordText(COMPANY));
});

test("deleting the workspace cascades through the authorization", opts, async () => {
  const r = await declare(ids.builder, { workspaceId: ids.wsGone });
  assert.ok(r.ok && r.value.created);
  assert.equal((await rowsFor(ids.wsGone)).length, 1);
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.wsGone]);
  assert.equal((await rowsFor(ids.wsGone)).length, 0);
});
