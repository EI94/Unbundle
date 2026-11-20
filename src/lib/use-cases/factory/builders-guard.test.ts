import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Le prove di guardia della 8.0c (RILASCIO-8.0c-ESTERNI.md §8, U5): un elenco solo di chi costruisce, un predicato solo.
// - Nessuna copia dell'elenco dei ruoli di Lateral Space che costruiscono nei moduli della fabbrica fuori da
//   `builders.ts` (e dal DDL della 0035): un modulo che ne tiene una sua dimentica chi costruisce da fuori, e la persona
//   vede la voce per poi ricevere 403.
// - `use_case_external_builders` la legge e la scrive solo `use-case-builders.ts`.
// - Le altre due (i ruoli della fabbrica fuori dal dossier, CASE_ROLES senza resti) stanno in builders.test.ts.

const root = fileURLToPath(new URL("../../../../", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.(ts|tsx|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

const rel = (path: string) => relative(root, path).split("\\").join("/");

/** I moduli della fabbrica: CLI, MCP del caso, compiti, proposte, GitHub, evals, pagine e azioni dell'Agent Factory. */
const FACTORY_DIRS = [
  "src/lib/use-cases/factory",
  "src/lib/use-cases/cli",
  "src/app/api/cli",
  "src/app/api/github",
  "src/components/agent-factory",
  "src/app/(dashboard)/dashboard/[workspaceId]/agent-factory",
  "src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/costruzione",
  "src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/progetto",
];
const FACTORY_FILES = [
  "src/lib/db/queries/use-case-factory.ts",
  "src/lib/db/queries/use-case-factory-line.ts",
  "src/lib/db/queries/use-case-tasks.ts",
  "src/lib/db/queries/use-case-tasks-notices.ts",
  "src/lib/db/queries/use-case-task-proposals.ts",
  "src/lib/db/queries/use-case-github.ts",
  "src/lib/db/queries/use-case-evals.ts",
  "src/lib/db/queries/use-case-builders.ts",
  "src/lib/db/queries/use-case-workspace-team.ts",
  "src/lib/db/queries/use-case-cli-auth.ts",
  "src/lib/actions/use-case-factory.ts",
  "src/lib/actions/use-case-workspace-team.ts",
];

const factoryModules = () => [...FACTORY_DIRS.flatMap((dir) => walk(join(root, dir))), ...FACTORY_FILES.map((file) => join(root, file))];

/** I tre ruoli di Lateral Space uno dopo l'altro, in un array di TypeScript o in un elenco SQL. */
const LS_LIST = /ls_lead["']?\s*,\s*["']?ls_analista["']?\s*,\s*["']?ls_sviluppatore/;

test("U5: nessuna copia dell'elenco di chi costruisce nei moduli della fabbrica, fuori da builders.ts", () => {
  const allowed = new Set(["src/lib/use-cases/factory/builders.ts"]);
  const files = factoryModules();
  assert.ok(files.length > 40, `${files.length} moduli`);
  for (const file of files) {
    const name = rel(file);
    if (allowed.has(name)) continue;
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, LS_LIST, `${name}: usa FACTORY_BUILDER_ROLES o builderMembersSql`);
    assert.doesNotMatch(text, /\bLS_CASE_ROLES\b/, `${name}: l'elenco dei ruoli di Lateral Space sta in builders.ts`);
    assert.doesNotMatch(text, /(?<![A-Z_])BUILDER_ROLES\b/, `${name}: BUILDER_ROLES non c'è più`);
  }
  // Il DDL della 0035 (il team di Lateral Space) tiene il suo CHECK, che non cambia.
  assert.match(readFileSync(join(root, "src/lib/db/use-case-hub-team-ddl.ts"), "utf8"), LS_LIST);
});

test("U5: la tabella delle concessioni la legge e la scrive solo use-case-builders.ts (un predicato solo)", () => {
  const allowed = new Set([
    "src/lib/db/queries/use-case-builders.ts",
    // Il DDL della 0037 e la tabella di Drizzle (solo la forma: nessuna query).
    "src/lib/db/use-case-hub-builders-ddl.ts",
    "src/lib/db/schema.ts",
    // (0038, rilascio 9a) Il DDL di «Contesto» controlla solo che la 0037 ci sia (`to_regclass`): nessuna query.
    "src/lib/db/context-ddl.ts",
  ]);
  const files = walk(join(root, "src"));
  assert.ok(files.length > 500);
  const users = files.filter((file) => /use_case_external_builders|useCaseExternalBuilders/.test(readFileSync(file, "utf8"))).map(rel);
  assert.deepEqual(users.filter((name) => !allowed.has(name)), []);
  // Il DDL della 0038 la nomina in una riga sola: il controllo che la 0037 ci sia.
  assert.deepEqual(readFileSync(join(root, "src/lib/db/context-ddl.ts"), "utf8").match(/[^\n]*use_case_external_builders[^\n]*/g), [
    "  IF to_regclass('public.use_case_external_builders') IS NULL THEN",
  ]);
  // Nessuno importa la tabella di Drizzle: le query stanno in use-case-builders.ts.
  for (const file of files) {
    if (rel(file) === "src/lib/db/schema.ts") continue;
    assert.doesNotMatch(readFileSync(file, "utf8"), /\buseCaseExternalBuilders\b/, rel(file));
  }
});
