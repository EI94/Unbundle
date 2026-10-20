import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { addCaseMember, commandContextFor, createCase, loadUserContext, removeCaseMember, type UcCommandContext } from "../db/queries/uc-cases.ts";
import { applyItemTransitions, requestClarification } from "../db/queries/uc-items.ts";
import { assignItems, copyRequestLink, createContact, createRequest, sendRequests } from "../db/queries/uc-requests.ts";
import { enqueueForLsMembersSql } from "../db/queries/uc-notifications.ts";
import { dispatchQueue, markBellRead, unreadBellSql, unreadForUser } from "../db/queries/uc-notifications-dispatch.ts";
import { runFreshnessCron, runRemindersCron } from "../db/queries/uc-cron.ts";
import { addCalendarDays, inRomeSendWindow, isWorkingDay, romeDate, romeLocalToUtc } from "./calendar.ts";
import { ROME_WORKING_CALENDAR, type MailResult, type OutgoingEmail, type UcMailer } from "./notify/dispatch.ts";
import { weeklySummaryDue } from "./notify/schedule.ts";
import { toStatement } from "./sql/statement.ts";
import { answerInsertSql } from "./sql/transitions.ts";
import { planTemplateLoad } from "./template/load.ts";

// Opt-in integration suite for WP11 (PIANO §5.7, §7.1) and WP10 (DESIGN §3.13.4): the
// uc_notifications queue, the email dispatch with a fake mailer, the uc-reminders and
// uc-freshness crons and the Lateral Space bell, on the isolated local harness only:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/notifications.integration.test.ts
// Never in parallel with database.integration.test.ts (it narrows a vocabulary CHECK on purpose).
// Every cron and dispatch call is scoped to this suite's workspace: the harness
// fixtures and other suites' rows are never touched.
const url = process.env.UC_TEST_DATABASE_URL;
const enabled = Boolean(url);
if (url) {
  const parsed = new URL(url);
  if (process.env.UC_TEST_ISOLATED !== "true" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("uc DB tests require an explicitly isolated loopback database (UC_TEST_ISOLATED=true)");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== url) {
    throw new Error("DATABASE_URL must be unset or equal to UC_TEST_DATABASE_URL for the uc DB tests");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs (NODE_OPTIONS=--require=…) to reach the local harness");
  }
}
const opts = { skip: !enabled };

const sql = url ? neon(url) : null;
const exec: UcExecutor | null = sql ? createUcExecutor(sql) : null;
const q = (text: string, params: unknown[] = []) => sql!.query(text, params) as Promise<Record<string, unknown>[]>;
const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0];
const num = (v: unknown) => Number(v);

const LS_DOMAINS = ["ls.test"];
const ORIGIN = "http://127.0.0.1:53110";
const EMAIL_ENV = { RESEND_API_KEY: "re_finto_di_prova", UC_EMAIL_FROM: "Lateral Space via Unbundle <casi@mittente.test>", NEXT_PUBLIC_APP_URL: ORIGIN };
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), lead: randomUUID(), analyst: randomUUID(), client: randomUUID() };
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");

/** Le 10:00 di Roma del primo giorno futuro che soddisfa la condizione (orologio vero, così le richieste restano vive). */
function nextRomeTen(pred: (t: Date) => boolean): Date {
  const today = romeDate(new Date());
  for (let i = 1; i <= 40; i++) {
    const t = romeLocalToUtc(addCalendarDays(today, i), 10);
    if (pred(t)) return t;
  }
  throw new Error("no suitable day");
}
/** Primo giorno lavorativo della settimana: c'è il riepilogo. */
const MONDAY = nextRomeTen((t) => weeklySummaryDue(t, ROME_WORKING_CALENDAR).due);
/** Un giorno lavorativo senza riepilogo. */
const WEEKDAY = nextRomeTen((t) => inRomeSendWindow(t) && !weeklySummaryDue(t, ROME_WORKING_CALENDAR).due);

/** Le 09:00 di Roma del giorno tale che fino a `instant` passano esattamente `n` giorni lavorativi. */
function workingDaysBefore(instant: Date, n: number): Date {
  let day = romeDate(instant);
  let counted = 0;
  while (counted < n) {
    if (isWorkingDay(day)) counted++;
    day = addCalendarDays(day, -1);
  }
  return romeLocalToUtc(day, 9);
}

const state = {
  caseId: "",
  code: `NOT-${suffix.toUpperCase()}`,
  costs: "",
  service: "",
  systems: "",
  owner: "",
  reqCosts: "",
  reqService: "",
  reqSystems: "",
};

async function ctxFor(userId: string): Promise<UcCommandContext> {
  const r = await commandContextFor(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId, lsDomains: LS_DOMAINS });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

interface Captured {
  email: OutgoingEmail;
  key: string;
}

function mailer(results: MailResult[] = []): UcMailer & { emails: Captured[] } {
  const emails: Captured[] = [];
  return {
    emails,
    async send(email, options) {
      emails.push({ email, key: options.idempotencyKey });
      return results.shift() ?? { ok: true };
    },
  };
}

function scoped(m: UcMailer, now: Date, env: Record<string, string> = EMAIL_ENV) {
  return { env, lsDomains: LS_DOMAINS, now, workspaceId: ids.ws, mailer: m, sendIntervalMs: 0 };
}

const tokenOf = (text: string) => /\/r\/(ucr_[A-Za-z0-9_-]{32})/.exec(text)?.[1] ?? null;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova notifiche', $2)`, [ids.org, `uc-not-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Cliente notifiche')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $4, now()), ($2::uuid, $5, now()), ($3::uuid, $6, now())`, [
    ids.lead,
    ids.analyst,
    ids.client,
    `not-lead-${suffix}@ls.test`,
    `not-analista-${suffix}@ls.test`,
    `not-cliente-${suffix}@cliente.test`,
  ]);
  await q(
    `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $4::uuid, 'transformation_lead'), ($2::uuid, $4::uuid, 'analyst'), ($3::uuid, $4::uuid, 'contributor')`,
    [ids.lead, ids.analyst, ids.client, ids.org],
  );
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.notifiche_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const lead = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, { workspaceId: ids.ws, user: lead!, canReviewWorkspacePortfolio: true, input: { templateId: loaded.value.templateId, code: state.code, title: "Caso delle notifiche" } });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  const leadCtx = await ctxFor(ids.lead);
  for (const [userId, role] of [
    [ids.analyst, "ls_analista"],
    [ids.client, "owner_cliente"],
  ] as const) {
    const r = await addCaseMember(exec!, leadCtx, { userId, role });
    assert.ok(r.ok, r.ok ? "" : r.message);
  }
  const contact = async (displayName: string, templateRoleKey: string | null, email: string | null) => {
    const r = await createContact(exec!, leadCtx, { displayName, roleLabel: displayName, ...(templateRoleKey ? { templateRoleKey } : {}), ...(email ? { email } : {}) });
    assert.ok(r.ok, r.ok ? "" : r.message);
    return r.value.contactId;
  };
  state.costs = await contact("Referente costi", "controllo_gestione", `not-costi-${suffix}@cliente.test`);
  state.service = await contact("Referente servizio", "resp_servizio", `not-servizio-${suffix}@cliente.test`);
  state.systems = await contact("Referente sistemi", "referente_sistemi", null);
  state.owner = await contact("Owner del cliente", null, `not-owner-${suffix}@cliente.test`);
  for (const [roleKey, contactId] of [
    ["controllo_gestione", state.costs],
    ["resp_servizio", state.service],
    ["referente_sistemi", state.systems],
  ]) {
    const r = await assignItems(exec!, leadCtx, { mode: "ruolo", roleKey, contactId });
    assert.ok(r.ok, r.ok ? "" : r.message);
  }
  const sent = await sendRequests(exec!, leadCtx, { contactIds: [state.costs, state.service] });
  assert.ok(sent.ok, sent.ok ? "" : sent.message);
  const byContact = new Map(sent.value.requests.map((r) => [r.contactId, r.requestId]));
  state.reqCosts = byContact.get(state.costs)!;
  state.reqService = byContact.get(state.service)!;
  assert.ok(state.reqCosts && state.reqService);
  const draft = await createRequest(exec!, leadCtx, { contactId: state.systems });
  assert.ok(draft.ok, draft.ok ? "" : draft.message);
  state.reqSystems = draft.value.requestId;
  const copied = await copyRequestLink(exec!, leadCtx, { requestId: state.reqSystems });
  assert.ok(copied.ok, copied.ok ? "" : copied.message);
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid)`, [ids.lead, ids.analyst, ids.client]);
});

test("without email configuration: the bell is delivered, emails stay queued with a clear reason and no token exists", opts, async () => {
  await exec!.batch([
    toStatement(
      enqueueForLsMembersSql({
        workspaceId: ids.ws,
        caseId: state.caseId,
        templateKey: "risposta_ricevuta",
        payload: { case_code: state.code, item_keys: ["q.costi.01"] },
        dedupeKeyPrefix: `risposte:${state.caseId}:${romeDate(new Date())}`,
      }),
    ),
  ]);
  const m = mailer();
  const summary = await dispatchQueue(exec!, scoped(m, WEEKDAY, {}));
  assert.equal(summary.bell, 2, "one bell row per Lateral Space member, none for the client");
  assert.equal(summary.notConfigured, 2);
  assert.equal(m.emails.length, 0);
  const rows = await q(`SELECT channel, status, hold_reason, recipient_user_id FROM uc_notifications WHERE workspace_id = $1::uuid ORDER BY channel`, [ids.ws]);
  assert.deepEqual(
    rows.filter((r) => r.channel === "email").map((r) => [r.status, r.hold_reason]),
    [
      ["in_coda", "email_non_configurata"],
      ["in_coda", "email_non_configurata"],
    ],
  );
  const bells = rows.filter((r) => r.channel === "in_app");
  assert.deepEqual(new Set(bells.map((r) => r.recipient_user_id)), new Set([ids.lead, ids.analyst]));
  assert.ok(bells.every((r) => r.status === "inviata"));
  const tokens = num((await one(`SELECT count(*) AS n FROM uc_request_tokens WHERE request_id = ANY($1::uuid[])`, [[state.reqCosts, state.reqService]])).n);
  assert.equal(tokens, 0, "no link exists until an email carries it");
});

test("with email: the link is issued at send time, stored only as a hash, and goes only into the email", opts, async () => {
  const m = mailer();
  const summary = await dispatchQueue(exec!, scoped(m, WEEKDAY));
  assert.equal(summary.sent, 2);
  assert.equal(m.emails.length, 2);
  for (const { email, key } of m.emails) {
    assert.equal(email.from, EMAIL_ENV.UC_EMAIL_FROM);
    assert.match(email.to, /^not-(costi|servizio)-[0-9a-f]{6}@cliente\.test$/);
    assert.match(key, /^richiesta:[0-9a-f-]{36}:0:\d{4}-\d{2}-\d{2}:a1$/);
    assert.ok(!/<img|src=|utm_/i.test(email.html), "no pixel, no tracking parameters");
    const token = tokenOf(email.text);
    assert.ok(token, "a referent link in the email");
    assert.ok(email.html.includes(`${ORIGIN}/r/${token}`));
    const row = await one(`SELECT request_id, issued_for, issued_by_user_id, revoked_at FROM uc_request_tokens WHERE token_hash = $1`, [sha(token!)]);
    assert.ok(row, "only the sha256 is stored");
    assert.deepEqual([row.issued_for, row.issued_by_user_id, row.revoked_at], ["invio", null, null]);
    for (const table of ["uc_events", "uc_notifications"]) {
      const leaked = num((await one(`SELECT count(*) AS n FROM ${table} WHERE payload::text LIKE '%' || $1 || '%'`, [token])).n);
      assert.equal(leaked, 0, `no clear token in ${table}`);
    }
  }
  const rows = await q(`SELECT status, attempts, hold_reason, sent_at IS NOT NULL AS sent FROM uc_notifications WHERE workspace_id = $1::uuid AND channel = 'email'`, [ids.ws]);
  assert.ok(rows.every((r) => r.status === "inviata" && num(r.attempts) === 1 && r.hold_reason === null && r.sent === true));
  const events = await q(`SELECT payload::text AS p, actor_type FROM uc_events WHERE case_id = $1::uuid AND event_type = 'notifica.inviata'`, [state.caseId]);
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.actor_type === "sistema" && !String(e.p).includes("@") && !String(e.p).includes("ucr_")));
  const again = await dispatchQueue(exec!, scoped(mailer(), WEEKDAY));
  assert.equal(again.sent, 0, "a sent row is never sent twice");
});

test("clarification: the referent of the answer gets a fresh link and the item title, never the answer", opts, async () => {
  const [row] = await q(
    `SELECT i.id, i.key, i.title, i.response_type FROM uc_request_items ri JOIN uc_items i ON i.id = ri.item_id
     WHERE ri.request_id = $1::uuid AND ri.state = 'da_fare' AND i.status = 'chiesta' AND i.privacy_class = 'nessuna' AND i.response_type IS NOT NULL ORDER BY i.key DESC LIMIT 1`,
    [state.reqCosts],
  );
  const itemId = String(row.id);
  const lead = await ctxFor(ids.lead);
  const referent = { ...lead, actor: { type: "referente" as const, contactId: state.costs, requestId: state.reqCosts, roleKey: "controllo_gestione" }, user: null };
  const answerId = randomUUID();
  const answered = await applyItemTransitions(exec!, referent, {
    itemIds: [itemId],
    transitions: [
      {
        itemId,
        to: "in_verifica",
        trigger: "risposta",
        answer: { kind: "valore", sourceKind: "referente" },
        actorRequestItem: { requestId: state.reqCosts, state: "da_fare" },
        extraSet: { currentAnswerId: answerId },
      },
    ],
    before: [
      answerInsertSql({
        id: answerId,
        workspaceId: ids.ws,
        caseId: state.caseId,
        itemId,
        kind: "valore",
        value: { value: "valore riservato 4242" },
        valueNormalized: null,
        validFrom: null,
        confidence: "certo",
        note: null,
        sourceKind: "referente",
        sourceRef: null,
        sourceBasis: "sistema",
        responderUserId: null,
        responderContactId: state.costs,
        requestId: state.reqCosts,
        textHash: null,
        responseType: String(row.response_type) as never,
        actor: { type: "referente", contactId: state.costs },
      }),
    ],
  });
  assert.ok(answered.ok, answered.ok ? "" : answered.message);
  const asked = await requestClarification(exec!, lead, { itemId, message: "Puoi indicare il periodo di riferimento?" });
  assert.ok(asked.ok, asked.ok ? "" : asked.message);
  const m = mailer();
  const summary = await dispatchQueue(exec!, scoped(m, WEEKDAY));
  assert.equal(summary.sent, 1);
  const email = m.emails[0].email;
  assert.equal(email.to, `not-costi-${suffix}@cliente.test`);
  assert.match(email.subject, /ti chiediamo un chiarimento$/);
  assert.ok(email.text.includes(String(row.title).slice(0, 40)), "the item title helps find the question");
  assert.ok(!email.text.includes("4242") && !email.text.includes("periodo di riferimento"), "neither the answer nor the comment text");
  const token = tokenOf(email.text)!;
  assert.equal((await one(`SELECT request_id, issued_for FROM uc_request_tokens WHERE token_hash = $1`, [sha(token)])).request_id, state.reqCosts);
});

test("reminders: the first after 3 working days, only with an email; a failed send revokes its link and retries", opts, async () => {
  await q(`UPDATE uc_requests SET sent_at = $2::timestamptz WHERE id = $1::uuid`, [state.reqCosts, workingDaysBefore(WEEKDAY, 3).toISOString()]);
  await q(`UPDATE uc_requests SET sent_at = $2::timestamptz WHERE id = $1::uuid`, [state.reqService, new Date(WEEKDAY.getTime() - 3_600_000).toISOString()]);
  await q(`UPDATE uc_requests SET sent_at = $2::timestamptz WHERE id = $1::uuid`, [state.reqSystems, workingDaysBefore(WEEKDAY, 3).toISOString()]);
  const planned = await runRemindersCron(exec!, { ...scoped(mailer(), WEEKDAY), dispatch: false });
  assert.equal(planned.inWindow, true);
  assert.equal(planned.weekly.due, false);
  assert.equal(planned.reminders, 1);
  assert.equal(planned.withoutEmail, 1, "the referent without email gets no email reminder");
  assert.equal(planned.errors, 0);
  const queued = await one(`SELECT template_key, status, payload, dedupe_key, recipient_contact_id FROM uc_notifications WHERE request_id = $1::uuid AND template_key = 'promemoria_1'`, [state.reqCosts]);
  assert.deepEqual([queued.status, queued.dedupe_key, queued.recipient_contact_id], ["in_coda", `promemoria_1:${state.reqCosts}`, state.costs]);
  assert.deepEqual(queued.payload, { reminder: 1, case_code: state.code });

  const failing = mailer([{ ok: false, code: "validation_error", ambiguous: false }]);
  const failed = await dispatchQueue(exec!, scoped(failing, WEEKDAY));
  assert.equal(failed.failed, 1);
  const afterFail = await one(`SELECT status, attempts, error FROM uc_notifications WHERE dedupe_key = $1`, [`promemoria_1:${state.reqCosts}`]);
  assert.deepEqual([afterFail.status, num(afterFail.attempts), afterFail.error], ["errore", 1, "validation_error"]);
  const failedToken = tokenOf(failing.emails[0].email.text)!;
  assert.ok((await one(`SELECT revoked_at FROM uc_request_tokens WHERE token_hash = $1`, [sha(failedToken)])).revoked_at, "the link of an email that did not leave is revoked");
  assert.equal(num((await one(`SELECT reminder_count FROM uc_requests WHERE id = $1::uuid`, [state.reqCosts])).reminder_count), 0);
  assert.equal(num((await one(`SELECT count(*) AS n FROM uc_events WHERE case_id = $1::uuid AND event_type = 'notifica.errore'`, [state.caseId])).n), 1);

  await q(`UPDATE uc_notifications SET scheduled_at = now() WHERE dedupe_key = $1`, [`promemoria_1:${state.reqCosts}`]);
  const ok = mailer();
  assert.equal((await dispatchQueue(exec!, scoped(ok, WEEKDAY))).sent, 1);
  assert.equal(ok.emails[0].key, `promemoria_1:${state.reqCosts}:a2`, "a retry has its own idempotency key");
  assert.match(ok.emails[0].email.subject, /^Promemoria · /);
  const req = await one(`SELECT reminder_count, last_reminder_at IS NOT NULL AS reminded, next_reminder_at FROM uc_requests WHERE id = $1::uuid`, [state.reqCosts]);
  assert.deepEqual([num(req.reminder_count), req.reminded], [1, true]);
  assert.ok(req.next_reminder_at, "the next reminder is scheduled");
  assert.equal((await one(`SELECT issued_for FROM uc_request_tokens WHERE token_hash = $1`, [sha(tokenOf(ok.emails[0].email.text)!)])).issued_for, "promemoria");
  assert.equal(num((await one(`SELECT count(*) AS n FROM uc_events WHERE target_id = $1::uuid AND event_type = 'richiesta.promemoria'`, [state.reqCosts])).n), 1);
  const replanned = await runRemindersCron(exec!, { ...scoped(mailer(), WEEKDAY), dispatch: false });
  assert.equal(replanned.reminders, 0, "no second reminder before 7 working days");
});

test("reminders: the second after 7 working days, then the Owner after 10, never a third to the referent", opts, async () => {
  await q(`UPDATE uc_requests SET sent_at = $2::timestamptz WHERE id = $1::uuid`, [state.reqCosts, workingDaysBefore(WEEKDAY, 7).toISOString()]);
  const second = mailer();
  const run2 = await runRemindersCron(exec!, scoped(second, WEEKDAY));
  assert.equal(run2.reminders, 1);
  assert.equal(second.emails.length, 1);
  assert.match(second.emails[0].email.subject, /^Ultimo promemoria · /);
  assert.equal(num((await one(`SELECT reminder_count FROM uc_requests WHERE id = $1::uuid`, [state.reqCosts])).reminder_count), 2);

  // 10 working days and no Owner on the case: the Lateral Space bell says so.
  await q(`UPDATE uc_requests SET sent_at = $2::timestamptz WHERE id = $1::uuid`, [state.reqCosts, workingDaysBefore(WEEKDAY, 10).toISOString()]);
  const noOwner = await runRemindersCron(exec!, scoped(mailer(), WEEKDAY));
  assert.deepEqual([noOwner.escalations, noOwner.ownerToDesignate, noOwner.reminders], [0, 1, 0]);
  const bells = await q(`SELECT recipient_user_id, status FROM uc_notifications WHERE template_key = 'owner_da_indicare' AND request_id = $1::uuid`, [state.reqCosts]);
  assert.deepEqual(new Set(bells.map((b) => b.recipient_user_id)), new Set([ids.lead, ids.analyst]));
  assert.equal((await one(`SELECT escalated_at FROM uc_requests WHERE id = $1::uuid`, [state.reqCosts])).escalated_at, null, "still waiting for an Owner");

  await q(`UPDATE uc_cases SET client_owner_contact_id = $2::uuid WHERE id = $1::uuid`, [state.caseId, state.owner]);
  const ownerMail = mailer();
  const escalated = await runRemindersCron(exec!, scoped(ownerMail, WEEKDAY));
  assert.equal(escalated.escalations, 1);
  assert.equal(ownerMail.emails.length, 1);
  const email = ownerMail.emails[0].email;
  assert.equal(email.to, `not-owner-${suffix}@cliente.test`);
  assert.ok(email.text.includes("q.costi."), "the Owner sees which questions are waiting (keys and titles)");
  assert.equal(tokenOf(email.text), null, "never the referent's link");
  assert.ok((await one(`SELECT escalated_at FROM uc_requests WHERE id = $1::uuid`, [state.reqCosts])).escalated_at);
  const quiet = await runRemindersCron(exec!, scoped(mailer(), WEEKDAY));
  assert.deepEqual([quiet.reminders, quiet.escalations, quiet.ownerToDesignate], [0, 0, 0], "no third reminder, no second escalation");
});

test("rule 7a: an asked item past its due date after 2 reminders becomes missing, by the system", opts, async () => {
  const [row] = await q(
    `SELECT ri.item_id FROM uc_request_items ri JOIN uc_items i ON i.id = ri.item_id WHERE ri.request_id = $1::uuid AND ri.state = 'da_fare' AND i.status = 'chiesta' ORDER BY i.key LIMIT 1`,
    [state.reqCosts],
  );
  const itemId = String(row.item_id);
  await q(`UPDATE uc_items SET due_at = now() - interval '1 day' WHERE id = $1::uuid`, [itemId]);
  const run = await runRemindersCron(exec!, { ...scoped(mailer(), WEEKDAY), dispatch: false });
  assert.equal(run.missingAfterReminders, 1);
  const item = await one(`SELECT status, status_reason FROM uc_items WHERE id = $1::uuid`, [itemId]);
  assert.deepEqual([item.status, item.status_reason], ["mancante", "Scaduta dopo 2 promemoria"]);
  const ev = await one(`SELECT actor_type, actor_user_id, from_state, to_state FROM uc_events WHERE target_id = $1::uuid AND event_type = 'voce.stato_cambiato' ORDER BY created_at DESC LIMIT 1`, [itemId]);
  assert.deepEqual([ev.actor_type, ev.actor_user_id, ev.from_state, ev.to_state], ["sistema", null, "chiesta", "mancante"]);
});

test("rule 7d: an expired link closes the request, its asked items become missing and its queue is cancelled", opts, async () => {
  const asked = (await q(`SELECT ri.item_id FROM uc_request_items ri JOIN uc_items i ON i.id = ri.item_id WHERE ri.request_id = $1::uuid AND ri.state = 'da_fare' AND i.status = 'chiesta'`, [state.reqService])).map((r) => String(r.item_id));
  assert.ok(asked.length > 0);
  await q(
    `INSERT INTO uc_notifications (workspace_id, case_id, request_id, recipient_contact_id, channel, template_key, payload, dedupe_key) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'email', 'promemoria_1', '{}'::jsonb, $5)`,
    [ids.ws, state.caseId, state.reqService, state.service, `promemoria_1:${state.reqService}`],
  );
  await q(`UPDATE uc_requests SET expires_at = now() - interval '1 hour' WHERE id = $1::uuid`, [state.reqService]);
  const run = await runRemindersCron(exec!, { ...scoped(mailer(), WEEKDAY), dispatch: false });
  assert.equal(run.expiredRequests, 1);
  assert.equal(run.missingAfterExpiry, asked.length);
  assert.equal((await one(`SELECT status FROM uc_requests WHERE id = $1::uuid`, [state.reqService])).status, "scaduta");
  const items = await q(`SELECT status, status_reason FROM uc_items WHERE id = ANY($1::uuid[])`, [asked]);
  assert.ok(items.every((i) => i.status === "mancante" && i.status_reason === "Link scaduto senza risposta"));
  assert.equal(num((await one(`SELECT count(*) AS n FROM uc_request_items WHERE request_id = $1::uuid AND state IN ('da_fare', 'bozza')`, [state.reqService])).n), 0, "the items can be asked again");
  assert.equal((await one(`SELECT status FROM uc_notifications WHERE dedupe_key = $1`, [`promemoria_1:${state.reqService}`])).status, "annullata");
  const ev = await one(`SELECT actor_type, from_state, to_state, payload FROM uc_events WHERE target_id = $1::uuid AND event_type = 'richiesta.scaduta'`, [state.reqService]);
  assert.deepEqual([ev.actor_type, ev.to_state, ev.payload], ["sistema", "scaduta", { items: asked.length }]);
  const again = await runRemindersCron(exec!, { ...scoped(mailer(), WEEKDAY), dispatch: false });
  assert.equal(again.expiredRequests, 0);
  const readiness = await one(`SELECT readiness -> 'per_stato' ->> 'mancante' AS n FROM uc_cases WHERE id = $1::uuid`, [state.caseId]);
  const missing = await one(`SELECT count(*) AS n FROM uc_items WHERE case_id = $1::uuid AND status = 'mancante' AND request_module_key IS NOT NULL AND deleted_at IS NULL`, [state.caseId]);
  assert.ok(num(missing.n) > 0);
  assert.equal(num(readiness.n), num(missing.n), "the header counts are refreshed after the cron");
});

test("weekly summary: on the first working day, to the Owner (bar and missing items) and to Lateral Space (email and bell), once", opts, async () => {
  const m = mailer();
  const run = await runRemindersCron(exec!, scoped(m, MONDAY));
  assert.equal(run.weekly.due, true);
  assert.deepEqual([run.weekly.emails, run.weekly.bells], [3, 2]);
  const byTo = new Map(m.emails.map((e) => [e.email.to, e.email]));
  const owner = byTo.get(`not-owner-${suffix}@cliente.test`);
  assert.ok(owner, "the Owner summary");
  assert.match(owner!.subject, /^Riepilogo settimanale · Cliente notifiche/);
  assert.ok(owner!.text.includes(state.code) && owner!.text.includes("Voci mancanti:"));
  assert.ok(!owner!.text.includes("/dashboard/"), "no internal links for the client");
  const ls = byTo.get(`not-lead-${suffix}@ls.test`);
  assert.ok(ls && ls.text.includes(`${ORIGIN}/dashboard/${ids.ws}/casi-duso/${state.caseId}`));
  assert.ok(!ls!.text.includes("Voci mancanti:"));
  assert.ok(byTo.has(`not-analista-${suffix}@ls.test`));
  assert.ok(![...byTo.keys()].some((to) => to.startsWith("not-cliente-")), "no summary to client accounts");
  const bells = await q(`SELECT status FROM uc_notifications WHERE workspace_id = $1::uuid AND template_key = 'riepilogo_settimanale' AND channel = 'in_app'`, [ids.ws]);
  assert.equal(bells.length, 2);
  const twice = await runRemindersCron(exec!, scoped(mailer(), MONDAY));
  assert.equal(twice.dispatch?.sent, 0, "the same week is never sent twice");
});

test("freshness: an expired validated value goes back to verification and rings the Lateral Space bell", opts, async () => {
  const [row] = await q(`SELECT id FROM uc_items WHERE case_id = $1::uuid AND status = 'da_chiedere' AND request_module_key IS NULL AND deleted_at IS NULL ORDER BY key LIMIT 1`, [state.caseId]);
  const itemId = String(row.id);
  const answerId = randomUUID();
  await q(`INSERT INTO uc_answers (id, case_id, item_id, version, kind, value, source_kind, responder_user_id) VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 'valore', '{"value": 1}'::jsonb, 'documento', $4::uuid)`, [
    answerId,
    state.caseId,
    itemId,
    ids.lead,
  ]);
  await q(
    `UPDATE uc_items SET status = 'validata', current_answer_id = $2::uuid, validated_answer_id = $2::uuid, validated_by_user_id = $3::uuid, stale_at = now() - interval '1 day' WHERE id = $1::uuid`,
    [itemId, answerId, ids.analyst],
  );
  const run = await runFreshnessCron(exec!, scoped(mailer(), new Date()));
  assert.equal(run.expiredData, 1);
  assert.ok(run.readinessRefreshed >= 1);
  assert.equal(run.quarantine, null, "global clean-ups do not run for a single workspace");
  assert.equal(run.errors, 0);
  const item = await one(`SELECT status, status_reason FROM uc_items WHERE id = $1::uuid`, [itemId]);
  assert.deepEqual([item.status, item.status_reason], ["in_verifica", "dato scaduto"]);
  const bells = await q(`SELECT recipient_user_id, status, payload FROM uc_notifications WHERE template_key = 'dato_scaduto' AND case_id = $1::uuid`, [state.caseId]);
  assert.deepEqual(new Set(bells.map((b) => b.recipient_user_id)), new Set([ids.lead, ids.analyst]));
  assert.ok(bells.every((b) => b.status === "inviata" && (b.payload as { item_id?: string }).item_id === itemId));
  assert.equal((await runFreshnessCron(exec!, scoped(mailer(), new Date()))).expiredData, 0);
});

test("bell: only for Lateral Space members of the case, marked read only by its recipient", opts, async () => {
  const env = { UC_ENABLED: "true", UC_LS_EMAIL_DOMAINS: "ls.test", UC_WORKSPACE_IDS: ids.ws };
  const lead = await unreadForUser(ids.lead, { workspaceId: ids.ws, executor: exec!, env });
  const kinds = new Set(lead.map((n) => n.templateKey));
  for (const k of ["risposta_ricevuta", "owner_da_indicare", "riepilogo_settimanale", "dato_scaduto"]) assert.ok(kinds.has(k), k);
  // New routes: inside the dossier, the weekly summary to the Roadmap of the Use case page.
  for (const n of lead) {
    if (n.caseId) assert.ok(n.href?.startsWith(`/dashboard/${ids.ws}/casi-duso/${state.caseId}`), n.href ?? "");
    else assert.equal(n.href, `/dashboard/${ids.ws}/use-cases?vista=roadmap`);
  }
  assert.equal(lead.find((n) => n.templateKey === "dato_scaduto")?.href?.includes("/domande/"), true);
  // First line from the dossier read now (no parent use case here), never in the description.
  for (const n of lead) {
    assert.equal(n.context, n.caseId ? `${state.code} · Caso delle notifiche` : null);
    assert.ok(!`${n.title} ${n.description}`.includes(state.code), "the description does not repeat the code");
    assert.ok(!`${n.context} ${n.title} ${n.description}`.includes("@"));
    assert.doesNotMatch(`${n.title} ${n.description} ${n.when}`, /Casi d'uso|caso d'uso|\d{4}-\d{2}-\d{2}|\d{4}-W\d{2}/);
  }
  // The answers of today from the referents, counted now.
  const [{ n: answersToday }] = await q(
    `SELECT count(DISTINCT item_id)::int AS n FROM uc_answers WHERE case_id = $1::uuid AND responder_contact_id IS NOT NULL
       AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'Europe/Rome')`,
    [state.caseId],
  );
  const answered = num(answersToday);
  const answersRow = lead.find((n) => n.templateKey === "risposta_ricevuta");
  assert.equal(answersRow?.title, answered === 1 ? "1 nuova risposta da verificare" : answered > 1 ? `${answered} nuove risposte da verificare` : "Nuove risposte da verificare");
  assert.deepEqual(await unreadForUser(ids.client, { workspaceId: ids.ws, executor: exec!, env }), [], "a client account never sees the bell");
  assert.deepEqual(await unreadForUser(ids.lead, { workspaceId: ids.ws, executor: exec!, env: {} }), [], "section off");
  assert.deepEqual(await unreadForUser(ids.lead, { workspaceId: ids.ws, executor: exec!, env: { ...env, UC_WORKSPACE_IDS: randomUUID() } }), [], "workspace outside the list");
  assert.deepEqual(await unreadForUser(ids.lead, { executor: exec!, env: { ...env, UC_WORKSPACE_IDS: randomUUID() } }), [], "no workspace given: only switched-on workspaces");
  assert.equal((await unreadForUser(ids.lead, { executor: exec!, env })).length, lead.length, "no workspace given, this one on");

  const analystItems = await unreadForUser(ids.analyst, { workspaceId: ids.ws, executor: exec!, env });
  assert.equal(await markBellRead(exec!, { userId: ids.lead, workspaceId: ids.ws, notificationId: analystItems[0].id }), 0, "nobody marks someone else's notification");
  assert.equal(await markBellRead(exec!, { userId: ids.lead, workspaceId: ids.ws, notificationId: lead[0].id }), 1);
  const afterOne = await unreadForUser(ids.lead, { workspaceId: ids.ws, executor: exec!, env });
  assert.equal(afterOne.length, lead.length - 1);
  assert.equal(await markBellRead(exec!, { userId: ids.lead, workspaceId: ids.ws }), lead.length - 1);
  assert.deepEqual(await unreadForUser(ids.lead, { workspaceId: ids.ws, executor: exec!, env }), []);
  assert.equal((await unreadForUser(ids.analyst, { workspaceId: ids.ws, executor: exec!, env })).length, analystItems.length, "the colleague's bell is untouched");

  const leadCtx = await ctxFor(ids.lead);
  const removed = await removeCaseMember(exec!, leadCtx, { userId: ids.analyst, role: "ls_analista" });
  assert.ok(removed.ok, removed.ok ? "" : removed.message);
  const left = await unreadForUser(ids.analyst, { workspaceId: ids.ws, executor: exec!, env });
  assert.ok(left.every((n) => n.caseId === null), "case notifications disappear for someone no longer on the case");
});

test("bell: answers of the same dossier and day are one row, marked read together; a parent use case gives the first line", opts, async () => {
  const env = { UC_ENABLED: "true", UC_LS_EMAIL_DOMAINS: "ls.test", UC_WORKSPACE_IDS: ids.ws };
  const day = romeDate(new Date());
  await exec!.batch(
    ["risposte-a", "risposte-b"].map((prefix) =>
      toStatement(
        enqueueForLsMembersSql({
          workspaceId: ids.ws,
          caseId: state.caseId,
          templateKey: "risposta_ricevuta",
          payload: { case_code: state.code, item_keys: ["q.costi.02"] },
          dedupeKeyPrefix: `${prefix}:${state.caseId}:${day}`,
        }),
      ),
    ),
  );
  // A parent use case: its title (and its code, where the column exists) is the first line.
  const useCaseId = randomUUID();
  await q(`INSERT INTO use_cases (id, workspace_id, title, status, portfolio_kind) VALUES ($1::uuid, $2::uuid, 'Smistamento delle richieste', 'accepted', 'use_case_ai')`, [useCaseId, ids.ws]);
  await q(`UPDATE uc_cases SET portfolio_use_case_id = $1::uuid WHERE id = $2::uuid`, [useCaseId, state.caseId]);
  try {
    const [{ code: parentCode }] = await q(`SELECT to_jsonb(u) ->> 'code' AS code FROM use_cases u WHERE id = $1::uuid`, [useCaseId]);
    const items = await unreadForUser(ids.lead, { workspaceId: ids.ws, executor: exec!, env });
    const answers = items.filter((n) => n.templateKey === "risposta_ricevuta");
    assert.equal(answers.length, 1, "one row for the day");
    assert.equal(answers[0].ids.length, 2);
    assert.equal(answers[0].context, `${(parentCode as string | null) ?? state.code} · Smistamento delle richieste`);
    assert.match(answers[0].title, /^(\d+ nuov[ae] rispost[ae]|Nuove risposte) da verificare$/);
    assert.equal(answers[0].when, "adesso");
    assert.equal(await markBellRead(exec!, { userId: ids.lead, workspaceId: ids.ws, notificationId: answers[0].id }), 2, "the whole row");
    assert.equal((await unreadForUser(ids.lead, { workspaceId: ids.ws, executor: exec!, env })).filter((n) => n.templateKey === "risposta_ricevuta").length, 0);
  } finally {
    await q(`UPDATE uc_cases SET portfolio_use_case_id = NULL WHERE id = $1::uuid`, [state.caseId]);
    await q(`DELETE FROM use_cases WHERE id = $1::uuid`, [useCaseId]);
  }
});

test("bell: the answers of a Rome day of 25 or 23 hours are counted on that day, whatever the session time zone", opts, async () => {
  // 26 Oct 2025 (end of summer time) runs from 22:00Z on the 25th to 23:00Z on the 26th;
  // 29 Mar 2026 (start of summer time) from 23:00Z on the 28th to 22:00Z on the 29th.
  const days = [
    { day: "2025-10-26", noon: "2025-10-26T11:00:00Z", answers: ["2025-10-25T22:30:00Z", "2025-10-26T22:30:00Z", "2025-10-26T23:30:00Z"], expected: 2 },
    { day: "2026-03-29", noon: "2026-03-29T10:00:00Z", answers: ["2026-03-29T21:30:00Z", "2026-03-29T22:30:00Z"], expected: 1 },
  ];
  const free = await q(
    `SELECT i.id FROM uc_items i WHERE i.case_id = $1::uuid AND i.deleted_at IS NULL AND i.privacy_class NOT IN ('personale', 'personale_equipaggio', 'escluso_sanitario')
       AND NOT EXISTS (SELECT 1 FROM uc_answers a WHERE a.item_id = i.id) ORDER BY i.key LIMIT 5`,
    [state.caseId],
  );
  assert.equal(free.length, 5);
  let next = 0;
  for (const d of days) {
    for (const at of d.answers) {
      await q(
        `INSERT INTO uc_answers (case_id, item_id, version, kind, value, source_kind, responder_contact_id, created_at)
         VALUES ($1::uuid, $2::uuid, 1, 'valore', '{"value": 1}'::jsonb, 'referente', $3::uuid, $4::timestamptz)`,
        [state.caseId, free[next++].id, state.costs, at],
      );
    }
    await exec!.batch([
      toStatement(
        enqueueForLsMembersSql({ workspaceId: ids.ws, caseId: state.caseId, templateKey: "risposta_ricevuta", payload: { case_code: state.code }, dedupeKeyPrefix: `risposte-ora:${state.caseId}:${d.day}` }),
      ),
    ]);
    await q(
      `UPDATE uc_notifications SET created_at = $2::timestamptz, scheduled_at = $2::timestamptz, status = 'inviata'
       WHERE case_id = $1::uuid AND channel = 'in_app' AND dedupe_key LIKE $3`,
      [state.caseId, d.noon, `risposte-ora:%:${d.day}:%`],
    );
  }
  const counted = async (timeZone: string) => {
    const [, rows] = await exec!.batch([
      { text: "SELECT set_config('TimeZone', $1, true)", params: [timeZone] },
      unreadBellSql({ userId: ids.lead, workspaceId: ids.ws, limit: 50 }),
    ]);
    const byDay = new Map(rows.filter((r) => r.template_key === "risposta_ricevuta").map((r) => [new Date(String(r.created_at)).toISOString(), num(r.answers)]));
    return days.map((d) => byDay.get(new Date(d.noon).toISOString()));
  };
  const expected = days.map((d) => d.expected);
  assert.deepEqual(await counted("UTC"), expected, "Neon sessions run in UTC");
  assert.deepEqual(await counted("Europe/Rome"), expected);
  await markBellRead(exec!, { userId: ids.lead, workspaceId: ids.ws });
});
