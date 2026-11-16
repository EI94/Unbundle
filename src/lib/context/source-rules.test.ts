import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

// Le regole di «Contesto» che valgono su tutto il codice (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §11.2): chi legge la
// tesi del valore, chi tocca le tabelle `context_*`, dove può comparire l'indirizzo di Granola. Si leggono i sorgenti.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const exists = (path: string) => existsSync(new URL(path, ROOT));

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
/**
 * I tre file che leggono ancora la tesi dell'organizzazione alla testa di F: li spostano i pacchetti «mcp» e «pagina»
 * (§10.1). Chi integra toglie da qui ogni file già spostato: l'elenco deve finire vuoto.
 */
const MOVED_BY_OTHER_PACKAGES: Readonly<Record<string, "mcp" | "pagina">> = {
  "src/app/api/ai/chat/route.ts": "mcp",
  "src/app/api/workspaces/[workspaceId]/sidebar-data/route.ts": "mcp",
  "src/app/(dashboard)/dashboard/[workspaceId]/setup/context/page.tsx": "pagina",
};

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
    if (!ORG_THESIS.test(read(file))) continue;
    assert.ok(Object.hasOwn(MOVED_BY_OTHER_PACKAGES, file), `${file}: legge la tesi dell'organizzazione; usa getWorkspaceValueThesis(workspaceId)`);
  }
  for (const file of Object.keys(MOVED_BY_OTHER_PACKAGES)) assert.ok(exists(file), `${file} non c'è più: toglilo dall'elenco`);
  // I lettori di F: tutti dalla funzione, con il workspace della richiesta.
  const readers: Readonly<Record<string, RegExp>> = {
    "src/lib/ai/tools/activity-mapping-tools.ts": /await getWorkspaceValueThesis\(workspaceId\)/,
    "src/lib/use-cases/create-flow.ts": /getWorkspaceValueThesis\(ctx\.workspaceId\)/,
    "src/lib/actions/reports.ts": /await getWorkspaceValueThesis\(workspaceId\)/,
    "src/lib/actions/value-map.ts": /await getWorkspaceValueThesis\(workspaceId\)/,
    "src/lib/actions/classify.ts": /await getWorkspaceValueThesis\(workspaceId\)/,
    "src/lib/actions/strategy.ts": /await getWorkspaceValueThesis\(workspaceId\)/,
    "src/lib/actions/simulation.ts": /await getWorkspaceValueThesis\(workspaceId\)/,
  };
  for (const [file, pattern] of Object.entries(readers)) {
    const source = read(file);
    assert.match(source, pattern, file);
    assert.match(source, /from "@\/lib\/db\/queries\/value-thesis"/, file);
    assert.doesNotMatch(source, /\borganizations\b/, `${file}: non serve più la tabella delle organizzazioni`);
  }
  // La Discovery scrive sul workspace: il tool non tocca più `organizations`.
  const tools = read("src/lib/ai/tools/leadership-tools.ts");
  assert.match(tools, /await saveWorkspaceValueThesis\(workspaceId, thesis\)/);
  assert.doesNotMatch(tools, /\borganizations\b/);
  assert.match(tools, /export function getLeadershipTools\(workspaceId: string, organizationId: string, opts:/, "la firma non cambia");
});
