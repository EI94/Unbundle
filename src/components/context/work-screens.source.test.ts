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
  // Chi guarda «Contesto» c'è solo per un revisore (il contributore ha la sua scheda corta).
  assert.match(source, /const reviewer = result\.projection !== "contributore";/);
  assert.match(source, /const contextActor = reviewer \? contextActorFor\(session\.user, access, workspaceId\) : null;/);
  assert.equal((source.match(/\bcontextActorFor\(/g) ?? []).length, 1);
  // Una sola lettura della piega, sotto quella condizione.
  assert.equal((source.match(/\bloadUseCaseContext\(/g) ?? []).length, 1, "una lettura sola");
  assert.equal((source.match(/\bloadContextFold\(/g) ?? []).length, 2, "la funzione e la sua chiamata");
  assert.match(source, /contextActor \? loadContextFold\(contextActor, result\.useCase\.id\) : null,/);
  // La lettura sta in un try/catch che risponde null, come quella delle proposte dei coding agent.
  const fold = functionBody(source, "loadContextFold");
  assert.match(fold, /try \{\s*return await loadUseCaseContext\(actor, useCaseId\);\s*\} catch \(error\) \{[\s\S]*return null;\s*\}/);
  assert.doesNotMatch(fold, /error\.message|String\(error\)/, "nel log solo il nome dell'errore");
  // «Una call risponde»: solo a chi modifica «Cosa serve», e solo con «Cosa serve» letto; anche lei non fa cadere la scheda.
  assert.equal((source.match(/\blistNeedLinks\(/g) ?? []).length, 1);
  assert.match(source, /contextActor && abilities\.canEditNeeds && needLists \? loadNeedLinks\(contextActor, result\.useCase\.id\) : \{\},/);
  assert.match(functionBody(source, "loadNeedLinks"), /try \{\s*return await listNeedLinks\(actor, useCaseId\);\s*\} catch \(error\) \{[\s\S]*return \{\};\s*\}/);
  // La pagina passa i dati alla scheda; la piega e la riga le decide la scheda.
  assert.match(source, /context=\{context\}/);
  assert.match(source, /needLinks=\{needLinks\}/);
});

test("«Chiudi con questo» e «Non risponde»: chi modifica «Cosa serve», poi la strada di sempre, poi il legame", () => {
  const source = withoutComments(read("src/lib/actions/context-work.ts"));
  assert.match(source, /^"use server";/);
  // Il permesso: chi modifica «Cosa serve», con l'area accesa, dalla sessione e dall'accesso appena letti.
  const editor = functionBody(source, "needEditor");
  assert.match(editor, /if \(!access\) return/);
  assert.match(editor, /if \(!isUseCaseHubWorkspace\(workspaceId\)\) return/);
  assert.match(editor, /abilitiesForUseCase\(viewerFromSession\(session\.user, access\.role\)\)\.canEditNeeds/);
  for (const name of ["closeNeedFromCallAction", "dismissNeedLinkAction"]) {
    const body = functionBody(source, name);
    const access = body.indexOf("needEditor(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId))");
    assert.ok(access > 0 && access > body.indexOf("await requireSession()"), `${name}: prima la sessione e l'accesso`);
    const write = Math.max(body.indexOf("listNeedLinks("), body.indexOf("dismissNeedLink("));
    assert.ok(body.indexOf("if (!page.ok) return page.result;") < write, `${name}: niente prima del permesso`);
  }
  // «Chiudi con questo»: la riga di questo use case, poi «A posto» con updateNeedAction, e solo se riesce il legame.
  const close = functionBody(source, "closeNeedFromCallAction");
  const order = ["listNeedLinks(page.actor, useCaseId)", 'updateNeedAction(workspaceId, useCaseId, link.needId, needVersion, { status: "validata" })', "if (!closed.ok) return", "markNeedLinkUsed(page.actor, link.id)"].map((piece) => close.indexOf(piece));
  assert.ok(order.every((at) => at > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "nell'ordine");
  assert.match(close, /message: CONTEXT_TEXT\.needLink\.closed/);
  assert.match(functionBody(source, "dismissNeedLinkAction"), /message: CONTEXT_TEXT\.needLink\.dismissed/);
  // Nessun modello e nessuna tabella di «Contesto» scritta qui.
  assert.doesNotMatch(source, /generateText|generateObject|askContext|readContextSource/);
});

test("la riga di «Cosa serve»: i testi di «Contesto», due pulsanti piccoli e non pieni da 44 px, solo a chi modifica", () => {
  const needs = withoutComments(read("src/components/use-cases/detail/section-needs.tsx"));
  const line = functionBody(needs, "NeedLinkLine");
  assert.match(line, /\{needLinkText\(link\)\}/);
  assert.match(line, /\{T\.close\}/);
  assert.match(line, /\{T\.dismiss\}/);
  assert.match(line, /const T = CONTEXT_TEXT\.needLink;/);
  const buttons = [...line.matchAll(/<Button\b[^>]*>/g)].map((match) => match[0]);
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    assert.match(button, /variant="(outline|ghost)"/, "mai pieno: il pulsante pieno della pagina è quello del riquadro");
    assert.match(button, /size="sm"/);
    assert.match(button, /\bmin-h-11\b/, "44 px sul telefono");
  }
  assert.doesNotMatch(line, /[àèéìíòóù«»…]/, "nessun testo scritto a mano");
  // La riga c'è solo per chi modifica «Cosa serve»: la scheda passa i legami solo con canEditNeeds, e la lista solo con canEdit.
  assert.match(needs, /needLinks=\{canEdit \? needLinks : null\}/);
  assert.match(needs, /const answeredBy = canEdit \? \(needLinks\?\.\[need\.id\.toLowerCase\(\)\] \?\? null\) : null;/);
  assert.match(withoutComments(read("src/components/use-cases/detail/detail.tsx")), /needLinks=\{abilities\.canEditNeeds \? needLinks : null\}/);
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
