import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// «Cosa serve»: chi non è revisore non riceve esigenze da nessuna parte (spec di Pierpaolo,
// 25/10/2026: pagina, REST, MCP ed export). Controllo sul sorgente:
//
// 1. Le tabelle `use_case_needs` e `use_case_need_links` si nominano solo nello schema, nel DDL
//    della 0022, nelle letture (`queries/use-case-needs.ts`, che rispondono null a chi non è
//    revisore) e nel servizio di scrittura (`needs-service.ts`, solo i revisori). Con «Chiedi al
//    referente» (drizzle/0024) le nominano anche i moduli della funzione: le letture e le scritture
//    dei revisori e il cron (`queries/use-case-referents.ts` e le sue basi), i file, la pagina
//    pubblica del referente (`queries/use-case-referent-public.ts`: senza account, solo le domande
//    aperte della sua richiesta), i costruttori SQL condivisi (`referent/sql.ts`) e «Raccolta
//    informazioni» (`queries/use-case-info-progress.ts`, null a chi non è revisore).
// 2. Le letture le chiamano solo le pagine dell'area, che le chiedono solo con `canSeeNeeds`.
// 3. La REST (`src/app/api/`) e gli export (`…/export/route.ts`) non toccano le esigenze, con due
//    eccezioni dichiarate qui sotto (`REST_EXCEPTIONS`): la pagina pubblica del referente e il cron
//    dei referenti, che arrivano alle esigenze solo attraverso i loro moduli.
//
// 4. Il MCP del team (`list_needs`, `save_needs`) le legge da `mcp/app-deps.ts` con la persona del
//    token, riletta a ogni richiesta: le letture stesse rispondono null a chi non è revisore. La
//    prova dei permessi sul database è in `mcp/mcp.integration.test.ts`.

const root = fileURLToPath(new URL("../../..", import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      out.push(...sources(path));
    } else if (/\.(ts|tsx|mjs|cjs|js)$/.test(name) && !/\.test\.(ts|mjs)$/.test(name)) {
      out.push(relative(root, path));
    }
  }
  return out;
}

const files = [...sources(join(root, "src")), ...sources(join(root, "mcp"))].sort();
const printer = ts.createPrinter({ removeComments: true });
const cache = new Map<string, string>();
/** Il sorgente senza commenti: contano il codice e le stringhe, non quello che si racconta. */
function read(file: string): string {
  const hit = cache.get(file);
  if (hit !== undefined) return hit;
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, false, kind);
  const code = printer.printFile(source);
  cache.set(file, code);
  return code;
}

const TABLES = /\b(use_case_needs|use_case_need_links|useCaseNeeds|useCaseNeedLinks)\b/;
const TABLE_FILES = new Set([
  "src/lib/db/schema.ts",
  "src/lib/db/use-case-hub-value-ddl.ts",
  "src/lib/db/use-case-hub-referents-ddl.ts",
  "src/lib/db/queries/use-case-needs.ts",
  "src/lib/use-cases/needs-service.ts",
  // «Chiedi al referente» (SPEC §9.1, §P2.12.1).
  "src/lib/db/queries/use-case-referents.ts",
  "src/lib/db/queries/use-case-referent-base.ts",
  "src/lib/db/queries/use-case-referent-public.ts",
  "src/lib/db/queries/use-case-referent-files.ts",
  "src/lib/db/queries/use-case-info-progress.ts",
  "src/lib/use-cases/referent/sql.ts",
]);

const READS = /\b(listWorkspaceNeeds|getWorkspaceNeed|needUseCaseRefs)\b|queries\/use-case-needs/;
const READ_FILES = new Set([
  "src/lib/db/queries/use-case-needs.ts",
  "src/components/use-cases/hub.tsx",
  "src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/page.tsx",
  "src/lib/use-cases/mcp/app-deps.ts",
  // Le dipendenze dei tool (`deps.reads.needs`, `deps.reads.needUseCaseRefs`), chiamate con `principal.viewer`.
  "src/lib/use-cases/mcp/tools.ts",
]);

const NEEDS_ANYWHERE = /use_case_need|useCaseNeed|use-case-needs|needs-service|lib\/use-cases\/needs|listWorkspaceNeeds|getWorkspaceNeed|NeedView\b/;

test("le tabelle delle esigenze si nominano solo in schema, DDL, letture e servizio", () => {
  const found = files.filter((file) => TABLES.test(read(file)));
  assert.deepEqual(found.filter((file) => !TABLE_FILES.has(file)), []);
  for (const file of TABLE_FILES) assert.ok(found.includes(file), `${file} non nomina più le tabelle: aggiorna l'elenco`);
});

test("le letture delle esigenze le chiamano solo le pagine dell'area, con canSeeNeeds", () => {
  const found = files.filter((file) => READS.test(read(file)));
  assert.deepEqual(found.filter((file) => !READ_FILES.has(file)), []);
  for (const file of ["src/components/use-cases/hub.tsx", "src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/page.tsx"]) {
    const source = read(file);
    const calls = [...source.matchAll(/([\w.]+) \? (listWorkspaceNeeds|getWorkspaceNeed)\(/g)];
    assert.equal(calls.length, (source.match(/\b(listWorkspaceNeeds|getWorkspaceNeed)\(/g) ?? []).length, `${file}: ogni lettura sotto una condizione`);
    for (const [, guard, name] of calls) {
      if (guard === "abilities.canSeeNeeds") continue;
      const definition = new RegExp(`const ${guard.replace(".", "\\.")} = [^;]*abilities\\.canSeeNeeds`);
      assert.match(source, definition, `${file}: ${name} sotto ${guard}, che non passa da canSeeNeeds`);
    }
  }
  // Le letture stesse rispondono null a chi non è revisore, prima di toccare il database.
  const reads = read("src/lib/db/queries/use-case-needs.ts");
  assert.equal((reads.match(/abilitiesForUseCase\(viewer\)\.canSeeNeeds/g) ?? []).length, 3);
});

test("il MCP del team legge le esigenze con la persona del token, mai con un'altra", () => {
  const source = read("src/lib/use-cases/mcp/app-deps.ts");
  const calls = [...source.matchAll(/\b(listWorkspaceNeeds|needUseCaseRefs)\(([^)]*)\)/g)].map((match) => match[0]);
  assert.deepEqual(calls, ["listWorkspaceNeeds(workspaceId, viewer, { includeArchived: opts.includeArchived })", "needUseCaseRefs(workspaceId, ids, viewer)"]);
  // `viewer` è il parametro delle letture dei tool: `principal.viewer`, ruolo riletto a questa richiesta.
  const tools = read("src/lib/use-cases/mcp/tools.ts");
  const reads = [...tools.matchAll(/deps\.reads\.(needs|needUseCaseRefs)\(([^;]*?)\)/g)].map((match) => match[2]);
  assert.ok(reads.length >= 3, reads.join(" | "));
  for (const args of reads) assert.match(args, /principal\.viewer/, args);
});

/**
 * Le sole rotte della REST che arrivano alle esigenze, e da dove: niente letture o tabelle dirette,
 * solo il modulo della funzione indicato.
 */
const REST_EXCEPTIONS: ReadonlyArray<{ path: string; reason: string; via: RegExp }> = [
  { path: "src/app/api/rispondi/", reason: "il referente risponde solo alle domande aperte della sua richiesta", via: /queries\/use-case-referent-public/ },
  { path: "src/app/api/cron/use-case-referents/route.ts", reason: "scadenze e promemoria", via: /queries\/use-case-referents/ },
];
const excepted = (file: string) => REST_EXCEPTIONS.find((e) => (e.path.endsWith("/") ? file.startsWith(e.path) : file === e.path));

test("REST ed export non toccano le esigenze", () => {
  const exposed = files.filter((file) => file.startsWith("src/app/api/") || /\/export\/route\.ts$/.test(file));
  assert.ok(exposed.length > 5, "le route ci sono");
  assert.deepEqual(exposed.filter((file) => !excepted(file) && NEEDS_ANYWHERE.test(read(file))), []);
  // Le eccezioni: nessuna lettura o tabella diretta, e i soli moduli della funzione.
  for (const file of exposed.filter((f) => excepted(f))) {
    const source = read(file);
    assert.doesNotMatch(source, TABLES, `${file}: niente tabelle delle esigenze`);
    assert.doesNotMatch(source, READS, `${file}: niente letture delle esigenze`);
    assert.doesNotMatch(source, /needs-service|lib\/use-cases\/needs\b/, `${file}: niente servizio delle esigenze`);
  }
});

test("le eccezioni della REST esistono (o sono del pacchetto della pagina pubblica, non ancora unito)", () => {
  const owned = JSON.parse(readFileSync(join(root, "scripts/use-case-test/ownership.json"), "utf8")) as { packages?: Record<string, { files?: string[] }> };
  const publicFiles = owned.packages?.["chiedi-p"]?.files ?? [];
  for (const e of REST_EXCEPTIONS) {
    const present = files.some((file) => (e.path.endsWith("/") ? file.startsWith(e.path) : file === e.path));
    if (present) {
      const via = files.filter((file) => (e.path.endsWith("/") ? file.startsWith(e.path) : file === e.path)).some((file) => e.via.test(read(file)));
      assert.ok(via, `${e.path} (${e.reason}): passa da ${e.via}`);
      continue;
    }
    assert.ok(publicFiles.some((f) => f.startsWith(e.path)), `${e.path} (${e.reason}) non esiste e non è di chiedi-p`);
  }
});
