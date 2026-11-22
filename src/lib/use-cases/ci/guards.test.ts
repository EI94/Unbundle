import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TOKEN_PREFIXES, findTokenInUrl } from "../../connector/http-hygiene.ts";
import { enqueueSql } from "../../db/queries/uc-notifications.ts";
import { CI_KEY_PREFIX, newCiKey } from "./keys.ts";

// Le prove di guardia della chiave della CI (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.2, §2.7, §3.2):
// - `ub_ci_` è tra i prefissi dei token che le difese riconoscono in un indirizzo, e la rotta della CLI revoca la chiave;
// - la tabella delle chiavi la legge e la scrive un modulo solo;
// - nessuna lettura raggruppa o ordina per chi ha creato o revocato una chiave, e la pagina non legge mai chi;
// - `ub_ci_` mai nei log: i moduli della chiave non scrivono sulla console, solo codici con `logSafeError`.

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** I file di codice sotto `src/` e `scripts/` (niente prove, niente documenti). */
function codeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|mjs|cjs|js)$/.test(name) && !/\.test\.(ts|tsx|mjs)$/.test(name)) out.push(relative(root, path));
    }
  };
  walk(join(root, "src"));
  walk(join(root, "scripts"));
  return out;
}

test("il prefisso della chiave della CI è tra i prefissi bloccati: una chiave della CI in un indirizzo si riconosce, nella query, nel percorso, codificata", () => {
  assert.ok(DEFAULT_TOKEN_PREFIXES.includes(CI_KEY_PREFIX));
  assert.ok(DEFAULT_TOKEN_PREFIXES.includes("ub_cli_"), "i prefissi di prima restano");
  const key = newCiKey();
  for (const url of [`https://app.test/api/ci/casi?x=${key}`, `https://app.test/api/ci/${key}`, `https://app.test/api/cli/evals?q=${encodeURIComponent(`Bearer ${key}`)}`]) {
    assert.deepEqual(findTokenInUrl(url), { found: true, candidates: [key] }, url.slice(0, 40));
  }
  // La rotta della CLI (e quella della CI) revoca la chiave prima di rispondere 400.
  const kit = read("src/lib/use-cases/cli/route-kit.ts");
  assert.match(kit, /const TOKEN_PREFIXES = \[\.\.\.DEFAULT_TOKEN_PREFIXES, CLI_TOKEN_PREFIX, CLI_DEVICE_CODE_PREFIX\];/);
  const screen = kit.slice(kit.indexOf("export async function screenCliRequest("), kit.indexOf("export async function revokeCiKeysInUrl("));
  assert.ok(screen.indexOf("await revokeCiKeysInUrl(finding.candidates);") > 0, "screenCliRequest revoca le chiavi della CI");
  assert.ok(screen.indexOf("await revokeCiKeysInUrl(finding.candidates);") < screen.indexOf('cliError(400, "token_nell_indirizzo"'));
  const revoke = kit.slice(kit.indexOf("export async function revokeCiKeysInUrl("), kit.indexOf("/**", kit.indexOf("export async function revokeCiKeysInUrl(")));
  assert.match(revoke, /revokeExposedCiKeys\(executor, keys, ucLsDomains\(\)\)/);
  assert.match(revoke, /after\(async \(\) => \{/, "l'e-mail parte dopo la risposta");
  assert.ok(!/console\./.test(revoke), "solo logSafeError: mai la chiave");
  assert.match(revoke, /logSafeError\("ci", /);
});

test("la coda delle notifiche rifiuta una chiave della CI come chiave di deduplica", () => {
  const spec = { workspaceId: "11111111-1111-4111-8111-111111111111", recipient: { userId: "22222222-2222-4222-8222-222222222222" }, channel: "email" as const, templateKey: "chiave_ci_creata" as const };
  assert.doesNotThrow(() => enqueueSql({ ...spec, dedupeKey: "chiave_ci_creata:11111111-1111-4111-8111-111111111111" }));
  assert.throws(() => enqueueSql({ ...spec, dedupeKey: newCiKey() }), /deduplica/);
});

test("la tabella delle chiavi la legge e la scrive un modulo solo (più il DDL e le prove)", () => {
  const allowed = new Set(["src/lib/db/use-case-hub-ci-keys-ddl.ts", "src/lib/db/queries/use-case-ci-keys.ts"]);
  const readers = codeFiles().filter((path) => /\buse_case_ci_keys\b/.test(read(path)));
  assert.deepEqual(readers.filter((path) => !allowed.has(path)), [], "fuori dal modulo delle chiavi");
  assert.ok(readers.includes("src/lib/db/queries/use-case-ci-keys.ts"));
});

test("nessuna lettura raggruppa o ordina per chi ha creato o revocato una chiave; chi sta solo nel registro", () => {
  const store = read("src/lib/db/queries/use-case-ci-keys.ts");
  const person = /created_by_user_id|revoked_by_user_id/;
  // Dentro ogni SQL: niente GROUP BY, ORDER BY, PARTITION BY, DISTINCT ON o count per persona.
  for (const sql of store.match(/ucSql`[^`]*`/g) ?? []) {
    for (const clause of sql.match(/(GROUP BY|ORDER BY|PARTITION BY|DISTINCT ON|count\()[^;]*/gi) ?? []) {
      assert.ok(!person.test(clause.split(/\b(FROM|WHERE|LIMIT|RETURNING|SELECT)\b/i)[0]), clause.slice(0, 80));
    }
  }
  // Chi ha creato una chiave si scrive solo nell'INSERT; chi l'ha revocata solo nell'UPDATE della revoca; mai letti.
  for (const line of store.split("\n").filter((l) => /created_by_user_id/.test(l))) assert.match(line, /INSERT INTO use_case_ci_keys \(/, line.trim());
  for (const line of store.split("\n").filter((l) => /revoked_by_user_id/.test(l))) assert.match(line, /SET revoked_at = now\(\), revoked_reason = 'a_mano', revoked_by_user_id = /, line.trim());
  const columns = store.match(/const KEY_COLUMNS = raw\("([^"]+)"\)/)?.[1] ?? "";
  assert.ok(columns.includes("k.created_at") && !person.test(columns) && !/token_hash/.test(columns), "la pagina legge date e prefissi, mai chi né l'impronta");
  assert.ok(!/SELECT k\.\*|SELECT \*/.test(store), "mai tutte le colonne");
});

test("il prefisso della chiave della CI mai nei log: i moduli della chiave non scrivono sulla console", () => {
  const keyModules = ["src/lib/use-cases/ci/keys.ts", "src/lib/db/queries/use-case-ci-keys.ts", "src/lib/actions/ci-keys.ts", "scripts/use-case-admin/ci-keys.ts", "scripts/use-case-admin/ci-key-revoke.ts"];
  for (const path of keyModules) {
    let text: string;
    try {
      text = read(path);
    } catch {
      continue;
    }
    assert.ok(!/console\.(log|info|warn|error|debug)\(/.test(text), `${path}: solo codici, con logSafeError o ucLogError`);
  }
  // E nessun file di codice scrive un prefisso della chiave in un log o in un testo.
  for (const path of codeFiles()) {
    const text = read(path);
    assert.ok(!/console\.\w+\([^)]*ub_ci_/.test(text), path);
  }
});
