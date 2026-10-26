import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as nodeModule from "node:module";

/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

// MCP del team «Unbundle Use case» sul database del pacchetto (docs/use-case/PIANO-LAVORI.md H5a,
// docs/use-case/DESIGN.md §9.4, §12.5 test 5 e criterio 5; decisioni D3, D9, D15).
//
// La rotta vera in memoria (`handleTeamMcpRequest` con `appTeamMcpHandlerDeps`): token personali
// nella tabella vera, ruolo riletto a ogni richiesta, servizio unico, letture proiettate,
// `use_case_mcp_requests` e `connector_rate_limits` veri. Il client è quello dell'SDK, come
// claude.ai o Claude Code. Notifiche e Slack finti; le action della pagina con una sessione finta
// (`@/lib/auth`), `revalidatePath` e `after` registrati invece di toccare Next.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). Dentro `npm run check` si salta: in testa solo moduli di Node; i moduli dell'app e
//   dell'SDK arrivano con `await import()` dentro `before()`.
// - Dati sintetici, creati e cancellati qui. I token si generano qui, si salvano come hash e non
//   si stampano mai.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) {
    throw new Error("Run this suite only on a package database hub_<id>");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type Client = import("@modelcontextprotocol/sdk/client/index.js").Client;
type HandlerDeps = import("./handler.ts").TeamHandlerDeps;
type Result = import("../decision-ui.ts").DecisionActionResult;

let ClientCtor: typeof import("@modelcontextprotocol/sdk/client/index.js").Client;
let Transport: typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js").StreamableHTTPClientTransport;
let handle: typeof import("./handler.ts").handleTeamMcpRequest;
let appDeps: typeof import("./app-deps.ts");
let contract: typeof import("./contract.ts");
let instructions: typeof import("./instructions.ts");
let permissions: typeof import("../permissions.ts");
let quarter: typeof import("../quarter.ts");
let decisionsPage: typeof import("../../actions/use-case-decisions.ts");
let editPage: typeof import("../../actions/use-case-edit.ts");
let createPage: typeof import("../../actions/use-case-create.ts");
let needsPage: typeof import("../../actions/use-case-needs.ts");
let needsReads: typeof import("../../db/queries/use-case-needs.ts");
let rest: typeof import("../../portfolio/submission-http.ts");
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let deps: HandlerDeps;

const ENDPOINT = "http://127.0.0.1:53120/api/mcp/use-case";
const TEAM_PREFIX = "ub_" + "team_";
const V1_PREFIX = "ub_" + "mcp_";
const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  wsA: randomUUID(),
  wsB: randomUUID(),
  template: randomUUID(),
  ls: randomUUID(),
  builder: randomUUID(),
  manager: randomUUID(),
  contributor: randomUUID(),
  learner: randomUUID(),
};
const emails = {
  ls: `ls.h5a.${suffix}@ls.test`,
  builder: `builder.h5a.${suffix}@cliente.test`,
  manager: `manager.h5a.${suffix}@cliente.test`,
  contributor: `contributor.h5a.${suffix}@cliente.test`,
  learner: `learner.h5a.${suffix}@cliente.test`,
};
type Person = keyof typeof emails;
const ROLE: Record<Person, string> = { ls: "transformation_lead", builder: "function_lead", manager: "exec_sponsor", contributor: "contributor", learner: "learner" };
const WORKSPACE_NAME = `Alfa e Beta ${suffix}`;
const BAND_LABELS = ["Fino a 10.000 €", "Da 10.000 a 40.000 €", "Da 40.000 a 100.000 €", "Da 100.000 a 200.000 €", "200.000 € e oltre"];

const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "VERCEL_ENV"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const ENV = { MCP_TEAM_ENABLED: "true", USE_CASE_HUB_WORKSPACES: "", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:53120" };

const state = globalThis as { __hubH5aSession?: unknown; __hubH5aRevalidated?: string[]; __hubH5aAfter?: Array<() => unknown> };
const tasks: Array<() => Promise<void>> = [];
const notified: string[] = [];
const tokens = {} as Record<string, { token: string; id: string }>;

// Ogni riga scritta su console durante la suite: alla fine nessun token, hash o testo delle schede.
const captured: string[] = [];
const originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0];

function signIn(person: Person | null) {
  state.__hubH5aSession = person ? { user: { id: ids[person], email: emails[person], emailVerified: true, name: `Persona ${person}`, image: null } } : null;
}

async function insertToken(
  name: string,
  opts: { person?: Person | null; workspaceId?: string; provider?: string; scopes?: string[]; prefix?: string; expired?: boolean; revoked?: boolean } = {},
) {
  const token = `${opts.prefix ?? TEAM_PREFIX}${randomBytes(32).toString("base64url")}`;
  const owner = opts.person === null ? null : ids[opts.person ?? "builder"];
  const [row] = await q(
    `INSERT INTO workspace_integration_tokens (workspace_id, label, provider, token_hash, token_prefix, scopes, created_by_user_id, owner_user_id, expires_at, revoked_at)
     VALUES ($1::uuid, 'Token di prova H5a', $2, $3, $4, $5::jsonb, $6::uuid, $7::uuid,
       (now() AT TIME ZONE 'UTC') + make_interval(days => $8::int), CASE WHEN $9::boolean THEN now() AT TIME ZONE 'UTC' END)
     RETURNING id`,
    [
      opts.workspaceId ?? ids.wsA,
      opts.provider ?? "unbundle_team_mcp",
      sha256(token),
      `${token.slice(0, 14)}...`,
      JSON.stringify(opts.scopes ?? ["use_cases:read", "use_cases:write"]),
      ids.builder,
      owner,
      opts.expired ? -1 : 90,
      opts.revoked === true,
    ],
  );
  tokens[name] = { token, id: String(row.id) };
  return tokens[name];
}

let codeSeq = 90000 + Math.floor(Math.random() * 5000);

interface CardSeed {
  workspaceId?: string;
  title?: string;
  status?: string;
  review?: string;
  kind?: string | null;
  intake?: Record<string, unknown> | null;
  targetQuarter?: string | null;
  proposedBy?: string | null;
  costBand?: number | null;
}

/** Una scheda sintetica in uno stato preciso, scritta senza passare dal servizio. */
async function seed(c: CardSeed = {}): Promise<{ id: string; code: string }> {
  const id = randomUUID();
  const code = `XX-${codeSeq++}`;
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, intake, target_quarter, proposed_by, source, cost_band)
     VALUES ($1::uuid, $2::uuid, $3, 'Problema di prova H5a', $4::use_case_status, $5::portfolio_review_status, $6, $7, $8::jsonb, $9, $10, 'web_proposed', $11)`,
    [
      id,
      c.workspaceId ?? ids.wsA,
      c.title ?? `Proposta di prova H5a ${suffix}`,
      c.status ?? "proposed",
      c.review ?? "in_review",
      c.kind === undefined ? "use_case_ai" : c.kind,
      code,
      c.intake === undefined ? null : JSON.stringify(c.intake),
      c.targetQuarter ?? null,
      c.proposedBy ?? null,
      c.costBand ?? null,
    ],
  );
  return { id, code };
}

async function row(id: string): Promise<Record<string, unknown>> {
  const r = await one(`SELECT *, review_by::text AS review_by_text FROM use_cases WHERE id = $1::uuid`, [id]);
  assert.ok(r, "la scheda c'è");
  return r;
}

async function versionOf(id: string): Promise<number> {
  return Number((await row(id)).version);
}

async function storia(id: string) {
  return q(`SELECT action, channel, actor_kind, actor_user_id, fields, phase_after FROM use_case_events WHERE use_case_id = $1::uuid ORDER BY at, id`, [id]);
}

async function connect(token: string, d: HandlerDeps = deps): Promise<Client> {
  const transport = new Transport(new URL(ENDPOINT), {
    fetch: async (input, init) => handle(new Request(input, init), d),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new ClientCtor({ name: "prova-h5a", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

type Structured = Record<string, unknown>;

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, content: result.structuredContent as Structured };
}

function rpcRequest(token: string | null, body: unknown, headers: Record<string, string> = {}, target = ENDPOINT) {
  return new Request(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prova", version: "1.0.0" } } };

function toolCall(name: string, args: Record<string, unknown>, id = 1) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

let keySeq = 0;
const newKey = () => `h5a-${suffix}-${String(++keySeq).padStart(4, "0")}`;

const write = (args: Record<string, unknown>) => ({ ...args, idempotencyKey: newKey(), confirmedByUser: true });

function ucOn() {
  process.env.UC_ENABLED = "true";
  process.env.UC_WORKSPACE_IDS = ids.wsA;
  delete process.env.VERCEL_ENV;
}

function ucOff() {
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
}

async function insertDossier(useCaseId: string, status: string): Promise<string> {
  const id = randomUUID();
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova H5a', $7, now())`,
    [id, ids.wsA, ids.org, useCaseId, ids.template, `XXD-${suffix.toUpperCase()}-${codeSeq++}`, status],
  );
  return id;
}

async function runTasks() {
  const pending = tasks.splice(0);
  for (const task of pending) await task();
}

before(async () => {
  if (!enabled) return;
  for (const level of ["log", "info", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      originalConsole[level](...args);
    };
  }
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    // La sessione della prova al posto dei cookie di Firebase.
    "@/lib/auth": stub("export async function auth() { return globalThis.__hubH5aSession ?? null; }"),
    // Fuori da una richiesta Next non ha la cache né `after`: si registrano.
    "next/cache": stub(
      "export function revalidatePath(path) { (globalThis.__hubH5aRevalidated ??= []).push(path); }\n" +
        "export function revalidateTag() {}\nexport function refresh() {}\nexport function updateTag() {}\n" +
        "export function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}",
    ),
    "next/server": stub("export function after(task) { (globalThis.__hubH5aAfter ??= []).push(task); }"),
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  ({ Client: ClientCtor } = await import("@modelcontextprotocol/sdk/client/index.js"));
  ({ StreamableHTTPClientTransport: Transport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js"));
  ({ handleTeamMcpRequest: handle } = await import("./handler.ts"));
  appDeps = await import("./app-deps.ts");
  contract = await import("./contract.ts");
  instructions = await import("./instructions.ts");
  permissions = await import("../permissions.ts");
  quarter = await import("../quarter.ts");
  decisionsPage = await import("../../actions/use-case-decisions.ts");
  editPage = await import("../../actions/use-case-edit.ts");
  createPage = await import("../../actions/use-case-create.ts");
  needsPage = await import("../../actions/use-case-needs.ts");
  needsReads = await import("../../db/queries/use-case-needs.ts");
  rest = await import("../../portfolio/submission-http.ts");

  ENV.USE_CASE_HUB_WORKSPACES = ids.wsA;
  process.env.USE_CASE_HUB_WORKSPACES = ids.wsA;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  ucOff();

  deps = appDeps.appTeamMcpHandlerDeps({
    schedule: (task) => tasks.push(task),
    env: ENV,
    notify: {
      loadUseCase: async (useCaseId) => ({ id: useCaseId, workspaceId: ids.wsA }) as never,
      notify: async (params) => {
        notified.push(params.useCase.id);
      },
    },
    alertDeps: { findAdminChannel: async () => null, post: async () => undefined },
  });

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H5a', $2)`, [ids.org, `hub-h5a-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, $4), ($2::uuid, $3::uuid, 'Prova H5a spento')`, [ids.wsA, ids.wsB, ids.org, WORKSPACE_NAME]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona di prova ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.wsA, ids[person], ROLE[person]]);
  }
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'function_lead')`, [ids.wsB, ids.builder]);
  await q(`INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix) VALUES ($1::uuid, $2, 'XX')`, [ids.wsA, `hub-h5a-${suffix}`]);
  await q(`INSERT INTO workspace_scoring_models (workspace_id, impact_flag_enabled, config) VALUES ($1::uuid, false, $2::jsonb)`, [
    ids.wsA,
    JSON.stringify({ costBands: { limits: [10000, 40000, 100000, 200000], labels: BAND_LABELS, topReferenceEur: 300000 } }),
  ]);
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova H5a', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.hub_h5a_${suffix}`, randomBytes(32).toString("hex"), ids.wsA],
  );
  for (const person of Object.keys(emails) as Person[]) await insertToken(person, { person });
  await insertToken("builderReadOnly", { person: "builder", scopes: ["use_cases:read"] });
  await insertToken("builderB", { person: "builder", workspaceId: ids.wsB });
  await insertToken("expired", { person: "builder", expired: true });
  await insertToken("revoked", { person: "builder", revoked: true });
  await insertToken("ownerless", { person: null });
  await insertToken("forgedProvider", { person: "builder", provider: "claude_mcp" });
  await insertToken("v1", { person: null, provider: "claude_mcp", prefix: V1_PREFIX, scopes: ["portfolio:submit"] });
  await insertToken("connector", { person: null, provider: "claude_connector", prefix: V1_PREFIX, scopes: ["connector:read", "connector:submit"] });
});

after(async () => {
  signIn(null);
  for (const level of ["log", "info", "warn", "error"] as const) console[level] = originalConsole[level];
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  const tokenIds = Object.values(tokens).map((t) => t.id);
  await q(`DELETE FROM connector_rate_limits WHERE bucket LIKE ANY($1::text[])`, [[...tokenIds.map((id) => `team:${id}:%`), `team:ws:${ids.wsA}:%`, `team:ws:${ids.wsB}:%`]]);
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

// ─── Server, tool e istruzioni ───────────────────────────────────────

test("initialize e tools/list: «Unbundle Use case», istruzioni del workspace con la riga sul costo, 8 tool con titoli e annotazioni", opts, async () => {
  const client = await connect(tokens.builder.token);
  try {
    assert.deepEqual(client.getServerVersion(), { name: "unbundle-use-case", title: "Unbundle Use case", version: "1.0.0" });
    const text = client.getInstructions() ?? "";
    assert.equal(text, instructions.teamMcpInstructions(WORKSPACE_NAME));
    assert.ok(text.length <= 2048 && text.includes(instructions.TEAM_MCP_COST_LINE));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), [...contract.TEAM_MCP_TOOL_NAMES]);
    for (const tool of tools) {
      const name = tool.name as keyof typeof contract.TEAM_MCP_TOOL_TEXT;
      assert.equal(tool.title, contract.TEAM_MCP_TOOL_TEXT[name].title);
      assert.deepEqual(tool.annotations, contract.TEAM_MCP_TOOL_ANNOTATIONS[name]);
    }
  } finally {
    await client.close();
  }
});

// ─── Token e permessi ────────────────────────────────────────────────

test("solo token del team attivi con un revisore: v1, connettore, scaduto, revocato, senza proprietario o con un altro provider danno 401", opts, async () => {
  for (const name of ["v1", "connector", "expired", "revoked", "ownerless", "forgedProvider", "contributor", "learner"]) {
    const response = await handle(rpcRequest(tokens[name].token, initialize), deps);
    assert.equal(response.status, 401, name);
    assert.deepEqual(await response.json(), { error: "unauthorized" }, name);
  }
  assert.equal((await handle(rpcRequest(null, initialize), deps)).status, 401);
  const used = await one(`SELECT last_used_at IS NOT NULL AS used FROM workspace_integration_tokens WHERE id = $1::uuid`, [tokens.contributor.id]);
  assert.equal(used.used, false, "un token respinto non registra l'uso");
  const ok = await handle(rpcRequest(tokens.manager.token, initialize), deps);
  assert.equal(ok.status, 200);
  const managerUsed = await one(`SELECT last_used_at IS NOT NULL AS used FROM workspace_integration_tokens WHERE id = $1::uuid`, [tokens.manager.id]);
  assert.equal(managerUsed.used, true);
});

test("un token del team non apre /api/mcp/portfolio/*: niente scope portfolio:submit", opts, async () => {
  const response = await rest.handlePortfolioSubmissionPost(
    new Request("http://127.0.0.1:53120/api/mcp/portfolio/submissions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens.builder.token}` },
      body: JSON.stringify({ title: "x" }),
    }),
    { schedule: () => undefined },
  );
  assert.equal(response.status, 403);
  assert.equal(await one(`SELECT count(*)::int AS n FROM use_cases WHERE workspace_id = $1::uuid AND title = 'x'`, [ids.wsA]).then((r) => r.n), 0);
});

test("permessi riletti a ogni richiesta: un revisore declassato riceve 401, e torna a entrare quando torna revisore", opts, async () => {
  const before = await handle(rpcRequest(tokens.builder.token, initialize), deps);
  assert.equal(before.status, 200);
  await q(`UPDATE workspace_memberships SET role = 'contributor' WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.wsA, ids.builder]);
  try {
    assert.equal((await handle(rpcRequest(tokens.builder.token, toolCall("search_use_cases", {})), deps)).status, 401);
  } finally {
    await q(`UPDATE workspace_memberships SET role = 'function_lead' WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.wsA, ids.builder]);
  }
  assert.equal((await handle(rpcRequest(tokens.builder.token, initialize), deps)).status, 200);
});

test("igiene HTTP: token nell'indirizzo 400 senza eco (segnato esposto), 415, 413, Origin 403, 405 con Allow: POST; rotta spenta 404", opts, async () => {
  const exposed = await insertToken("exposedInUrl", { person: "builder" });
  const inUrl = await handle(rpcRequest(null, initialize, {}, `${ENDPOINT}?token=${exposed.token}`), deps);
  assert.equal(inUrl.status, 400);
  const text = await inUrl.text();
  assert.deepEqual(JSON.parse(text), { error: "token_in_url" });
  assert.equal(text.includes(exposed.token), false);
  const flagged = await one(`SELECT exposed_at IS NOT NULL AS exposed FROM workspace_integration_tokens WHERE id = $1::uuid`, [exposed.id]);
  assert.equal(flagged.exposed, true, "il token si considera compromesso");
  const afterExposure = await handle(rpcRequest(exposed.token, initialize), deps);
  assert.equal(afterExposure.status, 401, "un token personale finito in un indirizzo non entra più, nemmeno nell'header");
  assert.deepEqual(await afterExposure.json(), { error: "unauthorized" });
  assert.equal((await handle(rpcRequest(tokens.builder.token, initialize, { "content-type": "text/plain" }), deps)).status, 415);
  assert.equal((await handle(rpcRequest(tokens.builder.token, initialize, { "content-length": String(300 * 1024) }), deps)).status, 413);
  assert.equal((await handle(rpcRequest(tokens.builder.token, initialize, { origin: "https://esempio.test" }), deps)).status, 403);
  const get = await handle(new Request(ENDPOINT, { method: "GET", headers: { authorization: `Bearer ${tokens.builder.token}` } }), deps);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
  assert.equal(get.headers.get("cache-control"), "no-store");
  const off = { ...deps, env: { ...ENV, MCP_TEAM_ENABLED: "false" } };
  assert.equal((await handle(rpcRequest(tokens.builder.token, initialize), off)).status, 404);
});

test("area spenta per il workspace del token: handshake e tools/list sì, ogni tool area_spenta", opts, async () => {
  const client = await connect(tokens.builderB.token);
  try {
    assert.equal((await client.listTools()).tools.length, 8);
    for (const name of contract.TEAM_MCP_TOOL_NAMES) {
      const out = await call(client, name, {});
      assert.equal(out.content.error, "area_spenta", name);
    }
  } finally {
    await client.close();
  }
});

// ─── Stessi permessi della pagina, ruolo per ruolo (D3, D9, §12.5 test 5) ────

type Category = "ok" | "permesso_mancante" | "transizione_non_ammessa" | "token_rifiutato" | string;

const MCP_TO_SERVICE: Record<string, string> = { version_conflict: "versione_superata", not_found: "non_trovato", invalid_payload: "dati_non_validi" };

function mcpCategory(out: { isError: boolean; content: Structured }): Category {
  if (!out.isError) return "ok";
  const code = String(out.content.error);
  return MCP_TO_SERVICE[code] ?? code;
}

function pageCategory(result: Result | { ok: boolean; error?: string }): Category {
  return result.ok ? "ok" : String((result as { error?: string }).error ?? "errore");
}

function viewerOf(person: Person) {
  return { userId: ids[person], email: emails[person], emailVerified: true, role: ROLE[person], isLateralSpace: person === "ls" };
}

/** Tre scritture della pagina una dopo l'altra (testi, visibilità, valutazione): ok solo se vanno tutte. */
async function pageUpdate(id: string): Promise<Category> {
  let version = await versionOf(id);
  const texts = await editPage.updateUseCaseFieldAction(ids.wsA, id, version, "title", `Titolo dalla pagina ${suffix}`);
  if (!texts.ok) return pageCategory(texts);
  version = texts.version;
  const hidden = await decisionsPage.setHiddenFromSearchAction(ids.wsA, id, version, true);
  if (!hidden.ok) return pageCategory(hidden);
  version = hidden.version;
  return pageCategory(await editPage.saveValuationAction(ids.wsA, id, version, { valueEurYear: 50000, cost: { band: 2 } }));
}

async function pageCreate(): Promise<Category> {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    kind: "da_costruire",
    title: `Creata dalla pagina ${suffix}`,
    description: "Il problema di prova.",
    flowDescription: "Come funzionerebbe.",
    businessCase: "Meno attese.",
    humanInTheLoop: "Chi controlla.",
    dataRequirements: "I dati che servono.",
  })) {
    form.set(key, value);
  }
  const result = await createPage.createUseCaseFromFormAction(ids.wsA, form);
  return result.ok ? "ok" : result.fieldErrors && Object.keys(result.fieldErrors).length ? "dati_non_validi" : "permesso_mancante";
}

test("stessi permessi della pagina, ruolo per ruolo: Lateral Space, AI Builder del cliente, chi gestisce, contributore e learner", opts, async () => {
  const people: Person[] = ["ls", "builder", "manager", "contributor", "learner"];
  const table: string[] = [];
  for (const person of people) {
    const abilities = permissions.abilitiesForUseCase(viewerOf(person));
    signIn(person);
    const reviewer = abilities.canUseTeamMcp;
    let client: Client | null = null;
    if (reviewer) client = await connect(tokens[person].token);
    else assert.equal((await handle(rpcRequest(tokens[person].token, initialize), deps)).status, 401, `${person}: token rifiutato`);
    const mcp = async (name: string, args: Record<string, unknown>): Promise<Category> => (client ? mcpCategory(await call(client, name, write(args))) : "token_rifiutato");

    const scenarios: Array<{ name: string; expected: Category; mcp: () => Promise<Category>; page: () => Promise<Category> }> = [
      {
        name: "decide approva (Da valutare)",
        expected: abilities.canDecide ? "ok" : "permesso_mancante",
        mcp: async () => {
          const card = await seed();
          return mcp("decide_use_case", { code: card.code, expectedVersion: await versionOf(card.id), decision: { type: "approva", quando: "questo_trimestre" } });
        },
        page: async () => {
          const card = await seed();
          return pageCategory(await decisionsPage.decideUseCaseAction(ids.wsA, card.id, await versionOf(card.id), { type: "approva", quando: "questo_trimestre" }));
        },
      },
      {
        name: "set_priority (Approvato)",
        expected: abilities.canDecide ? "ok" : "permesso_mancante",
        mcp: async () => {
          const card = await seed({ status: "accepted", review: "scored" });
          return mcp("set_priority", { code: card.code, expectedVersion: await versionOf(card.id), quando: "prossimo_trimestre" });
        },
        page: async () => {
          const card = await seed({ status: "accepted", review: "scored" });
          return pageCategory(await decisionsPage.setWhenAction(ids.wsA, card.id, await versionOf(card.id), "prossimo_trimestre"));
        },
      },
      {
        name: "set_priority (Da valutare)",
        expected: abilities.canDecide ? "transizione_non_ammessa" : "permesso_mancante",
        mcp: async () => {
          const card = await seed();
          return mcp("set_priority", { code: card.code, expectedVersion: await versionOf(card.id), quando: "piu_avanti" });
        },
        page: async () => {
          const card = await seed();
          return pageCategory(await decisionsPage.setWhenAction(ids.wsA, card.id, await versionOf(card.id), "piu_avanti"));
        },
      },
      {
        name: "decide riapri (non chiuso)",
        expected: abilities.canDecide ? "transizione_non_ammessa" : "permesso_mancante",
        mcp: async () => {
          const card = await seed();
          return mcp("decide_use_case", { code: card.code, expectedVersion: await versionOf(card.id), decision: { type: "riapri" } });
        },
        page: async () => {
          const card = await seed();
          return pageCategory(await decisionsPage.decideUseCaseAction(ids.wsA, card.id, await versionOf(card.id), { type: "riapri" }));
        },
      },
      {
        name: "decide segna_realizzato (dossier attivo, non «In uso»)",
        expected: abilities.canDecide ? "transizione_non_ammessa" : "permesso_mancante",
        mcp: async () => {
          ucOn();
          try {
            const card = await seed({ status: "accepted", review: "scored" });
            await insertDossier(card.id, "raccolta");
            return await mcp("decide_use_case", { code: card.code, expectedVersion: await versionOf(card.id), decision: { type: "segna_realizzato" } });
          } finally {
            ucOff();
          }
        },
        page: async () => {
          ucOn();
          try {
            const card = await seed({ status: "accepted", review: "scored" });
            await insertDossier(card.id, "raccolta");
            return pageCategory(await decisionsPage.decideUseCaseAction(ids.wsA, card.id, await versionOf(card.id), { type: "segna_realizzato" }));
          } finally {
            ucOff();
          }
        },
      },
      {
        name: "save_needs (aggiungi un'esigenza a uno use case)",
        expected: abilities.canEditNeeds ? "ok" : "permesso_mancante",
        mcp: async () => {
          const card = await seed();
          return mcp("save_needs", { items: [{ type: "requisito", kind: "accesso", title: `Esigenza dal MCP ${person} ${suffix}`, useCases: [card.code] }] });
        },
        page: async () => {
          const card = await seed();
          return pageCategory(await needsPage.createNeedAction(ids.wsA, card.id, { type: "requisito", kind: "accesso", title: `Esigenza dalla pagina ${person} ${suffix}` }));
        },
      },
      {
        name: "update_use_case (testi, visibilità, valutazione)",
        expected: abilities.canEditWhat && abilities.canSetHiddenFromSearch && abilities.canEditValuation ? "ok" : "permesso_mancante",
        mcp: async () => {
          const card = await seed();
          return mcp("update_use_case", {
            code: card.code,
            expectedVersion: await versionOf(card.id),
            changes: { title: `Titolo dal MCP ${suffix}`, hiddenFromSearch: true, valuation: { valueEurYear: 50000, cost: { band: 2 } } },
          });
        },
        page: async () => pageUpdate((await seed()).id),
      },
    ];
    for (const scenario of scenarios) {
      const expectedMcp = reviewer ? scenario.expected : "token_rifiutato";
      const [gotMcp, gotPage] = [await scenario.mcp(), await scenario.page()];
      table.push(`${person} · ${scenario.name}: MCP ${gotMcp}, pagina ${gotPage}`);
      assert.equal(gotMcp, expectedMcp, `${person} · ${scenario.name} (MCP)`);
      assert.equal(gotPage, scenario.expected, `${person} · ${scenario.name} (pagina)`);
      if (reviewer) assert.equal(gotMcp, gotPage, `${person} · ${scenario.name}: MCP e pagina coincidono`);
    }
    // Creare: i revisori dal MCP e dalla pagina; i contributori propongono solo dalla pagina (modulo completo, §5.1).
    const createMcp = reviewer ? mcpCategory(await call(client!, "create_use_cases", write({ items: [{ title: `Creata dal MCP ${person} ${suffix}`, problem: "Il problema di prova." }] }))) : "token_rifiutato";
    const createPageResult = await pageCreate();
    table.push(`${person} · create: MCP ${createMcp}, pagina ${createPageResult}`);
    assert.equal(createMcp, reviewer ? "ok" : "token_rifiutato", `${person} · create (MCP)`);
    assert.equal(createPageResult, abilities.canOpenArea ? "ok" : "permesso_mancante", `${person} · create (pagina)`);
    assert.equal(abilities.canStartRealization, person === "ls", "«Avvia» solo Lateral Space, e non esiste via MCP");
    if (client) await client.close();
  }
  signIn(null);
  state.__hubH5aAfter = [];
  tasks.length = 0;
  notified.length = 0;
  assert.equal(table.length, people.length * 8);
});

test("criterio 5: l'AI Builder del cliente approva, rimanda e sceglie «Quando» dal MCP; la Storia dice canale mcp_team", opts, async () => {
  const client = await connect(tokens.builder.token);
  try {
    const now = new Date();
    const card = await seed();
    const approved = await call(client, "decide_use_case", write({ code: card.code, expectedVersion: await versionOf(card.id), decision: { type: "approva", quando: "questo_trimestre" } }));
    assert.equal(approved.isError, false, JSON.stringify(approved.content));
    assert.equal(approved.content.phase, "approvato");
    assert.deepEqual(approved.content.connectorStatus, { statusCode: "APPROVATA", statusLabel: "Approvata" });
    let r = await row(card.id);
    assert.equal(r.status, "accepted");
    assert.equal(r.target_quarter, quarter.currentQuarter(now));
    assert.equal(approved.content.version, Number(r.version));

    const when = await call(client, "set_priority", write({ code: card.code, expectedVersion: approved.content.version, quando: "2031-Q2" }));
    assert.deepEqual(when.content, { duplicate: false, code: card.code, version: Number((await row(card.id)).version), targetQuarter: "2031-Q2", quando: "T2 2031" });

    const later = await seed();
    const reviewBy = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const postponed = await call(client, "decide_use_case", write({ code: later.code, expectedVersion: await versionOf(later.id), decision: { type: "rimanda", reviewBy } }));
    assert.equal(postponed.content.subState, "rimandata");
    r = await row(later.id);
    assert.equal(r.review_by_text, reviewBy);
    assert.equal((postponed.content.connectorStatus as Structured).statusCode, "VALUTATA", "una rimandata il cliente la legge «Valutata»");

    const events = await storia(card.id);
    const decision = events.find((e) => e.action === "decisione")!;
    assert.equal(decision.channel, "mcp_team");
    assert.equal(decision.actor_user_id, ids.builder);
    assert.equal(decision.actor_kind, "persona");
    assert.equal(events.at(-1)!.action, "quando");
  } finally {
    await client.close();
  }
});

// ─── Creazione ───────────────────────────────────────────────────────

test("create_use_cases: un AI Builder del cliente crea «AI Adoption», visibile, con le notifiche; Lateral Space «AI Transformation», nascosta, senza", opts, async () => {
  const builder = await connect(tokens.builder.token);
  const ls = await connect(tokens.ls.token);
  try {
    tasks.length = 0;
    notified.length = 0;
    const out = await call(builder, "create_use_cases", write({ items: [{ title: `Dal basso ${suffix}`, problem: "Le richieste arrivano in una casella sola.", aiLab: "AI Lab Prova", area: "Operazioni" }, { title: `Dal basso due ${suffix}`, problem: "I turni si contano a mano.", kind: "da_diffondere" }] }));
    assert.equal(out.isError, false, JSON.stringify(out.content));
    const created = out.content.created as Array<{ index: number; code: string; title: string; link: string }>;
    assert.equal(created.length, 2);
    for (const item of created) assert.match(item.code, /^XX-\d{4,5}$/);
    const rows = await q(`SELECT id, origin, source, intake, proposed_by, status::text AS status, portfolio_kind, ai_lab FROM use_cases WHERE workspace_id = $1::uuid AND code = ANY($2::text[]) ORDER BY code`, [ids.wsA, created.map((c) => c.code)]);
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.origin, "adoption");
      assert.equal(r.source, "team_mcp");
      assert.equal(r.proposed_by, null, "nessun proponente: la scheda nasce dal team");
      assert.equal(r.status, "proposed");
      assert.notEqual((r.intake as Record<string, unknown> | null)?.hiddenFromSearch, true);
    }
    assert.equal(created[0].link, `http://127.0.0.1:53120/dashboard/${ids.wsA}/use-cases/${rows.find((r) => r.portfolio_kind === "use_case_ai")!.id}`);
    assert.deepEqual(notified, [], "le notifiche partono dopo la risposta");
    await runTasks();
    assert.deepEqual(notified.sort(), rows.map((r) => String(r.id)).sort());
    const [creation] = await storia(String(rows[0].id));
    assert.deepEqual({ action: creation.action, channel: creation.channel, actor_kind: creation.actor_kind, actor_user_id: creation.actor_user_id }, { action: "creato", channel: "mcp_team", actor_kind: "proponente", actor_user_id: null });

    notified.length = 0;
    const top = await call(ls, "create_use_cases", write({ items: [{ title: `Dall'alto ${suffix}`, problem: "Un problema visto dal team." }] }));
    assert.equal(top.isError, false);
    const lsRow = await one(`SELECT origin, intake FROM use_cases WHERE workspace_id = $1::uuid AND code = $2`, [ids.wsA, (top.content.created as Array<{ code: string }>)[0].code]);
    assert.equal(lsRow.origin, "transformation");
    assert.deepEqual(lsRow.intake, { hiddenFromSearch: true });
    await runTasks();
    assert.deepEqual(notified, [], "Lateral Space: nessuna notifica");
  } finally {
    await builder.close();
    await ls.close();
  }
});

test("token «Solo lettura»: le scritture sono permesso_mancante, le letture vanno", opts, async () => {
  const client = await connect(tokens.builderReadOnly.token);
  try {
    const card = await seed();
    const denied = await call(client, "decide_use_case", write({ code: card.code, expectedVersion: await versionOf(card.id), decision: { type: "riapri" } }));
    assert.equal(denied.content.error, "permesso_mancante");
    assert.equal((await call(client, "get_use_case", { code: card.code })).isError, false);
  } finally {
    await client.close();
  }
});

// ─── Letture, fasce del workspace e costo ────────────────────────────

test("fasce del workspace (D15): search_use_cases e get_use_case con le etichette del workspace; update_use_case con {band} salva solo l'indice", opts, async () => {
  const client = await connect(tokens.builder.token);
  try {
    const card = await seed({ title: `Fasce del workspace ${suffix}`, costBand: 2 });
    const found = await call(client, "search_use_cases", { query: `Fasce del workspace ${suffix}` });
    const [hit] = found.content.results as Array<Record<string, unknown>>;
    assert.equal(found.content.total, 1);
    assert.deepEqual(hit.costo, { symbols: "€€", amount: null, band: 2, bandLabel: BAND_LABELS[1], source: "team_fascia", sourceLabel: "fascia del team", runEurYear: null, text: "€€ · fascia · team" });

    const read = await call(client, "get_use_case", { code: card.code });
    assert.deepEqual(read.content.costBands, BAND_LABELS.map((label, i) => ({ band: i + 1, symbol: "€".repeat(i + 1), label })));
    assert.equal(read.content.version, await versionOf(card.id));

    const band = await call(client, "update_use_case", write({ code: card.code, expectedVersion: read.content.version, changes: { valuation: { cost: { band: 3 } } } }));
    assert.equal(band.isError, false, JSON.stringify(band.content));
    let r = await row(card.id);
    assert.equal(r.cost_band, 3);
    assert.equal(r.cost_eur_once, null);
    assert.deepEqual(((band.content.useCase as Structured).valuation as Structured).costo, { symbols: "€€€", amount: null, band: 3, bandLabel: BAND_LABELS[2], source: "team_fascia", sourceLabel: "fascia del team", runEurYear: null, text: "€€€ · fascia · team" });

    const amount = await call(client, "update_use_case", write({ code: card.code, expectedVersion: band.content.version, changes: { valuation: { cost: { eurOnce: 45000 } } } }));
    r = await row(card.id);
    assert.equal(r.cost_eur_once, 45000);
    assert.equal(r.cost_band, null);
    assert.deepEqual(((amount.content.useCase as Structured).valuation as Structured).costo, { symbols: "€€€", amount: 45000, band: 3, bandLabel: BAND_LABELS[2], source: "team_importo", sourceLabel: "importo del team", runEurYear: null, text: "€€€ · 45.000 € · team" });
  } finally {
    await client.close();
  }
});

test("chi gestisce il workspace legge la scheda senza il proponente; la ricerca trova anche le nascoste per i revisori", opts, async () => {
  const client = await connect(tokens.manager.token);
  try {
    const card = await seed({ title: `Nascosta e propria di altri ${suffix}`, proposedBy: emails.contributor, intake: { hiddenFromSearch: true, submitterEmail: emails.contributor, frequency: "settimanale" } });
    const read = await call(client, "get_use_case", { code: card.code });
    assert.equal(read.isError, false);
    const text = JSON.stringify(read.content);
    assert.equal(text.includes(emails.contributor), false);
    assert.equal(text.includes("proposer"), false);
    assert.equal(read.content.hiddenFromSearch, true);
    assert.deepEqual(read.content.collected, { frequency: "settimanale" });
    const found = await call(client, "search_use_cases", { query: `Nascosta e propria di altri ${suffix}` });
    assert.equal(found.content.total, 1);
    assert.equal(JSON.stringify(found.content).includes(emails.contributor), false);
    assert.equal((await call(client, "get_use_case", { code: "XX-99999" })).content.error, "not_found");
  } finally {
    await client.close();
  }
});

test("update_use_case: versione superata con la version vecchia; testi, nota pubblica e visibilità con i nomi del contratto", opts, async () => {
  const client = await connect(tokens.builder.token);
  try {
    const card = await seed();
    const v = await versionOf(card.id);
    const out = await call(client, "update_use_case", write({ code: card.code, expectedVersion: v, changes: { problem: "Problema riscritto", expectedImpact: "Meno attese", publicNote: "Ne parliamo al prossimo AI Lab.", hiddenFromSearch: true } }));
    assert.equal(out.isError, false, JSON.stringify(out.content));
    const r = await row(card.id);
    assert.equal(r.description, "Problema riscritto");
    assert.equal(r.business_case, "Meno attese");
    assert.equal(r.public_note, "Ne parliamo al prossimo AI Lab.");
    assert.equal((r.intake as Record<string, unknown>).hiddenFromSearch, true);
    assert.equal(out.content.version, Number(r.version));
    const stale = await call(client, "update_use_case", write({ code: card.code, expectedVersion: v, changes: { title: "Titolo vecchio" } }));
    assert.equal(stale.content.error, "version_conflict");
    const area = await call(client, "update_use_case", write({ code: card.code, expectedVersion: Number(r.version), changes: { valuation: { kpis: { impact: { inventato: 3 } } } } }));
    assert.equal(area.content.error, "invalid_payload");
    assert.ok((area.content.fieldErrors as Structured)["changes.valuation.kpis.impact.inventato"]);
  } finally {
    await client.close();
  }
});

// ─── «Benefici e costi» ──────────────────────────────────────────────

/** FIX_A della spec: 115,5 ore, 4.042,5 € all'anno, avvio 560 €, ricorrenti 600 € all'anno. */
const FIX_A = {
  v: 1,
  primary: "tempo",
  components: [
    { key: "capacita", lever: "nuove_capacita", label: "Risposte anche fuori orario", kind: "qualitativo", confidence: "ipotesi" },
    { key: "tempo", lever: "tempo", label: "Smistamento delle richieste", kind: "ore", volumeYear: 6600, minutesPerUnit: 1.5, automatablePct: 70, confidence: "ipotesi" },
    { key: "qualita", lever: "qualita", label: "Meno errori di smistamento", kind: "qualitativo", confidence: "da_misurare" },
  ],
  ease: 4,
  costs: { devDays: 4, internalHours: 16, runCostEurYear: 600 },
  plan: { quarter: "2026-Q4", startMonth: "2026-11", goLiveMonth: "2027-01" },
};

test("«Benefici e costi»: update_use_case salva valuation.model, la Storia dice valore e costo; get_use_case dà il modello e i conti; null lo toglie", opts, async () => {
  const client = await connect(tokens.builder.token);
  try {
    const card = await seed({ status: "accepted", review: "scored", targetQuarter: "2026-Q4", title: `Benefici e costi ${suffix}` });
    const v = await versionOf(card.id);
    const saved = await call(client, "update_use_case", write({ code: card.code, expectedVersion: v, changes: { valuation: { model: FIX_A } } }));
    assert.equal(saved.isError, false, JSON.stringify(saved.content));
    let r = await row(card.id);
    assert.deepEqual(r.value_model, FIX_A);
    assert.equal(Number(r.version), v + 1, "una version sola, anche con il trigger della 0022");
    const valued = (await storia(card.id)).at(-1)!;
    assert.deepEqual({ action: valued.action, channel: valued.channel, actor_user_id: valued.actor_user_id }, { action: "valutato", channel: "mcp_team", actor_user_id: ids.builder });
    assert.deepEqual([...(valued.fields as string[])].sort(), ["costo", "valore"]);

    const read = await call(client, "get_use_case", { code: card.code });
    const valuation = read.content.valuation as Structured;
    assert.deepEqual(valuation.model, FIX_A);
    const computed = valuation.computed as Structured;
    for (const [key, expected] of Object.entries({ benefitEurYear: 4042.5, hoursYear: 115.5, pendingEurYear: 0, oneoffEur: 560, runEurYear: 600, netEurYear: 3442.5, qualitativeCount: 2 })) {
      assert.equal(computed[key], expected, key);
    }
    assert.equal(computed.valueText, "Basso · 4.043 €/anno");
    assert.equal(computed.costText, "avvio 560 € · ricorrenti 600 €/anno");
    assert.deepEqual(computed.costBand, { band: 1, symbol: "€", label: BAND_LABELS[0] });
    assert.deepEqual(computed.plan, { startMonth: "2026-11", goLiveMonth: "2027-01", startLabel: "nov 26", goLiveLabel: "gen 27", source: "piano", sourceLabel: "i mesi della scheda" });
    assert.equal((computed.assumptions as Structured).hourlyCostEur, 35, "le ipotesi predefinite del workspace");
    assert.deepEqual(valuation.costo, { symbols: "€", amount: 560, band: 1, bandLabel: BAND_LABELS[0], source: "stima", sourceLabel: "stima del team", runEurYear: 600, text: "avvio 560 € · ricorrenti 600 €/anno" });
    assert.equal((valuation.valore as Structured).text, "Basso · 4.043 €/anno");
    const [hit] = (await call(client, "search_use_cases", { query: `Benefici e costi ${suffix}` })).content.results as Structured[];
    assert.equal((hit.valore as Structured).text, "Basso · 4.043 €/anno");

    const wrong = await call(client, "update_use_case", write({ code: card.code, expectedVersion: read.content.version, changes: { valuation: { model: { ...FIX_A, primary: "ricavi" } } } }));
    assert.deepEqual(wrong.content.fieldErrors, { "changes.valuation.model.primary": "Il ritorno principale deve essere il tipo di almeno una voce." });
    assert.equal(await versionOf(card.id), v + 1, "un modello sbagliato non scrive");

    const cleared = await call(client, "update_use_case", write({ code: card.code, expectedVersion: read.content.version, changes: { valuation: { model: null } } }));
    assert.equal(cleared.isError, false, JSON.stringify(cleared.content));
    r = await row(card.id);
    assert.equal(r.value_model, null);
    const after = (cleared.content.useCase as Structured).valuation as Structured;
    assert.deepEqual([after.model, after.computed], [null, null]);
  } finally {
    await client.close();
  }
});

// ─── «Cosa serve» ────────────────────────────────────────────────────

/** Le esigenze del workspace con questi titoli, con gli use case collegati. */
async function needRows(...titles: string[]) {
  return q(
    `SELECT n.id, n.title, n.version, n.status, n.import_key, n.done_at, n.archived_at, n.archive_reason,
            coalesce((SELECT array_agg(l.use_case_id::text ORDER BY l.use_case_id) FROM use_case_need_links l WHERE l.need_id = n.id), '{}') AS links
       FROM use_case_needs n WHERE n.workspace_id = $1::uuid AND n.title = ANY($2::text[]) ORDER BY n.title`,
    [ids.wsA, titles],
  );
}

test("«Cosa serve»: save_needs crea e collega per codice o id, list_needs le legge come la pagina, il duplicato non riscrive; poi upsert, legami e archivio", opts, async () => {
  const client = await connect(tokens.builder.token);
  try {
    const a = await seed();
    const b = await seed();
    const key1 = `need-${suffix}-1`;
    const items = [
      { importKey: key1, type: "requisito", kind: "accesso", title: `Accesso al gestionale ${suffix}`, ownerLabel: "Ufficio IT", ownerSide: "cliente", availability: "subito", useCases: [a.code.toLowerCase()] },
      { type: "passo", kind: "decisione", title: `Fissare la riunione ${suffix}`, dueOn: "2026-11-15", dueIsProposal: true, useCases: [b.id.toUpperCase()] },
    ];
    const idempotencyKey = newKey();
    const first = await call(client, "save_needs", { items, idempotencyKey, confirmedByUser: true });
    assert.equal(first.isError, false, JSON.stringify(first.content));
    const saved = first.content.saved as Array<{ id: string; action: string; version: number; importKey: string | null }>;
    assert.deepEqual(saved.map((entry) => [entry.action, entry.version, entry.importKey]), [["creata", 1, key1], ["creata", 1, null]]);
    const titles = items.map((item) => item.title);
    let rows = await needRows(...titles);
    const byTitle = (title: string) => rows.find((r) => String(r.title).startsWith(title))!;
    assert.equal(rows.length, 2);
    assert.deepEqual(byTitle("Accesso").links, [a.id]);
    assert.deepEqual(byTitle("Fissare").links, [b.id]);
    const request = await one(`SELECT status, result, reserved_ids::text[] AS reserved, tool FROM use_case_mcp_requests WHERE workspace_id = $1::uuid AND idempotency_key = $2`, [ids.wsA, idempotencyKey]);
    assert.deepEqual([request.status, request.tool], ["completed", "save_needs"]);
    assert.deepEqual(request.reserved, saved.map((entry) => entry.id), "le esigenze nuove hanno gli id riservati");
    assert.equal(JSON.stringify(request.result).includes(suffix) || JSON.stringify(request.result).includes("Ufficio"), false, "solo indici, id, version e azioni");

    const listed = await call(client, "list_needs", { useCase: a.code });
    assert.equal(listed.content.total, 1);
    const [need] = listed.content.needs as Structured[];
    assert.deepEqual([need.title, need.typeLabel, need.areaLabel, need.ownerLabel, need.ownerSideLabel, need.statusLabel], [`Accesso al gestionale ${suffix}`, "Requisito", "Accessi", "Ufficio IT", "Cliente", "Non ancora chiesta"]);
    assert.deepEqual((need.useCases as Structured[]).map((u) => u.code), [a.code]);
    const page = await needsReads.listWorkspaceNeeds(ids.wsA, viewerOf("manager"));
    assert.deepEqual(page!.filter((n) => titles.includes(n.title)).map((n) => n.id).sort(), saved.map((entry) => entry.id).sort(), "la pagina legge le stesse esigenze");

    const again = await call(client, "save_needs", { items, idempotencyKey, confirmedByUser: true });
    assert.equal(again.content.duplicate, true);
    assert.equal((await needRows(...titles)).length, 2, "nessun doppione");

    const upsert = await call(client, "save_needs", write({ items: [{ importKey: key1, status: "validata" }] }));
    assert.deepEqual((upsert.content.saved as Structured[]).map((entry) => [entry.action, entry.version]), [["aggiornata", 2]]);
    const relink = await call(client, "save_needs", write({ items: [{ id: saved[0].id, expectedVersion: 2, useCases: [b.code] }] }));
    assert.deepEqual((relink.content.saved as Structured[]).map((entry) => [entry.action, entry.version]), [["aggiornata", 2]], "i legami non cambiano la version");
    rows = await needRows(...titles);
    assert.deepEqual(byTitle("Accesso").links, [b.id]);
    assert.notEqual(byTitle("Accesso").done_at, null, "un requisito validato è a posto");

    const stale = await call(client, "save_needs", write({ items: [{ importKey: key1, expectedVersion: 1, status: "chiesta" }] }));
    assert.equal(stale.content.error, "version_conflict");
    assert.equal(Number((await needRows(`Accesso al gestionale ${suffix}`))[0].version), 2, "niente scritto");

    const archived = await call(client, "save_needs", write({ items: [{ importKey: key1, expectedVersion: 2, archive: { reason: "Superata dal nuovo contratto." } }] }));
    assert.deepEqual((archived.content.saved as Structured[]).map((entry) => [entry.action, entry.version]), [["archiviata", 3]]);
    const [gone] = await needRows(`Accesso al gestionale ${suffix}`);
    assert.ok(gone, "archiviare non cancella");
    assert.notEqual(gone.archived_at, null);
    assert.equal(gone.archive_reason, "Superata dal nuovo contratto.");
    assert.equal(((await call(client, "list_needs", {})).content.needs as Structured[]).some((n) => n.id === saved[0].id), false, "le archiviate restano fuori");
    assert.equal(((await call(client, "list_needs", { includeArchived: true })).content.needs as Structured[]).some((n) => n.id === saved[0].id), true);
    const edit = await call(client, "save_needs", write({ items: [{ importKey: key1, status: "chiesta" }] }));
    assert.deepEqual(edit.content.fieldErrors, { "items.0.importKey": "Questa esigenza è archiviata." });
  } finally {
    await client.close();
  }
});

test("«Cosa serve» resta nel workspace del token: niente esigenze né use case di un altro workspace; «Solo lettura» legge e non salva; chi non è revisore non entra", opts, async () => {
  const other = await seed({ workspaceId: ids.wsB });
  const [foreign] = await q(
    `INSERT INTO use_case_needs (workspace_id, type, kind, title, status, import_key) VALUES ($1::uuid, 'requisito', 'accesso', $2, 'da_chiedere', $3) RETURNING id`,
    [ids.wsB, `Esigenza di un altro workspace ${suffix}`, `foreign-${suffix}`],
  );
  const client = await connect(tokens.builder.token);
  const reader = await connect(tokens.builderReadOnly.token);
  try {
    const all = await call(client, "list_needs", { includeArchived: true });
    assert.equal(JSON.stringify(all.content).includes("altro workspace"), false);
    const byId = await call(client, "save_needs", write({ items: [{ id: String(foreign.id), expectedVersion: 1, status: "chiesta" }] }));
    assert.equal((byId.content.fieldErrors as Structured)["items.0.id"], "Esigenza non trovata in questo workspace: rileggi con list_needs.");
    const byCode = await call(client, "save_needs", write({ items: [{ type: "passo", title: `Collegata altrove ${suffix}`, useCases: [other.code] }] }));
    assert.deepEqual(byCode.content.fieldErrors, { "items.0.useCases.0": "Use case non trovato." });
    const byKey = await call(client, "save_needs", write({ items: [{ importKey: `foreign-${suffix}`, type: "requisito", title: `Stessa chiave ${suffix}` }] }));
    assert.equal(byKey.isError, false, "le chiavi sono per workspace: in questo è nuova");
    assert.deepEqual((await one(`SELECT title, status FROM use_case_needs WHERE id = $1::uuid`, [foreign.id])), { title: `Esigenza di un altro workspace ${suffix}`, status: "da_chiedere" }, "l'altro workspace non cambia");

    assert.equal((await call(reader, "list_needs", {})).isError, false);
    const denied = await call(reader, "save_needs", write({ items: [{ type: "passo", title: `Dal token in sola lettura ${suffix}` }] }));
    assert.equal(denied.content.error, "permesso_mancante");
    assert.equal((await needRows(`Dal token in sola lettura ${suffix}`)).length, 0);
  } finally {
    await client.close();
    await reader.close();
  }
  for (const person of ["contributor", "learner"] as const) {
    const response = await handle(rpcRequest(tokens[person].token, toolCall("list_needs", {})), deps);
    assert.equal(response.status, 401, person);
  }
  await q(`UPDATE workspace_memberships SET role = 'contributor' WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.wsA, ids.builder]);
  try {
    assert.equal((await handle(rpcRequest(tokens.builder.token, toolCall("save_needs", write({ items: [{ type: "passo", title: "x" }] }))), deps)).status, 401);
  } finally {
    await q(`UPDATE workspace_memberships SET role = 'function_lead' WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.wsA, ids.builder]);
  }
});

// ─── Idempotenza ─────────────────────────────────────────────────────

test("idempotenza: duplicato senza consumare il limite, conflitto, risultato salvato senza testi", opts, async () => {
  const client = await connect(tokens.builder.token);
  try {
    const key = newKey();
    const args = { items: [{ title: `Idempotente ${suffix}`, problem: "Una volta sola." }], idempotencyKey: key, confirmedByUser: true };
    const first = await call(client, "create_use_cases", args);
    assert.equal(first.content.duplicate, false);
    const bucket = `team:${tokens.builder.id}:write`;
    const before = await one(`SELECT coalesce(sum(count), 0)::int AS n FROM connector_rate_limits WHERE bucket = $1`, [bucket]);
    const again = await call(client, "create_use_cases", args);
    assert.equal(again.content.duplicate, true);
    assert.deepEqual(again.content.created, first.content.created);
    const afterCount = await one(`SELECT coalesce(sum(count), 0)::int AS n FROM connector_rate_limits WHERE bucket = $1`, [bucket]);
    assert.equal(afterCount.n, before.n, "il duplicato non consuma il limite");
    const conflict = await call(client, "create_use_cases", { ...args, items: [{ title: `Altro ${suffix}`, problem: "Altro." }] });
    assert.equal(conflict.content.error, "idempotency_conflict");
    const stored = await one(`SELECT status, result, reserved_ids, tool FROM use_case_mcp_requests WHERE workspace_id = $1::uuid AND idempotency_key = $2`, [ids.wsA, key]);
    assert.equal(stored.status, "completed");
    assert.equal(stored.tool, "create_use_cases");
    assert.equal(JSON.stringify(stored.result).includes("Idempotente"), false, "solo id, codici e versioni");
    assert.equal((await q(`SELECT 1 FROM use_cases WHERE workspace_id = $1::uuid AND title = $2`, [ids.wsA, `Idempotente ${suffix}`])).length, 1);
  } finally {
    await client.close();
  }
});

test("dieci invii insieme con la stessa chiave: nessun 500, una sola creazione", opts, async () => {
  const key = newKey();
  const title = `Dieci insieme ${suffix}`;
  const body = (id: number) => toolCall("create_use_cases", { items: [{ title, problem: "Dieci invii." }], idempotencyKey: key, confirmedByUser: true }, id);
  const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => handle(rpcRequest(tokens.builder.token, body(i + 1)), deps)));
  const outcomes: string[] = [];
  for (const response of responses) {
    assert.equal(response.status, 200);
    const json = (await response.json()) as { result: { isError?: boolean; structuredContent: Structured } };
    const content = json.result.structuredContent;
    outcomes.push(json.result.isError ? String(content.error) : content.duplicate ? "duplicate" : "created");
  }
  assert.equal(outcomes.filter((o) => o === "created").length, 1, outcomes.join(","));
  assert.ok(outcomes.every((o) => ["created", "duplicate", "idempotency_in_progress"].includes(o)), outcomes.join(","));
  assert.equal((await q(`SELECT 1 FROM use_cases WHERE workspace_id = $1::uuid AND title = $2`, [ids.wsA, title])).length, 1);
});

test("interruzione dopo l'INSERT di create_use_cases e ripresa dopo 2 minuti: stesse schede, stessi codici, nessun doppione, notifiche dalla ripresa", opts, async () => {
  const key = newKey();
  const args = { items: [{ title: `Interrotta uno ${suffix}`, problem: "Prima." }, { title: `Interrotta due ${suffix}`, problem: "Seconda." }], idempotencyKey: key, confirmedByUser: true };
  // Il processo cade subito dopo il salvataggio: la riga resta «in corso».
  const crashing: HandlerDeps = {
    ...deps,
    tools: {
      ...deps.tools,
      requests: {
        ...deps.tools.requests,
        complete: async () => {
          throw new Error("processo interrotto");
        },
        fail: async () => {
          throw new Error("processo interrotto");
        },
      },
    },
  };
  const crashed = await handle(rpcRequest(tokens.builder.token, toolCall("create_use_cases", args)), crashing);
  assert.equal(((await crashed.json()) as { result: { structuredContent: Structured } }).result.structuredContent.error, "idempotency_in_progress");
  const saved = await q(`SELECT id, code FROM use_cases WHERE workspace_id = $1::uuid AND title LIKE $2 ORDER BY title DESC`, [ids.wsA, `Interrotta % ${suffix}`]);
  assert.equal(saved.length, 2, "le schede ci sono già, con il codice");

  const client = await connect(tokens.builder.token);
  try {
    const soon = await call(client, "create_use_cases", args);
    assert.equal(soon.content.error, "idempotency_in_progress", "prima dei 2 minuti: in corso");
    await q(`UPDATE use_case_mcp_requests SET updated_at = now() - interval '3 minutes' WHERE workspace_id = $1::uuid AND idempotency_key = $2`, [ids.wsA, key]);
    tasks.length = 0;
    notified.length = 0;
    const resumed = await call(client, "create_use_cases", args);
    assert.equal(resumed.isError, false, JSON.stringify(resumed.content));
    const codes = (resumed.content.created as Array<{ code: string }>).map((c) => c.code).sort();
    assert.deepEqual(codes, saved.map((r) => String(r.code)).sort(), "gli stessi codici");
    const after2 = await q(`SELECT id FROM use_cases WHERE workspace_id = $1::uuid AND title LIKE $2`, [ids.wsA, `Interrotta % ${suffix}`]);
    assert.equal(after2.length, 2, "nessun doppione");
    const request = await one(`SELECT status, attempt FROM use_case_mcp_requests WHERE workspace_id = $1::uuid AND idempotency_key = $2`, [ids.wsA, key]);
    assert.equal(request.status, "completed");
    assert.equal(request.attempt, 2);
    await runTasks();
    assert.deepEqual(notified.sort(), saved.map((r) => String(r.id)).sort(), "il tentativo interrotto non ha annunciato nulla: lo fa la ripresa, una volta");
    notified.length = 0;
    const duplicate = await call(client, "create_use_cases", args);
    assert.equal(duplicate.content.duplicate, true);
    await runTasks();
    assert.deepEqual(notified, [], "un duplicato non annuncia di nuovo");
  } finally {
    await client.close();
  }
});

test("chiusura incerta di create_use_cases: la riga diventa «failed» e la stessa chiave riprende subito, con le notifiche", opts, async () => {
  const key = newKey();
  const args = { items: [{ title: `Chiusura incerta ${suffix}`, problem: "Una." }], idempotencyKey: key, confirmedByUser: true };
  let failures = 0;
  const flaky: HandlerDeps = {
    ...deps,
    tools: {
      ...deps.tools,
      requests: {
        ...deps.tools.requests,
        complete: async (...params) => {
          if (failures++ === 0) throw new Error("rete");
          return deps.tools.requests.complete(...params);
        },
      },
    },
  };
  tasks.length = 0;
  notified.length = 0;
  const first = await handle(rpcRequest(tokens.builder.token, toolCall("create_use_cases", args)), flaky);
  assert.equal(((await first.json()) as { result: { structuredContent: Structured } }).result.structuredContent.error, "idempotency_in_progress");
  const request = await one(`SELECT status FROM use_case_mcp_requests WHERE workspace_id = $1::uuid AND idempotency_key = $2`, [ids.wsA, key]);
  assert.equal(request.status, "failed", "non resta «in corso» per 2 minuti");
  const client = await connect(tokens.builder.token);
  try {
    const again = await call(client, "create_use_cases", args);
    assert.equal(again.isError, false, JSON.stringify(again.content));
    assert.equal(again.content.duplicate, false);
    const cards = await q(`SELECT id FROM use_cases WHERE workspace_id = $1::uuid AND title = $2`, [ids.wsA, `Chiusura incerta ${suffix}`]);
    assert.equal(cards.length, 1);
    await runTasks();
    assert.deepEqual(notified, [String(cards[0].id)]);
  } finally {
    await client.close();
  }
});

test("decisione salvata ma con risposta riprova: la ripresa con la stessa chiave risponde la decisione, una sola riga nella Storia", opts, async () => {
  const { CONNECTOR_STATUS_LABEL } = await import("../../connector/status.ts");
  const card = await seed();
  const v = await versionOf(card.id);
  const args = { code: card.code, expectedVersion: v, decision: { type: "approva", quando: "2031-Q3" }, idempotencyKey: newKey(), confirmedByUser: true };
  // Il servizio salva, poi la rilettura della scheda non riesce: risponde `riprova`.
  const flaky: HandlerDeps = {
    ...deps,
    tools: {
      ...deps.tools,
      service: {
        ...deps.tools.service,
        decideUseCase: async (...params) => {
          const result = await deps.tools.service.decideUseCase(...params);
          return result.ok ? { ok: false, error: "riprova", message: "Non riusciamo a salvare. Riprova." } : result;
        },
      },
    },
  };
  const first = await handle(rpcRequest(tokens.builder.token, toolCall("decide_use_case", args)), flaky);
  assert.equal(((await first.json()) as { result: { structuredContent: Structured } }).result.structuredContent.error, "riprova");
  assert.equal(await versionOf(card.id), v + 1, "la decisione c'è");
  const client = await connect(tokens.builder.token);
  try {
    const again = await call(client, "decide_use_case", args);
    assert.deepEqual(again.content, {
      duplicate: true,
      code: card.code,
      version: v + 1,
      phase: "approvato",
      subState: "trimestre",
      phaseLabel: `Approvato · ${quarter.quarterLabel("2031-Q3")}`,
      connectorStatus: { statusCode: "APPROVATA", statusLabel: CONNECTOR_STATUS_LABEL.APPROVATA },
    });
    assert.equal(await versionOf(card.id), v + 1, "nessuna seconda scrittura");
    assert.equal((await storia(card.id)).filter((e) => e.action === "decisione").length, 1);
    const request = await one(`SELECT status, attempt FROM use_case_mcp_requests WHERE workspace_id = $1::uuid AND idempotency_key = $2`, [ids.wsA, args.idempotencyKey]);
    assert.equal(request.status, "completed");
    assert.equal(request.attempt, 2);
  } finally {
    await client.close();
  }
});

test("ripresa con versione superata e una decisione di un'altra persona: vero conflitto, la chiave torna libera", opts, async () => {
  const card = await seed();
  const v = await versionOf(card.id);
  const args = { code: card.code, expectedVersion: v, decision: { type: "approva", quando: "2031-Q4" }, idempotencyKey: newKey(), confirmedByUser: true };
  // Il primo tentativo non scrive nulla.
  const flaky: HandlerDeps = {
    ...deps,
    tools: { ...deps.tools, service: { ...deps.tools.service, decideUseCase: async () => ({ ok: false, error: "riprova", message: "Non riusciamo a salvare. Riprova." }) } },
  };
  await handle(rpcRequest(tokens.builder.token, toolCall("decide_use_case", args)), flaky);
  const builder = await connect(tokens.builder.token);
  const ls = await connect(tokens.ls.token);
  try {
    // Un'altra persona decide con la sua chiave, sullo stesso canale.
    const other = await call(ls, "decide_use_case", write({ code: card.code, expectedVersion: v, decision: { type: "rimanda", reviewBy: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) } }));
    assert.equal(other.isError, false, JSON.stringify(other.content));
    const again = await call(builder, "decide_use_case", args);
    assert.equal(again.content.error, "version_conflict");
    assert.equal(again.content.message, contract.TEAM_MCP_ERROR_MESSAGES.version_conflict);
    assert.equal((await q(`SELECT 1 FROM use_case_mcp_requests WHERE workspace_id = $1::uuid AND idempotency_key = $2`, [ids.wsA, args.idempotencyKey])).length, 0, "chiave liberata");
    assert.equal((await row(card.id)).target_quarter, null, "l'approvazione non c'è");
  } finally {
    await builder.close();
    await ls.close();
  }
});

test("«Cosa serve» nella Storia: save_needs scrive le righe col canale mcp_team su ogni use case toccato; duplicato e «invariata» nessuna", opts, async () => {
  const a = await seed();
  const b = await seed();
  /** Le righe «Cosa serve» della Storia: chi/canale/prima/dopo. */
  const needsRows = async (id: string) =>
    (await q(`SELECT actor_kind, actor_user_id::text AS actor, channel, action, fields, phase_before, phase_after FROM use_case_events WHERE use_case_id = $1::uuid AND 'cosa_serve' = ANY(fields) ORDER BY at, id`, [id])).map(
      (e) => `${e.action}/${e.actor_kind}/${e.actor === ids.builder ? "builder" : e.actor}/${e.channel}/${(e.fields as string[]).join(",")}/${e.phase_before ?? "-"}/${e.phase_after}`,
    );
  const line = (before: string, after: string) => `modificato/persona/builder/mcp_team/cosa_serve/${before}/${after}`;
  const client = await connect(tokens.builder.token);
  try {
    const idempotencyKey = newKey();
    const first = { items: [{ type: "requisito", kind: "dato", title: `Estratto dal MCP ${suffix}`, useCases: [a.code] }], idempotencyKey, confirmedByUser: true };
    const created = await call(client, "save_needs", first);
    assert.equal(created.isError, false, JSON.stringify(created.content));
    const [saved] = created.content.saved as Array<{ id: string; version: number }>;
    assert.deepEqual(await needsRows(a.id), [line("-", "aggiunta.requisito.da_chiedere")]);
    assert.equal((await call(client, "save_needs", first)).content.duplicate, true);
    assert.equal((await needsRows(a.id)).length, 1, "il duplicato non riscrive la Storia");

    // Stato e legami in una voce: la modifica su a (ancora collegata), poi b collegata e a scollegata.
    const moved = await call(client, "save_needs", write({ items: [{ id: saved.id, expectedVersion: 1, status: "validata", useCases: [b.code] }] }));
    assert.deepEqual((moved.content.saved as Structured[]).map((entry) => [entry.action, entry.version]), [["aggiornata", 2]]);
    assert.deepEqual(await needsRows(a.id), [
      line("-", "aggiunta.requisito.da_chiedere"),
      line("requisito.da_chiedere", "modificata.requisito.validata"),
      line("-", "scollegata.requisito.validata"),
    ]);
    assert.deepEqual(await needsRows(b.id), [line("-", "collegata.requisito.validata")]);
    const same = await call(client, "save_needs", write({ items: [{ id: saved.id, expectedVersion: 2, status: "validata", useCases: [b.code] }] }));
    assert.deepEqual((same.content.saved as Structured[]).map((entry) => entry.action), ["invariata"]);
    assert.equal((await needsRows(b.id)).length, 1, "«invariata»: nessuna riga");
    await call(client, "save_needs", write({ items: [{ id: saved.id, expectedVersion: 2, archive: { reason: `Motivo dal MCP ${suffix}` } }] }));
    assert.deepEqual(await needsRows(b.id), [line("-", "collegata.requisito.validata"), line("-", "archiviata.requisito.validata")]);
    const texts = JSON.stringify(await q(`SELECT * FROM use_case_events WHERE use_case_id = ANY($1::uuid[])`, [[a.id, b.id]]));
    assert.ok(!texts.includes(`Estratto dal MCP ${suffix}`) && !texts.includes(`Motivo dal MCP ${suffix}`), "nessun testo nella Storia");
    assert.deepEqual([await versionOf(a.id), await versionOf(b.id)], [1, 1], "le schede non cambiano versione");
  } finally {
    await client.close();
  }
});

test("ripresa di update_use_case con versione superata: una riga «Cosa serve» della stessa persona non vale come la scrittura di prima", opts, async () => {
  const card = await seed();
  const v = await versionOf(card.id);
  const args = { code: card.code, expectedVersion: v, changes: { title: `Titolo ripreso ${suffix}` }, idempotencyKey: newKey(), confirmedByUser: true };
  // Il primo tentativo non scrive nulla.
  const flaky: HandlerDeps = {
    ...deps,
    tools: { ...deps.tools, service: { ...deps.tools.service, updateUseCase: async () => ({ ok: false, error: "riprova", message: "Non riusciamo a salvare. Riprova." }) } },
  };
  await handle(rpcRequest(tokens.builder.token, toolCall("update_use_case", args)), flaky);
  const builder = await connect(tokens.builder.token);
  const ls = await connect(tokens.ls.token);
  try {
    // La stessa persona, sullo stesso canale, aggiunge un'esigenza alla scheda: una riga «modificato» nella Storia.
    const need = await call(builder, "save_needs", write({ items: [{ type: "passo", title: `Passo nel mezzo ${suffix}`, useCases: [card.code] }] }));
    assert.equal(need.isError, false, JSON.stringify(need.content));
    // Un'altra persona cambia la scheda: la versione sale di uno, come dopo la scrittura di prima.
    const other = await call(ls, "update_use_case", write({ code: card.code, expectedVersion: v, changes: { problem: `Problema di un altro ${suffix}` } }));
    assert.equal(other.isError, false, JSON.stringify(other.content));
    assert.equal(await versionOf(card.id), v + 1);
    const again = await call(builder, "update_use_case", args);
    assert.equal(again.content.error, "version_conflict", JSON.stringify(again.content));
    assert.notEqual(again.content.duplicate, true);
    assert.notEqual((await row(card.id)).title, `Titolo ripreso ${suffix}`, "il titolo non c'è");
  } finally {
    await builder.close();
    await ls.close();
  }
});

test("aree della guida del connettore: areaOptions nelle letture; un'area fuori elenco riceve gli id ammessi; un id dell'elenco si salva", opts, async () => {
  const areas = [{ id: "operazioni", label: "Operazioni" }, { id: "vendite", label: "Vendite e clienti" }];
  await q(`UPDATE workspace_connector_configs SET guide = $2::jsonb WHERE workspace_id = $1::uuid`, [ids.wsA, JSON.stringify({ areas })]);
  const client = await connect(tokens.builder.token);
  try {
    const card = await seed({ title: `Aree della guida ${suffix}` });
    const found = await call(client, "search_use_cases", { query: `Aree della guida ${suffix}` });
    assert.equal(found.content.total, 1);
    assert.deepEqual(found.content.areaOptions, areas);
    const read = await call(client, "get_use_case", { code: card.code });
    assert.deepEqual(read.content.areaOptions, areas);
    const choices = "Scegli uno degli id di areaOptions: operazioni, vendite.";
    const outside = await call(client, "create_use_cases", write({ items: [{ title: `Area fuori elenco ${suffix}`, problem: "Un problema.", area: "Operazioni" }] }));
    assert.equal(outside.content.error, "invalid_payload");
    assert.deepEqual(outside.content.fieldErrors, { "items.0.area": choices });
    assert.equal((await q(`SELECT 1 FROM use_cases WHERE workspace_id = $1::uuid AND title = $2`, [ids.wsA, `Area fuori elenco ${suffix}`])).length, 0);
    const wrong = await call(client, "update_use_case", write({ code: card.code, expectedVersion: read.content.version, changes: { area: "Operazioni" } }));
    assert.deepEqual(wrong.content.fieldErrors, { "changes.area": choices });
    const right = await call(client, "update_use_case", write({ code: card.code, expectedVersion: read.content.version, changes: { area: "operazioni" } }));
    assert.equal(right.isError, false, JSON.stringify(right.content));
    assert.equal((right.content.useCase as Structured).area, "operazioni");
    assert.equal(((await row(card.id)).intake as Structured).area, "operazioni");
    const created = await call(client, "create_use_cases", write({ items: [{ title: `Area dell'elenco ${suffix}`, problem: "Un problema.", area: "vendite" }] }));
    assert.equal(created.isError, false, JSON.stringify(created.content));
  } finally {
    await q(`UPDATE workspace_connector_configs SET guide = NULL WHERE workspace_id = $1::uuid`, [ids.wsA]);
    await client.close();
  }
});

test("search_use_cases trova le parole oltre l'anteprima del problema; giorni di attesa solo per «Da decidere»", opts, async () => {
  const client = await connect(tokens.builder.token);
  const word = `riconciliazione${suffix}`;
  try {
    const card = await seed({ title: `Problema lungo ${suffix}` });
    await q(`UPDATE use_cases SET description = $2 WHERE id = $1::uuid`, [card.id, `${"Le paghe si controllano a mano ogni mese. ".repeat(10)}Serve la ${word} con il gestionale.`]);
    const found = await call(client, "search_use_cases", { query: word });
    assert.deepEqual((found.content.results as Array<{ code: string }>).map((r) => r.code), [card.code]);
    assert.equal(typeof (found.content.results as Array<Structured>)[0].waitingDays, "number");
    const approved = await seed({ title: `Approvato da tempo ${suffix}`, status: "accepted", review: "scored", targetQuarter: "2031-Q1" });
    const read = await call(client, "get_use_case", { code: approved.code });
    assert.equal(read.content.phase, "approvato");
    assert.equal(read.content.waitingDays, null);
  } finally {
    await client.close();
  }
});

// ─── Limiti ──────────────────────────────────────────────────────────

test("limiti: letture per token all'ora e schede create per workspace al giorno, con retryAfterSeconds", opts, async () => {
  const reader = await insertToken("rateReader", { person: "manager" });
  await q(`INSERT INTO connector_rate_limits (bucket, window_start, count) VALUES ($1, date_trunc('hour', now(), 'UTC'), 600)`, [`team:${reader.id}:read`]);
  const client = await connect(reader.token);
  try {
    const limited = await call(client, "search_use_cases", {});
    assert.equal(limited.content.error, "rate_limited");
    assert.ok(Number(limited.content.retryAfterSeconds) >= 1 && Number(limited.content.retryAfterSeconds) <= 3600);
  } finally {
    await client.close();
  }
  const day = `team:ws:${ids.wsA}:create:day`;
  await q(
    `INSERT INTO connector_rate_limits (bucket, window_start, count) VALUES ($1, date_trunc('day', now(), 'Europe/Rome'), 299)
     ON CONFLICT (bucket, window_start) DO UPDATE SET count = 299`,
    [day],
  );
  const writer = await connect(tokens.manager.token);
  try {
    const two = await call(writer, "create_use_cases", write({ items: [{ title: `Oltre il tetto uno ${suffix}`, problem: "x y z" }, { title: `Oltre il tetto due ${suffix}`, problem: "x y z" }] }));
    assert.equal(two.content.error, "rate_limited", "due schede oltre le 300 del giorno");
    const oneMore = await call(writer, "create_use_cases", write({ items: [{ title: `L'ultima del giorno ${suffix}`, problem: "x y z" }] }));
    assert.equal(oneMore.isError, false, JSON.stringify(oneMore.content));
  } finally {
    await writer.close();
    await q(`DELETE FROM connector_rate_limits WHERE bucket = $1`, [day]);
  }
});

// ─── Letture del dossier che falliscono ──────────────────────────────

test("con un errore uc forzato le decisioni che dipendono dal dossier rispondono riprova; le altre passano", opts, async () => {
  const client = await connect(tokens.builder.token);
  ucOn();
  await q(`ALTER TABLE uc_cases RENAME COLUMN setup_completed_at TO setup_completed_at_h5a`);
  try {
    const card = await seed();
    const refused = await call(client, "decide_use_case", write({ code: card.code, expectedVersion: await versionOf(card.id), decision: { type: "non_avviare", publicNote: "Fuori perimetro." } }));
    assert.deepEqual(refused.content, { error: "riprova", message: "Non riesco a leggere lo stato del dossier. Riprova tra poco." });
    assert.equal((await row(card.id)).status, "proposed");
    const reviewBy = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const other = await call(client, "decide_use_case", write({ code: card.code, expectedVersion: await versionOf(card.id), decision: { type: "rimanda", reviewBy } }));
    assert.equal(other.isError, false, JSON.stringify(other.content));
  } finally {
    await q(`ALTER TABLE uc_cases RENAME COLUMN setup_completed_at_h5a TO setup_completed_at`);
    ucOff();
    await client.close();
  }
});

// ─── Log ─────────────────────────────────────────────────────────────

test("log: una riga per chiamata con area, tool, esito, durata e 8 caratteri dell'id del token; mai token, hash, testi o email", opts, async () => {
  const lines = captured.filter((line) => line.includes('"area":"team-mcp"'));
  assert.ok(lines.length > 20);
  assert.ok(lines.some((line) => line.includes('"tool":"create_use_cases"') && line.includes(`"token":"${tokens.builder.id.slice(0, 8)}"`)));
  const all = captured.join("\n");
  for (const t of Object.values(tokens)) {
    assert.equal(all.includes(t.token), false, "nessun token");
    assert.equal(all.includes(sha256(t.token)), false, "nessun hash");
  }
  assert.ok(lines.some((line) => line.includes('"tool":"save_needs"')) && lines.some((line) => line.includes('"tool":"list_needs"')));
  for (const text of [`Dal basso ${suffix}`, "Ne parliamo al prossimo AI Lab.", "Problema riscritto", `Accesso al gestionale ${suffix}`, "Ufficio IT", "Superata dal nuovo contratto.", ...Object.values(emails)]) {
    assert.equal(all.includes(text), false, text);
  }
});
