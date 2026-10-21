import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { CONNECTOR_TOKEN_PREFIX, hashIntegrationToken } from "../../connector/auth.ts";
import {
  TEAM_MCP_READ_SCOPE,
  TEAM_MCP_SCOPES,
  TEAM_MCP_TOKEN_PREFIX,
  authenticateTeamRequest,
  isTeamMcpEnabled,
  teamPrincipalKey,
  type TeamAuthDeps,
  type TeamOwnerAccess,
  type TeamOwnerProfile,
  type TeamTokenRecord,
} from "./auth.ts";

// Autenticazione del MCP del team (docs/use-case/DESIGN.md §9.4, D9): token personale del team,
// permessi della persona riletti a ogni richiesta. I token sono generati qui e mai stampati.

const freshToken = (prefix = TEAM_MCP_TOKEN_PREFIX) => `${prefix}${randomBytes(32).toString("base64url")}`;

function fakeDeps(opts: {
  token?: string;
  record?: Partial<TeamTokenRecord> | null;
  access?: TeamOwnerAccess | null;
  profile?: TeamOwnerProfile | null;
}) {
  const used: string[] = [];
  const lookups: string[] = [];
  const record: TeamTokenRecord | null =
    opts.record === null ? null : { id: randomUUID(), workspaceId: randomUUID(), ownerUserId: randomUUID(), scopes: [...TEAM_MCP_SCOPES], ...opts.record };
  const deps: TeamAuthDeps = {
    async findToken(hash) {
      lookups.push(hash);
      return opts.token && record && hash === hashIntegrationToken(opts.token) ? record : null;
    },
    async ownerAccess() {
      return opts.access === undefined ? { role: "function_lead", workspaceName: "Alfa e Beta" } : opts.access;
    },
    async ownerProfile() {
      return opts.profile === undefined ? { email: "builder@cliente.test", emailVerified: true, isLateralSpace: false } : opts.profile;
    },
    async markUsed(id) {
      used.push(id);
    },
  };
  return { deps, used, lookups, record };
}

test("interruttore: solo MCP_TEAM_ENABLED=true accende la rotta", () => {
  assert.equal(isTeamMcpEnabled({ MCP_TEAM_ENABLED: "true" }), true);
  for (const value of [undefined, "", "1", "TRUE", "yes", "false"]) assert.equal(isTeamMcpEnabled({ MCP_TEAM_ENABLED: value }), false, String(value));
});

test("un AI Builder del cliente con un token attivo passa: permessi riletti, last_used_at, principal per token", async () => {
  const token = freshToken();
  const { deps, used, record } = fakeDeps({ token });
  const result = await authenticateTeamRequest(`Bearer ${token}`, deps);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.principal.tokenId, record!.id);
  assert.equal(result.principal.principalKey, teamPrincipalKey(record!.id));
  assert.equal(result.principal.canWrite, true);
  assert.equal(result.principal.abilities.kind, "ai_builder");
  assert.equal(result.principal.abilities.canDecide, true, "D3: anche gli AI Builder del cliente decidono");
  assert.equal(result.principal.abilities.canStartRealization, false, "«Avvia» resta di Lateral Space");
  assert.equal(result.principal.workspaceName, "Alfa e Beta");
  assert.deepEqual(used, [record!.id]);
  assert.equal(JSON.stringify(result.principal).includes(token), false, "il principal non porta il token");
});

test("token in sola lettura: passa, ma senza scrittura; senza lo scope di lettura no", async () => {
  const token = freshToken();
  const readOnly = await authenticateTeamRequest(`Bearer ${token}`, fakeDeps({ token, record: { scopes: [TEAM_MCP_READ_SCOPE] } }).deps);
  assert.ok(readOnly.ok && readOnly.principal.canWrite === false);
  const none = await authenticateTeamRequest(`Bearer ${token}`, fakeDeps({ token, record: { scopes: ["portfolio:submit"] } }).deps);
  assert.deepEqual(none, { ok: false, reason: "scope" });
});

test("senza un token del team il database non si tocca: niente header, schema diverso, token v1 o del connettore", async () => {
  const { deps, lookups } = fakeDeps({ token: freshToken() });
  for (const header of [null, "", "Basic abc", `Bearer ${freshToken(CONNECTOR_TOKEN_PREFIX)}`, `Bearer ${TEAM_MCP_TOKEN_PREFIX}corto`, `Token ${freshToken()}`]) {
    assert.deepEqual(await authenticateTeamRequest(header, deps), { ok: false, reason: "no_token" }, String(header).slice(0, 12));
  }
  assert.deepEqual(lookups, []);
});

test("token sconosciuto, revocato o scaduto (il database non lo restituisce): 401", async () => {
  const { deps, used } = fakeDeps({ token: freshToken() });
  assert.deepEqual(await authenticateTeamRequest(`Bearer ${freshToken()}`, deps), { ok: false, reason: "unknown_token" });
  assert.deepEqual(used, []);
});

test("permessi riletti: un revisore declassato, chi è uscito dal workspace e chi segue solo un corso ricevono 401", async () => {
  const token = freshToken();
  for (const [access, reason] of [
    [{ role: "contributor", workspaceName: "Alfa" }, "not_reviewer"],
    [{ role: "viewer", workspaceName: "Alfa" }, "not_reviewer"],
    [null, "not_member"],
  ] as const) {
    const { deps, used } = fakeDeps({ token, access });
    assert.deepEqual(await authenticateTeamRequest(`Bearer ${token}`, deps), { ok: false, reason }, String(access?.role));
    assert.deepEqual(used, [], "last_used_at solo per una richiesta accettata");
  }
  assert.deepEqual(await authenticateTeamRequest(`Bearer ${token}`, fakeDeps({ token, profile: null }).deps), { ok: false, reason: "not_member" });
});

test("Lateral Space si legge dall'email verificata del proprietario; chi gestisce il workspace del cliente passa", async () => {
  const token = freshToken();
  const ls = await authenticateTeamRequest(
    `Bearer ${token}`,
    fakeDeps({ token, access: { role: "transformation_lead", workspaceName: null }, profile: { email: "ls@ls.test", emailVerified: true, isLateralSpace: true } }).deps,
  );
  assert.ok(ls.ok && ls.principal.abilities.kind === "lateral_space" && ls.principal.viewer.isLateralSpace);
  const manager = await authenticateTeamRequest(`Bearer ${token}`, fakeDeps({ token, access: { role: "exec_sponsor", workspaceName: null } }).deps);
  assert.ok(manager.ok && manager.principal.abilities.managesWorkspace && !manager.principal.abilities.isLateralSpace);
});
