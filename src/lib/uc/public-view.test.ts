import test from "node:test";
import assert from "node:assert/strict";
import { checkItemTransition } from "./item-state.ts";
import {
  INVALID_LINK_MESSAGE,
  MAX_BATCH_ANSWERS,
  MAX_DELEGATION_DEPTH,
  PAUSED_CASE_MESSAGE,
  PERSONAL_LOCKED_MESSAGE,
  PRIVACY_PENDING_MESSAGE,
  REFERENT_ANSWER_KINDS,
  REFERENT_PRIVACY_NOTICE,
  SINGLE_SEND_MESSAGE,
  VISIBLE_REQUEST_ITEM_STATES,
  greetingNameFrom,
  isLockedPersonal,
  planReferentAnswer,
  publicFail,
  referentCapabilities,
  referentItemDone,
  referentProgress,
  referentStatusLabel,
  type ReferentItemFacts,
} from "./public-view.ts";
import { findForbiddenIn } from "./views/copy-guard.ts";
import type { Actor, ItemSnapshot } from "./types.ts";
import { ACTIVE_REQUEST_ITEM_STATES, ITEM_STATUSES, REQUEST_ITEM_STATES, type ItemStatus, type RequestItemState } from "./vocab.ts";

const NOW = new Date("2026-10-12T10:00:00Z");
const CONTACT = "6f1c3c2a-1b2d-4e5f-8a9b-0c1d2e3f4a5b";
const REQUEST = "7a2d4e6f-8b0c-4d1e-9f2a-3b4c5d6e7f80";
const REFERENT: Actor = { type: "referente", contactId: CONTACT, requestId: REQUEST, roleKey: "resp_servizio" };

function facts(over: Partial<ReferentItemFacts> = {}): ReferentItemFacts {
  return { status: "chiesta", requestItemState: "da_fare", assignedToMe: true, privacyClass: "riservato_azienda", personalZoneOpen: false, writable: true, delegationDepth: 0, ...over };
}

function snap(status: ItemStatus, riState: RequestItemState): ItemSnapshot {
  return {
    id: "8c3e5f7a-9b1d-4e2f-a3b4-c5d6e7f8091a",
    key: "q.servizio.01",
    kind: "domanda",
    status,
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
    hasActiveRequestItem: (ACTIVE_REQUEST_ITEM_STATES as readonly string[]).includes(riState),
    lastAutoCheckError: false,
  };
}

test("privacy notice: versioned, short enough for the request column and the ack SQL", () => {
  assert.match(REFERENT_PRIVACY_NOTICE.version, /^[A-Za-z0-9_.:-]{1,20}$/);
  assert.equal(REFERENT_PRIVACY_NOTICE.version, "uc-2026-10-2", "the two-level notice is a new version: it is shown again");
  assert.ok(REFERENT_PRIVACY_NOTICE.paragraphs.length >= 3);
  const text = REFERENT_PRIVACY_NOTICE.paragraphs.join(" ");
  assert.match(text, /30 giorni/);
  assert.match(text, /impronta/);
  assert.match(text, /Non misuriamo i tuoi tempi/);
});

test("every answer the page plans is accepted by the server state machine (row by row)", () => {
  let planned = 0;
  for (const status of ITEM_STATUSES) {
    for (const riState of REQUEST_ITEM_STATES) {
      for (const kind of REFERENT_ANSWER_KINDS) {
        for (const partial of [false, true]) {
          const plan = planReferentAnswer({ status, requestItemState: riState, kind, partial });
          if (!plan.ok) continue;
          planned++;
          const reason = partial ? "Manca l'orario del sabato" : kind === "proposta_na" ? "La voce non serve per questo processo" : null;
          const r = checkItemTransition({
            item: snap(status, riState),
            to: plan.value.to,
            trigger: plan.value.trigger,
            actor: REFERENT,
            now: NOW,
            reason,
            case: { status: "raccolta" },
            answer: { kind, sourceKind: "referente" },
            actorRequestItem: { requestId: REQUEST, state: riState },
          });
          assert.ok(r.ok, `${status}/${riState}/${kind}/${partial}: ${r.ok ? "" : r.code}`);
          if (r.ok && kind === "conferma") assert.equal(r.value.patch.confirmedByContactId, CONTACT, "a confirmation records the confirming referent");
        }
      }
    }
  }
  assert.ok(planned > 20, `planned ${planned}`);
});

test("planning: «Non lo so» only on an open question; partial only from chiesta with a value; validated items take only new values", () => {
  assert.deepEqual(planReferentAnswer({ status: "chiesta", requestItemState: "da_fare", kind: "non_so", partial: false }), { ok: true, value: { to: "mancante", trigger: "non_so" } });
  assert.equal(planReferentAnswer({ status: "mancante", requestItemState: "non_so", kind: "non_so", partial: false }).ok, false);
  assert.deepEqual(planReferentAnswer({ status: "mancante", requestItemState: "non_so", kind: "valore", partial: false }), { ok: true, value: { to: "in_verifica", trigger: "risposta" } }, "a late answer after «Non lo so» is welcome");
  assert.deepEqual(planReferentAnswer({ status: "chiesta", requestItemState: "bozza", kind: "valore", partial: true }), { ok: true, value: { to: "parziale", trigger: "risposta_parziale" } });
  const naPartial = planReferentAnswer({ status: "chiesta", requestItemState: "bozza", kind: "proposta_na", partial: true });
  assert.equal(naPartial.ok ? null : naPartial.code, "tipo_risposta_non_ammesso");
  const partialAgain = planReferentAnswer({ status: "parziale", requestItemState: "inviata", kind: "valore", partial: true });
  assert.equal(partialAgain.ok ? null : partialAgain.code, "stato_non_ammesso");
  assert.deepEqual(planReferentAnswer({ status: "validata", requestItemState: "inviata", kind: "correzione", partial: false }), { ok: true, value: { to: "in_verifica", trigger: "nuova_versione" } });
  const naOnValidated = planReferentAnswer({ status: "validata", requestItemState: "inviata", kind: "proposta_na", partial: false });
  assert.equal(naOnValidated.ok ? null : naOnValidated.code, "tipo_risposta_non_ammesso");
  for (const status of ["in_verifica", "da_chiedere", "bloccata", "non_applicabile"] as const) {
    assert.equal(planReferentAnswer({ status, requestItemState: "inviata", kind: "valore", partial: false }).ok, false, status);
  }
  for (const riState of ["delegata", "riassegnata"] as const) {
    assert.equal(planReferentAnswer({ status: "chiesta", requestItemState: riState, kind: "valore", partial: false }).ok, false, `${riState} rows are history`);
  }
});

test("capabilities follow the plan: what the page offers, the server accepts", () => {
  for (const status of ITEM_STATUSES) {
    for (const riState of VISIBLE_REQUEST_ITEM_STATES) {
      const can = referentCapabilities(facts({ status, requestItemState: riState }));
      const plan = (kind: (typeof REFERENT_ANSWER_KINDS)[number], partial = false) => planReferentAnswer({ status, requestItemState: riState, kind, partial }).ok;
      if (can.answer) assert.ok(plan(can.newVersionOnly ? "correzione" : "valore"), `${status}/${riState} answer`);
      assert.equal(can.notKnown, plan("non_so"), `${status}/${riState} non_so`);
      assert.equal(can.partial, plan("valore", true), `${status}/${riState} partial`);
      if (can.proposeNa) assert.ok(plan("proposta_na"), `${status}/${riState} na`);
      if (!can.answer) assert.ok(can.lockedReason, `${status}/${riState} says why`);
    }
  }
});

test("capabilities: pause, reassignment, health, personal zone, delegation depth", () => {
  assert.deepEqual(referentCapabilities(facts({ writable: false })), {
    answer: false,
    newVersionOnly: false,
    partial: false,
    notKnown: false,
    delegate: false,
    proposeNa: false,
    draft: false,
    lockedReason: PAUSED_CASE_MESSAGE,
  });
  assert.equal(referentCapabilities(facts({ assignedToMe: false })).lockedReason, "Questa domanda non è più assegnata a te.");
  assert.equal(referentCapabilities(facts({ privacyClass: "escluso_sanitario" })).answer, false);
  const closed = referentCapabilities(facts({ privacyClass: "personale_equipaggio" }));
  assert.equal(closed.answer, false);
  assert.equal(closed.lockedReason, PERSONAL_LOCKED_MESSAGE, "the privacy sheet in plain words, never its code");
  const open = referentCapabilities(facts({ privacyClass: "personale", personalZoneOpen: true }));
  assert.deepEqual([open.answer, open.draft], [true, false], "personal items: answer, never a draft on the server");
  const full = referentCapabilities(facts());
  assert.deepEqual([full.answer, full.partial, full.notKnown, full.delegate, full.proposeNa, full.draft], [true, true, true, true, true, true]);
  assert.equal(referentCapabilities(facts({ delegationDepth: MAX_DELEGATION_DEPTH })).delegate, false, "a delegated link delegates at most twice");
  assert.equal(referentCapabilities(facts({ status: "in_verifica", requestItemState: "inviata" })).lockedReason, "La risposta è in verifica da Lateral Space.");
  const validated = referentCapabilities(facts({ status: "validata", requestItemState: "inviata" }));
  assert.deepEqual([validated.answer, validated.newVersionOnly, validated.notKnown, validated.delegate], [true, true, false, false]);
});

test("labels in the referent's words, and «3 di 8» counting", () => {
  assert.deepEqual(referentStatusLabel({ status: "chiesta", requestItemState: "da_fare", clarification: true, hasDraft: false }), { label: "Ti chiediamo un chiarimento", tone: "chiarimento" });
  assert.equal(referentStatusLabel({ status: "chiesta", requestItemState: "bozza", clarification: false, hasDraft: false }).label, "Bozza salvata");
  assert.equal(referentStatusLabel({ status: "chiesta", requestItemState: "da_fare", clarification: false, hasDraft: false }).label, "Da rispondere");
  assert.equal(referentStatusLabel({ status: "in_verifica", requestItemState: "inviata", clarification: false, hasDraft: false }).label, "In verifica");
  assert.equal(referentStatusLabel({ status: "mancante", requestItemState: "non_so", clarification: false, hasDraft: false }).label, "Hai risposto «Non lo so»");
  assert.equal(referentStatusLabel({ status: "mancante", requestItemState: "inviata", clarification: false, hasDraft: false }).label, "Da rispondere");
  assert.equal(referentStatusLabel({ status: "validata", requestItemState: "inviata", clarification: false, hasDraft: false }).label, "A posto");
  assert.equal(referentStatusLabel({ status: "parziale", requestItemState: "inviata", clarification: false, hasDraft: false }).label, "Da completare");
  assert.equal(referentStatusLabel({ status: "bloccata", requestItemState: "inviata", clarification: false, hasDraft: false }).label, "In attesa");
  assert.equal(referentItemDone({ status: "mancante", requestItemState: "non_so" }), true, "«Non lo so» is an answer");
  assert.equal(referentItemDone({ status: "in_verifica", requestItemState: "inviata" }), true);
  assert.equal(referentItemDone({ status: "chiesta", requestItemState: "inviata" }), false, "a clarification reopens the question");
  assert.equal(referentItemDone({ status: "chiesta", requestItemState: "bozza" }), false);
});

test("publicFail carries issues only when there are some", () => {
  assert.deepEqual(publicFail("x", "Messaggio."), { ok: false, code: "x", message: "Messaggio." });
  assert.deepEqual(publicFail("x", "Messaggio.", []), { ok: false, code: "x", message: "Messaggio." });
  assert.deepEqual(publicFail("x", "Messaggio.", [{ code: "c", message: "m" }]), { ok: false, code: "x", message: "Messaggio.", issues: [{ code: "c", message: "m" }] });
});

test("two-level notice (R0): three points, the full text, the button; nothing a client may not read", () => {
  const n = REFERENT_PRIVACY_NOTICE;
  assert.equal(n.summary.length, 3, "three things to know");
  assert.equal(n.title, "Prima di iniziare");
  assert.equal(n.button, "Ho letto, iniziamo");
  assert.ok(n.paragraphs.length >= 5, "the full text stays, closed");
  assert.match(n.summary.join(" "), /Non misuriamo i tuoi tempi/);
  assert.match(n.summary.join(" "), /30 giorni/);
  const texts = [n.title, n.lead, ...n.summary, ...n.paragraphs, n.fullTextLabel, n.footerLabel, n.contact, n.button, n.error];
  assert.deepEqual(findForbiddenIn(texts, "cliente"), []);
});

test("messages of the link: plain Italian, no codes (copy-guard)", () => {
  const texts = [INVALID_LINK_MESSAGE, PAUSED_CASE_MESSAGE, PRIVACY_PENDING_MESSAGE, PERSONAL_LOCKED_MESSAGE, SINGLE_SEND_MESSAGE];
  for (const status of ITEM_STATUSES) {
    for (const riState of VISIBLE_REQUEST_ITEM_STATES) {
      texts.push(referentStatusLabel({ status, requestItemState: riState, clarification: false, hasDraft: false }).label);
      const reason = referentCapabilities(facts({ status, requestItemState: riState })).lockedReason;
      if (reason) texts.push(reason);
    }
  }
  texts.push(referentCapabilities(facts({ privacyClass: "personale" })).lockedReason ?? "", referentCapabilities(facts({ privacyClass: "escluso_sanitario" })).lockedReason ?? "");
  assert.deepEqual(findForbiddenIn(texts, "cliente"), []);
  assert.equal(MAX_BATCH_ANSWERS, 50);
});

test("progress = done / answerable now: closed personal questions are out, «Non lo so» counts as done", () => {
  const open = { done: false, personal: false, can: referentCapabilities(facts()) };
  const sent = { done: true, personal: false, can: referentCapabilities(facts({ status: "in_verifica", requestItemState: "inviata" })) };
  const notKnown = { done: referentItemDone({ status: "mancante", requestItemState: "non_so" }), personal: false, can: referentCapabilities(facts({ status: "mancante", requestItemState: "non_so" })) };
  const lockedPersonal = { done: false, personal: true, can: referentCapabilities(facts({ privacyClass: "personale" })) };
  const openPersonal = { done: false, personal: true, can: referentCapabilities(facts({ privacyClass: "personale", personalZoneOpen: true })) };
  assert.equal(isLockedPersonal(lockedPersonal), true);
  assert.equal(isLockedPersonal(openPersonal), false);
  assert.equal(isLockedPersonal(open), false);
  assert.deepEqual(referentProgress([open, sent, notKnown, lockedPersonal, openPersonal]), { done: 2, total: 4 });
  assert.deepEqual(referentProgress([lockedPersonal]), { done: 0, total: 0 });
});

test("greeting: the first name when it looks like one, otherwise just «Ciao»", () => {
  assert.equal(greetingNameFrom("Marco Bianchi"), "Marco");
  assert.equal(greetingNameFrom("  Anna-Maria  De Luca"), "Anna-Maria");
  assert.equal(greetingNameFrom("D'Angelo"), "D'Angelo");
  assert.equal(greetingNameFrom("marco"), null, "not capitalised: maybe not a name");
  assert.equal(greetingNameFrom("ufficio_acquisti@cliente.test"), null);
  assert.equal(greetingNameFrom("R2"), null);
  assert.equal(greetingNameFrom(""), null);
  assert.equal(greetingNameFrom(null), null);
});
