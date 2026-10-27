import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { addCaseMember, commandContextFor, createCase, loadUserContext, type UcCommandContext } from "../db/queries/uc-cases.ts";
import { recordLsAnswer } from "../db/queries/uc-items.ts";
import {
  anonymizeContact,
  approveDelegation,
  assignItems,
  copyRequestLink,
  createContact,
  createRequest,
  extendExpiry,
  listCaseRequests,
  listContacts,
  remindRequest,
  requestConfirmation,
  revokeAllLinks,
  revokeRequest,
  sendRequest,
  sendRequests,
  updateContact,
} from "../db/queries/uc-requests.ts";
import { assignRoleQuestions, loadCaseSettings, loadPeopleView, loadStatusOptions, reassignContactQuestions, updateCaseSettings } from "../db/queries/uc-people-view.ts";
import { planTemplateLoad } from "./template/load.ts";
import { PAUSED_LINK_TEXT, clientPeopleRows, lsPeopleRows, peopleHaveSendWork, personPendingText, requestDetailLines } from "./views/people.ts";

// Opt-in integration suite for the internal request commands (PIANO §5.3, §5.4, §7.1),
// on the isolated local harness only. Same guard as commands.integration.test.ts:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/requests.integration.test.ts
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
const num = (v: unknown) => Number(v);

const LS_DOMAINS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), lead: randomUUID(), analyst: randomUUID(), owner: randomUUID(), mcp: randomUUID(), linked: randomUUID(), moved: randomUUID() };
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state = {
  caseId: "",
  items: new Map<string, string>(),
  contactCosts: "",
  contactSystems: "",
  contactService: "",
  contactColleague: "",
  requestCosts: "",
  requestCosts2: "",
  requestSystems: "",
  requestDelegation: "",
  draftService: "",
};

async function ctxFor(userId: string): Promise<UcCommandContext> {
  const r = await commandContextFor(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId, lsDomains: LS_DOMAINS });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

const item = (key: string) => {
  const id = state.items.get(key);
  assert.ok(id, `item ${key}`);
  return id;
};

/** Voci che si possono chiedere a un referente, calcolate dal database. */
async function requestableFor(contactId: string): Promise<string[]> {
  const rows = await q(
    `SELECT i.id FROM uc_items i
     WHERE i.case_id = $1::uuid AND i.assignee_contact_id = $2::uuid AND i.deleted_at IS NULL AND i.response_type IS NOT NULL
       AND i.status IN ('da_chiedere', 'mancante', 'parziale', 'bloccata')
       AND NOT EXISTS (SELECT 1 FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id WHERE ib.item_id = i.id AND b.status IN ('attivo', 'permanente'))
       AND NOT EXISTS (SELECT 1 FROM uc_request_items ri WHERE ri.item_id = i.id AND ri.state IN ('da_fare', 'bozza', 'inviata'))
     ORDER BY i.id`,
    [state.caseId, contactId],
  );
  return rows.map((r) => String(r.id));
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova richieste', $2)`, [ids.org, `uc-req-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova richieste')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $4, now()), ($2::uuid, $5, now()), ($3::uuid, $6, now())`, [
    ids.lead,
    ids.analyst,
    ids.owner,
    `req-lead-${suffix}@ls.test`,
    `req-analista-${suffix}@ls.test`,
    `req-owner-${suffix}@cliente.test`,
  ]);
  await q(
    `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $4::uuid, 'transformation_lead'), ($2::uuid, $4::uuid, 'analyst'), ($3::uuid, $4::uuid, 'contributor')`,
    [ids.lead, ids.analyst, ids.owner, ids.org],
  );
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.richieste_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const lead = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, { workspaceId: ids.ws, user: lead!, canReviewWorkspacePortfolio: true, input: { templateId: loaded.value.templateId, code: `req-${suffix}`, title: "Caso delle richieste" } });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  for (const r of await q(`SELECT id, key FROM uc_items WHERE case_id = $1::uuid`, [state.caseId])) state.items.set(String(r.key), String(r.id));
  const leadCtx = await ctxFor(ids.lead);
  for (const [userId, role] of [
    [ids.analyst, "ls_analista"],
    [ids.owner, "owner_cliente"],
  ] as const) {
    const r = await addCaseMember(exec!, leadCtx, { userId, role });
    assert.ok(r.ok, r.ok ? "" : r.message);
  }
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)`, [ids.lead, ids.analyst, ids.owner, ids.linked, ids.moved]);
});

test("referents: client people only, unique email per workspace, the Owner adds colleagues", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const ls = await createContact(exec!, lead, { displayName: "Consulente", email: `consulente-${suffix}@ls.test` });
  assert.equal(ls.ok ? null : ls.code, "referente_lateral_space");
  const costs = await createContact(exec!, lead, { displayName: "Referente costi", roleLabel: "Controllo di gestione", templateRoleKey: "controllo_gestione", email: `costi-${suffix}@cliente.test` });
  assert.ok(costs.ok, costs.ok ? "" : costs.message);
  state.contactCosts = costs.value.contactId;
  const dup = await createContact(exec!, lead, { displayName: "Doppione", email: `COSTI-${suffix}@cliente.test` });
  assert.equal(dup.ok ? null : dup.code, "email_in_uso");
  const owner = await ctxFor(ids.owner);
  const systems = await createContact(exec!, owner, { displayName: "Referente sistemi", roleLabel: "Sistemi", templateRoleKey: "referente_sistemi", phone: "+39 333 1234567" });
  assert.ok(systems.ok, systems.ok ? "" : systems.message);
  state.contactSystems = systems.value.contactId;
  const analyst = await ctxFor(ids.analyst);
  const refused = await createContact(exec!, analyst, { displayName: "Altro" });
  assert.equal(refused.ok ? null : refused.code, "attore_non_ammesso");
  const events = await q(`SELECT payload::text AS p FROM uc_events WHERE case_id = $1::uuid AND event_type = 'referente.creato'`, [state.caseId]);
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => !String(e.p).includes("@") && !String(e.p).includes("Referente")), "no names or emails in the audit");
});

test("assignment: in bulk by role, or to the referent proposed by the role", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const costRole = num((await one(`SELECT count(*) AS n FROM uc_items WHERE case_id = $1::uuid AND owner_role_key = 'controllo_gestione'`, [state.caseId])).n);
  const byRole = await assignItems(exec!, lead, { mode: "ruolo", roleKey: "controllo_gestione", contactId: state.contactCosts });
  assert.ok(byRole.ok, byRole.ok ? "" : byRole.message);
  assert.equal(byRole.value.assigned, costRole);
  const proposed = await assignItems(exec!, lead, { mode: "proposta" });
  assert.ok(proposed.ok, proposed.ok ? "" : proposed.message);
  const systems = await q(`SELECT assignee_contact_id FROM uc_items WHERE case_id = $1::uuid AND owner_role_key = 'referente_sistemi'`, [state.caseId]);
  assert.ok(systems.length > 0 && systems.every((r) => r.assignee_contact_id === state.contactSystems));
  assert.ok(proposed.value.skipped.some((s) => s.code === "nessun_referente_per_ruolo"), "roles without a referent are skipped");
  const audited = num((await one(`SELECT count(*) AS n FROM uc_events WHERE case_id = $1::uuid AND event_type = 'voce.assegnata'`, [state.caseId])).n);
  assert.equal(audited, byRole.value.assigned + proposed.value.assigned);
  const owner = await ctxFor(ids.owner);
  const ownerByRole = await assignItems(exec!, owner, { mode: "ruolo", roleKey: "controllo_gestione", contactId: state.contactCosts });
  assert.equal(ownerByRole.ok ? null : ownerByRole.code, "attore_non_ammesso");
});

test("send: one request per referent, items asked, case in raccolta, email queued without a token", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const expected = await requestableFor(state.contactCosts);
  assert.ok(expected.length > 0);
  const sent = await sendRequests(exec!, lead, { contactIds: [state.contactCosts], message: "Grazie per il vostro aiuto." });
  assert.ok(sent.ok, sent.ok ? "" : sent.message);
  assert.equal(sent.value.requests.length, 1);
  assert.equal(sent.value.requests[0].items, expected.length);
  assert.equal(sent.value.caseStarted, true);
  state.requestCosts = sent.value.requests[0].requestId;
  assert.equal(String((await one(`SELECT status FROM uc_cases WHERE id = $1::uuid`, [state.caseId])).status), "raccolta");
  const req = await one(
    `SELECT status, channel, share_epoch, acting_role_key, expires_at > now() + interval '29 days' AND expires_at <= now() + interval '720 hours' AS ttl_ok, next_reminder_at IS NOT NULL AS reminder
     FROM uc_requests WHERE id = $1::uuid`,
    [state.requestCosts],
  );
  assert.deepEqual([req.status, req.channel, num(req.share_epoch), req.acting_role_key, req.ttl_ok, req.reminder], ["inviata", "email", 0, "controllo_gestione", true, true]);
  const asked = await q(`SELECT status FROM uc_items WHERE id = ANY($1::uuid[])`, [expected]);
  assert.ok(asked.every((r) => r.status === "chiesta"));
  const queued = await one(`SELECT status, template_key, dedupe_key, payload::text AS p FROM uc_notifications WHERE request_id = $1::uuid`, [state.requestCosts]);
  assert.equal(queued.template_key, "richiesta_inviata");
  assert.equal(queued.status, "in_coda");
  assert.match(String(queued.dedupe_key), new RegExp(`^richiesta:${state.requestCosts}:0:\\d{4}-\\d{2}-\\d{2}$`));
  assert.doesNotMatch(String(queued.p), /ucr_/);
  assert.equal(num((await one(`SELECT count(*) AS n FROM uc_request_tokens WHERE request_id = $1::uuid`, [state.requestCosts])).n), 0, "the dispatch issues the token");
  const again = await sendRequests(exec!, lead, { contactIds: [state.contactCosts] });
  assert.equal(again.ok ? null : again.code, "nessuna_voce");
});

test("copy link: a fresh token each time, stored only as sha256 with who copied it; never for approval links", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const copied = await copyRequestLink(exec!, lead, { requestId: state.requestCosts });
  assert.ok(copied.ok, copied.ok ? "" : copied.message);
  const token = copied.value.path.slice(3);
  const row = await one(`SELECT token_hash, token_prefix, issued_for, issued_by_user_id FROM uc_request_tokens WHERE request_id = $1::uuid`, [state.requestCosts]);
  assert.equal(row.token_hash, createHash("sha256").update(token).digest("hex"));
  assert.equal(row.token_prefix, token.slice(0, 12));
  assert.deepEqual([row.issued_for, row.issued_by_user_id], ["copia", ids.lead]);
  for (const table of ["uc_events", "uc_notifications"]) {
    const leaked = num((await one(`SELECT count(*) AS n FROM ${table} WHERE payload::text LIKE '%' || $1 || '%'`, [token])).n);
    assert.equal(leaked, 0, `no clear token in ${table}`);
  }
  const second = await copyRequestLink(exec!, lead, { requestId: state.requestCosts });
  assert.ok(second.ok);
  assert.notEqual(second.value.path, copied.value.path);
  const analyst = await ctxFor(ids.analyst);
  const refused = await copyRequestLink(exec!, analyst, { requestId: state.requestCosts });
  assert.equal(refused.ok ? null : refused.code, "attore_non_ammesso");
  const approval = randomUUID();
  await q(
    `INSERT INTO uc_requests (id, case_id, contact_id, purpose, share_epoch, status, channel, sent_at, expires_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 'approvazioni', 0, 'inviata', 'email', now(), now() + interval '30 days')`,
    [approval, state.caseId, state.contactCosts],
  );
  const noCopy = await copyRequestLink(exec!, lead, { requestId: approval });
  assert.equal(noCopy.ok ? null : noCopy.code, "link_approvazione");
  assert.equal(num((await one(`SELECT count(*) AS n FROM uc_request_tokens WHERE request_id = $1::uuid`, [approval])).n), 0);
  const clientView = await listCaseRequests(exec!, { workspaceId: ids.ws, caseId: state.caseId, audience: "cliente" });
  assert.ok(clientView.every((r) => r.purpose === "raccolta" && r.detail === null), "clients see only statuses, never approval links");
  assert.ok(clientView.some((r) => r.statusLabel === "In attesa"));
});

test("single revocation: links dead, asked items back to da_chiedere with the reason, queue cancelled", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const asked = (await q(`SELECT item_id FROM uc_request_items WHERE request_id = $1::uuid AND state = 'da_fare'`, [state.requestCosts])).map((r) => String(r.item_id));
  const revoked = await revokeRequest(exec!, lead, { requestId: state.requestCosts, reason: "Referente sbagliato" });
  assert.ok(revoked.ok, revoked.ok ? "" : revoked.message);
  assert.equal(revoked.value.reopened, asked.length);
  const items = await q(`SELECT status, status_reason FROM uc_items WHERE id = ANY($1::uuid[])`, [asked]);
  assert.ok(items.every((r) => r.status === "da_chiedere" && r.status_reason === "Referente sbagliato"));
  const req = await one(`SELECT status, revoked_at IS NOT NULL AS revoked FROM uc_requests WHERE id = $1::uuid`, [state.requestCosts]);
  assert.deepEqual([req.status, req.revoked], ["revocata", true]);
  assert.equal(num((await one(`SELECT count(*) AS n FROM uc_request_tokens WHERE request_id = $1::uuid AND revoked_at IS NULL`, [state.requestCosts])).n), 0);
  assert.equal(num((await one(`SELECT count(*) AS n FROM uc_request_items WHERE request_id = $1::uuid AND state <> 'riassegnata'`, [state.requestCosts])).n), 0);
  assert.equal(String((await one(`SELECT status FROM uc_notifications WHERE request_id = $1::uuid`, [state.requestCosts])).status), "annullata");
  const again = await revokeRequest(exec!, lead, { requestId: state.requestCosts });
  assert.equal(again.ok ? null : again.code, "richiesta_chiusa");
});

test("a draft for a referent without email is sent by copying its link", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const expected = await requestableFor(state.contactSystems);
  assert.ok(expected.length > 0);
  const draft = await createRequest(exec!, lead, { contactId: state.contactSystems });
  assert.ok(draft.ok, draft.ok ? "" : draft.message);
  assert.equal(draft.value.items, expected.length);
  state.requestSystems = draft.value.requestId;
  const asDraft = await one(`SELECT status, expires_at FROM uc_requests WHERE id = $1::uuid`, [state.requestSystems]);
  assert.deepEqual([asDraft.status, asDraft.expires_at], ["bozza", null]);
  const copied = await copyRequestLink(exec!, lead, { requestId: state.requestSystems });
  assert.ok(copied.ok, copied.ok ? "" : copied.message);
  assert.equal(copied.value.sent, true);
  const sent = await one(`SELECT status, channel FROM uc_requests WHERE id = $1::uuid`, [state.requestSystems]);
  assert.deepEqual([sent.status, sent.channel], ["inviata", "link_manuale"]);
  assert.equal(num((await one(`SELECT count(*) AS n FROM uc_notifications WHERE request_id = $1::uuid`, [state.requestSystems])).n), 0);
  const items = await q(`SELECT status FROM uc_items WHERE id = ANY($1::uuid[])`, [expected]);
  assert.ok(items.every((r) => r.status === "chiesta"));
});

test("extension is capped at 30 days; a resend needs an email and goes at most once a day", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const far = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const extended = await extendExpiry(exec!, lead, { requestId: state.requestSystems, expiresAt: far });
  assert.ok(extended.ok, extended.ok ? "" : extended.message);
  assert.equal(extended.value.clamped, true);
  const ttl = await one(`SELECT expires_at <= now() + interval '720 hours' AS ok FROM uc_requests WHERE id = $1::uuid`, [state.requestSystems]);
  assert.equal(ttl.ok, true);
  const noEmail = await remindRequest(exec!, lead, { requestId: state.requestSystems });
  assert.equal(noEmail.ok ? null : noEmail.code, "email_mancante");
  const sent = await sendRequests(exec!, lead, { contactIds: [state.contactCosts] });
  assert.ok(sent.ok, sent.ok ? "" : sent.message);
  state.requestCosts2 = sent.value.requests[0].requestId;
  const sameDay = await remindRequest(exec!, lead, { requestId: state.requestCosts2 });
  assert.equal(sameDay.ok ? null : sameDay.code, "gia_inviata_oggi");
});

test("delegation approval: a pending delegation is not copied; approval sends it and hands the items to the colleague", opts, async () => {
  const owner = await ctxFor(ids.owner);
  const colleague = await createContact(exec!, owner, { displayName: "Collega nuovo", email: `collega-${suffix}@nuovo.test` });
  assert.ok(colleague.ok, colleague.ok ? "" : colleague.message);
  state.contactColleague = colleague.value.contactId;
  const delegated = String((await one(`SELECT item_id FROM uc_request_items WHERE request_id = $1::uuid AND state = 'da_fare' ORDER BY item_id LIMIT 1`, [state.requestCosts2])).item_id);
  // What the public API does on «Chiedi a un collega» with an unknown domain (WP7b): a draft to approve.
  state.requestDelegation = randomUUID();
  await q(
    `INSERT INTO uc_requests (id, case_id, contact_id, purpose, share_epoch, acting_role_key, status, channel, delegated_from_request_id, delegated_by_contact_id, delegation_depth)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'raccolta', 0, 'controllo_gestione', 'bozza', 'email', $4::uuid, $5::uuid, 1)`,
    [state.requestDelegation, state.caseId, state.contactColleague, state.requestCosts2, state.contactCosts],
  );
  await q(`UPDATE uc_request_items SET state = 'delegata' WHERE request_id = $1::uuid AND item_id = $2::uuid`, [state.requestCosts2, delegated]);
  await q(`INSERT INTO uc_request_items (case_id, request_id, item_id, state) VALUES ($1::uuid, $2::uuid, $3::uuid, 'da_fare')`, [state.caseId, state.requestDelegation, delegated]);
  const lead = await ctxFor(ids.lead);
  const copy = await copyRequestLink(exec!, lead, { requestId: state.requestDelegation });
  assert.equal(copy.ok ? null : copy.code, "delega_da_approvare");
  const analyst = await ctxFor(ids.analyst);
  const refused = await approveDelegation(exec!, analyst, { requestId: state.requestDelegation });
  assert.equal(refused.ok ? null : refused.code, "attore_non_ammesso");
  const approved = await approveDelegation(exec!, lead, { requestId: state.requestDelegation });
  assert.ok(approved.ok, approved.ok ? "" : approved.message);
  const req = await one(`SELECT status, expires_at IS NOT NULL AS has_expiry, share_epoch FROM uc_requests WHERE id = $1::uuid`, [state.requestDelegation]);
  assert.deepEqual([req.status, req.has_expiry, num(req.share_epoch)], ["inviata", true, 0]);
  const moved = await one(`SELECT status, assignee_contact_id FROM uc_items WHERE id = $1::uuid`, [delegated]);
  assert.deepEqual([moved.status, moved.assignee_contact_id], ["chiesta", state.contactColleague]);
  const email = await one(`SELECT template_key, dedupe_key FROM uc_notifications WHERE request_id = $1::uuid`, [state.requestDelegation]);
  assert.deepEqual([email.template_key, email.dedupe_key], ["delega", `delega:${state.requestDelegation}`]);
  const twice = await approveDelegation(exec!, lead, { requestId: state.requestDelegation });
  assert.equal(twice.ok ? null : twice.code, "delega_gia_decisa");
});

test("confirmation: an item filled in by Lateral Space goes back to the owner's role and is asked again", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const service = await createContact(exec!, lead, { displayName: "Referente servizio", roleLabel: "Servizio clienti", templateRoleKey: "resp_servizio", email: `servizio-${suffix}@cliente.test` });
  assert.ok(service.ok, service.ok ? "" : service.message);
  state.contactService = service.value.contactId;
  const key = "q.servizio.02";
  const assigned = await assignItems(exec!, lead, { mode: "voci", itemIds: [item(key)], contactId: state.contactService });
  assert.ok(assigned.ok, assigned.ok ? "" : assigned.message);
  const recorded = await recordLsAnswer(exec!, lead, { itemId: item(key), value: "120", sourceKind: "documento", sourceRef: "Report mensile del servizio" });
  assert.ok(recorded.ok, recorded.ok ? "" : recorded.message);
  const confirmed = await requestConfirmation(exec!, lead, { itemIds: [item(key)] });
  assert.ok(confirmed.ok, confirmed.ok ? "" : confirmed.message);
  assert.equal(confirmed.value.requests.length, 1);
  assert.equal(String((await one(`SELECT status FROM uc_items WHERE id = $1::uuid`, [item(key)])).status), "chiesta");
  const ri = await one(`SELECT ri.state, r.status, r.acting_role_key FROM uc_request_items ri JOIN uc_requests r ON r.id = ri.request_id WHERE ri.item_id = $1::uuid AND ri.state = 'da_fare'`, [item(key)]);
  assert.deepEqual([ri.status, ri.acting_role_key], ["inviata", "resp_servizio"]);
  // Drafts written by Lateral Space survive «Revoca tutti i link».
  const draft = await createRequest(exec!, lead, { contactId: state.contactService, itemIds: [item("q.servizio.03")] });
  assert.equal(draft.ok ? null : draft.code, "referente_assente");
  const assignedDraft = await assignItems(exec!, lead, { mode: "voci", itemIds: [item("q.servizio.03")], contactId: state.contactService });
  assert.ok(assignedDraft.ok);
  const draft2 = await createRequest(exec!, lead, { contactId: state.contactService, itemIds: [item("q.servizio.03")] });
  assert.ok(draft2.ok, draft2.ok ? "" : draft2.message);
  state.draftService = draft2.value.requestId;
});

test("revoke all links: new epoch, open requests revoked, asked items back, MCP tokens of the case revoked, drafts kept", opts, async () => {
  await q(
    `INSERT INTO workspace_integration_tokens (id, workspace_id, label, token_hash, token_prefix, scopes) VALUES ($1::uuid, $2::uuid, 'Sviluppo', $3, 'ub_mcp_prova', $4::jsonb)`,
    [ids.mcp, ids.ws, createHash("sha256").update(`mcp-${suffix}`).digest("hex"), JSON.stringify(["cases:read", `uc:case:${state.caseId}`])],
  );
  const asked = (await q(`SELECT id FROM uc_items WHERE case_id = $1::uuid AND status = 'chiesta'`, [state.caseId])).map((r) => String(r.id));
  assert.ok(asked.length > 0);
  const lead = await ctxFor(ids.lead);
  const done = await revokeAllLinks(exec!, lead, {});
  assert.ok(done.ok, done.ok ? "" : done.message);
  assert.equal(done.value.shareEpoch, 1);
  assert.equal(done.value.reopened, asked.length);
  assert.equal(num((await one(`SELECT share_epoch FROM uc_cases WHERE id = $1::uuid`, [state.caseId])).share_epoch), 1);
  const items = await q(`SELECT status FROM uc_items WHERE id = ANY($1::uuid[])`, [asked]);
  assert.ok(items.every((r) => r.status === "da_chiedere"));
  const open = num((await one(`SELECT count(*) AS n FROM uc_requests WHERE case_id = $1::uuid AND status NOT IN ('revocata', 'scaduta', 'bozza')`, [state.caseId])).n);
  assert.equal(open, 0);
  assert.equal(num((await one(`SELECT count(*) AS n FROM uc_request_tokens WHERE case_id = $1::uuid AND revoked_at IS NULL`, [state.caseId])).n), 0);
  assert.notEqual((await one(`SELECT revoked_at FROM workspace_integration_tokens WHERE id = $1::uuid`, [ids.mcp])).revoked_at, null);
  assert.equal(String((await one(`SELECT status FROM uc_requests WHERE id = $1::uuid`, [state.draftService])).status), "bozza");
  const sent = await sendRequest(exec!, lead, { requestId: state.draftService });
  assert.ok(sent.ok, sent.ok ? "" : sent.message);
  assert.equal(num((await one(`SELECT share_epoch FROM uc_requests WHERE id = $1::uuid`, [state.draftService])).share_epoch), 1, "a draft sent later joins the new epoch");
  assert.equal(num((await one(`SELECT count(*) AS n FROM uc_events WHERE case_id = $1::uuid AND event_type = 'link.revocati_tutti'`, [state.caseId])).n), 1);
});

test("referent lifecycle: an email change revokes old links; no anonymization while a link is open", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const busy = await anonymizeContact(exec!, lead, { contactId: state.contactService });
  assert.equal(busy.ok ? null : busy.code, "richieste_aperte");
  const changed = await updateContact(exec!, lead, { contactId: state.contactService, email: `servizio-nuovo-${suffix}@cliente.test` });
  assert.ok(changed.ok, changed.ok ? "" : changed.message);
  assert.equal(changed.value.linksRevoked, true);
  const anonymized = await anonymizeContact(exec!, lead, { contactId: state.contactCosts });
  assert.ok(anonymized.ok, anonymized.ok ? "" : anonymized.message);
  const row = await one(`SELECT display_name, email, is_active, anonymized_at IS NOT NULL AS anon FROM uc_contacts WHERE id = $1::uuid`, [state.contactCosts]);
  assert.deepEqual([row.display_name, row.email, row.is_active, row.anon], ["Controllo di gestione", null, false, true]);
  const edit = await updateContact(exec!, lead, { contactId: state.contactCosts, displayName: "Di nuovo" });
  assert.equal(edit.ok ? null : edit.code, "contatto_anonimizzato");
  const lsView = await listContacts(exec!, { workspaceId: ids.ws, caseId: state.caseId, audience: "lateral_space" });
  const clientView = await listContacts(exec!, { workspaceId: ids.ws, caseId: state.caseId, audience: "cliente" });
  assert.ok(lsView.some((c) => c.email !== null));
  assert.ok(clientView.every((c) => c.email === null && c.phone === null && c.openItems === null && c.assigned === null), "no per-person data for client roles");
  assert.ok(lsView.every((c) => typeof c.openItems === "number"));
});

test("referent lifecycle: an email change drops an account link that no longer matches the email; other edits keep it", opts, async () => {
  // A contact linked to an account (as the use case hub links the referents it creates).
  const lead = await ctxFor(ids.lead);
  const linkedEmail = `collegato-${suffix}@cliente.test`;
  await q(`INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $2, now())`, [ids.linked, linkedEmail]);
  const contactId = randomUUID();
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email, user_id) VALUES ($1::uuid, $2::uuid, 'Referente collegato', $3, $4::uuid)`, [contactId, ids.ws, linkedEmail, ids.linked]);
  const linkOf = async (id: string) => (await one(`SELECT user_id::text AS user_id FROM uc_contacts WHERE id = $1::uuid`, [id]))?.user_id ?? null;
  const renamed = await updateContact(exec!, lead, { contactId, displayName: "Referente rinominato" });
  assert.ok(renamed.ok, renamed.ok ? "" : renamed.message);
  assert.equal(await linkOf(contactId), ids.linked, "a change that is not the email keeps the link");
  // The email becomes a colleague's: the contact no longer leads to the account of before.
  const changed = await updateContact(exec!, lead, { contactId, email: `collega-${suffix}@cliente.test` });
  assert.ok(changed.ok, changed.ok ? "" : changed.message);
  assert.equal(await linkOf(contactId), null, "the old link is gone");
  // The account itself moved to the new address first: the link still matches and stays.
  const oldEmail = `prima-${suffix}@cliente.test`;
  const newEmail = `dopo-${suffix}@cliente.test`;
  await q(`INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $2, now())`, [ids.moved, newEmail]);
  const movedId = randomUUID();
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email, user_id) VALUES ($1::uuid, $2::uuid, 'Referente spostato', $3, $4::uuid)`, [movedId, ids.ws, oldEmail, ids.moved]);
  const followed = await updateContact(exec!, lead, { contactId: movedId, email: newEmail.toUpperCase() });
  assert.ok(followed.ok, followed.ok ? "" : followed.message);
  assert.equal(await linkOf(movedId), ids.moved, "the account has the new email: the link stays");
});

// ── Persone e Impostazioni (WP6, DESIGN §3.9 e §3.13.3) ───────────────

test("Persone: one list by name for Lateral Space; for the client nothing per person (art. 15.4)", opts, async () => {
  const ls = await loadPeopleView(exec!, { workspaceId: ids.ws, caseId: state.caseId, audience: "lateral_space" });
  assert.ok(ls);
  const rows = lsPeopleRows(ls);
  const listed = rows.filter((r) => !r.anonymized).map((r) => r.name);
  assert.deepEqual(listed, [...listed].sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" })), "alphabetical, never by open questions");
  assert.equal(rows.at(-1)?.anonymized, true, "the anonymized referent goes last, without a name");
  const service = rows.find((r) => r.id === state.contactService);
  assert.equal(service?.status, "link_attivo", "the draft sent after «Revoca tutti i link» is live");
  const dbCounts = await one(
    `SELECT count(*)::int AS assigned, count(*) FILTER (WHERE status NOT IN ('validata', 'non_applicabile'))::int AS open FROM uc_items WHERE case_id = $1::uuid AND assignee_contact_id = $2::uuid AND deleted_at IS NULL`,
    [state.caseId, state.contactSystems],
  );
  const systems = ls.contacts.find((c) => c.id === state.contactSystems);
  assert.deepEqual(systems?.counts && [systems.counts.assigned, systems.counts.open], [num(dbCounts.assigned), num(dbCounts.open)]);
  const groups = await q(
    `SELECT owner_role_key, count(*) FILTER (WHERE assignee_contact_id IS NULL)::int AS n FROM uc_items
     WHERE case_id = $1::uuid AND deleted_at IS NULL AND owner_role_key IS NOT NULL AND response_type IS NOT NULL
       AND (request_module_key IS NOT NULL OR kind IN ('fonte', 'documento'))
       AND status IN ('da_chiedere', 'mancante', 'parziale', 'in_verifica', 'bloccata')
     GROUP BY owner_role_key`,
    [state.caseId],
  );
  for (const g of groups) assert.equal(ls.roleGroups.find((x) => x.roleKey === g.owner_role_key)?.unassigned, num(g.n), String(g.owner_role_key));

  const client = await loadPeopleView(exec!, { workspaceId: ids.ws, caseId: state.caseId, audience: "cliente" });
  assert.ok(client);
  assert.ok(client.contacts.every((c) => c.counts === null && c.email === null && c.phone === null), "no counts or contact details for client roles");
  assert.ok(client.requests.every((r) => r.detail === null && r.purpose === "raccolta" && r.status !== "bozza" && r.status !== "revocata"));
  const clientRows = clientPeopleRows(client);
  assert.ok(clientRows.length > 0);
  for (const r of clientRows) assert.deepEqual(Object.keys(r).sort(), ["id", "kind", "name", "roleText", "signs", "status"]);
  assert.ok(!clientRows.some((r) => r.id === state.contactCosts), "anonymized people are not shown to the client");
  assert.equal(clientRows.find((r) => r.id === state.contactService)?.status, "invitato");
});

test("Persone: the client lead assigns questions without a referent and hands a colleague's questions over", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const owner = await ctxFor(ids.owner);
  const pick = await q(
    `SELECT i.id FROM uc_items i
     WHERE i.case_id = $1::uuid AND i.deleted_at IS NULL AND i.owner_role_key = 'resp_servizio' AND i.response_type IS NOT NULL
       AND (i.request_module_key IS NOT NULL OR i.kind IN ('fonte', 'documento')) AND i.status IN ('da_chiedere', 'mancante', 'parziale')
       AND NOT EXISTS (SELECT 1 FROM uc_request_items ri WHERE ri.item_id = i.id AND ri.state IN ('da_fare', 'bozza', 'inviata'))
     ORDER BY i.key LIMIT 2`,
    [state.caseId],
  );
  assert.equal(pick.length, 2);
  const picked = pick.map((r) => String(r.id));
  const cleared = await assignItems(exec!, lead, { mode: "voci", itemIds: picked, contactId: null });
  assert.ok(cleared.ok, cleared.ok ? "" : cleared.message);
  const colleague = await createContact(exec!, owner, { displayName: "Collega del servizio", templateRoleKey: "resp_servizio", email: `servizio-2-${suffix}@cliente.test` });
  assert.ok(colleague.ok, colleague.ok ? "" : colleague.message);

  const overwrite = await assignRoleQuestions(exec!, owner, { roleKey: "resp_servizio", contactId: colleague.value.contactId, includeAssigned: true });
  assert.equal(overwrite.ok ? null : overwrite.code, "attore_non_ammesso", "only Lateral Space reassigns questions that already have a referent");
  const assigned = await assignRoleQuestions(exec!, owner, { roleKey: "resp_servizio", contactId: colleague.value.contactId });
  assert.ok(assigned.ok, assigned.ok ? "" : assigned.message);
  assert.ok(assigned.value.assigned >= 2);
  const now = await q(`SELECT assignee_contact_id FROM uc_items WHERE id = ANY($1::uuid[])`, [picked]);
  assert.ok(now.every((r) => r.assignee_contact_id === colleague.value.contactId));

  const handed = await reassignContactQuestions(exec!, owner, { fromContactId: colleague.value.contactId, toContactId: state.contactService });
  assert.ok(handed.ok, handed.ok ? "" : handed.message);
  assert.equal(handed.value.assigned, assigned.value.assigned);
  const after = await q(`SELECT assignee_contact_id FROM uc_items WHERE id = ANY($1::uuid[])`, [picked]);
  assert.ok(after.every((r) => r.assignee_contact_id === state.contactService));
  const analyst = await ctxFor(ids.analyst);
  const refused = await reassignContactQuestions(exec!, analyst, { fromContactId: state.contactService, toContactId: colleague.value.contactId });
  assert.equal(refused.ok ? null : refused.code, "attore_non_ammesso");
  const audited = num((await one(`SELECT count(*) AS n FROM uc_events WHERE case_id = $1::uuid AND event_type = 'voce.assegnata' AND target_id = ANY($2::uuid[])`, [state.caseId, picked])).n);
  assert.ok(audited >= 4, `every assignment leaves its event (${audited})`);
});

test("Persone: questions handed over after an open link are pending on that row; a paused dossier keeps the link active", opts, async () => {
  const view = await loadPeopleView(exec!, { workspaceId: ids.ws, caseId: state.caseId, audience: "lateral_space" });
  assert.ok(view);
  const service = lsPeopleRows(view).find((r) => r.id === state.contactService);
  assert.ok(service);
  assert.equal(service.status, "link_attivo");
  assert.ok(service.unsent >= 2, `the handed questions are not in the open link (${service.unsent})`);
  assert.equal(personPendingText(service), `${service.unsent} da inviare`);
  assert.ok(peopleHaveSendWork([], [service]), "«Invia le domande» stays on Persone");

  const before = await one(`SELECT status, status_before_suspension FROM uc_cases WHERE id = $1::uuid`, [state.caseId]);
  await q(`UPDATE uc_cases SET status = 'sospeso', status_before_suspension = $2 WHERE id = $1::uuid`, [state.caseId, before.status]);
  try {
    const paused = await loadPeopleView(exec!, { workspaceId: ids.ws, caseId: state.caseId, audience: "lateral_space" });
    assert.ok(paused);
    const row = lsPeopleRows(paused).find((r) => r.id === state.contactService);
    assert.equal(row?.status, "link_attivo", "paused, not expired");
    const waiting = row?.requests.find((r) => r.status === "inviata" || r.status === "aperta" || r.status === "in_corso");
    assert.ok(waiting?.detail);
    assert.deepEqual([waiting.detail.live, waiting.detail.visible], [false, true]);
    const lines = requestDetailLines(waiting.detail, (iso) => iso?.slice(0, 10) ?? null);
    assert.match(lines[0], / · scade il /, lines[0]);
    assert.ok(lines.includes(PAUSED_LINK_TEXT));
  } finally {
    await q(`UPDATE uc_cases SET status = $2, status_before_suspension = $3 WHERE id = $1::uuid`, [state.caseId, before.status, before.status_before_suspension]);
  }
});

test("Impostazioni: name, sentence, perimeter and levers change with the event; the code never does", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const before = await loadCaseSettings(exec!, { workspaceId: ids.ws, caseId: state.caseId });
  assert.ok(before);
  assert.equal(before.displayCode, before.code, "without the use case code the dossier shows its own");
  assert.equal(before.previousCode, null);
  const analyst = await ctxFor(ids.analyst);
  const refused = await updateCaseSettings(exec!, analyst, { title: "Altro nome" });
  assert.equal(refused.ok ? null : refused.code, "attore_non_ammesso");
  const changed = await updateCaseSettings(exec!, lead, { title: "Caso delle richieste, rivisto", oneLiner: "Una frase sola.", perimeterLabel: "Servizio clienti", levers: ["rischio", "tempo"] });
  assert.ok(changed.ok, changed.ok ? "" : changed.message);
  assert.deepEqual([...changed.value.fields].sort(), ["in_una_frase", "leve", "nome", "perimetro"]);
  const row = await one(`SELECT title, one_liner, perimeter_label, levers::text AS levers, code FROM uc_cases WHERE id = $1::uuid`, [state.caseId]);
  assert.deepEqual([row.title, row.one_liner, row.perimeter_label, row.levers, row.code], ["Caso delle richieste, rivisto", "Una frase sola.", "Servizio clienti", '["tempo", "rischio"]', before.code]);
  const event = await one(`SELECT payload::text AS p FROM uc_events WHERE case_id = $1::uuid AND event_type = 'caso.descrizione_modificata' ORDER BY created_at DESC LIMIT 1`, [state.caseId]);
  assert.deepEqual(JSON.parse(String(event.p)), { blocks: ["nome", "in_una_frase", "perimetro", "leve"] });
  const again = await updateCaseSettings(exec!, lead, { levers: ["tempo", "rischio"] });
  assert.ok(again.ok && again.value.fields.length === 0, "same levers in another order: nothing to save");
  const options = await loadStatusOptions(exec!, lead);
  assert.ok(options?.allowed.includes("sospeso") && options.allowed.includes("chiuso"));
  const analystOptions = await loadStatusOptions(exec!, analyst);
  assert.ok(!analystOptions?.allowed.includes("sospeso"), "only the lead pauses the dossier");
});
