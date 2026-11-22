import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { Client as PgClient } from "pg";

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
 * - unverified, lsperson, contributor, learner, stranger: le aggiunte rifiutate (D10);
 * - racer: esterno, Analista, per le corse tra «Avvia la realizzazione» e «Togli».
 */
const people = ["lead", "other", "e", "e2", "unverified", "lsperson", "contributor", "learner", "stranger", "fresh", "racer"] as const;
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
  e: `sandro-${suffix}@gmail.test`,
  e2: `e2-${suffix}@gmail.test`,
  unverified: `nonverificata-${suffix}@gmail.test`,
  lsperson: `ls-${suffix}@ls.test`,
  contributor: `contributore-${suffix}@gmail.test`,
  learner: `corsista-${suffix}@gmail.test`,
  stranger: `estraneo-${suffix}@gmail.test`,
  fresh: `nuova-${suffix}@gmail.test`,
  racer: `corsa-${suffix}@gmail.test`,
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
  fresh: "analyst",
  racer: "analyst",
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

/** Una connessione sua al database di prova, per tenere il lock di una persona come lo terrebbe un'altra richiesta. */
async function lockHolder(): Promise<PgClient> {
  const pg = createRequire(import.meta.url)("pg") as { Client: new (config: { connectionString: string }) => PgClient };
  const client = new pg.Client({ connectionString: url! });
  await client.connect();
  return client;
}

/** La chiave del lock di una persona in «Chi costruisce» (`grantLockSql` di use-case-builders.ts). */
const PERSON_LOCK = `hashtext('unbundle:external-builders:' || $1 || ':' || $2)`;

/** Vero quando una transazione di questo database aspetta un advisory lock (al massimo 3 secondi). */
async function someoneWaits(client: PgClient): Promise<boolean> {
  for (let i = 0; i < 150; i++) {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    );
    if (rows[0].n > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
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
  await q(`INSERT INTO use_case_repos (use_case_id, workspace_id, repo, folder) VALUES ($1, $3, $4, 'casi/nx-0001'), ($2, $3, $4, 'casi/nx-0002')`, [uc.u1, uc.u2, ids.ws, `Prova/alfa-esploso-${suffix}`]);
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
    ["contributor", "ruolo_workspace", "Per costruire serve almeno il ruolo di Analista nel workspace: cambialo da Impostazioni › Team."],
    ["learner", "non_collaboratore", "Questa persona non fa parte del workspace: invitala prima, da Impostazioni › Team, come Analista."],
    ["stranger", "non_collaboratore", "Questa persona non fa parte del workspace: invitala prima, da Impostazioni › Team, come Analista."],
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

test("«Persona» in «Chi costruisce»: chi «Aggiungi» rifiuterebbe è segnato con il perché, con gli stessi controlli", opts, async () => {
  const candidates = ["e", "e2", "unverified", "contributor", "fresh"] as const;
  const refused = await team.externalRefusals(exec, ids.ws, candidates.map((p) => ids[p]), LS);
  assert.deepEqual(
    Object.fromEntries(candidates.map((p) => [p, refused.get(ids[p]) ?? null])),
    { e: null, e2: null, unverified: "email_non_verificata", contributor: "ruolo_workspace", fresh: null },
  );
  // Gli stessi di «Aggiungi»: chi è segnato è rifiutato con quel codice.
  for (const person of ["unverified", "contributor"] as const) {
    const r = await add(person, "tutti");
    assert.deepEqual([r.ok, !r.ok && r.code], [false, refused.get(ids[person])], person);
  }
});

test("«Aggiungi» in tutti i casi: entra nei dossier aperti dove chi agisce è responsabile; gli altri si dicono; i chiusi no", opts, async () => {
  const r = await add("e", "tutti");
  assert.ok(r.ok, r.ok ? "" : r.message);
  if (!r.ok) return;
  assert.deepEqual(await grantsOf("e"), [null], "una riga «tutti»");
  assert.deepEqual([...r.value.entered].sort(), [CODE.u1, CODE.u2].sort());
  assert.deepEqual(r.value.skipped, [{ code: CODE.u3, reason: "attore_non_ammesso" }], "lì non è responsabile");
  assert.deepEqual(r.value.repos, [`Prova/alfa-esploso-${suffix}`]);
  assert.deepEqual(await rolesOf(dossier.d1, "e"), ["osservatore"]);
  assert.deepEqual(await rolesOf(dossier.d4, "e"), [], "un dossier chiuso non cambia");
  // La stessa aggiunta di nuovo non cambia niente.
  const again = await add("e", "tutti");
  assert.ok(again.ok && again.value.entered.length === 0 && again.value.already.length === 2);
  assert.equal(await builders.isExternalBuilderOfCase(exec, { caseId: dossier.d1, userId: ids.e, lsDomains: LS }), true);
});

test("«tutti» copre solo i dossier di uno use case: uno senza use case resta fuori, anche con la riga data a mano", opts, async () => {
  const orphan = randomUUID();
  const code = `XO-${SUFFIX}`;
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, $4::uuid, '1.0.0', $5, 'Dossier di prova senza use case', 'pronto_sviluppo', now())`,
    [orphan, ids.ws, ids.org, ids.template, code],
  );
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead')`, [orphan, ids.lead]);
  try {
    assert.deepEqual(await grantsOf("e"), [null], "E costruisce in tutti i casi");
    const applied = await team.applyExternalBuildersToCase(exec, { workspaceId: ids.ws, caseId: orphan, actorUserId: ids.lead, lsDomains: LS });
    assert.deepEqual(applied, { done: [], unchanged: [], skipped: [] }, "«Avvia la realizzazione» non ce la mette");
    assert.deepEqual(await rolesOf(orphan, "e"), []);
    const again = await add("e", "tutti");
    assert.ok(again.ok, again.ok ? "" : again.message);
    if (!again.ok) return;
    assert.ok(![...again.value.entered, ...again.value.already, ...again.value.skipped.map((s) => s.code)].includes(code), "«Aggiungi» non lo conta");
    // Con la riga data a mano: legge da osservatore, non costruisce, e lì non è tra chi costruisce.
    await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'osservatore')`, [orphan, ids.e]);
    assert.equal(await builders.isExternalBuilderOfCase(exec, { caseId: orphan, userId: ids.e, lsDomains: LS }), false);
    assert.deepEqual(await builders.caseGrantUserIds(exec, orphan), []);
    assert.deepEqual(await builders.caseBuilderEmails(exec, orphan), []);
    assert.equal(await builders.hasGrantForCase(exec, { caseId: orphan, userId: ids.e }), false);
  } finally {
    await q(`DELETE FROM uc_case_members WHERE case_id = $1 AND user_id = $2`, [orphan, ids.e]);
  }
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
  assert.deepEqual(r.value.repos, [`Prova/alfa-esploso-${suffix}`]);
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

test("«Avvia la realizzazione» che ha letto le concessioni prima di «Togli»: la riga osservatore aspetta il lock della persona ed entra solo se la concessione c'è ancora", opts, async () => {
  const added = await add("racer", "tutti");
  assert.ok(added.ok, added.ok ? "" : added.message);
  const useCaseId = randomUUID();
  const caseId = randomUUID();
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $2, 'Caso della corsa', 'NX-0007')`, [useCaseId, ids.ws]);
  await openDossier(caseId, useCaseId, "lead");
  const holder = await lockHolder();
  try {
    // Un'altra richiesta tiene il lock della persona (come la transazione di «Togli»).
    await holder.query(`SELECT pg_advisory_lock(${PERSON_LOCK})`, [ids.ws, ids.racer]);
    const applying = team.applyExternalBuildersToCase(exec, { workspaceId: ids.ws, caseId, actorUserId: ids.lead, lsDomains: LS });
    assert.equal(await someoneWaits(holder), true, "la riga aspetta il lock della persona");
    // «Togli» toglie la concessione e lascia il lock: la riga non entra.
    await holder.query(`DELETE FROM use_case_external_builders WHERE workspace_id = $1 AND user_id = $2`, [ids.ws, ids.racer]);
    await holder.query(`SELECT pg_advisory_unlock(${PERSON_LOCK})`, [ids.ws, ids.racer]);
    const applied = await applying;
    assert.deepEqual(applied.skipped, [{ code: ids.racer, reason: "concessione_tolta" }]);
    assert.deepEqual(await rolesOf(caseId, "racer"), [], "chi è stato tolto non rientra dal dossier nuovo");
  } finally {
    await holder.end();
  }
});

test("«Togli» legge i casi dopo il lock della persona: esce anche dal dossier dove la riga è entrata un attimo prima", opts, async () => {
  const added = await add("racer", "tutti");
  assert.ok(added.ok, added.ok ? "" : added.message);
  const useCaseId = randomUUID();
  const caseId = randomUUID();
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $2, 'Caso della corsa due', 'NX-0008')`, [useCaseId, ids.ws]);
  const holder = await lockHolder();
  try {
    await holder.query(`SELECT pg_advisory_lock(${PERSON_LOCK})`, [ids.ws, ids.racer]);
    const removing = team.removeExternalBuilder(exec, { workspaceId: ids.ws, actorUserId: ids.lead, userId: ids.racer, lsDomains: LS });
    assert.equal(await someoneWaits(holder), true, "«Togli» aspetta il lock della persona");
    // Intanto «Avvia la realizzazione» apre un dossier e la persona ci entra, prima che «Togli» prenda il lock.
    await openDossier(caseId, useCaseId, "lead");
    await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'osservatore')`, [caseId, ids.racer]);
    await holder.query(`SELECT pg_advisory_unlock(${PERSON_LOCK})`, [ids.ws, ids.racer]);
    const removed = await removing;
    assert.ok(removed.ok, removed.ok ? "" : removed.message);
    if (!removed.ok) return;
    assert.ok(removed.value.left.includes("NX-0008"), JSON.stringify(removed.value));
    assert.deepEqual(await rolesOf(caseId, "racer"), [], "esce anche dal dossier nuovo");
    assert.deepEqual(await grantsOf("racer"), []);
  } finally {
    await holder.end();
  }
});

test("il «Dove» che si stringe legge i casi di prima dopo il lock della persona: esce anche dal dossier dove la riga è entrata un attimo prima", opts, async () => {
  const added = await add("racer", "tutti");
  assert.ok(added.ok, added.ok ? "" : added.message);
  const useCaseId = randomUUID();
  const caseId = randomUUID();
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $2, 'Caso della corsa tre', 'NX-0009')`, [useCaseId, ids.ws]);
  const holder = await lockHolder();
  try {
    await holder.query(`SELECT pg_advisory_lock(${PERSON_LOCK})`, [ids.ws, ids.racer]);
    const narrowing = add("racer", [uc.u1]);
    assert.equal(await someoneWaits(holder), true, "il «Dove» nuovo aspetta il lock della persona");
    // Intanto «Avvia la realizzazione» apre un dossier e la persona ci entra: «tutti» lo copre ancora.
    await openDossier(caseId, useCaseId, "lead");
    await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'osservatore')`, [caseId, ids.racer]);
    await holder.query(`SELECT pg_advisory_unlock(${PERSON_LOCK})`, [ids.ws, ids.racer]);
    const narrowed = await narrowing;
    assert.ok(narrowed.ok, narrowed.ok ? "" : narrowed.message);
    if (!narrowed.ok) return;
    assert.ok(narrowed.value.left.includes("NX-0009"), JSON.stringify(narrowed.value));
    assert.deepEqual(await rolesOf(caseId, "racer"), [], "non resta a guardare un dossier che il «Dove» nuovo non copre");
    assert.deepEqual(await grantsOf("racer"), [uc.u1]);
    assert.deepEqual(await rolesOf(dossier.d1, "racer"), ["osservatore"], "nel caso che resta nel «Dove» non cambia niente");
  } finally {
    await holder.end();
    await team.removeExternalBuilder(exec, { workspaceId: ids.ws, actorUserId: ids.lead, userId: ids.racer, lsDomains: LS });
    await q(`DELETE FROM uc_case_members WHERE case_id = $1 AND user_id = $2`, [caseId, ids.racer]);
  }
});

test("«Aggiungi» aspetta il lock della persona: due «Dove» scritti insieme non si mescolano, resta l'ultimo per intero", opts, async () => {
  assert.deepEqual(await grantsOf("racer"), []);
  const holder = await lockHolder();
  try {
    // Un altro «Aggiungi» per la stessa persona tiene il suo lock e non ha ancora scritto.
    await holder.query(`SELECT pg_advisory_lock(${PERSON_LOCK})`, [ids.ws, ids.racer]);
    const adding = add("racer", "tutti");
    assert.equal(await someoneWaits(holder), true, "«Aggiungi» aspetta il lock della persona");
    assert.deepEqual(await grantsOf("racer"), [], "finché aspetta non ha scritto niente");
    // L'altro scrive «solo in NX-0001» e lascia il lock: adesso tocca a questo, che lo sostituisce con «tutti».
    await holder.query(`INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id, added_by_user_id) VALUES ($1, $2, $3, $4)`, [ids.ws, ids.racer, uc.u1, ids.lead]);
    await holder.query(`SELECT pg_advisory_unlock(${PERSON_LOCK})`, [ids.ws, ids.racer]);
    const added = await adding;
    assert.ok(added.ok, added.ok ? "" : added.message);
    assert.deepEqual(await grantsOf("racer"), [null], "una riga «tutti», mai insieme a righe per caso");
  } finally {
    await holder.end();
    await team.removeExternalBuilder(exec, { workspaceId: ids.ws, actorUserId: ids.lead, userId: ids.racer, lsDomains: LS });
  }
});

test("l'uscita dal workspace aspetta il lock della persona: la concessione che un «Aggiungi» stava scrivendo se ne va con l'uscita", opts, async () => {
  assert.deepEqual(await grantsOf("racer"), []);
  const holder = await lockHolder();
  try {
    // Un «Aggiungi» già partito: la sua transazione ha il lock della persona e non ha ancora scritto la concessione.
    await holder.query("BEGIN");
    await holder.query(`SELECT pg_advisory_xact_lock(${PERSON_LOCK})`, [ids.ws, ids.racer]);
    const leaving = team.leaveWorkspaceFactory(exec, { workspaceId: ids.ws, userId: ids.racer, lsDomains: LS });
    assert.equal(await someoneWaits(holder), true, "l'uscita aspetta il lock della persona");
    await holder.query(`INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id, added_by_user_id) VALUES ($1, $2, NULL, $3)`, [ids.ws, ids.racer, ids.lead]);
    await holder.query("COMMIT");
    await leaving;
    assert.deepEqual(await grantsOf("racer"), [], "senza il lock l'uscita cancellerebbe prima, e questa concessione resterebbe");
  } finally {
    await holder.end();
    await q(`DELETE FROM use_case_external_builders WHERE workspace_id = $1 AND user_id = $2`, [ids.ws, ids.racer]);
  }
});

test("gli stessi id scritti in maiuscolo prendono lo stesso lock della persona", opts, async () => {
  const holder = await lockHolder();
  try {
    // Il lock con gli id in minuscolo, come li dà Postgres; la scrittura li riceve in maiuscolo (da un indirizzo, da un modulo).
    await holder.query(`SELECT pg_advisory_lock(${PERSON_LOCK})`, [ids.ws, ids.racer]);
    const upper = exec.batch(builders.deleteGrantsStatements(ids.ws.toUpperCase(), ids.racer.toUpperCase()));
    assert.equal(await someoneWaits(holder), true, "la stessa persona, lo stesso lock");
    await holder.query(`SELECT pg_advisory_unlock(${PERSON_LOCK})`, [ids.ws, ids.racer]);
    await upper;
    // E al contrario, con le istruzioni vere da tutte e due le parti: una transazione ha preso il lock con gli id in
    // maiuscolo, e la riga osservatore di un dossier, chiesta con gli id in minuscolo, si mette in fila dietro.
    const [lock] = builders.deleteGrantsStatements(ids.ws.toUpperCase(), ids.racer.toUpperCase());
    await holder.query("BEGIN");
    await holder.query(lock.text, [...lock.params]);
    const lower = exec.batch(builders.grantGuardStatements(ids.ws, ids.racer, dossier.d1)).catch((error: unknown) => error);
    assert.equal(await someoneWaits(holder), true, "anche la riga osservatore si mette in fila");
    await holder.query("COMMIT");
    // Senza concessione la riga non entra: dopo il lock la guardia risponde «concessione tolta».
    const refused = await lower;
    assert.ok(refused instanceof Error && /concessione_tolta/.test(refused.message), "la guardia è passata dopo il lock");
  } finally {
    await holder.end();
  }
});

test("«Aggiungi» di chi non è responsabile di nessun dossier: ogni caso saltato, il messaggio lo dice; la riga e «Togli» contano le righe vere", opts, async () => {
  const { externalAddedText, externalRemoveConfirm } = await import("./builders-text.ts");
  // Lateral Space, ma responsabile di nessun dossier: ogni caso aperto si salta.
  const added = await team.addExternalBuilder(exec, { workspaceId: ids.ws, actorUserId: ids.lsperson, userId: ids.racer, where: "tutti", lsDomains: LS });
  assert.ok(added.ok, added.ok ? "" : added.message);
  if (!added.ok) return;
  assert.deepEqual([added.value.entered, added.value.already, added.value.openCases], [[], [], 0]);
  assert.ok(added.value.skipped.length >= 3 && added.value.skipped.every((s) => s.reason === "attore_non_ammesso"), JSON.stringify(added.value.skipped));
  assert.match(externalAddedText(added.value), /^Per ora non costruisce in nessun caso aperto: entrerà in quelli nuovi\. .* Saltati: /);
  const rowOf = async () => (await team.listBuilders(exec, ids.ws, LS)).find((r) => r.userId === ids.racer);
  const row = await rowOf();
  assert.deepEqual([row?.where, row?.openCases], [{ all: true }, 0], "«tutti i casi» come «Dove», in nessun dossier");
  assert.equal(externalRemoveConfirm({ name: "Prova racer", openCases: row!.openCases, repos: row!.repos }).text.includes("Esce da"), false);
  // Il responsabile lo mette nei suoi dossier: la riga conta quelli.
  const byLead = await add("racer", "tutti");
  assert.ok(byLead.ok && byLead.value.entered.length > 0, byLead.ok ? JSON.stringify(byLead.value) : byLead.message);
  if (!byLead.ok) return;
  assert.equal(byLead.value.openCases, byLead.value.entered.length + byLead.value.already.length);
  assert.equal((await rowOf())?.openCases, byLead.value.entered.length + byLead.value.already.length);
  const removed = await team.removeExternalBuilder(exec, { workspaceId: ids.ws, actorUserId: ids.lead, userId: ids.racer, lsDomains: LS });
  assert.ok(removed.ok && removed.value.left.length === byLead.value.openCases, "«Togli» esce da quelli");
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

test("le e-mail: «Costruisci i casi d'uso di…» aspetta l'ok ai sub-responsabili; le e-mail di chi costruisce partono solo con l'ok; «Non costruisci più…»", opts, async () => {
  const dispatch = await import("../../db/queries/uc-notifications-dispatch.ts");
  const notices = await import("../../db/queries/use-case-tasks-notices.ts");
  const outbox: { to: string; subject: string; text: string }[] = [];
  const mailer = { async send(m: { to: string; subject: string; text: string }) { outbox.push(m); return { ok: true as const }; } };
  const env = { UC_ENABLED: "true", RESEND_API_KEY: "re_test_finto", UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>", NEXT_PUBLIC_APP_URL: "http://localhost:3000", UC_LS_EMAIL_DOMAINS: "ls.test" };
  const send = (scope: { notificationId?: string; caseId?: string }) => dispatch.dispatchQueue(exec, { env, mailer, sendIntervalMs: 0, ...scope });
  const row = async (id: string) => (await q(`SELECT status, hold_reason, error FROM uc_notifications WHERE id = $1`, [id]))[0];

  const added = await add("fresh", "tutti");
  assert.ok(added.ok && added.value.noticeId, "l'e-mail di benvenuto in coda");
  if (!added.ok || !added.value.noticeId) return;
  const welcome = added.value.noticeId;
  // Un «Dove» che cambia non la rimanda.
  const again = await add("fresh", "tutti");
  assert.ok(again.ok && again.value.noticeId === null);
  // Senza l'ok ai sub-responsabili: il benvenuto aspetta, le e-mail di chi costruisce si annullano (resta la campanella).
  await exec.batch(notices.notifyTask({ workspaceId: ids.ws, useCaseId: uc.u1 }, "compiti_pronti", { builders: await builders.loadBuilderScope(exec, LS) }, notices.NOBODY, new Date(), null));
  await send({ notificationId: welcome });
  assert.deepEqual(await row(welcome), { status: "in_coda", hold_reason: "sub_responsabili_mancanti", error: null });
  await send({ caseId: dossier.d1 });
  const [ready] = await q(`SELECT status, error FROM uc_notifications WHERE case_id = $1 AND template_key = 'compiti_pronti' AND recipient_user_id = $2`, [dossier.d1, ids.fresh]);
  assert.deepEqual(ready, { status: "annullata", error: "sub_responsabili_mancanti" });
  assert.ok(outbox.some((m) => m.to === EMAIL.lead), "a Lateral Space come prima");
  assert.ok(!outbox.some((m) => m.to === EMAIL.fresh));
  const [bell] = await q(`SELECT count(*)::int AS n FROM use_case_notifications WHERE use_case_id = $1 AND kind = 'compiti_pronti' AND recipient_user_id = $2`, [uc.u1, ids.fresh]);
  assert.equal(bell.n, 1, "la campanella resta");
  // L'ok del cliente: il benvenuto parte, e le e-mail nuove di chi costruisce pure.
  await q(`INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'transformation_lead')`, [ids.ws, ids.e2]);
  await send({ notificationId: welcome });
  assert.equal((await row(welcome)).status, "inviata");
  const mail = outbox.find((m) => m.to === EMAIL.fresh);
  assert.ok(mail);
  // (Rilascio 10, §3.12) «{Cliente}: costruisci i suoi casi d'uso», al massimo 55 caratteri: si accorcia il cliente.
  assert.equal(mail!.subject, "Cliente di prova chi cos…: costruisci i suoi casi d'uso");
  assert.match(mail!.text, /tutti, anche quelli che si apriranno/);
  await exec.batch(notices.notifyTask({ workspaceId: ids.ws, useCaseId: uc.u1 }, "compito_passato", { userId: ids.fresh }, ids.lead, new Date(), "T-1"));
  await send({ caseId: dossier.d1 });
  assert.ok(outbox.some((m) => m.to === EMAIL.fresh && /: il compito T-1 è tuo «/.test(m.subject)), "con l'ok, le e-mail di chi costruisce partono");
  // «Togli»: «Non costruisci più…», con l'ok.
  const removed = await team.removeExternalBuilder(exec, { workspaceId: ids.ws, actorUserId: ids.lead, userId: ids.fresh, lsDomains: LS });
  assert.ok(removed.ok && removed.value.noticeId);
  if (!removed.ok || !removed.value.noticeId) return;
  await send({ notificationId: removed.value.noticeId });
  assert.equal((await row(removed.value.noticeId)).status, "inviata");
  assert.ok(outbox.some((m) => m.to === EMAIL.fresh && m.subject === "Cliente di prova…: non costruisci più i suoi casi d'uso"));
  // Un benvenuto in coda di chi nel frattempo è stato tolto non parte.
  const back = await add("fresh", [uc.u1]);
  assert.ok(back.ok && back.value.noticeId);
  if (!back.ok || !back.value.noticeId) return;
  await team.removeExternalBuilder(exec, { workspaceId: ids.ws, actorUserId: ids.lead, userId: ids.fresh, lsDomains: LS });
  await send({ notificationId: back.value.noticeId });
  assert.deepEqual(await row(back.value.noticeId), { status: "annullata", hold_reason: null, error: "concessione_tolta" });
});

test("la coda con la sonda della 0037 che non risponde: le e-mail a chi costruisce da fuori aspettano il prossimo giro, non si annullano e non partono a caso", opts, async () => {
  const dispatch = await import("../../db/queries/uc-notifications-dispatch.ts");
  const notices = await import("../../db/queries/use-case-tasks-notices.ts");
  type Exec = typeof exec;
  const outbox: { to: string; subject: string }[] = [];
  const mailer = { async send(m: { to: string; subject: string }) { outbox.push(m); return { ok: true as const }; } };
  const env = { UC_ENABLED: "true", RESEND_API_KEY: "re_test_finto", UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>", NEXT_PUBLIC_APP_URL: "http://localhost:3000", UC_LS_EMAIL_DOMAINS: "ls.test" };
  const send = (executor: Exec, notificationId: string) => dispatch.dispatchQueue(executor, { env, mailer, sendIntervalMs: 0, notificationId });
  const row = async (id: string) => (await q(`SELECT status, hold_reason, error FROM uc_notifications WHERE id = $1`, [id]))[0];
  const toRacer = () => outbox.filter((m) => m.to === EMAIL.racer).map((m) => m.subject);
  // Solo la sonda della 0037 (la riconosce l'indice che cerca): un guasto di un momento, il resto del database risponde.
  const isProbe = (statements: Parameters<Exec["batch"]>[0]) => statements.some((st) => st.text.includes("use_case_external_builders_all_unique"));
  const probeDown: Exec = { batch: (statements) => (isProbe(statements) ? Promise.reject(new Error("la sonda non risponde")) : exec.batch(statements)) };
  // Oppure la sonda risponde che la tabella non c'è ancora (il self-heal non l'ha ancora creata).
  const probeAbsent: Exec = { batch: (statements) => (isProbe(statements) ? Promise.resolve([[{ ready: false }]]) : exec.batch(statements)) };
  const held = { status: "in_coda", hold_reason: "concessioni_non_lette", error: null };

  // Il workspace ha l'ok ai sub-responsabili (lo ha dato la prova di prima; qui si rimette, se manca). Il benvenuto e
  // un'e-mail di chi costruisce, in coda.
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role)
     VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'transformation_lead') ON CONFLICT (workspace_id, list_version) DO NOTHING`,
    [ids.ws, ids.e2],
  );
  const added = await add("racer", "tutti");
  assert.ok(added.ok && added.value.noticeId, added.ok ? "senza e-mail di benvenuto" : added.message);
  if (!added.ok || !added.value.noticeId) return;
  const welcome = added.value.noticeId;
  try {
    await exec.batch(notices.notifyTask({ workspaceId: ids.ws, useCaseId: uc.u1 }, "compito_passato", { userId: ids.racer }, ids.lead, new Date(), "T-1"));
    const [queued] = await q(`SELECT id FROM uc_notifications WHERE case_id = $1 AND template_key = 'compito_passato' AND recipient_user_id = $2 AND status = 'in_coda'`, [dossier.d1, ids.racer]);
    assert.ok(queued, "l'e-mail «ti hanno passato il compito» in coda");
    const passed = String(queued.id);

    for (const broken of [probeDown, probeAbsent]) {
      await send(broken, welcome);
      await send(broken, passed);
      assert.deepEqual(await row(welcome), held, "il benvenuto aspetta: la concessione c'è, solo non si è letta");
      assert.deepEqual(await row(passed), held, "l'e-mail di chi costruisce aspetta");
      assert.deepEqual(toRacer(), []);
    }
    // Al giro dopo la sonda risponde: partono tutte e due.
    await send(exec, welcome);
    await send(exec, passed);
    assert.deepEqual([(await row(welcome)).status, (await row(passed)).status], ["inviata", "inviata"]);
    assert.equal(toRacer().length, 2);

    // «Non costruisci più…» in coda, poi la persona torna tra chi costruisce: con la sonda giù non parte (non si sa se
    // la concessione c'è); quando risponde si annulla, perché la concessione c'è ancora.
    const removed = await team.removeExternalBuilder(exec, { workspaceId: ids.ws, actorUserId: ids.lead, userId: ids.racer, lsDomains: LS });
    assert.ok(removed.ok && removed.value.noticeId);
    if (!removed.ok || !removed.value.noticeId) return;
    const goodbye = removed.value.noticeId;
    const back = await add("racer", [uc.u1]);
    assert.ok(back.ok, back.ok ? "" : back.message);
    await send(probeDown, goodbye);
    assert.deepEqual(await row(goodbye), held);
    assert.equal(toRacer().some((subject) => subject.includes("non costruisci più")), false, "niente «…non costruisci più…» a chi costruisce ancora");
    await send(exec, goodbye);
    assert.deepEqual(await row(goodbye), { status: "annullata", hold_reason: null, error: "concessione_ancora_presente" });
  } finally {
    await team.removeExternalBuilder(exec, { workspaceId: ids.ws, actorUserId: ids.lead, userId: ids.racer, lsDomains: LS });
  }
});
