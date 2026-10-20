import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { addCaseMember, commandContextFor, createCase, loadUserContext, type UcCommandContext } from "../db/queries/uc-cases.ts";
import { applyItemTransitions, recordLsAnswer } from "../db/queries/uc-items.ts";
import { getCaseOverview } from "../db/queries/uc-cases.ts";
import { loadPrivacyPage } from "../db/queries/uc-events.ts";
import { loadOverview, loadVia } from "../db/queries/uc-overview.ts";
import { loadPeopleView } from "../db/queries/uc-people-view.ts";
import { loadQuestionDocuments, loadQuestionsPage, loadReviewQueue } from "../db/queries/uc-questions.ts";
import { listStartablePortfolioCards, loadProgressExtras } from "../db/queries/uc-shell.ts";
import { loadSolutionData, loadSolutionMap, loadSolutionRules } from "../db/queries/uc-solution.ts";
import { loadKpiPage, loadValuePage } from "../db/queries/uc-value.ts";
import { caseViewContextReader, loadCatalogSelection, loadItemDetail, type UcViewer } from "../db/queries/uc-views.ts";
import type { UcStatement } from "./sql/statement.ts";
import { forgetTemplateParts, rememberedTemplateHashes } from "./sql/template-parts.ts";
import { answerInsertSql } from "./sql/transitions.ts";
import { planTemplateLoad } from "./template/load.ts";
import { parseCatalogFilter } from "./views/catalog-filter.ts";
import { findForbidden } from "./views/copy-guard.ts";
import { parseKpiParams } from "./views/kpi.ts";
import { parseDataQuery, parseRulesQuery } from "./views/model.ts";
import type { CaseRole, CaseStatus } from "./vocab.ts";

// Opt-in integration suite for the read views of the internal pages (WP9), on the
// isolated local harness only. Same guard as commands.integration.test.ts:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/views.integration.test.ts
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
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  lead: randomUUID(),
  analyst: randomUUID(),
  owner: randomUUID(),
  observer: randomUUID(),
  contact: randomUUID(),
  request: randomUUID(),
};
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state: { caseId: string; items: Map<string, string> } = { caseId: "", items: new Map() };

const item = (key: string) => {
  const id = state.items.get(key);
  assert.ok(id, `item ${key}`);
  return id;
};

async function ctxFor(userId: string): Promise<UcCommandContext> {
  const r = await commandContextFor(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId, lsDomains: LS_DOMAINS });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

async function caseStatus(): Promise<CaseStatus> {
  const [r] = await q(`SELECT status FROM uc_cases WHERE id = $1::uuid`, [state.caseId]);
  return String(r.status) as CaseStatus;
}

async function viewer(userId: string, roles: CaseRole[]): Promise<UcViewer> {
  const user = await loadUserContext(exec!, userId, LS_DOMAINS);
  assert.ok(user);
  return { workspaceId: ids.ws, caseId: state.caseId, roles, user, readOnly: false };
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova viste', $2)`, [ids.org, `uc-views-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova viste')`, [ids.ws, ids.org]);
  await q(
    `INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $5, now()), ($2::uuid, $6, now()), ($3::uuid, $7, now()), ($4::uuid, $8, now())`,
    [ids.lead, ids.analyst, ids.owner, ids.observer, `views-lead-${suffix}@ls.test`, `views-analista-${suffix}@ls.test`, `views-owner-${suffix}@cliente.test`, `views-oss-${suffix}@cliente.test`],
  );
  await q(
    `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $5::uuid, 'transformation_lead'), ($2::uuid, $5::uuid, 'analyst'),
       ($3::uuid, $5::uuid, 'contributor'), ($4::uuid, $5::uuid, 'contributor')`,
    [ids.lead, ids.analyst, ids.owner, ids.observer, ids.org],
  );
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.viste_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const leadUser = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, { workspaceId: ids.ws, user: leadUser!, canReviewWorkspacePortfolio: true, input: { templateId: loaded.value.templateId, code: `views-${suffix}`, title: "Caso delle viste" } });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  for (const r of await q(`SELECT id, key FROM uc_items WHERE case_id = $1::uuid`, [state.caseId])) state.items.set(String(r.key), String(r.id));
  const lead = await ctxFor(ids.lead);
  for (const [userId, role] of [
    [ids.analyst, "ls_analista"],
    [ids.owner, "owner_cliente"],
    [ids.observer, "osservatore"],
  ] as const) {
    const r = await addCaseMember(exec!, lead, { userId, role });
    assert.ok(r.ok, r.ok ? "" : r.message);
  }

  // A referent answers q.servizio.02 (synthetic contact and request, as the referent page would).
  const key = "q.servizio.02";
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email, template_role_key) VALUES ($1::uuid, $2::uuid, 'Referente di prova', $3, 'resp_servizio')`, [
    ids.contact,
    ids.ws,
    `views-ref-${suffix}@cliente.test`,
  ]);
  await q(`UPDATE uc_items SET assignee_contact_id = $1::uuid WHERE id = $2::uuid`, [ids.contact, item(key)]);
  await q(`INSERT INTO uc_requests (id, case_id, contact_id, share_epoch, acting_role_key, status) VALUES ($1::uuid, $2::uuid, $3::uuid, 0, 'resp_servizio', 'bozza')`, [
    ids.request,
    state.caseId,
    ids.contact,
  ]);
  await q(`INSERT INTO uc_request_items (case_id, request_id, item_id, state) VALUES ($1::uuid, $2::uuid, $3::uuid, 'da_fare')`, [state.caseId, ids.request, item(key)]);
  const sent = await applyItemTransitions(exec!, lead, { itemIds: [item(key)], transitions: [{ itemId: item(key), to: "chiesta", trigger: "invio_richiesta" }] });
  assert.ok(sent.ok, sent.ok ? "" : sent.message);
  await q(`UPDATE uc_requests SET status = 'inviata', sent_at = now(), expires_at = now() + interval '30 days' WHERE id = $1::uuid`, [ids.request]);
  await q(`UPDATE uc_request_items SET state = 'inviata' WHERE request_id = $1::uuid`, [ids.request]);
  const referent = { ...lead, actor: { type: "referente" as const, contactId: ids.contact, requestId: ids.request, roleKey: "resp_servizio" }, user: null };
  const answerId = randomUUID();
  const answered = await applyItemTransitions(exec!, referent, {
    itemIds: [item(key)],
    transitions: [
      {
        itemId: item(key),
        to: "in_verifica",
        trigger: "risposta",
        answer: { kind: "valore", sourceKind: "referente" },
        actorRequestItem: { requestId: ids.request, state: "inviata" },
        extraSet: { currentAnswerId: answerId },
      },
    ],
    before: [
      answerInsertSql({
        id: answerId,
        workspaceId: ids.ws,
        caseId: state.caseId,
        itemId: item(key),
        kind: "valore",
        value: { value: 40, unit: "richieste" },
        valueNormalized: { value_si: 40 },
        validFrom: null,
        confidence: "certo",
        note: null,
        sourceKind: "referente",
        sourceRef: null,
        sourceBasis: "sistema",
        responderUserId: null,
        responderContactId: ids.contact,
        requestId: ids.request,
        textHash: null,
        responseType: "numero",
        actor: { type: "referente", contactId: ids.contact },
      }),
    ],
  });
  assert.ok(answered.ok, answered.ok ? "" : answered.message);
  // And Lateral Space records a value from a document on another question.
  const recorded = await recordLsAnswer(exec!, lead, { itemId: item("q.servizio.05"), value: "90 min", sourceKind: "documento", sourceRef: "Procedura interna, pagina 2" });
  assert.ok(recorded.ok, recorded.ok ? "" : recorded.message);
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`, [ids.lead, ids.analyst, ids.owner, ids.observer]);
});

test("questions: every question in one view, the referent's answer, no answers for the client, nothing yet for the developer", opts, async () => {
  const lead = await viewer(ids.lead, ["ls_lead"]);
  const status = await caseStatus();
  const now = new Date();
  const questions = [...state.items.keys()].filter((k) => k.startsWith("q."));
  const all = await loadQuestionsPage(exec!, lead, { searchParams: { vista: "tutte", indispensabili: "no" }, status, now });
  assert.ok(all);
  assert.equal(all.total, questions.length);
  assert.ok(all.rows.length <= 50);
  const answered = all.rows.find((r) => r.id === item("q.servizio.02"));
  assert.equal(answered?.status, "in_verifica");
  assert.equal(answered?.assignee, "Referente di prova");
  assert.ok(all.groups && all.groups.length > 0, "grouped by topic for Lateral Space");
  const observer = await loadQuestionsPage(exec!, await viewer(ids.observer, ["osservatore"]), { searchParams: { vista: "tutte", indispensabili: "no" }, status, now });
  assert.equal(observer!.audience, "cliente");
  assert.ok(observer!.rows.every((r) => r.answer === null && r.value === null), "the client never gets the answers");
  const dev = await loadQuestionsPage(exec!, { ...lead, roles: ["ls_sviluppatore"] }, { searchParams: {}, status, now });
  assert.equal(dev!.total, 0, "nothing is green yet");
});

test("item detail: answers, links, events and the four eyes", opts, async () => {
  const lead = await viewer(ids.lead, ["ls_lead"]);
  const detail = await loadItemDetail(exec!, lead, item("q.servizio.05"));
  assert.ok(detail);
  assert.equal(detail.answers.length, 1);
  assert.equal(detail.answers[0].provenance, "Documento · Procedura interna, pagina 2");
  assert.equal(detail.actions.validate?.ok, false, "who entered the value does not validate it");
  assert.ok(detail.links.length > 0);
  assert.ok(detail.events.length > 0);
  const owner = await loadItemDetail(exec!, await viewer(ids.owner, ["owner_cliente"]), item("q.servizio.02"));
  assert.ok(owner);
  assert.equal(owner.answers[0].responder, null);
  assert.equal(owner.answers[0].at, null);
  assert.ok(owner.events.every((e) => e.actor !== "Referente"));
  assert.equal(await loadItemDetail(exec!, lead, randomUUID()), null);
});

test("review queue, selection and ROI read without errors", opts, async () => {
  // The lead entered q.servizio.05: a colleague verifies it, the analyst verifies both.
  const leadQueue = await loadReviewQueue(exec!, await viewer(ids.lead, ["ls_lead"]));
  assert.deepEqual(leadQueue.ids, [item("q.servizio.02")]);
  assert.equal(leadQueue.mine, 1);
  const analystQueue = await loadReviewQueue(exec!, await viewer(ids.analyst, ["ls_analista"]));
  assert.deepEqual([...analystQueue.ids].sort(), [item("q.servizio.02"), item("q.servizio.05")].sort());
  const selection = await loadCatalogSelection(exec!, await viewer(ids.lead, ["ls_lead"]), { kind: "filtro", filter: parseCatalogFilter({ tipo: "domanda" }) });
  assert.equal(selection.total, [...state.items.keys()].filter((k) => k.startsWith("q.")).length);
  assert.equal(selection.truncated, false);
  const value = await loadValuePage(exec!, await viewer(ids.owner, ["owner_cliente"]));
  assert.equal(value!.roi.source, "template");
  assert.ok(value!.roi.costLines.length > 0);
});

// ── Schema letto una volta per impronta (DESIGN §7.1 P0-5 b) ───────────

/**
 * Uses of the template definition left in a statement once the parts guarded by
 * `hash` are taken out: the parts columns (`CASE WHEN t.definition_hash = ANY($n)
 * THEN NULL …`, with `hash` in `$n`) and the key lists (`coalesce($n::jsonb ->
 * t.definition_hash::text, …)`, with `hash` in `$n`). Postgres opens the
 * definition only in what is left.
 */
function unguardedDefinitionReads(s: UcStatement, hash: string): string[] {
  const param = (n: string) => s.params[Number(n) - 1];
  let text = s.text.replace(/CASE WHEN t\.definition_hash = ANY\(\$(\d+)::text\[\]\) THEN NULL ELSE jsonb_build_object\([\s\S]*?\) END AS template_parts/g, (all, n: string) => {
    const known = param(n);
    return Array.isArray(known) && known.includes(hash) ? "<parti in memoria>" : all;
  });
  text = text.replace(/coalesce\(\$(\d+)::jsonb -> t\.definition_hash::text, CASE WHEN jsonb_typeof\(t\.definition -> '\w+'\) = 'array' THEN t\.definition -> '\w+' ELSE '\[\]'::jsonb END\)/g, (all, n: string) => {
    const known = JSON.parse(String(param(n))) as Record<string, unknown>;
    return hash in known ? "<chiavi in memoria>" : all;
  });
  return text.match(/t\.definition(?!_hash)[^,)]*/g) ?? [];
}

test("the template's roles, modules, gates and ROI are read from the definition once per hash; every dossier page then reads them from memory", opts, async () => {
  forgetTemplateParts();
  const statements: UcStatement[] = [];
  const runs: Record<string, unknown>[][] = [];
  const inspecting: UcExecutor = {
    async batch(list) {
      statements.push(...list);
      const rows = await exec!.batch(list);
      runs.push(rows[0] ?? []);
      return rows;
    },
  };
  const first = caseViewContextReader(ids.ws, state.caseId);
  const firstCtx = first.parse((await inspecting.batch([first.statement]))[0]);
  assert.ok(firstCtx);
  assert.ok(runs[0][0].template_parts, "the first read extracts the parts");
  assert.ok(Object.keys(firstCtx.roleLabels).length > 0, "role labels from the template");
  assert.ok(firstCtx.modules.length > 0 && firstCtx.modules.every((m) => m.title.length > 0), "modules with their titles");
  const [hash] = rememberedTemplateHashes();
  assert.match(hash ?? "", /^[0-9a-f]{64}$/);

  const second = caseViewContextReader(ids.ws, state.caseId);
  const secondCtx = second.parse((await inspecting.batch([second.statement]))[0]);
  assert.equal(runs[1][0].template_parts, null, "the database skips the definition of a known hash");
  assert.equal(runs[1][0].template_hash, hash);
  assert.deepEqual(secondCtx, firstCtx, "same context from memory");

  // The loaders the dossier pages call, with a warm memory: not one statement opens the definition.
  statements.length = 0;
  const lead = await viewer(ids.lead, ["ls_lead"]);
  const status = await caseStatus();
  const now = new Date();
  const c = { workspaceId: ids.ws, caseId: state.caseId };
  const questions = await loadQuestionsPage(inspecting, lead, { searchParams: { vista: "tutte", indispensabili: "no" }, status, now });
  assert.deepEqual(questions!.ctx.roleLabels, firstCtx.roleLabels);
  assert.ok(questions!.groups!.length > 0 && questions!.groups!.every((g) => g.title !== null), "topics in schema order, with their titles");
  assert.ok(await loadQuestionDocuments(inspecting, lead));
  assert.ok(await loadItemDetail(inspecting, lead, item("q.servizio.05")));
  assert.ok(await loadOverview(inspecting, { ...c, now }));
  assert.ok(await loadVia(inspecting, { ...c, now }));
  assert.ok(await loadSolutionMap(inspecting, lead));
  assert.ok(await loadSolutionRules(inspecting, lead, parseRulesQuery({})));
  assert.ok(await loadSolutionData(inspecting, lead, parseDataQuery({})));
  const value = await loadValuePage(inspecting, lead);
  assert.equal(value!.roi.source, "template");
  assert.ok(value!.roi.costLines.length > 0, "the template's ROI from memory");
  assert.ok(await loadKpiPage(inspecting, lead, parseKpiParams({})));
  const people = await loadPeopleView(inspecting, { ...c, audience: "lateral_space" });
  assert.deepEqual(people!.roleLabels, firstCtx.roleLabels);
  assert.ok(await loadPrivacyPage(inspecting, { ...c, lsDomains: LS_DOMAINS }));
  const extras = await loadProgressExtras(inspecting, c);
  assert.ok(extras!.gate.approvers.length > 0, "G1 approvers from the template");
  assert.ok(await getCaseOverview(inspecting, await ctxFor(ids.lead)));
  assert.ok(statements.length > 15);
  for (const s of statements) assert.deepEqual(unguardedDefinitionReads(s, hash), [], s.text.slice(0, 120));

  // A cold memory gives the same gate, ROI and labels.
  forgetTemplateParts();
  const cold = await loadProgressExtras(exec!, c);
  assert.deepEqual(cold!.gate, extras!.gate, "same gate with an empty memory");
  forgetTemplateParts();
  assert.deepEqual((await loadValuePage(exec!, lead))!.roi, value!.roi, "same ROI with an empty memory");
  // Another workspace never reads this case, whatever the memory holds.
  const other = caseViewContextReader(randomUUID(), state.caseId);
  assert.equal(other.parse((await exec!.batch([other.statement]))[0]), null);
  forgetTemplateParts();
});

// ── Panoramica senza codici interni per il cliente (DESIGN §7.1 P0-12) ──

test("the Panoramica reads «In breve» and the phases without fact codes, and without articles or item keys for the client", opts, async () => {
  const [saved] = await q(`SELECT description FROM uc_cases WHERE id = $1::uuid`, [state.caseId]);
  // Synthetic text written as Lateral Space keeps its notes: fact codes, an article, an item key.
  const inBreve = "Il servizio risponde in giornata (F001, F002), come da art. 7.2; il volume è in q.servizio.02.";
  const fasi = [{ fase: "Prova (F003)", quando: "Maggio", cosa: "Si prova sui dati inventati, fonte F004.", uscita: "Il via (art. 9)" }];
  await q(`UPDATE uc_cases SET description = coalesce(description, '{}'::jsonb) || jsonb_build_object('in_breve', $2::text, 'fasi', $3::jsonb) WHERE id = $1::uuid`, [
    state.caseId,
    inBreve,
    JSON.stringify(fasi),
  ]);
  try {
    const c = { workspaceId: ids.ws, caseId: state.caseId };
    const texts = (d: Awaited<ReturnType<typeof loadOverview>>) => [d!.inBreve ?? "", ...d!.phases.flatMap((p) => Object.values(p))];
    const client = await loadOverview(exec!, c);
    assert.match(client!.inBreve ?? "", /^Il servizio risponde in giornata, /);
    assert.deepEqual(client!.phases, [{ fase: "Prova", quando: "Maggio", cosa: "Si prova sui dati inventati.", uscita: "Il via" }]);
    for (const text of texts(client)) assert.deepEqual(findForbidden(text, "cliente"), [], text);
    const ls = await loadOverview(exec!, { ...c, audience: "ls" });
    assert.ok(texts(ls).every((t) => !/F\d{3}/.test(t)), "no fact codes for Lateral Space either, as in the Descrizione");
    assert.match(ls!.inBreve ?? "", /art\. 7\.2/, "Lateral Space keeps the article");
  } finally {
    await q(`UPDATE uc_cases SET description = $2::jsonb WHERE id = $1::uuid`, [state.caseId, JSON.stringify(saved.description ?? null)]);
  }
});

// ── «Avvia la realizzazione» dalla lista di ripiego (PIANO-LAVORI §3.4 C13) ──

test("only approved use cases to build start a dossier, in the list and in createCase: no best practice, and an incomplete dossier does not count", opts, async () => {
  const card = (title: string, status: string, kind: string | null) => ({ id: randomUUID(), title, status, kind });
  const cards = [
    card("Da costruire", "accepted", "use_case_ai"),
    card("Senza tipo, di Activity mapping", "accepted", null),
    card("Best practice approvata", "accepted", "best_practice"),
    card("Proposta", "proposed", "use_case_ai"),
    card("Con il dossier", "accepted", "use_case_ai"),
    card("Con un dossier a metà", "accepted", "use_case_ai"),
  ];
  for (const c of cards) {
    await q(`INSERT INTO use_cases (id, workspace_id, title, status, portfolio_kind) VALUES ($1::uuid, $2::uuid, $3, $4, $5)`, [c.id, ids.ws, c.title, c.status, c.kind]);
  }
  const [withCase, halfway] = [cards[4], cards[5]];
  const template = await q(`SELECT template_id, organization_id FROM uc_cases WHERE id = $1::uuid`, [state.caseId]);
  const incomplete = randomUUID();
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, template_id, template_version, code, title, portfolio_use_case_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, '1.0.0', $5, 'Dossier a metà', $6::uuid)`,
    [incomplete, ids.ws, template[0].organization_id, template[0].template_id, `MET-${suffix}`.toUpperCase(), halfway.id],
  );
  const before = await q(`SELECT portfolio_use_case_id FROM uc_cases WHERE id = $1::uuid`, [state.caseId]);
  await q(`UPDATE uc_cases SET portfolio_use_case_id = $1::uuid WHERE id = $2::uuid`, [withCase.id, state.caseId]);
  try {
    const startable = await listStartablePortfolioCards(exec!, ids.ws);
    assert.deepEqual(startable.map((c) => c.title), ["Con un dossier a metà", "Da costruire", "Senza tipo, di Activity mapping"]);
    assert.deepEqual(await listStartablePortfolioCards(exec!, randomUUID()), [], "another workspace");
    // The server command says the same, even when called without the list (a direct POST to its action).
    const [template] = await q(`SELECT template_id FROM uc_cases WHERE id = $1::uuid`, [state.caseId]);
    const leadUser = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
    const start = (useCase: { id: string }, code: string) =>
      createCase(exec!, { workspaceId: ids.ws, user: leadUser!, canReviewWorkspacePortfolio: true, input: { templateId: String(template.template_id), code, title: "Dossier rifiutato", portfolioUseCaseId: useCase.id } });
    const refusals = [await start(cards[2], `BP-${suffix}`), await start(cards[3], `PRO-${suffix}`), await start(withCase, `DUE-${suffix}`)];
    assert.deepEqual(
      refusals.map((r) => (r.ok ? "ok" : r.code)),
      ["best_practice", "scheda_non_accettata", "caso_gia_avviato"],
    );
    const made = await q(`SELECT count(*)::int AS n FROM uc_cases WHERE workspace_id = $1::uuid AND upper(code) = ANY($2::text[])`, [ids.ws, [`BP-${suffix}`, `PRO-${suffix}`, `DUE-${suffix}`].map((c) => c.toUpperCase())]);
    assert.equal(made[0].n, 0, "no dossier was created");
  } finally {
    await q(`UPDATE uc_cases SET portfolio_use_case_id = $1::uuid WHERE id = $2::uuid`, [before[0].portfolio_use_case_id ?? null, state.caseId]);
    await q(`DELETE FROM uc_cases WHERE id = $1::uuid`, [incomplete]);
    await q(`DELETE FROM use_cases WHERE id = ANY($1::uuid[])`, [cards.map((c) => c.id)]);
  }
});
