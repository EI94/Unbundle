// La lettura delle evals per la pagina del progetto (rilascio 8.2a): un errore non fa cadere la pagina (va nel log,
// senza il messaggio, e la sezione lo dice), gli errori di Next passano, una forma inattesa non arriva alla pagina.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { analyzeBench, type BenchResult, type EvalOverview } from "../../lib/use-cases/factory/benchmark.ts";
import type { UcExecutor } from "../../lib/db/uc-executor.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

let readEvalOverview: typeof import("./eval-load.ts").readEvalOverview;
let notFound: () => never;
before(async () => {
  await enableTsxImports();
  ({ readEvalOverview } = await import("./eval-load.ts"));
  ({ notFound } = (await import("next/navigation")) as unknown as { notFound: () => never });
});

const EXECUTOR: UcExecutor = { batch: async () => [] };
const TARGET = { workspaceId: "ws-1", useCaseId: "uc-1" };

function recorder() {
  const lines: string[] = [];
  return { log: { error: (...args: unknown[]) => void lines.push(args.map(String).join(" ")) }, lines };
}

const result = (model: string, quality: number, cost: number | null, current = false): BenchResult => ({
  model,
  current,
  quality,
  passed: Math.round(quality * 28),
  total: 28,
  thresholdsMet: true,
  groups: {},
  costPer1000Usd: cost,
  latencyP50Ms: null,
  latencyP95Ms: null,
  tokensInAvg: null,
  tokensOutAvg: null,
  errors: 0,
});

function overview(results: BenchResult[]): EvalOverview {
  return {
    evals: { latest: null, trend: [] },
    benches: [
      {
        role: "lettura",
        run: { id: "r1", kind: "banco", role: "lettura", level: "pull_request", branch: "main", commit: null, templateVersion: null, models: {}, fakeModels: false, inConstruction: false, casesTotal: 28, createdAt: "2026-11-14T10:00:00.000Z", results },
        analysis: analyzeBench(results, { role: "lettura", fakeModels: false }),
      },
    ],
  };
}

test("una panoramica letta passa alla sezione, controllata", async () => {
  const { log, lines } = recorder();
  const data = overview([result("anthropic/claude-haiku-5-5", 0.95, 0.12, true)]);
  const read = await readEvalOverview(EXECUTOR, TARGET, { load: async () => data, log });
  assert.equal(read.unavailable, false);
  assert.deepEqual(read.overview, data);
  assert.deepEqual(lines, []);
  // Niente ancora: nessun avviso.
  assert.deepEqual(await readEvalOverview(EXECUTOR, TARGET, { load: async () => null, log }), { overview: null, unavailable: false });
  assert.deepEqual(lines, []);
});

test("un errore della lettura va nel log senza il messaggio, e la sezione lo dice", async () => {
  const { log, lines } = recorder();
  const failing = async () => {
    throw Object.assign(new Error("connessione persa per mario.rossi@example.com"), { code: "57P01" });
  };
  const read = await readEvalOverview(EXECUTOR, TARGET, { load: failing, log });
  assert.deepEqual(read, { overview: null, unavailable: true });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[progetto-banco\] lettura_fallita /);
  assert.match(lines[0], /"workspaceId":"ws-1","useCaseId":"uc-1"/);
  assert.match(lines[0], /"code":"57P01"/);
  assert.doesNotMatch(lines[0], /mario|example\.com|connessione/, "mai il messaggio, che può avere dati di persone");
});

test("gli errori di Next (notFound, redirect) non si fermano qui", async () => {
  const { log, lines } = recorder();
  await assert.rejects(
    readEvalOverview(EXECUTOR, TARGET, {
      load: async () => {
        notFound();
      },
      log,
    }),
    (error: unknown) => typeof (error as { digest?: unknown }).digest === "string",
  );
  assert.deepEqual(lines, []);
});

test("una forma inattesa non arriva alla pagina; le righe illeggibili si tolgono e si contano", async () => {
  const { log, lines } = recorder();
  const odd = await readEvalOverview(EXECUTOR, TARGET, { load: async () => ({ benches: "x" }) as unknown as EvalOverview, log });
  assert.deepEqual(odd, { overview: null, unavailable: true });
  assert.match(lines[0], /^\[progetto-banco\] forma_inattesa /);
  const broken = overview([result("anthropic/claude-haiku-5-5", 0.95, 0.12, true), { model: "", current: false } as unknown as BenchResult]);
  const read = await readEvalOverview(EXECUTOR, TARGET, { load: async () => broken, log });
  assert.equal(read.unavailable, false);
  assert.equal(read.overview?.benches[0].run.results.length, 1);
  assert.match(lines[1], /^\[progetto-banco\] righe_scartate .*"dropped":1/);
});
