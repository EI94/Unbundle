import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Art. 15.4: nessuna metrica per persona (docs/use-case/PIANO-LAVORI.md §5.4,
// docs/use-case/DESIGN.md §11 e §12.5 test 1). Controllo sul sorgente dell'area.
//
// 1. I campi sul proponente (`proposed_by`, `proposedBy`, `submitterEmail`,
//    `submitted_by_user_id`, scritti anche `submittedByUserId` o `submitter_email`)
//    compaiono solo nei file ammessi e, in tre di questi, solo in una parte precisa:
//    - `service.ts`: la lista di colonne dell'INSERT INTO use_cases, scritto in un template
//      SQL (da `INSERT INTO use_cases` fino a RETURNING, ON CONFLICT, WHERE, JOIN, `;` o
//      alla fine del template), oppure l'oggetto passato a `.insert(useCases).values(…)`;
//    - `types.ts`: l'interfaccia `NewUseCaseInput`;
//    - `use-case-hub.ts`: la funzione di primo livello `projectForManager`, la proiezione
//      di chi gestisce il workspace (H2b).
//    Commenti, stringhe e il resto di quei file si controllano come ogni altro file.
//    `actor_user_id` non è un campo sul proponente: chi del team ha agito si scrive e si
//    legge nella Storia (DESIGN §10.3). Conta solo nelle regole del punto 2.
//
// 2. Ovunque, anche nei file ammessi, niente ordinamenti, raggruppamenti o conteggi per
//    persona: `proposed_by` o `actor_user_id`, anche in camelCase. Un'istruzione è un
//    template SQL intero (`SELECT`, `WITH`, `INSERT`, `UPDATE`, `DELETE`) oppure, per le
//    catene Drizzle e le query in stringa, l'istruzione di codice più interna che le
//    contiene. Dentro l'istruzione conta il livello: la sottoquery `(SELECT …)` che contiene
//    la clausola, o l'istruzione SQL tra due `;`. Il JSX non conta: lì `min(` è CSS.
//    - GROUP BY e `.groupBy(`: nel livello la persona non compare da nessuna parte (lista
//      del SELECT, JOIN, condizioni). Così si vedono `GROUP BY 1`, `GROUP BY who` e i JOIN
//      sulla persona.
//    - Aggregati senza OVER (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`…): come
//      GROUP BY. `count(*) … WHERE proposed_by = $1` è un conteggio per persona. Un
//      conteggio per scheda resta possibile accanto al proponente, in una sottoquery.
//      Con OVER contano l'argomento e le condizioni (`count(*) OVER ()` resta ammesso).
//    - ORDER BY, PARTITION BY, DISTINCT ON e `.orderBy(`: i bersagli non puntano alla
//      persona, né direttamente, né per posizione o alias del SELECT (`ORDER BY 1`), né
//      con le colonne di una tabella unita sulla persona (`JOIN users u ON u.id =
//      e.actor_user_id … ORDER BY u.name`). La Storia ordinata per data resta ammessa.
//
// I file di test non si controllano: le prove nominano i campi per verificarne l'assenza.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Dove vive l'area. Le cartelle si leggono per intero; per le altre conta il nome del file. */
const SCAN_DIRS = [
  "src/lib/use-cases",
  "src/components/use-cases",
  "src/app/(dashboard)/dashboard/[workspaceId]/use-cases",
  "src/app/api/mcp/use-case",
  "scripts/use-case-admin",
];
const SCAN_FILES: Array<{ dir: string; name: RegExp }> = [
  { dir: "src/lib/db/queries", name: /^(use-case-|team-mcp-)[^/]*\.ts$/ },
  { dir: "scripts", name: /^use-case-admin[^/]*\.(ts|mjs|js)$/ },
];

type Range = readonly [start: number, end: number];

/** La proiezione di chi gestisce il workspace: il solo posto di `use-case-hub.ts` con il proponente. */
const MANAGER_PROJECTION = "projectForManager";

/**
 * I soli file che possono nominare il proponente, ciascuno per un motivo preciso. Con
 * `regions`, solo dentro quelle parti del file; senza, in tutto il file.
 */
const ALLOWED: Record<string, { reason: string; regions?: (source: string, file: string) => Range[] }> = {
  "src/lib/use-cases/permissions.ts": { reason: "isOwnReceipt: la ricevuta di chi ha appena proposto (DESIGN §5.5)" },
  "src/components/use-cases/detail/intake-details.tsx": {
    reason: "«Proposto da» ed «Email indicata», solo per chi gestisce il workspace",
  },
  "src/lib/db/queries/use-case-hub.ts": {
    reason: `solo la funzione ${MANAGER_PROJECTION}, la proiezione di chi gestisce il workspace`,
    regions: (source, file) => topLevelDeclarations(source, file, MANAGER_PROJECTION),
  },
  "src/lib/use-cases/service.ts": {
    reason: "solo la lista di colonne dell'INSERT INTO use_cases",
    regions: (source, file) => insertIntoUseCasesColumns(source, file),
  },
  "src/lib/use-cases/types.ts": {
    reason: "solo NewUseCaseInput, il tipo dell'input di creazione",
    regions: (source, file) => topLevelDeclarations(source, file, "NewUseCaseInput"),
  },
  "scripts/use-case-admin/origin.ts": { reason: "risolve l'origine dei dati esistenti (DESIGN §10.7)" },
  "scripts/use-case-admin/dossier-links.ts": { reason: "le schede madri dei dossier orfani (DESIGN §10.9)" },
};

const SOURCE = /\.(ts|tsx|mjs|js|cjs)$/;
const TEST_FILE = /\.test\.(ts|tsx|mjs|js|cjs)$/;

const PERSON_FIELD = /proposed_?by|submitter_?email|submitted_?by_?user_?id/gi;
const PERSON_COLUMN = /proposed_?by|actor_?user_?id/i;
const CLAUSE_END = /\b(limit|offset|having|union|returning|window|fetch|select|from|where)\b/i;

function walk(dir: string, out: string[]) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs)) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (SOURCE.test(entry) && !TEST_FILE.test(entry)) out.push(rel);
  }
}

function scannedFiles(): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) walk(dir, out);
  for (const { dir, name } of SCAN_FILES) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs)) {
      const rel = `${dir}/${entry}`;
      if (name.test(entry) && !TEST_FILE.test(entry) && statSync(join(ROOT, rel)).isFile()) out.push(rel);
    }
  }
  return [...new Set(out)].sort();
}

// ─── Struttura del sorgente (parser di TypeScript) ──────────────────

function parse(source: string, file: string): ts.SourceFile {
  const kind = file.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : /\.(mjs|cjs|js)$/.test(file)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

function forEachNode(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  node.forEachChild((child) => forEachNode(child, visit));
}

function isTemplate(node: ts.Node): node is ts.TemplateLiteral {
  return ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
}

/** Il testo di un template, backtick compresi, con le interpolazioni `${…}` coperte da spazi. */
function literalText(node: ts.TemplateLiteral, sf: ts.SourceFile): { start: number; text: string } {
  const start = node.getStart(sf);
  let text = node.getText(sf);
  if (ts.isTemplateExpression(node)) {
    let open = node.head.getEnd() - 2;
    for (const span of node.templateSpans) {
      const close = span.literal.getStart(sf) + 1;
      text = text.slice(0, open - start) + " ".repeat(close - open) + text.slice(close - start);
      open = span.literal.getEnd() - 2;
    }
  }
  return { start, text };
}

/** Il testo con gli intervalli coperti da spazi: righe e colonne restano dove sono. */
function blank(source: string, ranges: Range[]): string {
  const chars = source.split("");
  for (const [start, end] of ranges) {
    for (let i = start; i < end; i++) if (chars[i] !== "\n") chars[i] = " ";
  }
  return chars.join("");
}

// ─── Parti ammesse dei file ammessi ─────────────────────────────────

/** Le dichiarazioni di primo livello chiamate `name` (funzione, interfaccia, tipo o `const`), firma compresa. */
function topLevelDeclarations(source: string, file: string, name: string): Range[] {
  const sf = parse(source, file);
  const ranges: Range[] = [];
  for (const statement of sf.statements) {
    const named =
      ((ts.isFunctionDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
        statement.name?.text === name) ||
      (ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.length === 1 &&
        ts.isIdentifier(statement.declarationList.declarations[0].name) &&
        statement.declarationList.declarations[0].name.text === name);
    if (named) ranges.push([statement.getStart(sf), statement.getEnd()]);
  }
  return ranges;
}

const USE_CASE_INSERT = /\binsert\s+into\s+use_cases\b/gi;
const INSERT_COLUMNS_END = /\breturning\b|\bon\s+conflict\b|\bwhere\b|\bjoin\b|;/i;

/** `db.insert(useCases).values(…)` (o `tx.`): l'INSERT nella forma Drizzle. */
function isUseCaseInsertValues(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "values") return false;
  const insert = callee.expression;
  return (
    ts.isCallExpression(insert) &&
    ts.isPropertyAccessExpression(insert.expression) &&
    insert.expression.name.text === "insert" &&
    insert.arguments.length === 1 &&
    ts.isIdentifier(insert.arguments[0]) &&
    insert.arguments[0].text === "useCases"
  );
}

/**
 * Le liste di colonne degli INSERT INTO use_cases: solo dentro i template (non nei commenti
 * né nelle stringhe), da `INSERT INTO use_cases` alla prima RETURNING, ON CONFLICT, WHERE,
 * JOIN o `;` del template, altrimenti alla sua fine; le interpolazioni in mezzo (i valori)
 * sono comprese. In più gli argomenti di `.insert(useCases).values(…)`.
 */
function insertIntoUseCasesColumns(source: string, file: string): Range[] {
  const sf = parse(source, file);
  const ranges: Range[] = [];
  forEachNode(sf, (node) => {
    if (isTemplate(node)) {
      const { start, text } = literalText(node, sf);
      for (const match of text.matchAll(USE_CASE_INSERT)) {
        const from = match.index! + match[0].length;
        const stop = text.slice(from).search(INSERT_COLUMNS_END);
        ranges.push([start + match.index!, start + (stop === -1 ? text.length - 1 : from + stop)]);
      }
    }
    if (isUseCaseInsertValues(node)) {
      for (const argument of node.arguments) ranges.push([argument.getStart(sf), argument.getEnd()]);
    }
  });
  return ranges;
}

/** Le menzioni del proponente nel testo, con il numero di riga. */
function personFields(source: string): string[] {
  const found: string[] = [];
  source.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(PERSON_FIELD)) found.push(`riga ${index + 1}: ${match[0]}`);
  });
  return found;
}

/** Le menzioni del proponente fuori dalle parti ammesse di `file`. */
function personFieldsOutsideAllowed(source: string, file: string): string[] {
  const allowed = ALLOWED[file];
  if (allowed && !allowed.regions) return [];
  return personFields(allowed?.regions ? blank(source, allowed.regions(source, file)) : source);
}

// ─── Istruzioni e livelli ───────────────────────────────────────────

type Units = { sql: Range[]; code: Range[]; jsx: Range[] };

const SQL_STATEMENT = /^`\s*\(?\s*(select|with|insert|update|delete)\b/i;

/**
 * I template SQL interi e le istruzioni di codice (catene Drizzle, query in stringa). In più
 * il JSX, dove `min(`, `max(` o `count(` sono CSS o testo (`w-[min(100vw,44rem)]`), non SQL.
 */
function unitsOf(source: string, file: string): Units {
  const sf = parse(source, file);
  const units: Units = { sql: [], code: [], jsx: [] };
  forEachNode(sf, (node) => {
    if (isTemplate(node) && SQL_STATEMENT.test(node.getText(sf))) units.sql.push([node.getStart(sf), node.getEnd()]);
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      units.jsx.push([node.getStart(sf), node.getEnd()]);
    }
    if (
      ts.isExpressionStatement(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isReturnStatement(node) ||
      ts.isThrowStatement(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isExportAssignment(node)
    ) {
      units.code.push([node.getStart(sf), node.getEnd()]);
    }
  });
  return units;
}

/** L'istruzione intorno a `index`: il template SQL più esterno, poi l'istruzione di codice più interna, poi la riga. */
function unitAt(source: string, units: Units, index: number): Range {
  const around = ([start, end]: Range) => start <= index && index < end;
  const size = ([start, end]: Range) => end - start;
  const sql = units.sql.filter(around).sort((a, b) => size(b) - size(a))[0];
  if (sql) return sql;
  const code = units.code.filter(around).sort((a, b) => size(a) - size(b))[0];
  if (code) return code;
  const end = source.indexOf("\n", index);
  return [source.lastIndexOf("\n", index - 1) + 1, end === -1 ? source.length : end];
}

/** La parentesi che chiude quella in `open`, o la fine del testo. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return text.length;
}

/** Il contenuto tra la parentesi in `open` e quella che la chiude. */
function balanced(text: string, open: number): string {
  return text.slice(open + 1, closing(text, open));
}

/**
 * Il livello di `index`: dentro la parentesi `(SELECT` o `(WITH` più vicina che lo racchiude;
 * senza, l'istruzione SQL tra i `;` fuori dalle parentesi (un template può averne più d'una).
 */
function levelAt(text: string, index: number): Range {
  let depth = 0;
  let start = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (text[i] === ")") depth++;
    else if (text[i] === "(") {
      if (depth > 0) depth--;
      else if (/^\(\s*(select|with)\b/i.test(text.slice(i, i + 200))) return [i + 1, closing(text, i)];
    } else if (text[i] === ";" && depth === 0 && start === 0) start = i + 1;
  }
  depth = 0;
  for (let i = index; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === ";" && depth <= 0) return [start, i];
  }
  return [start, text.length];
}

/** Le parti separate da virgole fuori dalle parentesi. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) depth--;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(text.slice(last));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Il resto di una clausola SQL dopo `BY`: si ferma alla parentesi che la chiude, a `;`, a un backtick o alla clausola dopo. */
function clauseTail(text: string, start: number): string {
  let depth = 0;
  let end = Math.min(text.length, start + 400);
  for (let i = start; i < end; i++) {
    const char = text[i];
    if (char === "(") depth++;
    else if (char === ")" && --depth < 0) end = i;
    else if ((char === ";" || char === "`") && depth === 0) end = i;
  }
  const tail = text.slice(start, end);
  const next = tail.search(CLAUSE_END);
  return next === -1 ? tail : tail.slice(0, next);
}

/** Le condizioni di un livello: da `WHERE`, `FILTER (`, `HAVING` o `.where(` in poi. */
function conditionsOf(level: string): string {
  const at = level.search(/\bwhere\b|\bfilter\s*\(|\bhaving\b|\.where\s*\(/i);
  return at === -1 ? "" : level.slice(at);
}

/** Vero se dopo un aggregato (da `from`, dopo la sua parentesi) viene OVER, anche dopo un FILTER (…). */
function isWindow(text: string, from: number): boolean {
  let rest = text.slice(from);
  const filter = rest.match(/^\s*filter\s*\(/i);
  if (filter) rest = rest.slice(closing(rest, filter[0].length - 1) + 1);
  return /^\s*over\b/i.test(rest);
}

type SelectItem = { expression: string; name: string | null };

/** Una voce del SELECT: l'espressione e il nome con cui la si richiama (alias, o la colonna). */
function selectItem(item: string): SelectItem {
  const aliased = item.match(/^([\s\S]+?)(?:\s+as)?\s+"?([a-z_]\w*)"?$/i);
  if (aliased && /[\w)"]$/.test(aliased[1].trim())) return { expression: aliased[1].trim(), name: aliased[2].toLowerCase() };
  const column = item.match(/(?:^|\.)"?([a-z_]\w*)"?$/i);
  return { expression: item, name: column ? column[1].toLowerCase() : null };
}

/**
 * La lista del SELECT che governa `index` (l'ultimo SELECT prima, alla stessa profondità di
 * parentesi), fino al suo FROM: per `ORDER BY 2`, `DISTINCT ON (1)` o un alias.
 */
function selectListOf(text: string, index: number): SelectItem[] {
  let depth = 0;
  let select: { at: number; depth: number } | null = null;
  const selects: Array<{ at: number; depth: number }> = [];
  for (let i = 0; i < index; i++) {
    const char = text[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (/[sS]/.test(char) && /^select\b/i.test(text.slice(i, i + 7)) && !/[\w.$]/.test(text[i - 1] ?? "")) {
      selects.push({ at: i, depth });
    }
  }
  for (const candidate of selects) if (candidate.depth === depth) select = candidate;
  if (!select) return [];
  let start = select.at + "select".length;
  const distinct = text.slice(start).match(/^\s+distinct\s+on\s*\(/i);
  if (distinct) start += distinct[0].length + balanced(text, start + distinct[0].length - 1).length + 1;
  else start += text.slice(start).match(/^\s+(distinct|all)\b/i)?.[0].length ?? 0;
  let level = 0;
  let end = index > start ? index : text.length;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "(") level++;
    else if (text[i] === ")" && --level < 0) break;
    else if (level === 0 && /^from\b/i.test(text.slice(i, i + 5)) && /\s/.test(text[i - 1])) {
      end = i;
      break;
    }
  }
  return splitTopLevel(text.slice(start, end)).map(selectItem);
}

/** Ciò a cui punta un bersaglio di ORDER BY o DISTINCT ON: la voce del SELECT per posizione o per nome. */
function resolveTarget(target: string, items: SelectItem[]): string {
  const bare = target.match(/^"?([a-z_]\w*|\d+)"?(?=\s|$)/i)?.[1];
  if (!bare) return "";
  if (/^\d+$/.test(bare)) return items[Number(bare) - 1]?.expression ?? "";
  return items
    .filter((item) => item.name === bare.toLowerCase())
    .map((item) => item.expression)
    .join(" ");
}

/** Le tabelle unite sulla persona: `JOIN users u ON u.id = e.actor_user_id` dà `u`; `.innerJoin(users, eq(…actorUserId))` dà `users`. */
function personJoins(level: string): string[] {
  const names: string[] = [];
  for (const match of level.matchAll(/\bjoin\s+(?:lateral\s+)?("?[\w.]+"?)(?:\s+(?:as\s+)?(?!on\b|using\b)("?\w+"?))?\s+on\b/gi)) {
    const after = level.slice(match.index! + match[0].length);
    const end = after.search(/\b(join|where|group|order|limit|union|window|having)\b|[;`]/i);
    if (PERSON_COLUMN.test(end === -1 ? after : after.slice(0, end))) names.push((match[2] ?? match[1]).replace(/"/g, ""));
  }
  for (const match of level.matchAll(/\.(?:inner|left|right|full|cross)Join\s*\(/gi)) {
    const [table, ...condition] = splitTopLevel(balanced(level, match.index! + match[0].length - 1));
    if (table && PERSON_COLUMN.test(condition.join(","))) names.push(table);
  }
  return names;
}

/** Vero se il testo nomina una colonna sulla persona o una colonna di una tabella unita sulla persona. */
function mentionsPerson(text: string, joins: string[]): boolean {
  return (
    PERSON_COLUMN.test(text) ||
    joins.some((name) => new RegExp(`(?<![\\w.$])${name.replace(/[.$]/g, "\\$&")}\\s*\\.`, "i").test(text))
  );
}

const GROUPING = /\bgroup\s+by\b|\.groupBy\s*\(/gi;
// Non dopo `.` (Math.max), una lettera (account) o `[` (classi Tailwind come `w-[min(…)]`).
const AGGREGATE = /(?<![\w.$[])(count|countDistinct|sum|sumDistinct|avg|avgDistinct|min|max)\s*\(/gi;
const ORDERING = /\b(order|partition)\s+by\b|\bdistinct\s+on\s*\(|\.orderBy\s*\(/gi;

/** Ordinamenti, raggruppamenti e conteggi per persona, in SQL e in Drizzle (regole in testa al file). */
function aggregationsByPerson(source: string, file = "prova.ts"): string[] {
  const units = unitsOf(source, file);
  const found: string[] = [];
  const show = (text: string) => text.replace(/\s+/g, " ").trim();
  const inside = (ranges: Range[], index: number) => ranges.some(([start, end]) => start <= index && index < end);
  /** Le occorrenze di `pattern` fuori dal JSX (salvo dentro un template SQL). */
  const matches = (pattern: RegExp) =>
    [...source.matchAll(pattern)].filter((match) => !inside(units.jsx, match.index!) || inside(units.sql, match.index!));
  /** Il livello che contiene `index` e la posizione di `index` dentro di esso. */
  const levelOf = (index: number) => {
    const [start, end] = unitAt(source, units, index);
    const unit = source.slice(start, end);
    const [from, to] = levelAt(unit, index - start);
    return { level: unit.slice(from, to), at: index - start - from };
  };

  for (const match of matches(GROUPING)) {
    const { level } = levelOf(match.index!);
    if (PERSON_COLUMN.test(level)) found.push(show(`${match[0]} nel livello: ${level}`));
  }
  for (const match of matches(AGGREGATE)) {
    const { level, at } = levelOf(match.index!);
    const open = at + match[0].length - 1;
    const args = balanced(level, open);
    const scope = isWindow(level, closing(level, open) + 1) ? `${args} ${conditionsOf(level)}` : level;
    if (PERSON_COLUMN.test(scope)) found.push(show(`${match[0]}${args}) nel livello: ${scope}`));
  }
  for (const match of matches(ORDERING)) {
    const { level, at } = levelOf(match.index!);
    const after = at + match[0].length;
    const targets = match[0].endsWith("(") ? balanced(level, after - 1) : clauseTail(level, after);
    const items = match[0].startsWith(".") ? [] : selectListOf(level, at);
    const resolved = splitTopLevel(targets)
      .map((target) => `${target} ${resolveTarget(target, items)}`.trim())
      .join(", ");
    if (mentionsPerson(resolved, personJoins(level))) found.push(show(`${match[0]} ${targets} → ${resolved}`));
  }
  return found;
}

// ─── Il controllo sui file dell'area ────────────────────────────────

test("il controllo trova i file dell'area (nessun passaggio a vuoto)", () => {
  const files = scannedFiles();
  for (const expected of ["src/lib/use-cases/types.ts", "src/lib/use-cases/rollout.ts"]) {
    assert.ok(files.includes(expected), `manca ${expected} nell'elenco controllato`);
  }
  assert.ok(!files.some((file) => TEST_FILE.test(file)), "i file di test restano fuori");
  for (const allowed of Object.keys(ALLOWED)) {
    const inScope =
      SCAN_DIRS.some((dir) => allowed.startsWith(`${dir}/`)) ||
      SCAN_FILES.some(({ dir, name }) => allowed.startsWith(`${dir}/`) && name.test(allowed.slice(dir.length + 1)));
    assert.ok(inScope, `${allowed} è ammesso ma fuori dall'area controllata`);
  }
  const types = readFileSync(join(ROOT, "src/lib/use-cases/types.ts"), "utf8");
  assert.equal(topLevelDeclarations(types, "types.ts", "NewUseCaseInput").length, 1, "types.ts ha NewUseCaseInput");
});

test("il proponente compare solo nei file e nelle parti ammesse", () => {
  const violations: string[] = [];
  for (const file of scannedFiles()) {
    const source = readFileSync(join(ROOT, file), "utf8");
    for (const hit of personFieldsOutsideAllowed(source, file)) violations.push(`${file} ${hit}`);
  }
  assert.deepEqual(violations, [], "campi sul proponente fuori dalle parti ammesse (PIANO §5.4)");
});

test("nessun ORDER BY, GROUP BY o count( per proponente o per autore, nemmeno nei file ammessi", () => {
  const violations: string[] = [];
  for (const file of scannedFiles()) {
    for (const hit of aggregationsByPerson(readFileSync(join(ROOT, file), "utf8"), file)) violations.push(`${file}: ${hit}`);
  }
  assert.deepEqual(violations, [], "metriche per persona vietate (art. 15.4)");
});

// ─── Prove del controllo stesso ─────────────────────────────────────
// Su testi inventati: se le regole si rompono, il controllo sopra passerebbe senza vedere nulla.

/** Una query SQL in un template, come la scrive l'app. */
const sqlQuery = (text: string) => `const rows = await db.execute(sql\`${text}\`);`;

test("prova del controllo: trova il proponente in ogni grafia", () => {
  for (const text of [
    "SELECT proposed_by FROM use_cases",
    "const who = row.proposedBy;",
    "intake.submitterEmail",
    "u.submitted_by_user_id",
    "submittedByUserId: row.submittedByUserId",
    "SELECT PROPOSED_BY FROM use_cases",
    "const proposedByLabel = label(row);",
  ]) {
    assert.ok(personFields(text).length > 0, text);
  }
  for (const text of ["const proposal = draft.title;", "proposto da", "status = 'proposed' AND reviewed_by IS NULL"]) {
    assert.deepEqual(personFields(text), [], text);
  }
});

test("prova del controllo: in service.ts vale solo la lista di colonne dell'INSERT INTO use_cases", () => {
  const service = "src/lib/use-cases/service.ts";
  const outside = (text: string) => personFieldsOutsideAllowed(text, service);

  // Ammessi: la lista di colonne e i valori, nelle forme che il servizio può usare.
  const recordset = [
    "const rows = JSON.stringify(items);",
    "await db.execute(sql`INSERT INTO use_cases (id, title, proposed_by)",
    "  SELECT r.id, r.title, r.\"proposedBy\"",
    "  FROM jsonb_to_recordset(${rows}::jsonb) AS r(id uuid, title text, \"proposedBy\" varchar)",
    "  ON CONFLICT (id) DO NOTHING`);",
  ].join("\n");
  assert.deepEqual(outside(recordset), []);
  assert.equal(blank(recordset, insertIntoUseCasesColumns(recordset, service)).split("\n").length, 5, "le righe restano");
  const nested = [
    "await db.execute(sql`INSERT INTO use_cases (id, proposed_by)",
    "  VALUES ${sql.join(items.map((r) => sql`(${r.id}, ${r.proposedBy})`), sql`, `)}`);",
  ].join("\n");
  assert.deepEqual(outside(nested), []);
  assert.deepEqual(outside("await tx.insert(useCases).values({ id, title, proposedBy: input.proposedBy });"), []);

  // Il resto del file resta controllato: letture, RETURNING, condizioni, aggiornamenti, commenti e stringhe.
  assert.deepEqual(outside("await db.execute(sql`SELECT id, proposed_by FROM use_cases WHERE id = ${id}`);"), [
    "riga 1: proposed_by",
  ]);
  assert.deepEqual(outside("const row = { title: item.title, proposed_by: item.proposedBy };"), [
    "riga 1: proposed_by",
    "riga 1: proposedBy",
  ]);
  assert.deepEqual(
    outside("await db.execute(sql`INSERT INTO use_cases (id, title, proposed_by) VALUES (${id}, ${title}, ${who}) RETURNING id, proposed_by`);"),
    ["riga 1: proposed_by"],
  );
  assert.deepEqual(
    outside("await db.execute(sql`INSERT INTO use_cases (id, title) SELECT id, title FROM use_cases WHERE proposed_by = ${who}`);"),
    ["riga 1: proposed_by"],
  );
  assert.deepEqual(
    outside(
      "await db.execute(sql`INSERT INTO use_cases (id, proposed_by) VALUES (${id}, ${who}) ON CONFLICT (id) DO UPDATE SET proposed_by = excluded.proposed_by`);",
    ),
    ["riga 1: proposed_by", "riga 1: proposed_by"],
  );
  const comment = [
    "/** Scrive con un solo INSERT INTO use_cases (vedi sotto). */",
    "export async function read(id: string) {",
    "  return { who: row.proposedBy, mail: row.intake.submitterEmail };",
    "}",
    "const q = sql`SELECT 1`;",
  ].join("\n");
  assert.deepEqual(outside(comment), ["riga 3: proposedBy", "riga 3: submitterEmail"]);
  const string = ['const text = "INSERT INTO use_cases (id, proposed_by) VALUES ($1, $2)";', "const who = row.proposedBy;"].join("\n");
  assert.deepEqual(outside(string), ["riga 1: proposed_by", "riga 2: proposedBy"]);
  assert.deepEqual(outside("await db.insert(useCases).values({ id, proposedBy: who }).returning({ who: useCases.proposedBy });"), [
    "riga 1: proposedBy",
  ]);
  assert.deepEqual(outside("await db.insert(useCaseEvents).values({ proposedBy: who });"), ["riga 1: proposedBy"]);
});

test("prova del controllo: in types.ts vale solo NewUseCaseInput, in use-case-hub.ts solo projectForManager", () => {
  const types = [
    "/** Il tipo dell'input di creazione. */",
    "export interface NewUseCaseInput {",
    "  /** Chi propone. */",
    "  proposedBy?: string | null;",
    "}",
    "export interface ReviewerUseCase {",
    "  proposedBy: string | null;",
    "}",
  ].join("\n");
  assert.deepEqual(personFieldsOutsideAllowed(types, "src/lib/use-cases/types.ts"), ["riga 7: proposedBy"]);

  const hub = "src/lib/db/queries/use-case-hub.ts";
  const projections = [
    `export function ${MANAGER_PROJECTION}(row: Row): ReviewerUseCase & { proposedBy: string | null } {`,
    "  return { ...projectForReviewer(row), proposedBy: row.proposedBy, submitterEmail: row.intake.submitterEmail };",
    "}",
    "export function projectForReviewer(row: Row) {",
    "  return { id: row.id, who: row.proposedBy };",
    "}",
  ].join("\n");
  assert.deepEqual(personFieldsOutsideAllowed(projections, hub), ["riga 5: proposedBy"]);
  assert.deepEqual(personFieldsOutsideAllowed(`const ${MANAGER_PROJECTION} = (row: Row) => ({ proposedBy: row.proposedBy });`, hub), []);
  assert.deepEqual(personFieldsOutsideAllowed("const rows = await db.select({ who: useCases.proposedBy }).from(useCases);", hub), [
    "riga 1: proposedBy",
  ]);

  assert.deepEqual(personFieldsOutsideAllowed("const who = row.proposedBy;", "src/lib/use-cases/permissions.ts"), []);
});

test("prova del controllo: trova ordinamenti, raggruppamenti e conteggi per persona", () => {
  for (const text of [
    // Diretti
    sqlQuery("SELECT proposed_by, count(*) FROM use_cases GROUP BY proposed_by"),
    sqlQuery("SELECT id FROM use_cases ORDER BY u.proposed_by DESC LIMIT 5"),
    sqlQuery("SELECT id FROM use_cases ORDER BY lower(proposed_by), created_at"),
    sqlQuery("SELECT COUNT(DISTINCT actor_user_id) FROM use_case_events"),
    sqlQuery("SELECT count( e.actor_user_id ) FROM use_case_events e"),
    sqlQuery("SELECT id, row_number() OVER (PARTITION BY proposed_by ORDER BY created_at) FROM use_cases"),
    sqlQuery("SELECT x FROM t\nGROUP BY\n  t.workspace_id,\n  t.actor_user_id"),
    // Per posizione o per alias
    sqlQuery("SELECT proposed_by, count(*) FROM use_cases GROUP BY 1 ORDER BY 2 DESC"),
    sqlQuery("SELECT proposed_by AS who, count(*) AS n FROM use_cases WHERE workspace_id = $1 GROUP BY who"),
    sqlQuery("SELECT actor_user_id, count(*) FROM use_case_events GROUP BY 1 ORDER BY 2 DESC"),
    sqlQuery("SELECT e.actor_user_id AS who, count(*) AS n FROM use_case_events e GROUP BY who ORDER BY n DESC"),
    sqlQuery("SELECT proposed_by, title FROM use_cases ORDER BY 1"),
    sqlQuery("SELECT e.actor_user_id who, e.at FROM use_case_events e ORDER BY who"),
    sqlQuery("SELECT DISTINCT ON (proposed_by) id FROM use_cases"),
    sqlQuery("SELECT DISTINCT ON (1) proposed_by, id FROM use_cases"),
    sqlQuery("WITH t AS (SELECT proposed_by AS who FROM use_cases) SELECT who, count(*) FROM t GROUP BY who"),
    // Con un JOIN sulla persona
    sqlQuery("SELECT u.name, count(*) FROM use_case_events e JOIN users u ON u.id = e.actor_user_id GROUP BY u.name"),
    sqlQuery("SELECT u.email, count(*) FROM use_cases c JOIN users u ON u.email = c.proposed_by GROUP BY u.email"),
    sqlQuery("SELECT e.at FROM use_case_events e JOIN users u ON u.id = e.actor_user_id ORDER BY u.name"),
    sqlQuery("SELECT row_number() OVER (PARTITION BY u.name ORDER BY e.at) FROM use_case_events e JOIN users u ON u.id = e.actor_user_id"),
    // Filtrati sulla persona
    sqlQuery("SELECT count(*) FROM use_cases WHERE proposed_by = $1"),
    sqlQuery("SELECT count(*) FILTER (WHERE e.actor_user_id = $2) FROM use_case_events e"),
    sqlQuery("SELECT max(created_at) FROM use_cases WHERE proposed_by = $1"),
    sqlQuery("SELECT c.id, (SELECT count(*) FROM use_cases x WHERE x.proposed_by = c.proposed_by) AS n FROM use_cases c"),
    sqlQuery("SELECT kind, count(*) FROM use_cases WHERE id IN (SELECT id FROM use_cases WHERE proposed_by = $1) GROUP BY kind"),
    sqlQuery("SELECT 1; SELECT proposed_by, count(*) FROM use_cases GROUP BY 1"),
    // Drizzle
    "const rows = await db.select().from(useCases).orderBy(desc(useCases.proposedBy));",
    "const rows = await db.select().from(useCaseEvents).groupBy(useCaseEvents.actorUserId);",
    "const rows = await db.select({ n: countDistinct(useCaseEvents.actorUserId) }).from(useCaseEvents);",
    "const rows = await db.select({ n: count() }).from(useCases).where(eq(useCases.proposedBy, who));",
    "const rows = await db.select({ n: sql<number>`count(*)` }).from(useCases).where(eq(useCases.proposedBy, who));",
    "const rows = await db.select({ who: useCaseEvents.actorUserId, n: sql<number>`count(*)` }).from(useCaseEvents).groupBy(sql`1`);",
    "const rows = await db.select({ who: users.name, n: count() }).from(useCaseEvents).innerJoin(users, eq(users.id, useCaseEvents.actorUserId)).groupBy(users.name);",
    "const rows = await db.select().from(useCaseEvents).leftJoin(users, eq(users.id, useCaseEvents.actorUserId)).orderBy(users.name);",
  ]) {
    assert.ok(aggregationsByPerson(text).length > 0, text);
  }
  // Una query in stringa, come negli script .mjs con pg.
  const script = 'const { rows } = await client.query("SELECT proposed_by, count(*) FROM use_cases GROUP BY 1");';
  assert.ok(aggregationsByPerson(script, "scripts/use-case-admin/x.mjs").length > 0, script);
});

test("prova del controllo: lascia passare ordinamenti e conteggi che non guardano la persona", () => {
  for (const text of [
    sqlQuery("SELECT id FROM use_cases WHERE workspace_id = $1 ORDER BY created_at DESC"),
    sqlQuery("SELECT u.proposed_by, count(*) OVER () AS total FROM use_cases u WHERE u.workspace_id = $1"),
    sqlQuery("SELECT title FROM use_cases ORDER BY title LIMIT 10 OFFSET 0"),
    sqlQuery("SELECT count(*) AS n, workspace_id FROM use_case_events GROUP BY workspace_id"),
    // La Storia, ordinata per data, con chi ha agito
    sqlQuery("SELECT e.at, e.action, e.actor_user_id FROM use_case_events e WHERE e.use_case_id = $1 ORDER BY e.at DESC"),
    sqlQuery(
      "SELECT e.at, u.name FROM use_case_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.use_case_id = $1 ORDER BY e.at DESC, 1",
    ),
    sqlQuery(
      "SELECT c.id, (SELECT jsonb_agg(jsonb_build_object('at', e.at, 'by', e.actor_user_id) ORDER BY e.at) FROM use_case_events e WHERE e.use_case_id = c.id) AS history FROM use_cases c",
    ),
    // Il proponente accanto a conteggi e date per scheda, in una sottoquery
    sqlQuery("SELECT c.id, c.proposed_by, (SELECT count(*) FROM use_case_events x WHERE x.use_case_id = c.id) AS changes FROM use_cases c WHERE c.id = $1"),
    sqlQuery("SELECT e.actor_user_id, (SELECT max(at) FROM use_case_events x WHERE x.use_case_id = e.use_case_id) AS last FROM use_case_events e"),
    sqlQuery("SELECT e.actor_user_id, (SELECT at FROM use_case_events ORDER BY at DESC LIMIT 1) AS last FROM use_case_events e"),
    // Istruzioni separate
    "await db.execute(sql`SELECT id FROM use_cases ORDER BY code`); const who = row.proposedBy;",
    "const rows = await db.select().from(useCases).orderBy(desc(useCases.createdAt)); const x = { proposedBy: row.proposedBy };",
    "const n = await db.execute(sql`SELECT count(*) FROM use_cases WHERE workspace_id = ${id}`); const who = row.proposedBy;",
    "const Q = { byKind: sql`SELECT kind, count(*) FROM use_cases GROUP BY kind`, detail: sql`SELECT id, proposed_by FROM use_cases WHERE id = $1` };",
    sqlQuery("UPDATE use_cases SET origin = 'adoption' WHERE proposed_by IS NOT NULL; SELECT kind, count(*) FROM use_cases GROUP BY kind"),
    // Drizzle: la Storia per data; Math.max non è un aggregato
    "const rows = await db.select({ at: useCaseEvents.at, who: users.name }).from(useCaseEvents).leftJoin(users, eq(users.id, useCaseEvents.actorUserId)).where(eq(useCaseEvents.useCaseId, id)).orderBy(desc(useCaseEvents.at));",
    "const width = Math.max(row.proposedBy.length, 3);",
    'const panel = cn("w-[min(100vw,44rem)]", row.proposedBy ? "pt-2" : "pt-0");',
    // Un'istruzione dentro un callback conta da sola, non con l'istruzione che la contiene.
    [
      "const results = await Promise.all(items.map(async (item) => {",
      "  const [row] = await db.select({ n: count() }).from(useCases).where(eq(useCases.workspaceId, item.workspaceId));",
      "  return { n: row.n, who: item.proposedBy };",
      "}));",
    ].join("\n"),
  ]) {
    assert.deepEqual(aggregationsByPerson(text), [], text);
  }
  // In un componente: CSS e testo nel JSX non sono aggregati.
  const component = [
    "export function IntakeDetails({ row }: { row: Row }) {",
    '  return <div className="w-[min(100vw,44rem)]" style={{ width: "max(10rem, 50%)" }}>{row.proposedBy} (count(1))</div>;',
    "}",
  ].join("\n");
  assert.deepEqual(aggregationsByPerson(component, "src/components/use-cases/detail/intake-details.tsx"), [], component);
});
