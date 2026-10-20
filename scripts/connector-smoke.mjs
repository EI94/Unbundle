// Smoke test of the Claude connector (prompt WP10) against a running Unbundle server: the
// official SDK client (Client + StreamableHTTPClientTransport), as claude.ai or Claude Code
// would connect.
//
//   UB_CONNECTOR_TEST_TOKEN=… CONNECTOR_SMOKE_URL=http://127.0.0.1:53130/api/mcp/connettore/<slug> \
//     node --no-warnings scripts/connector-smoke.mjs
//
// Locally, scripts/connettore-test/smoke-run.mjs prepares a synthetic workspace and a test
// token in the local database, runs this script with the token in its environment (the
// full run, then the limited and suspended phases) and checks the saved rows.
//
// The token comes only from UB_CONNECTOR_TEST_TOKEN and goes only into the
// Authorization header of the requests: it is never printed, written to a file or put
// in a URL (the «token in the query» check uses a made-up token). Every printed line
// passes through a filter that would mask it anyway.
//
// Optional:
//   CONNECTOR_SMOKE_MODE            full (default): every check below
//                                   list: only initialize and tools/list (no tool call,
//                                   nothing written), to compare a server's tools with the
//                                   contract
//                                   limited: the workspace's submission bucket is full (the
//                                   runner lowers the limit after a full run with the same
//                                   CONNECTOR_SMOKE_RUN_ID): a replay of the first submission
//                                   still gets duplicate: true, a new one gets rate_limited
//                                   with retryAfterSeconds, reads still pass
//                                   suspended: the connector is suspended: initialize and
//                                   tools/list work, every tool answers connector_disabled
//                                   (what Claude needs for the plan B)
//   CONNECTOR_SMOKE_RUN_ID          8 hex characters naming this run's idempotency keys and
//                                   titles (default: random); the limited phase needs the one
//                                   of the full run
//   CONNECTOR_SMOKE_WORKSPACE_NAME  display name of the workspace: the instructions must be
//                                   exactly the workspace's template for that name (the
//                                   template of CONNECTOR_SMOKE_PROFILE_FILE, otherwise the
//                                   synthetic template of the tests)
//   CONNECTOR_SMOKE_PROFILE_FILE    the profile file loaded into the workspace (profile plus
//                                   instructionsTemplate, as for connector-admin profile):
//                                   tools/list must be exactly the definitions built from it
//   CONNECTOR_SMOKE_CONTRACT_FILE   the client contract JSON (outside git): titles,
//                                   descriptions, annotations and input schemas must be
//                                   the contract's (nothing of it is printed)
//   CONNECTOR_SMOKE_SUBMISSION_FILE a valid submit_contribution input for the server's
//                                   profile and guide (default: the synthetic example)
//   CONNECTOR_SMOKE_WARM_RUNS       warm submissions to time (default 20)
//
// Full run: initialize (latest protocol, then a 2025-06-18 client), tools/list (titles,
// annotations, schemas, key order on the wire), guide (with the rubric and the agent
// catalog), search, submit twice with the same key (duplicate), status, search after the
// submission (no author, email, notes or scores), the contract errors that need no server
// state (invalid_payload, missing_impact_measure, sensitive_content, unknown_related_code,
// idempotency_conflict, not_found, identity_required, each in the contract format), the HTTP
// negatives (no token 401, token in query 400, 405 with Allow: POST for GET, HEAD, PUT,
// PATCH, DELETE and OPTIONS, Origin 403, Content-Type 415, body over 256 KB 413, Accept 406,
// hygiene headers), then the warm submissions with p95 < 2 s; the first calls of the run are
// measured and reported (cold when the server has just started). A report without secrets
// closes every run. Exit code 0 only if every check passes.
// Needs Node 22.6+ (it imports TypeScript modules of the connector for the expected values).
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { CONNECTOR_TOKEN_PREFIX } from "../src/lib/connector/auth.ts";
import { EXAMPLE_INSTRUCTIONS_TEMPLATE, exampleSubmission } from "../src/lib/connector/contract.fixtures.ts";
import { connectorServerInstructions, CONNECTOR_INSTRUCTIONS_MAX_CHARS } from "../src/lib/connector/instructions.ts";
import { parseConnectorProfileFile } from "../src/lib/connector/profile.ts";
import { CONNECTOR_TOOL_ANNOTATIONS, connectorToolDefinitions } from "../src/lib/connector/tools.ts";

const TOOL_NAMES = ["get_intake_guide", "find_similar_contributions", "submit_contribution", "get_contribution_status"];
const FORBIDDEN_KEYS = ["proposedBy", "proposed_by", "submitterEmail", "email", "reviewNotes", "review_notes", "overallScore", "customScores", "reviewedBy"];
const ERROR_KEYS = ["error", "message", "fieldErrors", "retryAfterSeconds"];
const P95_LIMIT_MS = 2000;
const BODY_MAX_BYTES = 256 * 1024;
// Numero di telefono inventato (prefisso italiano, cellulare): deve dare sensitive_content.
const FAKE_PHONE = "+39 347 000 1122";

const token = process.env.UB_CONNECTOR_TEST_TOKEN?.trim();
const endpoint = process.env.CONNECTOR_SMOKE_URL?.trim();
if (!token || !token.startsWith(CONNECTOR_TOKEN_PREFIX)) {
  console.error("Set UB_CONNECTOR_TEST_TOKEN to a connector test token (workspace token prefix); it is never printed.");
  process.exit(2);
}
if (!endpoint) {
  console.error("Set CONNECTOR_SMOKE_URL to the connector URL, e.g. http://127.0.0.1:53130/api/mcp/connettore/<slug>.");
  process.exit(2);
}
const url = new URL(endpoint);
if (url.search || url.hash || url.username || url.password) {
  console.error("CONNECTOR_SMOKE_URL must not carry a query, a fragment or credentials.");
  process.exit(2);
}
const warmRuns = Math.max(1, Math.min(100, Number(process.env.CONNECTOR_SMOKE_WARM_RUNS ?? 20) || 20));
const MODES = ["full", "list", "limited", "suspended"];
const mode = process.env.CONNECTOR_SMOKE_MODE?.trim() || "full";
if (!MODES.includes(mode)) {
  console.error(`CONNECTOR_SMOKE_MODE must be one of ${MODES.join(", ")}.`);
  process.exit(2);
}
const givenRunId = process.env.CONNECTOR_SMOKE_RUN_ID?.trim();
if (givenRunId !== undefined && !/^[0-9a-f]{8}$/.test(givenRunId)) {
  console.error("CONNECTOR_SMOKE_RUN_ID must be 8 lowercase hex characters.");
  process.exit(2);
}
if (mode === "limited" && !givenRunId) {
  console.error("The limited phase needs CONNECTOR_SMOKE_RUN_ID of the full run.");
  process.exit(2);
}
const runId = givenRunId || randomBytes(4).toString("hex");

// ─── Output without secrets ──────────────────────────────────────────────────

function safe(text) {
  return String(text).split(token).join("[token]");
}
const results = [];
function report(ok, label, detail = "") {
  results.push(ok);
  console.log(safe(`${ok ? "[ok]   " : "[FAIL] "}${label}${detail ? `: ${detail}` : ""}`));
}
function check(condition, label, detail) {
  report(Boolean(condition), label, detail);
  return Boolean(condition);
}
const summary = [];
function note(line) {
  summary.push(line);
}

/** Un errore del contratto: isError, codice, solo i campi del formato, copia testuale JSON. */
function contractError(run, code, label, extra = () => true) {
  const content = run.content;
  const keysOk = Object.keys(content).every((key) => ERROR_KEYS.includes(key)) && typeof content.message === "string";
  const textOk = run.result.content?.[0]?.text === JSON.stringify(content);
  return check(
    run.result.isError === true && content.error === code && keysOk && textOk && extra(content),
    label,
    `${content.error ?? "nessun errore"}${content.fieldErrors ? ` su ${Object.keys(content.fieldErrors).join(", ")}` : ""}${content.retryAfterSeconds ? `, retryAfterSeconds ${content.retryAfterSeconds}` : ""}`
  );
}

// ─── Clients ─────────────────────────────────────────────────────────────────

/** An SDK client; `rewriteVersion` makes it ask for an older protocol version at initialize. */
async function connectClient({ rewriteVersion } = {}) {
  const seen = [];
  const fetchImpl = async (input, init = {}) => {
    let body = init.body;
    let method = init.method ?? "GET";
    if (typeof body === "string") {
      const message = JSON.parse(body);
      method = message.method ?? method;
      if (rewriteVersion && message.method === "initialize") {
        message.params.protocolVersion = rewriteVersion;
        body = JSON.stringify(message);
      }
    }
    const started = performance.now();
    const response = await fetch(input, { ...init, body });
    const entry = { method, status: response.status, ms: performance.now() - started };
    if (method === "initialize" && response.ok) entry.protocolVersion = (await response.clone().json()).result?.protocolVersion;
    seen.push(entry);
    return response;
  };
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: fetchImpl,
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "unbundle-connector-smoke", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport, seen };
}

async function rawPost(body, { headers = {}, auth = true, target = url } = {}) {
  return fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(auth ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "smoke", version: "1" } },
};

async function timedCall(client, name, args) {
  const started = performance.now();
  const result = await client.callTool({ name, arguments: args });
  return { result, ms: performance.now() - started, content: result.structuredContent ?? {} };
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const round = (ms) => `${Math.round(ms)} ms`;

function hasForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => FORBIDDEN_KEYS.includes(key) || hasForbiddenKey(item));
}

/** JSON con le chiavi in ordine: per confrontare due valori senza badare all'ordine. */
function canonical(value) {
  const sort = (v) =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(value));
}

function readJsonFile(variable) {
  const path = process.env[variable]?.trim();
  return path ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function baseSubmission() {
  const fromFile = readJsonFile("CONNECTOR_SMOKE_SUBMISSION_FILE");
  return fromFile ?? exampleSubmission({ submittedBy: { name: "Persona di prova dello smoke" } });
}

function submissionFor(n, base) {
  return {
    ...base,
    idempotencyKey: `smoke-${runId}-${String(n).padStart(3, "0")}`,
    title: `Riconciliazione automatica delle fatture già registrate ${runId}-${n}`,
  };
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const CODE_PATTERN = /^[A-Z]{2,4}-\d{4,5}$/;

/** Esito del giro, con il rapporto senza segreti. */
function finish(label) {
  const passed = results.filter(Boolean).length;
  console.log("Rapporto (senza segreti):");
  console.log(safe(`  modalità ${mode}, giro ${runId}, server ${url.origin}${url.pathname}`));
  for (const line of summary) console.log(safe(`  ${line}`));
  console.log(`Esito${label ? ` (${label})` : ""}: ${passed}/${results.length} controlli superati.`);
  return passed === results.length ? 0 : 1;
}

/** Connettore sospeso: handshake e tools/list funzionano, ogni tool risponde connector_disabled. */
async function suspendedPhase(client) {
  const base = baseSubmission();
  const args = {
    get_intake_guide: {},
    find_similar_contributions: { query: "riconciliazione fatture registrate" },
    submit_contribution: submissionFor(900, base),
    get_contribution_status: { code: "ZZ-0001" },
  };
  for (const name of TOOL_NAMES) {
    contractError(await timedCall(client, name, args[name]), "connector_disabled", `${name} con il connettore sospeso`);
  }
  note("connettore sospeso: initialize e tools/list funzionano, i 4 tool rispondono connector_disabled (piano B)");
  await client.close();
  return finish("connettore sospeso");
}

/** Secchio degli invii pieno: il duplicato passa, un invio nuovo no, le letture sì. */
async function limitedPhase(client) {
  const base = baseSubmission();
  const replay = await timedCall(client, "submit_contribution", submissionFor(0, base));
  check(
    !replay.result.isError && replay.content.duplicate === true && CODE_PATTERN.test(String(replay.content.code)),
    "invio ripetuto a secchio pieno",
    `duplicate ${replay.content.duplicate}, codice ${replay.content.code}`
  );
  const limited = await timedCall(client, "submit_contribution", submissionFor(warmRuns + 100, base));
  contractError(limited, "rate_limited", "invio nuovo a secchio pieno", (c) => Number(c.retryAfterSeconds) > 0 && Number(c.retryAfterSeconds) <= 3600);
  const guide = await timedCall(client, "get_intake_guide", {});
  check(!guide.result.isError, "letture con il secchio degli invii pieno", guide.result.isError ? String(guide.content.error) : "get_intake_guide risponde");
  note(`secchio degli invii pieno: duplicato ${replay.content.duplicate === true ? "sì" : "no"}, nuovo invio ${limited.content.error ?? "accettato"} (retryAfterSeconds ${limited.content.retryAfterSeconds ?? "-"})`);
  await client.close();
  return finish("secchio pieno");
}

async function main() {
  console.log(`Smoke del connettore MCP (${mode}), ${new Date().toISOString()}`);
  console.log(`Server: ${url.origin}${url.pathname}`);

  // initialize, istruzioni, tools/list (prima chiamata: a freddo).
  const coldStarted = performance.now();
  const { client, transport, seen } = await connectClient();
  const coldInitMs = performance.now() - coldStarted;
  const init = seen.find((s) => s.method === "initialize");
  check(init?.status === 200 && transport.protocolVersion === LATEST_PROTOCOL_VERSION, "initialize", `protocollo ${transport.protocolVersion}, HTTP ${init?.status}, prima chiamata ${round(init?.ms ?? coldInitMs)}`);
  const server = client.getServerVersion();
  check(server?.name === "unbundle", "serverInfo", `${server?.name} ${server?.version}`);
  check(seen.find((s) => s.method === "notifications/initialized")?.status === 202, "notifications/initialized", "HTTP 202");
  const instructions = client.getInstructions() ?? "";
  const workspaceName = process.env.CONNECTOR_SMOKE_WORKSPACE_NAME?.trim();
  const profileJson = readJsonFile("CONNECTOR_SMOKE_PROFILE_FILE");
  const profileFile = profileJson ? parseConnectorProfileFile(profileJson) : null;
  if (workspaceName) {
    const template = profileFile?.ok ? profileFile.instructionsTemplate : EXAMPLE_INSTRUCTIONS_TEMPLATE;
    check(instructions === connectorServerInstructions(workspaceName, template), "istruzioni del server", `modello del workspace con il suo nome, ${instructions.length} caratteri (max ${CONNECTOR_INSTRUCTIONS_MAX_CHARS})`);
  } else {
    check(instructions.length > 0 && instructions.length <= CONNECTOR_INSTRUCTIONS_MAX_CHARS, "istruzioni del server", `${instructions.length} caratteri`);
  }

  const { tools } = await client.listTools();
  check(JSON.stringify(tools.map((t) => t.name)) === JSON.stringify(TOOL_NAMES), "tools/list", `${tools.length} tool: ${tools.map((t) => t.name).join(", ")}`);
  const annotationsOk = tools.every((t) => JSON.stringify(t.annotations) === JSON.stringify(CONNECTOR_TOOL_ANNOTATIONS[t.name]));
  check(annotationsOk && tools.every((t) => t.title && t.description && !t.outputSchema), "titoli, descrizioni e annotazioni", "annotazioni del prompt WP5, nessun outputSchema");
  // L'SDK del client riordina le chiavi degli schemi: confronto semantico qui, e l'ordine
  // esatto sul filo con un tools/list senza client.
  const wire = (await (await rawPost({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()).result?.tools ?? [];
  if (profileFile) {
    const parsed = profileFile;
    const expected = parsed.ok ? connectorToolDefinitions(parsed.profile) : [];
    const pick = (t) => ({ title: t?.title, description: t?.description, inputSchema: t?.inputSchema });
    check(parsed.ok && tools.every((t, i) => canonical(pick(t)) === canonical(pick(expected[i]))), "schemi d'ingresso", "uguali a quelli costruiti dal profilo del server");
    check(parsed.ok && JSON.stringify(wire.map(pick)) === JSON.stringify(expected.map(pick)), "tools/list sul filo", "titoli, descrizioni e schemi con lo stesso ordine delle chiavi");
  }
  const contract = readJsonFile("CONNECTOR_SMOKE_CONTRACT_FILE");
  if (contract) {
    const byName = Object.fromEntries(contract.tools.map((t) => [t.name, t]));
    const reference = (name) => {
      const ref = byName[name];
      const schema = typeof ref?.input_schema_json === "string" ? JSON.parse(ref.input_schema_json) : ref?.input_schema_json;
      return { title: ref?.title, description: ref?.description, inputSchema: schema, annotations: ref?.annotations };
    };
    const pick = (t) => ({ title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations });
    check(tools.every((t) => canonical(pick(t)) === canonical(reference(t.name))), "tool del contratto", "titoli, descrizioni, schemi e annotazioni uguali");
    check(wire.length === 4 && wire.every((t) => JSON.stringify(pick(t)) === JSON.stringify(reference(t.name))), "tool del contratto sul filo", "identici, ordine delle chiavi compreso");
  }

  note(`initialize: protocollo ${transport.protocolVersion}, prima chiamata del giro ${round(init?.ms ?? coldInitMs)}; istruzioni ${instructions.length} caratteri; ${tools.length} tool`);
  if (mode === "suspended") return suspendedPhase(client);
  if (mode === "limited") return limitedPhase(client);

  // Client 2025-06-18.
  const old = await connectClient({ rewriteVersion: "2025-06-18" });
  const oldInit = old.seen.find((s) => s.method === "initialize");
  const oldTools = await old.client.listTools();
  check(oldInit?.protocolVersion === "2025-06-18" && old.transport.protocolVersion === "2025-06-18" && oldTools.tools.length === 4, "client 2025-06-18", `negoziata ${oldInit?.protocolVersion}, tools/list ${oldTools.tools.length}`);
  await old.client.close();

  if (mode === "list") {
    await client.close();
    return finish("solo initialize e tools/list");
  }

  // Guida e ricerca.
  const guide = await timedCall(client, "get_intake_guide", {});
  const guideChars = JSON.stringify(guide.content).length;
  check(!guide.result.isError && guide.content.guideVersion !== undefined && guide.content.identityMode, "get_intake_guide", `guideVersion ${guide.content.guideVersion}, identityMode ${guide.content.identityMode}, ${guideChars} caratteri, ${round(guide.ms)}`);
  check(guideChars < 20000, "guida sotto 20.000 caratteri", String(guideChars));
  // La guida che Claude riceve ha la rubrica (efficienza, sforzo, semaforo) e il catalogo degli agenti (WP8).
  const rubric = guide.content.rubric;
  const catalog = guide.content.agentCatalog;
  const rubricOk = rubric !== null && typeof rubric === "object" && !Array.isArray(rubric) && ["efficiency", "effort", "impactFlag"].every((key) => rubric[key] && typeof rubric[key] === "object");
  check(rubricOk && Array.isArray(catalog), "guida con rubrica e catalogo degli agenti", `rubrica ${rubricOk ? "con efficienza, sforzo e semaforo" : "mancante o incompleta"}, ${Array.isArray(catalog) ? catalog.length : "nessun"} agenti`);
  const searchBefore = await timedCall(client, "find_similar_contributions", { query: "riconciliazione fatture già" });
  check(!searchBefore.result.isError && Array.isArray(searchBefore.content.results) && typeof searchBefore.content.note === "string", "find_similar_contributions", `${searchBefore.content.results?.length ?? 0} risultati, nota presente, ${round(searchBefore.ms)}`);

  // Invio due volte con la stessa chiave, poi lo stato.
  const base = baseSubmission();
  const first = submissionFor(0, base);
  const sent = await timedCall(client, "submit_contribution", first);
  const code = sent.content.code;
  const firstSubmitMs = sent.ms;
  check(
    !sent.result.isError &&
      sent.content.ok === true &&
      sent.content.duplicate === false &&
      /^[A-Z]{2,4}-\d{4,5}$/.test(String(code)) &&
      sent.content.statusCode === "RICEVUTA" &&
      sent.content.statusLabel === "Ricevuta" &&
      sent.content.link === null,
    "submit_contribution",
    `${code}, ${sent.content.statusCode} «${sent.content.statusLabel}», duplicate ${sent.content.duplicate}, link ${sent.content.link}, prima chiamata ${round(firstSubmitMs)}`
  );
  const again = await timedCall(client, "submit_contribution", first);
  check(!again.result.isError && again.content.duplicate === true && again.content.code === code, "submit_contribution, stessa chiave", `duplicate ${again.content.duplicate}, stesso codice ${again.content.code}`);
  const status = await timedCall(client, "get_contribution_status", { code });
  check(!status.result.isError && status.content.code === code && typeof status.content.statusCode === "string", "get_contribution_status", `${status.content.code}: ${status.content.statusCode} «${status.content.statusLabel}», cambio ${status.content.statusChangedAt}`);
  const searchAfter = await timedCall(client, "find_similar_contributions", { query: "riconciliazione fatture già" });
  const found = (searchAfter.content.results ?? []).some((r) => r.code === code);
  check(found && !hasForbiddenKey(searchAfter.content), "ricerca dopo l'invio", `${code} trovato, nessun campo vietato (autore, email, note, punteggi)`);
  check(!hasForbiddenKey(status.content), "stato senza campi vietati", "nessun autore, email, nota interna o punteggio");

  // Errori del contratto che non chiedono uno stato del server, ognuno nel formato del contratto.
  const invalid = await timedCall(client, "submit_contribution", { title: "x" });
  contractError(invalid, "invalid_payload", "input non valido", (c) => c.fieldErrors && !JSON.stringify(invalid.result).includes("Input validation error"));
  const noImpact = submissionFor(800, base);
  for (const field of ["timeSavedMinutesPerRun", "valuePerRunEur", "qualityGain"]) delete noImpact[field];
  contractError(await timedCall(client, "submit_contribution", noImpact), "missing_impact_measure", "nessuna misura dell'impatto");
  const phone = await timedCall(client, "submit_contribution", { ...submissionFor(801, base), promptSnippet: `Se serve, chiama il numero ${FAKE_PHONE}.` });
  contractError(phone, "sensitive_content", "telefono nel prompt", (c) => Object.keys(c.fieldErrors ?? {}).includes("promptSnippet") && !JSON.stringify(phone.result).includes(FAKE_PHONE));
  contractError(
    await timedCall(client, "submit_contribution", { ...submissionFor(802, base), relatedCode: "ZZ-9999", relationType: "integra" }),
    "unknown_related_code",
    "codice collegato inesistente"
  );
  contractError(await timedCall(client, "submit_contribution", { ...first, problem: "Un altro contenuto per la stessa chiave di idempotenza." }), "idempotency_conflict", "stessa chiave, contenuto diverso");
  contractError(await timedCall(client, "get_contribution_status", { code: "ZZ-9999" }), "not_found", "codice sconosciuto");
  contractError(await timedCall(client, "get_contribution_status", {}), "identity_required", "stato senza codice in fase 1");

  const anonymous = await rawPost(INITIALIZE, { auth: false });
  const anonymousText = await anonymous.text();
  check(anonymous.status === 401 && anonymousText === JSON.stringify({ error: "unauthorized" }) && !anonymous.headers.get("www-authenticate"), "senza token", `HTTP ${anonymous.status} ${anonymousText}, WWW-Authenticate ${anonymous.headers.get("www-authenticate") ?? "assente"}`);
  const madeUp = `${CONNECTOR_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  const inQuery = await rawPost(INITIALIZE, { target: new URL(`${url.href}?token=${madeUp}`) });
  const inQueryText = await inQuery.text();
  check(inQuery.status === 400 && inQueryText === JSON.stringify({ error: "token_in_url" }) && !inQueryText.includes(madeUp), "token nella query (token inventato)", `HTTP ${inQuery.status} ${inQueryText}, nessuna eco`);
  // Ogni metodo che Next gestisce, tranne POST: 405 dalla rotta (non da Next), con l'igiene.
  for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" } });
    const text = await response.text();
    const expectedBody = method === "HEAD" ? "" : JSON.stringify({ error: "method_not_allowed" });
    check(
      response.status === 405 && response.headers.get("allow") === "POST" && response.headers.get("cache-control") === "no-store" && text === expectedBody,
      `${method}`,
      `HTTP ${response.status}, Allow: ${response.headers.get("allow")}, Cache-Control: ${response.headers.get("cache-control")} ${text}`
    );
  }
  const origin = await rawPost(INITIALIZE, { headers: { origin: "https://non-ammessa.example" } });
  const originText = await origin.text();
  check(origin.status === 403 && originText === JSON.stringify({ error: "origin_not_allowed" }), "Origin non ammesso", `HTTP ${origin.status} ${originText}`);
  const textPlain = await fetch(url, {
    method: "POST",
    headers: { "content-type": "text/plain", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify(INITIALIZE),
  });
  const textPlainBody = await textPlain.text();
  check(textPlain.status === 415 && textPlainBody === JSON.stringify({ error: "unsupported_media_type" }), "Content-Type diverso da JSON", `HTTP ${textPlain.status} ${textPlainBody}`);
  const tooLarge = await rawPost({ jsonrpc: "2.0", id: 3, method: "tools/list", params: { padding: "a".repeat(BODY_MAX_BYTES + 1024) } });
  const tooLargeBody = await tooLarge.text();
  check(tooLarge.status === 413 && tooLargeBody === JSON.stringify({ error: "payload_too_large" }), "corpo oltre 256 KB", `HTTP ${tooLarge.status} ${tooLargeBody}`);
  const notAcceptable = await rawPost(INITIALIZE, { headers: { accept: "application/json" } });
  await notAcceptable.text();
  check(notAcceptable.status === 406, "Accept senza text/event-stream", `HTTP ${notAcceptable.status} (controllo dell'SDK)`);
  const hygiene = await rawPost(INITIALIZE);
  await hygiene.text();
  check(hygiene.headers.get("cache-control") === "no-store" && hygiene.headers.get("x-content-type-options") === "nosniff", "intestazioni di igiene", "Cache-Control: no-store, X-Content-Type-Options: nosniff");

  // Tempi: invii a caldo.
  const timings = [];
  let warmOk = 0;
  for (let n = 1; n <= warmRuns; n++) {
    const run = await timedCall(client, "submit_contribution", submissionFor(n, base));
    timings.push(run.ms);
    if (!run.result.isError && run.content.ok === true && run.content.duplicate === false) warmOk += 1;
  }
  const p95 = percentile(timings, 95);
  check(warmOk === warmRuns, `${warmRuns} invii a caldo`, `${warmOk}/${warmRuns} riusciti`);
  const warmLine = `p50 ${round(percentile(timings, 50))}, p95 ${round(p95)}, max ${round(Math.max(...timings))}`;
  check(p95 < P95_LIMIT_MS, "tempi dell'invio a caldo", `${warmLine} (criterio p95 < ${P95_LIMIT_MS} ms)`);
  await client.close();

  note(`primo invio ${code}, ${sent.content.statusCode}; stessa chiave: duplicate ${again.content.duplicate}`);
  note(`${warmRuns} invii a caldo: ${warmOk} riusciti, ${warmLine} (criterio p95 < ${P95_LIMIT_MS} ms)`);
  note(`prime chiamate del giro (a freddo se il server è appena partito; non contano per il criterio): initialize ${round(init?.ms ?? coldInitMs)}, prima guida ${round(guide.ms)}, primo invio ${round(firstSubmitMs)}`);
  return finish();
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(safe(`[FAIL] errore: ${error instanceof Error ? `${error.name}: ${error.message}` : "sconosciuto"}`));
    process.exit(1);
  });
