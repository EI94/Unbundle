// `use-case-admin factory-import` (rilascio 8.0a): la lettura di PROGETTO.md e decisioni.md della settimana zero e il
// piano, su un caso inventato (il repository è pubblico: niente dati dei clienti).
import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_COMMANDS, AdminStop, parseAdminOptions } from "./cli.ts";
import { factoryImportPlan, italianNumber, packageFromFiles, parseDecisions, parseProjectMarkdown } from "./factory-import.ts";
import { packageFilesHash } from "../factory/package.ts";

const ROWS = [
  ["Funzionalità", "Smista le richieste in arrivo", "È il valore della scheda", "Anche la risposta"],
  ["User journey", "Gradino 0 in ombra, poi il pannello", "Misure in mano", "Autonomia subito"],
  ["Dati", "Sola lettura; una tabella del caso su Neon in UE", "Le regole vanno scritte", "Un foglio Excel"],
  ["Framework agentico", "Codice (predefinito)", "Regole precise", "n8n"],
  ["Backend", "Funzioni Vercel", "Risposta veloce", "Un controllo orario"],
  ["Frontend", "Pannello comune, poi nessuno", "Un tocco", "Un'interfaccia nuova"],
  ["Integrazioni", "Sistema A in sola lettura", "Meno rischio", "—"],
  ["Modelli", "lettura su un modello piccolo, con la riserva", "Il più piccolo che basta", "Uno grande per tutto"],
  ["Osservabilità", "Langfuse in UE", "Ispezionare", "Solo i log"],
  ["Evals e autonomia", "Regole al 100 %", "Una risposta sbagliata costa", "Partire dal gradino 1"],
];

const project = (over: { stato?: string; aiBoardIl?: string | null; rows?: string[][] } = {}) =>
  [
    "---",
    "caso: px-0001",
    "versione_progetto: 1",
    `stato: ${over.stato ?? "approvato"}`,
    'approvato_il: "2026-11-09"',
    "ai_board: approvato (Neon, Langfuse) dal responsabile del caso",
    over.aiBoardIl === null ? "" : `ai_board_il: "${over.aiBoardIl ?? "2026-11-10"}"`,
    'standard: "1.1"',
    "catalogo: 1",
    "---",
    "",
    "# PX-0001 · Caso di prova",
    "",
    "| # | Argomento | Scelta | Perché | Alternativa scartata |",
    "|---|---|---|---|---|",
    ...(over.rows ?? ROWS).map((r, i) => `| ${i + 1} | ${r.join(" | ")} |`),
    "",
    "## Stima",
    "- **Costruzione:** circa 40 ore, in 4 compiti.",
    "- **Esercizio al mese:** circa 25 € (modelli e database).",
    "",
    "## Strumenti nuovi per il cliente",
    "Neon Postgres in UE (database del caso) e Langfuse in UE (tracce): ok del responsabile del caso il 10/11/2026.",
    "",
  ].join("\n");

const DECISIONS = [
  "# Decisioni",
  "",
  "- 2026-11-09 · Funzionalità · smista le richieste · è il valore · anche la risposta · Lateral Space (bozza)",
  "- 2026-11-10 · Strumenti nuovi · Neon e Langfuse in UE · servono al caso · solo in locale · responsabile del caso",
  "- 2026-11-10 · Integrazioni · l'accesso c'è già · non chiedere due volte · — · responsabile del caso",
  "",
].join("\n");

const FILES = { "PACCHETTO.md": "# Pacchetto del caso PX-0001 (k1)\n", "BRIEF.md": "# PX-0001 · Caso di prova\n", VERSIONE: "k1 · PX-0001 · 2026-11-09\n" };

test("il comando è registrato e prende --use-case e --from", () => {
  assert.ok((ADMIN_COMMANDS as readonly string[]).includes("factory-import"));
  const parsed = parseAdminOptions(["--workspace", "3f2a9c1e-0000-4000-8000-0000000000a1", "--use-case", "PX-0001", "--from", "../repo/casi/px-0001"], { values: ["use-case", "from"] });
  assert.ok(parsed.ok);
});

test("PROGETTO.md: i 10 argomenti, il framework, gli strumenti nuovi con il perché, la stima, le date", () => {
  const p = parseProjectMarkdown(project());
  assert.equal(p.approvedOn, "2026-11-09");
  assert.equal(p.aiBoardOn, "2026-11-10");
  assert.equal(Object.keys(p.topics).length, 10);
  assert.deepEqual(p.topics.integrazioni, { scelta: "Sistema A in sola lettura", perche: "Meno rischio", alternativa: null });
  assert.equal(p.framework, "codice");
  assert.deepEqual(p.newTools, [{ nome: "Neon", perche: "database del caso" }, { nome: "Langfuse", perche: "tracce" }]);
  assert.equal(p.estimateHours, 40);
  assert.equal(p.monthlyCostEur, 25);
  assert.equal(p.standardVersion, "1.1");
  assert.equal(p.catalogVersion, "1");
  assert.match(p.aiBoardNote ?? "", /approvato \(Neon, Langfuse\)/);
});

test("PROGETTO.md che non va: non approvato, argomento sconosciuto o mancante, strumenti nuovi senza l'ok", () => {
  assert.throws(() => parseProjectMarkdown(project({ stato: "da_approvare" })), AdminStop);
  assert.throws(() => parseProjectMarkdown(project({ rows: ROWS.slice(0, 9) })), /Evals e autonomia/);
  assert.throws(() => parseProjectMarkdown(project({ rows: [...ROWS.slice(0, 9), ["Prezzo", "x", "y", "z"]] })), /Argomento sconosciuto/);
  assert.throws(() => parseProjectMarkdown(project({ aiBoardIl: null })), /ai_board_il/);
  assert.throws(() => parseProjectMarkdown("senza intestazione"), /intestazione/);
});

test("decisioni.md: una riga per decisione, «—» è vuoto, chi ha deciso è il suo ruolo", () => {
  const d = parseDecisions(DECISIONS);
  assert.equal(d.length, 3);
  assert.deepEqual(d[0], { decidedOn: "2026-11-09", topicKey: "funzionalita", topic: "Funzionalità", choice: "smista le richieste", reason: "è il valore", rejected: "anche la risposta", authorRole: "Lateral Space" });
  assert.equal(d[1].topicKey, null);
  assert.equal(d[2].rejected, null);
  assert.equal(d[2].authorRole, "responsabile del caso");
  assert.throws(() => parseDecisions("- 2026-11-09 · solo due · campi"), AdminStop);
});

test("il pacchetto: i tre file o niente", () => {
  assert.deepEqual(packageFromFiles((name) => FILES[name]), FILES);
  assert.throws(() => packageFromFiles((name) => (name === "VERSIONE" ? null : FILES[name])), /VERSIONE/);
});

test("il piano: progetto v1 approvato, k1 importato con la sua impronta, le decisioni; ogni scrittura controlla che lo use case sia vuoto", () => {
  const plan = factoryImportPlan({ workspaceId: "3f2a9c1e-0000-4000-8000-0000000000a1", useCaseId: "3f2a9c1e-0000-4000-8000-0000000000b2", project: parseProjectMarkdown(project()), decisions: parseDecisions(DECISIONS), files: FILES });
  assert.equal(plan.statements.length, 3 + 3);
  assert.match(plan.statements[0].text, /^SELECT uc_require\(NOT EXISTS \(SELECT 1 FROM use_case_projects[\s\S]*use_case_packages[\s\S]*use_case_decisions[\s\S]*'gia_impostato'\)/, "tutto o niente");
  assert.match(plan.statements[1].text, /INSERT INTO use_case_projects[\s\S]*'approvato'[\s\S]*NOT EXISTS \(SELECT 1 FROM use_case_projects/);
  assert.equal(plan.statements[1].params[9], "2026-11-09T11:00:00Z");
  assert.equal(plan.statements[1].params[10], "2026-11-10T11:00:00Z");
  assert.match(plan.statements[2].text, /'importato'/);
  assert.equal(plan.statements[2].params[2], packageFilesHash(FILES));
  for (const s of plan.statements.slice(3)) assert.match(s.text, /'importata', 1,/);
  assert.deepEqual(plan.report.progetto.strumentiNuovi, ["Neon", "Langfuse"]);
  assert.equal(plan.report.argomenti, 10);
  assert.equal(plan.report.decisioni, 3);
  assert.ok(!JSON.stringify(plan.report).includes("@"), "nessuna email nel rapporto");
});

test("i numeri all'italiana, gli strumenti solo se l'AI Board ha approvato, i nomi coperti anche nell'import", () => {
  assert.equal(italianNumber("1.200"), 1200);
  assert.equal(italianNumber("90"), 90);
  assert.equal(italianNumber("1,5"), 1.5);
  assert.equal(italianNumber("12.500,50"), 12500.5);
  const noBoard = parseProjectMarkdown(project().replace("ai_board: approvato (Neon, Langfuse) dal responsabile del caso", "ai_board: non serve (nessuno strumento)"));
  assert.deepEqual(noBoard.newTools, []);
  const named = DECISIONS.replace("smista le richieste · è il valore", "lo ha deciso Mario Rossi · è il valore");
  const plan = factoryImportPlan({
    workspaceId: "3f2a9c1e-0000-4000-8000-0000000000a1",
    useCaseId: "3f2a9c1e-0000-4000-8000-0000000000b2",
    project: parseProjectMarkdown(project()),
    decisions: parseDecisions(named),
    files: { ...FILES, "BRIEF.md": "# PX-0001 · scritto da Mario Rossi (mario@esempio.test)\n" },
    namesToHide: ["Mario Rossi"],
  });
  const all = JSON.stringify(plan.statements.map((s) => s.params));
  assert.ok(!all.includes("Mario") && !all.includes("Rossi") && !all.includes("mario@"), "nessun nome né e-mail");
  assert.ok(all.includes("lo ha deciso una persona"));
});
