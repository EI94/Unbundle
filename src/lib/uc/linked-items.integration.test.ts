import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { commandContextFor, type UcCommandContext } from "../db/queries/uc-cases.ts";
import { createCaseFromTemplate, ensureFromUseCaseTemplate } from "../db/queries/uc-templates.ts";
import { assignItems, createContact, createRequest, sendRequests } from "../db/queries/uc-requests.ts";
import { recordLsAnswer } from "../db/queries/uc-items.ts";
import { requestItemsInsertSql } from "./sql/request-commands.ts";

// Opt-in suite (docs/dossier/SCHEMA-DI-PARTENZA.md R1): questions born from «Cosa serve» are managed only there.
// Requests, assignments and answers on a linked dossier item are refused with one clear message. Local harness only:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/<copy> UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test src/lib/uc/linked-items.integration.test.ts
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

const MESSAGE = "Questa domanda si aggiorna in «Cosa serve» dello use case.";
const LS_DOMAINS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), lead: randomUUID(), uc: randomUUID() };
const state = { caseId: "", itemId: "", contactId: "" };

async function lead(): Promise<UcCommandContext> {
  const r = await commandContextFor(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId: ids.lead, lsDomains: LS_DOMAINS });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova voci collegate', $2)`, [ids.org, `uc-linked-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova voci collegate')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $2, now())`, [ids.lead, `linked-lead-${suffix}@ls.test`]);
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $2::uuid, 'transformation_lead')`, [ids.lead, ids.org]);
  await q(`INSERT INTO use_cases (id, workspace_id, title, status, portfolio_kind) VALUES ($1::uuid, $2::uuid, 'Use case inventato con una voce', 'accepted', 'use_case_ai')`, [ids.uc, ids.ws]);
  const need = await q(`INSERT INTO use_case_needs (workspace_id, type, kind, title, status, sort_order) VALUES ($1::uuid, 'requisito', 'dato', 'Informazione inventata', 'da_chiedere', 10) RETURNING id`, [ids.ws]);
  await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [need[0].id, ids.uc]);
  const t = await ensureFromUseCaseTemplate(exec!);
  assert.ok(t.ok);
  const created = await createCaseFromTemplate(exec!, { workspaceId: ids.ws, template: { templateId: t.value.id }, actorUserId: ids.lead, code: `XX-${suffix.toUpperCase()}`, title: "Prova voci collegate", portfolioUseCaseId: ids.uc });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  state.itemId = String((await q(`SELECT id FROM uc_items WHERE case_id = $1::uuid`, [state.caseId]))[0].id);
  const contact = await createContact(exec!, await lead(), { displayName: "Referente inventato", email: `referente-${suffix}@cliente.test` });
  assert.ok(contact.ok, contact.ok ? "" : contact.message);
  state.contactId = contact.value.contactId;
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1::uuid`, [ids.lead]);
});

const requestItems = async () => Number((await q(`SELECT count(*) AS n FROM uc_request_items WHERE item_id = $1::uuid`, [state.itemId]))[0].n);

test("a request built from a selection with a linked item is refused, and the item never gets a request item", opts, async () => {
  const ctx = await lead();
  const request = await createRequest(exec!, ctx, { contactId: state.contactId, itemIds: [state.itemId] });
  assert.equal(request.ok, false);
  assert.equal(request.ok ? "" : request.code, "voce_da_cosa_serve");
  assert.equal(request.ok ? "" : request.message, MESSAGE);
  const send = await sendRequests(exec!, ctx, { itemIds: [state.itemId] });
  assert.equal(send.ok ? "" : send.message, MESSAGE);
  assert.equal(await requestItems(), 0);
  assert.equal(Number((await q(`SELECT count(*) AS n FROM uc_requests WHERE case_id = $1::uuid`, [state.caseId]))[0].n), 0, "no request row either");
});

test("assigning or answering a linked item is refused with the same message; the SQL guard holds on its own", opts, async () => {
  const ctx = await lead();
  const assigned = await assignItems(exec!, ctx, { mode: "voci", itemIds: [state.itemId], contactId: state.contactId });
  assert.equal(assigned.ok ? "" : assigned.message, MESSAGE);
  const answered = await recordLsAnswer(exec!, ctx, { itemId: state.itemId, value: { testo: "inventato" }, sourceKind: "lateral_space", sourceRef: "prova inventata" });
  assert.equal(answered.ok ? "" : answered.code, "voce_da_cosa_serve");
  const row = (await q(`SELECT assignee_contact_id FROM uc_items WHERE id = $1::uuid`, [state.itemId]))[0];
  assert.equal(row.assignee_contact_id, null);
  assert.equal(Number((await q(`SELECT count(*) AS n FROM uc_answers WHERE item_id = $1::uuid AND source_kind <> 'import'`, [state.itemId]))[0].n), 0);
  // Even a caller that skips the checks cannot add the request item: the statement itself refuses.
  await assert.rejects(
    () => exec!.batch([requestItemsInsertSql({ caseId: state.caseId, requestId: randomUUID(), contactId: state.contactId, items: [{ id: state.itemId, status: "da_chiedere" }] })]),
    /uc:voce_da_cosa_serve/,
  );
  assert.equal(await requestItems(), 0);
});
