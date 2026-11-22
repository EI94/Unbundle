import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { installAppModules } from "../ai/claude-test-kit.ts";
import { enableTsxImports } from "../../components/use-cases/detail/referent/tsx-test-loader.ts";
import { LEARNING_TEXT } from "./text.ts";
import { filledButtons, textOf, visibleText } from "./render-test-kit.ts";

// (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §3.9, audit Fuori §4.3-§4.4) L'esercizio reso in
// HTML: la barra fissa «N di M · Invia» come solo pulsante pieno, «Riprova l'esercizio» pieno con «Da ripassare», «Torna
// al corso» pieno quando non c'è da ripassare, niente riga sulla privacy in ogni fase; la pagina dell'esercizio non
// ancora aperto con una frase, il controllo da solo e un solo ritorno. Le regole di salvataggio e invio restano quelle
// (provate sul sorgente qui sotto). Dati inventati.

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

type Fake = { activity: unknown; live: Array<{ from: number }> };
const fake: Fake = { activity: null, live: [] };
(globalThis as { __exerciseFake?: Fake }).__exerciseFake = fake;

await installAppModules({
  "@/lib/learning/server": `export class LearningError extends Error { constructor(code, message) { super(message); this.code = code; } }
  export async function getLearningActivity() { return globalThis.__exerciseFake.activity; }`,
  "@/lib/learning/client": `export async function startLearningAttempt() {} export async function saveLearningDraft() {} export async function submitLearningAttempt() {}
  export async function submitLearningDecisions() {} export async function startLearningRetake() {}`,
});
await enableTsxImports();
const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const routerStub = stub("export function useRouter() { return { push() {}, refresh() {}, replace() {}, back() {}, prefetch() {} }; } export function usePathname() { return '/'; }");
const liveStub = stub("export function LiveRefresh(props) { globalThis.__exerciseFake.live.push(props); return null; }");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/components/learning/")) {
      if (specifier === "next/navigation") return { url: routerStub, shortCircuit: true };
    }
    if (specifier === "@/components/learning/live-refresh") return { url: liveStub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const ROOT = new URL("../../../", import.meta.url);
const { ActivityPlayer } = await import("../../components/learning/activity-player.tsx");
const activityPage = (await import(pathToFileURL(new URL("src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/activities/[activityId]/page.tsx", ROOT).pathname).href)) as { default: (props: unknown) => Promise<unknown> };
const react = await import("react");
const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const X = LEARNING_TEXT.exercise;
const WS = "00000000-0000-4000-8000-0000000000f1";
const PROGRAM = "00000000-0000-4000-8000-0000000000a1";
const BASE = `/dashboard/${WS}/learning/${PROGRAM}`;

const activity = {
  id: "m1-check", moduleId: "m1", title: "La verifica", type: "knowledge_check", purpose: "post_module", aiAssistance: "not_allowed", estimatedMinutes: 10,
  completionGate: true, passMinCorrect: 2, requiresCriticalCorrect: false, allowedModes: [], requiredTextFields: [],
  items: [
    { id: "q1", prompt: "Che cosa controlli per primo?", options: [{ id: "o1", text: "Le fonti" }, { id: "o2", text: "Il tono" }] },
    { id: "q2", prompt: "Quando chiedi aiuto?", options: [{ id: "o3", text: "Subito" }, { id: "o4", text: "Mai" }] },
    { id: "q3", prompt: "Che cosa non incolli?", options: [{ id: "o5", text: "Dati personali" }, { id: "o6", text: "Un titolo" }] },
  ],
  case: null,
};
function attempt(o: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-0000000000b1", userId: "u1", activityId: activity.id, attemptNumber: 1, parentAttemptId: null, status: "draft", revision: 2,
    responses: { answers: { q1: "o1" }, fields: {} }, savedAt: "2026-11-23T14:10:00.000Z", submittedAt: null, decisionsSubmittedAt: null, result: null,
    activity, version: "1", contentVersion: "1", caseExample: null, answerKey: null, writeAccess: true, readOnlyReason: null, canRetake: false, retakeUnavailableReason: null,
    ...o,
  };
}
const player = (initialAttempt: unknown) =>
  renderToStaticMarkup(react.createElement(ActivityPlayer as never, { workspaceId: WS, programId: PROGRAM, userId: "u1", version: "1", activity, initialAttempt } as never));

test("answering: the fixed bar with one number and «Invia», the only filled button; no review page, no privacy line", () => {
  const html = player(attempt());
  const filled = filledButtons(html);
  assert.equal(filled.length, 1, "un solo pulsante pieno");
  assert.match(filled[0], /data-testid="learning-submit"/);
  assert.match(html, /data-slot="exercise-bar" class="sticky bottom-0/, "la barra resta in fondo mentre si scorre");
  assert.match(html, /data-testid="learning-progress"[^>]*><span class="sr-only">Parti completate: <\/span>1 di 3<\/p>/);
  const text = visibleText(html);
  assert.ok(text.includes("1 di 3 Salvato Invia"), text);
  assert.doesNotMatch(text, /Hai risposto a|Controlla e invia|Le tue risposte le vedi tu|Torna al percorso/);
  assert.equal([...html.matchAll(/data-testid="learning-question"/g)].length, 3);
});

test("the result, to review: «Riprova l'esercizio» is filled and «Torna al corso» bordered; the outcome once (no pills)", () => {
  const result = { correct: 1, total: 3, status: "needs_practice", essential_errors: [], items: [
    { itemId: "q1", selectedOptionId: "o1", correct: true, critical: false, feedback: "Bene.", evidence: [] },
    { itemId: "q2", selectedOptionId: "o4", correct: false, critical: false, feedback: "Meglio chiedere subito.", evidence: [] },
    { itemId: "q3", selectedOptionId: "o6", correct: false, critical: true, feedback: "I dati personali restano fuori.", evidence: [] },
  ] };
  const html = player(attempt({ status: "submitted", submittedAt: "2026-11-23T14:20:00.000Z", result, writeAccess: false, canRetake: true, readOnlyReason: "Queste risposte sono già state inviate e non si possono più cambiare." }));
  const filled = filledButtons(html);
  assert.equal(filled.length, 1);
  assert.match(filled[0], /data-testid="learning-retake"/);
  assert.ok(textOf(html).includes(X.retake));
  assert.match(html, new RegExp(`<a [^>]*class="[^"]*border-border[^"]*"[^>]*href="${BASE}"|<a [^>]*href="${BASE}"[^>]*class="[^"]*border-border`), "«Torna al corso» bordato");
  assert.doesNotMatch(html, /aria-label="Domanda per domanda"/, "le pastiglie se ne vanno: l'esito per domanda è nell'elenco");
  assert.equal([...html.matchAll(/data-testid="learning-result-item"/g)].length, 3);
  assert.doesNotMatch(visibleText(html), /Le tue risposte le vedi tu/);
});

test("the result, achieved: «Torna al corso» is the filled button, no retake offered", () => {
  const result = { correct: 3, total: 3, status: "consolidated", essential_errors: [], items: activity.items.map((item) => ({ itemId: item.id, selectedOptionId: item.options[0].id, correct: true, critical: false, feedback: "", evidence: [] })) };
  const html = player(attempt({ status: "submitted", submittedAt: "2026-11-23T14:20:00.000Z", result, writeAccess: false, canRetake: true }));
  const filled = filledButtons(html);
  assert.equal(filled.length, 1);
  assert.match(filled[0], new RegExp(`href="${BASE}"`));
  assert.ok(!textOf(html).includes(X.retake));
});

test("before starting: «Inizia» is the filled button", () => {
  const html = player(null);
  const filled = filledButtons(html);
  assert.equal(filled.length, 1);
  assert.match(filled[0], /data-testid="learning-activity-start"/);
});

test("the exercise not open yet: one sentence, one way back, and it checks by itself", async () => {
  const opens = Date.now() + 30 * 60_000;
  fake.activity = { userId: "u1", program: { id: PROGRAM, title: "Corso di prova", version: "1" }, activityTitle: "La verifica", availability: { state: "scheduled", readAccess: true, writeAccess: false, opensAt: new Date(opens).toISOString(), reason: "x" }, activity: null, attempt: null, history: [] };
  fake.live = [];
  const html = renderToStaticMarkup(await activityPage.default({ params: Promise.resolve({ workspaceId: WS, programId: PROGRAM, activityId: "m1-check" }) }));
  const text = visibleText(html);
  assert.match(text, /La verifica Si apre (alle \d\d:\d\d|[a-z]{3} \d+ [a-z]{3}, \d\d:\d\d), quando chi tiene il corso dà il via\./, text);
  assert.equal([...html.matchAll(new RegExp(`href="${BASE}"`, "g"))].length, 1, "un solo ritorno al corso");
  assert.doesNotMatch(text, /Aggiorna|premi|Per ora non è aperta/);
  assert.equal(filledButtons(html).length, 0);
  assert.equal(fake.live.length, 1, "si controlla da solo");
  assert.equal(fake.live[0].from, opens - 2 * 60 * 60_000);
});

test("saving and sending keep their rules: autosave, the check before sending, one idempotency key, the confirmation in the app's dialog", () => {
  const source = read("src/components/learning/activity-player.tsx");
  assert.match(source, /const timer = setTimeout\(\(\) => \{ void save\(\); \}, 900\);/, "il salvataggio da solo");
  assert.match(source, /if \(await save\(\)\) setReviewing\(true\);/, "prima si salva, poi si chiede conferma");
  assert.match(source, /submitKey\.current \?\?= crypto\.randomUUID\(\);/, "una sola chiave per un invio");
  assert.match(source, /if \(!attempt \|\| readOnly \|\| inFlight\.current \|\| edits\.current !== acknowledged\.current\) return;/, "si invia solo ciò che è salvato");
  assert.match(source, /<ConfirmDialog\s+open=\{reviewing\}/);
  assert.match(source, /onConfirm=\{\(\) => \{ void submit\(\); \}\}/);
  assert.doesNotMatch(source, /window\.(confirm|prompt|alert)\(/);
  // Un problema: una frase, «Riprova» bordato, il resto in «Altre opzioni»; la copia leggibile.
  assert.match(source, /<span>\{problemSentence\(problem, message\)\}<\/span>/);
  assert.match(source, /<Button variant="outline" className="min-h-11 sm:min-h-9" onClick=\{retry\}/);
  assert.match(source, /downloadLearningDraft\("le-mie-risposte\.txt", readableDraft\(active, current\.current, modeTitle\)\)/);
});
