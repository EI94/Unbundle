import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_NONE, CONTRIBUTION_KINDS, FREQUENCIES, QUALITY_GAINS, type ContractProfile } from "./contract.ts";
import { EXAMPLE_PROFILE } from "./contract.fixtures.ts";
import { GUIDE_MAX_CHARS, GUIDE_RUNS_PER_YEAR, guideProfileMismatches, parseConnectorGuide, type ConnectorGuide } from "./guide-schema.ts";
import { matchingAgents } from "./matching-agents.ts";
import { CONNECTOR_STATUS_PRECEDENCE } from "./status.ts";
import { guideRestrictions, intakeGuideOutput } from "./tools.ts";

// Schema della guida (prompt WP8, K8) sulla guida d'esempio sintetica
// `docs/connettore/guida-esempio.json`: nessun dato di un cliente.

const EXAMPLE_GUIDE_FILE = new URL("../../../docs/connettore/guida-esempio.json", import.meta.url);
const raw = () => JSON.parse(readFileSync(EXAMPLE_GUIDE_FILE, "utf8")) as Record<string, unknown>;

function parsedExample(): ConnectorGuide {
  const parsed = parseConnectorGuide(raw());
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.problems.join("\n"));
  return parsed.guide;
}

/** Una copia della guida d'esempio con una modifica. */
function variant(change: (guide: ConnectorGuide) => void): Record<string, unknown> {
  const copy = raw();
  change(copy as unknown as ConnectorGuide);
  return copy;
}

/** La guida come oggetto qualsiasi, per le modifiche che il tipo non ammette. */
const loose = (value: object) => value as Record<string, unknown>;
const looseList = (list: unknown) => list as Array<Record<string, unknown>>;

function problemsOf(input: unknown): string[] {
  const parsed = parseConnectorGuide(input);
  assert.equal(parsed.ok, false, "la guida doveva essere rifiutata");
  return parsed.ok ? [] : parsed.problems;
}

test("guida d'esempio: valida, sotto 20.000 caratteri nella risposta di get_intake_guide", () => {
  const parsed = parseConnectorGuide(raw());
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.problems.join("\n"));
  if (!parsed.ok) return;
  assert.ok(parsed.servedChars < GUIDE_MAX_CHARS, String(parsed.servedChars));
  const served = intakeGuideOutput({ guide: parsed.guide as unknown as Record<string, unknown>, guideVersion: parsed.guide.guideVersion, identityMode: "verificata" });
  assert.equal(JSON.stringify(served).length, parsed.servedChars);
  assert.deepEqual(Object.keys(served).slice(0, 2), ["guideVersion", "identityMode"]);
});

test("guida d'esempio: aree, società, strumenti e agenti sono un sottoinsieme degli enum del contratto sintetico", () => {
  const guide = parsedExample();
  assert.deepEqual(guideProfileMismatches(guide, EXAMPLE_PROFILE), []);
  for (const area of guide.areas) assert.ok(EXAMPLE_PROFILE.areas.includes(area.id), area.id);
  for (const company of guide.workspace.società) assert.ok(EXAMPLE_PROFILE.companies.includes(company), company);
  for (const tool of guide.tools) assert.ok([...EXAMPLE_PROFILE.tools, "altro"].includes(tool.id), tool.id);
  for (const agent of guide.agentCatalog) assert.ok(EXAMPLE_PROFILE.agents.includes(agent.id), agent.id);
  assert.equal(guide.beneficiaryCap, EXAMPLE_PROFILE.beneficiariesMax);
});

test("guida d'esempio: la rotta ne legge le restrizioni e gli agenti con le parole chiave", () => {
  const guide = parsedExample() as unknown as Record<string, unknown>;
  const restrictions = guideRestrictions(guide);
  assert.deepEqual(restrictions?.areas, EXAMPLE_PROFILE.areas);
  assert.deepEqual(restrictions?.companies, EXAMPLE_PROFILE.companies);
  assert.deepEqual(restrictions?.contributionKinds, [...CONTRIBUTION_KINDS]);
  assert.deepEqual(matchingAgents("promemoria per i documenti in scadenza", guide), [
    { id: "boreale", nome: "BOREALE", sistema: "Sistema Beta", cosaFa: "Controlla le scadenze dei documenti" },
  ]);
});

test("valori fissi del contratto: frequenze con 220, 50, 12, 4, 1 esecuzioni l'anno, in ordine", () => {
  assert.deepEqual(Object.values(GUIDE_RUNS_PER_YEAR), [220, 50, 12, 4, 1]);
  assert.deepEqual(Object.keys(GUIDE_RUNS_PER_YEAR), [...FREQUENCIES]);
  assert.match(problemsOf(variant((g) => (g.frequencies[0].esecuzioniAnno = 250))).join(" "), /frequencies\.0\.esecuzioniAnno: Per giornaliera le esecuzioni l'anno sono 220/);
  assert.match(problemsOf(variant((g) => g.frequencies.reverse())).join(" "), /frequencies\.0\.id/);
  assert.match(problemsOf(variant((g) => g.frequencies.pop())).join(" "), /frequencies/);
});

test("rubrica: cinque livelli in ordine, qualità del contratto per livello, semaforo verde-giallo-rosso", () => {
  const guide = parsedExample();
  assert.deepEqual(guide.rubric.efficiency.livelli.map((l) => l.qualita), [...QUALITY_GAINS]);
  assert.match(problemsOf(variant((g) => (g.rubric.efficiency.livelli[1].score = 3))).join(" "), /rubric\.efficiency\.livelli\.1\.score/);
  assert.match(problemsOf(variant((g) => (g.rubric.efficiency.livelli[0].qualita = "lieve"))).join(" "), /qualità è invariata/);
  assert.match(problemsOf(variant((g) => g.rubric.effort.livelli.pop())).join(" "), /rubric\.effort\.livelli/);
  assert.match(problemsOf(variant((g) => g.rubric.impactFlag.logica.reverse())).join(" "), /rubric\.impactFlag\.logica\.0\.value/);
  assert.match(problemsOf(variant((g) => delete loose(g.rubric).calibrazione)).join(" "), /rubric\.calibrazione/);
});

test("legenda degli stati: i 12 stati del contratto, una volta ciascuno, con le etichette dei tool", () => {
  const guide = parsedExample();
  assert.deepEqual(guide.statusLegend.map((s) => s.code).sort(), [...CONNECTOR_STATUS_PRECEDENCE].sort());
  assert.match(problemsOf(variant((g) => g.statusLegend.pop())).join(" "), /statusLegend/);
  assert.match(problemsOf(variant((g) => (g.statusLegend[1].code = "RICEVUTA"))).join(" "), /Stato ripetuto/);
  assert.match(problemsOf(variant((g) => (g.statusLegend[0].label = "Arrivata"))).join(" "), /statusLegend\.0\.label/);
  assert.match(problemsOf(variant((g) => (g.statusLegend[10].label = "Doppione"))).join(" "), /statusLegend\.10\.label/);
});

test("catalogo degli agenti: id unici, parole chiave obbligatorie, «nessuno» e «non_so» riservati", () => {
  assert.match(problemsOf(variant((g) => (g.agentCatalog[0].keywords = []))).join(" "), /agentCatalog\.0\.keywords/);
  assert.match(problemsOf(variant((g) => delete looseList(g.agentCatalog)[0].keywords)).join(" "), /agentCatalog\.0\.keywords/);
  assert.match(problemsOf(variant((g) => (g.agentCatalog[1].id = "atlante"))).join(" "), /Agente ripetuto/);
  assert.match(problemsOf(variant((g) => (g.agentCatalog[1].id = AGENT_NONE))).join(" "), /riservato dal contratto/);
  assert.match(problemsOf(variant((g) => (g.agentCatalog[0].keywords = ["x".repeat(81)]))).join(" "), /agentCatalog\.0\.keywords\.0/);
});

test("forma: campi obbligatori, niente campi in più, niente identityMode (lo mette la rotta), id validi", () => {
  for (const key of ["guideVersion", "workspace", "areas", "tools", "contributionKinds", "fields", "frequencies", "beneficiaryCap", "rubric", "privacyRules", "perimeterRules", "agentCatalog", "statusLegend", "dialogProtocol", "summaryTemplate"]) {
    assert.ok(problemsOf(variant((g) => delete loose(g)[key])).some((p) => p.startsWith(key)), key);
  }
  assert.match(problemsOf(variant((g) => (loose(g).identityMode = "dichiarata"))).join(" "), /campi non previsti: identityMode/);
  assert.match(problemsOf(variant((g) => (g.areas[0].id = "Area Con Spazi"))).join(" "), /areas\.0\.id: formato non valido/);
  assert.match(problemsOf(variant((g) => (g.guideVersion = "x".repeat(21)))).join(" "), /guideVersion/);
  assert.match(problemsOf(variant((g) => g.contributionKinds.push({ ...g.contributionKinds[0] }))).join(" "), /contributionKinds/);
  assert.match(problemsOf(variant((g) => (looseList(g.contributionKinds)[0].id = "idea"))).join(" "), /contributionKinds\.0\.id/);
  for (const input of [null, [], "guida", 3]) assert.equal(parseConnectorGuide(input).ok, false);
});

test("dimensione: una guida che porta la risposta oltre 20.000 caratteri non passa", () => {
  const big = variant((g) => {
    g.privacyRules = Array.from({ length: 20 }, (_, i) => `${i} ${"regola ".repeat(55)}`.slice(0, 400));
    g.perimeterRules = Array.from({ length: 20 }, (_, i) => `${i} ${"regola ".repeat(55)}`.slice(0, 400));
    g.dialogProtocol = "passo ".repeat(990);
  });
  const problems = problemsOf(big);
  assert.match(problems.join(" "), /oltre 20000/);
});

test("coerenza con il profilo: valori fuori dal contratto, tetto delle persone, campi di submit_contribution", () => {
  const guide = parsedExample();
  const narrower: ContractProfile = { ...EXAMPLE_PROFILE, areas: ["amministrazione", "vendite"], agents: ["atlante"], beneficiariesMax: 40 };
  const problems = guideProfileMismatches(guide, narrower);
  assert.ok(problems.some((p) => p.startsWith("areas:") && p.includes("operazioni") && p.includes("persone")), problems.join("\n"));
  assert.ok(problems.some((p) => p.startsWith("agentCatalog:") && p.includes("boreale")));
  assert.ok(problems.some((p) => p.startsWith("beneficiaryCap: 50")));
  assert.ok(problems.some((p) => p.startsWith("fields.beneficiaries: max è 40")));

  const fields = (patch: Record<string, unknown>) =>
    guideProfileMismatches({ ...guide, fields: [{ name: "title", required: true, help: "Titolo." , ...patch } as ConnectorGuide["fields"][number]] }, EXAMPLE_PROFILE);
  assert.deepEqual(fields({}), []);
  assert.deepEqual(fields({ min: 5, max: 120 }), []);
  assert.match(fields({ required: false }).join(" "), /fields\.title: required è true/);
  assert.match(fields({ max: 100 }).join(" "), /fields\.title: max è 120/);
  assert.match(fields({ name: "titolo" }).join(" "), /fields\.titolo: campo che submit_contribution non ha/);
  // Nomi ereditati dagli oggetti di JavaScript non sono campi del tool, nemmeno annidati.
  for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__", "submittedBy.constructor", "flags.valueOf"]) {
    assert.match(fields({ name, required: false }).join(" "), /campo che submit_contribution non ha/, name);
  }
  const inherited = parseConnectorGuide({ ...raw(), fields: [...(raw().fields as unknown[]), { name: "constructor", required: false, help: "Campo inesistente." }] });
  assert.equal(inherited.ok, true, "il nome ha la forma di un campo: lo ferma il confronto con il profilo");
  if (inherited.ok) assert.deepEqual(guideProfileMismatches(inherited.guide, EXAMPLE_PROFILE), ["fields.constructor: campo che submit_contribution non ha."]);
  assert.match(fields({ values: ["a"] }).join(" "), /fields\.title: il contratto non ha un elenco di valori/);
  const enumField = guideProfileMismatches(
    { ...guide, fields: [{ name: "frequency", required: true, values: ["giornaliera", "oraria"], help: "Frequenza." }] },
    EXAMPLE_PROFILE
  );
  assert.match(enumField.join(" "), /fields\.frequency\.values: valori fuori dal contratto \(oraria\)/);
  // Campi annidati: obbligatorietà dal loro oggetto.
  assert.deepEqual(
    guideProfileMismatches({ ...guide, fields: [{ name: "proposerEstimate.efficiency.reasoning", required: true, min: 10, max: 600, help: "Calcolo." }] }, EXAMPLE_PROFILE),
    []
  );
  assert.deepEqual(
    guideProfileMismatches({ ...guide, fields: [{ name: "submittedBy.email", required: false, max: 255, help: "Facoltativa." }] }, EXAMPLE_PROFILE),
    []
  );
});
