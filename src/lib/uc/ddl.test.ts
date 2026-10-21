import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as V from "./vocab.ts";
import {
  renderUcMigration,
  UC_APPEND_ONLY_TABLES,
  UC_DDL,
  UC_DDL_MARKER,
  UC_DOSSIER_DUPLICATES_CONDITION,
  UC_DOSSIER_DUPLICATES_SQL,
  UC_FUNCTIONS,
  UC_INDEXES,
  UC_MIGRATION_FILE,
  UC_PROBE_SQL,
  UC_TABLE_NAMES,
  UC_TABLES,
  UC_TRIGGERS,
  UC_UNIQUE_DOSSIER_INDEX,
  UC_UNIQUE_DOSSIER_INDEX_DDL,
  UC_VOCAB_CHECKS,
} from "./ddl.ts";
import { DOCTOR_DUPLICATES_SQL, DOCTOR_INDEX_SQL, UC_UNIQUE_DOSSIER_INDEX as DOCTOR_UNIQUE_DOSSIER_INDEX } from "./doctor.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const EXPECTED_TABLES = [
  "uc_templates", "uc_contacts", "uc_cases", "uc_case_members", "uc_blockers", "uc_items", "uc_item_blockers",
  "uc_item_links", "uc_requests", "uc_request_tokens", "uc_request_items", "uc_answers", "uc_files", "uc_datasets",
  "uc_validations", "uc_comments", "uc_maps", "uc_gate_reviews", "uc_catalog_versions", "uc_model_runs",
  "uc_kpi_measurements", "uc_test_cases", "uc_roi_models", "uc_milestones", "uc_notifications", "uc_events",
  "uc_rate_limits", "uc_subprocessor_acks",
];

const createTables = UC_DDL.filter((s) => s.startsWith("CREATE TABLE"));

test("migration 0018 is exactly the generated DDL", () => {
  const file = readFileSync(resolve(repoRoot, UC_MIGRATION_FILE), "utf8");
  assert.equal(file, renderUcMigration(), "run: node --no-warnings scripts/uc-write-migration.ts");
  assert.match(file, /GENERATO da scripts\/uc-write-migration\.ts/);
  assert.ok(file.includes(UC_DDL_MARKER));
});

test("the 23 specification tables plus 4 bridges and technical tables and the sub-processor authorizations exist, in creation order", () => {
  assert.deepEqual([...UC_TABLE_NAMES], EXPECTED_TABLES);
  assert.equal(createTables.length, 28);
  createTables.forEach((s, i) => assert.ok(s.startsWith(`CREATE TABLE IF NOT EXISTS ${EXPECTED_TABLES[i]} (`)));
});

test("every vocabulary CHECK has a stable name and exactly the values of vocab.ts", () => {
  assert.ok(UC_VOCAB_CHECKS.length >= 50);
  const sql = createTables.join("\n");
  for (const c of UC_VOCAB_CHECKS) {
    assert.equal(c.name, `${c.table}_${c.column}_chk`);
    assert.equal(c.values, V[c.vocab], `${c.name} must reuse ${c.vocab}`);
    const m = sql.match(new RegExp(`CONSTRAINT ${c.name} CHECK \\(${c.column} IN \\(([^)]*)\\)\\)`));
    assert.ok(m, `${c.name} missing in DDL`);
    const values = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    assert.deepEqual(values, [...c.values], c.name);
  }
  // Spot checks on the vocabularies the plan names explicitly.
  const byName = new Map(UC_VOCAB_CHECKS.map((c) => [c.name, c.vocab]));
  assert.equal(byName.get("uc_items_status_chk"), "ITEM_STATUSES");
  assert.equal(byName.get("uc_cases_status_chk"), "CASE_STATUSES");
  assert.equal(byName.get("uc_case_members_role_chk"), "CASE_ROLES");
  assert.equal(byName.get("uc_answers_source_kind_chk"), "ANSWER_SOURCE_KINDS");
  assert.equal(byName.get("uc_gate_reviews_gate_key_chk"), "GATE_KEYS");
});

test("every CHECK in the tables is named", () => {
  for (const statement of createTables) {
    const checks = [...statement.matchAll(/CHECK \(/g)].length;
    const named = [...statement.matchAll(/CONSTRAINT uc_[a-z0-9_]+_chk CHECK \(/g)].length;
    assert.equal(named, checks, statement.split("\n")[0]);
  }
});

test("every statement is idempotent", () => {
  for (const s of UC_DDL) {
    const ok =
      s.startsWith("CREATE TABLE IF NOT EXISTS ") ||
      s.startsWith("CREATE INDEX IF NOT EXISTS ") ||
      s.startsWith("CREATE UNIQUE INDEX IF NOT EXISTS ") ||
      s.startsWith("CREATE OR REPLACE FUNCTION ") ||
      s.startsWith("CREATE OR REPLACE TRIGGER ") ||
      s.startsWith("COMMENT ON FUNCTION ") ||
      s === UC_UNIQUE_DOSSIER_INDEX_DDL ||
      (s.startsWith("DO $uc$") && (s.includes("EXCEPTION WHEN duplicate_object THEN NULL") || s.includes("DROP CONSTRAINT IF EXISTS")));
    assert.ok(ok, s.slice(0, 80));
  }
  assert.ok(UC_DDL.at(-1)!.startsWith("COMMENT ON FUNCTION uc_require"), "the DDL marker is written last");
});

test("every foreign key has an index led by one of its columns", () => {
  const indexed = new Map<string, Set<string>>();
  const add = (table: string, first: string) => {
    if (!indexed.has(table)) indexed.set(table, new Set());
    indexed.get(table)!.add(first.trim().replace(/^lower\(|\)$/g, ""));
  };
  for (const i of UC_INDEXES) add(i.table, i.on.split(",")[0]);
  for (const t of UC_TABLES) {
    for (const c of t.columns) if (c.pk) add(t.name, c.name);
    for (const c of t.constraints) {
      const m = c.match(/(?:PRIMARY KEY|UNIQUE) \(([^)]*)\)/);
      if (m) add(t.name, m[1].split(",")[0]);
    }
  }
  for (const t of UC_TABLES) {
    const fks: string[][] = t.columns.filter((c) => c.references).map((c) => [c.name]);
    for (const c of t.constraints) {
      const m = c.match(/FOREIGN KEY \(([^)]*)\)/);
      if (m) fks.push(m[1].split(",").map((x) => x.trim()));
    }
    for (const cols of fks) {
      const covered = cols.some((col) => indexed.get(t.name)?.has(col));
      assert.ok(covered, `${t.name}(${cols.join(", ")}) has no index`);
    }
  }
});

test("every NO ACTION foreign key is checked at commit, so workspace cascades can complete", () => {
  const all = UC_DDL.join("\n");
  const references = [...all.matchAll(/REFERENCES [a-z_]+ \([a-z_, ]+\)([^,\n;]*)/g)];
  assert.ok(references.length > 60);
  for (const m of references) {
    const tail = m[1];
    assert.ok(/ON DELETE (CASCADE|SET NULL)/.test(tail) || tail.includes("DEFERRABLE INITIALLY DEFERRED"), m[0]);
  }
});

test("append-only tables, immutability and privacy triggers are declared", () => {
  assert.deepEqual([...UC_APPEND_ONLY_TABLES].sort(), ["uc_answers", "uc_catalog_versions", "uc_events", "uc_subprocessor_acks", "uc_validations"]);
  const names = UC_TRIGGERS.map((t) => `${t.table}.${t.name}`);
  for (const table of UC_APPEND_ONLY_TABLES) assert.ok(names.includes(`${table}.${table}_append_only`));
  assert.ok(names.includes("uc_templates.uc_templates_immutable"));
  assert.ok(names.includes("uc_gate_reviews.uc_gate_reviews_frozen"));
  assert.ok(names.includes("uc_answers.uc_answers_no_personal_plaintext"));
  assert.ok(names.includes("uc_item_blockers.uc_item_blockers_keep"));
  for (const t of UC_TRIGGERS) {
    assert.ok(UC_DDL.includes(`CREATE OR REPLACE TRIGGER ${t.name} ${t.timing} ON ${t.table} FOR EACH ROW EXECUTE FUNCTION ${t.fn}()`));
    assert.ok(UC_FUNCTIONS.includes(`${t.fn}()`));
  }
  const require = UC_DDL.find((s) => s.startsWith("CREATE OR REPLACE FUNCTION uc_require("));
  assert.ok(require?.includes("RAISE EXCEPTION 'uc:%', code"));
});

test("the probe covers tables, functions, triggers, additive columns, vocabularies and the DDL marker in `current`, and the unique dossier index in its own column", () => {
  for (const t of UC_TABLE_NAMES) assert.ok(UC_PROBE_SQL.includes(`'${t}'`), t);
  for (const f of UC_FUNCTIONS) assert.ok(UC_PROBE_SQL.includes(`'${f}'`), f);
  for (const t of UC_TRIGGERS) assert.ok(UC_PROBE_SQL.includes(`('${t.table}', '${t.name}')`), t.name);
  for (const c of UC_VOCAB_CHECKS) assert.ok(UC_PROBE_SQL.includes(`'${c.name}'`), c.name);
  assert.ok(UC_PROBE_SQL.includes("('uc_items', 'in_gate_scope')"));
  assert.ok(UC_PROBE_SQL.includes("('uc_cases', 'catalog_revision')"));
  assert.ok(UC_PROBE_SQL.includes("('uc_notifications', 'read_at')"));
  assert.ok(UC_PROBE_SQL.includes(`= '${UC_DDL_MARKER}'`));
  // A duplicate makes the DDL skip the index: that must not make `current` false, or the section
  // would answer 503 with the self-heal off (production). The index has its own column.
  const [current, uniqueIndex] = UC_PROBE_SQL.split(") AS current,");
  assert.ok(uniqueIndex !== undefined, "two columns: current, unique_index");
  assert.ok(!current.includes(UC_UNIQUE_DOSSIER_INDEX), "current does not look at the unique index");
  assert.equal(uniqueIndex.trim(), `to_regclass('public.${UC_UNIQUE_DOSSIER_INDEX}') IS NOT NULL AS unique_index`);
});

test("the unique dossier index is created only without duplicates (complete and incomplete rows), otherwise skipped with a NOTICE", () => {
  // One statement, the guarded block, between the indexes and the triggers; the marker stays last.
  assert.deepEqual(
    UC_DDL.filter((s) => s.includes(UC_UNIQUE_DOSSIER_INDEX)),
    [UC_UNIQUE_DOSSIER_INDEX_DDL],
  );
  const at = UC_DDL.indexOf(UC_UNIQUE_DOSSIER_INDEX_DDL);
  assert.ok(at > UC_DDL.findIndex((s) => s.startsWith("CREATE TABLE IF NOT EXISTS uc_cases (")));
  assert.ok(at > UC_DDL.findLastIndex((s) => s.startsWith("CREATE INDEX IF NOT EXISTS ") || s.startsWith("CREATE UNIQUE INDEX IF NOT EXISTS ")));
  assert.ok(at < UC_DDL.findIndex((s) => s.startsWith("CREATE OR REPLACE TRIGGER ")));

  // Same name and same duplicates rule as uc-doctor (and the 0020 of the Use case page): every row on
  // the same card counts, complete or not, because a failed creation can leave an incomplete one.
  assert.equal(UC_UNIQUE_DOSSIER_INDEX, "uc_cases_portfolio_use_case_unique_idx");
  assert.equal(UC_UNIQUE_DOSSIER_INDEX, DOCTOR_UNIQUE_DOSSIER_INDEX);
  assert.ok(DOCTOR_INDEX_SQL.includes(`to_regclass('public.${UC_UNIQUE_DOSSIER_INDEX}')`));
  const rule = "FROM uc_cases WHERE portfolio_use_case_id IS NOT NULL GROUP BY portfolio_use_case_id HAVING count(*) > 1";
  assert.equal(UC_DOSSIER_DUPLICATES_CONDITION, `SELECT 1 ${rule}`);
  assert.ok(DOCTOR_DUPLICATES_SQL.replace(/\s+/g, " ").includes(rule));
  assert.doesNotMatch(UC_UNIQUE_DOSSIER_INDEX_DDL, /setup_completed_at/);

  // Only when the index is missing: lock, check, then NOTICE or create. Never an exception, so a
  // duplicate cannot roll back the single uc self-heal transaction and switch the section off.
  const block = UC_UNIQUE_DOSSIER_INDEX_DDL;
  assert.ok(block.startsWith("DO $uc$\n") && block.endsWith("\n$uc$"));
  assert.doesNotMatch(block, /RAISE EXCEPTION|EXCEPTION WHEN/);
  const steps = [
    `IF to_regclass('public.${UC_UNIQUE_DOSSIER_INDEX}') IS NULL THEN`,
    "LOCK TABLE uc_cases IN SHARE MODE;",
    `IF EXISTS (${UC_DOSSIER_DUPLICATES_CONDITION}) THEN`,
    "RAISE NOTICE 'uc_cases: piu dossier sulla stessa scheda",
    "esegui use-case-admin dossier-dups.';",
    "ELSE",
    `CREATE UNIQUE INDEX IF NOT EXISTS ${UC_UNIQUE_DOSSIER_INDEX}\n        ON uc_cases (portfolio_use_case_id) WHERE portfolio_use_case_id IS NOT NULL;`,
  ];
  const positions = steps.map((step) => block.indexOf(step));
  for (const [i, p] of positions.entries()) assert.ok(p >= 0, steps[i]);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "lock, check, NOTICE, else create");

  // The old non-unique index stays (it goes in phase 6).
  const old = UC_INDEXES.find((i) => i.name === "uc_cases_portfolio_use_case_idx");
  assert.ok(old && !old.unique && old.on === "portfolio_use_case_id");

  // With the index missing, the log names the remedy from the same duplicates rule.
  assert.equal(UC_DOSSIER_DUPLICATES_SQL, `SELECT EXISTS (${UC_DOSSIER_DUPLICATES_CONDITION}) AS duplicates`);
});

test("ddl.ts stays pure and imports only vocab.ts", () => {
  const source = readFileSync(resolve(repoRoot, "src/lib/uc/ddl.ts"), "utf8");
  const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./vocab.ts"]);
});

test("isolation and privacy constraints from the plan are present", () => {
  const sql = createTables.join("\n");
  for (const fragment of [
    "CONSTRAINT uc_items_case_id_id_key UNIQUE (case_id, id)",
    "CONSTRAINT uc_requests_case_id_id_key UNIQUE (case_id, id)",
    "FOREIGN KEY (case_id, item_id) REFERENCES uc_items (case_id, id) ON DELETE CASCADE",
    "CONSTRAINT uc_blockers_sanitario_permanent_chk CHECK (key <> 'sanitario' OR status = 'permanente')",
    "CONSTRAINT uc_kpi_measurements_min_sample_chk CHECK (suppressed OR sample_size >= 5)",
    "CONSTRAINT uc_roi_models_human_review_included_chk CHECK (includes_human_review_time)",
    "CONSTRAINT uc_templates_confidential_restricted_chk",
    "CONSTRAINT uc_requests_expiry_when_sent_chk CHECK (status = 'bozza' OR expires_at IS NOT NULL)",
    // Not applicable only with both signatures: Lateral Space and the client (account or link).
    "CONSTRAINT uc_items_non_applicabile_signed_chk CHECK (status <> 'non_applicabile' OR (na_approved_at IS NOT NULL AND na_approved_by_user_id IS NOT NULL AND (na_client_approved_by_user_id IS NOT NULL OR na_approved_by_contact_id IS NOT NULL)))",
  ]) {
    assert.ok(sql.includes(fragment), fragment);
  }
  const late = UC_DDL.filter((s) => s.includes("REFERENCES uc_answers (item_id, id)") && s.startsWith("DO $uc$"));
  assert.equal(late.length, 2, "current and validated answers belong to the same item");
});
