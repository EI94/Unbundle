import test from "node:test";
import assert from "node:assert/strict";
import { blockerEvidenceHash } from "../blockers.ts";
import {
  a8FormFromEvidence,
  a8SignatureLines,
  blockerFormFields,
  blockerView,
  buildA8Evidence,
  buildBlockerEvidence,
  canManagePersonalZone,
  dataModeView,
  evidenceRows,
  personalZoneActions,
  personalZoneState,
  privacyCardStatus,
  privacyClassRows,
  privacyQuestionRows,
  type BlockerRowInput,
  type ZoneMemberRow,
  type ZoneViewer,
} from "./privacy.ts";

const FILE = "33333333-3333-4333-8333-333333333333";
const LS_USER = "44444444-4444-4444-8444-444444444444";

const a8Form = {
  documento: "Scheda A.8",
  versione: "1.0",
  data: "2026-10-01",
  approvatori: ["approvatore_privacy", "approvatore_privacy", "owner_cliente"],
  fileId: FILE,
  titolo: true,
  regione: true,
  accesso: [LS_USER],
};

function a8Row(approvals: unknown[], status: BlockerRowInput["status"] = "attivo"): BlockerRowInput {
  const ev = buildA8Evidence(a8Form);
  assert.ok(ev.ok);
  return { id: "b1", key: "a8", label: "", status, items: 19, evidence: ev.value, approvals: approvals as never, resolvedAt: null, fallbackAllowed: null };
}

test("A.8 evidence from the form is deduplicated and checked like on the server", () => {
  const ev = buildA8Evidence(a8Form);
  assert.ok(ev.ok);
  assert.deepEqual(ev.value.approvatori_per_ruolo, ["approvatore_privacy", "owner_cliente"]);
  assert.equal(buildA8Evidence({ ...a8Form, titolo: false }).ok, false);
  assert.equal(buildA8Evidence({ ...a8Form, regione: false }).ok, false);
  assert.equal(buildA8Evidence({ ...a8Form, fileId: "" }).ok, false);
  assert.equal(buildA8Evidence({ ...a8Form, approvatori: ["Mario Rossi"] }).ok, false, "roles, never names");
  assert.equal(buildA8Evidence({ ...a8Form, accesso: [] }).ok, true, "nobody in the personal zone is allowed");
});

test("A.8 signatures count only on the recorded evidence", () => {
  const evidence = buildA8Evidence(a8Form);
  assert.ok(evidence.ok);
  const hash = blockerEvidenceHash(evidence.value);
  const ls = { ruolo: "ls_lead", user_id: "u", at: "2026-10-02T09:00:00Z", text_hash: hash, metodo: "account" };
  const old = { ruolo: "approvatore_privacy", user_id: "p", at: "2026-10-01T09:00:00Z", text_hash: "0".repeat(64), metodo: "account" };
  const view = blockerView(a8Row([ls, old]));
  assert.equal(view.label, "Scheda privacy");
  assert.deepEqual(view.a8, { evidenceComplete: true, ls: { at: "2026-10-02T09:00:00Z", metodo: "account" }, cliente: null, waitingFor: "cliente" });
  const both = blockerView(a8Row([ls, { ...old, text_hash: hash }], "sciolto"));
  assert.equal(both.a8?.waitingFor, null);
  assert.equal(both.tone, "verde");
  const none = blockerView({ ...a8Row([]), evidence: null });
  assert.deepEqual(none.a8, { evidenceComplete: false, ls: null, cliente: null, waitingFor: null });
});

test("evidence rows are readable and show names only from lookups", () => {
  const ev = buildA8Evidence(a8Form);
  assert.ok(ev.ok);
  const rows = evidenceRows(ev.value, { files: new Map([[FILE, "scheda.pdf"]]), people: new Map([[LS_USER, "Analista"]]), roles: { owner_cliente: "Owner" } });
  assert.deepEqual(rows, [
    ["Documento", "Scheda A.8"],
    ["Versione", "1.0"],
    ["Approvata il", "01/10/2026"],
    ["Chi l'ha approvata", "approvatore_privacy, Owner"],
    ["File firmato", "scheda.pdf"],
    ["Titolo per usare i dati", "Sì"],
    ["Regioni dei dati verificate", "Sì"],
    ["Chi accede ai dati personali", "Analista"],
  ]);
  assert.deepEqual(evidenceRows({ segreto: "x" }), []);
  assert.ok(rows.every(([label]) => !/art\.|A\.8/.test(label)), "no articles or acronyms in the labels");
});

test("other blockers: forms ask for the evidence the server requires", () => {
  assert.equal(blockerFormFields("costi_art_8_4").file, "obbligatorio");
  assert.equal(blockerFormFields("accesso_sistema").descrizione, "obbligatoria");
  assert.equal(buildBlockerEvidence("decisione_board", { fileId: FILE, data: "2026-10-01", descrizione: "" }).ok, true);
  assert.equal(buildBlockerEvidence("decisione_board", { fileId: "", data: "2026-10-01", descrizione: "" }).ok, false);
  assert.equal(buildBlockerEvidence("accesso_sistema", { fileId: "", data: "2026-10-01", descrizione: "Accesso in lettura attivo" }).ok, true);
  assert.equal(buildBlockerEvidence("a8", { fileId: FILE, data: "2026-10-01", descrizione: "" }).ok, false);
  const health = blockerView({ id: "b2", key: "sanitario", label: "Dati sanitari: mai", status: "permanente", items: 0, evidence: null, approvals: [], resolvedAt: null, fallbackAllowed: null });
  assert.equal(health.tone, "rosso");
  assert.match(health.resolver, /mai/);
});

test("data mode, privacy classes and personal zone in plain words", () => {
  assert.equal(dataModeView("solo_sintetici").label, "Solo dati sintetici");
  assert.equal(dataModeView("altro").label, "altro");
  const rows = privacyClassRows({ personale: 3, nessuna: 10 });
  assert.equal(rows.length, 5);
  assert.equal(rows[0].key, "escluso_sanitario");
  assert.equal(rows.find((r) => r.key === "personale")?.count, 3);
  for (const lsViewer of [true, false]) {
    assert.equal(personalZoneState({ a8Status: "attivo", keyConfigured: true, activeMembers: 0, lsViewer }).open, false);
    assert.equal(personalZoneState({ a8Status: "sciolto", keyConfigured: false, activeMembers: 0, lsViewer }).open, false);
    assert.equal(personalZoneState({ a8Status: "sciolto", keyConfigured: true, activeMembers: 2, lsViewer }).text, "2 persone con accesso");
    assert.equal(personalZoneState({ a8Status: "sciolto", keyConfigured: true, activeMembers: 1, lsViewer }).text, "1 persona con accesso");
    for (const s of [personalZoneState({ a8Status: "attivo", keyConfigured: true, activeMembers: 0, lsViewer }), personalZoneState({ a8Status: "sciolto", keyConfigured: false, activeMembers: 0, lsViewer })]) {
      assert.doesNotMatch(s.text, /A\.8|art\./);
    }
  }
  // Without the zone key: the configuration reason for Lateral Space, a plain sentence for the client.
  assert.equal(
    personalZoneState({ a8Status: "sciolto", keyConfigured: false, activeMembers: 0, lsViewer: true }).text,
    "Chiusa: la scheda privacy è firmata, ma manca la chiave nella configurazione.",
  );
  const client = personalZoneState({ a8Status: "sciolto", keyConfigured: false, activeMembers: 0, lsViewer: false }).text;
  assert.equal(client, "Chiusa: si apre dopo l'attivazione da parte di Lateral Space.");
  assert.doesNotMatch(client, /chiave|configurazione/);
  for (const mode of ["solo_sintetici", "pseudonimizzati", "reali"]) assert.doesNotMatch(dataModeView(mode).help, /A\.8|art\./);
});

test("questions by privacy class hide the classes with nothing in them", () => {
  const rows = privacyQuestionRows({ all: { personale: 3, nessuna: 10 }, questions: { personale: 2 } });
  assert.deepEqual(
    rows.map((r) => [r.key, r.questions, r.all]),
    [
      ["personale", 2, 3],
      ["nessuna", 0, 10],
    ],
  );
  assert.deepEqual(privacyQuestionRows({ all: {}, questions: {} }), []);
});

test("the privacy card says what is missing, in plain words", () => {
  const ev = buildA8Evidence(a8Form);
  assert.ok(ev.ok);
  const hash = blockerEvidenceHash(ev.value);
  const ls = { ruolo: "ls_lead", user_id: "u", at: "2026-10-02T09:00:00Z", text_hash: hash, metodo: "account" };
  const client = { ruolo: "approvatore_privacy", contact_id: "c", at: "2026-10-03T09:00:00Z", text_hash: hash, metodo: "link" };
  assert.deepEqual(privacyCardStatus(blockerView({ ...a8Row([]), evidence: null })), {
    text: "Lateral Space non ha ancora registrato la scheda firmata.",
    tone: "lucchetto",
    waiting: "lateral_space",
  });
  assert.equal(privacyCardStatus(blockerView(a8Row([ls]))).text, "Manca la firma del cliente.");
  assert.equal(privacyCardStatus(blockerView(a8Row([ls]))).waiting, "cliente");
  assert.equal(privacyCardStatus(blockerView(a8Row([client]))).text, "Manca la firma di Lateral Space.");
  assert.equal(privacyCardStatus(blockerView(a8Row([]))).text, "Mancano le firme di Lateral Space e del cliente.");
  const done = privacyCardStatus(blockerView(a8Row([ls, client], "sciolto")));
  assert.equal(done.tone, "verde");
  assert.equal(done.waiting, null);
  for (const v of [blockerView(a8Row([ls])), blockerView(a8Row([client])), blockerView(a8Row([ls, client], "sciolto"))]) {
    assert.doesNotMatch(privacyCardStatus(v).text, /A\.8|art\./);
  }
});

test("A.8 form is prefilled from the recorded evidence, and signatures read in plain words", () => {
  const ev = buildA8Evidence(a8Form);
  assert.ok(ev.ok);
  const form = a8FormFromEvidence(ev.value);
  assert.deepEqual(form, { ...a8Form, approvatori: ["approvatore_privacy", "owner_cliente"] });
  assert.deepEqual(a8FormFromEvidence(null), { documento: "", versione: "", data: "", approvatori: [], fileId: "", titolo: false, regione: false, accesso: [] });
  const hash = blockerEvidenceHash(ev.value);
  const view = blockerView(a8Row([{ ruolo: "ls_lead", user_id: "u", at: "2026-10-02T09:00:00Z", text_hash: hash, metodo: "account" }]));
  const lines = a8SignatureLines(view, (iso) => (iso ? iso.slice(0, 10) : null));
  assert.deepEqual(
    lines.map((l) => [l.role, l.signed, l.text]),
    [
      ["ls_lead", true, "firmata il 2026-10-02"],
      ["approvatore_privacy", false, "da firmare"],
    ],
  );
  assert.deepEqual(
    lines.map((l) => l.label),
    ["Lateral Space", "Cliente"],
  );
  const viaLink = blockerView(a8Row([{ ruolo: "approvatore_privacy", contact_id: "c", at: "2026-10-03T09:00:00Z", text_hash: hash, metodo: "link" }]));
  assert.equal(a8SignatureLines(viaLink, () => "3 ott")[1].text, "firmata il 3 ott dal link");
  assert.deepEqual(a8SignatureLines(blockerView({ id: "x", key: "costi_art_8_4", label: "", status: "attivo", items: 0, evidence: null, approvals: [], resolvedAt: null, fallbackAllowed: null }), () => null), []);
});

test("personal zone: the lead proposes, the privacy approver signs, anyone of them (or the person) revokes; a pure module the server page can call", () => {
  const LEAD = "55555555-5555-4555-8555-555555555555";
  const APPROVER = "66666666-6666-4666-8666-666666666666";
  const member = (over: Partial<ZoneMemberRow>): ZoneMemberRow => ({ userId: LS_USER, name: "Luca Verdi", state: "no", inA8List: true, proposedBy: null, ...over });
  const lead: ZoneViewer = { userId: LEAD, lead: true, privacyApprover: false, write: true, paused: false };
  const approver: ZoneViewer = { userId: APPROVER, lead: false, privacyApprover: true, write: true, paused: false };

  assert.deepEqual(personalZoneActions(member({}), lead), { self: false, propose: true, sign: false, revoke: false });
  assert.equal(personalZoneActions(member({ inA8List: false }), lead).propose, false, "only who is in the privacy form");
  assert.equal(personalZoneActions(member({ userId: LEAD }), lead).propose, false, "never for oneself");
  assert.equal(personalZoneActions(member({}), { ...lead, paused: true }).propose, false, "no new access while paused");
  assert.deepEqual(personalZoneActions(member({ state: "in_attesa", proposedBy: LEAD }), approver), { self: false, propose: false, sign: true, revoke: true });
  assert.equal(personalZoneActions(member({ state: "in_attesa" }), { ...approver, paused: true }).sign, false);
  // Revoking stays possible while paused, also for the person who has access.
  assert.equal(personalZoneActions(member({ state: "attiva" }), { ...lead, paused: true }).revoke, true);
  assert.equal(personalZoneActions(member({ state: "attiva" }), { userId: LS_USER, lead: false, privacyApprover: false, write: true, paused: false }).revoke, true);
  assert.equal(personalZoneActions(member({ state: "attiva" }), { ...lead, write: false }).revoke, false, "read-only viewers do nothing");

  assert.equal(canManagePersonalZone([member({})], lead), true);
  assert.equal(canManagePersonalZone([member({})], approver), false, "nothing to sign yet");
  assert.equal(canManagePersonalZone([member({ state: "in_attesa" })], approver), true);
  assert.equal(canManagePersonalZone([], lead), false);
});
