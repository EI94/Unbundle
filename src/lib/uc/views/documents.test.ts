import test from "node:test";
import assert from "node:assert/strict";
import type { CaseRole } from "../vocab.ts";
import { findForbiddenIn } from "./copy-guard.ts";
import { caseFileRows, datasetsWithoutFile, parsePreview, requiredDocumentRows, reviewsText, rowsToCaseFiles, rowsToDatasets, rowsToRequiredDocuments } from "./documents.ts";
import { CONTACT } from "./view.fixtures.ts";

test("required documents: who provides them, after A.8, files and datasets", () => {
  const [doc] = rowsToRequiredDocuments(
    [
      {
        id: "s1",
        key: "src.crm.richieste",
        kind: "fonte",
        title: "Export delle richieste",
        help: "Esportate gli ultimi 12 mesi.",
        status: "bloccata",
        priority: "must",
        privacy_class: "personale",
        availability: ["oggi_export"],
        owner_role_key: "referente_sistemi",
        assignee_contact_id: CONTACT,
        response_type: "dataset",
        spec: { metodo: "export", periodo: "12 mesi", formato: "CSV" },
        active_blockers: ["a8"],
        files: 2,
        datasets: 1,
      },
    ],
    { roles: ["owner_cliente"], roleLabels: { referente_sistemi: "Sistemi" }, contacts: new Map([[CONTACT, { id: CONTACT, name: "Referente sistemi", roleLabel: null, templateRoleKey: null, assignable: true }]]) },
  );
  assert.equal(doc.owner, "Sistemi");
  assert.equal(doc.assignee, "Referente sistemi");
  assert.equal(doc.afterA8, true);
  assert.equal(doc.method, "export");
  assert.equal(doc.request, "Esportate gli ultimi 12 mesi.");
  assert.equal(doc.files, 2);
  assert.equal(doc.canOpen, true);
});

test("the masked preview is read as it is stored; nothing else", () => {
  const p = parsePreview({ schema: "unbundle.uc-preview/1", columns: ["Data", "Email"], rows: [["01/10", "•••"]], masked_columns: [1], total_rows: 300, truncated: true });
  assert.deepEqual(p, { columns: ["Data", "Email"], rows: [["01/10", "•••"]], maskedColumns: [1], totalRows: 300, truncated: true });
  assert.equal(parsePreview(null), null);
  assert.equal(parsePreview({ columns: [], rows: [] }), null);
});

test("files: findings in words without file text, no dates for client roles, no preview for the personal zone", () => {
  const rows = [
    {
      id: "f1",
      item_id: "s1",
      item_key: "src.crm.richieste",
      item_title: "Export",
      file_name: "richieste.csv",
      mime: "text/csv",
      size_bytes: 2048,
      storage_zone: "standard",
      personal_data: "no",
      scan_status: "rifiutato",
      scan_findings: { categoria: "sanitario", colonne: 1, termini: ["visita medica"] },
      content_scanned: true,
      reviewed: false,
      preview: null,
      retention_until: null,
      created_at: "2026-10-03T10:00:00Z",
    },
    { id: "f2", file_name: "turni.xlsx", storage_zone: "personale", scan_status: "pulito", content_scanned: true, preview: { columns: ["a"], rows: [["b"]] }, created_at: "2026-10-03T10:00:00Z" },
  ];
  const [rejected, personal] = rowsToCaseFiles(rows, ["owner_cliente"]);
  assert.deepEqual(rejected.findings, ["Trovati dati sanitari in 1 colonna"]);
  assert.ok(!rejected.findings.join(" ").includes("visita"), "never the terms of the file");
  assert.equal(rejected.usable, false);
  assert.equal(rejected.at, null);
  assert.equal(rejected.size, "2 KB");
  assert.equal(personal.preview, null);
  assert.equal(personal.usable, true);
  assert.ok(rowsToCaseFiles(rows, ["ls_lead"])[0].at);
});

test("datasets: period, rows, controller and quality errors", () => {
  const [d] = rowsToDatasets([
    { id: "d1", source_key: "src.crm.richieste", dataset_version: 2, period_from: "2025-01-01", period_to: "2025-12-31", row_count: 12500, personal_data: "pseudonimizzati", pseudonymized: true, pii_columns: 2, data_controller_label: null, status: "validato", dq_error: true },
  ]);
  assert.equal(d.period, "1 gen 2025 – 31 dic 2025");
  assert.equal(d.rows, "12.500");
  assert.equal(d.controller, "da indicare");
  assert.equal(d.status, "Validato");
  assert.equal(d.dqError, true);
});

// ── Documenti di Domande (DESIGN §3.6.6) ──────────────────────────────

const requiredRow = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  key: "src.crm.richieste",
  kind: "fonte",
  title: "Export dei preventivi dell'ultimo anno (F010)",
  help: null,
  status: "chiesta",
  priority: "must",
  privacy_class: "riservato_azienda",
  availability: [],
  owner_role_key: "referente_sistemi",
  assignee_contact_id: CONTACT,
  response_type: "dataset",
  spec: {},
  active_blockers: [],
  files: 0,
  datasets: 0,
  ...over,
});
const docCtx = (roles: CaseRole[]) => ({ roles, roleLabels: {}, contacts: new Map([[CONTACT, { id: CONTACT, name: "Mario Rossi", roleLabel: null, templateRoleKey: null, assignable: true }]]) });

test("required documents in one row: who provides it, or «File caricato» once a file arrived", () => {
  const docs = rowsToRequiredDocuments(
    [requiredRow(), requiredRow({ id: "s2", title: "Listino prezzi in vigore", status: "validata", files: 1 }), requiredRow({ id: "s3", assignee_contact_id: null, privacy_class: "personale" })],
    docCtx(["ls_lead"]),
  );
  const rows = requiredDocumentRows(docs, "ls");
  assert.deepEqual(
    rows.map((r) => [r.who, r.label, r.missing, r.personal]),
    [
      ["Mario Rossi", "Da fare", false, false],
      ["File caricato", "A posto", false, false],
      ["Senza referente", "Da fare", true, true],
    ],
  );
  assert.equal(rows[0].title, "Export dei preventivi dell'ultimo anno (F010)");
  const client = requiredDocumentRows(rowsToRequiredDocuments([requiredRow()], docCtx(["owner_cliente"])), "cliente");
  assert.equal(client[0].label, "Da rispondere");
  assert.equal(client[0].title, "Export dei preventivi dell'ultimo anno");
  assert.deepEqual(findForbiddenIn(client.flatMap((r) => [r.title, r.label, r.who]), "cliente"), []);
});

test("uploaded files: one grey line, Lateral Space actions from the upload panel, the dataset card of the file", () => {
  const files = rowsToCaseFiles(
    [
      { id: "f1", item_id: "s1", item_key: "src.crm.richieste", item_title: "Export", file_name: "listino.xlsx", size_bytes: 2_097_152, storage_zone: "standard", personal_data: "no", scan_status: "pulito", content_scanned: true, created_at: "2026-10-03T09:00:00Z" },
      { id: "f2", item_id: null, file_name: "nota.pdf", size_bytes: 1000, storage_zone: "personale", personal_data: "identificativi", scan_status: "in_quarantena", content_scanned: false, created_at: "2026-10-03T09:00:00Z" },
    ],
    ["ls_lead"],
  );
  const datasets = rowsToDatasets([{ id: "d1", item_id: "s1", file_id: "f1", source_key: "src.crm.richieste", dataset_version: 1, period_from: "2025-01-01", period_to: "2025-12-31", row_count: 1200, personal_data: "no", data_controller_label: "Cliente Esempio", status: "profilato", retention_until: "2027-01-01" }]);
  const rows = caseFileRows(files, datasets, {
    datasetCandidates: new Set(["f1"]),
    datasetsToDecide: new Map([["f1", { datasetId: "d1", canDecide: false }]]),
    deletable: new Set(["f1", "f2"]),
  });
  assert.equal(rows[0].meta, "Controllato · 2 MB · 3 ott 2026");
  assert.deepEqual(rows[0].actions, { download: true, createDataset: true, decide: null, decideBlocked: true, delete: true });
  assert.equal(rows[0].dataset?.controller, "Cliente Esempio");
  assert.equal(rows[0].item?.title, "Export");
  assert.equal(rows[1].actions.download, false, "personal zone and quarantine: no download");
  assert.equal(rows[1].dataset, null);
  const plain = caseFileRows(files, datasets, null);
  assert.deepEqual(plain[0].actions, { download: true, createDataset: false, decide: null, decideBlocked: false, delete: false });
});

test("each file shows the dataset card made from it: two files of one question, a case document, a deleted file", () => {
  const file = (id: string, itemId: string | null) => ({ id, item_id: itemId, item_key: itemId ? "src.crm.richieste" : null, item_title: itemId ? "Export (F010)" : null, file_name: `${id}.csv`, size_bytes: 10, storage_zone: "standard", personal_data: "no", scan_status: "pulito", content_scanned: true, created_at: "2026-10-03T09:00:00Z" });
  const files = rowsToCaseFiles([file("A", "s1"), file("B", "s1"), file("C", null)], ["ls_lead"]);
  const ds = (id: string, fileId: string | null, itemId: string | null, version: number, status: string, source = "src.crm.richieste") => ({
    id,
    item_id: itemId,
    file_id: fileId,
    source_key: source,
    dataset_version: version,
    data_controller_label: "Cliente Esempio",
    status,
  });
  // Ordered as the query returns them: newest version first.
  const datasets = rowsToDatasets([ds("v2-from-B", "B", "s1", 2, "ricevuto"), ds("v1-from-A", "A", "s1", 1, "validato"), ds("from-C", "C", null, 1, "profilato", "src.caso.nota"), ds("orphan", null, "s1", 1, "rifiutato", "src.vecchia")]);
  const rows = caseFileRows(files, datasets, null);
  assert.deepEqual(
    rows.map((r) => [r.id, r.dataset?.status ?? null]),
    [
      ["A", "Validato"],
      ["B", "Ricevuto"],
      ["C", "Profilato"],
    ],
  );
  // The card of a deleted file stays visible, under «Schede senza file», by the source's title.
  const sources = new Map([["src.vecchia", "Export vecchio (F011)"]]);
  assert.deepEqual(
    datasetsWithoutFile(files, datasets, sources, "ls").map((d) => [d.id, d.title, d.status]),
    [["orphan", "Export vecchio (F011)", "Rifiutato"]],
  );
  assert.equal(datasetsWithoutFile(files, datasets, new Map(), "ls")[0].title, "src.vecchia", "Lateral Space sees the key of a source out of the catalog");
  assert.equal(datasetsWithoutFile(files, datasets, new Map(), "cliente")[0].title, "Scheda dataset", "the client never sees a key");
  assert.equal(datasetsWithoutFile(files, datasets, sources, "cliente")[0].title, "Export vecchio");
  assert.deepEqual(datasetsWithoutFile(files.slice(0, 2), datasets, sources, "ls").map((d) => d.id), ["from-C", "orphan"], "a file out of the list leaves its card here");
});

test("the client reads the question of a file without codes, and never a key", () => {
  const files = rowsToCaseFiles(
    [
      { id: "f1", item_id: "s1", item_key: "src.crm.richieste", item_title: "Export dei preventivi (F010)", file_name: "a.csv", storage_zone: "standard", personal_data: "no", scan_status: "pulito", content_scanned: true },
      { id: "f2", item_id: "s2", item_key: "src.crm.altro", item_title: "", file_name: "b.csv", storage_zone: "standard", personal_data: "no", scan_status: "pulito", content_scanned: true },
    ],
    ["owner_cliente"],
  );
  const client = caseFileRows(files, [], null, "cliente");
  assert.equal(client[0].item?.title, "Export dei preventivi");
  assert.equal(client[1].item?.title, "Domanda senza titolo");
  assert.deepEqual(findForbiddenIn(client.map((r) => r.item?.title ?? ""), "cliente"), []);
  assert.equal(caseFileRows(files, [], null, "ls")[1].item?.title, "src.crm.altro");
  const untitled = requiredDocumentRows(rowsToRequiredDocuments([requiredRow({ title: "" })], docCtx(["owner_cliente"])), "cliente");
  assert.equal(untitled[0].title, "Documento senza titolo");
});

test("files to check by hand, only when there are some", () => {
  assert.equal(reviewsText(0), null);
  assert.equal(reviewsText(1), "1 file da controllare a mano");
  assert.equal(reviewsText(2), "2 file da controllare a mano");
});
