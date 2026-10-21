// Smoke of the team MCP «Unbundle Use case» (docs/use-case/DESIGN.md §9.4, PIANO-LAVORI H5a,
// stop H-C) against a running Unbundle server, with the official SDK client (Client +
// StreamableHTTPClientTransport), as claude.ai or Claude Code would connect.
//
// Client mode (any server; the tokens come only from the environment and are never printed,
// written to a file or put in a URL):
//
//   UB_TEAM_TEST_TOKEN=… USE_CASE_MCP_SMOKE_URL=http://127.0.0.1:53120/api/mcp/use-case \
//     node --no-warnings scripts/use-case-mcp-smoke.mjs
//
//   UB_TEAM_TEST_TOKEN                  personal token of a reviewer (required)
//   UB_TEAM_TEST_TOKEN_READONLY         optional: a «Solo lettura» token (writes must be refused)
//   UB_TEAM_TEST_TOKEN_REFUSED          optional: a token whose owner is not a reviewer (401)
//   USE_CASE_MCP_SMOKE_WORKSPACE_NAME   optional: the instructions must be exactly §9.4 for that name
//   USE_CASE_MCP_SMOKE_MODE=read        optional: only reads (initialize, tools/list, search, negatives)
//
// Local harness mode: prepares a synthetic workspace, three people and four test tokens in the
// hub's local test database (the one the app uses), runs the client mode as a child process with
// the tokens in its environment, checks the saved rows, then revokes the tokens and deletes the
// synthetic data (with --keep only the tokens are revoked):
//
//   node scripts/uc-test/start-app.mjs --build
//   node scripts/uc-test/start-app.mjs --production --flag USE_CASE_HUB_WORKSPACES=<uuid> --flag MCP_TEAM_ENABLED=true &
//   UC_TEST_PG_PORT=55479 UC_TEST_PG_DB=hub_<id> node --no-warnings scripts/use-case-mcp-smoke.mjs --local --workspace <uuid>
//
// <uuid> is any new UUID: the app has to know it before it starts (USE_CASE_HUB_WORKSPACES), the
// smoke creates the workspace with that id. Synthetic data only; SM is a synthetic code prefix.
//
// Checks: initialize (latest protocol, then a 2025-06-18 client), server name and instructions
// (≤ 2.048 characters, the cost line), tools/list (6 tools, titles, annotations, no
// outputSchema), search, create twice with the same key (duplicate), read, valuation with a cost
// band, approve, «Quando», a stale version (version_conflict), the negatives (no token 401,
// refused owner 401, token in the query 400 without echo, 405 with Allow: POST, Origin 403,
// Content-Type 415, read-only token on a write), then the warm reads with p95 < 2 s. Exit code
// 0 only if every check passes. Needs Node 22.6+ (it imports TypeScript modules of the MCP).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { TEAM_MCP_PROVIDER, TEAM_MCP_READ_SCOPE, TEAM_MCP_SCOPES, TEAM_MCP_TOKEN_PREFIX } from "../src/lib/use-cases/mcp/auth.ts";
import { TEAM_MCP_TOOL_ANNOTATIONS, TEAM_MCP_TOOL_NAMES, TEAM_MCP_TOOL_TEXT } from "../src/lib/use-cases/mcp/contract.ts";
import { TEAM_MCP_COST_LINE, TEAM_MCP_INSTRUCTIONS_MAX_CHARS, teamMcpInstructions } from "../src/lib/use-cases/mcp/instructions.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args.includes("--local")) process.exit(await localMain());
process.exit(await clientMain());

// ═══ Client mode ═════════════════════════════════════════════════════

async function clientMain() {
  const token = process.env.UB_TEAM_TEST_TOKEN?.trim();
  const readOnlyToken = process.env.UB_TEAM_TEST_TOKEN_READONLY?.trim() || null;
  const refusedToken = process.env.UB_TEAM_TEST_TOKEN_REFUSED?.trim() || null;
  const endpoint = process.env.USE_CASE_MCP_SMOKE_URL?.trim();
  const workspaceName = process.env.USE_CASE_MCP_SMOKE_WORKSPACE_NAME?.trim() || null;
  const readOnlyRun = process.env.USE_CASE_MCP_SMOKE_MODE?.trim() === "read";
  if (!token || !token.startsWith(TEAM_MCP_TOKEN_PREFIX)) {
    console.error("Set UB_TEAM_TEST_TOKEN to a personal team MCP token; it is never printed.");
    return 2;
  }
  if (!endpoint) {
    console.error("Set USE_CASE_MCP_SMOKE_URL, e.g. http://127.0.0.1:53120/api/mcp/use-case.");
    return 2;
  }
  const url = new URL(endpoint);
  if (url.search || url.hash || url.username || url.password) {
    console.error("USE_CASE_MCP_SMOKE_URL must not carry a query, a fragment or credentials.");
    return 2;
  }
  const secrets = [token, readOnlyToken, refusedToken].filter(Boolean);
  const safe = (text) => secrets.reduce((out, secret) => out.split(secret).join("[token]"), String(text));
  const results = [];
  const check = (condition, label, detail = "") => {
    results.push(Boolean(condition));
    console.log(safe(`${condition ? "[ok]   " : "[FAIL] "}${label}${detail ? `: ${detail}` : ""}`));
    return Boolean(condition);
  };
  const round = (ms) => `${Math.round(ms)} ms`;
  const runId = randomBytes(4).toString("hex");
  let keySeq = 0;
  const newKey = () => `smoke-${runId}-${String(++keySeq).padStart(3, "0")}`;

  async function connect({ bearer = token, rewriteVersion } = {}) {
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
    const transport = new StreamableHTTPClientTransport(url, { fetch: fetchImpl, requestInit: { headers: { authorization: `Bearer ${bearer}` } } });
    const client = new Client({ name: "unbundle-use-case-smoke", version: "1.0.0" });
    await client.connect(transport);
    return { client, transport, seen };
  }

  async function rawPost(body, { headers = {}, bearer = token, target = url } = {}) {
    return fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers },
      body: JSON.stringify(body),
    });
  }

  const INITIALIZE = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "smoke", version: "1" } } };

  async function call(client, name, toolArgs) {
    const started = performance.now();
    const result = await client.callTool({ name, arguments: toolArgs });
    return { isError: result.isError === true, content: result.structuredContent ?? {}, ms: performance.now() - started };
  }

  try {
    // ─── initialize, istruzioni, tools/list ───────────────────────────
    const coldStart = performance.now();
    const { client, transport, seen } = await connect();
    const init = seen.find((e) => e.method === "initialize");
    check(init?.status === 200 && transport.protocolVersion === LATEST_PROTOCOL_VERSION, "initialize", `protocollo ${transport.protocolVersion}, HTTP ${init?.status}, prima chiamata ${round(init?.ms ?? performance.now() - coldStart)}`);
    const server = client.getServerVersion();
    check(server?.name === "unbundle-use-case" && server?.title === "Unbundle Use case", "nome del server", `${server?.name} · ${server?.title}`);
    const instructions = client.getInstructions() ?? "";
    check(instructions.length > 0 && instructions.length <= TEAM_MCP_INSTRUCTIONS_MAX_CHARS && instructions.includes(TEAM_MCP_COST_LINE), "istruzioni", `${instructions.length} caratteri, riga sul costo presente`);
    if (workspaceName) check(instructions === teamMcpInstructions(workspaceName), "istruzioni del workspace", "testo di §9.4 con il nome del workspace");

    const { tools } = await client.listTools();
    check(JSON.stringify(tools.map((t) => t.name)) === JSON.stringify(TEAM_MCP_TOOL_NAMES), "tools/list", tools.map((t) => t.name).join(", "));
    const shapeOk = tools.every(
      (t) =>
        t.title === TEAM_MCP_TOOL_TEXT[t.name]?.title &&
        JSON.stringify(t.annotations) === JSON.stringify(TEAM_MCP_TOOL_ANNOTATIONS[t.name]) &&
        t.outputSchema === undefined &&
        t.inputSchema?.type === "object",
    );
    check(shapeOk, "titoli, annotazioni, schemi", "nessun outputSchema, nessun tool per cancellare o avviare");

    const old = await connect({ rewriteVersion: "2025-06-18" });
    const oldInit = old.seen.find((e) => e.method === "initialize");
    const oldTools = await old.client.listTools();
    check(oldInit?.protocolVersion === "2025-06-18" && oldTools.tools.length === 6, "client 2025-06-18", `negoziata ${oldInit?.protocolVersion}, tools/list ${oldTools.tools.length}`);
    await old.client.close();

    // ─── Letture ──────────────────────────────────────────────────────
    const search = await call(client, "search_use_cases", { limit: 5 });
    check(!search.isError && Array.isArray(search.content.results) && typeof search.content.total === "number", "search_use_cases", `${search.content.total} use case, ${round(search.ms)}`);
    const proposerKeys = /propos|submitter|email/i;
    const leaked = JSON.stringify(search.content).match(/"(proposedBy|proposed_by|submitterEmail|submittedByUserId)"/);
    check(!leaked, "nessun proponente nella ricerca");

    // ─── Scritture ────────────────────────────────────────────────────
    let code = null;
    if (!readOnlyRun) {
      const createKey = newKey();
      const create = await call(client, "create_use_cases", {
        items: [
          { title: `Smistamento richieste ${runId}`, problem: "Le richieste arrivano in una casella sola e si smistano a mano.", aiLab: "AI Lab di prova" },
          { title: `Riepilogo dei turni ${runId}`, problem: "I turni si contano a mano ogni settimana.", kind: "da_diffondere" },
        ],
        idempotencyKey: createKey,
        confirmedByUser: true,
      });
      const created = create.content.created ?? [];
      code = created[0]?.code ?? null;
      check(!create.isError && created.length === 2 && created.every((c) => /^[A-Z]{2,4}-\d{4,5}$/.test(c.code ?? "")), "create_use_cases", `${created.map((c) => c.code).join(", ")}, ${round(create.ms)}`);
      check(created.every((c) => typeof c.link === "string" && c.link.includes("/use-cases/")), "link alla scheda", created[0]?.link?.replace(/\/dashboard\/[^/]+/, "/dashboard/…") ?? "");
      const again = await call(client, "create_use_cases", {
        items: [
          { title: `Smistamento richieste ${runId}`, problem: "Le richieste arrivano in una casella sola e si smistano a mano.", aiLab: "AI Lab di prova" },
          { title: `Riepilogo dei turni ${runId}`, problem: "I turni si contano a mano ogni settimana.", kind: "da_diffondere" },
        ],
        idempotencyKey: createKey,
        confirmedByUser: true,
      });
      check(!again.isError && again.content.duplicate === true && JSON.stringify((again.content.created ?? []).map((c) => c.code)) === JSON.stringify(created.map((c) => c.code)), "stessa chiave: duplicato", "stessi codici, nessuna scheda in più");
      const conflict = await call(client, "create_use_cases", { items: [{ title: `Altro ${runId}`, problem: "Un altro problema." }], idempotencyKey: createKey, confirmedByUser: true });
      check(conflict.content.error === "idempotency_conflict", "stessa chiave, altro contenuto", String(conflict.content.error));
      const unconfirmed = await call(client, "create_use_cases", { items: [{ title: `Senza conferma ${runId}`, problem: "Non confermata." }], idempotencyKey: newKey(), confirmedByUser: false });
      check(unconfirmed.content.error === "invalid_payload" && unconfirmed.content.fieldErrors?.confirmedByUser, "senza conferma", "invalid_payload su confirmedByUser");
    }

    if (code) {
      const read = await call(client, "get_use_case", { code });
      const bands = read.content.costBands ?? [];
      check(!read.isError && read.content.code === code && bands.length === 5 && typeof read.content.version === "number", "get_use_case", `version ${read.content.version}, 5 fasce del workspace, ${round(read.ms)}`);
      check(!proposerKeys.test(Object.keys(read.content).join(" ")), "nessun proponente nella scheda");
      const valued = await call(client, "update_use_case", {
        code,
        expectedVersion: read.content.version,
        changes: { valuation: { valueEurYear: 60000, cost: { band: 2 } } },
        idempotencyKey: newKey(),
        confirmedByUser: true,
      });
      const costo = valued.content.useCase?.valuation?.costo;
      check(!valued.isError && costo?.band === 2 && costo?.source === "team_fascia" && costo?.bandLabel === bands[1]?.label, "update_use_case con una fascia", `version ${valued.content.version}, ${costo?.symbols} · ${costo?.bandLabel}`);
      const stale = await call(client, "update_use_case", { code, expectedVersion: read.content.version, changes: { title: `Titolo vecchio ${runId}` }, idempotencyKey: newKey(), confirmedByUser: true });
      check(stale.content.error === "version_conflict", "version vecchia", String(stale.content.error));
      const approved = await call(client, "decide_use_case", { code, expectedVersion: valued.content.version, decision: { type: "approva", quando: "questo_trimestre" }, idempotencyKey: newKey(), confirmedByUser: true });
      check(!approved.isError && approved.content.phase === "approvato" && approved.content.connectorStatus?.statusCode === "APPROVATA", "decide_use_case: approva", `${approved.content.phaseLabel}, ${round(approved.ms)}`);
      const when = await call(client, "set_priority", { code, expectedVersion: approved.content.version, quando: "prossimo_trimestre", idempotencyKey: newKey(), confirmedByUser: true });
      check(!when.isError && /^\d{4}-Q[1-4]$/.test(when.content.targetQuarter ?? ""), "set_priority", `${when.content.quando}`);
      const reopen = await call(client, "decide_use_case", { code, expectedVersion: when.content.version, decision: { type: "riapri" }, idempotencyKey: newKey(), confirmedByUser: true });
      check(reopen.content.error === "transizione_non_ammessa", "passaggio non ammesso", String(reopen.content.error));
    }

    // ─── Negativi ─────────────────────────────────────────────────────
    const anonymous = await rawPost(INITIALIZE, { bearer: null });
    check(anonymous.status === 401, "senza token", `HTTP ${anonymous.status}`);
    if (refusedToken) {
      const refused = await rawPost(INITIALIZE, { bearer: refusedToken });
      check(refused.status === 401, "proprietario senza ruolo da revisore", `HTTP ${refused.status}`);
    }
    const madeUp = `${TEAM_MCP_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
    const inQuery = await rawPost(INITIALIZE, { bearer: null, target: new URL(`${url.href}?token=${madeUp}`) });
    const inQueryText = await inQuery.text();
    check(inQuery.status === 400 && inQueryText.includes("token_in_url") && !inQueryText.includes(madeUp), "token nella query", `HTTP ${inQuery.status}, senza eco`);
    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(url, { method, headers: { authorization: `Bearer ${token}` } });
      check(response.status === 405 && response.headers.get("allow") === "POST", `${method}`, `HTTP ${response.status}, Allow: ${response.headers.get("allow")}`);
    }
    const origin = await rawPost(INITIALIZE, { headers: { origin: "https://esempio.test" } });
    check(origin.status === 403, "Origin non ammessa", `HTTP ${origin.status}`);
    const plain = await rawPost(INITIALIZE, { headers: { "content-type": "text/plain" } });
    check(plain.status === 415, "Content-Type non JSON", `HTTP ${plain.status}`);
    check(plain.headers.get("cache-control") === "no-store", "Cache-Control", plain.headers.get("cache-control") ?? "assente");
    if (readOnlyToken && code) {
      const ro = await connect({ bearer: readOnlyToken });
      const denied = await call(ro.client, "decide_use_case", { code, expectedVersion: 1, decision: { type: "riapri" }, idempotencyKey: newKey(), confirmedByUser: true });
      const allowed = await call(ro.client, "get_use_case", { code });
      check(denied.content.error === "permesso_mancante" && !allowed.isError, "token «Solo lettura»", "scrittura rifiutata, lettura ok");
      await ro.client.close();
    }

    // ─── Tempi delle letture a caldo ──────────────────────────────────
    const times = [];
    for (let i = 0; i < 20; i++) times.push((await call(client, "search_use_cases", { limit: 20 })).ms);
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1];
    check(p95 < 2000, "letture a caldo", `p95 ${round(p95)} su ${times.length} chiamate`);
    await client.close();
  } catch (error) {
    check(false, "errore inatteso", error instanceof Error ? error.name : "errore");
  }
  const passed = results.every(Boolean);
  console.log(passed ? `Smoke del MCP del team: ${results.length} controlli verdi.` : "Smoke del MCP del team: qualcosa non va.");
  return passed ? 0 : 1;
}

// ═══ Local harness mode ══════════════════════════════════════════════

async function localMain() {
  const requireFromApp = createRequire(resolve(repoRoot, "package.json"));
  const pg = requireFromApp("pg");
  const port = process.env.UC_TEST_PG_PORT?.trim() || "55479";
  const db = process.env.UC_TEST_PG_DB?.trim() ?? "";
  if (!/^\d+$/.test(port) || ["55439", "55449", "55469"].includes(port)) throw new Error("Use the hub's own test cluster port (default 55479)");
  if (!/^hub_[a-z0-9][a-z0-9_]{0,39}$/.test(db)) throw new Error("UC_TEST_PG_DB must be the hub package database the app uses (hub_<id>)");
  const workspaceId = option("--workspace")?.trim().toLowerCase();
  if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(workspaceId)) {
    throw new Error("--workspace <uuid>: the workspace the app has in USE_CASE_HUB_WORKSPACES");
  }
  const appPort = Number(process.env.UC_TEST_APP_PORT?.trim() || "53120");
  const keep = args.includes("--keep");
  const pool = new pg.Pool({ host: "127.0.0.1", port: Number(port), user: "uc_test", database: db, max: 2 });
  const q = async (text, params = []) => (await pool.query(text, params)).rows;
  const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
  const suffix = randomBytes(3).toString("hex");
  const ids = { org: randomUUID(), builder: randomUUID(), ls: randomUUID(), contributor: randomUUID() };
  const workspaceName = `Smoke del MCP del team ${suffix}`;
  const tokens = {};
  let exitCode = 1;

  async function insertToken(name, owner, scopes) {
    const token = `${TEAM_MCP_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const [row] = await q(
      `INSERT INTO workspace_integration_tokens (workspace_id, label, provider, token_hash, token_prefix, scopes, created_by_user_id, owner_user_id, expires_at)
       VALUES ($1, 'Smoke del MCP del team', $2, $3, $4, $5::jsonb, $6, $6, (now() AT TIME ZONE 'UTC') + interval '1 day') RETURNING id`,
      [workspaceId, TEAM_MCP_PROVIDER, sha256(token), `${token.slice(0, 14)}...`, JSON.stringify(scopes), owner],
    );
    tokens[name] = { token, id: row.id };
  }

  try {
    const [existing] = await q(`SELECT 1 FROM workspaces WHERE id = $1`, [workspaceId]);
    if (existing) throw new Error("The workspace already exists: pass a new UUID (and start the app with it)");
    await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova (smoke H5a)', $2)`, [ids.org, `org-h5a-smoke-${suffix}`]);
    await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, $3)`, [workspaceId, ids.org, workspaceName]);
    const people = [
      [ids.builder, `builder.smoke.${suffix}@cliente.test`, "function_lead"],
      [ids.ls, `ls.smoke.${suffix}@ls.test`, "transformation_lead"],
      [ids.contributor, `contributor.smoke.${suffix}@cliente.test`, "contributor"],
    ];
    for (const [id, email, role] of people) {
      await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, 'Persona di prova (smoke)', now())`, [id, email]);
      await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, $3::member_role)`, [workspaceId, id, role]);
    }
    await q(`INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix) VALUES ($1, $2, 'SM')`, [workspaceId, `h5a-smoke-${suffix}`]);
    await insertToken("builder", ids.builder, [...TEAM_MCP_SCOPES]);
    await insertToken("readOnly", ids.builder, [TEAM_MCP_READ_SCOPE]);
    await insertToken("refused", ids.contributor, [...TEAM_MCP_SCOPES]);

    const env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/private/tmp",
      UB_TEAM_TEST_TOKEN: tokens.builder.token,
      UB_TEAM_TEST_TOKEN_READONLY: tokens.readOnly.token,
      UB_TEAM_TEST_TOKEN_REFUSED: tokens.refused.token,
      USE_CASE_MCP_SMOKE_URL: `http://127.0.0.1:${appPort}/api/mcp/use-case`,
      USE_CASE_MCP_SMOKE_WORKSPACE_NAME: workspaceName,
    };
    const smoke = spawnSync(process.execPath, ["--no-warnings", fileURLToPath(import.meta.url)], { cwd: repoRoot, env, stdio: "inherit" });

    // Righe salvate dal server.
    const lines = [];
    const ok = [];
    const checkRow = (condition, label, detail) => {
      ok.push(Boolean(condition));
      lines.push(`${condition ? "[ok]   " : "[FAIL] "}${label}: ${detail}`);
    };
    const created = await q(
      `SELECT code, source, origin, proposed_by, intake, status::text AS status, cost_band, cost_eur_once FROM use_cases WHERE workspace_id = $1 ORDER BY code`,
      [workspaceId],
    );
    checkRow(created.length === 2, "schede create", `${created.length} (attese 2: il duplicato non ne crea)`);
    checkRow(created.every((r) => r.source === "team_mcp" && r.origin === "adoption" && r.proposed_by === null), "fonte, origine e proponente", "team_mcp, AI Adoption per un AI Builder del cliente, nessun proponente");
    checkRow(created.every((r) => r.intake?.hiddenFromSearch !== true), "visibili ai colleghi", "dal basso: non nascoste");
    checkRow(created[0]?.cost_band === 2 && created[0]?.cost_eur_once === null, "costo come fascia", `cost_band ${created[0]?.cost_band}, cost_eur_once ${created[0]?.cost_eur_once}`);
    const events = await q(
      `SELECT action, channel, actor_kind, actor_user_id FROM use_case_events WHERE workspace_id = $1 ORDER BY at`,
      [workspaceId],
    );
    checkRow(events.length > 0 && events.every((e) => e.channel === "mcp_team"), "Storia", `${events.length} righe, canale mcp_team`);
    checkRow(events.filter((e) => e.action === "creato").every((e) => e.actor_user_id === null), "nessun proponente nella Storia", "«creato» senza persona");
    const requests = await q(`SELECT tool, status, result FROM use_case_mcp_requests WHERE workspace_id = $1`, [workspaceId]);
    checkRow(requests.length > 0 && requests.filter((r) => r.tool === "create_use_cases").every((r) => r.status === "completed"), "richieste idempotenti", `${requests.length} righe`);
    checkRow(!requests.some((r) => JSON.stringify(r.result ?? {}).includes("Smistamento")), "risultati salvati senza testi", "solo id, codici e versioni");
    const buckets = await q(`SELECT bucket, count FROM connector_rate_limits WHERE bucket LIKE ANY($1::text[]) ORDER BY bucket`, [[`team:${tokens.builder.id}:%`, `team:ws:${workspaceId}:%`]]);
    const byKind = Object.fromEntries(buckets.map((b) => [b.bucket.split(":").slice(-1)[0], Number(b.count)]));
    lines.push(`[info] secchi: letture ${byKind.read ?? 0}, scritture ${byKind.write ?? 0}, schede del giorno ${byKind.day ?? 0} (il duplicato non consuma)`);
    const [token] = await q(`SELECT last_used_at IS NOT NULL AS used, exposed_at IS NULL AS not_exposed FROM workspace_integration_tokens WHERE id = $1`, [tokens.builder.id]);
    checkRow(token.used && token.not_exposed, "token di prova", "last_used_at aggiornato, mai segnato come esposto");
    const [refused] = await q(`SELECT last_used_at IS NULL AS unused FROM workspace_integration_tokens WHERE id = $1`, [tokens.refused.id]);
    checkRow(refused.unused, "token rifiutato", "nessun uso registrato");
    console.log("Righe nel database locale:");
    for (const line of lines) console.log(line);
    exitCode = smoke.status === 0 && ok.every(Boolean) ? 0 : 1;
  } catch (error) {
    console.error(`[FAIL] ${error instanceof Error ? error.message : "errore"}`);
  } finally {
    try {
      const tokenIds = Object.values(tokens).map((t) => t.id);
      if (tokenIds.length) await q(`UPDATE workspace_integration_tokens SET revoked_at = now() AT TIME ZONE 'UTC' WHERE id = ANY($1::uuid[])`, [tokenIds]);
      if (!keep) {
        await q(`DELETE FROM connector_rate_limits WHERE bucket LIKE ANY($1::text[])`, [[...tokenIds.map((id) => `team:${id}:%`), `team:ws:${workspaceId}:%`]]);
        await q(`DELETE FROM workspaces WHERE id = $1 AND organization_id = $2`, [workspaceId, ids.org]);
        await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
        await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.builder, ids.ls, ids.contributor]]);
      }
      console.log(keep ? "Token revocati; workspace di prova tenuto." : "Token revocati e dati sintetici cancellati.");
    } catch {
      console.error("[FAIL] pulizia non riuscita");
      exitCode = 1;
    }
    await pool.end();
  }
  return exitCode;
}
