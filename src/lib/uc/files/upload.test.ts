import test from "node:test";
import assert from "node:assert/strict";
import { scanText } from "../text/scan.ts";
import { findForbiddenIn } from "../views/copy-guard.ts";
import { buildPdf, pdfTextContent } from "./fixtures.ts";
import { INSPECT_MESSAGES, inspectFile } from "./inspect.ts";
import {
  attachmentHeader,
  canReadFile,
  canReviewFile,
  canUploadTo,
  checkUploadRequest,
  checkZone,
  decideUpload,
  fileUsable,
  maxBytesFor,
  personalZoneOpen,
  servedMime,
  textForScan,
  TEXT_SCAN_MAX_CHARS,
  UPLOAD_MESSAGES,
  zoneForClass,
  type FileAccessFacts,
  type ZoneState,
} from "./upload.ts";
import { UC_UPLOAD_LIMITS } from "./sniff.ts";

// Invented content only: no client values.
const MB = 1024 * 1024;
const csv = (text: string) => Buffer.from(text, "utf8");
const LINES = Array.from({ length: 6 }, (_, i) => `Regola ${i + 1}: il margine per tratta si calcola dal costo orario e dal prezzo proposto`);
const scan = (text: string | null) => (text ? scanText(textForScan(text), { context: "commento" }) : null);

const OPEN: ZoneState = { a8Status: "sciolto", zoneKeyConfigured: true, standardStoreConfigured: true, personalStoreConfigured: true };

test("zone from the privacy class: personal classes go to the personal zone, health data never get files", () => {
  assert.equal(zoneForClass("personale"), "personale");
  assert.equal(zoneForClass("personale_equipaggio"), "personale");
  assert.equal(zoneForClass("riservato_azienda"), "standard");
  assert.equal(zoneForClass("nessuna"), "standard");
  assert.equal(zoneForClass(null), "standard", "case documents");
  assert.equal(zoneForClass("escluso_sanitario"), null);
});

test("the personal zone is closed until A.8 is resolved and the key and the separate store exist", () => {
  assert.ok(checkZone("personale", OPEN).ok);
  assert.ok(personalZoneOpen(OPEN));
  for (const [patch, code] of [
    [{ a8Status: "attivo" }, "zona_personale_chiusa"],
    [{ a8Status: null }, "zona_personale_chiusa"],
    [{ zoneKeyConfigured: false }, "zona_personale_non_configurata"],
    [{ personalStoreConfigured: false }, "zona_personale_non_configurata"],
  ] as const) {
    const s = { ...OPEN, ...patch };
    const r = checkZone("personale", s);
    assert.equal(r.ok ? null : r.code, code);
    assert.equal(personalZoneOpen(s), false);
  }
  const noStore = checkZone("standard", { ...OPEN, standardStoreConfigured: false });
  assert.equal(noStore.ok ? null : noStore.code, "archivio_non_configurato");
  assert.equal(noStore.ok ? null : noStore.message, UPLOAD_MESSAGES.archivio_non_configurato);
});

test("upload request: declaration, allowed extension, size within the mode, personal zone only through the server", () => {
  const ok = checkUploadRequest({ fileName: "../../export tratte.CSV", size: 1200, declaration: true, mode: "server", zone: "standard" });
  assert.ok(ok.ok);
  assert.equal(ok.value.fileName, "export tratte.csv", "no folders in the stored name, lower-case extension");
  assert.equal(ok.value.kind, "csv");
  assert.equal(ok.value.maxBytes, UC_UPLOAD_LIMITS.serverMaxBytes);
  const code = (i: Parameters<typeof checkUploadRequest>[0]) => {
    const r = checkUploadRequest(i);
    return r.ok ? null : r.code;
  };
  assert.equal(code({ fileName: "a.csv", size: 10, declaration: false, mode: "server", zone: "standard" }), "dichiarazione_mancante");
  assert.equal(code({ fileName: "a.exe", size: 10, declaration: true, mode: "server", zone: "standard" }), "estensione_non_ammessa");
  assert.equal(code({ fileName: "a.xls", size: 10, declaration: true, mode: "server", zone: "standard" }), "estensione_non_ammessa");
  assert.equal(code({ fileName: "a.csv", size: 0, declaration: true, mode: "server", zone: "standard" }), "file_vuoto");
  assert.equal(code({ fileName: "a.csv", size: 4 * MB + 1, declaration: true, mode: "server", zone: "standard" }), "file_troppo_grande_server");
  assert.equal(code({ fileName: "a.csv", size: 4 * MB + 1, declaration: true, mode: "client", zone: "standard" }), null);
  assert.equal(code({ fileName: "a.csv", size: 20 * MB + 1, declaration: true, mode: "client", zone: "standard" }), "file_troppo_grande");
  assert.equal(code({ fileName: "a.csv", size: 10, declaration: true, mode: "client", zone: "personale" }), "modalita_server");
  assert.equal(code({ fileName: "", size: 10, declaration: true, mode: "server", zone: "standard" }), "nome_mancante");
  assert.equal(maxBytesFor("client", "personale"), UC_UPLOAD_LIMITS.serverMaxBytes);
  assert.equal(maxBytesFor("client", "standard"), UC_UPLOAD_LIMITS.clientBlobMaxBytes);
});

test("decision: «visita medica» in a header or in a PDF text rejects and deletes; clean files keep a masked preview", () => {
  const header = inspectFile(csv("codice_turno;visita medica;giorno\nT-1;si;lun\n"), "turni.csv", { zone: "standard", a8Resolved: false });
  const d1 = decideUpload(header, scan(header.extractedText), { zone: "standard", a8Resolved: false });
  assert.equal(d1.status, "rifiutato");
  assert.equal(d1.reason, "contenuto_sanitario");
  assert.match(d1.message ?? "", /dati sanitari/);
  assert.equal(d1.findings.categoria, "sanitario");
  assert.equal(JSON.stringify(d1.findings).includes("T-1"), false, "no content in the findings");

  const pdf = buildPdf([{ content: pdfTextContent([...LINES, "Prima del volo serve la visita medica del pilota"]) }]);
  const inPdf = inspectFile(pdf, "procedura.pdf", { zone: "standard", a8Resolved: false });
  const d2 = decideUpload(inPdf, scan(inPdf.extractedText), { zone: "standard", a8Resolved: false });
  assert.equal(d2.status, "rifiutato");
  assert.equal(d2.reason, "contenuto_sanitario");

  const clean = inspectFile(csv("codice_tratta;minuti\nAAA-BBB;95\nCCC-DDD;140\n"), "tratte.csv", { zone: "standard", a8Resolved: false });
  const d3 = decideUpload(clean, scan(clean.extractedText), { zone: "standard", a8Resolved: false });
  assert.equal(d3.status, "pulito");
  assert.equal(d3.personalData, "no");
  assert.deepEqual(d3.preview?.columns, ["codice_tratta", "minuti"]);
  assert.equal(d3.contentScanned, true);
  const personal = decideUpload(clean, scan(clean.extractedText), { zone: "personale", a8Resolved: true });
  assert.equal(personal.preview, null, "no preview in the personal zone");
});

test("decision: tax codes or birth dates in a document reject it outside the open personal zone; names only warn", () => {
  const withCf = inspectFile(csv(LINES.join("\n") + "\nRiferimento RSSMRA80A01H501U\n"), "nota.txt", { zone: "standard", a8Resolved: false });
  assert.equal(withCf.status, "pulito", "the text reader alone lets it through");
  const d = decideUpload(withCf, scan(withCf.extractedText), { zone: "standard", a8Resolved: false });
  assert.equal(d.status, "rifiutato");
  assert.equal(d.reason, "dati_personali");
  const open = decideUpload(withCf, scan(withCf.extractedText), { zone: "personale", a8Resolved: true });
  assert.equal(open.status, "pulito");
  assert.equal(open.personalData, "identificativi");

  const named = inspectFile(csv("Indichiamo Marco Bianchi come responsabile del caso.\n" + LINES.join("\n")), "email.txt", { zone: "standard", a8Resolved: false });
  const dn = decideUpload(named, scan(named.extractedText), { zone: "standard", a8Resolved: false });
  assert.equal(dn.status, "pulito", "a written proof that names a person is still accepted");
  assert.ok(dn.findings.avvisi?.includes("testo_nomi_persona"));
  assert.equal(dn.personalData, "sconosciuto");
});

test("decision: discriminatory preferences in a document are not kept", () => {
  const r = inspectFile(csv(`${LINES.join("\n")}\nIl cliente preferisce solo piloti donne\n`), "note.txt", { zone: "standard", a8Resolved: false });
  const d = decideUpload(r, scan(r.extractedText), { zone: "standard", a8Resolved: false });
  assert.equal(d.status, "rifiutato");
  assert.equal(d.reason, "testo_discriminatorio");
  assert.equal(d.message, UPLOAD_MESSAGES.testo_discriminatorio);
});

test("decision: a scanned PDF waits for review in the standard zone and is refused in the personal one", () => {
  const pdf = buildPdf([{ content: pdfTextContent(["Pagina quasi vuota"]) }]);
  const std = inspectFile(pdf, "scansione.pdf", { zone: "standard", a8Resolved: false });
  const d = decideUpload(std, scan(std.extractedText), { zone: "standard", a8Resolved: false });
  assert.equal(d.status, "revisione_manuale");
  assert.equal(d.findings.revisione_manuale, true);
  assert.equal(d.contentScanned, false);
  const per = inspectFile(pdf, "scansione.pdf", { zone: "personale", a8Resolved: true });
  const dp = decideUpload(per, scan(per.extractedText), { zone: "personale", a8Resolved: true });
  assert.equal(dp.status, "rifiutato");
  assert.equal(dp.reason, "testo_scarso");
});

test("text handed to the scan is capped and never kept", () => {
  assert.equal(textForScan(null), "");
  assert.equal(textForScan("x".repeat(TEXT_SCAN_MAX_CHARS + 10)).length, TEXT_SCAN_MAX_CHARS);
});

test("who uploads and who reviews: Lateral Space, the client owner only for case documents, never the uploader as reviewer", () => {
  assert.ok(canUploadTo(["ls_lead"], { itemId: "x" }));
  assert.ok(canUploadTo(["ls_analista"], { itemId: null }));
  assert.ok(canUploadTo(["owner_cliente"], { itemId: null }));
  assert.equal(canUploadTo(["owner_cliente"], { itemId: "x" }), false);
  for (const roles of [["osservatore"], ["ai_board"], ["approvatore_privacy"], ["ls_sviluppatore"]] as const) {
    assert.equal(canUploadTo(roles, { itemId: null }), false, roles.join());
  }
  assert.ok(canReviewFile({ roles: ["ls_analista"], isLateralSpace: true, userId: "u2", uploadedByUserId: "u1" }).ok);
  assert.ok(canReviewFile({ roles: ["ls_lead"], isLateralSpace: true, userId: "u2", uploadedByUserId: null }).ok, "a referent upload");
  const self = canReviewFile({ roles: ["ls_lead"], isLateralSpace: true, userId: "u1", uploadedByUserId: "u1" });
  assert.equal(self.ok ? null : self.code, "revisore_uguale");
  const client = canReviewFile({ roles: ["owner_cliente"], isLateralSpace: false, userId: "u2", uploadedByUserId: "u1" });
  assert.equal(client.ok ? null : client.code, "attore_non_ammesso");
  assert.equal(canReviewFile({ roles: ["ls_lead"], isLateralSpace: false, userId: "u2", uploadedByUserId: "u1" }).ok, false, "domain no longer Lateral Space");
});

const usable: FileAccessFacts = {
  zone: "standard",
  scanStatus: "pulito",
  contentScanned: true,
  reviewed: false,
  manualReview: false,
  deleted: false,
  uploadedByUserId: "u1",
  item: { status: "in_verifica", privacyClass: "riservato_azienda", valueVisibility: "owner_e_ls" },
};

function read(roles: Parameters<typeof canReadFile>[0]["roles"], file: Partial<FileAccessFacts> = {}, extra: Partial<Parameters<typeof canReadFile>[0]> = {}) {
  const r = canReadFile({ roles, userId: "u2", isLateralSpace: roles.some((x) => x.startsWith("ls_")), personalZoneAccess: false, zoneOpen: false, file: { ...usable, ...file }, ...extra });
  return r.ok ? r.value.motivo : r.code;
}

test("download: same 404 for absent, not yours and not usable; review exception; developer sees validated items only", () => {
  assert.equal(read(["ls_lead"]), "download");
  assert.equal(read(["owner_cliente"]), "download");
  assert.equal(read(["osservatore"]), "file_non_trovato");
  assert.equal(read(["approvatore_privacy"]), "file_non_trovato");
  assert.equal(read(["ls_sviluppatore"]), "file_non_trovato", "item not validated");
  assert.equal(read(["ls_sviluppatore"], { item: { ...usable.item!, status: "validata" } }), "download");
  assert.equal(read(["owner_cliente"], { item: { ...usable.item!, valueVisibility: "solo_ls" } }), "file_non_trovato");
  assert.equal(read(["ls_lead"], { item: { ...usable.item!, privacyClass: "escluso_sanitario" } }), "file_non_trovato");
  assert.equal(read(["ls_lead"], { deleted: true }), "file_non_trovato");
  assert.equal(read(["ls_lead"], { scanStatus: "rifiutato" }), "file_non_trovato");
  assert.equal(read(["ls_lead"], { item: null }), "download", "case documents");
  assert.equal(read(["ls_sviluppatore"], { item: null }), "file_non_trovato");
  // PDF waiting for review: only another Lateral Space person, and only to review it.
  const review = { scanStatus: "in_quarantena" as const, contentScanned: false, manualReview: true };
  assert.equal(read(["ls_analista"], review), "revisione");
  assert.equal(read(["ls_analista"], { ...review, uploadedByUserId: "u2" }), "file_non_trovato");
  assert.equal(read(["owner_cliente"], review), "file_non_trovato");
  assert.equal(read(["ls_lead"], { scanStatus: "in_quarantena", contentScanned: false }), "file_non_trovato", "still in quarantine");
  assert.equal(read(["ls_lead"], { contentScanned: false, reviewed: true }), "download", "reviewed and clean");
  assert.ok(fileUsable({ scanStatus: "pulito", contentScanned: false, reviewed: true, deleted: false }));
});

test("download in the personal zone: Lateral Space with the signed access and the zone open, nobody else", () => {
  const personal = { zone: "personale" as const, item: { status: "in_verifica" as const, privacyClass: "personale" as const, valueVisibility: "owner_e_ls" as const } };
  assert.equal(read(["ls_lead"], personal, { personalZoneAccess: true, zoneOpen: true }), "download");
  assert.equal(read(["ls_lead"], personal, { personalZoneAccess: false, zoneOpen: true }), "file_non_trovato");
  assert.equal(read(["ls_lead"], personal, { personalZoneAccess: true, zoneOpen: false }), "file_non_trovato", "A.8 reactivated or key missing");
  assert.equal(read(["owner_cliente"], personal, { personalZoneAccess: true, zoneOpen: true }), "file_non_trovato");
  assert.equal(read(["approvatore_privacy"], personal, { personalZoneAccess: true, zoneOpen: true }), "file_non_trovato", "metadata only");
});

test("served name and type: cleaned attachment header, only known types", () => {
  const h = attachmentHeader('rapporto "finale"‮.pdf');
  assert.match(h, /^attachment; filename="[^"‮]+"; filename\*=UTF-8''/);
  assert.equal(h.includes("‮"), false);
  assert.equal(attachmentHeader("../../etc/passwd.csv").includes("/"), false);
  assert.equal(servedMime("application/pdf"), "application/pdf");
  assert.equal(servedMime("text/html"), "application/octet-stream");
  assert.equal(servedMime(null), "application/octet-stream");
});

test("upload and inspection messages speak the client's words: «domanda», «scheda privacy», no codes", () => {
  const messages = [...Object.values(UPLOAD_MESSAGES), ...Object.values(INSPECT_MESSAGES)];
  assert.deepEqual(findForbiddenIn(messages, "cliente"), []);
  assert.deepEqual(messages.filter((m) => /\bvoc[ei]\b/i.test(m)), [], "«voce» stays only in Lateral Space's catalog filter (DESIGN §2.6)");
});
