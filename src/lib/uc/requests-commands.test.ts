import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { UcExecutor, UcRow } from "../db/uc-executor.ts";
import type { UcCommandContext } from "../db/queries/uc-cases.ts";
import {
  approveDelegation,
  assignItems,
  copyRequestLink,
  createContact,
  extendExpiry,
  listCaseRequests,
  listContacts,
  remindRequest,
  requestApproval,
  revokeAllLinks,
  revokeRequest,
  sendRequests,
} from "../db/queries/uc-requests.ts";
import type { UcStatement } from "./sql/statement.ts";
import type { CaseRole, CaseStatus } from "./vocab.ts";

// Command-level tests for src/lib/db/queries/uc-requests.ts with a fake executor:
// reads are answered by pattern, every other statement is a write that "succeeds".
// They check permissions, refusals before any write, statement order inside the
// batch and that no clear token or email ever reaches a statement. The same
// commands run against Postgres in requests.integration.test.ts (harness only).

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const CONTACT = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const REQ = "66666666-6666-4666-8666-666666666666";
const PARENT = "77777777-7777-4777-8777-777777777777";
const ITEM_A = "88888888-8888-4888-8888-888888888888";
const ITEM_B = "99999999-9999-4999-8999-999999999999";
const ITEM_C = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEMPLATE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-10-13T08:30:00.000Z");

type Row = Record<string, unknown>;

interface FakeState {
  caseStatus: CaseStatus;
  shareEpoch: number;
  designated: { owner: string | null; privacy: string | null };
  lsEmails: string[];
  contacts: Row[];
  items: Row[];
  request: Row | null;
  notificationExists: boolean;
  delegationsToday: number;
  revokeTargets: Row[];
  liveApproval: string | null;
  listRequests: Row[];
}

function contactRow(over: Row = {}): Row {
  return {
    id: CONTACT,
    display_name: "Referente costi",
    role_label: "Controllo di gestione",
    template_role_key: "controllo_gestione",
    email: "costi@cliente.test",
    phone_e164: null,
    preferred_channel: "email",
    is_active: true,
    anonymized_at: null,
    user_id: null,
    ...over,
  };
}

function itemRow(over: Row = {}): Row {
  return {
    id: ITEM_A,
    key: "q.costi.01",
    kind: "domanda",
    section: "modello_dati",
    status: "da_chiedere",
    status_reason: null,
    priority: "must",
    perimeter: null,
    serves_for: [],
    in_gate_scope: true,
    privacy_class: "nessuna",
    value_visibility: "owner_e_ls",
    response_type: "numero",
    response_config: {},
    owner_role_key: "controllo_gestione",
    assignee_contact_id: CONTACT,
    requires_validity_period: false,
    freshness_days: null,
    stale_at: null,
    current_answer_id: null,
    validated_answer_id: null,
    confirmed_by_contact_id: null,
    responder_user_ids: [],
    token_issuer_user_ids: [],
    blocker_links: [],
    open_clarification: false,
    active_request_id: null,
    last_auto_check_error: false,
    title: "Quanto costa un'ora di lavoro?",
    request_module_key: "m.costi.base",
    blocked: false,
    ...over,
  };
}

function requestRow(over: Row = {}): Row {
  return {
    id: REQ,
    case_id: CASE,
    contact_id: CONTACT,
    purpose: "raccolta",
    status: "inviata",
    share_epoch: 0,
    acting_role_key: "controllo_gestione",
    channel: "email",
    delegated_from_request_id: null,
    delegation_depth: 0,
    sent_at: "2026-10-01T08:00:00.000Z",
    expires_at: "2026-10-31T08:00:00.000Z",
    reminder_count: 0,
    escalated_at: null,
    revoked_at: null,
    contact_email: "costi@cliente.test",
    contact_active: true,
    contact_anonymized: false,
    contact_role_key: "controllo_gestione",
    contact_user_id: null,
    live: true,
    visible: true,
    active_item_ids: [ITEM_A],
    ...over,
  };
}

class FakeDb implements UcExecutor {
  readonly batches: UcStatement[][] = [];
  readonly writes: UcStatement[][] = [];
  readonly s: FakeState;
  constructor(s: FakeState) {
    this.s = s;
  }

  private read(text: string): Row[] | null {
    const s = this.s;
    if (/^SELECT c\.id, c\.workspace_id, c\.organization_id/.test(text)) {
      return [
        {
          id: CASE,
          workspace_id: WS,
          organization_id: null,
          code: "CASO-1",
          title: "Caso di prova",
          status: s.caseStatus,
          status_before_suspension: s.caseStatus === "sospeso" ? "raccolta" : null,
          status_changed_at: "2026-10-01T08:00:00.000Z",
          catalog_revision: 7,
          catalog_version: 0,
          share_epoch: s.shareEpoch,
          settings: {},
          contract_refs: [],
          signers_designation: {
            ...(s.designated.owner ? { owner: { contact_id: s.designated.owner } } : {}),
            ...(s.designated.privacy ? { privacy: { contact_id: s.designated.privacy } } : {}),
          },
          client_owner_contact_id: s.designated.owner,
          client_privacy_approver_contact_id: s.designated.privacy,
          portfolio_use_case_id: null,
          ai_environment_approved: false,
          template_id: TEMPLATE,
          template_version: "1.0.0",
          ls_lead_user_id: LEAD,
        },
      ];
    }
    if (/^SELECT i\.id, i\.key, i\.kind, i\.section, i\.status, i\.status_reason/.test(text)) return s.items;
    if (/^SELECT DISTINCT u\.email FROM uc_case_members/.test(text)) return s.lsEmails.map((email) => ({ email }));
    if (/^SELECT id, display_name, role_label, template_role_key, email, phone_e164, preferred_channel, is_active, anonymized_at, user_id\nFROM uc_contacts/.test(text)) {
      return /template_role_key IS NOT NULL/.test(text) ? s.contacts.filter((c) => c.template_role_key) : s.contacts;
    }
    if (/^SELECT r\.id, r\.case_id, r\.contact_id, r\.purpose/.test(text)) return s.request ? [s.request] : [];
    if (/^SELECT i\.id, i\.key, i\.title, i\.status, i\.response_type/.test(text)) return s.items;
    if (/^SELECT t\.definition_hash AS template_hash,[\s\S]*AS template_parts, c\.settings -> 'role_labels' AS role_labels\n/.test(text)) {
      // Moduli e ruoli dalle parti del template (DESIGN §7.1 P0-5 b), qui sempre «appena letti».
      return [
        {
          template_hash: "c".repeat(64),
          template_parts: {
            roles: [
              { key: "controllo_gestione", label: "Controllo di gestione" },
              { key: "operativo", label: "Operativo" },
            ],
            modules: [{ key: "m.costi.base", title: "Costi", role_key: "controllo_gestione", estimated_minutes: 10 }],
            gates: [],
            roi: null,
          },
          role_labels: null,
        },
      ];
    }
    if (/^SELECT EXISTS \(SELECT 1 FROM uc_notifications WHERE dedupe_key/.test(text)) return [{ found: s.notificationExists }];
    if (/^SELECT EXISTS \(SELECT 1 FROM uc_contacts WHERE workspace_id/.test(text)) return [{ taken: false }];
    if (/^SELECT id FROM uc_cases WHERE workspace_id/.test(text)) return [];
    if (/^SELECT count\(\*\)::int AS n FROM uc_requests/.test(text)) return [{ n: s.delegationsToday }];
    if (/^SELECT r\.id AS request_id/.test(text)) return s.revokeTargets;
    if (/^SELECT r\.id FROM uc_requests r JOIN uc_cases c/.test(text)) return s.liveApproval ? [{ id: s.liveApproval }] : [];
    if (/^SELECT id, email, email_verified FROM users/.test(text)) return [];
    if (/^SELECT ct\.id, ct\.display_name/.test(text)) return s.contacts.map((c) => ({ ...c, assigned: 3, open_items: 2 }));
    if (/^SELECT r\.id, r\.contact_id, ct\.display_name AS contact_name/.test(text)) return s.listRequests;
    return null;
  }

  async batch(statements: readonly UcStatement[]): Promise<UcRow[][]> {
    this.batches.push([...statements]);
    const out: UcRow[][] = [];
    let write = false;
    for (const st of statements) {
      const rows = this.read(st.text);
      if (rows) out.push(rows);
      else {
        write = true;
        out.push([{ ok: true }]);
      }
    }
    if (write) this.writes.push([...statements]);
    return out;
  }
}

function state(over: Partial<FakeState> = {}): FakeState {
  return {
    caseStatus: "raccolta",
    shareEpoch: 0,
    designated: { owner: null, privacy: null },
    lsEmails: ["lead@ls.test"],
    contacts: [contactRow()],
    items: [itemRow()],
    request: requestRow(),
    notificationExists: false,
    delegationsToday: 0,
    revokeTargets: [],
    liveApproval: null,
    listRequests: [],
    ...over,
  };
}

function ctx(roles: CaseRole[] = ["ls_lead"]): UcCommandContext {
  const lsRole = roles.some((r) => r.startsWith("ls_"));
  return {
    workspaceId: WS,
    caseId: CASE,
    actor: { type: "utente", userId: LEAD, roles },
    user: { userId: LEAD, emailVerified: true, emailDomain: lsRole ? "ls.test" : "cliente.test", isLateralSpace: lsRole },
    lsDomains: ["ls.test"],
    now: NOW,
  };
}

const texts = (batch: readonly UcStatement[]) => batch.map((s) => s.text);
const allParams = (db: FakeDb) => db.writes.flat().flatMap((s) => s.params);
const indexOf = (batch: readonly UcStatement[], re: RegExp) => batch.findIndex((s) => re.test(s.text));

// ── «Copia link» ──────────────────────────────────────────────────────

test("an approval link is never copied: refused before any write", async () => {
  const db = new FakeDb(state({ request: requestRow({ purpose: "approvazioni", acting_role_key: null }) }));
  const r = await copyRequestLink(db, ctx(), { requestId: REQ });
  assert.equal(r.ok ? null : r.code, "link_approvazione");
  assert.equal(db.writes.length, 0);
});

test("copying a live link issues a fresh token: only its sha256 is stored, with who copied it", async () => {
  const db = new FakeDb(state());
  const r = await copyRequestLink(db, ctx(), { requestId: REQ });
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.match(r.value.path, /^\/r\/ucr_[A-Za-z0-9_-]{32}$/);
  assert.equal(r.value.sent, false);
  const token = r.value.path.slice(3);
  const hash = createHash("sha256").update(token).digest("hex");
  assert.equal(db.writes.length, 1);
  const [batch] = db.writes;
  assert.match(batch[0].text, /INSERT INTO uc_request_tokens/);
  assert.ok(batch[0].params.includes(hash));
  assert.ok(batch[0].params.includes("copia"));
  assert.ok(batch[0].params.includes(LEAD), "the copier is recorded (four-eyes guard 9)");
  assert.ok(!allParams(db).some((p) => typeof p === "string" && p.includes(token)), "the clear token never reaches the database");
  assert.ok(batch[1].params.includes("link.copiato"));
  const second = await copyRequestLink(db, ctx(), { requestId: REQ });
  assert.ok(second.ok);
  assert.notEqual(second.value.path, r.value.path, "every copy is a new token");
});

test("copying a draft sends it as a manual link in the same batch, without an email", async () => {
  const db = new FakeDb(
    state({
      caseStatus: "bozza",
      request: requestRow({ status: "bozza", live: false, visible: false, sent_at: null, expires_at: null }),
      items: [itemRow({ active_request_id: REQ })],
    }),
  );
  const r = await copyRequestLink(db, ctx(), { requestId: REQ });
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.equal(r.value.sent, true);
  const [batch] = db.writes;
  const send = indexOf(batch, /UPDATE uc_requests r SET status = 'inviata'/);
  const token = indexOf(batch, /INSERT INTO uc_request_tokens/);
  const item = indexOf(batch, /UPDATE uc_items i SET status = \$\d+::text/);
  assert.ok(item > 0 && send > item && token > send, "items, then the send CAS, then the token");
  assert.ok(batch[send].params.includes("link_manuale"));
  assert.ok(texts(batch).some((t) => /UPDATE uc_cases SET status = \$1::text/.test(t)), "the first send moves the case to raccolta");
  assert.ok(!texts(batch).some((t) => /INSERT INTO uc_notifications/.test(t)), "a copied link sends no email");
});

test("a pending delegation, a paused case and a dead link cannot be copied", async () => {
  const pending = new FakeDb(state({ request: requestRow({ status: "bozza", live: false, delegated_from_request_id: PARENT, delegation_depth: 1 }) }));
  assert.equal(((await copyRequestLink(pending, ctx(), { requestId: REQ })) as { code: string }).code, "delega_da_approvare");
  const paused = new FakeDb(state({ caseStatus: "sospeso", request: requestRow({ live: false }) }));
  assert.equal(((await copyRequestLink(paused, ctx(), { requestId: REQ })) as { code: string }).code, "caso_sospeso");
  const expired = new FakeDb(state({ request: requestRow({ status: "scaduta", live: false, visible: false }) }));
  assert.equal(((await copyRequestLink(expired, ctx(), { requestId: REQ })) as { code: string }).code, "richiesta_non_viva");
  for (const db of [pending, paused, expired]) assert.equal(db.writes.length, 0);
});

test("only the case lead copies, sends and revokes links", async () => {
  for (const roles of [["ls_analista"], ["owner_cliente"], ["osservatore"]] as CaseRole[][]) {
    const db = new FakeDb(state());
    assert.equal(((await copyRequestLink(db, ctx(roles), { requestId: REQ })) as { code: string }).code, "attore_non_ammesso");
    assert.equal(((await sendRequests(db, ctx(roles), {})) as { code: string }).code, "attore_non_ammesso");
    assert.equal(((await revokeRequest(db, ctx(roles), { requestId: REQ })) as { code: string }).code, "attore_non_ammesso");
    assert.equal(db.writes.length, 0);
  }
});

// ── Invio ─────────────────────────────────────────────────────────────

test("«Invia» makes one sent request per referent, moves the items to chiesta and queues the email only for who has one", async () => {
  const db = new FakeDb(
    state({
      caseStatus: "bozza",
      contacts: [contactRow(), contactRow({ id: OTHER, display_name: "Operativo", template_role_key: "operativo", email: null, phone_e164: "+393331234567", preferred_channel: "whatsapp_manuale" })],
      items: [
        itemRow(),
        itemRow({ id: ITEM_B, key: "q.op.01", assignee_contact_id: OTHER, owner_role_key: "operativo", request_module_key: null }),
        itemRow({ id: ITEM_C, key: "q.op.02", assignee_contact_id: OTHER, status: "validata" }),
      ],
    }),
  );
  const r = await sendRequests(db, ctx(), { itemIds: [ITEM_A, ITEM_B, ITEM_C], message: "Grazie per l'aiuto." });
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.equal(r.value.requests.length, 2);
  assert.deepEqual(
    r.value.requests.map((q) => [q.contactId, q.items, q.channel]),
    [
      [CONTACT, 1, "email"],
      [OTHER, 1, "link_manuale"],
    ],
  );
  assert.deepEqual(r.value.skipped.map((s) => [s.key, s.code]), [["q.op.02", "stato_non_chiedibile"]]);
  assert.equal(r.value.caseStarted, true);
  const [batch] = db.writes;
  assert.equal(texts(batch).filter((t) => /INSERT INTO uc_requests/.test(t)).length, 2);
  assert.equal(texts(batch).filter((t) => /INSERT INTO uc_request_items/.test(t)).length, 2);
  const firstItems = indexOf(batch, /INSERT INTO uc_request_items/);
  const transition = indexOf(batch, /UPDATE uc_items i SET status = \$\d+::text/);
  assert.ok(transition > firstItems, "the items enter the request before the transition");
  const emails = batch.filter((s) => /INSERT INTO uc_notifications/.test(s.text));
  assert.equal(emails.length, 1);
  assert.ok(emails[0].params.includes(CONTACT));
  assert.ok(emails[0].params.includes("richiesta_inviata"));
  assert.ok(!allParams(db).some((p) => typeof p === "string" && /ucr_[A-Za-z0-9_-]{32}/.test(p)), "no token at send time: the dispatch issues it");
});

test("nothing is sent while the case is paused", async () => {
  const db = new FakeDb(state({ caseStatus: "sospeso" }));
  const r = await sendRequests(db, ctx(), {});
  assert.equal(r.ok ? null : r.code, "caso_sospeso");
  assert.equal(db.writes.length, 0);
});

// ── Revoca ────────────────────────────────────────────────────────────

test("revoking a request brings its asked items back to da_chiedere (row 31) and closes everything in one batch", async () => {
  const db = new FakeDb(state({ items: [itemRow({ status: "chiesta", active_request_id: REQ })] }));
  const r = await revokeRequest(db, ctx(), { requestId: REQ });
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.deepEqual(r.value, { requestId: REQ, released: 1, reopened: 1 });
  const [batch] = db.writes;
  const transition = indexOf(batch, /UPDATE uc_items i SET status = \$\d+::text/);
  const guard = indexOf(batch, /it\.status = 'chiesta'/);
  const revoke = indexOf(batch, /UPDATE uc_requests SET status = 'revocata'/);
  assert.ok(transition > 0 && guard > transition && revoke > guard);
  assert.ok(batch[transition].params.includes("da_chiedere"));
  assert.ok(batch[transition].params.includes("Richiesta revocata"));
  for (const re of [/UPDATE uc_request_tokens SET revoked_at/, /UPDATE uc_request_items SET state = 'riassegnata'/, /UPDATE uc_notifications SET status = 'annullata'/]) {
    assert.ok(indexOf(batch, re) > revoke, re.source);
  }
  assert.ok(allParams(db).includes("richiesta.revocata"));
});

test("revoking all links bumps the epoch, reopens asked items and revokes the case MCP tokens", async () => {
  const db = new FakeDb(state({ revokeTargets: [{ request_id: REQ, asked_item_ids: [ITEM_A] }, { request_id: PARENT, asked_item_ids: [] }], items: [itemRow({ status: "chiesta", active_request_id: REQ })] }));
  const r = await revokeAllLinks(db, ctx(), { reason: "Link inoltrato per errore" });
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.deepEqual(r.value, { shareEpoch: 1, requests: 2, reopened: 1 });
  const [batch] = db.writes;
  assert.ok(indexOf(batch, /SET share_epoch = share_epoch \+ 1/) > indexOf(batch, /UPDATE uc_items i SET status/));
  assert.ok(indexOf(batch, /UPDATE workspace_integration_tokens SET revoked_at = now\(\)/) > 0);
  assert.ok(indexOf(batch, /UPDATE uc_request_tokens SET revoked_at = now\(\) WHERE case_id/) > 0);
  assert.ok(allParams(db).includes("link.revocati_tutti"));
  assert.ok(allParams(db).includes("Link inoltrato per errore"), "the written reason becomes the visible status reason");
});

// ── Referenti e assegnazione ──────────────────────────────────────────

test("a referent with a Lateral Space address, or the address of an LS member, is refused", async () => {
  for (const email of ["persona@ls.test", "lead@ls.test"]) {
    const db = new FakeDb(state());
    const r = await createContact(db, ctx(), { displayName: "Persona", email });
    assert.equal(r.ok ? null : r.code, "referente_lateral_space");
    assert.equal(db.writes.length, 0);
  }
  const member = new FakeDb(state({ lsEmails: ["consulente@altro.test"] }));
  assert.equal(((await createContact(member, ctx(), { displayName: "Persona", email: "consulente@altro.test" })) as { code: string }).code, "referente_lateral_space");
});

test("the client Owner adds a colleague; the audit event carries no name or email", async () => {
  const db = new FakeDb(state());
  const r = await createContact(db, ctx(["owner_cliente"]), { displayName: "Collega del cliente", roleLabel: "Operativo", templateRoleKey: "operativo", email: "collega@cliente.test" });
  assert.ok(r.ok, r.ok ? "" : r.message);
  const [batch] = db.writes;
  const event = batch.find((s) => s.params.includes("referente.creato"));
  assert.ok(event);
  assert.ok(!event.params.some((p) => typeof p === "string" && (p.includes("@") || p.includes("Collega"))));
  const unknownRole = await createContact(new FakeDb(state()), ctx(), { displayName: "Persona", templateRoleKey: "ruolo_inventato" });
  assert.equal(unknownRole.ok ? null : unknownRole.code, "ruolo_non_previsto");
});

test("bulk assignment by role reaches only free items and gives the role to a referent without one", async () => {
  const db = new FakeDb(
    state({
      contacts: [contactRow({ template_role_key: null })],
      items: [itemRow(), itemRow({ id: ITEM_B, key: "q.costi.02", assignee_contact_id: null }), itemRow({ id: ITEM_C, key: "q.costi.03", assignee_contact_id: null, active_request_id: PARENT })],
    }),
  );
  const r = await assignItems(db, ctx(), { mode: "ruolo", roleKey: "controllo_gestione", contactId: CONTACT });
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.equal(r.value.assigned, 1);
  assert.equal(r.value.unchanged, 1);
  assert.deepEqual(r.value.skipped.map((s) => s.code), ["in_richiesta"]);
  const [batch] = db.writes;
  assert.ok(indexOf(batch, /UPDATE uc_items i SET assignee_contact_id = x\.contact/) > 0);
  assert.ok(indexOf(batch, /UPDATE uc_contacts SET template_role_key/) > 0);
  const lsContact = new FakeDb(state({ contacts: [contactRow({ email: "persona@ls.test" })] }));
  const refused = await assignItems(lsContact, ctx(), { mode: "voci", itemIds: [ITEM_A], contactId: CONTACT });
  assert.equal(refused.ok ? null : refused.code, "referente_lateral_space");
  assert.equal(((await assignItems(new FakeDb(state()), ctx(["owner_cliente"]), { mode: "ruolo", roleKey: "controllo_gestione", contactId: CONTACT })) as { code: string }).code, "attore_non_ammesso");
});

// ── Deleghe, proroga, reinvio, approvazioni ───────────────────────────

test("a delegation is approved only within depth 2 and 5 a day; approval sends it and moves the items to the colleague", async () => {
  const pending = requestRow({ status: "bozza", live: false, delegated_from_request_id: PARENT, delegation_depth: 1, contact_email: "collega@nuovo.test", contact_id: OTHER });
  const items = [itemRow({ status: "chiesta", active_request_id: REQ })];
  const deep = new FakeDb(state({ request: { ...pending, delegation_depth: 3 }, items }));
  assert.equal(((await approveDelegation(deep, ctx(), { requestId: REQ })) as { code: string }).code, "delega_troppo_profonda");
  const busy = new FakeDb(state({ request: pending, items, delegationsToday: 5 }));
  assert.equal(((await approveDelegation(busy, ctx(), { requestId: REQ })) as { code: string }).code, "troppe_deleghe");
  const db = new FakeDb(state({ request: pending, items }));
  const r = await approveDelegation(db, ctx(), { requestId: REQ });
  assert.ok(r.ok, r.ok ? "" : r.message);
  const [batch] = db.writes;
  assert.ok(indexOf(batch, /SET assignee_contact_id = \$1::uuid/) > 0);
  assert.ok(indexOf(batch, /UPDATE uc_requests r SET status = 'inviata'/) > 0);
  const email = batch.find((s) => /INSERT INTO uc_notifications/.test(s.text));
  assert.ok(email?.params.includes("delega"));
  assert.ok(allParams(db).includes("delega.approvata"));
});

test("an extension is capped at 30 days from now", async () => {
  const db = new FakeDb(state());
  const r = await extendExpiry(db, ctx(), { requestId: REQ, expiresAt: "2026-12-31" });
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.equal(r.value.clamped, true);
  assert.equal(r.value.expiresAt, new Date(NOW.getTime() + 30 * 86_400_000).toISOString());
  assert.ok(allParams(db).includes("richiesta.prorogata"));
  const backwards = await extendExpiry(new FakeDb(state()), ctx(), { requestId: REQ, expiresAt: "2026-10-20" });
  assert.equal(backwards.ok ? null : backwards.code, "data_non_valida");
});

test("a resend goes out at most once a day per request", async () => {
  const db = new FakeDb(state({ notificationExists: true }));
  const r = await remindRequest(db, ctx(), { requestId: REQ });
  assert.equal(r.ok ? null : r.code, "gia_inviata_oggi");
  assert.equal(db.writes.length, 0);
  const fresh = new FakeDb(state());
  const ok = await remindRequest(fresh, ctx(), { requestId: REQ });
  assert.ok(ok.ok, ok.ok ? "" : ok.message);
  assert.ok(allParams(fresh).includes("richiesta_inviata"));
});

test("an approval link goes only by email to the designated signer, and is never issued here", async () => {
  const noSigner = new FakeDb(state());
  assert.equal(((await requestApproval(noSigner, ctx(), { designation: "owner" }, { emailConfigured: true })) as { code: string }).code, "firmatario_mancante");
  const noEmail = new FakeDb(state({ designated: { owner: CONTACT, privacy: null } }));
  assert.equal(((await requestApproval(noEmail, ctx(), { designation: "owner" }, { emailConfigured: false })) as { code: string }).code, "email_non_configurata");
  const lsSigner = new FakeDb(state({ designated: { owner: CONTACT, privacy: null }, contacts: [contactRow({ email: "lead@ls.test" })] }));
  assert.equal(((await requestApproval(lsSigner, ctx(), { designation: "owner" }, { emailConfigured: true })) as { code: string }).code, "firmatario_lateral_space");
  const db = new FakeDb(state({ designated: { owner: CONTACT, privacy: null } }));
  const r = await requestApproval(db, ctx(), { designation: "owner" }, { emailConfigured: true });
  assert.ok(r.ok, r.ok ? "" : r.message);
  assert.equal(r.value.created, true);
  const [batch] = db.writes;
  assert.ok(batch.some((s) => /INSERT INTO uc_requests/.test(s.text) && s.params.includes("approvazioni")));
  assert.ok(batch.some((s) => /INSERT INTO uc_notifications/.test(s.text) && s.params.includes("richiesta_approvazione")));
  assert.ok(!texts(batch).some((t) => /uc_request_tokens/.test(t)), "the token is issued by the dispatch, never shown");
  for (const w of [noSigner, noEmail, lsSigner]) assert.equal(w.writes.length, 0);
});

// ── Letture per «Persone e richieste» ─────────────────────────────────

test("client roles see referents and request statuses only: no contacts details, counts, dates, approval links or actions", async () => {
  const listed = (over: Row) => ({
    id: REQ,
    contact_id: CONTACT,
    contact_name: "Referente costi",
    contact_role_label: "Controllo di gestione",
    contact_has_email: true,
    purpose: "raccolta",
    status: "aperta",
    channel: "email",
    acting_role_key: "controllo_gestione",
    delegated_from_request_id: null,
    delegation_depth: 0,
    sent_at: "2026-10-01T08:00:00.000Z",
    expires_at: "2026-10-31T08:00:00.000Z",
    reminder_count: 1,
    last_reminder_at: "2026-10-06T07:00:00.000Z",
    next_reminder_at: "2026-10-12T07:00:00.000Z",
    escalated_at: null,
    revoked_at: null,
    created_at: "2026-10-01T08:00:00.000Z",
    live: true,
    visible: true,
    items: 4,
    open_items: 2,
    active_links: 1,
    email_hold_reason: "email_non_configurata",
    email_queued: true,
    ...over,
  });
  const db = new FakeDb(
    state({
      listRequests: [
        listed({}),
        listed({ id: PARENT, purpose: "approvazioni", status: "inviata" }),
        listed({ id: ITEM_B, status: "bozza", live: false, visible: false, delegated_from_request_id: REQ, delegation_depth: 1 }),
      ],
    }),
  );
  const client = await listCaseRequests(db, { workspaceId: WS, caseId: CASE, audience: "cliente" });
  assert.deepEqual(client.map((r) => [r.id, r.statusLabel, r.detail]), [[REQ, "In attesa", null]]);
  assert.ok(client.every((r) => Object.values(r.actions).every((a) => a === false)));
  const ls = await listCaseRequests(db, { workspaceId: WS, caseId: CASE, audience: "lateral_space" });
  const byId = new Map(ls.map((r) => [r.id, r]));
  assert.equal(byId.get(REQ)?.statusLabel, "Aperta");
  assert.equal(byId.get(REQ)?.detail?.emailHoldReason, "email_non_configurata");
  assert.deepEqual(byId.get(REQ)?.actions, { send: false, copyLink: true, remind: true, revoke: true, extend: true, approveDelegation: false });
  assert.equal(byId.get(PARENT)?.actions.copyLink, false, "approval links are never copied");
  assert.equal(byId.get(PARENT)?.actions.remind, false);
  assert.deepEqual(byId.get(ITEM_B)?.actions, { send: false, copyLink: false, remind: false, revoke: true, extend: false, approveDelegation: true });
  assert.equal(byId.get(ITEM_B)?.detail?.needsApproval, true);
  for (const r of ls) assert.ok(!("firstOpenedAt" in (r.detail ?? {})) && !("completedAt" in (r.detail ?? {})));

  const clientContacts = await listContacts(db, { workspaceId: WS, caseId: CASE, audience: "cliente" });
  assert.deepEqual(clientContacts.map((c) => [c.email, c.phone, c.assigned, c.openItems, c.hasEmail]), [[null, null, null, null, true]]);
  const lsContacts = await listContacts(db, { workspaceId: WS, caseId: CASE, audience: "lateral_space" });
  assert.deepEqual(lsContacts.map((c) => [c.email, c.assigned, c.openItems]), [["costi@cliente.test", 3, 2]]);
});
