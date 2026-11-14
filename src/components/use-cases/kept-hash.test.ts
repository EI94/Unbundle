// Il rinvio breve del progetto dell'agente tiene l'ancora (#banco, #compiti): src/components/use-cases/kept-hash.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { isInternalPath, keptHash } from "./kept-hash.ts";

test("si riattacca solo un'ancora semplice della pagina", () => {
  assert.equal(keptHash("#banco"), "#banco");
  assert.equal(keptHash("#compiti"), "#compiti");
  assert.equal(keptHash(""), "");
  assert.equal(keptHash("#"), "");
  assert.equal(keptHash("#1abc"), "");
  assert.equal(keptHash("#banco?x=1"), "");
  assert.equal(keptHash("#a/b"), "");
  assert.equal(keptHash(`#${"a".repeat(65)}`), "");
});

test("si rinvia solo dentro il sito", () => {
  assert.ok(isInternalPath("/dashboard/w/casi-duso/c/progetto"));
  assert.ok(!isInternalPath("//altro.example/x"));
  assert.ok(!isInternalPath("/\\altro.example"));
  assert.ok(!isInternalPath("https://altro.example/x"));
});
