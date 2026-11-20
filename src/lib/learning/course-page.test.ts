import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { installAppModules } from "../ai/claude-test-kit.ts";
import { enableTsxImports } from "../../components/use-cases/detail/referent/tsx-test-loader.ts";
import { findHubForbiddenIn } from "../use-cases/copy-guard.ts";
import { LEARNING_TEXT } from "./text.ts";
import { filledButtons, folds, textOf, visibleText, wordCount } from "./render-test-kit.ts";

// (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §3.9) La pagina del corso e l'ingresso della
// Formazione resi in HTML, con le letture del corso finte: per chi segue il corso prima, durante e dopo la lezione, e
// per chi lo tiene. Un solo pulsante pieno, le pieghe chiuse (la scaletta aperta in lezione), gli esiti solo in
// «Esercizi», circa 150 parole, l'aggiornamento da solo in lezione; l'ingresso dritto nel corso con un corso solo; il
// vecchio «Il mio risultato» con un 308. Dati inventati: «Corso di prova», lunedì 23 novembre 2026, 14:30–16:30.

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

type Fake = { program: unknown; programs: Record<string, unknown>; home: unknown; catalog: unknown; error: unknown; live: Array<{ from: number }> };
const fake: Fake = { program: null, programs: {}, home: null, catalog: null, error: null, live: [] };
(globalThis as { __learningFake?: Fake }).__learningFake = fake;

await installAppModules({
  "@/lib/learning/server": `export class LearningError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  export async function getLearningProgram(workspaceId, programId) {
    const f = globalThis.__learningFake;
    if (f.error) throw f.error;
    return f.programs[programId] ?? f.program;
  }
  export async function getLearningHome() { return globalThis.__learningFake.home; }`,
  "@/lib/learning/admin": `export async function getLearningAdminCatalog() { return globalThis.__learningFake.catalog; }`,
});
await enableTsxImports();
// L'aggiornamento da solo è un componente del browser: qui si registra soltanto quando la pagina lo monta.
const liveStub = `data:text/javascript,${encodeURIComponent("export function LiveRefresh(props) { globalThis.__learningFake.live.push(props); return null; }")}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./live-refresh" && context.parentURL?.includes("/components/learning/")) return { url: liveStub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const ROOT = new URL("../../../", import.meta.url);
const appFile = (path: string) => pathToFileURL(new URL(path, ROOT).pathname).href;
const { ProgramOverview } = await import("../../components/learning/program-overview.tsx");
const home = (await import(appFile("src/app/(dashboard)/dashboard/[workspaceId]/learning/page.tsx"))) as { default: (props: unknown) => Promise<unknown> };
const progress = (await import(appFile("src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/progress/route.ts"))) as { GET: (request: unknown) => unknown };
const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const WS = "00000000-0000-4000-8000-0000000000f1";
const PROGRAM = "00000000-0000-4000-8000-0000000000a1";
const BASE = `/dashboard/${WS}/learning/${PROGRAM}`;
const START = Date.parse("2026-11-23T13:30:00.000Z");
const END = Date.parse("2026-11-23T15:30:00.000Z");
const MIN = 60_000;
const T = LEARNING_TEXT.course;

const scheduled = { state: "scheduled", readAccess: true, writeAccess: false, opensAt: new Date(START + 30 * MIN).toISOString(), reason: "Si apre durante la lezione." };
const available = { state: "available", readAccess: true, writeAccess: true, opensAt: new Date(START + 30 * MIN).toISOString(), reason: null };
type Act = Record<string, unknown>;
function act(id: string, o: Act = {}): Act {
  return { id, title: `Esercizio ${id}`, kind: "knowledge_check", purpose: "post_module", estimatedMinutes: 10, required: true, opensAfterMinutes: 30, status: "scheduled", attemptId: null, attemptNumber: null, attemptTitle: null, result: null, availability: scheduled, ...o };
}
function program(o: { now: number; activities?: Act[]; participant?: boolean; manage?: boolean; history?: Act[]; status?: string; sessionStatus?: string; materials?: Act[] }) {
  const participant = o.participant ?? true;
  const session = { cohortId: "c1", moduleId: "m1", startsAt: new Date(START).toISOString(), endsAt: new Date(END).toISOString(), status: o.sessionStatus ?? "scheduled" };
  return {
    id: PROGRAM, title: "Corso di prova", version: "1", status: o.status ?? "published", cohortId: participant ? "c1" : null,
    canParticipate: participant, canReview: !participant, canAggregate: !participant, canExport: false, canManage: !!o.manage,
    visibilityPolicy: "Le risposte le vede chi tiene il corso, per aiutarti.", retentionDays: 90, now: o.now,
    materials: o.materials ?? [
      { id: "mat1", moduleId: null, title: "Cartella degli esercizi", description: "1. Scarica il file\n2. Aprilo", kind: "exercise_files", downloadBefore: true, availableAfterSession: false, fileName: "esercizi.zip", mimeType: "application/zip", sizeBytes: 2_200_000, sortOrder: 0, forTrainers: false, access: { visible: true, downloadable: true, reason: null }, href: "/api/learning/materials/mat1" },
    ],
    ownSession: participant ? session : null,
    modules: [
      {
        id: "m1", title: "Modulo 1", subtitle: "Le basi", objective: "Usare l'AI nel lavoro di ogni giorno.", durationMinutes: 120,
        agenda: [{ from_minute: 0, to_minute: 30, title: "Apertura" }, { from_minute: 30, to_minute: 78, title: "Esercizio guidato" }, { from_minute: 78, to_minute: 120, title: "Il caso" }],
        takeaways: ["Rileggere sempre la bozza"], nextSteps: ["Provare con un documento vero"],
        completion: { required: 2, submitted: 0, status: "not_started", outcome: null }, completionStatus: "not_started", learningOutcome: null, status: "published",
        activities: o.activities ?? [act("a", { title: "Ripasso", purpose: "formative", required: false }), act("b", { title: "Il caso" }), act("c", { title: "La verifica" })],
      },
      { id: "m2", title: "Modulo 2", subtitle: "Più avanti", objective: "Automatizzare un processo.", durationMinutes: 120, agenda: [], takeaways: [], nextSteps: [], completion: { required: 0, submitted: 0, status: "not_started", outcome: null }, completionStatus: "not_started", learningOutcome: null, status: "scheduled", activities: [] },
    ],
    sessions: [
      { id: "s1", ...session, assigned: participant, timezone: "Europe/Rome" },
      { id: "s2", moduleId: "m2", cohortId: "c9", assigned: false, startsAt: "2026-11-30T13:30:00.000Z", endsAt: "2026-11-30T15:30:00.000Z", timezone: "Europe/Rome", status: "scheduled" },
    ],
    reviewers: participant ? ["Formatrice Demo · formatrice@cliente.test"] : [],
    history: o.history ?? [],
  };
}

async function page(p: unknown, moduleId?: string, arrival: string | null = null) {
  Object.assign(fake, { program: p, error: null, live: [] });
  return renderToStaticMarkup(await ProgramOverview({ workspaceId: WS, programId: PROGRAM, moduleId, arrival }));
}

function common(html: string) {
  const text = textOf(html);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1, "un solo H1");
  assert.match(html, /<h1 [^>]*>Corso di prova<\/h1>/);
  assert.doesNotMatch(text, /Europe\/Rome|\bIA\b|cohort|Turno c1|\bc1\b|Aggiorna\b|Il mio risultato|Il percorso|Formazione del workspace/, "niente codici, fusi, «IA» né «Aggiorna»");
  assert.deepEqual(findHubForbiddenIn([visibleText(html)], "area").map((m) => m.match), [], "le parole della dashboard");
  return text;
}

test("before the lesson: the lesson line, «Adesso» with «Scarica i materiali» as the only filled button, every fold closed, ~150 words", async () => {
  const html = await page(program({ now: START - 2 * 60 * MIN }));
  const text = common(html);
  assert.ok(text.includes("La tua lezione: lunedì 23 novembre, 14:30–16:30"), text);
  const filled = filledButtons(html);
  assert.equal(filled.length, 1, "un solo pulsante pieno");
  assert.match(filled[0], /href="\/api\/learning\/materials\/mat1"/);
  assert.match(filled[0], /download="esercizi.zip"/, "scarica senza passare dal router");
  assert.ok(text.includes(`${T.now.title} ${T.now.before}`), text);
  assert.ok(text.includes("Scarica il file Aprilo"), "i passi del materiale");
  assert.deepEqual(folds(html), [
    { id: "scaletta", open: false },
    { id: "materiali", open: false },
    { id: "prossimi-moduli", open: false },
    { id: "chi-vede", open: false },
  ]);
  assert.ok(!folds(html).some((fold) => fold.id === "da-portare-a-casa"), "«Da portare a casa» solo dopo la lezione");
  assert.ok(!folds(html).some((fold) => fold.id === "prove"), "nessuna prova: la piega non c'è");
  const words = wordCount(visibleText(html));
  assert.ok(words <= 150, `${words} parole con le pieghe chiuse`);
  assert.equal(fake.live.length, 1, "la pagina aperta il giorno della lezione aspetta l'ora giusta per aggiornarsi");
  assert.equal(fake.live[0].from, START - 15 * MIN);
  // «Esercizi»: una riga per esercizio, lo stato come puntino e parola, nessun link a un esercizio chiuso.
  assert.equal([...html.matchAll(/data-testid="learning-exercise"/g)].length, 3);
  assert.equal([...html.matchAll(/data-slot="status-dot"/g)].length, 3);
  assert.ok(text.includes("Si apre lun 23 nov, 15:00") || text.includes("Si apre alle 15:00"), text);
  assert.doesNotMatch(html, new RegExp(`href="${BASE}/activities/`), "un esercizio non aperto non è un link");
  assert.match(html, new RegExp(`href="${BASE}/ideas"`), "«Dal corso al tuo lavoro» a un tocco");
});

test("in the lesson: «Inizia: {exercise}» is the filled button, the agenda is open with «Siamo qui», the page refreshes itself", async () => {
  const html = await page(program({ now: START + 40 * MIN, activities: [act("a", { title: "Ripasso", purpose: "formative", required: false, status: "available", availability: available }), act("b", { title: "Il caso" }), act("c", { title: "La verifica" })] }));
  const text = common(html);
  const filled = filledButtons(html);
  assert.equal(filled.length, 1);
  assert.match(filled[0], new RegExp(`href="${BASE}/activities/a"`));
  assert.ok(text.includes("Inizia: Ripasso"), text);
  assert.deepEqual(folds(html).find((fold) => fold.id === "scaletta"), { id: "scaletta", open: true }, "in lezione la scaletta è aperta");
  assert.match(html, /aria-current="step"[^>]*>[\s\S]*?15:00–15:48[\s\S]*?Siamo qui/);
  assert.ok(text.includes("Da fare"), "l'esercizio aperto si dice «Da fare»");
  assert.equal(fake.live.length, 1);
  assert.equal(fake.live[0].from, START - 15 * MIN);
  const words = wordCount(visibleText(html));
  assert.ok(words <= 170, `${words} parole con la scaletta aperta`);
});

test("after the lesson: one number, «Rifai» on what needs practice, «Da portare a casa» and «Tutte le prove» closed, no refresh", async () => {
  const done = { status: "submitted", attemptId: "t1", attemptNumber: 1, result: { correct: 5, total: 5, status: "consolidated", essentialErrors: 0 }, availability: available };
  const html = await page(program({
    now: END + 60 * MIN,
    activities: [
      act("a", { title: "Ripasso", purpose: "formative", required: false, ...done, result: { correct: 3, total: 3, status: "formative_completed", essentialErrors: 0 } }),
      act("b", { title: "Il caso", ...done, attemptId: "t2" }),
      act("c", { title: "La verifica", ...done, attemptId: "t3", result: { correct: 2, total: 5, status: "needs_practice", essentialErrors: 1 } }),
    ],
    history: [
      { id: "t1", activityId: "a", activityTitle: "Ripasso", attemptNumber: 1, status: "submitted", submittedAt: null, result: { correct: 3, total: 3, status: "formative_completed", essentialErrors: 0 } },
      { id: "t2", activityId: "b", activityTitle: "Il caso", attemptNumber: 1, status: "submitted", submittedAt: null, result: { correct: 5, total: 5, status: "consolidated", essentialErrors: 0 } },
      { id: "t3", activityId: "c", activityTitle: "La verifica", attemptNumber: 1, status: "submitted", submittedAt: null, result: { correct: 2, total: 5, status: "needs_practice", essentialErrors: 1 } },
    ],
  }));
  const text = common(html);
  assert.match(html, /data-testid="learning-now-line"[^>]*>2 di 2 esercizi fatti</, "un numero solo");
  assert.ok(text.includes("Alcuni punti da ripassare."));
  const filled = filledButtons(html);
  assert.equal(filled.length, 1);
  assert.match(filled[0], new RegExp(`href="${BASE}/attempts/t3"`));
  assert.ok(text.includes("Rifai: La verifica"));
  // Gli esiti solo in «Esercizi»: il numero «2 di 2» una volta, «4/5 giuste» mai.
  assert.equal((text.match(/esercizi fatti/g) ?? []).length, 1, "un solo numero di avanzamento");
  assert.doesNotMatch(text, /\d\/\d giuste|Il tuo risultato|Turno completato/);
  assert.ok(text.includes("Da ripassare 2 di 5 giuste"), text);
  const ids = folds(html).map((fold) => fold.id);
  assert.deepEqual(ids, ["scaletta", "prove", "materiali", "da-portare-a-casa", "prossimi-moduli", "chi-vede"]);
  assert.ok(folds(html).every((fold) => !fold.open), "dopo la lezione tutto chiuso");
  assert.ok(text.includes("Tutte le prove (3)"));
  assert.equal(fake.live.length, 0, "dopo la lezione la pagina non si aggiorna da sola");
});

test("whoever runs the course: no «Adesso», «Risultati» filled and «Gestisci» bordered, no privacy fold, rows without links", async () => {
  const trainerMaterial = { id: "mat2", moduleId: "m1", title: "Note di regia", description: null, kind: "document", downloadBefore: false, availableAfterSession: false, fileName: "regia.pdf", mimeType: "application/pdf", sizeBytes: 1000, sortOrder: 1, forTrainers: true, access: { visible: true, downloadable: true, reason: null }, href: "/api/learning/materials/mat2" };
  const html = await page(program({ now: START + 40 * MIN, participant: false, manage: true, materials: [trainerMaterial] }));
  const text = common(html);
  assert.doesNotMatch(html, /data-testid="learning-now"/);
  const filled = filledButtons(html);
  assert.equal(filled.length, 1);
  assert.match(filled[0], new RegExp(`href="${BASE}/results"`));
  assert.match(html, new RegExp(`<a[^>]*href="${BASE}/admin"[^>]*>`), "«Gestisci» bordato");
  assert.ok(text.includes(T.trainerLine));
  assert.ok(!folds(html).some((fold) => fold.id === "chi-vede"), "«Chi vede le tue risposte» solo per chi segue il corso");
  assert.ok(folds(html).some((fold) => fold.id === "da-portare-a-casa"));
  assert.ok(text.includes("solo per chi tiene il corso"));
  assert.ok(text.includes("30 min"), "la scaletta in minuti, senza una lezione");
  assert.doesNotMatch(html, new RegExp(`href="${BASE}/(activities|attempts)/`));
  assert.equal(fake.live.length, 0);
});

test("a participant who also runs the course keeps «Risultati» and «Gestisci» one tap away, bordered; «Adesso» keeps the filled button", async () => {
  const html = await page({ ...program({ now: START + 40 * MIN, activities: [act("a", { title: "Ripasso", purpose: "formative", required: false, status: "available", availability: available })] }), canAggregate: true, canManage: true });
  const filled = filledButtons(html);
  assert.equal(filled.length, 1);
  assert.match(filled[0], new RegExp(`href="${BASE}/activities/a"`));
  assert.match(html, new RegExp(`<a [^>]*href="${BASE}/results"`));
  assert.match(html, new RegExp(`<a [^>]*href="${BASE}/admin"`));
});

test("the lesson address (/m2) opens «Prossimi moduli»; the arrival from a link says how the enrolment went", async () => {
  const html = await page(program({ now: START - 2 * 60 * MIN }), "m2", "Iscrizione fatta: il corso è qui sotto.");
  assert.deepEqual(folds(html).find((fold) => fold.id === "prossimi-moduli"), { id: "prossimi-moduli", open: true });
  assert.match(html, /data-testid="join-arrival"[^>]*>Iscrizione fatta: il corso è qui sotto\.</);
  assert.ok(textOf(html).includes("lunedì 30 novembre, 14:30–16:30"), "le date degli altri moduli nella piega");
  const m1 = await page(program({ now: START - 2 * 60 * MIN }), "m1");
  assert.ok(folds(m1).every((fold) => !fold.open));
});

test("a closed course: the sentence, no filled button", async () => {
  const html = await page(program({ now: END + MIN, status: "closed" }));
  assert.equal(filledButtons(html).length, 0);
  assert.ok(textOf(html).includes(T.now.closed));
});

test("the entrance: one course and nothing to manage goes straight in (307); several courses are rows with «Prossima lezione»", async () => {
  const learner = { canParticipate: true, canReview: false, canAggregate: false, canExport: false, canManage: false };
  Object.assign(fake, { error: null, home: { enabled: true, programs: [{ id: PROGRAM, title: "Corso di prova", ...learner }] }, catalog: { userId: "u", canCreate: false, canManage: false, programs: [] } });
  const thrown = await home.default({ params: Promise.resolve({ workspaceId: WS }) }).then(() => assert.fail("entra nel corso"), (error: unknown) => error);
  const [code, , target, status] = String((thrown as { digest?: unknown }).digest).split(";");
  assert.deepEqual([code, target, status], ["NEXT_REDIRECT", BASE, "307"]);

  const other = "00000000-0000-4000-8000-0000000000a2";
  fake.programs = { [PROGRAM]: program({ now: START - 60 * MIN }), [other]: { ...program({ now: START - 60 * MIN }), ownSession: null } };
  fake.home = { enabled: true, programs: [{ id: PROGRAM, title: "Corso di prova", ...learner }, { id: other, title: "Secondo corso", ...learner }] };
  const html = renderToStaticMarkup(await home.default({ params: Promise.resolve({ workspaceId: WS }) }));
  const text = textOf(html);
  assert.match(html, /<h1 [^>]*>Formazione<\/h1>/);
  assert.ok(text.includes("Corso di prova Prossima lezione: lun 23 nov, 14:30"), text);
  assert.ok(text.includes("Secondo corso") && !text.includes("Secondo corso Prossima"), "senza lezione, niente riga");
  assert.equal([...html.matchAll(/data-row="learning-course"/g)].length, 2);
  assert.match(html, new RegExp(`href="/dashboard/${WS}/learning/${other}"`));
  assert.equal(filledButtons(html).length, 0);
  assert.doesNotMatch(text, /Gestisci|Registro|Materiali, attività|Turno/);
  fake.programs = {};
});

test("the entrance for whoever manages: one bordered «Gestisci»; with no course, «Gestisci» is the filled step; learning off says so", async () => {
  Object.assign(fake, { error: null, program: program({ now: START, participant: false, manage: true }) });
  fake.home = { enabled: true, programs: [{ id: PROGRAM, title: "Corso di prova", canParticipate: false, canReview: true, canAggregate: true, canExport: false, canManage: true }] };
  fake.catalog = { userId: "u", canCreate: true, canManage: true, programs: [] };
  const html = renderToStaticMarkup(await home.default({ params: Promise.resolve({ workspaceId: WS }) }));
  assert.equal(filledButtons(html).length, 0);
  assert.equal([...html.matchAll(new RegExp(`href="/dashboard/${WS}/learning/admin"`, "g"))].length, 1, "un solo «Gestisci»");
  assert.doesNotMatch(html, /learning\/register/, "il registro si apre da Gestisci");
  fake.home = { enabled: true, programs: [] };
  const empty = renderToStaticMarkup(await home.default({ params: Promise.resolve({ workspaceId: WS }) }));
  assert.equal(filledButtons(empty).length, 1);
  assert.match(filledButtons(empty)[0], /learning\/admin/);
  assert.ok(textOf(empty).includes(LEARNING_TEXT.home.emptyManager));
  fake.catalog = { userId: "u", canCreate: false, canManage: false, programs: [] };
  const none = renderToStaticMarkup(await home.default({ params: Promise.resolve({ workspaceId: WS }) }));
  assert.equal(filledButtons(none).length, 0);
  assert.ok(textOf(none).includes(LEARNING_TEXT.home.empty));
  fake.home = { enabled: false, programs: [] };
  assert.ok(textOf(renderToStaticMarkup(await home.default({ params: Promise.resolve({ workspaceId: WS }) }))).includes(LEARNING_TEXT.home.off));
});

test("«Il mio risultato» is a 308 route to the course on «Tutte le prove», keeping the query; no page left there", () => {
  const thrown = (() => {
    try {
      progress.GET({ nextUrl: new URL(`http://unbundle.test${BASE}/progress?da=email`) });
    } catch (error) {
      return error;
    }
    return assert.fail("reindirizza");
  })();
  const [code, , target, status] = String((thrown as { digest?: unknown }).digest).split(";");
  assert.deepEqual([code, target, status], ["NEXT_REDIRECT", `${BASE}?da=email#prove`, "308"]);
  assert.throws(() => read("src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/progress/page.tsx"), /ENOENT/);
});
