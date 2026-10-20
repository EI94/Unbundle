import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source checks for the entries of the dossier (WP10, C10), like rollout-gates.test.ts for the
// platform: where the per-workspace switch (DESIGN §7.1 P0-1) is applied, that nothing comes from
// the hub or the connector (PIANO-LAVORI §2.6 rule 4) and that no read of the Use case page uses
// the proposer (art. 15.4). The behaviour is tested on the harness.
const root = new URL("../../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");

const LIST_PAGE = "src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/page.tsx";
const START_PAGE = "src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/nuovo/page.tsx";
const C10_FILES = [
  LIST_PAGE,
  START_PAGE,
  "src/components/uc/shell/create-wizard.tsx",
  "src/components/uc/shell/case-card.tsx",
  "src/components/uc/realization/realization-summary.tsx",
  "src/components/uc/realization/start-realization.tsx",
  "src/components/workspace/claude-mcp-card.tsx",
  "src/lib/actions/uc-realization.ts",
  "src/lib/actions/uc-notifications.ts",
  "src/lib/db/queries/uc-nav.ts",
  "src/lib/db/queries/uc-realization.ts",
  "src/lib/db/queries/uc-templates.ts",
  "src/lib/db/queries/uc-notifications.ts",
  "src/lib/db/queries/uc-notifications-dispatch.ts",
  "src/lib/uc/notify/bell.ts",
  "src/lib/uc/notify/dispatch.ts",
  "src/lib/uc/views/realization.ts",
];

test("the fallback list and the start page are 404 for a workspace outside UC_WORKSPACE_IDS", () => {
  for (const page of [LIST_PAGE, START_PAGE]) {
    const text = source(page);
    assert.match(text, /if \(!isUcEnabledFor\(workspaceId\)\) notFound\(\);/, page);
    assert.match(text, /await ensureUcAvailable\(workspaceId\);/, page);
    const firstRead = [text.indexOf("await getAppUcExecutor()"), text.indexOf("await dossierCardsForWorkspace(")].filter((i) => i >= 0);
    assert.ok(firstRead.length > 0 && firstRead.every((i) => text.indexOf("if (!isUcEnabledFor(workspaceId)) notFound();") < i), `${page}: the switch comes before any uc read`);
    assert.doesNotMatch(text, /\bredirect\(`\$\{ws\}\/use-cases\?vista=/, `${page}: the redirects to the Use case page belong to H6a`);
  }
});

test("the start action and the bell actions check the switch of their workspace", () => {
  const start = source("src/lib/actions/uc-realization.ts");
  assert.match(start, /const \{ session, access \} = await requireWorkspaceAccess\(workspaceId\);\s+const available = await ucSectionAvailable\(workspaceId\);/);
  const bell = source("src/lib/actions/uc-notifications.ts");
  assert.match(bell, /if \(!isUcEnabledFor\(workspaceId\)\) return ucFailure\("disattivata"/);
  assert.doesNotMatch(bell, /isUcEnabled\(\)/);
  const dispatch = source("src/lib/db/queries/uc-notifications-dispatch.ts");
  assert.match(dispatch, /if \(options\.workspaceId !== undefined && !isUcWorkspaceEnabled\(options\.workspaceId, rollout\)\) return \[\];/);
  assert.match(dispatch, /cronWorkspaceFilter\(ucCronWorkspaceScope\(rollout\)\)/);
});

test("every read for the Use case page and the fallback sidebar goes through the switch", () => {
  const nav = source("src/lib/db/queries/uc-nav.ts");
  for (const fn of ["ucCasesNavVisible", "portfolioCaseLink", "realizationForUseCase", "casesForUseCases"]) {
    const body = nav.slice(nav.indexOf(`export async function ${fn}(`));
    const end = body.indexOf("\nexport ", 10);
    assert.match(end > 0 ? body.slice(0, end) : body, /isUcEnabledFor\(i\.workspaceId\)/, fn);
  }
  assert.match(nav, /to_regclass\('public\.uc_cases'\)/);
  // The box of today's use case page offers the start only on a use case to build, never on a best practice.
  const link = nav.slice(nav.indexOf("export async function portfolioCaseLink("), nav.indexOf("function viewerFor("));
  assert.match(link, /coalesce\(u\.portfolio_kind, 'use_case_ai'\) AS kind/);
  assert.match(link, /row\.kind !== "use_case_ai"/);
});

test("no import from the hub or the connector; no read by proposer", () => {
  for (const file of C10_FILES) {
    const text = source(file);
    assert.doesNotMatch(text, /from ["'](?:@\/lib\/use-cases|@\/lib\/connector|@\/components\/use-cases|[./]*(?:lib\/)?use-cases\/|[./]*(?:lib\/)?connector\/)/, file);
  }
  for (const file of ["src/lib/db/queries/uc-realization.ts", "src/lib/db/queries/uc-nav.ts", "src/lib/uc/views/realization.ts", "src/lib/db/queries/uc-notifications-dispatch.ts"]) {
    // Il proponente dello use case (art. 15.4), non `na_proposed_by_contact_id` (il referente di un «non si applica»).
    assert.doesNotMatch(source(file), /(^|[^a-z_])proposed_by\b|proposedBy/, file);
  }
});

test("the chapter shows «0 di 245 indispensabili a posto»: the progress is the md size, without a link", () => {
  const summary = source("src/components/uc/realization/realization-summary.tsx");
  const progress = /<ProgressToGate\b[^>]*\/>/.exec(summary)?.[0] ?? "";
  assert.match(progress, /\bsize="md"/, "md prints «indispensabili» (sm never does)");
  assert.doesNotMatch(progress, /\bhref=/, "the chapter has its own «Apri il dossier»");
  assert.match(source("src/components/uc/ui/progress-to-gate.tsx"), /size === "md" && <span className="hidden sm:inline">indispensabili <\/span>/);
});
