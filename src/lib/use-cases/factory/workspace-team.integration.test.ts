import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// Il team di Lateral Space di un cliente (rilascio 8.1b) sul database del pacchetto: aggiungere una persona la mette in
// tutti i dossier aperti dove chi agisce è responsabile (gli altri si saltano e si dicono, i chiusi no); un dossier nuovo
// la prende da sé; toglierla la toglie dai dossier aperti. Solo persone di Lateral Space, collaboratori del workspace.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1).
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) throw new Error("Run this suite only on a package database hub_<id>");
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let exec: import("../../db/uc-executor.ts").UcExecutor;
let team: typeof import("../../db/queries/use-case-workspace-team.ts");
let ensure: typeof import("../../db/ensure-schema.ts");

const LS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
const migration = readFileSync(new URL("../../../../drizzle/0035_team_workspace.sql", import.meta.url), "utf8");
const ids = { org: randomUUID(), ws: randomUUID(), template: randomUUID(), owner: randomUUID(), leo: randomUUID(), other: randomUUID(), client: randomUUID(), stranger: randomUUID() };
const cases: Record<string, string> = {};
const email = (who: string, domain = "ls.test") => `${who}-${suffix}@${domain}`;

async function dossier(code: string, lead: string, status = "pronto_sviluppo"): Promise<string> {
  const id = randomUUID();
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, template_id, template_version, code, title, status, setup_completed_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, '1.0.0', $5, $6, $7, now())`,
    [id, ids.ws, ids.org, ids.template, `${code}-${suffix.toUpperCase()}`, `Dossier ${code}`, status],
  );
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead')`, [id, lead]);
  cases[code] = id;
  return id;
}
const rolesOf = async (caseId: string, userId: string) => (await q(`SELECT role FROM uc_case_members WHERE case_id = $1 AND user_id = $2 ORDER BY role`, [caseId, userId])).map((r) => r.role);

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  ensure = await import("../../db/ensure-schema.ts");
  await ensure.ensureDbSchema();
  exec = (await import("../../db/uc-executor.ts")).ucExecutorForUrl(url!);
  team = await import("../../db/queries/use-case-workspace-team.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova team', $2)`, [ids.org, `org-team-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova team')`, [ids.ws, ids.org]);
  const people: [keyof typeof ids, string, string | null][] = [
    ["owner", email("owner"), "transformation_lead"],
    ["leo", email("leo"), "analyst"],
    ["other", email("altro"), "analyst"],
    ["client", email("cliente", "cliente.test"), "contributor"],
    ["stranger", email("estraneo"), null],
  ];
  for (const [p, mail, role] of people) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[p], mail, `Prova ${p}`]);
    if (role) await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[p], role]);
  }
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova team', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.team_${suffix}`, randomBytes(32).toString("hex"), ids.ws],
  );
  await dossier("TA", ids.owner);
  await dossier("TB", ids.owner);
  await dossier("TC", ids.other);
  await dossier("TZ", ids.owner, "chiuso");
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.owner, ids.leo, ids.other, ids.client, ids.stranger]]);
});

test("lo schema della 0035 c'è; il file due volte e il self-heal due volte non cambiano niente", opts, async () => {
  assert.equal(await team.workspaceTeamReady(exec), true);
  await q(migration);
  await q(migration);
  await ensure.runWorkspaceTeamDdl();
  assert.equal(await team.workspaceTeamReady(exec), true);
});

test("aggiungere a tutti i casi: i dossier aperti dove chi agisce è responsabile; gli altri si dicono; i chiusi no", opts, async () => {
  const added = await team.addWorkspaceTeamMember(exec, { workspaceId: ids.ws, actorUserId: ids.owner, email: email("leo").toUpperCase(), role: "ls_sviluppatore", lsDomains: LS });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.deepEqual(added.value.done.sort(), [`TA-${suffix.toUpperCase()}`, `TB-${suffix.toUpperCase()}`].sort());
  assert.deepEqual(added.value.skipped, [{ code: `TC-${suffix.toUpperCase()}`, reason: "attore_non_ammesso" }], "lì non è responsabile");
  assert.deepEqual(await rolesOf(cases.TA, ids.leo), ["ls_sviluppatore"]);
  assert.deepEqual(await rolesOf(cases.TC, ids.leo), []);
  assert.deepEqual(await rolesOf(cases.TZ, ids.leo), [], "un dossier chiuso non cambia");
  const [by] = await q(`SELECT added_by_user_id FROM uc_case_members WHERE case_id = $1 AND user_id = $2`, [cases.TA, ids.leo]);
  assert.equal(by.added_by_user_id, ids.owner);
  assert.deepEqual((await team.listWorkspaceTeam(exec, ids.ws)).map((m) => [m.userId, m.role]), [[ids.leo, "ls_sviluppatore"]]);
  const again = await team.addWorkspaceTeamMember(exec, { workspaceId: ids.ws, actorUserId: ids.owner, email: email("leo"), role: "ls_sviluppatore", lsDomains: LS });
  assert.ok(again.ok && again.value.done.length === 0 && again.value.unchanged.length === 2, "la stessa aggiunta di nuovo non cambia niente");
  const other = await team.addWorkspaceTeamMember(exec, { workspaceId: ids.ws, actorUserId: ids.owner, email: email("leo"), role: "ls_analista", lsDomains: LS });
  assert.deepEqual([other.ok, !other.ok && other.code], [false, "ruolo_diverso"], "un ruolo diverso: si toglie e si riaggiunge");
});

test("solo persone di Lateral Space, collaboratrici del workspace, con un ruolo di chi costruisce", opts, async () => {
  const client = await team.addWorkspaceTeamMember(exec, { workspaceId: ids.ws, actorUserId: ids.owner, email: email("cliente", "cliente.test"), role: "ls_analista", lsDomains: LS });
  assert.deepEqual([client.ok, !client.ok && client.code], [false, "non_lateral_space"]);
  const stranger = await team.addWorkspaceTeamMember(exec, { workspaceId: ids.ws, actorUserId: ids.owner, email: email("estraneo"), role: "ls_analista", lsDomains: LS });
  assert.deepEqual([stranger.ok, !stranger.ok && stranger.code], [false, "non_collaboratore"]);
  const role = await team.addWorkspaceTeamMember(exec, { workspaceId: ids.ws, actorUserId: ids.owner, email: email("leo"), role: "owner_cliente", lsDomains: LS });
  assert.deepEqual([role.ok, !role.ok && role.code], [false, "dati_non_validi"]);
});

test("togliere: solo il ruolo del team, nei casi dove chi agisce è responsabile; i ruoli dati caso per caso restano", opts, async () => {
  // In TB ha anche un ruolo dato caso per caso; in TC (responsabile un altro) l'ha aggiunto chi lì è responsabile.
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead')`, [cases.TB, ids.leo]);
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_sviluppatore')`, [cases.TC, ids.leo]);
  const removed = await team.removeWorkspaceTeamMember(exec, { workspaceId: ids.ws, actorUserId: ids.owner, userId: ids.leo, lsDomains: LS });
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.deepEqual(removed.value.done.sort(), [`TA-${suffix.toUpperCase()}`, `TB-${suffix.toUpperCase()}`].sort());
  assert.deepEqual(removed.value.skipped, [{ code: `TC-${suffix.toUpperCase()}`, reason: "attore_non_ammesso" }]);
  assert.deepEqual(await rolesOf(cases.TA, ids.leo), []);
  assert.deepEqual(await rolesOf(cases.TB, ids.leo), ["ls_lead"], "il ruolo dato caso per caso resta");
  assert.deepEqual(await rolesOf(cases.TC, ids.leo), ["ls_sviluppatore"], "dove non sei responsabile non cambia: si dice");
  assert.deepEqual(await team.listWorkspaceTeam(exec, ids.ws), [], "e non entra più nei casi nuovi");
  const none = await team.removeWorkspaceTeamMember(exec, { workspaceId: ids.ws, actorUserId: ids.owner, userId: ids.leo, lsDomains: LS });
  assert.deepEqual([none.ok, !none.ok && none.code], [false, "non_trovato"]);
  await q(`DELETE FROM uc_case_members WHERE user_id = $1 AND case_id = ANY($2::uuid[])`, [ids.leo, [cases.TB, cases.TC]]);
});

test("un dossier nuovo prende il team del cliente; chi lascia il workspace esce dal team e non rientra da solo", opts, async () => {
  await team.addWorkspaceTeamMember(exec, { workspaceId: ids.ws, actorUserId: ids.owner, email: email("leo"), role: "ls_analista", lsDomains: LS });
  const fresh = await dossier("TD", ids.owner);
  const applied = await team.applyWorkspaceTeamToCase(exec, { workspaceId: ids.ws, caseId: fresh, actorUserId: ids.owner, lsDomains: LS });
  assert.deepEqual(applied.done, [ids.leo]);
  assert.deepEqual(await rolesOf(fresh, ids.leo), ["ls_analista"]);
  // Leo lascia il workspace: dalla lista sparisce subito; la rimozione dal workspace toglie anche la riga.
  await q(`DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, [ids.ws, ids.leo]);
  assert.deepEqual(await team.listWorkspaceTeam(exec, ids.ws), [], "chi non è più collaboratore non compare");
  const next = await dossier("TE", ids.owner);
  assert.deepEqual((await team.applyWorkspaceTeamToCase(exec, { workspaceId: ids.ws, caseId: next, actorUserId: ids.owner, lsDomains: LS })).done, []);
  await team.forgetWorkspaceTeamMember(exec, { workspaceId: ids.ws, userId: ids.leo });
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'analyst'::member_role)`, [ids.ws, ids.leo]);
  assert.deepEqual(await team.listWorkspaceTeam(exec, ids.ws), [], "tornato nel workspace, non rientra da solo nel team");
});
