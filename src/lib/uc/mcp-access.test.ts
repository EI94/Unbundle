import test from "node:test";
import assert from "node:assert/strict";
import {
  CASE_SCOPES,
  CASES_PROPOSE_SCOPE,
  CASES_READ_SCOPE,
  CASES_READ_VALIDATED_SCOPE,
  DATASETS_READ_ROWS_SCOPE,
  GRANTABLE_CASE_SCOPES,
  MCP_CASE_TOOLS,
  MCP_TOOL_SCOPE,
  STORED_SNAPSHOT_SCHEMA,
  buildCaseTokenScopes,
  buildCasiInstallCommand,
  buildCasiStarterPrompt,
  caseScopeMarker,
  casiServerName,
  checkMcpToolAccess,
  clientTextFromSettings,
  grantedCaseScopes,
  mcpErrorStatus,
  normalizeApiBaseUrl,
  parseCaseTokenScopes,
  parseKindsParam,
  parseStoredSnapshot,
  parseVersionParam,
  roleLabelsFrom,
} from "./mcp-access.ts";
import { caseTokenScope } from "./sql/transitions.ts";
import { CATALOG_SNAPSHOT_SCHEMA, buildCatalogSnapshot } from "./snapshot.ts";
import { sampleInput } from "./snapshot.fixtures.ts";
import { ITEM_KINDS } from "./vocab.ts";

const CASE = "0f1e2d3c-4b5a-4968-8776-655443322110";
const OTHER = "11111111-2222-4333-8444-555555555555";
const marker = `uc:case:${CASE}`;

test("the case marker matches the one revoked by case closure and «revoke all links»", () => {
  assert.equal(caseScopeMarker(CASE), caseTokenScope(CASE));
  assert.equal(caseScopeMarker(CASE.toUpperCase()), caseTokenScope(CASE.toUpperCase()));
  assert.equal(caseScopeMarker(CASE), marker);
});

test("the stored snapshot schema is the catalog snapshot schema", () => {
  assert.equal(STORED_SNAPSHOT_SCHEMA, CATALOG_SNAPSHOT_SCHEMA);
});

test("every tool needs a grantable read scope; only two scopes are grantable", () => {
  assert.deepEqual([...GRANTABLE_CASE_SCOPES], ["cases:read", "cases:read_validated"]);
  for (const tool of MCP_CASE_TOOLS) assert.ok(GRANTABLE_CASE_SCOPES.includes(MCP_TOOL_SCOPE[tool]));
  assert.equal(MCP_TOOL_SCOPE.get_validated_catalog, CASES_READ_VALIDATED_SCOPE);
  for (const tool of ["list_cases", "get_open_items", "get_data_dictionary", "get_gate_status"] as const) assert.equal(MCP_TOOL_SCOPE[tool], CASES_READ_SCOPE);
  assert.ok(CASE_SCOPES.includes(CASES_PROPOSE_SCOPE));
  assert.ok(CASE_SCOPES.includes(DATASETS_READ_ROWS_SCOPE));
});

test("list_cases lists dossiers; the old name list_use_cases is only an alias of the stdio server", () => {
  assert.deepEqual([...MCP_CASE_TOOLS], ["list_cases", "get_validated_catalog", "get_open_items", "get_data_dictionary", "get_gate_status"]);
  assert.ok(!(MCP_CASE_TOOLS as readonly string[]).includes("list_use_cases"));
});

test("a case token needs exactly one lowercase case marker", () => {
  assert.deepEqual(parseCaseTokenScopes([CASES_READ_SCOPE, marker]), { ok: true, value: { caseId: CASE, scopes: [CASES_READ_SCOPE] } });
  // Doppione dello stesso marcatore: un solo caso.
  assert.ok(parseCaseTokenScopes([CASES_READ_SCOPE, marker, marker]).ok);

  const code = (scopes: unknown) => {
    const r = parseCaseTokenScopes(scopes);
    return r.ok ? null : r.code;
  };
  assert.equal(code(["portfolio:submit"]), "scope_mancante");
  assert.equal(code([]), "scope_mancante");
  assert.equal(code(null), "scope_mancante");
  assert.equal(code("cases:read"), "scope_mancante");
  assert.equal(code([CASES_READ_SCOPE]), "token_senza_caso");
  assert.equal(code([CASES_READ_SCOPE, marker, `uc:case:${OTHER}`]), "token_senza_caso");
  assert.equal(code([CASES_READ_SCOPE, `uc:case:${CASE.toUpperCase()}`]), "token_senza_caso");
  assert.equal(code([CASES_READ_SCOPE, "uc:case:non-un-uuid"]), "token_senza_caso");
  assert.equal(code([CASES_READ_SCOPE, "uc:case:"]), "token_senza_caso");
});

test("reserved scopes make a case token but grant no tool", () => {
  const parsed = parseCaseTokenScopes([CASES_PROPOSE_SCOPE, marker]);
  assert.deepEqual(parsed, { ok: true, value: { caseId: CASE, scopes: [] } });
  for (const tool of MCP_CASE_TOOLS) {
    const r = checkMcpToolAccess({ scopes: [CASES_PROPOSE_SCOPE, DATASETS_READ_ROWS_SCOPE, marker], tool });
    assert.equal(r.ok ? null : r.code, "scope_mancante");
  }
});

test("tool access: the right scope, and only the marked case", () => {
  const readOnly = [CASES_READ_SCOPE, marker];
  const validatedOnly = [CASES_READ_VALIDATED_SCOPE, marker];
  assert.deepEqual(checkMcpToolAccess({ scopes: readOnly, tool: "list_cases" }), { ok: true, value: { caseId: CASE } });
  assert.deepEqual(checkMcpToolAccess({ scopes: readOnly, tool: "get_gate_status", caseId: CASE.toUpperCase() }), { ok: true, value: { caseId: CASE } });
  const denied = (r: ReturnType<typeof checkMcpToolAccess>) => (r.ok ? null : r.code);
  assert.equal(denied(checkMcpToolAccess({ scopes: readOnly, tool: "get_validated_catalog", caseId: CASE })), "scope_mancante");
  assert.equal(denied(checkMcpToolAccess({ scopes: validatedOnly, tool: "get_open_items", caseId: CASE })), "scope_mancante");
  assert.equal(denied(checkMcpToolAccess({ scopes: validatedOnly, tool: "list_cases" })), "scope_mancante");
  assert.ok(checkMcpToolAccess({ scopes: validatedOnly, tool: "get_validated_catalog", caseId: CASE }).ok);
  // Un altro caso, anche dello stesso workspace, risponde come un caso inesistente.
  assert.equal(denied(checkMcpToolAccess({ scopes: [...readOnly, CASES_READ_VALIDATED_SCOPE], tool: "get_validated_catalog", caseId: OTHER })), "caso_non_trovato");
  assert.equal(denied(checkMcpToolAccess({ scopes: readOnly, tool: "get_open_items", caseId: "../../cases" })), "caso_non_trovato");
  assert.equal(denied(checkMcpToolAccess({ scopes: ["portfolio:submit"], tool: "list_cases" })), "scope_mancante");
});

test("error codes map to HTTP statuses and Italian messages", () => {
  assert.equal(mcpErrorStatus("non_autorizzato"), 401);
  assert.equal(mcpErrorStatus("scope_mancante"), 403);
  assert.equal(mcpErrorStatus("token_senza_caso"), 403);
  assert.equal(mcpErrorStatus("caso_non_trovato"), 404);
  assert.equal(mcpErrorStatus("nessuna_versione_congelata"), 404);
  assert.equal(mcpErrorStatus("parametro_non_valido"), 422);
  assert.equal(mcpErrorStatus("registro_non_disponibile"), 503);
  assert.equal(mcpErrorStatus("qualcos_altro"), 500);
  const r = checkMcpToolAccess({ scopes: [CASES_READ_SCOPE], tool: "list_cases" });
  assert.ok(!r.ok && /un solo caso/.test(r.message));
});

test("new token scopes: only reads, ordered, with the case marker", () => {
  assert.deepEqual(buildCaseTokenScopes(CASE, [CASES_READ_VALIDATED_SCOPE, CASES_READ_SCOPE, CASES_READ_SCOPE]), {
    ok: true,
    value: [CASES_READ_SCOPE, CASES_READ_VALIDATED_SCOPE, marker],
  });
  assert.deepEqual(buildCaseTokenScopes(CASE.toUpperCase(), [CASES_READ_VALIDATED_SCOPE]), { ok: true, value: [CASES_READ_VALIDATED_SCOPE, marker] });
  const code = (caseId: string, requested: unknown) => {
    const r = buildCaseTokenScopes(caseId, requested);
    return r.ok ? null : r.code;
  };
  assert.equal(code(CASE, []), "scope_mancante");
  assert.equal(code(CASE, "cases:read"), "scope_mancante");
  assert.equal(code(CASE, [CASES_READ_SCOPE, CASES_PROPOSE_SCOPE]), "scope_non_ammesso");
  assert.equal(code(CASE, [DATASETS_READ_ROWS_SCOPE]), "scope_non_ammesso");
  assert.equal(code(CASE, ["portfolio:submit"]), "scope_non_ammesso");
  assert.equal(code(CASE, [`uc:case:${OTHER}`]), "scope_non_ammesso");
  assert.equal(code("non-un-uuid", [CASES_READ_SCOPE]), "caso_non_trovato");
  // Un token costruito così passa sempre il controllo delle rotte.
  const built = buildCaseTokenScopes(CASE, [CASES_READ_SCOPE, CASES_READ_VALIDATED_SCOPE]);
  assert.ok(built.ok);
  for (const tool of MCP_CASE_TOOLS) assert.ok(checkMcpToolAccess({ scopes: built.value, tool, caseId: tool === "list_cases" ? null : CASE }).ok);
  assert.deepEqual(grantedCaseScopes(built.value), [CASES_READ_SCOPE, CASES_READ_VALIDATED_SCOPE]);
  assert.deepEqual(grantedCaseScopes(null), []);
});

test("route parameters: version and kinds", () => {
  assert.deepEqual(parseVersionParam(null), { ok: true, value: null });
  assert.deepEqual(parseVersionParam(" "), { ok: true, value: null });
  assert.deepEqual(parseVersionParam("3"), { ok: true, value: 3 });
  for (const bad of ["0", "-1", "1.5", "abc", "01", "9999999999"]) assert.equal(parseVersionParam(bad).ok, false, bad);

  assert.deepEqual(parseKindsParam(null), { ok: true, value: null });
  assert.deepEqual(parseKindsParam(""), { ok: true, value: null });
  assert.deepEqual(parseKindsParam("regola, campo,campo"), { ok: true, value: ["campo", "regola"] });
  assert.equal(parseKindsParam("campo,segreto").ok, false);
  assert.equal(parseKindsParam([...ITEM_KINDS, "campo"].join(",")).ok, false);
});

test("client texts are on unless the case says otherwise", () => {
  assert.equal(clientTextFromSettings({}), true);
  assert.equal(clientTextFromSettings(null), true);
  assert.equal(clientTextFromSettings({ client_text: true }), true);
  assert.equal(clientTextFromSettings({ client_text: "false" }), true);
  assert.equal(clientTextFromSettings({ client_text: false }), false);
});

test("role labels come from the template, overridden by the case", () => {
  const roles = [{ key: "resp_servizio", label: "Responsabile del servizio" }, { key: "senza_etichetta" }, { label: "senza chiave" }, "rumore"];
  assert.deepEqual(roleLabelsFrom(roles, { role_labels: { resp_servizio: "Responsabile clienti", vuoto: " " } }), {
    resp_servizio: "Responsabile clienti",
    senza_etichetta: "senza_etichetta",
  });
  assert.deepEqual(roleLabelsFrom(null, null), {});
});

test("a stored snapshot is accepted only as a frozen version of the same case", () => {
  const built = buildCatalogSnapshot(sampleInput());
  assert.ok(built.ok);
  const snapshot = built.value;
  const caseId = snapshot.case.id;
  assert.equal(parseStoredSnapshot(snapshot, caseId), snapshot);
  assert.equal(parseStoredSnapshot(JSON.stringify(snapshot), caseId.toUpperCase())?.version, 1);
  assert.equal(parseStoredSnapshot(snapshot, OTHER), null);
  assert.equal(parseStoredSnapshot({ ...snapshot, version: "bozza" }, caseId), null);
  assert.equal(parseStoredSnapshot({ ...snapshot, frozen_at: null }, caseId), null);
  assert.equal(parseStoredSnapshot({ ...snapshot, schema: "altro/1" }, caseId), null);
  assert.equal(parseStoredSnapshot({ ...snapshot, items: null }, caseId), null);
  assert.equal(parseStoredSnapshot("{non json", caseId), null);
  assert.equal(parseStoredSnapshot(null, caseId), null);
});

test("install command: casi server and skill, the token, one server per case", () => {
  const command = buildCasiInstallCommand({ apiUrl: "https://www.example.test/", token: "ub_mcp_prova", caseCode: "ES-UC-01" });
  assert.match(command, /'https:\/\/www\.example\.test\/api\/mcp\/casi\/server'/);
  assert.match(command, /'https:\/\/www\.example\.test\/api\/mcp\/casi\/skill'/);
  assert.match(command, /@modelcontextprotocol\/sdk@\^1\.29\.0 zod@\^4\.3\.6/);
  assert.match(command, /UNBUNDLE_MCP_TOKEN='ub_mcp_prova'/);
  assert.match(command, / unbundle-casi-es-uc-01 -- node /);
  assert.doesNotMatch(command, /portfolio/);
  assert.equal(casiServerName("ES-UC-01"), "unbundle-casi-es-uc-01");
  assert.equal(casiServerName("--"), "unbundle-casi");
  // Un apice nel token non rompe il comando.
  assert.match(buildCasiInstallCommand({ apiUrl: "x.test", token: "a'b", caseCode: "AB" }), /UNBUNDLE_MCP_TOKEN='a'\\''b'/);
  assert.equal(normalizeApiBaseUrl("x.test/"), "https://x.test");
  assert.equal(normalizeApiBaseUrl("http://127.0.0.1:53110//"), "http://127.0.0.1:53110");
  assert.equal(normalizeApiBaseUrl("  "), null);
  const prompt = buildCasiStarterPrompt("ES-UC-01");
  assert.match(prompt, /ES-UC-01/);
  assert.match(prompt, /non inventare valori/);
});
