import test from "node:test";
import assert from "node:assert/strict";
import { blockBenefitOf, blockCheckOf, referentBlockOf, referentContactOf, type BlockRequestFact, type ReferentCheckRow } from "./block.ts";
import { impactRowsOf, type StoredBenefit } from "./impact.ts";
import type { TeamEstimate } from "./estimate.ts";

// Il blocco «Referente» dal pannello (rilascio 5, §3.1, §9.5): R* e R, lo stato, la conferma, le domande rifiutate.

const NOW = new Date("2026-11-03T12:00:00Z");
const day = (d: number) => new Date(Date.UTC(2026, 10, d, 9));
const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "aaaaaaaa-0000-4000-8000-00000000000b";
const TEAM: TeamEstimate = { key: "pratiche", volumeYear: 3000, minutes: 12, hours: 600, perMonth: 250, perYear: null, unit: "pratiche", label: null };
const CHECK = (over: Partial<ReferentCheckRow> = {}): ReferentCheckRow => ({
  submittedAt: null,
  confirm: null,
  confirmNote: null,
  estimate: null,
  timesPerMonth: null,
  minutesEach: null,
  teamComponentKey: null,
  teamVolumeYear: null,
  teamMinutes: null,
  correctionDoneAt: null,
  estimateOutcome: null,
  estimateOutcomeAt: null,
  benefits: null,
  ...over,
});
let seq = 0;
const req = (over: Partial<BlockRequestFact> = {}): BlockRequestFact => ({
  id: `bbbbbbbb-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  version: 1,
  contactId: A,
  contactName: "Aldo Prova",
  roleLabel: null,
  emailMasked: "a•••@cliente.test",
  team: false,
  status: "inviata",
  createdAt: day(1),
  expiresAt: day(30),
  reminderCount: 0,
  openTask: 1,
  check: CHECK(),
  ...over,
});
const input = (requests: BlockRequestFact[], over: Partial<Parameters<typeof referentBlockOf>[0]> = {}) => ({
  eligible: true,
  requests,
  clientRequirementToVerify: false,
  teamNow: TEAM,
  now: NOW,
  declinedNeedIds: [],
  hints: [],
  askableNeedIds: [],
  ...over,
});

test("nessun referente: prima della prima richiesta al referente, dopo una revoca, su uno use case non da scegliere", () => {
  assert.equal(referentBlockOf(input([])), null);
  assert.equal(referentBlockOf(input([req({ check: null })])), null, "una richiesta di sole domande non fa un referente");
  assert.equal(referentBlockOf(input([req({ status: "revocata" })])), null);
  assert.equal(referentBlockOf(input([req()], { eligible: false })), null);
  assert.equal(referentContactOf([req({ status: "revocata" })]), null);
});

test("il referente è la persona dell'ultima richiesta al referente; R è l'ultima non revocata a quella persona", () => {
  const first = req({ contactId: B, contactName: "Bruna Esempio", createdAt: day(1) });
  const second = req({ contactId: A, createdAt: day(2) });
  const followUp = req({ contactId: A, createdAt: day(3), check: null });
  const view = referentBlockOf(input([first, second, followUp]))!;
  assert.equal(view.contact.name, "Aldo Prova");
  assert.equal(view.referentRequestId, second.id);
  assert.equal(view.requestId, followUp.id);
  assert.equal(view.state, "in_attesa");
  assert.equal(view.live, true);
  assert.equal(referentContactOf([first, second]), A);
});

test("lo stato e la conferma: «Risposte da verificare» per una stima diversa, poi «Il referente ha risposto»", () => {
  const sent = CHECK({ submittedAt: day(2), confirm: "si", estimate: "meno", timesPerMonth: 200, teamComponentKey: "pratiche", teamVolumeYear: 3000, teamMinutes: 12 });
  const view = referentBlockOf(input([req({ status: "completata", openTask: 0, check: sent })]))!;
  assert.deepEqual([view.state, view.review, view.live], ["da_verificare", "stima", false]);
  assert.deepEqual(view.check?.team, { key: "pratiche", volumeYear: 3000, minutes: 12, hours: 600, perMonth: 250 });
  assert.equal(view.check?.referentHours, 480, "200 al mese × 12 × 12 minuti / 60");
  assert.equal(view.check?.teamChanged, false);
  const kept = referentBlockOf(input([req({ status: "completata", openTask: 0, check: { ...sent, estimateOutcome: "tenuta", estimateOutcomeAt: day(3) } })]))!;
  assert.deepEqual([kept.state, kept.review], ["fatto", null]);
  const changed = blockCheckOf(sent, 1, { ...TEAM, volumeYear: 4000 });
  assert.equal(changed.teamChanged, true);
  assert.equal(blockCheckOf(CHECK({ submittedAt: day(2), confirm: "si", estimate: "si", teamComponentKey: "pratiche", teamVolumeYear: 3000, teamMinutes: 12 }), 1, TEAM).referentHours, null, "«Sì» senza numeri");
});

test("le domande rifiutate escono da quelle per il referente; al massimo 3 «Chi potrebbe saperlo?»", () => {
  const Q1 = "cccccccc-0000-4000-8000-000000000001";
  const Q2 = "cccccccc-0000-4000-8000-000000000002";
  const view = referentBlockOf(input([req()], { declinedNeedIds: [Q1.toUpperCase()], askableNeedIds: [Q1, Q2], hints: ["a", "b", "c", "d"] }))!;
  assert.deepEqual(view.askableForReferent, [Q2]);
  assert.deepEqual(view.declinedNeedIds, [Q1]);
  assert.deepEqual(view.hints, ["a", "b", "c"]);
});

test("dopo «Usa la stima di …» il blocco non dice che la stima del team è cambiata dopo la risposta", () => {
  const sent = CHECK({ submittedAt: day(2), confirm: "si", estimate: "meno", timesPerMonth: 150, minutesEach: 8.5, teamComponentKey: "pratiche", teamVolumeYear: 3000, teamMinutes: 12, estimateOutcome: "adottata", estimateOutcomeAt: day(3) });
  // Il componente del team ha adesso i numeri del referente (adoptionPatch: 150 × 12 = 1.800 volte, 8,5 minuti).
  assert.equal(blockCheckOf(sent, 1, { ...TEAM, volumeYear: 1800, minutes: 8.5 }).teamChanged, false);
  // Solo le volte: i minuti restano quelli del team.
  assert.equal(blockCheckOf(CHECK({ ...sent, minutesEach: null }), 1, { ...TEAM, volumeYear: 1800 }).teamChanged, false);
  // Solo i minuti: le volte restano quelle del team.
  assert.equal(blockCheckOf(CHECK({ ...sent, timesPerMonth: null }), 1, { ...TEAM, minutes: 8.5 }).teamChanged, false);
  // Un cambio del team dopo l'adozione si dice ancora.
  assert.equal(blockCheckOf(sent, 1, { ...TEAM, volumeYear: 2000, minutes: 8.5 }).teamChanged, true);
  // Senza l'adozione gli stessi numeri sono un cambio dopo la risposta, come prima.
  assert.equal(blockCheckOf(CHECK({ ...sent, estimateOutcome: null, estimateOutcomeAt: null }), 1, { ...TEAM, volumeYear: 1800, minutes: 8.5 }).teamChanged, true);
  // «Tieni la nostra» con la stima di prima: nessun cambio.
  assert.equal(blockCheckOf(CHECK({ ...sent, estimateOutcome: "tenuta" }), 1, TEAM).teamChanged, false);
});

test("(rilascio 5.1) una voce nel blocco: la risposta, se aspetta il team, se c'è qualcosa da usare, se la cifra è cambiata o la voce tolta", () => {
  const model = (minutes: number, eurYear = 4000) => ({
    components: [
      { kind: "ore", key: "tempo-1", lever: "tempo", label: "Controllo delle fatture", volumeYear: 3000, minutesPerUnit: minutes },
      { kind: "euro", key: "costi-1", lever: "costi", label: "Meno solleciti", eurYear },
    ],
  });
  const ore: StoredBenefit = {
    key: "tempo-1",
    position: 1,
    label: "Controllo delle fatture",
    team: { kind: "ore", volumeYear: 3000, minutes: 12, eurYear: null },
    answer: "piu",
    timesPerMonth: 300,
    minutesEach: null,
    eurYear: null,
    comment: "Solo a fine mese.",
    outcome: null,
    outcomeAt: null,
  };
  const b = blockBenefitOf(ore, impactRowsOf(model(12)));
  assert.deepEqual([b.form, b.needsReview, b.adoptable, b.changed, b.comment], ["ore", true, true, null, "Solo a fine mese."]);
  assert.equal(blockBenefitOf(ore, impactRowsOf(model(10))).changed, "cambiata");
  assert.equal(blockBenefitOf(ore, impactRowsOf({ components: [model(12).components[1]] })).changed, "tolta");
  assert.equal(blockBenefitOf(ore, null).changed, "tolta");
  // Dopo «Usa la stima di …» la voce ha i numeri del referente: non è un cambio dopo la risposta.
  const adopted = { ...ore, outcome: "adottata" as const, outcomeAt: day(3) };
  assert.equal(blockBenefitOf(adopted, impactRowsOf({ components: [{ ...model(12).components[0], volumeYear: 3600 }] })).changed, null);
  assert.deepEqual([blockBenefitOf(adopted, impactRowsOf(model(12))).needsReview, blockBenefitOf(adopted, impactRowsOf(model(12))).outcomeAt], [false, day(3).toISOString()]);
  // «Sì» non aspetta niente e non ha niente da usare; «È di meno» senza numeri aspetta, ma senza numeri da usare.
  assert.deepEqual([blockBenefitOf({ ...ore, answer: "si", timesPerMonth: null }, impactRowsOf(model(12))).needsReview, blockBenefitOf({ ...ore, answer: "si", timesPerMonth: null }, impactRowsOf(model(12))).adoptable], [false, false]);
  assert.deepEqual([blockBenefitOf({ ...ore, answer: "meno", timesPerMonth: null }, impactRowsOf(model(12))).needsReview, blockBenefitOf({ ...ore, answer: "meno", timesPerMonth: null }, impactRowsOf(model(12))).adoptable], [true, false]);
  // Nella conferma: le voci, nell'ordine; la stima del tempo del rilascio 5 resta vuota.
  const check = blockCheckOf(CHECK({ submittedAt: day(2), confirm: "si", benefits: [ore] }), 1, null, impactRowsOf(model(12)));
  assert.equal(check.benefits?.length, 1);
  assert.equal(check.team, null);
  assert.equal(blockCheckOf(CHECK({ submittedAt: day(2), confirm: "si" }), 1, TEAM).benefits, null, "una conferma del rilascio 5");
  // (Decisione del titolare del 04/11/2026) «Non so» su una cifra del team: aspetta il team, niente da usare.
  const dunno = { ...ore, answer: "non_so" as const, timesPerMonth: null, comment: null };
  assert.deepEqual([blockBenefitOf(dunno, impactRowsOf(model(12))).needsReview, blockBenefitOf(dunno, impactRowsOf(model(12))).adoptable], [true, false]);
  const euroDunno: StoredBenefit = { ...dunno, key: "costi-1", position: 2, label: "Meno solleciti", team: { kind: "euro", volumeYear: null, minutes: null, eurYear: 4000 } };
  assert.deepEqual([blockBenefitOf(euroDunno, impactRowsOf(model(12))).needsReview, blockBenefitOf(euroDunno, impactRowsOf(model(12))).adoptable], [true, false]);
  // Lo stato: «Risposte da verificare» con «non_sa», mai «stima» (non è una stima diversa); dopo «Fatto», «Il referente ha risposto».
  const sentDunno = CHECK({ submittedAt: day(2), confirm: "si", benefits: [dunno, { ...euroDunno, answer: "si" }] });
  const view = referentBlockOf(input([req({ status: "completata", openTask: 0, check: sentDunno })]))!;
  assert.deepEqual([view.state, view.review], ["da_verificare", "non_sa"]);
  const withDiff = referentBlockOf(input([req({ status: "completata", openTask: 0, check: CHECK({ ...sentDunno, benefits: [dunno, { ...euroDunno, answer: "meno" }] }) })]))!;
  assert.deepEqual([withDiff.state, withDiff.review], ["da_verificare", "stima"], "una stima diversa viene prima");
  const seen = referentBlockOf(input([req({ status: "completata", openTask: 0, check: CHECK({ ...sentDunno, benefits: [{ ...dunno, outcome: "tenuta", outcomeAt: day(3) }] }) })]))!;
  assert.deepEqual([seen.state, seen.review], ["fatto", null]);
});
