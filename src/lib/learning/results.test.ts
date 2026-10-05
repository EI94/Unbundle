import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLearningResults, pickCohort, RESULTS_MINIMUM_GROUP,
  type GroupActivity, type GroupResults, type IndividualRow, type ResultsAttempt, type ResultsCohort, type ResultsEnrollment, type ResultsSession,
} from "./results.ts";
import { gradeActivity } from "./grading.ts";
import { getActivity } from "./pack.ts";
import { createGenericTrainingPack } from "./test-fixture.ts";
import type { ObjectiveGrade, PrivateTrainingPack } from "./types.ts";

// Nel pacchetto di prova: "check" è formativo (3 domande), "case" (6) ed "exit"
// (8) sono obbligatori, "retake" è il recupero di "exit". "case" si ripete su
// se stesso. In ogni attività le ultime domande sono essenziali.
const pack = createGenericTrainingPack();

// Il turno c1 è in corso a NOW (14:30-16:30 ora di Roma), c2 è più avanti.
const NOW = Date.parse("2026-10-05T13:00:00Z");
const sessions: ResultsSession[] = [
  { cohortId: "c1", startsAt: new Date("2026-10-05T12:30:00Z"), endsAt: new Date("2026-10-05T14:30:00Z"), status: "scheduled" },
  { cohortId: "c2", startsAt: new Date("2026-10-27T09:00:00Z"), endsAt: new Date("2026-10-27T11:00:00Z"), status: "scheduled" },
];

/** Consegna valutata davvero da gradeActivity; `choose` decide l'opzione per ogni domanda. */
function graded(activityId: string, choose: (index: number, correctOptionId: string) => string = (_, correct) => correct, source: PrivateTrainingPack = pack): ObjectiveGrade {
  const activity = getActivity(source, activityId);
  const answers = Object.fromEntries(activity.item_ids!.map((itemId, index) => [itemId, choose(index, source.items.find((item) => item.id === itemId)!.correct_option_ids[0])]));
  const fields = Object.fromEntries((activity.required_text_fields ?? []).map((field) => [field.id, "x".repeat(field.min_chars)]));
  return gradeActivity(source, activityId, { answers, fields, ...(activity.allowed_modes ? { mode: activity.allowed_modes[0] } : {}) });
}
const allRight = (activityId: string) => graded(activityId);
/** Le prime `count` domande giuste, le altre con «Non lo so ancora». */
const firstRight = (activityId: string, count: number) => graded(activityId, (index, correct) => (index < count ? correct : "unsure"));

function people(count: number, cohortId = "c1", from = 1): ResultsEnrollment[] {
  return Array.from({ length: count }, (_, index) => {
    const n = from + index;
    return { id: `e${n}`, userId: `u${n}`, cohortId, name: `Persona ${n}`, email: `persona${n}@example.test` };
  });
}

let sequence = 0;
function attempt(person: ResultsEnrollment, activityId: string, result: ObjectiveGrade | null, extra: Partial<ResultsAttempt> = {}): ResultsAttempt {
  sequence += 1;
  return {
    id: `a${sequence}`, enrollmentId: person.id, userId: person.userId, activityId, attemptNumber: 1,
    status: result ? "submitted" : "draft", result, submittedAt: result ? new Date(NOW) : null, ...extra,
  };
}

function build(input: Partial<Parameters<typeof buildLearningResults>[0]>) {
  return buildLearningResults({ pack, sessions, enrollments: [], attempts: [], aggregateScope: "all", reviewScope: "all", requestedCohort: "all", now: NOW, ...input });
}
function shownGroup(group: GroupResults | null) {
  assert.ok(group, "il gruppo deve esserci");
  assert.equal(group.suppressed, false, "il gruppo non deve essere nascosto");
  return group as Extract<GroupResults, { suppressed: false }>;
}
function groupActivity(group: GroupResults | null, activityId: string): GroupActivity {
  const found = shownGroup(group).activities.find((activity) => activity.id === activityId);
  assert.ok(found, `attività ${activityId} assente`);
  return found;
}
function row(individuals: IndividualRow[] | null, userId: string) {
  const found = individuals?.find((entry) => entry.userId === userId);
  assert.ok(found, `persona ${userId} assente`);
  return found;
}
const cell = (individuals: IndividualRow[] | null, userId: string, activityId: string) => row(individuals, userId).cells.find((entry) => entry.activityId === activityId)!;

test("la soglia del gruppo è di cinque persone", () => {
  assert.equal(RESULTS_MINIMUM_GROUP, 5);
});

test("le attività elencate sono quelle del primo modulo, senza il recupero", () => {
  const results = build({ enrollments: people(5) });
  assert.deepEqual(results.activities, [
    { id: "check", title: "Generic check", required: false, formative: true, totalItems: 3 },
    { id: "case", title: "Generic case", required: true, formative: false, totalItems: 6 },
    { id: "exit", title: "Generic exit", required: true, formative: false, totalItems: 8 },
  ]);
  assert.deepEqual(shownGroup(results.group).activities.map((activity) => activity.id), ["check", "case", "exit"]);
  assert.deepEqual(row(results.individuals, "u1").cells.map((entry) => entry.activityId), ["check", "case", "exit"]);
});

test("con meno di cinque iscritti il gruppo resta nascosto, ma la vista individuale no", () => {
  const four = build({ enrollments: people(4) });
  assert.deepEqual(four.group, { suppressed: true, minimum: 5 });
  assert.equal(four.individuals?.length, 4);

  const five = build({ enrollments: people(5) });
  const group = shownGroup(five.group);
  assert.equal(group.enrolled, 5);
  assert.equal(group.minimum, 5);
  assert.equal(group.started, 0);
  assert.equal(group.completed, 0);
  assert.equal(group.achieved, 0);
  assert.equal(group.required, 2);
});

test("la soglia del gruppo conta solo gli iscritti del turno scelto", () => {
  const enrollments = [...people(3, "c1"), ...people(3, "c2", 4)];
  // Due turni piccoli non si sommano: ognuno resta sotto la soglia.
  assert.deepEqual(build({ enrollments, requestedCohort: "all" }).group, { suppressed: true, minimum: 5 });
  assert.deepEqual(build({ enrollments, requestedCohort: "c1" }).group, { suppressed: true, minimum: 5 });
  // Senza richiesta vale il turno in corso, c1: tre persone non bastano.
  const live = build({ enrollments, requestedCohort: undefined });
  assert.equal(live.selectedCohort, "c1");
  assert.deepEqual(live.group, { suppressed: true, minimum: 5 });
  assert.deepEqual(live.individuals?.map((entry) => entry.userId), ["u1", "u2", "u3"]);
});

test("«Tutti i turni» non rivela un turno nascosto per differenza", () => {
  // c1: 6 iscritti e 5 consegne tutte giuste; c2: una sola persona, che non sa.
  const c1 = people(6, "c1");
  const [alone] = people(1, "c2", 7);
  const attempts = [
    ...c1.slice(0, 5).map((person) => attempt(person, "exit", allRight("exit"))),
    attempt(alone, "exit", graded("exit", () => "unsure")),
  ];
  const enrollments = [...c1, alone];
  const all = shownGroup(build({ enrollments, attempts, requestedCohort: "all" }).group);
  const one = shownGroup(build({ enrollments, attempts, requestedCohort: "c1" }).group);
  assert.equal(all.enrolled, 6, "il turno con una persona resta fuori");
  assert.equal(all.leftOutTurns, 1);
  assert.equal(one.leftOutTurns, 0);
  assert.deepEqual(groupActivity(all, "exit"), groupActivity(one, "exit"), "togliendo c1 da «tutti» non resta nulla");
  assert.deepEqual(build({ enrollments, attempts, requestedCohort: "c2" }).group, { suppressed: true, minimum: 5 });
});

test("«Tutti i turni» nasconde le risposte finché un turno ha meno di cinque consegne", () => {
  const c1 = people(5, "c1");
  const c2 = people(5, "c2", 6);
  const enrollments = [...c1, ...c2];
  const c1Done = c1.map((person) => attempt(person, "exit", allRight("exit")));
  const twoInC2 = c2.slice(0, 2).map((person) => attempt(person, "exit", graded("exit", () => "unsure")));
  const waiting = groupActivity(build({ enrollments, attempts: [...c1Done, ...twoInC2], requestedCohort: "all" }).group, "exit");
  assert.equal(waiting.submitted, 7);
  assert.equal(waiting.visible, false, "c2 ha solo due consegne: niente risposte nella vista di tutti");
  assert.deepEqual(waiting.items, []);
  assert.equal(waiting.achieved, null);
  assert.equal(waiting.averageCorrect, null);
  // Nel turno c1 da solo le risposte si vedono.
  assert.equal(groupActivity(build({ enrollments, attempts: [...c1Done, ...twoInC2], requestedCohort: "c1" }).group, "exit").visible, true);

  const c2Done = c2.map((person) => attempt(person, "exit", allRight("exit")));
  const both = groupActivity(build({ enrollments, attempts: [...c1Done, ...c2Done], requestedCohort: "all" }).group, "exit");
  assert.equal(both.visible, true);
  assert.equal(both.submitted, 10);
  assert.equal(both.achieved, 10);
});

test("la soglia si può cambiare per chi chiama", () => {
  assert.deepEqual(build({ enrollments: people(2), minimum: 3 }).group, { suppressed: true, minimum: 3 });
  assert.equal(shownGroup(build({ enrollments: people(3), minimum: 3 }).group).enrolled, 3);
});

test("i risultati di un'attività compaiono solo da cinque consegne", () => {
  const enrollments = people(6);
  const four = enrollments.slice(0, 4).map((person) => attempt(person, "exit", allRight("exit")));
  const hidden = groupActivity(build({ enrollments, attempts: four }).group, "exit");
  assert.equal(hidden.submitted, 4);
  assert.equal(hidden.started, 4);
  assert.equal(hidden.visible, false);
  assert.equal(hidden.achieved, null);
  assert.equal(hidden.averageCorrect, null);
  assert.deepEqual(hidden.items, []);

  // Una bozza non basta per mostrare i risultati.
  const withDraft = groupActivity(build({ enrollments, attempts: [...four, attempt(enrollments[4], "exit", null)] }).group, "exit");
  assert.equal(withDraft.started, 5);
  assert.equal(withDraft.submitted, 4);
  assert.equal(withDraft.visible, false);

  const five = [...four, attempt(enrollments[4], "exit", firstRight("exit", 6))];
  const shown = groupActivity(build({ enrollments, attempts: five }).group, "exit");
  assert.equal(shown.submitted, 5);
  assert.equal(shown.visible, true);
  assert.equal(shown.achieved, 4);
  assert.equal(shown.averageCorrect, (8 * 4 + 6) / 5);
  assert.equal(shown.items.length, 8);
  assert.equal(shown.totalItems, 8);
  assert.equal(shown.required, true);
  assert.equal(shown.formative, false);
});

test("un'attività facoltativa mostra le risposte ma non conta chi ha raggiunto l'obiettivo", () => {
  const enrollments = people(5);
  const attempts = enrollments.map((person) => attempt(person, "check", allRight("check")));
  const check = groupActivity(build({ enrollments, attempts }).group, "check");
  assert.equal(check.visible, true);
  assert.equal(check.formative, true);
  assert.equal(check.required, false);
  assert.equal(check.achieved, null);
  assert.equal(check.averageCorrect, 3);
});

test("il gruppo conta la prima consegna anche se un nuovo giro va meglio; la vista individuale l'ultima", () => {
  const enrollments = people(5);
  const [first] = enrollments;
  const weak = attempt(first, "case", firstRight("case", 2));
  const strong = attempt(first, "case", allRight("case"), { attemptNumber: 2 });
  const attempts = [weak, strong, ...enrollments.slice(1).map((person) => attempt(person, "case", allRight("case")))];
  const results = build({ enrollments, attempts });

  const caseGroup = groupActivity(results.group, "case");
  assert.equal(caseGroup.submitted, 5, "ogni persona conta una volta sola");
  assert.equal(caseGroup.started, 5);
  assert.equal(caseGroup.achieved, 4);
  assert.equal(caseGroup.averageCorrect, (2 + 6 * 4) / 5);
  const firstItem = caseGroup.items[0];
  const lastItem = caseGroup.items[5];
  assert.equal(firstItem.correct, 5);
  assert.equal(lastItem.correct, 4, "conta la risposta data al primo giro");
  assert.equal(lastItem.options.find((option) => option.id === "unsure")?.count, 1);

  const mine = cell(results.individuals, "u1", "case");
  assert.equal(mine.attempts, 2);
  assert.equal(mine.state, "submitted");
  assert.equal(mine.attemptId, strong.id);
  assert.deepEqual(mine.result, { correct: 6, total: 6, status: "consolidated", essentialErrors: 0 });
});

test("il gruppo resta sulla prima consegna anche quando il nuovo giro va peggio", () => {
  const enrollments = people(5);
  const attempts = [
    attempt(enrollments[0], "case", allRight("case")),
    attempt(enrollments[0], "case", firstRight("case", 1), { attemptNumber: 2 }),
    ...enrollments.slice(1).map((person) => attempt(person, "case", allRight("case"))),
  ];
  const results = build({ enrollments, attempts });
  assert.equal(groupActivity(results.group, "case").achieved, 5);
  assert.equal(cell(results.individuals, "u1", "case").result?.status, "needs_practice");
});

test("il recupero della verifica non entra nei numeri di gruppo della verifica, ma nella riga della persona sì", () => {
  const enrollments = people(5);
  const failed = attempt(enrollments[0], "exit", firstRight("exit", 6));
  const recovered = attempt(enrollments[0], "retake", allRight("retake"), { attemptNumber: 2 });
  const attempts = [failed, recovered, ...enrollments.slice(1).map((person) => attempt(person, "exit", allRight("exit")))];
  const results = build({ enrollments, attempts });

  const exit = groupActivity(results.group, "exit");
  assert.equal(exit.submitted, 5);
  assert.equal(exit.achieved, 4);
  assert.equal(exit.averageCorrect, (6 + 8 * 4) / 5);

  const mine = cell(results.individuals, "u1", "exit");
  assert.equal(mine.attempts, 2);
  assert.equal(mine.attemptId, recovered.id);
  assert.deepEqual(mine.result, { correct: 8, total: 8, status: "consolidated", essentialErrors: 0 });

  const previous = cell(build({ enrollments, attempts: [failed] }).individuals, "u1", "exit");
  assert.deepEqual(previous.result, { correct: 6, total: 8, status: "needs_practice", essentialErrors: 2 });
});

test("per ogni domanda conta le risposte per opzione e le risposte giuste", () => {
  const enrollments = people(5);
  // exit-q0 ha come giusta option-0.
  const picks = ["option-0", "option-0", "option-1", "unsure", "unsure"];
  const attempts = enrollments.map((person, index) => attempt(person, "exit", graded("exit", (item, correct) => (item === 0 ? picks[index] : correct))));
  const exit = groupActivity(build({ enrollments, attempts }).group, "exit");
  const item = exit.items[0];
  assert.equal(item.id, "exit-q0");
  assert.equal(item.prompt, "Generic prompt 0");
  assert.equal(item.critical, false);
  assert.equal(item.feedback, "PRIVATE_FEEDBACK_MARKER");
  assert.equal(item.answered, 5);
  assert.equal(item.correct, 2);
  assert.deepEqual(item.options, [
    { id: "option-0", text: "Generic option 0", correct: true, count: 2 },
    { id: "option-1", text: "Generic option 1", correct: false, count: 1 },
    { id: "option-2", text: "Generic option 2", correct: false, count: 0 },
    { id: "option-3", text: "Generic option 3", correct: false, count: 0 },
    { id: "unsure", text: "Not sure yet", correct: false, count: 2 },
  ]);
  // Le altre domande: tutti giusti, e le ultime due sono essenziali.
  assert.deepEqual(exit.items.slice(1).map((entry) => entry.correct), [5, 5, 5, 5, 5, 5, 5]);
  assert.deepEqual(exit.items.map((entry) => entry.critical), [false, false, false, false, false, false, true, true]);
  assert.equal(exit.items.reduce((sum, entry) => sum + entry.options.reduce((total, option) => total + option.count, 0), 0), 5 * 8);
});

test("«Non lo so ancora» va sempre in fondo, qualunque sia l'ordine del pacchetto", () => {
  const reordered = structuredClone(pack);
  const target = reordered.items.find((item) => item.id === "exit-q1")!;
  target.options = [...target.options.filter((option) => option.id === "unsure"), ...target.options.filter((option) => option.id !== "unsure").reverse()];
  const enrollments = people(5);
  const attempts = enrollments.map((person) => attempt(person, "exit", graded("exit", (item, correct) => (item === 1 ? "unsure" : correct), reordered)));
  const item = groupActivity(build({ pack: reordered, enrollments, attempts }).group, "exit").items[1];
  assert.deepEqual(item.options.map((option) => option.id), ["option-3", "option-2", "option-1", "option-0", "unsure"]);
  assert.equal(item.options.at(-1)?.count, 5);
  assert.equal(item.correct, 0);
  assert.equal(item.options.find((option) => option.correct)?.id, "option-1");
});

test("un permesso di gruppo limitato a un turno vede solo quel turno", () => {
  const enrollments = [...people(5, "c1"), ...people(5, "c2", 6)];
  const attempts = enrollments.filter((person) => person.cohortId === "c2").map((person) => attempt(person, "exit", allRight("exit")));
  const results = build({ enrollments, attempts, aggregateScope: new Set(["c1"]), reviewScope: null });
  assert.deepEqual(results.cohorts.map((cohort) => cohort.id), ["c1"]);
  const group = shownGroup(results.group);
  assert.equal(group.enrolled, 5);
  assert.equal(group.started, 0, "le consegne di un altro turno non contano");
  assert.equal(groupActivity(results.group, "exit").submitted, 0);
  assert.equal(results.individuals, null);
});

test("senza permesso di gruppo non c'è il gruppo; la vista individuale segue il suo permesso", () => {
  const enrollments = [...people(5, "c1"), ...people(5, "c2", 6)];
  const results = build({ enrollments, aggregateScope: null, reviewScope: new Set(["c2"]) });
  assert.equal(results.group, null);
  assert.deepEqual(results.cohorts.map((cohort) => cohort.id), ["c2"]);
  assert.deepEqual(results.individuals?.map((entry) => entry.cohortId), ["c2", "c2", "c2", "c2", "c2"]);
});

test("permessi diversi per gruppo e individuali: ognuno resta nel proprio turno", () => {
  const enrollments = [...people(5, "c1"), ...people(5, "c2", 6)];
  const results = build({ enrollments, aggregateScope: new Set(["c1"]), reviewScope: new Set(["c2"]) });
  assert.deepEqual(results.cohorts.map((cohort) => cohort.id), ["c1", "c2"]);
  assert.equal(shownGroup(results.group).enrolled, 5);
  assert.deepEqual(results.individuals?.map((entry) => entry.userId), ["u6", "u7", "u8", "u9", "u10"]);
});

test("senza alcun permesso sui risultati non escono né gruppo né individuali né turni", () => {
  const results = build({ enrollments: people(5), aggregateScope: null, reviewScope: null });
  assert.equal(results.group, null);
  assert.equal(results.individuals, null);
  assert.deepEqual(results.cohorts, []);
  assert.equal(results.selectedCohort, null);
});

test("pickCohort: turno chiesto se visibile, «all» per tutti, altrimenti quello in corso", () => {
  const cohorts: ResultsCohort[] = [
    { id: "c1", startsAt: "", endsAt: "", status: "scheduled", live: false },
    { id: "c2", startsAt: "", endsAt: "", status: "scheduled", live: true },
    { id: "c3", startsAt: "", endsAt: "", status: "scheduled", live: false },
  ];
  assert.equal(pickCohort(cohorts, "c3"), "c3");
  assert.equal(pickCohort(cohorts, "all"), null);
  assert.equal(pickCohort(cohorts, "sconosciuto"), "c2");
  assert.equal(pickCohort(cohorts, undefined), "c2");
  assert.equal(pickCohort(cohorts, null), "c2");
  assert.equal(pickCohort(cohorts, ""), "c2");
  const noneLive = cohorts.map((cohort) => ({ ...cohort, live: false }));
  assert.equal(pickCohort(noneLive, undefined), null);
  assert.equal(pickCohort(noneLive, "sconosciuto"), null);
  assert.equal(pickCohort(noneLive, "c1"), "c1");
  assert.equal(pickCohort([], "all"), null);
});

test("i turni: in corso solo dentro l'orario e se non chiusi; un turno fuori permesso non si può scegliere", () => {
  const results = build({ requestedCohort: undefined });
  assert.deepEqual(results.cohorts, [
    { id: "c1", startsAt: "2026-10-05T12:30:00.000Z", endsAt: "2026-10-05T14:30:00.000Z", status: "scheduled", live: true },
    { id: "c2", startsAt: "2026-10-27T09:00:00.000Z", endsAt: "2026-10-27T11:00:00.000Z", status: "scheduled", live: false },
  ]);
  assert.equal(results.selectedCohort, "c1");
  assert.equal(build({ requestedCohort: "c2" }).selectedCohort, "c2");
  assert.equal(build({ requestedCohort: "all" }).selectedCohort, null);

  const closed = sessions.map((session) => (session.cohortId === "c1" ? { ...session, status: "closed" } : session));
  assert.equal(build({ sessions: closed, requestedCohort: undefined }).selectedCohort, null);
  assert.equal(build({ requestedCohort: undefined, now: Date.parse("2026-10-05T14:30:00Z") }).selectedCohort, null, "la fine del turno è esclusa");
  assert.equal(build({ requestedCohort: undefined, now: Date.parse("2026-10-05T12:30:00Z") }).selectedCohort, "c1", "l'inizio del turno è incluso");

  // c1 non è nel permesso: chiederlo riporta al turno in corso visibile, qui nessuno.
  const outside = build({ aggregateScope: new Set(["c2"]), reviewScope: null, requestedCohort: "c1" });
  assert.deepEqual(outside.cohorts.map((cohort) => cohort.id), ["c2"]);
  assert.equal(outside.selectedCohort, null);
});

test("i tentativi di un altro utente con la stessa iscrizione non contano", () => {
  const enrollments = people(5);
  const intruder = attempt(enrollments[0], "exit", allRight("exit"), { userId: "u-altro" });
  const attempts = [intruder, ...enrollments.slice(1).map((person) => attempt(person, "exit", allRight("exit")))];
  const results = build({ enrollments, attempts });
  const group = shownGroup(results.group);
  assert.equal(group.started, 4);
  assert.equal(groupActivity(results.group, "exit").submitted, 4);
  assert.equal(groupActivity(results.group, "exit").visible, false);
  const mine = row(results.individuals, "u1");
  assert.equal(mine.completion.status, "not_started");
  assert.ok(mine.cells.every((entry) => entry.state === "not_started" && entry.attempts === 0 && entry.attemptId === null));
});

test("completamento: completato quando tutte le obbligatorie sono consegnate, obiettivo raggiunto sull'ultima consegna", () => {
  const enrollments = people(5);
  const [p1, p2, p3, p4] = enrollments;
  const attempts = [
    attempt(p1, "case", allRight("case")), attempt(p1, "exit", allRight("exit")),
    attempt(p2, "case", allRight("case")), attempt(p2, "exit", firstRight("exit", 6)),
    attempt(p3, "case", allRight("case")), attempt(p3, "exit", firstRight("exit", 6)), attempt(p3, "retake", allRight("retake"), { attemptNumber: 2 }),
    attempt(p4, "check", allRight("check")),
  ];
  const results = build({ enrollments, attempts });
  const group = shownGroup(results.group);
  assert.equal(group.enrolled, 5);
  assert.equal(group.started, 4);
  assert.equal(group.completed, 3);
  assert.equal(group.achieved, 2);
  assert.equal(group.required, 2);

  assert.deepEqual(row(results.individuals, "u1").completion, { required: 2, submitted: 2, status: "completed", outcome: "consolidated" });
  assert.deepEqual(row(results.individuals, "u2").completion, { required: 2, submitted: 2, status: "completed", outcome: "needs_practice" });
  assert.deepEqual(row(results.individuals, "u3").completion, { required: 2, submitted: 2, status: "completed", outcome: "consolidated" });
  assert.deepEqual(row(results.individuals, "u4").completion, { required: 2, submitted: 0, status: "in_progress", outcome: null });
  assert.deepEqual(row(results.individuals, "u5").completion, { required: 2, submitted: 0, status: "not_started", outcome: null });
});

test("una bozza conta come iniziata ma non come consegnata; stato delle celle individuali", () => {
  const enrollments = people(5);
  const [p1, , p3, p4, p5] = enrollments;
  const draft = attempt(p1, "case", null);
  const done = attempt(p3, "case", allRight("case"));
  const retry = attempt(p3, "case", null, { attemptNumber: 2 });
  const attempts = [draft, done, retry, attempt(p4, "case", allRight("case")), attempt(p5, "case", allRight("case"))];
  const results = build({ enrollments, attempts });

  const group = shownGroup(results.group);
  assert.equal(group.started, 4);
  assert.equal(group.completed, 0);
  const caseGroup = groupActivity(results.group, "case");
  assert.equal(caseGroup.started, 4);
  assert.equal(caseGroup.submitted, 3);
  assert.equal(caseGroup.visible, false);

  assert.deepEqual(cell(results.individuals, "u1", "case"), { activityId: "case", attempts: 1, state: "draft", attemptId: draft.id, result: null });
  assert.deepEqual(cell(results.individuals, "u2", "case"), { activityId: "case", attempts: 0, state: "not_started", attemptId: null, result: null });
  assert.deepEqual(cell(results.individuals, "u3", "case"), {
    activityId: "case", attempts: 2, state: "submitted", attemptId: done.id, result: { correct: 6, total: 6, status: "consolidated", essentialErrors: 0 },
  });
  assert.deepEqual(row(results.individuals, "u1").completion, { required: 2, submitted: 0, status: "in_progress", outcome: null });
});

test("la riga individuale usa l'email quando manca il nome", () => {
  const [nameless, ...others] = people(5);
  const results = build({ enrollments: [{ ...nameless, name: null }, ...others] });
  const mine = row(results.individuals, "u1");
  assert.equal(mine.name, "persona1@example.test");
  assert.equal(mine.email, "persona1@example.test");
  assert.equal(mine.cohortId, "c1");
  assert.equal(row(results.individuals, "u2").name, "Persona 2");
});
