import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbidden } from "../copy-guard.ts";
import {
  READ_ONLY_TOKEN_MESSAGE,
  SAVE_NEEDS_MESSAGES,
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

// Contratto del MCP del team (docs/use-case/DESIGN.md §9.4, §12.5 test 5; «Benefici e costi» e
// «Cosa serve» dalla spec di Pierpaolo, 25/10/2026).

const key = "registra-ai-lab-0001";

test("tools/list: esattamente 8 tool, nell'ordine, con titolo, descrizione, schema e annotazioni; nessun outputSchema", () => {
  const defs = teamToolDefinitions();
  assert.deepEqual(
    defs.map((d) => d.name),
    ["search_use_cases", "get_use_case", "create_use_cases", "update_use_case", "decide_use_case", "set_priority", "list_needs", "save_needs"],
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

test("annotazioni: tre letture, cinque scritture idempotenti, nessuna distruttiva né aperta al mondo", () => {
  for (const name of TEAM_MCP_TOOL_NAMES) {
    const a = TEAM_MCP_TOOL_ANNOTATIONS[name];
    assert.equal(a.readOnlyHint, !isTeamWriteTool(name), name);
    assert.equal(a.destructiveHint, false, name);
    assert.equal(a.idempotentHint, true, name);
    assert.equal(a.openWorldHint, false, name);
  }
});

test("le scritture vogliono confirmedByUser true e un idempotencyKey di 8-128 caratteri", () => {
  assert.deepEqual(TEAM_MCP_TOOL_NAMES.filter(isTeamWriteTool), ["create_use_cases", "update_use_case", "decide_use_case", "set_priority", "save_needs"]);
  for (const name of ["create_use_cases", "update_use_case", "decide_use_case", "set_priority", "save_needs"] as const) {
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

test("update_use_case: «Benefici e costi» in valuation.model con lo schema unico, oppure null; errori per campo in italiano", () => {
  const base = { code: "XX-0012", expectedVersion: 4, idempotencyKey: key, confirmedByUser: true };
  const check = (changes: unknown) => validateTeamToolInput("update_use_case", { ...base, changes });
  const model = {
    v: 1,
    primary: "tempo",
    components: [{ key: "tempo", lever: "tempo", label: "Smistamento delle richieste", kind: "ore", volumeYear: 6600, minutesPerUnit: 1.5, automatablePct: 70, confidence: "ipotesi" }],
    ease: 4,
    costs: { devDays: 4, internalHours: 16, runCostEurYear: 600 },
    plan: { quarter: "2026-Q4", startMonth: "2026-11", goLiveMonth: "2027-01" },
  };
  const ok = check({ valuation: { model } });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.data.changes.valuation?.model, model);
  assert.ok(check({ valuation: { model: null } }).ok, "null toglie il modello");
  const errors = (changes: unknown) => {
    const result = check(changes);
    return result.ok ? null : result.error.fieldErrors;
  };
  assert.deepEqual(errors({ valuation: { model: { ...model, primary: "ricavi" } } }), { "changes.valuation.model.primary": "Il ritorno principale deve essere il tipo di almeno una voce." });
  assert.ok(errors({ valuation: { model: { ...model, components: [] } } })?.["changes.valuation.model.components"]);
  assert.ok(errors({ valuation: { model: { ...model, v: 2 } } })?.["changes.valuation.model.v"]);
  assert.ok(errors({ valuation: { model: { ...model, ease: 6 } } })?.["changes.valuation.model.ease"]);
  assert.equal(errors({ valuation: { model: { ...model, chi: "x" } } })?.["changes.valuation.model.chi"], "Campo non previsto dal contratto.");
  // Un campo di un altro tipo di voce non passa: una voce in euro non ha minuti.
  assert.ok(errors({ valuation: { model: { ...model, components: [{ ...model.components[0], kind: "euro", eurYear: 100 }] } } }));
  const schema = JSON.stringify(teamToolDefinitions().find((d) => d.name === "update_use_case")!.inputSchema);
  for (const field of ["model", "components", "automatablePct", "runCostEurYear", "goLiveMonth"]) assert.ok(schema.includes(`"${field}"`), field);
});

test("list_needs: use case per codice, tipo, archiviate, pagine; nessun filtro sulla persona", () => {
  assert.ok(validateTeamToolInput("list_needs", {}).ok);
  const ok = validateTeamToolInput("list_needs", { useCase: "xx-0012", type: "passo", includeArchived: true, limit: 50 });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.data.useCase, "XX-0012");
  for (const bad of [{ useCase: "fatture" }, { type: "richiesta" }, { limit: 51 }, { limit: 0 }, { includeArchived: "sì" }]) {
    assert.equal(validateTeamToolInput("list_needs", bad).ok, false, JSON.stringify(bad));
  }
  for (const person of ["ownerLabel", "ownerSide", "owner", "chi", "persona", "email"]) {
    const result = validateTeamToolInput("list_needs", { [person]: "cliente" });
    assert.equal(result.ok, false, person);
    if (!result.ok) assert.equal(result.error.fieldErrors?.[person], "Campo non previsto dal contratto.");
  }
});

test("save_needs: 1-50 voci; nuova con tipo e titolo; per id o importKey; archive da solo; nessuna voce vuota", () => {
  const errors = (items: unknown[]) => {
    const result = validateTeamToolInput("save_needs", { items, idempotencyKey: key, confirmedByUser: true });
    return result.ok ? null : result.error.fieldErrors;
  };
  const fresh = { type: "requisito", title: "Accesso al gestionale", kind: "accesso", ownerLabel: "Ufficio IT", ownerSide: "cliente", useCases: ["XX-0012"] };
  assert.equal(errors([fresh]), null);
  assert.equal(errors([{ importKey: "riga-7", type: "passo", title: "Fissare la riunione", status: "confermata", dueOn: "2026-11-15", dueIsProposal: true }]), null);
  assert.equal(errors([{ id: "4f1c2b8e-2d6a-4c4e-9a51-0d1d6a1f00aa", expectedVersion: 3, status: "validata" }]), null);
  assert.equal(errors([{ importKey: "riga-7", archive: { reason: "Superata dal nuovo contratto." } }]), null);
  assert.equal(errors([{ id: "4f1c2b8e-2d6a-4c4e-9a51-0d1d6a1f00aa", expectedVersion: 3, importKey: "riga-7" }]), null, "una chiave nuova per un'esigenza riconosciuta per id");
  assert.equal(errors([{ importKey: "riga-7", status: "validata" }]), null, "con la sola importKey la version è facoltativa");
  assert.equal(errors([{ importKey: "riga-7", useCases: [] }]), null, "[] scollega tutti gli use case");

  assert.deepEqual(errors([]), { items: "Almeno 1 valori." });
  assert.ok(errors(Array.from({ length: 51 }, () => fresh))?.items);
  assert.equal(errors(Array.from({ length: 50 }, () => fresh)), null);
  assert.deepEqual(errors([{ title: "Senza tipo" }]), { "items.0.type": SAVE_NEEDS_MESSAGES.newNeedRequired });
  assert.deepEqual(errors([{ type: "passo" }]), { "items.0.title": SAVE_NEEDS_MESSAGES.newNeedRequired });
  assert.deepEqual(errors([{ importKey: "riga-7" }]), { "items.0.importKey": SAVE_NEEDS_MESSAGES.noChanges });
  assert.deepEqual(errors([{ id: "4f1c2b8e-2d6a-4c4e-9a51-0d1d6a1f00aa", expectedVersion: 3 }]), { "items.0.id": SAVE_NEEDS_MESSAGES.noChanges });
  // Per id la version è obbligatoria: senza, una modifica fatta nella pagina andrebbe persa.
  assert.deepEqual(errors([{ id: "4f1c2b8e-2d6a-4c4e-9a51-0d1d6a1f00aa", status: "validata" }]), { "items.0.expectedVersion": SAVE_NEEDS_MESSAGES.versionRequired });
  assert.deepEqual(errors([{ id: "4f1c2b8e-2d6a-4c4e-9a51-0d1d6a1f00aa", archive: { reason: "Fatto." } }]), { "items.0.expectedVersion": SAVE_NEEDS_MESSAGES.versionRequired });
  assert.deepEqual(errors([{ importKey: "riga-7", status: "fatta", archive: { reason: "Fatto." } }]), { "items.0.archive": SAVE_NEEDS_MESSAGES.archiveOnly });
  assert.deepEqual(errors([{ archive: { reason: "Fatto." } }]), { "items.0.archive": SAVE_NEEDS_MESSAGES.needRefRequired });
  assert.deepEqual(errors([{ ...fresh, expectedVersion: 2 }]), { "items.0.expectedVersion": SAVE_NEEDS_MESSAGES.needRefRequired });
  assert.ok(errors([{ importKey: "riga-7", archive: { reason: "" } }])?.["items.0.archive.reason"]);
  assert.ok(errors([{ id: "non-un-id", status: "fatta" }])?.["items.0.id"]);
  assert.ok(errors([{ ...fresh, status: "in_corso" }])?.["items.0.status"]);
  assert.ok(errors([{ ...fresh, kind: "software" }])?.["items.0.kind"]);
  assert.ok(errors([{ ...fresh, ownerSide: "ufficio" }])?.["items.0.ownerSide"]);
  assert.ok(errors([{ ...fresh, dueOn: "15/11/2026" }])?.["items.0.dueOn"]);
  assert.ok(errors([{ ...fresh, useCases: Array.from({ length: 51 }, () => "XX-0012") }])?.["items.0.useCases"]);
  assert.ok(errors([{ ...fresh, delete: true }])?.["items.0.delete"], "non esiste cancellare");
  assert.ok(errors([{ ...fresh, title: "x".repeat(301) }])?.["items.0.title"]);
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
  assert.equal(Object.keys(TEAM_MCP_INPUT_SCHEMAS).length, 8);
});
