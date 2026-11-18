import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import type { CommitmentView, QuestionView } from "../../lib/db/queries/context-memory.ts";
import type { UseCaseContext, UseCaseFact } from "../../lib/db/queries/context-work.ts";

// Le schermate di «Contesto nel lavoro» rese sul server (rilascio 9b, RILASCIO-9b-COSTRUZIONE.md §2.1, §2.3): il contenuto
// della piega «Contesto» della scheda e della sezione del dossier. Router, link, avvisi e azioni sono finti; le regole
// stanno in view-model.ts, con i loro test: qui si controlla che il componente le usi.

const REACT = import.meta.resolve("react");
await installAppModules({
  "next/navigation": `export function useRouter() { return { push() {}, refresh() {}, replace() {} }; }
    export function usePathname() { return "/"; }
    export function useSearchParams() { return new URLSearchParams(); }`,
  "next/link": `import React from ${JSON.stringify(REACT)};
    export default function Link({ href, children, prefetch, scroll, replace, ...rest }) { return React.createElement("a", { href: String(href), ...rest }, children); }
    export function useLinkStatus() { return { pending: false }; }`,
  sonner: `export const toast = Object.assign(() => {}, { success() {}, error() {} });`,
  "@/lib/actions/context": ["writeFactAction", "editFactAction", "reconfirmFactAction", "retireFactAction"]
    .map((name) => `export async function ${name}() { return { ok: true, value: true }; }`)
    .join("\n"),
});
await enableTsxImports();
const { UseCaseContextView } = await import("./use-case-context.tsx");

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
