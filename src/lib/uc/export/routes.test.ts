import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regole sulle route handler di WP12b e sui link di export: come
// `workspace-isolation.test.ts`, si controlla il sorgente, perché un controllo
// mancante non lascia tracce in un test di comportamento.

const CASE_DIR = "src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]";
const read = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function order(source: string, ...needles: string[]): void {
  let last = -1;
  for (const needle of needles) {
    const at = source.indexOf(needle);
    assert.ok(at >= 0, `missing ${needle}`);
    assert.ok(at > last, `${needle} comes too early`);
    last = at;
  }
}

test("export route: prefetch first, then flag, session, workspace, case role, permission, audit before the file", () => {
  const src = read(`${CASE_DIR}/export/route.ts`);
  order(
    src,
    "isPrefetchRequest(request)",
    "isUcEnabled()",
    "await auth()",
    "requireWorkspaceAccess(workspaceId)",
    "openUcCase(",
    "exportAllowed(",
    "snapshotForViewer(",
    "renderCatalogExport(",
    "recordCatalogExport(",
    "encodeForTransfer(file",
    "new Response(sent.body",
  );
  assert.match(src, /"Cache-Control": "private, no-store"/);
  assert.match(src, /"X-Content-Type-Options": "nosniff"/);
  assert.ok(!src.includes("getWorkspaceAccessForUser("));
  assert.ok(!src.includes("export async function POST"), "export is read-only");
});

test("import route: same-site POST, workspace, lead role before reading the body", () => {
  const src = read(`${CASE_DIR}/test-cases/import/route.ts`);
  order(
    src,
    "isUcEnabled()",
    "sameSiteRequest(request.headers",
    "await auth()",
    "requireWorkspaceAccess(workspaceId)",
    "openUcCase(",
    'caseAccess.roles.includes("ls_lead")',
    "readTestCasesUpload(request)",
    "importTestCases(",
    "revalidatePath(CASE_LAYOUT_PATH, \"layout\")",
  );
  assert.ok(!src.includes("export async function GET"), "no side effects on GET");
  assert.ok(!src.includes("getWorkspaceAccessForUser("));
  assert.match(src, /"Cache-Control": "no-store"/);
});

test("export links are native downloads, never Next links", () => {
  const src = read("src/components/uc/export/catalog-export-links.tsx");
  assert.ok(!src.includes("next/link"));
  assert.match(src, /<a key=\{format\} href=\{hrefFor\(format\)\} download/);
  assert.ok(!src.includes('"use client"'), "server component");
  const form = read("src/components/uc/export/test-cases-import.tsx");
  assert.ok(!form.includes("next/link"));
  assert.match(form, /method: "POST"/);
});
