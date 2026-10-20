import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  AGENT_NONE,
  AGENT_UNKNOWN,
  buildToolInputSchemas,
  buildToolInputZod,
  CONNECTOR_ERROR_CODES,
  CONNECTOR_ERROR_MESSAGES,
  CONNECTOR_TOOL_NAMES,
  CONTRACT_DESCRIPTION_KEYS,
  connectorError,
  connectorErrorResult,
  connectorResult,
  DEFAULT_CONTRACT_DESCRIPTIONS,
  parseContractProfile,
  SUBMIT_REQUIRED_FIELDS,
  TOOL_OTHER,
  validateFindSimilar,
  validateGetContributionStatus,
  validateGetIntakeGuide,
  validateSubmitContribution,
  warningTexts,
  type ContractProfile,
  type JsonSchema,
  type SubmitValidationContext,
} from "./contract.ts";
import { EXAMPLE_PROFILE, exampleSubmission } from "./contract.fixtures.ts";

// Contratto v2 del connettore (prompt WP3). Profilo e dati sintetici.

const ctx = (overrides: Partial<SubmitValidationContext> = {}): SubmitValidationContext => ({
  profile: EXAMPLE_PROFILE,
  identityMode: "dichiarata",
  esgEnabled: false,
  ...overrides,
});

async function submitError(payload: unknown, overrides: Partial<SubmitValidationContext> = {}) {
  const out = await validateSubmitContribution(payload, ctx(overrides));
  assert.equal(out.ok, false, "payload accettato");
  if (out.ok) throw new Error("unreachable");
  return out.error;
}

function without<T extends object>(value: T, key: keyof T): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  delete copy[key as string];
  return copy;
}

// ─── JSON Schema e zod: stesso contratto ─────────────────────────────────────

const COMPARED_KEYWORDS = [
  "type",
  "const",
  "enum",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "default",
  "format",
  "additionalProperties",
] as const;

/** Parole chiave che contano per la validazione, senza descrizioni né ordine delle chiavi. */
function normalize(node: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  for (const key of COMPARED_KEYWORDS) if (node[key] !== undefined) out[key] = node[key];
  // zod aggiunge un pattern alle email: per il contratto conta `format`.
  if (out.format === "email") delete out.pattern;
  if (Array.isArray(node.required)) out.required = [...(node.required as string[])].sort();
  else if (node.type === "object") out.required = [];
  if (node.properties) {
    out.properties = Object.fromEntries(
      Object.entries(node.properties as Record<string, JsonSchema>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, normalize(v)])
    );
  }
  if (node.items) out.items = normalize(node.items as JsonSchema);
  return out;
}

test("JSON Schema e zod coincidono per ogni tool: obbligatori, limiti, pattern, enum", () => {
  const json = buildToolInputSchemas(EXAMPLE_PROFILE);
  const zod = buildToolInputZod(EXAMPLE_PROFILE);
  assert.deepEqual(Object.keys(json), [...CONNECTOR_TOOL_NAMES]);
  for (const name of CONNECTOR_TOOL_NAMES) {
    const fromZod = z.toJSONSchema(zod[name], { io: "input" }) as JsonSchema;
    assert.deepEqual(normalize(fromZod), normalize(json[name]), name);
  }
});

test("JSON Schema di submit_contribution: obbligatori del contratto, tools unici, «altro» e agenti fittizi in coda", () => {
  const submit = buildToolInputSchemas(EXAMPLE_PROFILE).submit_contribution as {
    required: string[];
    additionalProperties: boolean;
    properties: Record<string, JsonSchema & { items?: JsonSchema }>;
  };
  assert.deepEqual(submit.required, [...SUBMIT_REQUIRED_FIELDS]);
  assert.equal(submit.additionalProperties, false);
  assert.equal(submit.properties.tools.uniqueItems, true);
  assert.deepEqual(submit.properties.tools.items?.enum, [...EXAMPLE_PROFILE.tools, TOOL_OTHER]);
  assert.deepEqual(submit.properties.relatedAgent.enum, [...EXAMPLE_PROFILE.agents, AGENT_NONE, AGENT_UNKNOWN]);
  assert.deepEqual(submit.properties.area.enum, EXAMPLE_PROFILE.areas);
  assert.deepEqual(submit.properties.company.enum, EXAMPLE_PROFILE.companies);
  assert.equal(submit.properties.beneficiaries.maximum, EXAMPLE_PROFILE.beneficiariesMax);
  assert.deepEqual(submit.properties.confirmedByUser, {
    type: "boolean",
    const: true,
    description: DEFAULT_CONTRACT_DESCRIPTIONS["submit_contribution.confirmedByUser"],
  });
  assert.deepEqual(Object.keys(submit.properties).slice(0, 4), ["idempotencyKey", "confirmedByUser", "guideVersion", "contributionKind"]);
});

test("JSON Schema: guida senza parametri, stato con il solo codice, stessa area nei due tool", () => {
  const json = buildToolInputSchemas(EXAMPLE_PROFILE);
  assert.deepEqual(json.get_intake_guide, { type: "object", properties: {}, additionalProperties: false });
  const status = json.get_contribution_status as { properties: Record<string, JsonSchema>; required?: unknown };
  assert.equal(status.required, undefined);
  assert.equal(status.properties.code.pattern, "^[A-Z]{2,4}-[0-9]{4,5}$");
  const find = json.find_similar_contributions as { properties: Record<string, JsonSchema>; required: string[] };
  const submit = json.submit_contribution as { properties: Record<string, JsonSchema> };
  assert.deepEqual(find.required, ["query"]);
  assert.deepEqual(find.properties.area.enum, submit.properties.area.enum);
  assert.equal(find.properties.limit.default, 5);
});

test("JSON Schema: ogni chiave di descrizione è usata, e il profilo può sostituirla", () => {
  const descriptions = Object.fromEntries(CONTRACT_DESCRIPTION_KEYS.map((key, i) => [key, `descrizione ${i}`]));
  const profile: ContractProfile = { ...EXAMPLE_PROFILE, descriptions };
  const found: string[] = [];
  const walk = (tool: string, node: JsonSchema, path: string[]) => {
    if (path.length && typeof node.description === "string") found.push(`${tool}.${path.join(".")}`);
    for (const [k, v] of Object.entries((node.properties ?? {}) as Record<string, JsonSchema>)) walk(tool, v, [...path, k]);
  };
  const built = buildToolInputSchemas(profile);
  for (const name of CONNECTOR_TOOL_NAMES) walk(name, built[name], []);
  assert.deepEqual(found.sort(), [...CONTRACT_DESCRIPTION_KEYS].sort());
  const submit = built.submit_contribution as { properties: Record<string, JsonSchema> };
  assert.equal(submit.properties.title.description, descriptions["submit_contribution.title"]);
  for (const key of CONTRACT_DESCRIPTION_KEYS) assert.ok(DEFAULT_CONTRACT_DESCRIPTIONS[key].length > 0, key);
});

// ─── Profilo ────────────────────────────────────────────────────────────────

test("profilo: valido; rifiuta valori riservati, ripetuti, con caratteri non ammessi o descrizioni sconosciute", () => {
  assert.equal(parseContractProfile(EXAMPLE_PROFILE).ok, true);
  const bad: Array<[string, unknown]> = [
    ["altro negli strumenti", { ...EXAMPLE_PROFILE, tools: ["posta", TOOL_OTHER] }],
    ["nessuno negli agenti", { ...EXAMPLE_PROFILE, agents: [AGENT_NONE] }],
    ["ripetuti", { ...EXAMPLE_PROFILE, areas: ["vendite", "vendite"] }],
    ["maiuscole", { ...EXAMPLE_PROFILE, companies: ["Alfa"] }],
    ["vuoto", { ...EXAMPLE_PROFILE, areas: [] }],
    ["tetto non intero", { ...EXAMPLE_PROFILE, beneficiariesMax: 10.5 }],
    ["descrizione sconosciuta", { ...EXAMPLE_PROFILE, descriptions: { "submit_contribution.nonEsiste": "x" } }],
    ["campo in più", { ...EXAMPLE_PROFILE, extra: true }],
  ];
  for (const [name, profile] of bad) {
    const out = parseContractProfile(profile);
    assert.equal(out.ok, false, name);
    if (!out.ok) assert.ok(Object.keys(out.fieldErrors).length > 0, name);
  }
});

// ─── submit_contribution ────────────────────────────────────────────────────

test("invio valido: ok, testi ripuliti dagli spazi, nessun avviso", async () => {
  const out = await validateSubmitContribution(
    { ...exampleSubmission(), title: "  Riconciliazione automatica delle fatture  " },
    ctx({ currentGuideVersion: "2026-10.1" })
  );
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.data.title, "Riconciliazione automatica delle fatture");
  assert.deepEqual(out.warnings, []);
  assert.equal(out.data.submittedBy?.name, "Persona di prova");
});

test("invalid_payload con fieldErrors per ogni campo sbagliato, mai il testo dell'SDK", async () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["campo obbligatorio mancante", without(exampleSubmission(), "problem"), "problem"],
    ["titolo troppo corto", { ...exampleSubmission(), title: "Ciao" }, "title"],
    ["titolo troppo lungo", { ...exampleSubmission(), title: "x".repeat(121) }, "title"],
    ["conferma falsa", { ...exampleSubmission(), confirmedByUser: false }, "confirmedByUser"],
    ["area fuori enum", { ...exampleSubmission(), area: "magazzino" }, "area"],
    ["società fuori enum", { ...exampleSubmission(), company: "gamma" }, "company"],
    ["strumento fuori enum", { ...exampleSubmission(), tools: ["posta", "fax"] }, "tools.1"],
    ["strumenti ripetuti", { ...exampleSubmission(), tools: ["posta", "posta"] }, "tools"],
    ["nessuno strumento", { ...exampleSubmission(), tools: [] }, "tools"],
    ["persone oltre il tetto", { ...exampleSubmission(), beneficiaries: 51 }, "beneficiaries"],
    ["persone non intere", { ...exampleSubmission(), beneficiaries: 2.5 }, "beneficiaries"],
    ["minuti oltre la giornata", { ...exampleSubmission(), timeSavedMinutesPerRun: 1441 }, "timeSavedMinutesPerRun"],
    ["chiave con spazi", { ...exampleSubmission(), idempotencyKey: "chiave con spazi" }, "idempotencyKey"],
    ["chiave corta", { ...exampleSubmission(), idempotencyKey: "abc" }, "idempotencyKey"],
    ["codice collegato malformato", { ...exampleSubmission(), relatedCode: "xx-12", relationType: "integra" }, "relatedCode"],
    ["punteggio fuori scala", { ...exampleSubmission(), proposerEstimate: { ...exampleSubmission().proposerEstimate, effort: { score: 6, reasoning: "Troppo alto per la scala." } } }, "proposerEstimate.effort.score"],
    ["flag mancante", { ...exampleSubmission(), flags: { personalData: false, safetyRelated: false } }, "flags.outsideFoundation"],
    ["email non valida", { ...exampleSubmission(), submittedBy: { name: "Persona di prova", email: "non-una-email" } }, "submittedBy.email"],
    ["campo non previsto", { ...exampleSubmission(), proponente: "qualcuno" }, "proponente"],
    ["urgenza fuori enum", { ...exampleSubmission(), urgency: "subito" }, "urgency"],
  ];
  for (const [name, payload, field] of cases) {
    const error = await submitError(payload);
    assert.equal(error.error, "invalid_payload", name);
    assert.ok(error.fieldErrors?.[field], `${name}: ${JSON.stringify(error.fieldErrors)}`);
    const result = connectorErrorResult(error);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error, "invalid_payload");
    assert.doesNotMatch(result.content[0].text, /Input validation error/i, name);
  }
});

test("invalid_payload: messaggi in italiano, senza i valori ricevuti", async () => {
  const marker = "VALORE-RISERVATO-123";
  const error = await submitError({
    ...exampleSubmission(),
    title: `${marker} ${"x".repeat(200)}`,
    area: marker,
    tools: [marker],
    [marker.toLowerCase()]: marker,
  });
  const text = JSON.stringify(error);
  assert.equal(text.includes(marker), false, text);
  assert.equal(error.fieldErrors?.title, "Al massimo 120 caratteri.");
  assert.match(error.fieldErrors?.area ?? "", /^Valore non ammesso\. Valori ammessi: amministrazione, /);
  assert.equal(error.fieldErrors?.["valore-riservato-123"], "Campo non previsto dal contratto.");
  assert.equal((await submitError(without(exampleSubmission(), "title"))).fieldErrors?.title, "Campo obbligatorio.");
  assert.equal((await submitError({ ...exampleSubmission(), confirmedByUser: false })).fieldErrors?.confirmedByUser, "Deve essere true.");
});

test("guida del workspace: un valore che la guida non contiene dà invalid_payload sul campo", async () => {
  const guide = { areas: ["vendite"], companies: ["beta"], tools: ["posta"], agents: ["boreale"], contributionKinds: ["best_practice"] };
  const error = await submitError(
    { ...exampleSubmission(), tools: ["posta", "gestionale"], relatedAgent: "atlante" },
    { guide }
  );
  assert.equal(error.error, "invalid_payload");
  assert.deepEqual(Object.keys(error.fieldErrors ?? {}).sort(), ["area", "company", "contributionKind", "relatedAgent", "tools"]);
  const ok = await validateSubmitContribution(
    {
      ...exampleSubmission(),
      contributionKind: "best_practice",
      area: "vendite",
      company: "beta",
      tools: ["posta", TOOL_OTHER],
      toolsOther: "Calendario condiviso",
      relatedAgent: AGENT_UNKNOWN,
    },
    ctx({ guide })
  );
  assert.equal(ok.ok, true, "«altro» e «non_so» restano ammessi");
  assert.equal((await validateSubmitContribution(exampleSubmission(), ctx({ guide: {} }))).ok, true, "guida senza elenchi");
});

test("«altro» senza toolsOther: errore sul campo toolsOther", async () => {
  for (const toolsOther of [undefined, "   "]) {
    const error = await submitError({ ...exampleSubmission(), tools: ["posta", TOOL_OTHER], toolsOther });
    assert.equal(error.error, "invalid_payload");
    assert.ok(error.fieldErrors?.toolsOther);
  }
});

test("regole incrociate: un codice d'errore per ogni regola", async () => {
  assert.equal((await submitError(without(exampleSubmission(), "guardrails"))).error, "missing_guardrails");
  assert.equal(
    (await validateSubmitContribution(without(exampleSubmission({ contributionKind: "best_practice" }), "guardrails"), ctx())).ok,
    true,
    "best practice senza guardrails"
  );
  const noMeasure = without(exampleSubmission(), "timeSavedMinutesPerRun");
  const missingMeasure = await submitError(noMeasure);
  assert.equal(missingMeasure.error, "missing_impact_measure");
  assert.deepEqual(Object.keys(missingMeasure.fieldErrors ?? {}), ["timeSavedMinutesPerRun", "valuePerRunEur", "qualityGain"]);
  for (const measure of [{ timeSavedMinutesPerRun: 0 }, { valuePerRunEur: 15 }, { qualityGain: "invariata" }]) {
    assert.equal((await validateSubmitContribution({ ...noMeasure, ...measure }, ctx())).ok, true, JSON.stringify(measure));
  }
  assert.equal((await submitError(without(exampleSubmission(), "submittedBy"))).error, "missing_submitter");
  assert.equal((await submitError(exampleSubmission(), { esgEnabled: true })).error, "missing_esg");
  assert.equal(
    (await validateSubmitContribution(exampleSubmission({ sustainabilityImpact: "Meno carta stampata ogni mese." }), ctx({ esgEnabled: true }))).ok,
    true
  );
  assert.equal((await submitError(exampleSubmission({ relatedCode: "XX-0007" }))).error, "missing_relation_type");
});

test("unknown_related_code: il codice si cerca nel workspace solo quando c'è e ha il suo tipo di relazione", async () => {
  const asked: string[] = [];
  const exists = async (code: string) => {
    asked.push(code);
    return code === "XX-0007";
  };
  const error = await submitError(exampleSubmission({ relatedCode: "XX-0099", relationType: "integra" }), { relatedCodeExists: exists });
  assert.equal(error.error, "unknown_related_code");
  assert.ok(error.fieldErrors?.relatedCode);
  const ok = await validateSubmitContribution(
    exampleSubmission({ relatedCode: "XX-0007", relationType: "simile_ma_diversa" }),
    ctx({ relatedCodeExists: exists })
  );
  assert.equal(ok.ok, true);
  await validateSubmitContribution(exampleSubmission(), ctx({ relatedCodeExists: exists }));
  assert.deepEqual(asked, ["XX-0099", "XX-0007"]);
});

test("identità verificata: submittedBy non serve e, se c'è, si ignora", async () => {
  const absent = await validateSubmitContribution(without(exampleSubmission(), "submittedBy"), ctx({ identityMode: "verificata" }));
  assert.equal(absent.ok, true);
  const present = await validateSubmitContribution(exampleSubmission(), ctx({ identityMode: "verificata" }));
  assert.equal(present.ok, true);
  if (present.ok) assert.equal(present.data.submittedBy, undefined);
});

test("guide_outdated: avviso, l'invio non si blocca", async () => {
  const out = await validateSubmitContribution(exampleSubmission(), ctx({ currentGuideVersion: "2026-11.1" }));
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(out.warnings.map((w) => w.code), ["guide_outdated"]);
  assert.equal(warningTexts(out.warnings).length, 1);
  const same = await validateSubmitContribution(exampleSubmission(), ctx({ currentGuideVersion: "2026-10.1" }));
  assert.equal(same.ok && same.warnings.length, 0);
});

// ─── Altri tool ─────────────────────────────────────────────────────────────

test("get_intake_guide: nessun parametro; argomenti assenti ammessi, campi in più no", () => {
  assert.equal(validateGetIntakeGuide(undefined).ok, true);
  assert.equal(validateGetIntakeGuide({}).ok, true);
  const out = validateGetIntakeGuide({ workspace: "altro" });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.error.error, "invalid_payload");
});

test("find_similar_contributions: limite predefinito 5, query e area controllate", () => {
  const ok = validateFindSimilar({ query: "fatture fornitori" }, { profile: EXAMPLE_PROFILE });
  assert.deepEqual(ok, { ok: true, data: { query: "fatture fornitori", limit: 5 } });
  const bad: Array<[unknown, string]> = [
    [{ query: "ab" }, "query"],
    [{ query: "x".repeat(201) }, "query"],
    [{ query: "fatture", area: "magazzino" }, "area"],
    [{ query: "fatture", limit: 11 }, "limit"],
    [{ query: "fatture", kind: "idea" }, "kind"],
    [{ query: "fatture", autore: "qualcuno" }, "autore"],
    [{}, "query"],
  ];
  for (const [input, field] of bad) {
    const out = validateFindSimilar(input, { profile: EXAMPLE_PROFILE });
    assert.equal(out.ok, false, JSON.stringify(input));
    if (!out.ok) {
      assert.equal(out.error.error, "invalid_payload");
      assert.ok(out.error.fieldErrors?.[field], JSON.stringify(out.error.fieldErrors));
    }
  }
  const guided = validateFindSimilar({ query: "fatture", area: "operazioni" }, { profile: EXAMPLE_PROFILE, guide: { areas: ["vendite"] } });
  assert.equal(guided.ok, false);
  if (!guided.ok) assert.ok(guided.error.fieldErrors?.area);
});

test("get_contribution_status: codice nel formato del contratto; senza codice in fase 1 identity_required", () => {
  assert.deepEqual(validateGetContributionStatus({ code: "XX-0012" }, { identityMode: "dichiarata" }), {
    ok: true,
    data: { code: "XX-0012" },
  });
  for (const code of ["xx-0012", "XX-12", "XX-123456", "XXXXX-0012", " XX-0012"]) {
    const out = validateGetContributionStatus({ code }, { identityMode: "dichiarata" });
    assert.equal(out.ok, false, code);
    if (!out.ok) assert.equal(out.error.error, "invalid_payload");
  }
  const none = validateGetContributionStatus({}, { identityMode: "dichiarata" });
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.error.error, "identity_required");
  assert.deepEqual(validateGetContributionStatus(undefined, { identityMode: "verificata" }), { ok: true, data: {} });
});

// ─── Formato degli errori ───────────────────────────────────────────────────

test("formato degli errori: uguale per tutti i codici, con structuredContent ripetuto come testo JSON", () => {
  assert.equal(new Set(CONNECTOR_ERROR_CODES).size, CONNECTOR_ERROR_CODES.length);
  for (const code of CONNECTOR_ERROR_CODES) {
    const error = connectorError(code);
    assert.deepEqual(Object.keys(error), ["error", "message"]);
    assert.ok(CONNECTOR_ERROR_MESSAGES[code].length > 10, code);
    const result = connectorErrorResult(error);
    assert.equal(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  }
  const limited = connectorError("rate_limited", { retryAfterSeconds: 12.2 });
  assert.equal(limited.retryAfterSeconds, 13);
  assert.equal(connectorError("rate_limited", { retryAfterSeconds: 0 }).retryAfterSeconds, 1);
  assert.equal(connectorError("rate_limited", { retryAfterSeconds: Number.NaN }).retryAfterSeconds, 1);
  assert.equal(connectorError("invalid_payload", { fieldErrors: {} }).fieldErrors, undefined);
  const ok = connectorResult({ ok: true, code: "XX-0012" });
  assert.equal(ok.isError, undefined);
  assert.equal(ok.content[0].text, JSON.stringify(ok.structuredContent));
});
