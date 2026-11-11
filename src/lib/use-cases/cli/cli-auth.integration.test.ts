import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// Il login della CLI e i suoi token sul database di prova dell'hub (rilascio 8.0b): il codice vale una volta e per
// 10 minuti; il token nasce solo dopo la conferma e si consegna una volta sola, anche con due richieste insieme;
// un token revocato, esposto, scaduto o di un altro tipo non apre niente; ognuno vede e revoca solo i suoi.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1).
//   Dati sintetici, creati e cancellati qui.
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
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let exec: import("../../db/uc-executor.ts").UcExecutor;
let cli: typeof import("../../db/queries/use-case-cli-auth.ts");

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), other: randomUUID(), useCase: randomUUID(), person: randomUUID(), stranger: randomUUID() };
const LABEL = `CLI di prova ${suffix}`;

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  const ensure = await import("../../db/ensure-schema.ts");
  await ensure.ensureDbSchema();
  exec = (await import("../../db/uc-executor.ts")).ucExecutorForUrl(url!);
  cli = await import("../../db/queries/use-case-cli-auth.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova CLI', $2)`, [ids.org, `org-cli-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova CLI'), ($3, $2, 'Altro workspace CLI')`, [ids.ws, ids.org, ids.other]);
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $2, 'Scheda di prova CLI', $3)`, [ids.useCase, ids.ws, "PX-0042"]);
  for (const [id, who] of [[ids.person, "persona"], [ids.stranger, "estraneo"]]) {
    await q(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3)`, [id, `prova-cli-${who}-${suffix}@example.test`, `Prova ${who}`]);
  }
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM use_case_cli_logins WHERE client_label LIKE $1`, [`%${suffix}%`]);
  await q(`DELETE FROM workspaces WHERE id IN ($1, $2)`, [ids.ws, ids.other]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1, $2)`, [ids.person, ids.stranger]);
});

test("il giro intero: codice, attesa, conferma, token una volta sola; il token apre come la persona nel suo workspace", opts, async () => {
  assert.equal(await cli.cliStoreReady(exec), true);
  const started = await cli.startCliLogin(exec, { clientLabel: `${LABEL} · macOS` });
  assert.match(started.userCode, /^[A-Z]{4}-[A-Z]{4}$/);
  assert.equal(started.expiresInSeconds, 600);
  const [stored] = await q(`SELECT device_code_hash, status FROM use_case_cli_logins WHERE user_code = $1 AND status = 'in_attesa'`, [started.userCode]);
  assert.notEqual(stored.device_code_hash, started.deviceCode, "solo l'impronta");
  assert.deepEqual(await cli.deliverCliLogin(exec, started.deviceCode), { status: "in_attesa" });
  assert.equal((await cli.findCliLogin(exec, started.userCode.toLowerCase()))?.status, "in_attesa");
  assert.equal((await cli.decideCliLogin(exec, { userCode: started.userCode, userId: ids.person, workspaceId: null, confirm: true })).ok, false, "serve il workspace");
  assert.ok((await cli.decideCliLogin(exec, { userCode: started.userCode, userId: ids.person, workspaceId: ids.ws, confirm: true })).ok);
  assert.equal((await cli.decideCliLogin(exec, { userCode: started.userCode, userId: ids.stranger, workspaceId: ids.other, confirm: true })).ok, false, "una volta sola");
  // Due richieste insieme: un solo token.
  const [a, b] = await Promise.all([cli.deliverCliLogin(exec, started.deviceCode), cli.deliverCliLogin(exec, started.deviceCode)]);
  const got = [a, b].filter((d) => d.status === "consegnato");
  assert.equal(got.length, 1, "un solo consegnato");
  assert.ok([a, b].some((d) => d.status === "gia_consegnato"));
  const delivered = got[0] as Extract<typeof a, { status: "consegnato" }>;
  assert.equal(delivered.workspaceId, ids.ws);
  assert.deepEqual(await cli.deliverCliLogin(exec, started.deviceCode), { status: "gia_consegnato" });
  const [tokens] = [await q(`SELECT count(*)::int AS n FROM workspace_integration_tokens WHERE owner_user_id = $1 AND provider = 'unbundle_cli'`, [ids.person])];
  assert.equal(tokens[0].n, 1);
  const principal = await cli.authenticateCli(exec, `Bearer ${delivered.token}`);
  assert.deepEqual({ ...principal, tokenId: undefined, expiresAt: undefined }, { tokenId: undefined, expiresAt: undefined, workspaceId: ids.ws, userId: ids.person, caseUseCaseId: null });
  const [login] = await q(`SELECT token_id, status FROM use_case_cli_logins WHERE user_code = $1 ORDER BY created_at DESC LIMIT 1`, [started.userCode]);
  assert.equal(login.token_id, principal!.tokenId);
  assert.equal(login.status, "consegnato");
});

test("negato o scaduto: niente token; il codice scaduto si ferma da solo", opts, async () => {
  const denied = await cli.startCliLogin(exec, { clientLabel: `${LABEL} negato` });
  assert.ok((await cli.decideCliLogin(exec, { userCode: denied.userCode, userId: ids.person, workspaceId: null, confirm: false })).ok);
  assert.deepEqual(await cli.deliverCliLogin(exec, denied.deviceCode), { status: "negato" });
  const late = await cli.startCliLogin(exec, { clientLabel: `${LABEL} tardi` });
  await q(`UPDATE use_case_cli_logins SET created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes' WHERE user_code = $1 AND status = 'in_attesa'`, [late.userCode]);
  assert.equal((await cli.findCliLogin(exec, late.userCode))?.status, "scaduto");
  assert.equal((await cli.decideCliLogin(exec, { userCode: late.userCode, userId: ids.person, workspaceId: ids.ws, confirm: true })).ok, false);
  assert.deepEqual(await cli.deliverCliLogin(exec, late.deviceCode), { status: "scaduto" });
  assert.deepEqual(await cli.deliverCliLogin(exec, "ub_dev_" + "x".repeat(43)), { status: "sconosciuto" });
  assert.deepEqual(await cli.deliverCliLogin(exec, "non-un-codice"), { status: "sconosciuto" });
  assert.equal(await cli.findCliLogin(exec, "AEIO-UAEI"), null);
});

async function freshToken(): Promise<string> {
  const s = await cli.startCliLogin(exec, { clientLabel: `${LABEL} extra` });
  await cli.decideCliLogin(exec, { userCode: s.userCode, userId: ids.person, workspaceId: ids.ws, confirm: true });
  const d = await cli.deliverCliLogin(exec, s.deviceCode);
  assert.equal(d.status, "consegnato");
  return (d as { token: string }).token;
}

test("un token revocato, esposto, scaduto, senza persona o di un altro tipo non apre niente", opts, async () => {
  assert.equal(await cli.authenticateCli(exec, null), null);
  assert.equal(await cli.authenticateCli(exec, "Bearer ub_team_" + "x".repeat(43)), null);
  assert.equal(await cli.authenticateCli(exec, "Bearer ub_cli_" + "x".repeat(43)), null, "un token che non esiste");
  const revoked = await freshToken();
  const principal = await cli.authenticateCli(exec, `Bearer ${revoked}`);
  assert.ok(principal);
  assert.equal(await cli.revokeCliTokenById(exec, principal!), true);
  assert.equal(await cli.authenticateCli(exec, `Bearer ${revoked}`), null, "revocato");
  for (const [column, value] of [["exposed_at", "now()"], ["expires_at", "now() - interval '1 minute'"], ["provider", "'unbundle_team_mcp'"], ["scopes", `'["use_cases:read"]'::jsonb`]] as const) {
    const token = await freshToken();
    const p = await cli.authenticateCli(exec, `Bearer ${token}`);
    await q(`UPDATE workspace_integration_tokens SET ${column} = ${value} WHERE id = $1`, [p!.tokenId]);
    assert.equal(await cli.authenticateCli(exec, `Bearer ${token}`), null, column);
  }
});

test("Impostazioni: ognuno vede e revoca solo i suoi; il token di un caso solo lo crea solo un token di tutti i casi", opts, async () => {
  const token = await freshToken();
  const principal = (await cli.authenticateCli(exec, `Bearer ${token}`))!;
  const mine = await cli.listOwnCliTokens(exec, { userId: ids.person, workspaceId: ids.ws });
  assert.ok(mine.some((t) => t.id === principal.tokenId));
  assert.ok(mine.every((t) => !JSON.stringify(t).includes(token)), "mai il token, solo il prefisso");
  assert.deepEqual(await cli.listOwnCliTokens(exec, { userId: ids.stranger, workspaceId: ids.ws }), []);
  assert.equal(await cli.revokeOwnCliToken(exec, { userId: ids.stranger, workspaceId: ids.ws, tokenId: principal.tokenId }), false, "non è suo");
  const caseToken = await cli.createCaseCliToken(exec, principal, { useCaseId: ids.useCase, label: `MCP del caso ${suffix}` });
  assert.ok(caseToken.ok);
  const scoped = (await cli.authenticateCli(exec, `Bearer ${caseToken.ok ? caseToken.value.token : ""}`))!;
  assert.equal(scoped.caseUseCaseId, ids.useCase);
  assert.equal((await cli.createCaseCliToken(exec, scoped, { useCaseId: ids.useCase, label: "x" })).ok, false, "non si moltiplica da sé");
  const listed = await cli.listOwnCliTokens(exec, { userId: ids.person, workspaceId: ids.ws });
  assert.equal(listed.find((t) => t.id === scoped.tokenId)?.caseCode, "PX-0042");
  assert.equal(await cli.revokeOwnCliToken(exec, { userId: ids.person, workspaceId: ids.ws, tokenId: scoped.tokenId }), true);
  assert.equal(await cli.authenticateCli(exec, `Bearer ${caseToken.ok ? caseToken.value.token : ""}`), null);
});
