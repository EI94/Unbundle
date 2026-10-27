import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

// I file di «Chiedi al referente» sul database di prova (SPEC §2.3, §3.8, §3.9): caricamento dal link
// e dalla scheda, controllo del contenuto, avvisi da confermare, PDF in revisione controllati da
// Lateral Space, limite di 5 per domanda, quarantene abbandonate, download per i revisori.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su
//   127.0.0.1). L'archivio è una cartella temporanea (`UC_LOCAL_STORAGE_DIR`), mai Vercel Blob.
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


type Files = typeof import("../../db/queries/use-case-referent-files.ts");
let files: Files;
const LINES = Array.from({ length: 6 }, (_, i) => `Regola ${i + 1}: il margine per tratta si calcola dal costo orario e dal prezzo proposto`).join("\n");
const bytes = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));
const CLEAN = bytes(`colonna;valore\n${LINES}\n`);
const NAMED = bytes(`Referente Mario Bianchi, mario.bianchi@example.com\n${LINES}\n`);
const HEALTH = bytes(`${LINES}\nIl dipendente ha una diagnosi di diabete e una visita medica.\n`);
let link: import("../../db/queries/use-case-referent-public.ts").ReferentLink;
const viewerOf = (person: Person) => ({ userId: ids[person], email: emails[person], emailVerified: true, role: ROLE[person], isLateralSpace: person === "ls" });

async function fileRow(id: string) {
  return (await q(`SELECT * FROM use_case_need_files WHERE id = $1::uuid`, [id]))[0];
}

test("preparazione: autorizzazione, domande, richiesta, link con l'informativa letta", opts, async () => {
  files = await import("../../db/queries/use-case-referent-files.ts");
  await q(
    `INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role) VALUES ($1::uuid, '2026-10', 'Autorizzazione di prova', $2::uuid, 'function_lead')`,
    [ids.ws, ids.builder],
  );
  ok(await referents.prepareReferentQuestions(as("builder"), ids.useCase));
  state.needs = await needIds();
  const sent = ok(await referents.sendReferentRequest(as("builder"), ids.useCase, { contact: { kind: "nuovo", displayName: "Mario Rossi", email: REFERENT_EMAIL }, needIds: state.needs.slice(0, 3) }, { env: ENV, requester: requester("builder") }));
  state.requestId = sent.requestId;
  const mailer = fakeMailer();
  await dispatch.dispatchReferentEmails({ requestId: sent.requestId, env: ENV, mailer, sendIntervalMs: 0 });
  state.token = tokenOf(mailer.outbox[0]) ?? "";
  const resolved = await pub.resolveReferentToken(state.token, new Date());
  assert.ok(resolved.access === "ok");
  if (resolved.access !== "ok") return;
  // Prima dell'informativa niente file.
  const early = await pub.uploadReferentFileServer(resolved.link, { needId: state.needs[0], fileName: "a.csv", declaration: true, bytes: CLEAN }, ENV);
  assert.ok(!early.ok && early.code === "informativa_da_leggere");
  assert.ok((await pub.acceptReferentPrivacy(resolved.link, { version: "ucq-2026-10-1" }, new Date())).ok);
  const again = await pub.resolveReferentToken(state.token, new Date());
  assert.ok(again.access === "ok");
  if (again.access === "ok") link = again.link;
});

test("referente: un CSV pulito è pulito e nell'archivio della scheda; senza dichiarazione no", opts, async () => {
  const noDecl = await pub.uploadReferentFileServer(link, { needId: state.needs[0], fileName: "a.csv", declaration: false, bytes: CLEAN }, ENV);
  assert.equal(noDecl.ok, false);
  const up = await pub.uploadReferentFileServer(link, { needId: state.needs[0], fileName: "regole.csv", declaration: true, bytes: CLEAN }, ENV);
  assert.ok(up.ok, JSON.stringify(up));
  if (!up.ok) return;
  assert.equal(up.value.status, "pulito");
  const row = await fileRow(up.value.fileId);
  assert.equal(row.scan_status, "pulito");
  assert.ok(String(row.blob_path).startsWith(`uc/s/${ids.ws}/${ids.useCase}/`));
  assert.equal(row.quarantine_path, null);
  assert.equal(row.source, "referente");
  // Una domanda non della richiesta: no.
  const foreign = await pub.uploadReferentFileServer(link, { needId: state.needs[5], fileName: "a.csv", declaration: true, bytes: CLEAN }, ENV);
  assert.ok(!foreign.ok && foreign.code === "domanda_non_disponibile", JSON.stringify(foreign));
  // Invisibile al pannello fino all'invio.
  const panelFiles = await q(`SELECT 1 FROM use_case_need_files WHERE id = $1::uuid AND submitted_at IS NOT NULL`, [up.value.fileId]);
  assert.equal(panelFiles.length, 0);
  // Toglierlo prima dell'invio si può.
  assert.ok((await pub.removeReferentFile(link, { fileId: up.value.fileId }, ENV)).ok);
  assert.equal((await fileRow(up.value.fileId)).deleted_reason, "referente");
});

test("referente: un file con nomi va confermato prima dell'invio; poi l'invio lo segna inviato e non si toglie più", opts, async () => {
  const up = await pub.uploadReferentFileServer(link, { needId: state.needs[1], fileName: "contatti.txt", declaration: true, bytes: NAMED }, ENV);
  assert.ok(up.ok && up.value.status === "pulito" && up.value.needsConfirmation, JSON.stringify(up));
  if (!up.ok) return;
  const blocked = await pub.submitReferentAnswers(link, { needIds: [state.needs[1]] }, new Date());
  assert.ok(!blocked.ok && blocked.code === "file_da_confermare", JSON.stringify(blocked));
  assert.ok((await pub.confirmReferentFile(link, { fileId: up.value.fileId })).ok);
  const done = await pub.submitReferentAnswers(link, { needIds: [state.needs[1]] }, new Date());
  assert.ok(done.ok, JSON.stringify(done));
  assert.equal(await statusOf(state.needs[1]), "in_verifica");
  const row = await fileRow(up.value.fileId);
  assert.ok(row.submitted_at);
  const removed = await pub.removeReferentFile(link, { fileId: up.value.fileId }, ENV);
  assert.ok(!removed.ok && removed.code === "file_gia_inviato");
  // «Nuovi documenti»: il file pulito conta nella notifica delle risposte.
  const notes = await q(`SELECT documents FROM use_case_notifications WHERE use_case_id = $1::uuid AND recipient_user_id = $2::uuid AND kind = 'risposte'`, [ids.useCase, ids.analyst]);
  assert.equal(Number(notes[0]?.documents), 1);
});

test("referente: dati sanitari → rifiutato, nessun oggetto, il motivo resta", opts, async () => {
  const up = await pub.uploadReferentFileServer(link, { needId: state.needs[2], fileName: "note.txt", declaration: true, bytes: HEALTH }, ENV);
  assert.ok(up.ok && up.value.status === "rifiutato", JSON.stringify(up));
  if (!up.ok) return;
  const row = await fileRow(up.value.fileId);
  assert.equal(row.scan_status, "rifiutato");
  assert.equal(row.blob_path, null);
  assert.ok(row.rejection_reason);
});

test("referente: un PDF con poco testo va in revisione, si può inviare, lo controlla un revisore del workspace (anche del cliente)", opts, async () => {
  const { buildPdf, pdfTextContent } = await import("../../uc/files/fixtures.ts");
  const pdf = buildPdf([{ content: pdfTextContent(["Pagina quasi vuota"]) }]);
  const up = await pub.uploadReferentFileServer(link, { needId: state.needs[2], fileName: "scansione.pdf", declaration: true, bytes: pdf }, ENV);
  assert.ok(up.ok && up.value.status === "in_revisione", JSON.stringify(up));
  if (!up.ok) return;
  const row = await fileRow(up.value.fileId);
  assert.ok(String(row.blob_path).startsWith("uc/s/"));
  // Prima dell'invio nessuno lo controlla.
  refused(await files.reviewNeedFile(as("builder"), ids.useCase, up.value.fileId, "accetta", ENV), "file_non_trovato");
  const done = await pub.submitReferentAnswers(link, { needIds: [state.needs[2]] }, new Date());
  assert.ok(done.ok, JSON.stringify(done));
  // Annunciato all'arrivo, come documento (non come «risposta»: solo un file, nessun testo).
  const arrived = await q(`SELECT answers, documents FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'risposte' AND recipient_user_id = $2::uuid`, [ids.useCase, ids.builder]);
  assert.ok(Number(arrived[0]?.documents) >= 1, JSON.stringify(arrived));
  const answers = await q(`SELECT body, dont_know FROM use_case_need_answers WHERE need_id = $1::uuid AND request_id = $2::uuid AND status = 'inviata'`, [state.needs[2], state.requestId]);
  assert.ok(answers.every((a) => a.body === null && a.dont_know === false));
  // Nel pannello: nessuna risposta vuota, il file «Da controllare» per i revisori del workspace.
  const base = await import("../../db/queries/use-case-referent-base.ts");
  const { getAppUcExecutor } = await import("../../db/uc-executor.ts");
  const all = await base.readCardNeeds(await getAppUcExecutor(), ids.ws, ids.useCase);
  const panel = await referents.loadUseCaseReferentPanel({
    workspaceId: ids.ws,
    useCaseId: ids.useCase,
    viewer: viewerOf("builder"),
    session: { id: ids.builder, name: "Persona builder", email: emails.builder, emailVerified: true },
    role: ROLE.builder,
    needs: { requirements: all.filter((n) => n.type === "requisito"), steps: [], linkable: [] },
    env: ENV,
  });
  assert.ok(panel);
  if (!panel) return;
  const need = panel.needs[state.needs[2]];
  assert.ok(need, "esigenza nel pannello");
  assert.equal(need.answers.length, 0, "una domanda risposta solo con un file non mostra una risposta vuota");
  assert.ok(need.files.some((f) => f.id === up.value.fileId && f.status === "in_revisione" && f.canReview), JSON.stringify(need.files));
  assert.equal(panel.canReviewFiles, true);
  // Il revisore del cliente lo scarica e lo controlla; il contributore no.
  const client = await files.openReviewerFileDownload({ workspaceId: ids.ws, useCaseId: ids.useCase, fileId: up.value.fileId, viewer: viewerOf("builder"), userId: ids.builder }, ENV);
  assert.ok(client.ok, JSON.stringify(client));
  if (client.ok) await client.value.body.cancel();
  const contributor = await files.openReviewerFileDownload({ workspaceId: ids.ws, useCaseId: ids.useCase, fileId: up.value.fileId, viewer: viewerOf("contributor"), userId: ids.contributor }, ENV);
  assert.equal(contributor.ok, false);
  assert.equal((await files.reviewNeedFile(as("contributor"), ids.useCase, up.value.fileId, "accetta", ENV)).ok, false);
  ok(await files.reviewNeedFile(as("builder"), ids.useCase, up.value.fileId, "accetta", ENV), "accetta");
  assert.equal((await fileRow(up.value.fileId)).scan_status, "pulito");
  // Già annunciato con le risposte: l'accettazione non manda una seconda notifica.
  assert.equal((await q(`SELECT 1 FROM use_case_notifications WHERE use_case_id = $1::uuid AND kind = 'documenti'`, [ids.useCase])).length, 0);
});

test("team: «Allega un file» porta a «Da verificare» (o «A posto» se verificato e pulito), con la Storia; chi l'ha caricato non lo controlla", opts, async () => {
  const n4 = state.needs[3];
  const up = await files.uploadReviewerFileServer(as("builder"), ids.useCase, { needId: n4, fileName: "regole.csv", declaration: true, bytes: CLEAN }, ENV);
  assert.ok(up.ok && up.value.status === "pulito", JSON.stringify(up));
  assert.equal(await statusOf(n4), "in_verifica");
  const n5 = state.needs[4];
  const verified = await files.uploadReviewerFileServer(as("builder"), ids.useCase, { needId: n5, fileName: "regole.csv", declaration: true, bytes: CLEAN, validate: true }, ENV);
  assert.ok(verified.ok);
  assert.equal(await statusOf(n5), "validata");
  const history = await q(`SELECT 1 FROM use_case_events WHERE use_case_id = $1::uuid AND phase_after = 'file_team'`, [ids.useCase]);
  assert.equal(history.length, 2);
  const { buildPdf, pdfTextContent } = await import("../../uc/files/fixtures.ts");
  const scan = await files.uploadReviewerFileServer(as("ls"), ids.useCase, { needId: n4, fileName: "scansione.pdf", declaration: true, bytes: buildPdf([{ content: pdfTextContent(["Poco"]) }]) }, ENV);
  assert.ok(scan.ok && scan.value.status === "in_revisione");
  if (scan.ok) {
    refused(await files.reviewNeedFile(as("ls"), ids.useCase, scan.value.fileId, "rifiuta", ENV), "revisore_uguale");
    // Il contributore non carica.
    const contributor = await files.uploadReviewerFileServer(as("contributor"), ids.useCase, { needId: n4, fileName: "a.csv", declaration: true, bytes: CLEAN }, ENV);
    assert.equal(contributor.ok, false);
  }
});

test("al massimo 5 file per domanda anche con otto caricamenti insieme", opts, async () => {
  const need = state.needs[3];
  const live = async () =>
    Number(
      (await q(`SELECT count(*)::int AS n FROM use_case_need_files WHERE need_id = $1::uuid AND use_case_id = $2::uuid AND source = 'revisore' AND deleted_at IS NULL AND scan_status <> 'rifiutato'`, [need, ids.useCase]))[0].n,
    );
  const before = await live();
  assert.ok(before < 5, `prima ${before}`);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => files.uploadReviewerFileServer(as("builder"), ids.useCase, { needId: need, fileName: `p${i}.csv`, declaration: true, bytes: CLEAN }, ENV)),
  );
  const done = results.filter((r) => r.ok).length;
  assert.equal(done, 5 - before, JSON.stringify(results.map((r) => (r.ok ? "ok" : r.code))));
  assert.ok(results.every((r) => r.ok || r.code === "troppi_file"), JSON.stringify(results.map((r) => (r.ok ? "ok" : r.code))));
  assert.equal(await live(), 5);
});

test("al massimo 5 file per domanda; una quarantena abbandonata non conta e il cron la chiude", opts, async () => {
  const n6 = state.needs[5];
  for (let i = 0; i < 5; i++) {
    const up = await files.uploadReviewerFileServer(as("builder"), ids.useCase, { needId: n6, fileName: `f${i}.csv`, declaration: true, bytes: CLEAN }, ENV);
    assert.ok(up.ok, JSON.stringify(up));
  }
  const sixth = await files.uploadReviewerFileServer(as("builder"), ids.useCase, { needId: n6, fileName: "f6.csv", declaration: true, bytes: CLEAN }, ENV);
  assert.ok(!sixth.ok && sixth.code === "troppi_file", JSON.stringify(sixth));
  // Una riga in quarantena di più di un'ora (un caricamento diretto mai finito).
  const stale = randomUUID();
  await q(
    `INSERT INTO use_case_need_files (id, workspace_id, use_case_id, need_id, request_id, source, file_name, kind, max_bytes, upload_mode, quarantine_path, created_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'referente', 'lento.csv', 'csv', 1000, 'client', $6, now() - interval '2 hours')`,
    [stale, ids.ws, ids.useCase, state.needs[0], state.requestId, `uc/q/${ids.ws}/${ids.useCase}/${stale}`],
  );
  const closed = await files.cleanupPendingFiles(ENV, new Date());
  assert.ok(closed >= 1);
  const row = await fileRow(stale);
  assert.deepEqual([row.scan_status, row.rejection_reason, row.quarantine_path], ["rifiutato", "quarantena_scaduta", null]);
});

test("caricamento diretto: senza archivio diretto non si può; un file di un'altra richiesta non si completa", opts, async () => {
  const begin = await pub.beginReferentClientUpload(link, { needId: state.needs[0], fileName: "grande.pdf", size: 10 * 1024 * 1024, declaration: true }, ENV);
  assert.ok(!begin.ok && begin.code === "modalita_non_disponibile", JSON.stringify(begin));
  const other = await q(`SELECT id::text AS id FROM use_case_need_files WHERE source = 'revisore' AND workspace_id = $1::uuid LIMIT 1`, [ids.ws]);
  const complete = await pub.completeReferentClientUpload(link, { fileId: String(other[0].id) }, ENV);
  assert.ok(!complete.ok && complete.code === "file_non_trovato");
});

test("download: un file pulito del team ai revisori; lo stesso «non trovato» per contributore, altro workspace, altra scheda, file cancellato", opts, async () => {
  const [row] = await q(`SELECT id::text AS id FROM use_case_need_files WHERE source = 'revisore' AND scan_status = 'pulito' AND workspace_id = $1::uuid AND deleted_at IS NULL LIMIT 1`, [ids.ws]);
  const id = String(row.id);
  const okDownload = await files.openReviewerFileDownload({ workspaceId: ids.ws, useCaseId: ids.useCase, fileId: id, viewer: viewerOf("builder"), userId: ids.builder }, ENV);
  assert.ok(okDownload.ok);
  if (okDownload.ok) {
    assert.equal(okDownload.value.fileName.endsWith(".csv"), true);
    await okDownload.value.body.cancel();
  }
  const denied = [
    await files.openReviewerFileDownload({ workspaceId: ids.ws, useCaseId: ids.useCase, fileId: id, viewer: viewerOf("contributor"), userId: ids.contributor }, ENV),
    await files.openReviewerFileDownload({ workspaceId: ids.other, useCaseId: ids.useCase, fileId: id, viewer: viewerOf("builder"), userId: ids.builder }, ENV),
    await files.openReviewerFileDownload({ workspaceId: ids.ws, useCaseId: ids.otherCard, fileId: id, viewer: viewerOf("builder"), userId: ids.builder }, ENV),
  ];
  for (const d of denied) assert.ok(!d.ok && d.code === "file_non_trovato");
  ok(await referents.deleteNeedFile(as("builder"), ids.useCase, id, ENV), "elimina");
  const gone = await files.openReviewerFileDownload({ workspaceId: ids.ws, useCaseId: ids.useCase, fileId: id, viewer: viewerOf("builder"), userId: ids.builder }, ENV);
  assert.ok(!gone.ok);
  // Gli oggetti dei file cancellati vanno via dopo la risposta (o con il cron).
  const removed = await files.cleanupDeletedFiles({ workspaceId: ids.ws }, ENV);
  assert.ok(removed >= 1);
  assert.equal((await fileRow(id)).blob_path, null);
});

// Gli aiuti di prova comuni alle suite di «Chiedi al referente»: questa non li usa tutti.
void (() => [useCaseSnapshot]);
