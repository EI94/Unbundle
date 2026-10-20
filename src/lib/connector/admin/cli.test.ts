import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJson,
  checkDatabaseTarget,
  CONNECTOR_ADMIN_COMMANDS,
  databaseFingerprint,
  parseAdminOptions,
  parseCommandName,
  truncateTitle,
} from "./cli.ts";

// Opzioni e conferme di `scripts/connector-admin.ts` (prompt WP8, K8). Modulo puro.

const WS = "11111111-1111-4111-8111-111111111111";
const LOCAL = "postgresql://uc_test@127.0.0.1:55469/conn_k8";
const REMOTE = "postgresql://utente:password-segreta@db.esempio.test:5432/prova?sslmode=require";
const APPLY_LOCAL = ["--apply", "--confirm-authorized", "--confirm-database", "127.0.0.1:55469/conn_k8", "--environment", "local"];

test("comandi: i cinque di K8; scoring-model passa all'hub; un comando sconosciuto si rifiuta", () => {
  assert.deepEqual([...CONNECTOR_ADMIN_COMMANDS], ["config", "profile", "guide", "token", "backfill-codes"]);
  for (const name of CONNECTOR_ADMIN_COMMANDS) assert.deepEqual(parseCommandName([name]), { ok: true, value: name });
  const deferred = parseCommandName(["scoring-model"]);
  assert.equal(deferred.ok, false);
  if (!deferred.ok) {
    assert.equal(deferred.code, "non_disponibile");
    assert.match(deferred.message, /hub/);
  }
  for (const argv of [[], ["altro"], ["--apply"]]) assert.equal(parseCommandName(argv).ok, false);
});

test("opzioni: --workspace obbligatorio e uuid; niente argomenti sciolti, ripetuti o sconosciuti", () => {
  assert.equal(parseAdminOptions([]).ok, false);
  assert.equal(parseAdminOptions(["--workspace", "non-un-id"]).ok, false);
  assert.equal(parseAdminOptions(["--workspace", WS, "sciolto"]).ok, false);
  assert.equal(parseAdminOptions(["--workspace", WS, "--workspace", WS]).ok, false);
  assert.equal(parseAdminOptions(["--workspace", WS, "--file", "x.json"]).ok, false, "--file solo se il comando lo dichiara");
  assert.equal(parseAdminOptions(["--workspace", WS, "--file"], { values: ["file"] }).ok, false, "manca il valore");
  const ok = parseAdminOptions(["--workspace", WS.toUpperCase(), "--file", "x.json", "--overwrite"], { values: ["file"], flags: ["overwrite"] });
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.equal(ok.value.workspaceId, WS);
  assert.equal(ok.value.apply, false);
  assert.equal(ok.value.values.get("file"), "x.json");
  assert.ok(ok.value.flags.has("overwrite"));
});

test("--apply: conferma dell'operatore, ambiente e, in produzione, approvazione; le conferme senza --apply si rifiutano", () => {
  assert.ok(parseAdminOptions(["--workspace", WS, ...APPLY_LOCAL]).ok);
  const cases: Array<[string, string[], string]> = [
    ["senza conferma", ["--apply", "--environment", "local", "--confirm-database", "x"], "conferma"],
    ["senza ambiente", ["--apply", "--confirm-authorized", "--confirm-database", "x"], "ambiente"],
    ["ambiente sconosciuto", ["--apply", "--confirm-authorized", "--environment", "staging"], "ambiente"],
    ["produzione senza approvazione", ["--apply", "--confirm-authorized", "--environment", "production"], "ambiente"],
    ["conferma senza apply", ["--confirm-authorized"], "opzioni"],
    ["database senza apply", ["--confirm-database", "127.0.0.1:55469/conn_k8"], "opzioni"],
  ];
  for (const [label, extra, code] of cases) {
    const out = parseAdminOptions(["--workspace", WS, ...extra]);
    assert.equal(out.ok, false, label);
    if (!out.ok) assert.equal(out.code, code, label);
  }
  const prod = parseAdminOptions(["--workspace", WS, "--apply", "--confirm-authorized", "--environment", "production", "--production-approved"]);
  assert.ok(prod.ok && prod.value.environment === "production");
});

test("database: solo CONNECTOR_ADMIN_DATABASE_URL; conferma host[:porta]/database; ambiente coerente con l'host", () => {
  assert.equal(checkDatabaseTarget(undefined, false, undefined).ok, false);
  assert.equal(checkDatabaseTarget("  ", false, undefined).ok, false);
  assert.equal(checkDatabaseTarget("mysql://x@y/z", false, undefined).ok, false);
  assert.equal(checkDatabaseTarget("non un url", false, undefined).ok, false);
  // A secco basta un URL valido; l'impronta non contiene mai la password.
  const dry = checkDatabaseTarget(REMOTE, false, undefined);
  assert.ok(dry.ok);
  if (dry.ok) assert.equal(dry.value.fingerprint, "db.esempio.test:5432/prova");
  if (dry.ok) assert.doesNotMatch(dry.value.fingerprint, /password-segreta|utente/);
  assert.equal(databaseFingerprint(LOCAL), "127.0.0.1:55469/conn_k8");
  // Con --apply.
  assert.ok(checkDatabaseTarget(LOCAL, true, "127.0.0.1:55469/conn_k8", "local").ok);
  const wrongDb = checkDatabaseTarget(LOCAL, true, "127.0.0.1:55469/altro", "local");
  assert.equal(wrongDb.ok ? null : wrongDb.code, "database");
  const remoteAsLocal = checkDatabaseTarget(REMOTE, true, "db.esempio.test:5432/prova", "local");
  assert.equal(remoteAsLocal.ok ? null : remoteAsLocal.code, "ambiente");
  const loopbackAsProduction = checkDatabaseTarget(LOCAL, true, "127.0.0.1:55469/conn_k8", "production");
  assert.equal(loopbackAsProduction.ok ? null : loopbackAsProduction.code, "ambiente");
  assert.ok(checkDatabaseTarget(REMOTE, true, "db.esempio.test:5432/prova", "preview").ok);
  for (const out of [wrongDb, remoteAsLocal, loopbackAsProduction]) assert.doesNotMatch(JSON.stringify(out), /password-segreta/);
});

test("titoli troncati e JSON canonico", () => {
  assert.equal(truncateTitle("  Titolo   breve "), "Titolo breve");
  assert.equal(truncateTitle("x".repeat(80)).length, 60);
  assert.ok(truncateTitle("x".repeat(80)).endsWith("…"));
  assert.equal(truncateTitle(null), "");
  assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  assert.equal(canonicalJson(undefined), "null");
});
