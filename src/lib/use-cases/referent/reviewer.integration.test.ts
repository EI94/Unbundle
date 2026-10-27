import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// «Chiedi al referente» per i revisori, sul database di prova (SPEC §3.3, §3.9, §3.10, §5): il
// pannello e le sue porte, la revoca, il nuovo tentativo, le risposte e i file del team, «Correggi
// l'email», «Cancella i dati di questa persona», la Storia solo per chi vede «Cosa serve».
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). Nessuna email vera (mailer finto), nessun archivio vero (cartella temporanea).
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


async function ack(): Promise<void> {
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead') ON CONFLICT DO NOTHING`,
    [ids.ws, ids.builder],
  );
}

async function panelFor(person: Person) {
  const base = await import("../../db/queries/use-case-referent-base.ts");
  const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
  const all = await base.readCardNeeds(await getAppUcExecutor(), ids.ws, ids.useCase);
  return referents.loadUseCaseReferentPanel({
    workspaceId: ids.ws,
    useCaseId: ids.useCase,
    viewer: { userId: ids[person], email: emails[person], emailVerified: true, role: ROLE[person], isLateralSpace: person === "ls" },
    session: { id: ids[person], name: `Persona ${person}`, email: emails[person], emailVerified: true },
    role: ROLE[person],
    needs: { requirements: all.filter((n) => n.type === "requisito"), steps: [], linkable: [] },
    env: ENV,
  });
}

async function send(needs: string[], email = REFERENT_EMAIL, name = "Mario Rossi"): Promise<{ requestId: string; contactId: string; token: string }> {
  const contacts = await q(`SELECT id::text AS id FROM uc_contacts WHERE workspace_id = $1::uuid AND email = $2`, [ids.ws, email]);
  const contact = contacts[0] ? { kind: "esistente", contactId: String(contacts[0].id) } : { kind: "nuovo", displayName: name, email };
  const sent = ok(await referents.sendReferentRequest(as("builder"), ids.useCase, { contact, needIds: needs }, { env: ENV, requester: requester("builder") }), "invio");
  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer, sendIntervalMs: 0 });
  const [row] = await q(`SELECT contact_id::text AS c FROM use_case_referent_requests WHERE id = $1::uuid`, [sent.requestId]);
  return { requestId: sent.requestId, contactId: String(row.c), token: mailer.outbox[0] ? (tokenOf(mailer.outbox[0]) ?? "") : "" };
}

async function versionOf(requestId: string): Promise<number> {
  return Number((await q(`SELECT version FROM use_case_referent_requests WHERE id = $1::uuid`, [requestId]))[0].version);
}

test("pannello: porte nell'ordine (prima l'autorizzazione, poi l'email); null per il contributore", opts, async () => {
  ok(await referents.prepareReferentQuestions(as("builder"), ids.useCase), "Prepara");
  state.needs = await needIds();
  const before = await panelFor("builder");
  assert.ok(before);
  assert.deepEqual(before!.gates.map((g) => g.code), ["sub_responsabili_mancanti"]);
  const unconfigured = await referents.loadUseCaseReferentPanel({
    workspaceId: ids.ws,
    useCaseId: ids.useCase,
    viewer: { userId: ids.builder, email: emails.builder, emailVerified: false, role: "function_lead", isLateralSpace: false },
    session: { id: ids.builder, name: "x", email: emails.builder, emailVerified: false },
    role: "function_lead",
    needs: { requirements: [], steps: [], linkable: [] },
    env: { ...ENV, RESEND_API_KEY: "" },
  });
  assert.deepEqual(unconfigured!.gates.map((g) => g.code), ["sub_responsabili_mancanti", "email_non_configurata", "email_non_verificata", "nessuna_domanda"]);
  assert.equal(await panelFor("contributor"), null);
  await ack();
  assert.deepEqual((await panelFor("builder"))!.gates, []);
  // Prepara le domande una seconda volta: niente di nuovo.
  ok(await referents.prepareReferentQuestions(as("builder"), ids.useCase));
  assert.equal((await needIds()).length, 6);
});

test("referenti: in ordine di creazione, email mascherate; quella intera solo a un revisore che la chiede", opts, async () => {
  const sent = await send(state.needs.slice(0, 2));
  state.requestId = sent.requestId;
  state.contactId = sent.contactId;
  state.token = sent.token;
  const panel = (await panelFor("builder"))!;
  assert.equal(panel.contacts.length, 1);
  assert.equal(panel.contacts[0].emailMasked, `m•••@topjet.test`);
  assert.equal(panel.contacts[0].reason, "richiesta_aperta");
  const shown = ok(await referents.revealReferentContactEmail(as("builder"), ids.useCase, state.contactId), "email intera");
  assert.equal(shown.email, REFERENT_EMAIL);
  const contributor = await referents.revealReferentContactEmail(as("contributor"), ids.useCase, state.contactId);
  assert.equal(contributor.ok, false);
  assert.ok(panel.requests[0].lines.some((l) => /Inviata il \d{2}\/\d{2}/.test(l)), panel.requests[0].lines.join(" | "));
});

test("la lettura dell'informativa non cambia la vista dei revisori", opts, async () => {
  const before = JSON.stringify((await panelFor("builder"))!.requests);
  const resolved = await pub.resolveReferentToken(state.token, new Date());
  assert.ok(resolved.access === "ok");
  if (resolved.access === "ok") assert.ok((await pub.acceptReferentPrivacy(resolved.link, { version: "ucq-2026-10-1" }, new Date())).ok);
  assert.equal(JSON.stringify((await panelFor("builder"))!.requests), before);
});

test("risposta del team: «Da verificare», oppure «A posto» con «L'ho già verificata»; poi «Elimina la risposta»", opts, async () => {
  const n4 = state.needs[3];
  const n5 = state.needs[4];
  const answer = ok(await referents.addReviewerAnswer(as("builder"), ids.useCase, n4, { text: "Circa 5.000 all'anno" }), "risposta");
  assert.equal(await statusOf(n4), "in_verifica");
  ok(await referents.addReviewerAnswer(as("builder"), ids.useCase, n5, { text: "Tre persone", validate: true }), "risposta verificata");
  assert.equal(await statusOf(n5), "validata");
  refused(await referents.addReviewerAnswer(as("builder"), ids.useCase, randomUUID(), { text: "x" }), "domanda_non_disponibile");
  const named = await referents.addReviewerAnswer(as("builder"), ids.useCase, n4, { text: "Lo sa Mario Bianchi" });
  assert.equal(named.ok, false);
  const contributor = await referents.addReviewerAnswer(as("contributor"), ids.useCase, n4, { text: "x" });
  assert.equal(contributor.ok, false);
  ok(await referents.removeNeedAnswer(as("builder"), ids.useCase, answer.answerId), "elimina");
  const [row] = await q(`SELECT body, removed_reason FROM use_case_need_answers WHERE id = $1::uuid`, [answer.answerId]);
  assert.deepEqual([row.body, row.removed_reason], [null, "revisore"]);
  assert.equal(await statusOf(n4), "in_verifica", "lo stato non cambia");
  refused(await referents.removeNeedAnswer(as("builder"), ids.useCase, answer.answerId), "risposta_non_trovata");
});

test("revoca: le domande aperte tornano da chiedere, le bozze si cancellano, il link non vale più", opts, async () => {
  const resolved = await pub.resolveReferentToken(state.token, new Date());
  assert.ok(resolved.access === "ok");
  if (resolved.access !== "ok") return;
  assert.ok((await pub.saveReferentDraft(resolved.link, { needId: state.needs[0], text: "Circa 20", dontKnow: false }, new Date())).ok);
  refused(await referents.revokeReferentRequest(as("builder"), ids.useCase, state.requestId, 999), "versione_superata");
  ok(await referents.revokeReferentRequest(as("builder"), ids.useCase, state.requestId, await versionOf(state.requestId)), "revoca");
  for (const id of state.needs.slice(0, 2)) assert.equal(await statusOf(id), "da_chiedere");
  assert.equal((await q(`SELECT 1 FROM use_case_need_answers WHERE request_id = $1::uuid AND status = 'bozza'`, [state.requestId])).length, 0);
  assert.equal((await pub.resolveReferentToken(state.token, new Date())).access, "revocato");
  refused(await referents.revokeReferentRequest(as("builder"), ids.useCase, state.requestId, await versionOf(state.requestId)), "richiesta_chiusa");
});

test("nuovo tentativo dell'email: solo se non è partita, al massimo tre volte", opts, async () => {
  const sent = ok(await referents.sendReferentRequest(as("builder"), ids.useCase, { contact: { kind: "esistente", contactId: state.contactId }, needIds: state.needs.slice(0, 1) }, { env: ENV, requester: requester("builder") }));
  // L'email non è partita: tre errori certi.
  await q(`UPDATE use_case_referent_emails SET status = 'errore', attempts = 3 WHERE request_id = $1::uuid`, [sent.requestId]);
  ok(await referents.retryReferentRequestEmail(as("builder"), ids.useCase, sent.requestId, await versionOf(sent.requestId), { env: ENV }), "riprova");
  refused(await referents.retryReferentRequestEmail(as("builder"), ids.useCase, sent.requestId, await versionOf(sent.requestId), { env: ENV }), "riprova_non_ammessa");
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer: fakeMailer(), sendIntervalMs: 0 });
  refused(await referents.retryReferentRequestEmail(as("builder"), ids.useCase, sent.requestId, await versionOf(sent.requestId), { env: ENV }), "riprova_non_ammessa");
  state.requestId = sent.requestId;
});

test("«Correggi l'email» di un referente solo dell'hub: il vecchio link non vale più, la richiesta resta viva", opts, async () => {
  const before = await q(`SELECT 1 FROM use_case_referent_tokens WHERE request_id = $1::uuid AND revoked_at IS NULL`, [state.requestId]);
  assert.ok(before.length >= 1);
  refused(await referents.correctReferentEmail(as("builder"), ids.useCase, state.contactId, { email: emails.ls }, { env: ENV }), "referente_lateral_space");
  // Mai l'indirizzo di chi ha chiesto (il builder): né da lui, né da un altro revisore.
  refused(await referents.correctReferentEmail(as("builder"), ids.useCase, state.contactId, { email: emails.builder }, { env: ENV }), "referente_sei_tu");
  refused(await referents.correctReferentEmail(as("analyst"), ids.useCase, state.contactId, { email: emails.builder.toUpperCase() }, { env: ENV }), "email_di_chi_chiede");
  const corrected = `m.rossi.${suffix}@topjet.test`;
  ok(await referents.correctReferentEmail(as("builder"), ids.useCase, state.contactId, { email: corrected }, { env: ENV }), "correzione");
  assert.equal((await q(`SELECT 1 FROM use_case_referent_tokens WHERE request_id = $1::uuid AND revoked_at IS NULL`, [state.requestId])).length, 0);
  const [r] = await q(`SELECT status FROM use_case_referent_requests WHERE id = $1::uuid`, [state.requestId]);
  assert.equal(r.status, "inviata");
  const events = await q(`SELECT phase_after FROM use_case_events WHERE use_case_id = $1::uuid AND phase_after = 'email_corretta'`, [ids.useCase]);
  assert.equal(events.length, 1);

  // Lo stesso giorno dell'email al vecchio indirizzo «Manda un promemoria» parte: è l'unico modo di
  // dare il link al nuovo indirizzo. Un orario fisso nella finestra di Roma, con l'email di prima alle 9:40.
  const { nextRomeSendWindowStart } = await import("../../uc/calendar.ts");
  const at = new Date(nextRomeSendWindowStart(new Date()).getTime() + 60 * 60_000);
  await q(`UPDATE use_case_referent_requests SET last_email_at = $2::timestamptz WHERE id = $1::uuid`, [state.requestId, new Date(at.getTime() - 20 * 60_000).toISOString()]);
  ok(await referents.remindReferentRequest(as("builder"), ids.useCase, state.requestId, await versionOf(state.requestId), { env: ENV, now: at }), "promemoria al nuovo indirizzo");
  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId: state.requestId, env: ENV, now: at, mailer, sendIntervalMs: 0 });
  assert.equal(mailer.outbox.length, 1, "un'email");
  assert.equal(mailer.outbox[0].to, corrected);
  const token = tokenOf(mailer.outbox[0]);
  assert.ok(token);
  assert.equal((await pub.resolveReferentToken(token!, new Date())).access, "ok");
  // Con il link valido per il nuovo indirizzo torna «un'email al giorno» (l'email è partita all'ora `at`).
  await q(`UPDATE use_case_referent_requests SET last_email_at = $2::timestamptz WHERE id = $1::uuid`, [state.requestId, at.toISOString()]);
  refused(
    await referents.remindReferentRequest(as("builder"), ids.useCase, state.requestId, await versionOf(state.requestId), { env: ENV, now: new Date(at.getTime() + 60_000) }),
    "promemoria_gia_inviato",
  );
});

test("un referente solo dell'hub: la lettura prima della cancellazione lo riconosce", opts, async () => {
  const erase = await import("./erase.ts");
  const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
  const executor = await getAppUcExecutor();
  const [[hubOnly]] = await executor.batch([erase.contactHubOnlyReadSql(ids.ws, state.contactId)]);
  assert.equal(hubOnly.hub_only, true);
  // La guardia della cancellazione passa per lo stesso referente.
  const [[guard]] = await executor.batch([erase.contactHubOnlySql(ids.ws, state.contactId)]);
  assert.ok(guard);
});

test("«Cancella i dati di questa persona»: risposte e file svuotati, link revocati, referente anonimizzato se solo dell'hub", opts, async () => {
  const result = ok(await referents.eraseReferentData(as("builder"), ids.useCase, state.contactId, { env: ENV }), "cancellazione");
  assert.equal(result.contactAnonymized, true);
  const [c] = await q(`SELECT anonymized_at, email FROM uc_contacts WHERE id = $1::uuid`, [state.contactId]);
  assert.ok(c.anonymized_at);
  const live = await q(`SELECT 1 FROM use_case_referent_requests WHERE contact_id = $1::uuid AND status = 'inviata'`, [state.contactId]);
  assert.equal(live.length, 0);
  const answers = await q(`SELECT body FROM use_case_need_answers a JOIN use_case_referent_requests r ON r.id = a.request_id WHERE r.contact_id = $1::uuid AND a.body IS NOT NULL`, [state.contactId]);
  assert.equal(answers.length, 0);
  // I link si cancellano, con l'impronta dell'email: nessuna riga riporta all'indirizzo di prima.
  assert.equal((await q(`SELECT 1 FROM use_case_referent_tokens t JOIN use_case_referent_requests r ON r.id = t.request_id WHERE r.contact_id = $1::uuid`, [state.contactId])).length, 0);
  for (const address of [REFERENT_EMAIL, `m.rossi.${suffix}@topjet.test`]) {
    const hash = await q(`SELECT 1 FROM use_case_referent_tokens WHERE recipient_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [address]);
    assert.equal(hash.length, 0, "nessuna impronta dell'email");
  }
  // Una seconda volta non fallisce.
  const again = await referents.eraseReferentData(as("builder"), ids.useCase, state.contactId, { env: ENV });
  assert.ok(again.ok || again.error === "referente_non_valido", JSON.stringify(again));
});

test("la Storia della funzione solo a chi vede «Cosa serve»", opts, async () => {
  const events = await import("../../db/queries/use-case-events.ts");
  const withNeeds = await events.listUseCaseEvents(ids.ws, ids.useCase, 100, { withNeeds: true });
  const without = await events.listUseCaseEvents(ids.ws, ids.useCase, 100);
  const isReferent = (e: { fields: readonly string[] }) => e.fields.includes("richiesta_referente");
  assert.ok(withNeeds.events.some(isReferent));
  assert.ok(!without.events.some(isReferent));
  assert.ok(!without.events.some((e) => e.fields.includes("cosa_serve")));
});

test("scadenza pigra in un batch di un revisore: la causa il tempo, chi agisce riceve la notifica e l'avviso", opts, async () => {
  const first = await send([state.needs[0]], `luigi.verdi.${suffix}@topjet.test`, "Luigi Verdi");
  const second = await send([state.needs[1]], `anna.neri.${suffix}@topjet.test`, "Anna Neri");
  await q(`UPDATE use_case_referent_requests SET created_at = now() - interval '31 days', sent_at = now() - interval '31 days', expires_at = now() - interval '1 minute' WHERE id = $1::uuid`, [first.requestId]);
  // Il builder (che ha chiesto la prima) revoca la seconda: la prima scade nello stesso batch.
  ok(await referents.revokeReferentRequest(as("builder"), ids.useCase, second.requestId, await versionOf(second.requestId)), "revoca");
  const [expired] = await q(`SELECT status FROM use_case_referent_requests WHERE id = $1::uuid`, [first.requestId]);
  assert.equal(expired.status, "scaduta");
  const bell = await q(`SELECT follow_up FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'senza_risposta' AND recipient_user_id = $2::uuid`, [ids.useCase, ids.builder]);
  assert.deepEqual(bell.map((r) => r.follow_up), ["scaduta"], "chi ha chiesto vede «Nessuna risposta»");
  const alert = await q(
    `SELECT i.follow_up FROM use_case_requester_email_items i JOIN use_case_requester_emails e ON e.id = i.email_id WHERE i.request_id = $1::uuid AND e.recipient_user_id = $2::uuid`,
    [first.requestId, ids.builder],
  );
  assert.deepEqual(alert.map((r) => r.follow_up), ["scaduta"], "e l'avviso per email");
});

test("un referente che è anche in un dossier: l'email intera resta coperta per i ruoli del cliente, e la purge del dossier non lo anonimizza", opts, async () => {
  const dossierEmail = `dossier.${suffix}@topjet.test`;
  const contactId = randomUUID();
  const templateId = randomUUID();
  const caseId = randomUUID();
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email) VALUES ($1::uuid, $2::uuid, 'Paola Bianchi', $3)`, [contactId, ids.ws, dossierEmail]);
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash) VALUES ($1::uuid, $2, '1.0.0', 'Modello di prova', 'prova', '{}'::jsonb, $3)`,
    [templateId, `prova.referenti_${suffix}`, "a".repeat(64)],
  );
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, template_id, template_version, code, title, client_owner_contact_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, '1.0.0', $5, 'Dossier di prova', $6::uuid)`,
    [caseId, ids.ws, ids.org, templateId, `UC-RF${suffix.toUpperCase()}`, contactId],
  );
  try {
    const client = ok(await referents.revealReferentContactEmail(as("builder"), ids.useCase, contactId), "revisore del cliente");
    assert.equal(client.email, null, "coperta, come in «Persone» del dossier");
    const ls = ok(await referents.revealReferentContactEmail(as("ls"), ids.useCase, contactId), "Lateral Space");
    assert.equal(ls.email, dossierEmail);
    refused(await referents.revealReferentContactEmail(as("builder"), randomUUID(), contactId), "non_trovato");
    // Una richiesta degli use case allo stesso referente.
    await send([state.needs[2]], dossierEmail);
    const { orphanContactsSql } = await import("../../db/queries/uc-retention.ts");
    const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
    const [orphans] = await (await getAppUcExecutor()).batch([orphanContactsSql(ids.ws, caseId)]);
    assert.ok(!orphans.some((r) => String(r.id) === contactId), "usato dagli use case: non è orfano");
  } finally {
    await q(`DELETE FROM uc_cases WHERE id = $1::uuid`, [caseId]);
    await q(`DELETE FROM uc_templates WHERE id = $1::uuid`, [templateId]);
  }
});

// Gli aiuti di prova comuni alle suite di «Chiedi al referente»: questa non li usa tutti.
void (() => [useCaseSnapshot]);
