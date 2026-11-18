import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import type { CommitmentView, FactView, MemoryView as MemoryData, QuestionView } from "../../lib/db/queries/context-memory.ts";
import type { UseCaseContext, UseCaseFact } from "../../lib/db/queries/context-work.ts";

// Le schermate di «Contesto nel lavoro» rese sul server (rilascio 9b, RILASCIO-9b-COSTRUZIONE.md §2.1, §2.3, §2.10): il
// contenuto della piega «Contesto» della scheda e della sezione del dossier, «Da verificare» e la sua riga nella Memoria.
// Router, link, avvisi e azioni sono finti; le regole stanno in view-model.ts, con i loro test: qui si controlla che i
// componenti le usino.

const REACT = import.meta.resolve("react");
const stubActions = (names: string[]) => names.map((name) => `export async function ${name}() { return { ok: true, value: true }; }`).join("\n");
await installAppModules({
  "next/navigation": `export function useRouter() { return { push() {}, refresh() {}, replace() {} }; }
    export function usePathname() { return "/"; }
    export function useSearchParams() { return new URLSearchParams(); }`,
  "next/link": `import React from ${JSON.stringify(REACT)};
    export default function Link({ href, children, prefetch, scroll, replace, ...rest }) { return React.createElement("a", { href: String(href), ...rest }, children); }
    export function useLinkStatus() { return { pending: false }; }`,
  sonner: `export const toast = Object.assign(() => {}, { success() {}, error() {} });`,
  "@/lib/actions/context": stubActions([
    "confirmProposalsAction",
    "editProposalAction",
    "discardProposalsAction",
    "writeFactAction",
    "editFactAction",
    "reconfirmFactAction",
    "retireFactAction",
    "closeCommitmentAction",
    "reopenCommitmentAction",
    "closeQuestionAction",
    "addQuestionAction",
    "removeSourceAction",
    "setDocumentVisibilityAction",
  ]),
  "@/lib/actions/context-work": stubActions(["closeNeedFromCallAction", "dismissNeedLinkAction", "reconfirmFactsAction"]),
  "@/lib/actions/uc-subprocessors": `export async function declareSubprocessorsAction() { return { ok: true, data: null, message: "" }; }`,
});
await enableTsxImports();
const { UseCaseContextView } = await import("./use-case-context.tsx");
const { VerifyView } = await import("./verify-view.tsx");
const { MemoryView } = await import("./memory-view.tsx");

const WS = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-11-18";

/** Il testo visibile, un pezzo per elemento, con le entità decodificate. */
function textOf(html: string): string[] {
  return html
    .split(/<[^>]+>/)
    .map((piece) => piece.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").trim())
    .filter(Boolean);
}
const render = (element: ReactElement) => renderToStaticMarkup(element);

function fact(over: Partial<UseCaseFact> = {}): UseCaseFact {
  return {
    id: "f1",
    version: 1,
    kind: "fatto",
    section: "sistemi",
    statement: "Il gestionale è SAP Business One.",
    basis: "detto",
    visibility: "tutti",
    needsCheck: false,
    sourceKind: "call",
    sourceLabel: "Call 14 nov",
    lastConfirmedOn: "2026-11-14",
    tag: null,
    ...over,
  };
}
const commitment = (over: Partial<CommitmentView> = {}): CommitmentView => ({
  id: "c1",
  version: 1,
  statement: "Inviare l'esportazione delle fatture",
  party: "cliente",
  roleLabel: "Responsabile amministrativo",
  dueOn: "2026-11-30",
  overdue: false,
  visibility: "tutti",
  ...over,
});
const question = (over: Partial<QuestionView> = {}): QuestionView => ({ id: "q1", version: 1, question: "Chi approva gli acquisti sopra soglia?", askWhom: "Direzione acquisti", visibility: "tutti", ...over });

function context(over: Partial<UseCaseContext> = {}): UseCaseContext {
  return {
    facts: [
      fact({ id: "f1", tag: "cambiato", lastConfirmedOn: "2026-11-16" }),
      fact({ id: "f2", section: "regole", statement: "Gli ordini sopra soglia li firma la direzione.", basis: "dedotto", needsCheck: true, visibility: "ls", sourceLabel: "Scritto a mano", lastConfirmedOn: "2026-05-02" }),
      fact({ id: "f3", section: "lavoro", statement: "Gli ordini arrivano via e-mail.", tag: "nuovo", sourceLabel: "Referente 12 nov", lastConfirmedOn: "2026-11-12" }),
    ],
    more: 12,
    novelties: 2,
    commitments: [commitment(), commitment({ id: "c2", party: "nostra", statement: "Rivedere il preventivo", roleLabel: null, dueOn: "2026-11-02", overdue: true, visibility: "ls" })],
    questions: [question()],
    ...over,
  };
}

test("la piega «Contesto»: «Novità», «Che cosa sappiamo» per sezione, «Impegni aperti», «Domande aperte» e «Apri il contesto»", () => {
  const html = render(createElement(UseCaseContextView, { workspaceId: WS, today: TODAY, context: context() }));
  const text = textOf(html);
  const headings = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ["Novità", "Che cosa sappiamo", "Impegni aperti", "Domande aperte"]);
  // «Novità»: il segno davanti, i più recenti prima.
  const novelties = html.slice(html.indexOf("Novità"), html.indexOf("Che cosa sappiamo"));
  assert.deepEqual(textOf(novelties).slice(1), ["Cambiato", "Il gestionale è SAP Business One.", "Nuovo", "Gli ordini arrivano via e-mail."]);
  // Le sezioni nell'ordine fisso, la fonte a destra, i segni solo dove servono, «e altri 12 nel contesto».
  const subheadings = [...html.matchAll(/<h4[^>]*>([^<]+)<\/h4>/g)].map((m) => m[1]);
  assert.deepEqual(subheadings, ["Come lavorano", "Sistemi e dati", "Regole e vincoli", "Nostri", "Del cliente"]);
  assert.ok(text.includes("Call 14 nov") && text.includes("Referente 12 nov") && text.includes("Scritto a mano"));
  assert.ok(text.includes("dedotto") && text.includes("da verificare") && text.includes("Solo Lateral Space"));
  assert.ok(text.includes("e altri 12 nel contesto"));
  // Gli impegni: per parte, con il ruolo e la scadenza; le domande con a chi chiederle.
  assert.ok(text.includes("Responsabile amministrativo") && text.includes("entro il 30 nov") && text.includes("scaduto il 2 nov"));
  assert.ok(text.includes("Da chiedere a: Direzione acquisti"));
  assert.match(html, new RegExp(`<a href="/dashboard/${WS}/contesto"[^>]*>Apri il contesto`));
  // Si legge e basta: nessun pulsante d'azione («Fatto», «Chiusa», «Modifica»).
  for (const action of ["Fatto", "Chiusa", "Modifica", "Ancora vero", "Non più vero"]) assert.equal(text.includes(action), false, action);
  assert.doesNotMatch(html, /data-slot="button"/);
});

test("la piega «Contesto» senza novità, impegni o domande: i blocchi vuoti non ci sono; un fatto apre il pannello", () => {
  const html = render(createElement(UseCaseContextView, { workspaceId: WS, today: TODAY, context: context({ facts: [fact()], more: 0, novelties: 0, commitments: [], questions: [] }) }));
  const headings = [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ["Che cosa sappiamo"]);
  assert.equal(textOf(html).some((t) => t.startsWith("e altri") || t === "e un altro nel contesto"), false);
  // Il fatto è un pulsante che apre il pannello (un tocco da 44 px sul telefono).
  assert.match(html, /<button type="button" class="[^"]*\bmin-h-11\b[^"]*">/);
  // Gli id dei titoli non si ripetono tra due pieghe sulla stessa pagina.
  const twice = render(createElement("div", null, createElement(UseCaseContextView, { workspaceId: WS, today: TODAY, context: context() }), createElement(UseCaseContextView, { workspaceId: WS, today: TODAY, context: context() })));
  const ids = [...twice.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "nessun id doppio");
});

test("la sezione «Contesto» del dossier senza fatti, impegni e domande: una riga che lo dice e «Apri il contesto»; con un fatto la riga non c'è", () => {
  const html = render(createElement(UseCaseContextView, { workspaceId: WS, today: TODAY, context: context({ facts: [], more: 0, novelties: 0, commitments: [], questions: [] }) }));
  assert.deepEqual(textOf(html), ["Ancora niente nella memoria del cliente per questo use case.", "Apri il contesto"]);
  assert.match(html, new RegExp(`<a href="/dashboard/${WS}/contesto"[^>]*>Apri il contesto`));
  const full = render(createElement(UseCaseContextView, { workspaceId: WS, today: TODAY, context: context() }));
  assert.equal(textOf(full).includes("Ancora niente nella memoria del cliente per questo use case."), false);
  // Solo domande aperte: c'è qualcosa da mostrare, la riga non c'è.
  const questionsOnly = render(createElement(UseCaseContextView, { workspaceId: WS, today: TODAY, context: context({ facts: [], more: 0, novelties: 0, commitments: [] }) }));
  assert.equal(textOf(questionsOnly).includes("Ancora niente nella memoria del cliente per questo use case."), false);
});

// ─── «Da verificare» ─────────────────────────────────────────────────

const stale = (over: Partial<FactView> = {}): FactView => ({
  id: "s1",
  version: 2,
  kind: "fatto",
  section: "sistemi",
  statement: "Il magazzino si chiude il venerdì.",
  basis: "detto",
  visibility: "tutti",
  needsCheck: true,
  sourceKind: "call",
  sourceLabel: "Call 14 nov 2025",
  lastConfirmedOn: "2026-05-14",
  ...over,
});

test("«Da verificare»: «← Contesto», il titolo, la domanda; ogni riga con la casella non spuntata, la fonte e l'ultima conferma, «Non più vero»; «Ancora veri (0)» spento", () => {
  const facts = [stale(), stale({ id: "s2", statement: "I prezzi li firma la direzione.", visibility: "ls", sourceLabel: "Scritto a mano", lastConfirmedOn: "2026-04-30" })];
  const html = render(createElement(VerifyView, { workspaceId: WS, today: TODAY, facts }));
  const text = textOf(html);
  assert.match(html, new RegExp(`<a href="/dashboard/${WS}/contesto"[^>]*>(<[^>]+>)*Contesto</a>`));
  assert.ok(text.includes("Da verificare") && text.includes("Questi fatti non sono stati riconfermati da più di 6 mesi. Sono ancora veri?"));
  assert.ok(text.includes("Call 14 nov 2025 · Ultima conferma: 14 mag") && text.includes("Scritto a mano · Ultima conferma: 30 apr"));
  assert.ok(text.includes("Solo Lateral Space"), "il lucchetto sul fatto «Solo Lateral Space»");
  assert.equal(text.filter((t) => t === "Non più vero").length, 2);
  // Nessuna casella spuntata all'inizio.
  const checkboxes = [...html.matchAll(/<(?:button|span)[^>]*role="checkbox"[^>]*>/g)].map((m) => m[0]);
  assert.equal(checkboxes.length, 2);
  assert.equal(checkboxes.filter((tag) => /aria-checked="true"/.test(tag)).length, 0, "nessuna casella spuntata all'inizio");
  // Un solo pulsante pieno: «Ancora veri (0)», spento finché non si spunta un fatto, fisso in fondo.
  assert.match(html, /<button[^>]*disabled=""[^>]*>Ancora veri \(0\)<\/button>/);
  const filled = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].filter(([, attrs]) => /\bbg-primary\b/.test(attrs)).map(([, , body]) => body.replace(/<[^>]+>/g, ""));
  assert.deepEqual(filled, ["Ancora veri (0)"]);
  assert.match(html, /class="sticky bottom-0[^"]*pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
});

test("«Da verificare» vuota: «Niente da verificare.» e «Torna alla memoria», nessun pulsante pieno", () => {
  const html = render(createElement(VerifyView, { workspaceId: WS, today: TODAY, facts: [] }));
  const text = textOf(html);
  assert.ok(text.includes("Niente da verificare.") && text.includes("Torna alla memoria"));
  assert.equal(text.some((t) => t.startsWith("Ancora veri")), false);
  assert.equal(text.includes("Questi fatti non sono stati riconfermati da più di 6 mesi. Sono ancora veri?"), false);
});

function memory(toCheck: number): MemoryData {
  return {
    sections: [{ section: "sistemi", live: [], facts: [stale()] }],
    nextSteps: { nostri: [], cliente: [] },
    questions: [],
    brief: null,
    novelties: null,
    counts: { facts: 1, openProposals: 0, unreadSources: 0, pendingSourceIds: [], toCheck },
  };
}
const memoryProps = (over: Record<string, unknown>) => ({ workspaceId: WS, today: TODAY, lateralSpace: true, canEditMemory: true, memory: memory(3), useCaseOptions: [], consentNotice: null, ...over });

test("la Memoria: «3 fatti da verificare» con «Apri» per Lateral Space; niente per il cliente e niente senza fatti da verificare", () => {
  const ls = render(createElement(MemoryView, memoryProps({})));
  assert.ok(textOf(ls).includes("3 fatti da verificare"));
  assert.match(ls, new RegExp(`<a href="/dashboard/${WS}/contesto/verifica"[^>]*>Apri`));
  const one = textOf(render(createElement(MemoryView, memoryProps({ memory: memory(1) }))));
  assert.ok(one.includes("1 fatto da verificare"));
  const none = render(createElement(MemoryView, memoryProps({ memory: memory(0) })));
  assert.doesNotMatch(none, /contesto\/verifica/);
  const client = render(createElement(MemoryView, memoryProps({ lateralSpace: false, canEditMemory: false })));
  assert.doesNotMatch(client, /contesto\/verifica|da verificare<\/span><a/);
  assert.equal(textOf(client).includes("3 fatti da verificare"), false);
});
