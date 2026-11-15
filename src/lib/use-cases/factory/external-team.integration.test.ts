import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// «Chi costruisce» con chi viene da fuori Lateral Space (rilascio 8.0c, RILASCIO-8.0c-ESTERNI.md §4 e §9) sul database
// del pacchetto: le aggiunte rifiutate (D10); «Aggiungi» con il «Dove» (i dossier aperti dove chi agisce è responsabile,
// mai dove la persona ha un ruolo del cliente); il «Dove» che cambia (esce dai casi tolti, i compiti tornano da
// prendere); i dossier nuovi; «Togli» (D9: prima i poteri, poi i casi); l'uscita dal workspace; «Togli» di Lateral
// Space che libera i compiti; la lista della pagina.
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
let builders: typeof import("../../db/queries/use-case-builders.ts");

const LS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
const SUFFIX = suffix.toUpperCase();
/**
 * - lead: Lateral Space, manager del workspace, responsabile di D1, D2, D4; other: Lateral Space, responsabile di D3;
 * - e: esterno, Analista; e2: esterno, Responsabile della trasformazione, AI Board in D2;
 * - unverified, lsperson, contributor, learner, stranger: le aggiunte rifiutate (D10).
 */
const people = ["lead", "other", "e", "e2", "unverified", "lsperson", "contributor", "learner", "stranger"] as const;
type Person = (typeof people)[number];
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  template: randomUUID(),
  ...(Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<Person, string>),
};
const EMAIL: Record<Person, string> = {
  lead: `lead-${suffix}@ls.test`,
  other: `altro-${suffix}@ls.test`,
  e: `alessio-${suffix}@gmail.test`,
  e2: `e2-${suffix}@gmail.test`,
  unverified: `nonverificata-${suffix}@gmail.test`,
  lsperson: `ls-${suffix}@ls.test`,
  contributor: `contributore-${suffix}@gmail.test`,
  learner: `corsista-${suffix}@gmail.test`,
  stranger: `estraneo-${suffix}@gmail.test`,
};
const ROLE: Record<Person, string | null> = {
  lead: "transformation_lead",
  other: "analyst",
  e: "analyst",
  e2: "transformation_lead",
  unverified: "analyst",
  lsperson: "analyst",
  contributor: "contributor",
  learner: "learner",
  stranger: null,
};
/** Use case U1..U5 (U5 senza dossier); dossier D1, D2, D4 (chiuso) del responsabile, D3 dell'altro. */
const uc = { u1: randomUUID(), u2: randomUUID(), u3: randomUUID(), u4: randomUUID(), u5: randomUUID() };
const dossier = { d1: randomUUID(), d2: randomUUID(), d3: randomUUID(), d4: randomUUID() };
const CODE = { u1: "NX-0001", u2: "NX-0002", u3: "NX-0003", u4: "NX-0004", u5: "NX-0005" };

const rolesOf = async (caseId: string, person: Person) => (await q(`SELECT role FROM uc_case_members WHERE case_id = $1 AND user_id = $2 ORDER BY role`, [caseId, ids[person]])).map((r) => r.role);
const grantsOf = async (person: Person) => (await q(`SELECT use_case_id FROM use_case_external_builders WHERE workspace_id = $1 AND user_id = $2 ORDER BY use_case_id NULLS FIRST`, [ids.ws, ids[person]])).map((r) => r.use_case_id);

let dossierSeq = 0;
async function openDossier(caseId: string, useCaseId: string, lead: Person, status = "pronto_sviluppo") {
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova chi costruisce', $7, now())`,
    [caseId, ids.ws, ids.org, useCaseId, ids.template, `XT${++dossierSeq}-${SUFFIX}`, status],
  );
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead')`, [caseId, ids[lead]]);
}

/** Un compito della persona nello use case, in corso o in revisione; il progetto approvato. */
async function heldTask(useCaseId: string, person: Person, ref: string, status: "in_corso" | "in_revisione" = "in_corso") {
  await q(`INSERT INTO use_case_projects (use_case_id, workspace_id, version, status, approved_at) VALUES ($1, $2, 1, 'approvato', now()) ON CONFLICT DO NOTHING`, [useCaseId, ids.ws]);
  await q(`INSERT INTO use_case_tasks (use_case_id, workspace_id, ref, title, status, holder_user_id, taken_at, source) VALUES ($1, $2, $3, 'Compito di prova', $4, $5, now(), 'cli')`, [
    useCaseId,
    ids.ws,
    ref,
    status,
    ids[person],
  ]);
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  await (await import("../../db/ensure-schema.ts")).ensureDbSchema();
  exec = (await import("../../db/uc-executor.ts")).ucExecutorForUrl(url!);
  team = await import("../../db/queries/use-case-workspace-team.ts");
  builders = await import("../../db/queries/use-case-builders.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova chi costruisce', $2)`, [ids.org, `org-cc-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente di prova chi costruisce')`, [ids.ws, ids.org]);
  for (const person of people) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, ${person === "unverified" ? "NULL" : "now()"})`, [ids[person], EMAIL[person], `Prova ${person}`]);
    if (ROLE[person]) await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], ROLE[person]]);
  }
  for (const [key, id] of Object.entries(uc)) {
    await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $2, $3, $4)`, [id, ids.ws, `Caso ${key}`, CODE[key as keyof typeof CODE]]);
  }
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova chi costruisce', 'prova', '{"confidential": false}'::jsonb, $3)`,
    [ids.template, `prova.cc_${suffix}`, randomBytes(32).toString("hex")],
  );
  await openDossier(dossier.d1, uc.u1, "lead");
  await openDossier(dossier.d2, uc.u2, "lead");
  await openDossier(dossier.d3, uc.u3, "other");
  await openDossier(dossier.d4, uc.u4, "lead", "chiuso");
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ai_board')`, [dossier.d2, ids.e2]);
  await q(`INSERT INTO use_case_repos (use_case_id, workspace_id, repo, folder) VALUES ($1, $3, $4, 'casi/nx-0001'), ($2, $3, $4, 'casi/nx-0002')`, [uc.u1, uc.u2, ids.ws, `Prova/nardi-esploso-${suffix}`]);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [people.map((p) => ids[p])]);
});

const add = (person: Person, where: unknown) => team.addExternalBuilder(exec, { workspaceId: ids.ws, actorUserId: ids.lead, userId: ids[person], where, lsDomains: LS });

test("D10: le aggiunte rifiutate: e-mail non verificata, Lateral Space come esterno, Contributore, partecipante ai corsi, non collaboratore", opts, async () => {
  const expected: [Person, string, string][] = [
    ["unverified", "email_non_verificata", "Prima deve confermare la sua e-mail in Unbundle."],
    ["lsperson", "di_lateral_space", "È una persona di Lateral Space: scegli Sviluppatore, Analista o Responsabile."],
    ["contributor", "ruolo_workspace", "Per costruire serve almeno il ruolo di Analista nel workspace: cambialo da Impostazioni › Persone."],
    ["learner", "non_collaboratore", "Questa persona non è un collaboratore del workspace: invitala prima nel workspace, da Impostazioni › Persone, come Analista."],
    ["stranger", "non_collaboratore", "Questa persona non è un collaboratore del workspace: invitala prima nel workspace, da Impostazioni › Persone, come Analista."],
  ];
  for (const [person, code, message] of expected) {
    const r = await add(person, "tutti");
    assert.deepEqual([r.ok, !r.ok && r.code, !r.ok && r.message], [false, code, message], person);
    assert.deepEqual(await grantsOf(person), [], `${person}: nessuna concessione`);
  }
  // Un ruolo di Lateral Space a chi viene da fuori: «Sviluppatore esterno».
  const lsRole = await team.addWorkspaceTeamMember(exec, { workspaceId: ids.ws, actorUserId: ids.lead, userId: ids.e, role: "ls_analista", lsDomains: LS });
  assert.deepEqual([lsRole.ok, !lsRole.ok && lsRole.code, !lsRole.ok && lsRole.message], [false, "ruolo_non_ammesso", "Analista e Responsabile sono ruoli di Lateral Space: per chi viene da fuori c'è Sviluppatore esterno."]);
  // Un «Dove» con un caso che non è del cliente, o vuoto.
  assert.deepEqual(await add("e", [randomUUID()]).then((r) => !r.ok && r.code), "dati_non_validi");
  assert.deepEqual(await add("e", []).then((r) => !r.ok && r.code), "dati_non_validi");
});

test("«Aggiungi» in tutti i casi: entra nei dossier aperti dove chi agisce è responsabile; gli altri si dicono; i chiusi no", opts, async () => {
  const r = await add("e", "tutti");
  assert.ok(r.ok, r.ok ? "" : r.message);
  if (!r.ok) return;
  assert.deepEqual(await grantsOf("e"), [null], "una riga «tutti»");
  assert.deepEqual([...r.value.entered].sort(), [CODE.u1, CODE.u2].sort());
  assert.deepEqual(r.value.skipped, [{ code: CODE.u3, reason: "attore_non_ammesso" }], "lì non è responsabile");
  assert.deepEqual(r.value.repos, [`Prova/nardi-esploso-${suffix}`]);
  assert.deepEqual(await rolesOf(dossier.d1, "e"), ["osservatore"]);
  assert.deepEqual(await rolesOf(dossier.d4, "e"), [], "un dossier chiuso non cambia");
  // La stessa aggiunta di nuovo non cambia niente.
  const again = await add("e", "tutti");
  assert.ok(again.ok && again.value.entered.length === 0 && again.value.already.length === 2);
  assert.equal(await builders.isExternalBuilderOfCase(exec, { caseId: dossier.d1, userId: ids.e, lsDomains: LS }), true);
});

test("«Solo in alcuni casi»: mai dove la persona firma o approva per il cliente; un caso senza dossier entra quando si apre", opts, async () => {
  const r = await add("e2", [uc.u2, uc.u5]);
  assert.ok(r.ok, r.ok ? "" : r.message);
  if (!r.ok) return;
  assert.deepEqual((await grantsOf("e2")).sort(), [uc.u2, uc.u5].sort());
  assert.deepEqual(r.value.entered, []);
  assert.deepEqual(r.value.skipped, [{ code: CODE.u2, reason: "ruolo_cliente" }]);
  assert.deepEqual(await rolesOf(dossier.d2, "e2"), ["ai_board"], "lì non costruisce");
  // Il dossier nuovo di U5: entra E2 (la sua concessione), E con «tutti» pure.
  const d5 = randomUUID();
  await openDossier(d5, uc.u5, "lead");
  const applied = await team.applyExternalBuildersToCase(exec, { workspaceId: ids.ws, caseId: d5, actorUserId: ids.lead, lsDomains: LS });
  assert.deepEqual([...applied.done].sort(), [ids.e, ids.e2].sort());
  assert.deepEqual(await rolesOf(d5, "e2"), ["osservatore"]);
  assert.equal(await builders.isExternalBuilderOfCase(exec, { caseId: d5, userId: ids.e2, lsDomains: LS }), true);
  // Chi oggi non può costruire (sceso a Contributore) non entra nel dossier nuovo.
  await q(`UPDATE workspace_memberships SET role = 'contributor' WHERE workspace_id = $1 AND user_id = $2`, [ids.ws, ids.e2]);
  const d6 = randomUUID();
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $2, 'Caso u6', 'NX-0006')`, [d6, ids.ws]);
  await add("e", "tutti");
  const d6case = randomUUID();
  await openDossier(d6case, d6, "lead");
  await q(`INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id) VALUES ($1, $2, $3)`, [ids.ws, ids.e2, d6]);
  const skipped = await team.applyExternalBuildersToCase(exec, { workspaceId: ids.ws, caseId: d6case, actorUserId: ids.lead, lsDomains: LS });
  assert.ok(skipped.done.includes(ids.e) && !skipped.done.includes(ids.e2), "solo chi oggi può costruire");
  await q(`UPDATE workspace_memberships SET role = 'transformation_lead' WHERE workspace_id = $1 AND user_id = $2`, [ids.ws, ids.e2]);
});

test("il «Dove» che cambia: esce dai casi tolti, dove i suoi compiti tornano da prendere con una nota senza nomi", opts, async () => {
  await heldTask(uc.u2, "e", "T-1");
  await heldTask(uc.u2, "e", "T-2", "in_revisione");
  await heldTask(uc.u1, "e", "T-1");
  const r = await add("e", [uc.u1]);
  assert.ok(r.ok, r.ok ? "" : r.message);
  if (!r.ok) return;
  assert.deepEqual(r.value.left.includes(CODE.u2), true);
  assert.equal(r.value.released, 2);
  assert.deepEqual(await rolesOf(dossier.d2, "e"), [], "uscita dal caso tolto");
  assert.deepEqual(await rolesOf(dossier.d1, "e"), ["osservatore"], "resta dove costruisce");
  const tasks = await q(`SELECT use_case_id, ref, status, holder_user_id FROM use_case_tasks WHERE workspace_id = $1 AND use_case_id = ANY($2::uuid[]) ORDER BY use_case_id, ref`, [ids.ws, [uc.u1, uc.u2]]);
  const byKey = new Map(tasks.map((t) => [`${t.use_case_id === uc.u1 ? "u1" : "u2"}:${t.ref}`, t]));
  assert.deepEqual([byKey.get("u2:T-1")?.status, byKey.get("u2:T-1")?.holder_user_id], ["da_fare", null]);
  assert.deepEqual([byKey.get("u2:T-2")?.status, byKey.get("u2:T-2")?.holder_user_id], ["in_revisione", null], "in revisione resta in revisione, senza persona");
  assert.deepEqual([byKey.get("u1:T-1")?.status, byKey.get("u1:T-1")?.holder_user_id], ["in_corso", ids.e], "dove costruisce ancora, il compito resta suo");
  const notes = await q(`SELECT body FROM use_case_task_notes WHERE use_case_id = $1 AND kind = 'passaggio'`, [uc.u2]);
  assert.deepEqual(notes.map((n) => n.body), [team.RELEASED_TASK_NOTE, team.RELEASED_TASK_NOTE]);
  assert.ok(!notes.some((n) => String(n.body).includes("Prova")), "nessun nome nella nota");
  const ready = await q(`SELECT recipient_user_id FROM use_case_notifications WHERE use_case_id = $1 AND kind = 'compiti_pronti'`, [uc.u2]);
  assert.deepEqual(ready.map((r) => r.recipient_user_id), [ids.lead], "a chi costruisce quel caso");
});

test("la lista di «Chi costruisce»: il team di Lateral Space e chi costruisce da fuori, con la CLI e perché oggi non costruisce", opts, async () => {
  await team.addWorkspaceTeamMember(exec, { workspaceId: ids.ws, actorUserId: ids.lead, userId: ids.other, role: "ls_sviluppatore", lsDomains: LS });
  await q(
    `INSERT INTO workspace_integration_tokens (workspace_id, label, provider, token_hash, token_prefix, scopes, created_by_user_id, owner_user_id, expires_at)
     VALUES ($1, 'CLI di prova', 'unbundle_cli', $2, 'ub_cli_prova', '["cli"]'::jsonb, $3, $3, now() + interval '90 days')`,
    [ids.ws, randomBytes(32).toString("hex"), ids.e],
  );
  await q(`UPDATE workspace_memberships SET role = 'contributor' WHERE workspace_id = $1 AND user_id = $2`, [ids.ws, ids.e2]);
  const rows = await team.listBuilders(exec, ids.ws, LS);
  const of = (person: Person) => rows.find((r) => r.userId === ids[person]);
  assert.deepEqual([of("e")?.external, of("e")?.role, of("e")?.cli, of("e")?.blocked, of("e")?.where], [true, "builder_esterno", true, null, { all: false, useCaseIds: [uc.u1] }]);
  assert.deepEqual(of("e")?.whereCodes, [CODE.u1]);
  assert.deepEqual([of("e2")?.blocked, of("e2")?.cli], ["ruolo_workspace", false], "sceso a Contributore: non costruisce");
  assert.deepEqual([of("other")?.external, of("other")?.role, of("other")?.cli], [false, "ls_sviluppatore", false]);
  await q(`UPDATE workspace_memberships SET role = 'transformation_lead' WHERE workspace_id = $1 AND user_id = $2`, [ids.ws, ids.e2]);
  const choices = await team.listWhereChoices(exec, ids.ws);
  assert.deepEqual(choices.slice(0, 5).map((c) => c.code), [CODE.u1, CODE.u2, CODE.u3, CODE.u4, CODE.u5], "anche gli use case senza dossier");
});

test("D9: «Togli»: prima i poteri (concessioni, token, compiti), poi esce dai casi; si ferma solo dove chi agisce non è responsabile", opts, async () => {
  const r = await team.removeExternalBuilder(exec, { workspaceId: ids.ws, actorUserId: ids.lead, userId: ids.e, lsDomains: LS });
  assert.ok(r.ok, r.ok ? "" : r.message);
  if (!r.ok) return;
  assert.deepEqual(await grantsOf("e"), []);
  assert.equal(r.value.revokedTokens, 1);
  const [live] = await q(`SELECT count(*)::int AS n FROM workspace_integration_tokens WHERE workspace_id = $1 AND owner_user_id = $2 AND revoked_at IS NULL`, [ids.ws, ids.e]);
  assert.equal(live.n, 0, "i token della CLI e dell'MCP del caso sono revocati");
  assert.equal(r.value.released, 1, "il compito che aveva in U1 torna da prendere");
  assert.deepEqual(r.value.left.sort(), [CODE.u1].sort());
  assert.deepEqual(await rolesOf(dossier.d1, "e"), []);
  assert.deepEqual(r.value.repos, [`Prova/nardi-esploso-${suffix}`]);
  assert.equal(await builders.isExternalBuilderOfCase(exec, { caseId: dossier.d1, userId: ids.e, lsDomains: LS }), false);
  const none = await team.removeExternalBuilder(exec, { workspaceId: ids.ws, actorUserId: ids.lead, userId: ids.e, lsDomains: LS });
  assert.deepEqual([none.ok, !none.ok && none.code], [false, "non_trovato"]);
  // Dove chi toglie non è responsabile, la riga osservatore resta (senza poteri) e si dice.
  await add("e", [uc.u3]);
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'osservatore') ON CONFLICT DO NOTHING`, [dossier.d3, ids.e]);
  const partial = await team.removeExternalBuilder(exec, { workspaceId: ids.ws, actorUserId: ids.lead, userId: ids.e, lsDomains: LS });
  assert.ok(partial.ok && partial.value.skipped.some((s) => s.code === CODE.u3 && s.reason === "attore_non_ammesso"));
  assert.equal(await builders.isExternalBuilderOfCase(exec, { caseId: dossier.d3, userId: ids.e, lsDomains: LS }), false, "senza concessione non costruisce");
  await q(`DELETE FROM uc_case_members WHERE case_id = $1 AND user_id = $2`, [dossier.d3, ids.e]);
});

test("l'uscita dal workspace: concessioni cancellate, compiti liberati, token revocati; «Togli» di Lateral Space libera i compiti", opts, async () => {
  await heldTask(uc.u5, "e2", "T-1");
  await q(
    `INSERT INTO workspace_integration_tokens (workspace_id, label, provider, token_hash, token_prefix, scopes, created_by_user_id, owner_user_id, expires_at)
     VALUES ($1, 'CLI di prova', 'unbundle_cli', $2, 'ub_cli_prova', '["cli"]'::jsonb, $3, $3, now() + interval '90 days')`,
    [ids.ws, randomBytes(32).toString("hex"), ids.e2],
  );
  const { removeUserFromWorkspaceCases } = await import("../../db/queries/uc-cases.ts");
  await q(`DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, [ids.ws, ids.e2]);
  await removeUserFromWorkspaceCases(exec, { workspaceId: ids.ws, userId: ids.e2, actorUserId: ids.lead });
  const left = await team.leaveWorkspaceFactory(exec, { workspaceId: ids.ws, userId: ids.e2, lsDomains: LS });
  assert.equal(left.released, 1);
  assert.deepEqual(await grantsOf("e2"), []);
  const [live] = await q(`SELECT count(*)::int AS n FROM workspace_integration_tokens WHERE workspace_id = $1 AND owner_user_id = $2 AND revoked_at IS NULL`, [ids.ws, ids.e2]);
  assert.equal(live.n, 0);
  const [task] = await q(`SELECT status, holder_user_id FROM use_case_tasks WHERE use_case_id = $1 AND ref = 'T-1'`, [uc.u5]);
  assert.deepEqual([task.status, task.holder_user_id], ["da_fare", null]);

  // «Togli» di Lateral Space: esce dai casi del ruolo del team e i suoi compiti lì tornano da prendere.
  await heldTask(uc.u1, "other", "T-9");
  const removed = await team.removeWorkspaceTeamMember(exec, { workspaceId: ids.ws, actorUserId: ids.lead, userId: ids.other, lsDomains: LS });
  assert.ok(removed.ok, removed.ok ? "" : removed.message);
  if (!removed.ok) return;
  assert.equal(removed.value.released, 1);
  const [t9] = await q(`SELECT status, holder_user_id FROM use_case_tasks WHERE use_case_id = $1 AND ref = 'T-9'`, [uc.u1]);
  assert.deepEqual([t9.status, t9.holder_user_id], ["da_fare", null]);
});
