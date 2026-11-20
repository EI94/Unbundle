import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// Le pagine della CI sul database di prova dell'hub (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.5, §2.6, §3.2):
// - la riga della famiglia nell'Agent Factory, letta come la legge la pagina (`readCiFamilies`): lo stato per chi vede la
//   famiglia; i pulsanti e «Da fare per te» solo a chi gestisce le chiavi del repository (chi gestisce il workspace, il
//   responsabile di un caso aperto del repository), mai a sviluppatori di Lateral Space, a chi costruisce da fuori o al
//   cliente; gli stati che seguono la chiave (collegata, usata, rotazione, revocata); mai la chiave né il suo prefisso;
// - «dalla CI» e «dalla CLI» in «Evals e banco di prova» (`loadEvalRunOrigins`): la fonte e l'esecuzione su GitHub,
//   solo delle esecuzioni del caso.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1).
//   Dati sintetici, creati e cancellati qui. Le chiavi le crea il loro modulo, come la pagina.
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

type Row = Record<string, unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let exec: import("../../db/uc-executor.ts").UcExecutor;
let store: typeof import("../../db/queries/use-case-ci-keys.ts");
let origins: typeof import("../../db/queries/use-case-eval-origins.ts");
let readCiFamilies: typeof import("../../../components/agent-factory/ci-load.ts").readCiFamilies;
let text: typeof import("../../../components/agent-factory/ci-text.ts");

const suffix = randomBytes(3).toString("hex");
const SUFFIX = suffix.toUpperCase();
const LS = ["ls.test"];
const REPO = `Voltaen/esempio-rosa-${suffix}`;
const OTHER = `Voltaen/esempio-blu-${suffix}`;
const RUN_URL = `https://github.com/${REPO}/actions/runs/12345678901`;
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  template: randomUUID(),
  uc1: randomUUID(),
  uc2: randomUUID(),
  case1: randomUUID(),
  case2: randomUUID(),
  manager: randomUUID(),
  lead: randomUUID(),
  dev: randomUUID(),
  outside: randomUUID(),
  client: randomUUID(),
};
type Person = "manager" | "lead" | "dev" | "outside" | "client";
const PEOPLE: readonly Person[] = ["manager", "lead", "dev", "outside", "client"];
const EMAIL: Record<Person, string> = {
  manager: `manager-${suffix}@ls.test`,
  lead: `responsabile-${suffix}@ls.test`,
  dev: `sviluppo-${suffix}@ls.test`,
  outside: `da-fuori-${suffix}@esterni.test`,
  client: `cliente-${suffix}@cliente.test`,
};
// Chi gestisce il workspace per Lateral Space ha un ruolo da revisore; gli altri contano solo per il ruolo nel caso.
const ROLE: Record<Person, string> = { manager: "transformation_lead", lead: "contributor", dev: "contributor", outside: "analyst", client: "transformation_lead" };
const LATERAL: Record<Person, boolean> = { manager: true, lead: true, dev: true, outside: false, client: false };

const families = [REPO, OTHER];
const lower = (repo: string) => repo.toLowerCase();
const viewFor = (person: Person) => readCiFamilies(exec, { workspaceId: ids.ws, userId: ids[person], isLateralSpace: LATERAL[person], lsDomains: LS, families, now: new Date() });

function okValue<T>(r: { ok: true; value: T } | { ok: false; code: string; message: string }, label: string): T {
  if (!r.ok) assert.fail(`${label}: atteso ok, ricevuto ${r.code}`);
  return r.value;
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (sqlText, params = []) => sql.query(sqlText, params) as Promise<Row[]>;
  await (await import("../../db/ensure-schema.ts")).ensureDbSchema();
  exec = (await import("../../db/uc-executor.ts")).ucExecutorForUrl(url!);
  store = await import("../../db/queries/use-case-ci-keys.ts");
  origins = await import("../../db/queries/use-case-eval-origins.ts");
  ({ readCiFamilies } = await import("../../../components/agent-factory/ci-load.ts"));
  text = await import("../../../components/agent-factory/ci-text.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova pagine CI', $2)`, [ids.org, `org-ci-pagine-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Cliente di prova pagine CI')`, [ids.ws, ids.org]);
  for (const person of PEOPLE) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [ids[person], EMAIL[person], `Persona ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], ROLE[person]]);
  }
  await q(`INSERT INTO use_cases (id, workspace_id, title, code) VALUES ($1, $3, 'Rosa aperto', $4), ($2, $3, 'Blu aperto', $5)`, [ids.uc1, ids.uc2, ids.ws, "XX-0031", "XX-0032"]);
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova pagine CI', 'prova', '{"confidential": false}'::jsonb, $3)`,
    [ids.template, `prova.ci_pagine_${suffix}`, randomBytes(32).toString("hex")],
  );
  for (const [caseId, uc] of [
    [ids.case1, ids.uc1],
    [ids.case2, ids.uc2],
  ]) {
    await q(
      `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova pagine CI', 'in_sviluppo', now())`,
      [caseId, ids.ws, ids.org, uc, ids.template, `XP-${SUFFIX}-${caseId.slice(0, 4).toUpperCase()}`],
    );
  }
  // Il responsabile del caso del repository rosa; lo sviluppatore di Lateral Space; chi costruisce da fuori; il cliente.
  await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, 'ls_lead'), ($1, $3, 'ls_sviluppatore'), ($1, $4, 'ls_sviluppatore'), ($1, $5, 'owner_cliente')`, [
    ids.case1,
    ids.lead,
    ids.dev,
    ids.outside,
    ids.client,
  ]);
  await q(`INSERT INTO use_case_repos (use_case_id, workspace_id, repo, folder) VALUES ($1, $3, $4, 'casi/xx-0031'), ($2, $3, $5, 'casi/xx-0032')`, [ids.uc1, ids.uc2, ids.ws, REPO, OTHER]);
  // Il caso rosa ha il progetto approvato: «Collega la CI» in «Da fare per te». Il blu no.
  await q(`INSERT INTO use_case_projects (use_case_id, workspace_id, version, status, approved_at) VALUES ($1, $2, 1, 'approvato', now())`, [ids.uc1, ids.ws]);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [PEOPLE.map((p) => ids[p])]);
});

test("la riga della famiglia: lo stato per tutti, i pulsanti e «Da fare per te» solo a chi gestisce le chiavi; la chiave mai", opts, async () => {
  // Nessuna chiave: «CI non collegata».
  const initial = Object.fromEntries(await Promise.all(PEOPLE.map(async (p) => [p, await viewFor(p)] as const)));
  for (const person of PEOPLE) {
    const v = initial[person];
    assert.equal(v.ready, true, person);
    for (const repo of families) assert.equal(v.rows.get(lower(repo))?.text, "CI non collegata: le evals di main restano su GitHub.", `${person} ${repo}`);
  }
  const buttons = (person: Person, repo: string) => {
    const row = initial[person].rows.get(lower(repo));
    return row ? [row.manages, row.primary] : null;
  };
  // Chi gestisce il workspace: tutti i repository. Il responsabile: solo quello del suo caso aperto.
  assert.deepEqual([buttons("manager", REPO), buttons("manager", OTHER)], [[true, "collega"], [true, "collega"]]);
  assert.deepEqual([buttons("lead", REPO), buttons("lead", OTHER)], [[true, "collega"], [false, null]]);
  // Sviluppatori di Lateral Space, chi costruisce da fuori e il cliente: lo stato, senza pulsanti.
  for (const person of ["dev", "outside", "client"] as const) {
    assert.deepEqual([buttons(person, REPO), buttons(person, OTHER)], [[false, null], [false, null]], person);
    assert.deepEqual(initial[person].todos, [], person);
  }
  // «Da fare per te»: «Collega la CI» per il repository con un caso dal progetto approvato, con il link alla famiglia.
  const connect = { kind: "collega", repo: REPO, text: `Collega la CI di esempio-rosa-${suffix}: le evals di main arriveranno da sole.`, href: `#famiglia-esempio-rosa-${suffix}` };
  assert.deepEqual(initial.manager.todos, [connect]);
  assert.deepEqual(initial.lead.todos, [connect]);

  // La chiave creata dal responsabile: «CI collegata il …», per tutti; il «⋯» con «Ruota» e «Revoca» a chi la gestisce.
  const issued = okValue(await store.createCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: { userId: ids.lead }, lsDomains: LS }), "crea");
  const created = `CI collegata il ${text.ciDay(issued.createdAt)}: le evals arrivano alla prossima unione su main.`;
  for (const person of PEOPLE) {
    const v = await viewFor(person);
    const row = v.rows.get(lower(REPO));
    assert.equal(row?.kind, "mai_usata", person);
    assert.equal(row?.text, created, person);
    assert.deepEqual(row?.menu, person === "manager" || person === "lead" ? ["ruota", "revoca"] : [], person);
    assert.equal(row?.primary, null, person);
    assert.deepEqual(v.todos, [], person);
    // Né la chiave, né il suo prefisso, né chi l'ha creata: solo date e stati.
    const shown = JSON.stringify({ rows: [...v.rows.values()], todos: v.todos, live: [...v.liveRepos] });
    assert.ok(!shown.includes("ub_ci_") && !shown.includes(issued.key) && !shown.includes(ids.lead), person);
  }

  // Il primo invio della CI: «ultimo invio oggi».
  assert.ok(await store.authenticateCiKey(exec, `Bearer ${issued.key}`), "la chiave vale");
  const used = (await viewFor("dev")).rows.get(lower(REPO));
  assert.equal(used?.text, `CI collegata · ultimo invio oggi · la chiave scade il ${text.ciDay(issued.expiresAt)}`);
  assert.deepEqual((await viewFor("manager")).liveRepos, new Set([lower(REPO)]), "«Togli» chiede di ruotarla");

  // La rotazione: la nuova da mettere su GitHub; la vecchia vale al più 7 giorni; solo «Revoca» nel «⋯».
  const rotated = okValue(await store.rotateCiKey(exec, { workspaceId: ids.ws, repo: REPO, actor: { userId: ids.manager }, lsDomains: LS }), "ruota");
  assert.ok(rotated.replaced);
  const rotation = (await viewFor("manager")).rows.get(lower(REPO));
  assert.equal(rotation?.kind, "rotazione");
  assert.equal(rotation?.text, `Chiave nuova da mettere su GitHub. La vecchia vale fino al primo invio con la nuova, al massimo fino al ${text.ciDay(rotated.replaced.until)}.`);
  assert.deepEqual(rotation?.menu, ["revoca"]);

  // Revocata: di nuovo «CI non collegata», nessuna chiave viva.
  okValue(await store.revokeCiKeys(exec, { workspaceId: ids.ws, repo: REPO, actor: { userId: ids.manager }, lsDomains: LS }), "revoca");
  const revoked = await viewFor("manager");
  assert.equal(revoked.rows.get(lower(REPO))?.kind, "non_collegata");
  assert.deepEqual([...revoked.liveRepos], []);
  assert.deepEqual(revoked.todos, [connect]);
});

test("«dalla CI» e «dalla CLI»: la fonte e l'esecuzione su GitHub, solo delle esecuzioni del caso", opts, async () => {
  const run = (uc: string, extra: string, values: unknown[]) =>
    q(
      `INSERT INTO use_case_eval_runs (use_case_id, workspace_id, kind, level, branch, commit_sha, cases_total${extra ? `, ${extra}` : ""})
       VALUES ($1, $2, 'evals', 'pull_request', 'main', $3, 28${values.map((_, i) => `, $${i + 4}`).join("")}) RETURNING id`,
      [uc, ids.ws, "a".repeat(40), ...values],
    );
  const [ci] = await run(ids.uc1, "source, ci_run_url", ["ci", RUN_URL]);
  const [cli] = await run(ids.uc1, "", []);
  const [ciNoLink] = await run(ids.uc1, "source", ["ci"]);
  const [otherCase] = await run(ids.uc2, "source, ci_run_url", ["ci", `https://github.com/${OTHER}/actions/runs/7`]);
  const read = await origins.loadEvalRunOrigins(exec, { workspaceId: ids.ws, useCaseId: ids.uc1 }, [String(ci.id).toUpperCase(), String(cli.id), String(ciNoLink.id), String(otherCase.id), "non-un-id"]);
  assert.deepEqual(
    Object.fromEntries(read),
    {
      [String(ci.id)]: { source: "ci", ciRunUrl: RUN_URL },
      [String(cli.id)]: { source: "cli", ciRunUrl: null },
      [String(ciNoLink.id)]: { source: "ci", ciRunUrl: null },
    },
    "l'esecuzione di un altro caso non c'è",
  );
  assert.deepEqual(await origins.loadEvalRunOrigins(exec, { workspaceId: ids.ws, useCaseId: ids.uc1 }, []), new Map());
});
