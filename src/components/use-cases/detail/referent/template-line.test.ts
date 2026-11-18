import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import type { NeedReferentView, NeedTemplateView } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_ASSIGN_TEXT, REFERENT_UI_TEXT } from "../../../../lib/use-cases/referent/labels.ts";
import { needReferentRows } from "./need-referent-view.ts";
import { enableTsxImports } from "./tsx-test-loader.ts";

// («File da compilare») Dalla scheda: «Aggiungi un file da compilare» accanto ad «Allega un file», la riga «Da compilare:
// {nome} · Sostituisci · Togli» sotto l'esigenza e «con file da compilare» nell'anteprima di «Chiedi al referente». Resa
// in HTML; le azioni del server non servono (moduli vuoti al loro posto). Dati inventati.

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};
const T = REFERENT_UI_TEXT;
const WS = "11111111-0000-4000-8000-000000000001";
const UC = "22222222-0000-4000-8000-000000000001";
const NEED = "55555555-0000-4000-8000-00000000000a";
const FILE = "66666666-0000-4000-8000-000000000001";

let sectionNeeds: typeof import("../section-needs.tsx");
let block: typeof import("./need-referent-block.tsx");
let preview: typeof import("./ask-preview.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let h: (type: unknown, props: unknown) => unknown;

/** Un modulo vuoto con gli stessi nomi delle azioni del server: qui non si chiamano. */
function stubOf(path: string): string {
  const names = [...readFileSync(new URL(path, import.meta.url), "utf8").matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
  return `data:text/javascript,${encodeURIComponent(names.map((name) => `export async function ${name}() { throw new Error("non in questa prova"); }`).join("\n"))}`;
}

before(async () => {
  await enableTsxImports();
  const stubs: Record<string, string> = {
    "@/lib/actions/use-case-referents": stubOf("../../../../lib/actions/use-case-referents.ts"),
    "@/lib/actions/use-case-needs": stubOf("../../../../lib/actions/use-case-needs.ts"),
    // (Rilascio 9b) «Chiudi con questo» e «Non risponde» sotto una richiesta di «Cosa serve».
    "@/lib/actions/context-work": stubOf("../../../../lib/actions/context-work.ts"),
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const stub = stubs[specifier];
      return stub ? { url: stub, shortCircuit: true } : nextResolve(specifier, context);
    },
  });
  sectionNeeds = await import("../section-needs.tsx");
  block = await import("./need-referent-block.tsx");
  preview = await import("./ask-preview.tsx");
  const react = await import("react");
  h = (type, props) => react.createElement(type as never, props as never);
  const server = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  // I pulsanti della riga rileggono la pagina con il router dell'app: qui uno che non fa niente.
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as { AppRouterContext: import("react").Context<object | null> };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  renderToStaticMarkup = (element) => server.renderToStaticMarkup(react.createElement(AppRouterContext.Provider, { value: router }, element as never));
});

const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

test("«Aggiungi un file da compilare» accanto ad «Allega un file», solo su un'esigenza che lo accetta e per chi modifica", () => {
  const labels = (o: { canEdit: boolean; answerable: boolean; templatable: boolean }) =>
    sectionNeeds.needRowActions({ need: { id: NEED, title: "Esigenza di prova" }, onOpen: () => undefined, onEdit: () => undefined, ...o }).map((a) => a.label);
  assert.deepEqual(labels({ canEdit: true, answerable: true, templatable: true }), [T.rowAddAnswer, T.rowAttachFile, T.rowAddTemplate, "Modifica"]);
  assert.deepEqual(labels({ canEdit: true, answerable: true, templatable: false }), [T.rowAddAnswer, T.rowAttachFile, "Modifica"]);
  assert.deepEqual(labels({ canEdit: false, answerable: true, templatable: true }), []);
  assert.equal(T.rowAddTemplate, "Aggiungi un file da compilare");
});

function template(over: Partial<NeedTemplateView> = {}): NeedTemplateView {
  return { id: FILE, name: "modello-XX-0001.xlsx", sizeLabel: "48 KB", status: "pulito", href: `/dashboard/${WS}/use-cases/${UC}/da-compilare/${FILE}`, canEdit: true, canReview: false, pending: null, ...over };
}
const view = (templates: NeedTemplateView[]): NeedReferentView => ({ needId: NEED, line: null, silent: false, answers: [], files: [], templates });

function renderBlock(v: NeedReferentView, canEdit: boolean): string {
  return readable(
    renderToStaticMarkup(h(block.NeedReferentBlock, { workspaceId: WS, useCaseId: UC, view: v, canEdit, canReviewFiles: canEdit, onOpen: () => undefined, thread: [], suggestions: [] })),
  );
}

test("sotto l'esigenza: «Da compilare: {nome} · Sostituisci · Togli», a vista, e non conta tra le risposte", () => {
  const html = renderBlock(view([template()]), true);
  assert.ok(html.includes(T.templateLabel));
  assert.match(html, new RegExp(`<a href="/dashboard/${WS}/use-cases/${UC}/da-compilare/${FILE}" download="[^"]*"[^>]*>modello-XX-0001\\.xlsx</a>`));
  assert.ok(html.includes("48 KB"));
  assert.ok(html.includes(`>${T.templateReplace}<`));
  assert.ok(html.includes(`>${T.templateRemove}<`));
  assert.equal(html.includes("Risposte e file"), false, "non è una risposta");
  const rows = needReferentRows(view([template()]), { canEdit: true, canReviewFiles: true });
  assert.equal(rows.summary, null);
  assert.deepEqual(rows.templates.map((r) => [r.label, r.name, r.canReplace, r.canRemove]), [["Da compilare:", "modello-XX-0001.xlsx", true, true]]);
});

test("una versione nuova in controllo: la riga lo dice, «Sostituisci» non c'è finché non è decisa", () => {
  const pending = { id: "66666666-0000-4000-8000-000000000002", name: "modello-v2.pdf", sizeLabel: "1 MB", href: `/dashboard/${WS}/use-cases/${UC}/da-compilare/66666666-0000-4000-8000-000000000002`, canReview: true };
  const html = renderBlock(view([template({ pending })]), true);
  assert.ok(html.includes(T.templatePending));
  assert.equal(html.includes(`>${T.templateReplace}<`), false);
  assert.ok(html.includes(T.fileAccept));
  assert.ok(html.includes(T.fileDownloadToReview));
});

test("chi non modifica «Cosa serve» vede il file pulito, senza azioni; un PDF da controllare non lo vede", () => {
  const html = renderBlock(view([template({ canEdit: false }), template({ id: "66666666-0000-4000-8000-000000000003", status: "in_revisione", canEdit: false })]), false);
  assert.ok(html.includes("modello-XX-0001.xlsx"));
  assert.equal(html.includes(`>${T.templateReplace}<`), false);
  assert.equal(html.includes(`>${T.templateRemove}<`), false);
  assert.equal((html.match(/data-slot="need-template"/g) ?? []).length, 1);
});

test("l'anteprima di «Chiedi al referente»: «con file da compilare» accanto alle domande che ne hanno uno", () => {
  const html = readable(
    renderToStaticMarkup(
      h(preview.AskPreviewStep, {
        headingId: "controlla",
        name: "Referente di prova",
        to: "Referente di prova · r•••@example.test",
        parts: { subject: "Oggetto di prova", blocks: [{ p: "Buongiorno," }] },
        questions: [{ title: "Domanda di prova A", fillIn: true }, "Domanda di prova B", { title: "Domanda di prova C", fillIn: false }],
        replyTo: null,
        gates: [],
        okNotice: null,
        error: null,
      }),
    ),
  );
  const list = html.slice(html.indexOf('data-slot="ask-preview-questions"'));
  assert.equal((list.match(new RegExp(T.askDialog.withTemplate, "g")) ?? []).length, 1);
  assert.match(list, /Domanda di prova A<span[^>]*> · con file da compilare<\/span><\/li>/);
  assert.equal(T.askDialog.withTemplate, "con file da compilare");
  assert.equal(REFERENT_ASSIGN_TEXT.withTemplate, "con file da compilare");
});
