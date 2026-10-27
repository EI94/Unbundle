import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// «Chiedi al referente» sul database di prova, dall'invio alla risposta (SPEC §3.1, §3.2, §3.8,
// §P2.6, §P2.7): le porte nell'ordine, la transazione di invio, l'email con il link, la pagina
// pubblica (informativa, bozze, invio), le notifiche ai revisori e l'avviso a chi ha chiesto.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). Nessuna email vera: un mailer finto; nessun archivio vero: una cartella temporanea.
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

test("porte: funzione spenta, contributore, autorizzazione ai fornitori, email non configurata, email non verificata", opts, async () => {
  ok(await referents.prepareReferentQuestions(as("builder"), ids.useCase), "Prepara le domande");
  state.needs = await needIds();
  assert.equal(state.needs.length, 6);
  const input = { contact: { kind: "nuovo", displayName: "Mario Rossi", email: REFERENT_EMAIL }, needIds: state.needs.slice(0, 3) };

  refused(await referents.sendReferentRequest(as("builder"), ids.useCase, input, { env: { ...ENV, USE_CASE_REFERENTS: "off" }, requester: requester("builder") }), "funzione_spenta");
  const contributor = await referents.sendReferentRequest(as("contributor"), ids.useCase, input, { env: ENV, requester: requester("contributor") });
  assert.equal(contributor.ok, false);
  refused(await referents.sendReferentRequest(as("builder"), ids.useCase, input, { env: ENV, requester: requester("builder") }), "sub_responsabili_mancanti");
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
  );
  refused(await referents.sendReferentRequest(as("builder"), ids.useCase, input, { env: { ...ENV, RESEND_API_KEY: "" }, requester: requester("builder") }), "email_non_configurata");
  refused(await referents.sendReferentRequest(as("builder"), ids.useCase, input, { env: ENV, requester: { name: "x", emailVerified: false } }), "email_non_verificata");
  // Nessuna riga scritta da nessuno dei rifiuti.
  assert.equal((await q(`SELECT 1 FROM use_case_referent_requests WHERE workspace_id = $1::uuid`, [ids.ws])).length, 0);
  assert.equal((await q(`SELECT 1 FROM uc_contacts WHERE workspace_id = $1::uuid`, [ids.ws])).length, 0);
});

test("porte sul referente e sulle domande", opts, async () => {
  const send = (input: unknown) => referents.sendReferentRequest(as("builder"), ids.useCase, input, { env: ENV, requester: requester("builder") });
  const needs = state.needs.slice(0, 3);
  refused(await send({ contact: { kind: "nuovo", displayName: "Mario Rossi", email: "" }, needIds: needs }), "email_mancante");
  refused(await send({ contact: { kind: "nuovo", displayName: "Mario Rossi", email: `x@ls.test` }, needIds: needs }), "referente_lateral_space");
  refused(await send({ contact: { kind: "nuovo", displayName: "Mario Rossi", email: emails.ls }, needIds: needs }), "referente_lateral_space");
  refused(await send({ contact: { kind: "nuovo", displayName: "Mario Rossi", email: REFERENT_EMAIL }, needIds: [] }), "nessuna_domanda");
  const otherNeed = randomUUID();
  refused(await send({ contact: { kind: "nuovo", displayName: "Mario Rossi", email: REFERENT_EMAIL }, needIds: [otherNeed] }), "domande_cambiate");
  refused(await send({ contact: { kind: "nuovo", displayName: "Mario Rossi", email: REFERENT_EMAIL }, needIds: needs, message: "Scrivi a mario.rossi@topjet.it" }), "testo_contatto");
  assert.equal((await q(`SELECT 1 FROM uc_contacts WHERE workspace_id = $1::uuid`, [ids.ws])).length, 0);
});

test("invio: referente nuovo, richiesta, domande, esigenze «chiesta», Storia ed email in coda in una transazione", opts, async () => {
  const before = await useCaseSnapshot();
  const sent = ok(
    await referents.sendReferentRequest(as("builder"), ids.useCase, { contact: { kind: "nuovo", displayName: "Mario Rossi", email: REFERENT_EMAIL, roleLabel: "Contabilità" }, needIds: state.needs.slice(0, 3), message: "Grazie in anticipo." }, { env: ENV, requester: requester("builder") }),
    "invio",
  );
  state.requestId = sent.requestId;
  assert.equal(sent.contactName, "Mario Rossi");
  const [request] = await q(`SELECT * FROM use_case_referent_requests WHERE id = $1::uuid`, [sent.requestId]);
  assert.equal(request.status, "inviata");
  assert.equal(request.requested_by_user_id, ids.builder);
  state.contactId = String(request.contact_id);
  const [contact] = await q(`SELECT email, is_active FROM uc_contacts WHERE id = $1::uuid`, [state.contactId]);
  assert.equal(contact.email, REFERENT_EMAIL);
  const items = await q(`SELECT need_id::text AS need_id, position, state FROM use_case_referent_request_items WHERE request_id = $1::uuid ORDER BY position`, [sent.requestId]);
  assert.deepEqual(items.map((i) => i.position), [1, 2, 3]);
  for (const id of state.needs.slice(0, 3)) assert.equal(await statusOf(id), "chiesta");
  for (const id of state.needs.slice(3)) assert.equal(await statusOf(id), "da_chiedere");
  const outbox = await q(`SELECT template, status, dedupe_key FROM use_case_referent_emails WHERE request_id = $1::uuid`, [sent.requestId]);
  assert.deepEqual(outbox.map((r) => [r.template, r.status, r.dedupe_key]), [["richiesta", "in_coda", `ric:${sent.requestId}:1`]]);
  const events = await q(`SELECT phase_after FROM use_case_events WHERE use_case_id = $1::uuid AND 'richiesta_referente' = ANY(fields)`, [ids.useCase]);
  assert.deepEqual(events.map((e) => e.phase_after), ["inviata"]);
  assert.equal(await useCaseSnapshot(), before, "la scheda non si tocca");
  // Una seconda richiesta viva per la stessa persona sulla stessa scheda: no.
  refused(
    await referents.sendReferentRequest(as("builder"), ids.useCase, { contact: { kind: "esistente", contactId: state.contactId }, needIds: state.needs.slice(3, 4) }, { env: ENV, requester: requester("builder") }),
    "richiesta_aperta",
  );
});

test("email: il link con un token nuovo, la risposta a chi ha chiesto, nessun token in chiaro nel database", opts, async () => {
  const mailer = fakeMailer();
  const summary = await dispatch.dispatchReferentEmails({ requestId: state.requestId, env: ENV, mailer, sendIntervalMs: 0 });
  assert.equal(summary.sent, 1, JSON.stringify(summary));
  const [m] = mailer.outbox;
  assert.equal(m.to, REFERENT_EMAIL);
  assert.equal(m.replyTo, emails.builder);
  assert.ok(m.subject.includes("TopJet prova: Persona builder ti chiede alcune informazioni"), m.subject);
  state.token = tokenOf(m) ?? "";
  assert.match(state.token, /^ucq_/);
  const tokens = await q(`SELECT token_hash, recipient_hash, issued_for FROM use_case_referent_tokens WHERE request_id = $1::uuid`, [state.requestId]);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].issued_for, "richiesta");
  const { hashReferentToken, recipientHash } = await import("./tokens.ts");
  assert.equal(String(tokens[0].token_hash).trim(), hashReferentToken(state.token));
  assert.equal(String(tokens[0].recipient_hash).trim(), recipientHash(REFERENT_EMAIL));
  // Il token in chiaro non è in nessuna colonna di testo delle tabelle nuove.
  const cols = await q(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'character', 'jsonb')
       AND (table_name LIKE 'use_case_referent%' OR table_name IN ('use_case_need_answers', 'use_case_need_files', 'use_case_notifications', 'use_case_requester_emails', 'use_case_requester_email_items'))`,
  );
  for (const c of cols) {
    const hits = await q(`SELECT 1 FROM ${c.table_name} WHERE ${c.column_name}::text LIKE $1 LIMIT 1`, [`%${state.token}%`]);
    assert.equal(hits.length, 0, `${c.table_name}.${c.column_name}`);
  }
  const [request] = await q(`SELECT sent_at, last_email_at FROM use_case_referent_requests WHERE id = $1::uuid`, [state.requestId]);
  assert.ok(request.sent_at && request.last_email_at);
});

test("pagina pubblica: il link, l'informativa, le bozze e i loro controlli", opts, async () => {
  const now = new Date();
  const resolved = await pub.resolveReferentToken(state.token, now);
  assert.equal(resolved.access, "ok");
  if (resolved.access !== "ok") return;
  assert.equal(resolved.link.privacyAccepted, false);
  assert.equal((await pub.resolveReferentToken(`ucq_${"Z".repeat(32)}`, now)).access, "non_valido");
  const page = await pub.loadReferentAskPage(state.token, { env: ENV, now });
  assert.equal(page.access, "ok");
  if (page.access === "ok") {
    assert.equal(page.view.questions.length, 3);
    assert.equal(page.view.company, "TopJet prova");
    assert.equal(page.view.message, "Grazie in anticipo.");
    assert.equal(page.view.state, "aperta");
    assert.ok(!JSON.stringify(page.view).includes("Serve per stimare"), "mai il dettaglio dell'esigenza");
  }
  const [n1, n2, n3] = state.needs;
  const draft = await pub.saveReferentDraft(resolved.link, { needId: n1, text: "Circa 20", dontKnow: false }, now);
  assert.equal(draft.ok, false);
  if (!draft.ok) assert.equal(draft.code, "informativa_da_leggere");
  const wrong = await pub.acceptReferentPrivacy(resolved.link, { version: "ucq-2025-01-1" }, now);
  assert.ok(!wrong.ok && wrong.code === "informativa_cambiata");
  assert.deepEqual(await pub.acceptReferentPrivacy(resolved.link, { version: "ucq-2026-10-1" }, now), { ok: true, value: { accepted: true } });
  const [r] = await q(`SELECT status FROM use_case_referent_requests WHERE id = $1::uuid`, [state.requestId]);
  assert.equal(r.status, "inviata", "leggere l'informativa non cambia lo stato");
  const again = await pub.resolveReferentToken(state.token, now);
  assert.ok(again.access === "ok" && again.link.privacyAccepted);
  if (again.access !== "ok") return;
  const health = await pub.saveReferentDraft(again.link, { needId: n1, text: "Il collega è in malattia per una visita medica", dontKnow: false }, now);
  assert.ok(!health.ok, "dati sanitari rifiutati");
  const named = await pub.saveReferentDraft(again.link, { needId: n1, text: "Le controlla Mario Bianchi, circa 20 al giorno", dontKnow: false }, now);
  assert.ok(named.ok, JSON.stringify(named));
  if (named.ok) assert.ok(named.value.warnings.length > 0);
  assert.ok((await pub.saveReferentDraft(again.link, { needId: n2, text: null, dontKnow: true }, now)).ok);
  const foreign = await pub.saveReferentDraft(again.link, { needId: state.needs[4], text: "x", dontKnow: false }, now);
  assert.ok(!foreign.ok && foreign.code === "domanda_non_disponibile");
  void n3;
});

test("invio delle risposte: un nome blocca e non scrive niente; poi risposte, «Non lo so», notifiche, avviso, conferma", opts, async () => {
  const now = new Date();
  const resolved = await pub.resolveReferentToken(state.token, now);
  assert.ok(resolved.access === "ok");
  if (resolved.access !== "ok") return;
  const [n1, n2] = state.needs;
  const blocked = await pub.submitReferentAnswers(resolved.link, {}, now);
  assert.ok(!blocked.ok && blocked.code === "risposte_da_correggere", JSON.stringify(blocked));
  if (!blocked.ok) assert.ok(blocked.issues?.every((i) => i.field === n1));
  assert.equal(await statusOf(n1), "chiesta", "niente scritto");
  assert.ok((await pub.saveReferentDraft(resolved.link, { needId: n1, text: "Circa 20 fatture al giorno", dontKnow: false }, now)).ok);
  const before = await useCaseSnapshot();
  const done = await pub.submitReferentAnswers(resolved.link, {}, now);
  assert.ok(done.ok, JSON.stringify(done));
  if (done.ok) assert.deepEqual(done.value, { submitted: 2, open: 1, state: "aperta" });
  assert.equal(await statusOf(n1), "in_verifica");
  assert.equal(await statusOf(n2), "mancante");
  assert.equal(await useCaseSnapshot(), before, "la scheda non si tocca");
  const items = await q(`SELECT need_id::text AS id, state FROM use_case_referent_request_items WHERE request_id = $1::uuid ORDER BY position`, [state.requestId]);
  assert.deepEqual(items.map((i) => i.state), ["risposta", "non_so", "aperta"]);
  // Una riga per revisore (il builder, l'analyst, Lateral Space), nessuna per il contributore.
  const notes = await q(`SELECT recipient_user_id::text AS who, kind, answers, unknowns, documents, read_at FROM use_case_notifications WHERE use_case_id = $1::uuid ORDER BY recipient_user_id`, [ids.useCase]);
  assert.deepEqual(notes.map((n) => n.who).sort(), [ids.builder, ids.analyst, ids.ls].sort());
  for (const n of notes) assert.deepEqual([n.kind, n.answers, n.unknowns, n.documents, n.read_at], ["risposte", 1, 1, 0, null]);
  const alerts = await q(
    `SELECT e.recipient_user_id::text AS who, i.answers, i.unknowns FROM use_case_requester_emails e JOIN use_case_requester_email_items i ON i.email_id = e.id WHERE i.request_id = $1::uuid`,
    [state.requestId],
  );
  assert.deepEqual(alerts, [{ who: ids.builder, answers: 1, unknowns: 1 }]);
  const conferma = await q(`SELECT dedupe_key FROM use_case_referent_emails WHERE request_id = $1::uuid AND template = 'conferma'`, [state.requestId]);
  assert.equal(conferma.length, 1);
  // Gli eventi della Storia: «cosa_serve» dal sistema (pagina pubblica) e «risposte».
  const history = await q(`SELECT actor_kind, channel, phase_after FROM use_case_events WHERE use_case_id = $1::uuid AND 'cosa_serve' = ANY(fields) AND actor_kind = 'sistema'`, [ids.useCase]);
  assert.ok(history.length >= 2);
  assert.ok(history.every((h) => h.channel === "web"));
  // Già inviata: la bozza non si riscrive.
  const again = await pub.saveReferentDraft(resolved.link, { needId: n1, text: "Altro", dontKnow: false }, now);
  assert.ok(!again.ok);
});

test("pannello: righe, risposte, maschere; un contributore non lo riceve", opts, async () => {
  // Le esigenze della scheda come le legge la pagina.
  const base = await import("../../db/queries/use-case-referent-base.ts");
  const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
  const all = await base.readCardNeeds(await getAppUcExecutor(), ids.ws, ids.useCase);
  const needs = { requirements: all.filter((n) => n.type === "requisito"), steps: [], linkable: [] };
  const session = { id: ids.builder, name: "Persona builder", email: emails.builder, emailVerified: true };
  const panel = await referents.loadUseCaseReferentPanel({
    workspaceId: ids.ws,
    useCaseId: ids.useCase,
    viewer: { userId: ids.builder, email: emails.builder, emailVerified: true, role: "function_lead", isLateralSpace: false },
    session,
    role: "function_lead",
    needs,
    env: ENV,
  });
  assert.ok(panel);
  if (!panel) return;
  assert.equal(panel.available, true);
  assert.deepEqual(panel.gates, []);
  assert.deepEqual(panel.askableNeedIds.slice().sort(), [state.needs[1], ...state.needs.slice(3)].sort(), "le tre non ancora chieste e il «Non lo so» (mancante)");
  assert.equal(panel.requests.length, 1);
  assert.equal(panel.requests[0].contact.emailMasked?.startsWith("m•••@"), true);
  assert.ok(!JSON.stringify(panel).includes(REFERENT_EMAIL), "mai l'email intera del referente");
  const n1 = panel.needs[state.needs[0]];
  assert.ok(n1 && n1.answers.length === 1 && n1.answers[0].text === "Circa 20 fatture al giorno");
  const contributor = await referents.loadUseCaseReferentPanel({
    workspaceId: ids.ws,
    useCaseId: ids.useCase,
    viewer: { userId: ids.contributor, email: emails.contributor, emailVerified: true, role: "contributor", isLateralSpace: false },
    session: { ...session, id: ids.contributor },
    role: "contributor",
    needs,
    env: ENV,
  });
  assert.equal(contributor, null);
});

test("ultima risposta: richiesta completata; il link resta per vedere, le bozze delle ritirate si cancellano", opts, async () => {
  const now = new Date();
  const resolved = await pub.resolveReferentToken(state.token, now);
  assert.ok(resolved.access === "ok");
  if (resolved.access !== "ok") return;
  const n3 = state.needs[2];
  assert.ok((await pub.saveReferentDraft(resolved.link, { needId: n3, text: "Usiamo Excel e il gestionale", dontKnow: false }, now)).ok);
  const done = await pub.submitReferentAnswers(resolved.link, { needIds: [n3] }, now);
  assert.ok(done.ok && done.value.state === "completata", JSON.stringify(done));
  const [r] = await q(`SELECT status, completed_at FROM use_case_referent_requests WHERE id = $1::uuid`, [state.requestId]);
  assert.equal(r.status, "completata");
  const view = await pub.loadReferentAskPage(state.token, { env: ENV, now });
  assert.ok(view.access === "ok" && view.view.state === "completata");
  // La conferma è una al giorno.
  assert.equal((await q(`SELECT 1 FROM use_case_referent_emails WHERE request_id = $1::uuid AND template = 'conferma'`, [state.requestId])).length, 1);
});
