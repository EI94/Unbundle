import { withAccount, withoutAccount, type AccountPart } from "@/lib/shell/account";

/**
 * Aprire e chiudere il foglio «Il tuo account» (rilascio 10, PROPOSTA-10 §2.3): solo l'indirizzo cambia, con la
 * cronologia del browser che Next segue (`usePathname`, `useSearchParams`), senza rileggere la pagina dal server.
 * Aprire aggiunge un passo alla cronologia, così «Indietro» chiude il foglio; chiudere lo sostituisce, come il
 * pannello `?apri=` degli use case.
 */
function here(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function openAccountSheet(part?: AccountPart, opts: { replace?: boolean } = {}): void {
  const url = withAccount(here(), part);
  if (opts.replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

export function closeAccountSheet(): void {
  window.history.replaceState(null, "", withoutAccount(here()));
}
