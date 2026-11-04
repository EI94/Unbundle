import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

// Schema della 0027 sul database di prova dell'hub (le risposte del referente per ogni voce di «Benefici e
// costi»): il file due volte e il self-heal due volte non cambiano niente; su uno schema della 0026 il CHECK
// dell'invio si allarga una volta sola e tiene le righe di prima; ogni CHECK della tabella nuova rifiuta la
// riga sbagliata e accetta quella giusta; le scritture del rilascio 5 funzionano ancora; la pulizia di
// RUNBOOK §10.10 punto 6 toglie solo quello che dice.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1):
//   lo schema lo porta il vero ensureDbSchema(); il file si applica come un unico testo (una transazione
//   implicita, come `psql --single-transaction`). Dati sintetici, creati e cancellati qui.
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
let ddl: typeof import("./use-case-hub-referent-benefits-ddl.ts");
let ensure: typeof import("./ensure-schema.ts");

const migration = readFileSync(new URL("../../../drizzle/0027_use_case_referent_benefits.sql", import.meta.url), "utf8");
const migration0026 = readFileSync(new URL("../../../drizzle/0026_use_case_referent_check.sql", import.meta.url), "utf8");
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), useCase: randomUUID() };

/** La condizione dell'invio della 0026, scritta come nella sua tabella. */
const SUBMITTED_0026 = `submitted_at IS NULL OR (
    confirm IS NOT NULL AND (confirm = 'si' OR confirm_note IS NOT NULL OR purged_at IS NOT NULL)
    AND ((team_component_key IS NOT NULL AND estimate IS NOT NULL) OR (team_component_key IS NULL AND times_per_month IS NOT NULL AND minutes_each IS NOT NULL)))`;

async function schemaSnapshot(): Promise<string> {
  const columns = await q(
    `SELECT table_name, column_name, data_type, is_nullable, column_default, numeric_precision, numeric_scale, character_maximum_length
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('use_case_referent_checks', 'use_case_referent_check_benefits')
     ORDER BY table_name, ordinal_position`,
  );
  const constraints = await q(
    `SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint
     WHERE conrelid IN ('public.use_case_referent_checks'::regclass, 'public.use_case_referent_check_benefits'::regclass)
     ORDER BY 1, 2`,
  );
  const indexes = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('use_case_referent_checks', 'use_case_referent_check_benefits') ORDER BY 1`);
  return JSON.stringify({ columns, constraints, indexes });
}

async function submittedDefinition(): Promise<string> {
  return String((await q(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.use_case_referent_checks'::regclass AND conname = 'use_case_referent_checks_submitted_check'`))[0]?.def ?? "");
}

async function newRequest(status: "inviata" | "completata" | "revocata" = "inviata"): Promise<string> {
  const id = randomUUID();
  const revoked = status === "revocata";
  await q(
    `INSERT INTO use_case_referent_requests (id, workspace_id, use_case_id, contact_id, requester_name, status, expires_at, completed_at, revoked_at, revoked_reason)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Persona di prova', $5, now() + interval '30 days', $6::timestamptz, $7::timestamptz, $8)`,
    [id, ids.ws, ids.useCase, randomUUID(), status, status === "completata" ? new Date().toISOString() : null, revoked ? new Date().toISOString() : null, revoked ? "revisore" : null],
  );
  return id;
}

async function newCheck(requestId: string, values: Record<string, unknown> = {}): Promise<void> {
  const keys = Object.keys(values);
  await q(
    `INSERT INTO use_case_referent_checks (request_id, workspace_id, use_case_id${keys.map((k) => `, ${k}`).join("")})
     VALUES ($1::uuid, $2::uuid, $3::uuid${keys.map((_, i) => `, $${i + 4}`).join("")})`,
    [requestId, ids.ws, ids.useCase, ...keys.map((k) => values[k])],
  );
}

const benefitSql = (keys: string[]) =>
  `INSERT INTO use_case_referent_check_benefits (request_id, workspace_id${keys.map((k) => `, ${k}`).join("")}) VALUES ($1::uuid, $2::uuid${keys.map((_, i) => `, $${i + 3}`).join("")})`;

async function newBenefit(requestId: string, values: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(values);
  await q(benefitSql(keys), [requestId, ids.ws, ...keys.map((k) => values[k])]);
}

async function rejects(sqlText: string, params: unknown[], constraint: string) {
  await assert.rejects(q(sqlText, params), (error: unknown) => {
    const text = String((error as { message?: unknown })?.message ?? error);
    assert.ok(text.includes(constraint), `atteso ${constraint}, ricevuto: ${text}`);
    return true;
  });
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  ensure = await import("./ensure-schema.ts");
  await ensure.ensureDbSchema();
  ddl = await import("./use-case-hub-referent-benefits-ddl.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova 0027', $2)`, [ids.org, `org-0027-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova 0027')`, [ids.ws, ids.org]);
  await q(`INSERT INTO use_cases (id, workspace_id, title) VALUES ($1, $2, 'Scheda di prova 0027')`, [ids.useCase, ids.ws]);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
});

test("lo schema della 0027 c'è; il file due volte, il self-heal due volte e la 0026 di nuovo non cambiano niente", opts, async () => {
  const [row] = await q(`SELECT ${ddl.USE_CASE_REFERENT_BENEFITS_PROBE_SQL} AS current, current_database() AS db`);
  assert.equal(row.db, process.env.UC_TEST_PG_DB);
  assert.equal(row.current, true);
  const first = await schemaSnapshot();
  await q(migration);
  await q(migration);
  assert.equal(await schemaSnapshot(), first, "il file due volte");
  await ensure.runUseCaseReferentBenefitsDdl();
  await ensure.runUseCaseReferentBenefitsDdl();
  assert.equal(await schemaSnapshot(), first, "il self-heal due volte");
  await q(migration0026);
  await ensure.runUseCaseReferentCheckDdl();
  assert.equal(await schemaSnapshot(), first, "la 0026 di nuovo non toglie l'allargamento");
  assert.match(await submittedDefinition(), /benefits OR/);
  const [defaults] = await q(`SELECT column_default FROM information_schema.columns WHERE table_name = 'use_case_referent_checks' AND column_name = 'benefits'`);
  assert.equal(defaults.column_default, "false");
});

test("su uno schema della 0026 il CHECK dell'invio si allarga una volta e le righe inviate di prima restano valide", opts, async () => {
  const now = new Date().toISOString();
  // Una conferma inviata con la stima del tempo del rilascio 5, e una con i due numeri senza stima del team.
  const withTeam = await newRequest("completata");
  await newCheck(withTeam, { submitted_at: now, confirm: "si", team_component_key: "tempo-1", team_volume_year: 3000, team_minutes: 12, estimate: "piu", times_per_month: 300 });
  const noTeam = await newRequest("completata");
  await newCheck(noTeam, { submitted_at: now, confirm: "correggi", confirm_note: "Una nota", times_per_month: 20, minutes_each: 3 });
  // Il CHECK com'era nella 0026, come su un database del rilascio 5; poi la 0027.
  await q(`ALTER TABLE use_case_referent_checks DROP CONSTRAINT use_case_referent_checks_submitted_check;
ALTER TABLE use_case_referent_checks ADD CONSTRAINT use_case_referent_checks_submitted_check CHECK (${SUBMITTED_0026}) NOT VALID;`);
  assert.doesNotMatch(await submittedDefinition(), /benefits/);
  const [before0027] = await q(`SELECT ${ddl.USE_CASE_REFERENT_BENEFITS_PROBE_SQL} AS current`);
  assert.equal(before0027.current, false, "senza l'allargamento la sonda è falsa");
  await q(migration);
  const widened = await submittedDefinition();
  assert.match(widened, /benefits OR/);
  await q(migration);
  assert.equal(await submittedDefinition(), widened, "una seconda volta non cambia niente");
  const [check] = await q(`SELECT convalidated FROM pg_constraint WHERE conrelid = 'public.use_case_referent_checks'::regclass AND conname = 'use_case_referent_checks_submitted_check'`);
  assert.equal(check.convalidated, true, "validato");
  const [after0027] = await q(`SELECT ${ddl.USE_CASE_REFERENT_BENEFITS_PROBE_SQL} AS current`);
  assert.equal(after0027.current, true);
  const kept = await q(`SELECT request_id FROM use_case_referent_checks WHERE request_id = ANY($1::uuid[]) AND benefits = false`, [[withTeam, noTeam]]);
  assert.equal(kept.length, 2, "le righe del rilascio 5 restano, con benefits falso");
});

test("il CHECK dell'invio allargato: con le risposte per beneficio niente stima del tempo; senza, la regola della 0026", opts, async () => {
  const now = new Date().toISOString();
  await newCheck(await newRequest(), { submitted_at: now, confirm: "si", benefits: true });
  await newCheck(await newRequest(), { submitted_at: now, confirm: "correggi", confirm_note: "Altro", benefits: true });
  for (const values of [
    { submitted_at: now, confirm: "si" },
    { submitted_at: now, confirm: "si", benefits: false, times_per_month: 3 },
    { submitted_at: now, benefits: true },
    { submitted_at: now, confirm: "correggi", benefits: true },
  ]) {
    const requestId = await newRequest();
    const keys = Object.keys(values);
    await rejects(
      `INSERT INTO use_case_referent_checks (request_id, workspace_id, use_case_id${keys.map((k) => `, ${k}`).join("")}) VALUES ($1::uuid, $2::uuid, $3::uuid${keys.map((_, i) => `, $${i + 4}`).join("")})`,
      [requestId, ids.ws, ids.useCase, ...keys.map((k) => (values as Record<string, unknown>)[k])],
      "use_case_referent_checks_submitted_check",
    );
  }
});

test("ogni CHECK della tabella nuova rifiuta la riga sbagliata e accetta quella giusta", opts, async () => {
  const ore = { component_key: "tempo-1", position: 1, kind: "ore", label: "Controllo delle fatture", team_volume_year: 3000, team_minutes: 12 };
  const euro = { component_key: "costi-1", position: 2, kind: "euro", label: "Meno solleciti", team_eur_year: 4000 };
  const fatto = { component_key: "qualita-1", position: 3, kind: "qualitativo", label: "Meno errori" };
  const now = new Date().toISOString();
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ ...ore, position: 0 }, "use_case_referent_check_benefits_position_check"],
    [{ ...ore, position: 7 }, "use_case_referent_check_benefits_position_check"],
    [{ ...fatto, kind: "altro" }, "use_case_referent_check_benefits_kind_check"],
    [{ ...ore, team_volume_year: -1 }, "use_case_referent_check_benefits_team_volume_check"],
    [{ ...ore, team_minutes: -1 }, "use_case_referent_check_benefits_team_minutes_check"],
    [{ ...euro, team_eur_year: -1 }, "use_case_referent_check_benefits_team_eur_check"],
    [{ ...ore, answer: "forse" }, "use_case_referent_check_benefits_answer_check"],
    [{ ...ore, answer: "meno", times_per_month: 8_333_334 }, "use_case_referent_check_benefits_times_check"],
    [{ ...ore, answer: "meno", minutes_each: 100_001 }, "use_case_referent_check_benefits_minutes_check"],
    [{ ...euro, answer: "meno", eur_year: 1_000_000_001 }, "use_case_referent_check_benefits_eur_check"],
    [{ ...ore, outcome: "boh", outcome_at: now }, "use_case_referent_check_benefits_outcome_check"],
    [{ ...ore, team_eur_year: 10 }, "use_case_referent_check_benefits_shape_check"],
    [{ ...ore, team_minutes: null }, "use_case_referent_check_benefits_shape_check"],
    [{ ...euro, team_eur_year: null }, "use_case_referent_check_benefits_shape_check"],
    [{ ...euro, answer: "meno", times_per_month: 3 }, "use_case_referent_check_benefits_shape_check"],
    [{ ...fatto, team_eur_year: 0 }, "use_case_referent_check_benefits_shape_check"],
    [{ ...ore, answer: "no" }, "use_case_referent_check_benefits_form_check"],
    [{ ...fatto, answer: "meno" }, "use_case_referent_check_benefits_form_check"],
    [{ ...euro, answer: "non_so" }, "use_case_referent_check_benefits_form_check"],
    [{ ...euro, team_eur_year: 0, answer: "piu" }, "use_case_referent_check_benefits_form_check"],
    [{ ...ore, team_minutes: 0, answer: "si" }, "use_case_referent_check_benefits_form_check"],
    [{ ...ore, answer: "si", times_per_month: 3 }, "use_case_referent_check_benefits_numbers_check"],
    [{ ...ore, times_per_month: 3 }, "use_case_referent_check_benefits_numbers_check"],
    [{ ...euro, answer: "si", eur_year: 10 }, "use_case_referent_check_benefits_numbers_check"],
    [{ ...euro, team_eur_year: 0, answer: "no", eur_year: 10 }, "use_case_referent_check_benefits_numbers_check"],
    [{ ...ore, outcome: "tenuta" }, "use_case_referent_check_benefits_outcome_pair_check"],
  ];
  for (const [values, constraint] of bad) {
    const requestId = await newRequest();
    await newCheck(requestId, { benefits: true });
    const keys = Object.keys(values);
    await rejects(benefitSql(keys), [requestId, ids.ws, ...keys.map((k) => values[k])], constraint).catch((e) => { throw new Error(`${constraint} ${JSON.stringify(values)}: ${e.message}`); });
  }
  const good: Array<Record<string, unknown>[]> = [
    [ore, euro, fatto],
    [{ ...ore, answer: "si" }, { ...euro, answer: "si" }, { ...fatto, answer: "si" }],
    [{ ...ore, answer: "meno", times_per_month: 150.5 }, { ...euro, answer: "piu", eur_year: 5200.25 }, { ...fatto, answer: "no" }],
    [{ ...ore, answer: "piu" }, { ...euro, answer: "meno" }, { ...fatto, answer: "non_so", comment: "Succede solo a fine mese." }],
    // Una voce «ore» senza i numeri del team: i due numeri del referente, senza risposta.
    [{ ...ore, team_volume_year: 0, team_minutes: 12, times_per_month: 20, minutes_each: 5 }, { ...euro, team_eur_year: 0, answer: "si" }],
    [{ ...ore, answer: "meno", times_per_month: 100, outcome: "adottata", outcome_at: now }, { ...euro, answer: "piu", outcome: "tenuta", outcome_at: now }],
  ];
  for (const rows of good) {
    const requestId = await newRequest();
    await newCheck(requestId, { benefits: true });
    for (const values of rows) await newBenefit(requestId, values);
  }
  // Nessuna colonna di persona.
  const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'use_case_referent_check_benefits'`);
  assert.ok(!cols.some((c) => /contact|_by_user_id|email|name/.test(String(c.column_name))));
  // Una voce sola per chiave; le righe vanno via con la conferma (e con la richiesta).
  const gone = await newRequest();
  await newCheck(gone, { benefits: true });
  await newBenefit(gone, ore);
  await rejects(benefitSql(Object.keys(ore)), [gone, ids.ws, ...Object.values(ore)], "use_case_referent_check_benefits_pkey");
  await q(`DELETE FROM use_case_referent_requests WHERE id = $1::uuid`, [gone]);
  assert.equal((await q(`SELECT 1 FROM use_case_referent_check_benefits WHERE request_id = $1::uuid`, [gone])).length, 0);
  // Senza la riga della conferma non c'è una risposta per beneficio.
  await rejects(benefitSql(Object.keys(ore)), [randomUUID(), ids.ws, ...Object.values(ore)], "use_case_referent_check_benefits_request_id_fkey");
});

test("le scritture del rilascio 5 funzionano ancora con la colonna nuova", opts, async () => {
  // La richiesta al referente nasce con la sua riga (sendReferentRequestOnce del rilascio 5).
  const requestId = await newRequest();
  await q(`INSERT INTO use_case_referent_checks (request_id, workspace_id, use_case_id) SELECT r.id, r.workspace_id, r.use_case_id FROM use_case_referent_requests r WHERE r.id = $1::uuid`, [requestId]);
  // Il passo 2 del rilascio 5 (l'istantanea e la stima), poi l'invio, su una riga con benefits ancora vero
  // (una bozza per beneficio rimasta da prima di un ritorno indietro).
  await q(`UPDATE use_case_referent_checks SET benefits = true WHERE request_id = $1::uuid`, [requestId]);
  await q(
    `UPDATE use_case_referent_checks c SET confirm = 'si', confirm_note = NULL, updated_at = now() FROM use_case_referent_requests r
     WHERE c.request_id = $1::uuid AND r.id = c.request_id AND r.status = 'inviata' AND c.submitted_at IS NULL RETURNING c.updated_at`,
    [requestId],
  );
  await q(
    `UPDATE use_case_referent_checks c SET team_component_key = 'tempo-1', team_volume_year = 3000, team_minutes = 12, estimate = 'meno', times_per_month = 200, minutes_each = NULL, updated_at = now()
     FROM use_case_referent_requests r WHERE c.request_id = $1::uuid AND r.id = c.request_id AND c.submitted_at IS NULL RETURNING c.updated_at`,
    [requestId],
  );
  await q(`UPDATE use_case_referent_checks SET submitted_at = now(), updated_at = now() WHERE request_id = $1::uuid AND submitted_at IS NULL`, [requestId]);
  // Le azioni del team del rilascio 5: l'esito della stima e «Fatto» sulla correzione.
  await q(`UPDATE use_case_referent_checks SET estimate_outcome = 'adottata', estimate_outcome_at = now(), updated_at = now() WHERE request_id = $1::uuid AND submitted_at IS NOT NULL AND estimate_outcome IS NULL`, [requestId]);
  // La pulizia della 0026 e la cancellazione dei dati del rilascio 5 (la nota), sulle righe della 0027.
  const purged = await newRequest("revocata");
  await newCheck(purged, { submitted_at: new Date().toISOString(), confirm: "correggi", confirm_note: "Nota", benefits: true });
  await q(`UPDATE use_case_referent_checks c SET confirm_note = NULL, purged_at = coalesce(c.purged_at, now()), updated_at = now() FROM use_case_referent_requests r WHERE c.request_id = r.id AND r.id = $1::uuid`, [purged]);
});

test("la pulizia di RUNBOOK §10.10 punto 6: commenti delle richieste cancellate, bozze delle richieste finite, e niente altro", opts, async () => {
  const now = new Date().toISOString();
  const fatto = { component_key: "qualita-1", position: 1, kind: "qualitativo", label: "Meno errori" };
  // Da pulire.
  const purged = await newRequest("revocata");
  await q(`UPDATE use_case_referent_requests SET purged_at = now(), message = NULL WHERE id = $1::uuid`, [purged]);
  await newCheck(purged, { submitted_at: now, confirm: "si", benefits: true });
  await newBenefit(purged, { ...fatto, answer: "no", comment: "Un commento" });
  const ended = await newRequest("completata");
  await newCheck(ended, { benefits: true });
  await newBenefit(ended, { ...fatto, answer: "si", comment: "Bozza rimasta" });
  // Da lasciare.
  const live = await newRequest();
  await newCheck(live, { benefits: true });
  await newBenefit(live, { ...fatto, answer: "non_so", comment: "Bozza viva" });
  const sent = await newRequest("completata");
  await newCheck(sent, { submitted_at: now, confirm: "si", benefits: true });
  await newBenefit(sent, { ...fatto, answer: "si", comment: "Commento inviato" });

  for (let round = 0; round < 2; round++) for (const statement of ddl.REFERENT_BENEFITS_SWEEP_SQL) await q(statement);

  const rowsOf = async (requestId: string) => (await q(`SELECT answer, comment FROM use_case_referent_check_benefits WHERE request_id = $1::uuid`, [requestId])).map((r) => ({ answer: r.answer, comment: r.comment }));
  const flagOf = async (requestId: string) => (await q(`SELECT benefits FROM use_case_referent_checks WHERE request_id = $1::uuid`, [requestId]))[0]?.benefits;
  assert.deepEqual(await rowsOf(purged), [{ answer: "no", comment: null }], "il commento va via, la risposta resta");
  assert.equal(await flagOf(purged), true);
  assert.deepEqual(await rowsOf(ended), [], "la bozza di una richiesta finita senza invio va via");
  assert.equal(await flagOf(ended), false);
  assert.deepEqual(await rowsOf(live), [{ answer: "non_so", comment: "Bozza viva" }]);
  assert.equal(await flagOf(live), true);
  assert.deepEqual(await rowsOf(sent), [{ answer: "si", comment: "Commento inviato" }]);
  assert.equal(await flagOf(sent), true);
});
