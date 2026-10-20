import test from "node:test";
import assert from "node:assert/strict";
import {
  alignAssigneeSql,
  assignItemsSql,
  caseRequestsListSql,
  channelForContact,
  checkConfirmationTarget,
  checkContactDraft,
  checkCopyLink,
  checkDelegationApproval,
  checkRemind,
  checkRequestable,
  checkRevoke,
  contactAnonymizeSql,
  contactEventSql,
  contactHasNoOpenRequestsSql,
  contactInsertSql,
  contactUpdateSql,
  extendExpirySql,
  groupByAssignee,
  noAskedItemsLeftSql,
  normalizePhone,
  parseContactRow,
  parseRequestRow,
  planAssignment,
  prepareContact,
  prepareContactPatch,
  requestEventSql,
  requestInsertSql,
  requestItemsInsertSql,
  requestRowSql,
  requestSendSql,
  revokeAllRequestsSql,
  revokeAllTargetsSql,
  shareEpochBumpSql,
  splitRequestable,
  suggestContactForRole,
  tokenInsertSql,
  type ContactRowState,
  type RequestRowState,
} from "./request-commands.ts";
import { newRequestToken } from "../tokens.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const CONTACT = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const REQ = "66666666-6666-4666-8666-666666666666";
const DRAFT = "77777777-7777-4777-8777-777777777777";
const ITEM_A = "88888888-8888-4888-8888-888888888888";
const ITEM_B = "99999999-9999-4999-8999-999999999999";
const TOKEN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LS = ["ls.test"];

const lead = { type: "utente" as const, userId: USER };

function contact(over: Partial<ContactRowState> = {}): ContactRowState {
  return {
    id: CONTACT,
    displayName: "Referente di prova",
    roleLabel: "Controllo di gestione",
    templateRoleKey: "controllo_gestione",
    email: "referente@cliente.test",
    phoneE164: null,
    preferredChannel: "email",
    isActive: true,
    anonymized: false,
    userId: null,
    ...over,
  };
}

function request(over: Partial<RequestRowState> = {}): RequestRowState {
  return {
    id: REQ,
    caseId: CASE,
    contactId: CONTACT,
    purpose: "raccolta",
    status: "inviata",
    shareEpoch: 0,
    actingRoleKey: "controllo_gestione",
    channel: "email",
    delegatedFromRequestId: null,
    delegationDepth: 0,
    sentAt: new Date("2026-10-01T08:00:00Z"),
    expiresAt: new Date("2026-10-31T08:00:00Z"),
    reminderCount: 0,
    escalatedAt: null,
    revokedAt: null,
    live: true,
    visible: true,
    activeItemIds: [ITEM_A],
    contact: { email: "referente@cliente.test", isActive: true, anonymized: false, templateRoleKey: "controllo_gestione", userId: null },
    ...over,
  };
}

// ── Referenti ─────────────────────────────────────────────────────────

test("phone numbers are normalized to E.164, with the international prefix", () => {
  assert.equal(normalizePhone("+39 333 123 4567"), "+393331234567");
  assert.equal(normalizePhone("0039 (333) 123-4567"), "+393331234567");
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone("333 1234567"), undefined);
  assert.equal(normalizePhone("+0 123"), undefined);
  assert.equal(normalizePhone(42), undefined);
});

test("a referent needs a name; email and phone are checked and the channel follows the contacts", () => {
  const full = prepareContact({ displayName: " Referente ", roleLabel: "Operativo", templateRoleKey: "operativo", email: " Referente@Cliente.TEST ", phone: "+39 333 1234567" });
  assert.ok(full.ok);
  assert.deepEqual(full.value, {
    displayName: "Referente",
    roleLabel: "Operativo",
    templateRoleKey: "operativo",
    email: "referente@cliente.test",
    phoneE164: "+393331234567",
    preferredChannel: "email",
  });
  const phoneOnly = prepareContact({ displayName: "Solo telefono", phone: "+393331234567" });
  assert.equal(phoneOnly.ok && phoneOnly.value.preferredChannel, "whatsapp_manuale");
  const nothing = prepareContact({ displayName: "Link a mano" });
  assert.ok(nothing.ok);
  assert.equal(nothing.value.email, null);
  assert.equal(prepareContact({ displayName: "X" }).ok, false);
  assert.equal((prepareContact({ displayName: "Nome", email: "non-una-email" }) as { code: string }).code, "email_non_valida");
  assert.equal((prepareContact({ displayName: "Nome", phone: "123" }) as { code: string }).code, "telefono_non_valido");
  assert.equal((prepareContact({ displayName: "Nome", email: "a@b.it", preferredChannel: "whatsapp_manuale" }) as { code: string }).code, "telefono_mancante");
  assert.equal((prepareContact({ displayName: "Nome", phone: "+393331234567", preferredChannel: "entrambi" }) as { code: string }).code, "email_mancante");
  assert.equal(prepareContact({ displayName: "Nome", templateRoleKey: "Ruolo Con Spazi" }).ok, false);
});

test("a contact patch lists only the columns that change and flags email changes and deactivation", () => {
  const current = contact();
  const same = prepareContactPatch({ contactId: CONTACT, displayName: "Referente di prova" }, current);
  assert.ok(same.ok);
  assert.deepEqual(same.value.fields, []);
  const changed = prepareContactPatch({ contactId: CONTACT, email: "nuova@cliente.test", isActive: false }, current);
  assert.ok(changed.ok);
  assert.deepEqual(changed.value.fields, ["email", "is_active"]);
  assert.equal(changed.value.emailChanged, true);
  assert.equal(changed.value.deactivated, true);
  assert.deepEqual(changed.value.patch, { email: "nuova@cliente.test", isActive: false });
  // Removing the email of an email-only contact moves the channel to manual WhatsApp only when a phone exists.
  const withPhone = prepareContactPatch({ contactId: CONTACT, email: null, phone: "+393331234567" }, current);
  assert.ok(withPhone.ok);
  assert.equal(withPhone.value.patch.preferredChannel, "whatsapp_manuale");
  assert.equal(prepareContactPatch({ contactId: CONTACT, displayName: "Altro" }, contact({ anonymized: true })).ok, false);
  assert.equal(prepareContactPatch({ contactId: CONTACT, unknown: 1 }, current).ok, false);
  assert.equal(prepareContactPatch({ contactId: CONTACT, email: "x" }, current).ok, false);
});

test("a referent is always a client person: Lateral Space domains and LS member emails are refused", () => {
  assert.equal(checkContactDraft({ email: "persona@ls.test" }, { lsDomains: LS, lsMemberEmails: [] }).ok, false);
  assert.equal(checkContactDraft({ email: "membro@altro.test" }, { lsDomains: LS, lsMemberEmails: ["Membro@altro.test"] }).ok, false);
  assert.equal(checkContactDraft({ email: "referente@cliente.test" }, { lsDomains: LS, lsMemberEmails: [] }).ok, true);
  assert.equal(checkContactDraft({ email: null }, { lsDomains: LS, lsMemberEmails: [] }).ok, true);
  assert.equal(checkContactDraft({ email: null }, { lsDomains: LS, lsMemberEmails: [], user: { isLateralSpace: true, emailDomain: "ls.test" } }).ok, false);
});

test("contact rows parse with safe defaults", () => {
  const c = parseContactRow({ id: CONTACT, display_name: "Ref", preferred_channel: "boh", is_active: "t", anonymized_at: null, email: null });
  assert.ok(c);
  assert.equal(c.preferredChannel, "email");
  assert.equal(c.isActive, true);
  assert.equal(c.anonymized, false);
  assert.equal(parseContactRow({ id: CONTACT, anonymized_at: "2026-10-01T00:00:00Z" })?.anonymized, true);
  assert.equal(parseContactRow(undefined), null);
});

test("contact SQL: insert fails as email_in_uso on a duplicate, updates and anonymizations are CAS, events carry no values", () => {
  const draft = { displayName: "Referente", roleLabel: null, templateRoleKey: null, email: "referente@cliente.test", phoneE164: null, preferredChannel: "email" as const };
  const ins = contactInsertSql({ id: CONTACT, workspaceId: WS, draft, createdByUserId: USER });
  assert.match(ins.text, /ON CONFLICT DO NOTHING/);
  assert.match(ins.text, /uc_require\(count\(\*\) = \$\d+::int, 'email_in_uso'\)/);
  const upd = contactUpdateSql({ workspaceId: WS, contactId: CONTACT, patch: { email: "nuova@cliente.test", isActive: false }, expect: { email: "referente@cliente.test", isActive: true } });
  assert.match(upd.text, /SET email = \$1::text, is_active = \$2::boolean, updated_at = now\(\)/);
  assert.match(upd.text, /email IS NOT DISTINCT FROM \$\d+::text AND is_active = \$\d+::boolean/);
  assert.match(upd.text, /anonymized_at IS NULL/);
  const anon = contactAnonymizeSql({ workspaceId: WS, contactId: CONTACT });
  assert.match(anon.text, /email = NULL, phone_e164 = NULL, user_id = NULL/);
  assert.match(anon.text, /anonymized_at = now\(\)/);
  const ev = contactEventSql({ type: "referente.modificato", workspaceId: WS, caseId: CASE, actor: lead, contactId: CONTACT, roleKey: "controllo_gestione", fields: ["email"] });
  const payload = ev.params.find((p) => typeof p === "string" && p.startsWith("{")) as string;
  assert.deepEqual(JSON.parse(payload), { role_key: "controllo_gestione", fields: ["email"] });
  assert.ok(!ev.params.some((p) => typeof p === "string" && p.includes("@")), "no email in the audit event");
  const open = contactHasNoOpenRequestsSql(CONTACT);
  assert.match(open.text, /'richieste_aperte'/);
  assert.match(open.text, /r\.status IN \('inviata', 'aperta', 'in_corso', 'completata'\)/);
});

// ── Assegnazione ──────────────────────────────────────────────────────

test("assignment never moves an item that is in an open request, and keeps existing assignees unless asked", () => {
  const items = [
    { id: ITEM_A, key: "q.a.01", assigneeContactId: null, ownerRoleKey: "r", activeRequestId: null },
    { id: ITEM_B, key: "q.a.02", assigneeContactId: OTHER, ownerRoleKey: "r", activeRequestId: null },
    { id: REQ, key: "q.a.03", assigneeContactId: OTHER, ownerRoleKey: "r", activeRequestId: DRAFT },
    { id: DRAFT, key: "q.a.04", assigneeContactId: CONTACT, ownerRoleKey: "r", activeRequestId: null },
    { id: ITEM_A, key: "q.a.01", assigneeContactId: null, ownerRoleKey: "r", activeRequestId: null },
  ];
  const keep = planAssignment({ items, target: () => ({ contactId: CONTACT }), overwrite: false });
  assert.deepEqual(keep.assign, [{ id: ITEM_A, key: "q.a.01", prev: null, contact: CONTACT }]);
  assert.deepEqual(keep.skipped.map((s) => [s.key, s.code]), [["q.a.02", "gia_assegnata"], ["q.a.03", "in_richiesta"]]);
  assert.equal(keep.unchanged, 1);
  const over = planAssignment({ items, target: () => ({ contactId: CONTACT }), overwrite: true });
  assert.deepEqual(over.assign.map((a) => [a.key, a.prev]), [["q.a.01", null], ["q.a.02", OTHER]]);
  const skip = planAssignment({ items, target: () => ({ skip: { code: "senza_ruolo", message: "x" } }), overwrite: true });
  assert.equal(skip.assign.length, 0);
  assert.equal(skip.skipped.length, 4);
});

test("the proposed referent for a role is the only active one with that role", () => {
  const contacts = [
    { id: CONTACT, templateRoleKey: "operativo", isActive: true, anonymized: false },
    { id: OTHER, templateRoleKey: "commerciale", isActive: true, anonymized: false },
    { id: REQ, templateRoleKey: "commerciale", isActive: true, anonymized: false },
    { id: DRAFT, templateRoleKey: "direzione", isActive: false, anonymized: false },
  ];
  assert.deepEqual(suggestContactForRole(contacts, "operativo"), { contactId: CONTACT });
  assert.deepEqual((suggestContactForRole(contacts, "commerciale") as { skip: { code: string } }).skip.code, "piu_referenti_per_ruolo");
  assert.deepEqual((suggestContactForRole(contacts, "direzione") as { skip: { code: string } }).skip.code, "nessun_referente_per_ruolo");
  assert.deepEqual((suggestContactForRole(contacts, null) as { skip: { code: string } }).skip.code, "senza_ruolo");
});

test("assignment SQL is a CAS on the read assignee, refuses items in open requests and audits each item", () => {
  const s = assignItemsSql({ workspaceId: WS, caseId: CASE, rows: [{ id: ITEM_A, prev: null, contact: CONTACT }], actor: lead, roleKey: "controllo_gestione" });
  assert.match(s.text, /i\.assignee_contact_id IS NOT DISTINCT FROM x\.prev/);
  assert.match(s.text, /NOT EXISTS \(SELECT 1 FROM uc_request_items ri WHERE ri\.item_id = i\.id AND ri\.state IN \('da_fare', 'bozza', 'inviata'\)\)/);
  assert.match(s.text, /uc_require\(count\(\*\) = \$\d+::int, 'conflitto'\)/);
  assert.ok(s.params.includes("voce.assegnata"));
  assert.throws(() => assignItemsSql({ workspaceId: WS, caseId: CASE, rows: [], actor: lead }));
  const align = alignAssigneeSql({ workspaceId: WS, caseId: CASE, itemIds: [ITEM_A], contactId: CONTACT, actor: lead });
  assert.match(align.text, /assignee_contact_id IS DISTINCT FROM/);
});

// ── Voci da chiedere ──────────────────────────────────────────────────

const base = { status: "da_chiedere" as const, responseType: "numero" as const, activeBlockerKeys: [] as string[], assigneeContactId: CONTACT };

test("an item can be requested only when it is askable, typed, unblocked, free and assigned to that referent", () => {
  const code = (r: ReturnType<typeof checkRequestable>) => (r.ok ? "ok" : r.code);
  assert.equal(code(checkRequestable(base, { activeRequestId: null, contactId: CONTACT })), "ok");
  for (const status of ["mancante", "parziale"] as const) assert.equal(code(checkRequestable({ ...base, status }, { activeRequestId: null })), "ok");
  for (const status of ["chiesta", "in_verifica", "validata", "non_applicabile"] as const) {
    assert.equal(code(checkRequestable({ ...base, status }, { activeRequestId: null })), "stato_non_chiedibile");
  }
  assert.equal(code(checkRequestable({ ...base, responseType: null }, { activeRequestId: null })), "senza_tipo_risposta");
  assert.equal(code(checkRequestable({ ...base, status: "bloccata", activeBlockerKeys: ["a8"] }, { activeRequestId: null })), "voce_bloccata");
  assert.equal(code(checkRequestable({ ...base, status: "bloccata" }, { activeRequestId: null })), "ok");
  assert.equal(code(checkRequestable(base, { activeRequestId: REQ })), "gia_in_richiesta");
  assert.equal(code(checkRequestable(base, { activeRequestId: DRAFT, draftRequestId: DRAFT })), "ok");
  assert.equal(code(checkRequestable({ ...base, assigneeContactId: null }, { activeRequestId: null })), "referente_assente");
  assert.equal(code(checkRequestable(base, { activeRequestId: null, contactId: OTHER })), "altro_referente");
});

test("requestable items are split with their reason and grouped by referent in a stable order", () => {
  const items = [
    { snapshot: { ...base, id: ITEM_B, key: "q.b", assigneeContactId: OTHER }, activeRequestId: null },
    { snapshot: { ...base, id: ITEM_A, key: "q.a" }, activeRequestId: null },
    { snapshot: { ...base, id: REQ, key: "q.c", status: "validata" as const }, activeRequestId: null },
  ];
  const split = splitRequestable(items, {});
  assert.deepEqual(split.eligible.map((i) => i.snapshot.key), ["q.b", "q.a"]);
  assert.deepEqual(split.skipped, [{ itemId: REQ, key: "q.c", code: "stato_non_chiedibile", message: split.skipped[0].message }]);
  const groups = groupByAssignee(split.eligible, (i) => i.snapshot.assigneeContactId);
  assert.deepEqual(groups.map((g) => [g.contactId, g.items.map((i) => i.snapshot.key)]), [[CONTACT, ["q.a"]], [OTHER, ["q.b"]]]);
  assert.deepEqual(groupByAssignee([{ c: null }], (x) => x.c), []);
});

test("a confirmation goes to a referent with the owner's role", () => {
  const item = { status: "in_verifica" as const, assigneeContactId: CONTACT, ownerRoleKey: "controllo_gestione" };
  assert.equal(checkConfirmationTarget(item, { templateRoleKey: "controllo_gestione" }).ok, true);
  assert.equal((checkConfirmationTarget(item, { templateRoleKey: "operativo" }) as { code: string }).code, "ruolo_titolare_diverso");
  assert.equal((checkConfirmationTarget({ ...item, ownerRoleKey: null }, { templateRoleKey: null }) as { ok: boolean }).ok, true);
  assert.equal((checkConfirmationTarget({ ...item, status: "chiesta" }, { templateRoleKey: "controllo_gestione" }) as { code: string }).code, "stato_non_ammesso");
  assert.equal((checkConfirmationTarget({ ...item, assigneeContactId: null }, null) as { code: string }).code, "referente_assente");
});

// ── Richieste ─────────────────────────────────────────────────────────

test("a request is born in the case's current link epoch: sent with now() + 30 days, or as a draft without expiry", () => {
  const sent = requestInsertSql({
    id: REQ,
    workspaceId: WS,
    caseId: CASE,
    contactId: CONTACT,
    purpose: "raccolta",
    actingRoleKey: "controllo_gestione",
    message: null,
    channel: "email",
    createdByUserId: USER,
    send: true,
    nextReminderAt: new Date("2026-10-06T07:00:00Z"),
  });
  assert.match(sent.text, /c\.share_epoch/);
  assert.match(sent.text, /'inviata'/);
  assert.match(sent.text, /now\(\) \+ interval '720 hours'/);
  assert.match(sent.text, /c\.status NOT IN \('chiuso', 'sospeso'\)/);
  assert.match(sent.text, /ct\.is_active AND ct\.anonymized_at IS NULL/);
  assert.ok(sent.params.includes("2026-10-06T07:00:00.000Z"));
  const draft = requestInsertSql({ id: DRAFT, workspaceId: WS, caseId: CASE, contactId: CONTACT, purpose: "raccolta", actingRoleKey: null, message: "Ciao", channel: "link_manuale", createdByUserId: USER, send: false });
  assert.match(draft.text, /'bozza'/);
  assert.match(draft.text, /c\.status NOT IN \('chiuso'\)/);
  assert.doesNotMatch(draft.text, /interval '720 hours'/);
});

test("request items are a CAS on status and assignee, and the partial unique index makes a second open request fail", () => {
  const s = requestItemsInsertSql({ caseId: CASE, requestId: REQ, contactId: CONTACT, items: [{ id: ITEM_A, status: "da_chiedere" }, { id: ITEM_A, status: "da_chiedere" }, { id: ITEM_B, status: "mancante" }] });
  assert.match(s.text, /i\.status = x\.status/);
  assert.match(s.text, /i\.assignee_contact_id = \$\d+::uuid/);
  assert.match(s.text, /ON CONFLICT DO NOTHING/);
  assert.match(s.text, /uc_require\(count\(\*\) = \$\d+::int, 'conflitto'\)/);
  assert.ok(s.params.includes(2), "duplicates are counted once");
  assert.throws(() => requestItemsInsertSql({ caseId: CASE, requestId: REQ, contactId: CONTACT, items: [] }));
});

test("sending a draft is a CAS from bozza with the current epoch and an active, client referent", () => {
  const s = requestSendSql({ workspaceId: WS, caseId: CASE, requestId: DRAFT, channel: "email", nextReminderAt: null });
  assert.match(s.text, /r\.status = 'bozza' AND r\.revoked_at IS NULL/);
  assert.match(s.text, /share_epoch = c\.share_epoch/);
  assert.match(s.text, /expires_at = now\(\) \+ interval '720 hours'/);
  assert.match(s.text, /c\.status NOT IN \('chiuso', 'sospeso'\)/);
  assert.match(s.text, /ct\.is_active AND ct\.anonymized_at IS NULL/);
});

test("request rows parse the link state computed by the database", () => {
  const row = requestRowSql({ workspaceId: WS, caseId: CASE, requestId: REQ });
  assert.match(row.text, /r\.share_epoch = c\.share_epoch/);
  assert.match(row.text, /AS live/);
  assert.match(row.text, /AS visible/);
  assert.doesNotMatch(row.text, /r\.(first_opened_at|completed_at)/);
  const parsed = parseRequestRow({
    id: REQ,
    case_id: CASE,
    contact_id: CONTACT,
    purpose: "raccolta",
    status: "in_corso",
    share_epoch: "2",
    channel: "link_manuale",
    delegation_depth: 1,
    live: "t",
    visible: true,
    active_item_ids: `["${ITEM_A}"]`,
    contact_email: null,
    contact_active: true,
    contact_anonymized: false,
  });
  assert.ok(parsed);
  assert.equal(parsed.shareEpoch, 2);
  assert.equal(parsed.channel, "link_manuale");
  assert.equal(parsed.live, true);
  assert.deepEqual(parsed.activeItemIds, [ITEM_A]);
  assert.equal(parseRequestRow({ id: REQ, purpose: "altro", status: "inviata" }), null);
  assert.equal(channelForContact(null), "link_manuale");
  assert.equal(channelForContact("a@b.it"), "email");
});

test("lists never select per-person times (art. 15.4)", () => {
  const list = caseRequestsListSql({ workspaceId: WS, caseId: CASE });
  assert.doesNotMatch(list.text, /r\.(first_opened_at|completed_at|privacy_ack_at)/);
});

// ── Token ─────────────────────────────────────────────────────────────

test("a token row stores only the sha256 and the prefix, and only for a live request", () => {
  const issued = newRequestToken();
  const s = tokenInsertSql({ tokenId: TOKEN_ID, workspaceId: WS, caseId: CASE, requestId: REQ, hash: issued.hash, prefix: issued.prefix, issuedFor: "copia", issuedByUserId: USER });
  assert.ok(!s.params.includes(issued.token), "the clear token never reaches the database");
  assert.ok(s.params.includes(issued.hash));
  assert.match(s.text, /r\.status IN \('inviata', 'aperta', 'in_corso', 'completata'\)/);
  assert.match(s.text, /r\.share_epoch = c\.share_epoch/);
  assert.match(s.text, /c\.status NOT IN \('chiuso', 'sospeso'\)/);
  assert.match(s.text, /r\.purpose = 'raccolta'/);
  assert.match(s.text, /'richiesta_non_viva'/);
  const email = tokenInsertSql({ tokenId: TOKEN_ID, workspaceId: WS, caseId: CASE, requestId: REQ, hash: issued.hash, prefix: issued.prefix, issuedFor: "invio", issuedByUserId: null });
  assert.doesNotMatch(email.text, /r\.purpose = 'raccolta'/, "approval links go out by email");
  assert.throws(() => tokenInsertSql({ tokenId: TOKEN_ID, workspaceId: WS, caseId: CASE, requestId: REQ, hash: issued.hash, prefix: issued.prefix, issuedFor: "copia", issuedByUserId: null }));
  assert.throws(() => tokenInsertSql({ tokenId: TOKEN_ID, workspaceId: WS, caseId: CASE, requestId: REQ, hash: issued.hash, prefix: issued.prefix, issuedFor: "promemoria", issuedByUserId: USER }));
  assert.throws(() => tokenInsertSql({ tokenId: TOKEN_ID, workspaceId: WS, caseId: CASE, requestId: REQ, hash: issued.token, prefix: issued.prefix, issuedFor: "invio", issuedByUserId: null }));
});

test("«Copia link» is never available for approval links, nor on a pending delegation, a paused or closed case", () => {
  const code = (r: ReturnType<typeof checkCopyLink>) => (r.ok ? r.value : r.code);
  assert.equal(code(checkCopyLink(request({ purpose: "approvazioni" }), "raccolta")), "link_approvazione");
  assert.equal(code(checkCopyLink(request({ status: "bozza", live: false }), "raccolta")), "invia_e_copia");
  assert.equal(code(checkCopyLink(request({ status: "bozza", live: false, delegatedFromRequestId: DRAFT }), "raccolta")), "delega_da_approvare");
  assert.equal(code(checkCopyLink(request(), "raccolta")), "copia");
  assert.equal(code(checkCopyLink(request(), "sospeso")), "caso_sospeso");
  assert.equal(code(checkCopyLink(request(), "chiuso")), "caso_chiuso");
  assert.equal(code(checkCopyLink(request({ live: false, status: "scaduta" }), "raccolta")), "richiesta_non_viva");
  assert.equal(code(checkCopyLink(request({ live: false, revokedAt: new Date(), status: "revocata" }), "raccolta")), "richiesta_non_viva");
});

// ── Revoca, proroga, reinvio ──────────────────────────────────────────

test("revocation refuses closed requests; revoking all links bumps the epoch and spares Lateral Space drafts", () => {
  assert.equal(checkRevoke(request()).ok, true);
  assert.equal(checkRevoke(request({ status: "bozza" })).ok, true);
  assert.equal(checkRevoke(request({ status: "revocata" })).ok, false);
  assert.equal(checkRevoke(request({ status: "scaduta" })).ok, false);
  const bump = shareEpochBumpSql({ workspaceId: WS, caseId: CASE, expectEpoch: 3 });
  assert.match(bump.text, /share_epoch = share_epoch \+ 1/);
  assert.match(bump.text, /share_epoch = \$\d+::int/);
  assert.ok(bump.params.includes(3));
  for (const s of [revokeAllTargetsSql({ workspaceId: WS, caseId: CASE }), revokeAllRequestsSql({ workspaceId: WS, caseId: CASE, actor: lead, reasonCode: "revoca_in_blocco" })]) {
    assert.match(s.text, /r\.status <> 'bozza' OR r\.delegated_from_request_id IS NOT NULL/);
  }
  const left = noAskedItemsLeftSql({ caseId: CASE, requestId: REQ });
  assert.match(left.text, /it\.status = 'chiesta'/);
  assert.match(noAskedItemsLeftSql({ caseId: CASE, revokeAll: true }).text, /r\.delegated_from_request_id IS NOT NULL/);
});

test("an extension never goes past 30 days from now nor backwards, also on a paused case", () => {
  const s = extendExpirySql({ workspaceId: WS, caseId: CASE, requestId: REQ, requested: new Date("2026-12-31T00:00:00Z"), nextReminderAt: null });
  assert.match(s.text, /GREATEST\(r\.expires_at, LEAST\(\$\d+::timestamptz, now\(\) \+ interval '720 hours'\)\)/);
  assert.match(s.text, /c\.status <> 'chiuso'/);
  assert.doesNotMatch(s.text, /'sospeso'/);
});

test("a resend needs a live collection request and a referent with email", () => {
  const code = (r: ReturnType<typeof checkRemind>) => (r.ok ? "ok" : r.code);
  assert.equal(code(checkRemind(request())), "ok");
  assert.equal(code(checkRemind(request({ purpose: "approvazioni" }))), "link_approvazione");
  assert.equal(code(checkRemind(request({ status: "bozza", live: false }))), "non_inviata");
  assert.equal(code(checkRemind(request({ live: false }))), "richiesta_non_viva");
  assert.equal(code(checkRemind(request({ contact: { ...request().contact, email: null } }))), "email_mancante");
  assert.equal(code(checkRemind(request({ contact: { ...request().contact, isActive: false } }))), "contatto_non_attivo");
});

test("delegation approval: depth at most 2, at most 5 a day, a client colleague and items still open", () => {
  const pending = request({ status: "bozza", live: false, delegatedFromRequestId: DRAFT, delegationDepth: 1, contact: { ...request().contact, email: "collega@nuovo.test" } });
  const code = (r: ReturnType<typeof checkDelegationApproval>) => (r.ok ? `ok:${r.value.depth}` : r.code);
  const run = (over: Partial<RequestRowState>, today = 0, members: string[] = []) =>
    code(checkDelegationApproval({ request: { ...pending, ...over }, delegationsToday: today, lsDomains: LS, lsMemberEmails: members }));
  assert.equal(run({}), "ok:1");
  assert.equal(run({ delegationDepth: 2 }), "ok:2");
  assert.equal(run({ delegationDepth: 3 }), "delega_troppo_profonda");
  assert.equal(run({}, 5), "troppe_deleghe");
  assert.equal(run({}, 4), "ok:1");
  assert.equal(run({ contact: { ...pending.contact, email: "persona@ls.test" } }), "delega_a_lateral_space");
  assert.equal(run({}, 0, ["collega@nuovo.test"]), "referente_lateral_space");
  assert.equal(run({ activeItemIds: [] }), "nessuna_voce");
  assert.equal(run({ delegatedFromRequestId: null }), "non_delega");
  assert.equal(run({ status: "inviata" }), "delega_gia_decisa");
  assert.equal(run({ contact: { ...pending.contact, isActive: false } }), "contatto_non_attivo");
});

test("request events carry codes and counts only", () => {
  const ev = requestEventSql({ type: "richiesta.inviata", workspaceId: WS, caseId: CASE, actor: lead, requestId: REQ, items: 3, purpose: "raccolta", channel: "email", toState: "inviata" });
  const payload = JSON.parse(ev.params.find((p) => typeof p === "string" && p.startsWith("{")) as string);
  assert.deepEqual(payload, { items: 3, purpose: "raccolta", channel: "email" });
  const extended = requestEventSql({ type: "richiesta.prorogata", workspaceId: WS, caseId: CASE, actor: lead, requestId: REQ, items: 3 });
  assert.deepEqual(JSON.parse(extended.params.find((p) => typeof p === "string" && p.startsWith("{")) as string), {});
});
