import test from "node:test";
import assert from "node:assert/strict";
import { rowToLoadedItem } from "../sql/transitions.ts";
import type { CaseRole } from "../vocab.ts";
import { findForbiddenIn } from "./copy-guard.ts";
import {
  QUESTION_ACTIONS,
  QUESTION_ACTION_LABEL,
  activityTimeline,
  askAgainLabel,
  canAskAgain,
  itemActions,
  itemNotes,
  linkedItems,
  nonValueAnswerText,
  pendingSignatureNotice,
  questionActionPlan,
  questionAnswerView,
  reviewActionPlan,
  rowsToAnswers,
  rowsToComments,
  rowsToEvents,
  rowsToLinkGroups,
  specEntries,
  statusReasonLine,
} from "./item-detail.ts";
import { ANSWER, CONTACT, LS_USER, OTHER_LS, lsUser, otherLsUser, ownerUser, snapshotRow } from "./view.fixtures.ts";

test("template fields: known labels first, technical keys hidden", () => {
  const entries = specEntries({ zz_extra: "altro", formula: "a / b", unit: "minuti", defaults_applied: ["serves_for"], notes: { privacy: "x" }, kpi_controllo: true });
  assert.deepEqual(entries.map((e) => e.label), ["Unità", "Formula", "KPI di controllo", "Zz extra"]);
  assert.equal(entries.find((e) => e.key === "kpi_controllo")?.value, "sì");
  assert.deepEqual(itemNotes({ notes: { privacy: "personale; riservato", other: "x" } }), [{ label: "Privacy", text: "personale; riservato" }]);
});

const answerRows = [
  {
    id: ANSWER,
    version: 2,
    kind: "valore",
    value: { value: 120, unit: null },
    note: "settimana tipica",
    encrypted: false,
    erased: false,
    valid_from: "2026-09-01",
    valid_to: null,
    confidence: "stima",
    source_kind: "referente",
    source_ref: null,
    source_basis: "stima_a_memoria",
    responder_contact_id: CONTACT,
    responder_contact_name: "Referente servizio",
    responder_user_id: null,
    responder_user_name: null,
    acting_role_key: "resp_servizio",
    supersedes_answer_id: "x",
    files: 1,
    text_hash: null,
    created_at: "2026-10-02T09:00:00Z",
  },
];

test("answer history: Lateral Space sees who and when, client roles do not", () => {
  const opts = { privacyClass: "riservato_azienda" as const, valueVisibility: "owner_e_ls", currentAnswerId: ANSWER, validatedAnswerId: null, roleLabels: { resp_servizio: "Servizio" } };
  const [ls] = rowsToAnswers(answerRows, { ...opts, roles: ["ls_lead"] });
  assert.equal(ls.responder, "Referente servizio");
  assert.ok(ls.at);
  assert.equal(ls.roleLabel, "Servizio");
  assert.equal(ls.confidence, "È una stima");
  assert.equal(ls.basis, "Stima a memoria");
  assert.equal(ls.note, "settimana tipica");
  assert.equal(ls.current, true);
  assert.equal(ls.supersedes, true);
  assert.deepEqual(ls.value, { kind: "value", text: "120" });
  const [owner] = rowsToAnswers(answerRows, { ...opts, roles: ["owner_cliente"] });
  assert.equal(owner.responder, null);
  assert.equal(owner.at, null);
  assert.equal(owner.value.kind, "value");
  const [personal] = rowsToAnswers([{ ...answerRows[0], value: null, note: null, encrypted: true }], { ...opts, privacyClass: "personale", roles: ["ls_lead"] });
  assert.equal(personal.value.kind, "hidden");
  assert.equal(personal.note, null);
});

test("comments: internal ones only for Lateral Space, referents anonymous for client roles", () => {
  const rows = [
    { id: "c1", body: "Da controllare con il bilancio", visibility: "interno_ls", kind: "commento", created_at: "2026-10-02T09:00:00Z", author_user_id: LS_USER, author_user_name: "Analista" },
    { id: "c2", body: "Quale settimana?", visibility: "condiviso", kind: "chiarimento_richiesto", created_at: "2026-10-02T10:00:00Z", resolved_at: null, author_user_id: LS_USER, author_user_name: "Analista" },
    { id: "c3", body: "Quella di marzo", visibility: "condiviso", kind: "risposta_chiarimento", created_at: "2026-10-03T10:00:00Z", author_contact_id: CONTACT, author_contact_name: "Referente servizio", parent_comment_id: "c2" },
  ];
  assert.deepEqual(rowsToComments(rows, ["ls_analista"]).map((c) => c.id), ["c1", "c2", "c3"]);
  const owner = rowsToComments(rows, ["owner_cliente"]);
  assert.deepEqual(owner.map((c) => c.id), ["c2", "c3"]);
  assert.equal(owner[0].open, true);
  assert.equal(owner[1].author, "Referente");
  assert.equal(owner[1].at, null);
  assert.equal(owner[1].replyTo, "c2");
});

test("links are grouped by direction and relation, outgoing first", () => {
  const groups = rowsToLinkGroups([
    { dir: "in", relation: "precisa", id: "q", key: "q.servizio.01", title: "Domanda", kind: "domanda", status: "chiesta" },
    { dir: "out", relation: "alimentato_da", id: "s", key: "src.crm.richieste", title: "Export", kind: "fonte", status: "da_chiedere" },
    { dir: "out", relation: "usa", id: "c", key: "richiesta.canale", title: "Canale", kind: "campo", status: "validata", cardinality: "N:1" },
  ]);
  assert.deepEqual(groups.map((g) => `${g.direction}:${g.relation}:${g.label}`), ["out:usa:Usa", "out:alimentato_da:Alimentata da", "in:precisa:Precisata dalla domanda"]);
  assert.equal(groups[0].items[0].cardinality, "N:1");
});

test("timeline: names only for Lateral Space viewers", () => {
  const rows = [{ id: "e1", event_type: "voce.stato_cambiato", from_state: "chiesta", to_state: "in_verifica", actor_type: "utente", actor_name: "Analista", created_at: "2026-10-02T09:00:00Z" }];
  assert.equal(rowsToEvents(rows, ["ls_lead"])[0].actor, "Analista");
  assert.equal(rowsToEvents(rows, ["owner_cliente"])[0].actor, "Persona con account");
  assert.equal(rowsToEvents(rows, ["ls_lead"])[0].change, "Chiesta, in attesa → Da verificare");
});

const base = { caseStatus: "raccolta" as const, designatedOwnerContactId: null, readOnly: false };

test("actions: the four eyes say why validation is not possible", () => {
  const loaded = rowToLoadedItem(snapshotRow());
  const ok = itemActions({ ...base, loaded, roles: ["ls_analista"], user: lsUser });
  assert.deepEqual(ok.validate, { ok: true });
  assert.equal(ok.clarify, true);
  assert.equal(ok.markMissing, true);
  const answeredByMe = rowToLoadedItem(snapshotRow({ responder_user_ids: [LS_USER] }));
  const mine = itemActions({ ...base, loaded: answeredByMe, roles: ["ls_lead"], user: lsUser });
  assert.equal(mine.validate?.ok, false);
  assert.match(mine.validate && !mine.validate.ok ? mine.validate.message : "", /deve validarla un'altra persona/);
  assert.equal(itemActions({ ...base, loaded: answeredByMe, roles: ["ls_lead"], user: otherLsUser }).validate?.ok, true);
  const declared = rowToLoadedItem(snapshotRow({ a_source_kind: "dichiarato_in_call", a_responder_contact_id: null, a_typed: false }));
  const d = itemActions({ ...base, loaded: declared, roles: ["ls_lead"], user: { ...otherLsUser, userId: OTHER_LS } });
  assert.equal(d.validate?.ok, false);
});

test("actions: read only and closed cases show nothing; the owner signs NA and comments shared", () => {
  const loaded = rowToLoadedItem(snapshotRow());
  const none = itemActions({ ...base, readOnly: true, loaded, roles: ["ls_lead"], user: lsUser });
  assert.equal(none.validate, null);
  assert.equal(none.comment, false);
  assert.equal(itemActions({ ...base, caseStatus: "chiuso", loaded, roles: ["ls_lead"], user: lsUser }).recordValue, null);
  const proposed = rowToLoadedItem(snapshotRow({ status: "da_chiedere", a_id: null, current_answer_id: null, na_proposed_at: "2026-10-03T10:00:00Z", na_reason: "Non serve per questo caso", na_approved_by_user_id: LS_USER }));
  const owner = itemActions({ ...base, loaded: proposed, roles: ["owner_cliente"], user: ownerUser });
  assert.deepEqual(owner.signNa, { ok: true });
  assert.equal(owner.rejectNa, true);
  assert.deepEqual(owner.commentVisibilities, ["condiviso"]);
  assert.equal(owner.validate, null);
  assert.equal(owner.recordValue, null);
  const lead = itemActions({ ...base, loaded: proposed, roles: ["ls_lead"], user: lsUser });
  assert.equal(lead.signNa?.ok, false);
  assert.equal(lead.proposeNa, false);
});

test("actions: no plaintext values for personal items, files from Documents", () => {
  const personal = rowToLoadedItem(snapshotRow({ status: "da_chiedere", privacy_class: "personale", a_id: null, current_answer_id: null }));
  assert.equal(itemActions({ ...base, loaded: personal, roles: ["ls_lead"], user: lsUser }).recordValue?.ok, false);
  const file = rowToLoadedItem(snapshotRow({ status: "da_chiedere", response_type: "file", a_id: null, current_answer_id: null }));
  assert.equal(itemActions({ ...base, loaded: file, roles: ["ls_lead"], user: lsUser }).recordValue?.ok, false);
  const blocked = rowToLoadedItem(snapshotRow({ status: "bloccata", a_id: null, current_answer_id: null, blocker_links: [{ blocker_id: "b", key: "accesso_sistema", origin: "scope", status: "attivo" }] }));
  const b = itemActions({ ...base, loaded: blocked, roles: ["ls_analista"], user: lsUser });
  assert.equal(b.proposeFallback, true);
  assert.equal(b.proposeWaiver?.ok, false);
});

test("actions: who cannot read internal comments does not write them", () => {
  const loaded = rowToLoadedItem(snapshotRow({ status: "validata", validated_answer_id: ANSWER }));
  assert.deepEqual(itemActions({ ...base, loaded, roles: ["ls_sviluppatore"], user: lsUser }).commentVisibilities, []);
  assert.deepEqual(itemActions({ ...base, loaded, roles: ["ls_analista"], user: lsUser }).commentVisibilities, ["interno_ls", "condiviso"]);
  assert.equal(itemActions({ ...base, loaded, roles: ["ls_sviluppatore"], user: lsUser }).recordValue, null);
});

// ── Pannello e pagina della domanda (DESIGN §3.6.5, §3.6.8) ───────────

const NOW = new Date("2026-10-14T10:00:00Z");

test("timeline for the client: state changes in the client words", () => {
  const rows = [{ id: "e1", event_type: "voce.stato_cambiato", from_state: "chiesta", to_state: "in_verifica", actor_type: "utente", actor_name: "Analista", created_at: "2026-10-02T09:00:00Z" }];
  assert.equal(rowsToEvents(rows, ["owner_cliente"])[0].change, "Da rispondere → In verifica");
  assert.equal(rowsToEvents(rows, ["ls_lead"])[0].type, "voce.stato_cambiato");
  assert.equal(rowsToEvents(rows, ["ls_lead"])[0].ts, Date.parse("2026-10-02T09:00:00Z"));
});

test("panel actions: at most two primaries chosen by the state, everything else in «⋯» (§3.6.5)", () => {
  const inReview = itemActions({ ...base, loaded: rowToLoadedItem(snapshotRow()), roles: ["ls_lead"], user: lsUser });
  const p1 = questionActionPlan({ status: "in_verifica", actions: inReview, askAgain: false, reassign: false, client: false });
  assert.deepEqual(p1.primary, ["validate", "clarify"]);
  assert.ok(p1.more.includes("partial"));
  assert.ok(p1.more.includes("missing"));
  assert.ok(!p1.more.includes("validate"));

  const missing = rowToLoadedItem(snapshotRow({ status: "mancante", a_id: null, current_answer_id: null }));
  const actions = itemActions({ ...base, loaded: missing, roles: ["ls_lead"], user: lsUser });
  const p2 = questionActionPlan({ status: "mancante", actions, askAgain: true, reassign: true, client: false });
  assert.deepEqual(p2.primary, ["askAgain", "record"]);
  assert.ok(!p2.more.includes("reassign"), "Lateral Space assigns from Persone or the selection");
  assert.ok(p2.primary.length + p2.more.length <= 13);

  const blocked = rowToLoadedItem(snapshotRow({ status: "bloccata", a_id: null, current_answer_id: null, blocker_links: [{ blocker_id: "b", key: "accesso_sistema", origin: "scope", status: "attivo" }] }));
  const p3 = questionActionPlan({ status: "bloccata", actions: itemActions({ ...base, loaded: blocked, roles: ["ls_lead"], user: lsUser }), askAgain: false, reassign: false, client: false });
  assert.deepEqual(p3.primary, []);
  assert.ok(p3.more.includes("proposeFallback"));

  const na = rowToLoadedItem(snapshotRow({ status: "non_applicabile", a_id: null, current_answer_id: null }));
  const p4 = questionActionPlan({ status: "non_applicabile", actions: itemActions({ ...base, loaded: na, roles: ["ls_lead"], user: lsUser }), askAgain: false, reassign: false, client: false });
  assert.deepEqual(p4.primary, ["reopen"]);

  // A validated question has no «Riapri» command (no validata → riaperta transition): the way to correct it is a new value.
  const ok = rowToLoadedItem(snapshotRow({ status: "validata" }));
  const p5 = questionActionPlan({ status: "validata", actions: itemActions({ ...base, loaded: ok, roles: ["ls_lead"], user: lsUser }), askAgain: false, reassign: false, client: false });
  assert.deepEqual(p5.primary, ["record"]);
});

test("signatures are given only on /firme: the question offers the notice with [Firma], never a sign or reject command (§1.1, §3.11)", () => {
  for (const k of ["signNa", "rejectNa", "signWaiver", "signFallback"]) assert.ok(!(QUESTION_ACTIONS as readonly string[]).includes(k), k);
  const proposed = rowToLoadedItem(snapshotRow({ status: "in_verifica", na_proposed_at: "2026-10-03T10:00:00Z", na_reason: "Non serve", na_approved_by_user_id: null }));
  for (const [roles, user] of [
    [["ls_lead"], lsUser],
    [["owner_cliente"], ownerUser],
  ] as const) {
    const actions = itemActions({ ...base, loaded: proposed, roles: [...roles], user });
    assert.equal(actions.signNa?.ok, true, "the role may sign");
    const plan = questionActionPlan({ status: "in_verifica", actions, askAgain: false, reassign: roles[0] === "owner_cliente", client: roles[0] === "owner_cliente" });
    assert.ok([...plan.primary, ...plan.more].every((k) => (QUESTION_ACTIONS as readonly string[]).includes(k)));
    assert.equal(pendingSignatureNotice(proposed, actions, null)?.canSign, true, "[Firma] → /firme");
  }
});

test("«Verifica una alla volta»: «Altro» holds only partial, missing and «non si applica» (§3.6.4)", () => {
  const must = rowToLoadedItem(snapshotRow({ priority: "must" }));
  const plan = questionActionPlan({ status: "in_verifica", actions: itemActions({ ...base, loaded: must, roles: ["ls_lead"], user: otherLsUser }), askAgain: false, reassign: false, client: false });
  assert.ok(plan.more.includes("proposeWaiver"), "the panel keeps every action");
  const review = reviewActionPlan(plan);
  assert.deepEqual(review.primary, ["validate", "clarify"]);
  assert.deepEqual(review.more, ["partial", "missing", "proposeNa"]);
  assert.deepEqual(reviewActionPlan({ primary: ["validate"], more: ["missing", "record"] }).more, ["missing"]);
});

test("the reason typed with «Manca il dato» or «Risposta parziale» stays visible on the question", () => {
  assert.equal(statusReasonLine("mancante", "Il referente ha risposto «Non lo so»", false), "Manca il dato: il referente ha risposto «Non lo so»");
  assert.equal(statusReasonLine("parziale", "Mancano i dati di marzo", false), "Risposta parziale: mancano i dati di marzo");
  assert.equal(statusReasonLine("in_verifica", "dato scaduto", false), "Da verificare: dato scaduto");
  assert.equal(statusReasonLine("parziale", "IVA esclusa, manca il totale", false), "Risposta parziale: IVA esclusa, manca il totale");
  // The client reads its own words, and only for what is still to complete.
  assert.equal(statusReasonLine("mancante", "Serve l'export di marzo", true), "Ci manca ancora questo dato: serve l'export di marzo");
  assert.equal(statusReasonLine("parziale", "Manca marzo", true), "Da completare: manca marzo");
  assert.equal(statusReasonLine("in_verifica", "dato scaduto", true), null);
  assert.equal(statusReasonLine("chiesta", "Chiarimento richiesto", false), null);
  assert.equal(statusReasonLine("mancante", "  ", false), null);
  assert.deepEqual(findForbiddenIn([statusReasonLine("mancante", "x", true) ?? "", statusReasonLine("parziale", "x", true) ?? ""], "cliente"), []);
});

test("panel actions for the client: one action, «Affida a un altro collega» (§3.6.8)", () => {
  const loaded = rowToLoadedItem(snapshotRow({ status: "chiesta", a_id: null, current_answer_id: null }));
  const actions = itemActions({ ...base, loaded, roles: ["owner_cliente"], user: ownerUser });
  assert.deepEqual(questionActionPlan({ status: "chiesta", actions, askAgain: false, reassign: true, client: true }), { primary: ["reassign"], more: [] });
  assert.deepEqual(questionActionPlan({ status: "chiesta", actions, askAgain: false, reassign: false, client: true }), { primary: [], more: [] });
  assert.deepEqual(findForbiddenIn([QUESTION_ACTION_LABEL.reassign], "cliente"), []);
});

test("«Chiedi di nuovo» only for the lead, with a referent, from the states that can be sent", () => {
  const ok = { status: "mancante" as const, hasAssignee: true, roles: ["ls_lead"] as CaseRole[], writable: true };
  assert.equal(canAskAgain(ok), true);
  assert.equal(canAskAgain({ ...ok, hasAssignee: false }), false);
  assert.equal(canAskAgain({ ...ok, roles: ["ls_analista"] }), false);
  assert.equal(canAskAgain({ ...ok, status: "chiesta" }), false);
  assert.equal(canAskAgain({ ...ok, writable: false }), false);
  assert.equal(askAgainLabel("da_chiedere"), "Chiedi al referente");
  assert.equal(askAgainLabel("mancante"), "Chiedi di nuovo");
});

test("pending signature notice: who is missing, and [Firma] only for who can sign", () => {
  const proposed = rowToLoadedItem(snapshotRow({ status: "da_chiedere", a_id: null, current_answer_id: null, na_proposed_at: "2026-10-03T10:00:00Z", na_reason: "Non serve", na_approved_by_user_id: LS_USER }));
  const owner = itemActions({ ...base, loaded: proposed, roles: ["owner_cliente"], user: ownerUser });
  assert.deepEqual(pendingSignatureNotice(proposed, owner, null), { text: "Serve la firma del cliente per “non si applica”.", canSign: true });
  const lead = itemActions({ ...base, loaded: proposed, roles: ["ls_lead"], user: lsUser });
  assert.equal(pendingSignatureNotice(proposed, lead, null)?.canSign, false);
  assert.equal(pendingSignatureNotice(rowToLoadedItem(snapshotRow()), lead, null), null);
  const waiver = rowToLoadedItem(snapshotRow({ waiver: { motivo: "m", piano: "p", scadenza: "2026-12-01", approvazioni: [] }, waiver_approved_at: null }));
  assert.equal(pendingSignatureNotice(waiver, lead, null)?.text, "Servono le due firme per partire senza risposta.");
});

const versions = (over: Record<string, unknown>[] = []) =>
  rowsToAnswers(
    [
      { ...answerRows[0], created_at: "2026-10-12T09:00:00Z" },
      { ...answerRows[0], id: "older", version: 1, value: { value: 100, unit: null }, created_at: "2026-10-01T09:00:00Z", supersedes_answer_id: null },
      ...over,
    ],
    { privacyClass: "riservato_azienda", valueVisibility: "owner_e_ls", currentAnswerId: ANSWER, validatedAnswerId: null, roleLabels: { resp_servizio: "Commerciale" }, roles: ["ls_lead"] },
  );

test("answer in the panel: value, who and when, checks right below, older versions (§3.6.5)", () => {
  const v = questionAnswerView(
    versions(),
    [
      { id: "v1", checkKey: "range", kind: "automatica", outcome: "avviso", message: "Il valore è fuori dall'intervallo atteso.", by: null, at: null, onCurrentAnswer: true },
      { id: "v2", checkKey: "range", kind: "automatica", outcome: "ok", message: "ok", by: null, at: null, onCurrentAnswer: true },
      { id: "v3", checkKey: "range", kind: "automatica", outcome: "errore", message: "vecchio", by: null, at: null, onCurrentAnswer: false },
    ],
    { client: false, now: NOW },
  );
  assert.ok(v);
  assert.deepEqual(v.value, { kind: "value", text: "120" });
  assert.equal(v.byLine, "Da Referente servizio, Commerciale · 2 giorni fa · È una stima");
  assert.deepEqual(v.checks, [{ outcome: "avviso", message: "Il valore è fuori dall'intervallo atteso." }]);
  assert.deepEqual(v.previous.map((a) => a.id), ["older"]);
  assert.ok(v.details.some(([k]) => k === "Fonte"));
  assert.ok(v.details.some(([k, val]) => k === "Nota" && val === "settimana tipica"));
});

test("answer for the client: only the value, and only if the role sees it (§3.6.8)", () => {
  const client = rowsToAnswers(answerRows, { privacyClass: "riservato_azienda", valueVisibility: "owner_e_ls", currentAnswerId: ANSWER, validatedAnswerId: null, roleLabels: {}, roles: ["owner_cliente"] });
  assert.deepEqual(questionAnswerView(client, [], { client: true, now: NOW }), { value: { kind: "value", text: "120" }, summary: null, declared: false, byLine: null, checks: [], details: [], previous: [] });
  // The referent answered but the role does not see the value: the answer exists, with the reason in place of the value.
  const hidden = rowsToAnswers(answerRows, { privacyClass: "riservato_azienda", valueVisibility: "solo_ls", currentAnswerId: ANSWER, validatedAnswerId: null, roleLabels: {}, roles: ["owner_cliente"] });
  const view = questionAnswerView(hidden, [], { client: true, now: NOW });
  assert.deepEqual(view?.value, { kind: "hidden", reason: "visibilita", text: "Valore non visibile per il tuo ruolo" });
  assert.equal(view?.byLine, null);
  const personal = rowsToAnswers(answerRows, { privacyClass: "personale", valueVisibility: "owner_e_ls", currentAnswerId: ANSWER, validatedAnswerId: null, roleLabels: {}, roles: ["owner_cliente"] });
  assert.equal(questionAnswerView(personal, [], { client: true, now: NOW })?.value.kind, "hidden");
  const delegated = rowsToAnswers([{ ...answerRows[0], kind: "delega", value: null }], { privacyClass: "riservato_azienda", valueVisibility: "owner_e_ls", currentAnswerId: ANSWER, validatedAnswerId: null, roleLabels: {}, roles: ["owner_cliente"] });
  assert.equal(questionAnswerView(delegated, [], { client: true, now: NOW })?.summary, "L'ha girata a un collega");
  // «Il referente non ha ancora risposto» only when nobody answered.
  assert.equal(questionAnswerView([], [], { client: true, now: NOW }), null);
  assert.equal(questionAnswerView([], [], { client: false, now: NOW }), null);
});

test("activity: comments and history in one timeline, newest first, without the duplicate comment events", () => {
  const comments = rowsToComments(
    [
      { id: "c1", body: "Quale settimana?", visibility: "condiviso", kind: "chiarimento_richiesto", created_at: "2026-10-13T10:00:00Z", resolved_at: null, author_user_id: LS_USER, author_user_name: "Luca Verdi" },
    ],
    ["ls_lead"],
  );
  const events = rowsToEvents(
    [
      { id: "e1", event_type: "chiarimento.richiesto", actor_type: "utente", actor_name: "Luca Verdi", created_at: "2026-10-13T10:00:00Z" },
      { id: "e2", event_type: "voce.stato_cambiato", from_state: "in_verifica", to_state: "chiesta", actor_type: "utente", actor_name: "Luca Verdi", created_at: "2026-10-13T10:00:01Z" },
      { id: "e3", event_type: "risposta.inviata", actor_type: "referente", created_at: "2026-10-11T08:00:00Z" },
    ],
    ["ls_lead"],
  );
  const t = activityTimeline(comments, events, NOW);
  assert.deepEqual(t.map((e) => e.id), ["e:e2", "c:c1", "e:e3"]);
  assert.equal(t[1].title, "Chiarimento aperto");
  assert.equal(t[1].meta, "Luca Verdi · ieri");
  assert.equal(t[0].title, "Stato cambiato · Da verificare → Chiesta, in attesa");
});

test("linked questions are counted once", () => {
  const groups = rowsToLinkGroups([
    { dir: "in", relation: "precisa", id: "q", key: "q.servizio.01", title: "Domanda", kind: "domanda", status: "chiesta" },
    { dir: "out", relation: "usa", id: "q", key: "q.servizio.01", title: "Domanda", kind: "domanda", status: "chiesta" },
    { dir: "out", relation: "usa", id: "c", key: "richiesta.canale", title: "Canale", kind: "campo", status: "validata" },
  ]);
  assert.deepEqual(linkedItems(groups).map((i) => i.id), ["q", "c"]);
});

test("answers that are not a value are said in words, never as raw data", () => {
  assert.equal(nonValueAnswerText("non_so", { who_might_know: "il responsabile dei turni" }), "Non lo sa: potrebbe saperlo il responsabile dei turni");
  assert.equal(nonValueAnswerText("non_so", null), "Non lo sa");
  assert.equal(nonValueAnswerText("proposta_na", { reason: "Il costo non cambia." }), "Propone “non si applica”: Il costo non cambia.");
  assert.equal(nonValueAnswerText("delega", {}), "L'ha girata a un collega");
  assert.equal(nonValueAnswerText("valore", { value: 1 }), null);
  const [na] = rowsToAnswers([{ ...answerRows[0], kind: "proposta_na", value: { reason: "Non serve." } }], {
    privacyClass: "riservato_azienda",
    valueVisibility: "owner_e_ls",
    currentAnswerId: ANSWER,
    validatedAnswerId: null,
    roleLabels: {},
    roles: ["ls_lead"],
  });
  assert.equal(na.summary, "Propone “non si applica”: Non serve.");
  assert.equal(questionAnswerView([na], [], { client: false, now: NOW })?.summary, "Propone “non si applica”: Non serve.");
});
