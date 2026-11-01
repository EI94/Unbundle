import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// (0025) «Pronto da avviare» sul database di prova: ogni scrittura che può rendere pronto uno use
// case approvato («A posto», «Non si applica», archiviare, scollegare, spostare dalla parte di Lateral
// Space o a «passo», l'approvazione, «Quando», il tipo, la risposta del team), chi riceve la riga (i
// revisori di Lateral Space tranne chi ha agito; mai un revisore del cliente, un contributore o
// un'email non verificata), nessun doppione (una scrittura in più, due insieme, il cron, due giri),
// pronto → non pronto → pronto, il trimestre scaduto, il cron che vede una modifica fatta fuori
// dall'app, «Informazioni complete» tolta solo a Lateral Space, il seme della migrazione, e la parità
// tra la regola in SQL e `isReadyToStart`.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1); la 0025 la porta il vero ensureDbSchema(). Dati sintetici, creati e cancellati qui.
//   Nessuna email parte: la coda si guarda soltanto.
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

type Ctx = import("../service.ts").WriteContext;
let service: typeof import("../service.ts");
let needs: typeof import("../needs-service.ts");
let referents: typeof import("../../db/queries/use-case-referents.ts");
let alerts: typeof import("../../db/queries/use-case-alerts.ts");
let sqlMod: typeof import("./sql.ts");
let readinessMod: typeof import("../readiness.ts");
let phaseMod: typeof import("../phase.ts");
let ddl: typeof import("../../db/use-case-hub-alerts-ddl.ts");
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  template: randomUUID(),
  lsLead: randomUUID(),
  lsAnalyst: randomUUID(),
  lsUnverified: randomUUID(),
  client: randomUUID(),
  exec: randomUUID(),
  contributor: randomUUID(),
};
type Person = "lsLead" | "lsAnalyst" | "lsUnverified" | "client" | "exec" | "contributor";
const PEOPLE: Record<Person, { email: string; role: string; verified: boolean; ls: boolean }> = {
  lsLead: { email: `lead.pronto.${suffix}@ls.test`, role: "transformation_lead", verified: true, ls: true },
  lsAnalyst: { email: `analista.pronto.${suffix}@ls.test`, role: "analyst", verified: true, ls: true },
  lsUnverified: { email: `nonverificato.pronto.${suffix}@ls.test`, role: "function_lead", verified: false, ls: false },
  client: { email: `responsabile.pronto.${suffix}@cliente.test`, role: "function_lead", verified: true, ls: false },
  exec: { email: `sponsor.pronto.${suffix}@cliente.test`, role: "exec_sponsor", verified: true, ls: false },
  contributor: { email: `contributore.pronto.${suffix}@ls.test`, role: "contributor", verified: true, ls: true },
};
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS", "USE_CASE_CLIENT_NOTICES"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

let quarter = "";
let codeSeq = 1000 + Math.floor(Math.random() * 7000);

function as(person: Person, channel: Ctx["channel"] = "pagina"): Ctx {
  return { workspaceId: ids.ws, actor: { userId: ids[person], role: PEOPLE[person].role, isLateralSpace: PEOPLE[person].ls, kind: "persona" }, channel };
}

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}

async function card(o: { status?: string; review?: string; kind?: string; quarter?: string | null } = {}): Promise<string> {
  const id = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, target_quarter)
     VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'Problema di prova', $3::use_case_status, $4::portfolio_review_status, $5, $6, 'web_proposed', $7)`,
    [id, ids.ws, o.status ?? "accepted", o.review ?? "scored", o.kind ?? "use_case_ai", `PR-${codeSeq++}`, o.quarter === undefined ? quarter : o.quarter],
  );
  return id;
}

async function need(cardId: string, o: { status?: string; side?: string | null; type?: string } = {}): Promise<string> {
  const id = randomUUID();
  const type = o.type ?? "requisito";
  await q(
    `INSERT INTO use_case_needs (id, workspace_id, type, kind, title, owner_side, status) VALUES ($1::uuid, $2::uuid, $3, 'dato', 'Volumi mensili', $4, $5)`,
    [id, ids.ws, type, o.side === undefined ? "cliente" : o.side, o.status ?? (type === "requisito" ? "da_chiedere" : "proposta")],
  );
  await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [id, cardId]);
  return id;
}

const needVersion = async (id: string) => Number((await q(`SELECT version FROM use_case_needs WHERE id = $1::uuid`, [id]))[0].version);
const cardVersion = async (id: string) => Number((await q(`SELECT version FROM use_cases WHERE id = $1::uuid`, [id]))[0].version);

async function rows(cardId: string, kind = "pronto") {
  return q(
    `SELECT recipient_user_id::text AS who, read_at, rome_day::text AS day, last_event_at FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = $2 ORDER BY recipient_user_id, rome_day`,
    [cardId, kind],
  );
}
const who = async (cardId: string, kind = "pronto") => (await rows(cardId, kind)).map((r) => String(r.who)).sort();
const people = (...list: Person[]) => list.map((p) => ids[p]).sort();

async function state(cardId: string) {
  const [s] = await q(`SELECT ready_since, ready_quarter FROM use_case_ready_state WHERE use_case_id = $1::uuid`, [cardId]);
  return s ?? null;
}

async function queued(person: Person, cardId: string) {
  return q(
    `SELECT e.status, e.kind FROM use_case_alert_emails e JOIN use_case_alert_email_items i ON i.email_id = e.id
     WHERE e.workspace_id = $1::uuid AND e.recipient_user_id = $2::uuid AND i.use_case_id = $3::uuid`,
    [ids.ws, ids[person], cardId],
  );
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
  delete process.env.USE_CASE_REFERENTS;
  delete process.env.USE_CASE_CLIENT_NOTICES;
  const ensure = await import("../../db/ensure-schema.ts");
  await ensure.ensureDbSchema();
  service = await import("../service.ts");
  needs = await import("../needs-service.ts");
  referents = await import("../../db/queries/use-case-referents.ts");
  alerts = await import("../../db/queries/use-case-alerts.ts");
  sqlMod = await import("./sql.ts");
  readinessMod = await import("../readiness.ts");
  phaseMod = await import("../phase.ts");
  ddl = await import("../../db/use-case-hub-alerts-ddl.ts");
  quarter = String((await q(`SELECT ${ddl.ROME_QUARTER_NOW_SQL} AS q`))[0].q);

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione pronti', $2)`, [ids.org, `hub-pronti-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'TopJet pronti')`, [ids.ws, ids.org]);
  for (const person of Object.keys(PEOPLE) as Person[]) {
    const p = PEOPLE[person];
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, CASE WHEN $4 THEN now() END)`, [ids[person], p.email, `Persona ${person}`, p.verified]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], p.role]);
  }
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova pronti', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.pronti_${suffix}`, randomBytes(32).toString("hex"), ids.ws],
  );
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await q(`DELETE FROM uc_cases WHERE workspace_id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM uc_templates WHERE id = $1::uuid`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(PEOPLE).map((p) => ids[p as Person])]);
});

const first = { card: "", needA: "", needB: "" };

test("l'ultima informazione «A posto»: una riga ai revisori di Lateral Space tranne chi ha agito, e l'email in coda", opts, async () => {
  first.card = await card();
  first.needA = await need(first.card, { status: "validata" });
  first.needB = await need(first.card);
  ok(await needs.updateNeed(as("lsAnalyst"), first.needA, await needVersion(first.needA), { title: "Quante fatture al mese?" }), "una modifica che non chiude");
  assert.deepEqual(await who(first.card), [], "con un'informazione ancora aperta, niente");
  ok(await needs.updateNeed(as("lsAnalyst"), first.needB, await needVersion(first.needB), { status: "validata" }));
  assert.deepEqual(await who(first.card), people("lsLead"), "solo Lateral Space verificata, mai chi ha agito, mai il cliente o un contributore");
  const s = await state(first.card);
  assert.ok(s?.ready_since);
  assert.equal(s?.ready_quarter, quarter);
  assert.deepEqual((await queued("lsLead", first.card)).map((r) => [r.status, r.kind]), [["in_coda", "pronto"]]);
  assert.equal((await queued("client", first.card)).length, 0);
  assert.deepEqual(await who(first.card, "complete"), [], "nessuna richiesta al referente: niente «Informazioni complete»");
});

test("una scrittura in più mentre è pronto non avvisa di nuovo", opts, async () => {
  await q(`UPDATE use_case_notifications SET read_at = now() WHERE use_case_id = $1::uuid`, [first.card]);
  ok(await needs.updateNeed(as("client"), first.needA, await needVersion(first.needA), { title: "Quante fatture all'anno?" }));
  const r = await rows(first.card);
  assert.equal(r.length, 1);
  assert.ok(r[0].read_at, "resta letta: nessun avviso nuovo");
  // Il cron dopo una scrittura: confronta con lo stato salvato, niente doppioni. Due giri lo stesso.
  for (let round = 0; round < 2; round++) {
    await alerts.syncReadyCards({ env: process.env, now: new Date() });
    const again = await rows(first.card);
    assert.equal(again.length, 1);
    assert.ok(again[0].read_at, `giro ${round + 1}`);
  }
});

test("«Non si applica», archiviare, scollegare, spostare dalla parte di Lateral Space o a «passo»: pronto", opts, async () => {
  const cases: Array<{ label: string; run: (cardId: string, needId: string) => Promise<unknown> }> = [
    { label: "non si applica", run: async (_c, n) => ok(await needs.updateNeed(as("client"), n, await needVersion(n), { status: "non_applicabile" })) },
    { label: "archiviata", run: async (_c, n) => ok(await needs.archiveNeed(as("client"), n, await needVersion(n), "Non serve più")) },
    { label: "scollegata", run: async (c, n) => ok(await needs.unlinkNeed(as("client"), n, c)) },
    { label: "Lateral Space", run: async (_c, n) => ok(await needs.updateNeed(as("client"), n, await needVersion(n), { ownerSide: "lateral_space" })) },
    { label: "passo", run: async (_c, n) => ok(await needs.updateNeed(as("client"), n, await needVersion(n), { type: "passo" })) },
  ];
  for (const c of cases) {
    const cardId = await card();
    const needId = await need(cardId, { status: "parziale" });
    await c.run(cardId, needId);
    assert.deepEqual(await who(cardId), people("lsLead", "lsAnalyst"), c.label);
  }
});

test("approvare con niente da chiedere al cliente: pronto; «Più avanti»: no", opts, async () => {
  const now = await card({ status: "proposed", quarter: null });
  ok(await service.decideUseCase(as("client"), now, await cardVersion(now), { type: "approva", quando: "questo_trimestre" }));
  assert.deepEqual(await who(now), people("lsLead", "lsAnalyst"));
  const later = await card({ status: "proposed", quarter: null });
  ok(await service.decideUseCase(as("client"), later, await cardVersion(later), { type: "approva", quando: "piu_avanti" }));
  assert.deepEqual(await who(later), []);
  assert.equal(await state(later), null, "uno use case mai pronto non ha stato");
  // Dal MCP del team: lo stesso servizio, lo stesso avviso.
  const mcp = await card({ status: "proposed", quarter: null });
  ok(await service.decideUseCase(as("lsLead", "mcp_team"), mcp, await cardVersion(mcp), { type: "approva", quando: "prossimo_trimestre" }));
  assert.deepEqual(await who(mcp), people("lsAnalyst"));
});

test("«Quando» da «Più avanti» o da un trimestre scaduto a uno valido: pronto, anche una seconda volta", opts, async () => {
  const later = await card({ quarter: null });
  ok(await service.setWhen(as("client"), later, await cardVersion(later), "questo_trimestre"));
  assert.deepEqual(await who(later), people("lsLead", "lsAnalyst"));
  // Pronto per un trimestre ormai passato: lo stato non vale più, quindi il nuovo trimestre avvisa di nuovo.
  const expired = await card({ quarter: "2020-Q1" });
  await q(`INSERT INTO use_case_ready_state (use_case_id, workspace_id, ready_since, ready_quarter) VALUES ($1::uuid, $2::uuid, '2020-01-15T09:00:00Z', '2020-Q1')`, [expired, ids.ws]);
  ok(await service.setWhen(as("client"), expired, await cardVersion(expired), "prossimo_trimestre"));
  assert.deepEqual(await who(expired), people("lsLead", "lsAnalyst"));
  assert.notEqual(new Date(String((await state(expired))?.ready_since)).getUTCFullYear(), 2020, "nuovo ready_since");
  // Da un trimestre valido all'altro: resta pronto, nessun avviso nuovo.
  await q(`UPDATE use_case_notifications SET read_at = now() WHERE use_case_id = $1::uuid`, [later]);
  ok(await service.setWhen(as("client"), later, await cardVersion(later), "prossimo_trimestre"));
  assert.ok((await rows(later)).every((r) => r.read_at));
});

test("il tipo da «Da diffondere» a «Da costruire»; la REST di oggi («accepted» = Più avanti) non avvisa", opts, async () => {
  const kind = await card({ kind: "best_practice" });
  assert.deepEqual(await who(kind), []);
  ok(await service.updateUseCase(as("client"), kind, await cardVersion(kind), { kind: "da_costruire" }));
  assert.deepEqual(await who(kind), people("lsLead", "lsAnalyst"));
  const rest = await card({ status: "proposed", quarter: null });
  ok(await service.applyLegacyStatus(as("client", "rest"), rest, "accepted"));
  assert.deepEqual(await who(rest), []);
  ok(await service.setWhen(as("client"), rest, await cardVersion(rest), "questo_trimestre"));
  assert.deepEqual(await who(rest), people("lsLead", "lsAnalyst"));
});

test("la risposta del team che chiude l'ultima informazione", opts, async () => {
  const cardId = await card();
  const needId = await need(cardId);
  ok(await referents.addReviewerAnswer(as("lsLead"), cardId, needId, { text: "Circa venti al giorno", validate: true }));
  assert.deepEqual(await who(cardId), people("lsAnalyst"));
});

test("pronto → non pronto → pronto: lo stesso giorno la stessa riga torna non letta; il giorno dopo una riga nuova", opts, async () => {
  const cardId = await card();
  const needId = await need(cardId);
  ok(await needs.updateNeed(as("client"), needId, await needVersion(needId), { status: "validata" }));
  await q(`UPDATE use_case_notifications SET read_at = now() WHERE use_case_id = $1::uuid`, [cardId]);
  const before = await rows(cardId);
  ok(await needs.updateNeed(as("client"), needId, await needVersion(needId), { status: "parziale" }));
  assert.equal((await state(cardId))?.ready_since, null, "non più pronto");
  ok(await needs.updateNeed(as("client"), needId, await needVersion(needId), { status: "validata" }));
  const again = await rows(cardId);
  assert.equal(again.length, before.length, "la stessa riga");
  assert.ok(again.every((r) => r.read_at === null), "di nuovo non letta");
  assert.ok(new Date(String(again[0].last_event_at)).getTime() >= new Date(String(before[0].last_event_at)).getTime());
  // Il giorno dopo (orologio di prova): una riga nuova per quel giorno.
  const tomorrow = new Date(Date.now() + 86_400_000);
  const readiness = { ...(await alerts.readinessSyncFor(ids.ws, process.env, tomorrow))!, clock: tomorrow };
  const exec = async (statements: import("../../uc/sql/statement.ts").UcStatement[]) => (await (await import("../../db/uc-executor.ts")).getAppUcExecutor()).batch(statements);
  await q(`UPDATE use_case_needs SET status = 'parziale' WHERE id = $1::uuid`, [needId]);
  await exec(sqlMod.cardSyncStatements({ workspaceId: ids.ws, useCaseIds: [cardId], actorUserId: null, readiness, info: false }));
  await q(`UPDATE use_case_needs SET status = 'validata' WHERE id = $1::uuid`, [needId]);
  await exec(sqlMod.cardSyncStatements({ workspaceId: ids.ws, useCaseIds: [cardId], actorUserId: null, readiness, info: false }));
  const days = [...new Set((await rows(cardId)).map((r) => String(r.day)))];
  assert.equal(days.length, 2, JSON.stringify(days));
});

test("due scritture insieme sulle ultime due informazioni, e un'approvazione insieme all'ultima: un avviso solo, nessuno stallo", opts, async () => {
  const cardId = await card();
  const [a, b] = [await need(cardId), await need(cardId)];
  const [va, vb] = [await needVersion(a), await needVersion(b)];
  const results = await Promise.all([
    needs.updateNeed(as("client"), a, va, { status: "validata" }),
    needs.updateNeed(as("exec"), b, vb, { status: "validata" }),
  ]);
  for (const r of results) assert.ok(r.ok, JSON.stringify(r));
  const r = await rows(cardId);
  assert.deepEqual(r.map((x) => String(x.who)).sort(), people("lsLead", "lsAnalyst"), "una riga per persona");

  const approval = await card({ status: "proposed", quarter: null });
  const last = await need(approval, { status: "parziale" });
  const [cv, nv] = [await cardVersion(approval), await needVersion(last)];
  const both = await Promise.all([
    service.decideUseCase(as("client"), approval, cv, { type: "approva", quando: "questo_trimestre" }),
    needs.updateNeed(as("exec"), last, nv, { status: "validata" }),
  ]);
  for (const x of both) assert.ok(x.ok, JSON.stringify(x));
  const per = new Map<string, number>();
  for (const x of await rows(approval)) per.set(String(x.who), (per.get(String(x.who)) ?? 0) + 1);
  assert.deepEqual([...per.keys()].sort(), people("lsLead", "lsAnalyst"));
  assert.ok([...per.values()].every((n) => n === 1));
});

test("il cron vede una modifica fatta fuori dall'app e annuncia una volta sola", opts, async () => {
  const cardId = await card();
  const needId = await need(cardId);
  await q(`UPDATE use_case_needs SET status = 'validata' WHERE id = $1::uuid`, [needId]);
  assert.deepEqual(await who(cardId), []);
  const first = await alerts.syncReadyCards({ env: process.env, now: new Date() });
  assert.ok(first.announced >= 1, JSON.stringify(first));
  assert.equal(first.errors, 0);
  assert.deepEqual(await who(cardId), people("lsLead", "lsAnalyst"), "dal cron nessuno è escluso");
  const second = await alerts.syncReadyCards({ env: process.env, now: new Date() });
  assert.equal(second.announced, 0);
  assert.equal((await rows(cardId)).length, 2);
  // Un trimestre passato o un dossier avviato dai dossier: il cron azzera lo stato, senza avvisi.
  await q(`UPDATE use_cases SET target_quarter = '2020-Q1' WHERE id = $1::uuid`, [cardId]);
  await alerts.syncReadyCards({ env: process.env, now: new Date() });
  assert.equal((await state(cardId))?.ready_since, null);
});

test("«Informazioni complete»: Lateral Space riceve solo «Pronto da avviare», il cliente la riceve come prima", opts, async () => {
  const cardId = await card();
  const needId = await need(cardId);
  await q(
    `INSERT INTO use_case_referent_requests (workspace_id, use_case_id, contact_id, requester_name, expires_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 'Il team', now() + interval '30 days')`,
    [ids.ws, cardId, randomUUID()],
  );
  ok(await needs.updateNeed(as("client"), needId, await needVersion(needId), { status: "validata" }));
  assert.deepEqual(await who(cardId), people("lsLead", "lsAnalyst"));
  // I revisori che non sono Lateral Space (il cliente, un'email di Lateral Space non verificata) come prima.
  assert.deepEqual(await who(cardId, "complete"), people("exec", "lsUnverified"), "il cliente come prima; Lateral Space non due volte");
});

test("un dossier completo collegato: non pronto; «Avvia la realizzazione» azzera lo stato", opts, async () => {
  const cardId = await card();
  await need(cardId, { status: "validata" });
  await alerts.syncReadyCards({ env: process.env, now: new Date() });
  assert.ok((await state(cardId))?.ready_since);
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova', 'raccolta', now())`,
    [randomUUID(), ids.ws, ids.org, cardId, ids.template, `PD-${suffix.toUpperCase()}-${codeSeq++}`],
  );
  await alerts.syncReadyCards({ env: process.env, now: new Date() });
  assert.equal((await state(cardId))?.ready_since, null);
});

test("il seme della migrazione: gli use case già pronti si segnano, nessun avviso", opts, async () => {
  const cardId = await card();
  await need(cardId, { status: "non_applicabile" });
  const seed = ddl.USE_CASE_ALERTS_DDL[ddl.USE_CASE_ALERTS_DDL.length - 1];
  await q(seed);
  assert.ok((await state(cardId))?.ready_since);
  await alerts.syncReadyCards({ env: process.env, now: new Date() });
  assert.deepEqual(await who(cardId), []);
});

test("parità: la regola in SQL dà la stessa risposta di isReadyToStart su una matrice di use case", opts, async () => {
  const matrix: Array<{ status: string; review: string; kind: string; quarter: string | null; needs: Array<{ status: string; side: string | null; type?: string }>; dossier?: boolean }> = [];
  const quarters = [quarter, "2020-Q1", null, "2099-Q2"];
  for (const status of ["accepted", "proposed", "in_progress", "implemented", "rejected"]) {
    for (const q0 of quarters) matrix.push({ status, review: "scored", kind: "use_case_ai", quarter: q0, needs: [] });
  }
  matrix.push(
    { status: "accepted", review: "archived", kind: "use_case_ai", quarter, needs: [] },
    { status: "accepted", review: "scored", kind: "best_practice", quarter, needs: [] },
    { status: "accepted", review: "scored", kind: "use_case_ai", quarter, needs: [{ status: "validata", side: "cliente" }, { status: "non_applicabile", side: null }] },
    { status: "accepted", review: "scored", kind: "use_case_ai", quarter, needs: [{ status: "parziale", side: "insieme" }] },
    { status: "accepted", review: "scored", kind: "use_case_ai", quarter, needs: [{ status: "da_chiedere", side: "lateral_space" }] },
    { status: "accepted", review: "scored", kind: "use_case_ai", quarter, needs: [{ status: "da_chiedere", side: "fornitore" }] },
    { status: "accepted", review: "scored", kind: "use_case_ai", quarter, needs: [{ status: "proposta", side: "cliente", type: "passo" }] },
    { status: "accepted", review: "scored", kind: "use_case_ai", quarter, needs: [{ status: "in_verifica", side: null }] },
    { status: "accepted", review: "needs_inputs", kind: "use_case_ai", quarter, needs: [] },
    { status: "accepted", review: "scored", kind: "use_case_ai", quarter, needs: [], dossier: true },
  );
  const today = String((await q(`SELECT (now() AT TIME ZONE 'Europe/Rome')::date::text AS d`))[0].d);
  const { clientSideNeeds } = await import("../info-progress.ts");
  const { kindOf } = await import("../labels.ts");
  for (const m of matrix) {
    const cardId = await card({ status: m.status, review: m.review, kind: m.kind, quarter: m.quarter });
    const facts = [];
    for (const n of m.needs) facts.push({ id: await need(cardId, { status: n.status, side: n.side, type: n.type }), type: n.type ?? "requisito", ownerSide: n.side, status: n.status, archivedAt: null, useCaseIds: [cardId] });
    let caseCode: string | null = null;
    if (m.dossier) {
      caseCode = `PX-${suffix.toUpperCase()}-${codeSeq++}`;
      await q(
        `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova', 'raccolta', now())`,
        [randomUUID(), ids.ws, ids.org, cardId, ids.template, caseCode],
      );
    }
    const { cast, toStatement, ucSql } = await import("../../uc/sql/statement.ts");
    const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
    const [[row]] = await (await getAppUcExecutor()).batch([
      toStatement(ucSql`SELECT ${sqlMod.readyNowSql("u", { dossiers: true })} AS ready FROM use_cases u WHERE u.id = ${cast(cardId, "uuid")}`),
    ]);
    const phase = phaseMod.phaseOfUseCase({
      status: m.status,
      portfolioReviewStatus: m.review,
      reviewedBy: null,
      publicNote: null,
      intake: null,
      reviewBy: null,
      linkedCaseCode: caseCode,
      portfolioKind: m.kind,
      targetQuarter: m.quarter,
      dossierStatus: caseCode ? "raccolta" : null,
      duplicateOfCode: null,
      today,
    } as Parameters<typeof phaseMod.phaseOfUseCase>[0]).phase;
    const expected = readinessMod.isReadyToStart({
      kind: kindOf(m.kind),
      phase,
      targetQuarter: m.quarter,
      clientNeeds: clientSideNeeds(facts as Parameters<typeof clientSideNeeds>[0], cardId),
      today,
    });
    assert.equal(row.ready, expected, JSON.stringify(m));
  }
  assert.ok(matrix.length >= 30, String(matrix.length));
});
