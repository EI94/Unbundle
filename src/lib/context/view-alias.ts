/**
 * (Rilascio 10, ondata 6a, docs/ui-10/PROPOSTA-10.md §8.2) Le «Fonti» di «Contesto» si chiamavano «Appunti»: il vecchio
 * `/dashboard/<ws>/contesto?vista=appunti` porta a `?vista=fonti`, con gli altri parametri nello stesso ordine (il
 * `?fonte=<id>` dei link della CLI apre ancora il pannello della fonte). L'ancora la tiene il browser.
 *
 * Lo usa il proxy (src/proxy.ts), prima della pagina: la pagina sta sotto `contesto/loading.tsx`, e lì un redirect
 * sarebbe un 200 con una meta refresh, non un 308.
 *
 * Modulo puro, senza import: il proxy lo porta con sé.
 */

const CONTEXT_PAGE = /^\/dashboard\/[^/]+\/contesto\/?$/;

/** L'indirizzo nuovo (percorso e query) per `?vista=appunti` sulla pagina di «Contesto»; null per ogni altro indirizzo. */
export function notesViewAlias(pathname: string, search: URLSearchParams): string | null {
  if (!CONTEXT_PAGE.test(pathname) || !search.getAll("vista").includes("appunti")) return null;
  const params = new URLSearchParams();
  let vista = false;
  for (const [key, value] of search) {
    if (key !== "vista") params.append(key, value);
    else if (!vista) {
      params.append("vista", "fonti");
      vista = true;
    }
  }
  return `${pathname.replace(/\/$/, "")}?${params.toString()}`;
}
