import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_REFRESH_LEAD_MS,
  agendaBlocks,
  clockLabel,
  exerciseRow,
  lessonPhase,
  lessonWhen,
  liveRefreshFrom,
  materialSteps,
  nextLessonOf,
  nowCard,
  shortWhen,
  sizeLabel,
  type CourseActivity,
  type CourseMaterial,
} from "./course-view.ts";
import { LIVE_REFRESH_MAX_SECONDS, LIVE_REFRESH_PROBE, LIVE_REFRESH_SECONDS, liveRefreshAfter, liveRefreshDelayMs, liveRefreshRuns } from "./live-refresh.ts";
import { ATTEMPTS_ANCHOR, progressTarget } from "./moved-routes.ts";
import { LEARNING_TEXT } from "./text.ts";

// (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §3.9) Le regole della pagina del corso: la lezione
// detta una volta, la fase, la card «Adesso» con il solo pulsante pieno, la riga di ogni esercizio, la scaletta con gli
// orari veri, l'aggiornamento da solo in lezione e l'indirizzo di «Il mio risultato». Dati inventati: una lezione di
// lunedì 23 novembre 2026, 14:30–16:30 a Roma (13:30–15:30 UTC).

const T = LEARNING_TEXT.course;
const BASE = "/dashboard/ws/learning/p1";
const START = Date.parse("2026-11-23T13:30:00.000Z");
const END = Date.parse("2026-11-23T15:30:00.000Z");
const MIN = 60_000;
const session = (status = "scheduled") => ({ startsAt: new Date(START).toISOString(), endsAt: new Date(END).toISOString(), status });

const closedAvailability = { state: "scheduled", writeAccess: false, opensAt: new Date(START + 30 * MIN).toISOString(), reason: "x" };
const openAvailability = { state: "available", writeAccess: true, opensAt: new Date(START + 30 * MIN).toISOString(), reason: null };
function activity(o: Partial<CourseActivity> & { id: string }): CourseActivity {
  return {
    title: `Esercizio ${o.id}`,
    purpose: "post_module",
    required: true,
    estimatedMinutes: 10,
    status: "scheduled",
    attemptId: null,
    result: null,
    opensAfterMinutes: 30,
    availability: closedAvailability,
    ...o,
  };
}
function material(o: Partial<CourseMaterial> & { id: string }): CourseMaterial {
  return { title: `Materiale ${o.id}`, description: null, fileName: `${o.id}.zip`, sizeBytes: 2_200_000, href: `/api/learning/materials/${o.id}`, access: { downloadable: true }, ...o };
}

test("the lesson is said once, in words and Rome's time, never with the time zone", () => {
  assert.equal(lessonWhen(session()), "lunedì 23 novembre, 14:30–16:30");
  assert.equal(shortWhen(START), "lun 23 nov, 14:30");
  assert.equal(clockLabel(START + 30 * MIN), "15:00");
  assert.equal(T.lesson(lessonWhen(session())), "La tua lezione: lunedì 23 novembre, 14:30–16:30");
  assert.doesNotMatch(lessonWhen(session()), /Europe|Rome|UTC/);
});

test("the phase follows the clock; an early opening counts as the lesson; a suspension does not end it", () => {
  assert.equal(lessonPhase(null, START), "none");
  assert.equal(lessonPhase(session(), START - MIN), "before");
  assert.equal(lessonPhase(session("open"), START - 60 * MIN), "live", "chi tiene il corso apre prima");
  assert.equal(lessonPhase(session(), START), "live");
  assert.equal(lessonPhase(session("closed"), START + 40 * MIN), "live", "le risposte sospese si possono riaprire");
  assert.equal(lessonPhase(session(), END - 1), "live");
  assert.equal(lessonPhase(session(), END), "after");
  assert.equal(lessonPhase(session("open"), END + MIN), "after");
});

test("the page refreshes by itself from a quarter of an hour before the lesson to its end, never after", () => {
  assert.equal(liveRefreshFrom(null, START), null);
  assert.equal(liveRefreshFrom(session(), START - 13 * 60 * MIN), null, "più di 12 ore prima: niente");
  assert.equal(liveRefreshFrom(session(), START - 2 * 60 * MIN), START - LIVE_REFRESH_LEAD_MS, "la pagina aperta prima aspetta l'ora giusta");
  assert.equal(liveRefreshFrom(session(), START + 60 * MIN), START - LIVE_REFRESH_LEAD_MS);
  assert.equal(liveRefreshFrom(session("closed"), START + 60 * MIN), START - LIVE_REFRESH_LEAD_MS, "anche con le risposte sospese");
  assert.equal(liveRefreshFrom(session(), END), null);
  assert.equal(LIVE_REFRESH_LEAD_MS, 15 * MIN);
});

test("the refresh rhythm: every 15 s, never offline, hidden or with unsaved edits, doubling after a failure up to 2 minutes", () => {
  assert.equal(LIVE_REFRESH_SECONDS, 15);
  assert.equal(liveRefreshDelayMs(0), 15_000);
  assert.equal(liveRefreshDelayMs(1), 30_000);
  assert.equal(liveRefreshDelayMs(2), 60_000);
  assert.equal(liveRefreshDelayMs(3), LIVE_REFRESH_MAX_SECONDS * 1000);
  assert.equal(liveRefreshDelayMs(40), 120_000, "mai oltre i 2 minuti");
  assert.equal(liveRefreshDelayMs(-2), 15_000);
  assert.equal(liveRefreshDelayMs(Number.NaN), 15_000);
  assert.equal(liveRefreshRuns({ online: true, visible: true, editing: false }), true);
  assert.equal(liveRefreshRuns({ online: false, visible: true, editing: false }), false, "senza rete la rilettura diventerebbe la pagina «offline» del browser");
  assert.equal(liveRefreshRuns({ online: true, visible: false, editing: false }), false, "con la scheda nascosta niente");
  assert.equal(liveRefreshRuns({ online: true, visible: true, editing: true }), false, "con modifiche non salvate niente");
  let state = liveRefreshAfter(0, false);
  assert.deepEqual(state, { failures: 1, refresh: false });
  state = liveRefreshAfter(state.failures, false);
  assert.equal(liveRefreshDelayMs(state.failures), 60_000);
  state = liveRefreshAfter(state.failures, true);
  assert.deepEqual(state, { failures: 0, refresh: true });
  assert.equal(LIVE_REFRESH_PROBE, "/favicon.ico", "un file piccolo del sito, non la pagina");
});

test("an exercise row: the state as a dot and a word, one grey fact, a link only where there is something to open", () => {
  const now = START + 40 * MIN;
  const done = exerciseRow(activity({ id: "a", status: "submitted", attemptId: "t1", result: { correct: 4, total: 5, status: "consolidated" } }), BASE, now);
  assert.deepEqual(done, { id: "a", title: "Esercizio a", tone: "verde", state: "Obiettivo raggiunto", fact: "4 di 5 giuste", href: `${BASE}/attempts/t1` });
  const practice = exerciseRow(activity({ id: "b", status: "submitted", attemptId: "t2", result: { correct: 2, total: 5, status: "needs_practice" } }), BASE, now);
  assert.equal(practice.tone, "giallo");
  assert.equal(practice.state, "Da ripassare");
  const formative = exerciseRow(activity({ id: "c", required: false, status: "submitted", attemptId: "t3", result: { correct: 3, total: 3, status: "formative_completed" } }), BASE, now);
  assert.equal(formative.state, "Fatto");
  assert.equal(formative.fact, "3 di 3 giuste · non conta per il risultato");
  const draft = exerciseRow(activity({ id: "d", status: "draft", attemptId: "t4", availability: openAvailability }), BASE, now);
  assert.deepEqual([draft.tone, draft.state, draft.href], ["blu", "In corso", `${BASE}/attempts/t4`]);
  const frozen = exerciseRow(activity({ id: "e", status: "draft", attemptId: "t5", availability: { ...closedAvailability, state: "session_closed" } }), BASE, now);
  assert.deepEqual([frozen.tone, frozen.state], ["grigio", "Risposte salvate"]);
  const todo = exerciseRow(activity({ id: "f", status: "available", availability: openAvailability }), BASE, now);
  assert.deepEqual([todo.tone, todo.state, todo.fact, todo.href], ["blu", "Da fare", "circa 10 minuti", `${BASE}/activities/f`]);
  const later = exerciseRow(activity({ id: "g" }), BASE, now);
  assert.deepEqual([later.tone, later.state, later.href], ["grigio", "Si apre alle 15:00", null]);
  const otherDay = exerciseRow(activity({ id: "h" }), BASE, START - 24 * 60 * MIN);
  assert.equal(otherDay.state, "Si apre lun 23 nov, 15:00");
  const closed = exerciseRow(activity({ id: "i", status: "session_closed", availability: { state: "session_closed", writeAccess: false, opensAt: null, reason: "x" } }), BASE, now);
  assert.equal(closed.state, "Chiuso");
  const planned = exerciseRow(activity({ id: "j", status: "planned", availability: { state: "planned", writeAccess: false, opensAt: null, reason: "x" } }), BASE, now);
  assert.equal(planned.state, "Non ancora aperto");
  for (const row of [done, practice, formative, draft, frozen, todo, later, otherDay, closed, planned]) {
    assert.doesNotMatch(`${row.state} ${row.fact ?? ""}`, /Europe|Rome|undefined|null/);
  }
});

const three = (o: Partial<Record<"a" | "b" | "c", Partial<CourseActivity>>> = {}) => [
  activity({ id: "a", title: "Ripasso", purpose: "formative", required: false, ...o.a }),
  activity({ id: "b", title: "Il caso", ...o.b }),
  activity({ id: "c", title: "La verifica", ...o.c }),
];

test("«Adesso» before the lesson: «Scarica i materiali», one file downloads at once with its steps, several open the fold", () => {
  const one = nowCard({ session: session(), now: START - 60 * MIN, activities: three(), beforeMaterials: [material({ id: "m1", description: "1. Scarica il file\n2) Aprilo con un doppio clic\n- Trascina la cartella" })], base: BASE, courseOpen: true });
  assert.equal(one.phase, "before");
  assert.equal(one.line, T.now.before);
  assert.deepEqual(one.action, { kind: "download", label: "Scarica i materiali", href: "/api/learning/materials/m1", fileName: "m1.zip" });
  assert.deepEqual(one.steps, ["Scarica il file", "Aprilo con un doppio clic", "Trascina la cartella"]);
  const two = nowCard({ session: session(), now: START - 60 * MIN, activities: three(), beforeMaterials: [material({ id: "m1" }), material({ id: "m2" })], base: BASE, courseOpen: true });
  assert.deepEqual(two.action, { kind: "materials", label: "Scarica i materiali", href: "#materiali" });
  assert.deepEqual(two.steps, []);
  const locked = nowCard({ session: session(), now: START - 60 * MIN, activities: three(), beforeMaterials: [material({ id: "m1", access: { downloadable: false, reason: "Si apre a fine lezione." } })], base: BASE, courseOpen: true });
  assert.equal(locked.action, null, "un materiale non ancora scaricabile non è un passo");
  const none = nowCard({ session: session(), now: START - 60 * MIN, activities: three(), beforeMaterials: [], base: BASE, courseOpen: true });
  assert.equal(none.line, T.now.beforeNoMaterials);
  assert.equal(none.action, null);
});

test("«Adesso» in the lesson: «Inizia» or «Continua» on the open exercise; the next opening; a suspension; the materials until the first opening", () => {
  const now = START + 35 * MIN;
  const formative = nowCard({ session: session(), now, activities: three({ a: { status: "available", availability: openAvailability } }), beforeMaterials: [], base: BASE, courseOpen: true });
  assert.equal(formative.line, T.now.live);
  assert.deepEqual(formative.action, { kind: "start", label: "Inizia: Ripasso", href: `${BASE}/activities/a` }, "in lezione anche il ripasso del momento");
  const resume = nowCard({
    session: session(),
    now,
    activities: three({ a: { status: "available", availability: openAvailability }, b: { status: "draft", attemptId: "t9", availability: openAvailability } }),
    beforeMaterials: [],
    base: BASE,
    courseOpen: true,
  });
  assert.deepEqual(resume.action, { kind: "resume", label: "Continua: Il caso", href: `${BASE}/attempts/t9` }, "prima l'esercizio obbligatorio iniziato");
  const waiting = nowCard({ session: session(), now: START + 5 * MIN, activities: three(), beforeMaterials: [material({ id: "m1" })], base: BASE, courseOpen: true });
  assert.equal(waiting.note, "Il prossimo esercizio si apre alle 15:00.");
  assert.equal(waiting.action?.kind, "download", "finché nessun esercizio è aperto, i materiali");
  const suspended = nowCard({ session: session("closed"), now, activities: three(), beforeMaterials: [material({ id: "m1" })], base: BASE, courseOpen: true });
  assert.equal(suspended.note, T.now.suspended);
  assert.equal(suspended.action, null);
  const submitted = { status: "submitted", attemptId: "t1", result: { correct: 5, total: 5, status: "consolidated" }, availability: openAvailability };
  const allDone = nowCard({ session: session(), now, activities: three({ a: { ...submitted, result: { correct: 3, total: 3, status: "formative_completed" } }, b: submitted, c: submitted }), beforeMaterials: [], base: BASE, courseOpen: true });
  assert.equal(allDone.note, T.now.allDone);
  assert.equal(allDone.action, null);
  const between = nowCard({ session: session(), now, activities: three({ a: { ...submitted, result: { correct: 3, total: 3, status: "formative_completed" } } }), beforeMaterials: [material({ id: "m1" })], base: BASE, courseOpen: true });
  assert.equal(between.note, "Il prossimo esercizio si apre alle 15:00.");
  assert.equal(between.action, null, "dopo il primo esercizio i materiali non sono più il passo");
});

test("«Adesso» after the lesson: one number, the outcome, and the step that is left («Inizia» or «Rifai»)", () => {
  const now = END + 60 * MIN;
  const ok = { status: "submitted", attemptId: "t1", result: { correct: 5, total: 5, status: "consolidated" }, availability: openAvailability };
  const homework = nowCard({ session: session(), now, activities: three({ b: ok, c: { status: "available", availability: openAvailability } }), beforeMaterials: [material({ id: "m1" })], base: BASE, courseOpen: true });
  assert.equal(homework.line, "1 di 2 esercizi fatti");
  assert.equal(homework.note, null);
  assert.deepEqual(homework.action, { kind: "start", label: "Inizia: La verifica", href: `${BASE}/activities/c` });
  const practice = nowCard({
    session: session(),
    now,
    activities: three({ b: ok, c: { status: "submitted", attemptId: "t7", result: { correct: 2, total: 5, status: "needs_practice" }, availability: openAvailability } }),
    beforeMaterials: [],
    base: BASE,
    courseOpen: true,
  });
  assert.equal(practice.line, "2 di 2 esercizi fatti");
  assert.equal(practice.note, "Alcuni punti da ripassare.");
  assert.deepEqual(practice.action, { kind: "redo", label: "Rifai: La verifica", href: `${BASE}/attempts/t7` });
  const achieved = nowCard({ session: session(), now, activities: three({ b: ok, c: ok }), beforeMaterials: [], base: BASE, courseOpen: true });
  assert.equal(achieved.note, "Obiettivo raggiunto.");
  assert.equal(achieved.action, null);
  const untouched = nowCard({ session: session(), now, activities: three(), beforeMaterials: [], base: BASE, courseOpen: true });
  assert.equal(untouched.line, "2 esercizi da fare", "lo zero non si mostra");
  const closed = nowCard({ session: session(), now, activities: three({ b: ok }), beforeMaterials: [], base: BASE, courseOpen: false });
  assert.equal(closed.line, T.now.closed);
  assert.equal(closed.action, null);
  const noLesson = nowCard({ session: null, now, activities: three(), beforeMaterials: [], base: BASE, courseOpen: true });
  assert.equal(noLesson.line, T.now.noLesson);
});

test("the agenda with real times, «Siamo qui» on the current block; minutes for whoever runs the course without a lesson", () => {
  const agenda = [
    { from_minute: 0, to_minute: 30, title: "Apertura" },
    { from_minute: 30, to_minute: 78, title: "Esercizio guidato", detail: "In coppia" },
    { from_minute: 78, to_minute: 120, title: "Il caso" },
  ];
  const live = agendaBlocks(agenda, session(), START + 40 * MIN);
  assert.deepEqual(live.map((block) => [block.time, block.current, block.past]), [
    ["14:30–15:00", false, true],
    ["15:00–15:48", true, false],
    ["15:48–16:30", false, false],
  ]);
  assert.equal(live[1].detail, "In coppia");
  const before = agendaBlocks(agenda, session(), START - 10 * MIN);
  assert.ok(before.every((block) => !block.current && !block.past));
  const trainer = agendaBlocks(agenda, null, START);
  assert.deepEqual(trainer.map((block) => block.time), ["30 min", "48 min", "42 min"]);
  assert.doesNotMatch(live.map((block) => block.time).join(" "), /^\d\d–\d\d$/, "mai più «00–30»");
});

test("the next lesson on a course card: the own one for a participant, the first upcoming one for whoever runs it", () => {
  assert.equal(nextLessonOf({ ownSession: session(), sessions: [], canParticipate: true, now: START - MIN }), "lun 23 nov, 14:30");
  assert.equal(nextLessonOf({ ownSession: session(), sessions: [], canParticipate: true, now: END }), null, "finita: niente");
  assert.equal(nextLessonOf({ ownSession: null, sessions: [], canParticipate: true, now: START }), null);
  const later = { startsAt: "2026-11-30T08:00:00.000Z", endsAt: "2026-11-30T10:00:00.000Z", status: "scheduled" };
  assert.equal(nextLessonOf({ ownSession: null, sessions: [later, session()], canParticipate: false, now: START - MIN }), "lun 23 nov, 14:30");
  assert.equal(nextLessonOf({ ownSession: null, sessions: [later, session("closed")], canParticipate: false, now: START - MIN }), "lun 30 nov, 09:00");
});

test("the small helpers: steps from a description, a file size", () => {
  assert.deepEqual(materialSteps(null), []);
  assert.deepEqual(materialSteps("  \n1. Uno\n\n• Due\n3) Tre"), ["Uno", "Due", "Tre"]);
  assert.equal(sizeLabel(900), "900 byte");
  assert.equal(sizeLabel(2048), "2 KB");
  assert.equal(sizeLabel(2_200_000), "2,1 MB");
});

test("«Il mio risultato» moved: a 308 to the course page, on «Tutte le prove», keeping the query", () => {
  assert.equal(progressTarget("/dashboard/ws/learning/p1/progress"), `/dashboard/ws/learning/p1#${ATTEMPTS_ANCHOR}`);
  assert.equal(progressTarget("/dashboard/ws/learning/p1/progress/", "a=1&b=2"), "/dashboard/ws/learning/p1?a=1&b=2#prove");
  assert.equal(progressTarget("/dashboard/ws/learning/p1/progress", new URLSearchParams({ turno: "x" })), "/dashboard/ws/learning/p1?turno=x#prove");
  assert.equal(progressTarget("/dashboard/ws/learning/p1/results"), null);
  assert.equal(progressTarget("/dashboard/ws/learning/progress"), null);
});
