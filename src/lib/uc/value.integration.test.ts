import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { applyTemplateLoad } from "../db/queries/uc-templates.ts";
import { addCaseMember, commandContextFor, createCase, loadUserContext, updateCaseRoi, type UcCommandContext } from "../db/queries/uc-cases.ts";
import { applyRoiTotals, loadKpiPage, loadRoiTotals, loadValuePage, planRoiTotals, saveCaseRoi } from "../db/queries/uc-value.ts";
import type { UcViewer } from "../db/queries/uc-views.ts";
import { planTemplateLoad } from "./template/load.ts";
import { findForbiddenIn } from "./views/copy-guard.ts";
import { parseKpiParams } from "./views/kpi.ts";
import { EMPTY_ROI_TOTALS, roiTotals, roiUpdateInput, type BenefitLine, type CostLine } from "./views/roi-edit.ts";
import type { CaseRole } from "./vocab.ts";

// Opt-in integration suite for Valore (WP5): the account saved with its totals (the
// «dossier» cost source of the Use case page), the one-off backfill of the totals, the
// Valore page reads and the KPI page searched and grouped in the database. Isolated
// local harness only, on the package's own database:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/<db> UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/value.integration.test.ts
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
const state = { caseId: "", oldCaseId: "", items: new Map<string, string>() };

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

async function storedTotals(caseId = state.caseId) {
  const [r] = await q(
    `SELECT implementation_cost, annual_run_cost, annual_benefit, break_even_months, value_5y, updated_at::text AS seen FROM uc_roi_models WHERE case_id = $1::uuid AND scenario = 'base' ORDER BY version DESC LIMIT 1`,
    [caseId],
  );
  return r;
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova valore', $2)`, [ids.org, `uc-val-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Prova valore')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $4, now()), ($2::uuid, $5, now()), ($3::uuid, $6, now())`, [
    ids.lead,
    ids.analyst,
    ids.owner,
    `val-lead-${suffix}@ls.test`,
    `val-analista-${suffix}@ls.test`,
    `val-owner-${suffix}@cliente.test`,
  ]);
  await q(
    `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $4::uuid, 'transformation_lead'), ($2::uuid, $4::uuid, 'analyst'), ($3::uuid, $4::uuid, 'contributor')`,
    [ids.lead, ids.analyst, ids.owner, ids.org],
  );
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.valore_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  const lead = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  for (const [code, key] of [
    [`val-${suffix}`, "caseId"],
    [`valold-${suffix}`, "oldCaseId"],
  ] as const) {
    const created = await createCase(exec!, {
      workspaceId: ids.ws,
      user: lead!,
      canReviewWorkspacePortfolio: true,
      input: { templateId: loaded.value.templateId, code, title: "Caso del valore", levers: ["tempo", "decisioni"] },
    });
    assert.ok(created.ok, created.ok ? "" : created.message);
    state[key] = created.value.caseId;
  }
  for (const r of await q(`SELECT id, key FROM uc_items WHERE case_id = $1::uuid`, [state.caseId])) state.items.set(String(r.key), String(r.id));
  const leadCtx = await ctxFor(ids.lead);
  for (const [userId, role] of [
    [ids.analyst, "ls_analista"],
    [ids.owner, "owner_cliente"],
  ] as const) {
    const r = await addCaseMember(exec!, leadCtx, { userId, role });
    assert.ok(r.ok, r.ok ? "" : r.message);
  }
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid)`, [ids.lead, ids.analyst, ids.owner]);
});

/** Righe dello schema d'esempio con tipi e valori: il conto si calcola. */
function completeLines(costLines: readonly CostLine[], benefitLines: readonly BenefitLine[]) {
  return {
    costLines: costLines.map((c, i) => ({ ...c, kind: i === 0 ? ("una_tantum" as const) : ("ricorrente" as const), value: i === 0 ? 36000 : 6000, status: "stima" as const })),
    benefitLines: benefitLines.map((b) => ({ ...b, value: 30000, status: "stima" as const })),
  };
}

test("Valore reads the account of the starting schema, the active levers and the open questions of the account", opts, async () => {
  const page = await loadValuePage(exec!, await viewer(ids.lead, ["ls_lead"]));
  assert.ok(page);
  assert.equal(page.roi.source, "template");
  assert.equal(page.roi.seen, null);
  assert.equal(page.view.computed, false);
  assert.deepEqual(
    page.view.figures.map((f) => f.note),
    ["da calcolare", "da calcolare", "da calcolare"],
  );
  // q.servizio.02 refines a KPI of the account, q.costi.01 and q.costi.04 the hourly cost parameter: both serve the ROI.
  assert.deepEqual(page.view.missing.questions.map((x) => x.key).sort(), ["q.costi.01", "q.costi.04", "q.servizio.02"]);
  assert.equal(page.view.missing.questionTotal, 3);
  assert.equal(page.view.missing.questions[page.view.missing.questions.length - 1].key, "q.costi.04", "the indispensable ones first");
  assert.equal(page.view.missing.total, 3 + page.roi.computed.gaps.length);
  assert.deepEqual(
    page.view.levers.map((l) => l.id),
    ["leva-tempo_risparmiato", "leva-costo_ridotto", "nuova-leva-decisioni"],
  );
  assert.equal(page.view.kpiTotal, 2);
  assert.deepEqual(page.view.levers[0].kpis.map((k) => k.title).sort(), ["Tempo medio alla prima risposta"]);
  // A question taken out of the catalog leaves the list.
  await q(`UPDATE uc_items SET deleted_at = now() WHERE id = $1::uuid`, [state.items.get("q.costi.04")]);
  const again = await loadValuePage(exec!, await viewer(ids.lead, ["ls_lead"]));
  assert.deepEqual(again!.view.missing.questions.map((x) => x.key).sort(), ["q.costi.01", "q.servizio.02"]);
  await q(`UPDATE uc_items SET deleted_at = NULL WHERE id = $1::uuid`, [state.items.get("q.costi.04")]);
});

test("AI Board and Osservatore, who have no Domande, see how many questions the account misses, not which", opts, async () => {
  const lead = await loadValuePage(exec!, await viewer(ids.lead, ["ls_lead"]));
  const titles = lead!.view.missing.questions.map((x) => x.title);
  assert.equal(titles.length, 3);
  for (const role of ["osservatore", "ai_board"] as const) {
    const page = await loadValuePage(exec!, await viewer(ids.owner, [role]));
    assert.ok(page);
    assert.deepEqual(page.view.missing.questions, [], role);
    assert.equal(page.view.missing.questionTotal, 3, `${role}: the count stays`);
    assert.equal(page.view.missing.total, lead!.view.missing.total, `${role}: «Mancano N dati» is the same number`);
    const shown = JSON.stringify(page.view);
    for (const title of titles) assert.ok(!shown.includes(title), `${role} reads no question title (${title})`);
  }
});

test("what the client reads on Valore has no keys, articles or jargon", opts, async () => {
  const page = await loadValuePage(exec!, await viewer(ids.owner, ["owner_cliente"]));
  assert.ok(page);
  const v = page.view;
  const texts = [
    v.statusLabel,
    v.disclaimer,
    ...v.figures.flatMap((f) => [f.label, f.value ?? "", f.note ?? ""]),
    ...v.levers.flatMap((l) => [l.label, l.value ?? "", l.description ?? "", l.howToEuro ?? "", ...l.kpis.map((k) => k.title)]),
    ...v.costs.flatMap((c) => [c.label, c.value ?? "", c.valueNote ?? "", c.howEstimated ?? "", c.source ?? "", c.kind]),
    ...v.missing.questions.map((x) => x.title),
    ...v.missing.lines.flatMap((l) => [l.label, l.reason]),
    ...v.missing.needs,
    ...v.how.method,
    ...v.how.formula,
    ...(v.how.example.note ? [v.how.example.note] : []),
  ];
  assert.deepEqual(findForbiddenIn(texts, "cliente"), []);
  assert.deepEqual(
    texts.filter((t) => /\b(baseline|backtest)\b/i.test(t)),
    [],
    "§2.6: «valore di partenza» and «prova sul passato»",
  );
});

test("the KPI panel shows starting value and target without fact codes, articles or keys; Lateral Space keeps the schema text", opts, async () => {
  const kpiId = state.items.get("kpi.servizio.tempo_prima_risposta")!;
  const [saved] = await q(`SELECT spec::text AS spec FROM uc_items WHERE id = $1::uuid`, [kpiId]);
  const baseline = "Misurata nel backtest di marzo (F010, F011), come kpi.servizio.costo_per_richiesta";
  await q(`UPDATE uc_items SET spec = spec || $2::jsonb WHERE id = $1::uuid`, [kpiId, JSON.stringify({ baseline, target: "-20% sulla baseline (art. 8.4)" })]);
  try {
    const client = await loadKpiPage(exec!, await viewer(ids.owner, ["owner_cliente"]), parseKpiParams({ apri: kpiId, vista: "tutti" }));
    const panel = client!.open!;
    assert.equal(panel.baseline, "Misurata nella prova sul passato di marzo, come Costo medio per richiesta");
    assert.equal(panel.target, "-20% sul valore di partenza");
    assert.deepEqual(findForbiddenIn([panel.baseline, panel.target], "cliente"), []);
    const lead = await loadKpiPage(exec!, await viewer(ids.lead, ["ls_lead"]), parseKpiParams({ apri: kpiId }));
    assert.equal(lead!.open?.baseline, panel.baseline, "the same text for everyone");
    assert.equal(lead!.open?.item.fields.baseline, baseline, "the schema text, for «Dettagli tecnici»");
  } finally {
    await q(`UPDATE uc_items SET spec = $2::jsonb WHERE id = $1::uuid`, [kpiId, saved.spec]);
  }
});

test("saving the account writes the totals the Use case page reads, and empties them while it is «da calcolare»", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const page = await loadValuePage(exec!, await viewer(ids.lead, ["ls_lead"]));
  const roi = page!.roi;
  const done = completeLines(roi.costLines, roi.benefitLines);
  const first = await saveCaseRoi(exec!, lead, roiUpdateInput({ ...done, content: roi.content, seen: roi.seen }));
  assert.ok(first.ok, first.ok ? "" : first.message);
  const expected = roiTotals(done);
  assert.equal(expected.implementationCost, 36000);
  assert.deepEqual(first.value.totals, expected);
  const totals = await loadRoiTotals(exec!, [state.caseId, randomUUID(), "non un id"]);
  assert.deepEqual(totals.get(state.caseId), expected, "the Use case page reads them without computing the account again");
  assert.equal(totals.size, 1);
  const stored = await storedTotals();
  assert.equal(Number(stored.implementation_cost), 36000);
  assert.equal(Number(stored.annual_benefit), 60000);
  assert.equal(Number(stored.annual_run_cost), 6000);
  assert.equal(Number(stored.break_even_months), 8);
  assert.equal(Number(stored.value_5y), 5 * 54000 - 36000);
  const [event] = await q(`SELECT payload FROM uc_events WHERE case_id = $1::uuid AND event_type = 'caso.descrizione_modificata' ORDER BY created_at DESC LIMIT 1`, [state.caseId]);
  assert.deepEqual((event.payload as { blocks?: string[] }).blocks, ["roi"]);

  // A cost line without a value: the account is «da calcolare» again and the totals are empty.
  const saved = await loadValuePage(exec!, await viewer(ids.lead, ["ls_lead"]));
  assert.equal(saved!.roi.source, "modello");
  assert.equal(saved!.view.computed, true);
  assert.equal(saved!.view.missing.lines.length, 0);
  const open = saved!.roi.costLines.map((c, i) => (i === 1 ? { ...c, value: null } : c));
  const second = await saveCaseRoi(exec!, lead, roiUpdateInput({ costLines: open, benefitLines: null, content: saved!.roi.content, seen: saved!.roi.seen }));
  assert.ok(second.ok, second.ok ? "" : second.message);
  assert.deepEqual(second.value.totals, EMPTY_ROI_TOTALS);
  assert.deepEqual((await loadRoiTotals(exec!, [state.caseId])).get(state.caseId), EMPTY_ROI_TOTALS);
  const reread = await loadValuePage(exec!, await viewer(ids.lead, ["ls_lead"]));
  assert.equal(reread!.view.computed, false);
  assert.deepEqual(reread!.view.missing.lines.map((l) => l.reason), ["Costo da stimare"]);
});

test("a save made on an account changed in the meantime is refused; only the Lateral Space lead saves", opts, async () => {
  const lead = await ctxFor(ids.lead);
  const page = await loadValuePage(exec!, await viewer(ids.lead, ["ls_lead"]));
  const roi = page!.roi;
  assert.ok(roi.seen);
  const ok = await saveCaseRoi(exec!, lead, roiUpdateInput({ costLines: roi.costLines, benefitLines: null, content: roi.content, seen: roi.seen }));
  assert.ok(ok.ok, ok.ok ? "" : ok.message);
  // The same page saves again: the model has changed since it was read.
  const stale = await saveCaseRoi(exec!, lead, roiUpdateInput({ costLines: roi.costLines, benefitLines: null, content: roi.content, seen: roi.seen }));
  assert.equal(stale.ok, false);
  assert.equal(stale.ok ? "" : stale.code, "conflitto");
  assert.match(stale.ok ? "" : stale.message, /cambiato nel frattempo/);
  const noModelSeen = await saveCaseRoi(exec!, lead, roiUpdateInput({ costLines: roi.costLines, benefitLines: null, content: roi.content, seen: null }));
  assert.equal(noModelSeen.ok ? "" : noModelSeen.code, "conflitto", "the page saw no model, but there is one now");
  const unchecked = await saveCaseRoi(exec!, lead, roiUpdateInput({ costLines: roi.costLines, benefitLines: null, content: roi.content }));
  assert.ok(unchecked.ok, "without `seen` the command behaves like updateCaseRoi");
  const analyst = await saveCaseRoi(exec!, await ctxFor(ids.analyst), roiUpdateInput({ costLines: roi.costLines, benefitLines: null, content: roi.content }));
  assert.equal(analyst.ok ? "" : analyst.code, "attore_non_ammesso");
  const dup = await saveCaseRoi(exec!, lead, { costLines: [...roiUpdateInput({ costLines: roi.costLines, benefitLines: null, content: {} }).costLines!, roiUpdateInput({ costLines: roi.costLines, benefitLines: null, content: {} }).costLines![0]] });
  assert.equal(dup.ok, false);
  assert.match(dup.ok ? "" : dup.message, /stessa chiave/);
  const unknown = await saveCaseRoi(exec!, lead, { costLines: [{ ...roiUpdateInput({ costLines: roi.costLines, benefitLines: null, content: {} }).costLines![0], colore: "rosso" }] });
  assert.match(unknown.ok ? "" : unknown.message, /Riga di costo 1: campo non previsto \(colore\)/);
  // 101 lines with different keys: too many, not «the same key».
  const one = roiUpdateInput({ costLines: roi.costLines, benefitLines: null, content: {} }).costLines![0];
  const tooMany = await saveCaseRoi(exec!, lead, { costLines: Array.from({ length: 101 }, (_, i) => ({ ...one, key: `riga_${i}` })) });
  assert.equal(tooMany.ok ? "" : tooMany.code, "dati_non_validi");
  assert.equal(tooMany.ok ? "" : tooMany.message, "Righe di costo: al massimo 100.");
  const notAList = await saveCaseRoi(exec!, lead, { benefitLines: "tutte" });
  assert.equal(notAList.ok ? "" : notAList.message, "Righe di beneficio: controlla l'elenco.");
});

test("the one-off backfill fills the totals of accounts saved before, without touching the lines, and finds nothing the second time", opts, async () => {
  // An account saved with the command of yesterday: lines complete, totals empty.
  const lead = await ctxFor(ids.lead, state.oldCaseId);
  const page = await loadValuePage(exec!, await viewer(ids.lead, ["ls_lead"], state.oldCaseId));
  const done = completeLines(page!.roi.costLines, page!.roi.benefitLines);
  const old = await updateCaseRoi(exec!, lead, roiUpdateInput({ ...done, content: page!.roi.content }));
  assert.ok(old.ok, old.ok ? "" : old.message);
  const before = await storedTotals(state.oldCaseId);
  assert.equal(before.implementation_cost, null);
  const plan = await planRoiTotals(exec!);
  const mine = plan.changes.filter((c) => c.caseId === state.oldCaseId);
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0].after, roiTotals(done));
  assert.ok(!plan.changes.some((c) => c.caseId === state.caseId), "the account saved by saveCaseRoi is already right");
  // A model changed after the plan is skipped, not overwritten.
  await q(`UPDATE uc_roi_models SET updated_at = now() WHERE id = $1::uuid`, [mine[0].id]);
  const skipped = await applyRoiTotals(exec!, mine);
  assert.deepEqual(skipped, { updated: 0, skipped: [mine[0].id] });
  const fresh = (await planRoiTotals(exec!)).changes.filter((c) => c.caseId === state.oldCaseId);
  const applied = await applyRoiTotals(exec!, fresh);
  assert.deepEqual(applied, { updated: 1, skipped: [] });
  const after = await storedTotals(state.oldCaseId);
  assert.equal(Number(after.implementation_cost), 36000);
  assert.equal(after.seen, (await q(`SELECT updated_at::text AS seen FROM uc_roi_models WHERE id = $1::uuid`, [mine[0].id]))[0].seen, "updated_at is left as it was");
  assert.equal((await planRoiTotals(exec!)).changes.filter((c) => c.caseId === state.oldCaseId).length, 0);
});

test("/valore/kpi: light rows searched in the database, linked to the account, grouped by lever, one KPI opened with its links", opts, async () => {
  const lead = await viewer(ids.lead, ["ls_lead"]);
  const all = await loadKpiPage(exec!, lead, parseKpiParams({}));
  assert.ok(all);
  assert.equal(all.counts.tutti, 2);
  assert.equal(all.counts.conto, 2, "both KPIs measure a line of the account");
  assert.equal(all.view, "conto");
  assert.deepEqual(
    all.groups.map((g) => [g.lever, g.items.map((k) => k.key)]),
    [
      ["tempo", ["kpi.servizio.tempo_prima_risposta"]],
      ["costi", ["kpi.servizio.costo_per_richiesta"]],
    ],
  );
  assert.equal(all.open, null);
  const payload = JSON.stringify(all.groups);
  assert.ok(!/alimentato_da|precisa|"links"/.test(payload), "no links reach the client");
  const search = await loadKpiPage(exec!, lead, parseKpiParams({ q: "COSTO medio", vista: "tutti" }));
  assert.deepEqual(search!.groups.flatMap((g) => g.items.map((k) => k.key)), ["kpi.servizio.costo_per_richiesta"]);
  assert.equal(search!.counts.tutti, 1);
  const byKey = await loadKpiPage(exec!, lead, parseKpiParams({ q: "tempo_prima" }));
  assert.equal(byKey!.shown, 1, "pasting a key finds it");
  const none = await loadKpiPage(exec!, lead, parseKpiParams({ q: "niente del genere" }));
  assert.equal(none!.shown, 0);
  const kpiId = state.items.get("kpi.servizio.tempo_prima_risposta")!;
  const opened = await loadKpiPage(exec!, lead, parseKpiParams({ apri: kpiId }));
  assert.equal(opened!.open?.item.id, kpiId);
  assert.deepEqual(opened!.open?.confirmQuestions.map((x) => x.key), ["q.servizio.02"]);
  assert.deepEqual(opened!.open?.sources.map((x) => x.key), ["src.crm.richieste"]);
  assert.equal(opened!.open?.data.ok, true);
  const otherCaseItem = (await q(`SELECT id FROM uc_items WHERE case_id = $1::uuid AND key = 'kpi.servizio.tempo_prima_risposta'`, [state.oldCaseId]))[0].id as string;
  const foreign = await loadKpiPage(exec!, lead, parseKpiParams({ apri: otherCaseItem }));
  assert.equal(foreign!.open, null, "a KPI of another case does not open");
  // «Da sistemare» only for Lateral Space.
  await q(`UPDATE uc_roi_models SET benefit_lines = '[]'::jsonb WHERE case_id = $1::uuid`, [state.caseId]);
  const vanity = await loadKpiPage(exec!, lead, parseKpiParams({ vista: "da-sistemare" }));
  assert.equal(vanity!.view, "da-sistemare");
  assert.deepEqual(vanity!.groups.flatMap((g) => g.items.map((k) => k.key)), ["kpi.servizio.tempo_prima_risposta"]);
  const client = await loadKpiPage(exec!, await viewer(ids.owner, ["owner_cliente"]), parseKpiParams({ vista: "da-sistemare" }));
  assert.equal(client!.view, "tutti");
  assert.equal(client!.counts["da-sistemare"], 0);
});
