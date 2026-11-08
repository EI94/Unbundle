import test from "node:test";
import assert from "node:assert/strict";
import {
  REFERENT_STATES,
  REFERENT_STATE_PARAM,
  REFERENT_STATE_TEXT,
  REFERENT_STATE_TONE,
  eligibleForReferent,
  latestRequest,
  referentRequestsOf,
  referentStateFromParam,
  referentStateOf,
  reviewOf,
  type ReferentCheckFact,
  type ReferentRequestFact,
  type ReferentStateInput,
} from "./use-case-state.ts";

// Rilascio 5 (§3.1, §3.2, §3.4): il referente di uno use case e il suo stato, dalle richieste. Dati sintetici.

const NOW = new Date("2026-11-03T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
let seq = 0;
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

const check = (c: Partial<ReferentCheckFact> = {}): ReferentCheckFact => ({ submittedAt: null, confirm: null, correctionDoneAt: null, estimate: null, estimateOutcome: null, teamComponentKey: "tempo-1", ...c });
function req(r: Partial<ReferentRequestFact> & { contactId?: string } = {}): ReferentRequestFact {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    contactId: A,
    status: "inviata",
    createdAt: day(-10 + seq / 100),
    expiresAt: day(20),
    reminderCount: 0,
    openTask: 1,
    check: check(),
    ...r,
  };
}
const input = (requests: ReferentRequestFact[], o: Partial<ReferentStateInput> = {}): ReferentStateInput => ({ eligible: true, requests, clientRequirementToVerify: false, hasTeamEstimateNow: true, now: NOW, ...o });
const stateOf = (requests: ReferentRequestFact[], o: Partial<ReferentStateInput> = {}) => referentStateOf(input(requests, o))?.state ?? null;

test("le parole, i valori dell'indirizzo, i toni e l'ordine del menu", () => {
  // (Rilascio 6) Dopo le risposte, il chiarimento chiesto dal team e la domanda del referente.
  assert.deepEqual([...REFERENT_STATES], ["manca", "in_attesa", "nessuna_risposta", "da_verificare", "chiarimento", "ha_chiesto", "fatto"]);
  assert.deepEqual(REFERENT_STATE_TEXT, {
    manca: "Manca il referente",
    in_attesa: "In attesa del referente",
    nessuna_risposta: "Nessuna risposta",
    da_verificare: "Risposte da verificare",
    chiarimento: "Chiarimento in attesa",
    ha_chiesto: "Il referente ha chiesto qualcosa",
    fatto: "Il referente ha risposto",
  });
  assert.deepEqual(REFERENT_STATE_PARAM, {
    manca: "manca",
    in_attesa: "in-attesa",
    nessuna_risposta: "nessuna-risposta",
    da_verificare: "da-verificare",
    chiarimento: "chiarimento",
    ha_chiesto: "ha-chiesto",
    fatto: "ha-risposto",
  });
  assert.deepEqual(REFERENT_STATE_TONE, { manca: "grigio", in_attesa: "blu", nessuna_risposta: "rosso", da_verificare: "giallo", chiarimento: "blu", ha_chiesto: "giallo", fatto: "verde" });
  for (const key of REFERENT_STATES) assert.equal(referentStateFromParam(REFERENT_STATE_PARAM[key]), key);
  for (const bad of ["Aldo Prova", "aldo@cliente.test", "", null, undefined, "in_attesa"]) assert.equal(referentStateFromParam(bad), null, String(bad));
});

test("chi ha uno stato: «Da costruire» in valutazione o approvato", () => {
  assert.equal(eligibleForReferent({ portfolioKind: "use_case_ai", phase: "da_valutare" }), true);
  assert.equal(eligibleForReferent({ portfolioKind: null, phase: "approvato" }), true);
  assert.equal(eligibleForReferent({ portfolioKind: "best_practice", phase: "approvato" }), false);
  for (const phase of ["in_realizzazione", "realizzato", "chiuso"] as const) assert.equal(eligibleForReferent({ portfolioKind: "use_case_ai", phase }), false, phase);
  assert.equal(referentStateOf(input([], { eligible: false })), null);
});

test("R*: l'ultima richiesta al referente per data e poi id, qualunque stato; revocata → nessun referente, mai una persona di prima", () => {
  const old = req({ contactId: B, status: "completata", openTask: 0, check: check({ submittedAt: day(-5), confirm: "si", estimate: "si" }) });
  const latest = req({ contactId: A, status: "revocata", createdAt: day(-1) });
  const r = referentRequestsOf([old, latest]);
  assert.equal(r.latestReferent?.id, latest.id);
  assert.equal(r.referent, null);
  assert.equal(stateOf([old, latest]), "manca");
  // Stessa data: vince l'id più grande.
  const t = day(-2);
  const x = req({ id: "00000000-0000-4000-8000-00000000000a", createdAt: t });
  const y = req({ id: "00000000-0000-4000-8000-00000000000b", createdAt: t, contactId: B });
  assert.equal(latestRequest([y, x])?.id, y.id);
  assert.equal(referentRequestsOf([x, y]).referent, B);
  // Le richieste di sole domande non fanno il referente.
  assert.equal(stateOf([req({ check: null })]), "manca");
  assert.equal(stateOf([]), "manca");
});

test("in attesa, nessuna risposta, ha risposto: da R, l'ultima non revocata al referente", () => {
  assert.equal(stateOf([req()]), "in_attesa");
  assert.equal(stateOf([req({ reminderCount: 2 })]), "nessuna_risposta");
  assert.equal(stateOf([req({ expiresAt: day(-1) })]), "nessuna_risposta", "inviata oltre la scadenza");
  assert.equal(stateOf([req({ status: "scaduta", expiresAt: day(-1) })]), "nessuna_risposta");
  assert.equal(stateOf([req({ status: "completata", openTask: 0, check: check({ submittedAt: day(-1), confirm: "si", estimate: "si" }) })]), "fatto");
  // Una richiesta di sole domande al referente, dopo la sua risposta, decide l'attesa.
  const answered = req({ status: "completata", openTask: 0, check: check({ submittedAt: day(-3), confirm: "si", estimate: "si" }) });
  const followUp = req({ check: null, createdAt: day(-1) });
  assert.equal(stateOf([answered, followUp]), "in_attesa");
  assert.equal(stateOf([answered, { ...followUp, reminderCount: 2 }]), "nessuna_risposta");
  // Una richiesta di sole domande a un'altra persona non cambia niente.
  assert.equal(stateOf([answered, req({ check: null, contactId: B, createdAt: day(-1), reminderCount: 2 })]), "fatto");
  // Completata con la conferma non inviata (dopo un ritorno indietro, RUNBOOK §10.9 punto 7): ha risposto.
  assert.equal(stateOf([req({ status: "completata", openTask: 0, check: check() })]), "fatto");
});

test("da verificare: un requisito del cliente «Da verificare», o la revisione della conferma o della stima", () => {
  assert.equal(stateOf([req()], { clientRequirementToVerify: true }), "da_verificare");
  const sent = (c: Partial<ReferentCheckFact>) => req({ status: "completata", openTask: 0, check: check({ submittedAt: day(-1), confirm: "si", estimate: "si", ...c }) });
  assert.deepEqual(referentStateOf(input([sent({ confirm: "correggi" })])), { state: "da_verificare", review: "correzione" });
  assert.deepEqual(referentStateOf(input([sent({ estimate: "meno" })])), { state: "da_verificare", review: "stima" });
  assert.deepEqual(referentStateOf(input([sent({ estimate: "piu" })])), { state: "da_verificare", review: "stima" });
  assert.deepEqual(referentStateOf(input([sent({ estimate: null, teamComponentKey: null })], { hasTeamEstimateNow: false })), { state: "da_verificare", review: "stima" });
  // Si chiude: «Fatto» sulla correzione, un esito della stima, una stima del team aggiunta.
  assert.equal(stateOf([sent({ confirm: "correggi", correctionDoneAt: day(0) })]), "fatto");
  assert.equal(stateOf([sent({ estimate: "meno", estimateOutcome: "adottata" })]), "fatto");
  assert.equal(stateOf([sent({ estimate: null, teamComponentKey: null })], { hasTeamEstimateNow: true }), "fatto");
  // Niente revisione dopo «Sì» e «Sì».
  assert.equal(stateOf([sent({})]), "fatto");
  // L'ordine: manca prima di tutto; da verificare prima di nessuna risposta e attesa.
  assert.equal(stateOf([], { clientRequirementToVerify: true }), "manca");
  assert.equal(stateOf([req({ reminderCount: 2 })], { clientRequirementToVerify: true }), "da_verificare");
});

test("la revisione: solo dopo l'invio", () => {
  assert.equal(reviewOf(check({ confirm: "correggi" }), true), null);
  assert.equal(reviewOf(null, false), null);
  assert.equal(reviewOf(check({ submittedAt: NOW, confirm: "correggi" }), true), "correzione");
  assert.equal(reviewOf(check({ submittedAt: NOW, confirm: "si", estimate: "si" }), false), null);
});

test("(rilascio 5.1) la revisione per beneficio: una voce da vedere, finché il team non decide; prima la correzione", () => {
  const sent = { submittedAt: NOW, confirm: "si" as const, teamComponentKey: null, benefits: true };
  assert.equal(reviewOf(check({ ...sent, benefitReview: true }), true), "stima");
  assert.equal(reviewOf(check({ ...sent, benefitReview: false }), true), null, "tutte «Sì» o già decise");
  assert.equal(reviewOf(check({ ...sent, benefitReview: false }), false), null, "senza la stima del tempo del rilascio 5 non si chiede una stima");
  assert.equal(reviewOf(check({ ...sent, confirm: "correggi", benefitReview: true }), true), "correzione");
  assert.equal(reviewOf(check({ ...sent, submittedAt: null, benefitReview: true }), true), null, "solo dopo l'invio");
  const r = req({ status: "completata", openTask: 0, check: check({ ...sent, benefitReview: true }) });
  assert.deepEqual(referentStateOf(input([r])), { state: "da_verificare", review: "stima" });
  assert.deepEqual(referentStateOf(input([{ ...r, check: check({ ...sent, benefitReview: false }) }])), { state: "fatto", review: null });
  // (Decisione del titolare del 04/11/2026) «Non so» su una cifra del team: da verificare, ma non una stima diversa.
  assert.equal(reviewOf(check({ ...sent, benefitUnknown: true }), true), "non_sa");
  assert.equal(reviewOf(check({ ...sent, benefitReview: true, benefitUnknown: true }), true), "stima", "una stima diversa viene prima");
  assert.equal(reviewOf(check({ ...sent, confirm: "correggi", benefitUnknown: true }), true), "correzione");
  assert.equal(reviewOf(check({ ...sent, submittedAt: null, benefitUnknown: true }), true), null);
  assert.deepEqual(referentStateOf(input([{ ...r, check: check({ ...sent, benefitUnknown: true }) }])), { state: "da_verificare", review: "non_sa" });
});

// ─── (Rilascio 6) «Il filo con il referente» ─────────────────────────

test("(rilascio 6) «Il referente ha chiesto qualcosa» viene prima di tutto; «Chiarimento in attesa» prima di «In attesa del referente»", () => {
  const sent = check({ submittedAt: day(-2), confirm: "si", estimate: "si" });
  const thread = (t: Partial<{ clarifications: number; doubts: number; news: number }>) => ({ clarifications: 0, doubts: 0, news: 0, ...t });
  // Un dubbio del referente: tocca al team, anche con una correzione da verificare e una domanda aperta.
  assert.equal(stateOf([req({ status: "inviata", openTask: 2, check: check({ submittedAt: day(-2), confirm: "correggi" }), thread: thread({ doubts: 1 }) })]), "ha_chiesto");
  assert.equal(referentStateOf(input([req({ status: "completata", openTask: 0, check: check({ submittedAt: day(-2), confirm: "correggi" }), thread: thread({ doubts: 1 }) })]))?.review, "correzione", "che cosa aspetta il team resta");
  // Un chiarimento del team: tocca al referente, finché la richiesta è viva.
  assert.equal(stateOf([req({ status: "inviata", openTask: 1, check: sent, thread: thread({ clarifications: 1 }) })]), "chiarimento");
  // Qualcosa da verificare viene prima: tocca al team.
  assert.equal(stateOf([req({ status: "inviata", openTask: 1, check: sent, thread: thread({ clarifications: 1 }) })], { clientRequirementToVerify: true }), "da_verificare");
  // Scaduta con un chiarimento senza risposta, o dopo l'ultimo promemoria: «Nessuna risposta».
  assert.equal(stateOf([req({ status: "inviata", expiresAt: day(-1), openTask: 1, check: sent, thread: thread({ clarifications: 1 }) })]), "nessuna_risposta");
  assert.equal(stateOf([req({ status: "inviata", reminderCount: 2, openTask: 1, check: sent, thread: thread({ clarifications: 1 }) })]), "nessuna_risposta");
  // Una risposta del referente nel filo su una voce o su «Generale»: da verificare, «risposta».
  const news = referentStateOf(input([req({ status: "completata", openTask: 0, check: sent, thread: thread({ news: 1 }) })]));
  assert.deepEqual(news, { state: "da_verificare", review: "risposta" });
  // Il filo di un'altra persona non conta per il referente; una richiesta revocata della stessa persona nemmeno.
  const other = req({ contactId: B, status: "completata", openTask: 0, check: null, thread: thread({ doubts: 1 }) });
  const revoked = req({ status: "revocata", openTask: 0, check: null, thread: thread({ doubts: 1 }) });
  assert.equal(stateOf([req({ status: "completata", openTask: 0, check: sent }), other, revoked]), "fatto");
  // Senza filo (rilascio 5.1): gli stati di prima.
  assert.equal(stateOf([req({ status: "inviata", openTask: 1, check: sent })]), "in_attesa");
  assert.equal(stateOf([req({ status: "completata", openTask: 0, check: sent })]), "fatto");
});
