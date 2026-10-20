import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { createCase, loadUserContext } from "../db/queries/uc-cases.ts";
import {
  listCaseReadTokens,
  loadMcpCase,
  readDataDictionary,
  readGateStatus,
  readOpenItems,
  readCases,
  readValidatedCatalog,
  recordMcpRead,
  revokeCaseReadToken,
  type McpCase,
  type McpRead,
} from "../db/queries/uc-mcp.ts";
import { buildCaseTokenScopes, checkMcpToolAccess } from "./mcp-access.ts";
import { buildCatalogSnapshot, snapshotHash } from "./snapshot.ts";
import { sampleInput } from "./snapshot.fixtures.ts";
import { planTemplateLoad } from "./template/load.ts";

// Opt-in integration suite for the read-only MCP of the cases (PIANO §5.8), on the
// isolated local harness only. Same guard as commands.integration.test.ts:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/mcp.integration.test.ts
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

const LS_DOMAINS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), ws2: randomUUID(), lead: randomUUID(), tokenA: randomUUID(), tokenB: randomUUID() };
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state: { caseId: string; mcase: McpCase | null } = { caseId: "", mcase: null };

function body(r: McpRead): Record<string, unknown> {
  assert.ok(r.ok, r.ok ? "" : `${r.code}: ${r.message}`);
  return r.body;
}

function codeOf(r: McpRead): string | null {
  return r.ok ? null : r.code;
}

async function reloadCase(): Promise<McpCase> {
  const mcase = await loadMcpCase(exec!, ids.ws, state.caseId);
  assert.ok(mcase, "case of the token");
  state.mcase = mcase;
  return mcase;
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova MCP', $2)`, [ids.org, `uc-mcp-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova MCP'), ($2::uuid, $3::uuid, 'Prova MCP altro')`, [ids.ws, ids.ws2, ids.org]);
  await q(`INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $2, now())`, [ids.lead, `mcp-lead-${suffix}@ls.test`]);
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $2::uuid, 'transformation_lead')`, [ids.lead, ids.org]);
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.mcp_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const leadCtx = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, {
    workspaceId: ids.ws,
    user: leadCtx!,
    canReviewWorkspacePortfolio: true,
    input: { templateId: loaded.value.templateId, code: `mcp-${suffix}`, title: "Caso per l'MCP" },
  });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  // Two case tokens: one for this case, one for another case of the same workspace.
  const scopesA = buildCaseTokenScopes(state.caseId, ["cases:read", "cases:read_validated"]);
  const scopesB = buildCaseTokenScopes(randomUUID(), ["cases:read"]);
  assert.ok(scopesA.ok && scopesB.ok);
  for (const [id, scopes] of [
    [ids.tokenA, scopesA.value],
    [ids.tokenB, scopesB.value],
  ] as const) {
    await q(
      `INSERT INTO workspace_integration_tokens (id, workspace_id, label, provider, token_hash, token_prefix, scopes, created_by_user_id, expires_at)
       VALUES ($1::uuid, $2::uuid, 'Prova MCP', 'claude_mcp', $3, 'ub_mcp_prova...', $4::jsonb, $5::uuid, (now() AT TIME ZONE 'UTC') + interval '180 days')`,
      [id, ids.ws, createHash("sha256").update(`ub_mcp_${id}`).digest("hex"), JSON.stringify(scopes), ids.lead],
    );
  }
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1::uuid, $2::uuid)`, [ids.ws, ids.ws2]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1::uuid`, [ids.lead]);
});

test("the token's case is read only inside the token's workspace", opts, async () => {
  const mcase = await reloadCase();
  assert.equal(mcase.code, `MCP-${suffix.toUpperCase()}`);
  assert.deepEqual(mcase.options, { aiEnvironmentApproved: false, clientText: true });
  assert.equal(await loadMcpCase(exec!, ids.ws2, state.caseId), null);
  assert.equal(await loadMcpCase(exec!, ids.ws, randomUUID()), null);
  const [token] = await q(`SELECT scopes FROM workspace_integration_tokens WHERE id = $1::uuid`, [ids.tokenA]);
  const scopes = typeof token.scopes === "string" ? JSON.parse(token.scopes) : token.scopes;
  assert.deepEqual(checkMcpToolAccess({ scopes, tool: "get_open_items", caseId: state.caseId }), { ok: true, value: { caseId: state.caseId } });
  const list = body(await readCases(exec!, mcase));
  const cases = list.cases as Record<string, unknown>[];
  assert.equal(cases.length, 1);
  assert.equal(cases[0].id, state.caseId);
  assert.equal(cases[0].catalog_version, null);
  assert.equal(cases[0].title, undefined, "client texts hidden until the AI environment is approved");
});

test("the catalog: never a draft, then only green or blue items of the frozen version", opts, async () => {
  const mcase = state.mcase ?? (await reloadCase());
  assert.equal(codeOf(await readValidatedCatalog(exec!, mcase, { version: null, kinds: null })), "nessuna_versione_congelata");
  assert.equal(codeOf(await readValidatedCatalog(exec!, mcase, { version: 1, kinds: null })), "versione_non_trovata");

  const base = sampleInput();
  const built = buildCatalogSnapshot(sampleInput({ case: { ...base.case, id: state.caseId, workspaceId: ids.ws, code: mcase.code } }));
  assert.ok(built.ok);
  await q(
    `INSERT INTO uc_catalog_versions (case_id, version, reason, diff, snapshot, snapshot_hash, approved_by)
     VALUES ($1::uuid, 1, 'gate', '{}'::jsonb, $2::jsonb, $3, '[]'::jsonb)`,
    [state.caseId, JSON.stringify(built.value), snapshotHash(built.value)],
  );
  await q(`UPDATE uc_cases SET catalog_version = 1 WHERE id = $1::uuid`, [state.caseId]);

  const read = await readValidatedCatalog(exec!, mcase, { version: null, kinds: null });
  const catalog = body(read);
  assert.equal(catalog.version, 1);
  assert.equal(catalog.case_id, state.caseId);
  assert.equal(catalog.text_hidden, "ambiente_non_approvato");
  const items = catalog.items as { key: string; status: string; title?: string }[];
  assert.deepEqual(items.map((i) => i.key), ["q.esempio.01", "q.esempio.02", "q.esempio.04", "q.esempio.05", "richiesta.durata"]);
  for (const i of items) {
    assert.ok(i.status === "validata" || i.status === "non_applicabile");
    assert.equal(i.title, undefined);
  }
  assert.ok((catalog.excluded as { key: string }[]).some((e) => e.key === "q.esempio.03"));
  assert.ok(!JSON.stringify(catalog).includes("dato personale inventato"));
  assert.ok(read.ok && read.event.version === 1 && read.event.items === 5);

  const fields = body(await readValidatedCatalog(exec!, mcase, { version: 1, kinds: ["campo"] }));
  assert.deepEqual((fields.items as { key: string }[]).map((i) => i.key), ["richiesta.durata"]);
  assert.equal(codeOf(await readValidatedCatalog(exec!, mcase, { version: 2, kinds: null })), "versione_non_trovata");
});

test("open items, data dictionary and gate status come from the live case", opts, async () => {
  let mcase = await reloadCase();
  const open = body(await readOpenItems(exec!, mcase));
  assert.equal(open.gate, "G1");
  assert.equal(open.catalog_version, 1);
  const openItems = open.items as { key: string; title?: string; role_key: string | null; status: string }[];
  assert.ok(openItems.length > 0);
  assert.equal(open.count, openItems.length);
  assert.equal(open.text_hidden, "ambiente_non_approvato");
  for (const i of openItems) assert.equal(i.title, undefined);

  const dictionary = body(await readDataDictionary(exec!, mcase));
  const entities = dictionary.entities as { key: string; fields: { key: string; privacy_class: string }[] }[];
  assert.ok(entities.some((e) => e.key === "ent.richiesta" && e.fields.length > 0));
  assert.ok(!JSON.stringify(dictionary).includes("Richiesta di assistenza"), "entity titles hidden");

  const gate = body(await readGateStatus(exec!, mcase));
  const status = gate.gate_status as { required: number; ok: number; ready: boolean; history: unknown[] };
  assert.equal(gate.ok, true);
  assert.ok(status.required > 0);
  assert.equal(status.ready, false);
  assert.deepEqual(status.history, []);
  assert.equal(status.required, openItems.length + status.ok);

  // A case without client texts shows titles and role labels.
  await q(`UPDATE uc_cases SET settings = jsonb_set(settings, '{client_text}', 'false'::jsonb) WHERE id = $1::uuid`, [state.caseId]);
  mcase = await reloadCase();
  const openWithTexts = body(await readOpenItems(exec!, mcase));
  assert.equal(openWithTexts.text_hidden, undefined);
  assert.ok((openWithTexts.items as { title?: string | null }[]).every((i) => typeof i.title === "string" && i.title.length > 0));
  const dictionaryWithTexts = body(await readDataDictionary(exec!, mcase));
  assert.ok(JSON.stringify(dictionaryWithTexts).includes("Richiesta di assistenza"));
  await q(`UPDATE uc_cases SET settings = jsonb_set(settings, '{client_text}', 'true'::jsonb) WHERE id = $1::uuid`, [state.caseId]);
});

test("every read leaves an mcp audit event with the token and no values", opts, async () => {
  await recordMcpRead(exec!, { workspaceId: ids.ws, caseId: state.caseId, integrationTokenId: ids.tokenA, tool: "get_validated_catalog", version: 1, items: 5, ipHash: "a".repeat(32), userAgent: "claude-code" });
  const rows = await q(`SELECT actor_type, actor_user_id, event_type, target_type, target_id, payload, ip_hash, user_agent FROM uc_events WHERE integration_token_id = $1::uuid`, [ids.tokenA]);
  assert.equal(rows.length, 1);
  const e = rows[0];
  assert.equal(e.actor_type, "mcp");
  assert.equal(e.actor_user_id, null);
  assert.equal(e.event_type, "catalogo.letto_mcp");
  assert.equal(e.target_type, "caso");
  assert.equal(e.target_id, state.caseId);
  const payload = typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload;
  assert.deepEqual(payload, { tool: "get_validated_catalog", version: 1, items: 5 });
  assert.equal(e.ip_hash, "a".repeat(32));
});

test("case tokens are listed and revoked only for their case", opts, async () => {
  const listed = await listCaseReadTokens(exec!, ids.ws, state.caseId);
  assert.deepEqual(listed.map((t) => t.id), [ids.tokenA]);
  assert.deepEqual(listed[0].scopes, ["cases:read", "cases:read_validated"]);
  assert.equal(listed[0].active, true);
  assert.ok(listed[0].expiresAt && new Date(listed[0].expiresAt).getTime() > Date.now());
  assert.equal(await revokeCaseReadToken(exec!, { workspaceId: ids.ws, caseId: state.caseId, tokenId: ids.tokenB }), false);
  assert.equal(await revokeCaseReadToken(exec!, { workspaceId: ids.ws2, caseId: state.caseId, tokenId: ids.tokenA }), false);
  assert.equal(await revokeCaseReadToken(exec!, { workspaceId: ids.ws, caseId: state.caseId, tokenId: ids.tokenA }), true);
  assert.equal(await revokeCaseReadToken(exec!, { workspaceId: ids.ws, caseId: state.caseId, tokenId: ids.tokenA }), false);
  const after = await listCaseReadTokens(exec!, ids.ws, state.caseId);
  assert.equal(after[0].active, false);
  assert.ok(after[0].revokedAt);
  const [other] = await q(`SELECT revoked_at FROM workspace_integration_tokens WHERE id = $1::uuid`, [ids.tokenB]);
  assert.equal(other.revoked_at, null);
});

test("a closed case is never read, even with a live token", opts, async () => {
  await q(`UPDATE uc_cases SET status = 'chiuso', closed_reason = 'prova' WHERE id = $1::uuid`, [state.caseId]);
  assert.equal(await loadMcpCase(exec!, ids.ws, state.caseId), null);
});
