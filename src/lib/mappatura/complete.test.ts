import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { fakeAppClaude, hang, installAppModules, message, recordLogs, refusal, THINKING, type Reply } from "../ai/claude-test-kit.ts";
import { MIN_MODEL_CALL_MS } from "../ai/models.ts";
import type { ClassificationResult } from "../ai/classify.ts";
import type { Activity } from "../db/schema.ts";
import type { CompletionOutcome } from "./complete.ts";

// «Completa la mappatura» (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.5): la funzione vera, con il classificatore e il
// match O*NET veri e il Claude finto di claude-test-kit.ts; il database è finto (le dipendenze di `CompleteDeps`).
// - la prima volta segna l'unità e avvisa, la seconda no; chiamarla di nuovo continua con quello che resta;
// - un rifiuto su un passo non fa perdere gli altri; una chiamata che non risponde si ferma alla scadenza;
// - gli id del match O*NET che non sono passi dell'unità si scartano;
// - la sintesi si salva solo se chi chiama la porta; nei log nessun titolo.

await installAppModules({});
const { completeUnitMapping: completeOrRefuse, isCompletionRefusal } = await import("./complete.ts");
/** Il completamento di un'unità con dei passi: mai un rifiuto (quello di un'unità vuota ha la sua prova, in fondo). */
async function completeUnitMapping(...args: Parameters<typeof completeOrRefuse>): Promise<CompletionOutcome | null> {
  const outcome = await completeOrRefuse(...args);
  assert.ok(!(outcome && "refused" in outcome), "un'unità con dei passi non si rifiuta");
  return outcome;
}
const { classifyActivitiesBatch } = await import("../ai/classify.ts");
const { matchActivitiesToOnet } = await import("../ai/onet-matching.ts");

type Deps = Parameters<typeof completeUnitMapping>[0];
const scope = { workspaceId: "11111111-aaaa-4aaa-8aaa-111111111111", departmentId: "22222222-bbbb-4bbb-8bbb-222222222222" };
const FAR = () => Date.now() + 10 * 60_000;

const activity = (id: string, title: string, over: Partial<Activity> = {}): Activity =>
  ({ id, departmentId: scope.departmentId, workspaceId: scope.workspaceId, title, description: "Una descrizione.", classification: null, onetTaskId: null, timeSpentHoursWeek: 2, toolsUsed: null, workType: null, ...over }) as Activity;

/** Quattro passi di «Ufficio acquisti» (due giri di classificazione da tre). */
const ACTIVITIES = () => [activity("a-1", "Raccolta delle richieste"), activity("a-2", "Confronto delle offerte"), activity("a-3", "Scelta del fornitore", { timeSpentHoursWeek: 0.5 }), activity("a-4", "Invio dell'ordine")];

const answer = (classification: string) => ({ classification, confidenceScore: 0.8, motivazione: "Una motivazione di prova.", aiPotential: "Un potenziale di prova." });
const match = (activityId: string, exposure: number) => ({ activityId, suggestedOnetCode: "13-1023.00", occupationTitle: "Addetto agli acquisti", relevantTasks: [], aiExposureEstimate: exposure, augmentationVsAutomation: "mixed", motivazione: "Una motivazione." });
const json = (value: unknown) => message([THINKING, { type: "text", text: JSON.stringify(value) }])();

/** Risponde secondo quello che c'è nel prompt: così l'ordine delle chiamate in parallelo non conta. */
function replies(options: { refuse?: string; hangOn?: string; onet?: unknown[] | "hang" | "refuse" } = {}): Reply {
  return (init) => {
    const prompt = JSON.stringify(JSON.parse(String(init?.body)).messages);
    if (prompt.includes("O*NET SOC")) {
      if (options.onet === "hang") return hang(init);
      if (options.onet === "refuse") return refusal([], "general_harms")();
      return json({ matches: options.onet ?? [] });
    }
    if (options.hangOn && prompt.includes(options.hangOn)) return hang(init);
    if (options.refuse && prompt.includes(options.refuse)) return refusal([THINKING, { type: "text", text: JSON.stringify(answer("automate")) }], "general_harms")();
    if (prompt.includes("Confronto delle offerte")) return json(answer("differentiate"));
    if (prompt.includes("Scelta del fornitore")) return json(answer("innovate"));
    return json(answer("automate"));
  };
}

/** Il database finto: tiene le attività e registra che cosa gli viene scritto. */
function fakeStore(activities: Activity[] | null) {
  const log = {
    marked: [] as Array<{ title: string; description: string }>,
    signals: 0,
    summaries: [] as unknown[],
    classified: [] as Array<Array<[string, ClassificationResult]>>,
    onet: [] as string[][],
    status: "in_progress",
  };
  const deps: Deps = {
    async loadUnit(where) {
      assert.deepEqual(where, scope);
      return activities ? { unitName: "Ufficio acquisti", activities: activities.map((item) => ({ ...item })), companyValueThesis: null, goals: [] } : null;
    },
    async markMapped(where, signal) {
      assert.deepEqual(where, scope);
      log.marked.push(signal);
      const first = log.status !== "mapped";
      log.status = "mapped";
      if (first) log.signals += 1;
      return { first };
    },
    async saveSummary(_where, summary) {
      log.summaries.push(summary);
    },
    async saveClassifications(_where, results) {
      log.classified.push([...results]);
      // Come il database: lo stream si scrive solo dove manca, e si conta quello che si è scritto.
      const written = { automate: 0, differentiate: 0, innovate: 0 };
      for (const [id, result] of results) {
        const item = activities!.find((activity) => activity.id === id)!;
        if (item.classification) continue;
        item.classification = result.classification;
        if (result.classification in written) written[result.classification as keyof typeof written] += 1;
      }
      return written;
    },
    async saveOnetMatches(_where, matches) {
      log.onet.push(matches.map((item) => item.activityId));
      for (const item of matches) activities!.find((activity) => activity.id === item.activityId)!.onetTaskId = item.suggestedOnetCode;
      return matches.length;
    },
    classify: classifyActivitiesBatch,
    matchOnet: matchActivitiesToOnet,
  };
  return { deps, log };
}

/** Le chiamate al modello ricevono il tempo chiesto, ma scadono dopo 30 ms: il test non aspetta i secondi veri. */
function shortTimeouts(t: TestContext): number[] {
  const requested: number[] = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    requested.push(ms);
    return timeout(30);
  });
  return requested;
}

test("la prima volta segna l'unità, avvisa una volta e classifica tutto; la seconda non segna e non ha niente da fare", async (t) => {
  recordLogs(t);
  const activities = ACTIVITIES();
  const { deps, log } = fakeStore(activities);
  // Il modello restituisce anche un id inventato e due volte lo stesso passo: valgono solo i passi mandati, una volta.
  const onet = [match("a-1", 0.2), match("a-2", 0.4), match("a-2", 0.9), match("id-di-un-altra-unità", 1), match("a-3", 0.3), match("a-4", 0.1)];
  const requests = fakeAppClaude(Array.from({ length: 5 }, () => replies({ onet })));
  const first = await completeUnitMapping(deps, { scope, deadline: FAR() });
  assert.deepEqual(first, {
    firstCompletion: true,
    total: 4,
    classified: 4,
    remaining: 0,
    counts: { automate: 2, differentiate: 1, innovate: 1 },
    classification: "fatta",
    matched: 4,
    avgExposurePct: 25,
    onet: "fatto",
  });
  assert.equal(requests.length, 5, "una chiamata per passo, una per il match O*NET");
  assert.deepEqual(log.marked, [{ title: "Mappatura completata: Ufficio acquisti", description: "4 passi, 6,5 ore a settimana." }]);
  assert.equal(log.signals, 1);
  assert.deepEqual(log.summaries, [], "nessuna sintesi se chi chiama non la porta");
  assert.deepEqual(log.classified[0].map(([id, result]) => [id, result.classification, result.reasoning, result.aiPotential]).sort(), [
    ["a-1", "automate", "Una motivazione di prova.", "Un potenziale di prova."],
    ["a-2", "differentiate", "Una motivazione di prova.", "Un potenziale di prova."],
    ["a-3", "innovate", "Una motivazione di prova.", "Un potenziale di prova."],
    ["a-4", "automate", "Una motivazione di prova.", "Un potenziale di prova."],
  ]);
  assert.deepEqual(log.onet, [["a-1", "a-2", "a-3", "a-4"]], "l'id inventato e il doppione non si scrivono");

  // La seconda volta: l'unità è già completa, ogni passo ha stream e codice. Nessuna chiamata al modello.
  const again = fakeAppClaude([]);
  const second = await completeUnitMapping(deps, { scope, deadline: FAR() });
  assert.deepEqual(second, { firstCompletion: false, total: 4, classified: 0, remaining: 0, counts: { automate: 0, differentiate: 0, innovate: 0 }, classification: "niente_da_fare", matched: 0, avgExposurePct: null, onet: "niente_da_fare" });
  assert.equal(again.length, 0);
  assert.equal(log.signals, 1, "la campanella una volta sola");
  assert.equal(log.marked.length, 2);
});

test("un rifiuto su un passo non fa perdere gli altri: «parziale», e chiamarla di nuovo continua con quello che resta", async (t) => {
  const lines = recordLogs(t);
  const activities = ACTIVITIES();
  const { deps, log } = fakeStore(activities);
  fakeAppClaude(Array.from({ length: 5 }, () => replies({ refuse: "Confronto delle offerte", onet: [match("a-1", 0.5)] })));
  const first = await completeUnitMapping(deps, { scope, deadline: FAR() });
  assert.deepEqual([first?.classification, first?.classified, first?.remaining, first?.counts], ["parziale", 3, 1, { automate: 2, differentiate: 0, innovate: 1 }]);
  assert.deepEqual([first?.onet, first?.matched, first?.avgExposurePct], ["fatto", 1, 50]);
  assert.deepEqual(log.classified[0].map(([id]) => id).sort(), ["a-1", "a-3", "a-4"]);
  assert.deepEqual(lines, ['[ai/classify] risposta_rifiutata {"finishReason":"content-filter","category":"general_harms"}']);

  // «Classifica 1 passo»: solo il passo rimasto va al classificatore, solo i tre senza codice al match.
  const requests = fakeAppClaude([replies({ onet: [match("a-2", 0.1), match("a-3", 0.2), match("a-4", 0.3)] }), replies({ onet: [match("a-2", 0.1), match("a-3", 0.2), match("a-4", 0.3)] })]);
  const second = await completeUnitMapping(deps, { scope, deadline: FAR() });
  assert.deepEqual([second?.firstCompletion, second?.classification, second?.classified, second?.remaining, second?.counts], [false, "fatta", 1, 0, { automate: 0, differentiate: 1, innovate: 0 }]);
  assert.deepEqual([second?.matched, second?.avgExposurePct], [3, 20]);
  assert.equal(requests.length, 2);
  const classifyPrompt = JSON.stringify(requests[0].body.messages);
  assert.ok(classifyPrompt.includes("Confronto delle offerte") && !classifyPrompt.includes("Raccolta delle richieste"));
  const onetPrompt = JSON.stringify(requests[1].body.messages);
  assert.ok(!onetPrompt.includes("[a-1]") && onetPrompt.includes("[a-2]") && onetPrompt.includes("[a-4]"));
});

test("nessuna classificazione riuscita: «non riuscita», niente scritto; il match O*NET rifiutato: «non riuscito»", async (t) => {
  const lines = recordLogs(t);
  const activities = [activity("a-2", "Confronto delle offerte")];
  const { deps, log } = fakeStore(activities);
  fakeAppClaude([replies({ refuse: "Confronto delle offerte", onet: "refuse" }), replies({ onet: "refuse" })]);
  const outcome = await completeUnitMapping(deps, { scope, deadline: FAR() });
  assert.deepEqual([outcome?.classification, outcome?.classified, outcome?.remaining, outcome?.onet, outcome?.matched, outcome?.avgExposurePct], ["non_riuscita", 0, 1, "non_riuscito", 0, null]);
  assert.deepEqual([log.classified.flat(), log.onet], [[], []]);
  assert.equal(outcome?.firstCompletion, true, "l'unità è completa lo stesso: la classificazione si riprova");
  assert.deepEqual(lines, [
    '[ai/classify] risposta_rifiutata {"finishReason":"content-filter","category":"general_harms"}',
    '[ai/onet-matching] risposta_rifiutata {"finishReason":"content-filter","category":"general_harms"}',
  ]);
});

test("una chiamata che non risponde si ferma alla scadenza: restano le classificazioni riuscite, «parziale» con quello che manca", async (t) => {
  const lines = recordLogs(t);
  const requested = shortTimeouts(t);
  const activities = ACTIVITIES();
  const { deps, log } = fakeStore(activities);
  // Nel primo giro di tre «Confronto» non risponde mai; il secondo giro non parte; il match O*NET non risponde.
  const requests = fakeAppClaude(Array.from({ length: 6 }, () => replies({ hangOn: "Confronto delle offerte", onet: "hang" })));
  const started = Date.now();
  const outcome = await completeUnitMapping(deps, { scope, deadline: Date.now() + 1_000 });
  assert.ok(Date.now() - started < 5_000, "risponde alla scadenza, non resta appesa");
  assert.deepEqual(requested, [MIN_MODEL_CALL_MS, MIN_MODEL_CALL_MS], "un tempo per la classificazione, uno per O*NET");
  assert.equal(requests.length, 4);
  assert.ok(requests.every((request) => request.signal));
  assert.deepEqual([outcome?.classification, outcome?.classified, outcome?.remaining, outcome?.counts], ["parziale", 2, 2, { automate: 1, differentiate: 0, innovate: 1 }]);
  assert.deepEqual([outcome?.onet, outcome?.matched], ["non_riuscito", 0]);
  assert.deepEqual(log.classified[0].map(([id]) => id).sort(), ["a-1", "a-3"]);
  assert.deepEqual(log.onet, []);
  assert.deepEqual(lines, ['[ai/classify] tempo_scaduto {"classificate":2,"rimaste":2}', `[ai/onet-matching] tempo_scaduto {"timeoutMs":${MIN_MODEL_CALL_MS}}`]);
});

test("le chiamate al modello hanno il tempo che resta fino alla scadenza, contato quando partono", async (t) => {
  recordLogs(t);
  const requested: number[] = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    requested.push(ms);
    return timeout(ms);
  });
  const { deps } = fakeStore([activity("a-1", "Raccolta delle richieste")]);
  fakeAppClaude([replies({ onet: [match("a-1", 0.3)] }), replies({ onet: [match("a-1", 0.3)] })]);
  const start = Date.now();
  t.mock.method(Date, "now", () => start + 40_000);
  const outcome = await completeUnitMapping(deps, { scope, deadline: start + 60_000 });
  assert.deepEqual(requested, [20_000, 20_000]);
  assert.deepEqual([outcome?.classification, outcome?.onet, outcome?.avgExposurePct], ["fatta", "fatto", 30]);
});

test("la sintesi si salva solo se chi chiama la porta; un'unità già classificata si completa senza chiamare il modello", async (t) => {
  recordLogs(t);
  const { deps, log } = fakeStore(ACTIVITIES().map((item) => ({ ...item, classification: "automate", onetTaskId: "13-1023.00" })));
  const requests = fakeAppClaude([]);
  const analysis = [{ title: "Dove va il tempo", text: "Nei solleciti. Ogni ordine ne chiede tre." }];
  const outcome = await completeUnitMapping(deps, { scope, deadline: FAR(), headline: "Il tempo va nei solleciti.", analysis });
  assert.deepEqual(outcome, { firstCompletion: true, total: 4, classified: 0, remaining: 0, counts: { automate: 0, differentiate: 0, innovate: 0 }, classification: "niente_da_fare", matched: 0, avgExposurePct: null, onet: "niente_da_fare" });
  assert.equal(requests.length, 0);
  assert.deepEqual(log.summaries, [{ headline: "Il tempo va nei solleciti.", analysis }]);
  assert.deepEqual(log.marked, [{ title: "Mappatura completata: Ufficio acquisti", description: "4 passi, 6,5 ore a settimana." }]);
  // Solo la frase, o solo i punti: si salva quello che c'è. Niente dei due (il bottone): niente.
  await completeUnitMapping(deps, { scope, deadline: FAR(), headline: "Solo la frase." });
  await completeUnitMapping(deps, { scope, deadline: FAR(), analysis: [] });
  await completeUnitMapping(deps, { scope, deadline: FAR() });
  await completeUnitMapping(deps, { scope, deadline: FAR(), headline: null });
  await completeUnitMapping(deps, { scope, deadline: FAR(), headline: "" });
  assert.deepEqual(log.summaries.slice(1), [{ headline: "Solo la frase.", analysis: undefined }, { headline: undefined, analysis: [] }]);
});

test("un passo che un altro giro classifica mentre questo aspetta il modello non è suo: non si conta; se gli altri hanno fatto tutto, niente da fare", async (t) => {
  recordLogs(t);
  const activities = ACTIVITIES();
  const { deps } = fakeStore(activities);
  // Mentre questo giro aspetta il modello, un altro (il tool della chat, o un'altra persona) scrive lo stream di «Confronto».
  deps.classify = (async (...args: Parameters<typeof classifyActivitiesBatch>) => {
    const results = await classifyActivitiesBatch(...args);
    activities[1].classification = "automate";
    return results;
  }) as typeof classifyActivitiesBatch;
  // Quattro classificazioni e il match O*NET.
  fakeAppClaude(Array.from({ length: 5 }, () => replies()));
  const outcome = await completeUnitMapping(deps, { scope, deadline: FAR() });
  assert.deepEqual([outcome?.counts, outcome?.classified, outcome?.remaining, outcome?.classification], [{ automate: 2, differentiate: 0, innovate: 1 }, 3, 0, "fatta"]);

  // Tutti i passi classificati da un altro giro nel frattempo: questo non ne ha scritto nessuno, e non lo dice come suo.
  const others = ACTIVITIES().slice(0, 2);
  const second = fakeStore(others);
  second.deps.classify = (async (...args: Parameters<typeof classifyActivitiesBatch>) => {
    const results = await classifyActivitiesBatch(...args);
    for (const activity of others) activity.classification = "innovate";
    return results;
  }) as typeof classifyActivitiesBatch;
  fakeAppClaude(Array.from({ length: 3 }, () => replies()));
  const late = await completeUnitMapping(second.deps, { scope, deadline: FAR() });
  assert.deepEqual([late?.counts, late?.classified, late?.remaining, late?.classification], [{ automate: 0, differentiate: 0, innovate: 0 }, 0, 0, "niente_da_fare"]);
});

test("un'unità che non si trova: null, niente segnato, niente chiesto al modello", async (t) => {
  recordLogs(t);
  const { deps, log } = fakeStore(null);
  const requests = fakeAppClaude([]);
  assert.equal(await completeUnitMapping(deps, { scope, deadline: FAR() }), null);
  assert.deepEqual([log.marked, requests.length], [[], 0]);
});

test("un'unità senza passi non si completa: un rifiuto, niente segnato, nessuna riga in campanella, niente chiesto al modello", async (t) => {
  recordLogs(t);
  const { deps, log } = fakeStore([]);
  const requests = fakeAppClaude([]);
  const refused = await completeOrRefuse(deps, { scope, deadline: FAR(), headline: "Una frase.", analysis: [{ title: "Un punto", text: "Un testo." }] });
  assert.deepEqual(refused, { refused: "senza_passi" });
  assert.deepEqual([isCompletionRefusal(refused), isCompletionRefusal(null), isCompletionRefusal(undefined)], [true, false, false]);
  assert.deepEqual([log.marked, log.signals, log.summaries, log.classified, log.onet, log.status, requests.length], [[], 0, [], [], [], "in_progress", 0]);
});

test("se il database non salva le classificazioni: «non riuscita», l'errore nel log senza testi, e il match O*NET va avanti", async (t) => {
  const lines = recordLogs(t);
  const { deps, log } = fakeStore(ACTIVITIES().slice(0, 1));
  deps.saveClassifications = async () => {
    throw Object.assign(new Error("valore troppo lungo per «Raccolta delle richieste»"), { code: "22001" });
  };
  fakeAppClaude([replies({ onet: [match("a-1", 0.3)] }), replies({ onet: [match("a-1", 0.3)] })]);
  const outcome = await completeUnitMapping(deps, { scope, deadline: FAR() });
  assert.deepEqual([outcome?.classification, outcome?.classified, outcome?.remaining, outcome?.onet, outcome?.matched], ["non_riuscita", 0, 1, "fatto", 1]);
  assert.deepEqual(log.onet, [["a-1"]]);
  assert.deepEqual(lines, [`[mappatura/complete] classificazione_non_riuscita {"workspaceId":"${scope.workspaceId}","departmentId":"${scope.departmentId}","error":{"name":"Error","code":"22001"}}`]);
});

test("nei log solo id, codici e numeri: mai un titolo, una descrizione o un testo del modello", async (t) => {
  const lines = recordLogs(t);
  shortTimeouts(t);
  const { deps } = fakeStore(ACTIVITIES());
  fakeAppClaude(Array.from({ length: 6 }, () => replies({ refuse: "Raccolta delle richieste", hangOn: "Scelta del fornitore", onet: "hang" })));
  await completeUnitMapping(deps, { scope, deadline: Date.now() + 1_000 });
  assert.ok(lines.length >= 2);
  for (const line of lines) assert.doesNotMatch(line, /Raccolta|Confronto|Scelta|Invio|Ufficio|descrizione|motivazione|potenziale/i, line);
});
