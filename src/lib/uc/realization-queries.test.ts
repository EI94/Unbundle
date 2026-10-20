// Tests for src/lib/db/queries/uc-realization.ts (the dossier seen from the Use case page) and
// the template list of uc-templates.ts, with a fake executor. Kept under src/lib/uc so that
// `npm run test:uc` runs them. The statements run against Postgres in
// realization.integration.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { UcExecutor, UcRow } from "../db/uc-executor.ts";
import {
  SCOPED_NEXT_STEP_STATEMENTS,
  dossierCardsSql,
  dossierScopeSql,
  parseScopedNextStepRows,
  readDossierCards,
  readRealization,
  realizationSql,
  scopedNextStepStatements,
  startContextSql,
  startRealization,
  StartRealizationInputSchema,
} from "../db/queries/uc-realization.ts";
import { parseNextStepRows } from "../db/queries/uc-next-step.ts";
import { PENDING_SIGNATURE_STATEMENTS } from "../db/queries/uc-signatures.ts";
import { listTemplatesForWorkspace, templateCountsSql } from "../db/queries/uc-templates.ts";
import type { UcStatement } from "./sql/statement.ts";
import { canonicalDefinition, templateDefinitionHash } from "./template/load.ts";
import { validateTemplate } from "./template/schema.ts";
import type { UserContext } from "./types.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const UC = "33333333-3333-4333-8333-333333333333";
const CASE = "44444444-4444-4444-8444-444444444444";
const CASE_2 = "55555555-5555-4555-8555-555555555555";
const TEMPLATE = "66666666-6666-4666-8666-666666666666";
const LS = ["ls.test"];
const HASH = "a".repeat(64);

function fake(answer: (s: UcStatement) => UcRow[]): UcExecutor & { seen: UcStatement[]; rounds: number } {
  const seen: UcStatement[] = [];
  const self = {
    seen,
    rounds: 0,
    async batch(statements: readonly UcStatement[]) {
      self.rounds++;
      return statements.map((s) => {
        seen.push(s);
        return answer(s);
      });
    },
  };
  return self;
}

const lsUser = { id: USER, email: "lead@ls.test", email_verified: "2026-01-01T00:00:00Z" };
const clientUser = { id: USER, email: "persona@cliente.test", email_verified: "2026-01-01T00:00:00Z" };
const reviewer = { userId: USER, canReview: true, canManage: false };

function rowOfUseCase(over: Record<string, unknown> = {}): UcRow {
  return { id: UC, status: "accepted", kind: "use_case_ai", use_case_code: null, use_case_title: "Smistamento", case_id: null, ...over };
}

function realizationExecutor(row: UcRow | null, user: UcRow = lsUser) {
  return fake((s) => (s.text.includes("FROM use_cases u") ? (row ? [row] : []) : s.text.includes("FROM users") ? [user] : []));
}

test("the template list reads the counts once per definition: the second load scans no items", async () => {
  const row = { id: TEMPLATE, key: "esempio.minimo", version: "1.0.0", language: "it", name: "Esempio", archetype: "x", industry: null, function_area: null, restricted: true, definition_hash: HASH, published_at: null };
  const ex = fake((s) => (s.text.includes("jsonb_array_elements") ? (s.params.some((p) => Array.isArray(p) && p.includes(HASH)) ? [] : [{ id: TEMPLATE, definition_hash: HASH, items: 50, questions: 16 }]) : [row]));
  const first = await listTemplatesForWorkspace(ex, WS);
  assert.deepEqual([first[0].items, first[0].questions, ex.rounds], [50, 16, 1]);
  const second = await listTemplatesForWorkspace(ex, WS);
  assert.deepEqual([second[0].items, second[0].questions, ex.rounds], [50, 16, 2], "one round trip, counts from memory");
  const counts = ex.seen.filter((s) => s.text.includes("jsonb_array_elements"));
  assert.equal(counts.length, 2);
  assert.ok(counts[1].params.some((p) => Array.isArray(p) && p.includes(HASH)), "the known definition is skipped");
  assert.match(templateCountsSql(WS, []).text, /count\(e\.item\) FILTER \(WHERE e\.item ->> 'kind' = 'domanda'\)/);
  assert.equal((templateCountsSql(WS, []).text.match(/jsonb_array_elements/g) ?? []).length, 1, "one pass over the items");
});

test("the template counts stay right with a full cache: a definition counted before never comes out as 0 questions", async () => {
  const hex = (n: number) => n.toString(16).padStart(64, "c");
  const tpl = (n: number) => ({ id: `t-${n}`, key: `k${n}`, version: "1.0.0", language: "it", name: `S${n}`, archetype: "x", industry: null, function_area: null, restricted: false, definition_hash: hex(n), published_at: null });
  let listed = [tpl(1000)];
  const ex = fake((s) => {
    if (!s.text.includes("jsonb_array_elements")) return listed;
    const known = new Set((s.params.find(Array.isArray) as string[] | undefined) ?? []);
    return listed.filter((t) => !known.has(t.definition_hash)).map((t) => ({ id: t.id, definition_hash: t.definition_hash, items: 3, questions: 2 }));
  });
  assert.equal((await listTemplatesForWorkspace(ex, WS))[0].questions, 2);
  // 600 new definitions next to the known one: the cache (500) fills up while this list is read.
  listed = [tpl(1000), ...Array.from({ length: 600 }, (_, n) => tpl(n))];
  const full = await listTemplatesForWorkspace(ex, WS);
  assert.deepEqual(full.filter((t) => t.questions !== 2).map((t) => t.id), [], "the known definition keeps its counts");
  const again = await listTemplatesForWorkspace(ex, WS);
  assert.deepEqual(again.filter((t) => t.questions !== 2).map((t) => t.id), []);
});

test("realization reads: no proposer, the oldest complete dossier, the use case code through to_jsonb", () => {
  const text = realizationSql({ workspaceId: WS, useCaseId: UC, userId: USER }).text;
  assert.match(text, /to_jsonb\(u\) ->> 'code' AS use_case_code/);
  assert.match(text, /c\.setup_completed_at IS NOT NULL\s+ORDER BY c\.created_at, c\.id\s+LIMIT 1/);
  assert.match(text, /FROM uc_roi_models m\s+WHERE m\.case_id = d\.id AND m\.scenario = 'base'\s+ORDER BY m\.version DESC/);
  for (const t of [text, dossierCardsSql({ workspaceId: WS, userId: USER, useCaseIds: [UC], canManage: false }).text, startContextSql(WS, UC).text]) {
    assert.doesNotMatch(t, /proposed_by|submitted_by/);
  }
  assert.match(startContextSql(WS, UC).text, /\(to_jsonb\(u\) -> 'code'\) IS NOT NULL AS has_code_column/);
  assert.match(startContextSql(WS, UC).text, /false AS existing_case_member/, "no viewer, no membership read");
  assert.match(startContextSql(WS, UC, USER).text, /FROM uc_case_members m WHERE m\.case_id = x\.id AND m\.user_id = \$\d+::uuid/);
});

test("the chapter: hidden for contributors, start only for Lateral Space on an approved use case to build", async () => {
  const none = fake(() => []);
  assert.deepEqual(await readRealization(none, { workspaceId: WS, useCaseId: UC, viewer: { ...reviewer, canReview: false }, lsDomains: LS }), { state: "nascosta" });
  assert.equal(none.rounds, 0);
  assert.equal(await readRealization(none, { workspaceId: WS, useCaseId: "x", viewer: reviewer, lsDomains: LS }), null);

  assert.equal(await readRealization(realizationExecutor(null), { workspaceId: WS, useCaseId: UC, viewer: reviewer, lsDomains: LS }), null, "not a use case of the workspace");
  assert.deepEqual(await readRealization(realizationExecutor(rowOfUseCase()), { workspaceId: WS, useCaseId: UC, viewer: reviewer, lsDomains: LS }), {
    state: "da_avviare",
    canStart: true,
    startHref: `/dashboard/${WS}/casi-duso/nuovo?useCaseId=${UC}`,
  });
  assert.deepEqual(await readRealization(realizationExecutor(rowOfUseCase(), clientUser), { workspaceId: WS, useCaseId: UC, viewer: reviewer, lsDomains: LS }), {
    state: "da_avviare",
    canStart: false,
    startHref: null,
  });
  assert.deepEqual(await readRealization(realizationExecutor(rowOfUseCase({ status: "under_review" })), { workspaceId: WS, useCaseId: UC, viewer: reviewer, lsDomains: LS }), {
    state: "da_avviare",
    canStart: false,
    startHref: null,
  });
  assert.deepEqual(await readRealization(realizationExecutor(rowOfUseCase({ kind: "best_practice" })), { workspaceId: WS, useCaseId: UC, viewer: reviewer, lsDomains: LS }), { state: "best_practice" });
});

test("the chapter after the start: everything for openers, no link for other reviewers, at most 2 round trips", async () => {
  const started = (roles: string[]) =>
    rowOfUseCase({
      use_case_code: "XX-0012",
      case_id: CASE,
      case_code: "XX-0012",
      case_title: "Smistamento",
      case_status: "bozza",
      case_updated_at: "2026-10-13T08:00:00Z",
      roles: JSON.stringify(roles),
      implementation_cost: "18500",
      annual_benefit: null,
      break_even_months: null,
      cost_lines: "[]",
      benefit_lines: "[]",
    });
  const member = realizationExecutor(started(["ls_lead"]));
  const mine = await readRealization(member, { workspaceId: WS, useCaseId: UC, viewer: reviewer, lsDomains: LS });
  assert.equal(mine?.state, "avviata");
  if (mine?.state !== "avviata") return;
  assert.equal(mine.dossier.href, `/dashboard/${WS}/casi-duso/${CASE}`);
  assert.equal(mine.dossier.statusLabel, "Bozza");
  assert.equal(mine.dossier.figures.benefit, null);
  assert.ok(mine.dossier.figures.cost?.startsWith("18.500"));
  assert.equal(member.rounds, 2, "use case and dossier, then the next step");

  const other = await readRealization(realizationExecutor(started([])), { workspaceId: WS, useCaseId: UC, viewer: reviewer, lsDomains: LS });
  assert.equal(other?.state === "avviata" ? other.dossier.href : "x", null);
  const manager = await readRealization(realizationExecutor(started([])), { workspaceId: WS, useCaseId: UC, viewer: { ...reviewer, canManage: true }, lsDomains: LS });
  assert.equal(manager?.state === "avviata" ? manager.dossier.href : null, `/dashboard/${WS}/casi-duso/${CASE}`);
});

test("cards: one per use case in the column (the oldest), every visible dossier in the fallback list", async () => {
  const rows = [
    { id: CASE, code: "XX-0012", title: "Uno", status: "raccolta", updated_at: "2026-10-01T00:00:00Z", use_case_id: UC, use_case_code: "XX-0012", use_case_title: "Uno", roles: "[]" },
    { id: CASE_2, code: "XX-0012-B", title: "Doppione", status: "bozza", updated_at: "2026-10-12T00:00:00Z", use_case_id: UC, use_case_code: "XX-0012", use_case_title: "Uno", roles: '["ls_lead"]' },
  ];
  const ex = () => fake((s) => (s.text.includes("FROM uc_cases c") && s.text.includes("LEFT JOIN use_cases u") ? rows : s.text.includes("FROM users") ? [lsUser] : []));
  const columnEx = ex();
  const column = await readDossierCards(columnEx, { workspaceId: WS, useCaseIds: [UC], viewer: reviewer, lsDomains: LS });
  assert.deepEqual(column.cards.map((c) => [c.caseId, c.href]), [[CASE, `/dashboard/${WS}/use-cases/${UC}`]], "the oldest, linked to the use case card for a non-member");
  assert.equal(column.byUseCase.get(UC)?.caseId, CASE);
  assert.equal(columnEx.rounds, 1, "dossiers, viewer and next step of all in one round trip");
  assert.equal(columnEx.seen.length, 2 + SCOPED_NEXT_STEP_STATEMENTS);
  const list = await readDossierCards(ex(), { workspaceId: WS, useCaseIds: null, viewer: reviewer, lsDomains: LS });
  assert.deepEqual(list.cards.map((c) => c.caseId), [CASE_2], "the fallback list shows only what the viewer opens");
  const contributor = fake(() => []);
  assert.deepEqual((await readDossierCards(contributor, { workspaceId: WS, useCaseIds: [UC], viewer: { ...reviewer, canReview: false }, lsDomains: LS })).cards, []);
  assert.equal(contributor.rounds, 0);
  assert.match(dossierCardsSql({ workspaceId: WS, userId: USER, useCaseIds: null, canManage: false }).text, /EXISTS \(SELECT 1 FROM uc_case_members m WHERE m\.case_id = c\.id AND m\.user_id = \$\d+::uuid\)/);
  assert.doesNotMatch(dossierCardsSql({ workspaceId: WS, userId: USER, useCaseIds: null, canManage: true }).text, /EXISTS \(SELECT 1 FROM uc_case_members m WHERE m\.case_id = c\.id AND m\.user_id/);
});

const LEAD: UserContext = { userId: USER, email: "lead@ls.test", emailVerified: true, emailDomain: "ls.test", isLateralSpace: true } as UserContext;
const CLIENT: UserContext = { userId: USER, email: "persona@cliente.test", emailVerified: true, emailDomain: "cliente.test", isLateralSpace: false } as UserContext;
const input = { useCaseId: UC, templateId: TEMPLATE, title: "Smistamento richieste", oneLiner: "Una frase.", code: "HACK-01" };

function startContext(over: Record<string, unknown> = {}): UcRow {
  return { id: UC, title: "Smistamento", description: "Il problema.", flow_description: null, human_in_the_loop: null, guardrails: null, data_requirements: null, status: "accepted", kind: "use_case_ai", has_code_column: false, use_case_code: null, existing_case_id: null, in_progress: false, ...over };
}

test("the form never sends the code: the schema drops it", () => {
  const parsed = StartRealizationInputSchema.parse(input);
  assert.equal("code" in parsed, false);
});

test("start: only Lateral Space, only an approved use case to build with no dossier, a code when the column exists", async () => {
  const run = (row: UcRow | null, user = LEAD, canReview = true) =>
    startRealization(
      fake((s) => (s.text.includes("FROM use_cases u") ? (row ? [row] : []) : [])),
      { workspaceId: WS, user, canReviewWorkspacePortfolio: canReview, input },
    );
  const code = async (p: ReturnType<typeof run>) => {
    const r = await p;
    return r.ok ? "ok" : r.code;
  };
  assert.equal(await code(run(startContext(), CLIENT)), "ruolo_solo_lateral_space");
  assert.equal(await code(run(startContext(), LEAD, false)), "permesso_mancante");
  assert.equal(await code(run(null)), "use_case_non_trovato");
  assert.equal(await code(run(startContext({ existing_case_id: CASE }))), "dossier_esistente");
  assert.equal(await code(run(startContext({ in_progress: true }))), "creazione_in_corso");
  assert.equal(await code(run(startContext({ kind: "best_practice" }))), "best_practice");
  assert.equal(await code(run(startContext({ status: "under_review" }))), "non_approvato");
  const noCode = await run(startContext({ has_code_column: true, use_case_code: null }));
  assert.deepEqual(noCode, { ok: false, code: "codice_mancante", message: "Questo workspace non ha ancora un prefisso per i codici. Impostalo in Impostazioni." });
  const bad = await startRealization(fake(() => []), { workspaceId: WS, user: LEAD, canReviewWorkspacePortfolio: true, input: { ...input, title: "x" } });
  assert.equal(bad.ok ? null : bad.code, "dati_non_validi");
});

test("start: two starts at the same moment, the unique code stops the second one", async () => {
  let reads = 0;
  const ex = fake((s) => {
    // The second read of the use case, after the clash, finds the dossier the other start just made.
    if (s.text.includes("FROM use_cases u")) return [startContext({ has_code_column: true, use_case_code: "XX-0012", ...(reads++ > 0 ? { existing_case_id: CASE } : {}) })];
    if (s.text.includes("FROM uc_templates t")) throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    return [];
  });
  const r = await startRealization(ex, { workspaceId: WS, user: LEAD, canReviewWorkspacePortfolio: true, input });
  assert.deepEqual(r, { ok: false, code: "dossier_esistente", message: "Questo use case ha già un dossier." });
});

/** A published template row as the database returns it: the synthetic example, canonical, with its hash. */
function templateRow(): UcRow {
  const validation = validateTemplate(JSON.parse(readFileSync(new URL("../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8")));
  assert.ok(validation.ok);
  const canonical = canonicalDefinition(validation.template);
  return { id: TEMPLATE, key: "esempio.minimo", version: "1.0.0", definition: JSON.stringify(canonical), definition_hash: templateDefinitionHash(canonical), restricted: false };
}

/**
 * A start where another dossier holds `clashing` (fresh and incomplete, or complete): the use
 * case itself has no dossier, unless `ownAfterClash` says what the second read of it finds.
 */
function clashExecutor(o: { context: Record<string, unknown>; clashing: string; complete?: boolean; taken?: string[]; ownAfterClash?: Record<string, unknown> }) {
  let contextReads = 0;
  let takenReads = 0;
  const codesTried: string[] = [];
  const ex = fake((s) => {
    if (s.text.includes("AS has_code_column")) return [startContext({ ...o.context, ...(contextReads++ > 0 ? (o.ownAfterClash ?? {}) : {}) })];
    if (s.text.includes("code LIKE")) return (takenReads++ > 0 ? (o.taken ?? []) : []).map((code) => ({ code }));
    if (s.text.includes("FROM uc_templates t")) return [templateRow()];
    if (s.text.includes("AS stale")) {
      const code = s.params.find((p) => typeof p === "string" && /-/.test(p) && p !== WS) as string;
      codesTried.push(code);
      return code === o.clashing ? [{ id: CASE_2, complete: o.complete === true, stale: false }] : [];
    }
    return [];
  });
  return Object.assign(ex, { codesTried, contextReads: () => contextReads });
}

test("start: a code just taken by another use case's dossier is never «già un dossier» for this one", async () => {
  const run = (ex: UcExecutor) => startRealization(ex, { workspaceId: WS, user: LEAD, canReviewWorkspacePortfolio: true, input });
  // Without use_cases.code: the generated code («Smistamento richieste» → SR-UC-01) is retried once with a free one.
  const generated = clashExecutor({ context: {}, clashing: "SR-UC-01", taken: ["SR-UC-01"] });
  const retried = await run(generated);
  assert.ok(retried.ok, retried.ok ? "" : retried.message);
  assert.equal(retried.value.code, "SR-UC-02");
  assert.deepEqual(generated.codesTried, ["SR-UC-01", "SR-UC-02"]);
  assert.equal(generated.contextReads(), 2, "the use case is read again after the clash");
  // Same with a complete dossier of another use case on the code.
  const complete = await run(clashExecutor({ context: {}, clashing: "SR-UC-01", complete: true, taken: ["SR-UC-01"] }));
  assert.equal(complete.ok ? complete.value.code : null, "SR-UC-02");
  // The second code clashes too: a neutral message, never a false «già un dossier».
  const twice = await run(clashExecutor({ context: {}, clashing: "SR-UC-01", taken: [] }));
  assert.deepEqual(twice, { ok: false, code: "codice_appena_usato", message: "Codice appena usato da un altro dossier: riprova." });

  // With use_cases.code the code cannot change: say so, without blaming this use case.
  const withColumn = { has_code_column: true, use_case_code: "XX-0012" };
  assert.deepEqual(await run(clashExecutor({ context: withColumn, clashing: "XX-0012" })), {
    ok: false,
    code: "codice_appena_usato",
    message: "Codice appena usato da un altro dossier: riprova.",
  });
  assert.deepEqual(await run(clashExecutor({ context: withColumn, clashing: "XX-0012", complete: true })), {
    ok: false,
    code: "codice_in_uso",
    message: "Nel workspace c'è già un dossier con il codice di questo use case.",
  });

  // The clash is this use case's own dossier: then the messages about it are right.
  assert.equal(await run(clashExecutor({ context: withColumn, clashing: "XX-0012", ownAfterClash: { in_progress: true } })).then((r) => (r.ok ? "ok" : r.code)), "creazione_in_corso");
  assert.equal(await run(clashExecutor({ context: {}, clashing: "SR-UC-01", complete: true, ownAfterClash: { existing_case_id: CASE } })).then((r) => (r.ok ? "ok" : r.code)), "dossier_esistente");
});

/** A start whose first batch hits the unique dossier index (another row of this use case); `after` is what each re-read of the use case finds. */
function cardIndexExecutor(after: Record<string, unknown>[], context: Record<string, unknown> = {}) {
  let contextReads = 0;
  const ex = fake((s) => {
    if (s.text.includes("AS has_code_column")) return [startContext({ ...context, ...(contextReads++ > 0 ? (after[contextReads - 2] ?? {}) : {}) })];
    if (s.text.includes("FROM uc_templates t")) return [templateRow()];
    if (s.text.includes("INSERT INTO uc_cases")) {
      throw Object.assign(new Error('duplicate key value violates unique constraint "uc_cases_portfolio_use_case_unique_idx"'), {
        code: "23505",
        constraint: "uc_cases_portfolio_use_case_unique_idx",
      });
    }
    return [];
  });
  return Object.assign(ex, { contextReads: () => contextReads });
}

test("start: a clash on the unique dossier index is about this use case, never «codice appena usato»", async () => {
  const run = (ex: UcExecutor) => startRealization(ex, { workspaceId: WS, user: LEAD, canReviewWorkspacePortfolio: true, input });
  const code = (r: Awaited<ReturnType<typeof run>>) => (r.ok ? "ok" : r.code);
  assert.equal(code(await run(cardIndexExecutor([{ in_progress: true }]))), "creazione_in_corso");
  assert.equal(code(await run(cardIndexExecutor([{ existing_case_id: CASE }]))), "dossier_esistente");
  // The other row is already gone at the re-read (a creation that just failed): one more try, then «in preparazione».
  for (const context of [{}, { has_code_column: true, use_case_code: "XX-0012" }]) {
    const gone = cardIndexExecutor([], context);
    assert.deepEqual(await run(gone), { ok: false, code: "creazione_in_corso", message: "Stiamo già preparando il dossier di questo use case: riprova tra qualche minuto." });
    assert.equal(gone.contextReads(), 3, "read again after each of the two clashes");
  }
});

test("creation from a use case: the first batch removes the incomplete rows left on it for over 10 minutes, before the insert", async () => {
  const ex = fake((s) => (s.text.includes("AS has_code_column") ? [startContext()] : s.text.includes("FROM uc_templates t") ? [templateRow()] : []));
  const r = await startRealization(ex, { workspaceId: WS, user: LEAD, canReviewWorkspacePortfolio: true, input });
  assert.ok(r.ok, r.ok ? "" : r.message);
  const cleanup = ex.seen.findIndex((s) => /^DELETE FROM uc_cases\b/.test(s.text) && s.text.includes("portfolio_use_case_id"));
  const insert = ex.seen.findIndex((s) => s.text.includes("INSERT INTO uc_cases"));
  assert.ok(cleanup >= 0 && cleanup < insert, `cleanup ${cleanup}, insert ${insert}`);
  const sql = ex.seen[cleanup].text;
  assert.match(sql, /setup_completed_at IS NULL/, "never a complete dossier");
  assert.match(sql, /created_at < now\(\) - interval '10 minutes'/, "never a creation still running");
  assert.match(sql, /workspace_id = /);
  assert.ok(ex.seen[cleanup].params.includes(UC) && ex.seen[cleanup].params.includes(WS));
});

test("the next step of the cards in the same batch: dossiers chosen by a subquery, the parser of uc-next-step", () => {
  const scope = dossierScopeSql({ workspaceId: WS, userId: USER, useCaseIds: [UC], canManage: false });
  const statements = scopedNextStepStatements(scope, USER);
  assert.equal(statements.length, SCOPED_NEXT_STEP_STATEMENTS);
  assert.equal(SCOPED_NEXT_STEP_STATEMENTS, 3 + PENDING_SIGNATURE_STATEMENTS);
  for (const s of statements) {
    assert.match(s.text, /IN \(SELECT s\.id FROM uc_cases s\s+WHERE s\.workspace_id = \$\d+::uuid AND s\.setup_completed_at IS NOT NULL AND s\.portfolio_use_case_id = ANY\(\$\d+::uuid\[\]\)\s+ORDER BY s\.created_at, s\.id LIMIT 500\)/);
    // Mai il proponente dello use case (art. 15.4); `na_proposed_by_contact_id` è il referente che propone un «non si applica».
    assert.doesNotMatch(s.text, /(^|[^a-z_])proposed_by\b/);
  }
  // Signature rows carry their dossier, so they can be split per dossier.
  for (const s of statements.slice(3)) assert.match(s.text, /^SELECT (DISTINCT ON \(m\.case_id, m\.user_id\) )?[a-z]\.case_id,/);
  const list = dossierScopeSql({ workspaceId: WS, userId: USER, useCaseIds: null, canManage: false });
  assert.match(scopedNextStepStatements(list, USER)[0].text, /EXISTS \(SELECT 1 FROM uc_case_members sm WHERE sm\.case_id = s\.id AND sm\.user_id = \$\d+::uuid\)/);

  // The rows split per dossier give what parseNextStepRows gives with five statements per dossier.
  const now = new Date("2026-10-14T10:00:00Z");
  const caseRow = (id: string) => ({ id, status: "raccolta", status_before_suspension: null, status_changed_at: "2026-10-01T00:00:00Z", readiness: null, catalog_revision: 1, catalog_version: 0, signers_designation: {}, catalog_frozen_at: null, next_milestone: null, pending_review: id === CASE_2 ? "[]" : null, referents: 2, privacy_member: false, a8_active: false });
  const cases = [caseRow(CASE), caseRow(CASE_2)];
  const counts = [{ case_id: CASE, g_da_fare: 3, g_a_posto: 1 }, { case_id: CASE_2, g_da_fare: 1, g_da_verificare: 2, to_verify_for_me: 2, to_verify_total: 2 }];
  const gate = { case_id: CASE_2, id: "77777777-7777-4777-8777-777777777777", gate_key: "G1", approvals: "[]" };
  const na = { case_id: CASE, id: "88888888-8888-4888-8888-888888888888", key: "q.x.01", title: "Costo del servizio", na_reason: "Fuori perimetro", na_proposed_at: "2026-10-10T09:00:00Z", by_referent: false, ls_signed: false, client_user_signed: false, client_contact_id: null, client_link_signed: false };
  const rolesByCase = new Map<string, ("ls_lead" | "owner_cliente")[]>([[CASE, ["ls_lead"]], [CASE_2, ["ls_lead"]]]);
  const scoped = parseScopedNextStepRows([cases, counts, [], [gate], [na], [], [], []], { caseIds: [CASE, CASE_2], rolesByCase, now });
  const perCase = parseNextStepRows([cases, counts, [], [], [na], [], [], [], [gate], [], [], [], []], { caseIds: [CASE, CASE_2], rolesByCase, now });
  assert.deepEqual(scoped, new Map([...perCase].map(([id, r]) => [id, r.input])));
  assert.equal(scoped.get(CASE)?.mySignaturesPending.length, 1, "the «non si applica» of the first dossier");
  assert.deepEqual(scoped.get(CASE_2)?.mySignaturesPending.map((p) => p.kind), ["via"]);
});
