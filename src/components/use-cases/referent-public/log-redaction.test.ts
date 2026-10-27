import test from "node:test";
import assert from "node:assert/strict";
import { areaForPath, idsFromPath, redactUcPath, ucLogLine } from "../../../lib/uc/log.ts";

// Nei log (instrumentation.ts) il token del link di «Chiedi al referente» non compare mai: il percorso
// `/rispondi/<token>` e le sue API diventano `[token]`, con un'area loro (SPEC §9.2).

const TOKEN = `ucq_${"Ab3_-x".repeat(5)}Zz`;

test("il token del link non arriva mai al log", () => {
  assert.equal(TOKEN.length, 36);
  assert.equal(redactUcPath(`/rispondi/${TOKEN}`), "/rispondi/[token]");
  assert.equal(redactUcPath(`/rispondi/${TOKEN}?x=1#fine`), "/rispondi/[token]");
  assert.equal(redactUcPath(`/api/rispondi/${TOKEN}`), "/api/rispondi/[token]");
  assert.equal(redactUcPath(`/api/rispondi/${TOKEN}/submit`), "/api/rispondi/[token]/submit");
  assert.equal(redactUcPath(`/api/rispondi/${TOKEN}/upload-complete`), "/api/rispondi/[token]/upload-complete");
  assert.equal(redactUcPath(`https://www.example.test/rispondi/${TOKEN}`), "/rispondi/[token]");
  // Anche un link sbagliato o corto: mai il segmento com'era.
  assert.equal(redactUcPath("/rispondi/abc"), "/rispondi/[token]");
  // Un «rispondi» più in profondità non è il link.
  assert.equal(redactUcPath("/dashboard/rispondi/visibile"), "/dashboard/rispondi/visibile");
  const line = ucLogLine({ level: "error", area: "app", op: "richiesta", route: redactUcPath(`/api/rispondi/${TOKEN}/draft`) });
  assert.ok(!JSON.stringify(line).includes(TOKEN));
});

test("l'area del log e nessun id dal percorso", () => {
  assert.equal(areaForPath("/rispondi/[token]"), "use-case.rispondi");
  assert.equal(areaForPath("/api/rispondi/[token]/submit"), "use-case.rispondi");
  assert.equal(areaForPath("/rispondi"), "use-case.rispondi");
  assert.equal(areaForPath("/rispondi-altro"), "app");
  // I link dei dossier restano com'erano.
  assert.equal(areaForPath("/r/[token]"), "uc.r");
  assert.equal(redactUcPath(`/r/${TOKEN}`), "/r/[token]");
  assert.deepEqual(idsFromPath("/rispondi/[token]"), {});
});
