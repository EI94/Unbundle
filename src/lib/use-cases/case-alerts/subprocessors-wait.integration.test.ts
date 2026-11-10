import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// (0025) «Autorizza i fornitori» sul database di prova: con l'interruttore spento (il valore di
// partenza) niente a nessuno; acceso per il workspace, solo chi può dare l'«ok sui sub-responsabili»
// (Sponsor esecutivo, Responsabile della trasformazione, Responsabile di funzione, email verificata
// fuori da Lateral Space) riceve la riga e l'email, quando una persona di Lateral Space approva o
// pianifica uno use case con informazioni da chiedere, prepara le domande o prova a chiedere; al
// massimo una volta ogni 7 giorni per workspace, anche con due azioni insieme; mai aprendo una
// pagina; mai più dopo l'ok (righe nascoste, email annullate, il cron non scrive).
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1); la 0025 la porta il vero ensureDbSchema(). L'ok è solo aggiunta (uc_subprocessor_acks):
//   ogni scenario ha il suo workspace. Dati sintetici, creati e cancellati qui. Nessuna email parte.
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
type Mail = import("../../uc/notify/dispatch.ts").OutgoingEmail;
let service: typeof import("../service.ts");
let referents: typeof import("../../db/queries/use-case-referents.ts");
let alerts: typeof import("../../db/queries/use-case-alerts.ts");
let data: typeof import("../../notifications/bell-data.ts");
let calendar: typeof import("../../uc/calendar.ts");
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const org = randomUUID();
type Person = "ls" | "lsAnalyst" | "exec" | "transformation" | "lead" | "analyst" | "contributor" | "unverified" | "lsExec";
const PEOPLE: Record<Person, { email: string; role: string; verified: boolean; ls: boolean }> = {
  ls: { email: `ls.fornitori.${suffix}@ls.test`, role: "transformation_lead", verified: true, ls: true },
  lsAnalyst: { email: `lsanalista.fornitori.${suffix}@ls.test`, role: "analyst", verified: true, ls: true },
  exec: { email: `sponsor.fornitori.${suffix}@cliente.test`, role: "exec_sponsor", verified: true, ls: false },
  transformation: { email: `trasformazione.fornitori.${suffix}@cliente.test`, role: "transformation_lead", verified: true, ls: false },
  lead: { email: `funzione.fornitori.${suffix}@cliente.test`, role: "function_lead", verified: true, ls: false },
  analyst: { email: `analista.fornitori.${suffix}@cliente.test`, role: "analyst", verified: true, ls: false },
  contributor: { email: `contributore.fornitori.${suffix}@cliente.test`, role: "contributor", verified: true, ls: false },
  unverified: { email: `nonverificato.fornitori.${suffix}@cliente.test`, role: "function_lead", verified: false, ls: false },
  lsExec: { email: `lssponsor.fornitori.${suffix}@ls.test`, role: "exec_sponsor", verified: true, ls: true },
};
const userIds = Object.fromEntries((Object.keys(PEOPLE) as Person[]).map((p) => [p, randomUUID()])) as Record<Person, string>;
const DECLARERS: Person[] = ["exec", "transformation", "lead"];
const workspaces: string[] = [];
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS", "USE_CASE_CLIENT_NOTICES"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const SEND_ENV: Record<string, string | undefined> = {
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <avvisi@notifiche.example.test>",
  UC_EMAIL_REPLY_TO: "persona@example.test",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  UC_LS_EMAIL_DOMAINS: "ls.test",
};

let quarter = "";
let codeSeq = 5000 + Math.floor(Math.random() * 4000);

function as(ws: string, person: Person): Ctx {
  return { workspaceId: ws, actor: { userId: userIds[person], role: PEOPLE[person].role, isLateralSpace: PEOPLE[person].ls, kind: "persona" }, channel: "pagina" };
}
function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}

/** Un workspace nuovo con tutte le persone; con `notices` l'interruttore lo accende. */
async function workspace(o: { notices: boolean }): Promise<string> {
  const ws = randomUUID();
  workspaces.push(ws);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Rondine')`, [ws, org]);
  for (const person of Object.keys(PEOPLE) as Person[]) {
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ws, userIds[person], PEOPLE[person].role]);
  }
  process.env.USE_CASE_HUB_WORKSPACES = workspaces.join(",");
  SEND_ENV.USE_CASE_HUB_WORKSPACES = process.env.USE_CASE_HUB_WORKSPACES;
  if (o.notices) process.env.USE_CASE_CLIENT_NOTICES = [process.env.USE_CASE_CLIENT_NOTICES, ws].filter(Boolean).join(",");
  SEND_ENV.USE_CASE_CLIENT_NOTICES = process.env.USE_CASE_CLIENT_NOTICES;
  return ws;
}

/** Uno use case da approvare (o già approvato) con un'informazione del cliente da chiedere. */
async function card(ws: string, o: { status?: string; quarter?: string | null; needStatus?: string | null } = {}): Promise<string> {
  const id = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source, target_quarter)
     VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'Problema', $3::use_case_status, 'scored', 'use_case_ai', $4, 'web_proposed', $5)`,
    [id, ws, o.status ?? "proposed", `FO-${codeSeq++}`, o.quarter === undefined ? null : o.quarter],
  );
  if (o.needStatus !== null) {
    const needId = randomUUID();
    await q(`INSERT INTO use_case_needs (id, workspace_id, type, kind, title, owner_side, status) VALUES ($1::uuid, $2::uuid, 'requisito', 'dato', 'Volumi', 'cliente', $3)`, [needId, ws, o.needStatus ?? "da_chiedere"]);
    await q(`INSERT INTO use_case_need_links (need_id, use_case_id) VALUES ($1::uuid, $2::uuid)`, [needId, id]);
  }
  return id;
}

const version = async (id: string) => Number((await q(`SELECT version FROM use_cases WHERE id = $1::uuid`, [id]))[0].version);
async function recipients(ws: string): Promise<string[]> {
  return (await q(`SELECT recipient_user_id::text AS who FROM use_case_notifications WHERE workspace_id = $1::uuid AND kind = 'fornitori'`, [ws])).map((r) => String(r.who)).sort();
}
async function mails(ws: string) {
  return q(`SELECT recipient_user_id::text AS who, status, cancel_reason FROM use_case_alert_emails WHERE workspace_id = $1::uuid AND kind = 'fornitori'`, [ws]);
}
const people = (...list: Person[]) => list.map((p) => userIds[p]).sort();
const approve = async (ws: string, id: string, person: Person = "ls") =>
  service.decideUseCase(as(ws, person), id, await version(id), { type: "approva", quando: "questo_trimestre" });
async function ack(ws: string) {
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ws, userIds.lead],
  );
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
  delete process.env.USE_CASE_REFERENTS;
  delete process.env.USE_CASE_CLIENT_NOTICES;
  const ensure = await import("../../db/ensure-schema.ts");
  await ensure.ensureDbSchema();
  service = await import("../service.ts");
  referents = await import("../../db/queries/use-case-referents.ts");
  alerts = await import("../../db/queries/use-case-alerts.ts");
  data = await import("../../notifications/bell-data.ts");
  calendar = await import("../../uc/calendar.ts");
  const ddl = await import("../../db/use-case-hub-alerts-ddl.ts");
  quarter = String((await q(`SELECT ${ddl.ROME_QUARTER_NOW_SQL} AS q`))[0].q);
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione fornitori', $2)`, [org, `hub-fornitori-${org}`]);
  for (const person of Object.keys(PEOPLE) as Person[]) {
    const p = PEOPLE[person];
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, CASE WHEN $4 THEN now() END)`, [userIds[person], p.email, `Persona ${person}`, p.verified]);
  }
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await q(`DELETE FROM uc_rate_limits WHERE bucket LIKE 'ucq:%'`);
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [workspaces]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(userIds)]);
});

test("interruttore spento (il valore di partenza): niente a nessuno, né dalle azioni né dal cron", opts, async () => {
  const ws = await workspace({ notices: false });
  const id = await card(ws);
  ok(await approve(ws, id));
  ok(await referents.prepareReferentQuestions(as(ws, "ls"), id));
  await alerts.syncSubprocessorsNotices({ env: process.env, now: new Date() });
  assert.deepEqual(await recipients(ws), []);
  assert.equal((await mails(ws)).length, 0);
});

test("acceso: solo chi può dare l'ok, quando Lateral Space approva uno use case con informazioni da chiedere", opts, async () => {
  const ws = await workspace({ notices: true });
  const id = await card(ws);
  ok(await approve(ws, id));
  assert.deepEqual(await recipients(ws), people(...DECLARERS), "mai Lateral Space, un analista, un contributore, un'email non verificata o di Lateral Space");
  assert.deepEqual((await mails(ws)).map((m) => String(m.who)).sort(), people(...DECLARERS));
  // La campanella: la riga porta a Impostazioni › Sub-responsabili.
  const lead = await data.loadBellPayload({ workspaceId: ws, userId: userIds.lead, role: "function_lead", useCaseHub: true });
  const row = lead.entries.find((e) => e.title === "Autorizza i fornitori");
  assert.ok(row);
  assert.equal(row.href, `/dashboard/${ws}/settings#sub-responsabili`);
  const contributor = await data.loadBellPayload({ workspaceId: ws, userId: userIds.contributor, role: "contributor", useCaseHub: true });
  assert.equal(contributor.entries.length, 0);
  // Una seconda approvazione nei 7 giorni: niente di nuovo.
  const other = await card(ws);
  ok(await approve(ws, other));
  assert.equal((await recipients(ws)).length, DECLARERS.length);
});

test("un revisore del cliente che approva, o uno use case che non aspetta l'ok: niente", opts, async () => {
  const ws = await workspace({ notices: true });
  ok(await approve(ws, await card(ws), "lead"));
  const later = await card(ws);
  ok(await service.decideUseCase(as(ws, "ls"), later, await version(later), { type: "approva", quando: "piu_avanti" }), "«Più avanti»");
  ok(await approve(ws, await card(ws, { needStatus: "validata" })));
  ok(await approve(ws, await card(ws, { needStatus: null })));
  assert.deepEqual(await recipients(ws), []);
});

test("«Prepara le domande» e «Chiedi al referente» bloccato dall'ok; aprire il pannello non scrive", opts, async () => {
  const ws = await workspace({ notices: true });
  const id = await card(ws, { status: "accepted", quarter, needStatus: null });
  await referents.loadUseCaseReferentPanel({
    workspaceId: ws,
    useCaseId: id,
    viewer: { userId: userIds.ls, email: PEOPLE.ls.email, emailVerified: true, role: "transformation_lead", isLateralSpace: true },
    session: { id: userIds.ls, name: "Persona ls", email: PEOPLE.ls.email, emailVerified: true },
    role: "transformation_lead",
    needs: { requirements: [], steps: [] },
    env: process.env,
  } as unknown as Parameters<typeof referents.loadUseCaseReferentPanel>[0]);
  assert.deepEqual(await recipients(ws), [], "una lettura non scrive");
  ok(await referents.prepareReferentQuestions(as(ws, "ls"), id));
  assert.deepEqual(await recipients(ws), people(...DECLARERS));
  // Un secondo workspace: «Chiedi al referente» rifiutato per l'ok mancante avvisa, e il rifiuto resta quello.
  const ws2 = await workspace({ notices: true });
  const id2 = await card(ws2, { status: "accepted", quarter });
  const [n] = await q(`SELECT n.id FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid`, [id2]);
  const refused = await referents.sendReferentRequest(
    as(ws2, "ls"),
    id2,
    { contact: { kind: "nuovo", displayName: "Mario Rossi", email: `mario.${suffix}@rondine.test` }, needIds: [String(n.id)] },
    { env: { ...process.env, ...SEND_ENV }, requester: { name: "Persona ls", emailVerified: true } },
  );
  assert.equal(refused.ok, false);
  assert.equal((refused as { error: string }).error, "sub_responsabili_mancanti");
  assert.deepEqual(await recipients(ws2), people(...DECLARERS));
});

test("«Prepara le domande» e «Chiedi al referente» rifiutato di un revisore del cliente: niente", opts, async () => {
  const ws = await workspace({ notices: true });
  const id = await card(ws, { status: "accepted", quarter, needStatus: null });
  ok(await referents.prepareReferentQuestions(as(ws, "lead"), id));
  const [prepared] = await q(`SELECT count(*)::int AS n FROM use_case_need_links WHERE use_case_id = $1::uuid`, [id]);
  assert.ok(Number(prepared.n) > 0, "le domande ci sono: il silenzio non è un'azione mancata");
  assert.deepEqual(await recipients(ws), [], "lo avvia solo Lateral Space");
  const ws2 = await workspace({ notices: true });
  const id2 = await card(ws2, { status: "accepted", quarter });
  const [n] = await q(`SELECT n.id FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid`, [id2]);
  const refused = await referents.sendReferentRequest(
    as(ws2, "transformation"),
    id2,
    { contact: { kind: "nuovo", displayName: "Mario Rossi", email: `mario.cliente.${suffix}@rondine.test` }, needIds: [String(n.id)] },
    { env: { ...process.env, ...SEND_ENV }, requester: { name: "Persona transformation", emailVerified: true } },
  );
  assert.equal(refused.ok, false);
  assert.equal((refused as { error: string }).error, "sub_responsabili_mancanti");
  assert.deepEqual(await recipients(ws2), [], "lo avvia solo Lateral Space");
});

test("al massimo una volta ogni 7 giorni per workspace, anche con due approvazioni insieme; il cron ripete dopo", opts, async () => {
  const ws = await workspace({ notices: true });
  const [a, b] = [await card(ws), await card(ws)];
  const [va, vb] = [await version(a), await version(b)];
  const both = await Promise.all([
    service.decideUseCase(as(ws, "ls"), a, va, { type: "approva", quando: "questo_trimestre" }),
    service.decideUseCase(as(ws, "lsAnalyst"), b, vb, { type: "approva", quando: "prossimo_trimestre" }),
  ]);
  for (const r of both) assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(await recipients(ws), people(...DECLARERS), "una riga per persona");
  // Il cron nei 7 giorni: niente; 8 giorni dopo (orologio di prova): di nuovo.
  await alerts.syncSubprocessorsNotices({ env: process.env, now: new Date() });
  assert.equal((await recipients(ws)).length, DECLARERS.length);
  const later = new Date(Date.now() + 8 * 86_400_000);
  await alerts.syncSubprocessorsNotices({ env: process.env, now: later, clock: later });
  assert.equal((await recipients(ws)).length, DECLARERS.length * 2);
});

test("dopo l'ok: righe nascoste, email annullate, il cron non scrive più", opts, async () => {
  const ws = await workspace({ notices: true });
  ok(await approve(ws, await card(ws)));
  assert.equal((await mails(ws)).length, DECLARERS.length);
  await ack(ws);
  const lead = await data.loadBellPayload({ workspaceId: ws, userId: userIds.lead, role: "function_lead", useCaseHub: true });
  assert.equal(lead.entries.some((e) => e.title === "Autorizza i fornitori"), false);
  const [row] = await q(`SELECT max(scheduled_at) AS at FROM use_case_alert_emails WHERE workspace_id = $1::uuid`, [ws]);
  let at = new Date(new Date(String(row.at)).getTime() + 60_000);
  if (!calendar.inRomeSendWindow(at)) at = new Date(calendar.nextRomeSendWindowStart(at).getTime() + 60_000);
  const outbox: Mail[] = [];
  await alerts.dispatchCaseAlerts({ env: SEND_ENV, now: at, mailer: { async send(m: Mail) { outbox.push(m); return { ok: true as const }; } }, sendIntervalMs: 0 });
  assert.equal(outbox.filter((m) => m.text.includes(`/dashboard/${ws}/`)).length, 0, "niente per questo workspace");
  assert.deepEqual([...new Set((await mails(ws)).map((m) => `${m.status}:${m.cancel_reason}`))], ["annullata:autorizzazione_data"]);
  const later = new Date(Date.now() + 8 * 86_400_000);
  await alerts.syncSubprocessorsNotices({ env: process.env, now: later, clock: later });
  assert.equal((await recipients(ws)).length, DECLARERS.length);
});

test("l'email a chi può dare l'ok: il link a Impostazioni, nessun dato dello use case", opts, async () => {
  const ws = await workspace({ notices: true });
  ok(await approve(ws, await card(ws)));
  const [row] = await q(`SELECT max(scheduled_at) AS at FROM use_case_alert_emails WHERE workspace_id = $1::uuid`, [ws]);
  let at = new Date(new Date(String(row.at)).getTime() + 60_000);
  if (!calendar.inRomeSendWindow(at)) at = new Date(calendar.nextRomeSendWindowStart(at).getTime() + 60_000);
  const outbox: Mail[] = [];
  await alerts.dispatchCaseAlerts({ env: SEND_ENV, now: at, mailer: { async send(m: Mail) { outbox.push(m); return { ok: true as const }; } }, sendIntervalMs: 0 });
  const mine = outbox.filter((m) => m.text.includes(`/dashboard/${ws}/`));
  assert.deepEqual(mine.map((m) => m.to).sort(), DECLARERS.map((p) => PEOPLE[p].email).sort());
  for (const m of mine) {
    assert.equal(m.subject, "Rondine: serve il tuo ok sui fornitori di Lateral Space");
    assert.ok(m.text.includes(`Apri Impostazioni › Sub-responsabili: http://localhost:3000/dashboard/${ws}/settings#sub-responsabili`));
    assert.doesNotMatch(m.text, /FO-\d+|Fatture fornitori|caso d'uso/);
    assert.equal(m.from, SEND_ENV.UC_EMAIL_FROM);
    assert.equal(m.replyTo, "persona@example.test");
  }
  // Interruttore spento dopo: le email in coda si annullano all'invio.
  const ws2 = await workspace({ notices: true });
  ok(await approve(ws2, await card(ws2)));
  const off = { ...SEND_ENV, USE_CASE_CLIENT_NOTICES: "" };
  await alerts.dispatchCaseAlerts({ env: off, now: at, mailer: { async send(m: Mail) { outbox.push(m); return { ok: true as const }; } }, sendIntervalMs: 0 });
  assert.deepEqual([...new Set((await mails(ws2)).map((m) => `${m.status}:${m.cancel_reason}`))], ["annullata:avvisi_cliente_spenti"]);
});
