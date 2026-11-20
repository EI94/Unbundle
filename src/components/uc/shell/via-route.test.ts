import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";

// (Rilascio 10, §3.5, F-043, §8.2 regola 2) «Via allo sviluppo» è una sezione della Panoramica. I vecchi indirizzi
// rispondono 308 con il redirect vero di Next, la query di prima e l'ancora `#via`: `/via` (campanella «via pronta» e
// «via approvato», link già partiti) e `/avanzamento` (il nome ancora più vecchio, dritto alla sezione). Le route sono
// quelle vere; nessuna lettura del database. Id inventati.

await enableTsxImports();

const APP = "../../../app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]";
type Route = { GET: (request: { nextUrl: URL }) => unknown };
const via = (await import(`${APP}/via/route.ts`)) as Route;
const avanzamento = (await import(`${APP}/avanzamento/route.ts`)) as Route;

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

test("/via: 308 to the via section of the Panoramica, with the same query", () => {
  assert.deepEqual(redirectOf(via, `${ROOT}/via`), { target: `${ROOT}#via`, status: "308" });
  assert.deepEqual(redirectOf(via, `${ROOT}/via/`), { target: `${ROOT}#via`, status: "308" });
  assert.deepEqual(redirectOf(via, `${ROOT}/via?apri=tappe&da=campanella`), { target: `${ROOT}?apri=tappe&da=campanella#via`, status: "308" });
});

test("/avanzamento: 308 straight to the via section, without passing through /via", () => {
  assert.deepEqual(redirectOf(avanzamento, `${ROOT}/avanzamento`), { target: `${ROOT}#via`, status: "308" });
  assert.deepEqual(redirectOf(avanzamento, `${ROOT}/avanzamento?x=1`), { target: `${ROOT}#via`, status: "308" }, "the old page had no parameters");
});

test("/via is a route, not a page: under loading.tsx a page redirect would stream a 200", () => {
  assert.ok(existsSync(new URL(`${APP}/via/route.ts`, import.meta.url)));
  assert.equal(existsSync(new URL(`${APP}/via/page.tsx`, import.meta.url)), false);
});
