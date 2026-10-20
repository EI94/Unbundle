import test from "node:test";
import assert from "node:assert/strict";
import {
  datasetDecisionSql,
  datasetInsertSql,
  deleteFileSql,
  expireQuarantineSql,
  fileReadEventSql,
  markCleanSql,
  markRejectedSql,
  quarantineInsertSql,
  reviewDecisionSql,
  staleQuarantineSql,
  uploadTargetSql,
} from "./files.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const CONTACT = "44444444-4444-4444-8444-444444444444";
const REQ = "66666666-6666-4666-8666-666666666666";
const ITEM = "77777777-7777-4777-8777-777777777777";
const FILE = "88888888-8888-4888-8888-888888888888";
const SHA = "ab".repeat(32);
const flat = (s: string) => s.replace(/\s+/g, " ");
const ev = { workspaceId: WS, caseId: CASE, actor: { type: "utente" as const, userId: USER } };

test("the quarantine row is born before the bytes, on an open ready case and an item of that case, guarded by uc_require", () => {
  const st = quarantineInsertSql({
    id: FILE,
    workspaceId: WS,
    caseId: CASE,
    itemId: ITEM,
    requestId: REQ,
    contactId: CONTACT,
    userId: null,
    fileName: "export.csv",
    zone: "standard",
    quarantinePath: `uc/q/${WS}/${CASE}/${FILE}`,
    privacyClass: "riservato_azienda",
    maxBytes: 4 * 1024 * 1024,
  });
  const text = flat(st.text);
  assert.match(text, /^WITH uc_cas AS \(INSERT INTO uc_files/);
  assert.match(text, /JOIN uc_items it ON it\.case_id = c\.id AND it\.id = \$\d+::uuid AND it\.deleted_at IS NULL/);
  assert.match(text, /c\.setup_completed_at IS NOT NULL AND c\.status <> 'chiuso'/);
  assert.match(text, /uc_require\(count\(\*\) = \$\d+::int, 'destinazione_non_valida'\)/);
  assert.match(text, /'in_quarantena'/);
  assert.throws(() => quarantineInsertSql({ id: FILE, workspaceId: WS, caseId: CASE, itemId: null, requestId: null, contactId: CONTACT, userId: null, fileName: "a.csv", zone: "standard", quarantinePath: null, privacyClass: "nessuna", maxBytes: 10 }), /richiesta/);
  assert.throws(() => quarantineInsertSql({ id: FILE, workspaceId: WS, caseId: CASE, itemId: null, requestId: null, contactId: null, userId: null, fileName: "a.csv", zone: "standard", quarantinePath: null, privacyClass: "nessuna", maxBytes: 10 }), /un solo autore/);
  assert.throws(() => quarantineInsertSql({ id: "x", workspaceId: WS, caseId: CASE, itemId: null, requestId: null, contactId: null, userId: USER, fileName: "a.csv", zone: "standard", quarantinePath: null, privacyClass: "nessuna", maxBytes: 10 }), /Id non valido/);
});

test("outcomes are compare-and-swap on a row still to check, with the event in the same statement and no file name", () => {
  const clean = markCleanSql({
    ...ev,
    fileId: FILE,
    zone: "standard",
    mime: "text/csv",
    sizeBytes: 120,
    maxBytes: 4096,
    sha256: SHA,
    blobPath: `uc/s/${WS}/${CASE}/${FILE}`,
    encryptionKeyRef: null,
    personalData: "no",
    findings: {},
    preview: { columns: ["a"] },
    contentScanned: true,
  });
  const text = flat(clean.text);
  assert.match(text, /f\.scan_status = 'in_quarantena' AND f\.sha256 IS NULL AND f\.deleted_at IS NULL/);
  assert.match(text, /INSERT INTO uc_events/);
  assert.match(text, /SELECT count\(\*\)::int AS updated FROM u$/);
  assert.equal(JSON.stringify(clean.params).includes("export"), false);
  const payload = clean.params.find((p) => typeof p === "string" && p.includes("outcome"));
  assert.deepEqual(JSON.parse(String(payload)), { mime: "text/csv", size_bytes: 120, zona: "standard", outcome: "pulito" });
  assert.throws(() => markCleanSql({ ...ev, fileId: FILE, zone: "personale", mime: "text/csv", sizeBytes: 1, maxBytes: 10, sha256: SHA, blobPath: "x", encryptionKeyRef: null, personalData: "no", findings: {}, preview: null, contentScanned: true }), /cifratura/);

  const rejected = markRejectedSql({ ...ev, fileId: FILE, zone: "standard", mime: "text/csv", sizeBytes: 9999, maxBytes: 100, sha256: SHA, reason: "contenuto_sanitario", category: "sanitario", findings: { categoria: "sanitario", colonne: 1 }, personalData: "sconosciuto" });
  const rt = flat(rejected.text);
  assert.match(rt, /scan_status = 'rifiutato'/);
  assert.match(rt, /blob_path = NULL, quarantine_path = NULL, preview = NULL, extracted_text = NULL/);
  assert.match(rt, /deleted_at = now\(\), deletion_reason = \$\d+::text/);
  assert.ok(rejected.params.includes(null), "a size over the row limit is not stored");
  const rp = rejected.params.find((p) => typeof p === "string" && p.includes("motivo"));
  assert.deepEqual(JSON.parse(String(rp)), { mime: "text/csv", zona: "standard", motivo: "contenuto_sanitario", categoria: "sanitario" });
});

test("manual review: another Lateral Space person, PDF still waiting, CHECK backs the four eyes", () => {
  const st = reviewDecisionSql({ ...ev, fileId: FILE, reviewerUserId: USER, outcome: "pulito", blobPath: `uc/s/${WS}/${CASE}/${FILE}`, mime: "application/pdf", sizeBytes: 10 });
  const text = flat(st.text);
  assert.match(text, /\(f\.scan_findings ->> 'revisione_manuale'\) = 'true'/);
  assert.match(text, /f\.uploaded_by_user_id IS DISTINCT FROM \$\d+::uuid/);
  assert.match(text, /reviewed_by_user_id = \$\d+::uuid, reviewed_at = now\(\)/);
  const rej = flat(reviewDecisionSql({ ...ev, fileId: FILE, reviewerUserId: USER, outcome: "rifiutato", blobPath: null, mime: null, sizeBytes: null }).text);
  assert.match(rej, /deletion_reason = 'revisione_rifiutata'/);
  assert.throws(() => reviewDecisionSql({ ...ev, fileId: FILE, reviewerUserId: USER, outcome: "pulito", blobPath: null, mime: null, sizeBytes: null }), /Percorso/);
});

test("deletion keeps the proofs used by the case; reads write an event; cleanup touches only quarantine rows", () => {
  const del = flat(deleteFileSql({ ...ev, fileId: FILE, reason: "cancellato_da_ls" }).text);
  assert.match(del, /validated_answer_id/);
  assert.match(del, /evidence_file_id/);
  assert.match(del, /b\.evidence ->> 'file_id'/);
  assert.match(del, /written_evidence_file_id/);
  assert.match(del, /NOT EXISTS \(SELECT 1 FROM used\)/);
  const read = fileReadEventSql({ ...ev, fileId: FILE, zone: "personale", mime: "text/csv", sizeBytes: 3, motivo: "download" });
  assert.match(flat(read.text), /^INSERT INTO uc_events/);
  assert.ok(read.params.includes("file.scaricato"));
  const stale = flat(staleQuarantineSql({ abandonedBefore: new Date("2026-01-01T00:00:00Z"), reviewBefore: new Date("2025-12-25T00:00:00Z") }).text);
  assert.match(stale, /f\.scan_status = 'in_quarantena' AND f\.deleted_at IS NULL/);
  assert.match(stale, /'quarantena_scaduta' ELSE 'revisione_scaduta'/);
  const exp = expireQuarantineSql({ workspaceId: WS, caseId: CASE, fileId: FILE, reason: "quarantena_scaduta", zone: "standard" });
  assert.match(flat(exp.text), /f\.scan_status = 'in_quarantena' AND f\.deleted_at IS NULL/);
  assert.ok(exp.params.includes("sistema") && exp.params.includes("file.cancellato"), "system actor, file.cancellato");
});

test("datasets: progressive version per source, only from a usable file, quality checks only with the item; decisions never by the uploader", () => {
  const input: Parameters<typeof datasetInsertSql>[0] = {
    id: FILE,
    workspaceId: WS,
    caseId: CASE,
    itemId: ITEM,
    fileId: FILE,
    sourceKey: "src.crm.richieste",
    periodFrom: "2026-01-01",
    periodTo: "2026-03-31",
    extractedAt: "2026-04-02",
    extractionMethod: null,
    timezone: "Europe/Rome",
    currency: null,
    rowCount: 3,
    columnMapping: {},
    schema: { columns: [] },
    pseudonymized: false,
    pseudonymizationMethod: null,
    personalData: "no",
    piiColumns: [],
    dataControllerLabel: "Società di esempio",
    quality: {},
    actor: ev.actor,
    checks: [{ checkKey: "dq.righe", outcome: "ok", message: "ok", details: {} }],
  };
  const text = flat(datasetInsertSql(input).text);
  assert.match(text, /coalesce\(\(SELECT max\(x\.dataset_version\)/);
  assert.match(text, /f\.scan_status = 'pulito' AND \(f\.content_scanned OR f\.reviewed_at IS NOT NULL\)/);
  assert.match(text, /INSERT INTO uc_validations/);
  assert.throws(() => datasetInsertSql({ ...input, sourceKey: "chiave con spazi" }), /fonte/);
  assert.equal(flat(datasetInsertSql({ ...input, itemId: null }).text).includes("uc_validations"), false, "quality checks need the item");
  const dec = flat(datasetDecisionSql({ workspaceId: WS, caseId: CASE, datasetId: FILE, userId: USER, outcome: "validato", actor: ev.actor }).text);
  assert.match(dec, /status IN \('ricevuto', 'profilato', 'in_verifica'\)/);
  assert.match(dec, /NOT EXISTS \(SELECT 1 FROM uc_files f WHERE f\.id = d\.file_id AND f\.uploaded_by_user_id = \$\d+::uuid\)/);
});

test("upload target reads the item only within the case and returns the a8 state and the forbidden columns", () => {
  const st = flat(uploadTargetSql({ workspaceId: WS, caseId: CASE, itemId: ITEM }).text);
  assert.match(st, /LEFT JOIN uc_items i ON i\.case_id = c\.id AND i\.id = \$\d+::uuid AND i\.deleted_at IS NULL/);
  assert.match(st, /b\.key = 'a8'/);
  assert.match(st, /forbidden_columns/);
  assert.match(st, /WHERE c\.id = \$\d+::uuid AND c\.workspace_id = \$\d+::uuid$/);
});
