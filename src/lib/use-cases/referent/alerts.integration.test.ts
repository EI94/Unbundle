import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { romeLocalToUtc } from "../../uc/calendar.ts";

// L'avviso per email a chi ha chiesto sul database di prova (SPEC §P2.7): una riga per persona e
// giorno di Roma, le voci che si sommano, le risposte che partono subito e i documenti che aspettano
// l'email del giorno dopo, la finestra 9-18, la scelta «Avvisami per email», le righe vecchie.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). Gli istanti sono fissi (passati come `now`), mai l'orologio di sistema; mailer finto.
// - Dati sintetici, creati e cancellati qui.
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


let notifications: typeof import("../../db/queries/use-case-notifications.ts");
let alerts: typeof import("./alerts.ts");
const T = (day: string, hour: number, minute = 0) => romeLocalToUtc(day, hour, minute);
const requests: string[] = [];
const contact = randomUUID();

async function exec(...statements: import("../../uc/sql/statement.ts").UcStatement[]) {
  const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
  return (await getAppUcExecutor()).batch(statements);
}
async function queue(requestId: string, at: Date, c: { answers?: number; unknowns?: number; documents?: number; followUp?: "ultimo_promemoria" | "scaduta" | null; immediate: boolean; actor?: string | null }) {
  await exec(
    notifications.queueRequesterAlertSql({
      workspaceId: ids.ws,
      target: { requestId },
      answers: c.answers ?? 0,
      unknowns: c.unknowns ?? 0,
      documents: c.documents ?? 0,
      followUp: c.followUp ?? null,
      actorUserId: c.actor ?? null,
      immediate: c.immediate,
      schedule: alerts.alertSchedule(at),
      now: at,
    }),
  );
}
async function rowsOf(user: string = ids.builder) {
  return q(
    `SELECT e.id::text AS id, e.send_on::text AS day, e.status, e.cancel_reason, i.request_id::text AS request, i.answers, i.unknowns, i.documents, i.follow_up
     FROM use_case_requester_emails e LEFT JOIN use_case_requester_email_items i ON i.email_id = e.id
     WHERE e.workspace_id = $1::uuid AND e.recipient_user_id = $2::uuid ORDER BY e.send_on, i.request_id`,
    [ids.ws, user],
  );
}
async function reset() {
  await q(`DELETE FROM use_case_requester_emails WHERE workspace_id = $1::uuid`, [ids.ws]);
}
const sendAt = (now: Date, mailer = fakeMailer()) => notifications.dispatchRequesterAlerts({ env: ENV, now, mailer, sendIntervalMs: 0 }).then((s) => ({ s, mailer }));

test("preparazione: due richieste di chi ha chiesto, autorizzazione ai fornitori", opts, async () => {
  notifications = await import("../../db/queries/use-case-notifications.ts");
  alerts = await import("./alerts.ts");
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
  );
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email) VALUES ($1::uuid, $2::uuid, 'Mario Rossi', $3)`, [contact, ids.ws, REFERENT_EMAIL]);
  const second = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
     VALUES ($1::uuid, $2::uuid, 'Ordini clienti', 'Problema', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed')`,
    [second, ids.ws, `RM-${String(1000 + Math.floor(Math.random() * 8000))}`],
  );
  for (const card of [ids.useCase, second]) {
    const [r] = await q(
      `INSERT INTO use_case_referent_requests (workspace_id, use_case_id, contact_id, requested_by_user_id, requester_name, created_at, expires_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Persona builder', now(), now() + interval '30 days') RETURNING id::text AS id`,
      [ids.ws, card, contact, ids.builder],
    );
    requests.push(String(r.id));
  }
});

test("risposte, poi documenti, poi il seguito sulla stessa richiesta lo stesso giorno: una riga, una voce sommata", opts, async () => {
  await reset();
  const at = T("2026-11-03", 10);
  await queue(requests[0], at, { answers: 2, immediate: true });
  await queue(requests[0], new Date(at.getTime() + 60_000), { documents: 1, immediate: false });
  await queue(requests[0], new Date(at.getTime() + 120_000), { followUp: "ultimo_promemoria", immediate: false });
  const rows = await rowsOf();
  assert.deepEqual(rows.map((r) => [r.day, r.answers, r.documents, r.follow_up]), [["2026-11-03", 2, 1, "ultimo_promemoria"]]);
  // Due richieste della stessa persona: una riga, due voci.
  await queue(requests[1], new Date(at.getTime() + 180_000), { answers: 1, immediate: true });
  const two = await rowsOf();
  assert.equal(new Set(two.map((r) => r.id)).size, 1);
  assert.equal(two.length, 2);
  // L'email parte, con le due schede, senza nomi o testi del referente.
  const { s, mailer } = await sendAt(new Date(at.getTime() + 240_000));
  assert.equal(s.sent, 1, JSON.stringify(s));
  assert.equal(mailer.outbox[0].to, emails.builder);
  assert.match(mailer.outbox[0].subject, /^Novità su 2 use case di TopJet prova$/);
  assert.ok(!mailer.outbox[0].text.includes("Mario Rossi") && !mailer.outbox[0].text.includes(REFERENT_EMAIL));
  assert.match(mailer.outbox[0].text, /\?capitolo=cosa-serve/);
});

test("dopo l'email del giorno: una risposta va al giorno lavorativo dopo; fuori orario alla prossima apertura; venerdì → lunedì", opts, async () => {
  // La riga del 3/11 è partita (test di prima).
  await queue(requests[0], T("2026-11-03", 15), { answers: 1, immediate: true });
  const rows = (await rowsOf()).filter((r) => r.status === "in_coda");
  assert.deepEqual(rows.map((r) => r.day), ["2026-11-04"]);
  await reset();
  await queue(requests[0], T("2026-11-03", 20), { answers: 1, immediate: true });
  assert.deepEqual((await rowsOf()).map((r) => r.day), ["2026-11-04"]);
  await reset();
  await queue(requests[0], T("2026-11-06", 17, 30), { answers: 1, immediate: true });
  await sendAt(T("2026-11-06", 17, 31));
  await queue(requests[0], T("2026-11-06", 17, 40), { answers: 1, immediate: true });
  assert.deepEqual((await rowsOf()).filter((r) => r.status === "in_coda").map((r) => r.day), ["2026-11-09"]);
});

test("cinque documenti caricati dal team in due minuti: niente adesso, un'email con «5 documenti nuovi» il giorno dopo", opts, async () => {
  await reset();
  const at = T("2026-11-04", 11);
  for (let i = 0; i < 5; i++) await queue(requests[0], new Date(at.getTime() + i * 20_000), { documents: 1, immediate: false });
  const rows = await rowsOf();
  assert.deepEqual(rows.map((r) => [r.day, r.documents]), [["2026-11-05", 5]]);
  const now = await sendAt(new Date(at.getTime() + 120_000));
  assert.equal(now.s.sent, 0, "non oggi");
  const next = await sendAt(T("2026-11-05", 10));
  assert.equal(next.s.sent, 1);
  assert.match(next.mailer.outbox[0].text, /ci sono 5 documenti nuovi/);
  // Un documento mentre la riga di oggi aspetta ancora (non presa): si unisce.
  await reset();
  await queue(requests[0], T("2026-11-05", 8), { followUp: "ultimo_promemoria", immediate: false });
  assert.deepEqual((await rowsOf()).map((r) => r.day), ["2026-11-05"], "fuori orario: la prossima apertura, oggi");
  await queue(requests[0], T("2026-11-05", 9, 30), { documents: 1, immediate: false });
  assert.deepEqual((await rowsOf()).map((r) => [r.day, r.documents, r.follow_up]), [["2026-11-05", 1, "ultimo_promemoria"]]);
});

test("chi ha chiesto: mai a chi ha agito; con la scelta spenta niente coda e le righe in attesa si annullano; un revisore che non lo è più, annullata", opts, async () => {
  await reset();
  await queue(requests[0], T("2026-11-04", 11), { answers: 1, immediate: true, actor: ids.builder });
  assert.equal((await rowsOf()).length, 0, "chi ha agito non riceve");
  await queue(requests[0], T("2026-11-04", 11), { answers: 1, immediate: true });
  await q(`INSERT INTO workspace_bell_state (workspace_id, user_id, referent_emails) VALUES ($1::uuid, $2::uuid, false)`, [ids.ws, ids.builder]);
  await queue(requests[0], T("2026-11-04", 11, 5), { answers: 1, immediate: true });
  assert.equal(Number((await rowsOf())[0].answers), 1, "niente in più con la scelta spenta");
  const off = await sendAt(T("2026-11-04", 11, 10));
  assert.equal(off.s.cancelled, 1);
  assert.equal((await rowsOf())[0].cancel_reason, "avvisi_spenti");
  await q(`UPDATE workspace_bell_state SET referent_emails = true WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.ws, ids.builder]);
  await reset();
  await queue(requests[0], T("2026-11-04", 12), { answers: 1, immediate: true });
  await q(`UPDATE workspace_memberships SET role = 'contributor' WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.ws, ids.builder]);
  try {
    const demoted = await sendAt(T("2026-11-04", 12, 5));
    assert.equal(demoted.s.cancelled, 1);
    assert.equal((await rowsOf())[0].cancel_reason, "destinatario_non_valido");
  } finally {
    await q(`UPDATE workspace_memberships SET role = 'function_lead' WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.ws, ids.builder]);
  }
});

test("senza email configurata le righe aspettano; più di 2 giorni lavorativi dopo `due_at` si annullano", opts, async () => {
  await reset();
  await queue(requests[0], T("2026-11-04", 12), { answers: 1, immediate: true });
  const held = await notifications.dispatchRequesterAlerts({ env: { ...ENV, RESEND_API_KEY: "" }, now: T("2026-11-04", 12, 1), mailer: fakeMailer() });
  assert.equal(held.notConfigured, 1);
  // Dei tentativi spostano `scheduled_at`, mai `due_at`.
  await q(`UPDATE use_case_requester_emails SET scheduled_at = $2::timestamptz WHERE workspace_id = $1::uuid`, [ids.ws, T("2026-11-09", 10).toISOString()]);
  const late = await sendAt(T("2026-11-09", 10, 30));
  assert.equal(late.s.cancelled, 1, JSON.stringify(late.s));
  assert.equal((await rowsOf())[0].cancel_reason, "troppo_vecchia");
});

test("ultimo promemoria, poi il referente risponde lo stesso giorno: l'email del giorno dopo non dice «restano domande senza risposta»", opts, async () => {
  await reset();
  // Una domanda aperta sulla richiesta: esigenza «chiesta» e voce «aperta».
  const need = randomUUID();
  await q(`INSERT INTO use_case_needs (id, workspace_id, type, title, status, owner_side) VALUES ($1::uuid, $2::uuid, 'requisito', 'Quante fatture al mese?', 'chiesta', 'cliente')`, [need, ids.ws]);
  await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [need, ids.useCase]);
  await q(
    `INSERT INTO use_case_referent_request_items (request_id, need_id, workspace_id, position, question) VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'Quante fatture al mese?')`,
    [requests[0], need, ids.ws],
  );
  // L'ultimo promemoria alle 10: l'avviso «Nessuna risposta» va al giorno lavorativo dopo.
  await queue(requests[0], T("2026-11-04", 10), { followUp: "ultimo_promemoria", immediate: false });
  assert.deepEqual((await rowsOf()).map((r) => [r.day, r.follow_up]), [["2026-11-05", "ultimo_promemoria"]]);
  // Ancora aperta: il giorno dopo l'email lo dice.
  const still = await sendAt(T("2026-11-05", 10));
  assert.equal(still.s.sent, 1, JSON.stringify(still.s));
  assert.match(still.mailer.outbox[0].text, /restano domande senza risposta/);

  await reset();
  await queue(requests[0], T("2026-11-04", 10), { followUp: "ultimo_promemoria", immediate: false });
  // Alle 10:30 il referente risponde a tutto: la richiesta è completata.
  await q(`UPDATE use_case_referent_request_items SET state = 'risposta', answered_at = now() WHERE request_id = $1::uuid`, [requests[0]]);
  await q(`UPDATE use_case_needs SET status = 'in_verifica' WHERE id = $1::uuid`, [need]);
  await q(`UPDATE use_case_referent_requests SET status = 'completata', completed_at = now() WHERE id = $1::uuid`, [requests[0]]);
  // Solo il seguito, ormai falso: la riga si annulla, nessuna email.
  const next = await sendAt(T("2026-11-05", 10));
  assert.equal(next.s.sent, 0, JSON.stringify(next.s));
  assert.equal((await rowsOf())[0].cancel_reason, "nessuna_voce");

  // Con una risposta nella stessa riga: l'email parte, senza la frase del seguito.
  await reset();
  await queue(requests[0], T("2026-11-04", 10), { followUp: "ultimo_promemoria", immediate: false });
  await queue(requests[0], T("2026-11-04", 10, 30), { answers: 1, immediate: false });
  const mixed = await sendAt(T("2026-11-05", 10));
  assert.equal(mixed.s.sent, 1, JSON.stringify(mixed.s));
  assert.match(mixed.mailer.outbox[0].text, /è arrivata 1 risposta/);
  assert.doesNotMatch(mixed.mailer.outbox[0].text, /senza risposta/);
  await q(`UPDATE use_case_referent_requests SET status = 'inviata', completed_at = NULL WHERE id = $1::uuid`, [requests[0]]);
});

// Gli aiuti di prova comuni alle suite di «Chiedi al referente»: questa non li usa tutti.
void (() => [referents, pub, dispatch, as, requester, ok, refused, tokenOf, needIds, statusOf, useCaseSnapshot, state]);
