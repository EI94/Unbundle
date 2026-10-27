import test from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../../../../next.config.ts";

// Le intestazioni della pagina `/rispondi/<token>` e delle sue API (SPEC §4.5): le stesse dei link dei
// dossier (CSP, mai indicizzate, mai in cache, nessun `Referer`), dopo quelle globali, così la loro
// `Referrer-Policy` sostituisce quella di default.

type Entry = { source: string; headers: { key: string; value: string }[] };

async function entries(): Promise<Entry[]> {
  assert.ok(nextConfig.headers, "next.config.ts ha headers()");
  return (await nextConfig.headers()) as Entry[];
}

const header = (e: Entry, key: string) => e.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

test("/rispondi e /api/rispondi hanno CSP, noindex, no-store e no-referrer, dopo la voce globale", async () => {
  const list = await entries();
  const global = list.findIndex((e) => e.source === "/:path*");
  assert.ok(global >= 0, "c'è la voce globale");
  for (const source of ["/rispondi/:path*", "/api/rispondi/:path*"]) {
    const i = list.findIndex((e) => e.source === source);
    assert.ok(i > global, `${source} dopo la voce globale`);
    const e = list[i];
    assert.equal(header(e, "X-Robots-Tag"), "noindex, nofollow");
    assert.equal(header(e, "Cache-Control"), "no-store");
    assert.equal(header(e, "Referrer-Policy"), "no-referrer");
    const csp = header(e, "Content-Security-Policy") ?? "";
    for (const part of ["frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'", "form-action 'self'", "connect-src 'self' https://vercel.com https://*.blob.vercel-storage.com"]) {
      assert.ok(csp.includes(part), `${source}: ${part}`);
    }
  }
});

test("le stesse intestazioni dei link dei dossier", async () => {
  const list = await entries();
  const of = (source: string) => list.find((e) => e.source === source)?.headers;
  assert.deepEqual(of("/rispondi/:path*"), of("/r/:path*"));
  assert.deepEqual(of("/api/rispondi/:path*"), of("/api/r/:path*"));
});
