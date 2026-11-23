import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// (Revisione 7b) Il link per tutti non resta nel browser: niente memoria del browser né impronta della versione, così su
// un computer condiviso, dopo «Esci», chi viene dopo non trova un link del questionario che funziona. «Copia il link
// per tutti» chiede ogni volta al server, che emette una copia per il link di adesso e ne salva solo l'hash: mai un link
// ritirato, sfrattato o di un altro manager. Il link sta solo nella finestra (e negli appunti) e si dimentica alla
// chiusura. La testata e la scheda ripartono da capo per ogni rilevazione.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(rel);
  }
  return out;
}

test("the link for everyone is never stored in the browser: no storage, no version, no cache module", () => {
  for (const gone of ["src/lib/ai-readiness/open-link-cache.ts", "src/lib/ai-readiness/open-link-version.ts"]) assert.equal(existsSync(join(ROOT, gone)), false, gone);
  const sources = walk("src").map((file) => relative(ROOT, join(ROOT, file)));
  assert.deepEqual(sources.filter((file) => /open-link-cache|open-link-version|unbundle-air-link|linkVersion|openLinkVersion/.test(read(file))), []);
  const hook = read("src/components/ai-readiness/open-link.tsx");
  assert.doesNotMatch(hook, /localStorage|sessionStorage|indexedDB|document\.cookie|useRef/);
});

test("«Copia il link per tutti» asks the server every time; the dialog forgets the link when it closes", () => {
  const hook = read("src/components/ai-readiness/open-link.tsx");
  const copy = hook.slice(hook.indexOf("  function copy() {"), hook.indexOf("  // La finestra è aperta finché"));
  assert.match(copy, /^ {2}function copy\(\) \{\s*setError\(null\);\s*startTransition\(async \(\) => \{\s*const result = await copyAiReadinessOpenLinkAction\(workspaceId, assessmentId\);/);
  assert.doesNotMatch(copy, /return;/, "nessuna scorciatoia prima del server");
  assert.match(hook, /<OpenLinkDialog\s+open=\{url !== null\}\s+url=\{url\}\s+onOpenChange=\{\(open\) => \{\s+if \(!open\) setUrl\(null\);/);
  // Il server: una copia per il link di adesso, solo l'hash.
  const action = read("src/lib/actions/ai-readiness.ts");
  const copyAction = action.slice(action.indexOf("export async function copyAiReadinessOpenLinkAction"), action.indexOf("const openStartSchema"));
  assert.match(copyAction, /const token = createInviteToken\(\);\s*const added = await addAssessmentOpenLinkTokenHash\(assessmentId, hashInviteToken\(token\)\);/);
  assert.match(action, /data: \{ openUrl: `\$\{baseUrl\}\/s\/\$\{encodeURIComponent\(token\)\}` \},\s*\};\s*\}\s*\/\*\*\s*\* \(Rilascio 10, ondata 7b\) «Copia il link per tutti»/, "«Crea» rende solo il link");
});

test("one rilevazione, one state: the header and the tab body are keyed per rilevazione; a copy in use is kept alive", () => {
  const page = read("src/app/(dashboard)/dashboard/[workspaceId]/ai-readiness/page.tsx");
  assert.match(page, /<ReadinessHeader\s+key=\{assessment\.id\}/);
  assert.match(page, /<div key=\{assessment\.id\} data-readiness-tab=\{tab\}>/);
  // Chi comincia il questionario da una copia la tiene viva: l'ultimo uso si aggiorna dopo la risposta.
  const action = read("src/lib/actions/ai-readiness.ts");
  const start = action.slice(action.indexOf("export async function startOpenSurveyAction"), action.indexOf("export async function createAiReadinessRespondentInviteAction"));
  assert.match(start, /const found = await getAssessmentByOpenLinkTokenHash\(openHash\);/);
  assert.match(start, /after\(\(\) =>\s*touchAssessmentOpenLinkCopy\(usedAssessmentId, openHash\)\.catch\(/);
});
