import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { addCaseMember, commandContextFor, createCase, loadUserContext, type UcCommandContext } from "../db/queries/uc-cases.ts";
import { updateDescriptionBlock } from "../db/queries/uc-shell.ts";
import { loadSolutionData, loadSolutionDescription, loadSolutionMap, loadSolutionRules } from "../db/queries/uc-solution.ts";
import type { UcViewer } from "../db/queries/uc-views.ts";
import { planTemplateLoad } from "./template/load.ts";
import { findForbidden } from "./views/copy-guard.ts";
import { descriptionVersions, descriptionView, stableJson } from "./views/description.ts";
import { parseDataQuery, parseRulesQuery, SOLUTION_PAGE_SIZE } from "./views/model.ts";
import type { CaseRole } from "./vocab.ts";

// Opt-in integration suite for Soluzione (DESIGN §3.7, WP4): one round-trip per
// page, rules and data searched and paged in the database, links only for the
// item open in the panel. On the isolated local harness only, with the same guard
// as the other uc integration suites:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/solution.integration.test.ts
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

/** Esecutore che conta i giri: ogni lettura di Soluzione deve farne uno. */
function counting(): { executor: UcExecutor; calls: () => number } {
  let n = 0;
  return {
    executor: {
      batch(statements) {
        n += 1;
        return exec!.batch(statements);
      },
    },
    calls: () => n,
  };
}

const LS_DOMAINS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), otherWs: randomUUID(), lead: randomUUID(), owner: randomUUID(), dev: randomUUID(), contact: randomUUID() };
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state: { caseId: string; items: Map<string, string> } = { caseId: "", items: new Map() };
const EXTRA_RULES = 130;
const EXTRA_PARAMETERS = 105;

async function ctxFor(userId: string): Promise<UcCommandContext> {
  const r = await commandContextFor(exec!, { workspaceId: ids.ws, caseId: state.caseId, userId, lsDomains: LS_DOMAINS });
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.value;
}

async function viewerFor(userId: string, roles: CaseRole[], workspaceId = ids.ws): Promise<UcViewer> {
  const user = await loadUserContext(exec!, userId, LS_DOMAINS);
  assert.ok(user);
  return { workspaceId, caseId: state.caseId, roles, user, readOnly: false };
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova soluzione', $2)`, [ids.org, `uc-solution-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova soluzione'), ($2::uuid, $3::uuid, 'Altra soluzione')`, [ids.ws, ids.otherWs, ids.org]);
  await q(
    `INSERT INTO users (id, email, email_verified, name) VALUES ($1::uuid, $4, now(), 'Lead di prova'), ($2::uuid, $5, now(), 'Owner di prova'), ($3::uuid, $6, now(), 'Sviluppatore di prova')`,
    [ids.lead, ids.owner, ids.dev, `sol-lead-${suffix}@ls.test`, `sol-owner-${suffix}@cliente.test`, `sol-dev-${suffix}@ls.test`],
  );
  await q(`INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $4::uuid, 'transformation_lead'), ($2::uuid, $4::uuid, 'contributor'), ($3::uuid, $4::uuid, 'analyst')`, [
    ids.lead,
    ids.owner,
    ids.dev,
    ids.org,
  ]);
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.soluzione_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const leadUser = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  const created = await createCase(exec!, { workspaceId: ids.ws, user: leadUser!, canReviewWorkspacePortfolio: true, input: { templateId: loaded.value.templateId, code: `SOL-${suffix}`.toUpperCase(), title: "Caso della soluzione" } });
  assert.ok(created.ok, created.ok ? "" : created.message);
  state.caseId = created.value.caseId;
  const lead = await ctxFor(ids.lead);
  for (const [userId, role] of [
    [ids.owner, "owner_cliente"],
    [ids.dev, "ls_sviluppatore"],
  ] as const) {
    const r = await addCaseMember(exec!, lead, { userId, role });
    assert.ok(r.ok, r.ok ? "" : r.message);
  }
  // Regole sintetiche in più, per le pagine: tre ruoli che confermano (uno senza ruolo), alcune da verificare e fuori contratto.
  await q(
    `INSERT INTO uc_items (case_id, key, kind, section, title, explanation, owner_role_key, status, perimeter, sort_order)
     SELECT $1::uuid, 'rule.prova.r_' || lpad(n::text, 3, '0'), 'regola', 'regole', 'Regola di prova ' || n, 'Spiegazione inventata ' || n,
       CASE n % 3 WHEN 0 THEN 'resp_servizio' WHEN 1 THEN 'controllo_gestione' ELSE NULL END,
       CASE WHEN n % 10 = 0 THEN 'in_verifica' ELSE 'da_chiedere' END,
       CASE WHEN n % 13 = 0 THEN 'evoluzione' ELSE 'in_contratto' END,
       1000 + n
     FROM generate_series(1, ${EXTRA_RULES}) AS n`,
    [state.caseId],
  );
  await q(
    `INSERT INTO uc_items (case_id, key, kind, section, title, sort_order)
     SELECT $1::uuid, 'par.prova_' || lpad(n::text, 3, '0'), 'parametro', 'modello_dati', 'Parametro di prova ' || n, 2000 + n
     FROM generate_series(1, ${EXTRA_PARAMETERS}) AS n`,
    [state.caseId],
  );
  for (const r of await q(`SELECT id, key FROM uc_items WHERE case_id = $1::uuid`, [state.caseId])) state.items.set(String(r.key), String(r.id));
  await q(`INSERT INTO uc_contacts (id, workspace_id, display_name, email, template_role_key) VALUES ($1::uuid, $2::uuid, 'Referente della soluzione', $3, 'resp_servizio')`, [
    ids.contact,
    ids.ws,
    `sol-ref-${suffix}@cliente.test`,
  ]);
  // Una domanda con referente e ruolo titolare: Lateral Space vede il nome, il cliente il ruolo.
  await q(`UPDATE uc_items SET assignee_contact_id = $1::uuid, owner_role_key = 'resp_servizio' WHERE id = $2::uuid`, [ids.contact, state.items.get("richiesta.canale")]);
  await q(`UPDATE uc_cases SET perimeter_label = 'Canale email' WHERE id = $1::uuid`, [state.caseId]);
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1::uuid, $2::uuid)`, [ids.ws, ids.otherWs]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid)`, [ids.lead, ids.owner, ids.dev]);
});

test("description: one round-trip with the perimeter label, the versions and their authors", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const first = await loadSolutionDescription(exec!, { workspaceId: ids.ws, caseId: state.caseId });
  assert.ok(first);
  const r = await updateDescriptionBlock(exec!, lead, { block: "esempio", value: "Una richiesta inventata arriva via chat (F010).", base: stableJson(first.description.esempio ?? null) });
  assert.ok(r.ok, r.ok ? "" : r.message);
  const c = counting();
  const data = await loadSolutionDescription(c.executor, { workspaceId: ids.ws, caseId: state.caseId });
  assert.equal(c.calls(), 1, "one round-trip, no live readiness");
  assert.ok(data);
  assert.equal(data.perimeterLabel, "Canale email");
  assert.equal(data.history.length, first.history.length + 1);
  assert.equal(data.authors.get(ids.lead), "Lead di prova");
  assert.deepEqual(descriptionVersions(data.description, data.history)[0].changed, ["esempio"]);
  const view = descriptionView(data.description, { audience: "cliente" });
  const esempio = view.main.find((b) => b.def.key === "esempio");
  assert.deepEqual(esempio?.content, { kind: "testo", text: "Una richiesta inventata arriva via chat." }, "no fact codes in the reading column");
  assert.equal(await loadSolutionDescription(exec!, { workspaceId: ids.otherWs, caseId: state.caseId }), null, "never from another workspace");
});

test("map: one round-trip with the cited questions; the client sees roles, never the referent's name", opts, async () => {
  const c = counting();
  const lsData = await loadSolutionMap(c.executor, await viewerFor(ids.lead, ["ls_lead"]));
  assert.equal(c.calls(), 1, "maps and cited questions in the same transaction");
  assert.ok(lsData?.maps.solution);
  const nodes = lsData.maps.solution.nodes;
  assert.equal(nodes.length, 6);
  const first = nodes.find((n) => n.id === "n1")!;
  const canale = first.items.find((i) => i.key === "richiesta.canale")!;
  assert.equal(canale.title, "Canale di arrivo");
  assert.equal(canale.owner, "Referente della soluzione");
  const client = await loadSolutionMap(exec!, await viewerFor(ids.owner, ["owner_cliente"]));
  const clientCanale = client!.maps.solution!.nodes.find((n) => n.id === "n1")!.items.find((i) => i.key === "richiesta.canale")!;
  assert.equal(clientCanale.owner, "Responsabile del servizio clienti", "the role that answers, never the contact's name (art. 15.4)");
  assert.notEqual(clientCanale.owner, canale.owner);
  assert.equal(await loadSolutionMap(exec!, await viewerFor(ids.lead, ["ls_lead"], ids.otherWs)), null);
});

test("rules: one round-trip, pages of 100 grouped by who confirms them, counts of every page", opts, async () => {
  const viewer = await viewerFor(ids.lead, ["ls_lead"]);
  const c = counting();
  const page1 = await loadSolutionRules(c.executor, viewer, parseRulesQuery({}));
  assert.equal(c.calls(), 1);
  assert.ok(page1);
  assert.equal(page1.hasRules, true);
  assert.equal(page1.hasConstraints, true);
  assert.equal(page1.total, EXTRA_RULES + 2);
  assert.equal(page1.pages, 2);
  const rows1 = page1.groups.flatMap((g) => g.rows);
  assert.equal(rows1.length, SOLUTION_PAGE_SIZE);
  assert.deepEqual(
    page1.groups.map((g) => [g.label, g.total, g.rows.length]),
    [
      ["Responsabile del servizio clienti", 44, 44],
      ["Controllo di gestione", 44, 44],
      ["Approvatore della scheda privacy", 1, 1],
      ["da indicare", 43, 11],
    ],
    "groups in the order of the template roles, rules without a confirmer last, counts of every page",
  );
  for (const row of rows1) assert.deepEqual(Object.keys(row).sort(), ["id", "kind", "roleKey", "status", "title"], "a row carries no link arrays");
  const page2 = await loadSolutionRules(exec!, viewer, parseRulesQuery({ pagina: "2" }));
  const rows2 = page2!.groups.flatMap((g) => g.rows);
  assert.equal(rows2.length, EXTRA_RULES + 2 - SOLUTION_PAGE_SIZE);
  assert.deepEqual(
    page2!.groups.map((g) => [g.label, g.total, g.rows.length]),
    [["da indicare", 43, 32]],
  );
  assert.equal(new Set([...rows1, ...rows2].map((r) => r.id)).size, EXTRA_RULES + 2, "no rule on two pages");
});

test("rules: search by key or words, filters, the constraints switch", opts, async () => {
  const viewer = await viewerFor(ids.lead, ["ls_lead"]);
  const byKey = await loadSolutionRules(exec!, viewer, parseRulesQuery({ q: "rule.prova.r_07" }));
  assert.deepEqual(
    byKey!.groups.flatMap((g) => g.rows.map((r) => r.title)).sort(),
    ["Regola di prova 70", "Regola di prova 71", "Regola di prova 72", "Regola di prova 73", "Regola di prova 74", "Regola di prova 75", "Regola di prova 76", "Regola di prova 77", "Regola di prova 78", "Regola di prova 79"],
    "pasting a key works",
  );
  const byWords = await loadSolutionRules(exec!, viewer, parseRulesQuery({ q: "URGENTI" }));
  assert.deepEqual(byWords!.groups.flatMap((g) => g.rows.map((r) => r.title)), ["Le richieste urgenti si lavorano prima delle altre"]);
  const byExplanation = await loadSolutionRules(exec!, viewer, parseRulesQuery({ q: "inventata 129" }));
  assert.equal(byExplanation!.total, 1);
  const toVerify = await loadSolutionRules(exec!, viewer, parseRulesQuery({ stato: "da-verificare" }));
  assert.equal(toVerify!.total, 13);
  assert.ok(toVerify!.groups.every((g) => g.rows.every((r) => r.status === "in_verifica")));
  const outside = await loadSolutionRules(exec!, viewer, parseRulesQuery({ perimetro: "fuori" }));
  assert.equal(outside!.total, 10);
  const none = await loadSolutionRules(exec!, viewer, parseRulesQuery({ q: "nessuna regola si chiama così" }));
  assert.equal(none!.total, 0);
  assert.equal(none!.hasRules, true, "the empty search is not an empty schema");
  const withConstraints = await loadSolutionRules(exec!, viewer, parseRulesQuery({ vincoli: "1", q: "orario" }));
  assert.deepEqual(withConstraints!.groups.flatMap((g) => g.rows.map((r) => r.kind)), ["vincolo_rigido"]);
});

test("rules: the open rule comes in the same round-trip with its links and its confirmation question", opts, async () => {
  const viewer = await viewerFor(ids.lead, ["ls_lead"]);
  const id = state.items.get("rule.servizio.urgenti_prima")!;
  const c = counting();
  const data = await loadSolutionRules(c.executor, viewer, parseRulesQuery({ apri: id }));
  assert.equal(c.calls(), 1);
  const open = data!.open!;
  assert.equal(open.key, "rule.servizio.urgenti_prima");
  assert.equal(open.ownerRoleLabel, "Responsabile del servizio clienti");
  assert.equal(open.confirmation.question?.key, "q.servizio.03");
  const relations = open.links.map((g) => `${g.direction}:${g.relation}`);
  for (const r of ["in:precisa", "out:usa", "out:vincola"]) assert.ok(relations.includes(r), r);
  assert.equal(open.locked, false);
  const other = await loadSolutionRules(exec!, viewer, parseRulesQuery({ apri: state.items.get("ent.richiesta")! }));
  assert.equal(other!.open, null, "the panel opens rules and constraints only");
});

test("data: pages of 100, groups by kind, entities by domain, the old ?entita= link opens the panel", opts, async () => {
  const lead = await viewerFor(ids.lead, ["ls_lead"]);
  const c = counting();
  const variables = await loadSolutionData(c.executor, lead, parseDataQuery({ vista: "variabili" }));
  assert.equal(c.calls(), 1);
  // Variabili del modello dello schema d'esempio: 1 decisione, 3 parametri, 2 vincoli, 1 obiettivo, 1 incertezza, 1 uscita.
  const templateVariables = 9;
  assert.equal(variables!.total, EXTRA_PARAMETERS + templateVariables);
  assert.equal(variables!.pages, 2);
  assert.equal(variables!.rows.length, SOLUTION_PAGE_SIZE);
  assert.equal(variables!.rows[0].group, "Decisioni", "the kinds in the order of the model");
  for (const row of variables!.rows) assert.deepEqual(Object.keys(row).sort(), ["group", "id", "kind", "line", "locked", "status", "title"]);
  const second = await loadSolutionData(exec!, lead, parseDataQuery({ vista: "variabili", pagina: "2" }));
  assert.equal(second!.rows.length, EXTRA_PARAMETERS + templateVariables - SOLUTION_PAGE_SIZE);
  const search = await loadSolutionData(exec!, lead, parseDataQuery({ vista: "variabili", q: "par.prova_10" }));
  assert.equal(search!.total, 6, "par.prova_100 to par.prova_105");

  const entities = await loadSolutionData(exec!, lead, parseDataQuery({ vista: "entita", entita: "ent.operatore" }));
  assert.deepEqual(entities!.rows.map((r) => [r.title, r.group, r.locked]), [
    ["Operatore", "Persone", true],
    ["Richiesta di assistenza", "Servizio", false],
    ["Cliente", "Servizio", false],
  ]);
  const open = entities!.open!;
  assert.equal(open.item.key, "ent.operatore");
  assert.equal(open.locked, true, "after the privacy card while its blocker is active");
  const turno = open.fields!.find((f) => f.key === "operatore.turno")!;
  assert.deepEqual(turno.sources, ["Turni degli operatori"], "sources by title, never by key");
  assert.equal(turno.locked, true);

  const sources = await loadSolutionData(exec!, lead, parseDataQuery({ vista: "fonti" }));
  assert.ok(sources!.rows.some((r) => r.title === "Crm · Export delle richieste degli ultimi 12 mesi"));
  const tests = await loadSolutionData(exec!, lead, parseDataQuery({ vista: "prova" }));
  assert.equal(tests!.rows.length, 0);
  assert.equal(tests!.testCases.length, tests!.total);
  assert.equal(await loadSolutionData(exec!, await viewerFor(ids.lead, ["ls_lead"], ids.otherWs), parseDataQuery({})), null);
});

test("data: the client reaching the address sees titles; the developer opens only what is done", opts, async () => {
  const owner = await viewerFor(ids.owner, ["owner_cliente"]);
  const data = await loadSolutionData(exec!, owner, parseDataQuery({ vista: "fonti" }));
  const texts = data!.rows.flatMap((r) => [r.title, r.line ?? ""]);
  assert.deepEqual(
    texts.flatMap((t) => findForbidden(t, "cliente")),
    [],
    "no keys in the rows",
  );
  const dev = await viewerFor(ids.dev, ["ls_sviluppatore"]);
  const opened = await loadSolutionData(exec!, dev, parseDataQuery({ vista: "entita", apri: state.items.get("ent.richiesta")! }));
  assert.equal(opened!.open!.item.canOpen, false, "the developer opens only answered questions");
});
