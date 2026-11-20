import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_CONTEXT_TEXT, caseOnlyAgentContext, caseOnlyContestoMd, formatAgentContext, formatContestoMd, type AgentContext } from "../../context/work/agent-text.ts";
import { caseOnlyPackageFiles, packageContextDelta } from "./package.ts";

// D7 senza database (rilascio 8.0d-1, RILASCIO-8.0d-ESTERNI-FASE-2.md §4.10, D7): «Solo questo use case» riceve della
// memoria del cliente solo i fatti legati al suo caso, mai «In breve», le regole e le parole dell'azienda, nemmeno dalle
// versioni del pacchetto salvate prima. La lettura dal database (`loadAgentContext` con `caseOnly`) la prova
// src/lib/use-cases/factory/case-only.integration.test.ts.

const fact = (statement: string, section: AgentContext["caseFacts"][number]["section"]) => ({ statement, section, source: "call" as const, on: "2026-11-14" });

const CTX: AgentContext = {
  brief: ["Cliente Demo fa logistica per l'industria.", "Lavorano su tre turni."],
  caseFacts: [fact("Le quotazioni le firma una persona.", "lavoro")],
  rules: [fact("Nessun dato esce dall'Unione europea.", "regole")],
  words: [fact("«Commessa» vuol dire ordine del cliente.", "parole")],
  commitments: [{ statement: "Inviare l'esportazione delle fatture", party: "cliente", role: "Amministrazione", dueOn: "2026-11-25" }],
  questions: [{ question: "Chi approva sopra soglia?", askWhom: "Direzione" }],
  since: null,
};

const COMPANY = /Cliente Demo fa logistica|tre turni|Unione europea|Commessa|In breve|Regole e vincoli|Parole del cliente/;

test("D7: il contesto per «Solo questo use case» ha i fatti del caso, gli impegni e le domande del caso; niente dell'azienda", () => {
  const reduced = caseOnlyAgentContext(CTX);
  assert.deepEqual(reduced.brief, []);
  assert.deepEqual(reduced.rules, []);
  assert.deepEqual(reduced.words, []);
  assert.deepEqual(reduced.caseFacts, CTX.caseFacts);
  assert.deepEqual(reduced.commitments, CTX.commitments);
  assert.deepEqual(reduced.questions, CTX.questions);
  const layer = formatAgentContext(reduced, { code: "XX-0012" });
  assert.match(layer, /Le quotazioni le firma una persona/);
  assert.doesNotMatch(layer, COMPANY);
});

test("D7: CONTESTO.md di una versione salvata, per «Solo questo use case»: titolo, apertura e solo «Che cosa tocca questo caso»", () => {
  const stored = formatContestoMd(CTX, { code: "XX-0012", version: 3, day: "2026-11-10" }) ?? "";
  assert.match(stored, COMPANY, "il file salvato ha anche l'azienda");
  const reduced = caseOnlyContestoMd(stored) ?? "";
  assert.ok(reduced.startsWith("# Contesto del cliente per XX-0012 (k3)\n\nSola lettura:"));
  assert.ok(reduced.includes(`${AGENT_CONTEXT_TEXT.file.caseFacts}\n- Le quotazioni le firma una persona.`));
  assert.doesNotMatch(reduced, COMPANY);
  assert.ok(reduced.endsWith("\n"));
  // Lo stesso file due volte: non cambia (idempotente).
  assert.equal(caseOnlyContestoMd(reduced), reduced);
  // Senza fatti del caso, nessun file; con una forma inattesa, nessun file (si chiude, non si apre).
  assert.equal(caseOnlyContestoMd(formatContestoMd({ ...CTX, caseFacts: [] }, { code: "XX-0012", version: 1, day: "2026-11-10" })), null);
  assert.equal(caseOnlyContestoMd("Regole: tutto quello che c'è"), null);
  assert.equal(caseOnlyContestoMd(null), null);
});

test("D7: i file del pacchetto per «Solo questo use case»: gli stessi, con CONTESTO.md ridotto o tolto", () => {
  const stored = formatContestoMd(CTX, { code: "XX-0012", version: 2, day: "2026-11-10" }) ?? "";
  const files = { "PACCHETTO.md": "# corpo", "BRIEF.md": "# brief", VERSIONE: "k2", "CONTESTO.md": stored };
  const shown = caseOnlyPackageFiles(files);
  assert.deepEqual(Object.keys(shown).sort(), Object.keys(files).sort());
  assert.equal(shown["PACCHETTO.md"], files["PACCHETTO.md"]);
  assert.doesNotMatch(String(shown["CONTESTO.md"]), COMPANY);
  assert.equal(files["CONTESTO.md"], stored, "i file di partenza non cambiano");
  const onlyCompany = formatContestoMd({ ...CTX, caseFacts: [] }, { code: "XX-0012", version: 2, day: "2026-11-10" }) ?? "";
  assert.equal("CONTESTO.md" in caseOnlyPackageFiles({ ...files, "CONTESTO.md": onlyCompany }), false);
  assert.deepEqual(caseOnlyPackageFiles({ VERSIONE: "k1" }), { VERSIONE: "k1" });
  assert.deepEqual(caseOnlyPackageFiles(null), {});
});

test("D7: le novità del contesto per «Solo questo use case» si contano sui soli fatti del caso", () => {
  const stored = formatContestoMd(CTX, { code: "XX-0012", version: 2, day: "2026-11-10" }) ?? "";
  const latest = { files: { "CONTESTO.md": stored } };
  // Lo stesso contesto, letto come lo legge lui: nessuna novità (le righe dell'azienda non contano come tolte).
  assert.equal(packageContextDelta({ context: caseOnlyAgentContext(CTX), namesToHide: [], code: "XX-0012", latest, caseOnly: true }), 0);
  // Per chi non è «Solo questo use case» il confronto resta quello di sempre.
  assert.equal(packageContextDelta({ context: CTX, namesToHide: [], code: "XX-0012", latest }), 0);
  const more = caseOnlyAgentContext({ ...CTX, caseFacts: [...CTX.caseFacts, fact("Le quotazioni partono dal portale.", "lavoro")] });
  assert.equal(packageContextDelta({ context: more, namesToHide: [], code: "XX-0012", latest, caseOnly: true }), 1);
});
