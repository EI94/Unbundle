import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { loadCaseReadiness, loadUserContext } from "../db/queries/uc-cases.ts";
import { createCaseFromTemplate, ensureFromUseCaseTemplate } from "../db/queries/uc-templates.ts";
import { loadQuestionsPage } from "../db/queries/uc-questions.ts";
import { loadItemDetail, type UcViewer } from "../db/queries/uc-views.ts";
import { loadOverview } from "../db/queries/uc-overview.ts";
import { loadCaseHeader } from "../db/queries/uc-header.ts";
import { loadExportSnapshot, lsOnlyItemKeys } from "../db/queries/uc-export.ts";
import { snapshotForViewer } from "./snapshot.ts";
import type { CaseRole } from "./vocab.ts";

// Owner's correction of 24/11 (docs/dossier/SCHEMA-DI-PARTENZA.md): client people see only the «Cosa serve» questions
// of their own side (cliente, insieme or none); lateral_space and fornitore are for Lateral Space only, and the client's
// counters count only what they see. Invented data only. Local harness:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/<copy> UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test src/lib/uc/client-visibility.integration.test.ts
const url = process.env.UC_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (process.env.UC_TEST_ISOLATED !== "true" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("uc DB tests require an explicitly isolated loopback database (UC_TEST_ISOLATED=true)");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== url) throw new Error("DATABASE_URL must be unset or equal to UC_TEST_DATABASE_URL");
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") throw new Error("Preload scripts/uc-test/local-neon.cjs");
}
const opts = { skip: !url };
const sql = url ? neon(url) : null;
const exec: UcExecutor | null = sql ? createUcExecutor(sql) : null;
const q = (text: string, params: unknown[] = []) => sql!.query(text, params) as Promise<Record<string, unknown>[]>;

const LS_DOMAINS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), lead: randomUUID(), client: randomUUID(), uc: randomUUID() };
const state = { caseId: "", needs: new Map<string, string>(), items: new Map<string, string>() };

async function viewer(userId: string, roles: CaseRole[]): Promise<UcViewer> {
  const user = await loadUserContext(exec!, userId, LS_DOMAINS);
  assert.ok(user);
  return { workspaceId: ids.ws, caseId: state.caseId, roles, user, readOnly: false };
}
const ls = () => viewer(ids.lead, ["ls_lead"]);
const client = () => viewer(ids.client, ["owner_cliente"]);

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova lato', $2)`, [ids.org, `uc-side-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova lato')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $2, now()), ($3::uuid, $4, now())`, [
    ids.lead,
    `side-lead-${suffix}@ls.test`,
    ids.client,
    `side-owner-${suffix}@cliente.test`,
  ]);
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $3::uuid, 'transformation_lead'), ($2::uuid, $3::uuid, 'transformation_lead')`, [ids.lead, ids.client, ids.org]);
  await q(`INSERT INTO use_cases (id, workspace_id, title, status, portfolio_kind) VALUES ($1::uuid, $2::uuid, 'Use case inventato con informazioni di tutte le parti', 'accepted', 'use_case_ai')`, [ids.uc, ids.ws]);
  // The owner's case: 4 cliente + 1 insieme + 6 lateral_space. Two of each side are validated.
  const sides: [string, string][] = [
    ...[1, 2, 3, 4].map((k): [string, string] => [`cliente.${k}`, "cliente"]),
    ["insieme.1", "insieme"],
    ...[1, 2, 3, 4, 5, 6].map((k): [string, string] => [`ls.${k}`, "lateral_space"]),
  ];
  let order = 10;
  for (const [name, side] of sides) {
    const status = name.endsWith(".1") || name.endsWith(".2") ? "validata" : "da_chiedere";
    const [row] = await q(
      `INSERT INTO use_case_needs (workspace_id, type, kind, title, status, owner_side, sort_order) VALUES ($1::uuid, 'requisito', 'accesso', $2, $3, $4, $5) RETURNING id`,
      [ids.ws, `Informazione inventata ${name}`, status, side, order],
    );
    order += 10;
    await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [row.id, ids.uc]);
    state.needs.set(name, String(row.id));
  }
  const t = await ensureFromUseCaseTemplate(exec!);
  assert.ok(t.ok);
  const created = await createCaseFromTemplate(exec!, { workspaceId: ids.ws, template: { templateId: t.value.id }, actorUserId: ids.lead, code: `XX-${suffix.toUpperCase()}`, title: "Prova lato", portfolioUseCaseId: ids.uc });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  await q(`INSERT INTO uc_case_members (case_id, user_id, role, added_by_user_id) VALUES ($1::uuid, $2::uuid, 'owner_cliente', $3::uuid)`, [state.caseId, ids.client, ids.lead]);
  for (const r of await q(`SELECT id, shared_item_id FROM uc_items WHERE case_id = $1::uuid`, [state.caseId])) {
    const name = [...state.needs].find(([, id]) => id === String(r.shared_item_id))?.[0];
    if (name) state.items.set(name, String(r.id));
  }
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, [ids.lead, ids.client]);
});

const status = async () => String((await q(`SELECT status FROM uc_cases WHERE id = $1::uuid`, [state.caseId]))[0].status) as never;
const list = async (v: UcViewer) => {
  const page = await loadQuestionsPage(exec!, v, { searchParams: { vista: "tutte", indispensabili: "no", q: "need." }, status: await status(), now: new Date() });
  assert.ok(page);
  return page;
};

test("the owner's case: a client person sees 5 questions in the list, the panel and the counters; Lateral Space sees 11", opts, async () => {
  const [lead, owner] = [await ls(), await client()];
  const forLs = await list(lead);
  const forClient = await list(owner);
  assert.equal(forLs.total, 11);
  assert.equal(forClient.total, 5);
  assert.equal(forClient.rows.length, 5);
  // The panel and the question page: an LS-only question does not reach the client at all.
  assert.equal(await loadItemDetail(exec!, owner, state.items.get("ls.1")!), null);
  assert.ok(await loadItemDetail(exec!, owner, state.items.get("cliente.1")!));
  assert.ok(await loadItemDetail(exec!, owner, state.items.get("insieme.1")!));
  assert.ok(await loadItemDetail(exec!, lead, state.items.get("ls.1")!));
  // Panoramica: «N di M indispensabili» and topics.
  const overviewLs = await loadOverview(exec!, { workspaceId: ids.ws, caseId: state.caseId, audience: "ls" });
  const overviewClient = await loadOverview(exec!, { workspaceId: ids.ws, caseId: state.caseId, audience: "cliente", clientView: true });
  assert.equal(overviewLs?.required.length, 11);
  assert.equal(overviewLs?.required.filter((r) => r.ok).length, 5, "LS counters unchanged: 5 di 11");
  assert.equal(overviewClient?.required.length, 5);
  assert.equal(overviewClient?.required.filter((r) => r.ok).length, 3, "client: 3 di 5 (cliente.1, cliente.2, insieme.1)");
  // The header «N di M» and the readiness.
  const headerLs = await loadCaseHeader(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.lead, roles: ["ls_lead"], viewerIsLs: true });
  const headerClient = await loadCaseHeader(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.client, roles: ["owner_cliente"], viewerIsLs: false });
  assert.deepEqual([headerLs?.progress?.ok, headerLs?.progress?.required], [5, 11]);
  assert.deepEqual([headerClient?.progress?.ok, headerClient?.progress?.required], [3, 5]);
  assert.equal((await loadCaseReadiness(exec!, ids.ws, state.caseId))?.readiness.G1.required, 11);
  assert.equal((await loadCaseReadiness(exec!, ids.ws, state.caseId, new Date(), { clientView: true }))?.readiness.G1.required, 5);
  // Serialised props: no LS-only title in what the server gives the client's pages.
  const serialised = JSON.stringify([forClient, overviewClient, headerClient]);
  assert.doesNotMatch(serialised, /Informazione inventata ls\./);
  assert.match(JSON.stringify(forLs), /Informazione inventata ls\.6/);
});

test("the side changing in «Cosa serve» moves the question in or out of the client's view; no side counts as visible", opts, async () => {
  const owner = await client();
  await q(`UPDATE use_case_needs SET owner_side = 'cliente' WHERE id = $1::uuid`, [state.needs.get("ls.6")]);
  assert.equal((await list(owner)).total, 6);
  await q(`UPDATE use_case_needs SET owner_side = NULL WHERE id = $1::uuid`, [state.needs.get("ls.6")]);
  assert.equal((await list(owner)).total, 6, "a null side is visible to the client");
  await q(`UPDATE use_case_needs SET owner_side = 'fornitore' WHERE id = $1::uuid`, [state.needs.get("ls.6")]);
  assert.equal((await list(owner)).total, 5, "a supplier's item is for Lateral Space only");
  await q(`UPDATE use_case_needs SET owner_side = 'lateral_space' WHERE id = $1::uuid`, [state.needs.get("ls.6")]);
  assert.equal((await list(owner)).total, 5);
  assert.equal((await list(await ls())).total, 11);
});

test("no LS-only question in the client's export or snapshot; Lateral Space gets them all", opts, async () => {
  const draft = await loadExportSnapshot(exec!, { workspaceId: ids.ws, caseId: state.caseId, version: { kind: "bozza" }, clientView: true });
  assert.ok(draft.ok, draft.ok ? "" : draft.message);
  const keys = await lsOnlyItemKeys(exec!, state.caseId);
  assert.equal(keys.size, 6);
  const forClient = snapshotForViewer(draft.value, { roles: ["owner_cliente"], lsOnlyKeys: keys });
  assert.equal(forClient.items.length, 5);
  assert.ok(forClient.items.every((i) => !keys.has(i.key)));
  assert.doesNotMatch(JSON.stringify(forClient), /Informazione inventata ls\./);
  assert.equal(draft.value.gate?.required, 5, "the client's draft counts only what they see");
  const full = await loadExportSnapshot(exec!, { workspaceId: ids.ws, caseId: state.caseId, version: { kind: "bozza" } });
  assert.ok(full.ok);
  assert.equal(snapshotForViewer(full.value, { roles: ["ls_lead"], lsOnlyKeys: keys }).items.length, 11, "an LS role always gets everything");
  assert.equal(full.value.gate?.required, 11);
});
