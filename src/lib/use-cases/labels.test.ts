import test from "node:test";
import assert from "node:assert/strict";
import * as labels from "./labels.ts";
import {
  ARCHIVE_REASON_LABEL,
  channelLabel,
  COST_SOURCE_LABEL,
  COST_SOURCES,
  EVENT_FIELDS,
  KIND_LABEL,
  kindOf,
  NOT_ESTIMATED_LABEL,
  ORIGIN_LABEL,
  portfolioKindOf,
  RISK_LABEL,
  VALUE_EUR_SOURCE_LABEL,
  VALUE_SOURCE_LABEL,
  VALUE_WORD_LABEL,
  WHAT_FIELD_LABEL,
  ZONE_HINT,
  ZONE_LABEL,
  ZONES,
} from "./labels.ts";
import { ARCHIVE_REASONS, KINDS, ORIGINS } from "./types.ts";

// Vocabolario dell'area: docs/use-case/DESIGN.md §3.2, §3.3, §4.7, §6.2, §7.1-7.4, §10.3, §14.3.

test("origine (§3.2): etichetta lunga, chip con il testo, colore del punto", () => {
  assert.deepEqual(Object.keys(ORIGIN_LABEL), [...ORIGINS]);
  assert.deepEqual(ORIGIN_LABEL.adoption, { long: "AI Adoption · dal basso", chip: "AI Adoption", color: "teal" });
  assert.deepEqual(ORIGIN_LABEL.transformation, { long: "AI Transformation · dall'alto", chip: "AI Transformation", color: "indigo" });
});

test("tipo (§3.3): best_practice è «Da diffondere», use_case_ai e NULL «Da costruire»", () => {
  assert.deepEqual(Object.keys(KIND_LABEL), [...KINDS]);
  assert.deepEqual(KIND_LABEL.da_costruire, { label: "Da costruire", icon: "Hammer" });
  assert.deepEqual(KIND_LABEL.da_diffondere, { label: "Da diffondere", icon: "Megaphone" });
  assert.equal(kindOf("best_practice"), "da_diffondere");
  assert.equal(kindOf("use_case_ai"), "da_costruire");
  assert.equal(kindOf(null), "da_costruire", "righe vecchie di Activity mapping");
  assert.equal(kindOf(undefined), "da_costruire");
  assert.equal(portfolioKindOf("da_diffondere"), "best_practice");
  assert.equal(portfolioKindOf("da_costruire"), "use_case_ai");
});

test("Valore (§7.1): Alto, Medio, Basso; fonti «team», «AI», «da stimare»; euro dal dossier o del team", () => {
  assert.deepEqual(VALUE_WORD_LABEL, { alto: "Alto", medio: "Medio", basso: "Basso" });
  assert.deepEqual(VALUE_SOURCE_LABEL, { team: "team", ai: "AI" });
  assert.equal(NOT_ESTIMATED_LABEL, "da stimare");
  assert.deepEqual(VALUE_EUR_SOURCE_LABEL.dossier, { short: "dossier", long: "dal dossier" });
});

test("costo (§7.2): fonti corte e lunghe, nell'ordine in cui vincono; mai «da dossier»", () => {
  assert.deepEqual(COST_SOURCES, ["dossier", "stima", "team_importo", "team_fascia", "sforzo"]);
  assert.deepEqual(COST_SOURCE_LABEL, {
    dossier: { short: "dossier", long: "dal dossier" },
    stima: { short: "team", long: "stima del team" },
    team_importo: { short: "team", long: "importo del team" },
    team_fascia: { short: "team", long: "fascia del team" },
    sforzo: { short: "stimato", long: "stimato dall'impegno" },
  });
  const all = JSON.stringify(labels);
  assert.doesNotMatch(all, /da dossier/);
});

test("zone (§7.4) e rischio (§7.3)", () => {
  assert.deepEqual(ZONES, ["subito", "da_pianificare", "se_avanza_tempo", "non_ora"]);
  assert.deepEqual(Object.values(ZONE_LABEL), ["Subito", "Da pianificare", "Se avanza tempo", "Non ora"]);
  assert.equal(ZONE_HINT, "Le zone sono un suggerimento, non la decisione.");
  assert.deepEqual(RISK_LABEL, { ai_board: "Serve decisione AI Board", dati_personali: "Dati personali", sicurezza: "Sicurezza" });
});

test("motivi di «Archivia» come nel dialogo (§14.3)", () => {
  assert.deepEqual(Object.keys(ARCHIVE_REASON_LABEL), [...ARCHIVE_REASONS]);
  assert.deepEqual(Object.values(ARCHIVE_REASON_LABEL), ["Superato da altro", "Ritirato da chi l'ha proposto", "Fuori dal perimetro", "Altro motivo"]);
});

test("canale da source (§4.7)", () => {
  const expected: Array<[string | null, string]> = [
    ["claude_connector", "Claude (connettore)"],
    ["claude_mcp", "Claude (MCP v1)"],
    ["slack_proposed", "Slack"],
    ["web_proposed", "Modulo web"],
    ["ai_readiness_assessment", "AI Readiness"],
    ["learning", "Corsi"],
    ["activity_mapping", "Activity mapping"],
    [null, "Activity mapping"],
    ["manual", "A mano"],
    ["team_mcp", "MCP del team"],
  ];
  for (const [source, label] of expected) assert.equal(channelLabel(source), label, String(source));
  assert.equal(channelLabel("toString"), "Altro");
  assert.equal(channelLabel("sconosciuto"), "Altro");
});

test("campi di «Cosa è» per tipo (§6.2)", () => {
  const byKind = (kind: "da_costruire" | "da_diffondere") =>
    Object.fromEntries(Object.entries(WHAT_FIELD_LABEL).map(([field, label]) => [field, label[kind]]));
  assert.deepEqual(byKind("da_costruire"), {
    title: "Titolo",
    description: "Problema",
    flowDescription: "Come funziona",
    humanInTheLoop: "Chi controlla",
    guardrails: "Limiti",
    businessCase: "Impatto atteso",
    dataRequirements: "Dati",
    area: "Area",
    aiLab: "AI Lab",
    sustainabilityImpact: "Impatto ambientale e sociale",
  });
  assert.deepEqual(byKind("da_diffondere"), {
    title: "Titolo",
    description: "Prima",
    flowDescription: "Adesso",
    humanInTheLoop: "Chi la usa",
    guardrails: null,
    businessCase: "Risultato",
    dataRequirements: "Cosa serve per copiarla",
    area: "Area",
    aiLab: "AI Lab",
    sustainabilityImpact: "Impatto ambientale e sociale",
  });
});

test("campi della Storia: lo stesso elenco del CHECK di use_case_events (§10.3)", () => {
  assert.deepEqual(EVENT_FIELDS, [
    "titolo",
    "problema",
    "come_funziona",
    "chi_controlla",
    "limiti",
    "impatto_atteso",
    "dati",
    "area",
    "ai_lab",
    "origine",
    "tipo",
    "nota_pubblica",
    "valore",
    "costo",
    "kpi",
    "quando",
    "revisione",
    "visibilita",
    "possibile_doppione",
    "intake",
  ]);
});

test("nessun testo usa le parole vietate dell'area (§14.5)", () => {
  const texts: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string") texts.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(Object.fromEntries(Object.entries(labels).filter(([name]) => name.endsWith("_LABEL") || name.endsWith("_HINT"))));
  collect([...[null, "manual", "team_mcp", "claude_mcp", "claude_connector"].map((s) => channelLabel(s))]);
  assert.ok(texts.length > 40);
  const forbidden = /caso d'uso|raccolta (&|e) ranking|quick win|strategic bet|capability builder|not yet|\bwave\b|\beffort\b|\bimpact\b|\bfeasibility\b/i;
  for (const text of texts) assert.doesNotMatch(text, forbidden, text);
});
