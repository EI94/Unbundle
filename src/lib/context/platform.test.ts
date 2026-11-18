import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// «Contesto» sulla piattaforma (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §11.2): il cron della notte in vercel.json e
// nessuna anteprima del ramo, gli script dei test, e i punti dove la fondazione lascia il posto al pacchetto
// «granola» (le firme dello stub, i due componenti, il montaggio in Impostazioni). Si leggono i file, non si esegue niente.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

// ─── vercel.json ─────────────────────────────────────────────────────

test("vercel.json: il cron di «Contesto» ogni notte alle 2 UTC, una volta sola; i cinque di prima restano", () => {
  const vercel = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(
    vercel.crons.filter((cron) => /contest|context/.test(cron.path)),
    [{ path: "/api/cron/contesto", schedule: "0 2 * * *" }],
  );
  // I cinque di prima restano, con il loro orario.
  for (const [path, schedule] of [
    ["/api/cron/weekly-pulse", "0 9 * * 1"],
    ["/api/cron/slack-draft-nudge", "0 8 * * *"],
    ["/api/cron/uc-reminders", "0 8 * * 1-5"],
    ["/api/cron/uc-freshness", "0 3 * * *"],
    ["/api/cron/use-case-referents", "0 9 * * 1-5"],
  ]) {
    assert.deepEqual(vercel.crons.filter((cron) => cron.path === path), [{ path, schedule }], path);
  }
  // La rotta del cron c'è, ed è quella dell'indirizzo.
  assert.match(read("src/app/api/cron/contesto/route.ts"), /export async function GET\(request: Request\): Promise<Response>/);
});

test("vercel.json: nessuna anteprima per i rami della 9a (le anteprime usano il database di produzione)", () => {
  const vercel = JSON.parse(read("vercel.json")) as { git: { deploymentEnabled: Record<string, boolean> } };
  assert.equal(vercel.git.deploymentEnabled["feat/rilascio-9a-contesto"], false);
  // I tre pacchetti hanno lo stesso self-heal della 0038: anche loro, finché esistono.
  for (const branch of ["feat/9a-granola", "feat/9a-mcp", "feat/9a-pagina"]) assert.equal(vercel.git.deploymentEnabled[branch], false, branch);
  // Le righe di prima restano.
  assert.equal(vercel.git.deploymentEnabled["feat/chiedi-al-referente"], false);
  assert.equal(vercel.git.deploymentEnabled["codex/m1-ux-refinements"], false);
});

test("vercel.json: nessuna anteprima per i rami della 9b, l'integrazione e i sette pacchetti (le anteprime usano il database di produzione)", () => {
  const vercel = JSON.parse(read("vercel.json")) as { git: { deploymentEnabled: Record<string, boolean> } };
  for (const branch of [
    "feat/rilascio-9b-contesto",
    "feat/9b-schermi",
    "feat/9b-agenti",
    "feat/9b-lettura",
    "feat/9b-mcp",
    "feat/9b-ai",
    "feat/9b-riepilogo",
    "feat/9b-persone",
  ]) {
    assert.equal(vercel.git.deploymentEnabled[branch], false, branch);
  }
  // Le righe della 9a restano.
  assert.equal(vercel.git.deploymentEnabled["feat/rilascio-9a-contesto"], false);
});

test("la lista dei workspace dice quando il ritorno da Granola è scaduto senza un workspace da cui ripartire", () => {
  const page = read("src/app/(dashboard)/dashboard/page.tsx");
  assert.match(page, /searchParams\?: Promise<\{[^}]*granola\?: string[^}]*\}>/);
  assert.match(page, /\{sp\.granola === "scaduto" \? \([\s\S]*?\{CONTEXT_TEXT\.granola\.stateExpiredSomewhere\}[\s\S]*?\) : null\}/);
});

// ─── Gli script dei test ─────────────────────────────────────────────

const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;

/** I file e i modelli che uno script passa a `node --test`. */
function patternsOf(script: string): string[] {
  const args = script.slice(script.indexOf("--test") + "--test".length);
  return [...args.matchAll(/"([^"]+)"|(\S+)/g)].map((found) => found[1] ?? found[2]).filter((arg) => /\.(ts|mjs)$/.test(arg));
}
/** Un modello di `node --test` come espressione regolare: `**` attraversa le cartelle (anche nessuna), `*` un nome. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*\*\//g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, "(?:.*/)?")}$`);
}
const takenBy = (file: string): string[] =>
  Object.entries(scripts)
    .filter(([name, script]) => /^test:[a-z-]+$/.test(name) && script.includes("--test") && patternsOf(script).some((glob) => globToRegExp(glob).test(file)))
    .map(([name]) => name);

test("package.json: `test:contesto` c'è, prende i posti di «Contesto» e le due migrazioni (0038, 0041) ed è dentro `test`", () => {
  assert.equal(
    scripts["test:contesto"],
    'node --no-warnings --test "src/lib/context/**/*.test.ts" "src/components/context/**/*.test.ts" src/lib/db/context-ddl.test.ts src/lib/db/context-work-ddl.test.ts',
  );
  assert.ok(scripts.test.split("&&").map((step) => step.trim()).includes("npm run test:contesto"), scripts.test);
  assert.ok(scripts.check.includes("npm run test"), "`check` passa da `test`");
});

test("ogni test di «Contesto», e ogni test che la 9a aggiunge altrove, è preso da uno script `test:*`", () => {
  // Il confronto dei modelli funziona: una cartella annidata sì, un altro posto no.
  assert.deepEqual(takenBy("src/lib/context/read/prompt.test.ts"), ["test:contesto"]);
  assert.deepEqual(takenBy("src/lib/context/text.test.ts"), ["test:contesto"]);
  assert.deepEqual(takenBy("src/lib/contextual/altro.test.ts"), []);

  const here = (readdirSync(new URL("src/", ROOT), { recursive: true }) as string[])
    .map((file) => `src/${file.split("\\").join("/")}`)
    .filter((file) => /\.test\.ts$/.test(file) && /^src\/(lib|components)\/context\//.test(file));
  assert.ok(here.length >= 15, `${here.length} file di test di «Contesto»`);
  for (const file of here) assert.ok(takenBy(file).includes("test:contesto"), file);
  assert.ok(takenBy("src/lib/db/context-ddl.test.ts").includes("test:contesto"));
  // (9b) La 0041 e le funzioni pure del lavoro.
  assert.ok(takenBy("src/lib/db/context-work-ddl.test.ts").includes("test:contesto"));
  assert.deepEqual(takenBy("src/lib/context/work/agent-text.test.ts"), ["test:contesto"]);

  // I test della 9a fuori da «Contesto» (fondazione e pacchetti, §11.2-§11.5): li prende `test:use-cases`.
  for (const file of [
    "src/lib/ai/models.test.ts",
    "src/lib/ai/value-thesis-readers.test.ts",
    "src/lib/ai/rag/chunker.test.ts",
    "src/lib/ai/rag/retriever.test.ts",
    "src/lib/ai/tools/mapping-workspace.test.ts",
    "src/lib/ai/chat-route.test.ts",
    "src/lib/ai/upload-route.test.ts",
    "src/components/agent/chat-consent.test.ts",
    "src/components/dashboard/nav-active.test.ts",
    "src/lib/use-cases/mcp/contract.test.ts",
    "src/lib/use-cases/mcp/context-tools.test.ts",
    "src/lib/use-cases/mcp/instructions.test.ts",
  ]) {
    assert.ok(takenBy(file).includes("test:use-cases"), file);
  }
});

test("run-db-tests.mjs prende le suite sul database di src/lib/context/, e niente le salta", () => {
  const runner = read("scripts/use-case-test/run-db-tests.mjs");
  const suites = /const DEFAULT_SUITES = \[([\s\S]*?)\];/.exec(runner)?.[1] ?? "";
  const globs = [...suites.matchAll(/"([^"]+)"/g)].map((found) => found[1]);
  assert.ok(globs.includes("src/lib/context/**/*.integration.test.ts"), globs.join(", "));
  const suite = new RegExp(/const SUITE = \/(.+)\/;/.exec(runner)?.[1] ?? "(?!)");
  for (const file of [
    "src/lib/context/context.integration.test.ts",
    "src/lib/context/granola/granola.integration.test.ts",
    "src/lib/use-cases/mcp/mcp.integration.test.ts",
    "src/components/context/routes/routes.integration.test.ts",
  ]) {
    assert.ok(suite.test(file), `${file}: si può chiedere per nome`);
    assert.ok(globs.some((glob) => globToRegExp(glob).test(file)), `${file}: è tra le suite predefinite`);
  }
  assert.equal(suite.test("src/lib/context/text.test.ts"), false, "solo le suite sul database");
  assert.equal(suite.test("src/lib/contextual/altro.integration.test.ts"), false);
  assert.equal(suite.test("src/components/contextual/altro.integration.test.ts"), false);
  // La suite si accende solo con il segnale del runner e solo su 127.0.0.1, su una copia hub_<id>.
  const integration = read("src/lib/context/context.integration.test.ts");
  assert.match(integration, /process\.env\.HUB_TEST_ISOLATED === "true"/);
  assert.match(integration, /parsed\.hostname !== "127\.0\.0\.1"/);
  assert.match(integration, /\^\\\/hub_\[a-z0-9\]/);
});

// ─── Quello che la fondazione lascia al pacchetto «granola» ──────────

test("context-granola.ts esporta le funzioni e i tipi del piano (§3.4.12): chi le usa non cambia quando arriva il corpo", () => {
  const source = read("src/lib/db/queries/context-granola.ts");
  assert.match(source, /^import "server-only";/);
  assert.match(source, /export function granolaAvailable\(env\?: Readonly<Record<string, string \| undefined>>\): boolean/);
  const asyncFunctions: Readonly<Record<string, string>> = {
    loadGranolaStatus: "Promise<GranolaStatus>",
    startGranolaConnect: "Promise<ServiceResult<{ url: string }>>",
    finishGranolaConnect: "Promise<ServiceResult<{ workspaceId: string }>>",
    disconnectGranola: "Promise<ServiceResult<true>>",
    syncGranolaForUser: "Promise<GranolaSyncResult>",
    syncGranolaAll: "Promise<{ users: number; imported: number; errors: number }>",
    listGranolaUnsorted: "Promise<ServiceResult<UnsortedMeeting[]>>",
    assignGranolaMeeting: "Promise<ServiceResult<{ sourceId: string }>>",
    leaveOutGranolaMeetings: "Promise<ServiceResult<{ left: number }>>",
    readGranolaRules: "Promise<GranolaRulesView | null>",
    saveGranolaRules: "Promise<ServiceResult<true>>",
    listGranolaFolders: "Promise<ServiceResult<Array<{ id: string; name: string }>>>",
  };
  for (const [name, returns] of Object.entries(asyncFunctions)) {
    const declaration = new RegExp(`export async function ${name}\\(([\\s\\S]*?)\\): (Promise<[^\\n]+>) \\{`).exec(source);
    assert.ok(declaration, `${name} manca`);
    assert.equal(declaration[2], returns, name);
  }
  for (const type of ["interface GranolaStatus", "type GranolaSyncStatus", "interface GranolaSyncResult", "interface UnsortedMeeting", "interface GranolaRulesView"]) {
    assert.ok(source.includes(`export ${type} `), type);
  }
  assert.match(source, /export type GranolaSyncStatus = "fatto" \| "recente" \| "in_corso" \| "non_collegato" \| "da_ricollegare" \| "limite" \| "non_riuscito";/);
});

test("i due componenti di Granola hanno le proprietà del piano e sono componenti server asincroni", () => {
  const card = read("src/components/context/granola/granola-card.tsx");
  const inbox = read("src/components/context/granola/granola-inbox.tsx");
  for (const source of [card, inbox]) assert.doesNotMatch(source, /^"use client"/m, "componenti server: leggono da sé lo stato");
  assert.match(card, /export async function GranolaCard\(/);
  assert.match(inbox, /export async function GranolaInbox\(/);
  for (const prop of ["workspaceId: string;", "workspaceName: string;", "userId: string;", "role: string;", "flash?: string;"]) assert.ok(card.includes(prop), `GranolaCard: ${prop}`);
  for (const prop of ["workspaceId: string;", "workspaceName: string;", "compact?: boolean;"]) assert.ok(inbox.includes(prop), `GranolaInbox: ${prop}`);
});

test("Impostazioni monta il blocco di Granola dentro «Integrazioni», all'ancora #granola, con il ritorno dal collegamento", () => {
  const page = read("src/app/(dashboard)/dashboard/[workspaceId]/settings/page.tsx");
  assert.match(page, /import \{ GranolaCard \} from "@\/components\/context\/granola\/granola-card";/);
  assert.match(page, /searchParams: Promise<\{ slack\?: string; slack_error\?: string; granola\?: string \}>;/);
  const integrations = page.slice(page.indexOf('<div id="integrazioni"'), page.indexOf("{useCaseSettings && <ValuationSettings"));
  assert.ok(integrations.length > 0, "la sezione «Integrazioni»");
  assert.match(
    integrations,
    /<div id="granola" className="scroll-mt-28 empty:hidden">\s*<GranolaCard workspaceId=\{workspaceId\} workspaceName=\{workspace\.name\} userId=\{session\.user\.id\} role=\{access\.role\} flash=\{search\.granola\} \/>\s*<\/div>/,
  );
  assert.equal(page.match(/<GranolaCard\b/g)?.length, 1);
  assert.equal(page.match(/id="granola"/g)?.length, 1);
});
