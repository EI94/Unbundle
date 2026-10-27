import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { isWorkingDay, romeDate, romeLocalToUtc, workingDaysBetween } from "../../uc/calendar.ts";

// Il cron di «Chiedi al referente» sul database di prova (SPEC §3.6, §3.7, §P2.9.2): promemoria al
// terzo e al settimo giorno lavorativo, una sola email al giorno per persona con tutte le sue
// richieste, scadenza (le esigenze restano «chiesta», «Senza risposta»), conservazione, avvisi.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). Il cron gira con un `now` fisso nella finestra di Roma (un giorno lavorativo alle 10,
//   non dopo l'ora vera) e le date delle richieste spostate indietro: mai l'orologio di sistema.
// - Nessuna email vera (mailer finto). Dati sintetici, creati e cancellati qui.
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
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

const state = { requestId: "", contactId: "", token: "", needs: [] as string[] };



/** Un giorno lavorativo alle 10 di Roma, non dopo adesso. */
function virtualNow(): Date {
  let day = romeDate(new Date());
  for (let i = 0; i < 20; i++) {
    const at = romeLocalToUtc(day, 10);
    if (isWorkingDay(day) && at.getTime() <= Date.now()) return at;
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    day = d.toISOString().slice(0, 10);
  }
  throw new Error("nessun giorno lavorativo");
}
/** Il giorno lavorativo `n` giorni prima di `to`, alle 10 di Roma. */
function workingDaysBefore(to: Date, n: number): Date {
  let day = romeDate(to);
  for (let i = 0; i < 60; i++) {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    day = d.toISOString().slice(0, 10);
    if (isWorkingDay(day) && workingDaysBetween(day, to) === n) return romeLocalToUtc(day, 10);
  }
  throw new Error("giorno non trovato");
}

const V = virtualNow();
let cards: string[] = [];

async function sendTo(useCaseId: string, needs: string[], email = REFERENT_EMAIL): Promise<string> {
  const contacts = await q(`SELECT id::text AS id FROM uc_contacts WHERE workspace_id = $1::uuid AND email = $2`, [ids.ws, email]);
  const contact = contacts[0] ? { kind: "esistente", contactId: String(contacts[0].id) } : { kind: "nuovo", displayName: "Mario Rossi", email };
  const sent = ok(await referents.sendReferentRequest(as("builder"), useCaseId, { contact, needIds: needs }, { env: ENV, requester: requester("builder") }), "invio");
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer: fakeMailer(), sendIntervalMs: 0 });
  return sent.requestId;
}

/** Sposta indietro le date di una richiesta: inviata il giorno `sent`, ultima email `last`. */
async function backdate(requestId: string, sent: Date, last: Date, reminderCount = 0): Promise<void> {
  await q(
    `UPDATE use_case_referent_requests SET created_at = $2::timestamptz - interval '1 minute', sent_at = $2::timestamptz, last_email_at = $3::timestamptz,
       last_reminder_at = CASE WHEN $4::int > 0 THEN $3::timestamptz ELSE NULL END, reminder_count = $4::int, expires_at = $2::timestamptz + interval '30 days'
     WHERE id = $1::uuid`,
    [requestId, sent.toISOString(), last.toISOString(), reminderCount],
  );
  await q(`UPDATE use_case_referent_emails SET sent_at = $2::timestamptz, created_at = $2::timestamptz, due_at = $2::timestamptz, scheduled_at = $2::timestamptz WHERE request_id = $1::uuid`, [requestId, sent.toISOString()]);
  // I promemoria già partiti per questa richiesta: partiti il giorno dell'ultima email.
  await q(
    `UPDATE use_case_referent_emails SET sent_at = $2::timestamptz, created_at = $2::timestamptz, due_at = $2::timestamptz, scheduled_at = $2::timestamptz, dedupe_key = dedupe_key || ':prima'
     WHERE template = 'promemoria' AND id IN (SELECT email_id FROM use_case_referent_email_items WHERE request_id = $1::uuid)`,
    [requestId, last.toISOString()],
  );
}

async function newCard(): Promise<string> {
  const id = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
     VALUES ($1::uuid, $2::uuid, 'Ordini clienti', 'Problema di prova', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed')`,
    [id, ids.ws, `RH-${String(1000 + Math.floor(Math.random() * 8000))}`],
  );
  ok(await referents.prepareReferentQuestions(as("builder"), id));
  return id;
}

const promemoria = (outbox: Mail[], to = REFERENT_EMAIL) => outbox.filter((m) => m.to === to);
const OTHER_REFERENT = `anna.neri.${suffix}@topjet.test`;

test("preparazione", opts, async () => {
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
  );
  ok(await referents.prepareReferentQuestions(as("builder"), ids.useCase));
  state.needs = await needIds();
  cards = [ids.useCase, await newCard(), await newCard()];
  assert.equal(workingDaysBetween(workingDaysBefore(V, 3), V), 3);
});

test("primo promemoria al terzo giorno lavorativo; mai due email lo stesso giorno", opts, async () => {
  const requestId = await sendTo(ids.useCase, state.needs.slice(0, 2));
  state.requestId = requestId;
  const sent = workingDaysBefore(V, 3);
  await backdate(requestId, sent, sent);
  const mailer = fakeMailer();
  const counts = await referents.runReferentCron({ env: ENV, now: V, mailer });
  assert.equal(counts.errors, 0, JSON.stringify(counts));
  const mails = promemoria(mailer.outbox);
  assert.equal(mails.length, 1, JSON.stringify(counts));
  assert.match(mails[0].subject, /^Promemoria: 2 domande aperte su «/);
  assert.match(mails[0].text, /\/rispondi\/ucq_/);
  const [r] = await q(`SELECT reminder_count, last_reminder_at FROM use_case_referent_requests WHERE id = $1::uuid`, [requestId]);
  assert.equal(Number(r.reminder_count), 1);
  assert.ok(r.last_reminder_at);
  assert.equal((await q(`SELECT 1 FROM use_case_events WHERE use_case_id = $1::uuid AND phase_after = 'promemoria_1'`, [ids.useCase])).length, 1);
  const again = fakeMailer();
  await referents.runReferentCron({ env: ENV, now: V, mailer: again });
  assert.equal(promemoria(again.outbox).length, 0, "lo stesso giorno niente");
});

test("ultimo promemoria al settimo giorno: «Senza risposta» per i revisori e un avviso a chi ha chiesto", opts, async () => {
  const sent = workingDaysBefore(V, 7);
  const last = workingDaysBefore(V, 4);
  await backdate(state.requestId, sent, last, 1);
  const mailer = fakeMailer();
  const counts = await referents.runReferentCron({ env: ENV, now: V, mailer });
  assert.equal(counts.errors, 0, JSON.stringify(counts));
  const mails = promemoria(mailer.outbox);
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /^Ultimo promemoria: /);
  const [r] = await q(`SELECT reminder_count FROM use_case_referent_requests WHERE id = $1::uuid`, [state.requestId]);
  assert.equal(Number(r.reminder_count), 2);
  const notes = await q(`SELECT recipient_user_id::text AS who, follow_up FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'senza_risposta'`, [ids.useCase]);
  assert.deepEqual(notes.map((n) => n.follow_up), notes.map(() => "ultimo_promemoria"));
  assert.ok(notes.length >= 3, "a ogni revisore");
  const alerts = await q(`SELECT i.follow_up FROM use_case_requester_email_items i WHERE i.request_id = $1::uuid`, [state.requestId]);
  assert.deepEqual(alerts.map((a) => a.follow_up), ["ultimo_promemoria"]);
  // Mai un terzo promemoria automatico.
  const third = fakeMailer();
  await q(`UPDATE use_case_referent_requests SET last_email_at = $2::timestamptz WHERE id = $1::uuid`, [state.requestId, workingDaysBefore(V, 3).toISOString()]);
  await referents.runReferentCron({ env: ENV, now: V, mailer: third });
  assert.equal(promemoria(third.outbox).length, 0);
  // «Raccolta informazioni»: senza risposta, l'esigenza resta «chiesta».
  assert.equal(await statusOf(state.needs[0]), "chiesta");
  const progress = await import("../../db/queries/use-case-info-progress.ts");
  const all = await progress.listInfoProgress(ids.ws, { userId: ids.builder, email: emails.builder, emailVerified: true, role: "function_lead", isLateralSpace: false }, { now: V });
  assert.equal(all?.[ids.useCase]?.state, "senza_risposta");
});

test("tre richieste alla stessa persona dovute lo stesso giorno: un'unica email con tre voci e tre link", opts, async () => {
  ok(await referents.revokeReferentRequest(as("builder"), ids.useCase, state.requestId, Number((await q(`SELECT version FROM use_case_referent_requests WHERE id = $1::uuid`, [state.requestId]))[0].version)));
  const requests: string[] = [];
  for (const card of cards) requests.push(await sendTo(card, (await needIds(card)).slice(0, 1), OTHER_REFERENT));
  const sent = workingDaysBefore(V, 3);
  for (const id of requests) await backdate(id, sent, sent);
  const mailer = fakeMailer();
  const counts = await referents.runReferentCron({ env: ENV, now: V, mailer });
  assert.equal(counts.errors, 0, JSON.stringify(counts));
  const mails = promemoria(mailer.outbox, OTHER_REFERENT);
  assert.equal(mails.length, 1, JSON.stringify(counts));
  assert.match(mails[0].subject, /^Promemoria: domande aperte su 3 use case di TopJet prova$/);
  assert.equal((mails[0].text.match(/\/rispondi\/ucq_/g) ?? []).length >= 3, true);
  const tokens = await q(`SELECT DISTINCT request_id FROM use_case_referent_tokens WHERE request_id = ANY($1::uuid[]) AND issued_for = 'promemoria'`, [requests]);
  assert.equal(tokens.length, 3);
  state.contactId = String((await q(`SELECT contact_id FROM use_case_referent_requests WHERE id = $1::uuid`, [requests[0]]))[0].contact_id);
  for (const id of requests) {
    const v = Number((await q(`SELECT version FROM use_case_referent_requests WHERE id = $1::uuid`, [id]))[0].version);
    const card = String((await q(`SELECT use_case_id FROM use_case_referent_requests WHERE id = $1::uuid`, [id]))[0].use_case_id);
    ok(await referents.revokeReferentRequest(as("builder"), card, id, v));
  }
});

test("scadenza: «scaduta», le esigenze restano «chiesta», il link non vale più, le bozze si cancellano, una notifica «scaduta»", opts, async () => {
  const card = cards[1];
  const need = (await needIds(card))[1];
  const requestId = await sendTo(card, [need]);
  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId, env: ENV, mailer, sendIntervalMs: 0 });
  const [tok] = await q(`SELECT count(*)::int AS n FROM use_case_referent_tokens WHERE request_id = $1::uuid`, [requestId]);
  assert.ok(Number(tok.n) >= 1);
  await q(`UPDATE use_case_referent_requests SET created_at = now() - interval '31 days', sent_at = now() - interval '31 days', expires_at = now() - interval '1 minute' WHERE id = $1::uuid`, [requestId]);
  const counts = await referents.runReferentCron({ env: ENV, now: V, mailer: fakeMailer() });
  assert.ok(counts.expired >= 1, JSON.stringify(counts));
  const [r] = await q(`SELECT status, expired_at FROM use_case_referent_requests WHERE id = $1::uuid`, [requestId]);
  assert.equal(r.status, "scaduta");
  assert.equal(await statusOf(need), "chiesta");
  const notes = await q(`SELECT follow_up FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'senza_risposta' AND recipient_user_id = $2::uuid`, [card, ids.analyst]);
  assert.deepEqual(notes.map((n) => n.follow_up), ["scaduta"]);
  const alerts = await q(`SELECT follow_up FROM use_case_requester_email_items WHERE request_id = $1::uuid`, [requestId]);
  assert.deepEqual(alerts.map((a) => a.follow_up), ["scaduta"]);
});

test("conservazione: 12 mesi dopo la fine le risposte si svuotano, se le esigenze non sono più da verificare", opts, async () => {
  const card = cards[2];
  const [n1, n2] = await needIds(card);
  const requestId = await sendTo(card, [n1, n2]);
  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId, env: ENV, mailer, sendIntervalMs: 0 });
  // Una risposta inviata e una richiesta finita 13 mesi fa; l'esigenza è stata verificata.
  await q(`UPDATE use_case_referent_request_items SET state = 'risposta', answered_at = now() WHERE request_id = $1::uuid`, [requestId]);
  await q(
    `INSERT INTO use_case_need_answers (workspace_id, use_case_id, need_id, request_id, source, body, status, submitted_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'referente', 'Excel', 'inviata', now())`,
    [ids.ws, card, n1, requestId],
  );
  await q(`UPDATE use_case_needs SET status = 'validata' WHERE id = ANY($1::uuid[])`, [[n1, n2]]);
  await q(
    `UPDATE use_case_referent_requests SET status = 'completata', created_at = now() - interval '400 days', sent_at = now() - interval '400 days', expires_at = now() - interval '370 days', completed_at = now() - interval '396 days' WHERE id = $1::uuid`,
    [requestId],
  );
  const counts = await referents.runReferentCron({ env: ENV, now: V, mailer: fakeMailer() });
  assert.ok(counts.purged >= 1, JSON.stringify(counts));
  const [a] = await q(`SELECT body, removed_reason FROM use_case_need_answers WHERE request_id = $1::uuid`, [requestId]);
  assert.deepEqual([a.body, a.removed_reason], [null, "conservazione"]);
  const [r] = await q(`SELECT purged_at, message FROM use_case_referent_requests WHERE id = $1::uuid`, [requestId]);
  assert.ok(r.purged_at);
  // I link si cancellano, con l'impronta dell'email del referente.
  assert.equal((await q(`SELECT 1 FROM use_case_referent_tokens WHERE request_id = $1::uuid`, [requestId])).length, 0);
});

test("senza l'autorizzazione ai fornitori il cron non mette niente in coda e il promemoria a mano si rifiuta", opts, async () => {
  // Un workspace dell'area senza autorizzazione (le autorizzazioni non si cancellano): una richiesta
  // scritta a mano, come se fosse partita tre giorni lavorativi fa.
  const ws = randomUUID();
  const card = randomUUID();
  const contact = randomUUID();
  const requestId = randomUUID();
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Senza autorizzazione')`, [ws, ids.org]);
  try {
    process.env.USE_CASE_HUB_WORKSPACES = `${ENV.USE_CASE_HUB_WORKSPACES},${ws}`;
    const env = { ...ENV, USE_CASE_HUB_WORKSPACES: process.env.USE_CASE_HUB_WORKSPACES };
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'function_lead')`, [ws, ids.builder]);
    await q(
      `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
       VALUES ($1::uuid, $2::uuid, 'Senza autorizzazione', 'Problema', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed')`,
      [card, ws, `RN-${String(1000 + Math.floor(Math.random() * 8000))}`],
    );
    ok(await referents.prepareReferentQuestions(as("builder", ws), card));
    const [need] = await needIds(card);
    await q(`UPDATE use_case_needs SET status = 'chiesta' WHERE id = $1::uuid`, [need]);
    await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email) VALUES ($1::uuid, $2::uuid, 'Paolo Neri', $3)`, [contact, ws, `paolo.neri.${suffix}@topjet.test`]);
    const sent = workingDaysBefore(V, 3);
    await q(
      `INSERT INTO use_case_referent_requests (id, workspace_id, use_case_id, contact_id, requested_by_user_id, requester_name, created_at, sent_at, last_email_at, expires_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'Persona builder', $6::timestamptz - interval '1 minute', $6::timestamptz, $6::timestamptz, $6::timestamptz + interval '30 days')`,
      [requestId, ws, card, contact, ids.builder, sent.toISOString()],
    );
    await q(`INSERT INTO use_case_referent_request_items (request_id, need_id, workspace_id, position, question) VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'Domanda di prova')`, [requestId, need, ws]);
    const mailer = fakeMailer();
    const counts = await referents.runReferentCron({ env, now: V, mailer });
    assert.equal(mailer.outbox.filter((m) => m.to.startsWith("paolo.neri")).length, 0, JSON.stringify(counts));
    assert.equal((await q(`SELECT 1 FROM use_case_referent_email_items WHERE request_id = $1::uuid`, [requestId])).length, 0);
    refused(await referents.remindReferentRequest(as("builder", ws), card, requestId, 1, { env, now: V }), "sub_responsabili_mancanti");
  } finally {
    process.env.USE_CASE_HUB_WORKSPACES = ENV.USE_CASE_HUB_WORKSPACES;
    await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ws]);
  }
});

// Gli aiuti di prova comuni alle suite di «Chiedi al referente»: questa non li usa tutti.
void (() => [pub, tokenOf, useCaseSnapshot]);
