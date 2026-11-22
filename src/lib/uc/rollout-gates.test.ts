import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Where the per-workspace switch (DESIGN §7.1 P0-1) is applied by the platform package:
// the access layer of pages and actions, the dossier MCP and the uc crons. A source check,
// so a later edit cannot drop a gate silently (the behaviour is tested on the harness).
const root = new URL("../../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");

test("pages and actions: the case access goes through the workspace switch", () => {
  const access = source("src/lib/db/queries/uc-access.ts");
  assert.match(access, /export function isUcEnabledFor\(/);
  assert.match(access, /isUcWorkspaceEnabled\(workspaceId, rolloutEnv\(process\.env\)\)/);
  // The dossier pages (one read with the header, case-data.ts) and resolveCaseAccess (actions,
  // routes) both check the workspace, through the same precheck.
  assert.match(access, /export async function caseAccessPrecheck\([\s\S]*?await ensureUcAvailable\(input\.workspaceId\);/);
  assert.match(access, /export async function resolveCaseAccess\([\s\S]*?if \(!\(await caseAccessPrecheck\(input\)\)\) return null;/);
  const shell = source("src/components/uc/shell/case-data.ts");
  assert.match(shell, /const readDossierBase = cache\([\s\S]*?if \(!isUcEnabledFor\(workspaceId\)\) return null;[\s\S]*?await caseAccessPrecheck\(input\)/);
  assert.match(shell, /async function loadDossierBase\([\s\S]*?if \(!base\) notFound\(\);/);
  assert.match(source("src/components/uc/catalog/case-page.ts"), /await requireDossierRole\(/);
  assert.match(access, /if \(workspaceId !== undefined && !isUcEnabledFor\(workspaceId\)\) throw new UcAccessError\("disattivata"/);

  const actions = source("src/lib/actions/uc-action-context.ts");
  assert.match(actions, /if \(!isUcEnabledFor\(i\.workspaceId\)\) return \{ ok: false, result: DISABLED \};/);
  // An action without a workspace passes only when every workspace is on (`*` outside production):
  // with an explicit list it is refused, so it cannot create anything in a switched-off workspace.
  assert.match(actions, /workspaceId === undefined \? !isUcEnabledForEveryWorkspace\(\) : !isUcEnabledFor\(workspaceId\)\) return DISABLED;/);
  assert.match(access, /export function isUcEnabledForEveryWorkspace\(\)[\s\S]*?ucOnForEveryWorkspace\(process\.env\)/);
});

// Gates handed off by C11 to other packages' files (DESIGN §8.1 rule 1), now landed.
test("dossier entries, notifications and referent links: the workspace switch", () => {
  for (const page of ["casi-duso/page.tsx", "casi-duso/nuovo/page.tsx"]) {
    const src = source(`src/app/(dashboard)/dashboard/[workspaceId]/${page}`);
    assert.match(src, /if \(!isUcEnabledFor\(workspaceId\)\) notFound\(\);/, page);
    assert.match(src, /await ensureUcAvailable\(workspaceId\);/, page);
  }
  assert.match(source("src/lib/actions/uc-notifications.ts"), /if \(!isUcEnabledFor\(workspaceId\)\) return ucFailure\("disattivata"/);
  assert.match(source("src/lib/actions/uc-realization.ts"), /await ucSectionAvailable\(workspaceId\)/);
  // The old «Nuovo caso» action, which could run without a workspace, is gone (WP12).
  assert.doesNotMatch(source("src/lib/actions/uc-cases.ts"), /createCaseAction/);
  for (const file of ["src/app/r/[token]/page.tsx", "src/app/api/r/[token]/handler.ts"]) {
    assert.match(source(file), /isUcWorkspaceEnabled\(workspaceId, \{ UC_WORKSPACE_IDS: process\.env\.UC_WORKSPACE_IDS/, file);
  }
});

test("MCP: a token of a workspace outside the list reads nothing", () => {
  const handler = source("src/app/api/mcp/casi/handler.ts");
  const auth = handler.indexOf("authenticateWorkspaceIntegrationToken(bearerToken(request))");
  const gate = handler.indexOf("if (!isUcEnabledFor(auth.workspace.id)) return fail(\"non_trovato\");");
  const read = handler.indexOf("loadMcpCase(");
  assert.ok(auth > 0 && gate > auth && read > gate, "the gate sits between the token check and the first case read");
});

test("crons: only the switched-on workspaces, from the same variable", () => {
  const handler = source("src/app/api/cron/uc-handler.ts");
  assert.match(handler, /ucCronWorkspaceScope\(process\.env\)/);
  assert.match(handler, /workspaceIds: cronWorkspaceFilter\(scope\)/);
});
