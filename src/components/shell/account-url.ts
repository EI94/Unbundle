import { ACCOUNT_PARAM, accountPartForSettingsHash, withAccount, withoutAccount, type AccountPart } from "@/lib/shell/account";

/**
 * Aprire e chiudere il foglio «Il tuo account» (rilascio 10, PROPOSTA-10 §2.3): solo l'indirizzo cambia, con la
 * cronologia del browser che Next segue (`usePathname`, `useSearchParams`), senza rileggere la pagina dal server.
 *
 * Come i pannelli `?apri=` (`useSheetParam`, src/components/ui-10/side-sheet.tsx): aprire dal menu sotto il nome
 * aggiunge un passo alla cronologia, così «Indietro» chiude il foglio; chiudere con ✕ o Esc un foglio aperto così torna
 * indietro di quel passo, e il primo «Indietro» dopo porta davvero alla pagina di prima. Un foglio che non ha un passo
 * suo (aperto da un link, o al posto di `settings#cli`) si chiude sostituendo l'indirizzo.
 *
 * Il passo aggiunto si ricorda qui, con il suo indirizzo (apertura e chiusura stanno in due componenti, il menu e il
 * foglio): chiudere torna indietro solo se l'indirizzo di adesso è quello del passo aggiunto, anche quando ci si torna
 * con «Avanti» o «Indietro»; un foglio a un altro indirizzo non ha un passo suo. Nessun link dell'app porta a
 * `?account=`: lo stesso indirizzo è sempre quel passo.
 */

/** La pagina che i due gesti toccano: `window`, o una finta nei test. */
export interface AccountPage {
  location: Pick<Location, "pathname" | "search" | "hash">;
  history: Pick<History, "pushState" | "replaceState" | "back">;
}

const browser = (): AccountPage => window;

function here(page: AccountPage): string {
  return `${page.location.pathname}${page.location.search}${page.location.hash}`;
}

/** L'indirizzo del passo che l'ultima apertura dal menu ha aggiunto alla cronologia (null prima della prima). */
let pushed: string | null = null;

export function openAccountSheet(part?: AccountPart, opts: { replace?: boolean } = {}, page: AccountPage = browser()): void {
  const url = withAccount(here(page), part);
  if (opts.replace) {
    page.history.replaceState(null, "", url);
    return;
  }
  page.history.pushState(null, "", url);
  pushed = url;
}

export function closeAccountSheet(page: AccountPage = browser()): void {
  const current = here(page);
  // L'apertura aveva aggiunto questo passo: chiudere è tornare indietro (Next segue il «popstate»).
  if (pushed !== null && pushed === current) page.history.back();
  else page.history.replaceState(null, "", withoutAccount(current));
}

/**
 * (§2.4) `settings#cli` (i link della CLI e dell'Agent Factory) e `settings#granola` (il ritorno da Granola) aprono il
 * foglio sulla parte giusta, al posto dell'indirizzo di prima: senza un passo nuovo, e solo se non è già aperto.
 */
export function openAccountForSettingsAnchor(pathname: string, workspaceId: string, page: AccountPage = browser()): void {
  const target = accountPartForSettingsHash(pathname, page.location.hash, workspaceId);
  if (target && !new URLSearchParams(page.location.search).has(ACCOUNT_PARAM)) openAccountSheet(target, { replace: true }, page);
}
