import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLI_PAGE_TEXT } from "../../app/cli/collega/text.ts";
import { accountHref } from "../shell/account.ts";

// (Rilascio 10, ondata 4 «Fuori», docs/ui-10/PROPOSTA-10.md §3.11, audit Realizzazione §3.44 e F-238) «Collega la CLI»:
// il guscio unico delle pagine pubbliche; in fondo un link a «Il tuo account › Claude e terminale» e uno all'Agent
// Factory; nell'errore (codice sbagliato, non trovato, scaduto) il campo per riscriverlo. Restano il codice, i quattro
// stati, la conferma con la scelta del workspace e «Non l'ho chiesto io».

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const code = (path: string) =>
  read(path)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

test("the two links at the bottom: «Il tuo account › Claude e terminale» and the Agent Factory of the workspace the page proposes", () => {
  const page = code("src/app/cli/collega/page.tsx");
  assert.match(page, /<PublicLink href=\{workspaceId \? accountHref\(workspaceId, "claude"\) : "\/dashboard"\}>\{workspaceId \? T\.account : T\.workspaces\}<\/PublicLink>/);
  assert.match(page, /\{workspaceId \? <PublicLink href=\{`\/dashboard\/\$\{workspaceId\}\/agent-factory`\}>\{T\.factory\}<\/PublicLink> : null\}/);
  assert.match(page, /const footer = <LinksFooter workspaceId=\{workspaces\[0\]\?\.id \?\? null\} \/>;/, "il workspace che la scelta propone per primo");
  assert.equal(accountHref("00000000-0000-4000-8000-0000000000a1", "claude"), "/dashboard/00000000-0000-4000-8000-0000000000a1?account=claude");
  assert.equal(CLI_PAGE_TEXT.account, "Il tuo account › Claude e terminale");
  assert.equal(CLI_PAGE_TEXT.factory, "Agent Factory");
});

test("on an error the field to retype the code; the four states, the confirmation and «Non l'ho chiesto io» stay", () => {
  const page = code("src/app/cli/collega/page.tsx");
  assert.match(page, /<CodeForm error=\{codice \? T\.invalid : null\} \/>/, "codice sbagliato");
  assert.match(page, /<PublicCard title=\{T\.notFound\.title\}>\s*<PublicCardText>\{T\.notFound\.body\}<\/PublicCardText>\s*<CodeForm label=\{T\.retype\} \/>/, "codice non trovato");
  assert.match(page, /\{login\.status === "scaduto" \? <CodeForm label=\{T\.retype\} \/> : null\}/, "codice scaduto");
  assert.match(page, /<form method="get"/, "il campo funziona anche senza script");
  assert.match(page, /className=\{PUBLIC_PRIMARY\}/);
  assert.match(page, /<CliLoginConfirm userCode=\{login\.userCode\} workspaces=\{workspaces\} \/>/);
  assert.deepEqual(Object.keys(CLI_PAGE_TEXT.done).sort(), ["confermato", "consegnato", "negato", "scaduto"]);
  assert.match(page, /if \(!session\?\.user\?\.id\) redirect\(loginPathForMissingSession\(/, "l'accesso prima di tutto, come prima");
  assert.match(page, /<PublicShell footer=\{footer\}>/);
  assert.doesNotMatch(page, /href="\/"|<Card\b/);
  assert.match(code("src/app/cli/layout.tsx"), /return <PublicRoot>\{children\}<\/PublicRoot>;/);
  assert.match(code("src/app/cli/collega/error.tsx"), /return <PublicErrorScreen retry=\{retry\} \/>;/);
});
