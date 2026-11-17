import test from "node:test";
import assert from "node:assert/strict";
import { invalidLinkResponse, publicAttachmentResponse } from "../../uc/http.ts";
import type { NeedView } from "../needs.ts";
import { TEMPLATE_LIMITS } from "./contract.ts";
import { FILL_IN_LINE, referentNewsParts, referentRequestParts, renderReferentEmail } from "./email.ts";
import { REFERENT_HISTORY_TEXT, referentHistoryText } from "./history.ts";
import { fillInNeedIds, referentNewQuestionsPreview, referentRequestPreview } from "./preview.ts";
import { templateNeeds } from "./questions.ts";
import { submitClosureOf, submitTransitionsOf } from "./submit.ts";
import {
  TEMPLATE_WRITTEN_TABLES,
  fillInQuestionsSql,
  requestTemplatesStatement,
  templateAcceptedStatements,
  templateCheckedEffects,
  templateFirstDownloadStatement,
  templateInsertStatements,
  templateRejectedStatements,
  templateRemoveStatements,
  templateReplaceStatements,
  templateTargetOf,
} from "./template-sql.ts";
import { uploadReferentFile } from "./upload-transport.ts";
import { needTemplateViews, offeredTemplates, templateDownloadAllowed, templateDownloadDecision, toPublicView, type PublicItemRow, type PublicTemplateRow, type TemplateFact } from "./view.ts";
import { toStatement, type UcStatement } from "../../uc/sql/statement.ts";

// «File da compilare» (RUNBOOK §10.21): il team allega a una o più esigenze un file che il referente scarica dal link,
// compila e ricarica con il caricamento di sempre. Prove senza database: gli statement, la vista, la decisione del
// download, l'email, l'invio. Dati inventati: codici XX-00NN, testi di prova.

const WS = "11111111-0000-4000-8000-000000000001";
const UC = "22222222-0000-4000-8000-000000000001";
const USER = "33333333-0000-4000-8000-000000000001";
const OTHER_USER = "33333333-0000-4000-8000-000000000002";
const REQ = "44444444-0000-4000-8000-000000000001";
const NEED_A = "55555555-0000-4000-8000-00000000000a";
const NEED_B = "55555555-0000-4000-8000-00000000000b";
const NEED_C = "55555555-0000-4000-8000-00000000000c";
const FILE_OLD = "66666666-0000-4000-8000-000000000001";
const FILE_NEW = "66666666-0000-4000-8000-000000000002";
const FILE_PDF = "66666666-0000-4000-8000-000000000003";
const FILE_OTHER = "66666666-0000-4000-8000-000000000004";
const FILE_GONE = "66666666-0000-4000-8000-000000000005";

/** Le tabelle che uno statement scrive (INSERT, UPDATE, DELETE), anche dentro una CTE. */
function writtenTables(s: UcStatement): string[] {
  return [...s.text.matchAll(/\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+)/g)].map((m) => m[1]);
}

const ANSWER_EFFECTS = /use_case_needs\s+SET|UPDATE use_case_needs\b|use_case_notifications|use_case_requester_email|use_case_info_state|use_case_ready_state|use_case_alert_email|use_case_need_answers|use_case_need_files|use_case_referent_requests\s+SET|UPDATE use_case_referent_requests\b|use_case_referent_emails/;

function everyTemplateStatement(): UcStatement[] {
  const insert = { fileId: FILE_NEW, workspaceId: WS, useCaseId: UC, userId: USER, fileName: "modello-XX-0001.xlsx", kind: "xlsx", maxBytes: 4 * 1024 * 1024, mode: "server" as const, quarantinePath: null };
  return [
    ...templateInsertStatements({ ...insert, needIds: [NEED_A, NEED_B], replacesId: null }),
    ...templateInsertStatements({ ...insert, needIds: [], replacesId: FILE_OLD }),
    ...templateCheckedEffects({ workspaceId: WS, useCaseId: UC, fileId: FILE_NEW, replacesId: null, userId: USER, outcome: "pulito" }),
    ...templateCheckedEffects({ workspaceId: WS, useCaseId: UC, fileId: FILE_NEW, replacesId: null, userId: USER, outcome: "in_revisione" }),
    ...templateCheckedEffects({ workspaceId: WS, useCaseId: UC, fileId: FILE_NEW, replacesId: FILE_OLD, userId: USER, outcome: "pulito" }),
    ...templateCheckedEffects({ workspaceId: WS, useCaseId: UC, fileId: FILE_NEW, replacesId: FILE_OLD, userId: USER, outcome: "in_revisione" }),
    ...templateAcceptedStatements({ workspaceId: WS, useCaseId: UC, fileId: FILE_PDF, replacesId: null, reviewerUserId: OTHER_USER }),
    ...templateAcceptedStatements({ workspaceId: WS, useCaseId: UC, fileId: FILE_NEW, replacesId: FILE_OLD, reviewerUserId: OTHER_USER }),
    ...templateRejectedStatements({ workspaceId: WS, useCaseId: UC, fileId: FILE_PDF, reviewerUserId: OTHER_USER }),
    ...templateRemoveStatements({ workspaceId: WS, useCaseId: UC, fileId: FILE_OLD, needId: NEED_A, userId: USER }),
    templateFirstDownloadStatement({ workspaceId: WS, useCaseId: UC, requestId: REQ }, FILE_OLD),
  ];
}

test("il file da compilare non cambia lo stato dell'esigenza: niente esigenze, notifiche, avvisi, richieste o risposte", () => {
  const statements = everyTemplateStatement();
  assert.ok(statements.length > 20);
  for (const s of statements) {
    for (const table of writtenTables(s)) assert.ok((TEMPLATE_WRITTEN_TABLES as readonly string[]).includes(table), `scrive ${table}: ${s.text.slice(0, 80)}`);
    assert.doesNotMatch(s.text, ANSWER_EFFECTS, s.text.slice(0, 120));
  }
  // La Storia: solo righe «richiesta_referente» con i codici dei file da compilare (e del controllo dei PDF).
  const codes = statements.flatMap((s) => s.params).filter((p): p is string => typeof p === "string" && /^(da_compilare_|file_)/.test(p));
  assert.deepEqual([...new Set(codes)].sort(), ["da_compilare_aggiunto", "da_compilare_scaricato", "da_compilare_sostituito", "da_compilare_tolto", "file_accettato", "file_rifiutato"]);
});

test("il caricamento: le esigenze dal database (requisito collegato, del cliente o «insieme», ancora da chiedere), al massimo 5 file per esigenza", () => {
  const [lock, needs, limit, insert, links] = templateInsertStatements({
    fileId: FILE_NEW,
    workspaceId: WS,
    useCaseId: UC,
    userId: USER,
    needIds: [NEED_A, NEED_A.toUpperCase(), NEED_B],
    replacesId: null,
    fileName: "modello-XX-0001.xlsx",
    kind: "xlsx",
    maxBytes: 1024,
    mode: "server",
    quarantinePath: null,
  });
  assert.match(lock.text, /pg_advisory_xact_lock\(hashtext\('use_case_template_files'\)/);
  assert.match(needs.text, /n\.type = 'requisito' AND n\.archived_at IS NULL AND \(n\.owner_side IS NULL OR n\.owner_side IN \('cliente', 'insieme'\)\)/);
  assert.match(needs.text, /use_case_need_links nl WHERE nl\.need_id = n\.id AND nl\.use_case_id = /);
  assert.ok(needs.params.some((p) => Array.isArray(p) && p.join(",") === "da_chiedere,chiesta,mancante,parziale"));
  // Due id uguali (maiuscole e minuscole) sono un'esigenza sola.
  assert.ok(needs.params.some((p) => Array.isArray(p) && p.length === 2));
  assert.ok(needs.params.includes(2));
  assert.match(needs.text, /'domanda_non_disponibile'/);
  assert.match(limit.text, /'troppi_file'/);
  assert.ok(limit.params.includes(TEMPLATE_LIMITS.filesPerNeed));
  assert.equal(TEMPLATE_LIMITS.filesPerNeed, 5);
  assert.match(insert.text, /INSERT INTO use_case_template_files [\s\S]*SELECT [\s\S]*FROM use_cases u WHERE u\.id = [\s\S]* AND u\.workspace_id = /);
  assert.match(links.text, /INSERT INTO use_case_template_links \(file_id, need_id, workspace_id, use_case_id\)/);
  // Una versione nuova: nessun legame nuovo, la vecchia deve essere viva e corrente, una sola versione nuova alla volta.
  const replace = templateInsertStatements({ fileId: FILE_NEW, workspaceId: WS, useCaseId: UC, userId: USER, needIds: [], replacesId: FILE_OLD, fileName: "v2.xlsx", kind: "xlsx", maxBytes: 1024, mode: "client", quarantinePath: `uc/q/${WS}/${UC}/${FILE_NEW}` });
  assert.equal(replace.some((s) => /INSERT INTO use_case_template_links/.test(s.text)), false);
  assert.ok(replace.some((s) => /o\.deleted_at IS NULL AND o\.scan_status IN \('pulito', 'in_revisione'\)\s+AND EXISTS \(SELECT 1 FROM use_case_template_links l WHERE l\.file_id = o\.id\)\), 'file_non_trovato'/.test(s.text)));
  assert.ok(replace.some((s) => /p\.replaces_id = .* AND p\.deleted_at IS NULL[\s\S]*'conflitto'/.test(s.text)));
});

test("le richieste dalla scheda: 1–50 esigenze distinte, oppure la versione da sostituire", () => {
  assert.deepEqual(templateTargetOf({ needIds: JSON.stringify([NEED_A, NEED_B, NEED_A]) }), { needIds: [NEED_A, NEED_B], replacesId: null });
  assert.deepEqual(templateTargetOf({ needIds: [NEED_C.toUpperCase()] }), { needIds: [NEED_C], replacesId: null });
  assert.deepEqual(templateTargetOf({ replacesId: FILE_OLD, needIds: [NEED_A] }), { needIds: [], replacesId: FILE_OLD });
  assert.equal(templateTargetOf({ needIds: [] }), null);
  assert.equal(templateTargetOf({ needIds: ["non-un-id"] }), null);
  assert.equal(templateTargetOf({ needIds: "[" }), null);
  assert.equal(templateTargetOf({ replacesId: "x" }), null);
  const many = Array.from({ length: TEMPLATE_LIMITS.needsPerFile + 1 }, (_, i) => `55555555-0000-4000-8000-${String(i).padStart(12, "0")}`);
  assert.equal(templateTargetOf({ needIds: many }), null);
  assert.equal(templateTargetOf({ needIds: many.slice(0, TEMPLATE_LIMITS.needsPerFile) })?.needIds.length, 50);
  // Dal modulo del caricamento dal server: un campo per esigenza, nell'ordine degli indici.
  assert.deepEqual(templateTargetOf({ "needIds.1": NEED_B, "needIds.0": NEED_A, file: "x" }), { needIds: [NEED_A, NEED_B], replacesId: null });
  assert.equal(templateTargetOf({ "needIds.0": "non-un-id" }), null);
});

test("50 esigenze passano dal modulo del caricamento dal server, un campo ciascuna", async () => {
  const { readUploadForm } = await import("../../uc/files/multipart.ts");
  const ids = Array.from({ length: TEMPLATE_LIMITS.needsPerFile }, (_, i) => `55555555-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const form = new FormData();
  form.set("file", new File(["dati di prova"], "modello-XX-0001.xlsx"));
  ids.forEach((id, index) => form.set(`needIds.${index}`, id));
  const request = new Request("https://app.example.test/upload", { method: "POST", body: form });
  const read = await readUploadForm(request);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.deepEqual(templateTargetOf(read.value.fields), { needIds: ids, replacesId: null });
  // Un solo campo con 50 id (oltre 1000 caratteri) il modulo lo scarta: per questo un campo per esigenza.
  assert.ok(JSON.stringify(ids).length > 1000);
});

function need(over: Partial<NeedView> & { id: string }): NeedView {
  return {
    importKey: null,
    version: 1,
    type: "requisito",
    kind: "dato",
    title: "Esigenza di prova",
    detail: null,
    ownerLabel: null,
    ownerSide: "cliente",
    status: "da_chiedere",
    availability: null,
    dueOn: null,
    dueLabel: null,
    dueIsProposal: false,
    forLabel: null,
    sortOrder: 0,
    useCaseIds: [UC],
    archivedAt: null,
    archiveReason: null,
    doneAt: null,
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    ...over,
  };
}

test("quali esigenze accettano un file da compilare: del cliente o «insieme», da chiedere, chieste, mancanti o parziali", () => {
  const ids = (list: NeedView[]) => templateNeeds(list, UC).map((n) => n.id);
  assert.deepEqual(ids([need({ id: NEED_A }), need({ id: NEED_B, ownerSide: "insieme", status: "chiesta" }), need({ id: NEED_C, ownerSide: null, status: "parziale" })]).sort(), [NEED_A, NEED_B, NEED_C].sort());
  assert.deepEqual(ids([need({ id: NEED_A, ownerSide: "lateral_space" }), need({ id: NEED_B, ownerSide: "fornitore" })]), []);
  assert.deepEqual(ids([need({ id: NEED_A, status: "in_verifica" })]), []);
  assert.deepEqual(ids([need({ id: NEED_A, status: "validata" })]), []);
  assert.deepEqual(ids([need({ id: NEED_A, type: "passo" })]), []);
  assert.deepEqual(ids([need({ id: NEED_A, archivedAt: "2026-11-02T09:00:00.000Z" })]), []);
  assert.deepEqual(ids([need({ id: NEED_A, useCaseIds: ["22222222-0000-4000-8000-000000000099"] })]), []);
});

test("«Sostituisci»: la versione nuova prende i legami della vecchia solo pulita (o accettata), con CAS sulla vecchia", () => {
  const replaced = templateCheckedEffects({ workspaceId: WS, useCaseId: UC, fileId: FILE_NEW, replacesId: FILE_OLD, userId: USER, outcome: "pulito" });
  const [cas, move, event] = replaced;
  // Solo la versione di adesso: viva, pulita o in controllo, ancora legata a un'esigenza (mai una rifiutata intanto).
  assert.match(
    cas.text,
    /UPDATE use_case_template_files SET deleted_at = now\(\), deleted_reason = 'sostituito'[\s\S]*deleted_at IS NULL AND scan_status IN \('pulito', 'in_revisione'\)\s+AND EXISTS \(SELECT 1 FROM use_case_template_links l WHERE l\.file_id = \$\d+::uuid\)\s+RETURNING id[\s\S]*'conflitto'/,
  );
  assert.ok(cas.params.includes(FILE_OLD));
  assert.match(move.text, /UPDATE use_case_template_links SET file_id = \$\d+::uuid WHERE file_id = \$\d+::uuid AND workspace_id = /);
  assert.deepEqual(move.params.slice(0, 2), [FILE_NEW, FILE_OLD]);
  assert.ok(event.params.includes("da_compilare_sostituito"));
  assert.deepEqual(replaced.slice(0, 2).map((s) => s.text), templateReplaceStatements({ workspaceId: WS, oldId: FILE_OLD, newId: FILE_NEW }).map((s) => s.text));
  // Un PDF nuovo da controllare non sostituisce niente: il referente ha la vecchia finché non è accettato.
  assert.deepEqual(templateCheckedEffects({ workspaceId: WS, useCaseId: UC, fileId: FILE_NEW, replacesId: FILE_OLD, userId: USER, outcome: "in_revisione" }), []);
  const accepted = templateAcceptedStatements({ workspaceId: WS, useCaseId: UC, fileId: FILE_NEW, replacesId: FILE_OLD, reviewerUserId: OTHER_USER });
  assert.ok(accepted.some((s) => /deleted_reason = 'sostituito'/.test(s.text)));
  assert.ok(accepted.some((s) => /UPDATE use_case_template_links SET file_id/.test(s.text)));
});

function item(over: Partial<PublicItemRow> & { needId: string; position: number }): PublicItemRow {
  return { question: "Domanda di prova", state: "aperta", open: true, visible: true, handled: false, fileRequired: false, draft: null, answer: null, files: [], ...over };
}
const tpl = (id: string, scanStatus: PublicTemplateRow["scanStatus"] = "pulito", fileName = "modello-XX-0001.xlsx"): PublicTemplateRow => ({ id, fileName, sizeBytes: 49_152, scanStatus });

function viewWith(items: PublicItemRow[]) {
  return toPublicView({
    request: { status: "inviata", expiresAt: new Date("2026-12-31T10:00:00Z"), privacyAcceptedAt: new Date("2026-11-10T10:00:00Z"), privacyNoticeVersion: "x", requesterName: "Team di prova", message: null },
    company: "Azienda di prova",
    useCase: { code: "XX-0001", title: "Caso di prova" },
    items,
    privacyContact: "privacy@example.test",
    clientMode: false,
    now: new Date("2026-11-17T10:00:00Z"),
  });
}

test("«Sostituisci» serve la versione nuova: chi ha già il link scarica la nuova, la vecchia non si scarica più", () => {
  const before = viewWith([item({ needId: NEED_A, position: 1, templates: [tpl(FILE_OLD)] }), item({ needId: NEED_B, position: 2, templates: [tpl(FILE_OLD)] })]);
  assert.equal(templateDownloadAllowed(before, FILE_OLD), true);
  // Dopo: la riga vecchia è cancellata (la lettura non la vede), i legami sono della nuova.
  const after = viewWith([item({ needId: NEED_A, position: 1, templates: [tpl(FILE_NEW, "pulito", "modello-XX-0001-v2.xlsx")] }), item({ needId: NEED_B, position: 2, templates: [tpl(FILE_NEW, "pulito", "modello-XX-0001-v2.xlsx")] })]);
  assert.deepEqual(after.questions.map((q) => q.templates?.map((t) => t.name)), [["modello-XX-0001-v2.xlsx"], ["modello-XX-0001-v2.xlsx"]]);
  assert.equal(templateDownloadDecision({ access: "ok", privacyAccepted: true, view: after, fileId: FILE_NEW }), true);
  assert.equal(templateDownloadDecision({ access: "ok", privacyAccepted: true, view: after, fileId: FILE_OLD }), false);
  // Una versione nuova da controllare non c'è ancora: si offre la vecchia.
  const pending = viewWith([item({ needId: NEED_A, position: 1, templates: [tpl(FILE_OLD), tpl(FILE_NEW, "in_revisione")] })]);
  assert.deepEqual(pending.questions[0].templates?.map((t) => t.id), [FILE_OLD]);
});

test("il download dà lo stesso 404 per link scaduto, revocato, altra richiesta, file tolto e file non pulito", async () => {
  const view = viewWith([
    item({ needId: NEED_A, position: 1, templates: [tpl(FILE_OLD), tpl(FILE_PDF, "in_revisione"), tpl(FILE_NEW, "in_quarantena"), tpl(FILE_OTHER, "rifiutato")] }),
    item({ needId: NEED_B, position: 2, open: false, state: "risposta", answer: { body: "Testo di prova", dontKnow: false, submittedAt: new Date("2026-11-12T10:00:00Z") }, templates: [tpl(FILE_OLD)] }),
    // Una domanda «gestita»: il team ci ha già pensato, niente da scaricare.
    item({ needId: NEED_C, position: 3, open: false, handled: true, templates: [tpl(FILE_GONE)] }),
  ]);
  assert.equal(templateDownloadDecision({ access: "ok", privacyAccepted: true, view, fileId: FILE_OLD }), true);
  const refused = [
    ["link scaduto", { access: "scaduto" as const, privacyAccepted: true, fileId: FILE_OLD }],
    ["link revocato", { access: "revocato" as const, privacyAccepted: true, fileId: FILE_OLD }],
    ["link non valido", { access: "non_valido" as const, privacyAccepted: true, fileId: FILE_OLD }],
    ["informativa non letta", { access: "ok" as const, privacyAccepted: false, fileId: FILE_OLD }],
    // Un file di un'altra richiesta (o di un altro workspace, o di un'altra scheda) non è sulla pagina di questo link.
    ["altra richiesta", { access: "ok" as const, privacyAccepted: true, fileId: "66666666-0000-4000-8000-000000000099" }],
    ["file tolto", { access: "ok" as const, privacyAccepted: true, fileId: "66666666-0000-4000-8000-000000000098" }],
    ["file da controllare", { access: "ok" as const, privacyAccepted: true, fileId: FILE_PDF }],
    ["file in quarantena", { access: "ok" as const, privacyAccepted: true, fileId: FILE_NEW }],
    ["file rifiutato", { access: "ok" as const, privacyAccepted: true, fileId: FILE_OTHER }],
    ["domanda gestita", { access: "ok" as const, privacyAccepted: true, fileId: FILE_GONE }],
    ["id non valido", { access: "ok" as const, privacyAccepted: true, fileId: "../etc" }],
  ] as const;
  const reference = invalidLinkResponse();
  const referenceBody = await reference.text();
  for (const [why, c] of refused) {
    assert.equal(templateDownloadDecision({ ...c, view }), false, why);
    // La rotta: senza file, lo stesso 404 del link non valido (il gestore lo dà già per scaduto e revocato).
    const response = publicAttachmentResponse(null);
    assert.equal(response.status, 404, why);
    assert.deepEqual([...response.headers.entries()].sort(), [...reference.headers.entries()].sort(), why);
    assert.equal(await response.text(), referenceBody, why);
  }
});

test("il file arriva sempre come allegato, mai aperto nel browser", () => {
  const ok = publicAttachmentResponse({ body: null, size: 49_152, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", disposition: `attachment; filename="modello.xlsx"; filename*=UTF-8''modello.xlsx` });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-disposition") ?? "", /^attachment; filename="modello\.xlsx"/);
  assert.equal(ok.headers.get("content-security-policy"), "sandbox; default-src 'none'");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.equal(ok.headers.get("content-length"), "49152");
  // Una disposizione che non è un allegato non passa mai.
  assert.equal(publicAttachmentResponse({ body: null, size: null, mime: "text/plain", disposition: "inline" }).headers.get("content-disposition"), "attachment");
});

test("la pagina offre solo i file puliti, una volta ciascuno; mai su una domanda «gestita»", () => {
  assert.deepEqual(offeredTemplates([tpl(FILE_OLD), tpl(FILE_OLD.toUpperCase()), tpl(FILE_PDF, "in_revisione")]), [{ id: FILE_OLD, name: "modello-XX-0001.xlsx", sizeBytes: 49_152 }]);
  const view = viewWith([item({ needId: NEED_C, position: 1, open: false, handled: true, templates: [tpl(FILE_OLD)] })]);
  assert.equal(view.questions[0].state, "gestita");
  assert.equal(view.questions[0].templates, undefined);
});

test("il primo download di ogni versione per ogni richiesta, una riga sola nella Storia", () => {
  const s = templateFirstDownloadStatement({ workspaceId: WS, useCaseId: UC, requestId: REQ }, FILE_OLD);
  assert.match(s.text, /^WITH once AS \(INSERT INTO use_case_template_downloads \(file_id, request_id, workspace_id\)/);
  assert.match(s.text, /ON CONFLICT \(file_id, request_id\) DO NOTHING\s+RETURNING 1\)/);
  assert.match(s.text, /JOIN use_case_referent_requests r ON r\.id = \$\d+::uuid AND r\.workspace_id = f\.workspace_id AND r\.use_case_id = f\.use_case_id/);
  assert.match(s.text, /INSERT INTO use_case_events[\s\S]*NULL::uuid, 'sistema', 'web'[\s\S]*AND EXISTS \(SELECT 1 FROM once\)$/);
  assert.ok(s.params.includes("da_compilare_scaricato"));
  assert.equal(referentHistoryText({ phaseAfter: "da_compilare_scaricato" }), "Chiedi al referente: file da compilare scaricato dal referente");
  assert.equal(REFERENT_HISTORY_TEXT.da_compilare_aggiunto, "file da compilare aggiunto");
  assert.equal(REFERENT_HISTORY_TEXT.da_compilare_sostituito, "file da compilare sostituito");
  assert.equal(REFERENT_HISTORY_TEXT.da_compilare_tolto, "file da compilare tolto");
});

test("«Togli»: il legame se ne va; dall'ultima esigenza il file (e una versione nuova in controllo) si cancella", () => {
  const [, unlink, remove, event] = templateRemoveStatements({ workspaceId: WS, useCaseId: UC, fileId: FILE_OLD, needId: NEED_A, userId: USER });
  assert.match(unlink.text, /DELETE FROM use_case_template_links WHERE file_id = .* AND need_id = .* AND workspace_id = .* AND use_case_id = .* RETURNING file_id[\s\S]*'file_non_trovato'/);
  assert.match(remove.text, /SET deleted_at = now\(\), deleted_reason = 'tolto'[\s\S]*\(id = \$\d+::uuid OR replaces_id = \$\d+::uuid\)[\s\S]*NOT EXISTS \(SELECT 1 FROM use_case_template_links l WHERE l\.file_id = /);
  assert.ok(event.params.includes("da_compilare_tolto"));
});

test("la pagina e l'email leggono solo i file della richiesta, dello use case, non cancellati; l'email conta solo i puliti", () => {
  const page = requestTemplatesStatement({ workspaceId: WS, useCaseId: UC, requestId: REQ });
  assert.match(page.text, /WHERE l\.workspace_id = \$\d+::uuid AND l\.use_case_id = \$\d+::uuid AND f\.deleted_at IS NULL/);
  assert.match(page.text, /l\.need_id IN \(SELECT i\.need_id FROM use_case_referent_request_items i WHERE i\.request_id = /);
  const email = toStatement(fillInQuestionsSql("r"));
  assert.match(email.text, /tf\.deleted_at IS NULL AND tf\.scan_status = 'pulito'/);
  assert.match(email.text, /tl\.workspace_id = r\.workspace_id AND tl\.use_case_id = r\.use_case_id/);
  assert.throws(() => fillInQuestionsSql("r; DROP"));
});

const LINK = "https://app.example.test/rispondi/ucq_abcdefghijklmnopqrstuvwxyz012345";
const requestInput = (over: Partial<Parameters<typeof referentRequestParts>[0]> = {}): Parameters<typeof referentRequestParts>[0] => ({
  template: "richiesta",
  company: "Azienda di prova",
  useCase: { code: "XX-0001", title: "Caso di prova" },
  requesterName: "Team di prova",
  questions: 3,
  message: null,
  expiresAt: new Date("2026-12-17T10:00:00Z"),
  link: LINK,
  replyToKnown: true,
  ...over,
});

test("la riga compare nella mail quando almeno una domanda ha un file da compilare, prima del pulsante", () => {
  assert.equal(FILL_IN_LINE, "Alcune domande hanno un file da compilare: lo scarichi dal link.");
  for (const kind of ["domande", "referente"] as const) {
    const parts = referentRequestParts(requestInput({ kind, fillInQuestions: 2 }));
    const at = parts.blocks.findIndex((b) => "p" in b && b.p === FILL_IN_LINE);
    assert.ok(at > 0, kind);
    assert.ok("link" in parts.blocks[at + 1], `${kind}: subito prima del link`);
    assert.ok(renderReferentEmail(requestInput({ kind, fillInQuestions: 1 })).text.includes(FILL_IN_LINE), kind);
    for (const none of [0, undefined]) {
      assert.equal(referentRequestParts(requestInput({ kind, fillInQuestions: none })).blocks.some((b) => "p" in b && b.p === FILL_IN_LINE), false, `${kind}: senza file`);
    }
  }
  // L'email «nuove» (domande aggiunte alla richiesta), con o senza novità del filo.
  const entry = { useCase: { code: "XX-0001", title: "Caso di prova" }, requesterName: "Team di prova", kind: "nuove" as const, openQuestions: 2, newQuestions: 2, expiresAt: new Date("2026-12-17T10:00:00Z"), link: LINK };
  for (const extra of [{}, { clarifications: 1 }]) {
    const news = referentNewsParts({ ...entry, ...extra, fillInQuestions: 1 }, { company: "Azienda di prova", replyToKnown: true });
    assert.ok(news.blocks.some((b) => "p" in b && b.p === FILL_IN_LINE));
    assert.equal(referentNewsParts({ ...entry, ...extra }, { company: "Azienda di prova", replyToKnown: true }).blocks.some((b) => "p" in b && b.p === FILL_IN_LINE), false);
  }
  // L'anteprima di «Chiedi al referente» è l'email vera: la stessa riga.
  const preview = { company: "Azienda di prova", useCase: { code: "XX-0001", title: "Caso di prova" }, requesterName: "Team di prova", questions: 2, today: new Date("2026-11-17T10:00:00Z"), fillInQuestions: 1 };
  assert.ok(referentRequestPreview({ ...preview, message: null }).blocks.some((b) => "p" in b && b.p === FILL_IN_LINE));
  assert.ok(referentNewQuestionsPreview(preview).blocks.some((b) => "p" in b && b.p === FILL_IN_LINE));
});

test("«con file da compilare» e la riga dell'email contano solo le esigenze con un file pulito", () => {
  const ids = fillInNeedIds({
    [NEED_A]: { templates: [{ status: "pulito" }] },
    [NEED_B.toUpperCase()]: { templates: [{ status: "in_revisione" }, { status: "pulito" }] },
    [NEED_C]: { templates: [{ status: "in_revisione" }] },
  });
  assert.deepEqual([...ids].sort(), [NEED_A, NEED_B].sort());
  assert.equal(fillInNeedIds(null).size, 0);
});

test("il file compilato ricaricato porta l'esigenza a «Da verificare»; il file da compilare da solo non chiude la domanda", () => {
  // Una domanda con il file da compilare e niente altro: manca ancora qualcosa.
  assert.equal(submitClosureOf({ fileRequired: true }, null, 0), null);
  assert.equal(submitClosureOf({ fileRequired: false }, null, 0), null);
  // Il file compilato ricaricato con «Allega il file compilato» è un file del referente: chiude la domanda.
  assert.equal(submitClosureOf({ fileRequired: true }, null, 1), "file");
  // Le altre domande dello stesso file si chiudono con «È già allegato».
  assert.equal(submitClosureOf({ fileRequired: false }, { dontKnow: false, alreadyAttached: true, body: null }, 0), "allegato");
  const ready = [
    { needId: NEED_A, dontKnow: false, alreadyAttached: false, hasDraft: false, hasText: false, documents: 1 },
    { needId: NEED_B, dontKnow: false, alreadyAttached: true, hasDraft: true, hasText: false, documents: 0 },
    { needId: NEED_C, dontKnow: true, alreadyAttached: false, hasDraft: true, hasText: false, documents: 0 },
  ];
  assert.deepEqual(submitTransitionsOf(ready), { inVerifica: [NEED_A, NEED_B], mancante: [NEED_C] });
});

test("«Allega il file compilato» è il caricamento di sempre del referente: stessa rotta, stessa catena", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true, data: { fileId: FILE_NEW, fileName: "compilato.xlsx", sizeBytes: 10, status: "pulito", usable: true, message: null } }), { status: 200 });
  }) as typeof fetch;
  try {
    const token = "ucq_abcdefghijklmnopqrstuvwxyz012345";
    const outcome = await uploadReferentFile({ kind: "referente", token, needId: NEED_A }, new File(["dati di prova"], "compilato.xlsx"), { clientMode: false });
    assert.equal(outcome.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `/api/rispondi/${token}/upload`);
    assert.equal(calls[0].init.credentials, "omit");
    const form = calls[0].init.body as FormData;
    assert.equal(form.get("needId"), NEED_A);
    assert.equal(form.get("needIds"), null);
    // Il file da compilare del team, invece, ha le sue rotte e mai `needId`.
    calls.length = 0;
    await uploadReferentFile({ kind: "da_compilare", workspaceId: WS, useCaseId: UC, needIds: [NEED_A, NEED_B], replacesId: null }, new File(["dati"], "modello.xlsx"), { clientMode: false });
    assert.equal(calls[0].url, `/dashboard/${WS}/use-cases/${UC}/da-compilare/upload`);
    assert.equal(calls[0].init.credentials, "same-origin");
    const teamForm = calls[0].init.body as FormData;
    // Un campo per esigenza: ognuno sotto il limite dei campi del modulo (`readUploadForm`).
    assert.deepEqual([teamForm.get("needIds.0"), teamForm.get("needIds.1"), teamForm.get("needIds.2")], [NEED_A, NEED_B, null]);
    assert.equal(teamForm.get("needIds"), null);
    assert.equal(teamForm.get("needId"), null);
    calls.length = 0;
    await uploadReferentFile({ kind: "da_compilare", workspaceId: WS, useCaseId: UC, needIds: [], replacesId: FILE_OLD }, new File(["dati"], "v2.xlsx"), { clientMode: false });
    assert.equal((calls[0].init.body as FormData).get("replacesId"), FILE_OLD);
  } finally {
    globalThis.fetch = original;
  }
});

const fact = (over: Partial<TemplateFact> & { id: string }): TemplateFact => ({ replacesId: null, name: "modello-XX-0001.xlsx", sizeBytes: 49_152, status: "pulito", uploadedByUserId: USER, needIds: [NEED_A], ...over });

test("sotto l'esigenza: il file, la versione nuova in controllo; un PDF da controllare solo a chi modifica e non l'ha caricato", () => {
  const facts = [fact({ id: FILE_OLD, needIds: [NEED_A, NEED_B] }), fact({ id: FILE_NEW, replacesId: FILE_OLD, status: "in_revisione", needIds: [], name: "modello-v2.pdf" }), fact({ id: FILE_PDF, status: "in_revisione", needIds: [NEED_A] })];
  const o = { workspaceId: WS, useCaseId: UC, canAsk: true };
  const forOther = needTemplateViews(facts, NEED_A, { ...o, viewerId: OTHER_USER });
  assert.deepEqual(forOther.map((t) => t.id), [FILE_OLD, FILE_PDF]);
  assert.equal(forOther[0].href, `/dashboard/${WS}/use-cases/${UC}/da-compilare/${FILE_OLD}`);
  assert.equal(forOther[0].pending?.id, FILE_NEW);
  assert.equal(forOther[0].pending?.canReview, true);
  assert.equal(forOther[1].canReview, true);
  // Chi l'ha caricato non lo controlla e non lo apre.
  const forUploader = needTemplateViews(facts, NEED_A, { ...o, viewerId: USER });
  assert.equal(forUploader[1].canReview, false);
  assert.equal(forUploader[1].href, null);
  assert.equal(forUploader[0].pending?.canReview, false);
  // Chi non modifica «Cosa serve» vede solo i file puliti, senza azioni né versioni in controllo.
  const reader = needTemplateViews(facts, NEED_A, { ...o, canAsk: false, viewerId: OTHER_USER });
  assert.deepEqual(reader.map((t) => [t.id, t.canEdit, t.pending]), [[FILE_OLD, false, null]]);
  assert.deepEqual(needTemplateViews(facts, NEED_C, { ...o, viewerId: OTHER_USER }), []);
});
