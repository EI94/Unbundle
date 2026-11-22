import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { installAppModules } from "../ai/claude-test-kit.ts";
import { enableTsxImports } from "../../components/use-cases/detail/referent/tsx-test-loader.ts";
import { findHubForbiddenIn } from "../use-cases/copy-guard.ts";
import { criteriaMap, italianAuthority, legalFramework, limits, notIncluded, privacyGuidance } from "./register-legal.ts";
import { LEARNING_TEXT } from "./text.ts";
import { filledButtons, folds, readable, textOf, visibleText, wordCount } from "./render-test-kit.ts";

// (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §3.9, audit Fuori §4.13) Il «Registro della
// formazione AI» reso in HTML: una frase di stato, «Scarica PDF» il solo pulsante pieno, Excel come link, sette righe
// chiuse (i dati dell'azienda aperti da soli quando mancano), circa 150 parole e niente «IA» a schermo con le pieghe
// chiuse; la norma intera, invariata, nella sua piega. Il contenuto del registro, il PDF e l'Excel non cambiano.

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};
await installAppModules({});
await enableTsxImports();
const routerStub = `data:text/javascript,${encodeURIComponent("export function useRouter() { return { push() {}, refresh() {}, replace() {}, back() {}, prefetch() {} }; } export function usePathname() { return '/'; }")}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/navigation" && context.parentURL?.includes("/components/learning/")) return { url: routerStub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { RegisterConsole } = await import("../../components/learning/register-console.tsx");
const react = await import("react");
const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const G = LEARNING_TEXT.register;
const session = { programId: "p1", programTitle: "Corso di prova", moduleId: "m1", moduleTitle: "Modulo 1", cohortId: "c1", startsAt: "2026-11-23T13:30:00.000Z", endsAt: "2026-11-23T15:30:00.000Z", durationMinutes: 120, state: "svolta", enrolled: 20, participants: 17, manualParticipants: 1, undocumented: 2, article4: "modificato" };
function register(o: { organization?: Record<string, unknown> } = {}) {
  return {
    domain: null,
    provider: { name: "Lateral Space", platform: "Unbundle" },
    organization: { workspaceName: "Cliente Demo", legalName: "Cliente Demo S.r.l.", registerOwner: "Persona Demo, HR", aiActRole: "deployer", aiSystems: ["Claude (Anthropic) — bozze"], useContext: "Uffici", trainers: "Formatrice Demo", otherInitiatives: null, companyNames: {}, settingsUpdatedAt: null, settingsUpdatedBy: null, ...o.organization },
    companies: [],
    withoutCompany: 0,
    needsAssessments: [],
    programs: [{ id: "p1", title: "Corso di prova", contentVersion: "1", packHash: "a".repeat(64), sourceSnapshotSha: "b", publishedAt: "2026-11-01T10:00:00.000Z", status: "published", closedAt: null, retentionDays: 90,
      modules: [{ id: "m1", title: "Modulo 1", subtitle: null, objective: "Usare l'AI.", durationMinutes: 120, agenda: [], competencies: ["Verifica"], exercises: ["La verifica"] }],
      materials: [{ title: "Cartella", fileName: "esercizi.zip", sha256: "c".repeat(64), audience: "learners", moduleId: "m1", createdAt: "2026-11-01T10:00:00.000Z" }] }],
    sessions: [session],
    participants: [
      { key: "k1", userId: "u1", name: "Persona Uno", email: "uno@cliente.test", programId: "p1", programTitle: "Corso di prova", moduleId: "m1", moduleTitle: "Modulo 1", cohortId: "c1", sessionStartsAt: session.startsAt, sessionHeld: true, source: "piattaforma", joinedAt: "2026-11-23T13:35:00.000Z", joinTiming: "durante_la_lezione", joinLabel: "Entrata dal link durante la lezione", required: 2, submitted: 2, status: "esercitazioni_completate", statusLabel: "Ha partecipato", manualEntryId: null, manualNote: null, recordedBy: null, recordedAt: null },
      { key: "k2", userId: null, name: "Persona Due", email: null, programId: "p1", programTitle: "Corso di prova", moduleId: "m1", moduleTitle: "Modulo 1", cohortId: "c1", sessionStartsAt: session.startsAt, sessionHeld: true, source: "registrazione_manuale", joinedAt: null, joinTiming: null, joinLabel: "Registrata dal formatore", required: 2, submitted: 0, status: "presenza_registrata", statusLabel: "Presenza registrata", manualEntryId: "me1", manualNote: "foglio firme", recordedBy: "Formatrice Demo", recordedAt: "2026-11-23T16:00:00.000Z" },
    ],
    corrections: [],
    totals: { people: 20, peopleAttended: 18, peopleUpcoming: 0, participations: 18, allExercises: 17, manualEntries: 1, undocumented: 0, sessionsHeld: 1, hoursDelivered: 2, sessionsScheduled: 0 },
  };
}
const exports = [{ id: "x1", format: "pdf", sha256: "d".repeat(64), sizeBytes: 1000, participantCount: 18, companyDomain: null, generatedAt: "2026-11-23T16:10:00.000Z", generatedBy: "Formatrice Demo" }];
const render = (data: unknown, copies: unknown = exports) => renderToStaticMarkup(react.createElement(RegisterConsole as never, { workspaceId: "w", userId: "u", canEditSettings: true, register: data, exports: copies } as never));

test("one status sentence, «Scarica PDF» the only filled button, Excel as a link, seven closed rows, ~150 words, no «IA» on screen", () => {
  const html = render(register());
  const visible = visibleText(html);
  assert.ok(visible.startsWith("In ordine. 1 lezione svolta · 18 persone · ultima copia 23/11/2026 17:10"), visible);
  const filled = filledButtons(html);
  assert.equal(filled.length, 1, "un solo pulsante pieno");
  assert.match(filled[0], /data-testid="register-pdf"/);
  assert.match(html, /<button type="button" class="[^"]*underline[^"]*"[^>]*data-testid="register-excel">Anche in Excel<\/button>/, "Excel come link");
  assert.deepEqual(folds(html), [
    { id: "partecipanti", open: false },
    { id: "presenze", open: false },
    { id: "lezioni", open: false },
    { id: "dati-azienda", open: false },
    { id: "contenuti", open: false },
    { id: "verifica", open: false },
    { id: "norma", open: false },
  ]);
  const words = wordCount(visible);
  assert.ok(words <= 150, `${words} parole con le righe chiuse (prima circa 2.150)`);
  assert.doesNotMatch(visible, /\bIA\b|AI Act|art\. 4|SHA-256|Deployer/, "il lessico legale sta nella sua piega");
  assert.deepEqual(findHubForbiddenIn([visible], "area").map((m) => m.match), []);
});

test("missing company data: the sentence says how many, links to the row, and the row opens by itself", () => {
  const html = render(register({ organization: { trainers: null, useContext: null } }));
  assert.ok(visibleText(html).startsWith("Mancano 2 dati dell'azienda. Completa"), visibleText(html));
  assert.match(html, /<a [^>]*href="#dati-azienda"[^>]*>Completa<\/a>/);
  assert.deepEqual(folds(html).find((fold) => fold.id === "dati-azienda"), { id: "dati-azienda", open: true });
  assert.equal(filledButtons(html).length, 1, "«Salva i dati dell'azienda» bordato: il pieno resta «Scarica PDF»");
  assert.ok(visibleText(html).includes(G.role), "a schermo «Ruolo nell'uso dell'AI»");
});

test("the law stays whole and unchanged, in its fold; the register's data and the files are not touched", () => {
  const html = render(register());
  const text = readable(textOf(html));
  for (const paragraph of [...legalFramework, ...notIncluded, ...limits, italianAuthority]) assert.ok(text.includes(readable(paragraph)), paragraph.slice(0, 40));
  for (const [key, value] of [...criteriaMap, ...privacyGuidance]) assert.ok(text.includes(readable(key)) && text.includes(readable(value)), key);
  assert.match(html, /Art\. 4 in vigore: Testo modificato \(Reg\. UE 2026\/1744\)/, "la versione dell'art. 4 di ogni lezione, nella sua riga");
  assert.match(html, /<span class="block text-xs text-uc-giallo">\+ (?:<!-- -->)?2(?:<!-- -->)? senza partecipazione documentata<\/span>/);
  assert.ok(text.includes(G.verifyLabel), "la funzione che il PDF nomina, «Verifica un file»");
  assert.ok(text.includes("Storico delle esportazioni (1)"), "l'elenco che il PDF nomina");
  const source = read("src/components/learning/register-console.tsx");
  for (const operation of ["export", "verify", "saveSettings", "addManualEntry", "voidManualEntry"]) assert.ok(source.includes(`operation: "${operation}"`), operation);
  assert.match(read("src/lib/learning/register-export.ts"), /registerTitle|Registro della formazione in materia di intelligenza artificiale/, "il PDF tiene il suo titolo");
});

test("phone: no wide tables, 44 px controls, 16 px fields", () => {
  const source = read("src/components/learning/register-console.tsx");
  assert.doesNotMatch(source, /min-w-\[640px\]|<table\b/, "niente tabelle larghe");
  assert.doesNotMatch(source, /h-auto px-0 text-xs/, "«Annulla questa presenza» non è più un testo minuscolo");
  assert.ok(!/<Input (?![^>]*text-base)[^>]*>/.test(source), "ogni campo a 16 px al telefono");
});
