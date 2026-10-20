import test from "node:test";
import assert from "node:assert/strict";
import { isLateralSpaceEmail, parseLsDomains, userContextFrom } from "./lateral-space.ts";
import {
  CASE_ACTION_ROLES,
  actorClasses,
  addSignature,
  approvalsComplete,
  assertMemberRoles,
  assertNoRoleConflict,
  assertRoleAllowed,
  can,
  canValidate,
  checkAssignee,
  checkCaseCreator,
  checkContactEmail,
  checkPersonalZoneProposal,
  checkPersonalZoneSignature,
  checkSignerDesignation,
  checkSignerEmail,
  clientSignerRole,
  designationChanged,
  dropLinkApprovals,
  naSignaturePatch,
  naSignatures,
  ownerRoleSatisfied,
  personalZoneAllowed,
  signatureRole,
  staleNaLinkSignaturePatch,
  valueVisibleTo,
  type CaseAction,
  type SignatureContext,
  type Signer,
} from "./permissions.ts";
import type { Approval, AnswerMeta, ItemSnapshot, UserContext } from "./types.ts";
import { CASE_ROLES, type CaseRole } from "./vocab.ts";

const EARLIER = new Date("2026-10-01T10:00:00Z");

function answer(over: Partial<AnswerMeta> = {}): AnswerMeta {
  return {
    id: "ans-2",
    version: 2,
    kind: "valore",
    sourceKind: "referente",
    responderContactId: "contact-1",
    responderUserId: null,
    requestId: "req-1",
    validFrom: null,
    createdAt: EARLIER,
    textHash: null,
    typed: true,
    ...over,
  };
}

/** Voce in verifica che il Responsabile del caso può validare. */
function snap(over: Partial<ItemSnapshot> = {}): ItemSnapshot {
  return {
    id: "item-1",
    key: "par.esempio",
    kind: "parametro",
    status: "in_verifica",
    priority: "must",
    perimeter: "in_contratto",
    servesFor: ["modello"],
    inGateScope: true,
    privacyClass: "riservato_azienda",
    responseType: "numero",
    ownerRoleKey: "controllo_gestione",
    assigneeContactId: "contact-1",
    requiresValidityPeriod: false,
    freshnessDays: null,
    staleAt: null,
    currentAnswer: answer(),
    answerResponderUserIds: [],
    currentAnswerTokenIssuerUserIds: [],
    confirmedByContactId: null,
    confirmedByRoleKey: null,
    responderRoleKey: "controllo_gestione",
    na: { reason: null, proposedAt: null, lsUserId: null, clientUserId: null, clientContactId: null, approvedAt: null },
    waiver: null,
    fallback: null,
    partialNa: null,
    activeBlockerKeys: [],
    openClarification: false,
    hasActiveRequestItem: true,
    lastAutoCheckError: false,
    ...over,
  };
}

const LEAD = "u-lead";
const lsUser: UserContext = { userId: LEAD, emailVerified: true, emailDomain: "ls.test", isLateralSpace: true };
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);

test("the baseline item is validatable by ls_lead and ls_analista", () => {
  assert.equal(code(canValidate(snap(), LEAD, ["ls_lead"])), "ok");
  assert.equal(code(canValidate(snap(), "u-analista", ["ls_analista"])), "ok");
  assert.equal(code(canValidate(snap(), LEAD, ["ls_lead"], lsUser)), "ok");
});

test("four eyes, table-driven: every guard rejects with its own code", () => {
  const cases: [string, Partial<ItemSnapshot>, string, CaseRole[]?][] = [
    ["1 role: developer", {}, "ruolo_non_ammesso", ["ls_sviluppatore"]],
    ["1 role: client owner", {}, "ruolo_non_ammesso", ["owner_cliente"]],
    ["2 answered an earlier version", { answerResponderUserIds: [LEAD] }, "stessa_persona"],
    ["2 answered the current version", { currentAnswer: answer({ responderUserId: LEAD, responderContactId: null, sourceKind: "documento" }) }, "stessa_persona"],
    ["3 no answer", { currentAnswer: null }, "risposta_assente"],
    ["3 «Non lo so»", { currentAnswer: answer({ kind: "non_so" }) }, "risposta_non_validabile"],
    ["3 delegation", { currentAnswer: answer({ kind: "delega" }) }, "risposta_non_validabile"],
    ["3 NA proposal", { currentAnswer: answer({ kind: "proposta_na" }) }, "risposta_non_validabile"],
    ["4 automatic check error", { lastAutoCheckError: true }, "controllo_automatico_errore"],
    ["5 no contact confirmation", { currentAnswer: answer({ responderContactId: null, sourceKind: "dichiarato_in_call" }), responderRoleKey: null }, "conferma_titolare_mancante"],
    ["5 must answered by another role", { responderRoleKey: "operativo" }, "ruolo_titolare_diverso"],
    ["6 rule confirmed by another role (could)", { priority: "could", responseType: "conferma_regola", responderRoleKey: "operativo" }, "ruolo_titolare_diverso"],
    ["7 validity period missing", { requiresValidityPeriod: true }, "validita_mancante"],
    ["8 open clarification", { openClarification: true }, "chiarimento_aperto"],
    ["9 copied the request link", { currentAnswerTokenIssuerUserIds: [LEAD] }, "link_copiato_da_te"],
    ["10 prose on a currency", { responseType: "valuta", currentAnswer: answer({ typed: false }) }, "valore_non_tipizzato"],
  ];
  for (const [name, over, expected, roles] of cases) {
    assert.equal(code(canValidate(snap(over), LEAD, roles ?? ["ls_lead"])), expected, name);
  }
});

test("the owner's confirmation can come from the answer or from a later confirmation", () => {
  // Declared in a call, then confirmed by a contact of the owner role.
  const confirmed = snap({
    currentAnswer: answer({ responderContactId: null, sourceKind: "dichiarato_in_call" }),
    responderRoleKey: null,
    confirmedByContactId: "contact-1",
    confirmedByRoleKey: "controllo_gestione",
  });
  assert.equal(code(canValidate(confirmed, LEAD, ["ls_lead"])), "ok");
  // A should item answered by another role passes guard 5 (owner role only for must).
  assert.equal(code(canValidate(snap({ priority: "should", responderRoleKey: "operativo" }), LEAD, ["ls_lead"])), "ok");
  // The delegate inherits the role of the delegating contact (acting_role_key): same role, accepted.
  assert.equal(code(canValidate(snap({ responderRoleKey: "controllo_gestione", currentAnswer: answer({ responderContactId: "contact-delegate" }) }), LEAD, ["ls_lead"])), "ok");
  // Without an owner role nothing to compare.
  assert.equal(ownerRoleSatisfied({ ownerRoleKey: null, responderRoleKey: null, confirmedByRoleKey: null }), true);
});

test("textual types stay validatable without a normalized value", () => {
  for (const responseType of ["testo", "conferma_regola", "conferma_formula", "file", "tabella"] as const) {
    assert.equal(code(canValidate(snap({ responseType, currentAnswer: answer({ typed: false }) }), LEAD, ["ls_lead"])), "ok", responseType);
  }
  for (const responseType of ["numero", "valuta", "percentuale", "durata", "data", "intervallo", "scelta"] as const) {
    assert.equal(code(canValidate(snap({ responseType, currentAnswer: answer({ typed: false }) }), LEAD, ["ls_lead"])), "valore_non_tipizzato", responseType);
  }
});

test("validation recomputes Lateral Space with the user context", () => {
  const removedDomain: UserContext = { ...lsUser, emailDomain: "altro.test", isLateralSpace: false };
  assert.equal(code(canValidate(snap(), LEAD, ["ls_lead"], removedDomain)), "ruolo_non_ammesso");
  assert.equal(code(canValidate(snap(), LEAD, ["ls_lead"], { ...lsUser, userId: "someone-else" })), "ruolo_non_ammesso");
});

test("NA signatures: only LS no, only client no, both yes", () => {
  const base = { reason: "x", proposedAt: EARLIER, lsUserId: null, clientUserId: null, clientContactId: null, approvedAt: null };
  assert.deepEqual(naSignatures({ na: base }), { ls: false, client: false, complete: false });
  assert.deepEqual(naSignatures({ na: { ...base, lsUserId: LEAD } }), { ls: true, client: false, complete: false });
  assert.deepEqual(naSignatures({ na: { ...base, clientUserId: "u-owner" } }), { ls: false, client: true, complete: false });
  assert.deepEqual(naSignatures({ na: { ...base, lsUserId: LEAD, clientContactId: "contact-owner" } }), { ls: true, client: true, complete: true });
});

test("actor classes: roles, links and recomputation", () => {
  assert.deepEqual([...actorClasses({ type: "sistema", job: "seed" })], ["sistema"]);
  assert.deepEqual([...actorClasses({ type: "referente", contactId: "c", requestId: "r", roleKey: null })], ["referente"]);
  assert.deepEqual([...actorClasses({ type: "owner_link", contactId: "c", requestId: "r", designation: "owner" })], ["cliente"]);
  assert.deepEqual([...actorClasses({ type: "owner_link", contactId: "c", requestId: "r", designation: "privacy" })], []);
  assert.deepEqual([...actorClasses({ type: "utente", userId: "u", roles: ["ls_lead", "ls_analista"] })], ["ls_lead", "ls_analista"]);
  assert.deepEqual([...actorClasses({ type: "utente", userId: "u", roles: ["owner_cliente"] })], ["cliente"]);
  assert.deepEqual([...actorClasses({ type: "utente", userId: "u", roles: ["osservatore", "ai_board"] })], []);
  const client: UserContext = { userId: "u", emailVerified: true, emailDomain: "cliente.test", isLateralSpace: false };
  assert.deepEqual([...actorClasses({ type: "utente", userId: "u", roles: ["ls_lead"] }, client)], []);
  assert.deepEqual([...actorClasses({ type: "utente", userId: "u", roles: ["owner_cliente"] }, { ...client, isLateralSpace: true })], []);
});

// ── Chi è Lateral Space (D36) ─────────────────────────────────────────

const DOMAINS = parseLsDomains("ls.test, studio-ls.test");
const LS_USER: UserContext = { userId: "u-ls", emailVerified: true, emailDomain: "ls.test", isLateralSpace: true };
const LS_USER_2: UserContext = { userId: "u-ls-2", emailVerified: true, emailDomain: "ls.test", isLateralSpace: true };
const CLIENT_USER: UserContext = { userId: "u-client", emailVerified: true, emailDomain: "cliente.test", isLateralSpace: false };
const PRIVACY_USER: UserContext = { userId: "u-privacy", emailVerified: true, emailDomain: "cliente.test", isLateralSpace: false };

test("Lateral Space is a verified email in an exact listed domain", () => {
  assert.equal(isLateralSpaceEmail({ email: "anna@ls.test", emailVerified: true }, DOMAINS), true);
  assert.equal(isLateralSpaceEmail({ email: "ANNA@LS.TEST", emailVerified: true }, DOMAINS), true);
  assert.equal(isLateralSpaceEmail({ email: "anna@ls.test", emailVerified: false }, DOMAINS), false, "unverified email");
  assert.equal(isLateralSpaceEmail({ email: "anna@eu.ls.test", emailVerified: true }, DOMAINS), false, "no implicit subdomains");
  assert.equal(isLateralSpaceEmail({ email: "anna@cliente.test", emailVerified: true }, DOMAINS), false);
  assert.equal(isLateralSpaceEmail({ email: null, emailVerified: true }, DOMAINS), false);
  assert.equal(isLateralSpaceEmail({ email: "anna@ls.test", emailVerified: true }, []), false, "no UC_LS_EMAIL_DOMAINS");
});

test("assertRoleAllowed: ls_* only for Lateral Space, client roles only for the others, observer for both", () => {
  const ls = new Set<CaseRole>(["ls_lead", "ls_analista", "ls_sviluppatore"]);
  const client = new Set<CaseRole>(["owner_cliente", "approvatore_privacy", "ai_board"]);
  for (const role of CASE_ROLES) {
    const forLs = assertRoleAllowed(LS_USER, role);
    const forClient = assertRoleAllowed(CLIENT_USER, role);
    assert.equal(forLs.ok, !client.has(role), `${role} for Lateral Space`);
    assert.equal(forClient.ok, !ls.has(role), `${role} for the client`);
    if (ls.has(role)) assert.equal(code(forClient), "ruolo_solo_lateral_space", role);
    if (client.has(role)) assert.equal(code(forLs), "ruolo_solo_cliente", role);
  }
  // Without UC_LS_EMAIL_DOMAINS nobody is Lateral Space: no ls_* role can be assigned.
  const noDomains = userContextFrom({ id: "u-ls", email: "anna@ls.test", emailVerified: new Date() }, parseLsDomains(undefined));
  assert.equal(code(assertRoleAllowed(noDomains, "ls_lead")), "ruolo_solo_lateral_space");
  // An unverified email is not Lateral Space, and it is not the client either:
  // otherwise a Lateral Space person could sign on the client's behalf (D16, D36).
  const unverified = userContextFrom({ id: "u-ls", email: "anna@ls.test", emailVerified: null }, DOMAINS);
  assert.equal(code(assertRoleAllowed(unverified, "ls_analista")), "ruolo_solo_lateral_space");
  for (const role of ["owner_cliente", "approvatore_privacy", "ai_board"] as const) {
    assert.equal(code(assertRoleAllowed(unverified, role)), "ruolo_solo_cliente", role);
  }
  assert.equal(code(assertRoleAllowed(unverified, "osservatore")), "ok");
  const unverifiedClient = userContextFrom({ id: "u-c", email: "owner@cliente.test", emailVerified: null }, DOMAINS);
  assert.equal(code(assertRoleAllowed(unverifiedClient, "owner_cliente")), "ruolo_solo_cliente");
  // With the domain list at hand, a client role is refused to a Lateral Space domain even if the flag says otherwise.
  assert.equal(code(assertRoleAllowed({ ...CLIENT_USER, emailDomain: "ls.test" }, "owner_cliente", DOMAINS)), "ruolo_solo_cliente");
  assert.equal(code(assertRoleAllowed(CLIENT_USER, "owner_cliente", DOMAINS)), "ok");
});

test("role conflicts and member roles", () => {
  assert.equal(code(assertNoRoleConflict(["ls_lead", "ls_analista", "osservatore"])), "ok");
  assert.equal(code(assertNoRoleConflict(["owner_cliente", "approvatore_privacy"])), "ok");
  assert.equal(code(assertNoRoleConflict(["ls_analista", "owner_cliente"])), "conflitto_ruoli");
  assert.equal(code(assertMemberRoles(LS_USER, ["ls_lead", "osservatore"])), "ok");
  assert.equal(code(assertMemberRoles(LS_USER, ["ls_lead", "ai_board"])), "conflitto_ruoli");
  assert.equal(code(assertMemberRoles(CLIENT_USER, ["ls_sviluppatore"])), "ruolo_solo_lateral_space");
  assert.equal(code(checkCaseCreator({ user: LS_USER, canReviewWorkspacePortfolio: true })), "ok");
  assert.equal(code(checkCaseCreator({ user: CLIENT_USER, canReviewWorkspacePortfolio: true })), "ruolo_solo_lateral_space");
  assert.equal(code(checkCaseCreator({ user: LS_USER, canReviewWorkspacePortfolio: false })), "permesso_mancante");
});

test("checkSignerEmail: never a Lateral Space domain nor a Lateral Space member of the case", () => {
  const members = ["Anna@ls.test", "consulente@esterno.test"];
  assert.equal(code(checkSignerEmail("owner@cliente.test", DOMAINS, members)), "ok");
  assert.equal(code(checkSignerEmail("owner@ls.test", DOMAINS, members)), "firmatario_lateral_space");
  assert.equal(code(checkSignerEmail("owner@studio-ls.test", DOMAINS, members)), "firmatario_lateral_space");
  assert.equal(code(checkSignerEmail(" CONSULENTE@esterno.test ", DOMAINS, members)), "firmatario_lateral_space");
  assert.equal(code(checkSignerEmail("non-una-email", DOMAINS, members)), "email_non_valida");
  assert.equal(code(checkSignerEmail(null, DOMAINS, members)), "email_non_valida");
});

// ── Firme ──────────────────────────────────────────────────────────────

const SIG_CTX: SignatureContext = {
  lsDomains: DOMAINS,
  lsMemberEmails: ["anna@ls.test"],
  designated: { owner: "contact-owner", privacy: "contact-privacy" },
};
const LEAD_SIGNER: Signer = { kind: "account", user: LS_USER, roles: ["ls_lead"] };
const LEAD_2_SIGNER: Signer = { kind: "account", user: LS_USER_2, roles: ["ls_lead"] };
const OWNER_SIGNER: Signer = { kind: "account", user: CLIENT_USER, roles: ["owner_cliente"] };
const PRIVACY_SIGNER: Signer = { kind: "account", user: PRIVACY_USER, roles: ["approvatore_privacy"] };
const OWNER_LINK: Signer = { kind: "link", contactId: "contact-owner", designation: "owner", email: "owner@cliente.test" };
const PRIVACY_LINK: Signer = { kind: "link", contactId: "contact-privacy", designation: "privacy", email: "privacy@cliente.test" };

test("who signs what: Lateral Space is ls_lead, the client is the Owner, A.8 and the personal zone are the privacy approver", () => {
  assert.equal(clientSignerRole("na"), "owner_cliente");
  assert.equal(clientSignerRole("gate"), "owner_cliente");
  assert.equal(clientSignerRole("a8"), "approvatore_privacy");
  assert.equal(clientSignerRole("zona_personale"), "approvatore_privacy");
  assert.equal(clientSignerRole("classe_privacy"), "approvatore_privacy");
  const side = (r: ReturnType<typeof signatureRole>) => (r.ok ? `${r.value.side}:${r.value.ruolo}` : r.code);
  const cases: [string, Signer, Parameters<typeof signatureRole>[1], string, SignatureContext?][] = [
    ["ls_lead on NA", LEAD_SIGNER, "na", "ls:ls_lead"],
    ["Owner account on a waiver", OWNER_SIGNER, "deroga", "cliente:owner_cliente"],
    ["Owner link on the gate", OWNER_LINK, "gate", "cliente:owner_cliente"],
    ["privacy link on A.8", PRIVACY_LINK, "a8", "cliente:approvatore_privacy"],
    ["privacy account on A.8", PRIVACY_SIGNER, "a8", "cliente:approvatore_privacy"],
    ["Owner account on A.8", OWNER_SIGNER, "a8", "firmatario_non_ammesso"],
    ["Owner link on A.8", OWNER_LINK, "a8", "firmatario_non_ammesso"],
    ["privacy link on NA", PRIVACY_LINK, "na", "firmatario_non_ammesso"],
    ["analyst on NA", { kind: "account", user: LS_USER, roles: ["ls_analista"] }, "na", "firmatario_non_ammesso"],
    ["observer on NA", { kind: "account", user: CLIENT_USER, roles: ["osservatore"] }, "na", "firmatario_non_ammesso"],
    ["domain removed from the list", { kind: "account", user: { ...LS_USER, isLateralSpace: false }, roles: ["ls_lead"] }, "na", "ruolo_solo_lateral_space"],
    ["Owner who became Lateral Space", { kind: "account", user: { ...CLIENT_USER, isLateralSpace: true }, roles: ["owner_cliente"] }, "na", "ruolo_solo_cliente"],
    ["unverified Lateral Space domain as Owner on the gate",
      { kind: "account", user: { userId: "u-x", emailVerified: false, emailDomain: "ls.test", isLateralSpace: false }, roles: ["owner_cliente"] }, "gate", "ruolo_solo_cliente"],
    ["unverified Lateral Space domain as privacy approver on A.8",
      { kind: "account", user: { userId: "u-x", emailVerified: false, emailDomain: "ls.test", isLateralSpace: false }, roles: ["approvatore_privacy"] }, "a8", "ruolo_solo_cliente"],
    ["unverified client account on NA", { kind: "account", user: { ...CLIENT_USER, emailVerified: false }, roles: ["owner_cliente"] }, "na", "ruolo_solo_cliente"],
    ["verified account in a Lateral Space domain flagged as client", { kind: "account", user: { ...CLIENT_USER, emailDomain: "ls.test" }, roles: ["owner_cliente"] }, "deroga", "ruolo_solo_cliente"],
    ["conflicting roles", { kind: "account", user: LS_USER, roles: ["ls_lead", "owner_cliente"] }, "na", "conflitto_ruoli"],
    ["link no longer designated", OWNER_LINK, "na", "firmatario_non_designato", { ...SIG_CTX, designated: { owner: "contact-new", privacy: null } }],
    ["designated link with a Lateral Space email", { ...OWNER_LINK, email: "owner@ls.test" }, "na", "firmatario_lateral_space"],
    ["designated link with the email of a Lateral Space member", { ...OWNER_LINK, email: "anna@ls.test" }, "na", "firmatario_lateral_space"],
  ];
  for (const [name, signer, purpose, expected, ctx] of cases) {
    assert.equal(side(signatureRole(signer, purpose, ctx ?? SIG_CTX)), expected, name);
  }
});

test("addSignature: one per side, two different people, on the expected text", () => {
  const now = new Date("2026-10-07T10:00:00Z");
  const first = addSignature({ purpose: "gate", approvals: [], signer: LEAD_SIGNER, ctx: SIG_CTX, now, textHash: "h1", expectedTextHash: "h1" });
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.value.complete, false);
  assert.equal(first.value.approval.metodo, "account");
  assert.equal(code(addSignature({ purpose: "gate", approvals: first.value.approvals, signer: LEAD_2_SIGNER, ctx: SIG_CTX, now, textHash: "h1", expectedTextHash: "h1" })), "firma_gia_presente");
  assert.equal(code(addSignature({ purpose: "gate", approvals: first.value.approvals, signer: OWNER_LINK, ctx: SIG_CTX, now, textHash: "h2", expectedTextHash: "h1" })), "testo_cambiato");
  const second = addSignature({ purpose: "gate", approvals: first.value.approvals, signer: OWNER_LINK, ctx: SIG_CTX, now, textHash: "h1", expectedTextHash: "h1", ipHash: "ip" });
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.equal(second.value.complete, true);
  assert.equal(second.value.approval.metodo, "link");
  assert.equal(second.value.approval.email_domain, "cliente.test");
  assert.equal(second.value.approval.contact_id, "contact-owner");
  // The same person cannot put both signatures (a stored approval with the same user on the other side).
  const forged: Approval[] = [{ ruolo: "owner_cliente", user_id: "u-ls", at: now.toISOString(), metodo: "account" }];
  assert.equal(code(addSignature({ purpose: "gate", approvals: forged, signer: LEAD_SIGNER, ctx: SIG_CTX, now })), "stessa_persona");
});

test("addSignature: a link signer carries the keyed IP hash into the approval; an account signer never does", () => {
  const now = new Date("2026-10-07T10:00:00Z");
  const link = addSignature({ purpose: "deroga", approvals: [], signer: { ...OWNER_LINK, ipHash: "ab".repeat(16) }, ctx: SIG_CTX, now, textHash: "h", expectedTextHash: "h" });
  assert.ok(link.ok);
  if (!link.ok) return;
  assert.deepEqual([link.value.approval.metodo, link.value.approval.ip_hash], ["link", "ab".repeat(16)]);
  const explicit = addSignature({ purpose: "deroga", approvals: [], signer: { ...OWNER_LINK, ipHash: "ab".repeat(16) }, ctx: SIG_CTX, now, ipHash: "cd".repeat(16) });
  assert.equal(explicit.ok && explicit.value.approval.ip_hash, "cd".repeat(16), "an explicit hash wins");
  const noHash = addSignature({ purpose: "deroga", approvals: [], signer: OWNER_LINK, ctx: SIG_CTX, now });
  assert.equal(noHash.ok && noHash.value.approval.ip_hash, null);
  const account = addSignature({ purpose: "deroga", approvals: [], signer: LEAD_SIGNER, ctx: SIG_CTX, now });
  assert.equal(account.ok && account.value.approval.ip_hash, null);
});

test("approvalsComplete needs ls_lead and the right client role from two people", () => {
  const at = "2026-10-07T10:00:00Z";
  const lead: Approval = { ruolo: "ls_lead", user_id: "u-ls", at, metodo: "account" };
  const owner: Approval = { ruolo: "owner_cliente", contact_id: "contact-owner", at, metodo: "link" };
  const privacy: Approval = { ruolo: "approvatore_privacy", user_id: "u-privacy", at, metodo: "account" };
  assert.deepEqual(approvalsComplete([lead], "deroga"), { ls: true, cliente: false, complete: false });
  assert.deepEqual(approvalsComplete([owner], "deroga"), { ls: false, cliente: true, complete: false });
  assert.deepEqual(approvalsComplete([lead, owner], "deroga"), { ls: true, cliente: true, complete: true });
  assert.deepEqual(approvalsComplete([lead, owner], "a8"), { ls: true, cliente: false, complete: false }, "A.8 needs the privacy approver");
  assert.deepEqual(approvalsComplete([lead, privacy], "a8"), { ls: true, cliente: true, complete: true });
  assert.equal(approvalsComplete([lead, { ...privacy, user_id: "u-ls" }], "a8").complete, false, "same person on both sides");
  assert.equal(approvalsComplete([{ ...lead, user_id: null }, owner], "na").complete, false, "Lateral Space signs only from an account");
});

test("NA signatures write the right columns and complete with both sides", () => {
  const proposed = { na: { reason: "Il dato non serve al modello", proposedAt: EARLIER, lsUserId: null, clientUserId: null, clientContactId: null, approvedAt: null } };
  const ls = naSignaturePatch({ item: proposed, signer: LEAD_SIGNER, ctx: SIG_CTX });
  assert.ok(ls.ok);
  assert.deepEqual(ls.ok && ls.value, { patch: { naApprovedByUserId: "u-ls" }, side: "ls", complete: false });
  const withLs = { na: { ...proposed.na, lsUserId: "u-ls" } };
  assert.equal(code(naSignaturePatch({ item: withLs, signer: LEAD_2_SIGNER, ctx: SIG_CTX })), "firma_gia_presente");
  const byLink = naSignaturePatch({ item: withLs, signer: OWNER_LINK, ctx: SIG_CTX });
  assert.deepEqual(byLink.ok && byLink.value, { patch: { naApprovedByContactId: "contact-owner" }, side: "cliente", complete: true });
  const byAccount = naSignaturePatch({ item: withLs, signer: OWNER_SIGNER, ctx: SIG_CTX });
  assert.deepEqual(byAccount.ok && byAccount.value, { patch: { naClientApprovedByUserId: "u-client" }, side: "cliente", complete: true });
  assert.equal(code(naSignaturePatch({ item: { na: { ...proposed.na, proposedAt: null } }, signer: LEAD_SIGNER, ctx: SIG_CTX })), "na_non_proposta");
  assert.equal(code(naSignaturePatch({ item: { na: { ...proposed.na, approvedAt: EARLIER } }, signer: LEAD_SIGNER, ctx: SIG_CTX })), "na_gia_approvata");
  assert.equal(code(naSignaturePatch({ item: proposed, signer: PRIVACY_LINK, ctx: SIG_CTX })), "firmatario_non_ammesso");
});

test("a pending NA signature from the link of a contact no longer designated is dropped", () => {
  const pending = { na: { reason: "Il dato non serve al modello", proposedAt: EARLIER, lsUserId: "u-ls", clientUserId: null, clientContactId: "contact-owner", approvedAt: null } };
  assert.deepEqual(naSignatures(pending, "contact-owner"), { ls: true, client: true, complete: true });
  assert.deepEqual(naSignatures(pending, "contact-new"), { ls: true, client: false, complete: false });
  assert.deepEqual(naSignatures(pending, null), { ls: true, client: false, complete: false });
  // Without the designation at hand the old behaviour stays (the command must pass it).
  assert.deepEqual(naSignatures(pending), { ls: true, client: true, complete: true });
  assert.deepEqual(staleNaLinkSignaturePatch(pending, "contact-new"), { naApprovedByContactId: null });
  assert.equal(staleNaLinkSignaturePatch(pending, "contact-owner"), null);
  // An NA already approved keeps its history.
  assert.equal(staleNaLinkSignaturePatch({ na: { ...pending.na, approvedAt: EARLIER } }, "contact-new"), null);
  // The new designee's link, or the Owner's account, can sign again; the account drops the stale link signature.
  const ctx = { ...SIG_CTX, designated: { owner: "contact-new", privacy: null } };
  const byAccount = naSignaturePatch({ item: pending, signer: OWNER_SIGNER, ctx });
  assert.deepEqual(byAccount.ok && byAccount.value, { patch: { naClientApprovedByUserId: "u-client", naApprovedByContactId: null }, side: "cliente", complete: true });
  const byNewLink = naSignaturePatch({ item: pending, signer: { ...OWNER_LINK, contactId: "contact-new" }, ctx });
  assert.deepEqual(byNewLink.ok && byNewLink.value, { patch: { naApprovedByContactId: "contact-new" }, side: "cliente", complete: true });
});

test("a referent contact is a client person: no Lateral Space email or account, at creation, email change and assignment", () => {
  const base = { lsDomains: DOMAINS, lsMemberEmails: ["anna@ls.test"] };
  assert.equal(code(checkContactEmail({ ...base, email: "ref@cliente.test" })), "ok");
  assert.equal(code(checkContactEmail({ ...base, email: null })), "ok");
  assert.equal(code(checkContactEmail({ ...base, email: "  " })), "ok");
  assert.equal(code(checkContactEmail({ ...base, email: "collega@LS.test" })), "referente_lateral_space");
  assert.equal(code(checkContactEmail({ ...base, email: " Anna@ls.test " })), "referente_lateral_space");
  assert.equal(code(checkContactEmail({ ...base, email: "non-valida" })), "email_non_valida");
  assert.equal(code(checkContactEmail({ ...base, email: "ref@cliente.test", user: { isLateralSpace: true, emailDomain: "ls.test" } })), "referente_lateral_space");
  assert.equal(code(checkContactEmail({ ...base, email: null, user: { isLateralSpace: false, emailDomain: "ls.test" } })), "referente_lateral_space");
  const contact = { email: "ref@cliente.test", isActive: true, anonymized: false };
  assert.equal(code(checkAssignee({ ...base, contact })), "ok");
  assert.equal(code(checkAssignee({ ...base, contact: { ...contact, email: "x@ls.test" } })), "referente_lateral_space");
  assert.equal(code(checkAssignee({ ...base, contact: { ...contact, isActive: false } })), "contatto_non_attivo");
  assert.equal(code(checkAssignee({ ...base, contact: { ...contact, anonymized: true } })), "contatto_non_attivo");
});

// ── Firmatari designati (D16) ─────────────────────────────────────────

test("signer designation: by ls_lead or the Owner, with written evidence, to a non Lateral Space email", () => {
  const contact = { id: "contact-owner", email: "owner@cliente.test", isActive: true, anonymized: false };
  const base = { designation: "owner" as const, contact, evidenceFileId: "file-1", ctx: SIG_CTX };
  assert.equal(code(checkSignerDesignation({ ...base, actor: { user: LS_USER, roles: ["ls_lead"] } })), "ok");
  assert.equal(code(checkSignerDesignation({ ...base, actor: { user: CLIENT_USER, roles: ["owner_cliente"] } })), "ok");
  assert.equal(code(checkSignerDesignation({ ...base, actor: { user: LS_USER, roles: ["ls_analista"] } })), "ruolo_non_ammesso");
  assert.equal(code(checkSignerDesignation({ ...base, actor: { user: { ...LS_USER, isLateralSpace: false }, roles: ["ls_lead"] } })), "ruolo_non_ammesso");
  const lead = { user: LS_USER, roles: ["ls_lead"] as CaseRole[] };
  assert.equal(code(checkSignerDesignation({ ...base, actor: lead, evidenceFileId: null })), "prova_mancante");
  assert.equal(code(checkSignerDesignation({ ...base, actor: lead, contact: { ...contact, email: null } })), "email_mancante");
  assert.equal(code(checkSignerDesignation({ ...base, actor: lead, contact: { ...contact, email: "x@ls.test" } })), "firmatario_lateral_space");
  assert.equal(code(checkSignerDesignation({ ...base, actor: lead, contact: { ...contact, isActive: false } })), "contatto_non_attivo");
  assert.equal(code(checkSignerDesignation({ ...base, actor: lead, contact: { ...contact, anonymized: true } })), "contatto_non_attivo");
});

test("a new designee or a new email cancels pending link signatures", () => {
  const a = { contactId: "c1", email: "owner@cliente.test" };
  assert.equal(designationChanged(null, null), false);
  assert.equal(designationChanged(a, { ...a, email: " OWNER@cliente.test " }), false);
  assert.equal(designationChanged(a, { ...a, email: "altro@cliente.test" }), true);
  assert.equal(designationChanged(a, { contactId: "c2", email: a.email }), true);
  assert.equal(designationChanged(a, null), true);
  const at = "2026-10-07T10:00:00Z";
  const approvals: Approval[] = [
    { ruolo: "ls_lead", user_id: "u-ls", at, metodo: "account" },
    { ruolo: "owner_cliente", contact_id: "c1", at, metodo: "link" },
  ];
  assert.deepEqual(dropLinkApprovals(approvals, "c1"), [approvals[0]]);
});

// ── Zona personale (D46) ──────────────────────────────────────────────

test("personal zone: proposed by ls_lead for someone else in the A.8 evidence, active only with the privacy approver", () => {
  const now = new Date("2026-10-07T10:00:00Z");
  const proposer = { user: LS_USER, roles: ["ls_lead"] as CaseRole[] };
  const beneficiary = { user: LS_USER_2, roles: ["ls_analista"] as CaseRole[] };
  const base = { proposer, beneficiary, a8Status: "sciolto" as const, a8EvidenceUserIds: ["u-ls-2"], now };
  const proposal = checkPersonalZoneProposal(base);
  assert.ok(proposal.ok);
  assert.equal(code(checkPersonalZoneProposal({ ...base, a8Status: "attivo" })), "a8_non_sciolto");
  assert.equal(code(checkPersonalZoneProposal({ ...base, beneficiary: proposer, a8EvidenceUserIds: ["u-ls"] })), "autoconcessione");
  assert.equal(code(checkPersonalZoneProposal({ ...base, a8EvidenceUserIds: [] })), "non_nella_scheda_a8");
  assert.equal(code(checkPersonalZoneProposal({ ...base, proposer: { user: LS_USER, roles: ["ls_analista"] } })), "ruolo_non_ammesso");
  assert.equal(code(checkPersonalZoneProposal({ ...base, beneficiary: { user: CLIENT_USER, roles: ["owner_cliente"] }, a8EvidenceUserIds: ["u-client"] })), "ruolo_non_ammesso");
  if (!proposal.ok) return;
  const grant = proposal.value.grant;
  const sign = (signer: Signer, a8Status: "sciolto" | "attivo" = "sciolto") => checkPersonalZoneSignature({ grant, signer, ctx: SIG_CTX, a8Status, now });
  assert.equal(code(sign(LEAD_2_SIGNER)), "firmatario_non_ammesso", "a Lateral Space signature does not grant access");
  assert.equal(code(sign(OWNER_SIGNER)), "firmatario_non_ammesso", "the Owner is not the privacy approver");
  assert.equal(code(sign(PRIVACY_SIGNER, "attivo")), "a8_non_sciolto");
  const signed = sign(PRIVACY_SIGNER);
  assert.ok(signed.ok && signed.value.active);
  assert.equal(signed.ok && signed.value.grant.approvals.length, 1);
  assert.ok(sign(PRIVACY_LINK).ok);
  // Access counts only while it is granted, a8 is resolved and the Lateral Space role still holds.
  const access = { user: LS_USER_2, roles: ["ls_analista"] as CaseRole[], personalZoneAccess: true, a8Status: "sciolto" as const };
  assert.equal(personalZoneAllowed(access), true);
  assert.equal(personalZoneAllowed({ ...access, a8Status: "attivo" }), false);
  assert.equal(personalZoneAllowed({ ...access, personalZoneAccess: false }), false);
  assert.equal(personalZoneAllowed({ ...access, user: { ...LS_USER_2, isLateralSpace: false } }), false);
  assert.equal(personalZoneAllowed({ ...access, user: PRIVACY_USER, roles: ["approvatore_privacy"] }), false);
});

// ── Matrice e visibilità dei valori ───────────────────────────────────

test("the action matrix follows the plan, role by role", () => {
  const expected: Record<CaseRole, CaseAction[]> = {
    ls_lead: [
      "vedere_caso", "vedere_sintesi", "vedere_catalogo_validato", "vedere_metadati_privacy", "vedere_commenti_interni",
      "modificare_catalogo", "proporre_voci", "proporre_na", "gestire_membri", "aggiungere_referenti", "assegnare",
      "inviare_richieste", "revocare_link", "riassegnare", "validare", "esiti_verifica", "firma_ls", "proporre_gate",
      "sciogliere_blocco", "zona_personale", "export", "export_validato", "registro",
    ],
    ls_analista: [
      "vedere_caso", "vedere_sintesi", "vedere_catalogo_validato", "vedere_metadati_privacy", "vedere_commenti_interni",
      "proporre_voci", "proporre_na", "validare", "esiti_verifica", "zona_personale", "export", "export_validato",
    ],
    ls_sviluppatore: ["vedere_catalogo_validato", "zona_personale", "export_validato"],
    owner_cliente: [
      "vedere_caso", "vedere_sintesi", "vedere_catalogo_validato", "vedere_metadati_privacy", "aggiungere_referenti",
      "riassegnare", "firma_cliente", "export", "export_validato", "registro_filtrato",
    ],
    approvatore_privacy: ["vedere_metadati_privacy", "firmare_a8", "metadati_zona_personale", "registro_filtrato"],
    ai_board: ["vedere_sintesi", "prova_decisione_board"],
    osservatore: ["vedere_sintesi"],
  };
  const actions = Object.keys(CASE_ACTION_ROLES) as CaseAction[];
  for (const role of CASE_ROLES) {
    const allowed = actions.filter((a) => can([role], a)).sort();
    assert.deepEqual(allowed, [...expected[role]].sort(), role);
  }
  assert.equal(can([], "vedere_sintesi"), false);
  assert.equal(can(["osservatore", "owner_cliente"], "firma_cliente"), true);
});

test("value visibility: health never, personal only Lateral Space with zone access, then value_visibility", () => {
  assert.equal(valueVisibleTo("tutti_i_ruoli_del_caso", ["ls_lead"], "escluso_sanitario", true), false);
  for (const privacy of ["personale", "personale_equipaggio"] as const) {
    assert.equal(valueVisibleTo("tutti_i_ruoli_del_caso", ["ls_lead"], privacy, false), false, privacy);
    assert.equal(valueVisibleTo("tutti_i_ruoli_del_caso", ["ls_analista"], privacy, true), true, privacy);
    assert.equal(valueVisibleTo("tutti_i_ruoli_del_caso", ["owner_cliente"], privacy, true), false, privacy);
  }
  assert.equal(valueVisibleTo("owner_e_ls", ["owner_cliente"], "riservato_azienda", false), true);
  assert.equal(valueVisibleTo("owner_e_ls", ["ai_board"], "riservato_azienda", false), false);
  assert.equal(valueVisibleTo("solo_ls", ["owner_cliente"], "nessuna", false), false);
  assert.equal(valueVisibleTo("solo_ls", ["ls_sviluppatore"], "nessuna", false), true);
  assert.equal(valueVisibleTo("tutti_i_ruoli_del_caso", ["osservatore"], "nessuna", false), true);
  assert.equal(valueVisibleTo("tutti_i_ruoli_del_caso", [], "nessuna", false), false);
  // Roles that see only the summary or the privacy metadata never see company-confidential values.
  for (const role of ["osservatore", "ai_board", "approvatore_privacy"] as const) {
    assert.equal(valueVisibleTo("tutti_i_ruoli_del_caso", [role], "riservato_azienda", false), false, role);
    assert.equal(valueVisibleTo("tutti_i_ruoli_del_caso", [role], "nessuna", false), true, role);
  }
  for (const role of ["ls_lead", "ls_analista", "ls_sviluppatore", "owner_cliente"] as const) {
    assert.equal(valueVisibleTo("tutti_i_ruoli_del_caso", [role], "riservato_azienda", false), true, role);
  }
});
