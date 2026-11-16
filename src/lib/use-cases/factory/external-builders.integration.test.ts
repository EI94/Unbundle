import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// Chi costruisce da fuori Lateral Space (rilascio 8.0c, RILASCIO-8.0c-ESTERNI.md §6, §7 e §9) sul database del
// pacchetto: la 0037 e la sua sonda (D13), il predicato unico per ogni fatto (D1).
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1). Dati
//   sintetici, creati e cancellati qui.
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
let builders: typeof import("../../db/queries/use-case-builders.ts");
let ensure: typeof import("../../db/ensure-schema.ts");
let ddl: typeof import("../../db/use-case-hub-builders-ddl.ts");

const LS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
const migration = readFileSync(new URL("../../../../drizzle/0037_costruttori_esterni.sql", import.meta.url), "utf8");

/**
 * Le persone del workspace A (come Nardi). Ognuna è come E tranne un fatto: così ogni riga dice quale fatto chiude.
 * - lead: Lateral Space, responsabile dei casi;
 * - e: esterno, Analista, gmail verificato, concessione «tutti», osservatore: costruisce;
 * - e2: esterno, Responsabile della trasformazione, concessione per un caso solo;
 * - p: Analista senza concessione; c: Contributore con concessione; learner: partecipa solo ai corsi, con concessione;
 * - unverified: e-mail non verificata; lsdomain: e-mail verificata di Lateral Space; norow: senza la riga osservatore;
 * - client: osservatore e AI Board nel caso; orgcontrib: Analista nel workspace ma Contributore nell'organizzazione.
 */
const people = ["lead", "e", "e2", "p", "c", "learner", "unverified", "lsdomain", "norow", "client", "orgcontrib"] as const;
type Person = (typeof people)[number];
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  template: randomUUID(),
  ucA: randomUUID(),
  ucB: randomUUID(),
  caseA: randomUUID(),
  caseB: randomUUID(),
  ...(Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<Person, string>),
};
const EMAIL: Record<Person, string> = {
  lead: `lead-${suffix}@ls.test`,
  e: `e-${suffix}@gmail.test`,
  e2: `e2-${suffix}@gmail.test`,
  p: `p-${suffix}@gmail.test`,
  c: `c-${suffix}@gmail.test`,
  learner: `learner-${suffix}@gmail.test`,
  unverified: `unverified-${suffix}@gmail.test`,
  lsdomain: `lsdomain-${suffix}@LS.test`,
  norow: `norow-${suffix}@gmail.test`,
  client: `client-${suffix}@gmail.test`,
  orgcontrib: `orgcontrib-${suffix}@gmail.test`,
};
const WS_ROLE: Record<Person, string> = {
  lead: "transformation_lead",
  e: "analyst",
  e2: "transformation_lead",
  p: "analyst",
  c: "contributor",
  learner: "learner",
  unverified: "analyst",
  lsdomain: "analyst",
  norow: "analyst",
  client: "analyst",
  orgcontrib: "analyst",
};

async function grant(person: Person, useCaseId: string | null) {
  await q(`INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id, added_by_user_id) VALUES ($1, $2, $3, $4)`, [ids.ws, ids[person], useCaseId, ids.lead]);
}

before(async () => {
  if (!enabled) return;
  process.env.UC_LS_EMAIL_DOMAINS = LS.join(",");
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  ensure = await import("../../db/ensure-schema.ts");
  await ensure.ensureDbSchema();
  exec = (await import("../../db/uc-executor.ts")).ucExecutorForUrl(url!);
  builders = await import("../../db/queries/use-case-builders.ts");
  ddl = await import("../../db/use-case-hub-builders-ddl.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova esterni', $2)`, [ids.org, `org-esterni-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente di prova esterni')`, [ids.ws, ids.org]);
  for (const person of people) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, ${person === "unverified" ? "NULL" : "now()"})`, [ids[person], EMAIL[person], `Prova ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], WS_ROLE[person]]);
  }
  await q(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'contributor'::member_role)`, [ids.org, ids.orgcontrib]);
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $3, 'Caso A di prova', 'NX-0001'), ($2, $3, 'Caso B di prova', 'NX-0002')`, [ids.ucA, ids.ucB, ids.ws]);
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova esterni', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.esterni_${suffix}`, randomBytes(32).toString("hex"), ids.ws],
  );
  for (const [caseId, useCaseId, code] of [
    [ids.caseA, ids.ucA, `XA-${suffix.toUpperCase()}`],
    [ids.caseB, ids.ucB, `XB-${suffix.toUpperCase()}`],
  ]) {
    await q(
      `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova esterni', 'pronto_sviluppo', now())`,
      [caseId, ids.ws, ids.org, useCaseId, ids.template, code],
    );
    await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead')`, [caseId, ids.lead]);
  }
  // Tutti osservatori nel caso A (tranne chi non ha la riga), il cliente anche con l'AI Board.
  for (const person of people.filter((p) => p !== "lead" && p !== "norow")) {
    await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'osservatore')`, [ids.caseA, ids[person]]);
  }
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ai_board')`, [ids.caseA, ids.client]);
  // Le concessioni: «tutti» per quasi tutti; E2 solo per il caso B; P nessuna.
  for (const person of ["e", "c", "learner", "unverified", "lsdomain", "norow", "client", "orgcontrib"] as const) await grant(person, null);
  await grant("e2", ids.ucB);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [people.map((p) => ids[p])]);
});

test("D13: la 0037 due volte e il self-heal due volte non cambiano niente; la sonda è vera", opts, async () => {
  assert.equal(await builders.externalBuildersReady(exec), true);
  await q(migration);
  await q(migration);
  await ensure.runExternalBuildersDdl();
  await ensure.runExternalBuildersDdl();
  assert.equal(await builders.externalBuildersReady(exec), true);
  const [count] = await q(`SELECT count(*)::int AS n FROM use_case_external_builders WHERE workspace_id = $1`, [ids.ws]);
  assert.equal(count.n, 9, "le concessioni restano");
});

test("D13: su un database senza la 0037 la sonda è falsa e il file la crea (in una transazione annullata)", opts, async () => {
  const marker = `prova-0037-annullata-${suffix}`;
  const text = [
    `DROP TABLE use_case_external_builders;`,
    `DO $$ BEGIN IF ${ddl.EXTERNAL_BUILDERS_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora vera'; END IF; END $$;`,
    ...ddl.EXTERNAL_BUILDERS_DDL,
    `DO $$ BEGIN IF NOT ${ddl.EXTERNAL_BUILDERS_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora falsa'; END IF; END $$;`,
    // Una riga «tutti» per persona e workspace, e una per caso: gli indici unici la tengono.
    `INSERT INTO use_case_external_builders (workspace_id, user_id) VALUES ('${ids.ws}', '${ids.e}');`,
    `DO $$ BEGIN
       BEGIN INSERT INTO use_case_external_builders (workspace_id, user_id) VALUES ('${ids.ws}', '${ids.e}'); RAISE EXCEPTION 'doppia riga tutti';
       EXCEPTION WHEN unique_violation THEN NULL; END;
     END $$;`,
    `INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id) VALUES ('${ids.ws}', '${ids.e}', '${ids.ucA}');`,
    `DO $$ BEGIN
       BEGIN INSERT INTO use_case_external_builders (workspace_id, user_id, use_case_id) VALUES ('${ids.ws}', '${ids.e}', '${ids.ucA}'); RAISE EXCEPTION 'doppia riga del caso';
       EXCEPTION WHEN unique_violation THEN NULL; END;
     END $$;`,
    `DO $$ BEGIN RAISE EXCEPTION '${marker}'; END $$;`,
  ].join("\n");
  await assert.rejects(q(text), (error: unknown) => String((error as { message?: unknown })?.message ?? error).includes(marker));
  assert.equal(await builders.externalBuildersReady(exec), true, "annullata: tutto come prima");
});

test("D13: senza la 0037 (o con la sonda che non risponde) nessuno è esterno e niente si ferma", opts, async () => {
  const missing = { batch: async () => [[{ ready: false }]] } as unknown as typeof exec;
  assert.equal(await builders.externalBuildersReady(missing), false);
  assert.deepEqual(await builders.loadBuilderScope(missing, LS), { lsDomains: LS, externalReady: false });
  assert.equal(await builders.isExternalBuilderOfCase(missing, { caseId: ids.caseA, userId: ids.e, lsDomains: LS }), false);
  const broken = { batch: async () => Promise.reject(new Error("rete")) } as unknown as typeof exec;
  assert.equal(await builders.externalBuildersReady(broken), false);
  assert.equal(await builders.isExternalBuilderOfCase(broken, { caseId: ids.caseA, userId: ids.e, lsDomains: LS }), false);
  // Il frammento senza la 0037 non nomina la tabella: si può usare in ogni istruzione.
  const off = await import("../../uc/sql/statement.ts").then((s) => s.toStatement(builders.externalBuilderSql(builders.NO_EXTERNAL_BUILDERS)));
  assert.equal(off.text, "false");
});

test("la 0037 non pronta (sonda falsa o che non risponde): alle porte chi ha una concessione riceve «riprova», chi non ne ha il no di sempre", opts, async () => {
  /** Il database vero, tranne la sonda della 0037: falsa (la tabella c'è, un indice no) oppure un errore. */
  const probeOnly = (answer: "falsa" | "errore") =>
    ({
      batch: async (statements: Parameters<typeof exec.batch>[0]) => {
        if (statements.some((st) => st.text.includes(ddl.EXTERNAL_BUILDERS_UNIQUE_INDEXES[0]))) {
          if (answer === "errore") throw new Error("sonda");
          return [[{ ready: false }]];
        }
        return exec.batch(statements);
      },
    }) as unknown as typeof exec;
  const gate = (executor: typeof exec, person: Person) => builders.externalBuilderGate(executor, { caseId: ids.caseA, userId: ids[person], lsDomains: LS });
  for (const answer of ["falsa", "errore"] as const) {
    assert.equal(await builders.probeExternalBuilders(probeOnly(answer)), answer === "falsa" ? "assente" : "guasta");
    assert.deepEqual(await gate(probeOnly(answer), "e"), { builds: false, blocked: "non_disponibile" }, `E, sonda ${answer}`);
    assert.deepEqual(await gate(probeOnly(answer), "p"), { builds: false, blocked: null }, `P senza concessione, sonda ${answer}`);
    assert.deepEqual(await gate(probeOnly(answer), "e2"), { builds: false, blocked: null }, `E2, concessione per un altro caso, sonda ${answer}`);
  }
  // Senza la tabella nessuno ha una concessione: il no di sempre. Se non si riesce a leggere niente: «riprova».
  const missing = { batch: async () => [[{ ready: false }]] } as unknown as typeof exec;
  assert.deepEqual(await gate(missing, "e"), { builds: false, blocked: null });
  const broken = { batch: async () => Promise.reject(new Error("rete")) } as unknown as typeof exec;
  assert.deepEqual(await gate(broken, "e"), { builds: false, blocked: "non_disponibile" });
  // Con la 0037 pronta: il predicato, senza perché.
  assert.deepEqual(await gate(exec, "e"), { builds: true, blocked: null });
  assert.deepEqual(await gate(exec, "p"), { builds: false, blocked: null });
});

/** Chi costruisce il caso secondo gli elenchi (`builderMembersSql`). */
async function listedBuilders(caseId: string, lsDomains = LS): Promise<string[]> {
  const scope = await builders.loadBuilderScope(exec, lsDomains);
  const { toStatement, ucSql, cast } = await import("../../uc/sql/statement.ts");
  const [rows] = await exec.batch([toStatement(ucSql`SELECT r.user_id FROM uc_cases c CROSS JOIN LATERAL ${builders.builderMembersSql(scope)} r WHERE c.id = ${cast(caseId, "uuid")}`)]);
  return rows.map((r) => String(r.user_id)).sort();
}

/** Per ogni fatto, chi costruisce il caso A da fuori adesso: solo E ha tutti i fatti veri. */
const EXPECTED: Record<Person, boolean> = {
  lead: false, // Lateral Space: costruisce con il suo ruolo, non da fuori
  e: true,
  e2: false, // la concessione è per un altro caso
  p: false, // nessuna concessione
  c: false, // Contributore
  learner: false,
  unverified: false,
  lsdomain: false, // l'e-mail è di Lateral Space (anche con le maiuscole)
  norow: false, // niente riga osservatore
  client: false, // ha un ruolo del cliente nel caso
  orgcontrib: false, // nell'organizzazione è Contributore: vale prima del workspace
};

test("D1: il predicato dice sì solo con tutti i fatti veri, e le porte e gli elenchi dicono lo stesso", opts, async () => {
  const listed = await listedBuilders(ids.caseA);
  for (const person of people) {
    const gate = await builders.isExternalBuilderOfCase(exec, { caseId: ids.caseA, userId: ids[person], lsDomains: LS });
    assert.equal(gate, EXPECTED[person], `porta: ${person}`);
    const inList = listed.includes(ids[person]);
    assert.equal(inList, EXPECTED[person] || person === "lead", `elenco: ${person}`);
  }
  // Senza domini di Lateral Space configurati nessuno è esterno.
  assert.equal(await builders.isExternalBuilderOfCase(exec, { caseId: ids.caseA, userId: ids.e, lsDomains: [] }), false);
  assert.deepEqual(await listedBuilders(ids.caseA, []), [ids.lead].sort());
  // Nel caso B E2 ha la concessione, ma non la riga: non costruisce. Con la riga sì; con un ruolo del cliente in più no.
  assert.equal(await builders.isExternalBuilderOfCase(exec, { caseId: ids.caseB, userId: ids.e2, lsDomains: LS }), false);
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'osservatore')`, [ids.caseB, ids.e2]);
  assert.equal(await builders.isExternalBuilderOfCase(exec, { caseId: ids.caseB, userId: ids.e2, lsDomains: LS }), true);
  assert.ok((await listedBuilders(ids.caseB)).includes(ids.e2));
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'owner_cliente')`, [ids.caseB, ids.e2]);
  assert.equal(await builders.isExternalBuilderOfCase(exec, { caseId: ids.caseB, userId: ids.e2, lsDomains: LS }), false);
  await q(`DELETE FROM uc_case_members WHERE case_id = $1 AND user_id = $2`, [ids.caseB, ids.e2]);
  // Il ruolo si rilegge ogni volta: E sceso a Contributore smette subito, tornato Analista ricomincia.
  await q(`UPDATE workspace_memberships SET role = 'contributor' WHERE workspace_id = $1 AND user_id = $2`, [ids.ws, ids.e]);
  assert.equal(await builders.isExternalBuilderOfCase(exec, { caseId: ids.caseA, userId: ids.e, lsDomains: LS }), false);
  // Alle porte il perché: manca solo il ruolo nel workspace. Agli altri no e basta.
  assert.deepEqual(await builders.externalBuilderGate(exec, { caseId: ids.caseA, userId: ids.e, lsDomains: LS }), { builds: false, blocked: "ruolo_workspace" });
  for (const person of ["c", "orgcontrib"] as const) {
    assert.deepEqual(await builders.externalBuilderGate(exec, { caseId: ids.caseA, userId: ids[person], lsDomains: LS }), { builds: false, blocked: "ruolo_workspace" }, person);
  }
  for (const person of ["p", "e2", "norow", "client", "unverified", "lsdomain"] as const) {
    assert.deepEqual(await builders.externalBuilderGate(exec, { caseId: ids.caseA, userId: ids[person], lsDomains: LS }), { builds: false, blocked: null }, person);
  }
  await q(`UPDATE workspace_memberships SET role = 'analyst' WHERE workspace_id = $1 AND user_id = $2`, [ids.ws, ids.e]);
  assert.equal(await builders.isExternalBuilderOfCase(exec, { caseId: ids.caseA, userId: ids.e, lsDomains: LS }), true);
});

test("D1: la voce nella barra, «Da fare per te», la campanella, l'e-mail in coda e «passa» dicono quello che dice il predicato", opts, async () => {
  const line = await import("../../db/queries/use-case-factory-line.ts");
  const notices = await import("../../db/queries/use-case-tasks-notices.ts");
  const tasks = await import("../../db/queries/use-case-tasks.ts");
  const target = { workspaceId: ids.ws, useCaseId: ids.ucA };
  // Il progetto approvato e un compito del responsabile, da passare.
  await q(`INSERT INTO use_case_projects (use_case_id, workspace_id, version, status, approved_at) VALUES ($1, $2, 1, 'approvato', now())`, [ids.ucA, ids.ws]);
  await q(
    `INSERT INTO use_case_tasks (use_case_id, workspace_id, ref, title, status, holder_user_id, taken_at, source) VALUES ($1, $2, 'T-1', 'Lettura dell''esploso', 'in_corso', $3, now(), 'cli')`,
    [ids.ucA, ids.ws, ids.lead],
  );
  const scope = await builders.loadBuilderScope(exec, LS);
  await exec.batch(notices.notifyTask(target, "compito_proposto", { builders: scope }, notices.NOBODY, new Date(), null));
  const bell = new Set((await q(`SELECT recipient_user_id FROM use_case_notifications WHERE use_case_id = $1 AND kind = 'compito_proposto'`, [ids.ucA])).map((r) => String(r.recipient_user_id)));
  const mail = new Set((await q(`SELECT recipient_user_id FROM uc_notifications WHERE case_id = $1 AND template_key = 'compito_proposto'`, [ids.caseA])).map((r) => String(r.recipient_user_id)));
  const lead = { userId: ids.lead, roles: ["ls_lead" as const] };
  for (const person of people.filter((p) => p !== "lead")) {
    const want = EXPECTED[person];
    assert.equal(await line.factoryNavVisible(exec, { workspaceId: ids.ws, userId: ids[person], lsManager: false, lsDomains: LS }), want, `voce: ${person}`);
    const view = await line.loadFactoryOverview(exec, { workspaceId: ids.ws, userId: ids[person], seeAll: false, canSeeNeeds: false, lsDomains: LS });
    assert.equal(view.todos.some((t) => t.kind === "collega"), want, `«Collega Claude Code»: ${person}`);
    assert.equal(bell.has(ids[person]), want, `campanella: ${person}`);
    assert.equal(mail.has(ids[person]), want, `e-mail in coda: ${person}`);
    const passed = await tasks.passTask(exec, target, lead, { ref: "T-1", toEmail: EMAIL[person], note: "Fatto: la lettura. Da fare: i test." });
    assert.equal(passed.ok, want, `passa: ${person}`);
    if (passed.ok) {
      const back = await tasks.passTask(exec, target, { userId: ids[person], roles: ["osservatore", "builder_esterno"] }, { ref: "T-1", toEmail: EMAIL.lead, note: "Torna a te." });
      assert.equal(back.ok, true, "e indietro al responsabile");
    } else {
      assert.deepEqual([passed.code, passed.message], ["non_trovato", "Questa persona non costruisce questo caso: la aggiunge Lateral Space."]);
    }
  }
  assert.ok(bell.has(ids.lead) && mail.has(ids.lead), "Lateral Space come prima");
  // Senza domini configurati, nemmeno la voce.
  assert.equal(await line.factoryNavVisible(exec, { workspaceId: ids.ws, userId: ids.e, lsManager: false, lsDomains: [] }), false);
});

test("il team del dossier sa chi ha una concessione che copre il caso («Osservatore · costruisce»), tranne chi lì ha un ruolo del cliente", opts, async () => {
  const covered = await builders.caseGrantUserIds(exec, ids.caseA);
  for (const person of ["e", "c", "learner", "unverified", "lsdomain", "norow", "orgcontrib"] as const) assert.ok(covered.includes(ids[person]), person);
  assert.ok(!covered.includes(ids.client), "AI Board nel caso: lì è del cliente, non costruisce");
  assert.ok(!covered.includes(ids.e2), "la concessione di E2 è per il caso B");
  assert.ok((await builders.caseGrantUserIds(exec, ids.caseB)).includes(ids.e2));
  assert.deepEqual(await builders.caseGrantUserIds({ batch: async () => [[{ ready: false }]] } as unknown as typeof exec, ids.caseA), [], "senza la 0037");
});

test("D8: fuori dalla fabbrica non cambia niente: con e senza concessione, per ogni ruolo del workspace, le stesse abilità sugli use case, l'ok ai sub-responsabili, «Avvia la realizzazione», l'MCP del team e la voce «Casi d'uso»", opts, async () => {
  const { abilitiesForUseCase } = await import("../permissions.ts");
  const { viewerFromSession } = await import("../../db/queries/use-case-hub.ts");
  const { subprocessorDeclarerOf } = await import("../../uc/legal/subprocessors.ts");
  const { getUcUserContext } = await import("../../db/queries/uc-access.ts");
  const { portfolioCaseLink, ucCasesNavVisible } = await import("../../db/queries/uc-nav.ts");
  const { authenticateTeamRequest, TEAM_MCP_READ_SCOPE } = await import("../mcp/auth.ts");
  const { appTeamAuthDeps } = await import("../mcp/app-deps.ts");
  const env = { UC_ENABLED: process.env.UC_ENABLED, UC_WORKSPACE_IDS: process.env.UC_WORKSPACE_IDS };
  process.env.UC_ENABLED = "true";
  process.env.UC_WORKSPACE_IDS = ids.ws;
  // Uno use case senza dossier, per «Avvia la realizzazione».
  const ucC = randomUUID();
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $2, 'Caso C di prova, senza dossier', 'NX-0003')`, [ucC, ids.ws]);
  // L'MCP del team: il token è finto, il ruolo e il profilo di E sono quelli del database (le dipendenze dell'app).
  const token = `ub_team_${randomBytes(24).toString("base64url")}`;
  const deps = { ...appTeamAuthDeps, findToken: async () => ({ id: randomUUID(), workspaceId: ids.ws, ownerUserId: ids.e, scopes: [TEAM_MCP_READ_SCOPE] }), markUsed: async () => {} };
  const user = { id: ids.e, email: EMAIL.e, emailVerified: true };
  const facts = async (role: string) => {
    const team = await authenticateTeamRequest(`Bearer ${token}`, deps);
    return {
      abilities: abilitiesForUseCase(viewerFromSession(user, role)),
      declarer: subprocessorDeclarerOf(await getUcUserContext(ids.e), role, LS),
      dossier: await portfolioCaseLink({ userId: ids.e, workspaceId: ids.ws, role, useCaseId: ids.ucA, useCaseStatus: "accepted" }),
      start: await portfolioCaseLink({ userId: ids.e, workspaceId: ids.ws, role, useCaseId: ucC, useCaseStatus: "accepted" }),
      teamMcp: team.ok ? { ok: true, abilities: team.principal.abilities } : team,
      casesNav: await ucCasesNavVisible({ userId: ids.e, workspaceId: ids.ws, role }),
    };
  };
  const removeGrant = () => q(`DELETE FROM use_case_external_builders WHERE workspace_id = $1 AND user_id = $2`, [ids.ws, ids.e]);
  try {
    for (const role of ["exec_sponsor", "transformation_lead", "function_lead", "analyst", "contributor", "learner"]) {
      await q(`UPDATE workspace_memberships SET role = $3::member_role WHERE workspace_id = $1 AND user_id = $2`, [ids.ws, ids.e, role]);
      const withGrant = await facts(role);
      await removeGrant();
      const withoutGrant = await facts(role);
      await grant("e", null);
      assert.deepEqual(withoutGrant, withGrant, role);
      // I fatti non sono vuoti: la prova confronta qualcosa.
      if (role === "analyst") {
        assert.equal(withGrant.teamMcp.ok, true);
        assert.equal(withGrant.dossier?.existing?.id, ids.caseA);
        assert.equal(withGrant.start?.canStart, false, "«Avvia la realizzazione» resta di Lateral Space");
        assert.equal(withGrant.abilities.canStartRealization, false);
        assert.equal(withGrant.casesNav, true, "è nel team del dossier A");
      }
      if (role === "exec_sponsor") assert.equal(withGrant.declarer, "cliente");
      if (role === "learner") assert.deepEqual([withGrant.casesNav, withGrant.teamMcp.ok], [false, false]);
    }
  } finally {
    await removeGrant();
    await grant("e", null);
    await q(`UPDATE workspace_memberships SET role = 'analyst'::member_role WHERE workspace_id = $1 AND user_id = $2`, [ids.ws, ids.e]);
    await q(`DELETE FROM use_cases WHERE id = $1`, [ucC]);
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
