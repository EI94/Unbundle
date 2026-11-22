import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installAppModules } from "../ai/claude-test-kit.ts";
import { enableTsxImports } from "../../components/use-cases/detail/referent/tsx-test-loader.ts";
import { LEARNING_TEXT } from "./text.ts";

// (Rilascio 10) Un corso che questo account non può aprire (un altro account, nessuna iscrizione, un corso sospeso o
// nascosto: `getLearningProgram` lancia `forbidden`) mostra la spiegazione nella cornice della Formazione, non «Questa
// pagina non si è caricata.» con «Riprova»; gli errori veri restano a `learning/error.tsx`. La pagina del corso vera
// (`ProgramOverview`, anche della lezione), con la lettura del corso finta. Id inventati.

type Prova = { error: unknown; asked: number };
const prova: Prova = { error: null, asked: 0 };
(globalThis as { __programOverview?: Prova }).__programOverview = prova;

const WS = "00000000-0000-4000-8000-0000000000f1";
const PROGRAM = "00000000-0000-4000-8000-0000000000a1";

await installAppModules({
  "@/lib/learning/server": `export class LearningError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  export async function getLearningProgram() { globalThis.__programOverview.asked += 1; throw globalThis.__programOverview.error; }`,
});
await enableTsxImports();

const { ProgramOverview } = await import("../../components/learning/program-overview.tsx");
const { LearningError } = (await import("@/lib/learning/server")) as unknown as { LearningError: new (code: string, message: string) => Error };
const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const open = (moduleId?: string) => ProgramOverview({ workspaceId: WS, programId: PROGRAM, moduleId });

test("un corso che questo account non può aprire: la spiegazione nella cornice della Formazione, senza «Riprova»", async () => {
  for (const moduleId of [undefined, "m1"]) {
    Object.assign(prova, { error: new LearningError("forbidden", "Contenuto non disponibile per questo account."), asked: 0 });
    const html = renderToStaticMarkup(await open(moduleId));
    const text = textOf(html);
    assert.match(html, /<h1 [^>]*>Formazione<\/h1>/, "il titolo della pagina");
    // (Ondata 7a) Una frase sola, senza il titolo «Percorso non disponibile» (FO-4), e il ritorno alla Formazione.
    assert.doesNotMatch(text, /Percorso non disponibile/);
    assert.match(html, /data-slot="empty-state"/);
    assert.ok(text.includes(LEARNING_TEXT.programUnavailable.body), text);
    assert.match(html, new RegExp(`<a [^>]*href="/dashboard/${WS}/learning"[^>]*>.*${LEARNING_TEXT.backToLearning}</a>`), "il ritorno alla Formazione del workspace");
    assert.doesNotMatch(text, /Riprova|non si è caricata/);
    assert.equal(prova.asked, 1);
  }
});

test("gli errori veri non si nascondono: la pagina li rilancia a learning/error.tsx", async () => {
  for (const error of [new LearningError("technical", "Errore tecnico."), new LearningError("unavailable", "Spenta."), new Error("rete")]) {
    prova.error = error;
    await assert.rejects(open(), (thrown) => thrown === error);
  }
  assert.match(read("src/app/(dashboard)/dashboard/[workspaceId]/learning/error.tsx"), /<PageLoadError error=\{error\} retry=\{retry\} area="learning" \/>/);
});

test("le parole sono quelle di prima: sospeso o non assegnato, le risposte salvate, chi tiene il corso", () => {
  const T = LEARNING_TEXT.programUnavailable;
  assert.equal(T.title, "Formazione");
  assert.match(T.body, /^Il corso potrebbe essere sospeso o non assegnato a questo account\. Le risposte già inviate restano salvate\./);
  assert.match(T.body, /Controlla di essere nel workspace giusto, oppure chiedi a chi tiene il corso\.$/);
});
