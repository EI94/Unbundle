import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { isWorkingDay, romeDate, romeLocalToUtc } from "../../uc/calendar.ts";

// Le correzioni della revisione prima del rilascio di «Chiedi al referente», sul database di prova:
// - un revisore che è anche il referente non accetta il PDF scansionato che ha mandato lui dal link;
// - un PDF del team da controllare non chiude la domanda del referente finché un'altra persona non lo
//   accetta, e un rifiuto non lascia niente da disfare;
// - in un workspace con un solo revisore un PDF scansionato dalla scheda si rifiuta subito;
// - il reply-to di un promemoria è di chi ha chiesto le voci che partono davvero;
// - senza le risposte dal link (UC_SECRET su Vercel) niente richieste e niente promemoria;
// - un contatto creato in «Persone» di un dossier non è «solo degli use case»;
// - «File non controllato in tempo» solo per file che il team ha visto, e 7 giorni dall'invio;
// - `markSent` blocca le richieste prima dell'email e delle voci.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). Dati sintetici, creati e cancellati qui. Nessuna email vera: un mailer finto.
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
type Files = typeof import("../../db/queries/use-case-referent-files.ts");
type Ctx = import("../service.ts").WriteContext;
type Mail = import("../../uc/notify/dispatch.ts").OutgoingEmail;
type Link = import("../../db/queries/use-case-referent-base.ts").ReferentLink;

let referents: Referents;
let pub: Public;
let dispatch: Dispatch;
let files: Files;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), ws2: randomUUID(), federico: randomUUID(), claudio: randomUUID(), anna: randomUUID(), solo: randomUUID() };
type Person = "federico" | "claudio" | "anna" | "solo";
const PEOPLE: Person[] = ["federico", "claudio", "anna", "solo"];
const ROLE: Record<Person, string> = { federico: "function_lead", claudio: "function_lead", anna: "analyst", solo: "exec_sponsor" };
const HOME: Record<Person, string> = { federico: ids.ws, claudio: ids.ws, anna: ids.ws, solo: ids.ws2 };
const emails: Record<Person, string> = {
  federico: `federico.${suffix}@topjet.test`,
  claudio: `claudio.${suffix}@topjet.test`,
  anna: `anna.${suffix}@topjet.test`,
  solo: `solo.${suffix}@cliente.test`,
};
const MARIO = `mario.rossi.${suffix}@topjet.test`;
const DOSSIER = `paola.bianchi.${suffix}@topjet.test`;
const contacts = { claudio: randomUUID(), mario: randomUUID(), dossier: randomUUID() };
const cards = { self: randomUUID(), team: randomUUID(), replyA: randomUUID(), replyB: randomUUID(), gate: randomUUID(), review: randomUUID(), locks: randomUUID(), solo: randomUUID() };
const storageDir = mkdtempSync(join(tmpdir(), "referenti-rilascio-"));

const ENV = {
  USE_CASE_HUB_WORKSPACES: "",
  UC_LS_EMAIL_DOMAINS: "ls.test",
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  UC_LOCAL_STORAGE_DIR: storageDir,
} as Record<string, string | undefined>;
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "USE_CASE_REFERENTS", "NEXT_PUBLIC_APP_URL"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function as(person: Person): Ctx {
  return { workspaceId: HOME[person], actor: { userId: ids[person], role: ROLE[person], isLateralSpace: false, kind: "persona" }, channel: "pagina" };
}
const requester = (person: Person) => ({ name: `Persona ${person}`, emailVerified: true });
const viewer = (person: Person) => ({ userId: ids[person], email: emails[person], emailVerified: true, role: ROLE[person], isLateralSpace: false });

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
const LINES = Array.from({ length: 6 }, (_, i) => `Regola ${i + 1}: il margine per tratta si calcola dal costo orario e dal prezzo proposto`).join("\n");
const CLEAN = new Uint8Array(Buffer.from(`colonna;valore\n${LINES}\n`, "utf8"));

/** Un giorno lavorativo alle 10 di Roma, non dopo adesso: la finestra dei promemoria è aperta. */
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
const V = virtualNow();

async function scanPdf(): Promise<Uint8Array> {
  const { buildPdf, pdfTextContent } = await import("../../uc/files/fixtures.ts");
  return buildPdf([{ content: pdfTextContent(["Pagina quasi vuota"]) }]);
}
async function needsOf(card: string): Promise<string[]> {
  const rows = await q(`SELECT n.id::text AS id FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id WHERE l.use_case_id = $1::uuid ORDER BY n.sort_order, n.id`, [card]);
  return rows.map((r) => String(r.id));
}
async function statusOf(needId: string): Promise<string> {
  return String((await q(`SELECT status FROM use_case_needs WHERE id = $1::uuid`, [needId]))[0]?.status);
}
async function requestStatus(requestId: string): Promise<string> {
  return String((await q(`SELECT status FROM use_case_referent_requests WHERE id = $1::uuid`, [requestId]))[0]?.status);
}
async function fileRow(id: string) {
  return (await q(`SELECT * FROM use_case_need_files WHERE id = $1::uuid`, [id]))[0];
}
async function panelFor(person: Person, card: string, env: Record<string, string | undefined> = ENV) {
  const base = await import("../../db/queries/use-case-referent-base.ts");
  const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
  const all = await base.readCardNeeds(await getAppUcExecutor(), HOME[person], card);
  const panel = await referents.loadUseCaseReferentPanel({
    workspaceId: HOME[person],
    useCaseId: card,
    viewer: viewer(person),
    session: { id: ids[person], name: `Persona ${person}`, email: emails[person], emailVerified: true },
    role: ROLE[person],
    needs: { requirements: all.filter((n) => n.type === "requisito"), steps: [], linkable: [] },
    env,
  });
  assert.ok(panel, "pannello");
  return panel!;
}
/** Una richiesta a un contatto esistente e la sua email partita con il mailer finto. */
async function ask(by: Person, card: string, contactId: string, needIds: string[]) {
  const sent = ok(await referents.sendReferentRequest(as(by), card, { contact: { kind: "esistente", contactId }, needIds }, { env: ENV, requester: requester(by) }), `invio di ${by}`);
  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer, sendIntervalMs: 0 });
  assert.equal(mailer.outbox.length, 1, "un'email");
  return { requestId: sent.requestId, mail: mailer.outbox[0], token: tokenOf(mailer.outbox[0]) ?? "" };
}
/** Il link del referente con l'informativa letta. */
async function openLink(token: string): Promise<Link> {
  const first = await pub.resolveReferentToken(token, V);
  if (first.access !== "ok") assert.fail(`link: ${first.access}`);
  assert.ok((await pub.acceptReferentPrivacy(first.link, { version: "ucq-2026-10-1" }, V)).ok, "informativa");
  const again = await pub.resolveReferentToken(token, V);
  if (again.access !== "ok") assert.fail("link dopo l'informativa");
  return again.link;
}
async function documentRows(card: string) {
  return (await q(`SELECT recipient_user_id::text AS who FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'documenti' ORDER BY recipient_user_id`, [card])).map((r) => String(r.who));
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  ENV.USE_CASE_HUB_WORKSPACES = [ids.ws, ids.ws2].join(",");
  process.env.USE_CASE_HUB_WORKSPACES = ENV.USE_CASE_HUB_WORKSPACES;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
  delete process.env.USE_CASE_REFERENTS;
  referents = await import("../../db/queries/use-case-referents.ts");
  pub = await import("../../db/queries/use-case-referent-public.ts");
  dispatch = await import("../../db/queries/use-case-referent-dispatch.ts");
  files = await import("../../db/queries/use-case-referent-files.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione rilascio', $2)`, [ids.org, `hub-rilascio-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'TopJet rilascio'), ($2::uuid, $3::uuid, 'Cliente con un revisore')`, [ids.ws, ids.ws2, ids.org]);
  for (const person of PEOPLE) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [HOME[person], ids[person], ROLE[person]]);
  }
  for (const [name, card] of Object.entries(cards)) {
    await q(
      `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source)
       VALUES ($1::uuid, $2::uuid, $3, 'Problema di prova', 'accepted', 'scored', 'use_case_ai', $4, 'web_proposed')`,
      [card, name === "solo" ? ids.ws2 : ids.ws, `Scheda ${name}`, `RL-${String(1000 + Math.floor(Math.random() * 8000))}`],
    );
  }
  for (const [ws, by] of [
    [ids.ws, ids.federico],
    [ids.ws2, ids.solo],
  ]) {
    await q(
      `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
      [ws, by],
    );
  }
  // Claudio come referente: solo l'email, uguale alla sua email verificata (Parte 3). Mario senza account.
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email) VALUES ($1::uuid, $2::uuid, 'Claudio', $3), ($4::uuid, $2::uuid, 'Mario Rossi', $5)`, [
    contacts.claudio,
    ids.ws,
    emails.claudio,
    contacts.mario,
    MARIO,
  ]);
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
  await q(`DELETE FROM uc_contacts WHERE workspace_id = ANY($1::uuid[])`, [[ids.ws, ids.ws2]]);
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.ws, ids.ws2]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [PEOPLE.map((p) => ids[p])]);
});

test("preparazione: le domande standard su ogni scheda", opts, async () => {
  for (const [name, card] of Object.entries(cards)) ok(await referents.prepareReferentQuestions(as(name === "solo" ? "solo" : "federico"), card), `Prepara ${name}`);
  for (const card of Object.values(cards)) assert.ok((await needsOf(card)).length >= 4);
});

test("un revisore che è anche il referente non accetta né apre per il controllo il PDF scansionato che ha mandato dal link; un altro revisore sì", opts, async () => {
  const needs = await needsOf(cards.self);
  const asked = await ask("federico", cards.self, contacts.claudio, needs.slice(0, 2));
  const link = await openLink(asked.token);
  const up = await pub.uploadReferentFileServer(link, { needId: needs[0], fileName: "fattura-scansionata.pdf", declaration: true, bytes: await scanPdf() }, ENV);
  assert.ok(up.ok && up.value.status === "in_revisione", JSON.stringify(up));
  if (!up.ok) return;
  const done = await pub.submitReferentAnswers(link, { needIds: [needs[0]] }, V);
  assert.ok(done.ok, JSON.stringify(done));
  assert.equal((await fileRow(up.value.fileId)).uploaded_by_user_id, null, "un file del link non ha chi l'ha caricato");

  // Claudio vede il file nella scheda, ma non «Accetta il file» e niente link per aprirlo.
  const own = (await panelFor("claudio", cards.self)).needs[needs[0]]?.files.find((f) => f.id === up.value.fileId);
  assert.ok(own, "il file c'è");
  assert.equal(own!.status, "in_revisione");
  assert.equal(own!.canReview, false, "non lo controlla chi l'ha mandato");
  assert.equal(own!.href, null);
  const download = await files.openReviewerFileDownload({ workspaceId: ids.ws, useCaseId: cards.self, fileId: up.value.fileId, viewer: viewer("claudio"), userId: ids.claudio }, ENV);
  assert.ok(!download.ok && download.code === "file_non_trovato");
  refused(await files.reviewNeedFile(as("claudio"), cards.self, up.value.fileId, "accetta", ENV), "revisore_uguale");
  refused(await files.reviewNeedFile(as("claudio"), cards.self, up.value.fileId, "rifiuta", ENV), "revisore_uguale");
  assert.equal((await fileRow(up.value.fileId)).scan_status, "in_revisione");

  // Federico, che ha chiesto, lo vede da controllare e lo accetta.
  const other = (await panelFor("federico", cards.self)).needs[needs[0]]?.files.find((f) => f.id === up.value.fileId);
  assert.ok(other?.canReview && other.href, JSON.stringify(other));
  const opened = await files.openReviewerFileDownload({ workspaceId: ids.ws, useCaseId: cards.self, fileId: up.value.fileId, viewer: viewer("federico"), userId: ids.federico }, ENV);
  assert.ok(opened.ok, JSON.stringify(opened));
  if (opened.ok) await opened.value.body.cancel();
  ok(await files.reviewNeedFile(as("federico"), cards.self, up.value.fileId, "accetta", ENV), "accetta");
  assert.equal((await fileRow(up.value.fileId)).scan_status, "pulito");
});

test("un PDF del team da controllare non chiude la domanda del referente; un rifiuto non lascia niente da disfare; l'accettazione sì", opts, async () => {
  const needs = await needsOf(cards.team);
  const asked = await ask("federico", cards.team, contacts.mario, [needs[0]]);
  assert.equal(await statusOf(needs[0]), "chiesta");
  const openItems = async () =>
    Number(
      (
        await q(
          `SELECT count(*)::int AS n FROM use_case_referent_request_items i JOIN use_case_needs n ON n.id = i.need_id
           WHERE i.request_id = $1::uuid AND i.state = 'aperta' AND n.status = 'chiesta' AND n.archived_at IS NULL`,
          [asked.requestId],
        )
      )[0].n,
    );

  const first = await files.uploadReviewerFileServer(as("claudio"), cards.team, { needId: needs[0], fileName: "scansione.pdf", declaration: true, bytes: await scanPdf() }, ENV);
  assert.ok(first.ok && first.value.status === "in_revisione", JSON.stringify(first));
  if (!first.ok) return;
  assert.equal(await statusOf(needs[0]), "chiesta", "non conta finché nessuno lo accetta");
  assert.equal(await requestStatus(asked.requestId), "inviata", "la domanda di Mario resta aperta");
  assert.equal(await openItems(), 1);
  assert.deepEqual(await documentRows(cards.team), [], "nessun «Nuovi documenti» prima del controllo");
  const page = await pub.resolveReferentToken(asked.token, V);
  assert.equal(page.access, "ok", "il link di Mario funziona ancora");

  // Federico lo rifiuta: niente da disfare, la domanda resta di Mario.
  ok(await files.reviewNeedFile(as("federico"), cards.team, first.value.fileId, "rifiuta", ENV), "rifiuta");
  assert.equal((await fileRow(first.value.fileId)).scan_status, "rifiutato");
  assert.equal(await statusOf(needs[0]), "chiesta");
  assert.equal(await requestStatus(asked.requestId), "inviata");
  assert.equal(await openItems(), 1);

  // Un altro PDF, accettato da Federico: adesso conta, la richiesta di Mario è fatta.
  const second = await files.uploadReviewerFileServer(as("claudio"), cards.team, { needId: needs[0], fileName: "scansione-2.pdf", declaration: true, bytes: await scanPdf() }, ENV);
  assert.ok(second.ok && second.value.status === "in_revisione", JSON.stringify(second));
  if (!second.ok) return;
  ok(await files.reviewNeedFile(as("federico"), cards.team, second.value.fileId, "accetta", ENV), "accetta");
  assert.equal(await statusOf(needs[0]), "in_verifica");
  assert.equal(await requestStatus(asked.requestId), "completata");
  assert.equal(await openItems(), 0);
  // «Nuovi documenti» a chi non ha agito né dato il file: Anna sola.
  assert.deepEqual(await documentRows(cards.team), [ids.anna]);
  const storia = await q(`SELECT phase_after FROM use_case_events WHERE use_case_id = $1::uuid AND phase_after IN ('file_team', 'file_rifiutato', 'file_accettato') ORDER BY at, id`, [cards.team]);
  assert.deepEqual(
    storia.map((r) => r.phase_after),
    ["file_team", "file_rifiutato", "file_team", "file_accettato"],
  );
});

test("con un solo revisore nel workspace un PDF scansionato dalla scheda si rifiuta subito, con il motivo; un CSV va", opts, async () => {
  const needs = await needsOf(cards.solo);
  const before = await statusOf(needs[0]);
  const scan = await files.uploadReviewerFileServer(as("solo"), cards.solo, { needId: needs[0], fileName: "scansione.pdf", declaration: true, bytes: await scanPdf() }, ENV);
  assert.ok(scan.ok, JSON.stringify(scan));
  if (!scan.ok) return;
  assert.equal(scan.value.status, "rifiutato");
  const { REFERENT_ERROR_MESSAGES } = await import("./labels.ts");
  assert.equal(scan.value.message, REFERENT_ERROR_MESSAGES.nessun_altro_revisore);
  const row = await fileRow(scan.value.fileId);
  assert.deepEqual([row.scan_status, row.rejection_reason, row.blob_path], ["rifiutato", "nessun_altro_revisore", null]);
  assert.equal(await statusOf(needs[0]), before, "l'esigenza non cambia");
  const csv = await files.uploadReviewerFileServer(as("solo"), cards.solo, { needId: needs[0], fileName: "regole.csv", declaration: true, bytes: CLEAN }, ENV);
  assert.ok(csv.ok && csv.value.status === "pulito", JSON.stringify(csv));
  assert.equal(await statusOf(needs[0]), "in_verifica");
});

test("il reply-to di un promemoria segue chi ha chiesto le voci che partono, anche quando la prima si toglie", opts, async () => {
  const needsA = await needsOf(cards.replyA);
  const needsB = await needsOf(cards.replyB);
  const r1 = await ask("federico", cards.replyA, contacts.mario, [needsA[0]]);
  const r2 = await ask("claudio", cards.replyB, contacts.mario, [needsB[0]]);
  // Le email delle richieste sono di due giorni fa: oggi a Mario non è ancora partito niente.
  const twoDaysAgo = new Date(V.getTime() - 2 * 86_400_000).toISOString();
  await q(`UPDATE use_case_referent_requests SET created_at = $2::timestamptz - interval '1 minute' * (CASE WHEN id = $3::uuid THEN 2 ELSE 1 END), sent_at = $2::timestamptz, last_email_at = $2::timestamptz WHERE id = ANY($1::uuid[])`, [
    [r1.requestId, r2.requestId],
    twoDaysAgo,
    r1.requestId,
  ]);
  await q(`UPDATE use_case_referent_emails SET sent_at = $2::timestamptz WHERE request_id = ANY($1::uuid[]) AND status = 'inviata'`, [[r1.requestId, r2.requestId], twoDaysAgo]);
  // Un solo promemoria in coda per Mario con le due voci (uno per persona al giorno).
  const scheduled = new Date(V.getTime() - 60_000).toISOString();
  const [row] = await q(
    `INSERT INTO use_case_referent_emails (workspace_id, contact_id, template, dedupe_key, due_at, scheduled_at) VALUES ($1::uuid, $2::uuid, 'promemoria', $3, $4::timestamptz, $4::timestamptz) RETURNING id::text AS id`,
    [ids.ws, contacts.mario, `pro:${contacts.mario}:rilascio-${suffix}`, scheduled],
  );
  const emailId = String(row.id);
  for (const r of [r1.requestId, r2.requestId]) {
    await q(`INSERT INTO use_case_referent_email_items (email_id, request_id, workspace_id, kind) VALUES ($1::uuid, $2::uuid, $3::uuid, 'manuale')`, [emailId, r, ids.ws]);
  }
  // Federico mette «A posto» l'unica domanda di R1 dal menu dello stato: R1 non ha più domande aperte.
  await q(`UPDATE use_case_needs SET status = 'validata' WHERE id = $1::uuid`, [needsA[0]]);

  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId: r2.requestId, env: ENV, now: V, mailer, sendIntervalMs: 0 });
  assert.equal(mailer.outbox.length, 1, "il promemoria parte");
  const mail = mailer.outbox[0];
  assert.equal(mail.to, MARIO);
  assert.equal(mail.replyTo, emails.claudio, "le risposte arrivano a chi ha chiesto R2");
  assert.ok(mail.text.includes("arriva a Persona claudio"), "il testo nomina la stessa persona dell'intestazione");
  assert.ok(!mail.text.includes("Persona federico"));
  const items = await q(`SELECT request_id::text AS r, state, drop_reason FROM use_case_referent_email_items WHERE email_id = $1::uuid ORDER BY request_id`, [emailId]);
  const byRequest = Object.fromEntries(items.map((i) => [String(i.r), [i.state, i.drop_reason]]));
  assert.deepEqual(byRequest[r1.requestId], ["tolta", "nessuna_domanda_aperta"]);
  assert.deepEqual(byRequest[r2.requestId], ["inviata", null]);
});

test("senza le risposte dal link (UC_SECRET mancante su Vercel) niente richieste né promemoria: la scheda lo dice e le email aspettano", opts, async () => {
  const needs = await needsOf(cards.gate);
  const PROD = { ...ENV, VERCEL_ENV: "production", UC_SECRET: "" };
  const panel = await panelFor("federico", cards.gate, PROD);
  const { REFERENT_UI_TEXT } = await import("./labels.ts");
  assert.ok(panel.gates.some((g) => g.code === "risposte_non_attive" && g.message === REFERENT_UI_TEXT.gates.publicWritesOff), JSON.stringify(panel.gates));
  refused(
    await referents.sendReferentRequest(as("federico"), cards.gate, { contact: { kind: "esistente", contactId: contacts.mario }, needIds: [needs[0]] }, { env: PROD, requester: requester("federico") }),
    "risposte_non_attive",
  );
  assert.equal(await statusOf(needs[0]), "da_chiedere");
  // Una richiesta fatta prima (UC_SECRET c'era): l'email aspetta finché le risposte non tornano.
  const sent = ok(await referents.sendReferentRequest(as("federico"), cards.gate, { contact: { kind: "esistente", contactId: contacts.mario }, needIds: [needs[0]] }, { env: ENV, requester: requester("federico") }));
  const held = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: PROD, mailer: held, sendIntervalMs: 0 });
  assert.equal(held.outbox.length, 0, "nessun link da cui non si può rispondere");
  const [queued] = await q(`SELECT status, hold_reason FROM use_case_referent_emails WHERE request_id = $1::uuid AND template = 'richiesta'`, [sent.requestId]);
  assert.deepEqual([queued.status, queued.hold_reason], ["in_coda", "risposte_non_attive"]);
  const back = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: { ...PROD, UC_SECRET: "segreto-di-prova" }, mailer: back, sendIntervalMs: 0 });
  assert.equal(back.outbox.length, 1, "con UC_SECRET di nuovo l'email parte");
});

test("un contatto creato in «Persone» di un dossier non è «solo degli use case»: l'email resta coperta e non si corregge né si anonimizza dall'hub", opts, async () => {
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email) VALUES ($1::uuid, $2::uuid, 'Paola Bianchi', $3)`, [contacts.dossier, ids.ws, DOSSIER]);
  const hub = ok(await referents.revealReferentContactEmail(as("federico"), cards.self, contacts.dossier, ENV), "prima, senza dossier");
  assert.equal(hub.email, DOSSIER, "senza nessuna traccia dei dossier è dell'hub");
  // La riga «referente.creato» del dossier, prima di ogni richiesta, incarico o firma.
  await q(
    `INSERT INTO uc_events (workspace_id, case_id, actor_type, actor_user_id, event_type, target_type, target_id, payload)
     VALUES ($1::uuid, $2::uuid, 'utente', $3::uuid, 'referente.creato', 'referente', $4::uuid, '{"fields":["display_name","email"]}'::jsonb)`,
    [ids.ws, randomUUID(), ids.federico, contacts.dossier],
  );
  const covered = ok(await referents.revealReferentContactEmail(as("federico"), cards.self, contacts.dossier, ENV), "dopo");
  assert.equal(covered.email, null, "come in «Persone» del dossier: niente email ai ruoli del cliente");
  refused(await referents.correctReferentEmail(as("federico"), cards.self, contacts.dossier, { email: `altra.${suffix}@topjet.test` }, { env: ENV }), "referente_in_dossier");
  const erased = ok(await referents.eraseReferentData(as("federico"), cards.self, contacts.dossier, { env: ENV }), "cancella");
  assert.equal(erased.contactAnonymized, false, "la riga resta alla procedura dei dossier");
  const [contact] = await q(`SELECT email, anonymized_at FROM uc_contacts WHERE id = $1::uuid`, [contacts.dossier]);
  assert.deepEqual([contact.email, contact.anonymized_at], [DOSSIER, null]);
});

test("«File non controllato in tempo» solo per file che il team ha visto, finché l'esigenza è aperta; i 7 giorni contano dall'invio", opts, async () => {
  const needs = await needsOf(cards.review);
  const asked = await ask("federico", cards.review, contacts.mario, needs.slice(0, 3));
  const link = await openLink(asked.token);
  const draft = await pub.uploadReferentFileServer(link, { needId: needs[0], fileName: "bozza.pdf", declaration: true, bytes: await scanPdf() }, ENV);
  const late = await pub.uploadReferentFileServer(link, { needId: needs[1], fileName: "inviato-tardi.pdf", declaration: true, bytes: await scanPdf() }, ENV);
  assert.ok(draft.ok && draft.value.status === "in_revisione" && late.ok && late.value.status === "in_revisione");
  if (!draft.ok || !late.ok) return;
  assert.ok((await pub.submitReferentAnswers(link, { needIds: [needs[1]] }, V)).ok, "invio del secondo");
  const team = await files.uploadReviewerFileServer(as("claudio"), cards.review, { needId: needs[2], fileName: "team.pdf", declaration: true, bytes: await scanPdf() }, ENV);
  assert.ok(team.ok && team.value.status === "in_revisione");
  if (!team.ok) return;
  // Tutti caricati 8 giorni fa; il secondo inviato adesso.
  await q(`UPDATE use_case_need_files SET created_at = now() - interval '8 days' WHERE id = ANY($1::uuid[])`, [[draft.value.fileId, late.value.fileId, team.value.fileId]]);
  await files.cleanupPendingFiles(ENV, new Date());
  assert.equal((await fileRow(draft.value.fileId)).scan_status, "in_revisione", "una bozza non la scade il controllo: la toglie la pulizia delle bozze");
  assert.equal((await fileRow(late.value.fileId)).scan_status, "in_revisione", "7 giorni dall'invio, non dal caricamento");
  assert.deepEqual([(await fileRow(team.value.fileId)).scan_status, (await fileRow(team.value.fileId)).rejection_reason], ["rifiutato", "revisione_scaduta"]);

  // Inviato 8 giorni fa anche il secondo: adesso scade.
  await q(`UPDATE use_case_need_files SET submitted_at = now() - interval '8 days' WHERE id = $1::uuid`, [late.value.fileId]);
  await q(`UPDATE use_case_need_files SET created_at = now() - interval '9 days' WHERE id = $1::uuid`, [draft.value.fileId]);
  await files.cleanupPendingFiles(ENV, new Date());
  assert.equal((await fileRow(late.value.fileId)).rejection_reason, "revisione_scaduta");
  assert.equal((await fileRow(draft.value.fileId)).scan_status, "in_revisione");

  let panel = await panelFor("federico", cards.review);
  assert.equal(panel.needs[needs[0]]?.reviewExpired, false, "una bozza mai inviata non dà l'avviso");
  assert.equal(panel.needs[needs[1]]?.reviewExpired, true);
  assert.equal(panel.needs[needs[2]]?.reviewExpired, true);
  // Un'esigenza chiusa non lo dice più.
  await q(`UPDATE use_case_needs SET status = 'validata' WHERE id = $1::uuid`, [needs[2]]);
  await q(`UPDATE use_case_needs SET archived_at = now(), archive_reason = 'Non serve più' WHERE id = $1::uuid`, [needs[1]]);
  panel = await panelFor("federico", cards.review);
  assert.notEqual(panel.needs[needs[1]]?.reviewExpired, true);
  assert.notEqual(panel.needs[needs[2]]?.reviewExpired, true);
});

test("markSent blocca prima le richieste (in ordine di id), poi l'email e le voci; la scadenza blocca le richieste vive della scheda in ordine", opts, async () => {
  const needs = await needsOf(cards.locks);
  const a = await ask("federico", cards.locks, contacts.mario, [needs[0]]);
  const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
  const real = await getAppUcExecutor();
  const recorded: { text: string }[][] = [];
  const recording = { batch: (statements: readonly { text: string; params: readonly unknown[] }[]) => (recorded.push([...statements]), real.batch(statements)) };
  const [row] = await q(
    `INSERT INTO use_case_referent_emails (workspace_id, contact_id, template, dedupe_key) VALUES ($1::uuid, $2::uuid, 'promemoria', $3) RETURNING id::text AS id`,
    [ids.ws, contacts.mario, `pro:${contacts.mario}:locks-${suffix}`],
  );
  await q(`INSERT INTO use_case_referent_email_items (email_id, request_id, workspace_id, kind) VALUES ($1::uuid, $2::uuid, $3::uuid, 'manuale')`, [String(row.id), a.requestId, ids.ws]);
  const store = dispatch.createReferentDispatchStore(recording, { env: ENV });
  await store.markSent(
    { id: String(row.id), workspaceId: ids.ws, contactId: contacts.mario, requestId: null, template: "promemoria", attempts: 0, dedupeKey: `pro:${contacts.mario}:locks-${suffix}`, dueAt: new Date() },
    [{ requestId: a.requestId, reminder: null, first: false, manual: true }],
    {},
    [],
  );
  const batch = recorded.at(-1)!;
  assert.match(batch[0].text, /FROM use_case_referent_requests r\s+WHERE[\s\S]*ORDER BY r\.id\s+FOR UPDATE/, "prima le richieste");
  assert.match(batch[1].text, /^UPDATE use_case_referent_emails/, "poi l'email");
  assert.equal(String((await q(`SELECT status FROM use_case_referent_emails WHERE id = $1::uuid`, [String(row.id)]))[0].status), "inviata");

  const { expireStatements } = await import("./sql.ts");
  const { alertSchedule } = await import("./alerts.ts");
  const expire = expireStatements({ workspaceId: ids.ws, useCaseId: cards.locks, actorUserId: null, schedule: alertSchedule(V), now: V });
  assert.match(expire[0].text, /^SELECT id FROM use_case_referent_requests\s+WHERE[\s\S]*status = 'inviata'\s+ORDER BY id\s+FOR UPDATE/);
  assert.match(expire[1].text, /^UPDATE use_case_referent_requests SET status = 'scaduta'/);
  // Lo stesso batch, sul database: niente scade (la richiesta è viva), niente si rompe.
  await real.batch(expire);
  assert.equal(await requestStatus(a.requestId), "inviata");
});
