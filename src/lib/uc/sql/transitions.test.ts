import test from "node:test";
import assert from "node:assert/strict";
import {
  NO_ACTIVE_BLOCKER,
  answerInsertSql,
  blockerUpdateSql,
  caseRevisionSql,
  caseTokenScope,
  caseTransitionSql,
  catalogFreezeCaseSql,
  dropPendingApprovalsSql,
  gateReviewDecideSql,
  itemSetSql,
  itemSnapshotsSql,
  itemUpdateSql,
  planItemTransitions,
  plannedSideEffects,
  requestItemsStateSql,
  revokeCaseMcpTokensSql,
  rowToLoadedItem,
  transitionStatements,
  type TransitionRequest,
} from "./transitions.ts";
import { toStatement } from "./statement.ts";
import type { Actor, AnswerMeta, ItemSnapshot, UserContext } from "../types.ts";

const NOW = new Date("2026-10-07T10:00:00.000Z");
const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const LS_USER = "33333333-3333-4333-8333-333333333333";
const OTHER_LS = "44444444-4444-4444-8444-444444444444";
const ITEM_A = "55555555-5555-4555-8555-555555555555";
const ITEM_B = "66666666-6666-4666-8666-666666666666";
const CONTACT = "77777777-7777-4777-8777-777777777777";

const lsUser: UserContext = { userId: LS_USER, emailVerified: true, emailDomain: "ls.test", isLateralSpace: true };
const lead: Actor = { type: "utente", userId: LS_USER, roles: ["ls_lead"] };
const system: Actor = { type: "sistema", job: "blocchi" };

function answer(over: Partial<AnswerMeta> = {}): AnswerMeta {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    version: 1,
    kind: "valore",
    sourceKind: "referente",
    responderContactId: CONTACT,
    responderUserId: null,
    requestId: "99999999-9999-4999-8999-999999999999",
    validFrom: null,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    textHash: null,
    typed: true,
    ...over,
  };
}

function snap(over: Partial<ItemSnapshot> = {}): ItemSnapshot {
  return {
    id: ITEM_A,
    key: "q.prova.01",
    kind: "domanda",
    status: "bloccata",
    priority: "must",
    perimeter: "in_contratto",
    servesFor: ["modello"],
    inGateScope: true,
    privacyClass: "riservato_azienda",
    responseType: "numero",
    ownerRoleKey: "resp_servizio",
    assigneeContactId: CONTACT,
    requiresValidityPeriod: false,
    freshnessDays: null,
    staleAt: null,
    currentAnswer: null,
    answerResponderUserIds: [],
    currentAnswerTokenIssuerUserIds: [],
    confirmedByContactId: null,
    confirmedByRoleKey: null,
    responderRoleKey: null,
    na: { reason: null, proposedAt: null, lsUserId: null, clientUserId: null, clientContactId: null, approvedAt: null },
    waiver: null,
    fallback: null,
    partialNa: null,
    activeBlockerKeys: [],
    openClarification: false,
    hasActiveRequestItem: false,
    lastAutoCheckError: false,
    ...over,
  };
}

const caseRaccolta = { status: "raccolta" as const, statusBeforeSuspension: null };

test("itemSetSql maps the transition patch to columns with casts and always touches updated_at", () => {
  const s = toStatement(itemSetSql({ status: "validata", statusReason: null, validatedAt: NOW, validatedByUserId: LS_USER }, { currentAnswerId: ITEM_B }));
  assert.equal(
    s.text,
    "status = $1::text, status_reason = $2::text, validated_by_user_id = $3::uuid, validated_at = $4::timestamptz, current_answer_id = $5::uuid, updated_at = now()",
  );
  assert.deepEqual(s.params, ["validata", null, LS_USER, NOW.toISOString(), ITEM_B]);
  assert.equal(toStatement(itemSetSql({})).text, "updated_at = now()");
});

test("itemUpdateSql is a CAS on status and current answer, with one event per updated row and uc_require on the count", () => {
  const s = itemUpdateSql({
    workspaceId: WS,
    caseId: CASE,
    targets: [
      { id: ITEM_A, currentAnswerId: null },
      { id: ITEM_B, currentAnswerId: null },
    ],
    from: "bloccata",
    set: itemSetSql({ status: "da_chiedere", statusChangedAt: NOW, statusReason: null }),
    guards: [NO_ACTIVE_BLOCKER],
    events: [{ type: "voce.stato_cambiato", actor: { type: "sistema" }, states: true, payload: { trigger: "blocco_sciolto", value: "segreto" } }],
  });
  assert.match(s.text, /UPDATE uc_items i SET status = \$\d+::text/);
  assert.match(s.text, /i\.status = \$\d+::text AND i\.deleted_at IS NULL/);
  assert.match(s.text, /i\.current_answer_id IS NOT DISTINCT FROM x\.cur/);
  assert.match(s.text, /NOT EXISTS \(SELECT 1 FROM uc_item_blockers ib/);
  assert.match(s.text, /INSERT INTO uc_events/);
  assert.match(s.text, /SELECT uc_require\(count\(\*\) = \$\d+::int, 'conflitto'\) AS ok FROM u$/);
  assert.ok(s.params.includes(2), "expected count is the number of targets");
  const targets = JSON.parse(String(s.params[0])) as { id: string; check_nap: boolean }[];
  assert.deepEqual(
    targets.map((t) => t.id),
    [ITEM_A, ITEM_B],
  );
  assert.equal(targets[0].check_nap, false);
  assert.ok(!s.params.some((p) => typeof p === "string" && p.includes("segreto")), "payload is minimized by eventPayload");
  assert.throws(() => itemUpdateSql({ workspaceId: WS, caseId: CASE, targets: [], from: "bloccata", set: itemSetSql({}), events: [] }));
});

test("itemUpdateSql checks the NA proposal at millisecond precision only when asked", () => {
  const s = itemUpdateSql({
    workspaceId: WS,
    caseId: CASE,
    targets: [{ id: ITEM_A, currentAnswerId: null, naProposedAt: NOW }],
    from: "da_chiedere",
    set: itemSetSql({ naApprovedByUserId: LS_USER }),
    events: [],
  });
  assert.match(s.text, /date_trunc\('milliseconds', i\.na_proposed_at\) IS NOT DISTINCT FROM x\.nap/);
  const [target] = JSON.parse(String(s.params[0])) as { check_nap: boolean; nap: string }[];
  assert.equal(target.check_nap, true);
  assert.equal(target.nap, NOW.toISOString());
});

test("requestItemsStateSql touches only active rows, or only the referent's own request", () => {
  const ls = requestItemsStateSql({ caseId: CASE, itemIds: [ITEM_A], state: "riassegnata" });
  assert.match(ls.text, /state IN \('da_fare', 'bozza', 'inviata'\)/);
  const ref = requestItemsStateSql({ caseId: CASE, itemIds: [ITEM_A], state: "inviata", requestId: "99999999-9999-4999-8999-999999999999" });
  assert.match(ref.text, /request_id = \$\d+::uuid/);
  assert.doesNotMatch(ref.text, /state IN/);
});

test("caseRevisionSql bumps the revision under the expected case status and revision", () => {
  const s = caseRevisionSql({ workspaceId: WS, caseId: CASE, expectStatus: ["raccolta"], expectRevision: 7 });
  assert.match(s.text, /catalog_revision = catalog_revision \+ 1/);
  assert.match(s.text, /status = ANY\(\$\d+::text\[\]\)/);
  assert.match(s.text, /catalog_revision = \$\d+::int/);
  assert.match(s.text, /setup_completed_at IS NOT NULL/);
  assert.match(s.text, /uc_require\(count\(\*\) = \$\d+::int, 'conflitto'\)/);
  const noBump = caseRevisionSql({ workspaceId: WS, caseId: CASE, bump: false });
  assert.doesNotMatch(noBump.text, /catalog_revision \+ 1/);
});

test("caseTransitionSql is a CAS on status and status before suspension, with the event in the same statement", () => {
  const s = caseTransitionSql({
    workspaceId: WS,
    caseId: CASE,
    from: "sospeso",
    statusBeforeSuspension: "raccolta",
    patch: { status: "raccolta", statusChangedAt: NOW, statusBeforeSuspension: null, suspensionReason: null },
    actor: { type: "utente", userId: LS_USER },
    reasonCode: "Not a code!",
  });
  assert.match(s.text, /status = \$\d+::text AND status_before_suspension IS NOT DISTINCT FROM \$\d+::text/);
  assert.match(s.text, /status_before_suspension = \$\d+::text/);
  assert.ok(s.params.includes("caso.stato_cambiato"));
  assert.ok(!s.params.some((p) => typeof p === "string" && p.includes("Not a code")), "free text never reaches the event");
});

test("closing a case revokes the case-scoped MCP tokens by their scope marker", () => {
  const s = revokeCaseMcpTokensSql(WS, CASE.toUpperCase());
  assert.match(s.text, /scopes \? \$\d+::text AND revoked_at IS NULL/);
  assert.ok(s.params.includes(`uc:case:${CASE}`));
  assert.equal(caseTokenScope(CASE.toUpperCase()), `uc:case:${CASE}`);
});

test("dropPendingApprovalsSql removes only pending signatures, for a user or a contact", () => {
  const mixed = "ABCDEF01-2345-4abc-8def-0123456789ab";
  const byUser = dropPendingApprovalsSql({ scope: { caseId: CASE }, match: { userId: mixed } });
  const byContact = dropPendingApprovalsSql({ scope: { workspaceId: WS }, match: { contactId: CONTACT } });
  assert.equal(byUser.length, 7);
  assert.equal(byContact.length, 7);
  assert.match(byUser[0].text, /na_approved_by_user_id = CASE WHEN/);
  assert.match(byUser[0].text, /na_approved_at IS NULL/);
  assert.match(byContact[0].text, /na_approved_by_contact_id = NULL/);
  assert.match(byContact[0].text, /case_id IN \(SELECT id FROM uc_cases WHERE workspace_id = /);
  assert.ok(byUser.some((s) => /UPDATE uc_gate_reviews g SET approvals/.test(s.text) && /g\.decision = 'proposto'/.test(s.text)));
  assert.ok(byUser.some((s) => /UPDATE uc_blockers b SET approvals/.test(s.text) && /b\.status = 'attivo'/.test(s.text)));
  assert.ok(byUser.some((s) => /waiver_approved_at IS NULL/.test(s.text)));
  assert.ok(byUser.some((s) => /personal_zone_access = false/.test(s.text)));
  assert.ok(byUser.every((s) => !s.params.includes(mixed)), "ids are compared in lower case");
  assert.ok(byUser.some((s) => s.params.includes(mixed.toLowerCase())));
});

test("answerInsertSql appends version max + 1 and audits without the value", () => {
  const s = answerInsertSql({
    id: ITEM_B,
    workspaceId: WS,
    caseId: CASE,
    itemId: ITEM_A,
    kind: "valore",
    value: { text: "valore riservato" },
    valueNormalized: null,
    validFrom: null,
    confidence: null,
    note: null,
    sourceKind: "documento",
    sourceRef: "Contratto, pag. 3",
    sourceBasis: "documento",
    responderUserId: LS_USER,
    textHash: null,
    responseType: "testo",
    actor: { type: "utente", userId: LS_USER },
  });
  assert.match(s.text, /coalesce\(\(SELECT max\(x\.version\) FROM uc_answers x WHERE x\.item_id = i\.id\), 0\) \+ 1/);
  assert.match(s.text, /'risposta\.inviata'|INSERT INTO uc_events/);
  const eventPayloads = s.params.filter((p) => typeof p === "string" && p.startsWith("{") && p.includes("source_kind"));
  assert.equal(eventPayloads.length, 1);
  assert.doesNotMatch(String(eventPayloads[0]), /valore riservato/);
});

test("gate decisions and blocker updates are CAS on the signatures read", () => {
  const g = gateReviewDecideSql({ reviewId: ITEM_A, caseId: CASE, decision: "approvato", oldApprovals: [], approvals: [], catalogVersion: 1, snapshotHash: "a".repeat(64) });
  assert.match(g.text, /decision = 'proposto' AND approvals = \$\d+::jsonb/);
  const b = blockerUpdateSql({ blockerId: ITEM_A, caseId: CASE, fromStatus: "attivo", oldApprovals: [], status: "sciolto", approvals: [], resolvedByUserId: LS_USER, resolved: true });
  assert.match(b.text, /status = \$\d+::text AND approvals = \$\d+::jsonb/);
  assert.match(b.text, /resolved_at = now\(\)/);
  const f = catalogFreezeCaseSql({ workspaceId: WS, caseId: CASE, expectRevision: 4, version: 2, fromStatus: "pronto_sviluppo", toStatus: null });
  assert.match(f.text, /catalog_revision = \$\d+::int AND catalog_version = \$\d+::int AND status = \$\d+::text/);
  assert.ok(f.params.includes(4) && f.params.includes(1) && f.params.includes(2));
});

test("rowToLoadedItem reads JSON, Postgres arrays and blocker links", () => {
  const loaded = rowToLoadedItem({
    id: ITEM_A,
    key: "q.prova.01",
    kind: "domanda",
    section: "modello_dati",
    status: "in_verifica",
    priority: "must",
    perimeter: "in_contratto",
    serves_for: '["modello","inventato"]',
    in_gate_scope: true,
    privacy_class: "riservato_azienda",
    response_type: "numero",
    owner_role_key: "resp_servizio",
    assignee_contact_id: CONTACT,
    requires_validity_period: "t",
    freshness_days: "30",
    stale_at: null,
    current_answer_id: "88888888-8888-4888-8888-888888888888",
    confirmed_by_contact_id: null,
    na_reason: null,
    na_proposed_at: null,
    waiver: null,
    fallback: null,
    partial_na: null,
    availability: "[]",
    levers: [],
    spec: { health_rule_question: true, blocked_by: ["a8"] },
    title: "Domanda",
    a_id: "88888888-8888-4888-8888-888888888888",
    a_version: 2,
    a_kind: "valore",
    a_source_kind: "referente",
    a_responder_contact_id: CONTACT,
    a_responder_user_id: null,
    a_request_id: "99999999-9999-4999-8999-999999999999",
    a_valid_from: "2026-01-01",
    a_created_at: "2026-10-01T10:00:00Z",
    a_text_hash: null,
    a_typed: false,
    responder_role_key: "resp_servizio",
    responder_user_ids: `["${OTHER_LS}"]`,
    token_issuer_user_ids: "{}",
    blocker_links: [
      { blocker_id: ITEM_B, key: "a8", origin: "template", status: "sciolto" },
      { blocker_id: CASE, key: "sanitario", origin: "scope", status: "permanente" },
    ],
    open_clarification: false,
    active_request_id: "99999999-9999-4999-8999-999999999999",
    last_auto_check_error: true,
  });
  const s = loaded.snapshot;
  assert.deepEqual(s.servesFor, ["modello"]);
  assert.equal(s.requiresValidityPeriod, true);
  assert.equal(s.freshnessDays, 30);
  assert.deepEqual(s.answerResponderUserIds, [OTHER_LS]);
  assert.deepEqual(s.currentAnswerTokenIssuerUserIds, []);
  assert.deepEqual(s.activeBlockerKeys, ["sanitario"]);
  assert.equal(s.hasActiveRequestItem, true);
  assert.equal(s.lastAutoCheckError, true);
  assert.equal(s.currentAnswer?.version, 2);
  assert.equal(s.currentAnswer?.validFrom, "2026-01-01");
  assert.equal(s.currentAnswer?.typed, false);
  assert.equal(loaded.extra.healthRuleQuestion, true);
  assert.equal(loaded.extra.blockerLinks.length, 2);
});

test("itemSnapshotsSql filters by ids or by status, never reads answer values", () => {
  const byIds = itemSnapshotsSql(CASE, { itemIds: [ITEM_A] });
  assert.match(byIds.text, /i\.id = ANY\(\$\d+::uuid\[\]\)/);
  assert.doesNotMatch(byIds.text, /a\.value\b|a\.value,|value_encrypted AS/);
  const byStatus = itemSnapshotsSql(CASE, { statuses: ["chiesta"] });
  assert.match(byStatus.text, /i\.status = ANY\(\$\d+::text\[\]\)/);
});

test("planItemTransitions runs checkItemTransition for every item and names the failing key", () => {
  const items = new Map([
    [ITEM_A, snap()],
    [ITEM_B, snap({ id: ITEM_B, key: "q.prova.02", activeBlockerKeys: ["a8"] })],
  ]);
  const requests: TransitionRequest[] = [
    { itemId: ITEM_A, to: "da_chiedere", trigger: "blocco_sciolto", blockerKeys: [] },
    { itemId: ITEM_B, to: "da_chiedere", trigger: "blocco_sciolto" },
  ];
  const r = planItemTransitions({ items, requests, actor: system, now: NOW, case: caseRaccolta });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.message, /^q\.prova\.02: /);

  const dup = planItemTransitions({ items, requests: [requests[0], requests[0]], actor: system, now: NOW, case: caseRaccolta });
  assert.equal(dup.ok ? null : dup.code, "voce_ripetuta");
  const missing = planItemTransitions({ items, requests: [{ itemId: CASE, to: "da_chiedere", trigger: "blocco_sciolto" }], actor: system, now: NOW, case: caseRaccolta });
  assert.equal(missing.ok ? null : missing.code, "voce_non_trovata");
});

test("overrides describe facts the same batch creates (e.g. the confirmation request)", () => {
  const item = snap({ status: "in_verifica", currentAnswer: answer({ sourceKind: "dichiarato_in_call", responderContactId: null }), hasActiveRequestItem: false });
  const items = new Map([[ITEM_A, item]]);
  const without = planItemTransitions({ items, requests: [{ itemId: ITEM_A, to: "chiesta", trigger: "richiesta_conferma" }], actor: lead, user: lsUser, now: NOW, case: caseRaccolta });
  assert.equal(without.ok ? null : without.code, "richiesta_assente");
  const withOverride = planItemTransitions({
    items,
    requests: [{ itemId: ITEM_A, to: "chiesta", trigger: "richiesta_conferma", overrides: { hasActiveRequestItem: true } }],
    actor: lead,
    user: lsUser,
    now: NOW,
    case: caseRaccolta,
  });
  assert.ok(withOverride.ok);
  assert.deepEqual(plannedSideEffects(withOverride.value), ["richiesta_conferma"]);
});

test("transitionStatements groups identical transitions into one CAS; guards group only when declared", () => {
  const items = new Map([
    [ITEM_A, snap()],
    [ITEM_B, snap({ id: ITEM_B, key: "q.prova.02" })],
  ]);
  const plan = (guardGroup?: string) =>
    planItemTransitions({
      items,
      requests: [ITEM_A, ITEM_B].map((itemId) => ({ itemId, to: "da_chiedere" as const, trigger: "blocco_sciolto" as const, blockerKeys: [], guards: [NO_ACTIVE_BLOCKER], guardGroup })),
      actor: system,
      now: NOW,
      case: caseRaccolta,
    });
  const grouped = plan("sblocco");
  assert.ok(grouped.ok);
  const g = transitionStatements({ workspaceId: WS, caseId: CASE, actor: system, planned: grouped.value });
  assert.equal(g.length, 1, "one UPDATE for both items, no request rows to touch");
  assert.ok(g[0].params.includes(2));
  const solo = plan();
  assert.ok(solo.ok);
  assert.equal(transitionStatements({ workspaceId: WS, caseId: CASE, actor: system, planned: solo.value }).length, 2);
});

test("transitionStatements writes the request item state; a referent touches only its own request", () => {
  const requestId = "99999999-9999-4999-8999-999999999999";
  const item = snap({ status: "chiesta", hasActiveRequestItem: true, assigneeContactId: CONTACT });
  const referent: Actor = { type: "referente", contactId: CONTACT, requestId, roleKey: "resp_servizio" };
  const planned = planItemTransitions({
    items: new Map([[ITEM_A, item]]),
    requests: [{ itemId: ITEM_A, to: "mancante", trigger: "non_so", answer: { kind: "non_so", sourceKind: "referente" }, actorRequestItem: { requestId, state: "inviata" } }],
    actor: referent,
    now: NOW,
    case: caseRaccolta,
  });
  assert.ok(planned.ok, planned.ok ? "" : planned.message);
  const statements = transitionStatements({ workspaceId: WS, caseId: CASE, actor: referent, planned: planned.value });
  assert.equal(statements.length, 2);
  assert.match(statements[1].text, /UPDATE uc_request_items SET state = \$1::text/);
  assert.ok(statements[1].params.includes("non_so"));
  assert.ok(statements[1].params.includes(requestId));
});
