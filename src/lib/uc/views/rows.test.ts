import test from "node:test";
import assert from "node:assert/strict";
import { ITEM_STATUSES, type CaseRole } from "../vocab.ts";
import { NONE, QUESTION_SEGMENT_LABEL } from "./catalog-filter.ts";
import { findForbiddenIn } from "./copy-guard.ts";
import {
  CATALOG_VALUE_MAX,
  dueView,
  parseCaseViewContext,
  questionGroups,
  questionSegmentItems,
  questionTopicGroups,
  topicCount,
  roleLabelsFrom,
  rowToCatalogRow,
  rowToContact,
  rowToQuestionRow,
  clientPlainText,
  rowsToFacet,
  rowsToQuestionCounts,
  rowsToRoleGroups,
  rowsToSelection,
} from "./rows.ts";
import { statusView } from "./status-groups.ts";
import { CASE_ID, CONTACT } from "./view.fixtures.ts";

test("role labels come from the template, with the case labels on top", () => {
  const labels = roleLabelsFrom([{ key: "resp_servizio", label: "Responsabile del servizio" }, { key: "sistemi" }], { role_labels: { resp_servizio: "Responsabile dell'assistenza" } });
  assert.deepEqual(labels, { resp_servizio: "Responsabile dell'assistenza", sistemi: "sistemi" });
});

test("case context with modules in template order", () => {
  const ctx = parseCaseViewContext({
    id: CASE_ID,
    code: "SERV-1",
    title: "Caso",
    status: "raccolta",
    settings: {},
    catalog_version: 0,
    template_key: "esempio.minimo",
    template_name: "Esempio",
    template_version: "1.0.0",
    template_roles: [],
    modules: [{ key: "m.b", title: "Secondo", role_key: null }, { key: "m.a", title: null }],
  });
  assert.ok(ctx);
  assert.deepEqual(ctx.modules, [
    { key: "m.b", title: "Secondo", roleKey: null },
    { key: "m.a", title: "m.a", roleKey: null },
  ]);
  assert.equal(parseCaseViewContext({ ...ctx, status: "boh" }), null);
});

const contact = rowToContact({ id: CONTACT, display_name: "Referente servizio", role_label: "Servizio", template_role_key: "resp_servizio", is_active: true, anonymized: false });

test("catalog rows: declared value in grey, value hidden for roles that should not see it", () => {
  const row = {
    id: "i1",
    key: "q.servizio.01",
    kind: "domanda",
    title: "Quante richieste?",
    status: "in_verifica",
    privacy_class: "riservato_azienda",
    value_visibility: "owner_e_ls",
    serves_for: ["modello"],
    availability: ["oggi_export"],
    owner_role_key: "resp_servizio",
    assignee_contact_id: CONTACT,
    due_at: "2026-10-20T10:00:00Z",
    due_is_proposal: true,
    a_version: 1,
    a_kind: "valore",
    a_source_kind: "dichiarato_in_call",
    a_source_ref: "F012",
    a_value: { text: "circa 120" },
    a_encrypted: false,
    a_erased: false,
  };
  const ctx = { contacts: new Map([[CONTACT, contact]]), roleLabels: { resp_servizio: "Servizio clienti" } };
  const lead = rowToCatalogRow(row, { ...ctx, roles: ["ls_lead"] });
  assert.equal(lead.answer?.declared, true);
  assert.equal(lead.answer?.provenance, "Dichiarato in call · F012");
  assert.deepEqual(lead.answer?.value, { kind: "value", text: "circa 120" });
  assert.equal(lead.assigneeName, "Referente servizio");
  assert.equal(lead.ownerRoleLabel, "Servizio clienti");
  assert.equal(lead.due, "20 ott 2026");
  assert.equal(lead.dueIsProposal, true);
  assert.equal(rowToCatalogRow(row, { ...ctx, roles: ["osservatore"] }).answer?.value.kind, "hidden");
  assert.equal(rowToCatalogRow({ ...row, a_kind: null, a_source_kind: null }, { ...ctx, roles: ["ls_lead"] }).answer, null);
});

test("facets, role groups as counts, and the selection of all results by status", () => {
  assert.deepEqual(rowsToFacet([{ v: "chiesta", n: 3 }, { v: "validata", n: "2" }, { v: null, n: 4 }]), { chiesta: 3, validata: 2 });
  const groups = rowsToRoleGroups(
    [
      { role_key: "resp_servizio", items: 2, unassigned: "1" },
      { role_key: "vuoto", items: 0, unassigned: 0 },
    ],
    { resp_servizio: "Servizio" },
    [contact],
  );
  assert.deepEqual(groups, [{ roleKey: "resp_servizio", roleLabel: "Servizio", itemCount: 2, unassignedCount: 1, suggestedContactIds: [CONTACT] }]);
  const sel = rowsToSelection(
    [
      { id: "a", status: "da_chiedere" },
      { id: "b", status: "in_verifica" },
      { id: "c", status: "da_chiedere" },
      { id: "d", status: "boh" },
    ],
    10,
  );
  assert.deepEqual(sel, { total: 4, truncated: false, byStatus: { da_chiedere: ["a", "c"], in_verifica: ["b"] } });
  const capped = rowsToSelection([{ id: "a", status: "chiesta" }, { id: "b", status: "chiesta" }, { id: "c", status: "chiesta" }], 2);
  assert.deepEqual(capped, { total: 2, truncated: true, byStatus: { chiesta: ["a", "b"] } });
});

test("catalog rows carry only what the table shows", () => {
  const row = rowToCatalogRow(
    { id: "i1", key: "q.a.01", kind: "domanda", title: "T", status: "da_chiedere", privacy_class: "nessuna", request_module_key: "m.a", owner_role_key: "r", assignee_contact_id: CONTACT },
    { roles: ["ls_lead"], contacts: new Map([[CONTACT, contact]]), roleLabels: { r: "Ruolo" } },
  );
  for (const k of ["moduleKey", "ownerRoleKey", "assigneeId"]) assert.ok(!(k in row), k);
  assert.equal(row.assigneeName, "Referente servizio");
  assert.equal(row.ownerRoleLabel, "Ruolo");
});

test("long values are clipped in the catalog (the item detail shows them whole)", () => {
  const long = "x".repeat(CATALOG_VALUE_MAX + 50);
  const base = { id: "i1", key: "q.a.01", kind: "domanda", title: "T", status: "in_verifica", privacy_class: "nessuna", a_kind: "valore", a_source_kind: "referente", a_version: 1 };
  const ctx = { roles: ["ls_lead"] as const, contacts: new Map(), roleLabels: {} };
  const clipped = rowToCatalogRow({ ...base, a_value: { text: long } }, ctx).answer?.value;
  assert.equal(clipped?.kind, "value");
  assert.equal(clipped?.kind === "value" ? clipped.text.length : 0, CATALOG_VALUE_MAX);
  assert.ok(clipped?.kind === "value" && clipped.text.endsWith("…"));
  assert.deepEqual(rowToCatalogRow({ ...base, a_value: { text: "breve" } }, ctx).answer?.value, { kind: "value", text: "breve" });
});

// ── Domande (DESIGN §3.6, WP3) ────────────────────────────────────────

const NOW = new Date("2026-10-14T10:00:00Z");

test("Domande counts: segments, topics with a count per segment, the answers of the viewer and the unassigned ones", () => {
  const c = rowsToQuestionCounts([
    { m: "m.a", n: 10, a_posto: 2, da_fare: 5, da_verificare: 1, in_verifica: 3, bloccate: 0, senza_referente: 4, fuori: 0 },
    { m: null, n: 2, a_posto: 0, da_fare: 1, da_verificare: 0, in_verifica: 0, bloccate: 1, senza_referente: 0, fuori: 1 },
  ]);
  assert.deepEqual(c.segments, { "da-fare": 6, "da-verificare": 1, bloccate: 1, "a-posto": 2, tutte: 12 });
  assert.equal(c.mine, 2, "in review but answered by the viewer");
  assert.equal(c.unassigned, 4);
  assert.equal(c.outOfContract, 1);
  assert.deepEqual(c.byModule, {
    "m.a": { total: 10, ok: 2, daFare: 5, daVerificare: 1, bloccate: 0 },
    "": { total: 2, ok: 0, daFare: 1, daVerificare: 0, bloccate: 1 },
  });
  assert.deepEqual(
    (["da-fare", "da-verificare", "bloccate", "a-posto", "tutte"] as const).map((v) => topicCount(c.byModule["m.a"], v)),
    [5, 1, 0, 2, 10],
  );
  assert.equal(topicCount(undefined, "tutte"), 0);
});

test("(release 10, §3.5) three segments: «Da fare · Da verificare · Tutte», the client's words; «Bloccate» counts in «Da fare»; zero hidden except the default, the open one and «Tutte»", () => {
  const counts = { "da-fare": 140, "da-verificare": 0, bloccate: 10, "a-posto": 3, tutte: 245 };
  const ls = questionSegmentItems({ audience: "ls", counts, active: "da-fare", defaultSegment: "da-fare" });
  assert.deepEqual(
    ls.map((s) => `${s.key}:${s.label}:${s.count}`),
    ["da-fare:Da fare:150", "tutte:Tutte:245"],
    "no «Bloccate», «A posto» or «Documenti» segment; the waiting group counts in «Da fare»",
  );
  const blocked = questionSegmentItems({ audience: "ls", counts: { ...counts, "da-verificare": 4 }, active: "bloccate", defaultSegment: "tutte" });
  assert.deepEqual(blocked.map((s) => s.key), ["da-fare", "da-verificare", "tutte"], "the waiting group lights «Da fare»");
  const zero = questionSegmentItems({ audience: "ls", counts: { ...counts, "da-fare": 0, bloccate: 0 }, active: "tutte", defaultSegment: "da-fare" });
  assert.ok(zero.some((s) => s.key === "da-fare"), "the default stays at 0");
  const verify = questionSegmentItems({ audience: "ls", counts, active: "da-verificare", defaultSegment: "tutte" });
  assert.ok(verify.some((s) => s.key === "da-verificare" && s.count === 0), "the open one stays at 0");
  const client = questionSegmentItems({ audience: "cliente", counts: { ...counts, "da-verificare": 2 }, active: "da-fare", defaultSegment: "da-fare" });
  assert.deepEqual(client.map((s) => s.label), ["Da rispondere", "In verifica", "Tutte"]);
  assert.deepEqual(questionSegmentItems({ audience: "sviluppatore", counts, active: "a-posto", defaultSegment: "a-posto" }), []);
});

test("(release 10, §3.5) closed topics: schema order, only those with questions, the role in the group, the count of the open view; topics outside the schema and no topic last", () => {
  const counts = {
    "m.costi": { total: 3, ok: 1, daFare: 2, daVerificare: 0, bloccate: 0 },
    "m.servizio.base": { total: 14, ok: 0, daFare: 9, daVerificare: 3, bloccate: 2 },
    "m.vecchio": { total: 1, ok: 0, daFare: 1, daVerificare: 0, bloccate: 0 },
    "": { total: 4, ok: 0, daFare: 4, daVerificare: 0, bloccate: 0 },
  };
  const modules = [
    { key: "m.servizio.base", title: "Prezzi e sconti (art. 7.2)", roleKey: "resp_servizio" },
    { key: "m.costi", title: "Costi", roleKey: null },
    { key: "m.vuoto", title: "Vuoto", roleKey: null },
  ];
  const roleLabels = { resp_servizio: "Commerciale (A.8)" };
  const ls = questionTopicGroups({ counts, modules, roleLabels, vista: "da-fare", plain: (t) => t });
  assert.deepEqual(
    ls.map((g) => [g.key, g.title, g.role, g.count]),
    [
      ["m.servizio.base", "Prezzi e sconti (art. 7.2)", "Commerciale (A.8)", 9],
      ["m.costi", "Costi", null, 2],
      ["m.vecchio", "Altro argomento", null, 1],
      [NONE, "Senza argomento", null, 4],
    ],
  );
  const verify = questionTopicGroups({ counts, modules, roleLabels, vista: "da-verificare", plain: (t) => t });
  assert.deepEqual(verify.map((g) => [g.key, g.count]), [["m.servizio.base", 3]], "a topic without questions in the view is not shown");
  const client = questionTopicGroups({ counts, modules, roleLabels, vista: "tutte", plain: clientPlainText });
  assert.deepEqual(findForbiddenIn(client.flatMap((g) => [g.title, g.role ?? ""]), "cliente"), [], "no article or privacy sheet code for the client");
});

test("due date only within 7 days or past, in the row words", () => {
  assert.deepEqual(dueView(new Date("2026-10-18T16:00:00Z"), "chiesta", NOW), { text: "scade il 18 ott", overdue: false });
  assert.deepEqual(dueView(new Date("2026-10-08T16:00:00Z"), "mancante", NOW), { text: "scaduta l'8 ott", overdue: true });
  assert.equal(dueView(new Date("2026-11-30T16:00:00Z"), "chiesta", NOW), null);
  assert.equal(dueView(new Date("2026-10-08T16:00:00Z"), "validata", NOW), null);
  assert.equal(dueView(null, "chiesta", NOW), null);
});

const questionRow = (over: Record<string, unknown> = {}) => ({
  id: "q1",
  key: "q.servizio.01",
  kind: "domanda",
  title: "Quanti preventivi si perdono ogni mese? (F012)",
  status: "in_verifica",
  status_reason: null,
  priority: "must",
  privacy_class: "nessuna",
  value_visibility: "owner_e_ls",
  perimeter: "in_contratto",
  request_module_key: "m.servizio.base",
  owner_role_key: "resp_servizio",
  assignee_contact_id: CONTACT,
  due_at: null,
  response_type: "numero",
  a_at: "2026-10-12T09:00:00Z",
  a_kind: "valore",
  a_source_kind: "referente",
  a_confidence: "stima",
  a_value: { value: 40, unit: null },
  a_encrypted: false,
  a_erased: false,
  a_responder: "Mario Rossi",
  lock_key: null,
  ...over,
});

const rowCtx = (audience: "ls" | "cliente" | "sviluppatore", roles: CaseRole[]) => ({
  audience,
  roles,
  contacts: new Map([[CONTACT, { id: CONTACT, name: "Mario Rossi", roleLabel: null, templateRoleKey: "resp_servizio", assignable: true }]]),
  now: NOW,
});

test("(release 10, §3.5) a row for Lateral Space says one thing in grey: who answered and when, who answers, the block, the state; the due date only when past", () => {
  const r = rowToQuestionRow(questionRow(), rowCtx("ls", ["ls_analista"]));
  assert.equal(r.label, "Da verificare");
  assert.equal(r.title, "Quanti preventivi si perdono ogni mese? (F012)");
  assert.equal(r.line, "Mario Rossi · 2 giorni fa");
  assert.equal(r.missing, false);
  assert.equal(r.value, null);
  const asked = rowToQuestionRow(questionRow({ status: "chiesta", assignee_contact_id: null, due_at: "2026-10-16T16:00:00Z" }), rowCtx("ls", ["ls_lead"]));
  assert.equal(asked.label, "Da fare");
  assert.equal(asked.line, "Senza referente", "the role is only in the group");
  assert.equal(asked.missing, true);
  assert.equal(asked.overdue, null, "a due date still to come is not on the row");
  const late = rowToQuestionRow(questionRow({ status: "chiesta", due_at: "2026-10-10T16:00:00Z" }), rowCtx("ls", ["ls_lead"]));
  assert.equal(late.line, "Mario Rossi");
  assert.equal(late.overdue, "scaduta il 10 ott");
  const locked = rowToQuestionRow(questionRow({ status: "bloccata", lock_key: "a8", privacy_class: "personale" }), rowCtx("ls", ["ls_lead"]));
  assert.equal(locked.line, "Scheda privacy");
  assert.equal(locked.label, "Bloccata");
  assert.equal(locked.personal, true);
  assert.equal(rowToQuestionRow(questionRow({ status: "validata" }), rowCtx("ls", ["ls_lead"])).line, "A posto");
  assert.equal(rowToQuestionRow(questionRow({ status: "non_applicabile" }), rowCtx("ls", ["ls_lead"])).line, "Non si applica");
  for (const row of [r, asked, late, locked]) assert.equal(row.line.split(" ").length <= 6, true, `«${row.line}»: one short grey line`);
});

test("Domande row for the client: its words, no answer, no date next to a name, no codes in the title (§3.6.8)", () => {
  const r = rowToQuestionRow(questionRow({ status: "mancante" }), rowCtx("cliente", ["owner_cliente"]));
  assert.equal(r.label, "Da rispondere");
  assert.equal(r.line, "Mario Rossi", "who answers");
  assert.equal(r.value, null);
  assert.equal(r.title, "Quanti preventivi si perdono ogni mese?");
  assert.deepEqual(findForbiddenIn([r.label, r.title, r.line], "cliente"), []);
  const review = rowToQuestionRow(questionRow(), rowCtx("cliente", ["owner_cliente"]));
  assert.equal(review.line, "In verifica", "the state, never who answered and when (art. 15.4)");
  // Next to the name of who answers a deadline would be a date per person (art. 15.4): never for the client, not even overdue.
  const late = rowToQuestionRow(questionRow({ status: "chiesta", due_at: "2026-10-10T16:00:00Z" }), rowCtx("cliente", ["owner_cliente"]));
  assert.equal(late.overdue, null);
});

test("Domande row for the developer: the validated value in line", () => {
  const r = rowToQuestionRow(questionRow({ status: "validata" }), rowCtx("sviluppatore", ["ls_sviluppatore"]));
  assert.deepEqual(r.value, { kind: "value", text: "40" });
  assert.equal(r.overdue, null);
});

test("Domande groups follow the page order: title, the role (only here) and the count of the whole topic with the filters", () => {
  const ctx = rowCtx("ls", ["ls_lead"]);
  const rows = [
    rowToQuestionRow(questionRow({ id: "a1" }), ctx),
    rowToQuestionRow(questionRow({ id: "a2" }), ctx),
    rowToQuestionRow(questionRow({ id: "b1", request_module_key: "m.costi" }), ctx),
    rowToQuestionRow(questionRow({ id: "x1", request_module_key: null }), ctx),
  ];
  const zero = { ok: 0, daFare: 0, daVerificare: 0, bloccate: 0 };
  const groups = questionGroups(rows, {
    counts: { "m.servizio.base": { ...zero, total: 14, daVerificare: 2 }, "m.costi": { ...zero, total: 3, daVerificare: 1 }, "": { ...zero, total: 1, daVerificare: 1 } },
    modules: [
      { key: "m.servizio.base", title: "Prezzi e sconti", roleKey: "resp_servizio" },
      { key: "m.costi", title: "Costi", roleKey: null },
    ],
    roleLabels: { resp_servizio: "Commerciale" },
    vista: "da-verificare",
    plain: (t) => t,
  });
  assert.deepEqual(
    groups.map((g) => [g.title, g.role, g.count, g.rowIds.join(",")]),
    [
      ["Prezzi e sconti", "Commerciale", 2, "a1,a2"],
      ["Costi", null, 1, "b1"],
      ["Senza argomento", null, 1, "x1"],
    ],
  );
});

test("client segment and status words pass the copy guard", () => {
  const texts = [...Object.values(QUESTION_SEGMENT_LABEL.cliente), ...ITEM_STATUSES.map((s) => statusView(s, "cliente").label)];
  assert.deepEqual(findForbiddenIn(texts, "cliente"), []);
});

test("schema texts for the client lose item keys: a parenthesis with a key goes, a key alone goes", () => {
  assert.equal(clientPlainText("Fatture passive (Rossi Srl) o export di contabilità (da SDI, q.fonti.28) · ultimo anno"), "Fatture passive (Rossi Srl) o export di contabilità · ultimo anno");
  assert.equal(clientPlainText("Registro del sistema (export di src.sistema.fatture e src.sistema.note_pdf) · mensile"), "Registro del sistema · mensile");
  assert.equal(clientPlainText("Vedi q.servizio.12 per il dettaglio"), "per il dettaglio", "the «vedi» goes with the key");
  assert.equal(clientPlainText("Primo paragrafo (q.costi.01).\n\nSecondo paragrafo."), "Primo paragrafo.\n\nSecondo paragrafo.", "paragraphs stay");
  assert.equal(clientPlainText("Riga uno\nq.servizio.12 riga due"), "Riga uno\nriga due", "a line that starts with a key keeps its line break");
  assert.equal(clientPlainText("Primo punto\n\n(src.crm.richieste) Secondo punto"), "Primo punto\n\nSecondo punto", "a paragraph that starts with a key in brackets keeps its blank line");
  assert.equal(clientPlainText("Riga uno\n(q.servizio.12) riga due"), "Riga uno\nriga due", "a line that starts with a key in brackets keeps its line break");
  // Not keys: file names, short forms, addresses.
  for (const plain of ["Il verbale.doc.pdf firmato", "Firmato f.to dal responsabile", "Sul sito www.src.it", "Quanti preventivi si perdono ogni mese?"]) assert.equal(clientPlainText(plain), plain);
  const client = clientPlainText("Export dei preventivi (F010) (vedi src.crm.richieste) art. 8.4");
  assert.deepEqual(findForbiddenIn([client], "cliente"), []);
  const row = rowToQuestionRow(questionRow({ title: "Canali di vendita (q.canali.02)" }), rowCtx("cliente", ["owner_cliente"]));
  assert.equal(row.title, "Canali di vendita");
});
