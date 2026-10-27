import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// Le notifiche degli use case per i revisori sul database di prova (SPEC §P2.6): chi le riceve
// (prima il ruolo nell'organizzazione, poi quello nel workspace; mai chi ha agito), le righe dello
// stesso giorno che si sommano e tornano non lette, la lettura per persona, «Informazioni complete»
// una sola volta, anche con due scritture insieme.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). Dati sintetici, creati e cancellati qui.
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

type Referents = typeof import("../../db/queries/use-case-referents.ts");
type Public = typeof import("../../db/queries/use-case-referent-public.ts");
type Dispatch = typeof import("../../db/queries/use-case-referent-dispatch.ts");
type Ctx = import("../service.ts").WriteContext;
type Mail = import("../../uc/notify/dispatch.ts").OutgoingEmail;

let referents: Referents;
let pub: Public;
let dispatch: Dispatch;
let notifications: typeof import("../../db/queries/use-case-notifications.ts");
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), other: randomUUID(), builder: randomUUID(), analyst: randomUUID(), contributor: randomUUID(), ls: randomUUID(), useCase: randomUUID(), otherCard: randomUUID() };
const emails = {
  builder: `builder.referenti.${suffix}@cliente.test`,
  analyst: `analyst.referenti.${suffix}@cliente.test`,
  contributor: `contributor.referenti.${suffix}@cliente.test`,
  ls: `ls.referenti.${suffix}@ls.test`,
};
type Person = keyof typeof emails;
const ROLE: Record<Person, string> = { builder: "function_lead", analyst: "analyst", contributor: "contributor", ls: "transformation_lead" };
const REFERENT_EMAIL = `mario.rossi.${suffix}@topjet.test`;
const storageDir = mkdtempSync(join(tmpdir(), "referenti-"));

const ENV = {
  USE_CASE_HUB_WORKSPACES: "",
  UC_LS_EMAIL_DOMAINS: "ls.test",
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  UC_LOCAL_STORAGE_DIR: storageDir,
} as Record<string, string | undefined>;
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function as(person: Person, workspaceId: string = ids.ws): Ctx {
  return { workspaceId, actor: { userId: ids[person], role: ROLE[person], isLateralSpace: person === "ls", kind: "persona" }, channel: "pagina" };
}
const requester = (person: Person) => ({ name: `Persona ${person}`, emailVerified: true });

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}
function refused(result: { ok: boolean; error?: string }, error: string, label = "rifiuto") {
  assert.equal(result.ok, false, label);
  assert.equal(result.error, error, label);
}

function fakeMailer() {
  const outbox: Mail[] = [];
  return { outbox, async send(m: Mail) { outbox.push(m); return { ok: true as const }; } };
}
const tokenOf = (m: Mail) => /\/rispondi\/(ucq_[A-Za-z0-9_-]{32})/.exec(m.text)?.[1] ?? null;

async function needIds(useCaseId: string = ids.useCase): Promise<string[]> {
  const rows = await q(`SELECT n.id::text AS id FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid ORDER BY n.sort_order, n.id`, [useCaseId]);
  return rows.map((r) => String(r.id));
}
async function statusOf(needId: string): Promise<string> {
  return String((await q(`SELECT status FROM use_case_needs WHERE id = $1::uuid`, [needId]))[0]?.status);
}
async function useCaseSnapshot(): Promise<string> {
  return JSON.stringify(await q(`SELECT version, portfolio_review_status, intake, updated_at FROM use_cases WHERE id = $1::uuid`, [ids.useCase]));
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  ENV.USE_CASE_HUB_WORKSPACES = [ids.ws, ids.other].join(",");
  process.env.USE_CASE_HUB_WORKSPACES = ENV.USE_CASE_HUB_WORKSPACES;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
  delete process.env.USE_CASE_REFERENTS;
  referents = await import("../../db/queries/use-case-referents.ts");
  pub = await import("../../db/queries/use-case-referent-public.ts");
  dispatch = await import("../../db/queries/use-case-referent-dispatch.ts");
  notifications = await import("../../db/queries/use-case-notifications.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione referenti', $2)`, [ids.org, `hub-referenti-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'TopJet prova'), ($2::uuid, $3::uuid, 'Altro workspace')`, [ids.ws, ids.other, ids.org]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
    for (const ws of [ids.ws, ids.other]) await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ws, ids[person], ROLE[person]]);
  }
  for (const [id, ws, code] of [
    [ids.useCase, ids.ws, `RF-${String(1000 + Math.floor(Math.random() * 8000))}`],
    [ids.otherCard, ids.other, `RG-${String(1000 + Math.floor(Math.random() * 8000))}`],
  ]) {
    await q(
      `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
       VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'Problema di prova', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed')`,
      [id, ws, code],
    );
  }
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(storageDir, { recursive: true, force: true });
  if (!enabled) return;
  await q(`DELETE FROM uc_rate_limits WHERE bucket LIKE 'ucq:%'`);
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.other]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[...Object.keys(emails).map((p) => ids[p as Person]), ...Object.values(extra)]]);
});

const state = { requestId: "", contactId: "", token: "", needs: [] as string[] };


type NeedsService = typeof import("../needs-service.ts");
let needsService: NeedsService;
const extra = { orgSponsor: randomUUID(), orgContributor: randomUUID(), learner: randomUUID(), stranger: randomUUID() };

async function exec(...statements: import("../../uc/sql/statement.ts").UcStatement[]) {
  const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
  return (await getAppUcExecutor()).batch(statements);
}
async function rowsFor(useCaseId: string, kind: string) {
  return q(
    `SELECT recipient_user_id::text AS who, answers, unknowns, documents, follow_up, read_at, rome_day::text AS day FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = $2 ORDER BY recipient_user_id`,
    [useCaseId, kind],
  );
}

test("destinatari: revisori del workspace e dell'organizzazione; l'organizzazione vince; mai chi ha agito, contributori, corsisti, estranei", opts, async () => {
  needsService = await import("../needs-service.ts");
  const add = async (id: string, email: string) => q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, 'Persona extra', now())`, [id, email]);
  await add(extra.orgSponsor, `sponsor.${suffix}@cliente.test`);
  await add(extra.orgContributor, `orgcontrib.${suffix}@cliente.test`);
  await add(extra.learner, `corsista.${suffix}@cliente.test`);
  await add(extra.stranger, `estraneo.${suffix}@cliente.test`);
  await q(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'exec_sponsor')`, [ids.org, extra.orgSponsor]);
  await q(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'contributor')`, [ids.org, extra.orgContributor]);
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'function_lead')`, [ids.ws, extra.orgContributor]);
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'learner')`, [ids.ws, extra.learner]);
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'function_lead')`, [ids.other, extra.stranger]);
  await exec(notifications.notifyReviewersSql({ workspaceId: ids.ws, useCaseId: ids.useCase, kind: "risposte", answers: 2, unknowns: 0, documents: 0, actorUserId: ids.builder }));
  const who = (await rowsFor(ids.useCase, "risposte")).map((r) => r.who).sort();
  assert.deepEqual(who, [ids.analyst, ids.ls, extra.orgSponsor].sort());
});

test("lo stesso giorno si somma e torna non letta; dopo la lettura si riparte dall'evento nuovo; il giorno dopo una riga nuova", opts, async () => {
  const day1 = new Date("2026-11-03T09:00:00Z");
  const card2 = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
     VALUES ($1::uuid, $2::uuid, 'Ordini', 'Problema', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed')`,
    [card2, ids.ws, `RJ-${String(1000 + Math.floor(Math.random() * 8000))}`],
  );
  const ev = (answers: number, unknowns: number, clock: Date) => exec(notifications.notifyReviewersSql({ workspaceId: ids.ws, useCaseId: card2, kind: "risposte", answers, unknowns, actorUserId: null, clock }));
  await ev(1, 0, day1);
  await ev(2, 1, new Date(day1.getTime() + 3600_000));
  let rows = (await rowsFor(card2, "risposte")).filter((r) => r.who === ids.analyst);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].answers, rows[0].unknowns, rows[0].read_at], [3, 1, null]);
  await q(`UPDATE use_case_notifications SET read_at = now() WHERE use_case_id = $1::uuid AND recipient_user_id = $2::uuid`, [card2, ids.analyst]);
  await ev(4, 0, new Date(day1.getTime() + 7200_000));
  rows = (await rowsFor(card2, "risposte")).filter((r) => r.who === ids.analyst);
  assert.deepEqual([rows[0].answers, rows[0].unknowns, rows[0].read_at], [4, 0, null], "dopo la lettura solo l'evento nuovo, di nuovo non letta");
  // Gli altri revisori hanno le loro righe, con le somme di tutti e tre.
  const builder = (await rowsFor(card2, "risposte")).filter((r) => r.who === ids.builder);
  assert.deepEqual([builder[0].answers, builder[0].unknowns], [7, 1]);
  await ev(1, 0, new Date("2026-11-04T09:00:00Z"));
  rows = (await rowsFor(card2, "risposte")).filter((r) => r.who === ids.analyst);
  assert.deepEqual(rows.map((r) => String(r.day)).sort(), ["2026-11-03", "2026-11-04"]);
});

test("«Informazioni complete»: una volta sola, solo con una richiesta sulla scheda, di nuovo dopo «non più complete»", opts, async () => {
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead') ON CONFLICT DO NOTHING`,
    [ids.ws, ids.builder],
  );
  ok(await referents.prepareReferentQuestions(as("builder"), ids.useCase));
  const needs = await needIds();
  // Una scheda senza richiesta, completata a mano: nessuna notifica.
  for (const id of needs) {
    const [n] = await q(`SELECT version FROM use_case_needs WHERE id = $1::uuid`, [id]);
    ok(await needsService.updateNeed(as("builder"), id, Number(n.version), { status: "non_applicabile" }), "a mano");
  }
  assert.equal((await rowsFor(ids.useCase, "complete")).length, 0);
  // Riaperte, poi una richiesta e la chiusura: una notifica, mai a chi chiude.
  for (const id of needs) {
    const [n] = await q(`SELECT version FROM use_case_needs WHERE id = $1::uuid`, [id]);
    ok(await needsService.updateNeed(as("builder"), id, Number(n.version), { status: "da_chiedere" }));
  }
  ok(await referents.sendReferentRequest(as("builder"), ids.useCase, { contact: { kind: "nuovo", displayName: "Mario Rossi", email: REFERENT_EMAIL }, needIds: needs.slice(0, 1) }, { env: ENV, requester: requester("builder") }));
  for (const id of needs) {
    const [n] = await q(`SELECT version FROM use_case_needs WHERE id = $1::uuid`, [id]);
    ok(await needsService.updateNeed(as("analyst"), id, Number(n.version), { status: "validata" }), "verificata");
  }
  let complete = await rowsFor(ids.useCase, "complete");
  assert.deepEqual(complete.map((r) => r.who).sort(), [ids.builder, ids.ls, extra.orgSponsor].sort(), "tutti i revisori tranne chi ha completato");
  // Una modifica che non cambia la completezza non la riemette.
  const [n0] = await q(`SELECT version FROM use_case_needs WHERE id = $1::uuid`, [needs[0]]);
  ok(await needsService.updateNeed(as("analyst"), needs[0], Number(n0.version), { title: "Ogni quanto fate questo lavoro?" }));
  assert.equal((await rowsFor(ids.useCase, "complete")).length, complete.length);
  await q(`UPDATE use_case_notifications SET read_at = now() WHERE use_case_id = $1::uuid AND kind = 'complete'`, [ids.useCase]);
  // Non più completa, poi di nuovo: di nuovo non letta.
  const [n1] = await q(`SELECT version FROM use_case_needs WHERE id = $1::uuid`, [needs[1]]);
  ok(await needsService.updateNeed(as("analyst"), needs[1], Number(n1.version), { status: "parziale" }));
  const [n1b] = await q(`SELECT version FROM use_case_needs WHERE id = $1::uuid`, [needs[1]]);
  ok(await needsService.updateNeed(as("analyst"), needs[1], Number(n1b.version), { status: "validata" }));
  complete = await rowsFor(ids.useCase, "complete");
  assert.ok(complete.every((r) => r.read_at === null), "di nuovo non letta");
});

test("«Informazioni complete» con due scritture insieme sulle ultime due esigenze: una sola", opts, async () => {
  const card = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
     VALUES ($1::uuid, $2::uuid, 'Concorrenza', 'Problema', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed')`,
    [card, ids.ws, `RK-${String(1000 + Math.floor(Math.random() * 8000))}`],
  );
  ok(await referents.prepareReferentQuestions(as("builder"), card));
  const needs = await needIds(card);
  ok(await referents.sendReferentRequest(as("builder"), card, { contact: { kind: "nuovo", displayName: "Anna Neri", email: `anna.${suffix}@topjet.test` }, needIds: needs.slice(0, 1) }, { env: ENV, requester: requester("builder") }));
  for (const id of needs.slice(2)) {
    const [n] = await q(`SELECT version FROM use_case_needs WHERE id = $1::uuid`, [id]);
    ok(await needsService.updateNeed(as("analyst"), id, Number(n.version), { status: "validata" }));
  }
  const versions = await Promise.all(needs.slice(0, 2).map(async (id) => Number((await q(`SELECT version FROM use_case_needs WHERE id = $1::uuid`, [id]))[0].version)));
  const results = await Promise.all([
    needsService.updateNeed(as("analyst"), needs[0], versions[0], { status: "validata" }),
    needsService.updateNeed(as("ls"), needs[1], versions[1], { status: "validata" }),
  ]);
  for (const r of results) assert.ok(r.ok, JSON.stringify(r));
  const complete = await rowsFor(card, "complete");
  const perPerson = new Map<string, number>();
  for (const r of complete) perPerson.set(String(r.who), (perPerson.get(String(r.who)) ?? 0) + 1);
  assert.ok(complete.length >= 1, "una notifica");
  assert.ok([...perPerson.values()].every((n) => n === 1), "una sola per persona");
  const [info] = await q(`SELECT complete_since FROM use_case_info_state WHERE use_case_id = $1::uuid`, [card]);
  assert.ok(info.complete_since);
});

test("un lato «Lateral Space» non blocca la completezza", opts, async () => {
  const card = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
     VALUES ($1::uuid, $2::uuid, 'Lati', 'Problema', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed')`,
    [card, ids.ws, `RL-${String(1000 + Math.floor(Math.random() * 8000))}`],
  );
  ok(await referents.prepareReferentQuestions(as("builder"), card));
  const needs = await needIds(card);
  ok(await referents.sendReferentRequest(as("builder"), card, { contact: { kind: "nuovo", displayName: "Paolo Gialli", email: `paolo.${suffix}@topjet.test` }, needIds: needs.slice(0, 1) }, { env: ENV, requester: requester("builder") }));
  const [n0] = await q(`SELECT version FROM use_case_needs WHERE id = $1::uuid`, [needs[0]]);
  ok(await needsService.updateNeed(as("analyst"), needs[0], Number(n0.version), { ownerSide: "lateral_space" }));
  for (const id of needs.slice(1)) {
    const [n] = await q(`SELECT version FROM use_case_needs WHERE id = $1::uuid`, [id]);
    ok(await needsService.updateNeed(as("analyst"), id, Number(n.version), { status: "validata" }));
  }
  assert.ok((await rowsFor(card, "complete")).length >= 1);
});

// Gli aiuti di prova comuni alle suite di «Chiedi al referente»: questa non li usa tutti.
void (() => [pub, dispatch, refused, fakeMailer, tokenOf, statusOf, useCaseSnapshot, state]);
