import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { UC_TABLE_NAMES } from "./ddl.ts";

// Production configuration of the Casi d'uso section (DESIGN §7.1 P0-2, P0-7, P0-9):
// the files are read as they are deployed, no network and no database.
const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function headerRules(): Promise<HeaderRule[]> {
  const { default: config } = (await import(new URL("next.config.ts", root).href)) as { default: { headers: () => Promise<HeaderRule[]> } };
  return config.headers();
}

test("personal links carry the CSP of P0-7, page and API alike; the rest of the app has none", async () => {
  const rules = await headerRules();
  for (const source of ["/r/:path*", "/api/r/:path*"]) {
    const rule = rules.find((r) => r.source === source);
    assert.ok(rule, source);
    const csp = rule.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
    const directives = new Map(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
    assert.deepEqual(directives.get("frame-ancestors"), ["'none'"], source);
    assert.deepEqual(directives.get("base-uri"), ["'none'"], source);
    assert.deepEqual(directives.get("object-src"), ["'none'"], source);
    assert.deepEqual(directives.get("form-action"), ["'self'"], source);
    assert.deepEqual(directives.get("img-src"), ["'self'", "data:", "blob:"], source);
    const connect = directives.get("connect-src") ?? [];
    assert.equal(connect[0], "'self'");
    // Direct uploads from the browser go to the Vercel Blob API: nothing else.
    for (const host of connect.slice(1)) assert.match(host, /^https:\/\/(vercel\.com|\*\.blob\.vercel-storage\.com)$/, host);
    // The headers that were already there stay.
    for (const key of ["X-Robots-Tag", "Cache-Control", "Referrer-Policy"]) assert.ok(rule.headers.some((h) => h.key === key), `${source} ${key}`);
  }
  const global = rules.find((r) => r.source === "/:path*");
  assert.ok(global && !global.headers.some((h) => h.key === "Content-Security-Policy"), "no global CSP in this package");
});

test("drizzle-kit never reads the uc tables from the database (tablesFilter)", async () => {
  const { default: config } = (await import(new URL("drizzle.config.ts", root).href)) as { default: { tablesFilter?: string[] } };
  assert.deepEqual(config.tablesFilter, ["!uc_*"]);
  // Same rule as drizzle-kit's push and pull introspection: negated globs exclude.
  const { Minimatch } = createRequire(import.meta.url)("minimatch") as { Minimatch: new (p: string) => { negate: boolean; match: (s: string) => boolean } };
  const matchers = config.tablesFilter!.map((p) => new Minimatch(p));
  const kept = (table: string) => {
    const flags: boolean[] = [];
    for (const m of matchers) {
      if (m.negate && !m.match(table)) flags.push(false);
      if (m.match(table)) flags.push(true);
    }
    return flags.length > 0 && flags.every(Boolean);
  };
  for (const table of UC_TABLE_NAMES) assert.equal(kept(table), false, table);
  for (const table of ["use_cases", "workspaces", "users", "workspace_integration_tokens", "learning_courses"]) assert.equal(kept(table), true, table);
});

test("drizzle-kit does not know the uc tables on the code side either (schema entry without uc_*)", async () => {
  const { default: config } = (await import(new URL("drizzle.config.ts", root).href)) as { default: { schema?: string[] } };
  assert.deepEqual(config.schema, ["./src/lib/db/schema.drizzle-kit.cjs"]);
  // learning/schema.ts imports "@/lib/db/schema": resolve the alias as tsconfig does, in this test process only.
  type Next = (specifier: string, context: unknown) => unknown;
  const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: (s: string, c: unknown, next: Next) => unknown }) => unknown };
  registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith("@/") ? new URL(`src/${specifier.slice(2)}.ts`, root).href : specifier, context) });
  const entry = createRequire(import.meta.url)(fileURLToPath(new URL("src/lib/db/schema.drizzle-kit.cjs", root))) as Record<string, unknown>;
  const main = (await import("../db/schema.ts")) as Record<string, unknown>;
  const learning = (await import("../learning/schema.ts")) as Record<string, unknown>;
  const tables = (mod: Record<string, unknown>) => Object.values(mod).filter((v): v is PgTable => is(v, PgTable)).map((t) => getTableName(t)).sort();
  const ucInSchema = tables(main).filter((name) => name.startsWith("uc_"));
  assert.deepEqual(ucInSchema, [...UC_TABLE_NAMES].sort(), "schema.ts still declares every uc table for the typed queries");
  assert.deepEqual(tables(entry), [...tables(main), ...tables(learning)].filter((name) => !name.startsWith("uc_")).sort());
  // Everything else passes untouched: enums, relations and every other table.
  for (const mod of [main, learning]) {
    for (const [name, value] of Object.entries(mod)) {
      if (is(value, PgTable) && getTableName(value).startsWith("uc_")) assert.ok(!(name in entry), name);
      else assert.equal(entry[name], value, name);
    }
  }
});

test("switches and the personal zone key are never copied to Vercel by the sync script", () => {
  const source = read("scripts/sync-vercel-env.mjs");
  for (const name of ["UC_ENABLED", "UC_WORKSPACE_IDS", "UC_SCHEMA_SELF_HEAL", "UC_PERSONAL_ZONE_KEY", "UC_ADMIN_DATABASE_URL", "UC_LOCAL_STORAGE_DIR"]) {
    assert.doesNotMatch(source, new RegExp(`name:\\s*"${name}"`), name);
  }
  for (const name of ["UC_SECRET", "UC_LS_EMAIL_DOMAINS", "UC_EMAIL_FROM", "UC_EMAIL_REPLY_TO"]) assert.match(source, new RegExp(`name:\\s*"${name}"`), name);
});

test("the uc crons stay scheduled", () => {
  const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
  assert.deepEqual(
    vercel.crons.filter((c) => c.path.startsWith("/api/cron/uc-")),
    [
      { path: "/api/cron/uc-reminders", schedule: "0 8 * * 1-5" },
      { path: "/api/cron/uc-freshness", schedule: "0 3 * * *" },
    ],
  );
});

test("CI: Postgres 16 like the harness, migration check, unit tests, integration suites one at a time", () => {
  const ci = read(".github/workflows/uc.yml");
  assert.match(ci, /image: postgres:16/);
  assert.match(ci, /127\.0\.0\.1:55449:5432/);
  assert.match(ci, /uc-write-migration\.ts --check/);
  assert.match(ci, /npm run check/);
  assert.match(ci, /--test-concurrency=1/);
  assert.match(ci, /local-neon\.cjs/);
  assert.match(ci, /database\.integration\.test\.ts/);
  // Never a real secret or a remote database in CI.
  assert.doesNotMatch(ci, /secrets\./);
  assert.doesNotMatch(ci, /^\s*DATABASE_URL:/m);
});
