import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { addCaseMember, commandContextFor, createCase, loadUserContext } from "../db/queries/uc-cases.ts";
import { loadDossierBaseRows } from "../db/queries/uc-dossier-base.ts";
import { caseHeaderFromRows, loadCaseHeader } from "../db/queries/uc-header.ts";
import { planTemplateLoad } from "./template/load.ts";

// Opt-in integration suite: every dossier page reads the case access row and the header in
// one batch (DESIGN §7.1 P0-5c, budget of P0-5e), instead of the access and then the header.
// On the isolated local harness only:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/dossier-base.integration.test.ts
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
const ids = { org: randomUUID(), ws: randomUUID(), otherWs: randomUUID(), lead: randomUUID(), owner: randomUUID(), stranger: randomUUID() };
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state = { caseId: "" };

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

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova lettura di base', $2)`, [ids.org, `uc-base-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova lettura di base'), ($2::uuid, $3::uuid, 'Altro lettura di base')`, [ids.ws, ids.otherWs, ids.org]);
  await q(
    `INSERT INTO users (id, email, email_verified, name) VALUES
       ($1::uuid, $4, now(), 'Lead di prova'), ($2::uuid, $5, now(), 'Owner di prova'), ($3::uuid, $6, now(), 'Nessun ruolo')`,
    [ids.lead, ids.owner, ids.stranger, `base-lead-${suffix}@ls.test`, `base-owner-${suffix}@cliente.test`, `base-altro-${suffix}@cliente.test`],
  );
  await q(
    `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $4::uuid, 'transformation_lead'), ($2::uuid, $4::uuid, 'contributor'), ($3::uuid, $4::uuid, 'contributor')`,
    [ids.lead, ids.owner, ids.stranger, ids.org],
  );
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.base_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const leadUser = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, { workspaceId: ids.ws, user: leadUser!, canReviewWorkspacePortfolio: true, input: { templateId: loaded.value.templateId, code: `BASE-${suffix}`.toUpperCase(), title: "Caso della lettura di base" } });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  const lead = await commandContextFor(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.lead, lsDomains: LS_DOMAINS });
  assert.ok(lead.ok);
  assert.ok((await addCaseMember(exec!, lead.value, { userId: ids.owner, role: "owner_cliente" })).ok);
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1::uuid, $2::uuid)`, [ids.ws, ids.otherWs]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid)`, [ids.lead, ids.owner, ids.stranger]);
});

test("access row and header in one round-trip; the header is the same as the header's own read", opts, async () => {
  const counted = countingExecutor();
  const base = await loadDossierBaseRows(counted.executor, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.owner });
  assert.equal(counted.calls(), 1, "one batch, one round-trip");
  assert.ok(base.access);
  assert.equal(base.access.id, state.caseId);
  assert.equal(base.access.userId, ids.owner);
  const roles = Array.isArray(base.access.roles) ? base.access.roles : String(base.access.roles).replace(/^\{|\}$/g, "").split(",");
  assert.deepEqual(roles, ["owner_cliente"]);
  const now = new Date();
  const header = await caseHeaderFromRows(counted.executor, base.headerRows, { workspaceId: ids.ws, caseId: state.caseId, roles: ["owner_cliente"], now });
  const own = await loadCaseHeader(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.owner, roles: ["owner_cliente"], now });
  assert.ok(header && own);
  assert.deepEqual(header, own);
  assert.equal(header.case.title, "Caso della lettura di base");
});

test("the same batch for a non-member, another workspace, an uppercase address", opts, async () => {
  const stranger = await loadDossierBaseRows(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.stranger });
  assert.ok(stranger.access);
  assert.ok(Array.isArray(stranger.access.roles) ? stranger.access.roles.length === 0 : stranger.access.roles === "{}", "no stored role: the page decides (404 or implicit observer)");

  const elsewhere = await loadDossierBaseRows(exec!, { workspaceId: ids.otherWs, caseId: state.caseId, userId: ids.lead });
  assert.ok(elsewhere.access);
  assert.equal(elsewhere.access.id, null, "a case of another workspace is not found");
  assert.equal(await caseHeaderFromRows(exec!, elsewhere.headerRows, { workspaceId: ids.otherWs, caseId: state.caseId, roles: ["ls_lead"] }), null, "nor its header");

  const upper = await loadDossierBaseRows(exec!, { workspaceId: ids.ws.toUpperCase(), caseId: state.caseId.toUpperCase(), userId: ids.lead.toUpperCase() });
  assert.equal(upper.access?.id, state.caseId);
  assert.ok(await caseHeaderFromRows(exec!, upper.headerRows, { workspaceId: ids.ws.toUpperCase(), caseId: state.caseId.toUpperCase(), roles: ["ls_lead"] }));
});
