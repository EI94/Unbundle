// La linea dell'Agent Factory (rilascio 8.1a): la stazione di ogni caso da dossier, progetto e compiti; il prossimo
// passo; i conteggi; la coda della fabbrica con i repository indietro con il modello.
import test from "node:test";
import assert from "node:assert/strict";
import { benchFacts, compareVersions, evalsFact, evalsTodoText, factoryQueue, lineCounts, nextStepOf, stationOf, type LineCase } from "./line.ts";
import { analyzeBench, type BenchResult } from "./benchmark.ts";

const none = { total: 0, open: 0, inProgress: 0, inReview: 0, done: 0, cancelled: 0 };
const c = (over: Partial<LineCase>): LineCase => ({ dossierStatus: "pronto_sviluppo", projectStatus: null, tasks: none, ...over });

test("la stazione: dalla fase del dossier quando è avanti, poi da progetto e compiti", () => {
  assert.equal(stationOf(c({ dossierStatus: "bozza" })), "dossier");
  assert.equal(stationOf(c({ projectStatus: "in_corso" })), "impostazione");
  assert.equal(stationOf(c({ projectStatus: "da_approvare" })), "impostazione");
  assert.equal(stationOf(c({ projectStatus: "approvato" })), "approvato");
  assert.equal(stationOf(c({ projectStatus: "approvato", tasks: { ...none, total: 9, open: 2, inProgress: 1, done: 6 } })), "costruzione");
  assert.equal(stationOf(c({ projectStatus: "approvato", tasks: { ...none, total: 9, done: 8, cancelled: 1 } })), "collaudo", "fatti tutti, gli annullati non contano");
  assert.equal(stationOf(c({ dossierStatus: "collaudo", projectStatus: "approvato", tasks: { ...none, total: 3, open: 1 } })), "collaudo", "la fase del dossier vince");
  assert.equal(stationOf(c({ dossierStatus: "in_esercizio" })), "esercizio");
  assert.equal(stationOf(c({ dossierStatus: "misura_roi" })), "esercizio");
});

test("il prossimo passo, in una frase", () => {
  assert.equal(nextStepOf(c({})), "Impostare il caso con il coding agent.");
  assert.equal(nextStepOf(c({ projectStatus: "da_approvare" })), "Il progetto aspetta l'approvazione.");
  assert.equal(nextStepOf(c({ projectStatus: "approvato" })), "Portare i compiti in Unbundle («compiti importa»).");
  assert.equal(nextStepOf(c({ projectStatus: "approvato", tasks: { ...none, total: 4, open: 3, done: 1 } })), "3 compiti da prendere.");
  assert.equal(nextStepOf(c({ projectStatus: "approvato", tasks: { ...none, total: 4, open: 1, done: 3 } })), "1 compito da prendere.");
  assert.equal(nextStepOf(c({ projectStatus: "approvato", tasks: { ...none, total: 2, inProgress: 1, done: 1 } })), "Compiti in corso.");
  assert.equal(nextStepOf(c({ projectStatus: "approvato", tasks: { ...none, total: 2, done: 2 } })), "Compiti fatti: pronto per il collaudo.");
});

test("i conteggi seguono l'ordine della linea", () => {
  const counts = lineCounts([c({}), c({ projectStatus: "in_corso" }), c({ projectStatus: "approvato", tasks: { ...none, total: 2, open: 2 } }), c({ dossierStatus: "in_esercizio" })]);
  assert.deepEqual(counts.map((x) => [x.station, x.count]), [["dossier", 1], ["impostazione", 1], ["approvato", 0], ["costruzione", 1], ["collaudo", 0], ["esercizio", 1]]);
});

test("la coda della fabbrica: i repository indietro con il modello, o senza versione; mai quelli aggiornati", () => {
  assert.ok(compareVersions("1.2.0", "1.3.0") < 0);
  assert.ok(compareVersions("1.10.0", "1.9.9") > 0);
  assert.equal(compareVersions("1.3.0", "1.3.0"), 0);
  const queue = factoryQueue(
    [
      { repo: "Voltaen/rondine-rosa", templateVersion: "1.2.0" },
      { repo: "Voltaen/rondine-alcione", templateVersion: "1.3.0" },
      { repo: "Voltaen/rondine-merope", templateVersion: null },
    ],
    "1.3.0",
  );
  assert.deepEqual(queue.map((q) => q.repo), ["Voltaen/rondine-merope", "Voltaen/rondine-rosa"]);
  assert.match(queue[1].text, /Ha il modello 1\.2\.0, c'è il 1\.3\.0: «unbundle aggiorna»/);
});

test("(8.2a) le evals e il banco nella riga del caso: «evals 96%», «sotto soglia», «il banco consiglia …»", () => {
  assert.equal(evalsFact(null), null);
  assert.equal(evalsFact({ quality: 0.96, thresholdsMet: true, fakeModels: false }), "evals 96%");
  assert.equal(evalsFact({ quality: 0.8, thresholdsMet: false, fakeModels: false }), "evals 80%, sotto soglia");
  assert.equal(evalsFact({ quality: 27 / 28, thresholdsMet: true, fakeModels: true }), "evals 96,4%, modelli finti");
  const r = (model: string, quality: number, cost: number, current = false): BenchResult => ({
    model, current, quality, passed: Math.round(quality * 28), total: 28, thresholdsMet: true, groups: {}, costPer1000Usd: cost,
    latencyP50Ms: null, latencyP95Ms: null, tokensInAvg: null, tokensOutAvg: null, errors: 0,
  });
  const change = analyzeBench([r("anthropic/claude-sonnet-5-5", 0.96, 1.8, true), r("anthropic/claude-haiku-5-5", 0.95, 0.12)], { role: "lettura", fakeModels: false }).verdict;
  const stay = analyzeBench([r("anthropic/claude-haiku-5-5", 0.95, 0.12, true)], { role: "scrittura", fakeModels: false }).verdict;
  assert.deepEqual(benchFacts([{ role: "lettura", verdict: change }, { role: "scrittura", verdict: stay }]), ["il banco consiglia Claude Haiku 5.5 per «lettura»"]);
  assert.deepEqual(benchFacts([]), []);
  // Un banco superato (il consiglio seguito, o il ruolo non c'è più) non consiglia più niente.
  assert.deepEqual(benchFacts([{ role: "lettura", verdict: change, superseded: true }, { role: "scrittura", verdict: stay, superseded: false }]), []);
  assert.deepEqual(benchFacts([{ role: "lettura", verdict: change, superseded: false }]), ["il banco consiglia Claude Haiku 5.5 per «lettura»"]);
  assert.equal(evalsTodoText(0.8), "Le evals di main sono sotto soglia (80%): guarda quali prove non passano.");
  for (const text of [evalsFact({ quality: 0.8, thresholdsMet: false, fakeModels: false }), evalsTodoText(0.8), ...benchFacts([{ role: "lettura", verdict: change }])]) {
    assert.doesNotMatch(String(text), /caso d'uso/, "nella dashboard si dice «use case»");
  }
});
