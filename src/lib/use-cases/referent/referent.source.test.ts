import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// «Chiedi al referente» sul sorgente (SPEC §9.1): dove si nominano le tabelle nuove, cosa importano
// le rotte pubbliche, e che i log non stampino email, token o testi.

const root = fileURLToPath(new URL("../../../..", import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      out.push(...sources(path));
    } else if (/\.(ts|tsx|mjs|cjs|js)$/.test(name) && !/\.test\.(ts|tsx|mjs)$/.test(name)) {
      out.push(relative(root, path));
    }
  }
  return out;
}

const files = [...sources(join(root, "src")), ...sources(join(root, "scripts")), ...sources(join(root, "mcp"))].sort();
const printer = ts.createPrinter({ removeComments: true });
const cache = new Map<string, string>();
/** Il sorgente senza commenti. */
function read(file: string): string {
  const hit = cache.get(file);
  if (hit !== undefined) return hit;
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const code = printer.printFile(ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, false, kind));
  cache.set(file, code);
  return code;
}

const NEW_TABLES =
  /\b(use_case_referent_\w+|use_case_need_answers|use_case_need_files|weekly_signal_reads|workspace_bell_state|use_case_notifications|use_case_info_state|use_case_requester_email\w*|useCaseReferent\w*|useCaseNeedAnswers|useCaseNeedFiles|weeklySignalReads|workspaceBellState|useCaseNotifications|useCaseInfoState|useCaseRequesterEmail\w*)\b/;

const TABLE_FILES = new Set([
  "src/lib/db/schema.ts",
  "src/lib/db/use-case-hub-referents-ddl.ts",
  // Il servizio e le sue basi, la pagina pubblica, i file, l'invio delle email.
  "src/lib/db/queries/use-case-referents.ts",
  "src/lib/db/queries/use-case-referent-base.ts",
  "src/lib/db/queries/use-case-referent-public.ts",
  "src/lib/db/queries/use-case-referent-files.ts",
  "src/lib/db/queries/use-case-referent-dispatch.ts",
  // La campanella e «Raccolta informazioni».
  "src/lib/db/queries/use-case-notifications.ts",
  "src/lib/db/queries/use-case-info-progress.ts",
  "src/lib/db/queries/bell-state.ts",
  "src/lib/db/queries/signals.ts",
  // I costruttori SQL condivisi, la cancellazione e il suo comando dell'operatore.
  "src/lib/use-cases/referent/sql.ts",
  "src/lib/use-cases/referent/erase.ts",
  "src/lib/use-cases/admin/erase-referent.ts",
  "scripts/use-case-admin/erase-referent.ts",
  // La cancellazione di un workspace raccoglie i percorsi dei file.
  "src/lib/db/queries/workspaces.ts",
  // La purge di un dossier non anonimizza un referente che gli use case usano ancora.
  "src/lib/db/queries/uc-retention.ts",
  // I controlli dello schema sul cluster locale di prova (0024 tolta e rimessa).
  "scripts/use-case-test/schema-check.mjs",
]);

test("le tabelle nuove si nominano solo nei moduli della funzione", () => {
  const found = files.filter((file) => NEW_TABLES.test(read(file)));
  assert.deepEqual(found.filter((file) => !TABLE_FILES.has(file)), []);
  for (const file of TABLE_FILES) assert.ok(found.includes(file), `${file} non nomina più le tabelle: aggiorna l'elenco`);
});

const PUBLIC_DIR = "src/app/api/rispondi/";
const PUBLIC_IMPORTS = new Set([
  "@/lib/use-cases/referent/contract",
  "@/lib/use-cases/referent/tokens",
  "@/lib/db/queries/use-case-referent-public",
  "@/lib/uc/http",
  "@/lib/uc/files/multipart",
  "@/lib/db/queries/uc-public",
  "@/lib/db/uc-executor",
]);

function importsOf(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) out.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) out.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

test("le rotte pubbliche importano solo i moduli ammessi", () => {
  const routes = files.filter((file) => file.startsWith(PUBLIC_DIR));
  if (routes.length === 0) {
    // La pagina pubblica arriva con il suo pacchetto (chiedi-p): la regola vale appena c'è.
    const owned = JSON.parse(readFileSync(join(root, "scripts/use-case-test/ownership.json"), "utf8")) as { packages: Record<string, { files: string[] }> };
    assert.ok(owned.packages["chiedi-p"].files.includes(`${PUBLIC_DIR}**`));
    return;
  }
  const bad: string[] = [];
  for (const file of routes) {
    for (const spec of importsOf(file)) {
      if (spec.startsWith(".") || !spec.startsWith("@/")) continue;
      if (!PUBLIC_IMPORTS.has(spec)) bad.push(`${file}: ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});

const LOG_FILES = files.filter(
  (file) =>
    file.startsWith("src/lib/use-cases/referent/") ||
    /^src\/lib\/db\/queries\/(use-case-referent|use-case-notifications|use-case-info-progress|bell-state)/.test(file) ||
    file.startsWith("src/lib/notifications/bell") ||
    file === "src/lib/actions/use-case-referents.ts" ||
    file === "src/lib/actions/notifications.ts" ||
    file.startsWith("src/app/api/rispondi/") ||
    file.startsWith("src/app/api/cron/use-case-referents/") ||
    file.startsWith("src/app/api/workspaces/[workspaceId]/bell/") ||
    file.includes("/use-cases/[useCaseId]/allegati/"),
);
const SENSITIVE = /\b(email|token|replyTo|recipient|body|answer|text|draft|message|fileName|link)\w*\b/i;

/** Gli argomenti delle chiamate a console.*, senza le stringhe letterali. */
function consoleArgs(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const strip = (node: ts.Node): string => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return "''";
    if (ts.isTemplateExpression(node)) return node.templateSpans.map((s) => strip(s.expression)).join(" ");
    let text = "";
    ts.forEachChild(node, (child) => {
      text += ` ${strip(child)}`;
    });
    return node.getChildCount(source) === 0 ? node.getText(source) : text;
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "console") {
      out.push(node.arguments.map(strip).join(", "));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

test("nessun console.* della funzione stampa email, token o testi", () => {
  assert.ok(LOG_FILES.length > 15, String(LOG_FILES.length));
  const bad: string[] = [];
  for (const file of LOG_FILES) for (const args of consoleArgs(file)) if (SENSITIVE.test(args)) bad.push(`${file}: console(${args})`);
  assert.deepEqual(bad, []);
});

test("prova del controllo dei log", () => {
  // Il controllo vede le chiamate: i moduli della funzione ne hanno qualcuna (con soli codici).
  assert.ok(LOG_FILES.flatMap((file) => consoleArgs(file)).length > 0);
  assert.ok(SENSITIVE.test("to.email"));
  assert.ok(SENSITIVE.test("input.token"));
  assert.equal(SENSITIVE.test("'' , error instanceof Error ? error.name : ''"), false);
});
