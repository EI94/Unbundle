import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { findHubForbidden } from "../../../../lib/use-cases/copy-guard.ts";

// I testi dei componenti di «Chiedi al referente», della campanella e di «Raccolta informazioni»
// (SPEC §9.3, §P2.12.3): ogni stringa e ogni testo JSX dei sorgenti passa il controllo dell'area
// («use case», mai «caso d'uso» né «wave») e non ha parole tecniche per i clienti. I testi veri
// stanno in `labels.ts`, `bell.ts` e `info-progress.ts` (provati da `src/lib/use-cases/referent/copy.test.ts`).
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const here = "src/components/use-cases/detail/referent";
const FILES = [
  ...readdirSync(`${root}${here}`)
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) && name !== "tsx-test-loader.ts")
    .map((name) => `${here}/${name}`),
  "src/components/use-cases/detail/section-needs.tsx",
  "src/components/use-cases/detail/info-summary.tsx",
  "src/components/use-cases/info-chip.tsx",
  "src/components/portfolio/notifications-bell.tsx",
  "src/components/portfolio/notifications-bell-state.ts",
];
const TECH = /\b(token|MCP|workflow)\b/i;

/** Le stringhe e i testi JSX di un file, senza commenti né identificatori. */
function texts(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(`${root}${file}`, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateExpression(node)) out.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
    else if (ts.isJsxText(node) && node.text.trim()) out.push(node.text.trim());
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

test("i file ci sono", () => {
  assert.ok(FILES.length >= 18, String(FILES.length));
  for (const file of FILES) assert.ok(texts(file).length > 0, file);
});

test("nessuna parola vietata dell'area nei testi dei componenti", () => {
  const hits = FILES.flatMap((file) => texts(file).flatMap((text) => findHubForbidden(text, "area").map((m) => `${file}: ${m.rule} in «${text}»`)));
  assert.deepEqual(hits, []);
});

test("nessuna parola tecnica per i clienti, nessun «caso d'uso»", () => {
  const hits = FILES.flatMap((file) => texts(file).filter((text) => TECH.test(text) || /casi? d['’]uso/i.test(text)).map((text) => `${file}: «${text}»`));
  assert.deepEqual(hits, []);
});

test("i componenti di «Chiedi al referente» non scrivono testi per le persone: li prendono da labels.ts", () => {
  // Un testo visibile scritto nel componente sarebbe un JSX con lettere: i testi passano tutti da costanti.
  const jsxTexts = FILES.filter((file) => file.endsWith(".tsx") && file.startsWith(here)).flatMap((file) => {
    const source = ts.createSourceFile(file, readFileSync(`${root}${file}`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const out: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node) && /\p{L}/u.test(node.text)) out.push(`${file}: «${node.text.trim()}»`);
      ts.forEachChild(node, visit);
    };
    visit(source);
    return out;
  });
  assert.deepEqual(jsxTexts, []);
});
