import test from "node:test";
import assert from "node:assert/strict";
import { ITEM_STATUSES, type CaseRole } from "../vocab.ts";
import { QUESTION_SEGMENT_LABEL } from "./catalog-filter.ts";
import { findForbiddenIn } from "./copy-guard.ts";
import {
  CATALOG_VALUE_MAX,
  checksLine,
  dueView,
  parseCaseViewContext,
  questionGroups,
  questionSegmentItems,
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

test("Domande counts: segments, topics, the answers of the viewer and the unassigned ones", () => {
  const c = rowsToQuestionCounts([
    { m: "m.a", n: 10, a_posto: 2, da_fare: 5, da_verificare: 1, in_verifica: 3, bloccate: 0, senza_referente: 4, fuori: 0 },
    { m: null, n: 2, a_posto: 0, da_fare: 1, da_verificare: 0, in_verifica: 0, bloccate: 1, senza_referente: 0, fuori: 1 },
  ]);
  assert.deepEqual(c.segments, { "da-fare": 6, "da-verificare": 1, bloccate: 1, "a-posto": 2, tutte: 12 });
  assert.equal(c.mine, 2, "in review but answered by the viewer");
  assert.equal(c.unassigned, 4);
  assert.equal(c.outOfContract, 1);
  assert.deepEqual(c.byModule, { "m.a": { total: 10, ok: 2 }, "": { total: 2, ok: 0 } });
});

test("Domande segments: zero hidden except the default, the open one and «Tutte»; Documenti before «Tutte» (§3.6.1)", () => {
  const counts = { "da-fare": 140, "da-verificare": 0, bloccate: 10, "a-posto": 3, tutte: 245 };
  const ls = questionSegmentItems({ audience: "ls", counts, active: "da-fare", defaultSegment: "da-fare", documents: 12 });
  assert.deepEqual(
    ls.map((s) => `${s.key}:${s.label}:${s.count}`),
    ["da-fare:Da fare:140", "bloccate:Bloccate:10", "documenti:Documenti:12", "tutte:Tutte:245"],
  );
  const open = questionSegmentItems({ audience: "ls", counts, active: "a-posto", defaultSegment: "tutte", documents: 0 });
  assert.deepEqual(open.map((s) => s.key), ["da-fare", "bloccate", "a-posto", "tutte"]);
  const zero = questionSegmentItems({ audience: "ls", counts: { ...counts, "da-fare": 0 }, active: "tutte", defaultSegment: "da-fare", documents: null });
  assert.ok(zero.some((s) => s.key === "da-fare"), "the default stays at 0");
  const client = questionSegmentItems({ audience: "cliente", counts, active: "da-fare", defaultSegment: "da-fare", documents: null });
  assert.deepEqual(client.map((s) => s.label), ["Da rispondere", "A posto", "Tutte"]);
  assert.deepEqual(questionSegmentItems({ audience: "sviluppatore", counts, active: "a-posto", defaultSegment: "a-posto", documents: 3 }), []);
});

test("due date only within 7 days or past, in the row words", () => {
  assert.deepEqual(dueView(new Date("2026-10-18T16:00:00Z"), "chiesta", NOW), { text: "scade il 18 ott", overdue: false });
  assert.deepEqual(dueView(new Date("2026-10-08T16:00:00Z"), "mancante", NOW), { text: "scaduta l'8 ott", overdue: true });
  assert.equal(dueView(new Date("2026-11-30T16:00:00Z"), "chiesta", NOW), null);
  assert.equal(dueView(new Date("2026-10-08T16:00:00Z"), "validata", NOW), null);
  assert.equal(dueView(null, "chiesta", NOW), null);
});

test("automatic checks in one line: errors before warnings", () => {
  assert.deepEqual(checksLine({ avvisi: 1, errori: 0, primo: "Il valore è fuori dall'intervallo atteso." }), { text: "1 avviso: il valore è fuori dall'intervallo atteso.", error: false });
  assert.deepEqual(checksLine({ avvisi: 2, errori: 1, primo: "Formato non valido." }), { text: "1 errore: formato non valido.", error: true });
  assert.equal(checksLine(null), null);
  assert.equal(checksLine({ avvisi: 0, errori: 0 }), null);
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
  checks: { avvisi: 1, errori: 0, primo: "Il valore è fuori dall'intervallo atteso." },
  lock_key: null,
  ...over,
});

const rowCtx = (audience: "ls" | "cliente" | "sviluppatore", roles: CaseRole[]) => ({
  audience,
  roles,
  contacts: new Map([[CONTACT, { id: CONTACT, name: "Mario Rossi", roleLabel: null, templateRoleKey: "resp_servizio", assignable: true }]]),
  roleLabels: { resp_servizio: "Commerciale" },
  moduleTitles: new Map([["m.servizio.base", "Prezzi e sconti"]]),
  now: NOW,
});

test("Domande row for Lateral Space: group, grey sub-state, answer excerpt with who and when, checks", () => {
  const r = rowToQuestionRow(questionRow(), rowCtx("ls", ["ls_analista"]));
  assert.equal(r.label, "Da verificare");
  assert.equal(r.sublabel, null);
  assert.equal(r.title, "Quanti preventivi si perdono ogni mese? (F012)");
  assert.equal(r.assignee, "Mario Rossi");
  assert.equal(r.roleLabel, null, "the role only without a referent");
  assert.deepEqual(r.answer, { excerpt: "40", muted: false, by: "Mario Rossi", when: "2 giorni fa" });
  assert.equal(r.checks?.text, "1 avviso: il valore è fuori dall'intervallo atteso.");
  assert.equal(r.must, true);
  assert.equal(r.value, null);
  const asked = rowToQuestionRow(questionRow({ status: "chiesta", assignee_contact_id: null, due_at: "2026-10-16T16:00:00Z" }), rowCtx("ls", ["ls_lead"]));
  assert.equal(asked.label, "Da fare");
  assert.equal(asked.sublabel, "Chiesta, in attesa");
  assert.equal(asked.assignee, null);
  assert.equal(asked.roleLabel, "Commerciale");
  assert.equal(asked.answer, null);
  assert.equal(asked.checks, null);
  assert.equal(asked.due?.text, "scade il 16 ott");
  const locked = rowToQuestionRow(questionRow({ status: "bloccata", lock_key: "a8", privacy_class: "personale" }), rowCtx("ls", ["ls_lead"]));
  assert.equal(locked.lockReason, "Scheda privacy");
  assert.equal(locked.label, "Bloccata", "one question is «Bloccata», the segment is «Bloccate»");
  assert.equal(locked.personal, true);
});

test("Domande row for the client: its words, no answer, no codes in the title (§3.6.8)", () => {
  const r = rowToQuestionRow(questionRow({ status: "mancante" }), rowCtx("cliente", ["owner_cliente"]));
  assert.equal(r.label, "Da rispondere");
  assert.equal(r.sublabel, null);
  assert.equal(r.answer, null);
  assert.equal(r.checks, null);
  assert.equal(r.value, null);
  assert.equal(r.title, "Quanti preventivi si perdono ogni mese?");
  assert.equal(r.moduleTitle, "Prezzi e sconti");
  assert.equal(r.assignee, "Mario Rossi");
  assert.deepEqual(findForbiddenIn([r.label, r.title, r.moduleTitle ?? ""], "cliente"), []);
  // Next to «Risponde: Mario Rossi» a deadline would be a date per person (art. 15.4): never for the client, not even overdue.
  const late = rowToQuestionRow(questionRow({ status: "chiesta", due_at: "2026-10-10T16:00:00Z" }), rowCtx("cliente", ["owner_cliente"]));
  assert.equal(late.due, null);
  assert.equal(rowToQuestionRow(questionRow({ status: "chiesta", due_at: "2026-10-10T16:00:00Z" }), rowCtx("ls", ["ls_lead"])).due?.overdue, true);
});

test("Domande row for the developer: the validated value in line", () => {
  const r = rowToQuestionRow(questionRow({ status: "validata", checks: null }), rowCtx("sviluppatore", ["ls_sviluppatore"]));
  assert.deepEqual(r.value, { kind: "value", text: "40" });
  assert.equal(r.answer, null);
  assert.equal(r.due, null);
});

test("Domande groups follow the page order; the subtitle counts the whole topic with the filters", () => {
  const ctx = rowCtx("ls", ["ls_lead"]);
  const rows = [
    rowToQuestionRow(questionRow({ id: "a1" }), ctx),
    rowToQuestionRow(questionRow({ id: "a2" }), ctx),
    rowToQuestionRow(questionRow({ id: "b1", request_module_key: "m.costi" }), ctx),
    rowToQuestionRow(questionRow({ id: "x1", request_module_key: null }), ctx),
  ];
  const groups = questionGroups(rows, {
    counts: { "m.servizio.base": { total: 14, ok: 0 }, "m.costi": { total: 3, ok: 1 }, "": { total: 1, ok: 0 } },
    modules: [
      { key: "m.servizio.base", title: "Prezzi e sconti", roleKey: "resp_servizio" },
      { key: "m.costi", title: "Costi", roleKey: null },
    ],
    roleLabels: { resp_servizio: "Commerciale" },
  });
  assert.deepEqual(
    groups.map((g) => [g.title, g.meta, g.rowIds.join(",")]),
    [
      ["Prezzi e sconti", "Commerciale · 0 di 14", "a1,a2"],
      ["Costi", "1 di 3", "b1"],
      ["Senza argomento", "0 di 1", "x1"],
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
