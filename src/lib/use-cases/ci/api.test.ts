import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { analyzeBench, type EvalOverview, type EvalRunView } from "../factory/benchmark.ts";
import { evalOverviewForCli, parseEvalRun, runForCli } from "../factory/benchmark-input.ts";
import {
  CI_ERRORS,
  CI_IDEMPOTENCY_MISSING_MESSAGE,
  CI_ROUTE_LIMITS,
  CI_VERSION_WINDOW_DAYS,
  checkCiRunSource,
  ciCaseFailureCode,
  ciCasesBody,
  ciEvalsWriteBody,
  ciLinkVisible,
  parseCiEvals,
  type CiRunSource,
} from "./api.ts";
import { CI_COMMIT_MESSAGE, CI_RUN_URL_MESSAGE } from "./keys.ts";

// L'API della CI senza il database (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.2, §2.3, §2.9): il corpo di
// `POST /api/ci/evals` (prima solo main, il commit intero e l'esecuzione di quel repository, poi le regole della 8.2a),
// la risposta di `GET /api/ci/casi`, gli errori con lo stato e il testo della specifica, l'impronta dell'idempotenza senza
// il tentativo, chi scrive (la CI, mai una persona), chi vede il link a GitHub, la fonte nella lettura della CLI. Dati inventati.

const REPO = "Voltaen/esempio-rosa";
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const RUN = "12345678901";
const RUN_URL = `https://github.com/${REPO}/actions/runs/${RUN}`;
const HAIKU = "anthropic/claude-haiku-5-5";
const SONNET = "anthropic/claude-sonnet-5-5";

const result = (over: Record<string, unknown> = {}) => ({ modello: HAIKU, attuale: true, superati: 27, totali: 28, soglieRispettate: true, ...over });
/** Il corpo dell'esempio del §2.9: le evals di main con i modelli finti (D3). */
const body = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  caso: "XX-0012",
  tipo: "evals",
  livello: "pull_request",
  ramo: "main",
  commit: SHA,
  versioneModello: "1.8.0",
  modelliFinti: true,
  inCostruzione: false,
  modelli: { lettura: HAIKU },
  risultati: [result()],
  ci: { esecuzione: RUN, tentativo: 1, url: RUN_URL },
  ...over,
});

test("il corpo dell'esempio della specifica passa: le evals di main, con l'esecuzione di GitHub", () => {
  const parsed = parseCiEvals(body(), REPO);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.run, { runId: RUN, attempt: 1, url: RUN_URL });
  assert.equal(parsed.value.input.kind, "evals");
  assert.equal(parsed.value.input.branch, "main");
  assert.equal(parsed.value.input.commit, SHA);
  assert.equal(parsed.value.input.templateVersion, "1.8.0");
  assert.equal(parsed.value.input.fakeModels, true);
  // Il numero come numero, il tentativo che manca vale 1; il repository senza badare alle maiuscole (GitHub non ci bada).
  const numeric = parseCiEvals(body({ ci: { esecuzione: Number(RUN), url: RUN_URL } }), REPO.toLowerCase());
  assert.ok(numeric.ok);
  if (numeric.ok) assert.deepEqual(numeric.value.run, { runId: RUN, attempt: 1, url: RUN_URL });
  // Il banco dalla CI, con il ruolo e il modello di oggi del ruolo.
  const bench = parseCiEvals(
    body({ tipo: "banco", ruolo: "lettura", modelli: { lettura: SONNET }, modelliFinti: false, risultati: [result({ modello: SONNET }), result({ attuale: false })] }),
    REPO,
  );
  assert.ok(bench.ok, JSON.stringify(bench));
  if (bench.ok) assert.deepEqual([bench.value.input.kind, bench.value.input.role], ["banco", "lettura"]);
});

test("solo main: un altro ramo, o nessun ramo, è 403 solo_main, prima di ogni altro controllo del corpo", () => {
  for (const over of [{ ramo: "xx-0012/prova" }, { ramo: undefined }, { ramo: "Main" }, { ramo: "refs/heads/main", tipo: "altro" }, { ramo: "feature", commit: "a1b2c3d", ci: undefined }]) {
    const parsed = parseCiEvals(body(over), REPO);
    assert.equal(parsed.ok, false, JSON.stringify(over));
    if (parsed.ok) continue;
    assert.deepEqual([parsed.status, parsed.code, parsed.message], [403, "solo_main", "La chiave della CI manda solo le evals di main."], JSON.stringify(over));
  }
});

test("il commit intero e l'esecuzione di GitHub di questo repository, altrimenti 400 dati_non_validi con il testo della specifica", () => {
  const bad = (over: Record<string, unknown>, message: string) => {
    const parsed = parseCiEvals(body(over), REPO);
    assert.equal(parsed.ok, false, JSON.stringify(over));
    if (parsed.ok) return;
    assert.deepEqual([parsed.status, parsed.code, parsed.message], [400, "dati_non_validi", message], JSON.stringify(over));
  };
  bad({ commit: "a1b2c3d" }, CI_COMMIT_MESSAGE);
  bad({ commit: SHA.toUpperCase() }, CI_COMMIT_MESSAGE);
  bad({ commit: undefined }, CI_COMMIT_MESSAGE);
  bad({ ci: undefined }, CI_RUN_URL_MESSAGE);
  bad({ ci: { esecuzione: RUN, url: `https://github.com/Voltaen/esempio-blu/actions/runs/${RUN}` } }, CI_RUN_URL_MESSAGE);
  bad({ ci: { esecuzione: "999", url: RUN_URL } }, CI_RUN_URL_MESSAGE);
  bad({ ci: { esecuzione: RUN, url: `https://gitlab.com/${REPO}/actions/runs/${RUN}` } }, CI_RUN_URL_MESSAGE);
  bad({ ci: { esecuzione: RUN, url: `${RUN_URL}?x=1` } }, CI_RUN_URL_MESSAGE);
  bad({ ci: { esecuzione: RUN, url: RUN_URL, tentativo: 0 } }, CI_RUN_URL_MESSAGE);
  bad({ ci: [RUN_URL] }, CI_RUN_URL_MESSAGE);
  assert.equal(CI_COMMIT_MESSAGE, "commit: le 40 cifre del commit di main.");
  assert.equal(CI_RUN_URL_MESSAGE, "ci.url: l'indirizzo dell'esecuzione su GitHub di questo repository.");
  // Poi le regole della 8.2a, con il loro messaggio.
  for (const [over, message] of [
    [{ tipo: "altro" }, /^tipo:/],
    [{ modelliFinti: undefined }, /^modelliFinti:/],
    [{ inCostruzione: undefined }, /^inCostruzione:/],
    [{ risultati: [] }, /^risultati:/],
    [{ modelli: undefined }, /^modelli: per le evals/],
    [{ versioneModello: "1.7" }, /^versioneModello:/],
  ] as [Record<string, unknown>, RegExp][]) {
    const parsed = parseCiEvals(body(over), REPO);
    assert.equal(parsed.ok, false);
    if (parsed.ok) continue;
    assert.deepEqual([parsed.status, parsed.code], [400, "dati_non_validi"]);
    assert.match(parsed.message, message);
    assert.equal(parsed.message, (parseEvalRun(body(over)) as { message: string }).message, "lo stesso testo della CLI");
  }
});

test("GET /api/ci/casi: il repository, i casi registrati (aperti, o il perché), solo main, la scadenza; mai una persona", () => {
  const scade = "2027-05-17T19:04:00.000Z";
  const answer = ciCasesBody({ repo: "Voltaen/xx-famiglia", expiresAt: scade }, [
    { code: "XX-0012", folder: "casi/xx-0012", open: true, why: null },
    { code: "XX-0013", folder: "casi/xx-0013", open: false, why: "chiuso" },
  ]);
  // L'esempio del §2.9, uguale.
  assert.deepEqual(answer, {
    repository: "Voltaen/xx-famiglia",
    casi: [
      { caso: "XX-0012", cartella: "casi/xx-0012", aperto: true },
      { caso: "XX-0013", cartella: "casi/xx-0013", aperto: false, perche: "chiuso" },
    ],
    soloMain: true,
    scade,
  });
  assert.deepEqual(Object.keys(answer), ["repository", "casi", "soloMain", "scade"]);
  assert.ok(!("perche" in answer.casi[0]), "un caso aperto non ha il perché");
  // In pausa e senza la realizzazione; senza doppioni (lo stesso caso e la stessa cartella con il repository scritto in due
  // modi); senza i casi senza codice; l'ordine della lettura.
  const more = ciCasesBody({ repo: REPO, expiresAt: scade }, [
    { code: "XX-0003", folder: "casi/xx-0003", open: false, why: "sospeso" },
    { code: "XX-0005", folder: "casi/xx-0005", open: false, why: "senza_dossier" },
    { code: "xx-0005", folder: "casi/xx-0005", open: false, why: "senza_dossier" },
    { code: "XX-0005", folder: "casi/xx-0005-bis", open: false, why: "senza_dossier" },
    { code: " ", folder: "casi/senza-codice", open: true, why: null },
  ]);
  assert.deepEqual(
    more.casi.map((c) => [c.caso, c.cartella, c.aperto, c.perche]),
    [
      ["XX-0003", "casi/xx-0003", false, "sospeso"],
      ["XX-0005", "casi/xx-0005", false, "senza_dossier"],
      ["XX-0005", "casi/xx-0005-bis", false, "senza_dossier"],
    ],
  );
  assert.deepEqual(ciCasesBody({ repo: REPO, expiresAt: scade }, []).casi, [], "nessun caso: la lista vuota");
});

test("gli errori: lo stato e il testo del §2.9; i limiti per chiave; l'intestazione d'idempotenza che manca", () => {
  const expected: [keyof typeof CI_ERRORS, number, string][] = [
    ["chiave", 401, "Chiave della CI mancante, scaduta o revocata: ruotala dall'Agent Factory e aggiorna il segreto UNBUNDLE_CI_TOKEN."],
    ["chiave_nell_indirizzo", 400, "La chiave non va mai nell'indirizzo: è stata bloccata. Creane una nuova dall'Agent Factory."],
    ["non_trovato", 404, "Questo caso non è tra quelli del repository della chiave."],
    ["solo_main", 403, "La chiave della CI manda solo le evals di main."],
    ["caso_chiuso", 409, "Il caso è chiuso: il progetto si legge soltanto."],
    ["caso_sospeso", 409, "Il caso è in pausa: si riprende da Impostazioni del caso."],
    ["senza_dossier", 409, "Il caso non ha ancora una realizzazione: si avvia dalla sua pagina in Unbundle."],
    ["troppe_richieste", 429, "Troppe richieste: riprova tra poco."],
    ["non_disponibile", 503, "Unbundle non riceve ancora le evals dalla CI: riprova tra qualche minuto."],
    ["metodo", 405, "Metodo non ammesso."],
    ["json", 415, "Serve un corpo JSON."],
    ["troppo_grande", 413, "La richiesta è troppo grande."],
  ];
  for (const [code, status, message] of expected) {
    assert.deepEqual(CI_ERRORS[code], { status, message }, code);
  }
  assert.equal(CI_ERRORS.origine.status, 403);
  assert.ok(!/CLI/.test(CI_ERRORS.origine.message), "la CI non è la CLI");
  assert.deepEqual({ ...CI_ROUTE_LIMITS }, { readsPerHour: 600, writesPerHour: 120, bodyBytes: 65_536 });
  assert.match(CI_IDEMPOTENCY_MISSING_MESSAGE, /^Manca l'intestazione Idempotency-Key \(8-128 caratteri\)/);
  // Il caso che non si può mandare: i quattro codici del modulo delle chiavi, ogni altro vale «non trovato».
  for (const code of ["non_trovato", "senza_dossier", "caso_chiuso", "caso_sospeso"]) assert.equal(ciCaseFailureCode(code), code);
  assert.equal(ciCaseFailureCode("permesso_negato"), "non_trovato");
  // Nessun testo nomina una persona o il segreto per intero.
  for (const e of Object.values(CI_ERRORS)) assert.ok(!/ub_ci_/.test(e.message));
});

test("l'idempotenza: l'impronta senza il tentativo (un job rilanciato è la stessa richiesta), con il caso e l'esecuzione", () => {
  const first = parseCiEvals(body(), REPO);
  const again = parseCiEvals(body({ ci: { esecuzione: RUN, tentativo: 2, url: RUN_URL } }), REPO);
  const other = parseCiEvals(body({ risultati: [result({ superati: 26 })] }), REPO);
  assert.ok(first.ok && again.ok && other.ok);
  if (!first.ok || !again.ok || !other.ok) return;
  const a = ciEvalsWriteBody("XX-0012", first.value);
  assert.deepEqual(a, ciEvalsWriteBody("XX-0012", again.value), "il secondo tentativo con le stesse evals");
  assert.notDeepEqual(a, ciEvalsWriteBody("XX-0012", other.value), "altri numeri: un'altra richiesta");
  assert.notDeepEqual(a, ciEvalsWriteBody("XX-0013", first.value), "un altro caso");
  assert.deepEqual(a.ci, { url: RUN_URL });
  assert.equal(a.caso, "XX-0012");
  assert.ok(!JSON.stringify(a).includes("tentativo") && !JSON.stringify(a).includes('"attempt"'));
});

test("chi scrive: la CI con la sua chiave e l'esecuzione di quel repository, solo main e il commit intero; mai una persona", () => {
  const parsed = parseCiEvals(body(), REPO);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const source: CiRunSource = { kind: "ci", keyId: randomUUID(), runUrl: RUN_URL, repo: REPO };
  assert.equal(checkCiRunSource(source, parsed.value.input), null);
  assert.equal(checkCiRunSource({ ...source, repo: REPO.toUpperCase() }, parsed.value.input), null, "GitHub non bada alle maiuscole");
  assert.match(String(checkCiRunSource({ ...source, keyId: "non-una-chiave" }, parsed.value.input)), /Chiave della CI non valida/);
  assert.match(String(checkCiRunSource({ ...source, repo: "non un repository" }, parsed.value.input)), /Repository della chiave non valido/);
  assert.equal(checkCiRunSource({ ...source, runUrl: `https://github.com/Voltaen/esempio-blu/actions/runs/${RUN}` }, parsed.value.input), CI_RUN_URL_MESSAGE);
  assert.equal(checkCiRunSource({ ...source, runUrl: `https://github.com/${REPO}/pull/12` }, parsed.value.input), CI_RUN_URL_MESSAGE);
  assert.equal(checkCiRunSource(source, { ...parsed.value.input, branch: "xx-0012/prova" }), "La chiave della CI manda solo le evals di main.");
  assert.equal(checkCiRunSource(source, { ...parsed.value.input, commit: "a1b2c3d" }), CI_COMMIT_MESSAGE);
  // Il tipo non ha posto per una persona.
  assert.deepEqual(Object.keys(source).sort(), ["keyId", "kind", "repo", "runUrl"]);
});

test("il link all'esecuzione su GitHub: a chi costruisce e a Lateral Space; al cliente no", () => {
  assert.equal(ciLinkVisible({ isLateralSpace: true, builds: true }), true, "chi costruisce, di Lateral Space");
  assert.equal(ciLinkVisible({ isLateralSpace: true, builds: false }), true, "chi gestisce il workspace, Lateral Space, non nel team");
  assert.equal(ciLinkVisible({ isLateralSpace: false, builds: true }), true, "chi costruisce da fuori");
  assert.equal(ciLinkVisible({ isLateralSpace: false, builds: false }), false, "il cliente: «dalla CI» senza link");
});

test("la lettura della CLI: ogni esecuzione dice fonte e ci; il link solo a chi può vederlo e solo per la CI", () => {
  const parsed = parseEvalRun({ ...body(), ci: undefined });
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const run = (over: Partial<EvalRunView> = {}): EvalRunView => ({
    id: randomUUID(),
    kind: "evals",
    role: null,
    level: "pull_request",
    branch: "main",
    commit: SHA,
    templateVersion: "1.8.0",
    models: { lettura: HAIKU },
    fakeModels: true,
    inConstruction: false,
    casesTotal: 28,
    createdAt: "2026-11-20T10:00:00.000Z",
    results: parsed.value.results,
    ...over,
  });
  // Prima della 0042 la lettura non ha la fonte: «dalla CLI».
  assert.deepEqual([runForCli(run()).fonte, runForCli(run()).ci], ["cli", null]);
  assert.deepEqual([runForCli(run({ source: "cli", ciRunUrl: null }), { ciLinks: true }).fonte, runForCli(run({ source: "cli" }), { ciLinks: true }).ci], ["cli", null]);
  const fromCi = run({ source: "ci", ciRunUrl: RUN_URL });
  assert.deepEqual([runForCli(fromCi, { ciLinks: true }).fonte, runForCli(fromCi, { ciLinks: true }).ci], ["ci", RUN_URL]);
  assert.deepEqual([runForCli(fromCi).fonte, runForCli(fromCi).ci], ["ci", null], "senza il permesso, senza link");
  assert.deepEqual(Object.keys(runForCli(fromCi)).slice(-2), ["fonte", "ci"]);
  const overview: EvalOverview = {
    evals: { latest: fromCi, trend: [] },
    benches: [{ role: "lettura", run: run({ kind: "banco", role: "lettura", source: "ci", ciRunUrl: RUN_URL }), analysis: analyzeBench(parsed.value.results, { role: "lettura", fakeModels: true }) }],
  };
  const client = evalOverviewForCli("XX-0012", overview);
  const builder = evalOverviewForCli("XX-0012", overview, { ciLinks: true });
  assert.deepEqual([client.evals.ultime?.fonte, client.evals.ultime?.ci, client.banchi[0].fonte, client.banchi[0].ci], ["ci", null, "ci", null]);
  assert.deepEqual([builder.evals.ultime?.ci, builder.banchi[0].ci], [RUN_URL, RUN_URL]);
});

test("la versione del modello del repository: la dice main per un mese dall'ultimo invio della CI", () => {
  assert.equal(CI_VERSION_WINDOW_DAYS, 30);
  const line = readFileSync(new URL("../../db/queries/use-case-factory-line.ts", import.meta.url), "utf8");
  const report = line.slice(line.indexOf("export async function reportRepoVersion("));
  // La fonte delle evals si legge solo con la 0042 pronta; la versione del comune la dice sempre `unbundle start`.
  assert.match(report, /const fromMain = \(await ciKeysStoreReady\(executor\)\) \? CI_VERSION_FROM_MAIN_SQL : raw\("false"\);/);
  assert.match(report, /template_version = CASE WHEN \$\{fromMain\} THEN use_case_factory_repos\.template_version ELSE EXCLUDED\.template_version END/);
  assert.match(report, /common_version = coalesce\(EXCLUDED\.common_version, use_case_factory_repos\.common_version\)/);
});
