import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// Le regole di «Contesto» che valgono su tutto il codice (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §11.2): chi legge la
// tesi del valore, chi tocca le tabelle `context_*`, dove può comparire l'indirizzo di Granola. Si leggono i sorgenti.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** I sorgenti .ts e .tsx sotto src/, test compresi. */
function sourceFiles(): string[] {
  return (readdirSync(new URL("src/", ROOT), { recursive: true }) as string[])
    .map((file) => `src/${file.split("\\").join("/")}`)
    .filter((file) => /\.(ts|tsx)$/.test(file));
}
const ALL = sourceFiles();
const isTest = (file: string) => /\.test\.tsx?$/.test(file) || file.endsWith("-test-kit.ts");
const CODE = ALL.filter((file) => !isTest(file));

test("i sorgenti ci sono", () => {
  assert.ok(ALL.length > 500, `${ALL.length} file`);
  assert.ok(CODE.includes("src/lib/db/queries/value-thesis.ts"));
});

// ─── La tesi del valore sta sul workspace (§10.1) ────────────────────

/** Dove la colonna può comparire per nome: la colonna dell'organizzazione nello schema, le due funzioni, il DDL. */
const THESIS_COLUMN_ALLOWED = new Set(["src/lib/db/schema.ts", "src/lib/db/queries/value-thesis.ts", "src/lib/db/context-ddl.ts"]);
/** Una lettura (o una scrittura) della tesi dell'organizzazione: `org?.companyValueThesis`, `organizations.companyValueThesis`. */
const ORG_THESIS = /\b(?:org|organization|organizations)\??\.companyValueThesis\b/;

test("`company_value_thesis` compare solo nello schema, nelle due funzioni della tesi e nel DDL", () => {
  for (const file of CODE) {
    if (read(file).includes("company_value_thesis")) assert.ok(THESIS_COLUMN_ALLOWED.has(file), `${file}: la colonna si legge e si scrive solo da value-thesis.ts`);
  }
  for (const file of THESIS_COLUMN_ALLOWED) assert.ok(read(file).includes("company_value_thesis"), file);
  // La tabella Drizzle `workspaces` non dichiara la colonna (context-ddl.test.ts lo prova sulle colonne).
  assert.equal(read("src/lib/db/schema.ts").match(/jsonb\("company_value_thesis"\)/g)?.length, 1, "nello schema solo la colonna dell'organizzazione");
});

test("nessuno legge più la tesi dell'organizzazione: ogni lettura passa da getWorkspaceValueThesis", () => {
  for (const file of CODE) {
    assert.doesNotMatch(read(file), ORG_THESIS, `${file}: legge la tesi dell'organizzazione; usa getWorkspaceValueThesis(workspaceId)`);
  }
  // Il vecchio indirizzo di «Contesto» è solo un reindirizzamento: la pagina nuova legge la tesi con loadLiveDiscovery.
  const oldPage = read("src/app/(dashboard)/dashboard/[workspaceId]/setup/context/page.tsx");
  assert.doesNotMatch(oldPage, /ValueThesis/);
  assert.match(oldPage, /redirect\(`\/dashboard\/\$\{workspaceId\}\/contesto`\)/);
  // I lettori: tutti dalla funzione, con il workspace della richiesta (F, poi la chat e la barra della Discovery di «mcp»).
  const readers: Readonly<Record<string, RegExp>> = {
    // (Rilascio insieme) «Completo mapping» classifica con il completamento della board (mappatura board): la tesi la
    // legge lui, caricando il modulo quando serve.
    "src/lib/mappatura/complete.ts": /getWorkspaceValueThesis\(workspaceId\)/,
    "src/lib/use-cases/create-flow.ts": /getWorkspaceValueThesis\(ctx\.workspaceId\)/,
    "src/lib/actions/reports.ts": /await getWorkspaceValueThesis\(workspaceId\)/,
    "src/lib/actions/value-map.ts": /await getWorkspaceValueThesis\(workspaceId\)/,
    "src/lib/actions/classify.ts": /await getWorkspaceValueThesis\(workspaceId\)/,
    "src/lib/actions/strategy.ts": /await getWorkspaceValueThesis\(workspaceId\)/,
    "src/lib/actions/simulation.ts": /await getWorkspaceValueThesis\(workspaceId\)/,
    "src/lib/db/queries/context-discovery.ts": /getWorkspaceValueThesis\(workspace\.id\)/,
    "src/app/api/ai/chat/route.ts": /await getWorkspaceValueThesis\(workspaceId\)/,
    "src/app/api/workspaces/[workspaceId]/sidebar-data/route.ts": /getWorkspaceValueThesis\(workspaceId\)/,
  };
  for (const [file, pattern] of Object.entries(readers)) {
    const source = read(file);
    assert.match(source, pattern, file);
    assert.match(source, /(?:from |import\()"@\/lib\/db\/queries\/value-thesis"/, file);
    assert.doesNotMatch(source, /\borganizations\b/, `${file}: non serve più la tabella delle organizzazioni`);
  }
  // La Discovery scrive sul workspace: il tool non tocca più `organizations`.
  const tools = read("src/lib/ai/tools/leadership-tools.ts");
  assert.match(tools, /await saveWorkspaceValueThesis\(workspaceId, thesis\)/);
  assert.doesNotMatch(tools, /\borganizations\b/);
  assert.match(tools, /export function getLeadershipTools\(workspaceId: string, organizationId: string, opts:/, "la firma non cambia");
});

// ─── Le tabelle `context_*` (§3) ─────────────────────────────────────

/** I soli moduli che toccano le tabelle di «Contesto»: le funzioni condivise, la tesi, lo schema e il DDL. */
const TABLE_OWNERS = /^src\/lib\/db\/(queries\/(context-[a-z-]+|value-thesis)\.ts|schema\.ts|context-ddl\.ts|ensure-schema\.ts)$/;
/** Un import con i nomi importati e da dove. */
const NAMED_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g;
/** Vero se l'import di `file` punta allo schema Drizzle (`src/lib/db/schema.ts`), con l'alias o con un percorso relativo. */
function isDbSchemaImport(file: string, specifier: string): boolean {
  if (specifier === "@/lib/db/schema") return true;
  if (!specifier.startsWith(".")) return false;
  const resolved = new URL(specifier, new URL(file, "file:///repo/")).pathname.replace(/^\/repo\//, "").replace(/\.ts$/, "");
  return resolved === "src/lib/db/schema";
}
const CONTEXT_TABLE_SQL = /\bcontext_(?:sources|facts|fact_links|entities|relations|commitments|questions|proposals|events|seen|briefs|granola_[a-z_]+)\b/;

test("le tabelle `context*` dello schema le importano solo le funzioni di src/lib/db/queries/context-*.ts", () => {
  let checked = 0;
  for (const file of CODE) {
    const source = read(file);
    for (const match of source.matchAll(NAMED_IMPORT)) {
      if (!isDbSchemaImport(file, match[2])) continue;
      checked += 1;
      const names = match[1].split(",").map((name) => name.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
      const tables = names.filter((name) => /^context[A-Z]/.test(name));
      if (tables.length > 0) assert.ok(TABLE_OWNERS.test(file), `${file} importa ${tables.join(", ")}: passa dalle funzioni di context-*.ts`);
    }
  }
  assert.ok(checked >= 80, `${checked} import dallo schema controllati`);
  assert.ok(TABLE_OWNERS.test("src/lib/db/queries/context-sources.ts") && TABLE_OWNERS.test("src/lib/db/queries/context-granola.ts"));
  assert.equal(TABLE_OWNERS.test("src/lib/actions/context.ts"), false);
});

test("pagine, rotte, azioni, componenti e MCP non scrivono SQL sulle tabelle `context_*`", () => {
  const outer = CODE.filter((file) => /^src\/(app|components|lib\/actions|lib\/use-cases)\//.test(file));
  assert.ok(outer.length > 300);
  for (const file of outer) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.equal(CONTEXT_TABLE_SQL.test(code), false, `${file}: le tabelle di «Contesto» si leggono e si scrivono dalle funzioni di context-*.ts`);
  }
});

// ─── Le rotte di «Contesto» (§3.5) ───────────────────────────────────

/** Una rotta di `/api/context/…`: le rotte del cron e del ritorno da Granola stanno altrove, con il loro controllo. */
const CONTEXT_ROUTE = /^src\/app\/api\/context\/(?:.+\/)?route\.ts$/;

test("ogni rotta sotto /api/context/ comincia da chi chiama: contextActorFromSession", () => {
  assert.ok(CONTEXT_ROUTE.test("src/app/api/context/[workspaceId]/sources/route.ts"));
  assert.ok(CONTEXT_ROUTE.test("src/app/api/context/[workspaceId]/sources/[sourceId]/read/route.ts"));
  assert.equal(CONTEXT_ROUTE.test("src/app/api/cron/contesto/route.ts"), false);
  assert.equal(CONTEXT_ROUTE.test("src/app/api/context/[workspaceId]/sources/handler.ts"), false);
  for (const file of CODE.filter((path) => CONTEXT_ROUTE.test(path))) {
    const source = read(file);
    assert.match(source, /\bcontextActorFromSession\(/, `${file}: senza sessione 401, senza accesso 404 (contextActorFromSession)`);
    assert.match(source, /from "@\/lib\/context\/server\/actor"/, file);
  }
  // Il cron non ha una sessione: passa dal segreto, e risponde 404 nelle anteprime.
  const cron = read("src/app/api/cron/contesto/route.ts");
  assert.match(cron, /checkCronAuthorization\(request\.headers\.get\("authorization"\), process\.env\.CRON_SECRET\)/);
  assert.match(cron, /process\.env\.VERCEL_ENV === "preview"/);
  assert.equal(cron.includes("`Bearer ${process.env.CRON_SECRET}`"), false, "un segreto assente rifiuta sempre");
});

// ─── Granola: un solo posto per gli indirizzi, solo strumenti di lettura (§8.2, §8.4, §8.10) ──

// Il dominio e i nomi qui sotto si compongono a pezzi: questo file non deve contenerli per intero.
const GRANOLA_DOMAIN = ["granola", "ai"].join(".");
const GRANOLA_ENDPOINTS_FILE = "src/lib/context/granola/endpoints.ts";
const tool = (...words: string[]) => words.join("_");
/** Gli strumenti dell'MCP di Granola che scrivono, o che fanno qualcosa nell'account: nel codice non hanno un nome. */
const GRANOLA_WRITE_TOOLS = [
  tool("update", "private", "notes"),
  tool("create", "folder"),
  tool("update", "folder"),
  tool("add", "note", "to", "folder"),
  tool("remove", "note", "from", "folder"),
  tool("create", "meeting", "note", "from", "transcript"),
  tool("generate", "summary"),
  tool("give", "feedback"),
  tool("sign", "out"),
];

test("l'indirizzo di Granola compare in un solo file di src/; nessun test usa gli indirizzi veri", () => {
  assert.equal(GRANOLA_DOMAIN.length, 10);
  for (const file of ALL) {
    if (read(file).includes(GRANOLA_DOMAIN)) assert.equal(file, GRANOLA_ENDPOINTS_FILE, `${file}: l'indirizzo di Granola sta solo in ${GRANOLA_ENDPOINTS_FILE}`);
  }
  // I test passano gli indirizzi del server finto (127.0.0.1): mai quelli veri.
  for (const file of ALL.filter(isTest)) {
    for (const match of read(file).matchAll(NAMED_IMPORT)) {
      const names = match[1].split(",").map((name) => name.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
      assert.equal(names.includes("GRANOLA_ENDPOINTS"), false, `${file}: un test non importa GRANOLA_ENDPOINTS`);
    }
  }
});

test("gli strumenti di Granola che scrivono non hanno un nome in src/", () => {
  assert.equal(GRANOLA_WRITE_TOOLS.length, 9);
  assert.ok(GRANOLA_WRITE_TOOLS.every((name) => /^[a-z]+(_[a-z]+)+$/.test(name)));
  for (const file of ALL) {
    const source = read(file);
    for (const name of GRANOLA_WRITE_TOOLS) {
      assert.equal(new RegExp(`\\b${name}\\b`).test(source), false, `${file}: «${name}» è uno strumento di Granola che scrive; Unbundle legge soltanto`);
    }
  }
});
