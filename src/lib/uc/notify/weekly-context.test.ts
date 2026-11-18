import test from "node:test";
import assert from "node:assert/strict";
import type { UcExecutor, UcRow } from "../../db/uc-executor.ts";
import { WEEKLY_CONTEXT_PROBE_SQL, loadWeeklyContext, rowToWeeklyContext, weeklyContextSql } from "../../db/queries/context-weekly.ts";
import { loadDeliveryFacts } from "../../db/queries/uc-notifications-dispatch.ts";
import type { UcStatement } from "../sql/statement.ts";
import type { ClaimedNotification, WeeklyContext } from "./dispatch.ts";

// (9b) The numbers of «Contesto» for the Monday summary (RILASCIO-9b-COSTRUZIONE.md §2.9, §5.8, D6), without a database:
// the SQL of `loadWeeklyContext` (src/lib/db/queries/context-weekly.ts), how a row becomes numbers, the reader on a fake
// executor, and the delivery facts of a summary row (uc-notifications-dispatch.ts). The same reads run on the hub
// database in src/lib/db/queries/context-weekly.integration.test.ts.

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";
const CASE = "22222222-2222-4222-8222-222222222222";
const OWNER = "55555555-5555-4555-8555-555555555555";
const NOTIF = "88888888-8888-4888-8888-888888888888";
// Monday 16 November 2026, 09:30 in Rome.
const NOW = new Date("2026-11-16T08:30:00Z");

const ROW: UcRow = {
  workspace_id: WS,
  novelties_all: 4,
  novelties_shared: 3,
  to_check: 3,
  to_confirm: 12,
  due_ours: 2,
  due_theirs: 1,
  theirs_shared: [{ statement: "Inviare l'esportazione delle fatture", dueOn: "2026-11-20", visibility: "tutti" }],
};
const CONTEXT: WeeklyContext = {
  novelties: { all: 4, shared: 3 },
  toConfirm: 12,
  toCheck: 3,
  due: { ours: 2, theirs: 1 },
  theirsShared: [{ statement: "Inviare l'esportazione delle fatture", dueOn: "2026-11-20", visibility: "tutti" }],
};

/** A fake executor: answers by the text of each statement and keeps what it ran. */
function fakeExecutor(answer: (s: UcStatement) => UcRow[]): UcExecutor & { ran: UcStatement[] } {
  const ran: UcStatement[] = [];
  return {
    ran,
    async batch(statements) {
      ran.push(...statements);
      return statements.map(answer);
    },
  };
}

const isProbe = (s: UcStatement) => s.text.includes("to_regclass('public.context_facts')");
const isWeekly = (s: UcStatement) => s.text.includes("FROM context_facts f WHERE f.workspace_id = w.id");

// ─── The SQL ─────────────────────────────────────────────────────────

test("the weekly SQL: every read of a context table carries the workspace; per workspace, never per person", () => {
  const s = weeklyContextSql({ workspaceIds: [WS, OTHER_WS], since: new Date("2026-11-09T08:30:00Z"), dueBy: "2026-11-23" });
  const tables = [...s.text.matchAll(/FROM (context_[a-z_]+) ([a-z]+)\b/g)];
  assert.deepEqual(
    tables.map((m) => m[1]),
    ["context_facts", "context_proposals", "context_commitments", "context_commitments"],
  );
  for (const m of tables) {
    assert.match(s.text.slice(m.index), new RegExp(`^FROM ${m[1]} ${m[2]}\\s+WHERE ${m[2]}\\.workspace_id = w\\.id AND `), `${m[1]} ${m[2]}`);
  }
  // Active facts, open proposals and open commitments; the commitments for the Owner only of the client and «Per tutti».
  assert.match(s.text, /FROM context_facts f WHERE f\.workspace_id = w\.id AND f\.status = 'attivo'/);
  assert.match(s.text, /count\(\*\) FILTER \(WHERE f\.created_at >= \$\d+::timestamptz\)::int AS novelties_all/);
  assert.match(s.text, /count\(\*\) FILTER \(WHERE f\.created_at >= \$\d+::timestamptz AND f\.visibility = 'tutti'\)::int AS novelties_shared/);
  assert.match(s.text, /count\(\*\) FILTER \(WHERE f\.needs_check\)::int AS to_check/);
  assert.match(s.text, /FROM context_proposals p WHERE p\.workspace_id = w\.id AND p\.status = 'aperta'/);
  assert.match(s.text, /FROM context_commitments c WHERE c\.workspace_id = w\.id AND c\.status = 'aperto' AND c\.due_on <= \$\d+::date\n\) due/);
  assert.match(s.text, /WHERE c\.workspace_id = w\.id AND c\.status = 'aperto' AND c\.party = 'cliente' AND c\.visibility = 'tutti' AND c\.due_on <= \$\d+::date/);
  // No text of a fact, no quote, no role, no person: the only text read is a commitment of the client «Per tutti».
  for (const forbidden of [/\bf\.statement\b/, /\bquote\b/, /role_label/, /user_id/, /confirmed_by/, /context_sources/, /GROUP BY/i]) {
    assert.doesNotMatch(s.text, forbidden);
  }
  assert.deepEqual(s.params[0], [WS, OTHER_WS]);
  assert.ok(s.params.includes("2026-11-09T08:30:00.000Z") && s.params.includes("2026-11-23"));
  // The probe of the 0038: the three tables the read needs.
  for (const table of ["context_facts", "context_proposals", "context_commitments"]) assert.ok(WEEKLY_CONTEXT_PROBE_SQL.includes(`to_regclass('public.${table}')`), table);
});

// ─── A row ───────────────────────────────────────────────────────────

test("a row becomes the numbers of its workspace; odd numbers count as zero", () => {
  assert.deepEqual(rowToWeeklyContext(ROW), { workspaceId: WS, context: CONTEXT });
  assert.deepEqual(rowToWeeklyContext({ ...ROW, workspace_id: WS.toUpperCase(), novelties_all: "7", to_check: -1, to_confirm: null, due_ours: 1.5, theirs_shared: null })?.context, {
    ...CONTEXT,
    novelties: { all: 7, shared: 3 },
    toCheck: 0,
    toConfirm: 0,
    due: { ours: 0, theirs: 1 },
    theirsShared: [],
  });
  assert.equal(rowToWeeklyContext({ ...ROW, workspace_id: "non-un-id" }), null);
  assert.equal(rowToWeeklyContext({ ...ROW, workspace_id: null }), null);
});

test("the commitments for the Owner: «Per tutti», with a valid date, without a person's data, at most three", () => {
  const items = [
    { statement: "Inviare a Giulia Esempio il verbale firmato", dueOn: "2026-11-12", visibility: "tutti" },
    { statement: "Mandare il verbale a prova.persona@cliente.test", dueOn: "2026-11-13", visibility: "tutti" },
    { statement: "Solo per noi: ricontrollare il contratto", dueOn: "2026-11-14", visibility: "ls" },
    { statement: "Mandare l'organigramma aggiornato", dueOn: "2026-11-15", visibility: "tutti" },
    { statement: "   ", dueOn: "2026-11-15", visibility: "tutti" },
    { statement: "Inviare il listino", dueOn: "15/11/2026", visibility: "tutti" },
    { statement: "Inviare l'esportazione delle fatture", dueOn: "2026-11-20", visibility: "tutti" },
    { statement: "Confermare la data del collaudo", dueOn: "2026-11-21", visibility: "tutti" },
    { statement: "Indicare chi approva gli acquisti", dueOn: "2026-11-22", visibility: "tutti" },
  ];
  const expected = [
    { statement: "Mandare l'organigramma aggiornato", dueOn: "2026-11-15", visibility: "tutti" },
    { statement: "Inviare l'esportazione delle fatture", dueOn: "2026-11-20", visibility: "tutti" },
    { statement: "Confermare la data del collaudo", dueOn: "2026-11-21", visibility: "tutti" },
  ];
  assert.deepEqual(rowToWeeklyContext({ ...ROW, theirs_shared: items })?.context.theirsShared, expected);
  // The driver may hand jsonb over as text.
  assert.deepEqual(rowToWeeklyContext({ ...ROW, theirs_shared: JSON.stringify(items) })?.context.theirsShared, expected);
  assert.deepEqual(rowToWeeklyContext({ ...ROW, theirs_shared: "non json" })?.context.theirsShared, []);
});

// ─── The reader on a fake executor (in this order: the probe is remembered once true) ──

test("loadWeeklyContext: without a valid workspace or time nothing is read", async () => {
  const exec = fakeExecutor(() => []);
  assert.equal((await loadWeeklyContext(exec, [], NOW)).size, 0);
  assert.equal((await loadWeeklyContext(exec, ["non-un-id", ""], NOW)).size, 0);
  assert.equal((await loadWeeklyContext(exec, [WS], new Date(Number.NaN))).size, 0);
  assert.equal(exec.ran.length, 0);
});

test("loadWeeklyContext: without the context tables (0038) the summary goes without the block", async () => {
  const exec = fakeExecutor((s) => (isProbe(s) ? [{ ok: false }] : [ROW]));
  assert.equal((await loadWeeklyContext(exec, [WS], NOW)).size, 0);
  assert.equal(exec.ran.length, 1, "only the probe");
});

test("loadWeeklyContext: the last 7 days and the commitments due within 7 Rome days; only the workspaces asked for", async () => {
  const exec = fakeExecutor((s) => (isProbe(s) ? [{ ok: true }] : isWeekly(s) ? [ROW, { ...ROW, workspace_id: OTHER_WS, novelties_all: 99 }] : []));
  const out = await loadWeeklyContext(exec, [WS.toUpperCase(), WS], NOW);
  assert.deepEqual([...out.entries()], [[WS, CONTEXT]], "another workspace is never counted");
  const weekly = exec.ran.find(isWeekly)!;
  assert.deepEqual(weekly.params[0], [WS], "lower case, once");
  assert.ok(weekly.params.includes("2026-11-09T08:30:00.000Z"), "since: 7 days before");
  assert.ok(weekly.params.includes("2026-11-23"), "due by: Rome today + 7");
  // Across the change to summer time (28 March 2027), just after midnight in Rome: calendar days of Rome, not UTC.
  await loadWeeklyContext(exec, [WS], new Date("2027-03-24T23:30:00Z"));
  assert.ok(exec.ran.filter(isWeekly).at(-1)!.params.includes("2027-04-01"), "25 March in Rome + 7");
  // Once true, the probe is not asked again.
  assert.equal(exec.ran.filter(isProbe).length, 1);
});

test("loadWeeklyContext never throws: a database error gives no block and a log line without data", async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    const failing: UcExecutor = {
      async batch() {
        throw Object.assign(new Error("relation context_facts: Giulia Esempio <prova.persona@cliente.test>"), { code: "42P01" });
      },
    };
    assert.equal((await loadWeeklyContext(failing, [WS], NOW)).size, 0);
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[context\/weekly\] contesto_settimana_non_letto /);
  assert.match(lines[0], /"code":"42P01"/);
  assert.doesNotMatch(lines[0], /Giulia|prova\.persona|relation/);
});

// ─── The delivery facts of a summary row ─────────────────────────────

const SUMMARY_ROW: ClaimedNotification = {
  id: NOTIF,
  workspaceId: WS,
  caseId: null,
  requestId: null,
  recipientContactId: OWNER,
  recipientUserId: null,
  templateKey: "riepilogo_settimanale",
  payload: { week: "2026-W47" },
  attempts: 0,
  dedupeKey: `riepilogo:${WS}:2026-W47:c-${OWNER}`,
};
const FACT_ROW: UcRow = {
  client_name: "Cliente prova",
  contact_id: OWNER,
  contact_email: "owner@cliente.test",
  contact_reachable: true,
  digest_opt_out: false,
};
const CASE_ROW: UcRow = { id: CASE, code: "XX-0012", title: "Caso di prova", readiness: { per_stato: { validata: 1 }, scope_total: 1, green_pct: 100 }, next_milestone: null, red_items: [] };

function deliveryExecutor(cases: UcRow[]) {
  return fakeExecutor((s) => {
    if (s.text.includes("FROM uc_notifications n\nJOIN workspaces w")) return [FACT_ROW];
    if (s.text.includes("FROM uc_cases c\nWHERE c.workspace_id")) return cases;
    if (isProbe(s)) return [{ ok: true }];
    if (isWeekly(s)) return [ROW];
    return [];
  });
}

test("the summary row reads the context of its own workspace, only when the e-mail goes (at least one case)", async () => {
  const exec = deliveryExecutor([CASE_ROW]);
  const facts = await loadDeliveryFacts(exec, SUMMARY_ROW, { lsDomains: ["ls.test"], now: NOW });
  assert.equal(facts.weekly?.cases.length, 1);
  assert.deepEqual(facts.weekly?.context, CONTEXT);
  assert.deepEqual(exec.ran.find(isWeekly)?.params[0], [WS]);

  const none = deliveryExecutor([]);
  const empty = await loadDeliveryFacts(none, SUMMARY_ROW, { lsDomains: ["ls.test"], now: NOW });
  assert.deepEqual(empty.weekly, { cases: [], context: null });
  assert.equal(none.ran.some(isWeekly), false, "no case, no context read");

  // Not a summary: no context read.
  const other = deliveryExecutor([CASE_ROW]);
  await loadDeliveryFacts(other, { ...SUMMARY_ROW, templateKey: "cli_collegata", payload: {} }, { lsDomains: ["ls.test"], now: NOW });
  assert.equal(other.ran.some((s) => isWeekly(s) || isProbe(s)), false);
});
