// Il contesto per i coding agent (rilascio 8.0b): il brief sta in 300 token anche con tanto materiale, non dice
// mai un nome, mostra solo le decisioni che valgono e il prossimo passo giusto per ogni stato del progetto.
import test from "node:test";
import assert from "node:assert/strict";
import { BRIEF_MAX_CHARS, BRIEF_MAX_TOKENS, composeBrief, composeDecisionsLayer, composeProjectLayer, estimateTokens, nextStep, SETUP_GUIDE, type BriefInput, type BriefProject } from "./brief.ts";
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
