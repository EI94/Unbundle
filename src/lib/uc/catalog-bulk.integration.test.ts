import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { addCaseMember, commandContextFor, createCase, loadUserContext, updateCaseRoi, type UcCommandContext } from "../db/queries/uc-cases.ts";
import { recordLsAnswer } from "../db/queries/uc-items.ts";
import { assignItems, createContact, requestConfirmation, sendRequests } from "../db/queries/uc-requests.ts";
import { loadQuestionSegments, loadQuestionSelection, loadQuestionsPage, loadReviewQueue } from "../db/queries/uc-questions.ts";
import { loadPeopleView } from "../db/queries/uc-people-view.ts";
import { loadValuePage } from "../db/queries/uc-value.ts";
import { loadCatalogSelection, type UcViewer } from "../db/queries/uc-views.ts";
import { planTemplateLoad } from "./template/load.ts";
import { eligibleIds } from "./views/bulk.ts";
import { EMPTY_CATALOG_FILTER, catalogQuery, parseCatalogFilter, parseCatalogQuery, questionQuery } from "./views/catalog-filter.ts";
import { roiUpdateInput } from "./views/roi-edit.ts";
import type { CaseRole, CaseStatus } from "./vocab.ts";

// Opt-in integration suite for the catalog at scale and its bulk actions (WP9b): filters,
// counts and paging in SQL, «select all N results», «Invia» and «Chiedi conferma» on a
// selection, and the ROI command keeping the case texts. Isolated local harness only:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/catalog-bulk.integration.test.ts
// Never in parallel with database.integration.test.ts (it narrows a vocabulary CHECK on purpose).
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

const LS_DOMAINS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), lead: randomUUID(), analyst: randomUUID(), owner: randomUUID() };
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state = { caseId: "", items: new Map<string, string>(), contactCosts: "", contactService: "" };

const item = (key: string) => {
  const id = state.items.get(key);
  assert.ok(id, `item ${key}`);
  return id;
};

async function ctxFor(userId: string, caseId = state.caseId): Promise<UcCommandContext> {
  const r = await commandContextFor(exec!, { workspaceId: ids.ws, caseId, userId, lsDomains: LS_DOMAINS });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

async function viewer(userId: string, roles: CaseRole[], caseId = state.caseId): Promise<UcViewer> {
  const user = await loadUserContext(exec!, userId, LS_DOMAINS);
  assert.ok(user);
  return { workspaceId: ids.ws, caseId, roles, user, readOnly: false };
}

async function count(where: string, params: unknown[] = []): Promise<number> {
  const [r] = await q(`SELECT count(*)::int AS n FROM uc_items i WHERE i.case_id = $1::uuid AND i.deleted_at IS NULL AND ${where}`, [state.caseId, ...params]);
  return Number(r.n);
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova catalogo', $2)`, [ids.org, `uc-cat-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova catalogo')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $4, now()), ($2::uuid, $5, now()), ($3::uuid, $6, now())`, [
    ids.lead,
    ids.analyst,
    ids.owner,
    `cat-lead-${suffix}@ls.test`,
    `cat-analista-${suffix}@ls.test`,
    `cat-owner-${suffix}@cliente.test`,
  ]);
  await q(
    `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $4::uuid, 'transformation_lead'), ($2::uuid, $4::uuid, 'analyst'), ($3::uuid, $4::uuid, 'contributor')`,
    [ids.lead, ids.analyst, ids.owner, ids.org],
  );
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.catalogo_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const lead = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, { workspaceId: ids.ws, user: lead!, canReviewWorkspacePortfolio: true, input: { templateId: loaded.value.templateId, code: `cat-${suffix}`, title: "Caso del catalogo" } });
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
  const costs = await createContact(exec!, leadCtx, { displayName: "Referente costi", roleLabel: "Controllo di gestione", templateRoleKey: "controllo_gestione", email: `costi-${suffix}@cliente.test` });
  assert.ok(costs.ok, costs.ok ? "" : costs.message);
  state.contactCosts = costs.value.contactId;
  const service = await createContact(exec!, leadCtx, { displayName: "Referente servizio", roleLabel: "Servizio clienti", templateRoleKey: "resp_servizio", email: `servizio-${suffix}@cliente.test` });
  assert.ok(service.ok, service.ok ? "" : service.message);
  state.contactService = service.value.contactId;
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid)`, [ids.lead, ids.analyst, ids.owner]);
});

test("select all N results follows the same filters, the developer's limit and the role groups", opts, async () => {
  const lead = await viewer(ids.lead, ["ls_lead"]);
  const filter = parseCatalogFilter({ ruolo: "controllo_gestione" });
  const selection = await loadCatalogSelection(exec!, lead, { kind: "filtro", filter: parseCatalogQuery(catalogQuery(filter)) });
  assert.equal(selection.total, await count("i.kind = 'domanda' AND i.owner_role_key = 'controllo_gestione'"));
  assert.equal(selection.truncated, false);
  assert.equal(Object.values(selection.byStatus).flat().length, selection.total);
  assert.deepEqual(new Set(Object.values(selection.byStatus).flat()).size, selection.total, "no duplicates");
  const everything = await loadCatalogSelection(exec!, lead, { kind: "filtro", filter: EMPTY_CATALOG_FILTER });
  assert.equal(everything.total, state.items.size);
  const dev = await loadCatalogSelection(exec!, { ...lead, roles: ["ls_sviluppatore"] }, { kind: "filtro", filter: parseCatalogFilter({}) });
  assert.equal(dev.total, 0, "nothing is green yet");
  // The role group of Persone counts what «Assegna per ruolo» selects.
  const role = await loadCatalogSelection(exec!, lead, { kind: "ruolo", roleKey: "controllo_gestione", includeAssigned: false });
  const people = await loadPeopleView(exec!, { workspaceId: ids.ws, caseId: state.caseId, audience: "lateral_space" });
  const group = people!.roleGroups.find((g) => g.roleKey === "controllo_gestione");
  assert.ok(group && group.unassigned > 0);
  assert.equal(role.total, group.unassigned);
});

test("«Invia» and «Chiedi conferma» on a selection: one request per referent, skipped items with a reason", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const leadView = await viewer(ids.lead, ["ls_lead"]);
  // Assign the cost questions through the role-group selection, as «Assegna per ruolo» does.
  const role = await loadCatalogSelection(exec!, leadView, { kind: "ruolo", roleKey: "controllo_gestione", includeAssigned: false });
  const assigned = await assignItems(exec!, lead, { mode: "voci", itemIds: eligibleIds(role.byStatus, "assign"), contactId: state.contactCosts });
  assert.ok(assigned.ok, assigned.ok ? "" : assigned.message);
  assert.equal(assigned.value.assigned, role.total);
  // Select all the questions (assigned or not) and send: the unassigned ones are skipped with the reason.
  const questions = await loadCatalogSelection(exec!, leadView, { kind: "filtro", filter: parseCatalogFilter({}) });
  const toSend = eligibleIds(questions.byStatus, "send");
  const expected = await count(
    `i.kind = 'domanda' AND i.assignee_contact_id = $2::uuid AND i.response_type IS NOT NULL AND i.status IN ('da_chiedere', 'mancante', 'parziale', 'bloccata')
     AND NOT EXISTS (SELECT 1 FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id WHERE ib.item_id = i.id AND b.status IN ('attivo', 'permanente'))`,
    [state.contactCosts],
  );
  assert.ok(expected > 0);
  const sent = await sendRequests(exec!, lead, { itemIds: toSend, message: "Grazie." });
  assert.ok(sent.ok, sent.ok ? "" : sent.message);
  assert.equal(sent.value.requests.length, 1, "one request for the one referent");
  assert.equal(sent.value.requests[0].contactId, state.contactCosts);
  assert.equal(sent.value.requests[0].items, expected);
  assert.equal(sent.value.skippedTotal, toSend.length - expected);
  assert.ok(sent.value.skipped.some((s) => s.code === "referente_assente"));
  assert.ok(sent.value.skipped.every((s) => ["referente_assente", "voce_bloccata", "senza_tipo_risposta"].includes(s.code)));
  assert.equal(await count("i.assignee_contact_id = $2::uuid AND i.status = 'chiesta'", [state.contactCosts]), expected);
  // «Chiedi conferma»: a value entered by Lateral Space goes back to the owner of the data.
  const key = "q.servizio.02";
  const recorded = await recordLsAnswer(exec!, lead, { itemId: item(key), value: "40", sourceKind: "documento", sourceRef: "Report del servizio" });
  assert.ok(recorded.ok, recorded.ok ? "" : recorded.message);
  const toConfirm = await loadCatalogSelection(exec!, leadView, { kind: "filtro", filter: parseCatalogFilter({ stato: "in_verifica" }) });
  assert.deepEqual(eligibleIds(toConfirm.byStatus, "confirm"), [item(key)]);
  const noReferent = await requestConfirmation(exec!, lead, { itemIds: [item(key)] });
  assert.equal(noReferent.ok, false, "without a referent with the owner's role nothing is sent");
  const ok = await assignItems(exec!, lead, { mode: "voci", itemIds: [item(key)], contactId: state.contactService });
  assert.ok(ok.ok);
  const confirmed = await requestConfirmation(exec!, lead, { itemIds: eligibleIds(toConfirm.byStatus, "confirm") });
  assert.ok(confirmed.ok, confirmed.ok ? "" : confirmed.message);
  assert.equal(confirmed.value.requests.length, 1);
  assert.equal(confirmed.value.requests[0].contactId, state.contactService);
  const [row] = await q(`SELECT status FROM uc_items WHERE id = $1::uuid`, [item(key)]);
  assert.equal(row.status, "chiesta");
  // «Verifica una alla volta»: every answer to verify, once, split between the analyst's and a colleague's.
  const queue = await loadReviewQueue(exec!, await viewer(ids.analyst, ["ls_analista"]));
  assert.equal(new Set(queue.ids).size, queue.ids.length);
  assert.equal(queue.ids.length + queue.mine, await count("i.status = 'in_verifica'"));
});

test("the ROI command keeps the case texts on the benefit lines and accepts a lever or cost type still to choose", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const view = await viewer(ids.lead, ["ls_lead"]);
  const before = await loadValuePage(exec!, view);
  assert.equal(before!.roi.source, "template");
  const costLines = before!.roi.costLines.map((c, i) => (i === 0 ? { ...c, kind: null, value: 1000 } : c));
  const benefitLines = [
    ...before!.roi.benefitLines,
    {
      key: "nuova_leva",
      lever: null,
      leverLabel: "Nuove capacità commerciali",
      formula: "richieste in più × margine",
      inputs: [],
      value: null,
      status: "da_raccogliere" as const,
      source: null,
      howToEuro: "Margine delle richieste in più",
      dataNeeded: ["richieste perse al mese"],
      example: "Dati inventati: 10 richieste × 500 €",
      unresolvedRefs: ["kpi.non_creato"],
    },
  ];
  const saved = await updateCaseRoi(exec!, lead, roiUpdateInput({ costLines, benefitLines, content: { ...before!.roi.content, benefit_extras: { vecchio: { lever_label: "x" } } } }));
  assert.ok(saved.ok, saved.ok ? "" : saved.message);
  const after = await loadValuePage(exec!, view);
  assert.equal(after!.roi.source, "modello");
  assert.equal(after!.roi.costLines[0].kind, null);
  assert.equal(after!.roi.costLines[0].value, 1000);
  const line = after!.roi.benefitLines.find((b) => b.key === "nuova_leva");
  assert.ok(line);
  assert.equal(line.lever, null);
  assert.equal(line.leverLabel, "Nuove capacità commerciali");
  assert.deepEqual(line.dataNeeded, ["richieste perse al mese"]);
  assert.equal(line.example, "Dati inventati: 10 richieste × 500 €");
  assert.deepEqual(line.unresolvedRefs, ["kpi.non_creato"]);
  assert.ok(!("benefit_extras" in after!.roi.content), "the legacy extras are dropped");
  assert.match(after!.roi.computed.missing.join(" | "), /Tipo di costo da indicare/);
  const [stored] = await q(`SELECT benefit_lines FROM uc_roi_models WHERE case_id = $1::uuid ORDER BY version DESC LIMIT 1`, [state.caseId]);
  const raw = (stored.benefit_lines as Record<string, unknown>[]).find((b) => b.key === "nuova_leva");
  assert.equal(raw?.lever_label, "Nuove capacità commerciali");
  // A field the command does not know is refused, not dropped in silence.
  const unknown = await updateCaseRoi(exec!, lead, { benefitLines: [{ ...roiUpdateInput({ costLines: [], benefitLines: [benefitLines[benefitLines.length - 1]], content: {} }).benefitLines![0], colore: "rosso" }] });
  assert.equal(unknown.ok, false);
  assert.match(unknown.ok ? "" : unknown.message, /Riga di beneficio 1: campo non previsto \(colore\)/);
});

// ── Domande (DESIGN §3.6, WP3) ────────────────────────────────────────

async function caseStatus(caseId = state.caseId): Promise<CaseStatus> {
  const [r] = await q(`SELECT status FROM uc_cases WHERE id = $1::uuid`, [caseId]);
  return String(r.status) as CaseStatus;
}

const NOW = new Date();

test("Domande opens on «Da fare» and the indispensable questions, by topic in schema order, in one batch", opts, async () => {
  const lead = await viewer(ids.lead, ["ls_lead"]);
  const status = await caseStatus();
  const page = await loadQuestionsPage(exec!, lead, { searchParams: {}, status, now: NOW });
  assert.ok(page);
  assert.equal(page.audience, "ls");
  assert.equal(page.filter.vista, "da-fare");
  assert.equal(page.filter.soloIndispensabili, true);
  const required = `i.kind = 'domanda' AND i.in_gate_scope AND i.priority = 'must' AND i.perimeter = 'in_contratto' AND i.serves_for @> '["modello"]'::jsonb`;
  assert.equal(page.counts.segments.tutte, await count(required));
  assert.equal(page.total, await count(`${required} AND i.status IN ('da_chiedere', 'chiesta', 'mancante', 'parziale')`));
  assert.equal(page.rows.length, Math.min(page.total, 50));
  // Topics in the order of the schema, the indispensable questions first inside each topic.
  const order = page.ctx.modules.map((m) => m.key);
  const positions = page.rows.map((r) => order.indexOf(r.moduleKey ?? ""));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.ok(page.groups && page.groups.length > 0);
  for (const g of page.groups) {
    const total = await count(`${required} AND i.request_module_key = $2`, [g.key]);
    assert.match(g.meta, new RegExp(`\\d+ di ${total}$`));
  }
  // Segments: the default one stays, «Tutte» always; Documenti counts the required documents.
  assert.ok(page.segments.some((s) => s.key === "da-fare"));
  assert.ok(page.segments.some((s) => s.key === "tutte"));
  const docs = await count(`(i.kind IN ('fonte', 'documento') OR i.response_type IN ('file', 'dataset'))`);
  assert.equal(page.segments.find((s) => s.key === "documenti")?.count, docs > 0 ? docs : undefined);
  assert.equal(page.catalogSize, state.items.size);
  // Every question with the switch off; the whole catalog for Lateral Space.
  const all = await loadQuestionsPage(exec!, lead, { searchParams: { vista: "tutte", indispensabili: "no" }, status, now: NOW });
  assert.equal(all!.total, await count("i.kind = 'domanda'"));
  const catalog = await loadQuestionsPage(exec!, lead, { searchParams: { vista: "tutte", indispensabili: "no", mostra: "catalogo" }, status, now: NOW });
  assert.equal(catalog!.total, state.items.size);
  assert.equal(Object.values(catalog!.kindCounts ?? {}).reduce((s, n) => s + n, 0), state.items.size);
  // Pasting a key finds the question; a page past the end shows the last one.
  const byKey = await loadQuestionsPage(exec!, lead, { searchParams: { vista: "tutte", indispensabili: "no", q: "q.costi.01" }, status, now: NOW });
  assert.deepEqual(byKey!.rows.map((r) => r.id), [item("q.costi.01")]);
  const past = await loadQuestionsPage(exec!, lead, { searchParams: { vista: "tutte", indispensabili: "no", pagina: "9" }, status, now: NOW });
  assert.equal(past!.filter.pagina, 1);
  assert.equal(past!.rows.length, all!.rows.length);
  const segments = await loadQuestionSegments(exec!, lead, status);
  assert.deepEqual(
    segments.segments.map((s) => s.key),
    page.segments.map((s) => s.key),
  );
});

test("«Da verificare» and «Verifica una alla volta» apply the four eyes: your own answers go to a colleague", opts, async () => {
  const analystCtx = await ctxFor(ids.analyst);
  const key = "q.sistemi.01";
  const recorded = await recordLsAnswer(exec!, analystCtx, { itemId: item(key), value: { value: "sì" }, sourceKind: "documento", sourceRef: "Manuale del sistema" });
  assert.ok(recorded.ok, recorded.ok ? "" : recorded.message);
  const status = await caseStatus();
  const params = { vista: "da-verificare", indispensabili: "no" };
  const analyst = await loadQuestionsPage(exec!, await viewer(ids.analyst, ["ls_analista"]), { searchParams: params, status, now: NOW });
  assert.equal(analyst!.counts.mine, 1);
  assert.ok(!analyst!.rows.some((r) => r.id === item(key)), "the analyst answered: not in the analyst's list");
  const lead = await loadQuestionsPage(exec!, await viewer(ids.lead, ["ls_lead"]), { searchParams: params, status, now: NOW });
  const row = lead!.rows.find((r) => r.id === item(key));
  assert.ok(row, "the lead verifies it");
  assert.ok(row.answer?.excerpt && row.answer.excerpt !== "—");
  assert.equal(row.label, "Da verificare");
  assert.equal(lead!.groups, null, "«Da verificare» is one list, from the oldest answer");
  const analystQueue = await loadReviewQueue(exec!, await viewer(ids.analyst, ["ls_analista"]));
  assert.ok(!analystQueue.ids.includes(item(key)));
  assert.equal(analystQueue.mine, 1);
  const leadQueue = await loadReviewQueue(exec!, await viewer(ids.lead, ["ls_lead"]));
  assert.ok(leadQueue.ids.includes(item(key)));
  assert.equal(leadQueue.mine, 0);
  assert.equal(leadQueue.ids.length, await count("i.status = 'in_verifica'"));
});

test("Domande for the client and the developer: their words, no answers for the client, only validated ones for the developer", opts, async () => {
  const status = await caseStatus();
  const owner = await loadQuestionsPage(exec!, await viewer(ids.owner, ["owner_cliente"]), { searchParams: { vista: "bloccate", indispensabili: "no" }, status, now: NOW });
  assert.ok(owner);
  assert.equal(owner.audience, "cliente");
  assert.equal(owner.filter.vista, owner.defaults.vista, "«Bloccate» is not a client segment");
  assert.ok(owner.rows.every((r) => r.answer === null && r.value === null && r.checks === null));
  assert.ok(owner.segments.every((s) => ["Da rispondere", "In verifica", "A posto", "Tutte"].includes(s.label)));
  assert.ok(!owner.segments.some((s) => s.key === "documenti" || s.key === "bloccate"));
  assert.equal(owner.groups, null);
  assert.equal(owner.catalogSize, null);
  // Art. 15.4: the client never filters by one colleague, so the segment counts are never that person's progress.
  const ownerViewer = await viewer(ids.owner, ["owner_cliente"]);
  const all = { vista: "tutte", indispensabili: "no" };
  assert.ok((await count("i.kind = 'domanda' AND i.assignee_contact_id = $2::uuid", [state.contactCosts])) > 0, "some questions are assigned");
  const everyone = await loadQuestionsPage(exec!, ownerViewer, { searchParams: all, status, now: NOW });
  const oneColleague = await loadQuestionsPage(exec!, ownerViewer, { searchParams: { ...all, referente: state.contactCosts }, status, now: NOW });
  assert.equal(oneColleague!.filter.referente, null);
  assert.deepEqual(oneColleague!.counts.segments, everyone!.counts.segments);
  assert.deepEqual(oneColleague!.segments, everyone!.segments);
  assert.ok(oneColleague!.rows.every((r) => r.due === null), "no deadline next to «Risponde: …»");
  // «Senza referente» stays: the client finds the questions to assign.
  const unassigned = await loadQuestionsPage(exec!, ownerViewer, { searchParams: { ...all, referente: "nessuno" }, status, now: NOW });
  assert.equal(unassigned!.total, await count("i.kind = 'domanda' AND i.assignee_contact_id IS NULL"));
  // Lateral Space keeps the filter by referent.
  const lead = await loadQuestionsPage(exec!, await viewer(ids.lead, ["ls_lead"]), { searchParams: { ...all, referente: state.contactCosts }, status, now: NOW });
  assert.equal(lead!.total, await count("i.kind = 'domanda' AND i.assignee_contact_id = $2::uuid", [state.contactCosts]));
  const dev = await loadQuestionsPage(exec!, await viewer(ids.lead, ["ls_sviluppatore"]), { searchParams: { vista: "da-fare" }, status, now: NOW });
  assert.equal(dev!.audience, "sviluppatore");
  assert.equal(dev!.filter.vista, "a-posto");
  assert.equal(dev!.total, await count("i.kind = 'domanda' AND i.status IN ('validata', 'non_applicabile')"));
  assert.deepEqual(dev!.segments, []);
});

test("«Seleziona tutte le N» of Domande follows the page's view, with vista and switch written out", opts, async () => {
  const lead = await viewer(ids.lead, ["ls_lead"]);
  const status = await caseStatus();
  const page = await loadQuestionsPage(exec!, lead, { searchParams: { vista: "tutte", indispensabili: "no", ruolo: "controllo_gestione" }, status, now: NOW });
  const selection = await loadQuestionSelection(exec!, lead, questionQuery(page!.filter, page!.defaults, {}, { explicit: true }));
  assert.equal(selection.total, page!.total);
  assert.equal(selection.truncated, false);
  assert.equal(new Set(Object.values(selection.byStatus).flat()).size, selection.total);
  const defaults = await loadQuestionSelection(exec!, lead, questionQuery(page!.filter, page!.defaults, { vista: "da-fare", soloIndispensabili: true, ruolo: null }, { explicit: true }));
  const first = await loadQuestionsPage(exec!, lead, { searchParams: {}, status, now: NOW });
  assert.equal(defaults.total, first!.total);
});
