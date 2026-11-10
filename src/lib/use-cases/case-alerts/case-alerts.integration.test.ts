import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// (0025) La coda delle email di «Pronto da avviare» sul database di prova, dalla scrittura all'invio
// con un mailer finto (nessuna email parte): un'email al giorno per persona con tutti gli use case
// diventati pronti, in attesa senza l'ok sui sub-responsabili o senza RESEND_API_KEY, senza gli use
// case non più pronti o con la riga già aperta, tre tentativi, annullata se troppo vecchia.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1); la 0025 la porta il vero ensureDbSchema(). Dati sintetici, creati e cancellati qui.
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

type Mail = import("../../uc/notify/dispatch.ts").OutgoingEmail;
type MailResult = import("../../uc/notify/dispatch.ts").MailResult;
let needs: typeof import("../needs-service.ts");
let alerts: typeof import("../../db/queries/use-case-alerts.ts");
let calendar: typeof import("../../uc/calendar.ts");
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), lsLead: randomUUID(), lsAnalyst: randomUUID(), client: randomUUID() };
type Person = "lsLead" | "lsAnalyst" | "client";
const PEOPLE: Record<Person, { email: string; role: string }> = {
  lsLead: { email: `lead.coda.${suffix}@ls.test`, role: "transformation_lead" },
  lsAnalyst: { email: `analista.coda.${suffix}@ls.test`, role: "analyst" },
  client: { email: `responsabile.coda.${suffix}@cliente.test`, role: "function_lead" },
};
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
/** L'ambiente dell'invio: una chiave finta, mai letta da Resend (il mailer è sempre quello finto). */
const SEND_ENV: Record<string, string | undefined> = {
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <avvisi@notifiche.example.test>",
  UC_EMAIL_REPLY_TO: "persona@example.test",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  UC_LS_EMAIL_DOMAINS: "ls.test",
};

let quarter = "";
let codeSeq = 3000 + Math.floor(Math.random() * 6000);

const as = (person: Person) => ({ workspaceId: ids.ws, actor: { userId: ids[person], role: PEOPLE[person].role, isLateralSpace: person !== "client", kind: "persona" as const }, channel: "pagina" as const });

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }): T {
  if (!result.ok) assert.fail(`atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}

/** Uno use case approvato con un'informazione aperta, che diventa pronto quando `client` la chiude. */
async function becomeReady(title: string): Promise<string> {
  const cardId = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, target_quarter)
     VALUES ($1::uuid, $2::uuid, $3, 'Problema', 'accepted', 'scored', 'use_case_ai', $4, 'web_proposed', $5)`,
    [cardId, ids.ws, title, `CO-${codeSeq++}`, quarter],
  );
  const needId = randomUUID();
  await q(`INSERT INTO use_case_needs (id, workspace_id, type, kind, title, owner_side, status) VALUES ($1::uuid, $2::uuid, 'requisito', 'dato', 'Volumi', 'cliente', 'parziale')`, [needId, ids.ws]);
  await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [needId, cardId]);
  const [n] = await q(`SELECT version FROM use_case_needs WHERE id = $1::uuid`, [needId]);
  ok(await needs.updateNeed(as("client"), needId, Number(n.version), { status: "validata" }));
  return cardId;
}

async function queue(person: Person) {
  return q(
    `SELECT e.id, e.status, e.hold_reason, e.cancel_reason, e.attempts, e.scheduled_at, e.send_on::text AS send_on,
       (SELECT count(*)::int FROM use_case_alert_email_items i WHERE i.email_id = e.id) AS items
     FROM use_case_alert_emails e WHERE e.workspace_id = $1::uuid AND e.recipient_user_id = $2::uuid AND e.kind = 'pronto' ORDER BY e.created_at, e.id`,
    [ids.ws, ids[person]],
  );
}

/** Un istante nella finestra di Roma dopo tutte le email in coda del workspace. */
async function windowAfterQueue(): Promise<Date> {
  const [row] = await q(`SELECT max(scheduled_at) AS at FROM use_case_alert_emails WHERE workspace_id = $1::uuid`, [ids.ws]);
  let at = new Date(new Date(String(row.at)).getTime() + 60_000);
  if (!calendar.inRomeSendWindow(at)) at = new Date(calendar.nextRomeSendWindowStart(at).getTime() + 60_000);
  return at;
}

function fakeMailer(results: MailResult[] = []) {
  const outbox: Array<{ mail: Mail; key: string }> = [];
  return {
    outbox,
    async send(mail: Mail, options: { idempotencyKey: string }) {
      outbox.push({ mail, key: options.idempotencyKey });
      return results.shift() ?? ({ ok: true } as const);
    },
  };
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  SEND_ENV.USE_CASE_HUB_WORKSPACES = ids.ws;
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
  delete process.env.USE_CASE_REFERENTS;
  const ensure = await import("../../db/ensure-schema.ts");
  await ensure.ensureDbSchema();
  needs = await import("../needs-service.ts");
  alerts = await import("../../db/queries/use-case-alerts.ts");
  calendar = await import("../../uc/calendar.ts");
  const ddl = await import("../../db/use-case-hub-alerts-ddl.ts");
  quarter = String((await q(`SELECT ${ddl.ROME_QUARTER_NOW_SQL} AS q`))[0].q);
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione coda', $2)`, [ids.org, `hub-coda-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Rondine')`, [ids.ws, ids.org]);
  for (const person of Object.keys(PEOPLE) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], PEOPLE[person].email, `Persona ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], PEOPLE[person].role]);
  }
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(PEOPLE).map((p) => ids[p as Person])]);
});

const cards = { a: "", b: "" };

test("due use case pronti lo stesso giorno: un'email per persona di Lateral Space, con tutti e due; nessuna al cliente", opts, async () => {
  cards.a = await becomeReady("Fatture fornitori");
  cards.b = await becomeReady("Ordini clienti");
  for (const person of ["lsLead", "lsAnalyst"] as const) {
    const rows = await queue(person);
    assert.equal(rows.length, 1, person);
    assert.deepEqual([rows[0].status, rows[0].items], ["in_coda", 2]);
  }
  assert.equal((await queue("client")).length, 0);
});

test("senza RESEND_API_KEY restano in coda (email_non_configurata); senza l'ok sui sub-responsabili in attesa", opts, async () => {
  const at = await windowAfterQueue();
  const mailer = fakeMailer();
  const none = await alerts.dispatchCaseAlerts({ env: { ...SEND_ENV, RESEND_API_KEY: undefined }, now: at, mailer, sendIntervalMs: 0 });
  assert.ok(none.notConfigured >= 2);
  assert.equal((await queue("lsLead"))[0].hold_reason, "email_non_configurata");
  const held = await alerts.dispatchCaseAlerts({ env: SEND_ENV, now: at, mailer, sendIntervalMs: 0 });
  assert.ok(held.held >= 2, JSON.stringify(held));
  assert.equal(mailer.outbox.filter((m) => m.mail.to.endsWith("@ls.test") && m.mail.to.includes(suffix)).length, 0);
  const lead = (await queue("lsLead"))[0];
  assert.deepEqual([lead.status, lead.hold_reason], ["in_coda", "sub_responsabili_mancanti"]);
});

test("con l'ok: parte, dal mittente delle notifiche con il reply-to; senza gli use case già aperti nella campanella", opts, async () => {
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.client],
  );
  // L'analista ha già aperto la riga del primo: la sua email parla solo del secondo.
  await q(`UPDATE use_case_notifications SET read_at = now() WHERE use_case_id = $1::uuid AND recipient_user_id = $2::uuid AND kind = 'pronto'`, [cards.a, ids.lsAnalyst]);
  const mailer = fakeMailer();
  const sent = await alerts.dispatchCaseAlerts({ env: SEND_ENV, now: await windowAfterQueue(), mailer, sendIntervalMs: 0 });
  assert.ok(sent.sent >= 2, JSON.stringify(sent));
  const byTo = new Map(mailer.outbox.filter((m) => m.mail.to.includes(suffix)).map((m) => [m.mail.to, m]));
  assert.equal(byTo.size, 2);
  const lead = byTo.get(PEOPLE.lsLead.email);
  const analyst = byTo.get(PEOPLE.lsAnalyst.email);
  assert.ok(lead && analyst);
  assert.equal(lead.mail.subject, "Rondine: 2 casi d'uso pronti da avviare");
  assert.match(analyst.mail.subject, /^Rondine: il caso d'uso «CO-\d+ · Ordini clienti» è pronto da avviare$/);
  for (const m of [lead, analyst]) {
    assert.equal(m.mail.from, SEND_ENV.UC_EMAIL_FROM);
    assert.equal(m.mail.replyTo, "persona@example.test");
    assert.match(m.key, /^ca:[0-9a-f-]{36}:a1$/);
    assert.ok(m.mail.text.includes(`/dashboard/${ids.ws}/use-cases/`) && m.mail.text.includes("?capitolo=realizzazione"));
    // (Rilascio 5.1) Fuori dalla dashboard «caso d'uso», mai «use case» (gli indirizzi a parte).
    assert.doesNotMatch(m.mail.text.replace(/https?:\/\/\S+/g, ""), /\buse[\s-]*cases?\b/i);
    assert.match(m.mail.text, /cas[oi] d'uso/);
  }
  assert.ok(!byTo.has(PEOPLE.client.email), "mai al cliente");
  assert.equal((await queue("lsLead"))[0].status, "inviata");
  // Un secondo giro non manda niente.
  const again = fakeMailer();
  await alerts.dispatchCaseAlerts({ env: SEND_ENV, now: await windowAfterQueue(), mailer: again, sendIntervalMs: 0 });
  assert.equal(again.outbox.filter((m) => m.mail.to.includes(suffix)).length, 0);
});

test("tre tentativi al massimo, poi basta; una riga troppo vecchia si annulla", opts, async () => {
  // Come un altro giorno: l'email già partita della prova di prima non c'è più.
  await q(`DELETE FROM use_case_alert_emails WHERE workspace_id = $1::uuid`, [ids.ws]);
  const c = await becomeReady("Note spese");
  const failing = (): MailResult => ({ ok: false, code: "application_error", ambiguous: true });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const mailer = fakeMailer([failing(), failing()]);
    await alerts.dispatchCaseAlerts({ env: SEND_ENV, now: await windowAfterQueue(), mailer, sendIntervalMs: 0 });
    const lead = (await queue("lsLead")).find((r) => r.status !== "inviata");
    assert.ok(lead);
    assert.deepEqual([lead.status, lead.attempts], ["errore", attempt]);
  }
  const fourth = fakeMailer();
  await alerts.dispatchCaseAlerts({ env: SEND_ENV, now: await windowAfterQueue(), mailer: fourth, sendIntervalMs: 0 });
  assert.equal(fourth.outbox.filter((m) => m.mail.to.includes(suffix)).length, 0, "dopo tre tentativi non si riprova");
  // Una riga nuova, poi vecchia di due settimane: troppo_vecchia.
  await q(`DELETE FROM use_case_alert_emails WHERE workspace_id = $1::uuid`, [ids.ws]);
  await q(`UPDATE use_case_needs n SET status = 'parziale' FROM use_case_need_links l WHERE l.need_id = n.id AND l.use_case_id = $1::uuid`, [c]);
  await alerts.syncReadyCards({ env: process.env, now: new Date() });
  await q(`UPDATE use_case_needs n SET status = 'validata' FROM use_case_need_links l WHERE l.need_id = n.id AND l.use_case_id = $1::uuid`, [c]);
  await q(`UPDATE use_case_notifications SET read_at = NULL WHERE use_case_id = $1::uuid`, [c]);
  await alerts.syncReadyCards({ env: process.env, now: new Date() });
  assert.equal((await queue("lsLead")).length, 1);
  const at = await windowAfterQueue();
  await q(`UPDATE use_case_alert_emails SET due_at = now() - interval '14 days', scheduled_at = now() - interval '14 days' WHERE workspace_id = $1::uuid`, [ids.ws]);
  const stale = fakeMailer();
  await alerts.dispatchCaseAlerts({ env: SEND_ENV, now: at, mailer: stale, sendIntervalMs: 0 });
  assert.equal(stale.outbox.filter((m) => m.mail.to.includes(suffix)).length, 0);
  assert.deepEqual((await queue("lsLead")).map((r) => [r.status, r.cancel_reason]), [["annullata", "troppo_vecchia"]]);
});
