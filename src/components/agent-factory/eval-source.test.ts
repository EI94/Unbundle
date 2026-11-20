// Da dove arriva un'esecuzione delle evals o del banco (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.3, §2.6, §2.7), senza
// database: «dalla CI» o «dalla CLI»; il link all'esecuzione su GitHub solo per chi costruisce e solo con l'indirizzo di
// un'esecuzione di GitHub (la regola della 0042); la lettura delle fonti che non riesce non fa cadere la pagina e non dice
// una fonte sbagliata. Dati inventati.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import type { UcExecutor } from "../../lib/db/uc-executor.ts";
import { CLI_ORIGIN, evalRunOriginOf, type EvalRunOrigin } from "../../lib/db/queries/use-case-eval-origins.ts";
import { CI_RUN_URL_RE } from "../../lib/db/use-case-hub-ci-keys-ddl.ts";
import type { EvalOverview, EvalRunView } from "../../lib/use-cases/factory/benchmark.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import { CI_RUN_LINK_RE, EVAL_TEXT, ciRunHref, evalSourceText, originOf } from "./eval-format.ts";

let readEvalOrigins: typeof import("./eval-load.ts").readEvalOrigins;
let notFound: () => never;
before(async () => {
  await enableTsxImports();
  ({ readEvalOrigins } = await import("./eval-load.ts"));
  ({ notFound } = (await import("next/navigation")) as unknown as { notFound: () => never });
});

const RUN_URL = "https://github.com/Voltaen/esempio-rosa/actions/runs/12345678901";
const NOT_RUNS = [
  "https://github.com/Voltaen/esempio-rosa/pull/3",
  "http://github.com/Voltaen/esempio-rosa/actions/runs/1",
  "https://github.com.example.test/Voltaen/esempio-rosa/actions/runs/1",
  "https://github.com/Voltaen/esempio-rosa/actions/runs/1?x=1",
  "javascript:alert(1)",
  "",
];

test("«dalla CI» o «dalla CLI», le parole della specifica", () => {
  assert.equal(evalSourceText("ci"), "dalla CI");
  assert.equal(evalSourceText("cli"), "dalla CLI");
  assert.equal(EVAL_TEXT.emptyCi, "Con la CI collegata, le evals di main arrivano da sole dopo ogni unione.");
});

test("il link all'esecuzione: solo per chi costruisce, solo un'esecuzione di GitHub (la regola della 0042, scritta di nuovo per il browser)", () => {
  assert.equal(CI_RUN_LINK_RE.source, CI_RUN_URL_RE.source);
  assert.equal(CI_RUN_LINK_RE.flags, CI_RUN_URL_RE.flags);
  const ci: EvalRunOrigin = { source: "ci", ciRunUrl: RUN_URL };
  assert.equal(ciRunHref(ci, true), RUN_URL);
  assert.equal(ciRunHref(ci, false), null, "il cliente: «dalla CI» senza link");
  assert.equal(ciRunHref({ source: "cli", ciRunUrl: RUN_URL }, true), null, "una persona non ha un'esecuzione su GitHub");
  assert.equal(ciRunHref(null, true), null);
  for (const url of NOT_RUNS) assert.equal(ciRunHref({ source: "ci", ciRunUrl: url }, true), null, url);
});

test("la fonte letta dal database: «ci» con l'indirizzo che rispetta la regola, tutto il resto «cli»", () => {
  assert.deepEqual(evalRunOriginOf("ci", RUN_URL), { source: "ci", ciRunUrl: RUN_URL });
  for (const url of [...NOT_RUNS, null, 42]) assert.deepEqual(evalRunOriginOf("ci", url), { source: "ci", ciRunUrl: null }, String(url));
  for (const source of ["cli", null, undefined, "CI", "github"]) assert.deepEqual(evalRunOriginOf(source, RUN_URL), CLI_ORIGIN, String(source));
  // Gli id dell'elenco letto sono in minuscolo; la pagina li chiede come li ha.
  const map = new Map([["0f8fad5b-d9cb-469f-a165-70867728950e", { source: "ci" as const, ciRunUrl: RUN_URL }]]);
  assert.deepEqual(originOf(map, "0F8FAD5B-D9CB-469F-A165-70867728950E"), { source: "ci", ciRunUrl: RUN_URL });
  assert.equal(originOf(null, "0f8fad5b-d9cb-469f-a165-70867728950e"), null);
});

const EXECUTOR: UcExecutor = { batch: async () => [] };
const TARGET = { workspaceId: "ws-1", useCaseId: "uc-1" };

const runView = (id: string, kind: EvalRunView["kind"]): EvalRunView => ({
  id,
  kind,
  role: kind === "banco" ? "lettura" : null,
  level: "pull_request",
  branch: "main",
  commit: null,
  templateVersion: null,
  models: {},
  fakeModels: false,
  inConstruction: false,
  casesTotal: 1,
  createdAt: "2026-11-18T10:00:00.000Z",
  results: [],
});
const overview = (latest: string | null, benches: string[]): EvalOverview => ({
  evals: { latest: latest ? runView(latest, "evals") : null, trend: [] },
  benches: benches.map((id) => ({ role: "lettura", run: runView(id, "banco"), analysis: { best: null, cheapest: null, efficient: null, frontier: [], verdict: { kind: "finti", text: "x" } } })),
});

function recorder() {
  const lines: string[] = [];
  return { log: { error: (...args: unknown[]) => void lines.push(args.map(String).join(" ")) }, lines };
}

test("la lettura delle fonti: le evals che fanno lo stato e l'ultimo banco di ogni ruolo, del caso", async () => {
  const asked: string[][] = [];
  const found = new Map([["e1", { source: "ci" as const, ciRunUrl: RUN_URL }]]);
  const { log, lines } = recorder();
  const read = await readEvalOrigins(EXECUTOR, TARGET, overview("e1", ["b1", "b2"]), {
    load: async (_executor, target, ids) => {
      assert.deepEqual(target, TARGET);
      asked.push([...ids]);
      return found;
    },
    log,
  });
  assert.equal(read, found);
  assert.deepEqual(asked, [["e1", "b1", "b2"]]);
  assert.deepEqual(lines, []);
  // Senza panoramica non si sa niente; senza esecuzioni non si chiede niente.
  const never = async () => assert.fail("nessuna lettura");
  assert.equal(await readEvalOrigins(EXECUTOR, TARGET, null, { load: never, log }), null);
  assert.deepEqual(await readEvalOrigins(EXECUTOR, TARGET, overview(null, []), { load: never, log }), new Map());
});

test("una lettura delle fonti che non riesce: nel log solo i codici, e nessuna fonte (mai una sbagliata)", async () => {
  const { log, lines } = recorder();
  const failing = async () => {
    throw Object.assign(new Error(`chiave ub_ci_${"x".repeat(43)} di mario.rossi@example.com`), { code: "57P01" });
  };
  assert.equal(await readEvalOrigins(EXECUTOR, TARGET, overview("e1", []), { load: failing, log }), null);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[progetto-banco\] fonte_non_letta /);
  assert.match(lines[0], /"code":"57P01"/);
  assert.doesNotMatch(lines[0], /ub_ci_|mario|example\.com/, "mai il messaggio");
  // Gli errori di Next passano.
  await assert.rejects(
    readEvalOrigins(EXECUTOR, TARGET, overview("e1", []), {
      load: async () => {
        notFound();
      },
      log,
    }),
    (error: unknown) => typeof (error as { digest?: unknown }).digest === "string",
  );
});
