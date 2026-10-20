import test from "node:test";
import assert from "node:assert/strict";
import {
  REQUEST_ITEM_TRANSITIONS,
  REQUEST_TRANSITIONS,
  checkDelegation,
  checkExtendExpiry,
  estimateMinutes,
  HEAVY_RESPONSE_TYPES,
  isHeavyResponseType,
  minutesForQuestion,
  expiryOnSend,
  isActiveRequestItem,
  isAllowedRequestItemTransition,
  isOpenRequestItem,
  isRequestLive,
  isRequestVisible,
  nextRequestStatus,
  requestLinkAccess,
  requestStatusLabel,
  statusAfterActivity,
  type CaseLinkState,
  type DelegationInput,
  type RequestEvent,
  type RequestLinkState,
} from "./request-state.ts";
import { ACTIVE_REQUEST_ITEM_STATES, CASE_STATUSES, REQUEST_ITEM_STATES, REQUEST_STATUSES } from "./vocab.ts";

const NOW = new Date("2026-10-07T10:00:00Z");
const DAY = 86_400_000;
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);

test("every status change produced by an event is in the whitelist", () => {
  const events: RequestEvent[] = ["inviata", "aperta", "in_corso", "completata", "scaduta", "revocata"];
  for (const status of REQUEST_STATUSES) {
    for (const event of events) {
      const r = nextRequestStatus({ status, expiresAt: new Date(NOW.getTime() - 1) }, event, NOW);
      if (r.ok && r.value.changed) {
        assert.ok(REQUEST_TRANSITIONS[status].includes(r.value.status), `${status} + ${event} → ${r.value.status}`);
      }
    }
  }
});

test("request lifecycle: send, open once, progress, complete, reopen", () => {
  const sent = nextRequestStatus({ status: "bozza", expiresAt: null }, "inviata");
  assert.deepEqual(sent.ok && sent.value, { status: "inviata", changed: true });
  assert.equal(code(nextRequestStatus({ status: "inviata", expiresAt: null }, "inviata")), "gia_inviata");
  assert.deepEqual(nextRequestStatus({ status: "inviata", expiresAt: null }, "aperta").ok, true);
  const reopened = nextRequestStatus({ status: "in_corso", expiresAt: null }, "aperta");
  assert.deepEqual(reopened.ok && reopened.value, { status: "in_corso", changed: false });
  assert.equal(code(nextRequestStatus({ status: "bozza", expiresAt: null }, "aperta")), "non_inviata");
  const done = statusAfterActivity({ status: "aperta", expiresAt: null }, 0);
  assert.deepEqual(done.ok && done.value, { status: "completata", changed: true });
  const progress = statusAfterActivity({ status: "aperta", expiresAt: null }, 3);
  assert.deepEqual(progress.ok && progress.value, { status: "in_corso", changed: true });
  const back = nextRequestStatus({ status: "completata", expiresAt: null }, "in_corso");
  assert.deepEqual(back.ok && back.value, { status: "in_corso", changed: true });
  assert.throws(() => statusAfterActivity({ status: "aperta", expiresAt: null }, -1));
});

test("expiry and revocation close the request for good", () => {
  const future = new Date(NOW.getTime() + DAY);
  const past = new Date(NOW.getTime() - DAY);
  assert.equal(code(nextRequestStatus({ status: "inviata", expiresAt: future }, "scaduta", NOW)), "non_scaduta");
  assert.equal(code(nextRequestStatus({ status: "bozza", expiresAt: null }, "scaduta", NOW)), "non_inviata");
  const expired = nextRequestStatus({ status: "in_corso", expiresAt: past }, "scaduta", NOW);
  assert.deepEqual(expired.ok && expired.value, { status: "scaduta", changed: true });
  for (const status of ["bozza", "inviata", "aperta", "in_corso", "completata"] as const) {
    assert.equal(code(nextRequestStatus({ status, expiresAt: null }, "revocata")), "ok", status);
  }
  for (const status of ["scaduta", "revocata"] as const) {
    for (const event of ["inviata", "aperta", "in_corso", "completata", "scaduta", "revocata"] as const) {
      assert.equal(code(nextRequestStatus({ status, expiresAt: past }, event, NOW)), "richiesta_chiusa");
    }
  }
});

test("request items: open and active states, allowed moves", () => {
  assert.deepEqual(REQUEST_ITEM_STATES.filter(isOpenRequestItem), ["da_fare", "bozza"]);
  assert.deepEqual(REQUEST_ITEM_STATES.filter(isActiveRequestItem), [...ACTIVE_REQUEST_ITEM_STATES]);
  assert.equal(isAllowedRequestItemTransition("inviata", "da_fare"), true); // clarification
  assert.equal(isAllowedRequestItemTransition("non_so", "inviata"), true); // late answer
  assert.equal(isAllowedRequestItemTransition("delegata", "inviata"), false);
  assert.deepEqual(REQUEST_ITEM_TRANSITIONS.riassegnata, []);
});

const liveRequest: RequestLinkState = { status: "inviata", revokedAt: null, expiresAt: new Date(NOW.getTime() + DAY), shareEpoch: 2 };
const openCase: CaseLinkState = { status: "raccolta", shareEpoch: 2, setupCompletedAt: new Date("2026-09-01T00:00:00Z") };

test("uc_request_live: a draft is never valid, suspended is read-only, closed is not valid", () => {
  assert.equal(requestLinkAccess(liveRequest, openCase, NOW), "scrivibile");
  assert.equal(requestLinkAccess({ ...liveRequest, status: "completata" }, openCase, NOW), "scrivibile");
  assert.equal(requestLinkAccess({ ...liveRequest, status: "bozza" }, openCase, NOW), "non_valido");
  assert.equal(requestLinkAccess(liveRequest, { ...openCase, status: "sospeso" }, NOW), "sola_lettura");
  assert.equal(requestLinkAccess(liveRequest, { ...openCase, status: "chiuso" }, NOW), "non_valido");
  assert.equal(requestLinkAccess({ ...liveRequest, revokedAt: NOW }, openCase, NOW), "non_valido");
  assert.equal(requestLinkAccess({ ...liveRequest, expiresAt: NOW }, openCase, NOW), "non_valido");
  assert.equal(requestLinkAccess({ ...liveRequest, shareEpoch: 1 }, openCase, NOW), "non_valido");
  assert.equal(requestLinkAccess(liveRequest, { ...openCase, setupCompletedAt: null }, NOW), "non_valido");
  assert.equal(requestLinkAccess(liveRequest, openCase, NOW, true), "non_valido");
  for (const status of REQUEST_STATUSES) {
    for (const caseStatus of CASE_STATUSES) {
      const r = { ...liveRequest, status };
      const c = { ...openCase, status: caseStatus };
      // Live always implies visible.
      if (isRequestLive(r, c, NOW)) assert.ok(isRequestVisible(r, c, NOW));
    }
  }
});

test("expires_at = sent_at + 30 days and extensions stay within now + 30 days", () => {
  assert.equal(expiryOnSend(NOW).toISOString(), "2026-11-06T10:00:00.000Z");
  const base = { status: "aperta" as const, revokedAt: null, currentExpiresAt: new Date(NOW.getTime() + 5 * DAY), now: NOW };
  const clamped = checkExtendExpiry({ ...base, requested: new Date(NOW.getTime() + 90 * DAY) });
  assert.ok(clamped.ok);
  assert.equal(clamped.ok && clamped.value.expiresAt.getTime(), NOW.getTime() + 30 * DAY);
  assert.equal(clamped.ok && clamped.value.clamped, true);
  const exact = checkExtendExpiry({ ...base, requested: new Date(NOW.getTime() + 10 * DAY) });
  assert.equal(exact.ok && exact.value.clamped, false);
  assert.equal(code(checkExtendExpiry({ ...base, requested: new Date(NOW.getTime() + 2 * DAY) })), "data_non_valida");
  assert.equal(code(checkExtendExpiry({ ...base, requested: new Date(NOW.getTime() - DAY) })), "data_non_valida");
  assert.equal(code(checkExtendExpiry({ ...base, status: "bozza", requested: new Date(NOW.getTime() + 10 * DAY) })), "richiesta_non_viva");
  assert.equal(code(checkExtendExpiry({ ...base, revokedAt: NOW, requested: new Date(NOW.getTime() + 10 * DAY) })), "richiesta_non_viva");
  assert.equal(code(checkExtendExpiry({ ...base, currentExpiresAt: new Date(NOW.getTime() - 1), requested: new Date(NOW.getTime() + 10 * DAY) })), "richiesta_non_viva");
  // A link just sent already expires a little past now + 30 days (database clock): asking for more keeps it.
  const atMax = new Date(NOW.getTime() + 30 * DAY + 5);
  const kept = checkExtendExpiry({ ...base, currentExpiresAt: atMax, requested: new Date(NOW.getTime() + 90 * DAY) });
  assert.equal(kept.ok && kept.value.expiresAt.getTime(), atMax.getTime());
  assert.equal(kept.ok && kept.value.clamped, true);
});

test("delegation: depth ≤ 2, ≤ 5 a day, never to Lateral Space, external domains need approval", () => {
  const base: DelegationInput = {
    parentDepth: 0,
    delegationsToday: 0,
    delegateEmail: "collega@cliente.test",
    caseContactDomains: ["cliente.test"],
    lsDomains: ["ls.test"],
    itemIds: ["i1"],
    activeItemIds: ["i1", "i2"],
  };
  const ok1 = checkDelegation(base);
  assert.deepEqual(ok1.ok && ok1.value, { depth: 1, needsApproval: false });
  assert.equal(code(checkDelegation({ ...base, parentDepth: 1 })), "ok");
  assert.equal(code(checkDelegation({ ...base, parentDepth: 2 })), "delega_troppo_profonda");
  assert.equal(code(checkDelegation({ ...base, delegationsToday: 4 })), "ok");
  assert.equal(code(checkDelegation({ ...base, delegationsToday: 5 })), "troppe_deleghe");
  assert.equal(code(checkDelegation({ ...base, delegateEmail: "non-una-email" })), "email_non_valida");
  assert.equal(code(checkDelegation({ ...base, delegateEmail: "persona@LS.test" })), "delega_a_lateral_space");
  assert.equal(code(checkDelegation({ ...base, itemIds: [] })), "nessuna_voce");
  assert.equal(code(checkDelegation({ ...base, itemIds: ["i3"] })), "voce_non_della_richiesta");
  assert.equal(code(checkDelegation({ ...base, itemIds: ["i1", "i1"] })), "voce_non_della_richiesta");
  const external = checkDelegation({ ...base, delegateEmail: "consulente@esterno.test" });
  assert.deepEqual(external.ok && external.value, { depth: 1, needsApproval: true });
});

test("estimated minutes: module estimates once, otherwise 2 minutes per item", () => {
  const modules = [
    { key: "mod.a", estimatedMinutes: 15 },
    { key: "mod.b", estimatedMinutes: null },
  ];
  assert.equal(estimateMinutes(modules, [{ moduleKey: "mod.a" }, { moduleKey: "mod.a" }]), 15);
  assert.equal(estimateMinutes(modules, [{ moduleKey: "mod.a" }, { moduleKey: "mod.b" }, { moduleKey: null }]), 19);
  assert.equal(estimateMinutes(modules, []), 0);
});

test("estimated minutes: fixed weights per type and the module estimate in proportion (DESIGN §4.4 point 5)", () => {
  assert.equal(minutesForQuestion({ oneTap: true, responseType: "numero" }), 0.5, "a confirmation with one tap");
  assert.equal(minutesForQuestion({ responseType: "si_no" }), 0.5);
  assert.equal(minutesForQuestion({ responseType: "scelta" }), 0.5);
  for (const t of ["numero", "valuta", "percentuale", "durata", "data", "data_ora", "intervallo", "codice", "scelta_multipla", "conferma_regola", "conferma_formula", "conferma_valore"] as const) {
    assert.equal(minutesForQuestion({ responseType: t }), 1, t);
  }
  assert.equal(minutesForQuestion({ responseType: "testo" }), 2);
  for (const t of HEAVY_RESPONSE_TYPES) assert.equal(minutesForQuestion({ responseType: t }), 5, t);
  assert.equal(minutesForQuestion({}), 2, "no type: the 2 minutes of before");
  assert.equal(isHeavyResponseType("tabella"), true);
  assert.equal(isHeavyResponseType("numero"), false);
  assert.equal(isHeavyResponseType(null), false);
  // Today a single question of a module counted the whole module: now 30 × 3/12.
  const modules = [{ key: "m.prezzi", estimatedMinutes: 30, questionCount: 12 }];
  assert.equal(estimateMinutes(modules, [{ moduleKey: "m.prezzi" }, { moduleKey: "m.prezzi" }, { moduleKey: "m.prezzi" }]), 8);
  assert.equal(estimateMinutes(modules, [{ moduleKey: "m.prezzi" }]), 3, "rounded up to the minute");
  assert.equal(
    estimateMinutes([], [{ moduleKey: null, responseType: "si_no" }, { moduleKey: null, responseType: "si_no" }, { moduleKey: null, responseType: "testo" }]),
    3,
  );
  assert.equal(estimateMinutes([], [{ moduleKey: null, oneTap: true }]), 1);
});

test("client roles see «In attesa» instead of sent, opened or in progress", () => {
  for (const status of ["inviata", "aperta", "in_corso"] as const) {
    assert.equal(requestStatusLabel(status, "cliente"), "In attesa");
    assert.notEqual(requestStatusLabel(status, "lateral_space"), "In attesa");
  }
  assert.equal(requestStatusLabel("completata", "cliente"), "Completata");
  assert.equal(requestStatusLabel("scaduta", "cliente"), "Scaduta");
});

test("every request status × event, table-driven: allowed changes, no-ops and refusals", () => {
  const S = (status: string) => `→${status}`;
  const SAME = "=";
  // Expected outcome with an expired link (`scaduta` applies); codes are refusals.
  const expected: Record<string, Record<RequestEvent, string>> = {
    bozza: { inviata: S("inviata"), aperta: "non_inviata", in_corso: "non_inviata", completata: "non_inviata", scaduta: "non_inviata", revocata: S("revocata") },
    inviata: { inviata: "gia_inviata", aperta: S("aperta"), in_corso: S("in_corso"), completata: S("completata"), scaduta: S("scaduta"), revocata: S("revocata") },
    aperta: { inviata: "gia_inviata", aperta: SAME, in_corso: S("in_corso"), completata: S("completata"), scaduta: S("scaduta"), revocata: S("revocata") },
    in_corso: { inviata: "gia_inviata", aperta: SAME, in_corso: SAME, completata: S("completata"), scaduta: S("scaduta"), revocata: S("revocata") },
    completata: { inviata: "gia_inviata", aperta: SAME, in_corso: S("in_corso"), completata: SAME, scaduta: S("scaduta"), revocata: S("revocata") },
    scaduta: { inviata: "richiesta_chiusa", aperta: "richiesta_chiusa", in_corso: "richiesta_chiusa", completata: "richiesta_chiusa", scaduta: "richiesta_chiusa", revocata: "richiesta_chiusa" },
    revocata: { inviata: "richiesta_chiusa", aperta: "richiesta_chiusa", in_corso: "richiesta_chiusa", completata: "richiesta_chiusa", scaduta: "richiesta_chiusa", revocata: "richiesta_chiusa" },
  };
  assert.deepEqual(Object.keys(expected).sort(), [...REQUEST_STATUSES].sort());
  const past = new Date(NOW.getTime() - 1);
  for (const status of REQUEST_STATUSES) {
    for (const event of Object.keys(expected[status]) as RequestEvent[]) {
      const r = nextRequestStatus({ status, expiresAt: past }, event, NOW);
      const got = !r.ok ? r.code : r.value.changed ? S(r.value.status) : SAME;
      assert.equal(got, expected[status][event], `${status} + ${event}`);
    }
  }
  // The whitelist is exactly the set of changes the events can produce.
  const produced = new Set(REQUEST_STATUSES.flatMap((s) => Object.values(expected[s]).filter((v) => v.startsWith("→")).map((v) => `${s}${v}`)));
  const whitelist = new Set(REQUEST_STATUSES.flatMap((s) => REQUEST_TRANSITIONS[s].map((t) => `${s}→${t}`)));
  assert.deepEqual([...produced].sort(), [...whitelist].sort());
});

test("every request item move, table-driven", () => {
  const allowed = new Set([
    "da_fare>bozza", "da_fare>inviata", "da_fare>delegata", "da_fare>non_so", "da_fare>riassegnata",
    "bozza>bozza", "bozza>inviata", "bozza>delegata", "bozza>non_so", "bozza>riassegnata",
    "inviata>bozza", "inviata>inviata", "inviata>da_fare", "inviata>riassegnata",
    "non_so>bozza", "non_so>inviata", "non_so>riassegnata",
  ]);
  for (const from of REQUEST_ITEM_STATES) {
    for (const to of REQUEST_ITEM_STATES) {
      assert.equal(isAllowedRequestItemTransition(from, to), allowed.has(`${from}>${to}`), `${from}>${to}`);
    }
  }
  // Delegated and reassigned items left the link for good.
  assert.deepEqual(REQUEST_ITEM_TRANSITIONS.delegata, []);
  assert.deepEqual(REQUEST_ITEM_TRANSITIONS.riassegnata, []);
});
