import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";

// (Rilascio 10, ondata 5b, §8.2 regole 1-5, F-131, F-133) Ogni indirizzo di ieri della realizzazione risponde con il
// redirect vero di Next (308, `NEXT_REDIRECT;…;308`) verso la sua casa nuova, con la query tradotta: le route sono
// quelle vere, senza database. Un'ancora non arriva al server: il 308 la mette solo quando l'indirizzo di ieri la
// diceva da sé; altrimenti il browser tiene la sua, e la pagina nuova ha ancora quell'id. Id inventati.

await enableTsxImports();

const APP = "../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]";
type Route = { GET: (request: { nextUrl: URL }) => unknown };
const load = async (segment: string) => (await import(`${APP}/${segment}/route.ts`)) as Route;

const WS = "00000000-0000-4000-8000-0000000000f1";
const CASE = "00000000-0000-4000-8000-000000000c01";
const ROOT = `/dashboard/${WS}/casi-duso/${CASE}`;

/** Chiama la route e legge il redirect di Next: «NEXT_REDIRECT;<tipo>;<indirizzo>;<stato>;». */
function redirectOf(route: Route, path: string): { target: string; status: string } {
  try {
    route.GET({ nextUrl: new URL(path, "http://unbundle.test") });
  } catch (error) {
    const [code, , target, status] = String((error as { digest?: unknown }).digest).split(";");
    assert.equal(code, "NEXT_REDIRECT", String((error as { digest?: unknown }).digest));
    return { target, status };
  }
  assert.fail(`${path}: nessun redirect`);
}

const page = (segment: string) => new URL(`${APP}/${segment}/page.tsx`, import.meta.url);
const handler = (segment: string) => new URL(`${APP}/${segment}/route.ts`, import.meta.url);

test("/progetto: 308 to the Costruzione with the same query; the anchors stay in the browser (F-011, F-131)", async () => {
  const progetto = await load("progetto");
  assert.deepEqual(redirectOf(progetto, `${ROOT}/progetto`), { target: `${ROOT}/costruzione`, status: "308" });
  assert.deepEqual(redirectOf(progetto, `${ROOT}/progetto/`), { target: `${ROOT}/costruzione`, status: "308" });
  assert.deepEqual(redirectOf(progetto, `${ROOT}/progetto?da=email`), { target: `${ROOT}/costruzione?da=email`, status: "308" });
  // The Costruzione keeps yesterday's ids: `#banco` (the details of «Qualità»), `#compiti`, `#contesto`.
  const source = readFileSync(page("costruzione"), "utf8");
  assert.match(source, /<Fold id=\{QUALITY_ANCHORS\.details\}/);
  assert.match(source, /<span id=\{QUALITY_ANCHORS\.details\}/, "who has no details fold lands on the section");
  assert.match(source, /<section id=\{T\.tasksHeadingId\}/);
  assert.match(source, /<Fold id=\{T\.contextId\}/);
});

test("/soluzione/regole and /regole: 308 to the «Regole» panel of the Soluzione, the open rule as `regola` (F-090)", async () => {
  const rules = await load("soluzione/regole");
  const RULE = "00000000-0000-4000-8000-0000000000aa";
  assert.deepEqual(redirectOf(rules, `${ROOT}/soluzione/regole`), { target: `${ROOT}/soluzione?apri=regole`, status: "308" });
  assert.deepEqual(redirectOf(rules, `${ROOT}/soluzione/regole?apri=${RULE}&q=sconto&vincoli=1`), { target: `${ROOT}/soluzione?apri=regole&q=sconto&vincoli=1&regola=${RULE}`, status: "308" });
  const older = await load("regole");
  assert.deepEqual(redirectOf(older, `${ROOT}/regole?apri=${RULE}`), { target: `${ROOT}/soluzione?apri=regole&regola=${RULE}`, status: "308" }, "the oldest address, in one hop");
});

test("(D9 (a), F-016, F-018) the /casi-duso list is retired: 308 to Use case › Panoramica, with the stub log line", async () => {
  const list = (await import("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/route.ts")) as Route;
  const lines: string[] = [];
  const info = console.info;
  console.info = (line: string) => void lines.push(line);
  try {
    assert.deepEqual(redirectOf(list, `/dashboard/${WS}/casi-duso`), { target: `/dashboard/${WS}/use-cases?vista=panoramica`, status: "308" });
    assert.deepEqual(redirectOf(list, `/dashboard/${WS}/casi-duso/?x=1`), { target: `/dashboard/${WS}/use-cases?vista=panoramica`, status: "308" }, "the list had no parameters");
  } finally {
    console.info = info;
  }
  assert.deepEqual(lines.map((l) => JSON.parse(l)), [{ area: "use-case-hub", op: "stub", from: "/casi-duso" }, { area: "use-case-hub", op: "stub", from: "/casi-duso" }], "no id, no query");
  assert.equal(existsSync(new URL("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/page.tsx", import.meta.url)), false, "the list page is gone");
  assert.ok(existsSync(new URL("../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/nuovo/page.tsx", import.meta.url)), "/casi-duso/nuovo stays as the fallback");
});

test("every other old address of the realization: one 308 each, to its new home, query translated", async () => {
  const ITEM = "00000000-0000-4000-8000-0000000000bb";
  const cases: [segment: string, path: string, target: string][] = [
    ["voci", `${ROOT}/voci?preset=bloccate`, `${ROOT}/domande?vista=bloccate`],
    ["voci/[itemId]", `${ROOT}/voci/${ITEM}`, `${ROOT}/domande/${ITEM}`],
    ["verifica", `${ROOT}/verifica?pagina=2`, `${ROOT}/domande?vista=da-verificare&pagina=2`],
    ["documenti", `${ROOT}/documenti`, `${ROOT}/domande?vista=tutte&indispensabili=no&mostra=documenti&apri=file`],
    ["domande/documenti", `${ROOT}/domande/documenti`, `${ROOT}/domande?vista=tutte&indispensabili=no&mostra=documenti&apri=file`],
    ["mappa", `${ROOT}/mappa?vista=oggi`, `${ROOT}/soluzione/mappa?vista=oggi`],
    ["modello-dati", `${ROOT}/modello-dati?vista=fonti`, `${ROOT}/soluzione/dati?vista=fonti`],
    ["kpi", `${ROOT}/kpi`, `${ROOT}/valore/kpi`],
    ["roi", `${ROOT}/roi`, `${ROOT}/valore`],
    ["avanzamento", `${ROOT}/avanzamento`, `${ROOT}#via`],
    ["registro", `${ROOT}/registro?tipo=caso`, `${ROOT}/attivita?tipo=caso`],
    ["registro/csv", `${ROOT}/registro/csv?tipo=caso`, `${ROOT}/attivita/csv?tipo=caso`],
  ];
  for (const [segment, path, target] of cases) assert.deepEqual(redirectOf(await load(segment), path), { target, status: "308" }, segment);
});

test("the services stay where they are: the test cases import (POST), the export, the files", () => {
  const imports = readFileSync(handler("test-cases/import"), "utf8");
  assert.match(imports, /export async function POST\(/);
  assert.doesNotMatch(imports, /export (async )?function GET\(/, "no page and no redirect: a service");
  for (const service of ["export", "files/[fileId]", "attivita/csv"]) assert.ok(existsSync(handler(service)), service);
});

test("old addresses are routes, never pages: under loading.tsx a page redirect would stream a 200", () => {
  for (const segment of ["progetto", "via", "firme", "avanzamento", "mappa", "regole", "modello-dati", "voci", "verifica", "documenti", "kpi", "roi", "registro", "soluzione/regole", "domande/documenti"]) {
    assert.ok(existsSync(handler(segment)), `${segment}/route.ts`);
    assert.equal(existsSync(page(segment)), false, `${segment}/page.tsx`);
  }
});

test("/use-cases/<id>/progetto (bell, CLI, MCP: «…/progetto#banco») goes straight to the Costruzione, keeping the anchor", () => {
  const source = readFileSync(new URL("../../../app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/progetto/page.tsx", import.meta.url), "utf8");
  assert.match(source, /<RedirectKeepingHash href=\{`\/dashboard\/\$\{encodeURIComponent\(workspaceId\)\}\/casi-duso\/\$\{encodeURIComponent\(read\.dossier\.caseId\)\}\/costruzione`\}/);
});
