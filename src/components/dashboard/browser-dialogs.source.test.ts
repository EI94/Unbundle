import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// (Rilascio 10, ondata 1 · docs/ui-10/PROPOSTA-10.md §1 regola 7, §5.4, §5.5) Nessuna finestra del browser: chi conferma,
// cancella o toglie un accesso risponde in una finestra dell'app (`ConfirmDialog`, src/components/ui/confirm-dialog.tsx).
// Si legge ogni sorgente .ts e .tsx sotto src/ (i test esclusi) con l'albero di TypeScript: commenti e stringhe non
// contano, `deps.confirm(…)` è un metodo, e un `confirm` dichiarato nel file (le funzioni locali dei dialoghi degli use
// case, di case-menu.tsx) non è quello del browser. Le finestre di base-ui si aprono solo nel browser: il resto si
// controlla sul sorgente, come in ondata-0-functions.source.test.ts.

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

const BROWSER_DIALOGS = new Set(["confirm", "alert", "prompt"]);
const GLOBALS = new Set(["window", "globalThis"]);

const SOURCES = (readdirSync(`${root}src`, { recursive: true }) as string[])
  .map((file) => file.split("\\").join("/"))
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .map((file) => `src/${file}`)
  .sort();

/** `x`, `(x)`, `x!` e `x as T`: l'espressione sotto. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current) || ts.isAsExpression(current)) current = current.expression;
  return current;
}

/** Il nome di una finestra del browser letto da `window`/`globalThis` (`window.confirm`, `globalThis["alert"]`), o null. */
function globalDialog(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(unwrap(node.expression))) {
    const owner = (unwrap(node.expression) as ts.Identifier).text;
    if (GLOBALS.has(owner) && BROWSER_DIALOGS.has(node.name.text)) return node.name.text;
  }
  if (ts.isElementAccessExpression(node) && ts.isIdentifier(unwrap(node.expression)) && ts.isStringLiteralLike(node.argumentExpression)) {
    const owner = (unwrap(node.expression) as ts.Identifier).text;
    if (GLOBALS.has(owner) && BROWSER_DIALOGS.has(node.argumentExpression.text)) return node.argumentExpression.text;
  }
  return null;
}

/** I punti di un sorgente che aprono una finestra del browser, come «file:riga: codice». */
function browserDialogs(path: string, text: string): string[] {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const declared = new Set<string>();
  const found: { node: ts.Node; bare: string | null }[] = [];
  const visit = (node: ts.Node) => {
    // Un nome dichiarato nel file (funzione, variabile, parametro, import) copre quello globale.
    if (
      (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) || ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      BROWSER_DIALOGS.has(node.name.text)
    ) {
      declared.add(node.name.text);
    }
    if (globalDialog(node)) found.push({ node, bare: null });
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (ts.isIdentifier(callee) && BROWSER_DIALOGS.has(callee.text)) found.push({ node, bare: callee.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found
    .filter(({ bare }) => bare === null || !declared.has(bare))
    .map(({ node }) => `${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${node.getText(file).replace(/\s+/g, " ").slice(0, 90)}`);
}

test("the guard finds the browser dialogs, and only them", () => {
  const found = (text: string, path = "src/sample.tsx") => browserDialogs(path, text).length;
  assert.equal(found(`if (!window.confirm("Rimuovere?")) return;`), 1);
  assert.equal(found(`const ok = globalThis.confirm("Rimuovere?");`), 1);
  assert.equal(found(`window.alert("Fatto");`), 1);
  assert.equal(found(`const typed = window.prompt("Scrivi ELIMINA");`), 1);
  assert.equal(found(`window["prompt"]("Scrivi ELIMINA");`), 1);
  assert.equal(found(`(window as Window).confirm("Rimuovere?");`), 1);
  assert.equal(found(`const ask = window.confirm; ask("Rimuovere?");`), 1, "a reference counts too");
  assert.equal(found(`if (!confirm("Rimuovere?")) return;`), 1, "the bare global");
  assert.equal(found(`alert("Fatto");`), 1);
  // Not the browser's: a local function, a method, an object member, a declaration, comments and strings.
  assert.equal(found(`async function confirm() {}\nvoid confirm();`), 0);
  assert.equal(found(`const confirm = () => undefined;\nconfirm();`), 0);
  assert.equal(found(`function run({ confirm }: { confirm: () => void }) { confirm(); }`), 0);
  assert.equal(found(`await deps.confirm(actor, items);`), 0);
  assert.equal(found(`interface Deps { confirm(actor: string): Promise<void>; }`), 0);
  assert.equal(found(`const store = { confirm() { return 1; } };\nstore.confirm();`), 0);
  assert.equal(found(`// window.confirm("Rimuovere?")\n/* alert("x") */`), 0);
  assert.equal(found(`const text = "window.confirm(x) e prompt(y)";`), 0);
  assert.equal(found(`<Button onClick={() => setOpen(true)}>Rimuovi</Button>`), 0);
});

test("no source under src/ opens a browser dialog: every confirmation is a dialog of the app", () => {
  assert.ok(SOURCES.length > 1000, "the sources are there");
  const found = SOURCES.flatMap((path) => browserDialogs(path, read(path)));
  assert.deepEqual(found, []);
});

/**
 * I 13 componenti che chiedevano con `window.confirm` o `window.prompt`, più la finestra della Formazione che ha preso
 * il posto di `window.confirm` e `window.alert` di use-unsaved-changes.ts: le 22 chiamate dell'ondata 1.
 */
const CONVERTED = [
  "src/components/ai-readiness/threshold-form.tsx",
  "src/components/ai-readiness/question-editor.tsx",
  "src/components/ai-readiness/open-link-form.tsx",
  "src/components/ai-readiness/assessment-actions.tsx",
  "src/components/workspace/claude-mcp-card.tsx",
  "src/components/workspace/team-mcp-card.tsx",
  "src/components/workspace/connector-card-panel.tsx",
  "src/components/workspace/disable-share-links-button.tsx",
  "src/components/workspace/workspace-collaboration-card.tsx",
  "src/components/uc/privacy/personal-zone-panel.tsx",
  "src/components/dashboard/esg-toggle.tsx",
  "src/components/portfolio/scoring-model-form.tsx",
  "src/components/learning/leave-dialog.tsx",
];

test("the converted components ask with ConfirmDialog", () => {
  for (const path of CONVERTED) {
    const source = read(path);
    assert.match(source, /import \{ ConfirmDialog(?:, useSubmitConfirmation)? \} from "@\/components\/ui\/confirm-dialog";/, path);
    assert.match(source, /<ConfirmDialog\b/, path);
  }
});

test("ConfirmDialog: the question, one sentence, «Annulla» and the verb, 44 px on phones; the form does not reach the page", () => {
  const source = read("src/components/ui/confirm-dialog.tsx");
  assert.match(source, /<DialogTitle>\{title\}<\/DialogTitle>/);
  assert.match(source, /\{description \? <DialogDescription>\{description\}<\/DialogDescription> : null\}/);
  assert.match(source, /<DialogClose render=\{<Button type="button" variant="outline" className="h-11 sm:h-8" \/>\}>\{cancelLabel\}<\/DialogClose>/);
  assert.match(source, /<Button type="submit" variant=\{destructive \? "destructive" : "default"\} className="h-11 sm:h-8"/);
  assert.match(source, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*if \(!blocked\) onConfirm\(\);/, "a dialog opened from a form does not submit it");
  assert.match(source, /<DialogContent showCloseButton=\{false\}/);
  // The contrast tokens of the dossier and of the Use case area follow `data-slot="dialog-content"` (globals.css): kept.
  assert.doesNotMatch(source, /data-slot=/);
  // A form that asks first sends itself again, with the same button, and lets that second submit through once.
  assert.match(source, /form\.requestSubmit\(submitterOf\(form, submitter\)\);/);
  assert.match(source, /finally \{[\s\S]*?confirmed\.current = false;/);
});

test("revokes in the lists are outlined, the red only inside the dialog; «Crea link» and the Slack «Salva» are outlined", () => {
  for (const path of ["src/components/workspace/claude-mcp-card.tsx", "src/components/workspace/team-mcp-card.tsx", "src/components/workspace/connector-card-panel.tsx"]) {
    const source = read(path);
    assert.doesNotMatch(source, /<Button\b[^>]*variant="destructive"/, path);
    for (const button of source.match(/<Button\b[^>]*>\s*Revoca(?: tutti)?\s*<\/Button>/g) ?? []) {
      assert.match(button, /variant="outline"/, `${path}: ${button}`);
      assert.match(button, /className="h-11 sm:h-8"/, `${path}: 44 px on phones`);
    }
    assert.match(source, /destructive\s+onConfirm=\{revoking\.confirm\}/, `${path}: the red is the dialog's`);
  }
  // (Rilascio 10, ondata 6b) Impostazioni › Team: «Invita» è bordato nella pagina; «Crea il link» è il pulsante del
  // pannello dell'invito (un pannello ha il suo pulsante pieno).
  const people = read("src/components/workspace/workspace-collaboration-card.tsx");
  assert.match(people, /<Button type="button" variant="outline" className="min-h-11 sm:min-h-9" aria-haspopup="dialog" onClick=\{\(\) => setPanel\(INVITE_PANEL\)\}/);
  assert.match(people, /<SideSheet\s+open=\{panel === INVITE_PANEL\}[\s\S]*?footer=\{\s*<Button type="submit" form="workspace-invite-create-form" className="min-h-11 sm:min-h-9" disabled=\{createPending\}>/);
  const slack = read("src/components/dashboard/slack-notify-channel-form.tsx");
  assert.match(slack, /<Button type="button" variant="outline" className="h-11 sm:h-8" disabled=\{pending\} onClick=\{save\}>/);
});

test("«Elimina» of AI Readiness is one dialog: the summary, the word to type, and the same word for the server", () => {
  const source = read("src/components/ai-readiness/assessment-actions.tsx");
  assert.equal(source.match(/<ConfirmDialog\b/g)?.length, 2, "«Chiudi la raccolta» and «Elimina»");
  // (Ondata 7b) Dal «⋯»: la finestra si apre dalla voce rossa, e la conferma manda il modulo con la parola scritta.
  assert.match(source, /label: M\.remove, destructive: true, disabled: deletePending, onSelect: \(\) => setDeleting\(true\)/);
  assert.match(source, /deleteForm\.current\?\.requestSubmit\(\);/);
  assert.match(source, /<input type="hidden" name="confirmation" value=\{deleteWordTyped \? DELETE_WORD : ""\} \/>/);
  assert.match(source, /description=\{ASK\.deleteBody\(respondentCount, completedCount\)\}/);
  assert.match(source, /confirmDisabled=\{!deleteWordTyped\}/);
  assert.match(source, /<Label htmlFor=\{typedId\}>\{ASK\.deleteField\}<\/Label>/);
  // The server checks the same word, after the same normalisation.
  assert.match(read("src/lib/actions/ai-readiness.ts"), /formString\(formData, "confirmation"\)\.toUpperCase\(\) !== "ELIMINA"/);
});

test("Learning: a guarded link, «Aggiorna» or another section ask in the app's dialog, then run the step", () => {
  const guard = read("src/components/learning/use-unsaved-changes.ts");
  assert.match(guard, /if \(!learningLeave\.request\("leave", \(\) => follow\(target, url\.href\)\)\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(guard, /window\.setTimeout\(\(\) => \{\s*if \(anchor\.isConnected\) anchor\.click\(\);\s*else window\.location\.assign\(href\);/, "the same link again, after the dialog closed");
  assert.match(guard, /window\.addEventListener\("beforeunload", beforeUnload\);/, "closing the tab still asks the browser");
  // Every step goes on after the confirmation, «Esci» in the sidebar too: discarding signs out, with one click.
  assert.match(guard, /export function confirmLearningNavigation\(proceed: \(\) => void\): boolean \{\s*return learningLeave\.request\("continue", proceed\);/);
  assert.match(read("src/components/dashboard/app-sidebar.tsx"), /if \(!confirmLearningNavigation\(\(\) => void handleLogout\(\)\)\) return;/);
  // One dialog, outside the subtree that Activity hides, so it answers every form.
  const boundary = read("src/components/learning/session-boundary.tsx");
  assert.ok(boundary.indexOf("<LearningLeaveDialog />") > boundary.indexOf("</Activity>"));
  assert.match(read("src/components/learning/learning-refresh.tsx"), /if \(confirmLearningNavigation\(refresh\)\) refresh\(\);/);
  const admin = read("src/components/learning/admin-program.tsx");
  assert.match(admin, /!confirmLearningNavigation\(\(\) => void refresh\(\)\)/);
  assert.match(admin, /if \(key !== section && confirmLearningNavigation\(open\)\) open\(\);/);
  // «Scarta modifiche» still receives a function that answers whether nothing was left to discard.
  assert.match(guard, /return \{ confirmDiscard: confirmLearningDiscard \};/);
  assert.match(read("src/components/learning/admin-shared.tsx"), /onDiscard: \(\) => boolean/);
});
