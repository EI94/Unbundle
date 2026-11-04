import test from "node:test";
import assert from "node:assert/strict";
import type { ReferentBlockView, ReferentContactOption, ReferentGate, ReferentRequestView, UseCaseReferentPanel } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_LIMITS } from "../../../../lib/use-cases/referent/contract.ts";
import { findHubForbidden } from "../../../../lib/use-cases/copy-guard.ts";
import { NEW_CONTACT } from "./ask-dialog-state.ts";
import {
  ASSIGN_REFRESH_CODES,
  assignContactRow,
  assignDraftErrors,
  assignEntry,
  assignErrorPlace,
  assignKind,
  assignLeadFor,
  assignModeOf,
  assignPayload,
  assignQuestionIds,
  assignQuestionsSummary,
  assignRestLine,
  assignSendLabel,
  assignSentToast,
  assignTicks,
  assignTitle,
  carriedNeedIds,
  defaultFileRequired,
  droppedLine,
  requestsShown,
  type AssignDraft,
} from "./assign-dialog-state.ts";

// «Scegli il referente» (rilascio 5, SPEC §8): chi apre, i modi, chi si sceglie, le spunte, le frasi, il contenuto.

const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const Q = [1, 2, 3, 4, 5, 6, 7].map((n) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`);
const CONTACT = (n: number, over: Partial<ReferentContactOption> = {}): ReferentContactOption => ({
  id: id(n),
  displayName: `Persona ${n}`,
  roleLabel: null,
  emailMasked: "p•••@cliente.test",
  selectable: true,
  reason: null,
  team: false,
  hasOtherRequests: false,
  liveRequest: null,
  ...over,
});
const gate = {
  email: { code: "email_non_configurata", message: "Le email non sono ancora attive." } as ReferentGate,
  sub: (canDeclare: boolean) => ({ code: "sub_responsabili_mancanti", message: "Serve l'ok.", canDeclare, settingsHref: "/x", linkLabel: "Apri Impostazioni" }) as ReferentGate,
  verified: { code: "email_non_verificata", message: "Verifica l'email." } as ReferentGate,
  none: { code: "nessuna_domanda", message: "Niente." } as ReferentGate,
};

function request(n: number, over: Partial<ReferentRequestView> = {}): ReferentRequestView {
  return {
    id: id(100 + n),
    version: 1,
    contact: { id: id(n), name: `Persona ${n}`, roleLabel: null, emailMasked: null, hubOnly: true },
    status: "inviata",
    statusLabel: "In attesa",
    silent: false,
    lines: [],
    notices: [],
    email: { state: "partita", label: null },
    needIds: [],
    openNeedIds: [],
    kind: "domande",
    actions: { remind: { allowed: true, reason: null }, add: { allowed: true, reason: null }, revoke: true, askAgain: false, retry: false, correctEmail: true, erase: true },
    createdAt: "2026-11-01T09:00:00.000Z",
    expiresAt: "2026-12-01T09:00:00.000Z",
    ...over,
  };
}

function referentView(over: Partial<ReferentBlockView> = {}): ReferentBlockView {
  return {
    contact: { id: id(1), name: "Persona 1", roleLabel: null, emailMasked: null, team: false },
    requestId: id(101),
    referentRequestId: id(101),
    state: "in_attesa",
    review: null,
    live: true,
    check: null,
    declinedNeedIds: [],
    hints: [],
    askableForReferent: [],
    ...over,
  };
}

function panel(over: Partial<UseCaseReferentPanel> = {}): UseCaseReferentPanel {
  return {
    available: true,
    canAsk: true,
    canReviewFiles: true,
    gates: [],
    contacts: [CONTACT(1), CONTACT(2)],
    requests: [],
    needs: {},
    askableNeedIds: Q.slice(0, 7),
    answerableNeedIds: [],
    preparable: [],
    requester: { name: "Giulia Neri", email: "giulia@lateral.test" },
    upload: { clientMode: false },
    limits: REFERENT_LIMITS,
    eligible: true,
    referent: null,
    latestReferentRequestId: null,
    ...over,
  };
}

const draft = (over: Partial<AssignDraft> = {}): AssignDraft => ({ choice: null, name: "", email: "", role: "", needIds: [], fileRequired: [], message: "", ...over });

test("assignEntry: si apre senza motivi, con le email spente (lo dice) e con l'ok che chi guarda può dare; «Nessuna domanda» non blocca mai", () => {
  assert.deepEqual(assignEntry(panel()), { canOpen: true, sendGates: [], notice: null });
  assert.equal(assignEntry(panel({ gates: [gate.none] })).canOpen, true, "D5");
  assert.equal(assignEntry(panel({ askableNeedIds: [] })).canOpen, true, "senza domande: la conferma e la stima");
  const email = assignEntry(panel({ gates: [gate.email] }));
  assert.deepEqual([email.canOpen, email.sendGates.length, email.notice?.code], [true, 1, "email_non_configurata"]);
  assert.equal(assignEntry(panel({ gates: [gate.sub(true)] })).canOpen, true);
  assert.equal(assignEntry(panel({ gates: [gate.sub(false)] })).canOpen, false, "l'ok lo dà un'altra persona: il riquadro dice chi");
  assert.equal(assignEntry(panel({ gates: [gate.verified] })).canOpen, false);
  assert.equal(assignEntry(panel({ canAsk: false })).canOpen, false);
  assert.equal(assignEntry(panel({ available: false })).canOpen, false);
});

test("i modi: «scegli» senza referente, «di_nuovo» con «Nessuna risposta», «chiedi» quando ha risposto e ci sono domande che non ha rifiutato", () => {
  assert.equal(assignModeOf(panel()), "scegli");
  assert.equal(assignModeOf(panel({ referent: referentView({ state: "nessuna_risposta" }) })), "di_nuovo");
  assert.equal(assignModeOf(panel({ referent: referentView({ state: "in_attesa" }) })), null);
  assert.equal(assignModeOf(panel({ referent: referentView({ state: "fatto", live: false, askableForReferent: [Q[0]] }) })), "chiedi");
  assert.equal(assignModeOf(panel({ referent: referentView({ state: "fatto", live: false, askableForReferent: [] }) })), null);
  assert.deepEqual([assignTitle("scegli"), assignTitle("cambia"), assignTitle("di_nuovo"), assignTitle("chiedi")], ["Scegli il referente", "Cambia referente", "Chiedi di nuovo", "Chiedi al referente"]);
});

test("l'elenco: il referente non si sceglie («(è il referente)»); chi ha già delle domande aperte sì (D49)", () => {
  const p = panel({ referent: referentView() });
  assert.deepEqual(assignContactRow(CONTACT(1, { selectable: false, reason: "richiesta_aperta", liveRequest: { id: id(101), kind: "referente" } }), p), { selectable: false, suffix: "(è il referente)" });
  assert.deepEqual(assignContactRow(CONTACT(2, { selectable: false, reason: "richiesta_aperta", liveRequest: { id: id(102), kind: "domande" } }), p), { selectable: true, suffix: "(ha già delle domande aperte)" });
  assert.deepEqual(assignContactRow(CONTACT(3, { selectable: false, reason: "lateral_space" }), p), { selectable: false, suffix: "(di Lateral Space)" });
  assert.deepEqual(assignContactRow(CONTACT(4), p), { selectable: true, suffix: null });
});

test("le domande portate: «Cambia referente» porta le aperte del referente di prima; scegliere chi ha domande aperte porta le sue", () => {
  const old = request(1, { kind: "referente", openNeedIds: [Q[5], Q[6]] });
  const followUp = request(1, { id: id(111), openNeedIds: [Q[4]] });
  const colleague = request(2, { id: id(102), openNeedIds: [Q[3]] });
  const other = request(3, { id: id(103), openNeedIds: [Q[6]] });
  const p = panel({ referent: referentView(), requests: [old, followUp, colleague, other], contacts: [CONTACT(1), CONTACT(2, { liveRequest: { id: id(102), kind: "domande" } }), CONTACT(3)] });
  // Q[6] la chiede ancora un'altra richiesta viva: resta lì.
  assert.deepEqual(carriedNeedIds(p, "cambia", draft({ choice: id(3) })), [Q[5], Q[4]]);
  assert.deepEqual(carriedNeedIds(p, "cambia", draft({ choice: id(2) })), [Q[5], Q[4], Q[3]]);
  assert.deepEqual(carriedNeedIds(panel({ requests: [colleague], contacts: [CONTACT(2, { liveRequest: { id: id(102), kind: "domande" } })] }), "scegli", draft({ choice: id(2) })), [Q[3]]);
  assert.deepEqual(carriedNeedIds(p, "chiedi", draft()), []);
  // L'ordine della scheda; «chiedi» senza le domande rifiutate.
  const order = [...Q];
  assert.deepEqual(assignQuestionIds(panel({ askableNeedIds: [Q[0], Q[2]] }), "cambia", [Q[5], Q[1]], order), [Q[0], Q[1], Q[2], Q[5]]);
  assert.deepEqual(assignQuestionIds(panel({ askableNeedIds: [Q[0], Q[2]], referent: referentView({ declinedNeedIds: [Q[2]] }) }), "chiedi", [], order), [Q[0]]);
});

test("le spunte: 5 di 7 (D31), le portate prima; «Serve un file» per i documenti", () => {
  const needInfo = Object.fromEntries(Q.map((q, i) => [q, { title: `Domanda ${i + 1}`, owner: null, ownerLabel: null, kind: i === 1 ? "documento" : "dato" }]));
  const ticks = assignTicks({ mode: "scegli", questions: Q, carried: [], needInfo, person: { displayName: "Aldo Prova", roleLabel: null }, orgWords: new Set(), declined: [], previous: null });
  assert.equal(ticks.length, 5);
  const carried = assignTicks({ mode: "cambia", questions: Q, carried: [Q[6]], needInfo, person: null, orgWords: new Set(), declined: [], previous: null });
  assert.equal(carried[0], Q[6]);
  assert.equal(carried.length, 5);
  assert.deepEqual(defaultFileRequired(ticks, needInfo), ticks.includes(Q[1]) ? [Q[1]] : []);
  assert.equal(assignQuestionsSummary(5, 7), "Domande · 5 di 7");
  assert.equal(assignQuestionsSummary(3, 3), "Domande · 3");
  assert.equal(assignRestLine(5, 7), "Le altre 2 restano da chiedere.");
  assert.equal(assignRestLine(6, 7), "L'altra resta da chiedere.");
  assert.equal(assignRestLine(3, 3), null);
});

test("le frasi: il numero vero di domande; «chiedi» e «Chiedi di nuovo» di sole domande dicono il nome", () => {
  assert.equal(assignLeadFor("scegli", "referente", 5, "Aldo"), "Riceve subito un'email: conferma lo use case e l'impatto, poi risponde a 5 domande.");
  assert.equal(assignLeadFor("scegli", "referente", 1, "Aldo"), "Riceve subito un'email: conferma lo use case e l'impatto, poi risponde a una domanda.");
  assert.equal(assignLeadFor("cambia", "referente", 0, "Aldo"), "Riceve subito un'email: conferma lo use case e l'impatto.");
  assert.equal(assignLeadFor("chiedi", "domande", 2, "Aldo"), "Aldo riceve subito un'email con 2 domande.");
  assert.equal(assignLeadFor("di_nuovo", "domande", 1, "Aldo"), "Aldo riceve subito un'email con una domanda.");
  assert.equal(droppedLine(0), null);
  assert.equal(droppedLine(1), "Una frase della descrizione resta fuori: ha importi, percentuali o dati personali.");
  assert.equal(droppedLine(2), "2 frasi della descrizione restano fuori: hanno importi, percentuali o dati personali.");
  assert.equal(assignSendLabel(null), "Invia");
  assert.equal(assignSendLabel("Aldo Prova"), "Invia a Aldo Prova");
  assert.equal(assignSentToast("scegli", "referente", "Aldo"), "Aldo è il referente: l'email parte adesso.");
  assert.equal(assignSentToast("chiedi", "domande", "Aldo"), "Richiesta inviata a Aldo.");
  for (const text of [assignLeadFor("scegli", "referente", 3, "Aldo"), droppedLine(3)!, assignTitle("cambia")]) assert.deepEqual(findHubForbidden(text, "area"), []);
});

test("il contenuto dell'action: il tipo, la richiesta vista, «Cambia referente», «Chiedi di nuovo»", () => {
  const ticked = draft({ choice: id(2), needIds: [Q[2], Q[0]], fileRequired: [Q[2], Q[5]], message: "  Grazie  " });
  const scegli = assignPayload(ticked, { mode: "scegli", questions: Q, panel: panel({ latestReferentRequestId: id(90) }), previous: null });
  assert.deepEqual(scegli, { kind: "referente", contact: { kind: "esistente", contactId: id(2) }, needIds: [Q[0], Q[2]], message: "Grazie", fileRequired: [Q[2]], expectedReferentRequestId: id(90) });
  const cambia = assignPayload(ticked, { mode: "cambia", questions: Q, panel: panel({ referent: referentView(), latestReferentRequestId: id(101) }), previous: null });
  assert.equal(cambia.replaceReferent, true);
  assert.equal(cambia.expectedReferentRequestId, id(101));
  const again = assignPayload(draft({ needIds: [Q[0]] }), { mode: "di_nuovo", questions: Q, panel: panel({ referent: referentView({ state: "nessuna_risposta" }), latestReferentRequestId: id(101) }), previous: { id: id(101), kind: "referente" } });
  assert.deepEqual([again.kind, again.previousRequestId, again.contact], ["referente", id(101), { kind: "esistente", contactId: id(1) }]);
  assert.equal(assignKind("di_nuovo", { kind: "domande" }), "domande");
  const ask = assignPayload(draft({ needIds: [Q[0]] }), { mode: "chiedi", questions: Q, panel: panel({ referent: referentView({ state: "fatto", live: false }) }), previous: null });
  assert.deepEqual([ask.kind, ask.expectedReferentRequestId, ask.replaceReferent, ask.contact], ["domande", undefined, undefined, { kind: "esistente", contactId: id(1) }]);
  const fresh = assignPayload(draft({ choice: NEW_CONTACT, name: " Aldo Prova ", email: " aldo@cliente.test " }), { mode: "scegli", questions: Q, panel: panel(), previous: null });
  assert.deepEqual(fresh.contact, { kind: "nuovo", displayName: "Aldo Prova", email: "aldo@cliente.test", roleLabel: null });
  assert.equal(fresh.expectedReferentRequestId, null);
});

test("i controlli prima dell'invio e dove va un errore del server", () => {
  const p = panel();
  assert.deepEqual(assignDraftErrors(draft(), p, "scegli", []), { contact: "Scegli il referente." });
  assert.deepEqual(assignDraftErrors(draft({ choice: id(1) }), p, "scegli", []), {}, "zero domande: la conferma e la stima bastano");
  assert.ok(assignDraftErrors(draft({ choice: NEW_CONTACT, name: "A", email: "x" }), p, "scegli", []).email);
  assert.ok(assignDraftErrors(draft({ needIds: [] }), p, "chiedi", []).needIds);
  assert.equal(assignErrorPlace("referente_gia_scelto", undefined), "chosen");
  assert.equal(assignErrorPlace("email_non_valida", { email: "x" }), "list");
  assert.equal(assignErrorPlace("domande_cambiate", undefined), "questions");
  assert.equal(assignErrorPlace("email_non_configurata", undefined), "gates");
  assert.equal(assignErrorPlace("non_trovato", undefined), "close");
  // (Rilascio 5) Lo use case non ha più un referente da scegliere (avviato, archiviato): si chiude e la scheda si rilegge.
  assert.equal(assignErrorPlace("referente_non_previsto", undefined), "close");
  assert.ok(ASSIGN_REFRESH_CODES.has("referente_non_previsto"));
  assert.equal(assignErrorPlace("riprova", undefined), "footer");
});

test("«Richieste inviate» (D34): senza le richieste al referente", () => {
  const p = panel({ referent: referentView(), requests: [request(1), request(2, { id: id(102) })] });
  assert.deepEqual(requestsShown(p).map((r) => r.id), [id(102)]);
  assert.equal(requestsShown(panel({ requests: [request(1)] })).length, 1);
  assert.equal(requestsShown({ ...p, eligible: false }).length, 2, "non da scegliere: tutte come nel rilascio 4");
});
