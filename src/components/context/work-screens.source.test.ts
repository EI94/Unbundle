import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Le regole delle schermate di «Contesto nel lavoro» che si leggono nei sorgenti (rilascio 9b,
// RILASCIO-9b-COSTRUZIONE.md §5.2): la scheda legge il contesto solo per i revisori e senza far cadere la pagina; la
// piega apre i fatti in sola lettura.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** Il sorgente senza i commenti (blocchi e righe; un `//` dopo i due punti è un indirizzo, non un commento). */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}
/** Il corpo di una funzione del file, dalla sua firma alla graffa che la chiude in colonna zero. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} c'è`);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end === -1 ? undefined : end + 2);
}

const DASHBOARD = "src/app/(dashboard)/dashboard/[workspaceId]";
const CARD_PAGE = `${DASHBOARD}/use-cases/[useCaseId]/page.tsx`;

test("la scheda legge il contesto solo per i revisori, dentro un try che dà null: senza, la scheda resta", () => {
  const source = withoutComments(read(CARD_PAGE));
  // Una sola lettura, sotto la condizione dei revisori (il contributore ha la sua scheda corta).
  assert.equal((source.match(/\bloadUseCaseContext\(/g) ?? []).length, 1, "una lettura sola");
  assert.equal((source.match(/\bloadContextFold\(/g) ?? []).length, 2, "la funzione e la sua chiamata");
  assert.match(source, /reviewer \? loadContextFold\(contextActorFor\(session\.user, access, workspaceId\), result\.useCase\.id\) : null,/);
  assert.match(source, /const reviewer = result\.projection !== "contributore";/);
  // La lettura sta in un try/catch che risponde null, come quella delle proposte dei coding agent.
  const fold = functionBody(source, "loadContextFold");
  assert.match(fold, /try \{\s*return await loadUseCaseContext\(actor, useCaseId\);\s*\} catch \(error\) \{[\s\S]*return null;\s*\}/);
  assert.doesNotMatch(fold, /error\.message|String\(error\)/, "nel log solo il nome dell'errore");
  // La pagina passa il contesto alla scheda; la piega la decide la scheda.
  assert.match(source, /context=\{context\}/);
});

test("la piega: chiusa, prima di «Storia», con il pannello del fatto in sola lettura", () => {
  const detail = withoutComments(read("src/components/use-cases/detail/detail.tsx"));
  const fold = detail.indexOf('<Fold id="contesto"');
  assert.ok(fold > 0, "la piega c'è");
  assert.ok(fold > detail.indexOf('<Fold id="realizzazione"') && fold < detail.indexOf('<Fold id="storia"'), "dopo «Realizzazione», prima di «Storia»");
  assert.doesNotMatch(detail.slice(fold, detail.indexOf(">", fold)), /\bopen=/, "chiusa: la apre solo l'arrivo (`?capitolo=contesto`)");
  assert.match(detail, /const contextFold = context && contextFoldShown\(context\) \? context : null;/, "senza niente da mostrare non c'è");
  assert.match(detail, /context: contextFold !== null,/, "l'ancora c'è solo con la piega");

  const view = withoutComments(read("src/components/context/use-case-context.tsx"));
  assert.match(view, /^"use client";/);
  const sheets = [...view.matchAll(/<FactSheet\b[\s\S]*?\/>/g)].map((match) => match[0]);
  assert.equal(sheets.length, 1, "un pannello");
  assert.match(sheets[0], /\bcanEdit=\{false\}/, "in sola lettura: si modifica solo da «Contesto»");
  assert.doesNotMatch(view, /canEdit=\{(?!false\})/, "nessun canEdit diverso da false");
  // Nessun pulsante nella piega: solo il link «Apri il contesto» e i fatti che aprono il pannello.
  assert.doesNotMatch(view, /<Button\b|from "@\/components\/ui\/button"/);
  assert.match(view, /href=\{`\/dashboard\/\$\{workspaceId\}\/contesto`\}/);
});
