// I codici e i token della CLI (rilascio 8.0b): forma, alfabeto, etichetta pulita, ambiti.
import test from "node:test";
import assert from "node:assert/strict";
import {
  caseScopeOf,
  cleanClientLabel,
  cliScopes,
  CLI_DEFAULT_LABEL,
  CLI_TOKEN_PREFIX,
  hashSecret,
  isDeviceCode,
  newCliToken,
  newDeviceCode,
  newUserCode,
  normalizeUserCode,
  tokenPrefixOf,
} from "./codes.ts";
import { CLI_USER_CODE_ALPHABET } from "../../db/use-case-hub-cli-ddl.ts";
import { bearerTokenFromHeader } from "../../connector/auth.ts";

const UC = "3f2a9c1e-0000-4000-8000-0000000000b2";

test("il codice da leggere: otto consonanti dell'alfabeto, con il trattino; ogni lettera può uscire", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 400; i += 1) {
    const code = newUserCode();
    assert.match(code, new RegExp(`^[${CLI_USER_CODE_ALPHABET}]{4}-[${CLI_USER_CODE_ALPHABET}]{4}$`));
    for (const c of code.replace("-", "")) seen.add(c);
  }
  assert.equal(seen.size, CLI_USER_CODE_ALPHABET.length);
  assert.equal(newUserCode(() => 0), "BBBB-BBBB");
});

test("il codice come lo scrive una persona diventa canonico; un codice impossibile è null", () => {
  assert.equal(normalizeUserCode("bcdf-ghjk"), "BCDF-GHJK");
  assert.equal(normalizeUserCode(" BCDF GHJK "), "BCDF-GHJK");
  assert.equal(normalizeUserCode("bcdfghjk"), "BCDF-GHJK");
  for (const bad of ["ABCD-EFGH", "BCDF-GHJ", "BCDF-GHJKL", "BCD0-GHJK", "", null, 12345678]) assert.equal(normalizeUserCode(bad), null, String(bad));
});

test("codice della CLI e token: casuali, con il loro prefisso, solo l'impronta va salvata", () => {
  const device = newDeviceCode();
  assert.ok(isDeviceCode(device));
  assert.ok(!isDeviceCode(`${device}x`));
  assert.ok(!isDeviceCode("ub_dev_corto"));
  assert.notEqual(newDeviceCode(), device);
  const token = newCliToken();
  assert.ok(token.startsWith(CLI_TOKEN_PREFIX));
  assert.equal(bearerTokenFromHeader(`Bearer ${token}`, CLI_TOKEN_PREFIX), token, "lo legge l'header come gli altri token");
  assert.equal(bearerTokenFromHeader(`Bearer ${token}`, "ub_team_"), null);
  assert.equal(tokenPrefixOf(token), token.slice(0, 11));
  assert.match(hashSecret(token), /^[0-9a-f]{64}$/);
  assert.notEqual(hashSecret(token), hashSecret(newCliToken()));
});

test("l'etichetta: niente e-mail né simboli strani, al massimo 80 caratteri; vuota è «CLI di Unbundle»", () => {
  assert.equal(cleanClientLabel("CLI · macOS · repository-del-caso"), "CLI · macOS · repository-del-caso");
  assert.equal(cleanClientLabel("CLI di mario.rossi@esempio.test <script>"), "CLI di script");
  assert.equal(cleanClientLabel("x".repeat(200)).length, 80);
  for (const empty of ["", "   ", "@@@ ###", null, 42]) assert.equal(cleanClientLabel(empty), CLI_DEFAULT_LABEL, String(empty));
});

test("gli ambiti: «cli» per tutti i casi della persona, più «caso:<id>» per un caso solo", () => {
  assert.deepEqual(cliScopes(), ["cli"]);
  assert.deepEqual(cliScopes(UC), ["cli", `caso:${UC}`]);
  assert.throws(() => cliScopes("non-un-id"));
  assert.equal(caseScopeOf(["cli"]), null);
  assert.equal(caseScopeOf(["cli", `caso:${UC}`]), UC);
  for (const bad of [["use_cases:read"], ["cli", "caso:x"], ["cli", `caso:${UC}`, `caso:${UC}`], null, "cli"]) assert.equal(caseScopeOf(bad), false, JSON.stringify(bad));
});
