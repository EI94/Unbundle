// Il contesto per i coding agent (rilascio 8.0b): il brief sta in 300 token anche con tanto materiale, non dice
// mai un nome, mostra solo le decisioni che valgono e il prossimo passo giusto per ogni stato del progetto. (9b) La riga
// del contesto del cliente dopo quella del pacchetto, e lo strato `contesto`.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BRIEF_MAX_CHARS,
  BRIEF_MAX_TOKENS,
  cliKnowsContextLayer,
  composeBrief,
  composeDecisionsLayer,
  composeProjectLayer,
  composeQuestionsLayer,
  CONTEXT_LAYERS,
  estimateTokens,
  nextStep,
  SETUP_GUIDE,
  type BriefInput,
  type BriefProject,
} from "./brief.ts";
import { SETUP_TOPICS } from "../../db/use-case-hub-factory-ddl.ts";

const topics = (n: number) => Object.fromEntries(SETUP_TOPICS.slice(0, n).map((t) => [t, { scelta: `Scelta per ${t}`, perche: "Il motivo", alternativa: null }]));

const project = (over: Partial<BriefProject> = {}): BriefProject => ({
  version: 1,
  status: "approvato",
  revision: 4,
  topics: topics(10),
  framework: "codice",
  newTools: [{ nome: "Neon", perche: "il database del caso" }],
  estimateHours: 90,
  monthlyCostEur: 60,
  approvedAt: "2026-11-09T10:00:00.000Z",
  aiBoardOkAt: "2026-11-10T10:00:00.000Z",
  changeRequest: null,
  updatedAt: "2026-11-10T10:00:00.000Z",
  ...over,
});

const decision = (i: number, over: Partial<BriefInput["decisions"][number]> = {}) => ({
  id: `d${i}`,
  decidedOn: `2026-11-${String(10 + (i % 15)).padStart(2, "0")}`,
  topicKey: null,
  topic: `Argomento ${i}`,
  choice: `Decisione numero ${i}`,
  reason: null,
  createdAt: `2026-11-${String(10 + (i % 15)).padStart(2, "0")}T10:00:00.000Z`,
  ...over,
});

const input = (over: Partial<BriefInput> = {}): BriefInput => ({
  code: "PX-0001",
  title: "Smistamento delle richieste in arrivo",
  dossierStatus: "in_sviluppo",
  open: null,
  approved: project(),
  latestPackage: { version: 1, createdAt: "2026-11-09T10:00:00.000Z", source: "importato" },
  decisions: [decision(1), decision(2)],
  openNeeds: 2,
  proposedQuestions: 1,
  repos: [{ repo: "Prova/repo-di-prova", folder: "casi/px-0001" }],
  namesToHide: ["Mario Rossi"],
  ...over,
});

test("il brief: codice, stato, prossimo passo, pacchetto, strumenti, decisioni, domande, repository, entro 300 token", () => {
  const text = composeBrief(input());
  assert.match(text, /^PX-0001 · Smistamento delle richieste in arrivo\n/);
  assert.match(text, /Dossier: In sviluppo\. Progetto: versione 1, approvato il 09\/11\/2026, framework codice\./);
  assert.match(text, /Prossimo passo: costruire secondo il progetto approvato \(versione 1\)\./);
  assert.match(text, /Pacchetto: k1 del 09\/11\/2026/);
  assert.match(text, /Strumenti nuovi: Neon \(ok AI Board 10\/11\/2026\)\./);
  assert.match(text, /Domande: 2 aperte in «Cosa serve», 1 proposta da un coding agent\./);
  assert.match(text, /Repository: Prova\/repo-di-prova \(casi\/px-0001\)\./);
  assert.ok(estimateTokens(text) <= BRIEF_MAX_TOKENS);
  assert.match(composeBrief(input({ openNeeds: 1, proposedQuestions: 0 })), /Domande: 1 aperta in «Cosa serve»\./);
});

test("anche con cento decisioni lunghe e un titolo lunghissimo il brief resta entro 1.200 caratteri", () => {
  const many = Array.from({ length: 100 }, (_, i) => decision(i, { choice: "x".repeat(400), topic: "y".repeat(80) }));
  const text = composeBrief(input({ title: "t".repeat(500), decisions: many, repos: Array.from({ length: 20 }, (_, i) => ({ repo: `Prova/r${i}`, folder: `casi/px-${i}` })) }));
  assert.ok(text.length <= BRIEF_MAX_CHARS, String(text.length));
  assert.ok(estimateTokens(text) <= BRIEF_MAX_TOKENS);
  assert.ok((text.match(/^- /gm) ?? []).length <= 5, "al massimo cinque decisioni");
});

test("mai un nome: né nel brief né negli strati; le e-mail non ci sono perché i testi del team non le ammettono", () => {
  const named = input({ decisions: [decision(1, { choice: "Lo approva Mario Rossi ogni lunedì" })], approved: project({ topics: { funzionalita: { scelta: "Mario prepara le bozze", perche: null, alternativa: null } } }) });
  for (const text of [composeBrief(named), composeProjectLayer(named), composeDecisionsLayer(named)]) {
    assert.ok(!text.includes("Mario") && !text.includes("Rossi"), text);
    assert.ok(text.includes("una persona"));
  }
});

test("(8.0c) gli identificativi tecnici non passano dai nomi da nascondere: codice, repository e cartelle restano interi; il testo libero no", () => {
  // Una persona di nome Prova Esterno e una di cognome Rosa: i loro nomi stanno anche in un codice e in due repository.
  const names = ["Prova Esterno", "Maria Rosa"];
  const named = input({
    code: "ROSA-0001",
    title: "Il riordino che prepara Rosa",
    repos: [
      { repo: "Voltaen/prova-esterni", folder: "casi/rosa-0001" },
      { repo: "Voltaen/beta-rosa", folder: "casi/rosa-0001" },
    ],
    namesToHide: names,
    decisions: [decision(1, { topic: "Chi approva", choice: "Lo approva Rosa ogni lunedì" })],
    approved: project({ topics: { funzionalita: { scelta: "Prova prepara le bozze", perche: null, alternativa: null } }, changeRequest: null }),
  });
  const brief = composeBrief(named);
  assert.match(brief, /^ROSA-0001 · Il riordino che prepara una persona\n/);
  assert.match(brief, /Repository: Voltaen\/prova-esterni \(casi\/rosa-0001\), Voltaen\/beta-rosa \(casi\/rosa-0001\)\./);
  assert.match(brief, /Lo approva una persona ogni lunedì/);
  const project_ = composeProjectLayer(named);
  assert.match(project_, /^ROSA-0001 · progetto versione 1/);
  assert.match(project_, /\nuna persona prepara le bozze\n/);
  assert.match(composeDecisionsLayer(named), /^ROSA-0001 · decisioni che valgono \(1\)\n- .* · Lo approva una persona ogni lunedì$/);
  const questions = composeQuestionsLayer({ code: "ROSA-0001", openNeeds: [{ title: "Il turno di Rosa", status: "aperta" }], proposals: [], namesToHide: names });
  assert.match(questions, /^ROSA-0001 · domande\n/);
  assert.match(questions, /- Il turno di una persona \(aperta\)/);
  assert.match(questions, /unbundle ask ROSA-0001 /);
  // Il nome non resta mai nel testo libero.
  for (const text of [brief, project_, composeDecisionsLayer(named), questions]) {
    assert.doesNotMatch(text.replace(/ROSA-0001|casi\/rosa-0001|Voltaen\/beta-rosa|Voltaen\/prova-esterni/g, ""), /\b(Rosa|Prova)\b/i, text);
  }
});

test("(8.0c) un nome noto in ogni testo libero: strumenti nuovi, modifica chiesta dall'AI Board, argomento, scelta e perché di una decisione passano tutti dai nomi da nascondere", () => {
  // Mario Rossi è tra i nomi che Unbundle conosce: sta in ogni testo che il team scrive a mano, un campo alla volta.
  const named = input({
    approved: null,
    open: project({
      version: 2,
      status: "da_approvare",
      approvedAt: null,
      aiBoardOkAt: null,
      topics: { funzionalita: { scelta: "Rossi prepara le bozze", perche: "Mario conosce i clienti", alternativa: "Farle scrivere a Mario Rossi" } },
      newTools: [{ nome: "Agenda di Mario Rossi", perche: "la usa già Mario per i turni" }],
      changeRequest: "Togliere l'accesso di Mario Rossi all'archivio",
    }),
    decisions: [decision(1, { topic: "Il turno di Mario", choice: "Lo copre Rossi", reason: "Mario Rossi è in sede ogni lunedì" })],
  });
  // Il brief: gli strumenti nuovi e le decisioni (argomento e scelta).
  const brief = composeBrief(named);
  assert.match(brief, /\nStrumenti nuovi: Agenda di una persona \(manca l'ok dell'AI Board\)\.\n/);
  assert.match(brief, /\n- 11\/11 · Il turno di una persona · Lo copre una persona\n/);
  // Lo strato «progetto»: scelta, perché e alternativa; il nome e il perché di uno strumento nuovo; la modifica chiesta.
  const layer = composeProjectLayer(named);
  assert.match(layer, /\nuna persona prepara le bozze\nPerché: una persona conosce i clienti\nScartata: Farle scrivere a una persona\n/);
  assert.match(layer, /\n- Agenda di una persona: la usa già una persona per i turni\n/);
  assert.match(layer, /\nL'AI Board chiede una modifica: Togliere l'accesso di una persona all'archivio$/);
  // Lo strato «decisioni»: argomento, scelta e perché.
  const decisions = composeDecisionsLayer(named);
  assert.match(decisions, /\n- 11\/11\/2026 · Il turno di una persona · Lo copre una persona \(perché: una persona è in sede ogni lunedì\)$/);
  for (const text of [brief, layer, decisions]) assert.doesNotMatch(text, /Mario|Rossi/, text);
});

test("solo le decisioni che valgono: una scelta rifatta sostituisce quella di prima", () => {
  const decisions = [
    decision(1, { topicKey: "modelli", topic: "Modelli", choice: "Modello grande", decidedOn: "2026-11-09", createdAt: "2026-11-09T09:00:00.000Z" }),
    decision(2, { topicKey: "modelli", topic: "Modelli", choice: "Modello piccolo con riserva", decidedOn: "2026-11-10", createdAt: "2026-11-10T09:00:00.000Z" }),
  ];
  for (const text of [composeBrief(input({ decisions })), composeDecisionsLayer(input({ decisions }))]) {
    assert.ok(text.includes("Modello piccolo con riserva"));
    assert.ok(!text.includes("Modello grande"));
  }
});

test("il prossimo passo segue il progetto", () => {
  const base = { code: "PX-0001", latestPackage: null, approved: null };
  assert.match(nextStep({ ...base, open: null }), /^impostare il caso \(«unbundle setup PX-0001»\)\.$/);
  assert.match(nextStep({ ...base, open: project({ status: "in_corso", topics: topics(9) }) }), /manca una scelta/);
  assert.match(nextStep({ ...base, open: project({ status: "in_corso", topics: topics(7) }) }), /mancano 3 scelte/);
  assert.equal(nextStep({ ...base, open: project({ status: "in_corso" }) }), "mandare il progetto in approvazione.");
  assert.equal(nextStep({ ...base, open: project({ status: "da_approvare", aiBoardOkAt: null }) }), "aspettare l'ok dell'AI Board agli strumenti nuovi.");
  assert.equal(nextStep({ ...base, open: project({ status: "da_approvare" }) }), "aspettare l'approvazione del responsabile del caso.");
  assert.match(nextStep({ ...base, open: project({ status: "da_approvare", aiBoardOkAt: null, changeRequest: "Solo in UE" }) }), /chiede una modifica/);
  assert.match(nextStep({ ...base, approved: project(), open: null }), /generare il pacchetto/);
});

test("dal: che cosa è cambiato; senza novità lo dice", () => {
  const since = composeBrief(input({ since: "2026-11-09T12:00:00.000Z", decisions: [decision(1, { createdAt: "2026-11-10T09:00:00.000Z" })] }));
  assert.match(since, /Dal 09\/11\/2026: 1 decisione nuova, progetto cambiato\./);
  assert.match(composeBrief(input({ since: "2026-12-01T00:00:00.000Z" })), /Dal 01\/12\/2026: niente di nuovo\./);
});

test("lo strato progetto: i 10 argomenti nell'ordine, «Da scegliere» dove mancano, strumenti e stima", () => {
  const text = composeProjectLayer(input({ open: project({ status: "in_corso", topics: topics(8) }) }));
  assert.equal((text.match(/^## /gm) ?? []).length, 11);
  assert.equal((text.match(/^Da scegliere\.$/gm) ?? []).length, 2);
  assert.match(text, /Costruzione: circa 90 ore\. Esercizio: circa 60 € al mese\./);
  assert.equal(composeProjectLayer(input({ approved: null })), "PX-0001: il progetto non è ancora impostato.");
  for (const topic of SETUP_TOPICS) assert.ok(SETUP_GUIDE[topic].endsWith("."), topic);
});

test("lo strato domande: le proposte a chi vede «Cosa serve», senza nomi; per gli altri solo che ci sono altrove", () => {
  const proposals = [{ question: "Le richieste di Olga vanno prima?", reason: null, createdAt: "2026-11-11T10:00:00.000Z" }];
  const seen = composeQuestionsLayer({ code: "PX-0042", openNeeds: [], proposals, namesToHide: ["Olga Cliente"] });
  assert.match(seen, /Proposte dei coding agent da decidere \(1\):\n- 11\/11\/2026 · Le richieste di una persona vanno prima\?/);
  assert.match(seen, /unbundle ask PX-0042/);
  // Anche il perché di una proposta e il titolo di un'esigenza aperta passano dai nomi da nascondere.
  const reasoned = composeQuestionsLayer({
    code: "PX-0042",
    openNeeds: [{ title: "L'elenco dei clienti di Olga", status: "aperta" }],
    proposals: [{ question: "Chi copre il turno di Olga?", reason: "Olga Cliente è in ferie ad agosto", createdAt: "2026-11-11T10:00:00.000Z" }],
    namesToHide: ["Olga Cliente"],
  });
  assert.match(reasoned, /\n- L'elenco dei clienti di una persona \(aperta\)\n/);
  assert.match(reasoned, /\n- 11\/11\/2026 · Chi copre il turno di una persona\? \(perché: una persona è in ferie ad agosto\)\n/);
  assert.doesNotMatch(reasoned, /Olga|Cliente/);
  const hidden = composeQuestionsLayer({ code: "PX-0042", openNeeds: null, proposals: null, namesToHide: [] });
  assert.equal(hidden, "PX-0042 · domande\n«Cosa serve»: le esigenze le vede chi valuta lo use case.\nProposte dei coding agent: le vede chi valuta lo use case.");
});

// ─── (9b) Il contesto del cliente (RILASCIO-9b-COSTRUZIONE.md §2.5) ───

test("(9b) la riga del contesto sta subito dopo quella del pacchetto; senza novità non c'è", () => {
  const lines = composeBrief(input({ contextLayer: true, contextDelta: 3, latestPackage: { version: 2, createdAt: "2026-11-09T10:00:00.000Z", source: "generato" } })).split("\n");
  const at = lines.findIndex((line) => line.startsWith("Pacchetto: k2 del 09/11/2026"));
  assert.ok(at > 0);
  assert.equal(lines[at + 1], "Contesto: 3 novità dopo il pacchetto k2 (unbundle context PX-0001 --contesto).");
  for (const delta of [0, undefined, -2, Number.NaN]) assert.doesNotMatch(composeBrief(input({ contextLayer: true, contextDelta: delta })), /^Contesto:/m, String(delta));
});

test("(9b) senza pacchetto e con fatti: quanti fatti ci sono, dopo il prossimo passo", () => {
  const lines = composeBrief(input({ contextLayer: true, latestPackage: null, contextDelta: 12 })).split("\n");
  const at = lines.findIndex((line) => line.startsWith("Prossimo passo: "));
  assert.equal(lines[at + 1], "Contesto: 12 fatti sul cliente (unbundle context PX-0001 --contesto).");
  assert.match(composeBrief(input({ contextLayer: true, latestPackage: null, contextDelta: 1 })), /\nContesto: 1 fatto sul cliente \(unbundle context PX-0001 --contesto\)\.\n/);
});

test("(9b) il tetto dei 1.200 caratteri resta: con il brief lungo escono le decisioni, non la riga del contesto", () => {
  const many = Array.from({ length: 100 }, (_, i) => decision(i, { choice: "x".repeat(400), topic: "y".repeat(80) }));
  const text = composeBrief(input({ contextLayer: true, title: "t".repeat(500), decisions: many, contextDelta: 7, repos: Array.from({ length: 20 }, (_, i) => ({ repo: `Prova/r${i}`, folder: `casi/px-${i}` })) }));
  assert.ok(text.length <= BRIEF_MAX_CHARS, String(text.length));
  assert.match(text, /\nContesto: 7 novità dopo il pacchetto k1 \(unbundle context PX-0001 --contesto\)\.\n/);
  assert.ok((text.match(/^- /gm) ?? []).length < 5, "le decisioni cedono il posto");
});

test("(9b) la riga del contesto porta il codice intero, anche quando contiene un nome da nascondere", () => {
  const text = composeBrief(input({ contextLayer: true, code: "ROSA-0001", namesToHide: ["Maria Rosa"], contextDelta: 2 }));
  assert.match(text, /\nContesto: 2 novità dopo il pacchetto k1 \(unbundle context ROSA-0001 --contesto\)\.\n/);
});

test("(9b) lo strato `contesto` tra gli strati, e nella riga «Strati» del brief per la CLI che lo conosce", () => {
  assert.deepEqual([...CONTEXT_LAYERS], ["progetto", "decisioni", "pacchetto", "domande", "contesto"]);
  assert.match(composeBrief(input({ contextLayer: true })), /\nStrati: --progetto, --decisioni, --pacchetto, --domande, --contesto\.$/);
});

test("(9b) la CLI 1.5.0 non conosce `--contesto`: nel brief niente riga del contesto e niente strato, anche con le novità", () => {
  for (const contextLayer of [undefined, false]) {
    const text = composeBrief(input({ contextLayer, contextDelta: 3 }));
    assert.doesNotMatch(text, /^Contesto:|--contesto/m, String(contextLayer));
    assert.match(text, /\nStrati: --progetto, --decisioni, --pacchetto, --domande\.$/);
  }
});

test("(9b) chi conosce `--contesto`: la CLI del modello dalla 1.6.0 (il suo user-agent); le altre e gli altri client no", () => {
  for (const agent of ["unbundle-cli/1.6.0", "unbundle-cli/1.6.1", "unbundle-cli/1.10.0", "unbundle-cli/2.0.0", " unbundle-cli/1.6.0 ", "unbundle-cli/1.6.0 (darwin)", "unbundle-cli/1.6.0-beta"]) {
    assert.equal(cliKnowsContextLayer(agent), true, agent);
  }
  for (const agent of [null, undefined, "", "unbundle-cli/1.5.0", "unbundle-cli/1.5.9", "unbundle-cli/0.9.9", "unbundle-cli/1.6", "unbundle-cli/1.6.0.1", "Unbundle-CLI/1.6.0", "claude-code/2.0.0", "node", "x unbundle-cli/1.6.0"]) {
    assert.equal(cliKnowsContextLayer(agent), false, String(agent));
  }
});
