import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { forbiddenLogValues, isListening, phoneForms, serverLogTarget, spawnServer, stopServer, waitUntilListening } from "../../../scripts/connettore-test/smoke-support.mjs";
import { exampleSubmission } from "./contract.fixtures.ts";

// Helpers of scripts/connettore-test/smoke-run.mjs (prompt WP10). The child processes here are
// small `node -e` programs on a free loopback port: no Next, no database, no network.

const HOST = "127.0.0.1";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, HOST, done));
  const address = server.address();
  await new Promise<void>((done) => server.close(() => done()));
  assert.ok(address && typeof address === "object");
  return address.port;
}

const nodeChild = (code: string) => spawnServer({ command: process.execPath, args: ["-e", code], cwd: process.cwd(), env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } });

test("server del smoke: un figlio che non apre la porta in tempo resta nelle mani del chiamante, che lo ferma", async () => {
  const port = await freePort();
  const app = nodeChild("setInterval(() => {}, 1000)");
  try {
    await assert.rejects(waitUntilListening(app, { host: HOST, port, timeoutMs: 300 }), (error: Error) => {
      assert.match(error.message, new RegExp(`did not listen on ${HOST}:${port} within 0 s \\(child process ${app.child.pid}\\)`));
      return true;
    });
    assert.equal(app.exited, null, "l'attesa non ferma il figlio: lo fa stopServer");
  } finally {
    assert.equal(await stopServer(app, { host: HOST, port }), true);
  }
  assert.equal(app.exited, "SIGTERM");
  assert.equal(app.stopped, true);
  assert.equal(await stopServer(app, { host: HOST, port }), true, "una seconda chiamata non fa nulla");
});

test("server del smoke: un figlio che ascolta viene atteso, poi fermato con la porta libera", async () => {
  const port = await freePort();
  const app = nodeChild(`require("node:net").createServer().listen(${port}, "${HOST}", () => console.log("pronto"))`);
  try {
    const readyMs = await waitUntilListening(app, { host: HOST, port, timeoutMs: 10_000 });
    assert.ok(readyMs > 0 && app.readyMs === readyMs);
    assert.equal(await isListening(HOST, port), true);
  } finally {
    assert.equal(await stopServer(app, { host: HOST, port }), true);
  }
  assert.equal(await isListening(HOST, port), false);
  assert.match(app.output.join(""), /pronto/, "l'uscita del figlio resta per il controllo del log");
});

test("server del smoke: un figlio che esce prima di ascoltare si segnala con il suo codice", async () => {
  const port = await freePort();
  const app = nodeChild("process.exit(3)");
  await assert.rejects(waitUntilListening(app, { host: HOST, port, timeoutMs: 10_000 }), /exited before listening \(3\)/);
  assert.equal(await stopServer(app, { host: HOST, port }), true);
  assert.equal(await stopServer(null, { host: HOST, port }), true, "senza figlio non c'è nulla da fermare");
});

test("log del smoke: i valori vietati vengono dall'invio davvero mandato, a ogni profondità, nome ed email compresi", () => {
  // Un invio come quello di --submission-file: testi diversi da quelli d'esempio.
  const fromFile = exampleSubmission({
    title: "Titolo del file di prova",
    problem: "Problema scritto solo nel file di prova.",
    flowDescription: "Flusso scritto solo nel file di prova.",
    toolsOther: "Strumento descritto nel file",
    promptSnippet: "Frammento di prompt del file di prova.",
    sourceConversation: "Conversazione di origine del file.",
    sustainabilityImpact: "Impatto ambientale del file.",
    submittedBy: { name: "Proponente del file", email: "proponente.file@esempio.test" },
  });
  const values = forbiddenLogValues(fromFile, ["ub_mcp_", "", null, undefined, "abc123"]);
  for (const expected of [
    fromFile.title,
    fromFile.problem,
    fromFile.flowDescription,
    fromFile.toolsOther,
    fromFile.humanInTheLoop,
    fromFile.guardrails,
    fromFile.expectedImpact,
    fromFile.dataRequirements,
    fromFile.sustainabilityImpact,
    fromFile.promptSnippet,
    fromFile.sourceConversation,
    fromFile.proposerEstimate.efficiency.reasoning,
    fromFile.proposerEstimate.effort.reasoning,
    fromFile.proposerEstimate.impactFlag.reasoning,
    "Proponente del file",
    "proponente.file@esempio.test",
    "ub_mcp_",
    "abc123",
  ]) {
    assert.ok(values.includes(String(expected)), `manca un valore da cercare (${String(expected).slice(0, 12)}…)`);
  }
  // I valori pubblici della guida (enum) e le chiavi non si cercano: comparirebbero per caso.
  for (const publicValue of [fromFile.area, fromFile.company, fromFile.contributionKind, fromFile.frequency, fromFile.developmentStatus, fromFile.guideVersion, fromFile.idempotencyKey, ...fromFile.tools, "verde"]) {
    assert.ok(!values.includes(publicValue), `${publicValue}: valore pubblico cercato`);
  }
  assert.ok(!values.includes(""), "nessun valore vuoto: troverebbe tutto");
  // Senza file: l'invio d'esempio con il solo nome dello smoke (niente email).
  const smoke = forbiddenLogValues(exampleSubmission({ submittedBy: { name: "Persona di prova dello smoke" } }));
  assert.ok(smoke.includes("Persona di prova dello smoke"));
  assert.ok(!smoke.includes("proponente@esempio.test"));
  assert.ok(smoke.includes(exampleSubmission().problem));
});

test("log del smoke: il telefono inventato si cerca come scritto e solo cifre, con e senza prefisso", () => {
  assert.deepEqual(phoneForms("+39 347 000 1122").sort(), ["+39 347 000 1122", "347 000 1122", "393470001122", "3470001122"].sort());
  assert.deepEqual(phoneForms("347 123 4567").sort(), ["347 123 4567", "3471234567"].sort());
});

test("log del smoke: si salva solo sotto un UC_TEST_ROOT temporaneo fuori da git, altrimenti si dice perché no", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const saved = process.env.UC_TEST_ROOT;
  try {
    process.env.UC_TEST_ROOT = "/private/tmp/conn-prova/";
    assert.deepEqual(serverLogTarget("ab12cd34"), { dir: "/private/tmp/conn-prova/conn-evidence/k10", file: "/private/tmp/conn-prova/conn-evidence/k10/next-start-ab12cd34.log" });
    process.env.UC_TEST_ROOT = "/tmp/conn-prova";
    assert.equal("file" in serverLogTarget("ab12cd34"), true);
    // Relativo, dentro la checkout o in un'altra cartella: mai nella copia di lavoro di git.
    for (const root of ["conn", "./conn-evidence", repoRoot, `${repoRoot}/conn`, "/Users/prova/conn", "/private/tmpx/conn", "/tmp/../Users/prova/conn", "/private/tmp/"]) {
      process.env.UC_TEST_ROOT = root;
      const target = serverLogTarget("ab12cd34");
      assert.ok("reason" in target, `${root}: il log non va salvato qui`);
      assert.match(target.reason, /cartella temporanea fuori da git/);
    }
    for (const root of [undefined, "", "  "]) {
      if (root === undefined) delete process.env.UC_TEST_ROOT;
      else process.env.UC_TEST_ROOT = root;
      assert.deepEqual(serverLogTarget("ab12cd34"), { reason: "UC_TEST_ROOT non impostata" });
    }
  } finally {
    if (saved === undefined) delete process.env.UC_TEST_ROOT;
    else process.env.UC_TEST_ROOT = saved;
  }
});
