import test from "node:test";
import assert from "node:assert/strict";
import { enableTsxImports } from "../../components/use-cases/detail/referent/tsx-test-loader.ts";
import { notesViewAlias } from "./view-alias.ts";

// (Rilascio 10, ondata 6a, docs/ui-10/PROPOSTA-10.md §8.2) Il vecchio `?vista=appunti` di «Contesto» porta a
// `?vista=fonti` con un 308 vero, nel proxy e non nella pagina (che sta sotto `contesto/loading.tsx`, dove un redirect
// diventa un 200 con una meta refresh). Gli altri parametri restano: il `?fonte=<id>` dei link della CLI apre ancora il
// pannello della fonte.

const WS = "8a6f3c2e-1b4d-4e5f-9a7b-0c1d2e3f4a5b";
const PAGE = `/dashboard/${WS}/contesto`;
const query = (search: string) => new URLSearchParams(search);

test("`?vista=appunti` → `?vista=fonti`, con gli altri parametri nello stesso ordine; ogni altro indirizzo resta com'è", () => {
  assert.equal(notesViewAlias(PAGE, query("vista=appunti")), `${PAGE}?vista=fonti`);
  assert.equal(notesViewAlias(PAGE, query("vista=appunti&fonte=abc")), `${PAGE}?vista=fonti&fonte=abc`);
  assert.equal(notesViewAlias(PAGE, query("fonte=abc&vista=appunti&x=1&x=2")), `${PAGE}?fonte=abc&vista=fonti&x=1&x=2`);
  assert.equal(notesViewAlias(PAGE, query("vista=appunti&vista=fonti")), `${PAGE}?vista=fonti`, "una vista sola");
  assert.equal(notesViewAlias(`${PAGE}/`, query("vista=appunti")), `${PAGE}?vista=fonti`);
  for (const search of ["", "vista=fonti&fonte=abc", "vista=processi", "apri=abc"]) assert.equal(notesViewAlias(PAGE, query(search)), null, search);
  for (const path of [`${PAGE}/conferma`, `/dashboard/${WS}/mapping`, "/contesto"]) assert.equal(notesViewAlias(path, query("vista=appunti")), null, path);
});

test("il proxy: con la sessione un 308 verso le Fonti, prima della pagina; l'indirizzo nuovo passa; senza sessione il login di sempre", async () => {
  await enableTsxImports();
  const { NextRequest } = await import("next/server");
  const { proxy } = await import("../../proxy.ts");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const cookie = `__session=h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;
  const moved = proxy(new NextRequest(`http://localhost${PAGE}?vista=appunti&fonte=abc`, { headers: { cookie } }));
  assert.equal(moved.status, 308);
  assert.equal(moved.headers.get("location"), `http://localhost${PAGE}?vista=fonti&fonte=abc`);
  const page = proxy(new NextRequest(`http://localhost${PAGE}?vista=fonti&fonte=abc`, { headers: { cookie } }));
  assert.equal(page.headers.get("location"), null);
  assert.equal(page.headers.get("x-middleware-next"), "1", "la pagina si apre");
  const anonymous = proxy(new NextRequest(`http://localhost${PAGE}?vista=appunti`));
  assert.match(anonymous.headers.get("location") ?? "", /^http:\/\/localhost\/login\?callbackUrl=/);
});
