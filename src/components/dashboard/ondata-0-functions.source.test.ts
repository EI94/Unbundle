import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// (Ondata 0, docs/ui-10/PROPOSTA-10.md §6.3) Funzioni rotte o a metà, controllate sul sorgente: i menu e le finestre
// di base-ui si aprono solo nel browser, e il client di Firebase non si carica sotto Node.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("0.17 · the user menu items act themselves: items with onClick, links as menu link items, nothing nested", () => {
  const sidebar = read("src/components/dashboard/app-sidebar.tsx");
  const menu = sidebar.slice(sidebar.indexOf('<DropdownMenuContent side="top"'), sidebar.indexOf("</DropdownMenuContent>"));
  assert.ok(menu.length > 0);
  // (Rilascio 10, PROPOSTA-10 §2.1) «Il tuo account» · «Tema ›» · «Esci»; «Tutti i workspace» è nel selettore in cima.
  assert.match(menu, /<DropdownMenuItem onClick=\{openAccount\} className=\{MENU_ITEM_CLASS\}>/);
  assert.match(menu, /<DropdownMenuSubTrigger className=\{MENU_ITEM_CLASS\}>/);
  assert.match(menu, /<DropdownMenuItem onClick=\{handleLogout\} className=\{MENU_ITEM_CLASS\}>/);
  assert.doesNotMatch(menu, /<button|<DropdownMenuItem>\s*<Link|<Link/, "nessun link o pulsante dentro una voce");
  const switcher = read("src/components/shell/workspace-switcher.tsx");
  assert.equal(switcher.match(/<DropdownMenuLinkItem render=\{<Link href=\{(WORKSPACE_LIST_HREF|NEW_WORKSPACE_HREF)\} onNavigate=\{onNavigate\} \/>\}/g)?.length, 2);
  assert.doesNotMatch(switcher, /<DropdownMenuItem\b/);
  const ui = read("src/components/ui/dropdown-menu.tsx");
  assert.match(ui, /function DropdownMenuLinkItem\(\{ className, closeOnClick = true, \.\.\.props \}: MenuPrimitive\.LinkItem\.Props\)/);
  assert.match(ui, /<MenuPrimitive\.LinkItem\s+data-slot="dropdown-menu-item"\s+closeOnClick=\{closeOnClick\}/);
});

test("0.19 · revoking a CLI connection asks first, in a dialog of the app", () => {
  // (Rilascio 10, ondata 6b) La CLI sta in «Il tuo account › Claude e terminale»: la riga apre la finestra, la revoca
  // parte solo dalla finestra. La card «CLI di Unbundle» delle Impostazioni non c'è più.
  const sheet = read("src/components/shell/account-sheet-body.tsx");
  assert.match(sheet, /onClick=\{\(\) => setRevoking\(row\)\}>\s*\{C\.revoke\}/, "il pulsante della riga apre la finestra");
  assert.match(sheet, /<Dialog open=\{revoking !== null\}/);
  assert.match(sheet, /<DialogTitle>\{C\.revokeTitle\(revoking\.label\)\}<\/DialogTitle>/);
  assert.match(sheet, /<Button variant="destructive" disabled=\{pending\} onClick=\{\(\) => revoke\(revoking\)\}>/, "si revoca solo dalla finestra");
  assert.match(sheet, /const run = row\.kind === "claude" \? actions\.revokeClaudeAccess : actions\.revokeTerminalLink;/);
  assert.doesNotMatch(sheet, /window\.confirm/);
  assert.equal(existsSync(new URL("../workspace/cli-card.tsx", import.meta.url)), false, "niente seconda casa per la CLI");
});

test("0.20 · the share page has no button inside a link: the button renders the link", () => {
  const page = read("src/app/share/portfolio/[workspaceId]/[useCaseId]/page.tsx");
  assert.doesNotMatch(page, /<Link[^>]*>\s*<Button/);
  // (Rilascio 10, §3.4) The views moved to share-view.tsx, with the full-width 48 px buttons of the public pages.
  const view = read("src/app/share/portfolio/[workspaceId]/[useCaseId]/share-view.tsx");
  assert.doesNotMatch(view, /<Link[^>]*>\s*<Button/);
  assert.match(view, /<Button render=\{<Link href=\{loginHref\} \/>\} nativeButton=\{false\} className="h-12 w-full text-base">\s*\{SHARE_PAGE_TEXT\.invalidLogin\}/);
});

test("0.21 · on /cli/collega the way out goes to the workspaces, never to «/»", () => {
  const page = read("src/app/cli/collega/page.tsx");
  // (Rilascio 10, ondata 4) Il marchio del guscio pubblico non è un link: si torna con i link in fondo, a «Il tuo
  // account › Claude e terminale» e all'Agent Factory del workspace (senza workspace, all'elenco dei workspace).
  // (8.0d) A «Solo questo use case» il foglio si apre sull'Agent Factory, nel suo perimetro; senza workspace, l'elenco.
  assert.match(page, /<PublicLink href=\{workspaceId \? \(caseOnly \? caseOnlyAccountHref\(workspaceId, "claude"\) : accountHref\(workspaceId, "claude"\)\) : "\/dashboard"\}>/);
  assert.match(page, /<PublicLink href=\{`\/dashboard\/\$\{workspaceId\}\/agent-factory`\}>/);
  assert.doesNotMatch(page, /<Link href="\/"|href="\/"/);
});

test("0.22 · Firebase speaks Italian: the language is set where the client auth is created", () => {
  const client = read("src/lib/firebase/client.ts");
  const created = client.indexOf("export const firebaseAuth = getAuth(firebaseApp);");
  assert.ok(created > 0);
  assert.ok(client.indexOf('firebaseAuth.languageCode = "it";') > created);
});
