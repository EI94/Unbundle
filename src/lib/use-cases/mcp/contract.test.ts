import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbidden } from "../copy-guard.ts";
import {
  READ_ONLY_TOKEN_MESSAGE,
  TEAM_MCP_ERROR_MESSAGES,
  TEAM_MCP_INPUT_SCHEMAS,
  TEAM_MCP_SERVER_INFO,
  TEAM_MCP_TOOL_ANNOTATIONS,
  TEAM_MCP_TOOL_NAMES,
  TEAM_MCP_TOOL_TEXT,
  isTeamWriteTool,
  teamError,
  teamErrorResult,
  teamRequestHash,
  teamResult,
  teamToolDefinitions,
  validateTeamToolInput,
} from "./contract.ts";

// Contratto del MCP del team (docs/use-case/DESIGN.md §9.4, §12.5 test 5).

const key = "registra-ai-lab-0001";

test("tools/list: esattamente 6 tool, nell'ordine, con titolo, descrizione, schema e annotazioni; nessun outputSchema", () => {
  const defs = teamToolDefinitions();
  assert.deepEqual(
    defs.map((d) => d.name),
    ["search_use_cases", "get_use_case", "create_use_cases", "update_use_case", "decide_use_case", "set_priority"],
  );
  for (const def of defs) {
    assert.ok(def.title.length > 0 && def.description.length > 0, def.name);
    assert.equal(def.inputSchema.type, "object", def.name);
    assert.equal(def.inputSchema.additionalProperties, false, `${def.name}: schema stretto`);
    assert.equal("$schema" in def.inputSchema, false);
    assert.equal("outputSchema" in def, false);
    assert.deepEqual(def.annotations, TEAM_MCP_TOOL_ANNOTATIONS[def.name]);
  }
  assert.equal(teamToolDefinitions(), defs, "le definizioni si costruiscono una volta");
  assert.deepEqual(TEAM_MCP_SERVER_INFO, { name: "unbundle-use-case", title: "Unbundle Use case", version: "1.0.0" });
});

test("nessun tool per cancellare, avviare, segnare come in realizzazione, oscurare o cambiare le impostazioni", () => {
  const names = TEAM_MCP_TOOL_NAMES.join(" ");
  for (const word of ["delete", "cancel", "remove", "avvia", "start", "realizzazione", "oscura", "redact", "setting", "impostazioni"]) {
    assert.equal(names.includes(word), false, word);
  }
  const decision = JSON.stringify(teamToolDefinitions().find((d) => d.name === "decide_use_case")!.inputSchema);
  for (const forbidden of ["segna_in_realizzazione", "avvia", "oscura", "cancella"]) assert.equal(decision.includes(`"${forbidden}"`), false, forbidden);
  const rejected = validateTeamToolInput("decide_use_case", {
    code: "XX-0012",
    expectedVersion: 2,
    decision: { type: "segna_in_realizzazione" },
    idempotencyKey: key,
    confirmedByUser: true,
  });
  assert.equal(rejected.ok, false);
});

test("annotazioni: due letture, quattro scritture idempotenti, nessuna distruttiva né aperta al mondo", () => {
  for (const name of TEAM_MCP_TOOL_NAMES) {
    const a = TEAM_MCP_TOOL_ANNOTATIONS[name];
    assert.equal(a.readOnlyHint, !isTeamWriteTool(name), name);
    assert.equal(a.destructiveHint, false, name);
    assert.equal(a.idempotentHint, true, name);
    assert.equal(a.openWorldHint, false, name);
  }
});

test("le scritture vogliono confirmedByUser true e un idempotencyKey di 8-128 caratteri", () => {
  for (const name of ["create_use_cases", "update_use_case", "decide_use_case", "set_priority"] as const) {
    const schema = teamToolDefinitions().find((d) => d.name === name)!.inputSchema as { required: string[]; properties: Record<string, Record<string, unknown>> };
    assert.ok(schema.required.includes("confirmedByUser") && schema.required.includes("idempotencyKey"), name);
    assert.equal(schema.properties.confirmedByUser.const, true, name);
    assert.equal(schema.properties.idempotencyKey.minLength, 8, name);
    assert.equal(schema.properties.idempotencyKey.maxLength, 128, name);
  }
  const missing = validateTeamToolInput("set_priority", { code: "XX-0012", expectedVersion: 3, quando: "piu_avanti", idempotencyKey: "corta", confirmedByUser: false });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.error.error, "invalid_payload");
    assert.deepEqual(missing.error.fieldErrors, { idempotencyKey: "Almeno 8 caratteri.", confirmedByUser: "Deve essere true." });
  }
});

test("search_use_cases: limiti di §9.4 e nessun filtro fuori elenco (nemmeno sulla persona)", () => {
  assert.equal(validateTeamToolInput("search_use_cases", {}).ok, true);
  const ok = validateTeamToolInput("search_use_cases", { query: " fatture ", fase: "approvato", trimestre: "2027-Q1", limit: 50, canale: "team_mcp" });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.data.query, "fatture");
  for (const bad of [{ query: "x" }, { query: "x".repeat(201) }, { limit: 0 }, { limit: 51 }, { trimestre: "2027-Q5" }, { fase: "nuova" }]) {
    assert.equal(validateTeamToolInput("search_use_cases", bad).ok, false, JSON.stringify(bad).slice(0, 40));
  }
  for (const person of ["proponente", "proposedBy", "autore", "persona", "submitterEmail", "email"]) {
    const result = validateTeamToolInput("search_use_cases", { [person]: "chiunque" });
    assert.equal(result.ok, false, person);
    if (!result.ok) assert.equal(result.error.fieldErrors?.[person], "Campo non previsto dal contratto.");
  }
});

test("create_use_cases: 1-25 schede, titolo 3-200, problema 3-2.000, tipo e origine dall'elenco", () => {
  const item = { title: "Smistamento richieste", problem: "Le richieste arrivano in una casella sola." };
  assert.ok(validateTeamToolInput("create_use_cases", { items: [item], idempotencyKey: key, confirmedByUser: true }).ok);
  const errors = (input: unknown) => {
    const result = validateTeamToolInput("create_use_cases", input);
    return result.ok ? null : result.error.fieldErrors;
  };
  assert.deepEqual(errors({ items: [], idempotencyKey: key, confirmedByUser: true }), { items: "Almeno 1 valori." });
  assert.ok(errors({ items: Array.from({ length: 26 }, () => item), idempotencyKey: key, confirmedByUser: true })?.items);
  assert.ok(errors({ items: [{ ...item, title: "ab" }], idempotencyKey: key, confirmedByUser: true })?.["items.0.title"]);
  assert.ok(errors({ items: [{ ...item, problem: "x".repeat(2001) }], idempotencyKey: key, confirmedByUser: true })?.["items.0.problem"]);
  assert.ok(errors({ items: [{ ...item, origin: "dal_basso" }], idempotencyKey: key, confirmedByUser: true })?.["items.0.origin"]);
  assert.ok(errors({ items: [{ ...item, proposedBy: "x" }], idempotencyKey: key, confirmedByUser: true })?.["items.0.proposedBy"]);
});

test("update_use_case: costo come importo o fascia 1-5, mai entrambi; almeno una modifica", () => {
  const base = { code: "XX-0012", expectedVersion: 4, idempotencyKey: key, confirmedByUser: true };
  const check = (changes: unknown) => validateTeamToolInput("update_use_case", { ...base, changes });
  assert.ok(check({ valuation: { cost: { band: 3 } } }).ok);
  assert.ok(check({ valuation: { cost: { eurOnce: 40000 } } }).ok);
  assert.ok(check({ valuation: { cost: null } }).ok);
  assert.equal(check({ valuation: { cost: { band: 3, eurOnce: 40000 } } }).ok, false);
  assert.equal(check({ valuation: { cost: { band: 6 } } }).ok, false);
  assert.equal(check({ valuation: { kpis: { impact: { efficiency: 6 } } } }).ok, false);
  assert.equal(check({ valuation: {} }).ok, false);
  assert.equal(check({}).ok, false);
  assert.equal(check({ publicNote: "x".repeat(1001) }).ok, false);
  assert.ok(check({ publicNote: null, hiddenFromSearch: false }).ok);
});

test("decide_use_case e set_priority: le decisioni di §3.7 e «Quando» con un trimestre esplicito", () => {
  const base = { code: "xx-0012", expectedVersion: 4, idempotencyKey: key, confirmedByUser: true };
  const decisions = [
    { type: "approva", quando: "questo_trimestre" },
    { type: "approva", quando: "2027-Q3" },
    { type: "rimanda", reviewBy: "2027-01-14" },
    { type: "serve_info", publicNote: "Serve il volume mensile." },
    { type: "non_avviare", publicNote: "Fuori perimetro." },
    { type: "doppione", ofCode: "XX-0007" },
    { type: "archivia", reason: "superato" },
    { type: "riapri" },
    { type: "segna_diffusa" },
    { type: "segna_realizzato" },
  ];
  for (const decision of decisions) {
    const result = validateTeamToolInput("decide_use_case", { ...base, decision });
    assert.ok(result.ok, decision.type);
    if (result.ok) assert.equal(result.data.code, "XX-0012", "il codice si normalizza");
  }
  assert.equal(validateTeamToolInput("decide_use_case", { ...base, decision: { type: "non_avviare" } }).ok, false, "nota obbligatoria");
  assert.equal(validateTeamToolInput("decide_use_case", { ...base, decision: { type: "archivia", reason: "boh" } }).ok, false);
  assert.ok(validateTeamToolInput("set_priority", { ...base, quando: "piu_avanti" }).ok);
  assert.ok(validateTeamToolInput("set_priority", { ...base, quando: "2027-Q1" }).ok);
  assert.equal(validateTeamToolInput("set_priority", { ...base, quando: "domani" }).ok, false);
});

test("hash della richiesta: stesso contenuto, stesso hash; chiave e conferma non contano; lo strumento sì", () => {
  const a = { code: "XX-0012", expectedVersion: 2, quando: "piu_avanti", idempotencyKey: "chiave-uno-1", confirmedByUser: true };
  const b = { confirmedByUser: true, idempotencyKey: "chiave-due-2", quando: "piu_avanti", expectedVersion: 2, code: "XX-0012" };
  assert.equal(teamRequestHash("set_priority", a), teamRequestHash("set_priority", b));
  assert.notEqual(teamRequestHash("set_priority", a), teamRequestHash("set_priority", { ...a, quando: "2027-Q1" }));
  assert.notEqual(teamRequestHash("set_priority", a), teamRequestHash("decide_use_case", a));
  assert.match(teamRequestHash("set_priority", a), /^[0-9a-f]{64}$/);
});

test("errori nel formato del connettore: isError, structuredContent e copia JSON; retryAfterSeconds intero", () => {
  const error = teamError("rate_limited", { retryAfterSeconds: 2.2 });
  assert.deepEqual(error, { error: "rate_limited", message: TEAM_MCP_ERROR_MESSAGES.rate_limited, retryAfterSeconds: 3 });
  const result = teamErrorResult(error);
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, error);
  assert.deepEqual(JSON.parse(result.content[0].text), error);
  assert.equal("isError" in teamResult({ ok: 1 }), false);
});

test("i testi del contratto rispettano le parole di §14.5 (niente «caso d'uso», «wave», «Impact»…)", () => {
  const texts = [
    ...Object.values(TEAM_MCP_TOOL_TEXT).flatMap((t) => [t.title, t.description]),
    ...Object.values(TEAM_MCP_ERROR_MESSAGES),
    READ_ONLY_TOKEN_MESSAGE,
  ];
  const descriptions: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "description" && typeof v === "string") descriptions.push(v);
      else walk(v);
    }
  };
  for (const def of teamToolDefinitions()) walk(def.inputSchema);
  assert.ok(descriptions.length > 20);
  for (const text of [...texts, ...descriptions]) assert.deepEqual(findHubForbidden(text, "area"), [], text);
  assert.equal(Object.keys(TEAM_MCP_INPUT_SCHEMAS).length, 6);
});
