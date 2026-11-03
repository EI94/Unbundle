import test from "node:test";
import assert from "node:assert/strict";
import { blockCheckOf, referentBlockOf, referentContactOf, type BlockRequestFact, type ReferentCheckRow } from "./block.ts";
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
