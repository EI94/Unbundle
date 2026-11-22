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

// (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §3.9, audit Fuori §4.8-§4.9) Risultati resi in HTML,
// con la lettura finta: H1 = il titolo del corso; «In aula» e «Persone»; un numero, «12 su 20 hanno finito»;
// «Presenta in aula» il solo pulsante pieno; «Scarica» e «Gestisci» bordati; le lezioni solo se più d'una; niente
// interruttore né «Aggiorna ora»; il lucchetto solo per chi gestisce; il vecchio `?vista=scarica` apre il pannello.
// I permessi e le soglie restano quelli del server (results.ts e i suoi test). Dati inventati.

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

type Fake = { results: unknown; live: Array<{ from: number; seconds?: number }>; download: Array<Record<string, unknown>> };
const fake: Fake = { results: null, live: [], download: [] };
(globalThis as { __resultsFake?: Fake }).__resultsFake = fake;

await installAppModules({
  "@/lib/learning/server": `export class LearningError extends Error { constructor(code, message) { super(message); this.code = code; } }
  export async function getLearningResults() { return globalThis.__resultsFake.results; }`,
  "@/lib/learning/admin-client": "export async function learningAdminRequest() { return { ok: true, data: {} }; }",
  "@/lib/learning/client": "export async function exportLearningCsv() { return { ok: true, data: { csv: '', filename: 'x.csv' } }; }",
});
await enableTsxImports();
const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const routerStub = stub("export function useRouter() { return { push() {}, refresh() {}, replace() {}, back() {}, prefetch() {} }; } export function usePathname() { return '/'; }");
const liveStub = stub("export function LiveRefresh(props) { globalThis.__resultsFake.live.push(props); return null; }");
// Il pannello vive in un portale, che sul server non si disegna: qui si registra il pulsante con il suo stato.
const downloadStub = stub(`import React from ${JSON.stringify(import.meta.resolve("react"))};
const { createElement } = React;
export const DOWNLOAD_SHEET = "scarica";
export function ResultsDownload(props) { globalThis.__resultsFake.download.push(props); return createElement("button", { "data-slot": "button", className: "border-border", "data-testid": "results-download" }, "Scarica"); }
export function ResultsExportBody() { return createElement("div", { "data-testid": "results-export" }, createElement("button", { "data-slot": "button", className: "bg-primary" }, "Scarica l'elenco")); }`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/navigation" && context.parentURL?.includes("/components/learning/")) return { url: routerStub, shortCircuit: true };
    if (specifier === "@/components/learning/live-refresh") return { url: liveStub, shortCircuit: true };
    if (specifier === "@/components/learning/results-export") return { url: downloadStub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const ROOT = new URL("../../../", import.meta.url);
const resultsPage = (await import(pathToFileURL(new URL("src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/results/page.tsx", ROOT).pathname).href)) as { default: (props: unknown) => Promise<unknown> };
const { ResultsExportBody } = await import("../../components/learning/results-export.tsx");
const react = await import("react");
const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const R = LEARNING_TEXT.results;
const WS = "00000000-0000-4000-8000-0000000000f1";
const PROGRAM = "00000000-0000-4000-8000-0000000000a1";
const BASE = `/dashboard/${WS}/learning/${PROGRAM}`;

function item(n: number) {
  return { id: `q${n}`, prompt: `Domanda inventata numero ${n}?`, critical: n === 1, answered: 12, correct: 9, feedback: "Perché sì.", options: [
    { id: "a", text: "Risposta giusta", count: 9, correct: true },
    { id: "b", text: "Risposta sbagliata", count: 3, correct: false },
  ] };
}
function activity(id: string, title: string, required = true) {
  return { id, title, required, formative: !required, totalItems: 3, started: 14, submitted: 12, visible: true, achieved: required ? 8 : null, averageCorrect: 2.4, items: [item(1), item(2), item(3)] };
}
function results(o: { group?: boolean; individual?: boolean; export?: boolean; manage?: boolean; manageAll?: boolean; cohorts?: number; completed?: number; status?: string } = {}) {
  const cohorts = Array.from({ length: o.cohorts ?? 2 }, (_, index) => ({ id: `c${index + 1}`, startsAt: `2026-11-2${3 + index}T13:30:00.000Z`, endsAt: `2026-11-2${3 + index}T15:30:00.000Z`, status: "scheduled", live: index === 0 }));
  const group = o.group === false ? null : { suppressed: false, minimum: 5, enrolled: 20, started: 14, completed: o.completed ?? 12, achieved: 8, required: 2, leftOutTurns: 0, activities: [activity("a", "Ripasso", false), activity("b", "Il caso"), activity("c", "La verifica")] };
  const individuals = o.individual ? [
    { userId: "u1", name: "Persona Uno", email: "uno@cliente.test", cohortId: "c1", completion: { required: 2, submitted: 2, status: "completed", outcome: "consolidated" }, cells: [
      { activityId: "b", attempts: 1, state: "submitted", attemptId: "t1", result: { correct: 3, total: 3, status: "consolidated", essentialErrors: 0 } },
      { activityId: "c", attempts: 2, state: "submitted", attemptId: "t2", result: { correct: 1, total: 3, status: "needs_practice", essentialErrors: 1 } },
    ] },
  ] : null;
  return {
    program: { id: PROGRAM, title: "Corso di prova", status: o.status ?? "published" }, viewerId: "v1",
    can: { group: o.group !== false, individual: !!o.individual, export: !!o.export, manage: !!o.manage, manageAll: !!o.manageAll },
    cohorts, selectedCohort: "c1", activities: [{ id: "b", title: "Il caso", required: true, formative: false, totalItems: 3 }, { id: "c", title: "La verifica", required: true, formative: false, totalItems: 3 }],
    group, individuals,
  };
}
async function page(data: unknown, query: Record<string, string> = {}) {
  Object.assign(fake, { results: data, live: [], download: [] });
  return renderToStaticMarkup(await resultsPage.default({ params: Promise.resolve({ workspaceId: WS, programId: PROGRAM }), searchParams: Promise.resolve(query) }));
}

test("«In aula»: the course title as H1, one number, «Presenta in aula» the only filled button, folds closed, ~300 words", async () => {
  const html = await page(results({ individual: true, export: true, manage: true, manageAll: true }));
  const text = textOf(html);
  assert.match(html, /<h1 [^>]*>Corso di prova<\/h1>/);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  const filled = filledButtons(html);
  assert.equal(filled.length, 1);
  assert.match(filled[0], /data-testid="present-button"/);
  assert.ok(text.includes(`${R.present}`));
  assert.match(html, /data-slot="big-number-value"[^>]*>12 su 20<\/p>/, "un numero solo");
  assert.ok(text.includes("hanno finito tutti i 2 esercizi da fare"), text);
  assert.deepEqual(folds(html).map((fold) => [fold.id, fold.open]), [["tutti-i-numeri", false], ["esercizio-a", false], ["esercizio-b", false], ["esercizio-c", false]]);
  assert.ok(text.includes("Il caso 12 su 20 hanno consegnato"), "ogni esercizio con la sua riga");
  assert.match(html, /aria-label="Sezioni dei risultati"/);
  assert.ok(visibleText(html).includes("In aula Persone"));
  assert.match(html, /data-testid="results-turns"/, "più lezioni: si sceglie");
  assert.ok(text.includes("Tutte le lezioni"));
  assert.doesNotMatch(text, /Aggiornamento automatico|Aggiorna ora|Risultati di gruppo|Risultati individuali|Turno|Tutti i turni|CSV|registro/i);
  assert.equal(fake.live.length, 1);
  assert.deepEqual(fake.live[0], { from: 0, seconds: 10 }, "si aggiorna da sola ogni 10 secondi, come prima");
  assert.equal(fake.download.length, 1, "«Scarica» in testata");
  assert.match(html, new RegExp(`href="${BASE}/admin"`), "«Gestisci» in testata");
  assert.deepEqual(findHubForbiddenIn([visibleText(html)], "area").map((m) => m.match), []);
  const words = wordCount(visibleText(html));
  assert.ok(words <= 300, `${words} parole con le pieghe chiuse`);
});

test("one lesson only: no lesson chips; nobody finished yet: the number is the enrolled, never a zero", async () => {
  const html = await page(results({ cohorts: 1, completed: 0 }));
  assert.doesNotMatch(html, /data-testid="results-turns"/);
  assert.match(html, /data-slot="big-number-value"[^>]*>20<\/p><p data-slot="big-number-label"[^>]*>Iscritti/);
  assert.doesNotMatch(textOf(html), /\b0 su 20\b/);
});

test("only the group permission and not managing: no tabs, no lock, no «Scarica», no «Gestisci»", async () => {
  const html = await page(results({ cohorts: 1 }));
  assert.doesNotMatch(html, /aria-label="Sezioni dei risultati"/);
  assert.doesNotMatch(html, /data-testid="results-locked"|<svg[^>]*lucide-lock/);
  assert.equal(fake.download.length, 0);
  assert.doesNotMatch(html, new RegExp(`href="${BASE}/admin"`));
  assert.equal(filledButtons(html).length, 1);
});

test("managing without a permission: the tab has the lock and «Attiva per me»; asking for it otherwise falls back", async () => {
  const html = await page(results({ manage: true, manageAll: true, individual: false }), { vista: "individuali" });
  assert.match(html, /data-testid="results-locked"/);
  assert.ok(textOf(html).includes(R.lockedTitle(R.tabs.people)));
  assert.ok(textOf(html).includes(R.grantSelf));
  assert.match(html, /\(serve un permesso\)/, "il lucchetto ha la sua parola");
  const other = await page(results({ cohorts: 1 }), { vista: "individuali" });
  assert.match(other, /data-testid="results-group"/, "chi non gestisce torna alla scheda che vede");
  assert.doesNotMatch(other, /data-testid="results-locked"/);
});

test("«Persone»: with names said once, one number, an icon beside the colour in every cell", async () => {
  const html = await page(results({ individual: true, cohorts: 1 }), { vista: "individuali" });
  const text = textOf(html);
  assert.ok(text.includes(R.withNames));
  assert.doesNotMatch(text, /Vista con i nomi: non proiettarla in aula/);
  assert.match(html, /data-slot="big-number-value"[^>]*>1 su 1<\/p>/);
  assert.match(html, /aria-label="Persona Uno, La verifica: 1 risposte giuste su 3, Da ripassare\. Apri le risposte"[^>]*><svg[^>]*lucide-rotate-ccw/, "l'esito anche con l'icona");
  assert.match(html, new RegExp(`href="${BASE}/manage/t2"`));
  assert.equal(filledButtons(html).length, 0);
});

test("the old «Scarica» tab: ?vista=scarica opens the «Scarica» panel; only-download viewers get the file in the page", async () => {
  await page(results({ individual: true, export: true }), { vista: "scarica" });
  assert.equal(fake.download.length, 1);
  assert.equal(fake.download[0].initialOpen, "scarica");
  assert.equal(fake.download[0].canExport, true);
  await page(results({ individual: true, export: true }), { apri: "scarica" });
  assert.equal(fake.download[0].initialOpen, "scarica");
  const only = await page(results({ group: false, export: true }));
  assert.match(only, /data-testid="results-export"/);
  assert.equal(fake.download.length, 0, "niente pulsante doppio");
  assert.doesNotMatch(only, /aria-label="Sezioni dei risultati"/);
});

test("the «Scarica» panel: one sentence, the columns folded, «Scarica l'elenco», names and the operations history", () => {
  const html = renderToStaticMarkup(react.createElement(ResultsExportBody as never, { workspaceId: WS, programId: PROGRAM } as never));
  const text = visibleText(html);
  assert.ok(text.startsWith(R.downloadText), text);
  assert.ok(text.includes("Le colonne"));
  assert.doesNotMatch(text, /Partecipante/, "le colonne stanno nella piega");
  assert.equal(filledButtons(html).length, 1, "il pieno del pannello");
  assert.ok(textOf(html).includes(R.downloadButton));
  assert.ok(text.includes(R.downloadCare));
  const source = read("src/components/learning/results-export.tsx");
  assert.match(source, /useSheetParam\(\{ initial: initialOpen, accept: acceptDownload \}\)/, "il pannello ha il suo indirizzo, ?apri=scarica");
  assert.match(source, /<ResultsLocked capability="export"/, "chi gestisce senza il permesso trova «Attiva per me» nel pannello");
});

test("the old addresses still open their tab: /live → ?vista=gruppo, /manage → ?vista=individuali", () => {
  assert.match(read("src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/live/page.tsx"), /results\?vista=gruppo`\);/);
  assert.match(read("src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/manage/page.tsx"), /results\?vista=individuali`\);/);
  assert.match(read("src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/manage/[attemptId]/page.tsx"), /back=\{\{ href: resultsHref\(base, "individuali", turno\), label: LEARNING_TEXT\.results\.tabs\.people \}\}/);
});

test("closing the «Scarica» panel goes back one step without blanking the page: a same-page popstate is a soft session check", () => {
  // Il pannello si chiude con `history.back()` (useSheetParam): prima il confine della sessione lo trattava come un ritorno
  // nella cronologia e nascondeva la pagina con «Verifica dell'accesso…».
  const boundary = read("src/components/learning/session-boundary.tsx");
  assert.match(boundary, /const onPopState = \(\) => \{ if \(window\.location\.pathname === pathname\) softRecheck\(\); else recheck\(\); \};/);
  assert.match(boundary, /window\.addEventListener\("popstate", onPopState\);/);
  assert.match(boundary, /window\.removeEventListener\("popstate", onPopState\);/);
  assert.match(boundary, /window\.addEventListener\("pageshow", recheck\);/, "una pagina ripresa dalla cache del browser resta un controllo duro");
  assert.match(boundary, /setState\(\(previous\) => soft && previous\.path === pathname && previous\.phase === "verified" \? previous :/, "il controllo morbido lascia a schermo la pagina verificata");
});
