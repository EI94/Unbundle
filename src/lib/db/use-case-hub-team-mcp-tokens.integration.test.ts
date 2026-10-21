import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { fileURLToPath } from "node:url";

/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
type LoadResult = { format?: string; source?: string | Uint8Array; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult;
    load?(url: string, context: object, nextLoad: (url: string, context: object) => LoadResult): LoadResult;
  }): void;
};

// Token personali del MCP del team (docs/use-case/PIANO-LAVORI.md H5b; docs/use-case/DESIGN.md
// §9.4 «Token personali», §1.2 punto 8, §11 «Token»; decisione D9): le server action di
// src/lib/actions/team-mcp-tokens.ts con una sessione finta, le query di
// src/lib/db/queries/team-mcp-tokens.ts e la card «Claude per il team» resa in HTML.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del
//   pacchetto hub_<id> su 127.0.0.1): `@/lib/auth` restituisce la sessione scelta dalla
//   prova; ruolo e accesso si rileggono dal database come nell'app. `revalidatePath` registra
//   i percorsi. I file `.tsx` si traducono qui con TypeScript.
// - Dentro `npm run check` si salta: in testa solo moduli di Node; i moduli dell'app arrivano
//   con `await import()` dentro `before()`. Dati sintetici, creati e cancellati qui. Nessun
//   token compare nel sorgente: nascono a ogni prova e si confrontano solo con sé stessi.
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

type Actions = typeof import("../actions/team-mcp-tokens.ts");
type Queries = typeof import("./queries/team-mcp-tokens.ts");
type Integrations = typeof import("./queries/workspace-integrations.ts");
type Card = typeof import("../../components/workspace/team-mcp-card.tsx");
type Hygiene = typeof import("../connector/http-hygiene.ts");
type State<D> = import("../actions/team-mcp-tokens.ts").TeamMcpActionState<D>;
type Created = import("../actions/team-mcp-tokens.ts").CreateTeamMcpTokenData;

let actions: Actions;
let queries: Queries;
let integrations: Integrations;
let card: Card;
let hygiene: Hygiene;
let renderToStaticMarkup: (element: unknown) => string;
let createElement: typeof import("react").createElement;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  wsOff: randomUUID(),
  ls: randomUUID(),
  builder: randomUUID(),
  analyst: randomUUID(),
  manager: randomUUID(),
  contributor: randomUUID(),
  learner: randomUUID(),
  outsider: randomUUID(),
};
const emails = {
  ls: `ls.${suffix}@ls.test`,
  builder: `builder.${suffix}@cliente.test`,
  analyst: `analyst.${suffix}@cliente.test`,
  manager: `manager.${suffix}@cliente.test`,
  contributor: `contributor.${suffix}@cliente.test`,
  learner: `learner.${suffix}@cliente.test`,
  outsider: `outsider.${suffix}@cliente.test`,
};
type Person = keyof typeof emails;

const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "MCP_TEAM_ENABLED"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const state = globalThis as { __hubH5bSession?: unknown; __hubH5bRevalidated?: string[] };

function signIn(person: Person | null): void {
  state.__hubH5bSession = person
    ? { user: { id: ids[person], email: emails[person], emailVerified: true, name: `Persona ${person}`, image: null } }
    : null;
}

function revalidated(): string[] {
  const paths = state.__hubH5bRevalidated ?? [];
  state.__hubH5bRevalidated = [];
  return paths;
}

function user(person: Person) {
  return { id: ids[person], email: emails[person], emailVerified: true };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function create(person: Person, fields: Record<string, string> = { label: "Claude Code" }, workspaceId = ids.ws): Promise<State<Created>> {
  signIn(person);
  return actions.createTeamMcpTokenAction(workspaceId, form(fields));
}

function created(result: State<Created>, label = "creazione"): Created {
  assert.equal(result.ok, true, `${label}: ${result.message}`);
  assert.ok(result.data, `${label}: dati del token`);
  return result.data;
}

async function tokenRow(id: string): Promise<Record<string, unknown>> {
  const [row] = await q(`SELECT * FROM workspace_integration_tokens WHERE id = $1::uuid`, [id]);
  assert.ok(row, "il token c'è");
  return row;
}

/** Un token di un altro tipo (v1 o connettore), scritto senza passare dall'app; con `ownerUserId` ha anche un proprietario. */
async function otherToken(provider: string, scopes: string[], workspaceId = ids.ws, ownerUserId: string | null = null): Promise<string> {
  const id = randomUUID();
  await q(
    `INSERT INTO workspace_integration_tokens (id, workspace_id, label, provider, token_hash, token_prefix, scopes, owner_user_id)
     VALUES ($1::uuid, $2::uuid, 'Altro token', $3, $4, 'altro...', $5::jsonb, $6::uuid)`,
    [id, workspaceId, provider, randomBytes(32).toString("hex"), JSON.stringify(scopes), ownerUserId],
  );
  return id;
}

before(async () => {
  if (!enabled) return;
  const { default: ts } = await import("typescript");
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    "@/lib/auth": stub("export async function auth() { return globalThis.__hubH5bSession ?? null; }"),
    "next/cache": stub(
      "export function revalidatePath(path) { (globalThis.__hubH5bRevalidated ??= []).push(path); }\n" +
        "export function revalidateTag() {}\nexport function refresh() {}\nexport function updateTag() {}\n" +
        "export function unstable_cache(fn) { return fn; }\nexport function unstable_noStore() {}",
    ),
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(moduleUrl, context, nextLoad) {
      if (!moduleUrl.startsWith("file:") || !moduleUrl.endsWith(".tsx")) return nextLoad(moduleUrl, context);
      const file = fileURLToPath(moduleUrl);
      const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
        fileName: file,
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    },
  });

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  actions = await import("../actions/team-mcp-tokens.ts");
  queries = await import("./queries/team-mcp-tokens.ts");
  integrations = await import("./queries/workspace-integrations.ts");
  card = await import("../../components/workspace/team-mcp-card.tsx");
  hygiene = await import("../connector/http-hygiene.ts");
  const react = await import("react");
  createElement = react.createElement;
  const { renderToStaticMarkup: toHtml } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  renderToStaticMarkup = toHtml;

  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  process.env.MCP_TEAM_ENABLED = "true";

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H5b', $2)`, [ids.org, `hub-h5b-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova H5b'), ($2::uuid, $3::uuid, 'Prova H5b spento')`, [
    ids.ws,
    ids.wsOff,
    ids.org,
  ]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona di prova ${person}`]);
  }
  const memberships: Array<[string, Person, string]> = [
    [ids.ws, "ls", "transformation_lead"],
    [ids.ws, "builder", "function_lead"],
    [ids.ws, "analyst", "analyst"],
    [ids.ws, "manager", "exec_sponsor"],
    [ids.ws, "contributor", "contributor"],
    [ids.ws, "learner", "learner"],
    [ids.wsOff, "builder", "function_lead"],
    [ids.wsOff, "manager", "exec_sponsor"],
  ];
  for (const [workspaceId, person, role] of memberships) {
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [workspaceId, ids[person], role]);
  }
  revalidated();
});

after(async () => {
  signIn(null);
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.wsOff]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

// ─── Chi crea un token ───────────────────────────────────────────────

test("solo chi ha un ruolo da revisore crea un token, per sé, con l'area accesa", opts, async () => {
  for (const person of ["ls", "builder", "analyst", "manager"] as const) {
    const data = created(await create(person), person);
    const row = await tokenRow(data.tokenId);
    assert.equal(row.owner_user_id, ids[person], `${person}: il proprietario è chi è in sessione`);
    assert.equal(row.created_by_user_id, ids[person]);
    assert.equal(row.workspace_id, ids.ws);
    assert.equal(row.provider, queries.TEAM_MCP_PROVIDER);
    assert.equal(queries.TEAM_MCP_PROVIDER, "unbundle_team_mcp");
    assert.deepEqual(revalidated(), [`/dashboard/${ids.ws}/settings`]);
  }

  const contributor = await create("contributor");
  assert.equal(contributor.ok, false);
  assert.equal(contributor.message, "I token per Claude li crea solo chi valuta gli use case, per sé.");
  for (const person of ["learner", "outsider"] as const) {
    const refused = await create(person);
    assert.equal(refused.ok, false, person);
    assert.equal(refused.message, "Workspace non trovato o non accessibile.", person);
  }
  // Area spenta: nessun token, anche per un revisore.
  const off = await create("builder", { label: "Claude" }, ids.wsOff);
  assert.equal(off.ok, false);
  assert.equal(off.message, "L'area «Use case» non è accesa per questo workspace.");
  // Nessun campo per scegliere un altro proprietario: si ignora.
  const forOther = created(await create("builder", { label: "Per un altro", ownerUserId: ids.manager }), "proprietario nel modulo");
  assert.equal((await tokenRow(forOther.tokenId)).owner_user_id, ids.builder);

  const rows = await q(
    `SELECT count(*)::int AS n FROM workspace_integration_tokens WHERE provider = $1 AND owner_user_id = ANY($2::uuid[])`,
    [queries.TEAM_MCP_PROVIDER, [ids.contributor, ids.learner, ids.outsider]],
  );
  assert.equal(rows[0].n, 0, "niente token per chi non è revisore");
  const offRows = await q(`SELECT count(*)::int AS n FROM workspace_integration_tokens WHERE workspace_id = $1::uuid`, [ids.wsOff]);
  assert.equal(offRows[0].n, 0, "niente token nel workspace spento");

  // Etichetta: obbligatoria e al massimo 80 caratteri; l'ingresso sbagliato non tocca il database.
  const empty = await create("builder", { label: "   " });
  assert.equal(empty.ok, false);
  assert.equal(empty.fieldErrors?.label, "Scrivi un'etichetta.");
  const long = await create("builder", { label: "x".repeat(81) });
  assert.equal(long.fieldErrors?.label, "Scrivi un'etichetta di massimo 80 caratteri.");
  signIn("builder");
  const badWorkspace = await actions.createTeamMcpTokenAction("non-un-uuid", form({ label: "Claude" }));
  assert.equal(badWorkspace.message, "Richiesta non valida.");
});

test("token: prefisso del team, solo hash in tabella, mostrato una volta, 90 giorni, scope per «Solo lettura»", opts, async () => {
  const before = Date.now();
  const data = created(await create("builder", { label: "Claude Code sul portatile" }));
  const after = Date.now();
  assert.ok(data.token.startsWith(queries.TEAM_MCP_TOKEN_PREFIX), "prefisso del team");
  assert.ok(hygiene.DEFAULT_TOKEN_PREFIXES.includes(queries.TEAM_MCP_TOKEN_PREFIX), "un token del team in un indirizzo si riconosce come esposto");
  assert.match(data.token.slice(queries.TEAM_MCP_TOKEN_PREFIX.length), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(data.tokenPrefix, `${data.token.slice(0, queries.TEAM_MCP_TOKEN_PREFIX.length + 6)}...`);
  assert.equal(data.label, "Claude Code sul portatile");
  assert.equal(data.readOnly, false);

  const row = await tokenRow(data.tokenId);
  assert.equal(row.token_hash, createHash("sha256").update(data.token, "utf8").digest("hex"), "in tabella c'è l'hash");
  assert.ok(!JSON.stringify(row).includes(data.token), "il token in chiaro non è in nessuna colonna");
  assert.ok(!JSON.stringify(row).includes(data.token.slice(queries.TEAM_MCP_TOKEN_PREFIX.length + 6)), "nemmeno la parte segreta");
  assert.deepEqual(row.scopes, ["use_cases:read", "use_cases:write"]);
  // 90 giorni da adesso (la colonna è l'ora UTC, senza fuso).
  const [{ expires_text }] = await q(`SELECT expires_at::text AS expires_text FROM workspace_integration_tokens WHERE id = $1::uuid`, [data.tokenId]);
  const expires = new Date(`${String(expires_text).replace(" ", "T")}Z`).getTime();
  const day = 24 * 60 * 60 * 1000;
  assert.ok(expires >= before + 90 * day - 1000 && expires <= after + 90 * day + 1000, "scade dopo 90 giorni");
  assert.equal(queries.TEAM_MCP_TOKEN_TTL_DAYS, 90);

  // Il token apre le credenziali di workspace finché è attivo; la card non lo restituisce mai più.
  const authenticated = await integrations.authenticateWorkspaceIntegrationToken(data.token);
  assert.equal(authenticated?.token.id, data.tokenId);
  const view = await queries.loadTeamMcpCard({ workspaceId: ids.ws, user: user("builder"), role: "function_lead" });
  assert.ok(view);
  const json = JSON.stringify(view);
  assert.ok(!json.includes(data.token), "la card non ha il token");
  assert.ok(!json.includes(String(row.token_hash)), "né l'hash");
  const own = view.tokens.find((t) => t.id === data.tokenId);
  assert.equal(own?.tokenPrefix, data.tokenPrefix, "resta solo l'inizio");
  assert.equal(own?.state, "attivo");
  assert.equal(own?.readOnly, false);
  const html = renderToStaticMarkup(createElement(card.TeamMcpCard, { workspaceId: ids.ws, data: view }));
  assert.ok(!html.includes(data.token) && !html.includes(String(row.token_hash)));

  const readOnly = created(await create("builder", { label: "Solo lettura", readOnly: "on" }), "solo lettura");
  assert.equal(readOnly.readOnly, true);
  assert.deepEqual((await tokenRow(readOnly.tokenId)).scopes, ["use_cases:read"]);

  // Due token sono sempre diversi.
  const second = created(await create("builder", { label: "Secondo" }));
  assert.notEqual(second.token, data.token);
});

// ─── Revoca ──────────────────────────────────────────────────────────

test("«Revoca»: ognuno solo i propri token; dopo, il token non apre più nulla", opts, async () => {
  const mine = created(await create("analyst", { label: "Da revocare" }));
  const theirs = created(await create("ls", { label: "Di un collega" }));

  revalidated();
  signIn("analyst");
  const other = await actions.revokeTeamMcpTokenAction(ids.ws, form({ tokenId: theirs.tokenId }));
  assert.equal(other.ok, false);
  assert.equal(other.message, "Token non trovato o già revocato.");
  assert.equal((await tokenRow(theirs.tokenId)).revoked_at, null, "il token del collega resta attivo");

  const ok = await actions.revokeTeamMcpTokenAction(ids.ws, form({ tokenId: mine.tokenId }));
  assert.equal(ok.ok, true, ok.message ?? "");
  assert.equal(ok.message, "Token revocato. Claude non può più usarlo.");
  assert.deepEqual(revalidated(), [`/dashboard/${ids.ws}/settings`]);
  assert.notEqual((await tokenRow(mine.tokenId)).revoked_at, null);
  assert.equal(await integrations.authenticateWorkspaceIntegrationToken(mine.token), null, "revocato non autentica");
  const again = await actions.revokeTeamMcpTokenAction(ids.ws, form({ tokenId: mine.tokenId }));
  assert.equal(again.message, "Token non trovato o già revocato.");

  // Un token della card v1 o del connettore non si revoca da qui.
  const v1 = await otherToken("claude_mcp", ["portfolio:submit"]);
  const revokeV1 = await actions.revokeTeamMcpTokenAction(ids.ws, form({ tokenId: v1 }));
  assert.equal(revokeV1.ok, false);
  assert.equal((await tokenRow(v1)).revoked_at, null);
  // Nemmeno quando solo il provider è diverso: stesso workspace e stesso proprietario.
  const countBefore = await queries.countActiveTeamMcpTokens(ids.ws);
  const ownV1 = await otherToken("claude_mcp", ["portfolio:submit"], ids.ws, ids.analyst);
  const ownConnector = await otherToken("claude_connector", ["connector:read", "connector:submit"], ids.ws, ids.analyst);
  for (const id of [ownV1, ownConnector]) {
    const refused = await actions.revokeTeamMcpTokenAction(ids.ws, form({ tokenId: id }));
    assert.equal(refused.ok, false);
    assert.equal(refused.message, "Token non trovato o già revocato.");
    assert.equal((await tokenRow(id)).revoked_at, null, "un token di un'altra card resta attivo anche se è della stessa persona");
  }
  const ownList = await queries.listOwnTeamMcpTokens({ workspaceId: ids.ws, ownerUserId: ids.analyst });
  assert.ok(!ownList.some((t) => t.id === ownV1 || t.id === ownConnector), "l'elenco dei propri token ha solo quelli del team");
  assert.equal(await queries.countActiveTeamMcpTokens(ids.ws), countBefore, "il conteggio del workspace non li conta");
  const bad = await actions.revokeTeamMcpTokenAction(ids.ws, form({ tokenId: "non-un-uuid" }));
  assert.equal(bad.message, "Token non valido.");
  signIn("outsider");
  const outsider = await actions.revokeTeamMcpTokenAction(ids.ws, form({ tokenId: theirs.tokenId }));
  assert.equal(outsider.message, "Workspace non trovato o non accessibile.");
});

test("«Revoca tutti»: solo chi gestisce il workspace; tutti i token del team del workspace, nient'altro", opts, async () => {
  const fromBuilder = created(await create("builder", { label: "Del builder" }));
  const fromLs = created(await create("ls", { label: "Di Lateral Space" }));
  const v1 = await otherToken("claude_mcp", ["portfolio:submit"]);
  const connector = await otherToken("claude_connector", ["connector:read", "connector:submit"]);
  // Un token del team in un altro workspace (scritto a mano: lì l'area è spenta).
  const elsewhere = randomUUID();
  await q(
    `INSERT INTO workspace_integration_tokens (id, workspace_id, label, provider, token_hash, token_prefix, scopes, owner_user_id, created_by_user_id)
     VALUES ($1::uuid, $2::uuid, 'Altrove', $3, $4, 'altrove...', '["use_cases:read"]'::jsonb, $5::uuid, $5::uuid)`,
    [elsewhere, ids.wsOff, queries.TEAM_MCP_PROVIDER, randomBytes(32).toString("hex"), ids.builder],
  );

  for (const person of ["builder", "analyst", "contributor"] as const) {
    signIn(person);
    const refused = await actions.revokeAllTeamMcpTokensAction(ids.ws);
    assert.equal(refused.ok, false, person);
    assert.equal(refused.message, "Solo chi gestisce il workspace revoca i token di tutti.", person);
  }
  assert.equal((await tokenRow(fromBuilder.tokenId)).revoked_at, null);

  const active = await queries.countActiveTeamMcpTokens(ids.ws);
  assert.ok(active >= 2);
  revalidated();
  signIn("manager");
  const all = await actions.revokeAllTeamMcpTokensAction(ids.ws);
  assert.equal(all.ok, true, all.message ?? "");
  assert.equal(all.data?.revoked, active, "revocati tutti quelli attivi: gli stessi che la card conta");
  assert.equal(all.message, active === 1 ? "Revocato 1 token." : `Revocati ${active} token.`);
  assert.deepEqual(revalidated(), [`/dashboard/${ids.ws}/settings`]);
  for (const id of [fromBuilder.tokenId, fromLs.tokenId]) assert.notEqual((await tokenRow(id)).revoked_at, null);
  assert.equal(await integrations.authenticateWorkspaceIntegrationToken(fromBuilder.token), null);
  for (const id of [v1, connector, elsewhere]) assert.equal((await tokenRow(id)).revoked_at, null, "v1, connettore e altri workspace restano");
  assert.equal(await queries.countActiveTeamMcpTokens(ids.ws), 0);

  const none = await actions.revokeAllTeamMcpTokensAction(ids.ws);
  assert.equal(none.message, "Nessun token attivo da revocare.");
  const empty = await queries.loadTeamMcpCard({ workspaceId: ids.ws, user: user("manager"), role: "exec_sponsor" });
  assert.equal(empty?.workspaceActiveCount, 0);
  const emptyHtml = renderToStaticMarkup(createElement(card.TeamMcpCard, { workspaceId: ids.ws, data: empty! }));
  // Zero token attivi: solo «Nessun token attivo.» dei propri, senza una seconda riga vuota per il workspace.
  assert.equal(emptyHtml.split("Nessun token attivo").length - 1, 1, "lo stato vuoto una volta sola");
  assert.ok(!emptyHtml.includes("nel workspace") && !emptyHtml.includes("Di tutte le persone che valutano"), "niente riga del workspace a zero");
  assert.ok(!emptyHtml.includes("Revoca tutti"), "niente «Revoca tutti» senza token attivi");
  // Revocare va bene anche con l'area spenta: togliere un accesso non chiede l'interruttore.
  const offAll = await actions.revokeAllTeamMcpTokensAction(ids.wsOff);
  assert.equal(offAll.data?.revoked, 1);
  assert.notEqual((await tokenRow(elsewhere)).revoked_at, null);
});

// ─── Card ────────────────────────────────────────────────────────────

test("la card: ognuno vede solo i propri token; chi gestisce vede quanti sono attivi nel workspace", opts, async () => {
  const builderToken = created(await create("builder", { label: "Etichetta del builder" }));
  const lsToken = created(await create("ls", { label: "Etichetta di Lateral Space" }));
  const managerToken = created(await create("manager", { label: "Etichetta di chi gestisce" }));

  const builder = await queries.loadTeamMcpCard({ workspaceId: ids.ws, user: user("builder"), role: "function_lead" });
  assert.ok(builder);
  assert.equal(builder.status, "pronta");
  assert.ok(builder.tokens.some((t) => t.id === builderToken.tokenId));
  assert.ok(!builder.tokens.some((t) => t.id === lsToken.tokenId || t.id === managerToken.tokenId), "nessun token degli altri");
  assert.equal(builder.workspaceActiveCount, null, "il conteggio del workspace solo a chi gestisce");
  assert.equal(builder.canRevokeAll, false);

  const manager = await queries.loadTeamMcpCard({ workspaceId: ids.ws, user: user("manager"), role: "exec_sponsor" });
  assert.ok(manager);
  assert.deepEqual(manager.tokens.filter((t) => t.active).map((t) => t.id), [managerToken.tokenId], "anche chi gestisce vede solo i propri");
  const owners = await q(`SELECT DISTINCT owner_user_id FROM workspace_integration_tokens WHERE id = ANY($1::uuid[])`, [manager.tokens.map((t) => t.id)]);
  assert.deepEqual(owners.map((r) => r.owner_user_id), [ids.manager], "tutti i token elencati sono suoi");
  assert.equal(manager.workspaceActiveCount, await queries.countActiveTeamMcpTokens(ids.ws));
  assert.ok(manager.workspaceActiveCount! >= 3);
  assert.equal(manager.canRevokeAll, true);

  const managerHtml = renderToStaticMarkup(createElement(card.TeamMcpCard, { workspaceId: ids.ws, data: manager }));
  for (const text of ["Claude per il team", "Crea il tuo token", "Solo lettura", "Revoca tutti", `${manager.workspaceActiveCount} token attivi nel workspace`, "Etichetta di chi gestisce"]) {
    assert.ok(managerHtml.includes(text), `chi gestisce vede «${text}»`);
  }
  assert.ok(!managerHtml.includes("Etichetta del builder") && !managerHtml.includes("Etichetta di Lateral Space"), "niente etichette degli altri");
  // Istruzioni per Claude Code e claude.ai, con il nome del connettore che la skill usa.
  assert.ok(managerHtml.includes(queries.TEAM_MCP_PUBLIC_URL));
  assert.ok(managerHtml.includes("Unbundle Use case"));
  // La skill cita i tool con il nome del connettore della card: «Unbundle Use case:<tool>».
  const skill = readFileSync(new URL("../../../skills/registra-ai-lab/SKILL.md", import.meta.url), "utf8");
  const prefixes = new Set([...skill.matchAll(/`([^`:]+):[a-z_]+`/g)].map((m) => m[1]));
  assert.deepEqual([...prefixes], [queries.TEAM_MCP_CONNECTOR_NAME], "la skill cita i tool con il nome del connettore della card");
  assert.ok(managerHtml.includes("claude mcp add --transport http unbundle-use-case"));
  assert.ok(!/bg-primary/.test(managerHtml.replace(/data-checked:bg-primary|dark:data-checked:bg-primary|aria-invalid:aria-checked:border-primary/g, "")), "nessun pulsante pieno nella card");

  const builderHtml = renderToStaticMarkup(createElement(card.TeamMcpCard, { workspaceId: ids.ws, data: builder }));
  assert.ok(builderHtml.includes("Crea il tuo token"));
  assert.ok(!builderHtml.includes("Revoca tutti") && !builderHtml.includes("token attivi nel workspace"), "il revisore non vede il conteggio né «Revoca tutti»");

  // La card v1 «Claude per Unbundle» e la scheda del connettore non ricevono i token del team
  // (DESIGN §9.7): chi gestisce il workspace non vede i token personali degli altri lì.
  const v1Tokens = await integrations.getWorkspaceIntegrationTokens(ids.ws);
  assert.ok(!v1Tokens.some((t) => t.provider === queries.TEAM_MCP_PROVIDER), "niente token del team nella card v1");
  const connectorTokens = await integrations.getConnectorIntegrationTokens(ids.ws);
  assert.ok(!connectorTokens.some((t) => t.provider === queries.TEAM_MCP_PROVIDER), "né nella scheda del connettore");

  // Non si mostra a chi non è revisore, né con l'area spenta.
  assert.equal(await queries.loadTeamMcpCard({ workspaceId: ids.ws, user: user("contributor"), role: "contributor" }), null);
  assert.equal(await queries.loadTeamMcpCard({ workspaceId: ids.ws, user: user("learner"), role: "learner" }), null);
  assert.equal(await queries.loadTeamMcpCard({ workspaceId: ids.ws, user: user("outsider"), role: null }), null);
  assert.equal(await queries.loadTeamMcpCard({ workspaceId: ids.wsOff, user: user("manager"), role: "exec_sponsor" }), null);

  // Interruttore della rotta spento: la card c'è e lo dice in parole semplici.
  process.env.MCP_TEAM_ENABLED = "false";
  try {
    const routeOff = await queries.loadTeamMcpCard({ workspaceId: ids.ws, user: user("builder"), role: "function_lead" });
    assert.equal(routeOff?.routeEnabled, false);
    const html = renderToStaticMarkup(createElement(card.TeamMcpCard, { workspaceId: ids.ws, data: routeOff! }));
    assert.ok(html.includes("Il collegamento con Claude non è ancora acceso"));
  } finally {
    process.env.MCP_TEAM_ENABLED = "true";
  }
});

test("la card chiama le azioni senza lo stato precedente e mostra solo il risultato dell'ultima", opts, async () => {
  // Nessuna server action ha un parametro per lo stato precedente: dopo una creazione quello
  // stato ha il token in chiaro, e React lo manderebbe al server come argomento.
  assert.equal(actions.createTeamMcpTokenAction.length, 2, "solo workspace e dati del modulo");
  assert.equal(actions.revokeTeamMcpTokenAction.length, 2, "solo workspace e dati del modulo");
  assert.equal(actions.revokeAllTeamMcpTokensAction.length, 1, "solo il workspace");

  // Una seconda creazione dalla card: lo stato di prima, con il token, resta nel browser.
  const first = created(await create("analyst", { label: "Prima creazione" }));
  const sent: unknown[][] = [];
  const done: boolean[] = [];
  signIn("analyst");
  const createFromCard = card.cardAction(
    (...args: [FormData]) => {
      sent.push(args);
      return actions.createTeamMcpTokenAction(ids.ws, args[0]);
    },
    (result) => done.push(result.ok),
  );
  const second = await createFromCard({ ok: true, seq: 1, data: first }, form({ label: "Seconda creazione" }));
  assert.equal(second.ok, true, second.message ?? "");
  assert.notEqual(second.data?.token, first.token);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 1, "un solo argomento: i dati del modulo");
  assert.ok(sent[0][0] instanceof FormData);
  assert.ok(!JSON.stringify([...(sent[0][0] as FormData).entries()]).includes(first.token), "il token di prima non torna al server");
  assert.deepEqual(done, [true], "la card sa che la creazione è riuscita (e spegne «Solo lettura»)");

  // Ogni risultato ha un numero d'ordine più alto: la card mostra solo quello dell'ultima azione.
  const revokeFromCard = card.cardAction(async () => ({ ok: true, message: "Token revocato. Claude non può più usarlo." }));
  const revoked = await revokeFromCard({ ok: true, seq: 0 }, form({}));
  assert.ok(revoked.seq > second.seq);
  assert.equal(card.latestCardAction({ create: second.seq, revoke: revoked.seq, revokeAll: 0 }), "revoke");
  const third = await createFromCard(second, form({ label: "Terza creazione" }));
  assert.equal(card.latestCardAction({ create: third.seq, revoke: revoked.seq, revokeAll: 0 }), "create", "un token nuovo toglie il «Token revocato» di prima");
  assert.equal(card.latestCardAction({ create: third.seq, revoke: revoked.seq, revokeAll: third.seq + 1 }), "revokeAll");
  assert.equal(card.latestCardAction({ create: 0, revoke: 0, revokeAll: 0 }), null, "nessun messaggio prima di ogni azione");
  assert.equal(sent.length, 2);
  assert.ok(!JSON.stringify([...(sent[1][0] as FormData).entries()]).includes(second.data!.token), "nemmeno il secondo token");
});

test("il pannello del token appena creato sparisce quando il token è revocato, anche senza «Nascondi il token»", opts, async () => {
  const fresh = created(await create("manager", { label: "Appena creato" }));
  const load = async () => (await queries.loadTeamMcpCard({ workspaceId: ids.ws, user: user("manager"), role: "exec_sponsor" }))!;
  assert.equal(card.newTokenToShow(fresh, null, (await load()).tokens), fresh, "attivo: il pannello c'è");
  assert.equal(card.newTokenToShow(fresh, fresh.tokenId, (await load()).tokens), null, "nascosto da chi guarda");
  assert.equal(card.newTokenToShow(fresh, null, []), fresh, "elenco non letto: il pannello resta, il token esiste");
  assert.equal(card.newTokenToShow(undefined, null, []), null);

  // «Revoca» sul token appena creato: l'elenco lo dà revocato e il pannello non lo offre più.
  signIn("manager");
  const revoked = await actions.revokeTeamMcpTokenAction(ids.ws, form({ tokenId: fresh.tokenId }));
  assert.equal(revoked.ok, true, revoked.message ?? "");
  const afterRevoke = await load();
  assert.equal(afterRevoke.tokens.find((t) => t.id === fresh.tokenId)?.active, false);
  assert.equal(card.newTokenToShow(fresh, null, afterRevoke.tokens), null, "revocato: niente token da copiare");

  // «Revoca tutti» su un altro token appena creato.
  const other = created(await create("manager", { label: "Appena creato, poi tutti" }));
  assert.equal(card.newTokenToShow(other, null, (await load()).tokens), other);
  signIn("manager");
  const all = await actions.revokeAllTeamMcpTokensAction(ids.ws);
  assert.equal(all.ok, true, all.message ?? "");
  assert.equal(card.newTokenToShow(other, null, (await load()).tokens), null, "revocati tutti: niente token da copiare");
});

test("scadenza: avviso da 14 giorni prima, poi scaduto e fuori dal conteggio; token esposto; ogni dato una volta", opts, async () => {
  const soon = created(await create("analyst", { label: "Scade presto" }));
  const expired = created(await create("analyst", { label: "Già scaduto" }));
  const exposed = created(await create("analyst", { label: "Finito in un indirizzo" }));
  await q(`UPDATE workspace_integration_tokens SET expires_at = (now() AT TIME ZONE 'UTC') + interval '10 days' WHERE id = $1::uuid`, [soon.tokenId]);
  await q(`UPDATE workspace_integration_tokens SET expires_at = (now() AT TIME ZONE 'UTC') - interval '1 day' WHERE id = $1::uuid`, [expired.tokenId]);
  await q(`UPDATE workspace_integration_tokens SET exposed_at = (now() AT TIME ZONE 'UTC') WHERE id = $1::uuid`, [exposed.tokenId]);
  const countBefore = await queries.countActiveTeamMcpTokens(ids.ws);

  const view = await queries.loadTeamMcpCard({ workspaceId: ids.ws, user: user("analyst"), role: "analyst" });
  assert.ok(view);
  const byId = new Map(view.tokens.map((t) => [t.id, t]));
  assert.equal(byId.get(soon.tokenId)?.state, "in_scadenza");
  assert.equal(byId.get(soon.tokenId)?.active, true);
  assert.match(byId.get(soon.tokenId)?.expiresIn ?? "", /^tra (9|10) giorni$/);
  assert.equal(byId.get(expired.tokenId)?.state, "scaduto");
  assert.equal(byId.get(expired.tokenId)?.active, false);
  assert.equal(byId.get(exposed.tokenId)?.exposed, true);
  assert.equal(await integrations.authenticateWorkspaceIntegrationToken(expired.token), null, "scaduto non autentica");

  const html = renderToStaticMarkup(createElement(card.TeamMcpCard, { workspaceId: ids.ws, data: view }));
  assert.ok(html.includes("Token in scadenza"), "avviso di scadenza");
  assert.match(html, /«Scade presto» scade tra (9|10) giorni\. Crea un token nuovo/, "l'avviso dice quanto manca");
  assert.ok(html.includes("Token esposto, da revocare"), "avviso del token esposto");
  // Un dato, un posto: la scadenza vicina e l'esposizione nell'avviso, la data nella riga del token.
  const occurrences = (text: string) => html.split(text).length - 1;
  assert.equal(occurrences("esposto"), 1, "niente etichetta «esposto» in più nella riga");
  assert.ok(!html.includes("Scade tra"), "niente etichetta «Scade tra…» nella riga");
  const soonDay = byId.get(soon.tokenId)?.expiresOn ?? "?";
  assert.equal(occurrences(soonDay), 1, "la data di scadenza una volta sola");
  assert.ok(html.includes(`scade il ${soonDay}`), "nella riga del token");
  const inactiveCount = view.tokens.filter((t) => !t.active).length;
  assert.ok(inactiveCount >= 1 && html.includes(`Token non più attivi (${inactiveCount})`), "lo scaduto sta tra i non più attivi");
  assert.ok(html.includes("Già scaduto") && html.includes("Scaduto"));

  // Il conteggio del workspace non conta lo scaduto.
  const [{ n }] = await q(
    `SELECT count(*)::int AS n FROM workspace_integration_tokens
     WHERE workspace_id = $1::uuid AND provider = $2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > (now() AT TIME ZONE 'UTC'))`,
    [ids.ws, queries.TEAM_MCP_PROVIDER],
  );
  assert.equal(countBefore, n);

  // Vista pura: i confini dell'avviso e della scadenza.
  const now = new Date("2026-10-19T10:00:00Z");
  const base = { id: "x", label: "x", tokenPrefix: "x...", scopes: ["use_cases:read"], createdAt: now, lastUsedAt: null, revokedAt: null, exposedAt: null };
  const at = (days: number) => queries.teamMcpTokenView({ ...base, expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000) }, now);
  assert.equal(at(15).state, "attivo");
  assert.equal(at(14).state, "in_scadenza");
  assert.equal(at(0.01).state, "in_scadenza");
  assert.equal(at(0).state, "scaduto");
  assert.equal(at(15).readOnly, true);
  assert.equal(queries.teamMcpTokenView({ ...base, expiresAt: null, revokedAt: now }, now).state, "revocato");
});

test("H7: un token di chi non valuta più non conta e si revoca; il modulo si chiude con un token attivo; la skill solo a Lateral Space", opts, async () => {
  const token = created(await create("analyst", { label: "Token dell'analista" }));
  const before = await queries.countActiveTeamMcpTokens(ids.ws);
  const [{ n: own }] = await q(
    `SELECT count(*)::int AS n FROM workspace_integration_tokens
     WHERE workspace_id = $1::uuid AND provider = $2 AND owner_user_id = $3::uuid AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > (now() AT TIME ZONE 'UTC'))`,
    [ids.ws, queries.TEAM_MCP_PROVIDER, ids.analyst],
  );
  const others = before - Number(own);
  assert.ok(Number(own) >= 1);
  try {
    // Perde il ruolo da revisore: il token non conta più, anche prima della revoca.
    await q(`UPDATE workspace_memberships SET role = 'contributor' WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.ws, ids.analyst]);
    assert.equal(await queries.countActiveTeamMcpTokens(ids.ws), others, "i token di chi non valuta più non contano");
    // Lascia il workspace: lo stesso.
    await q(`DELETE FROM workspace_memberships WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.ws, ids.analyst]);
    assert.equal(await queries.countActiveTeamMcpTokens(ids.ws), others, "né quelli di chi ha lasciato il workspace");
    // La revoca dei token della persona (cambio di ruolo, rimozione): solo i suoi, di questo workspace.
    assert.ok((await queries.revokeTeamMcpTokensOfOwner({ workspaceId: ids.ws, ownerUserId: ids.analyst })) >= 1);
    assert.ok((await tokenRow(token.tokenId)).revoked_at, "revocato");
    assert.equal(await queries.countActiveTeamMcpTokens(ids.ws), others, "gli altri token restano");
  } finally {
    await q(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'analyst'::member_role)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'analyst'::member_role`,
      [ids.ws, ids.analyst],
    );
  }

  // Con un token attivo il modulo sta dietro «Crea un altro token»; senza, è aperto.
  created(await create("builder", { label: "Token del builder" }));
  const builder = await queries.loadTeamMcpCard({ workspaceId: ids.ws, user: user("builder"), role: "function_lead" });
  assert.ok(builder && builder.tokens.some((t) => t.active));
  const withToken = renderToStaticMarkup(createElement(card.TeamMcpCard, { workspaceId: ids.ws, data: builder }));
  assert.match(withToken, /<details[^>]*data-team-mcp-create-more[^>]*>[\s\S]*Crea un altro token[\s\S]*data-team-mcp-create/);
  const empty = renderToStaticMarkup(createElement(card.TeamMcpCard, { workspaceId: ids.ws, data: { ...builder, tokens: [] } }));
  assert.ok(!empty.includes("Crea un altro token") && empty.includes("data-team-mcp-create"), "senza token il modulo è aperto");

  // La skill «registra-ai-lab» la nomina solo a Lateral Space, che conduce gli AI Lab.
  assert.equal(builder.skillName, null);
  assert.ok(!withToken.includes("registra-ai-lab"));
  const ls = await queries.loadTeamMcpCard({ workspaceId: ids.ws, user: user("ls"), role: "transformation_lead" });
  assert.equal(ls?.skillName, "registra-ai-lab");
  assert.ok(renderToStaticMarkup(createElement(card.TeamMcpCard, { workspaceId: ids.ws, data: ls! })).includes("la skill «registra-ai-lab»"));
});
