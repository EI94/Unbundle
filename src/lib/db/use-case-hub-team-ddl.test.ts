import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import { WORKSPACE_TEAM_DDL, WORKSPACE_TEAM_NAMED_CONSTRAINTS, WORKSPACE_TEAM_PROBE_SQL, WORKSPACE_TEAM_ROLES } from "./use-case-hub-team-ddl.ts";
import * as schema from "./schema.ts";

// Migrazione 0035 e self-heal: il team di Lateral Space di un cliente (rilascio 8.1b). Le prove sul database stanno in
// src/lib/use-cases/factory/workspace-team.integration.test.ts.

const migration = readFileSync(new URL("../../../drizzle/0035_team_workspace.sql", import.meta.url), "utf8");
const ensureSchema = readFileSync(new URL("./ensure-schema.ts", import.meta.url), "utf8");
const normalize = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/\s+/g, " ").trim();

test("0035: apertura, poi gli statement del self-heal, e nient'altro; solo aggiunte", () => {
  const prelude = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-workspace-team-ddl'));"];
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(prelude.join("\n"))));
  const rest = [...prelude, ...WORKSPACE_TEAM_DDL].reduce((text, s) => text.replace(normalize(s), ""), body);
  assert.equal(rest.trim(), "");
  for (const s of WORKSPACE_TEAM_DDL) {
    assert.doesNotMatch(s, /ALTER|DROP|\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i);
    assert.doesNotMatch(s, /\buc_[a-z_]+/, "il DDL uc non cambia");
  }
});

test("una riga per persona e workspace, con un ruolo di chi costruisce; si cancella con il workspace e con la persona", () => {
  const t = WORKSPACE_TEAM_DDL[0];
  assert.deepEqual([...WORKSPACE_TEAM_ROLES], ["ls_lead", "ls_analista", "ls_sviluppatore"]);
  assert.ok(t.includes("role IN ('ls_lead', 'ls_analista', 'ls_sviluppatore')"));
  assert.match(t, /CONSTRAINT use_case_workspace_team_unique UNIQUE \(workspace_id, user_id\)/);
  assert.match(t, /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(t, /user_id uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  for (const name of WORKSPACE_TEAM_NAMED_CONSTRAINTS) assert.ok(t.includes(`CONSTRAINT ${name} `) && WORKSPACE_TEAM_PROBE_SQL.includes(`'${name}'`), name);
});

test("ensure-schema: versione 29, la 0035 dopo la 0034, non fatale, sonda in AND; colonne Drizzle uguali", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 29, "ENSURE_VERSION almeno 29 (la 0036 la porta a 30)");
  const runOnce = ensureSchema.slice(ensureSchema.indexOf("async function runOnce(): Promise<void> {"));
  assert.ok(runOnce.indexOf("await runProposalsDdlSafely();") < runOnce.indexOf("await runWorkspaceTeamDdlSafely();"));
  assert.match(ensureSchema, /AND \$\{sql\.raw\(PROPOSALS_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(WORKSPACE_TEAM_PROBE_SQL\)\}/);
  assert.match(ensureSchema, /ensurePromise = ensurePromise\.then\(runWorkspaceTeamDdlSafely\);/);
  assert.equal(getTableName(schema.useCaseWorkspaceTeam), "use_case_workspace_team");
  assert.deepEqual(Object.values(getTableColumns(schema.useCaseWorkspaceTeam)).map((c) => c.name), ["id", "workspace_id", "user_id", "role", "created_at", "updated_at"]);
});
