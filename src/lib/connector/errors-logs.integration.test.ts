import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { SubmitContributionDeps } from "../portfolio/submit-contribution.ts";
import { CONNECTOR_TOKEN_PREFIX, hashIntegrationToken } from "./auth.ts";
import { CONNECTOR_ERROR_CODES, type ConnectorErrorCode } from "./contract.ts";
import { EXAMPLE_CONNECTOR_PROFILE_INPUT, EXAMPLE_INSTRUCTIONS_TEMPLATE, exampleSubmission } from "./contract.fixtures.ts";
import type { ExposedTokenAlertDeps } from "./exposed-token-alert.ts";
import type { ConnectorHandlerDeps } from "./handler.ts";
import { MCP_BODY_MAX_BYTES } from "./http-hygiene.ts";
import { EXAMPLE_GUIDE } from "./tools.fixtures.ts";

// Opt-in integration suite (prompt WP10, criteria 7 and 13) on the connector's own local
// cluster: every error code of the contract is reached through the real route with an input
// or a state made for it, always HTTP 200 with `isError: true` and
// `{ error, message, fieldErrors?, retryAfterSeconds? }` repeated as JSON text; then the whole
// output of the process (every write to stdout and stderr, so console and anything else),
// captured from the first to the last test and through the error paths of zod, of the
// database (real Postgres errors whose messages carry payload text) and of the work after the
// response, contains no token, hash, submission text, name, email or other value sent by
// the client. Real gate, token table, `connector_rate_limits`, shared submit service, search
// and status SQL, driven through the route handler in memory; the database failures are real
// statements on the local database, injected where the app would call its queries. Ranking
// and notifications are fakes that fail with payload text (no model, no network).
//   node scripts/connettore-test/run-db-tests.mjs
// Same guards as route.integration.test.ts. Synthetic data, created and deleted here; the test
// tokens are generated at run time and never printed.
const url = process.env.DATABASE_URL;
const enabled = process.env.CONN_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Connector DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

// A: acceso (prefisso EA). S: sospeso. R: zero letture l'ora. G: guida oltre 20.000 caratteri
// (scritta a mano, come una guida vecchia: lo schema di K8 non la farebbe entrare). E: ESG attivo.
type Ws = "a" | "s" | "r" | "g" | "e";
const WORKSPACES: readonly Ws[] = ["a", "s", "r", "g", "e"];
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), user: randomUUID(), a: randomUUID(), s: randomUUID(), r: randomUUID(), g: randomUUID(), e: randomUUID() };
const slug = (ws: Ws) => `k10-err-${ws}-${suffix}`;
const tokens = {} as Record<Ws | "leakA" | "restA", { token: string; id: string }>;

// Valori scritti dal «client»: non devono mai uscire nelle risposte d'errore né nel log.
const TITLE = `Verbali automatici di Persona Inventata ${suffix}`;
const SUBMITTER = { name: `Persona Inventata ${suffix}`, email: `inventata.${suffix}@esempio.test` };
const AREA_SENTINEL = `area-inventata-${suffix}`;
const PHONE = "+39 347 123 4567";
const THIRD_EMAIL = `terza.persona.${suffix}@esempio.test`;
const QUERY_SENTINEL = `fatture di Persona Inventata ${suffix}`;
const BODY_SENTINEL = `corpo-riservato-${suffix}`;
const MADE_UP = `${CONNECTOR_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
const fakeAlertDeps: ExposedTokenAlertDeps = { findAdminChannel: async () => null, post: async () => undefined };

let base: ConnectorHandlerDeps;
let withSubmit: (patch: Partial<SubmitContributionDeps>) => ConnectorHandlerDeps;
let handle: (request: Request, slug: string, deps: ConnectorHandlerDeps) => Promise<Response>;
let handleRest: typeof import("../portfolio/submission-http.ts").handlePortfolioSubmissionPost;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
const tasks: Array<() => Promise<void>> = [];
const seen = new Set<ConnectorErrorCode>();

// Tutto ciò che il processo scrive su stdout e stderr durante la suite.
const chunks: string[] = [];
const originalWrite = { out: process.stdout.write, err: process.stderr.write };
function capture(stream: NodeJS.WriteStream, original: typeof process.stdout.write) {
  stream.write = function write(this: NodeJS.WriteStream, chunk: unknown, ...rest: unknown[]) {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    return (original as (...args: unknown[]) => boolean).call(this, chunk, ...rest);
  } as typeof process.stdout.write;
}

const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0];
type Structured = Record<string, unknown>;
type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }>; structuredContent: Structured };

function request(ws: Ws, init: { token?: string | null; body?: string; headers?: Record<string, string>; query?: string } = {}) {
  const token = init.token === undefined ? tokens[ws].token : init.token;
  return new Request(`http://127.0.0.1:53130/api/mcp/connettore/${slug(ws)}${init.query ?? ""}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    body: init.body ?? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

let rpcId = 0;
async function callTool(ws: Ws, name: string, args: object, deps: ConnectorHandlerDeps = base): Promise<ToolResult> {
  rpcId += 1;
  const response = await handle(
    request(ws, { body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method: "tools/call", params: { name, arguments: args } }) }),
    slug(ws),
    deps
  );
  assert.equal(response.status, 200, "HTTP sempre 200 per un tools/call");
  return ((await response.json()) as { result: ToolResult }).result;
}

const CLIENT_VALUES = [TITLE, SUBMITTER.name, SUBMITTER.email, AREA_SENTINEL, PHONE, "3471234567", THIRD_EMAIL, QUERY_SENTINEL, BODY_SENTINEL];

/** Il formato d'errore del contratto (criterio 7), mai con i valori ricevuti. */
function expectContractError(result: ToolResult, code: ConnectorErrorCode): Structured {
  const content = result.structuredContent;
  assert.equal(result.isError, true, code);
  assert.equal(content.error, code);
  assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(content) }], `${code}: copia testuale JSON`);
  for (const key of Object.keys(content)) assert.ok(["error", "message", "fieldErrors", "retryAfterSeconds"].includes(key), `${code}: campo ${key}`);
  assert.equal(typeof content.message, "string");
  assert.ok(String(content.message).length > 0);
  if (content.fieldErrors !== undefined) {
    assert.ok(content.fieldErrors && typeof content.fieldErrors === "object" && !Array.isArray(content.fieldErrors), code);
    for (const [field, message] of Object.entries(content.fieldErrors as Record<string, unknown>)) {
      assert.match(field, /^[A-Za-z0-9_.]+$/, code);
      assert.equal(typeof message, "string", code);
    }
  }
  if (content.retryAfterSeconds !== undefined) assert.ok(Number.isInteger(content.retryAfterSeconds) && Number(content.retryAfterSeconds) > 0, code);
  const text = JSON.stringify(result);
  assert.equal(text.includes("Input validation error"), false, code);
  for (const value of CLIENT_VALUES) assert.equal(text.includes(value), false, `${code}: un valore ricevuto nella risposta`);
  seen.add(code);
  return content;
}

const submission = (overrides: Parameters<typeof exampleSubmission>[0] = {}) =>
  exampleSubmission({ idempotencyKey: `k10-err-${suffix}-${randomBytes(3).toString("hex")}`, title: TITLE, submittedBy: SUBMITTER, ...overrides });

/** Un errore vero di Postgres il cui messaggio contiene il valore passato (22P02, «invalid input syntax»). */
async function realDatabaseError(value: string): Promise<never> {
  await q(`SELECT $1::int AS n`, [value]);
  throw new Error("il database avrebbe dovuto rifiutare il valore");
}

before(async () => {
  if (!enabled) return;
  capture(process.stdout, originalWrite.out);
  capture(process.stderr, originalWrite.err);
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  const [integrations, appTools, handler, rest] = await Promise.all([
    import("../db/queries/workspace-integrations.ts"),
    import("./app-tools.ts"),
    import("./handler.ts"),
    import("../portfolio/submission-http.ts"),
  ]);
  handle = handler.handleConnectorRequest;
  handleRest = rest.handlePortfolioSubmissionPost;
  // Dopo la risposta: il ranking fallisce con un errore che porta il titolo e il token (come
  // un errore dell'SDK che ripete l'input); la notifica con un errore vero del database che
  // porta l'email di chi propone.
  const submit: SubmitContributionDeps = {
    ...rest.appSubmitContributionDeps,
    autoScore: async () => {
      throw new Error(`Ranking fallito per «${TITLE}» con ${tokens.a.token}`);
    },
    notify: async () => realDatabaseError(SUBMITTER.email),
  };
  const env = { MCP_CONNECTOR_ENABLED: "true" };
  const schedule = (task: () => Promise<void>) => tasks.push(task);
  base = appTools.appConnectorHandlerDeps({ schedule, env, submit, alertDeps: fakeAlertDeps });
  withSubmit = (patch) => appTools.appConnectorHandlerDeps({ schedule, env, submit: { ...submit, ...patch }, alertDeps: fakeAlertDeps });

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova (errori)', $2)`, [ids.org, `org-k10-err-${suffix}`]);
  await q(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Lateral Space di prova')`, [ids.user, `ls.k10.err.${suffix}@ls.test`]);
  const oversized = { ...EXAMPLE_GUIDE, notaAggiuntiva: "x".repeat(21_000) };
  for (const ws of WORKSPACES) {
    await q(`INSERT INTO workspaces (id, organization_id, name, esg_enabled) VALUES ($1, $2, $3, $4)`, [ids[ws], ids.org, `Workspace errori ${ws} ${suffix}`, ws === "e"]);
    await q(
      `INSERT INTO workspace_connector_configs (workspace_id, slug, enabled, code_prefix, workspace_display_name, guide, guide_version, limits, profile, instructions_template)
       VALUES ($1, $2, $3, $4, 'Alfa e Beta', $5::jsonb, '2026-10.1', $6::jsonb, $7::jsonb, $8)`,
      [
        ids[ws],
        slug(ws),
        ws !== "s",
        `E${ws.toUpperCase()}`,
        JSON.stringify(ws === "g" ? oversized : EXAMPLE_GUIDE),
        JSON.stringify(ws === "r" ? { readsPerHour: 0 } : {}),
        JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT),
        EXAMPLE_INSTRUCTIONS_TEMPLATE,
      ]
    );
    const created = await integrations.createConnectorIntegrationToken({ workspaceId: ids[ws], label: "Connettore di prova", createdByUserId: ids.user });
    tokens[ws] = { token: created.token, id: created.row.id };
  }
  const leak = await integrations.createConnectorIntegrationToken({ workspaceId: ids.a, label: "Connettore esposto", createdByUserId: ids.user });
  tokens.leakA = { token: leak.token, id: leak.row.id };
  const restA = await integrations.createWorkspaceIntegrationToken({ workspaceId: ids.a, label: "REST di prova", createdByUserId: ids.user });
  tokens.restA = { token: restA.token, id: restA.row.id };
});

after(async () => {
  if (!enabled) return;
  process.stdout.write = originalWrite.out;
  process.stderr.write = originalWrite.err;
  const patterns = [...WORKSPACES.map((ws) => ids[ws]), ...Object.values(tokens).map((t) => t.id)].map((p) => `%${p}%`);
  await q(`DELETE FROM connector_rate_limits WHERE bucket LIKE ANY($1::text[])`, [patterns]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
});

test("errori di validazione: invalid_payload (zod e guida), le regole incrociate, unknown_related_code e sensitive_content", opts, async () => {
  const invalid = expectContractError(await callTool("a", "submit_contribution", submission({ area: AREA_SENTINEL as never, beneficiaries: -1 })), "invalid_payload");
  assert.ok("area" in (invalid.fieldErrors as Structured) && "beneficiaries" in (invalid.fieldErrors as Structured), JSON.stringify(invalid.fieldErrors));
  // Un valore del profilo che la guida non contiene: la guida restringe senza cambiare lo schema.
  const guideOnly = { ...EXAMPLE_GUIDE, areas: (EXAMPLE_GUIDE.areas as Array<{ id: string }>).filter((area) => area.id !== "vendite") };
  await q(`UPDATE workspace_connector_configs SET guide = $2::jsonb WHERE workspace_id = $1`, [ids.a, JSON.stringify(guideOnly)]);
  try {
    const outside = expectContractError(await callTool("a", "submit_contribution", submission({ area: "vendite" })), "invalid_payload");
    assert.deepEqual(Object.keys(outside.fieldErrors as Structured), ["area"]);
  } finally {
    await q(`UPDATE workspace_connector_configs SET guide = $2::jsonb WHERE workspace_id = $1`, [ids.a, JSON.stringify(EXAMPLE_GUIDE)]);
  }
  expectContractError(await callTool("a", "submit_contribution", submission({ guardrails: undefined })), "missing_guardrails");
  expectContractError(await callTool("a", "submit_contribution", submission({ timeSavedMinutesPerRun: undefined })), "missing_impact_measure");
  expectContractError(await callTool("a", "submit_contribution", submission({ submittedBy: undefined })), "missing_submitter");
  expectContractError(await callTool("e", "submit_contribution", submission()), "missing_esg");
  expectContractError(await callTool("a", "submit_contribution", submission({ relatedCode: "EA-0999" })), "missing_relation_type");
  expectContractError(await callTool("a", "submit_contribution", submission({ relatedCode: "EA-0999", relationType: "integra" })), "unknown_related_code");
  const sensitive = expectContractError(
    await callTool(
      "a",
      "submit_contribution",
      submission({ promptSnippet: `Se serve, chiama il numero ${PHONE}.`, problem: `Le richieste arrivano anche da ${THIRD_EMAIL} e vanno smistate a mano.` })
    ),
    "sensitive_content"
  );
  assert.deepEqual(Object.keys(sensitive.fieldErrors as Structured).sort(), ["problem", "promptSnippet"]);
  // Nessuno di questi invii ha scritto una segnalazione.
  assert.equal(Number((await one(`SELECT count(*)::int AS n FROM use_cases WHERE workspace_id IN ($1, $2)`, [ids.a, ids.e])).n), 0);
});

test("errori di stato e di servizio: conflitto, in corso, limite, sospeso, salvataggio fallito e ripreso, errore interno, codice sconosciuto, identità", opts, async () => {
  // idempotency_conflict: stessa chiave, contenuto diverso.
  const first = submission({ idempotencyKey: `k10-err-${suffix}-conflict` });
  const created = await callTool("a", "submit_contribution", first);
  assert.equal(created.isError, undefined);
  assert.equal(created.structuredContent.code, "EA-0001");
  expectContractError(await callTool("a", "submit_contribution", { ...first, problem: "Un altro contenuto per la stessa chiave." }), "idempotency_conflict");

  // idempotency_in_progress: un invio resta fermo dentro il salvataggio, il secondo con la stessa chiave lo trova in corso.
  let release!: () => void;
  const latch = new Promise<void>((resolve) => (release = resolve));
  const slowDeps = withSubmit({
    createUseCase: async (data) => {
      await latch;
      return base.tools.submit.createUseCase(data);
    },
  });
  const pendingArgs = submission({ idempotencyKey: `k10-err-${suffix}-pending`, title: `${TITLE} (in corso)` });
  const slow = callTool("a", "submit_contribution", pendingArgs, slowDeps);
  for (let i = 0; i < 100; i += 1) {
    const row = await one(`SELECT status FROM external_contribution_submissions WHERE workspace_id = $1 AND idempotency_key = $2`, [ids.a, pendingArgs.idempotencyKey]);
    if (row?.status === "pending") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const inProgress = expectContractError(await callTool("a", "submit_contribution", pendingArgs), "idempotency_in_progress");
  assert.ok(Number(inProgress.retryAfterSeconds) >= 1 && Number(inProgress.retryAfterSeconds) <= 5);
  release();
  assert.equal((await slow).structuredContent.duplicate, false);

  // rate_limited: un workspace con zero letture l'ora.
  const limited = expectContractError(await callTool("r", "get_intake_guide", {}), "rate_limited");
  assert.ok(Number(limited.retryAfterSeconds) > 0 && Number(limited.retryAfterSeconds) <= 3600);

  // connector_disabled: ogni tool del connettore sospeso.
  for (const name of ["get_intake_guide", "find_similar_contributions", "submit_contribution", "get_contribution_status"]) {
    expectContractError(await callTool("s", name, {}), "connector_disabled");
  }

  // submit_failed: il salvataggio riceve un errore vero del database con il titolo nel messaggio...
  const failing = submission({ idempotencyKey: `k10-err-${suffix}-failed` });
  expectContractError(await callTool("a", "submit_contribution", failing, withSubmit({ createUseCase: async (data) => realDatabaseError(String(data.title)) })), "submit_failed");
  const failedRow = await one(`SELECT status FROM external_contribution_submissions WHERE workspace_id = $1 AND idempotency_key = $2`, [ids.a, failing.idempotencyKey]);
  assert.equal(failedRow.status, "failed");
  // ...e lo stesso invio, ripetuto con la stessa chiave, si salva.
  const retried = await callTool("a", "submit_contribution", failing);
  assert.equal(retried.isError, undefined);
  assert.equal(retried.structuredContent.duplicate, false);
  assert.match(String(retried.structuredContent.code), /^EA-\d{4}$/);

  // internal_error: una guida troppo grande nel database e una lettura che riceve un errore vero del database.
  expectContractError(await callTool("g", "get_intake_guide", {}), "internal_error");
  const brokenSearch: ConnectorHandlerDeps = { ...base, tools: { ...base.tools, searchContributions: async ({ input }) => realDatabaseError(input.query) } };
  expectContractError(await callTool("a", "find_similar_contributions", { query: QUERY_SENTINEL }, brokenSearch), "internal_error");

  expectContractError(await callTool("a", "get_contribution_status", { code: "EA-0999" }), "not_found");
  expectContractError(await callTool("a", "get_contribution_status", {}), "identity_required");
});

test("ogni codice d'errore del contratto si è ottenuto con un input apposito", opts, () => {
  assert.deepEqual([...seen].sort(), [...CONNECTOR_ERROR_CODES].sort());
});

test("dopo la risposta: ranking e notifica falliscono con il testo nei loro errori, la segnalazione resta Ricevuta", opts, async () => {
  assert.ok(tasks.length >= 3, String(tasks.length));
  for (const task of tasks.splice(0)) await task();
  const row = await one(`SELECT status::text AS status, portfolio_review_status::text AS review FROM use_cases WHERE workspace_id = $1 AND code = 'EA-0001'`, [ids.a]);
  assert.deepEqual([row.status, row.review], ["proposed", "needs_inputs"]);
});

test("percorsi d'errore dell'ingresso: 401, token nell'indirizzo, Origin, Content-Type, corpo troppo grande, JSON non valido", opts, async () => {
  const expectGate = async (req: Request, status: number, error: string) => {
    const response = await handle(req, slug("a"), base);
    assert.equal(response.status, status, error);
    const text = await response.text();
    assert.equal(text, JSON.stringify({ error }));
    for (const value of [...CLIENT_VALUES, MADE_UP, tokens.leakA.token]) assert.equal(text.includes(value), false);
  };
  await expectGate(request("a", { token: MADE_UP }), 401, "unauthorized");
  await expectGate(request("a", { query: `?token=${MADE_UP}` }), 400, "token_in_url");
  await expectGate(request("a", { query: `?access_token=${tokens.leakA.token}` }), 400, "token_in_url");
  assert.notEqual((await one(`SELECT exposed_at FROM workspace_integration_tokens WHERE id = $1`, [tokens.leakA.id])).exposed_at, null, "il token valido nell'indirizzo è esposto");
  await expectGate(request("a", { headers: { origin: `https://${SUBMITTER.name.toLowerCase().replaceAll(" ", "-")}.esempio.test` } }), 403, "origin_not_allowed");
  await expectGate(request("a", { headers: { "content-type": "text/plain" }, body: BODY_SENTINEL }), 415, "unsupported_media_type");
  await expectGate(request("a", { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { x: BODY_SENTINEL.repeat(Math.ceil(MCP_BODY_MAX_BYTES / BODY_SENTINEL.length) + 1) } }) }), 413, "payload_too_large");
  await expectGate(request("a", { body: `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":"${BODY_SENTINEL}` }), 400, "invalid_json");
});

test("REST: un payload non valido e un invio valido con il token REST, nella stessa cattura", opts, async () => {
  const post = (body: unknown) =>
    handleRest(
      new Request("http://127.0.0.1/api/mcp/portfolio/submissions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tokens.restA.token}` },
        body: JSON.stringify(body),
      }),
      { schedule: () => {}, deps: { autoScore: async () => { throw new Error(`non usato ${TITLE}`); }, notify: async () => {} } }
    );
  const restPayload = {
    idempotencyKey: `k10-err-rest-${suffix}`,
    confirmedByUser: true,
    contributionKind: "best_practice",
    submittedBy: { name: SUBMITTER.name, email: SUBMITTER.email },
    title: `${TITLE} (REST)`,
    problem: "Le richieste ricorrenti si smistano a mano.",
    flowDescription: "Un assistente prepara le bozze di risposta.",
    humanInTheLoop: "Chi risponde controlla ogni bozza.",
    expectedImpact: "Meno tempo per le risposte ricorrenti.",
    dataRequirements: "Archivio delle risposte già inviate.",
  };
  assert.equal((await post({ ...restPayload, contributionKind: AREA_SENTINEL })).status, 422);
  assert.equal((await post(restPayload)).status, 201);
});

test("log: tutto l'output del processo durante la suite, compresi i percorsi d'errore, non ha token, hash, testi, nomi né email", opts, () => {
  const output = chunks.join("");
  const secrets = [...Object.values(tokens).flatMap((t) => [t.token, hashIntegrationToken(t.token)]), MADE_UP, hashIntegrationToken(MADE_UP)];
  for (const secret of secrets) assert.equal(output.includes(secret), false, "un token o un hash nell'output");
  for (const value of [...CLIENT_VALUES, "Persona Inventata", "persona-inventata", "esempio.test"]) assert.equal(output.includes(value), false, "un valore del client nell'output");
  // La cattura funziona: ci sono le righe delle chiamate, con ogni codice d'errore del contratto e dell'ingresso...
  const calls = output.split("\n").filter((line) => line.includes("[mcp] call "));
  for (const outcome of [...CONNECTOR_ERROR_CODES, "unauthorized", "token_in_url", "origin_not_allowed", "unsupported_media_type", "payload_too_large", "invalid_json"]) {
    assert.ok(calls.some((line) => line.includes(`"outcome":"${outcome}"`)), `riga di log per ${outcome}`);
  }
  assert.ok(calls.some((line) => line.includes('"outcome":"origin_not_allowed"') && line.includes('"origin":"other"')));
  // ...e gli errori veri del database e dopo la risposta, scritti solo con nome e codice.
  for (const event of ["[portfolio/submit] submit_failed", "[connector] tool_failed", "[connector] guide_too_large", "[portfolio/submit] auto_ranking_failed", "[portfolio/submit] notify_failed"]) {
    assert.ok(output.includes(event), event);
  }
  assert.ok(output.split("\n").some((line) => line.includes("[portfolio/submit] submit_failed") && line.includes('"code":"22P02"')));
  assert.ok(output.split("\n").some((line) => line.includes("[connector] tool_failed") && line.includes('"code":"22P02"')));
});
