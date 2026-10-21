import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  ADMIN_COMMANDS,
  ADMIN_DATABASE_ENV,
  checkDatabaseTarget,
  counted,
  databaseFingerprint,
  parseAdminOptions,
  parseCommandName,
  plural,
  scopeQuery,
  truncateTitle,
} from "./cli.ts";

// scripts/use-case-admin.ts (docs/use-case/DESIGN.md §10.5; PIANO-LAVORI H2c). Id inventati.

const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";

test("i 9 comandi, nell'ordine di DESIGN §10.5", () => {
  assert.deepEqual(
    [...ADMIN_COMMANDS],
    ["dossier-dups", "configs", "team-name", "origin", "codes", "dossier-links", "slack-drafts", "scoring-v2", "doctor"],
  );
  assert.equal(ADMIN_DATABASE_ENV, "USE_CASE_ADMIN_DATABASE_URL");
});

test("comando: il primo argomento, solo tra quelli registrati", () => {
  assert.deepEqual(parseCommandName(["codes", "--all"]), { ok: true, value: "codes" });
  assert.equal(parseCommandName([]).ok, false);
  assert.equal(parseCommandName(["--all"]).ok, false);
  assert.equal(parseCommandName(["purge"]).ok, false);
});

test("ambito: esattamente uno tra --workspace <uuid> e --all", () => {
  const one = parseAdminOptions(["--workspace", WS.toUpperCase()]);
  assert.equal(one.ok, true);
  if (one.ok) assert.deepEqual(one.value.scope, { kind: "workspace", workspaceId: WS });
  const all = parseAdminOptions(["--all"]);
  assert.equal(all.ok, true);
  if (all.ok) assert.deepEqual(all.value.scope, { kind: "all" });
  for (const argv of [[], ["--workspace", WS, "--all"], ["--workspace", "ws-1"], ["--workspace"]]) {
    const parsed = parseAdminOptions(argv);
    assert.equal(parsed.ok, false, argv.join(" "));
  }
});

test("opzioni: niente sconosciute, ripetute, sciolte o senza valore", () => {
  const cases: string[][] = [
    ["--all", "--force"],
    ["--all", "--all"],
    ["--all", "extra"],
    ["--all", "--apply", "yes"],
    ["--all", "--detach"],
    ["--all", "--detach", "--apply"],
    ["--all", "-a"],
  ];
  for (const argv of cases) assert.equal(parseAdminOptions(argv, { values: ["detach"] }).ok, false, argv.join(" "));
  const ok = parseAdminOptions(["--all", "--detach", "a,b", "--apply", "--confirm-authorized", "--confirm-database", "h/db", "--environment", "local"], { values: ["detach"] });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.apply, true);
    assert.equal(ok.value.environment, "local");
    assert.equal(ok.value.values.get("detach"), "a,b");
    assert.equal(ok.value.values.get("confirm-database"), "h/db");
  }
  const flags = parseAdminOptions(["--all", "--revert"], { flags: ["revert"] });
  assert.equal(flags.ok, true);
  if (flags.ok) assert.equal(flags.value.flags.has("revert"), true);
});

test("--apply: mai su un comando in sola lettura; le conferme solo con --apply", () => {
  const readOnly = parseAdminOptions(["--all", "--apply", "--confirm-authorized", "--environment", "local"], {}, true);
  assert.equal(readOnly.ok, false);
  if (!readOnly.ok) assert.equal(readOnly.code, "sola_lettura");
  for (const extra of [["--confirm-database", "h/db"], ["--confirm-authorized"], ["--environment", "local"], ["--production-approved"]]) {
    const parsed = parseAdminOptions(["--all", ...extra]);
    assert.equal(parsed.ok, false, extra.join(" "));
    if (!parsed.ok) assert.equal(parsed.code, "opzioni");
  }
  assert.equal(parseAdminOptions(["--all"], {}, true).ok, true);
  const dry = parseAdminOptions(["--all"]);
  assert.equal(dry.ok && dry.value.environment, null);
});

test("--apply: --confirm-authorized, --environment e, in produzione, --production-approved (come uc-case-admin)", () => {
  const code = (argv: string[]) => {
    const parsed = parseAdminOptions(["--all", "--apply", ...argv]);
    return parsed.ok ? "ok" : parsed.code;
  };
  assert.equal(code(["--environment", "local"]), "conferma");
  assert.equal(code(["--confirm-authorized"]), "ambiente");
  assert.equal(code(["--confirm-authorized", "--environment", "staging"]), "ambiente");
  assert.equal(code(["--confirm-authorized", "--environment", "production"]), "ambiente");
  assert.equal(code(["--confirm-authorized", "--environment", "production", "--production-approved"]), "ok");
  assert.equal(code(["--confirm-authorized", "--environment", "preview"]), "ok");
  assert.equal(code(["--confirm-authorized", "--environment", "local"]), "ok");
});

test("database: solo l'URL della variabile, e con --apply la sua conferma esatta", () => {
  assert.equal(databaseFingerprint("postgresql://u@127.0.0.1:55479/hub_h2c"), "127.0.0.1:55479/hub_h2c");
  assert.equal(databaseFingerprint("postgres://u:p@db.example.test/prod?sslmode=require"), "db.example.test/prod");
  assert.equal(databaseFingerprint("https://db.example.test/prod"), null);
  assert.equal(databaseFingerprint("postgresql://u@db.example.test"), null);
  assert.equal(databaseFingerprint("non un url"), null);
  // Come neon(): senza utente l'URL non vale (prima finiva in un errore non gestito del driver).
  assert.equal(databaseFingerprint("postgresql://:pw@host.invalid/db"), null);
  assert.equal(databaseFingerprint("postgresql://host.invalid/db"), null);
  const noUser = checkDatabaseTarget("postgresql://:pw@host.invalid/db", false, undefined);
  assert.equal(noUser.ok, false);
  if (!noUser.ok) {
    assert.equal(noUser.code, "database");
    assert.doesNotMatch(noUser.message, /pw/);
  }

  const missing = checkDatabaseTarget(undefined, false, undefined);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.message, /USE_CASE_ADMIN_DATABASE_URL/);
  assert.equal(checkDatabaseTarget("  ", false, undefined).ok, false);
  assert.equal(checkDatabaseTarget("mysql://h/db", false, undefined).ok, false);
  const url = "postgresql://u@127.0.0.1:55479/hub_h2c";
  assert.deepEqual(checkDatabaseTarget(url, false, undefined), { ok: true, value: { url, fingerprint: "127.0.0.1:55479/hub_h2c" } });
  assert.equal(checkDatabaseTarget(url, true, undefined, "local").ok, false);
  assert.equal(checkDatabaseTarget(url, true, "127.0.0.1:55479/hub_altro", "local").ok, false);
  assert.equal(checkDatabaseTarget(url, true, "127.0.0.1/hub_h2c", "local").ok, false);
  assert.equal(checkDatabaseTarget(url, true, "127.0.0.1:55479/hub_h2c", "local").ok, true);
});

test("database: --environment local solo su loopback, preview e production mai", () => {
  const code = (url: string, confirm: string, environment: "local" | "preview" | "production" | null) => {
    const checked = checkDatabaseTarget(url, true, confirm, environment);
    return checked.ok ? "ok" : checked.code;
  };
  const local = "postgresql://u@127.0.0.1:55479/hub_h2c";
  assert.equal(code(local, "127.0.0.1:55479/hub_h2c", "local"), "ok");
  assert.equal(code(local, "127.0.0.1:55479/hub_h2c", "preview"), "ambiente");
  assert.equal(code(local, "127.0.0.1:55479/hub_h2c", "production"), "ambiente");
  assert.equal(code(local, "127.0.0.1:55479/hub_h2c", null), "ambiente");
  assert.equal(code("postgresql://u@localhost/db", "localhost/db", "local"), "ok");
  assert.equal(code("postgresql://u@[::1]:5432/db", "[::1]:5432/db", "local"), "ok");
  const remote = "postgresql://u:p@ep-esempio.eu-central-1.aws.neon.example/prod?sslmode=require";
  assert.equal(code(remote, "ep-esempio.eu-central-1.aws.neon.example/prod", "local"), "ambiente");
  assert.equal(code(remote, "ep-esempio.eu-central-1.aws.neon.example/prod", "preview"), "ok");
  assert.equal(code(remote, "ep-esempio.eu-central-1.aws.neon.example/prod", "production"), "ok");
  // A secco l'ambiente non serve.
  assert.equal(checkDatabaseTarget(remote, false, undefined).ok, true);
});

test("titoli troncati a 60 caratteri, spazi ripuliti", () => {
  assert.equal(truncateTitle("Riepilogo  automatico\n delle riunioni"), "Riepilogo automatico delle riunioni");
  const long = "Classificazione automatica delle richieste di assistenza clienti in arrivo";
  const cut = truncateTitle(long);
  assert.equal(cut.length, 60);
  assert.ok(cut.endsWith("…"));
  assert.ok(long.startsWith(cut.slice(0, -1)));
  assert.equal(truncateTitle("x".repeat(60)), "x".repeat(60));
  assert.equal(truncateTitle(null), "");
});

test("numeri e parole d'accordo: 1 al singolare, 0 e gli altri al plurale", () => {
  assert.equal(counted(1, "scheda", "schede"), "1 scheda");
  assert.equal(counted(0, "scheda", "schede"), "0 schede");
  assert.equal(counted(2, "codice", "codici"), "2 codici");
  assert.equal(`${plural(1, "Resta", "Restano")} ${counted(1, "scheda", "schede")}`, "Resta 1 scheda");
  assert.equal(`${plural(3, "Creata", "Create")} ${counted(3, "riga", "righe")}`, "Create 3 righe");
});

test("ambito per le query: filtro $1 solo con --workspace", () => {
  assert.deepEqual(scopeQuery({ kind: "all" }), { withWorkspace: false, params: [] });
  assert.deepEqual(scopeQuery({ kind: "workspace", workspaceId: WS }), { withWorkspace: true, params: [WS] });
});

// ─── Guardia sul sorgente: niente file d'ambiente, niente DATABASE_URL ──────

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function adminSources(): string[] {
  const files = ["scripts/use-case-admin.ts"];
  for (const dir of ["scripts/use-case-admin", "src/lib/use-cases/admin"]) {
    if (!existsSync(join(ROOT, dir))) continue;
    for (const name of readdirSync(join(ROOT, dir))) {
      if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) files.push(`${dir}/${name}`);
    }
  }
  return files.sort();
}

/** Le variabili che lo script legge dalla shell: nessun'altra. */
const ALLOWED_ENV = new Set(["USE_CASE_ADMIN_DATABASE_URL", "UC_LS_EMAIL_DOMAINS", "USE_CASE_HUB_WORKSPACES", "USE_CASE_HUB_EXCLUDE"]);

function envProblems(file: string, source = readFileSync(join(ROOT, file), "utf8")): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const problems: string[] = [];
  const isProcessEnv = (node: ts.Node) =>
    ts.isPropertyAccessExpression(node) && node.name.text === "env" && ts.isIdentifier(node.expression) && node.expression.text === "process";
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      if (/dotenv/.test(from)) problems.push(`${file}: importa ${from}`);
      if (from.startsWith("@/") || /(^|\/)db(\/index)?(\.ts)?$/.test(from) || from === "server-only") problems.push(`${file}: importa ${from}`);
    }
    if (ts.isIdentifier(node) && /^(loadEnvFile|config)$/.test(node.text) && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
      const owner = node.parent.expression.getText(tree);
      if (/process|dotenv/.test(owner)) problems.push(`${file}: ${owner}.${node.text}`);
    }
    if (isProcessEnv(node)) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        if (!ALLOWED_ENV.has(parent.name.text)) problems.push(`${file}: legge process.env.${parent.name.text}`);
      } else {
        problems.push(`${file}: usa process.env per intero o con un indice`);
      }
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && /(^|[^A-Za-z_])\.env\b|--env-file/.test(node.text)) {
      problems.push(`${file}: stringa con un file d'ambiente`);
    }
    node.forEachChild(visit);
  };
  visit(tree);
  return problems;
}

test("lo script non legge file d'ambiente né DATABASE_URL: solo le sue tre variabili", () => {
  const files = adminSources();
  assert.ok(files.includes("scripts/use-case-admin.ts"));
  assert.ok(files.includes("src/lib/use-cases/admin/cli.ts"));
  assert.deepEqual(files.flatMap((file) => envProblems(file)), []);
});

test("la guardia trova le letture vietate", () => {
  const probe = (source: string) => envProblems("probe.ts", source).length;
  assert.equal(probe("const url = process.env.USE_CASE_ADMIN_DATABASE_URL;"), 0);
  assert.equal(probe("const url = process.env.DATABASE_URL;"), 1);
  assert.equal(probe('const url = process.env["USE_CASE_ADMIN_DATABASE_URL"];'), 1);
  assert.equal(probe("const all = process.env;"), 1);
  assert.equal(probe('import "dotenv/config";'), 1);
  assert.equal(probe("process.loadEnvFile();"), 1);
  assert.equal(probe('readFileSync(".env.local", "utf8");'), 1);
  assert.equal(probe('import { db } from "../../db/index.ts";'), 1);
  assert.equal(probe('import { db } from "@/lib/db";'), 1);
});

test("i piani in src/lib/use-cases/admin sono puri: solo import relativi .ts", () => {
  for (const name of readdirSync(join(ROOT, "src/lib/use-cases/admin"))) {
    if (!/\.ts$/.test(name) || /\.test\.ts$/.test(name)) continue;
    const source = readFileSync(join(ROOT, "src/lib/use-cases/admin", name), "utf8");
    for (const match of source.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gm)) {
      assert.match(match[1], /^\.\.?\/.+\.ts$/, `${name}: ${match[1]}`);
    }
  }
});
