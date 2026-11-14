// Il corpo di `POST /api/cli/evals` (rilascio 8.2a, docs/rilascio-8/BANCO-DI-PROVA.md §2): controllato con le regole dei
// CHECK della 0036, la qualità ricalcolata, il banco con il ruolo e un solo «attuale», le evals con un solo risultato;
// e le risposte alla CLI con le chiavi italiane, senza persone.
import test from "node:test";
import assert from "node:assert/strict";
import { evalOverviewForCli, parseEvalRun, QUALITY_TOLERANCE, recommendationOf, resultForCli, runForCli } from "./benchmark-input.ts";
import { analyzeBench, type EvalOverview, type EvalRunView } from "./benchmark.ts";
import { EVAL_LIMITS } from "../../db/use-case-hub-evals-ddl.ts";

const HAIKU = "anthropic/claude-haiku-5-5";
const SONNET = "anthropic/claude-sonnet-5-5";
const OPUS = "anthropic/claude-opus-5-5";

const result = (over: Record<string, unknown> = {}) => ({
  modello: HAIKU,
  attuale: true,
  qualita: 0.9643,
  superati: 27,
  totali: 28,
  soglieRispettate: true,
  gruppi: { regole: { passati: 9, totali: 9, soglia: 1, ok: true }, avversari: { passati: 8, totali: 9, soglia: 0.8, ok: true } },
  costoPer1000Usd: 0.42,
  latenzaP50Ms: 1800,
  latenzaP95Ms: 4100,
  tokenIngressoMedi: 1900,
  tokenUscitaMedi: 220,
  errori: 0,
  ...over,
});

const banco = (over: Record<string, unknown> = {}) => ({
  caso: "TJ-0049",
  tipo: "banco",
  ruolo: "lettura",
  livello: "pull_request",
  ramo: "main",
  commit: "a1b2c3d",
  versioneModello: "1.4.0",
  modelliFinti: false,
  inCostruzione: false,
  modelli: { lettura: SONNET, scrittura: HAIKU },
  risultati: [result({ modello: SONNET, attuale: true, costoPer1000Usd: 1.8 }), result({ modello: HAIKU, attuale: false, costoPer1000Usd: 0.12 })],
  ...over,
});

const evals = (over: Record<string, unknown> = {}) => ({
  caso: "TJ-0049",
  tipo: "evals",
  livello: "pull_request",
  ramo: "main",
  commit: "a1b2c3d4e5f6",
  modelliFinti: false,
  inCostruzione: false,
  modelli: { lettura: HAIKU },
  risultati: [result()],
  ...over,
});

const message = (body: Record<string, unknown>) => {
  const r = parseEvalRun(body);
  assert.equal(r.ok, false, JSON.stringify(body).slice(0, 200));
  return r.ok ? "" : r.message;
};

test("un banco valido: i campi in inglese, la qualità ricalcolata, le prove dal risultato più grande", () => {
  const r = parseEvalRun(banco());
  assert.ok(r.ok);
  if (!r.ok) return;
  const v = r.value;
  assert.deepEqual([v.kind, v.role, v.level, v.branch, v.commit, v.templateVersion, v.fakeModels, v.inConstruction], ["banco", "lettura", "pull_request", "main", "a1b2c3d", "1.4.0", false, false]);
  assert.deepEqual(v.models, { lettura: SONNET, scrittura: HAIKU });
  assert.equal(v.casesTotal, 28);
  assert.equal(v.results.length, 2);
  const [sonnet, haiku] = v.results;
  assert.equal(sonnet.quality, 27 / 28, "superate / totali, non il numero mandato");
  assert.deepEqual([sonnet.model, sonnet.current, haiku.current, haiku.costPer1000Usd], [SONNET, true, false, 0.12]);
  assert.deepEqual(sonnet.groups.regole, { passati: 9, totali: 9, soglia: 1, ok: true });
  assert.deepEqual([sonnet.latencyP50Ms, sonnet.latencyP95Ms, sonnet.tokensInAvg, sonnet.tokensOutAvg, sonnet.errors], [1800, 4100, 1900, 220, 0]);
});

test("le evals valide: un risultato «attuale», senza ruolo; i facoltativi possono mancare", () => {
  const r = parseEvalRun(evals({ ramo: undefined, commit: null, versioneModello: undefined, modelli: { lettura: HAIKU }, risultati: [result({ qualita: undefined, gruppi: undefined, costoPer1000Usd: null, latenzaP50Ms: undefined, latenzaP95Ms: null, tokenIngressoMedi: null, tokenUscitaMedi: undefined, errori: undefined })] }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual([r.value.kind, r.value.role, r.value.branch, r.value.commit, r.value.templateVersion], ["evals", null, null, null, null]);
  assert.deepEqual(r.value.models, { lettura: HAIKU });
  const [x] = r.value.results;
  assert.deepEqual([x.groups, x.costPer1000Usd, x.latencyP50Ms, x.latencyP95Ms, x.tokensInAvg, x.tokensOutAvg, x.errors], [{}, null, null, null, null, null, 0]);
});

test("misure arrotondate: tempi e token all'intero, il costo a 6 decimali; quello che si salva è quello che si rilegge", () => {
  const r = parseEvalRun(evals({ risultati: [result({ costoPer1000Usd: 0.123456789, latenzaP50Ms: 1800.4, latenzaP95Ms: 4100.6, tokenIngressoMedi: 1900.5, tokenUscitaMedi: 220.2 })] }));
  assert.ok(r.ok);
  if (!r.ok) return;
  const [x] = r.value.results;
  assert.deepEqual([x.costPer1000Usd, x.latencyP50Ms, x.latencyP95Ms, x.tokensInAvg, x.tokensOutAvg], [0.123457, 1800, 4101, 1901, 220]);
  assert.equal(x.costPer1000Usd, Number("0.123457"), "il numero che Postgres rimanda da numeric(14,6)");
});

test("il tipo, il ruolo, il livello, il ramo, il commit, la versione: ogni campo con il suo messaggio", () => {
  assert.match(message(banco({ tipo: "altro" })), /^tipo: «banco» oppure «evals»\.$/);
  assert.match(message(banco({ ruolo: undefined })), /^ruolo: il ruolo di agent\.yaml/);
  assert.match(message(banco({ ruolo: "Lettura" })), /^ruolo:/);
  assert.match(message(banco({ ruolo: "r".repeat(41) })), /^ruolo:/);
  assert.match(message(evals({ ruolo: "lettura" })), /^ruolo: solo per il banco/);
  assert.match(message(banco({ livello: "PR" })), /^livello:/);
  assert.match(message(banco({ livello: undefined })), /^livello:/);
  assert.match(message(banco({ ramo: "ramo con spazi" })), /^ramo:/);
  assert.match(message(banco({ ramo: "r".repeat(121) })), /^ramo:/);
  assert.match(message(banco({ ramo: 12 })), /^ramo:/);
  assert.match(message(banco({ commit: "A1B2C3D" })), /^commit:/);
  assert.match(message(banco({ commit: "a1b2c3" })), /^commit:/);
  assert.match(message(banco({ versioneModello: "1.4" })), /^versioneModello:/);
  assert.match(message(banco({ versioneModello: "v1.4.0" })), /^versioneModello:/);
});

test("modelli finti e caso in costruzione: si dicono sempre (per il banco «inCostruzione» può mancare)", () => {
  assert.match(message(banco({ modelliFinti: undefined })), /^modelliFinti: true o false\.$/);
  assert.match(message(evals({ modelliFinti: "no" })), /^modelliFinti:/);
  assert.match(message(evals({ inCostruzione: undefined })), /^inCostruzione: true o false\.$/);
  const r = parseEvalRun(banco({ inCostruzione: undefined }));
  assert.ok(r.ok && r.value.inConstruction === false);
  assert.match(message(banco({ inCostruzione: "sì" })), /^inCostruzione:/);
});

test("i modelli di oggi: un ruolo per chiave, un id valido, al massimo 20; il banco ha sempre quello del suo ruolo, l'«attuale»", () => {
  assert.match(message(banco({ modelli: [HAIKU] })), /^modelli: un oggetto/);
  assert.match(message(banco({ modelli: { Lettura: HAIKU } })), /^modelli: ogni chiave è un ruolo/);
  assert.match(message(banco({ modelli: { lettura: "modello con spazi" } })), /^modelli\.lettura:/);
  const many = Object.fromEntries(Array.from({ length: EVAL_LIMITS.modelsMax + 1 }, (_, i) => [`ruolo${i}`, HAIKU]));
  assert.match(message(banco({ modelli: many })), /^modelli: al massimo 20 ruoli\.$/);
  assert.match(message(banco({ modelli: { lettura: OPUS } })), /^modelli\.lettura: il modello di oggi del ruolo è quello «attuale» del banco \(anthropic\/claude-sonnet-5-5\)\.$/);
  // Senza il modello di oggi del ruolo il banco non si scrive: la CLI lo manda sempre da agent.yaml.
  const missing = /^modelli\.lettura: il modello di oggi del ruolo del banco, da agent\.yaml \(anthropic\/claude-sonnet-5-5\)\.$/;
  for (const modelli of [undefined, null, {}, { scrittura: HAIKU }]) assert.match(message(banco({ modelli })), missing, JSON.stringify(modelli));
  // Un ruolo con il nome di una proprietà degli oggetti non la trova per caso.
  assert.match(message(banco({ ruolo: "constructor", modelli: { lettura: SONNET } })), /^modelli\.constructor: il modello di oggi del ruolo del banco/);
  assert.ok(parseEvalRun(banco({ ruolo: "constructor", modelli: { constructor: SONNET } })).ok);
  // Le evals li dicono tutti, come la CLI: senza, un banco già seguito non si riconoscerebbe più.
  const none = /^modelli: per le evals, ogni ruolo di agent\.yaml con il suo modello di oggi \(almeno uno\)\.$/;
  for (const modelli of [undefined, null, {}]) assert.match(message(evals({ modelli })), none, JSON.stringify(modelli));
  assert.ok(parseEvalRun(evals({ modelli: { scrittura: HAIKU } })).ok);
});

test("il banco: da 1 a 12 modelli distinti, esattamente un «attuale»; le evals: un solo risultato, «attuale»", () => {
  assert.match(message(banco({ risultati: [] })), /^risultati: da 1 a 12 modelli per il banco\.$/);
  assert.match(message(banco({ risultati: "tutti" })), /^risultati:/);
  const thirteen = Array.from({ length: 13 }, (_, i) => result({ modello: `fornitore/modello-${i}`, attuale: i === 0 }));
  assert.match(message(banco({ risultati: thirteen, modelli: undefined })), /^risultati: da 1 a 12/);
  const twelve = parseEvalRun(banco({ risultati: thirteen.slice(0, 12), modelli: { lettura: "fornitore/modello-0" } }));
  assert.ok(twelve.ok && twelve.value.results.length === 12);
  assert.match(message(banco({ risultati: [result({ modello: SONNET }), result({ modello: "Anthropic/Claude-Sonnet-5-5", attuale: false })] })), /^risultati: ogni modello una volta sola/);
  assert.match(message(banco({ risultati: [result({ modello: SONNET, attuale: false }), result({ modello: HAIKU, attuale: false })], modelli: undefined })), /^risultati: esattamente un modello «attuale»/);
  assert.match(message(banco({ risultati: [result({ modello: SONNET }), result({ modello: HAIKU })], modelli: undefined })), /^risultati: esattamente un modello «attuale»/);
  assert.match(message(evals({ risultati: [result(), result({ modello: SONNET, attuale: false })] })), /^risultati: le evals hanno un solo risultato/);
  assert.match(message(evals({ risultati: [result({ attuale: false })] })), /^risultati: il risultato delle evals è quello dei modelli di oggi/);
  assert.match(message(evals({ risultati: [result({ attuale: undefined })] })), /«attuale»: true/);
});

test("un risultato: il modello, le prove (intere, superate entro le totali), la qualità uguale a superate / totali", () => {
  const one = (over: Record<string, unknown>) => message(evals({ risultati: [result(over)] }));
  assert.match(one({ modello: "" }), /^risultati\[0\]\.modello:/);
  assert.match(one({ modello: "m".repeat(81) }), /^risultati\[0\]\.modello:/);
  assert.match(one({ modello: "-inizio" }), /^risultati\[0\]\.modello:/);
  assert.match(one({ attuale: "sì" }), /^risultati\[0\]\.attuale: true o false\.$/);
  assert.match(one({ superati: 2.5 }), /^risultati\[0\]\.superati: un numero intero da 0 a 100000\.$/);
  assert.match(one({ superati: -1 }), /^risultati\[0\]\.superati:/);
  assert.match(one({ totali: 0, superati: 0, qualita: 0 }), /^risultati\[0\]\.totali: un numero intero da 1 a 100000\.$/);
  assert.match(one({ totali: EVAL_LIMITS.casesMax + 1 }), /^risultati\[0\]\.totali:/);
  assert.match(one({ superati: 29 }), /^risultati\[0\]: le prove superate non possono essere più delle totali\.$/);
  assert.match(one({ qualita: 0.5 }), /^risultati\[0\]\.qualita: deve essere superate \/ totali \(27\/28\)\.$/);
  assert.match(one({ qualita: 1.2 }), /^risultati\[0\]\.qualita: da 0 a 1/);
  assert.match(one({ qualita: "96%" }), /^risultati\[0\]\.qualita:/);
  assert.ok(parseEvalRun(evals({ risultati: [result({ qualita: 27 / 28 + QUALITY_TOLERANCE * 0.9 })] })).ok, "l'arrotondamento della CLI va bene");
  assert.match(one({ soglieRispettate: undefined }), /^risultati\[0\]\.soglieRispettate: true o false\.$/);
  assert.match(one({ errori: 1.5 }), /^risultati\[0\]\.errori:/);
  assert.match(one({ errori: -2 }), /^risultati\[0\]\.errori:/);
  assert.match(message(evals({ risultati: ["no"] })), /^risultati\[0\]: un oggetto/);
});

test("le misure: numeri finiti nei limiti, oppure null; la p50 non supera la p95", () => {
  const one = (over: Record<string, unknown>) => message(evals({ risultati: [result(over)] }));
  assert.match(one({ costoPer1000Usd: -0.01 }), /^risultati\[0\]\.costoPer1000Usd: il costo stimato in USD da 0 a 10000000, oppure null\.$/);
  assert.match(one({ costoPer1000Usd: "0,42" }), /^risultati\[0\]\.costoPer1000Usd:/);
  assert.match(one({ costoPer1000Usd: Number.POSITIVE_INFINITY }), /^risultati\[0\]\.costoPer1000Usd:/);
  assert.match(one({ latenzaP50Ms: EVAL_LIMITS.latencyMsMax + 1 }), /^risultati\[0\]\.latenzaP50Ms:/);
  assert.match(one({ latenzaP95Ms: Number.NaN }), /^risultati\[0\]\.latenzaP95Ms:/);
  assert.match(one({ latenzaP50Ms: 5000, latenzaP95Ms: 4000 }), /^risultati\[0\]: la latenza p50 non può superare la p95\.$/);
  assert.match(one({ tokenIngressoMedi: -1 }), /^risultati\[0\]\.tokenIngressoMedi:/);
  assert.match(one({ tokenUscitaMedi: EVAL_LIMITS.tokensAvgMax + 1 }), /^risultati\[0\]\.tokenUscitaMedi:/);
});

test("i gruppi: al massimo 20, il nome come un ruolo, passati entro i totali, la soglia da 0 a 1, ok sì o no", () => {
  const one = (gruppi: unknown) => message(evals({ risultati: [result({ gruppi })] }));
  assert.match(one([1, 2]), /^risultati\[0\]\.gruppi: un oggetto/);
  assert.match(one({ "Regole Base": { passati: 1, totali: 1, soglia: 1, ok: true } }), /^risultati\[0\]\.gruppi: il nome di un gruppo/);
  assert.match(one({ regole: "tutte" }), /^risultati\[0\]\.gruppi\.regole: \{passati, totali, soglia, ok\}\.$/);
  assert.match(one({ regole: { passati: 3, totali: 2, soglia: 1, ok: true } }), /^risultati\[0\]\.gruppi\.regole: le passate non possono essere più delle totali\.$/);
  assert.match(one({ regole: { passati: 1.5, totali: 2, soglia: 1, ok: true } }), /^risultati\[0\]\.gruppi\.regole\.passati:/);
  assert.match(one({ regole: { passati: 1, totali: 2, soglia: 2, ok: true } }), /^risultati\[0\]\.gruppi\.regole\.soglia:/);
  assert.match(one({ regole: { passati: 1, totali: 2, soglia: 0.5, ok: "sì" } }), /^risultati\[0\]\.gruppi\.regole\.ok:/);
  const many = Object.fromEntries(Array.from({ length: EVAL_LIMITS.groupsMax + 1 }, (_, i) => [`g${i}`, { passati: 0, totali: 0, soglia: 0, ok: true }]));
  assert.match(one(many), /^risultati\[0\]\.gruppi: al massimo 20 gruppi\.$/);
  // Un gruppo vuoto (zero prove) è ammesso; i campi in più si lasciano.
  const r = parseEvalRun(evals({ risultati: [result({ gruppi: { casi: { passati: 0, totali: 0, soglia: 0.9, ok: true, extra: "x" } } })] }));
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value.results[0].groups, { casi: { passati: 0, totali: 0, soglia: 0.9, ok: true } });
});

test("la raccomandazione per la CLI: tipo, modello e testo; mai con i modelli finti; null senza banco", () => {
  const parsed = parseEvalRun(banco());
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const analysis = analyzeBench(parsed.value.results, { role: "lettura", fakeModels: false });
  const rec = recommendationOf(analysis);
  assert.ok(rec && rec.tipo === "cambia" && rec.modello === HAIKU && /^Conviene Claude Haiku 5\.5 per «lettura»/.test(rec.testo));
  assert.equal(recommendationOf(analyzeBench(parsed.value.results, { role: "lettura", fakeModels: true })), null, "modelli finti");
  assert.equal(recommendationOf(null), null);
  const none = recommendationOf(analyzeBench(parsed.value.results.map((r) => ({ ...r, thresholdsMet: false })), { role: "lettura", fakeModels: false }));
  assert.deepEqual(none && Object.keys(none).sort(), ["testo", "tipo"], "«nessuno» non ha un modello");
  assert.equal(none?.tipo, "nessuno");
});

test("la panoramica per la CLI: chiavi italiane, l'andamento così com'è, il banco con i segni; mai una persona", () => {
  const parsed = parseEvalRun(banco());
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const run = (kind: "banco" | "evals"): EvalRunView => ({
    id: "11111111-1111-4111-8111-111111111111",
    kind,
    role: kind === "banco" ? "lettura" : null,
    level: "pull_request",
    branch: "main",
    commit: "a1b2c3d",
    templateVersion: "1.4.0",
    models: { lettura: SONNET },
    fakeModels: false,
    inConstruction: false,
    casesTotal: 28,
    createdAt: "2026-11-14T10:00:00.000Z",
    results: kind === "banco" ? parsed.value.results : [parsed.value.results[0]],
  });
  const overview: EvalOverview = {
    evals: { latest: run("evals"), trend: [{ at: "2026-11-13T10:00:00.000Z", quality: 0.9, thresholdsMet: true, fakeModels: false }] },
    benches: [{ role: "lettura", run: run("banco"), analysis: analyzeBench(parsed.value.results, { role: "lettura", fakeModels: false }) }],
  };
  const cli = evalOverviewForCli("TJ-0049", overview);
  assert.equal(cli.caso, "TJ-0049");
  assert.deepEqual(cli.evals.andamento, [{ quando: "2026-11-13T10:00:00.000Z", qualita: 0.9, soglieRispettate: true, modelliFinti: false }]);
  assert.deepEqual(Object.keys(cli.evals.ultime ?? {}), ["id", "tipo", "ruolo", "livello", "ramo", "commit", "versioneModello", "modelli", "modelliFinti", "inCostruzione", "prove", "quando", "risultati"]);
  const [b] = cli.banchi;
  // Stessa qualità: il più bravo è il più economico, e Sonnet è battuto su tutti e due.
  assert.deepEqual([b.ruolo, b.piuBravo, b.piuEconomico, b.piuEfficiente, b.raccomandazione?.tipo], ["lettura", HAIKU, HAIKU, HAIKU, "cambia"]);
  assert.deepEqual(b.frontiera, [HAIKU]);
  assert.deepEqual(Object.keys(resultForCli(parsed.value.results[0])), [
    "modello",
    "attuale",
    "qualita",
    "superati",
    "totali",
    "soglieRispettate",
    "gruppi",
    "costoPer1000Usd",
    "latenzaP50Ms",
    "latenzaP95Ms",
    "tokenIngressoMedi",
    "tokenUscitaMedi",
    "errori",
  ]);
  const text = JSON.stringify(cli);
  assert.doesNotMatch(text, /autore|author|actor|user|persona|email|"chi"/i, "art. 15.4");
  assert.equal(runForCli(run("evals")).ruolo, null);
  const empty = evalOverviewForCli("TJ-0049", { evals: { latest: null, trend: [] }, benches: [] });
  assert.deepEqual(empty, { caso: "TJ-0049", evals: { ultime: null, andamento: [] }, banchi: [] });
});
