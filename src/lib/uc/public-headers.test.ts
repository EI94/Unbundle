import test from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../../../next.config.ts";
import { PUBLIC_HEADERS } from "./http.ts";

/**
 * Intestazioni di `next.config.ts` per i link dei referenti (PIANO §5.6): la
 * pagina `/r/<token>` e le API `/api/r/<token>/…` non si indicizzano, non
 * vanno in cache e non mandano il `Referer` (il token sta nell'indirizzo).
 * Vengono dopo le intestazioni globali, perché a parità di chiave vince
 * l'ultima regola che corrisponde.
 */

type Rule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<Rule[]> {
  assert.equal(typeof nextConfig.headers, "function");
  return (await nextConfig.headers!()) as Rule[];
}

test("pagina e API dei link dei referenti: noindex, no-store, no-referrer", async () => {
  const all = await rules();
  for (const source of ["/r/:path*", "/api/r/:path*"]) {
    const rule = all.find((r) => r.source === source);
    assert.ok(rule, `manca la regola ${source}`);
    const map = new Map(rule.headers.map((h) => [h.key, h.value]));
    assert.equal(map.get("X-Robots-Tag"), "noindex, nofollow");
    assert.equal(map.get("Cache-Control"), "no-store");
    assert.equal(map.get("Referrer-Policy"), "no-referrer");
    for (const key of ["X-Robots-Tag", "Cache-Control", "Referrer-Policy"]) {
      assert.equal(map.get(key), PUBLIC_HEADERS[key], `${source}: ${key} diverso dalle risposte delle API`);
    }
  }
});

test("le regole dei link vengono dopo quelle globali (vince l'ultima)", async () => {
  const all = await rules();
  const global = all.findIndex((r) => r.source === "/:path*");
  assert.ok(global >= 0);
  assert.ok(all.findIndex((r) => r.source === "/r/:path*") > global);
  assert.ok(all.findIndex((r) => r.source === "/api/r/:path*") > global);
  // Le intestazioni di sicurezza globali restano anche sui link (HSTS, frame, nosniff).
  const keys = all[global].headers.map((h) => h.key);
  for (const key of ["Strict-Transport-Security", "X-Frame-Options", "X-Content-Type-Options"]) assert.ok(keys.includes(key), key);
});
