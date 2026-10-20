import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

// Fixed test of DESIGN §8.3 WP13 («Cambia con Use case»): no uc read that the Use case page
// mounts (chapter «Realizzazione», Roadmap cards, «Avvia la realizzazione») sorts, filters,
// groups or counts by proposer (art. 15.4). The proposer never leaves these reads either.

const root = new URL("../../../../", import.meta.url).pathname;
const component = "src/components/uc/realization";
/** What the Use case page mounts: its uc reads, the action and the components. */
const MOUNTED = [
  "src/lib/db/queries/uc-nav.ts",
  "src/lib/db/queries/uc-realization.ts",
  "src/lib/uc/views/realization.ts",
  "src/lib/actions/uc-realization.ts",
  ...readdirSync(join(root, component))
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((f) => `${component}/${f}`),
];

const IMPORT = /\b(?:import|export)\s[^;]*?\bfrom\s+"([^"]+)"/g;
/** uc query and view modules: where a read of the page can sort, group or count. */
const UC_READ = /^src\/lib\/(db\/queries|uc\/views)\/[^/]+\.ts$/;
/** uc SQL builders: where a query module can keep the text of its SQL (`pendingGateSql`…). */
const UC_SQL = /^src\/lib\/uc\/sql\/[^/]+\.ts$/;

/** The modules matching `kind` that a file imports directly (relative paths and `@/`). */
function importedBy(file: string, kind: RegExp): string[] {
  const out: string[] = [];
  for (const m of readFileSync(join(root, file), "utf8").matchAll(IMPORT)) {
    const spec = m[1];
    const base = spec.startsWith("@/") ? join("src", spec.slice(2)) : spec.startsWith(".") ? normalize(join(dirname(file), spec)) : null;
    if (!base) continue;
    const found = [base, `${base}.ts`].find((c) => kind.test(c) && existsSync(join(root, c)));
    if (found) out.push(found);
  }
  return out;
}

/**
 * The mounted files and the uc reads they delegate to (`uc-next-step.ts`, `uc-signatures.ts`,
 * `views/next-step.ts`…), read from their imports: a new dependency is covered by itself. One
 * level only: further down (`views/approvals.ts`, `views/privacy.ts`) `proposed_by` is the
 * person who proposed a personal-data access, another thing, and those modules are not reads
 * of this page. The SQL of a read can sit in a builder of `src/lib/uc/sql/` (the pending
 * signatures of `uc-signatures.ts` are in `sql/public.ts`): the builders these files import are
 * covered too.
 */
const READS = [...new Set([...MOUNTED, ...MOUNTED.flatMap((f) => importedBy(f, UC_READ))])];
const FILES = [...new Set([...READS, ...READS.flatMap((f) => importedBy(f, UC_SQL))])].sort();

/** The proposer of a use case, under any of its names (the «non si applica» proposals are another thing). */
const PROPOSER = /\b(proposed_by|proposedBy|submitted_by_user_id|submittedByUserId|submitter_email|submitterEmail)\b/;
/** Ordering, grouping or counting by a person. */
const PER_PERSON = [
  /\b(ORDER|GROUP)\s+BY\b[^;`]{0,200}?\b(proposed_by|actor_user_id)\b/i,
  /\bcount\s*\([^)]*\b(proposed_by|actor_user_id)\b/i,
  /\bPARTITION\s+BY\b[^;`]{0,200}?\b(proposed_by|actor_user_id)\b/i,
];

test("the uc reads of the Use case page exist where this test looks for them, with the reads they delegate to", () => {
  assert.ok(FILES.length >= 6, FILES.join(", "));
  for (const f of FILES) assert.ok(readFileSync(join(root, f), "utf8").length > 0, f);
  for (const f of ["src/lib/db/queries/uc-next-step.ts", "src/lib/db/queries/uc-signatures.ts", "src/lib/uc/views/next-step.ts", "src/lib/uc/sql/public.ts"]) {
    assert.ok(FILES.includes(f), `${f} is covered`);
  }
});

test("no uc read of the Use case page names the proposer", () => {
  for (const f of FILES) {
    const source = readFileSync(join(root, f), "utf8");
    const match = PROPOSER.exec(source);
    assert.equal(match, null, `${f}: ${match?.[0]}`);
  }
});

test("no uc read of the Use case page sorts, groups or counts by person", () => {
  for (const f of FILES) {
    const source = readFileSync(join(root, f), "utf8");
    for (const rule of PER_PERSON) {
      const match = rule.exec(source);
      assert.equal(match, null, `${f}: ${match?.[0].slice(0, 120)}`);
    }
  }
});

test("the rules catch what they are for", () => {
  assert.ok(PROPOSER.test("SELECT u.proposed_by FROM use_cases u"));
  assert.ok(!PROPOSER.test("i.na_proposed_by_contact_id IS NOT NULL"), "a «non si applica» proposal is not the proposer");
  assert.ok(PER_PERSON[0].test("GROUP BY u.proposed_by"));
  assert.ok(PER_PERSON[0].test("ORDER BY e.created_at, e.actor_user_id"));
  assert.ok(PER_PERSON[1].test("count(DISTINCT e.actor_user_id)"));
  assert.ok(!PER_PERSON[0].test("ORDER BY lower(u.title)"));
});
