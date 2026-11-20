import test from "node:test";
import assert from "node:assert/strict";
import { findForbiddenIn } from "./copy-guard.ts";
import type { MapItemRef, ProcessStepView, SolutionNodeView } from "./map.ts";
import {
  RULES_PANEL,
  RULES_TEXT,
  RULE_PARAM,
  SOLUTION_TEXT,
  boardSteps,
  rulesPanelHref,
  solutionLinksFor,
  solutionViewHref,
  stepFromPanel,
  stepPanelHref,
  stepPanelParam,
} from "./solution.ts";
import { legacyRulesHref } from "./solution-panels.ts";

// (Rilascio 10, §3.5) Soluzione, una pagina di lettura: il processo disegnato come la board, i pannelli dei passi e
// delle regole nell'indirizzo, le pagine senza scheda per Lateral Space e lo sviluppo. Dati inventati.

const ID = "33333333-3333-4333-8333-333333333333";
const base = "/dashboard/w/casi-duso/c/soluzione";
const item = (status: MapItemRef["status"]): MapItemRef => ({ key: `q.x.${status}`, id: ID, title: "Quante richieste al mese?", kind: "domanda", status, owner: null, canOpen: true });
const step = (id: string, over: Partial<ProcessStepView> = {}): ProcessStepView => ({
  id,
  label: `Passo ${id}`,
  phase: null,
  who: "Commerciale",
  tool: null,
  time: null,
  friction: null,
  input: [],
  output: [],
  humanDecision: null,
  items: [],
  otherData: [],
  ...over,
});

test("the board: the agent's colour on the steps the agent does, «◆» where a person decides, the questions as a dot", () => {
  const steps = [step("a", { items: [item("validata")] }), step("b", { humanDecision: "Approva lo sconto", items: [item("in_verifica"), item("validata")] }), step("c", { items: [item("da_chiedere")] })];
  const withAi = boardSteps("con-agente", steps);
  assert.deepEqual(
    withAi.map((s) => [s.n, s.agent, s.decision, s.tone]),
    [
      [1, true, false, "a_posto"],
      [2, false, true, "da_verificare"],
      [3, true, false, "da_fare"],
    ],
  );
  assert.ok(boardSteps("oggi", steps).every((s) => !s.agent), "today people do the work: no agent colour");
  assert.ok(boardSteps("esempio", steps).every((s) => !s.agent));
  assert.equal(boardSteps("oggi", [step("x")])[0].tone, null, "no question: a dashed dot");
  const node: SolutionNodeView = { id: "n1", label: "Arriva la richiesta", description: null, who: "Servizio", input: [], output: [], items: [], worst: null };
  assert.deepEqual(boardSteps("con-agente", [node])[0], { id: "n1", n: 1, title: "Arriva la richiesta", who: "Servizio", decision: false, agent: true, tone: null });
});

test("views, steps and the example live in the address; «Con l'AI» is the starting one", () => {
  assert.equal(solutionViewHref(base, "con-agente"), `${base}#come-funziona`);
  assert.equal(solutionViewHref(base, "oggi"), `${base}?vista=oggi#come-funziona`);
  assert.equal(solutionViewHref(base, "esempio"), `${base}?vista=esempio#come-funziona`);
  assert.equal(stepPanelHref(base, "con-agente", "p1"), `${base}?apri=passo-p1`);
  assert.equal(stepPanelHref(base, "oggi", "p 1"), `${base}?vista=oggi&apri=passo-p+1`);
  assert.equal(stepFromPanel(stepPanelParam("p1")), "p1");
  for (const other of [null, "", "regole", "versioni", "passo-"]) assert.equal(stepFromPanel(other), null, String(other));
  assert.deepEqual(SOLUTION_TEXT.views, { oggi: "Oggi", "con-agente": "Con l'AI" });
});

test("«Vista di analisi ›» and «Modello dati ›» for Lateral Space and the development only", () => {
  for (const role of ["ls_lead", "ls_analista", "ls_sviluppatore"] as const) assert.deepEqual(solutionLinksFor([role]), { analysis: true, dataModel: true }, role);
  for (const role of ["owner_cliente", "ai_board", "osservatore", "approvatore_privacy"] as const) assert.deepEqual(solutionLinksFor([role]), { analysis: false, dataModel: false }, role);
  assert.equal(SOLUTION_TEXT.rules(40), "Regole · 40");
  assert.equal(SOLUTION_TEXT.rules(0), "Regole");
});

test("the rules panel keeps search, filters, constraints and page; the open rule is `regola`; other parameters drop", () => {
  const sp = { apri: RULES_PANEL, q: "margine", stato: "da-fare", vincoli: "1", pagina: "2", vista: "oggi", versione: "3", regola: ID };
  assert.equal(rulesPanelHref(base, sp), `${base}?apri=regole&q=margine&stato=da-fare&vincoli=1&pagina=2&regola=${ID}`);
  assert.equal(rulesPanelHref(base, sp, { [RULE_PARAM]: null }), `${base}?apri=regole&q=margine&stato=da-fare&vincoli=1&pagina=2`);
  assert.equal(rulesPanelHref(base, {}, { pagina: "3" }), `${base}?apri=regole&pagina=3`);
});

test("yesterday's Regole page lands in the panel, with its open rule and filters", () => {
  const root = "/dashboard/w/casi-duso/c";
  assert.equal(legacyRulesHref(root, new URLSearchParams(`apri=${ID}&q=sconto&perimetro=fuori&x=1`)), `${base}?apri=regole&q=sconto&perimetro=fuori&regola=${ID}`);
  assert.equal(legacyRulesHref(`${root}/`, {}), `${base}?apri=regole`);
  assert.equal(legacyRulesHref(root, { apri: [ID, "x"], stato: "a-posto" }), `${base}?apri=regole&stato=a-posto&regola=${ID}`);
});

test("copy guard: the words of the reading page and of the rules panel the client reads", () => {
  const T = SOLUTION_TEXT;
  const client = [
    T.howTitle, ...Object.values(T.views), T.viewsLabel, T.legendLabel, T.legend("cliente"), T.example, T.exampleTitle, T.backToProcess, T.decides, T.who, T.step(3),
    T.agentStep, T.stepPanelWho, T.stepPanelTool, T.stepPanelTime, T.friction, T.decidesWhat, T.enters, T.exits, T.questions, T.noQuestions, T.noDescription,
    T.more, T.rules(40), T.partsLabel, T.backToSolution, RULES_TEXT.title, RULES_TEXT.count(40), RULES_TEXT.none("cliente"), RULES_TEXT.noFilterMatch, RULES_TEXT.clear,
    RULES_TEXT.back,
  ];
  assert.deepEqual(findForbiddenIn(client, "cliente"), []);
  for (const text of client) assert.doesNotMatch(text, /schema di partenza|\bvincol|\bcaso\b|\bdossier\b/i, text);
  assert.match(RULES_TEXT.none("ls"), /schema di partenza/, "Lateral Space keeps its word");
});
