import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { copyScopeOfFile, findHubForbidden } from "../../../lib/use-cases/copy-guard.ts";
import { REFERENT_PRIVACY_NOTICE, REFERENT_PUBLIC_TEXT } from "../../../lib/use-cases/referent/labels.ts";
import { REFERENT_PUBLIC_EXTRA_TEXT } from "./texts.ts";

// I testi della pagina `/rispondi/<token>` (SPEC §9.2): «use case», mai «caso d'uso» né «wave»; niente
// parole tecniche per il referente; e nessun testo scritto nei componenti: vengono tutti da labels.ts
// (`REFERENT_PUBLIC_TEXT`, l'informativa) o, per i pochi che la SPEC non elenca, da `texts.ts`.

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const DIRS = ["src/components/use-cases/referent-public", "src/app/rispondi"];
/** I moduli che tengono i testi: si controllano le parole, non la loro presenza. */
const TEXT_MODULES = new Set(["src/components/use-cases/referent-public/texts.ts"]);
/** I metadati del layout (titolo «Unbundle», descrizione) sono gli stessi dei link dei dossier. */
const METADATA_FILES = new Set(["src/app/rispondi/layout.tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const path = join(abs, name);
    if (statSync(path).isDirectory()) walk(relative(root, path), out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(relative(root, path));
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(d)).sort();
const TECH = /\b(token|MCP|workflow)\b/i;
const NON_VISIBLE_ATTRIBUTES = new Set(["className", "id", "key", "type", "accept", "htmlFor", "variant", "size", "role", "href", "rel", "target", "as", "titleId", "kind", "enterKeyHint", "autoComplete", "inputMode", "tone"]);
const NON_VISIBLE_CALLS = new Set(["cn", "fetch", "require", "Error", "addEventListener", "removeEventListener", "getElementById", "focusById", "test", "match"]);

interface Literal {
  text: string;
  /** Testo JSX: sempre a schermo. */
  jsx: boolean;
  aria: boolean;
}

/** Le stringhe che un sorgente può mettere a schermo (niente import, direttive, chiavi, classi, codice). */
function literals(file: string): Literal[] {
  const sf = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Literal[] = [];
  const visit = (node: ts.Node, aria: boolean): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression)) return;
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if (NON_VISIBLE_ATTRIBUTES.has(name) || name.startsWith("data-") || name === "aria-hidden") return;
      if (name.startsWith("aria-")) aria = true;
    }
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || NON_VISIBLE_CALLS.has(callee)) return;
    }
    if (ts.isLiteralTypeNode(node)) return;
    if (ts.isJsxText(node)) {
      const t = node.text.replace(/\s+/g, " ").trim();
      if (t) out.push({ text: t, jsx: true, aria });
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      const isKey = (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node;
      if (!isKey && node.text.trim()) out.push({ text: node.text, jsx: false, aria });
    } else if (ts.isTemplateExpression(node)) {
      const t = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
      if (t.trim()) out.push({ text: t, jsx: false, aria });
    }
    ts.forEachChild(node, (child) => visit(child, aria));
  };
  visit(sf, false);
  return out;
}

/** Una frase in italiano, non un identificatore, una classe o un percorso. */
function looksLikeCopy(l: Literal): boolean {
  if (l.jsx) return /\p{L}/u.test(l.text);
  const t = l.text.trim();
  if (/[àèéìòù«»…’]/.test(t)) return true;
  return /^\p{Lu}\p{Ll}+/u.test(t) && /\s/.test(t);
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}

test("il controllo trova i file della pagina pubblica", () => {
  for (const expected of [
    "src/app/rispondi/[token]/page.tsx",
    "src/app/rispondi/[token]/error.tsx",
    "src/components/use-cases/referent-public/referent-ask-page.tsx",
    "src/components/use-cases/referent-public/question-card.tsx",
    "src/components/use-cases/referent-public/attachments.tsx",
  ]) {
    assert.ok(files.includes(expected), expected);
  }
  // La cartella dei componenti è nell'area del controllo dei testi dell'hub.
  assert.equal(copyScopeOfFile("src/components/use-cases/referent-public/question-card.tsx"), "area");
});

test("nessuna parola vietata né tecnica nei testi della pagina", () => {
  const bad: string[] = [];
  for (const file of files) {
    for (const l of literals(file)) {
      if (findHubForbidden(l.text, "area").length > 0 || (looksLikeCopy(l) && TECH.test(l.text))) bad.push(`${file}: ${l.text}`);
    }
  }
  for (const text of [...strings(REFERENT_PUBLIC_EXTRA_TEXT), ...strings(REFERENT_PUBLIC_TEXT), ...strings(REFERENT_PRIVACY_NOTICE)]) {
    if (findHubForbidden(text, "area").length > 0 || TECH.test(text)) bad.push(`testo: ${text}`);
  }
  assert.deepEqual(bad, []);
});

test("i componenti non scrivono testi: arrivano da labels.ts o da texts.ts", () => {
  const bad: string[] = [];
  for (const file of files) {
    if (TEXT_MODULES.has(file) || METADATA_FILES.has(file)) continue;
    for (const l of literals(file)) if (looksLikeCopy(l)) bad.push(`${file}: ${l.text}`);
  }
  assert.deepEqual(bad, []);
});

test("prova del controllo", () => {
  assert.equal(looksLikeCopy({ text: "Invia le risposte", jsx: false, aria: false }), true);
  assert.equal(looksLikeCopy({ text: "Più tardi", jsx: false, aria: false }), true);
  assert.equal(looksLikeCopy({ text: "Grazie", jsx: true, aria: false }), true);
  assert.equal(looksLikeCopy({ text: "min-h-11 w-full text-base", jsx: false, aria: false }), false);
  assert.equal(looksLikeCopy({ text: "application/json", jsx: false, aria: false }), false);
  assert.equal(looksLikeCopy({ text: "same-origin", jsx: false, aria: false }), false);
  assert.ok(TECH.test("Apri il token"));
});
