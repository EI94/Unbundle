import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createUcExecutor, type UcExecutor } from "../db/uc-executor.ts";
import { loadUserContext } from "../db/queries/uc-cases.ts";
import { loadNextStepInputs } from "../db/queries/uc-next-step.ts";
import { dossierScopeSql, parseScopedNextStepRows, readDossierCards, readRealization, readStartContext, scopedNextStepStatements, startRealization } from "../db/queries/uc-realization.ts";
import { applyTemplateLoad, createCaseFromTemplate, listTemplatesForWorkspace } from "../db/queries/uc-templates.ts";
import { planTemplateLoad } from "./template/load.ts";
import type { CaseRole } from "./vocab.ts";

// Opt-in integration suite for WP10 (DESIGN §2.1 entries 1 and 2, §3.1, §3.2): «Avvia la
// realizzazione» from a use case, the realization chapter and the Roadmap cards, on the
// isolated local harness only:
//   UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test UC_TEST_ISOLATED=true \
//   NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs node --no-warnings --test --test-concurrency=1 src/lib/uc/realization.integration.test.ts
// It works with and without the `use_cases.code` column (0019): with it the dossier takes the
// use case code, without it the code generated from the name. Everything lives in the suite's
// own workspace and is deleted at the end.
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
const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0];

const LS_DOMAINS = ["ls.test"];
const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  lead: randomUUID(),
  manager: randomUUID(),
  client: randomUUID(),
  contributor: randomUUID(),
  approved: randomUUID(),
  practice: randomUUID(),
  proposed: randomUUID(),
  race: randomUUID(),
  noCode: randomUUID(),
};
const exampleText = readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const state = { templateId: "", hasCodeColumn: false, caseId: "", code: "" };

const leadViewer = () => ({ userId: ids.lead, canReview: true, canManage: false });
const clientViewer = () => ({ userId: ids.client, canReview: true, canManage: false });
const managerViewer = () => ({ userId: ids.manager, canReview: true, canManage: true });
const contributorViewer = () => ({ userId: ids.contributor, canReview: false, canManage: false });

async function lead() {
  const user = await loadUserContext(exec!, ids.lead, LS_DOMAINS);
  assert.ok(user?.isLateralSpace);
  return user;
}

async function start(useCaseId: string, extra: Record<string, unknown> = {}, who: "lead" | "client" = "lead") {
  const user = who === "lead" ? await lead() : (await loadUserContext(exec!, ids.client, LS_DOMAINS))!;
  return startRealization(exec!, {
    workspaceId: ids.ws,
    user,
    canReviewWorkspacePortfolio: true,
    input: { useCaseId, templateId: state.templateId, title: "Smistamento delle richieste", oneLiner: "Instrada ogni richiesta alla persona giusta.", ...extra },
  });
}

before(async () => {
  if (!sql) return;
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Org prova realizzazione', $2)`, [ids.org, `uc-real-${ids.org}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, 'Cliente realizzazione')`, [ids.ws, ids.org]);
  await q(`INSERT INTO users (id, email, email_verified) VALUES ($1::uuid, $5, now()), ($2::uuid, $6, now()), ($3::uuid, $7, now()), ($4::uuid, $8, now())`, [
    ids.lead,
    ids.manager,
    ids.client,
    ids.contributor,
    `real-lead-${suffix}@ls.test`,
    `real-manager-${suffix}@cliente.test`,
    `real-client-${suffix}@cliente.test`,
    `real-contrib-${suffix}@cliente.test`,
  ]);
  await q(
    `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $5::uuid, 'analyst'), ($2::uuid, $5::uuid, 'transformation_lead'), ($3::uuid, $5::uuid, 'function_lead'), ($4::uuid, $5::uuid, 'contributor')`,
    [ids.lead, ids.manager, ids.client, ids.contributor, ids.org],
  );
  const value = JSON.parse(exampleText) as Record<string, unknown>;
  value.key = `prova.realizzazione_${suffix}`;
  const plan = planTemplateLoad(JSON.stringify(value), { restrictToWorkspaceId: ids.ws });
  assert.ok(plan.ok);
  const loaded = await applyTemplateLoad(exec!, plan.plan, { actorUserId: ids.lead, publish: true });
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.message);
  state.templateId = loaded.value.templateId;
  state.hasCodeColumn = (await one(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'use_cases' AND column_name = 'code') AS ok`))?.ok === true;
  const proposer = `real-contrib-${suffix}@cliente.test`;
  const insert = (id: string, title: string, status: string, kind: string) =>
    q(
      `INSERT INTO use_cases (id, workspace_id, title, description, flow_description, human_in_the_loop, guardrails, data_requirements, status, portfolio_kind, proposed_by)
       VALUES ($1::uuid, $2::uuid, $3, 'Le richieste arrivano a una casella sola. Poi qualcuno le smista a mano.', 'Claude legge la richiesta e propone il team.',
         'Il coordinatore conferma.', 'Mai risposte automatiche ai clienti.', 'Storico delle richieste.', $4::use_case_status, $5, $6)`,
      [id, ids.ws, title, status, kind, proposer],
    );
  await insert(ids.approved, "Smistamento richieste", "accepted", "use_case_ai");
  await insert(ids.practice, "Buona pratica", "accepted", "best_practice");
  await insert(ids.proposed, "Idea in valutazione", "proposed", "use_case_ai");
  await insert(ids.race, "Gara di avvio", "accepted", "use_case_ai");
  await insert(ids.noCode, "Senza codice", "accepted", "use_case_ai");
  if (state.hasCodeColumn) {
    await q(`UPDATE use_cases SET code = 'XR-' || $2 WHERE id = $1::uuid`, [ids.approved, String(1000 + Math.floor(Math.random() * 8999))]);
    await q(`UPDATE use_cases SET code = 'XR-' || $2 WHERE id = $1::uuid`, [ids.race, String(1000 + Math.floor(Math.random() * 8999))]);
  }
});

after(async () => {
  if (!sql) return;
  await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [ids.ws]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.lead, ids.manager, ids.client, ids.contributor]]);
});

test("schema list: the counts of a template read once, then from memory", opts, async () => {
  const first = (await listTemplatesForWorkspace(exec!, ids.ws)).find((t) => t.id === state.templateId);
  const second = (await listTemplatesForWorkspace(exec!, ids.ws)).find((t) => t.id === state.templateId);
  assert.deepEqual([first?.items, first?.questions], [50, 16]);
  assert.deepEqual([second?.items, second?.questions], [50, 16]);
});

test("before the start: Lateral Space may start an approved use case to build, the client reviewers read who does it", opts, async () => {
  assert.deepEqual(await readRealization(exec!, { workspaceId: ids.ws, useCaseId: ids.approved, viewer: leadViewer(), lsDomains: LS_DOMAINS }), {
    state: "da_avviare",
    canStart: true,
    startHref: `/dashboard/${ids.ws}/casi-duso/nuovo?useCaseId=${ids.approved}`,
  });
  assert.deepEqual(await readRealization(exec!, { workspaceId: ids.ws, useCaseId: ids.approved, viewer: clientViewer(), lsDomains: LS_DOMAINS }), { state: "da_avviare", canStart: false, startHref: null });
  assert.deepEqual(await readRealization(exec!, { workspaceId: ids.ws, useCaseId: ids.approved, viewer: contributorViewer(), lsDomains: LS_DOMAINS }), { state: "nascosta" });
  assert.deepEqual(await readRealization(exec!, { workspaceId: ids.ws, useCaseId: ids.practice, viewer: leadViewer(), lsDomains: LS_DOMAINS }), { state: "best_practice" });
  assert.deepEqual(await readRealization(exec!, { workspaceId: ids.ws, useCaseId: ids.proposed, viewer: leadViewer(), lsDomains: LS_DOMAINS }), { state: "da_avviare", canStart: false, startHref: null });
  assert.equal(await readRealization(exec!, { workspaceId: randomUUID(), useCaseId: ids.approved, viewer: leadViewer(), lsDomains: LS_DOMAINS }), null, "another workspace");
});

test("start: refused for a client reviewer, a best practice and a use case not approved", opts, async () => {
  const client = await start(ids.approved, {}, "client");
  assert.equal(client.ok ? null : client.code, "ruolo_solo_lateral_space");
  const practice = await start(ids.practice);
  assert.equal(practice.ok ? null : practice.code, "best_practice");
  const proposed = await start(ids.proposed);
  assert.equal(proposed.ok ? null : proposed.code, "non_approvato");
  const foreign = await start(randomUUID());
  assert.equal(foreign.ok ? null : foreign.code, "use_case_non_trovato");
  assert.equal(Number((await one(`SELECT count(*) AS n FROM uc_cases WHERE workspace_id = $1::uuid`, [ids.ws]))?.n), 0, "nothing created");
});

test("start: the dossier takes the use case code and texts, the form's code is ignored, the proposer never enters", opts, async () => {
  const r = await start(ids.approved, { code: "HACK-01" });
  assert.ok(r.ok, r.ok ? "" : r.message);
  state.caseId = r.value.caseId;
  state.code = r.value.code;
  const row = await one(
    `SELECT c.code, c.title, c.one_liner, c.status, c.portfolio_use_case_id, c.description, c.setup_completed_at IS NOT NULL AS complete, to_jsonb(u) ->> 'code' AS use_case_code
     FROM uc_cases c JOIN use_cases u ON u.id = c.portfolio_use_case_id WHERE c.id = $1::uuid`,
    [state.caseId],
  );
  assert.ok(row);
  assert.notEqual(row.code, "HACK-01");
  if (state.hasCodeColumn) assert.equal(row.code, row.use_case_code, "the code of the use case");
  else assert.equal(row.code, "SDR-UC-01", "without the column: generated from the name, as before");
  assert.deepEqual([row.title, row.one_liner, row.status, row.portfolio_use_case_id, row.complete], ["Smistamento delle richieste", "Instrada ogni richiesta alla persona giusta.", "bozza", ids.approved, true]);
  const description = row.description as Record<string, unknown>;
  assert.equal(description.in_breve, "Le richieste arrivano a una casella sola. Poi qualcuno le smista a mano.\n\nClaude legge la richiesta e propone il team.");
  assert.deepEqual(description.dallo_use_case, { chi_controlla: "Il coordinatore conferma.", limiti: "Mai risposte automatiche ai clienti.", dati: "Storico delle richieste." });
  assert.ok(!JSON.stringify(description).includes("real-contrib"), "the proposer stays on the use case card");
  const members = await q(`SELECT user_id, role FROM uc_case_members WHERE case_id = $1::uuid`, [state.caseId]);
  assert.deepEqual(members.map((m) => [m.user_id, m.role]), [[ids.lead, "ls_lead"]]);
});

test("start: a second start on the same use case is refused", opts, async () => {
  const again = await start(ids.approved);
  assert.deepEqual(again, { ok: false, code: "dossier_esistente", message: "Questo use case ha già un dossier." });
  const context = await readStartContext(exec!, { workspaceId: ids.ws, useCaseId: ids.approved });
  assert.equal(context?.existingCaseId, state.caseId, "the start page sends to the dossier");
  assert.equal(context?.existingCaseMember, false, "membership is read only with the viewer");
  assert.equal((await readStartContext(exec!, { workspaceId: ids.ws, useCaseId: ids.approved, userId: ids.lead }))?.existingCaseMember, true, "the lead opens it");
  assert.equal((await readStartContext(exec!, { workspaceId: ids.ws, useCaseId: ids.approved, userId: ids.client }))?.existingCaseMember, false, "a reviewer who is not a member goes to the card");
});

test("start: two starts at the same moment leave one dossier", opts, async () => {
  const results = await Promise.all([start(ids.race), start(ids.race)]);
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results.map((r) => (r.ok ? "ok" : r.code))));
  for (const r of results) if (!r.ok) assert.ok(["dossier_esistente", "creazione_in_corso", "codice_in_uso"].includes(r.code), r.code);
  const rows = await q(`SELECT setup_completed_at IS NOT NULL AS complete FROM uc_cases WHERE portfolio_use_case_id = $1::uuid`, [ids.race]);
  assert.deepEqual(rows.map((r) => r.complete), [true]);
});

test("start: with the code column, a use case without a code does not start", opts, async (t) => {
  if (!state.hasCodeColumn) {
    t.skip("use_cases.code is not on this database (branch without 0019): the generated code applies");
    return;
  }
  const r = await start(ids.noCode);
  assert.deepEqual(r, { ok: false, code: "codice_mancante", message: "Questo workspace non ha ancora un prefisso per i codici. Impostalo in Impostazioni." });
});

test("after the start: everything to who opens the dossier, no link to other reviewers, nothing to contributors", opts, async () => {
  const mine = await readRealization(exec!, { workspaceId: ids.ws, useCaseId: ids.approved, viewer: leadViewer(), lsDomains: LS_DOMAINS });
  assert.equal(mine?.state, "avviata");
  if (mine?.state !== "avviata") return;
  assert.equal(mine.dossier.href, `/dashboard/${ids.ws}/casi-duso/${state.caseId}`);
  assert.equal(mine.dossier.statusLabel, "Bozza");
  assert.ok(mine.dossier.progress && mine.dossier.progress.required > 0);
  assert.deepEqual(mine.dossier.figures, { cost: null, benefit: null, breakEven: null }, "no ROI saved yet: «da calcolare»");
  assert.equal(mine.dossier.myStep?.label, "Aggiungi i referenti", "the lead's next step of a new draft");

  const client = await readRealization(exec!, { workspaceId: ids.ws, useCaseId: ids.approved, viewer: clientViewer(), lsDomains: LS_DOMAINS });
  assert.equal(client?.state, "avviata");
  if (client?.state === "avviata") {
    assert.deepEqual([client.dossier.href, client.dossier.myStep], [null, null]);
    assert.deepEqual(client.dossier.progress, mine.dossier.progress, "same status, progress and milestone");
  }
  const manager = await readRealization(exec!, { workspaceId: ids.ws, useCaseId: ids.approved, viewer: managerViewer(), lsDomains: LS_DOMAINS });
  assert.equal(manager?.state === "avviata" ? manager.dossier.href : null, `/dashboard/${ids.ws}/casi-duso/${state.caseId}`, "who manages the workspace opens it, read only");
  assert.deepEqual(await readRealization(exec!, { workspaceId: ids.ws, useCaseId: ids.approved, viewer: contributorViewer(), lsDomains: LS_DOMAINS }), { state: "nascosta" });

  // The saved ROI totals are the dossier figures.
  await q(
    `INSERT INTO uc_roi_models (case_id, version, scenario, implementation_cost, annual_benefit, break_even_months) VALUES ($1::uuid, 1, 'base', 18500, 60000, 4)`,
    [state.caseId],
  );
  const withRoi = await readRealization(exec!, { workspaceId: ids.ws, useCaseId: ids.approved, viewer: clientViewer(), lsDomains: LS_DOMAINS });
  assert.equal(withRoi?.state === "avviata" ? withRoi.dossier.figures.breakEven : null, "4 mesi");
  assert.match(withRoi?.state === "avviata" ? (withRoi.dossier.figures.cost ?? "") : "", /^18\.500\s€$/);
});

test("Roadmap cards: one per use case, linked by role; the fallback list shows what the viewer opens", opts, async () => {
  const forLead = await readDossierCards(exec!, { workspaceId: ids.ws, useCaseIds: [ids.approved, ids.race, ids.proposed], viewer: leadViewer(), lsDomains: LS_DOMAINS });
  assert.deepEqual(new Set(forLead.byUseCase.keys()), new Set([ids.approved, ids.race]));
  assert.ok(forLead.cards.every((c) => c.href?.includes("/casi-duso/")));
  assert.ok(forLead.cards[0].myTurn, "my turn first");
  const card = forLead.byUseCase.get(ids.approved)!;
  assert.equal(card.title, "Smistamento richieste", "the use case title");
  assert.equal(card.code, state.code);
  assert.equal(card.context?.text, "Tocca a te · Aggiungi i referenti");

  const forClient = await readDossierCards(exec!, { workspaceId: ids.ws, useCaseIds: [ids.approved], viewer: clientViewer(), lsDomains: LS_DOMAINS });
  assert.equal(forClient.byUseCase.get(ids.approved)?.href, `/dashboard/${ids.ws}/use-cases/${ids.approved}`, "other reviewers go to the use case card");
  assert.equal(forClient.byUseCase.get(ids.approved)?.myTurn, false);
  assert.deepEqual((await readDossierCards(exec!, { workspaceId: ids.ws, useCaseIds: [ids.approved], viewer: contributorViewer(), lsDomains: LS_DOMAINS })).cards, []);

  assert.deepEqual((await readDossierCards(exec!, { workspaceId: ids.ws, useCaseIds: null, viewer: clientViewer(), lsDomains: LS_DOMAINS })).cards, [], "not a member: nothing in the fallback list");
  assert.equal((await readDossierCards(exec!, { workspaceId: ids.ws, useCaseIds: null, viewer: managerViewer(), lsDomains: LS_DOMAINS })).cards.length, 2);
});

test("start: two use cases whose dossier names give the same code start together, each with its own dossier", opts, async () => {
  const twins = [randomUUID(), randomUUID()];
  for (const [k, id] of twins.entries()) {
    await q(`INSERT INTO use_cases (id, workspace_id, title, status, portfolio_kind) VALUES ($1::uuid, $2::uuid, $3, 'accepted', 'use_case_ai')`, [id, ids.ws, `Gemello ${k + 1}`]);
    if (state.hasCodeColumn) await q(`UPDATE use_cases SET code = 'XG-' || $2 WHERE id = $1::uuid`, [id, String(1000 + k + 10 * Math.floor(Math.random() * 800))]);
  }
  // Same name, so without use_cases.code the same generated code: the one that clashes takes the next free code.
  const results = await Promise.all(twins.map((id) => start(id, { title: "Sintesi dei report" })));
  assert.deepEqual(results.map((r) => (r.ok ? "ok" : r.code)), ["ok", "ok"]);
  const rows = await q(`SELECT portfolio_use_case_id, code FROM uc_cases WHERE portfolio_use_case_id = ANY($1::uuid[]) AND setup_completed_at IS NOT NULL`, [twins]);
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((r) => r.code)).size, 2, "two codes");
});

test("Roadmap cards: the next step read in the same batch equals the one of uc-next-step, signatures included", opts, async () => {
  const caseIds = (await q(`SELECT id FROM uc_cases WHERE workspace_id = $1::uuid AND setup_completed_at IS NOT NULL ORDER BY created_at, id`, [ids.ws])).map((r) => String(r.id));
  assert.ok(caseIds.length >= 2);
  // A «non si applica» and a start without an answer waiting for signatures on the first dossier.
  const items = await q(`SELECT id FROM uc_items WHERE case_id = $1::uuid AND deleted_at IS NULL ORDER BY key LIMIT 2`, [state.caseId]);
  await q(`UPDATE uc_items SET na_proposed_at = now(), na_reason = 'Fuori dal perimetro', na_proposed_by_user_id = $2::uuid WHERE id = $1::uuid`, [items[0].id, ids.lead]);
  await q(`UPDATE uc_items SET waiver = '{"motivo": "Si parte con una stima", "piano": "La risposta arriva entro il primo rilascio", "scadenza": "2026-12-31", "approvazioni": []}'::jsonb WHERE id = $1::uuid`, [items[1].id]);
  try {
    const rolesByCase = new Map(caseIds.map((id) => [id, ["ls_lead"] as CaseRole[]]));
    const now = new Date();
    const scope = dossierScopeSql({ workspaceId: ids.ws, userId: ids.lead, useCaseIds: null, canManage: true });
    const scoped = parseScopedNextStepRows(await exec!.batch(scopedNextStepStatements(scope, ids.lead)), { caseIds, rolesByCase, now });
    const perCase = await loadNextStepInputs(exec!, { workspaceId: ids.ws, caseIds, userId: ids.lead, rolesByCase, now });
    assert.equal(scoped.size, caseIds.length);
    assert.deepEqual(scoped, perCase);
    assert.equal(scoped.get(state.caseId)?.mySignaturesPending.length, 2, "both signatures of the first dossier, none of the others");
    assert.ok(caseIds.filter((id) => id !== state.caseId).every((id) => scoped.get(id)?.mySignaturesPending.length === 0));
  } finally {
    await q(`UPDATE uc_items SET na_proposed_at = NULL, na_reason = NULL, na_proposed_by_user_id = NULL WHERE id = $1::uuid`, [items[0].id]);
    await q(`UPDATE uc_items SET waiver = NULL WHERE id = $1::uuid`, [items[1].id]);
  }
});

test("start: an incomplete dossier left on the use case by a failed creation, with another code, waits 10 minutes and then stops blocking", opts, async () => {
  const card = randomUUID();
  await q(`INSERT INTO use_cases (id, workspace_id, title, status, portfolio_kind) VALUES ($1::uuid, $2::uuid, 'Riga rimasta', 'accepted', 'use_case_ai')`, [card, ids.ws]);
  if (state.hasCodeColumn) await q(`UPDATE use_cases SET code = 'XS-' || $2 WHERE id = $1::uuid`, [card, String(1000 + Math.floor(Math.random() * 8999))]);
  // A creation whose batch and cleanup both failed: an incomplete row on the card, with a code the start never picks.
  const leftover = randomUUID();
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, created_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Rimasto a metà', now() - interval '1 minute')`,
    [leftover, ids.ws, ids.org, card, state.templateId, `RIM-${suffix.toUpperCase()}`],
  );
  const rows = () => q(`SELECT id, setup_completed_at IS NOT NULL AS complete FROM uc_cases WHERE portfolio_use_case_id = $1::uuid ORDER BY created_at`, [card]);
  // Recent: it may still be running, so it stays.
  const early = await start(card);
  assert.deepEqual(early, { ok: false, code: "creazione_in_corso", message: "Stiamo già preparando il dossier di questo use case: riprova tra qualche minuto." });
  assert.deepEqual((await rows()).map((r) => r.id), [leftover]);
  // Over 10 minutes old: the start removes it in the same transaction and the dossier is made, with the unique index or without.
  await q(`UPDATE uc_cases SET created_at = now() - interval '1 hour' WHERE id = $1::uuid`, [leftover]);
  const later = await start(card);
  assert.ok(later.ok, later.ok ? "" : `${later.code}: ${later.message}`);
  assert.deepEqual((await rows()).map((r) => [r.id, r.complete]), [[later.value.caseId, true]]);
  // A complete dossier is never removed, however old: a second start says it is there and, past
  // that check, a creation on the card stops at the unique index (if the database has it).
  await q(`UPDATE uc_cases SET created_at = now() - interval '1 hour' WHERE id = $1::uuid`, [later.value.caseId]);
  assert.equal(await start(card).then((r) => (r.ok ? "ok" : r.code)), "dossier_esistente");
  if ((await one(`SELECT to_regclass('public.uc_cases_portfolio_use_case_unique_idx') IS NOT NULL AS ok`))?.ok === true) {
    const direct = await createCaseFromTemplate(exec!, {
      workspaceId: ids.ws,
      template: { templateId: state.templateId },
      actorUserId: ids.lead,
      code: `DIR-${suffix.toUpperCase()}`,
      title: "Secondo dossier",
      portfolioUseCaseId: card,
    }).then(
      (r) => (r.ok ? "ok" : r.code),
      (error: unknown) => (error as { constraint?: string }).constraint,
    );
    assert.equal(direct, "uc_cases_portfolio_use_case_unique_idx");
  }
  assert.deepEqual((await rows()).map((r) => [r.id, r.complete]), [[later.value.caseId, true]]);
});

test("start: two starts on one use case with different names, on the unique dossier index, never say «codice appena usato»", opts, async (t) => {
  if ((await one(`SELECT to_regclass('public.uc_cases_portfolio_use_case_unique_idx') IS NOT NULL AS ok`))?.ok !== true) {
    t.skip("the unique dossier index is not on this database (uc DDL before C11b)");
    return;
  }
  const card = randomUUID();
  await q(`INSERT INTO use_cases (id, workspace_id, title, status, portfolio_kind) VALUES ($1::uuid, $2::uuid, 'Due nomi', 'accepted', 'use_case_ai')`, [card, ids.ws]);
  if (state.hasCodeColumn) await q(`UPDATE use_cases SET code = 'XN-' || $2 WHERE id = $1::uuid`, [card, String(1000 + Math.floor(Math.random() * 8999))]);
  // Without use_cases.code two names give two codes: only the unique dossier index stops the second dossier.
  const results = await Promise.all([start(card, { title: "Analisi dei contratti" }), start(card, { title: "Verifica delle fatture" })]);
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results.map((r) => (r.ok ? "ok" : r.code))));
  for (const r of results) if (!r.ok) assert.ok(["dossier_esistente", "creazione_in_corso"].includes(r.code), r.code);
  const rows = await q(`SELECT setup_completed_at IS NOT NULL AS complete FROM uc_cases WHERE portfolio_use_case_id = $1::uuid`, [card]);
  assert.deepEqual(rows.map((r) => r.complete), [true]);
});
