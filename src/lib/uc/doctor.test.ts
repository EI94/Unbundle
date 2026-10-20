import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { DOCTOR_DUPLICATES_SQL, checkUcDatabase, checkUcEnv, doctorExitCode, formatDoctorReport, type DoctorCheck, type UcDbFacts } from "./doctor.ts";

const A = "0f8e2a64-1b7c-4d3e-9a5f-6c2b1d0e9f8a";
const B = "7c1d9e2f-3a4b-4c5d-8e6f-0a1b2c3d4e5f";
const KEY = randomBytes(32).toString("base64");

const status = (checks: DoctorCheck[], key: string) => checks.find((c) => c.key === key)?.status;

/** A complete production environment (placeholders, never real values). */
function production(extra: Record<string, string | undefined> = {}) {
  return {
    UC_ENABLED: "true",
    UC_WORKSPACE_IDS: A,
    USE_CASE_HUB_WORKSPACES: `${A},${B}`,
    UC_LS_EMAIL_DOMAINS: "ls.test",
    UC_SECRET: "segreto-di-prova",
    CRON_SECRET: "cron-di-prova",
    UC_SCHEMA_SELF_HEAL: "off",
    NEXT_PUBLIC_APP_URL: "https://app.example.test",
    RESEND_API_KEY: "chiave-di-prova",
    UC_EMAIL_FROM: "Prova <avvisi@example.test>",
    BLOB_READ_WRITE_TOKEN: "store-standard-di-prova",
    ...extra,
  };
}

test("a complete production environment is green", () => {
  const checks = checkUcEnv(production(), "production");
  assert.equal(doctorExitCode(checks), 0, formatDoctorReport(checks));
  assert.ok(checks.every((c) => c.status === "ok"), formatDoctorReport(checks));
  // No value of a variable ever reaches the report.
  const text = formatDoctorReport(checks);
  for (const secret of ["segreto-di-prova", "cron-di-prova", "chiave-di-prova", "store-standard-di-prova"]) assert.ok(!text.includes(secret), secret);
});

test("production rules: no wildcard, self-heal off, secrets, https, the Use case page first", () => {
  assert.equal(status(checkUcEnv(production({ UC_WORKSPACE_IDS: "*" }), "production"), "UC_WORKSPACE_IDS"), "errore");
  assert.equal(status(checkUcEnv(production({ UC_SCHEMA_SELF_HEAL: "on" }), "production"), "UC_SCHEMA_SELF_HEAL"), "errore");
  // Unset is fine: production switches the uc self-heal off by default.
  assert.equal(status(checkUcEnv(production({ UC_SCHEMA_SELF_HEAL: undefined }), "production"), "UC_SCHEMA_SELF_HEAL"), "ok");
  assert.equal(status(checkUcEnv(production({ UC_SECRET: "" }), "production"), "UC_SECRET"), "errore");
  assert.equal(status(checkUcEnv(production({ CRON_SECRET: undefined }), "production"), "CRON_SECRET"), "errore");
  assert.equal(status(checkUcEnv(production({ NEXT_PUBLIC_APP_URL: "http://app.example.test" }), "production"), "NEXT_PUBLIC_APP_URL"), "errore");
  assert.equal(status(checkUcEnv(production({ UC_LS_EMAIL_DOMAINS: undefined }), "production"), "UC_LS_EMAIL_DOMAINS"), "errore");
  assert.equal(status(checkUcEnv(production({ BLOB_READ_WRITE_TOKEN: undefined }), "production"), "BLOB_READ_WRITE_TOKEN"), "errore");
  // A dossier workspace without the Use case page: error in production, warning elsewhere.
  const off = { USE_CASE_HUB_WORKSPACES: B };
  assert.equal(status(checkUcEnv(production(off), "production"), "USE_CASE_HUB_WORKSPACES"), "errore");
  assert.equal(status(checkUcEnv(production(off), "preview"), "USE_CASE_HUB_WORKSPACES"), "avviso");
  assert.equal(status(checkUcEnv(production({ USE_CASE_HUB_WORKSPACES: undefined }), "production"), "USE_CASE_HUB_WORKSPACES"), "errore");
  // The hub list is a plain comma list: «*» and spaces are reported, never read as «all».
  const star = checkUcEnv(production({ USE_CASE_HUB_WORKSPACES: "*" }), "production");
  assert.equal(status(star, "USE_CASE_HUB_WORKSPACES.voci"), "avviso");
  assert.equal(status(star, "USE_CASE_HUB_WORKSPACES"), "errore");
});

test("outside production the harness is accepted with warnings only", () => {
  const harness = {
    UC_ENABLED: "true",
    UC_WORKSPACE_IDS: "*",
    UC_LS_EMAIL_DOMAINS: "ls.test",
    UC_SECRET: "x",
    CRON_SECRET: "y",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:53110",
    UC_LOCAL_STORAGE_DIR: "/private/tmp/prova/uc-blob",
    UC_PERSONAL_ZONE_KEY: KEY,
  };
  const checks = checkUcEnv(harness, "local");
  assert.equal(doctorExitCode(checks), 0, formatDoctorReport(checks));
  assert.equal(status(checks, "NEXT_PUBLIC_APP_URL"), "ok");
  assert.equal(status(checks, "UC_WORKSPACE_IDS"), "avviso");
  assert.equal(status(checks, "UC_EMAIL_FROM"), "avviso");
  assert.equal(status(checks, "UC_PERSONAL_ZONE_KEY"), "ok");
  // http is only for loopback, and only on the harness.
  assert.equal(status(checkUcEnv({ ...harness, NEXT_PUBLIC_APP_URL: "http://app.example.test" }, "local"), "NEXT_PUBLIC_APP_URL"), "errore");
  assert.equal(status(checkUcEnv({ ...harness, NEXT_PUBLIC_APP_URL: "http://127.0.0.1:53110" }, "preview"), "NEXT_PUBLIC_APP_URL"), "errore");
});

test("the personal zone: a 32-byte key and a separate store, or neither", () => {
  assert.equal(status(checkUcEnv(production(), "production"), "UC_PERSONAL_ZONE_KEY"), "ok");
  const both = checkUcEnv(production({ UC_PERSONAL_ZONE_KEY: KEY, UC_PERSONAL_BLOB_READ_WRITE_TOKEN: "store-personale" }), "production");
  assert.equal(status(both, "UC_PERSONAL_ZONE_KEY"), "ok");
  assert.equal(status(both, "UC_PERSONAL_BLOB_READ_WRITE_TOKEN"), "ok");
  const same = checkUcEnv(production({ UC_PERSONAL_ZONE_KEY: KEY, UC_PERSONAL_BLOB_READ_WRITE_TOKEN: "store-standard-di-prova" }), "production");
  assert.equal(status(same, "UC_PERSONAL_BLOB_READ_WRITE_TOKEN"), "errore");
  assert.equal(status(checkUcEnv(production({ UC_PERSONAL_ZONE_KEY: "corta" }), "production"), "UC_PERSONAL_ZONE_KEY"), "errore");
  assert.equal(status(checkUcEnv(production({ UC_PERSONAL_ZONE_KEY: KEY }), "production"), "UC_PERSONAL_BLOB_READ_WRITE_TOKEN"), "avviso");
});

test("a switched-off section is not an error", () => {
  const checks = checkUcEnv({}, "production");
  assert.equal(status(checks, "UC_ENABLED"), "avviso");
  assert.equal(status(checks, "UC_LS_EMAIL_DOMAINS"), "avviso");
  assert.equal(status(checks, "UC_SECRET"), "avviso");
  assert.equal(status(checks, "UC_SCHEMA_SELF_HEAL"), "ok", "production never self-heals unless told to");
  assert.deepEqual(
    checks.filter((c) => c.status === "errore").map((c) => c.key),
    [],
  );
});

const GOOD: UcDbFacts = { ucTables: 27, probeCurrent: true, duplicateGroups: 0, duplicateRows: 0, uniqueIndex: true, orphanDossiers: 0, listedWorkspacesFound: 1, listedWorkspaces: 1 };

test("database: probe, duplicates with the 0020 condition, unique index, orphans", () => {
  const ok = checkUcDatabase(GOOD, { environment: "production", ucEnabled: true });
  assert.equal(doctorExitCode(ok), 0, formatDoctorReport(ok));
  assert.equal(status(checkUcDatabase({ ...GOOD, probeCurrent: false }, { environment: "production", ucEnabled: true }), "sonda"), "errore");
  const dups = checkUcDatabase({ ...GOOD, duplicateGroups: 1, duplicateRows: 2 }, { environment: "preview", ucEnabled: true });
  assert.equal(status(dups, "doppioni"), "errore");
  assert.match(dups.find((c) => c.key === "doppioni")!.message, /complete e incomplete/);
  assert.equal(status(checkUcDatabase({ ...GOOD, uniqueIndex: false }, { environment: "production", ucEnabled: true }), "indice_unico"), "avviso");
  assert.equal(status(checkUcDatabase({ ...GOOD, orphanDossiers: 3 }, { environment: "production", ucEnabled: true }), "schede_madri"), "avviso");
  assert.equal(status(checkUcDatabase({ ...GOOD, listedWorkspacesFound: 0 }, { environment: "production", ucEnabled: true }), "workspace"), "avviso");
  assert.equal(status(checkUcDatabase({ ...GOOD, ucTables: 0 }, { environment: "production", ucEnabled: true }), "schema"), "errore");
  assert.equal(status(checkUcDatabase({ ...GOOD, ucTables: 0 }, { environment: "production", ucEnabled: false }), "schema"), "avviso");
  assert.equal(status(checkUcDatabase({ ...GOOD, ucTables: 20 }, { environment: "production", ucEnabled: true }), "schema"), "errore");
});

test("duplicates count every row with a use case, complete or not, like the 0020", () => {
  assert.match(DOCTOR_DUPLICATES_SQL, /portfolio_use_case_id IS NOT NULL/);
  assert.match(DOCTOR_DUPLICATES_SQL, /HAVING count\(\*\) > 1/);
  assert.doesNotMatch(DOCTOR_DUPLICATES_SQL, /setup_completed_at/);
});
