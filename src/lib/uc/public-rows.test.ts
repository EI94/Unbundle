import test from "node:test";
import assert from "node:assert/strict";
import { signedTextHash } from "../db/queries/uc-items.ts";
import { blockerEvidenceHash } from "./blockers.ts";
import {
  buildApprovals,
  declaredSourceLabel,
  fallbackApprovalHash,
  groupReferentModules,
  naApprovalHash,
  parseLinkRow,
  parseModules,
  privacyAcknowledged,
  referentItemFromRow,
  referentItemsFromRows,
  referentMinutes,
  waiverApprovalHash,
  withQuestionCounts,
  zoneApprovalHash,
  type PendingApprovalRows,
  type ReferentRowContext,
} from "./public-rows.ts";
import { OTHER_QUESTIONS_TITLE } from "./public-view.ts";
import { estimateMinutes } from "./request-state.ts";
import { findForbiddenIn } from "./views/copy-guard.ts";
import type { Row } from "./sql/readiness.ts";

const NOW = new Date("2026-10-12T10:00:00Z");
const ME = "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const OTHER = "2e3d4c5b-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const OWNER = "3f4e5d6c-7a8b-4c9d-8e0f-2a3b4c5d6e7f";
const PRIVACY = "4a5f6e7d-8b9c-4d0e-9f1a-3b4c5d6e7f80";
const ITEM = "5b6a7f8e-9c0d-4e1f-8a2b-4c5d6e7f8091";
const ANSWER = "6c7b8a9f-0d1e-4f2a-9b3c-5d6e7f8091a2";
const ctx: ReferentRowContext = { contactId: ME, writable: true, personalZoneOpen: false, delegationDepth: 0, now: NOW };

function itemRow(over: Row = {}): Row {
  return {
    item_id: ITEM,
    ri_state: "da_fare",
    draft: null,
    key: "q.sistemi.07",
    title: "Ogni quanto si può ripetere l'export?",
    explanation: null,
    why: "Per sapere ogni quanto aggiornare i dati.",
    example: "  ",
    help: null,
    spec: { allegato: "Un export di prova" },
    status: "chiesta",
    status_reason: "Chiarimento richiesto",
    response_type: "scelta",
    response_config: { options: ["ogni giorno", "ogni settimana", "ogni mese"] },
    privacy_class: "nessuna",
    value_visibility: "owner_e_ls",
    request_module_key: "m.sistemi.base",
    requires_validity_period: false,
    assignee_contact_id: ME,
    current_answer_id: null,
    a_kind: null,
    a_source_kind: null,
    a_source_ref: null,
    a_responder_contact_id: null,
    a_value: null,
    a_value_normalized: null,
    own_answer: null,
    clarification: null,
    files: [],
    ...over,
  };
}

const declared = (over: Row = {}): Row =>
  itemRow({ current_answer_id: ANSWER, a_kind: "valore", a_source_kind: "dichiarato_in_call", a_source_ref: "F001", a_responder_contact_id: null, a_value: { text: "ogni settimana" }, ...over });

test("link row: every field from one SQL row, nothing for an unusable row", () => {
  const row: Row = {
    token_id: "7d8c9b0a-1e2f-4a3b-8c4d-6e7f8091a2b3",
    request_id: "8e9d0c1b-2f3a-4b4c-9d5e-7f8091a2b3c4",
    case_id: "9f0e1d2c-3a4b-4c5d-8e6f-8091a2b3c4d5",
    workspace_id: "0a1f2e3d-4b5c-4d6e-9f7a-91a2b3c4d5e6",
    contact_id: ME,
    contact_email: "servizio@cliente.test",
    purpose: "raccolta",
    status: "aperta",
    acting_role_key: "resp_servizio",
    delegation_depth: 1,
    expires_at: "2026-11-11T10:00:00.000Z",
    opened: true,
    privacy_ack_at: null,
    privacy_notice_version: null,
    case_status: "sospeso",
    case_code: "CASO-1",
    case_title: "Caso di prova",
    client_label: "Cliente di prova",
    live: false,
  };
  const link = parseLinkRow(row);
  assert.ok(link);
  assert.deepEqual(
    [link.purpose, link.status, link.delegationDepth, link.opened, link.live, link.caseStatus, link.expiresAt.toISOString()],
    ["raccolta", "aperta", 1, true, false, "sospeso", "2026-11-11T10:00:00.000Z"],
  );
  assert.equal(parseLinkRow(undefined), null);
  assert.equal(parseLinkRow({ ...row, token_id: null }), null);
  assert.equal(parseLinkRow({ ...row, purpose: "altro" }), null);
  assert.equal(parseLinkRow({ ...row, expires_at: null }), null);
  assert.equal(privacyAcknowledged({ privacyAckAt: NOW, privacyNoticeVersion: "v1" }, "v1"), true);
  assert.equal(privacyAcknowledged({ privacyAckAt: NOW, privacyNoticeVersion: "v0" }, "v1"), false, "a new notice is shown again");
  assert.equal(privacyAcknowledged({ privacyAckAt: null, privacyNoticeVersion: "v1" }, "v1"), false);
});

test("declared value «dichiarato in call»: shown with its source; prose on a typed question is retyped, not confirmed with one click", () => {
  const v = referentItemFromRow(declared(), ctx);
  assert.ok(v?.toConfirm);
  assert.deepEqual(
    [v.toConfirm.answerId, v.toConfirm.display, v.toConfirm.sourceLabel, v.toConfirm.declaredInCall, v.toConfirm.canConfirm],
    [ANSWER, "ogni settimana", "In una call con Lateral Space", true, false],
    "the source in plain words, never the fact code",
  );
  assert.deepEqual(v.toConfirm.value, { text: "ogni settimana" }, "the value travels for «Correggi»");
  assert.deepEqual(v.toConfirm.prefill, { option: "ogni settimana" });
  const typed = referentItemFromRow(declared({ a_value: { option: "ogni mese" }, a_value_normalized: { option: "ogni mese" } }), ctx);
  assert.equal(typed?.toConfirm?.canConfirm, true, "a typed value is confirmed with «Confermo»");
  const hidden = referentItemFromRow(declared({ value_visibility: "solo_ls", a_value: { option: "ogni mese" }, a_value_normalized: { option: "ogni mese" } }), ctx);
  assert.equal(hidden?.toConfirm, null, "a value the referent cannot see is neither shown nor confirmed: the question is asked normally");
  const fromDoc = referentItemFromRow(declared({ a_source_kind: "documento", a_source_ref: "Listino 2026" }), ctx);
  assert.equal(fromDoc?.toConfirm?.declaredInCall, false);
  assert.equal(fromDoc?.toConfirm?.sourceLabel, "Da un documento: Listino 2026");
  assert.equal(referentItemFromRow(declared({ a_responder_contact_id: ME }), ctx)?.toConfirm, null, "my own answer is not «already told»");
  assert.equal(referentItemFromRow(declared({ a_kind: "non_so" }), ctx)?.toConfirm, null);
  assert.equal(referentItemFromRow(declared({ status: "in_verifica" }), ctx)?.toConfirm, null);
});

test("personal and health items: no declared value, no draft; texts and hints only", () => {
  const personal = referentItemFromRow(declared({ privacy_class: "personale", draft: { v: 1, payload: "x" }, a_value: null }), { ...ctx, personalZoneOpen: true });
  assert.deepEqual([personal?.personal, personal?.toConfirm, personal?.draft, personal?.can.draft, personal?.can.answer], [true, null, null, false, true]);
  const health = referentItemFromRow(itemRow({ privacy_class: "escluso_sanitario", draft: { v: 1 } }), ctx);
  assert.deepEqual([health?.draft, health?.can.answer], [null, false]);
  const v = referentItemFromRow(itemRow({ draft: { v: 1, payload: { option: "ogni giorno" } }, ri_state: "bozza" }), ctx);
  assert.deepEqual(v?.draft, { v: 1, payload: { option: "ogni giorno" } });
  assert.equal(v?.label, "Bozza salvata");
  assert.equal(v?.attachmentHint, "Un export di prova");
  assert.equal(v?.example, null, "blank texts are dropped");
  assert.equal(v?.statusReason, null, "the reason is shown only for missing or partial items");
  assert.equal(referentItemFromRow(itemRow({ status: "parziale", status_reason: "Manca il sabato" }), ctx)?.statusReason, "Manca il sabato");
  assert.equal(referentItemFromRow(itemRow({ status: "boh" }), ctx), null);
});

test("own answer, files and clarification", () => {
  const v = referentItemFromRow(
    itemRow({
      own_answer: { kind: "valore", version: 2, confidence: "stima", value: { value: 1200, unit: "€" }, encrypted: false },
      clarification: "  Intendete giorni lavorativi?  ",
      files: [{ id: "f1", name: "export.csv", size: 120, status: "pulito", usable: true }, { id: "f2", name: "x.pdf", size: 10, status: "in_quarantena", usable: false }, { bad: true }],
    }),
    ctx,
  );
  assert.deepEqual(v?.ownAnswer, { kind: "valore", version: 2, display: "1200 €", value: { value: 1200, unit: "€" }, estimate: true, encrypted: false });
  assert.equal(v?.clarification, "Intendete giorni lavorativi?");
  assert.equal(v?.label, "Ti chiediamo un chiarimento");
  assert.deepEqual(v?.files.map((f) => [f.id, f.usable]), [["f1", true], ["f2", false]]);
  const enc = referentItemFromRow(itemRow({ privacy_class: "personale", own_answer: { kind: "valore", version: 1, value: null, encrypted: true } }), ctx);
  assert.deepEqual([enc?.ownAnswer?.display, enc?.ownAnswer?.value, enc?.ownAnswer?.encrypted], [null, null, true]);
});

test("modules: template order, unknown or missing module in «Altre domande» at the end, minutes", () => {
  const modules = parseModules([
    { key: "m.a", title: "Primo", why: "Perché", instructions: null, estimated_minutes: 15, estimated_label: "15 minuti" },
    { key: "m.b", title: "", estimated_minutes: 0 },
    { title: "senza chiave" },
    "rotto",
  ]);
  assert.deepEqual(modules.map((m) => [m.key, m.title, m.estimatedMinutes]), [["m.a", "Primo", 15], ["m.b", "Argomento 2", null]], "a module without a title never shows its key");
  const rows = [
    itemRow({ item_id: "i1", key: "q.b.01", request_module_key: "m.b" }),
    itemRow({ item_id: "i2", key: "q.x.01", request_module_key: null }),
    itemRow({ item_id: "i3", key: "q.a.01", request_module_key: "m.a" }),
    itemRow({ item_id: "i4", key: "q.z.01", request_module_key: "m.sconosciuto" }),
    itemRow({ item_id: "i5", key: "q.a.02", request_module_key: "m.a" }),
  ];
  const items = referentItemsFromRows(rows, ctx);
  const grouped = groupReferentModules(items, modules);
  assert.deepEqual(grouped.map((g) => [g.key, g.title, g.items.map((i) => i.key)]), [
    ["m.a", "Primo", ["q.a.01", "q.a.02"]],
    ["m.b", "Argomento 2", ["q.b.01"]],
    [null, OTHER_QUESTIONS_TITLE, ["q.x.01", "q.z.01"]],
  ]);
  assert.equal(referentMinutes(items, modules), Math.ceil(15 + 3 * 0.5), "15 once for the module (no question count), half a minute per single choice elsewhere");
  assert.deepEqual(groupReferentModules([], modules), []);
});

test("minutes in proportion: a module estimate covers only the request's share of its questions (DESIGN §4.4 point 5)", () => {
  const modules = withQuestionCounts(parseModules([{ key: "m.a", title: "Primo", estimated_minutes: 20 }, { key: "m.b", title: "Secondo" }]), [
    { key: "m.a", n: 10 },
    { key: "m.b", n: 4 },
    { key: null, n: 3 },
  ]);
  assert.deepEqual(modules.map((m) => m.questionCount), [10, 4]);
  const rows = [
    itemRow({ item_id: "i1", key: "q.a.01", request_module_key: "m.a" }),
    itemRow({ item_id: "i2", key: "q.a.02", request_module_key: "m.a" }),
    itemRow({ item_id: "i3", key: "q.b.01", request_module_key: "m.b", response_type: "testo" }),
    itemRow({ item_id: "i4", key: "q.b.02", request_module_key: "m.b", response_type: "tabella" }),
  ];
  const items = referentItemsFromRows(rows, ctx);
  // 20 × 2/10 = 4 for the first module; 2 (text) + 5 (table) for the second, without an estimate.
  assert.equal(referentMinutes(items, modules), 4 + 2 + 5);
  const grouped = groupReferentModules(items, modules);
  assert.deepEqual(grouped.map((g) => g.questionCount), [10, 4]);
  // Without the counts, the whole estimate (as before).
  assert.equal(referentMinutes(items.slice(0, 2), parseModules([{ key: "m.a", title: "Primo", estimated_minutes: 20 }])), 20);
  // Any module shape with a key takes the counts: the request emails can split the estimate the same way.
  const plain = withQuestionCounts([{ key: "m.a", title: null, roleKey: null, estimatedMinutes: 20 }], [{ key: "m.a", n: 10 }]);
  assert.deepEqual(plain, [{ key: "m.a", title: null, roleKey: null, estimatedMinutes: 20, questionCount: 10 }]);
  assert.equal(estimateMinutes(plain, [{ moduleKey: "m.a" }, { moduleKey: "m.a" }]), 4);
});

test("where a declared value comes from: plain words, never fact codes or keys", () => {
  assert.equal(declaredSourceLabel("dichiarato_in_call", "F010"), "In una call con Lateral Space");
  assert.equal(declaredSourceLabel("documento", "F012 verbale"), "Da un documento");
  assert.equal(declaredSourceLabel("documento", "Listino   2026"), "Da un documento: Listino 2026");
  assert.equal(declaredSourceLabel("documento", null), "Da un documento");
  // Every source code of the seed, also inside a title, and any other internal code (P0-12).
  for (const ref of ["F014a", "F-M3", "F-T12", "E1", "E2", "verbale F012", "f010", "Listino q.prezzi.base", "Contratto art. 5"]) {
    assert.equal(declaredSourceLabel("documento", ref), "Da un documento", ref);
  }
  assert.equal(declaredSourceLabel("documento", "   "), "Da un documento");
  assert.equal(declaredSourceLabel("documento", "Report E10 annuale"), "Da un documento: Report E10 annuale", "only E1 and E2 are source codes");
  const all = (["referente", "lateral_space", "documento", "sistema", "import", "ai_proposta", "dichiarato_in_call"] as const).map((k) => declaredSourceLabel(k, "F001"));
  assert.deepEqual(findForbiddenIn(all, "cliente"), []);
});

const emptyRows: PendingApprovalRows = { na: [], waiversAndFallbacks: [], gates: [], a8: [], zone: [] };

test("approvals: the Owner sees NA, waivers, fallbacks and gates; the privacy approver sees A.8 and zone grants", () => {
  const proposedAt = new Date("2026-10-10T08:00:00Z");
  const waiver = { motivo: "Dato non ancora disponibile", piano: "Arriva con l'export di novembre", scadenza: "2026-12-31", approvazioni: [{ ruolo: "ls_lead", user_id: "u", at: "x", metodo: "account" }] };
  const fallback = { descrizione: "Export CSV autorizzato", valido_per: ["G1"], da_sostituire_entro: "2027-06-30", approvazioni: [] };
  const evidence = { documento: "Scheda privacy", versione: "1.0", data: "2026-10-01", approvatori_per_ruolo: ["approvatore_privacy"], titolo_art_15_2: true, regione_dati_verificata: true, accesso_zona_personale: ["u1"] };
  const grant = { beneficiary_user_id: "b0b0b0b0-1111-4222-8333-444455556666", proposed_by_user_id: "c0c0c0c0-1111-4222-8333-444455556666", at: "2026-10-11T09:00:00.000Z", approvals: [] };
  const rows: PendingApprovalRows = {
    na: [
      { id: ITEM, key: "q.costi.04", title: "Data", na_reason: "La data non serve qui", na_proposed_at: proposedAt, by_referent: true, ls_signed: false, client_user_signed: false, client_contact_id: null },
      { id: "x1", key: "q.costi.05", title: "Firmata", na_reason: "Già firmata dall'Owner", na_proposed_at: proposedAt, by_referent: false, ls_signed: false, client_user_signed: false, client_contact_id: OWNER },
    ],
    waiversAndFallbacks: [{ id: "w1", key: "q.costi.01", title: "Costo", waiver, fallback }],
    gates: [{ id: "g1", gate_key: "G1", computed: { required: 10, ok: 10, summary_text: "G1 · CASO · regola request_modules · 10 richieste, 10 a posto" }, summary_text_hash: "ab".repeat(32), approvals: [{ ruolo: "ls_lead", metodo: "account", at: "x" }], has_evidence: false }],
    a8: [{ id: "a1", key: "a8", evidence, approvals: [], access_names: ["Persona LS"] }],
    zone: [{ user_id: grant.beneficiary_user_id, personal_zone_grant: grant, name: "Analista LS" }],
  };
  // Order, titles and lines belong to the builder's owner (WP9, `views/approvals.test.ts`): here the decisions, the flags and the hashes.
  const owner = buildApprovals({ rows, contactId: OWNER, designated: { owner: OWNER, privacy: PRIVACY } });
  const ofKind = (list: typeof owner, kind: string) => list.find((a) => a.kind === kind)!;
  assert.deepEqual(owner.map((a) => a.kind).sort(), ["deroga", "gate", "na", "ripiego"], "the NA already signed by the Owner is not pending");
  const na = ofKind(owner, "na");
  assert.equal(na.textHash, naApprovalHash({ itemId: ITEM, reason: "La data non serve qui", proposedAt }));
  assert.deepEqual([na.canReject, na.waitingForLs, na.designation], [true, true, "owner"]);
  const deroga = ofKind(owner, "deroga");
  assert.equal(deroga.textHash, signedTextHash({ motivo: waiver.motivo, piano: waiver.piano, scadenza: waiver.scadenza }), "same hash the internal signWaiver checks");
  assert.equal(deroga.textHash, waiverApprovalHash(waiver));
  assert.deepEqual([deroga.canReject, deroga.waitingForLs], [false, false]);
  const ripiego = ofKind(owner, "ripiego");
  assert.equal(ripiego.textHash, signedTextHash({ descrizione: fallback.descrizione, valido_per: ["G1"], da_sostituire_entro: fallback.da_sostituire_entro }), "same hash the internal signFallback checks");
  assert.equal(ripiego.textHash, fallbackApprovalHash(fallback));
  const gate = ofKind(owner, "gate");
  assert.equal(gate.textHash, "ab".repeat(32), "the gate signs the proposal's canonical summary");
  assert.equal(gate.waitingForLs, false);

  const privacy = buildApprovals({ rows, contactId: PRIVACY, designated: { owner: OWNER, privacy: PRIVACY } });
  assert.deepEqual(privacy.map((a) => a.kind).sort(), ["a8", "zona_personale"]);
  assert.equal(ofKind(privacy, "a8").textHash, blockerEvidenceHash(evidence), "A.8 signs the evidence as recorded");
  assert.equal(ofKind(privacy, "zona_personale").textHash, zoneApprovalHash(grant));
  assert.equal(ofKind(privacy, "zona_personale").targetId, grant.beneficiary_user_id);

  assert.deepEqual(buildApprovals({ rows, contactId: OTHER, designated: { owner: OWNER, privacy: PRIVACY } }), [], "a contact no longer designated signs nothing");
  assert.deepEqual(buildApprovals({ rows, contactId: OWNER, designated: { owner: null, privacy: null } }), []);
  assert.deepEqual(buildApprovals({ rows: emptyRows, contactId: OWNER, designated: { owner: OWNER, privacy: OWNER } }), []);
});

test("approvals already signed by the client are not pending; an A.8 signed on older evidence is pending again", () => {
  const evidence = { documento: "Scheda", versione: "2.0", data: "2026-10-02" };
  const oldHash = blockerEvidenceHash({ ...evidence, versione: "1.0" });
  const rows: PendingApprovalRows = {
    ...emptyRows,
    waiversAndFallbacks: [{ id: "w1", key: "k", title: "t", waiver: { motivo: "m", piano: "p", scadenza: "2026-12-31", approvazioni: [{ ruolo: "owner_cliente", metodo: "link", at: "x" }] }, fallback: null }],
    gates: [{ id: "g1", gate_key: "G1", computed: {}, summary_text_hash: "cd".repeat(32), approvals: [{ ruolo: "owner_cliente", metodo: "account", at: "x" }], has_evidence: true }],
    a8: [{ id: "a1", key: "a8", evidence, approvals: [{ ruolo: "approvatore_privacy", metodo: "link", at: "x", text_hash: oldHash }], access_names: [] }],
  };
  assert.deepEqual(buildApprovals({ rows, contactId: OWNER, designated: { owner: OWNER, privacy: null } }), []);
  const a8 = buildApprovals({ rows, contactId: PRIVACY, designated: { owner: null, privacy: PRIVACY } });
  assert.deepEqual(a8.map((a) => a.kind), ["a8"]);
  assert.equal(a8[0].textHash, blockerEvidenceHash(evidence));
});
