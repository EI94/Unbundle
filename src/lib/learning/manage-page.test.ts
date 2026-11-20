import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { installAppModules } from "../ai/claude-test-kit.ts";
import { enableTsxImports } from "../../components/use-cases/detail/referent/tsx-test-loader.ts";
import { findHubForbiddenIn } from "../use-cases/copy-guard.ts";
import { LEARNING_TEXT } from "./text.ts";
import { filledButtons, textOf, visibleText } from "./render-test-kit.ts";

// (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §3.9, audit Fuori §4.10-§4.11) «Gestisci» reso in
// HTML: quattro schede con il loro indirizzo, un solo pulsante pieno per scheda, «Lezioni» con ingresso, attività e QR
// insieme, niente codici del turno; «Gestisci formazione» con le righe dei corsi, il registro e «Nuovo corso». Le
// operazioni del server sono quelle di prima (provate sul sorgente). Dati inventati.

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

type Fake = { detail: unknown; catalog: unknown };
const fake: Fake = { detail: null, catalog: null };
(globalThis as { __manageFake?: Fake }).__manageFake = fake;

await installAppModules({
  "@/lib/learning/admin": "export async function getLearningAdminDetail() { return globalThis.__manageFake.detail; } export async function getLearningAdminCatalog() { return globalThis.__manageFake.catalog; }",
  "@/lib/learning/admin-client": "export async function learningAdminRequest() { return { ok: true, data: {} }; }",
  "@/lib/learning/server": "export class LearningError extends Error {} export function learningEnabled() { return true; }",
});
await enableTsxImports();
const routerStub = `data:text/javascript,${encodeURIComponent("export function useRouter() { return { push() {}, refresh() {}, replace() {}, back() {}, prefetch() {} }; } export function usePathname() { return '/'; }")}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/navigation" && context.parentURL?.includes("/components/learning/")) return { url: routerStub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const ROOT = new URL("../../../", import.meta.url);
const app = (path: string) => pathToFileURL(new URL(path, ROOT).pathname).href;
const adminPage = (await import(app("src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/admin/page.tsx"))) as { default: (props: unknown) => Promise<unknown> };
const catalogPage = (await import(app("src/app/(dashboard)/dashboard/[workspaceId]/learning/admin/page.tsx"))) as { default: (props: unknown) => Promise<unknown> };
const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const M = LEARNING_TEXT.manage;
const WS = "00000000-0000-4000-8000-0000000000f1";
const PROGRAM = "00000000-0000-4000-8000-0000000000a1";
const H = 60 * 60_000;
const soon = (hours: number) => new Date(Date.now() + hours * H).toISOString();

function detail(o: { links?: unknown[]; manageAll?: boolean; lessonStatus?: string } = {}) {
  return {
    userId: "u1",
    program: { id: PROGRAM, title: "Corso di prova", version: "1", status: "published", featureEnabled: true, visibilityPolicy: "Le risposte le vede chi tiene il corso.", retentionDays: 90, publishedAt: soon(-200), closedAt: null, canManageAll: o.manageAll ?? true, managedCohorts: o.manageAll === false ? ["coorte-a"] : [] },
    members: [{ id: "m9", name: "Persona Nuova", email: "nuova@cliente.test", role: "learner", source: "workspace" }],
    sessions: [
      { id: "s1", moduleId: "m1", cohortId: "coorte-a", startsAt: soon(2), endsAt: soon(4), timezone: "Europe/Rome", status: o.lessonStatus ?? "scheduled" },
      { id: "s2", moduleId: "m1", cohortId: "coorte-b", startsAt: soon(50), endsAt: soon(52), timezone: "Europe/Rome", status: "scheduled" },
      { id: "s3", moduleId: "m2", cohortId: "coorte-m2", startsAt: soon(200), endsAt: soon(202), timezone: "Europe/Rome", status: "scheduled" },
    ],
    enrollments: [
      { id: "e1", userId: "p1", name: "Persona Uno", email: "uno@cliente.test", moduleId: "m1", cohortId: "coorte-a", status: "active", hasWork: true },
      { id: "e2", userId: "p2", name: "Persona Due", email: "due@cliente.test", moduleId: "m1", cohortId: "coorte-a", status: "active", hasWork: false },
    ],
    grants: [{ id: "g1", userId: "u1", name: "Formatrice Demo", email: "formatrice@cliente.test", capability: "review", cohortId: "coorte-a", grantedAt: soon(-100), revokedAt: null }],
    audit: [{ id: "a1", eventType: "join_link_opened", actorName: "Formatrice Demo", resourceId: "x", createdAt: soon(-1), cohortId: "coorte-a" }],
    retention: { eligible: false, purgeAfter: null, attempts: 4, ideaDrafts: 1 },
    materials: [{ id: "mat1", moduleId: "m1", title: "Cartella degli esercizi", description: null, kind: "exercise_files", audience: "learners", downloadBefore: true, availableAfterSession: false, fileName: "esercizi.zip", sizeBytes: 2_200_000, downloads: 1, enrolled: 2 }],
    joinLinks: o.links ?? [],
  };
}
async function admin(data: unknown, scheda?: string) {
  fake.detail = data;
  return renderToStaticMarkup(await adminPage.default({ params: Promise.resolve({ workspaceId: WS, programId: PROGRAM }), searchParams: Promise.resolve(scheda ? { scheda } : {}) }));
}
const noCodes = (html: string) => assert.doesNotMatch(visibleText(html), /coorte-|\bM1\b|\bM2\b|Turni|turno|Europe\/Rome|perimetro|tentativi|\bIA\b/, "niente codici, fusi o gergo");

test("«Lezioni» (the start tab): the course title as H1, the state in a line, «Risultati» bordered, the next lesson's «Crea il link» the only filled button", async () => {
  const html = await admin(detail());
  const text = textOf(html);
  assert.match(html, /<h1 [^>]*>Corso di prova<\/h1>/);
  assert.ok(text.includes("In corso visibile ai partecipanti"), text);
  assert.match(html, new RegExp(`data-testid="admin-results-link"[^>]*class="[^"]*border-border`), "«Risultati» bordato");
  assert.match(html, /aria-label="Altre azioni"/, "il «⋯»");
  assert.deepEqual([...html.matchAll(/data-testid="admin-tab-([a-z]+)"/g)].map((m) => m[1]), ["lezioni", "materiali", "persone", "impostazioni"]);
  assert.match(html, /aria-pressed="true"[^>]*data-testid="admin-tab-lezioni"/);
  const filled = filledButtons(html);
  assert.equal(filled.length, 1, "un solo pulsante pieno");
  assert.match(filled[0], /data-testid="join-link-create"/);
  assert.equal([...html.matchAll(/data-testid="admin-lesson"/g)].length, 2, "una card per lezione del primo modulo");
  assert.ok(text.includes("Attività secondo la scaletta"));
  assert.ok(text.includes(M.lessons.openNow) && text.includes(M.lessons.suspend), "le attività nella stessa card dell'ingresso");
  assert.ok(text.includes("2 iscritti"));
  assert.ok(visibleText(html).includes(M.lessons.otherModules(1)), "gli altri moduli, chiusi");
  noCodes(html);
  assert.deepEqual(findHubForbiddenIn([visibleText(html)], "area").map((m) => m.match), []);
});

test("«Lezioni» with a closed entrance: «Apri l'ingresso» is filled; with it open, nothing is; reopen requests name the lesson", async () => {
  const closed = { id: "l1", cohortId: "coorte-a", label: "aula", maxUses: 30, usedCount: 8, doorOpen: false, expiresAt: soon(20), revokedAt: null, createdAt: soon(-1), joined: 8, reopenRequests: [{ cohortId: "coorte-b", count: 2 }] };
  const html = await admin(detail({ links: [closed, { ...closed, id: "l0", label: null, revokedAt: soon(-2), reopenRequests: [] }] }));
  const filled = filledButtons(html);
  assert.equal(filled.length, 1);
  assert.ok(textOf(html).includes(M.lessons.openDoor));
  assert.match(html, /data-slot="status-dot"[^>]*>[\s\S]*?Ingresso chiuso/);
  assert.ok(textOf(html).includes("8 persone entrate · 22 posti liberi su 30"));
  assert.ok(visibleText(html).includes("Link non più validi (1)"), "i link chiusi in una piega");
  assert.match(textOf(html), /2 persone chiedono di riaprire la sua lezione \(\d+ [a-z]{3} \d{4}, \d\d:\d\d\)/, "la lezione con la data, non il codice");
  noCodes(html);
  const open = await admin(detail({ links: [{ ...closed, doorOpen: true }] }));
  assert.equal(filledButtons(open).length, 0, "ingresso aperto: niente da fare");
  assert.ok(textOf(open).includes(M.lessons.closeDoor));
});

test("«Materiali», «Persone», «Impostazioni»: one filled button each, open from their address", async () => {
  const materials = await admin(detail(), "materiali");
  assert.equal(filledButtons(materials).length, 1);
  assert.ok(textOf(materials).includes("Carica"));
  assert.ok(textOf(materials).includes("modulo 1"), "il modulo in parole");
  noCodes(materials);
  const people = await admin(detail(), "persone");
  const filled = filledButtons(people);
  assert.equal(filled.length, 1, "«Concedi permesso» bordato");
  assert.match(filled[0], /type="submit"/);
  assert.ok(textOf(people).includes("Assegna alle persone selezionate"));
  assert.ok(textOf(people).includes("Lezione del"));
  assert.equal((textOf(people).match(/non invia email/g) ?? []).length, 1, "detto una volta");
  noCodes(people);
  const settings = await admin(detail(), "impostazioni");
  assert.equal(filledButtons(settings).length, 1);
  assert.ok(textOf(settings).includes("Salva impostazioni"));
  assert.match(settings, /<section id="storico" data-slot="fold"(?! data-open)/, "lo storico chiuso");
  assert.match(settings, /<section id="cancellazione" data-slot="fold"(?! data-open)/, "la cancellazione chiusa");
  noCodes(settings);
  const scoped = await admin(detail({ manageAll: false }), "impostazioni");
  assert.equal(filledButtons(scoped).length, 0, "chi gestisce solo alcune lezioni non cambia le impostazioni");
  assert.match(textOf(scoped), /Gestisci solo: \d+ [a-z]{3} \d{4}, \d\d:\d\d\./);
});

test("the console keeps its server operations and its guards", () => {
  const program = read("src/components/learning/admin-program.tsx");
  assert.match(program, /if \(key !== section && confirmLearningNavigation\(open\)\) open\(\);/, "le modifiche non salvate prima di cambiare scheda");
  assert.match(program, /window\.history\.replaceState\(window\.history\.state, "", adminTabHref\(/, "la scheda nell'indirizzo");
  const lessons = read("src/components/learning/admin-join-links.tsx");
  assert.match(lessons, /operation: "joinLink",[\s\S]*idempotencyKey: crypto\.randomUUID\(\)/, "un doppio tocco non crea due link");
  assert.match(lessons, /mutate\(\{ operation: "joinLinkDoor", input: \{ \.\.\.scope, linkId: result\.data\.linkId, doorOpen: false \} \}\)/, "il link nasce con l'ingresso chiuso");
  for (const status of ["open", "scheduled", "closed"]) assert.match(lessons, new RegExp(`mutate\\(\\{ operation: "session", input: \\{ \\.\\.\\.sessionInput, status: "${status}" \\} \\}\\)`));
  assert.match(lessons, /<AdminQrFullscreen/);
  const qr = read("src/components/learning/admin-qr.tsx");
  assert.match(qr, /className="fixed inset-0 z-50/, "a tutto schermo");
  assert.match(qr, /<ResultsToggle checked=\{doorOpen\}/, "con l'interruttore dell'ingresso");
  assert.match(qr, /survey-light rounded-2xl bg-card/, "il margine bianco attorno al QR nei due temi");
});

test("«Gestisci formazione»: course rows, the register as a row, «Nuovo corso» the only filled button", async () => {
  fake.catalog = { userId: "u1", canCreate: true, canManage: true, programs: [
    { id: PROGRAM, title: "Corso di prova", version: "1", status: "published", featureEnabled: true, visibilityPolicy: "x".repeat(20), retentionDays: 90, publishedAt: soon(-10), closedAt: null, canManageAll: true, managedCohorts: [] },
  ] };
  const html = renderToStaticMarkup(await catalogPage.default({ params: Promise.resolve({ workspaceId: WS }) }));
  const text = textOf(html);
  const filled = filledButtons(html);
  assert.equal(filled.length, 1);
  assert.match(filled[0], /data-testid="catalog-new-course"/);
  assert.match(html, new RegExp(`data-row="catalog-course"[^>]*|href="/dashboard/${WS}/learning/${PROGRAM}/admin"`));
  assert.match(html, new RegExp(`href="/dashboard/${WS}/learning/register"`));
  assert.ok(text.includes("Registro della formazione AI"));
  assert.doesNotMatch(text, /AI Readiness|survey|JSON|art\. 4|AI Act|\bIA\b|Gestisci Corso di prova|Versione/);
  assert.equal((text.match(/non invia email/g) ?? []).length, 1);
});
