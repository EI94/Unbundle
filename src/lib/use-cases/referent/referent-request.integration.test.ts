import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { isWorkingDay, romeDate, romeLocalToUtc, workingDaysBetween } from "../../uc/calendar.ts";

// «Referente in un tocco» (rilascio 5, SPEC §3.1, §5, A4) sul database di prova: la richiesta al referente
// con la riga della conferma, anche senza domande; un referente alla volta (il controllo dentro il lock,
// due invii insieme, lo stesso invio ripetuto entro 60 secondi); «Cambia referente» e la persona con una
// richiesta di sole domande, con le domande portate; le «Non ce l'ho» del referente mai richieste; la
// conferma da inviare che tiene aperta la richiesta (promemoria, «Nessuna risposta», scadenza, mai
// completata dal cron o dalle risposte del team); le email con il mailer finto; nota e commenti tolti
// da cancellazione, conservazione ed «Elimina la risposta»; la pulizia del cron.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). Nessuna email vera (mailer finto). Dati sintetici, creati e cancellati qui.
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
type Dispatch = typeof import("../../db/queries/use-case-referent-dispatch.ts");
type Ctx = import("../service.ts").WriteContext;
type Mail = import("../../uc/notify/dispatch.ts").OutgoingEmail;

let referents: Referents;
let dispatch: Dispatch;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), builder: randomUUID(), analyst: randomUUID(), ls: randomUUID() };
const emails = {
  builder: `builder.r5.${suffix}@cliente.test`,
  analyst: `analyst.r5.${suffix}@cliente.test`,
  ls: `ls.r5.${suffix}@ls.test`,
};
type Person = keyof typeof emails;
const ROLE: Record<Person, string> = { builder: "function_lead", analyst: "analyst", ls: "transformation_lead" };
const ALDO = `aldo.prova.${suffix}@topjet.test`;
const BRUNA = `bruna.esempio.${suffix}@topjet.test`;
const CARLO = `carlo.campione.${suffix}@topjet.test`;
const storageDir = mkdtempSync(join(tmpdir(), "referenti-r5-"));

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

function as(person: Person): Ctx {
  return { workspaceId: ids.ws, actor: { userId: ids[person], role: ROLE[person], isLateralSpace: person === "ls", kind: "persona" }, channel: "pagina" };
}
const requester = (person: Person) => ({ name: `Persona ${person}`, emailVerified: true });
const deps = (person: Person = "builder") => ({ env: ENV, requester: requester(person) });

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

/** Uno use case approvato con «Prepara le domande»: sei requisiti del cliente da chiedere. */
async function newCard(): Promise<{ id: string; needs: string[] }> {
  const id = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
     VALUES ($1::uuid, $2::uuid, 'Fatture fornitori', 'Le fatture arrivano via PEC. Si risparmia il 30%.', 'accepted', 'scored', 'use_case_ai', $3, 'web_proposed')`,
    [id, ids.ws, `RC-${String(1000 + Math.floor(Math.random() * 8000))}`],
  );
  ok(await referents.prepareReferentQuestions(as("builder"), id), "Prepara le domande");
  const rows = await q(`SELECT n.id::text AS id FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid ORDER BY n.sort_order, n.id`, [id]);
  return { id, needs: rows.map((r) => String(r.id)) };
}

const newContact = (email: string, displayName: string) => ({ kind: "nuovo", displayName, email });
const NAMES: Record<string, string> = { [ALDO]: "Aldo Prova", [BRUNA]: "Bruna Esempio", [CARLO]: "Carlo Campione" };
/** Il referente già creato, oppure uno nuovo con il suo nome. */
async function contactOf(email: string): Promise<{ kind: "esistente"; contactId: string } | { kind: "nuovo"; displayName: string; email: string }> {
  const [row] = await q(`SELECT id::text AS id FROM uc_contacts WHERE workspace_id = $1::uuid AND email = $2`, [ids.ws, email]);
  return row ? { kind: "esistente", contactId: String(row.id) } : { kind: "nuovo", displayName: NAMES[email] ?? "Persona di prova", email };
}
async function contactIdOf(email: string): Promise<string> {
  const [row] = await q(`SELECT id::text AS id FROM uc_contacts WHERE workspace_id = $1::uuid AND email = $2`, [ids.ws, email]);
  assert.ok(row, `manca il referente ${email}`);
  return String(row.id);
}
async function latestReferentId(useCaseId: string): Promise<string | null> {
  const [row] = await q(
    `SELECT r.id::text AS id FROM use_case_referent_requests r JOIN use_case_referent_checks c ON c.request_id = r.id WHERE r.use_case_id = $1::uuid ORDER BY r.created_at DESC, r.id DESC LIMIT 1`,
    [useCaseId],
  );
  return row ? String(row.id) : null;
}
async function statusOf(needId: string): Promise<string> {
  return String((await q(`SELECT status FROM use_case_needs WHERE id = $1::uuid`, [needId]))[0]?.status);
}
async function requestOf(id: string) {
  return (await q(`SELECT status, revoked_reason, version, reminder_count FROM use_case_referent_requests WHERE id = $1::uuid`, [id]))[0];
}
async function itemsOf(id: string) {
  return q(`SELECT need_id::text AS need_id, position, file_required, state FROM use_case_referent_request_items WHERE request_id = $1::uuid ORDER BY position`, [id]);
}
async function storyCodes(useCaseId: string): Promise<string[]> {
  return (await q(`SELECT phase_after FROM use_case_events WHERE use_case_id = $1::uuid AND 'richiesta_referente' = ANY(fields) ORDER BY at, id`, [useCaseId])).map((r) => String(r.phase_after));
}
async function sendReferent(useCaseId: string, input: Record<string, unknown>, person: Person = "builder") {
  return referents.sendReferentRequest(as(person), useCaseId, { kind: "referente", expectedReferentRequestId: await latestReferentId(useCaseId), ...input }, deps(person));
}
async function mailOf(requestId: string): Promise<Mail> {
  const mailer = fakeMailer();
  const summary = await dispatch.dispatchReferentEmails({ requestId, env: ENV, mailer, sendIntervalMs: 0 });
  assert.equal(summary.sent, 1, JSON.stringify(summary));
  return mailer.outbox[0];
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

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  ENV.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.USE_CASE_HUB_WORKSPACES = ids.ws;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
  delete process.env.USE_CASE_REFERENTS;
  referents = await import("../../db/queries/use-case-referents.ts");
  dispatch = await import("../../db/queries/use-case-referent-dispatch.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione r5', $2)`, [ids.org, `hub-r5-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'TopJet prova')`, [ids.ws, ids.org]);
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.ws, ids[person], ROLE[person]]);
  }
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
  );
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
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

test("richiesta al referente senza domande: la riga della conferma, la Storia, l'email «Inizia» con le due cose", opts, async () => {
  const card = await newCard();
  const before = await Promise.all(card.needs.map(statusOf));
  const sent = ok(await sendReferent(card.id, { contact: newContact(ALDO, "Aldo Prova"), needIds: [] }), "invio");
  const [check] = await q(`SELECT workspace_id::text AS ws, use_case_id::text AS uc, confirm, estimate, submitted_at FROM use_case_referent_checks WHERE request_id = $1::uuid`, [sent.requestId]);
  assert.deepEqual(check, { ws: ids.ws, uc: card.id, confirm: null, estimate: null, submitted_at: null });
  assert.equal((await itemsOf(sent.requestId)).length, 0);
  assert.deepEqual(await Promise.all(card.needs.map(statusOf)), before, "nessuna esigenza cambia");
  assert.deepEqual(await storyCodes(card.id), ["referente"]);
  const [open] = await q(
    `SELECT (SELECT count(*)::int FROM use_case_referent_request_items oi WHERE oi.request_id = r.id) AS questions, (SELECT count(*)::int FROM use_case_referent_checks oc WHERE oc.request_id = r.id AND oc.submitted_at IS NULL) AS pending FROM use_case_referent_requests r WHERE r.id = $1::uuid`,
    [sent.requestId],
  );
  assert.deepEqual(open, { questions: 0, pending: 1 });
  const m = await mailOf(sent.requestId);
  assert.equal(m.to, ALDO);
  assert.match(m.subject, /^TopJet prova: sei il referente per «RC-\d+ · Fatture fornitori»$/);
  assert.ok(m.text.includes("Persona builder ti ha indicato come referente per lo use case «"), m.text);
  assert.ok(m.text.includes("Ti chiediamo due cose: confermare che lo use case è descritto bene e dirci quanto tempo prende questo lavoro."), m.text);
  assert.ok(m.text.includes("Bastano pochi minuti, anche dal telefono. Se un'informazione non ce l'hai, scegli «Non ce l'ho»."), m.text);
  assert.ok(m.text.includes("Inizia"), m.text);
  assert.ok(!/domand/.test(m.text.split("Bastano")[0]), "nessuna domanda");
});

test("richiesta al referente con domande e «Serve un file»: l'email conta le domande, una o più", opts, async () => {
  const card = await newCard();
  const sent = ok(await sendReferent(card.id, { contact: newContact(BRUNA, "Bruna Esempio"), needIds: card.needs.slice(0, 3), fileRequired: [card.needs[1]] }), "invio");
  assert.deepEqual((await itemsOf(sent.requestId)).map((i) => [i.position, i.file_required]), [[1, false], [2, true], [3, false]]);
  for (const id of card.needs.slice(0, 3)) assert.equal(await statusOf(id), "chiesta");
  const m = await mailOf(sent.requestId);
  assert.ok(m.text.includes("Ti chiediamo di confermare che lo use case è descritto bene, di dirci quanto tempo prende questo lavoro e di rispondere a 3 domande."), m.text);
  // «Serve un file» solo tra le domande della richiesta.
  const other = await newCard();
  refused(await sendReferent(other.id, { contact: await contactOf(BRUNA), needIds: other.needs.slice(0, 1), fileRequired: [other.needs[2]] }), "domande_cambiate");
  const one = ok(await sendReferent(other.id, { contact: await contactOf(BRUNA), needIds: other.needs.slice(0, 1) }), "una domanda");
  assert.ok((await mailOf(one.requestId)).text.includes("e di rispondere a una domanda."));
  // Le richieste di sole domande restano quelle del rilascio 4: senza domande, «nessuna_domanda».
  refused(await referents.sendReferentRequest(as("builder"), other.id, { contact: await contactOf(ALDO), needIds: [] }, deps()), "nessuna_domanda");
});

test("un referente alla volta: la richiesta vista dalla finestra, due invii insieme, lo stesso invio entro 60 secondi", opts, async () => {
  const card = await newCard();
  // Due revisori insieme, due persone diverse, entrambi con «nessun referente»: uno solo passa.
  const [a, b] = await Promise.all([
    referents.sendReferentRequest(as("builder"), card.id, { kind: "referente", expectedReferentRequestId: null, contact: newContact(CARLO, "Carlo Campione"), needIds: [] }, deps("builder")),
    referents.sendReferentRequest(as("analyst"), card.id, { kind: "referente", expectedReferentRequestId: null, contact: await contactOf(ALDO), needIds: [] }, deps("analyst")),
  ]);
  const results = [a, b];
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  const loser = results.find((r) => !r.ok)!;
  refused(loser, "referente_gia_scelto");
  assert.equal((await q(`SELECT 1 FROM use_case_referent_checks WHERE use_case_id = $1::uuid`, [card.id])).length, 1);
  // La finestra di prima (nessun referente) non vale più.
  refused(await referents.sendReferentRequest(as("analyst"), card.id, { kind: "referente", expectedReferentRequestId: null, contact: await contactOf(BRUNA), needIds: [] }, deps("analyst")), "referente_gia_scelto");
  // Un doppio clic dello stesso revisore alla stessa persona: la stessa richiesta, niente di scritto.
  const fresh = await newCard();
  const input = { kind: "referente", expectedReferentRequestId: null, contact: await contactOf(BRUNA), needIds: fresh.needs.slice(0, 2) };
  const [first, second] = await Promise.all([referents.sendReferentRequest(as("builder"), fresh.id, input, deps()), referents.sendReferentRequest(as("builder"), fresh.id, input, deps())]);
  const one = ok(first, "primo");
  assert.equal(ok(second, "secondo").requestId, one.requestId);
  const again = ok(await referents.sendReferentRequest(as("builder"), fresh.id, input, deps()), "dopo");
  assert.equal(again.requestId, one.requestId);
  assert.equal((await q(`SELECT 1 FROM use_case_referent_requests WHERE use_case_id = $1::uuid`, [fresh.id])).length, 1);
  assert.equal((await q(`SELECT 1 FROM use_case_referent_emails WHERE request_id = $1::uuid`, [one.requestId])).length, 1);
  // Lo stesso invio ripetuto da un'altra persona, o a un'altra persona, o dopo 60 secondi: rifiutato.
  refused(await referents.sendReferentRequest(as("analyst"), fresh.id, input, deps("analyst")), "referente_gia_scelto");
  await q(`UPDATE use_case_referent_requests SET created_at = now() - interval '2 minutes' WHERE id = $1::uuid`, [one.requestId]);
  refused(await referents.sendReferentRequest(as("builder"), fresh.id, input, deps()), "referente_gia_scelto");
  // Un doppio clic con un referente nuovo, mai visto: una persona sola, una richiesta sola.
  const third = await newCard();
  const newbie = `dora.nuova.${suffix}@topjet.test`;
  const nInput = { kind: "referente", expectedReferentRequestId: null, contact: newContact(newbie, "Dora Nuova"), needIds: [] };
  const [n1, n2] = await Promise.all([referents.sendReferentRequest(as("builder"), third.id, nInput, deps()), referents.sendReferentRequest(as("builder"), third.id, nInput, deps())]);
  assert.equal(ok(n1, "n1").requestId, ok(n2, "n2").requestId);
  assert.equal((await q(`SELECT 1 FROM uc_contacts WHERE workspace_id = $1::uuid AND email = $2`, [ids.ws, newbie])).length, 1);
});

test("«Cambia referente»: le richieste vive del referente di prima revocate, le sue domande aperte passano alla nuova", opts, async () => {
  // Un referente vivo con tre domande aperte (l'indice unico tiene una sola richiesta viva per persona e use case).
  const card = await newCard();
  const live = ok(await sendReferent(card.id, { contact: await contactOf(ALDO), needIds: card.needs.slice(0, 3) }), "referente");
  refused(await sendReferent(card.id, { contact: await contactOf(ALDO), needIds: [], replaceReferent: true }), "referente_uguale");
  refused(await sendReferent(card.id, { contact: await contactOf(BRUNA), needIds: [] }), "referente_gia_scelto", "senza «Cambia referente» un'altra persona no");
  const changed = ok(await sendReferent(card.id, { contact: await contactOf(BRUNA), needIds: [...card.needs.slice(0, 3), card.needs[3]], replaceReferent: true }), "cambia");
  assert.deepEqual([(await requestOf(live.requestId)).status, (await requestOf(live.requestId)).revoked_reason], ["revocata", "revisore"]);
  assert.deepEqual((await itemsOf(changed.requestId)).map((i) => i.need_id), card.needs.slice(0, 4));
  for (const id of card.needs.slice(0, 4)) assert.equal(await statusOf(id), "chiesta", "niente resta da chiedere");
  let codes = await storyCodes(card.id);
  assert.equal(codes.filter((c) => c === "revocata").length, 1);
  assert.ok(codes.includes("referente_cambiato") && !codes.includes("inviata"), JSON.stringify(codes));
  assert.equal(await latestReferentId(card.id), changed.requestId);

  // Un referente che ha già risposto e ha una richiesta di sole domande viva (il «seguito»): si revoca
  // quella, le sue domande aperte passano; la richiesta già risposta resta com'è.
  const other = await newCard();
  const answered = ok(await sendReferent(other.id, { contact: await contactOf(CARLO), needIds: [other.needs[0]] }), "referente");
  await q(`UPDATE use_case_referent_request_items SET state = 'risposta', answered_at = now() WHERE request_id = $1::uuid`, [answered.requestId]);
  await q(`UPDATE use_case_needs SET status = 'in_verifica' WHERE id = $1::uuid`, [other.needs[0]]);
  await q(`UPDATE use_case_referent_checks SET confirm = 'si', times_per_month = 3, minutes_each = 4, submitted_at = now() WHERE request_id = $1::uuid`, [answered.requestId]);
  await q(`UPDATE use_case_referent_requests SET status = 'completata', completed_at = now() WHERE id = $1::uuid`, [answered.requestId]);
  const follow = ok(await referents.sendReferentRequest(as("builder"), other.id, { contact: await contactOf(CARLO), needIds: other.needs.slice(1, 4) }, deps()), "seguito");
  const swapped = ok(await sendReferent(other.id, { contact: await contactOf(BRUNA), needIds: other.needs.slice(1, 4), replaceReferent: true }), "cambia dopo il seguito");
  assert.equal((await requestOf(answered.requestId)).status, "completata");
  assert.deepEqual([(await requestOf(follow.requestId)).status, (await requestOf(follow.requestId)).revoked_reason], ["revocata", "revisore"]);
  assert.deepEqual((await itemsOf(swapped.requestId)).map((i) => i.need_id), other.needs.slice(1, 4));
  for (const id of other.needs.slice(1, 4)) assert.equal(await statusOf(id), "chiesta");
  codes = await storyCodes(other.id);
  assert.equal(codes.filter((c) => c === "revocata").length, 1, "una riga per la richiesta revocata");
});

test("la persona scelta ha già una richiesta di sole domande: si revoca e le sue domande passano alla richiesta al referente", opts, async () => {
  const card = await newCard();
  const asked = ok(await referents.sendReferentRequest(as("builder"), card.id, { contact: await contactOf(CARLO), needIds: card.needs.slice(0, 2) }, deps()), "domande");
  const chosen = ok(await sendReferent(card.id, { contact: await contactOf(CARLO), needIds: card.needs.slice(0, 2) }), "referente");
  assert.deepEqual([(await requestOf(asked.requestId)).status, (await requestOf(asked.requestId)).revoked_reason], ["revocata", "revisore"]);
  assert.deepEqual((await itemsOf(chosen.requestId)).map((i) => i.need_id), card.needs.slice(0, 2));
  for (const id of card.needs.slice(0, 2)) assert.equal(await statusOf(id), "chiesta");
  // Una richiesta al referente viva alla stessa persona: rifiutata.
  refused(await sendReferent(card.id, { contact: await contactOf(CARLO), needIds: [] }), "richiesta_aperta");
});

test("le «Non ce l'ho» del referente: mai di nuovo con «Chiedi al referente» né con «Aggiungi domande»", opts, async () => {
  const card = await newCard();
  const sent = ok(await sendReferent(card.id, { contact: await contactOf(ALDO), needIds: card.needs.slice(0, 2) }), "referente");
  // Il referente ha risposto «Non ce l'ho» alla prima (scritto qui come lo scrive l'invio delle risposte).
  await q(`UPDATE use_case_referent_request_items SET state = 'non_so', answered_at = now() WHERE request_id = $1::uuid AND need_id = $2::uuid`, [sent.requestId, card.needs[0]]);
  await q(`UPDATE use_case_needs SET status = 'mancante' WHERE id = $1::uuid`, [card.needs[0]]);
  const [r] = await q(`SELECT version FROM use_case_referent_requests WHERE id = $1::uuid`, [sent.requestId]);
  refused(await referents.addToReferentRequest(as("builder"), card.id, sent.requestId, Number(r.version), { needIds: [card.needs[0]] }, { env: ENV }), "domande_cambiate");
  ok(await referents.addToReferentRequest(as("builder"), card.id, sent.requestId, Number(r.version), { needIds: [card.needs[2]], fileRequired: [card.needs[2]] }, { env: ENV }), "un'altra sì");
  assert.equal((await itemsOf(sent.requestId)).find((i) => i.need_id === card.needs[2])?.file_required, true);
  // Chiusa la richiesta, «Chiedi al referente» (sole domande al referente) rifiuta la «Non ce l'ho».
  await q(`UPDATE use_case_referent_requests SET status = 'completata', completed_at = now() WHERE id = $1::uuid`, [sent.requestId]);
  await q(`UPDATE use_case_referent_checks SET confirm = 'si', times_per_month = 3, minutes_each = 4, submitted_at = now() WHERE request_id = $1::uuid`, [sent.requestId]);
  refused(await referents.sendReferentRequest(as("builder"), card.id, { contact: await contactOf(ALDO), needIds: [card.needs[0]] }, deps()), "domande_cambiate");
  // A un'altra persona sì.
  ok(await referents.sendReferentRequest(as("builder"), card.id, { contact: await contactOf(BRUNA), needIds: [card.needs[0]] }, deps()), "a un'altra persona");
});

test("la conferma da inviare tiene aperta la richiesta: promemoria al terzo e al settimo giorno, «Nessuna risposta», mai completata", opts, async () => {
  const card = await newCard();
  const sent = ok(await sendReferent(card.id, { contact: await contactOf(BRUNA), needIds: [] }), "referente senza domande");
  await mailOf(sent.requestId);
  // Il cron non la completa (nessuna domanda aperta, ma la conferma sì).
  await backdate(sent.requestId, workingDaysBefore(V, 1), workingDaysBefore(V, 1));
  await referents.runReferentCron({ env: ENV, now: V, mailer: fakeMailer() });
  assert.equal((await requestOf(sent.requestId)).status, "inviata");
  // Primo promemoria.
  await backdate(sent.requestId, workingDaysBefore(V, 3), workingDaysBefore(V, 3));
  const m1 = fakeMailer();
  const c1 = await referents.runReferentCron({ env: ENV, now: V, mailer: m1 });
  assert.equal(c1.errors, 0, JSON.stringify(c1));
  const p1 = m1.outbox.filter((m) => m.to === BRUNA);
  assert.equal(p1.length, 1, JSON.stringify(c1));
  assert.match(p1[0].subject, /^Promemoria: la tua conferma su «RC-\d+ · Fatture fornitori»$/);
  assert.ok(p1[0].text.includes("ti ricordiamo che Persona builder aspetta la tua conferma sullo use case «"), p1[0].text);
  assert.ok(/aspetta la tua conferma sullo use case «[^»]+»\./.test(p1[0].text), "senza domande, niente «e le risposte»");
  assert.ok(p1[0].text.includes("Riprendi"));
  // Ultimo promemoria: «Nessuna risposta» per i revisori.
  await backdate(sent.requestId, workingDaysBefore(V, 7), workingDaysBefore(V, 4), 1);
  const m2 = fakeMailer();
  await referents.runReferentCron({ env: ENV, now: V, mailer: m2 });
  const p2 = m2.outbox.filter((m) => m.to === BRUNA);
  assert.equal(p2.length, 1);
  assert.match(p2[0].subject, /^Ultimo promemoria: la tua conferma su «/);
  assert.equal(Number((await requestOf(sent.requestId)).reminder_count), 2);
  assert.ok((await q(`SELECT 1 FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'senza_risposta'`, [card.id])).length >= 1);
  // Una risposta del team non la completa.
  const asked = await newCard();
  const withQ = ok(await sendReferent(asked.id, { contact: await contactOf(CARLO), needIds: [asked.needs[0]] }), "con una domanda");
  ok(await referents.addReviewerAnswer(as("builder"), asked.id, asked.needs[0], { text: "Circa 20 al giorno" }, ENV), "risposta del team");
  assert.equal((await requestOf(withQ.requestId)).status, "inviata", "la conferma aspetta ancora");
});

test("scadenza con la conferma da inviare: «Nessuna risposta» anche con meno di due promemoria", opts, async () => {
  const card = await newCard();
  const sent = ok(await sendReferent(card.id, { contact: await contactOf(ALDO), needIds: [] }), "referente");
  await mailOf(sent.requestId);
  await q(`UPDATE use_case_referent_requests SET created_at = now() - interval '31 days', sent_at = now() - interval '31 days', expires_at = now() - interval '1 hour' WHERE id = $1::uuid`, [sent.requestId]);
  const counts = await referents.runReferentCron({ env: ENV, now: new Date(), mailer: fakeMailer() });
  assert.equal(counts.errors, 0, JSON.stringify(counts));
  assert.equal((await requestOf(sent.requestId)).status, "scaduta");
  const notes = await q(`SELECT follow_up FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'senza_risposta'`, [card.id]);
  assert.ok(notes.length >= 1 && notes.every((n) => n.follow_up === "scaduta"), JSON.stringify(notes));
  // «Chiedi di nuovo» alla stessa persona: una richiesta al referente nuova.
  const again = ok(await sendReferent(card.id, { contact: await contactOf(ALDO), needIds: [], previousRequestId: sent.requestId }), "di nuovo");
  assert.equal(await latestReferentId(card.id), again.requestId);
});

test("revoca: la bozza della conferma si svuota, la riga resta", opts, async () => {
  const card = await newCard();
  const sent = ok(await sendReferent(card.id, { contact: await contactOf(BRUNA), needIds: [] }), "referente");
  await q(`UPDATE use_case_referent_checks SET confirm = 'correggi', confirm_note = 'Le fatture arrivano anche via PEC.' WHERE request_id = $1::uuid`, [sent.requestId]);
  ok(await referents.revokeReferentRequest(as("builder"), card.id, sent.requestId, Number((await requestOf(sent.requestId)).version)), "revoca");
  const [c] = await q(`SELECT confirm, confirm_note FROM use_case_referent_checks WHERE request_id = $1::uuid`, [sent.requestId]);
  assert.deepEqual(c, { confirm: null, confirm_note: null });
  assert.equal(await latestReferentId(card.id), sent.requestId, "la riga resta: lo use case resta senza referente");
});

test("cancellazione, conservazione, «Elimina la risposta»: note e commenti tolti, numeri e righe restano; la pulizia del cron", opts, async () => {
  const card = await newCard();
  const sent = ok(await sendReferent(card.id, { contact: await contactOf(CARLO), needIds: [card.needs[0]] }), "referente");
  // La risposta del referente, inviata con «Non ce l'ho» e un commento, e la conferma con la correzione.
  await q(
    `INSERT INTO use_case_need_answers (workspace_id, use_case_id, need_id, request_id, source, body, dont_know, status, submitted_at, comment)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'referente', NULL, true, 'inviata', now(), 'Lo sa l''ufficio acquisti')`,
    [ids.ws, card.id, card.needs[0], sent.requestId],
  );
  await q(`UPDATE use_case_referent_checks SET confirm = 'correggi', confirm_note = 'Arrivano anche via PEC', times_per_month = 20, minutes_each = 3, submitted_at = now() WHERE request_id = $1::uuid`, [sent.requestId]);
  const [answer] = await q(`SELECT id::text AS id FROM use_case_need_answers WHERE request_id = $1::uuid`, [sent.requestId]);
  ok(await referents.removeNeedAnswer(as("builder"), card.id, String(answer.id), ENV), "elimina");
  assert.deepEqual((await q(`SELECT body, comment FROM use_case_need_answers WHERE id = $1::uuid`, [answer.id]))[0], { body: null, comment: null });
  // «Cancella i dati di questa persona».
  const contact = await contactIdOf(CARLO);
  ok(await referents.eraseReferentData(as("builder"), card.id, contact, { env: ENV }), "cancella");
  const [c] = await q(`SELECT confirm, confirm_note, times_per_month, minutes_each, purged_at IS NOT NULL AS purged FROM use_case_referent_checks WHERE request_id = $1::uuid`, [sent.requestId]);
  assert.deepEqual(c, { confirm: "correggi", confirm_note: null, times_per_month: "20.00", minutes_each: "3.00", purged: true });
  // La conservazione dopo 12 mesi.
  const other = await newCard();
  const old = ok(await sendReferent(other.id, { contact: await contactOf(BRUNA), needIds: [] }), "vecchia");
  await q(`UPDATE use_case_referent_checks SET confirm = 'correggi', confirm_note = 'Nota vecchia', times_per_month = 2, minutes_each = 5, submitted_at = now() WHERE request_id = $1::uuid`, [old.requestId]);
  await q(`UPDATE use_case_referent_requests SET status = 'completata', completed_at = now() - interval '400 days', created_at = now() - interval '430 days', expires_at = now() - interval '399 days' WHERE id = $1::uuid`, [old.requestId]);
  // Un commento lasciato da un'eliminazione del codice di prima: la pulizia del cron lo toglie.
  const legacy = await newCard();
  const leg = ok(await sendReferent(legacy.id, { contact: await contactOf(ALDO), needIds: [legacy.needs[0]] }), "legacy");
  await q(
    `INSERT INTO use_case_need_answers (workspace_id, use_case_id, need_id, request_id, source, body, dont_know, status, submitted_at, removed_at, removed_reason, comment)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'referente', NULL, true, 'inviata', now(), now(), 'revisore', 'Commento rimasto')`,
    [ids.ws, legacy.id, legacy.needs[0], leg.requestId],
  );
  const counts = await referents.runReferentCron({ env: ENV, now: new Date(), mailer: fakeMailer() });
  assert.equal(counts.errors, 0, JSON.stringify(counts));
  assert.ok(counts.purged >= 1);
  const [p] = await q(`SELECT confirm_note, times_per_month, purged_at IS NOT NULL AS purged FROM use_case_referent_checks WHERE request_id = $1::uuid`, [old.requestId]);
  assert.deepEqual(p, { confirm_note: null, times_per_month: "2.00", purged: true });
  assert.equal((await q(`SELECT comment FROM use_case_need_answers WHERE request_id = $1::uuid`, [leg.requestId]))[0].comment, null);
});
