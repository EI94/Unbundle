import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// (Ondata 0, docs/ui-10/PROPOSTA-10.md §6.3) Funzioni rotte o a metà, controllate sul sorgente: i menu e le finestre
// di base-ui si aprono solo nel browser, e il client di Firebase non si carica sotto Node.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("0.17 · the user menu items act themselves: a menu link item and an item with onClick, nothing nested", () => {
  const sidebar = read("src/components/dashboard/app-sidebar.tsx");
  const menu = sidebar.slice(sidebar.indexOf('<DropdownMenuContent side="top"'), sidebar.indexOf("</DropdownMenuContent>"));
  assert.ok(menu.length > 0);
  assert.match(menu, /<DropdownMenuLinkItem render=\{<Link onNavigate=\{closeMobileNavigation\} href="\/dashboard" \/>\}>/);
  assert.match(menu, /<DropdownMenuItem onClick=\{handleLogout\}>/);
  assert.doesNotMatch(menu, /<button|<DropdownMenuItem>\s*<Link/, "nessun link o pulsante dentro una voce");
  const ui = read("src/components/ui/dropdown-menu.tsx");
  assert.match(ui, /function DropdownMenuLinkItem\(\{ className, closeOnClick = true, \.\.\.props \}: MenuPrimitive\.LinkItem\.Props\)/);
  assert.match(ui, /<MenuPrimitive\.LinkItem\s+data-slot="dropdown-menu-item"\s+closeOnClick=\{closeOnClick\}/);
});

test("0.19 · revoking a CLI connection asks first, in a dialog of the app", () => {
  const card = read("src/components/workspace/cli-card.tsx");
  assert.match(card, /onClick=\{\(\) => setRevoking\(t\)\}>\s*Revoca/, "il pulsante della riga apre la finestra");
  assert.match(card, /<Dialog open=\{revoking !== null\}/);
  assert.match(card, /<DialogTitle>Revocare «\{revoking\.label\}»\?<\/DialogTitle>/);
  assert.match(card, /variant="destructive"[^>]*onClick=\{\(\) => revoke\(revoking\)\}/, "si revoca solo dalla finestra");
  assert.equal(card.match(/revokeOwnCliTokenAction\(/g)?.length, 1);
  assert.doesNotMatch(card, /window\.confirm/);
});

test("0.20 · the share page has no button inside a link: the button renders the link", () => {
  const page = read("src/app/share/portfolio/[workspaceId]/[useCaseId]/page.tsx");
  assert.doesNotMatch(page, /<Link[^>]*>\s*<Button/);
  assert.match(page, /<Button render=\{<Link href=\{loginUrl\} \/>\} nativeButton=\{false\} className="h-10">\s*Accedi a Unbundle/);
});

test("0.21 · on /cli/collega the brand goes to the workspaces", () => {
  const page = read("src/app/cli/collega/page.tsx");
  assert.match(page, /<Link href="\/dashboard" className="mb-6 text-sm font-semibold tracking-wide">\s*Unbundle\s*<\/Link>/);
  assert.doesNotMatch(page, /<Link href="\/"/);
});

test("0.22 · Firebase speaks Italian: the language is set where the client auth is created", () => {
  const client = read("src/lib/firebase/client.ts");
  const created = client.indexOf("export const firebaseAuth = getAuth(firebaseApp);");
  assert.ok(created > 0);
  assert.ok(client.indexOf('firebaseAuth.languageCode = "it";') > created);
});
