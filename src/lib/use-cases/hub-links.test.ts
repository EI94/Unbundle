import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { bellHref } from "../uc/notify/bell.ts";
import { caseTrail } from "../uc/views/case-shell.ts";
import { receiptPath } from "./create.ts";
import { hubSignalHref } from "./digest.ts";
import { hubRedirectFor } from "./legacy-routes.ts";
import { HUB_VIEWS } from "./views.ts";

// Rilascio «Panoramica»: «Priorità» e «Roadmap» non sono più viste. I loro nomi restano leggibili
// nei link che girano già (`HUB_VIEW_ALIASES`), ma nessun codice li scrive più: ogni link nuovo
// porta a una vista di `HUB_VIEWS`. Id inventati.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WS = "00000000-0000-4000-8000-0000000000f1";
const UC = "00000000-0000-4000-8000-000000000e01";

/** I file sorgente di `src`, senza le prove: le prove nominano i vecchi link per leggerli. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules") out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(path);
    }
  }
  return out;
}

/** Il codice senza commenti: un commento può raccontare i vecchi nomi. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Chi scrive un vecchio nome di vista: in un indirizzo, in un oggetto della pagina, nel selettore. */
const OLD_VIEW_PRODUCERS: readonly RegExp[] = [
  /vista=(?:priorita|roadmap)\b/,
  /vista:\s*["'](?:priorita|roadmap)["']/,
  /key:\s*["'](?:priorita|roadmap)["']/,
  /HUB_VIEWS\.(?:priorita|roadmap)\b/,
  /viewHref\(["'](?:priorita|roadmap)["']\)/,
];

test("nessun sorgente scrive più ?vista=priorita o ?vista=roadmap", () => {
  const files = sourceFiles(join(ROOT, "src"));
  assert.ok(files.length > 100, "la cartella src si legge");
  const found: string[] = [];
  for (const file of files) {
    const code = withoutComments(readFileSync(file, "utf8"));
    for (const pattern of OLD_VIEW_PRODUCERS) {
      const match = pattern.exec(code);
      if (match) found.push(`${relative(ROOT, file)}: ${match[0]}`);
    }
  }
  assert.deepEqual(found, []);
});

test("la tabella dei vecchi nomi non conta come un link", () => {
  const views = withoutComments(readFileSync(join(ROOT, "src/lib/use-cases/views.ts"), "utf8"));
  assert.match(views, /priorita: "panoramica", roadmap: "panoramica"/);
  for (const pattern of OLD_VIEW_PRODUCERS) assert.doesNotMatch(views, pattern, String(pattern));
});

test("ogni link verso la pagina «Use case» porta a una vista di HUB_VIEWS", () => {
  const views: readonly string[] = HUB_VIEWS;
  const trail = caseTrail({ workspaceId: WS, caseBase: `/dashboard/${WS}/casi-duso/c1`, parent: { id: UC, code: "XX-0012", title: "Prova" } });
  const hrefs: Array<[string, string | null]> = [
    ["campanella, riepilogo", hubSignalHref(WS, "use_case_digest")],
    ["campanella, nuovo trimestre", hubSignalHref(WS, "use_case_quarter")],
    ["ricevuta del modulo", receiptPath(WS, UC)],
    ["/plan", hubRedirectFor(`/dashboard/${WS}/plan`)],
    ["/casi-duso", hubRedirectFor(`/dashboard/${WS}/casi-duso`, undefined, { dossierLinksReady: true })],
    ["/casi-duso/nuovo", hubRedirectFor(`/dashboard/${WS}/casi-duso/nuovo`)],
    ["campanella del dossier, riepilogo", bellHref({ workspaceId: WS, caseId: null, templateKey: "riepilogo_settimanale", payload: {} })],
    ["percorso del dossier", trail.kind === "use_case" ? trail.root.href : null],
  ];
  for (const [what, href] of hrefs) {
    assert.ok(href, what);
    const url = new URL(href, "http://x");
    assert.match(url.pathname, /\/use-cases$/, what);
    assert.ok(views.includes(url.searchParams.get("vista") ?? ""), `${what}: ${href}`);
  }
});
