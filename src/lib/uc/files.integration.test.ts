import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { addCaseMember, commandContextFor, createCase, loadUserContext, type UcCommandContext } from "../db/queries/uc-cases.ts";
import { assignItems, createContact, issueRequestToken, sendRequests } from "../db/queries/uc-requests.ts";
import { acknowledgePrivacy, resolveRequestToken, submitReferentAnswer, type PublicOptions, type ResolvedLink } from "../db/queries/uc-public.ts";
import {
  cleanupQuarantine,
  completeReferentUpload,
  completeUserUpload,
  beginUserUpload,
  createDataset,
  deleteCaseFile,
  loadUploadPanel,
  openFileDownload,
  referentTableTemplate,
  reviewQuarantinedFile,
  uploadFromReferent,
  uploadFromUser,
  userUploader,
  validateDataset,
  type UcFilesEnv,
  type UploadResult,
  type UserUploader,
} from "../db/queries/uc-files.ts";
import { loadQuestionDocuments } from "../db/queries/uc-questions.ts";
import { ENVELOPE_MAGIC } from "./crypto.ts";
import { ucBlobPath } from "./files/filename.ts";
import { buildPdf, pdfTextContent } from "./files/fixtures.ts";
import { REFERENT_PRIVACY_NOTICE } from "./public-view.ts";
import { caseFileRows, datasetsWithoutFile } from "./views/documents.ts";
import type { CaseRole } from "./vocab.ts";
import { quarantineInsertSql } from "./sql/files.ts";
import { planTemplateLoad } from "./template/load.ts";
import type { Result } from "./types.ts";

// Opt-in integration suite for files and datasets (PIANO §6), on the isolated local harness only:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/files.integration.test.ts
// Never in parallel with database.integration.test.ts (it narrows a vocabulary CHECK on purpose).
// Files go to a temporary local folder (UC_LOCAL_STORAGE_DIR), never to a real store. Invented content only.
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

const LS_DOMAINS = ["ls.test"];
const storeDir = mkdtempSync(join(tmpdir(), "uc-files-it-"));
const ENV: UcFilesEnv = { UC_LOCAL_STORAGE_DIR: storeDir, UC_PERSONAL_ZONE_KEY: randomBytes(32).toString("base64") };
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), lead: randomUUID(), analyst: randomUUID(), owner: randomUUID() };
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state = { caseId: "", items: new Map<string, string>(), contactSystems: "", contactService: "", tokenSystems: "", tokenService: "" };

const csv = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));
const LINES = Array.from({ length: 6 }, (_, i) => `Regola ${i + 1}: il margine per tratta si calcola dal costo orario e dal prezzo proposto al cliente`);
const CLEAN_CSV = csv("codice_richiesta;canale;data_apertura\nR-001;portale;2026-03-01\nR-002;sportello;2026-03-02\nR-003;portale;2026-03-03\n");

function popts(): PublicOptions {
  return { lsDomains: LS_DOMAINS, ipHash: "c".repeat(32), userAgent: "Mozilla/5.0 (iPhone) prova", device: "mobile", emailConfigured: false, personalZoneKey: ENV.UC_PERSONAL_ZONE_KEY };
}

async function ctxFor(userId: string): Promise<UcCommandContext> {
  const r = await commandContextFor(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId, lsDomains: LS_DOMAINS });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

async function uploader(userId: string): Promise<UserUploader> {
  const u = userUploader(await ctxFor(userId));
  assert.ok(u.ok);
  return u.value;
}

const item = (key: string) => {
  const id = state.items.get(key);
  assert.ok(id, `item ${key}`);
  return id;
};

function value<T>(r: Result<T>): T {
  assert.ok(r.ok, r.ok ? "" : `${r.code}: ${r.message}`);
  return r.value;
}

function code(r: Result<unknown>): string | null {
  return r.ok ? null : r.code;
}

async function link(token: string): Promise<ResolvedLink> {
  const l = await resolveRequestToken(exec!, token);
  assert.ok(l, "link valid");
  return l;
}

function filesOnDisk(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(full.slice(storeDir.length + 1));
    }
  };
  walk(storeDir);
  return out.sort();
}

const fileRow = (id: string) => one(`SELECT * FROM uc_files WHERE id = $1::uuid`, [id]);
const events = (type: string, target: string) => q(`SELECT payload::text AS p, actor_type, ip_hash FROM uc_events WHERE event_type = $1 AND target_id = $2::uuid`, [type, target]);

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova file', $2)`, [ids.org, `uc-files-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Cliente di prova file')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, email_verified, name) VALUES ($1::uuid, $4, now(), 'Persona LS'), ($2::uuid, $5, now(), 'Analista LS'), ($3::uuid, $6, now(), 'Owner')`, [
    ids.lead,
    ids.analyst,
    ids.owner,
    `files-lead-${suffix}@ls.test`,
    `files-analista-${suffix}@ls.test`,
    `files-owner-${suffix}@cliente.test`,
  ]);
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $4::uuid, 'transformation_lead'), ($2::uuid, $4::uuid, 'analyst'), ($3::uuid, $4::uuid, 'contributor')`, [
    ids.lead,
    ids.analyst,
    ids.owner,
    ids.org,
  ]);
  const json = JSON.parse(exampleText) as Record<string, unknown>;
  json.key = `prova.file_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(json), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const lead = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, { workspaceId: ids.ws, user: lead!, canReviewWorkspacePortfolio: true, input: { templateId: loaded.value.templateId, code: `FIL-${suffix.toUpperCase()}`, title: "Caso dei file" } });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  for (const r of await q(`SELECT id, key FROM uc_items WHERE case_id = $1::uuid`, [state.caseId])) state.items.set(String(r.key), String(r.id));
  const leadCtx = await ctxFor(ids.lead);
  for (const [userId, role] of [
    [ids.analyst, "ls_analista"],
    [ids.owner, "owner_cliente"],
  ] as const) {
    const r = await addCaseMember(exec!, leadCtx, { userId, role });
    assert.ok(r.ok, r.ok ? "" : r.message);
  }
  for (const [field, role] of [
    ["contactSystems", "referente_sistemi"],
    ["contactService", "resp_servizio"],
  ] as const) {
    const c = value(await createContact(exec!, leadCtx, { displayName: `Referente ${role}`, templateRoleKey: role, email: `${role}-${suffix}@cliente.test` }));
    state[field] = c.contactId;
    value(await assignItems(exec!, leadCtx, { mode: "ruolo", roleKey: role, contactId: c.contactId }));
  }
  const sent = value(await sendRequests(exec!, leadCtx, { contactIds: [state.contactSystems, state.contactService] }));
  for (const r of sent.requests) {
    const issued = value(await issueRequestToken(exec!, { workspaceId: ids.ws, caseId: state.caseId, requestId: r.requestId, issuedFor: "invio" }));
    if (r.contactId === state.contactSystems) state.tokenSystems = issued.token;
    else state.tokenService = issued.token;
  }
});

after(async () => {
  rmSync(storeDir, { recursive: true, force: true });
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid)`, [ids.lead, ids.analyst, ids.owner]);
});

const shared: { clean?: UploadResult; reviewPdf?: UploadResult } = {};

test("clean CSV from Lateral Space: quarantine row, checks, standard object by file id, masked preview, event without the name", opts, async () => {
  const analyst = await uploader(ids.analyst);
  const r = value(await uploadFromUser(exec!, analyst, { itemId: item("src.crm.richieste"), fileName: "../export richieste.csv", declaration: true, bytes: CLEAN_CSV }, ENV));
  shared.clean = r;
  assert.equal(r.status, "pulito");
  assert.equal(r.usable, true);
  assert.equal(r.fileName, "export richieste.csv");
  const row = await fileRow(r.fileId);
  assert.equal(row.blob_path, ucBlobPath("standard", ids.ws, state.caseId, r.fileId));
  assert.equal(row.quarantine_path, null);
  assert.equal(row.mime, "text/csv");
  assert.equal(row.uploaded_by_user_id, ids.analyst);
  assert.equal(row.uploader_declaration, true);
  assert.equal(row.content_scanned, true);
  assert.equal(row.extracted_text, null, "text is never stored in the MVP");
  assert.deepEqual((row.preview as { columns: string[] }).columns, ["codice_richiesta", "canale", "data_apertura"]);
  assert.ok(filesOnDisk().includes(join("standard", row.blob_path as string)));
  const ev = await events("file.caricato", r.fileId);
  assert.equal(ev.length, 1);
  assert.deepEqual(JSON.parse(String(ev[0].p)), { mime: "text/csv", size_bytes: CLEAN_CSV.byteLength, zona: "standard", outcome: "pulito" });
  const again = value(await uploadFromUser(exec!, analyst, { itemId: item("src.crm.richieste"), fileName: "copia.csv", declaration: true, bytes: CLEAN_CSV }, ENV));
  assert.equal(again.duplicate, true);
  assert.equal(again.fileId, r.fileId, "a duplicate in the same item and zone reuses the file");
  const noDecl = await uploadFromUser(exec!, analyst, { itemId: null, fileName: "a.csv", declaration: false, bytes: CLEAN_CSV }, ENV);
  assert.equal(code(noDecl), "dichiarazione_mancante");
});

test("«visita medica» in a CSV header or in a PDF: rejected, deleted, audited without content", opts, async () => {
  const analyst = await uploader(ids.analyst);
  const before = filesOnDisk();
  const header = value(await uploadFromUser(exec!, analyst, { itemId: null, fileName: "turni.csv", declaration: true, bytes: csv("codice_turno;visita medica\nT-1;si\n") }, ENV));
  assert.equal(header.status, "rifiutato");
  assert.match(header.message ?? "", /dati sanitari/);
  const row = await fileRow(header.fileId);
  assert.equal(row.scan_status, "rifiutato");
  assert.ok(row.deleted_at);
  assert.equal(row.deletion_reason, "contenuto_sanitario");
  assert.equal(row.blob_path, null);
  assert.equal(row.quarantine_path, null);
  assert.equal(row.preview, null);
  assert.equal((row.scan_findings as { categoria: string }).categoria, "sanitario");
  const ev = await events("file.rifiutato", header.fileId);
  assert.equal(ev.length, 1);
  const payload = JSON.parse(String(ev[0].p));
  assert.equal(payload.motivo, "contenuto_sanitario");
  assert.equal(String(ev[0].p).includes("turni") || String(ev[0].p).includes("T-1"), false);

  const pdf = buildPdf([{ content: pdfTextContent([...LINES, "Il pilota deve presentare la visita medica ogni anno"]) }]);
  const inPdf = value(await uploadFromUser(exec!, analyst, { itemId: item("doc.procedura_assistenza"), fileName: "procedura.pdf", declaration: true, bytes: new Uint8Array(pdf) }, ENV));
  assert.equal(inPdf.status, "rifiutato");
  assert.deepEqual(filesOnDisk(), before, "nothing of a rejected file stays in any store");
});

test("scanned PDF: waits in quarantine; the uploader cannot review it; another Lateral Space person opens and clears it", opts, async () => {
  const analyst = await uploader(ids.analyst);
  const pdf = new Uint8Array(buildPdf([{ content: pdfTextContent(["Pagina quasi vuota"]) }]));
  const r = value(await uploadFromUser(exec!, analyst, { itemId: item("doc.procedura_assistenza"), fileName: "scansione.pdf", declaration: true, bytes: pdf }, ENV));
  shared.reviewPdf = r;
  assert.equal(r.status, "in_quarantena");
  assert.equal(r.usable, false);
  const row = await fileRow(r.fileId);
  assert.equal(row.quarantine_path, ucBlobPath("quarantena", ids.ws, state.caseId, r.fileId));
  assert.equal(row.blob_path, null);
  const self = await reviewQuarantinedFile(exec!, await ctxFor(ids.analyst), { fileId: r.fileId, outcome: "pulito" }, ENV);
  assert.equal(code(self), "revisore_uguale");
  const ownerRead = await openFileDownload(exec!, await uploader(ids.owner), r.fileId, ENV);
  assert.equal(code(ownerRead), "file_non_trovato", "not usable yet");
  const leadRead = value(await openFileDownload(exec!, await uploader(ids.lead), r.fileId, ENV));
  assert.equal(Buffer.from(await new Response(leadRead.body).arrayBuffer()).equals(Buffer.from(pdf)), true);
  assert.equal(JSON.parse(String((await events("file.scaricato", r.fileId))[0].p)).motivo, "revisione");
  value(await reviewQuarantinedFile(exec!, await ctxFor(ids.lead), { fileId: r.fileId, outcome: "pulito" }, ENV));
  const after = await fileRow(r.fileId);
  assert.equal(after.scan_status, "pulito");
  assert.equal(after.reviewed_by_user_id, ids.lead);
  assert.equal(after.blob_path, ucBlobPath("standard", ids.ws, state.caseId, r.fileId));
  assert.equal(after.quarantine_path, null);
  assert.equal(existsSync(join(storeDir, "standard", ...(row.quarantine_path as string).split("/"))), false);
  assert.equal(code(await reviewQuarantinedFile(exec!, await ctxFor(ids.lead), { fileId: r.fileId, outcome: "rifiutato" }, ENV)), "non_in_revisione");
  assert.ok(value(await openFileDownload(exec!, await uploader(ids.owner), r.fileId, ENV)), "usable after the review");
});

test("referent upload: only after the privacy notice, only on its own open items, bound to its request and usable in the answer", opts, async () => {
  const l = await link(state.tokenSystems);
  const early = await uploadFromReferent(exec!, l, { itemId: item("q.sistemi.03"), fileName: "schema.csv", declaration: true, bytes: CLEAN_CSV }, {}, ENV);
  assert.equal(code(early), "informativa_da_leggere");
  value(await acknowledgePrivacy(exec!, l, { version: REFERENT_PRIVACY_NOTICE.version }, popts()));
  const l2 = await link(state.tokenSystems);
  const notMine = await uploadFromReferent(exec!, l2, { itemId: item("q.servizio.02"), fileName: "a.csv", declaration: true, bytes: CLEAN_CSV }, {}, ENV);
  assert.equal(code(notMine), "voce_non_disponibile");
  const bytes = csv("sistema;tabella\nCRM;richieste\n");
  const r = value(await uploadFromReferent(exec!, l2, { itemId: item("q.sistemi.03"), fileName: "schema.csv", declaration: true, bytes }, { ipHash: "c".repeat(32), userAgent: "prova" }, ENV));
  assert.equal(r.status, "pulito");
  const row = await fileRow(r.fileId);
  assert.equal(row.request_id, l2.requestId);
  assert.equal(row.uploaded_by_contact_id, l2.contactId);
  assert.equal(row.uploaded_by_user_id, null);
  const ev = await events("file.caricato", r.fileId);
  assert.equal(ev[0].actor_type, "referente");
  assert.equal(ev[0].ip_hash, "c".repeat(32));
  const answered = await submitReferentAnswer(exec!, l2, item("q.sistemi.03"), { kind: "valore", payload: { file_ids: [r.fileId] }, file_ids: [r.fileId] }, popts());
  assert.ok(answered.ok, answered.ok ? "" : `${answered.code}: ${answered.message}`);
  const a = await one(`SELECT file_ids FROM uc_answers WHERE item_id = $1::uuid ORDER BY version DESC LIMIT 1`, [item("q.sistemi.03")]);
  assert.deepEqual(a.file_ids, [r.fileId]);
  const foreign = await submitReferentAnswer(exec!, l2, item("q.sistemi.03"), { kind: "valore", payload: { file_ids: [shared.clean!.fileId] } }, popts());
  assert.equal(foreign.ok, false, "a file of another item or request cannot be attached");
});

test("client-Blob completion accepts only the file id issued to the same user or request (no IDOR); none on the harness", opts, async () => {
  const analyst = await uploader(ids.analyst);
  assert.equal(code(await beginUserUpload(exec!, analyst, { itemId: null, fileName: "grande.csv", size: 6 * 1024 * 1024, declaration: true }, ENV)), "modalita_non_disponibile");
  // A row as `upload-token` would create it, with the object already at its exact quarantine path.
  const fileId = randomUUID();
  const path = ucBlobPath("quarantena", ids.ws, state.caseId, fileId);
  await exec!.batch([
    quarantineInsertSql({ id: fileId, workspaceId: ids.ws, caseId: state.caseId, itemId: null, requestId: null, contactId: null, userId: ids.analyst, fileName: "diretto.csv", zone: "standard", quarantinePath: path, privacyClass: "riservato_azienda", maxBytes: 20 * 1024 * 1024 }),
  ]);
  const { ucStore } = await import("./storage.ts");
  await ucStore("standard", ENV)!.put(path, csv("colonna;valore\nA;1\n"));
  assert.equal(code(await completeUserUpload(exec!, await uploader(ids.lead), { fileId }, ENV)), "caricamento_non_trovato", "another user");
  const l = await link(state.tokenService);
  value(await acknowledgePrivacy(exec!, l, { version: REFERENT_PRIVACY_NOTICE.version }, popts()));
  assert.equal(code(await completeReferentUpload(exec!, await link(state.tokenService), { fileId }, {}, ENV)), "caricamento_non_trovato", "a referent link");
  const done = value(await completeUserUpload(exec!, analyst, { fileId }, ENV));
  assert.equal(done.status, "pulito");
  assert.equal(code(await completeUserUpload(exec!, analyst, { fileId }, ENV)), "caricamento_non_trovato", "only once");
  assert.equal(existsSync(join(storeDir, "standard", ...path.split("/"))), false, "quarantine object removed");
});

test("personal zone: closed before A.8; then encrypted at rest, readable only with the signed access, closed again on reactivation", opts, async () => {
  const lead = await uploader(ids.lead);
  const personalCsv = csv("codice_turno;cognome;giorno\nT-1;Cognome Inventato;lun\n");
  const closed = await uploadFromUser(exec!, lead, { itemId: item("src.hr.turni"), fileName: "turni.csv", declaration: true, bytes: personalCsv }, ENV);
  assert.equal(code(closed), "zona_personale_chiusa");
  await q(`UPDATE uc_blockers SET status = 'sciolto', resolved_at = now() WHERE case_id = $1::uuid AND key = 'a8'`, [state.caseId]);
  assert.equal(code(await uploadFromUser(exec!, lead, { itemId: item("src.hr.turni"), fileName: "turni.csv", declaration: true, bytes: personalCsv }, ENV)), "zona_personale_negata", "no signed access yet");
  await q(`UPDATE uc_case_members SET personal_zone_access = true WHERE case_id = $1::uuid AND user_id = $2::uuid`, [state.caseId, ids.lead]);
  const noKey = await uploadFromUser(exec!, lead, { itemId: item("src.hr.turni"), fileName: "turni.csv", declaration: true, bytes: personalCsv }, { UC_LOCAL_STORAGE_DIR: storeDir });
  assert.equal(code(noKey), "zona_personale_non_configurata");
  const health = value(await uploadFromUser(exec!, lead, { itemId: item("src.hr.turni"), fileName: "turni.csv", declaration: true, bytes: csv("codice_turno;idoneità medica\nT-1;si\n") }, ENV));
  assert.equal(health.status, "rifiutato", "health columns are never kept, not even in the personal zone");
  const r = value(await uploadFromUser(exec!, lead, { itemId: item("src.hr.turni"), fileName: "turni.csv", declaration: true, bytes: personalCsv }, ENV));
  assert.equal(r.status, "pulito");
  assert.equal(r.zone, "personale");
  const row = await fileRow(r.fileId);
  assert.equal(row.storage_zone, "personale");
  assert.equal(row.encryption_key_ref, "UC_PERSONAL_ZONE_KEY/v1/hkdf");
  assert.equal(row.preview, null);
  assert.equal(row.personal_data, "identificativi");
  const onDisk = readFileSync(join(storeDir, "personale", ...(row.blob_path as string).split("/")));
  assert.equal(onDisk.subarray(0, 4).toString("ascii"), ENVELOPE_MAGIC);
  assert.equal(onDisk.includes(Buffer.from("Cognome Inventato")), false, "never in clear at rest");
  assert.equal(statSync(join(storeDir, "personale", ...(row.blob_path as string).split("/"))).size > personalCsv.byteLength, true);
  const read = value(await openFileDownload(exec!, lead, r.fileId, ENV));
  assert.equal(Buffer.from(await new Response(read.body).arrayBuffer()).toString("utf8"), Buffer.from(personalCsv).toString("utf8"));
  assert.equal(code(await openFileDownload(exec!, await uploader(ids.analyst), r.fileId, ENV)), "file_non_trovato", "no signed access");
  assert.equal(code(await openFileDownload(exec!, await uploader(ids.owner), r.fileId, ENV)), "file_non_trovato");
  const ev = await events("file.scaricato", r.fileId);
  assert.equal(JSON.parse(String(ev[0].p)).zona, "personale");
  await q(`UPDATE uc_blockers SET status = 'attivo', resolved_at = NULL WHERE case_id = $1::uuid AND key = 'a8'`, [state.caseId]);
  assert.equal(code(await openFileDownload(exec!, lead, r.fileId, ENV)), "file_non_trovato", "A.8 reactivated: the zone closes");
});

test("datasets: profile from a usable file, version per source, validated only by someone other than the uploader", opts, async () => {
  const input = { fileId: shared.clean!.fileId, periodFrom: "2026-03-01", periodTo: "2026-03-31", extractedAt: "2026-04-02", extractionMethod: "export dal sistema", dataControllerLabel: "Società di esempio" };
  const ds = value(await createDataset(exec!, await ctxFor(ids.analyst), input, ENV));
  assert.equal(ds.version, 1);
  assert.equal(ds.rows, 3);
  const row = await one(`SELECT * FROM uc_datasets WHERE id = $1::uuid`, [ds.datasetId]);
  assert.equal(row.source_key, "src.crm.richieste");
  assert.equal(row.status, "ricevuto");
  assert.equal(row.item_id, item("src.crm.richieste"));
  assert.equal(JSON.stringify(row.schema).includes("R-001"), false, "no values in the card");
  assert.ok((await q(`SELECT check_key FROM uc_validations WHERE dataset_id = $1::uuid`, [ds.datasetId])).length >= 1);
  assert.equal(code(await validateDataset(exec!, await ctxFor(ids.analyst), { datasetId: ds.datasetId, outcome: "validato" })), "revisore_uguale");
  assert.equal(code(await validateDataset(exec!, await ctxFor(ids.owner), { datasetId: ds.datasetId, outcome: "validato" })), "attore_non_ammesso");
  value(await validateDataset(exec!, await ctxFor(ids.lead), { datasetId: ds.datasetId, outcome: "validato" }));
  const validated = await one(`SELECT status, validated_by_user_id FROM uc_datasets WHERE id = $1::uuid`, [ds.datasetId]);
  assert.deepEqual([validated.status, validated.validated_by_user_id], ["validato", ids.lead]);
  assert.equal(code(await validateDataset(exec!, await ctxFor(ids.lead), { datasetId: ds.datasetId, outcome: "rifiutato" })), "dataset_gia_deciso");
  const v2 = value(await createDataset(exec!, await ctxFor(ids.lead), input, ENV));
  assert.equal(v2.version, 2);
  const pdfCard = await createDataset(exec!, await ctxFor(ids.lead), { ...input, fileId: shared.reviewPdf!.fileId }, ENV);
  assert.equal(code(pdfCard), "non_tabellare");
  const evs = await q(`SELECT to_state FROM uc_events WHERE event_type = 'dataset.validato' AND target_id = $1::uuid`, [ds.datasetId]);
  assert.deepEqual(evs.map((e) => e.to_state), ["validato"]);
});

test("deletion: proofs used by the case stay; other files lose the object and keep an audited row", opts, async () => {
  await q(`UPDATE uc_blockers SET evidence = jsonb_build_object('file_id', $2::text) WHERE case_id = $1::uuid AND key = 'costi_art_8_4'`, [state.caseId, shared.reviewPdf!.fileId]);
  assert.equal(code(await deleteCaseFile(exec!, await ctxFor(ids.lead), { fileId: shared.reviewPdf!.fileId }, ENV)), "file_in_uso");
  assert.equal(code(await deleteCaseFile(exec!, await ctxFor(ids.analyst), { fileId: shared.clean!.fileId }, ENV)), "attore_non_ammesso");
  const blob = (await fileRow(shared.clean!.fileId)).blob_path as string;
  value(await deleteCaseFile(exec!, await ctxFor(ids.lead), { fileId: shared.clean!.fileId }, ENV));
  const row = await fileRow(shared.clean!.fileId);
  assert.ok(row.deleted_at);
  assert.equal(row.blob_path, null);
  assert.equal(existsSync(join(storeDir, "standard", ...blob.split("/"))), false);
  assert.equal((await events("file.cancellato", shared.clean!.fileId)).length, 1);
  assert.equal(code(await openFileDownload(exec!, await uploader(ids.lead), shared.clean!.fileId, ENV)), "file_non_trovato");
});

test("Documenti: each file shows the dataset card made from it; the card of a deleted file stays visible", opts, async () => {
  const leadCtx = await ctxFor(ids.lead);
  const up = await uploader(ids.lead);
  const second = value(await uploadFromUser(exec!, up, { itemId: item("src.crm.richieste"), fileName: "aprile.csv", declaration: true, bytes: csv("codice_richiesta;canale;data_apertura\nR-101;portale;2026-04-01\nR-102;sportello;2026-04-02\n") }, ENV));
  const caseDoc = value(await uploadFromUser(exec!, up, { itemId: null, fileName: "turni.csv", declaration: true, bytes: csv("reparto;turni\nA;3\nB;2\n") }, ENV));
  const input = { periodFrom: "2026-04-01", periodTo: "2026-04-30", extractedAt: "2026-05-02", extractionMethod: "export dal sistema", dataControllerLabel: "Società di esempio" };
  const fromSecond = value(await createDataset(exec!, leadCtx, { ...input, fileId: second.fileId }, ENV));
  const fromCase = value(await createDataset(exec!, leadCtx, { ...input, fileId: caseDoc.fileId, sourceKey: "src.hr.turni" }, ENV));
  const viewerOf = async (userId: string, roles: CaseRole[]) => ({ workspaceId: ids.ws, caseId: state.caseId, roles, user: (await loadUserContext(exec!, userId, LS_DOMAINS))!, readOnly: false });
  const data = await loadQuestionDocuments(exec!, await viewerOf(ids.lead, ["ls_lead"]));
  assert.ok(data);
  const rows = caseFileRows(data.files, data.datasets, null);
  const card = (fileId: string) => rows.find((r) => r.id === fileId)?.dataset ?? null;
  assert.equal(card(second.fileId)?.status, "Ricevuto", "the second file of the question has its own card");
  assert.equal(card(caseDoc.fileId)?.status, "Ricevuto", "a case document (no question) shows its card");
  assert.ok(data.datasets.some((d) => d.id === fromSecond.datasetId && d.fileId === second.fileId));
  assert.ok(data.datasets.some((d) => d.id === fromCase.datasetId && d.fileId === caseDoc.fileId && d.itemId === null));
  // The first CSV was deleted by the test before: its cards (v1 validated, v2) stay under «Schede senza file», the newest one.
  const sources = new Map(data.required.map((d) => [d.key, d.title]));
  const orphans = datasetsWithoutFile(data.files, data.datasets, sources, "ls");
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].title, data.required.find((d) => d.key === "src.crm.richieste")?.title);
  assert.ok(!rows.some((r) => r.id === shared.clean!.fileId));
  // The client sees the same cards, with the question's title only.
  const client = await loadQuestionDocuments(exec!, await viewerOf(ids.owner, ["owner_cliente"]));
  const clientRows = caseFileRows(client!.files, client!.datasets, null, "cliente");
  assert.equal(clientRows.find((r) => r.id === second.fileId)?.dataset?.status, "Ricevuto");
  assert.ok(clientRows.every((r) => !r.item || !r.item.title.startsWith("src.")));
});

test("cleanup: abandoned quarantine rows close after an hour, orphan quarantine objects are deleted", opts, async () => {
  const fileId = randomUUID();
  const path = ucBlobPath("quarantena", ids.ws, state.caseId, fileId);
  await exec!.batch([
    quarantineInsertSql({ id: fileId, workspaceId: ids.ws, caseId: state.caseId, itemId: null, requestId: null, contactId: null, userId: ids.lead, fileName: "mai.csv", zone: "standard", quarantinePath: path, privacyClass: "riservato_azienda", maxBytes: 1024 }),
  ]);
  await q(`UPDATE uc_files SET created_at = now() - interval '2 hours' WHERE id = $1::uuid`, [fileId]);
  const { ucStore } = await import("./storage.ts");
  const store = ucStore("standard", ENV)!;
  await store.put(path, csv("a\n1\n"));
  const orphan = ucBlobPath("quarantena", ids.ws, state.caseId, randomUUID());
  await store.put(orphan, csv("b\n2\n"));
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(join(storeDir, "standard", ...orphan.split("/")), old, old);
  const fresh = ucBlobPath("quarantena", ids.ws, state.caseId, randomUUID());
  await store.put(fresh, csv("c\n3\n"));
  const r = await cleanupQuarantine(exec!, ENV);
  assert.ok(r.rows >= 1);
  const row = await fileRow(fileId);
  assert.equal(row.deletion_reason, "quarantena_scaduta");
  assert.equal(await store.head(path), null);
  assert.equal(await store.head(orphan), null, "orphan object deleted");
  assert.ok(await store.head(fresh), "an upload in progress is left alone");
  assert.equal((await events("file.cancellato", fileId)).length, 1);
  await store.delete([fresh]);
});

test("table template from the link and the Lateral Space panel data", opts, async () => {
  const l = await link(state.tokenService);
  const file = value(await referentTableTemplate(exec!, l, item("q.servizio.01")));
  const book = XLSX.read(file.bytes, { type: "buffer" });
  assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets.Modello, { header: 1 })[0], ["Canale", "Su 100"]);
  assert.equal(code(await referentTableTemplate(exec!, l, item("q.sistemi.03"))), "voce_non_disponibile", "not this referent's item");
  const panel = await loadUploadPanel(exec!, { workspaceId: ids.ws, caseId: state.caseId, itemId: null, userId: ids.lead, roles: ["ls_lead"], isLateralSpace: true, readOnly: false }, ENV);
  assert.ok(panel);
  assert.equal(panel.upload.allowed, true);
  assert.equal(panel.upload.clientMode, false);
  assert.equal(panel.canManage, true);
  assert.ok(panel.deletable.length >= 1);
  const ownerPanel = await loadUploadPanel(exec!, { workspaceId: ids.ws, caseId: state.caseId, itemId: item("src.hr.turni"), userId: ids.owner, roles: ["owner_cliente"], isLateralSpace: false, readOnly: false }, ENV);
  assert.ok(ownerPanel);
  assert.equal(ownerPanel.upload.allowed, false);
  assert.equal(ownerPanel.canManage, false);
  assert.equal(ownerPanel.target.zone, "personale");
});
