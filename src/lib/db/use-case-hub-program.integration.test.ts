import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

// Schema della 0029 sul database di prova dell'hub («Programma», rilascio 7): il file due volte e il
// self-heal due volte non cambiano niente, nemmeno la 0028 di nuovo (che non toglie «da_rivedere»); ogni
// CHECK rifiuta la riga sbagliata; le righe si cancellano con il loro workspace, use case o KPI; poi le
// scritture della pagina con i loro permessi, e «Chiudi il SAL» che legge davvero tutto.
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
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let ddl: typeof import("./use-case-hub-program-ddl.ts");
let ensure: typeof import("./ensure-schema.ts");
let program: typeof import("./queries/use-case-program.ts");

const migration = readFileSync(new URL("../../../drizzle/0029_program.sql", import.meta.url), "utf8");
const migration0028 = readFileSync(new URL("../../../drizzle/0028_use_case_referent_thread.sql", import.meta.url), "utf8");
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), other: randomUUID(), useCase: randomUUID(), foreign: randomUUID(), user: randomUUID(), kr: randomUUID() };

const TABLES = ["program_settings", "program_case_costs", "program_snapshots", "program_kpis", "program_kpi_values", "strategic_goal_checkins", "strategic_goals", "use_case_notifications"];

async function schemaSnapshot(): Promise<string> {
  const list = TABLES.map((t) => `'${t}'`).join(", ");
  const columns = await q(
    `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name IN (${list}) ORDER BY table_name, ordinal_position`,
  );
  const constraints = await q(
    `SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint
     WHERE conrelid IN (${TABLES.map((t) => `'public.${t}'::regclass`).join(", ")}) ORDER BY 1, 2`,
  );
  const indexes = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN (${list}) ORDER BY 1`);
  return JSON.stringify({ columns, constraints, indexes });
}

async function probe(): Promise<boolean> {
  return (await q(`SELECT ${ddl.PROGRAM_PROBE_SQL} AS ok`))[0]?.ok === true;
}

async function rejects(sqlText: string, params: unknown[], constraint: string) {
  await assert.rejects(q(sqlText, params), (error: unknown) => {
    const text = String((error as { message?: unknown })?.message ?? error);
    assert.ok(text.includes(constraint), `atteso ${constraint}, ricevuto: ${text}`);
    return true;
  });
}

const LS = () => ({ workspaceId: ids.ws, userId: ids.user, role: "transformation_lead", isLateralSpace: true });
const CLIENT_MANAGER = () => ({ ...LS(), isLateralSpace: false });
const ANALYST = () => ({ ...LS(), role: "analyst", isLateralSpace: false });
const CONTRIBUTOR = () => ({ ...LS(), role: "contributor", isLateralSpace: true });

before(async () => {
  if (!enabled) return;
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  ensure = await import("./ensure-schema.ts");
  await ensure.ensureDbSchema();
  ddl = await import("./use-case-hub-program-ddl.ts");
  program = await import("./queries/use-case-program.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova 0029', $2)`, [ids.org, `org-0029-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova 0029'), ($3, $2, 'Altro workspace 0029')`, [ids.ws, ids.org, ids.other]);
  await q(`INSERT INTO use_cases (id, workspace_id, title) VALUES ($1, $2, 'Scheda di prova 0029'), ($3, $4, 'Scheda di un altro workspace')`, [ids.useCase, ids.ws, ids.foreign, ids.other]);
  await q(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Persona di prova 0029')`, [ids.user, `prova-0029-${suffix}@example.test`]);
  await q(`INSERT INTO strategic_goals (id, workspace_id, type, title, target_value, current_value) VALUES ($1, $2, 'key_result', 'Valore in uso', 100, 10)`, [ids.kr, ids.ws]);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1, $2)`, [ids.ws, ids.other]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
});

test("lo schema della 0029 c'è; il file due volte, il self-heal due volte, la 0028 di nuovo non cambiano niente", opts, async () => {
  const [row] = await q(`SELECT current_database() AS db`);
  assert.equal(row.db, process.env.UC_TEST_PG_DB);
  assert.equal(await probe(), true);
  const first = await schemaSnapshot();
  await q(migration);
  await q(migration);
  assert.equal(await schemaSnapshot(), first, "il file due volte");
  await ensure.runProgramDdl();
  await ensure.runProgramDdl();
  assert.equal(await schemaSnapshot(), first, "il self-heal due volte");
  await q(migration0028);
  await ensure.runUseCaseReferentThreadDdl();
  assert.equal(await schemaSnapshot(), first, "la 0028 di nuovo non toglie «da_rivedere»");
  const [kinds] = await q(`SELECT pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conname = 'use_case_notifications_kind_check'`);
  assert.match(String(kinds.def), /'domanda'[\s\S]*'da_rivedere'/);
  assert.equal(kinds.convalidated, true);
  const goals = await q(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'strategic_goals' AND column_name = 'baseline_value'`);
  assert.equal(goals[0].n, 0, "strategic_goals non cambia");
});

test("su un database senza la 0029 il self-heal la crea (in una transazione annullata)", opts, async () => {
  const marker = `prova-0029-annullata-${suffix}`;
  const text = [
    `DROP TABLE program_kpi_values, program_kpis, program_snapshots, program_case_costs, program_settings, strategic_goal_checkins;`,
    `DELETE FROM use_case_notifications WHERE kind = 'da_rivedere';`,
    `DO $$ BEGIN IF ${ddl.PROGRAM_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora vera'; END IF; END $$;`,
    ...ddl.PROGRAM_DDL,
    `DO $$ BEGIN IF NOT ${ddl.PROGRAM_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora falsa'; END IF; END $$;`,
    `DO $$ BEGIN RAISE EXCEPTION '${marker}'; END $$;`,
  ].join("\n");
  await assert.rejects(q(text), (error: unknown) => String((error as { message?: unknown })?.message ?? error).includes(marker));
  assert.equal(await probe(), true, "annullata: tutto come prima");
});

test("i CHECK: dipendenti, fonti, mesi, periodo, modo dello sviluppo, formula, tipo dei check-in", opts, async () => {
  const ws = ids.ws;
  await rejects(`INSERT INTO program_settings (workspace_id, employees, employees_source) VALUES ($1, 0, 'manuale')`, [ws], "program_settings_employees_check");
  await rejects(`INSERT INTO program_settings (workspace_id, employees) VALUES ($1, 10)`, [ws], "program_settings_sources_check");
  await rejects(`INSERT INTO program_settings (workspace_id, employees, employees_source) VALUES ($1, 10, 'chat')`, [ws], "program_settings_employees_source_check");
  await rejects(`INSERT INTO program_settings (workspace_id, support_from) VALUES ($1, '2026-13')`, [ws], "program_settings_support_from_check");
  await rejects(`INSERT INTO program_settings (workspace_id, support_from, support_to) VALUES ($1, '2026-11', '2026-10')`, [ws], "program_settings_support_range_check");
  await rejects(`INSERT INTO program_settings (workspace_id, dev_pct) VALUES ($1, 101)`, [ws], "program_settings_dev_pct_check");
  await rejects(`INSERT INTO program_case_costs (use_case_id, workspace_id, mode) VALUES ($1, $2, 'importo')`, [ids.useCase, ws], "program_case_costs_shape_check");
  await rejects(`INSERT INTO program_case_costs (use_case_id, workspace_id, mode, amount_eur) VALUES ($1, $2, 'percentuale', 10)`, [ids.useCase, ws], "program_case_costs_shape_check");
  await rejects(`INSERT INTO program_snapshots (workspace_id, kind, period, metrics) VALUES ($1, 'mese', '2026-11-09', '{}')`, [ws], "program_snapshots_period_check");
  await rejects(`INSERT INTO program_snapshots (workspace_id, kind, period, metrics) VALUES ($1, 'sal', '2026-11-09', '[]')`, [ws], "program_snapshots_metrics_check");
  await rejects(`INSERT INTO program_kpis (workspace_id, key, label, kind, source) VALUES ($1, 'Maiuscola', 'X', 'risultato', 'manuale')`, [ws], "program_kpis_key_check");
  await rejects(`INSERT INTO program_kpis (workspace_id, key, label, kind, source) VALUES ($1, 'senza_formula', 'X', 'risultato', 'formula')`, [ws], "program_kpis_formula_check");
  await rejects(`INSERT INTO strategic_goal_checkins (goal_id, workspace_id, kind, value, recorded_on) VALUES ($1, $2, 'stima', 1, '2026-11-09')`, [ids.kr, ws], "strategic_goal_checkins_kind_check");
  await q(`INSERT INTO strategic_goal_checkins (goal_id, workspace_id, kind, value, recorded_on) VALUES ($1, $2, 'base', 1, '2026-11-01')`, [ids.kr, ws]);
  await rejects(`INSERT INTO strategic_goal_checkins (goal_id, workspace_id, kind, value, recorded_on) VALUES ($1, $2, 'base', 2, '2026-11-02')`, [ids.kr, ws], "strategic_goal_checkins_base_unique");
  await q(`DELETE FROM strategic_goal_checkins WHERE goal_id = $1`, [ids.kr]);
  await rejects(`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day) VALUES ($1, $2, $3, 'da_ripensare', '2026-11-09')`, [ws, ids.useCase, ids.user], "use_case_notifications_kind_check");
  const [ok] = await q(`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day) VALUES ($1, $2, $3, 'da_rivedere', '2026-11-09') RETURNING id`, [ws, ids.useCase, ids.user]);
  await q(`DELETE FROM use_case_notifications WHERE id = $1`, [ok.id]);
});

test("le scritture: chi può cosa; lo sviluppo solo su use case del workspace; i costi e i pesi solo Lateral Space", opts, async () => {
  assert.equal((await program.saveCompanyFacts(ANALYST(), { employees: 420 })).ok, false, "un analista non scrive i dipendenti");
  assert.equal((await program.saveCompanyFacts(CONTRIBUTOR(), { employees: 420 })).ok, false, "un contributore nemmeno se è di Lateral Space");
  const facts = await program.saveCompanyFacts(CLIENT_MANAGER(), { employees: 420, revenueEur: 12_000_000 });
  assert.deepEqual(facts, { ok: true, value: true });
  const costsByClient = await program.saveLsCosts(CLIENT_MANAGER(), { supportMonthEur: 4000, supportFrom: "2026-10", supportTo: null, devPct: 15 });
  assert.equal(costsByClient.ok, false, "i costi di Lateral Space solo a Lateral Space");
  assert.deepEqual(await program.saveLsCosts(LS(), { supportMonthEur: 4000, supportFrom: "2026-10", supportTo: null, devPct: 15 }), { ok: true, value: true });
  const foreign = await program.saveCaseDev(LS(), ids.foreign, { mode: "percentuale", amountEur: null });
  assert.equal(foreign.ok, false, "uno use case di un altro workspace non c'è");
  assert.deepEqual(await program.saveCaseDev(LS(), ids.useCase, { mode: "importo", amountEur: 2500 }), { ok: true, value: true });
  assert.equal((await program.saveIndexWeights(CLIENT_MANAGER(), { persone: 40, use_case: 20, valore: 20, adozione: 20 })).ok, false);
  assert.deepEqual(await program.saveIndexWeights(LS(), { persone: 40, use_case: 20, valore: 20, adozione: 20 }), { ok: true, value: true });
  const settings = await program.readProgramSettings(ids.ws);
  assert.equal(settings.employees, 420);
  assert.equal(settings.employeesSource, "manuale");
  assert.equal(settings.revenueEur, 12_000_000);
  assert.equal(settings.costs.supportMonthEur, 4000);
  assert.equal(settings.costs.devPct, 15);
  assert.deepEqual(settings.costs.caseDev.get(ids.useCase.toLowerCase()), { mode: "importo", amountEur: 2500 });
  assert.deepEqual(settings.weights, { persone: 40, use_case: 20, valore: 20, adozione: 20 });
  // La Discovery scrive con la sua fonte; l'ultimo vale.
  assert.equal(await program.saveCompanyFactsFromDiscovery(ids.ws, { employees: 430 }), true);
  const again = await program.readProgramSettings(ids.ws);
  assert.equal(again.employees, 430);
  assert.equal(again.employeesSource, "discovery");
  assert.equal(again.revenueSource, "manuale", "il ricavo resta quello scritto a mano");
  // Lo sviluppo si toglie; si cancella con lo use case.
  assert.deepEqual(await program.saveCaseDev(LS(), ids.useCase, { mode: null, amountEur: null }), { ok: true, value: true });
  assert.equal((await program.readProgramSettings(ids.ws)).costs.caseDev.size, 0);
});

test("KPI e risultati chiave: attiva, formula, valore del mese, base e aggiornamento, collegamento", opts, async () => {
  const actor = CLIENT_MANAGER();
  const weekly = await program.activateCatalogKpi(actor, "uso_settimanale_ai");
  assert.ok(weekly.ok);
  const twice = await program.activateCatalogKpi(actor, "uso_settimanale_ai");
  assert.deepEqual(twice, weekly, "già attivo: lo stesso");
  assert.equal((await program.activateCatalogKpi(actor, "non_esiste")).ok, false);
  const custom = await program.addCustomKpi(actor, { label: "Doppio uso", unit: "%", kind: "risultato", direction: "su", formula: "uso_settimanale_ai * 2" });
  assert.ok(custom.ok);
  const bad = await program.addCustomKpi(actor, { label: "Rotto", unit: "", kind: "risultato", direction: "su", formula: "process.exit(1)" });
  assert.equal(bad.ok, false);
  assert.deepEqual(await program.recordKpiValue(actor, weekly.ok ? weekly.value.id : "", "2026-11", 38), { ok: true, value: true });
  assert.deepEqual(await program.recordKpiValue(actor, weekly.ok ? weekly.value.id : "", "2026-11", 40), { ok: true, value: true }, "lo stesso mese si sostituisce");
  assert.equal((await program.recordKpiValue(actor, custom.ok ? custom.value.id : "", "2026-11", 1)).ok, false, "una formula non si scrive a mano");
  assert.deepEqual(await program.updateKpiTargets(actor, weekly.ok ? weekly.value.id : "", { base: 10, target: 70, keyResultId: ids.kr }), { ok: true, value: true });
  assert.deepEqual(await program.setKeyResultBase(actor, ids.kr, 0, "2026-09-01"), { ok: true, value: true });
  assert.deepEqual(await program.setKeyResultBase(actor, ids.kr, 5, "2026-09-02"), { ok: true, value: true }, "una base sola: si sostituisce");
  assert.deepEqual(await program.addKeyResultCheckin(actor, ids.kr, 40, "2026-11-09", "Dopo il primo trimestre"), { ok: true, value: true });
  const [goal] = await q(`SELECT current_value FROM strategic_goals WHERE id = $1`, [ids.kr]);
  assert.equal(goal.current_value, 40, "l'aggiornamento diventa il valore della Strategia");
  const bases = await q(`SELECT value FROM strategic_goal_checkins WHERE goal_id = $1 AND kind = 'base'`, [ids.kr]);
  assert.deepEqual(bases.map((b) => b.value), [5]);
  assert.deepEqual(await program.linkUseCaseToKeyResult(actor, ids.kr, ids.useCase, true), { ok: true, value: true });
  assert.equal((await program.linkUseCaseToKeyResult(actor, ids.kr, ids.foreign, true)).ok, false, "mai uno use case di un altro workspace");
  const links = await q(`SELECT use_case_id FROM use_case_kr_links WHERE key_result_id = $1`, [ids.kr]);
  assert.deepEqual(links.map((l) => l.use_case_id), [ids.useCase]);
  assert.equal((await program.addKeyResultCheckin(ANALYST(), ids.kr, 1, "2026-11-09", null)).ok, false);
});

test("«Chiudi il SAL»: la fotografia del giorno e del mese, senza persone; il giorno dell'ultimo SAL", opts, async () => {
  const result = await program.closeSal(CLIENT_MANAGER(), new Date("2026-11-09T10:00:00Z"));
  assert.deepEqual(result, { ok: true, value: { on: "2026-11-09" } });
  const snaps = await q(`SELECT kind, period, metrics FROM program_snapshots WHERE workspace_id = $1 ORDER BY kind`, [ids.ws]);
  assert.deepEqual(snaps.map((s) => [s.kind, s.period]), [["mese", "2026-11"], ["sal", "2026-11-09"]]);
  const metrics = snaps[1].metrics as Record<string, unknown>;
  assert.equal(metrics.dipendenti, 430);
  assert.ok("valore_stimato" in metrics && "kpis" in metrics);
  assert.doesNotMatch(JSON.stringify(metrics), /@|prova-0029|Persona di prova/);
  assert.equal((await program.readProgramSettings(ids.ws)).lastSalOn, "2026-11-09");
  assert.equal((await program.closeSal(ANALYST(), new Date("2026-11-09T10:00:00Z"))).ok, false);
});

test("tutto si cancella con il workspace; i valori con il loro KPI", opts, async () => {
  const [kpi] = await q(`SELECT id FROM program_kpis WHERE workspace_id = $1 AND key = 'uso_settimanale_ai'`, [ids.ws]);
  const actor = CLIENT_MANAGER();
  assert.deepEqual(await program.removeKpi(actor, String(kpi.id)), { ok: true, value: true });
  assert.equal((await q(`SELECT count(*)::int AS n FROM program_kpi_values WHERE kpi_id = $1`, [kpi.id]))[0].n, 0);
  const ws = randomUUID();
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Da cancellare 0029')`, [ws, ids.org]);
  await q(`INSERT INTO program_settings (workspace_id, employees, employees_source) VALUES ($1, 5, 'manuale')`, [ws]);
  await q(`INSERT INTO program_snapshots (workspace_id, kind, period, metrics) VALUES ($1, 'mese', '2026-11', '{}')`, [ws]);
  await q(`DELETE FROM workspaces WHERE id = $1`, [ws]);
  const left = await q(`SELECT (SELECT count(*) FROM program_settings WHERE workspace_id = $1)::int + (SELECT count(*) FROM program_snapshots WHERE workspace_id = $1)::int AS n`, [ws]);
  assert.equal(left[0].n, 0);
});
