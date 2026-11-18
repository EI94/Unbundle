import test from "node:test";
import assert from "node:assert/strict";
import { fakeAppClaude, installAppModules, message, THINKING, type Captured } from "./claude-test-kit.ts";
import { contextPromptBlock } from "../context/work/prompt-block.ts";
import type { Activity, Department, StrategicGoal, UseCase } from "../db/schema.ts";

// (Rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.12, §5.5) Il blocco «Contesto» nei prompt dei generatori: con
// `contesto` il blocco c'è, una volta, dopo i dati e prima delle richieste; con "" (senza l'ok ai fornitori di AI, o
// niente da dire) il prompt è quello di prima, byte per byte. I generatori veri e il Claude finto di claude-test-kit.ts;
// i dati sono inventati. Quali punti leggono il blocco, e dopo quali controlli: context-in-prompts.source.test.ts.

await installAppModules({});
const { generateReport } = await import("./generate-report.ts");
const { generateUseCases } = await import("./generate-use-cases.ts");
const { classifyActivity, classifyActivitiesBatch } = await import("./classify.ts");
const { generateAgentBlueprints } = await import("./generate-blueprints.ts");
const { generateSimulation } = await import("./generate-simulation.ts");
const { completeUnitMapping } = await import("../mappatura/complete.ts");

// ─── I dati ──────────────────────────────────────────────────────────

const AT = new Date("2026-11-02T09:00:00.000Z");
const THESIS = { coreValueProposition: "Cucine su misura", strategicNodes: ["Progettazione"] };
const activity = (over: Partial<Activity> = {}): Activity =>
  ({
    id: "act-1", departmentId: "dep-1", workspaceId: "ws-prova", title: "Fatture mensili", description: "Ogni mese si preparano le fatture dei clienti.",
    workType: "delivery", classification: "automate", confidenceScore: 0.8, frequency: "mensile", timeSpentHoursWeek: 6, toolsUsed: ["Gestionale", "Foglio di calcolo"],
    inputDescription: "Gli ordini chiusi", outputDescription: "Le fatture inviate", decisionPoints: null, dependencies: null, painPoints: "Copie a mano",
    dataRequired: null, qualityPerceived: null, onetTaskId: null, onetMatchScore: null, aiExposureScore: null, createdAt: AT, updatedAt: AT,
    ...over,
  }) as Activity;
const goals = (): StrategicGoal[] => [
  { id: "goal-1", workspaceId: "ws-prova", parentId: null, type: "goal", title: "Ridurre i tempi di fatturazione", description: null, direction: "decrease", targetValue: 2, currentValue: 5, owner: "Amministrazione", timeframe: null, kpiName: null, kpiUnit: null, createdAt: AT } as StrategicGoal,
];
const reportData = () => ({
  companyValueThesis: THESIS,
  departments: [{ name: "Amministrazione", mappingStatus: "mapped", description: "Fatture e incassi" }] as unknown as Department[],
  activities: [activity()],
  useCases: [{ title: "Fatture automatiche", category: "quick_win", overallScore: 4.25, description: "Le fatture partono da sole dagli ordini chiusi." }] as unknown as UseCase[],
  goals: goals(),
});

/** Il blocco come lo restituisce `loadPromptContext`: con un a capo prima e dopo, pronto da mettere nel prompt. */
const asLoaded = (block: string) => `\n${block}\n`;
/** Il blocco di un generatore con «In breve» e un fatto. */
const BLOCK = asLoaded(
  contextPromptBlock({ brief: ["Il cliente fa cucine su misura per i negozi."], facts: [{ section: "sistemi", statement: "Il gestionale è un ERP di prova." }], nonce: "k3x9q2w7m4p8", purpose: "generatore" }),
);
/** Il blocco della classificazione: solo «In breve» (profilo `classify`). */
const BRIEF_BLOCK = asLoaded(contextPromptBlock({ brief: ["Il cliente fa cucine su misura per i negozi."], facts: [], nonce: "q8w2e6r4t1y5", purpose: "generatore" }));

const reply = (value: unknown) => message([THINKING, { type: "text", text: JSON.stringify(value) }]);
const REPORT = { executiveSummary: "Sintesi.", valueThesisSummary: "Valore.", topAutomate: [], topDifferentiate: [], topInnovate: [], operatingModelImplications: [], governanceBlockers: [], sequencingRecommendation: "Prima le fatture.", kpiBaseline: [] };
const CLASSIFICATION = { classification: "automate", confidenceScore: 0.9, motivazione: "Lavoro ripetitivo.", aiPotential: "Alto" };

/** Il prompt che il modello ha ricevuto: un solo messaggio dell'utente, con un solo testo. */
function promptOf(requests: Captured[], index = 0): string {
  const messages = requests[index].body.messages as Array<{ role: string; content: Array<{ type: string; text: string }> }>;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].content.length, 1);
  assert.equal(requests[index].body.system, undefined, "il prompt è tutto nel messaggio");
  return messages[0].content[0].text;
}

/** Il blocco c'è una volta sola, subito prima di `before`; tolto il blocco, il prompt è `without`. */
function assertBlockBefore(prompt: string, block: string, before: string, without: string): void {
  assert.equal(prompt.split(block).length - 1, 1, "il blocco c'è, una volta");
  assert.ok(prompt.startsWith(`\n${before}`, prompt.indexOf(block) + block.length), `subito prima di «${before}»`);
  assert.equal(prompt.replace(block, ""), without, "il resto del prompt non cambia");
}

// ─── I prompt di prima (per i dati qui sopra) ────────────────────────

const TODAY_REPORT = `Genera un report esecutivo completo per la trasformazione AI di questa organizzazione. Scrivi in italiano, professionale e orientato all'azione.

## Value Thesis
{
  "coreValueProposition": "Cucine su misura",
  "strategicNodes": [
    "Progettazione"
  ]
}

## Dipartimenti mappati (1)
- Amministrazione (mapped): Fatture e incassi

## Attività mappate (1)
- "Fatture mensili" [delivery] [automate] - Ogni mese si preparano le fatture dei clienti.

## Use Cases generati (1)
- "Fatture automatiche" [quick_win] Score: 4.3 - Le fatture partono da sole dagli ordini chiusi.

## Obiettivi Strategici
- [goal] "Ridurre i tempi di fatturazione" → decrease

## Output richiesti

1. **Executive Summary**: 3-5 paragrafi che sintetizzano findings, opportunità e raccomandazioni
2. **Value Thesis Summary**: sintesi di dove si concentra il valore
3. **Top 3 Automate**: stream principali da automatizzare
4. **Top 3 Differentiate**: domini dove concentrare energia umana
5. **Top 3 Innovate**: nuove opportunità possibili con AI
6. **Operating Model Implications**: cosa cambia in ruoli, ownership, governance
7. **Governance Blockers**: impedimenti da risolvere
8. **Sequencing Recommendation**: priorità e ordine di esecuzione
9. **KPI Baseline**: metriche chiave con valori attuali e target`;

const TODAY_USE_CASES = `Sei un esperto di AI transformation. Analizza le attività classificate e il contesto strategico per generare use case AI concreti e azionabili.

## Attività mappate
[act-1] "Fatture mensili" (delivery, automate) - Ogni mese si preparano le fatture dei clienti.

## Contesto strategico (Value Thesis)
{
  "coreValueProposition": "Cucine su misura",
  "strategicNodes": [
    "Progettazione"
  ]
}

## Obiettivi strategici / OKR
[goal] "Ridurre i tempi di fatturazione" - Direction: decrease, Target: 2, Owner: Amministrazione

## Regole per la generazione

1. **Ogni use case deve essere concreto e implementabile**: non idee vaghe ma progetti con scope chiaro
2. **Ogni use case deve essere legato a specifiche attività**: usa gli ID delle attività in relatedActivityIds
3. **Ogni use case deve essere legato a KR/obiettivi quando possibile**
4. **Scoring rigoroso** (1-5 per ogni asse):
   - Impatto: economico, tempo, qualità, coordinamento, sociale
   - Fattibilità: disponibilità dati, chiarezza workflow, rischio, complessità tech, prontezza team
5. **Business case dettagliato**: numeri, metriche attese, costi evitati
6. **Genera 3 categorie**:
   - Top 3 "Automate" streams (attività da automatizzare/comprimere)
   - Top 3 "Differentiate" domains (dove concentrare energia umana)
   - Top 3 "Innovate" opportunities (nuovi prodotti/servizi possibili con AI)
7. Ogni use case deve avere un timeline realistico
8. Non generare più di 12 use case totali

Genera gli use case in italiano.`;

const TODAY_CLASSIFICATION = `Analizza questa attività lavorativa e classificala in uno dei 3 stream del framework Unbundle.

## Attività
- **Titolo**: Fatture mensili
- **Descrizione**: Ogni mese si preparano le fatture dei clienti.
- **Work Type**: delivery
- **Frequenza**: mensile
- **Ore/settimana**: 6
- **Strumenti**: Gestionale, Foglio di calcolo
- **Input**: Gli ordini chiusi
- **Output**: Le fatture inviate
- **Decision points**: non specificati
- **Pain points**: Copie a mano

## Contesto strategico
{
  "coreValueProposition": "Cucine su misura",
  "strategicNodes": [
    "Progettazione"
  ]
}

## Obiettivi strategici
- [goal] Ridurre i tempi di fatturazione

## I 3 STREAM

### AUTOMATE — "Questo lavoro non dovrebbe esistere nella sua forma attuale."
Processi da eliminare o ristrutturare. Lavoro dove l'energia umana viene spesa su task che le macchine dovrebbero gestire. Caratteristiche:
- Alta ripetitività, basso giudizio umano
- Input/output ben definiti
- Il valore sta nell'esecuzione veloce e accurata, non nell'interpretazione
- Spesso source di errori manuali e ritardi
- Include anche attività "bloccate" da sistemi legacy o governance che, una volta sbloccate, andrebbero automatizzate

### DIFFERENTIATE — "Qui concentrare l'energia umana."
Dove risiede il vantaggio competitivo. Il lavoro che solo le tue persone possono fare. Caratteristiche:
- Richiede giudizio, esperienza, relazioni
- È parte dei nodi strategici della value thesis
- L'AI può augmentare (assistere, accelerare) ma NON sostituire
- Se lo automatizzo, perdo vantaggio competitivo
- Include decision-making strategico, relazioni con clienti, design creativo

### INNOVATE — "Questo valore prima non esisteva."
Opportunità nuove che emergono dai pattern cross-organizzativi. Revenue stream, prodotti, servizi che diventano possibili quando vedi cosa gli altri non vedono. Caratteristiche:
- Non è un'attività "corrente" ottimizzabile — è un'opportunità latente
- Emerge dalla combinazione di dati, processi, competenze già esistenti
- L'AI abilita insight, prodotti o servizi completamente nuovi
- Ha potenziale di revenue o di trasformazione del modello di business

Classifica con rigore. Se l'attività è palesemente operativa e ripetitiva → AUTOMATE. Se è il cuore del valore → DIFFERENTIATE. Se nasconde un'opportunità di innovazione → INNOVATE. In caso di dubbio, scegli AUTOMATE (è il default per il lavoro che "c'è ma non dovrebbe esserci così").`;

// ─── Report, use case, classificazione ───────────────────────────────

test("report: con \"\" (o senza `contesto`) il prompt di prima, byte per byte; con il blocco, dopo gli obiettivi e prima delle richieste", async () => {
  for (const contesto of [undefined, ""]) {
    const requests = fakeAppClaude([reply(REPORT)]);
    await generateReport(reportData(), contesto);
    assert.equal(promptOf(requests), TODAY_REPORT, JSON.stringify(contesto));
  }
  const requests = fakeAppClaude([reply(REPORT)]);
  await generateReport(reportData(), BLOCK);
  assertBlockBefore(promptOf(requests), BLOCK, "## Output richiesti", TODAY_REPORT);
});

test("use case: con \"\" (o senza `contesto`) il prompt di prima, byte per byte; con il blocco, dopo gli obiettivi e prima delle regole, anche con l'ESG", async () => {
  for (const contesto of [undefined, ""]) {
    const requests = fakeAppClaude([reply({ useCases: [] })]);
    await generateUseCases([activity()], { companyValueThesis: THESIS, goals: goals(), ...(contesto === undefined ? {} : { contesto }) }, false);
    assert.equal(promptOf(requests), TODAY_USE_CASES, JSON.stringify(contesto));
  }
  const requests = fakeAppClaude([reply({ useCases: [] })]);
  await generateUseCases([activity()], { companyValueThesis: THESIS, goals: goals(), contesto: BLOCK }, false);
  assertBlockBefore(promptOf(requests), BLOCK, "## Regole per la generazione", TODAY_USE_CASES);
  // Con l'ESG le regole cambiano numeri, il posto del blocco no.
  const esg = fakeAppClaude([reply({ useCases: [] }), reply({ useCases: [] })]);
  await generateUseCases([activity()], { companyValueThesis: THESIS, goals: goals(), contesto: "" }, true);
  await generateUseCases([activity()], { companyValueThesis: THESIS, goals: goals(), contesto: BLOCK }, true);
  assert.match(promptOf(esg, 0), /Scoring ESG rigoroso/);
  assertBlockBefore(promptOf(esg, 1), BLOCK, "## Regole per la generazione", promptOf(esg, 0));
});

test("classificazione: con \"\" (o senza `contesto`) il prompt di prima, byte per byte; con «In breve», dopo gli obiettivi e prima dei tre stream", async () => {
  for (const contesto of [undefined, ""]) {
    const requests = fakeAppClaude([reply(CLASSIFICATION)]);
    await classifyActivity(activity(), { companyValueThesis: THESIS, goals: goals(), ...(contesto === undefined ? {} : { contesto }) });
    assert.equal(promptOf(requests), TODAY_CLASSIFICATION, JSON.stringify(contesto));
  }
  const requests = fakeAppClaude([reply(CLASSIFICATION)]);
  const result = await classifyActivity(activity(), { companyValueThesis: THESIS, goals: goals(), contesto: BRIEF_BLOCK });
  assertBlockBefore(promptOf(requests), BRIEF_BLOCK, "## I 3 STREAM", TODAY_CLASSIFICATION);
  assert.deepEqual(result, { classification: "automate", confidenceScore: 0.9, aiPotential: "Alto", reasoning: "Lavoro ripetitivo." }, "la risposta resta quella di sempre");
});

test("classificazione a lotti: lo stesso blocco arriva al prompt di ogni attività, e nessuna chiamata in più", async () => {
  const activities = [activity({ id: "act-1", title: "Fatture mensili" }), activity({ id: "act-2", title: "Solleciti di pagamento" }), activity({ id: "act-3", title: "Incassi" }), activity({ id: "act-4", title: "Note di credito" })];
  const requests = fakeAppClaude(activities.map(() => reply(CLASSIFICATION)));
  const results = await classifyActivitiesBatch(activities, { companyValueThesis: THESIS, goals: goals(), contesto: BRIEF_BLOCK });
  assert.equal(results.size, 4);
  assert.equal(requests.length, 4, "una chiamata per attività, come prima");
  for (let i = 0; i < requests.length; i++) {
    const prompt = promptOf(requests, i);
    assert.equal(prompt.split(BRIEF_BLOCK).length - 1, 1, `attività ${i + 1}`);
    assert.ok(prompt.startsWith("\n## I 3 STREAM", prompt.indexOf(BRIEF_BLOCK) + BRIEF_BLOCK.length));
  }
});

test("«Completa la mappatura»: il blocco che legge `loadUnit` arriva al prompt di ogni passo da classificare; senza, il prompt di prima", async () => {
  const scope = { workspaceId: "11111111-aaaa-4aaa-8aaa-111111111111", departmentId: "22222222-bbbb-4bbb-8bbb-222222222222" };
  // Due passi senza stream e già con il codice O*NET: si classificano soltanto.
  const steps = () => [
    activity({ id: "33333333-cccc-4ccc-8ccc-333333333331", title: "Raccolta delle richieste", classification: null, onetTaskId: "13-1023.00" }),
    activity({ id: "33333333-cccc-4ccc-8ccc-333333333332", title: "Invio dell'ordine", classification: null, onetTaskId: "13-1023.00" }),
  ];
  /** I prompt per titolo del passo: le chiamate partono insieme, l'ordine non conta. */
  const prompts: Record<"con" | "senza", Record<string, string>> = { con: {}, senza: {} };
  for (const [label, contesto] of [["con", BRIEF_BLOCK], ["senza", undefined]] as const) {
    const requests = fakeAppClaude([reply(CLASSIFICATION), reply(CLASSIFICATION)]);
    const outcome = await completeUnitMapping(
      {
        loadUnit: async () => ({ unitName: "Ufficio acquisti", activities: steps(), companyValueThesis: THESIS, goals: goals(), ...(contesto ? { contesto } : {}) }),
        markMapped: async () => ({ first: false }),
        saveSummary: async () => {},
        saveClassifications: async (_where, results) => ({ automate: results.size, differentiate: 0, innovate: 0 }),
        saveOnetMatches: async () => 0,
        classify: classifyActivitiesBatch,
        matchOnet: async () => {
          throw new Error("i passi hanno già il codice O*NET");
        },
      },
      { scope, deadline: Date.now() + 60_000 },
    );
    assert.ok(outcome && !("refused" in outcome) && outcome.classification === "fatta", JSON.stringify(outcome));
    assert.equal(requests.length, 2, `${label}: una chiamata per passo, come prima`);
    for (let i = 0; i < 2; i++) {
      const prompt = promptOf(requests, i);
      prompts[label][/- \*\*Titolo\*\*: (.+)\n/.exec(prompt)?.[1] ?? ""] = prompt;
    }
  }
  assert.deepEqual(Object.keys(prompts.con).sort(), ["Invio dell'ordine", "Raccolta delle richieste"]);
  for (const [title, prompt] of Object.entries(prompts.con)) {
    assert.equal(prompts.senza[title].includes("<contesto-"), false, `${title}: senza il blocco`);
    assertBlockBefore(prompt, BRIEF_BLOCK, "## I 3 STREAM", prompts.senza[title]);
  }
});

// ─── Blueprint e simulazione ─────────────────────────────────────────

test("blueprint: con \"\" il prompt di prima; con il blocco, dopo le attività e prima delle richieste", async () => {
  const useCases = [{ id: "uc-1", title: "Fatture automatiche", category: "quick_win", description: "Le fatture partono da sole.", businessCase: "Meno ore di lavoro.", requirements: ["Accesso al gestionale"] }] as unknown as UseCase[];
  const requests = fakeAppClaude([reply({ blueprints: [] }), reply({ blueprints: [] }), reply({ blueprints: [] })]);
  await generateAgentBlueprints(useCases, [activity()]);
  await generateAgentBlueprints(useCases, [activity()], "");
  await generateAgentBlueprints(useCases, [activity()], BLOCK);
  assert.equal(promptOf(requests, 1), promptOf(requests, 0));
  assert.equal(promptOf(requests, 0).includes("<contesto-"), false);
  assertBlockBefore(promptOf(requests, 2), BLOCK, "Per ogni blueprint specifica:", promptOf(requests, 0));
});

test("simulazione: con \"\" il prompt di prima; con il blocco, dopo gli use case e prima delle richieste", async () => {
  const data = () => ({ ...reportData(), departments: [{ name: "Amministrazione", teamSize: 4 }] as unknown as Department[] });
  const empty = { scenarios: [], aiOsSummary: Object.fromEntries(["knowledgeBase", "agentOrchestration", "dataPipelines", "monitoring", "governance"].map((key) => [key, { needed: false, recommendation: "Non serve." }])) };
  const requests = fakeAppClaude([reply(empty), reply(empty), reply(empty)]);
  await generateSimulation(data());
  await generateSimulation(data(), "");
  await generateSimulation(data(), BLOCK);
  assert.equal(promptOf(requests, 1), promptOf(requests, 0));
  assert.equal(promptOf(requests, 0).includes("<contesto-"), false);
  assertBlockBefore(promptOf(requests, 2), BLOCK, "Genera 3 scenari:", promptOf(requests, 0));
});
