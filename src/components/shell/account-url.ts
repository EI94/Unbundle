import { ACCOUNT_PARAM, accountPartForSettingsHash, accountPartForSettingsLanding, withAccount, withoutAccount, type AccountPart } from "@/lib/shell/account";

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
  location: Pick<Location, "pathname" | "search" | "hash"> & Partial<Pick<Location, "origin">>;
  history: Pick<History, "pushState" | "replaceState" | "back">;
  addEventListener(type: "popstate", listener: () => void): void;
  /** Come si è arrivati alla pagina (il tipo della navigazione, il referrer): `window` li ha; senza, l'arrivo è dall'app. */
  performance?: Pick<Performance, "getEntriesByType">;
  document?: Pick<Document, "referrer">;
}

const browser = (): AccountPage => window;

function here(page: AccountPage): string {
  return `${page.location.pathname}${page.location.search}${page.location.hash}`;
}

/** L'indirizzo del passo che l'ultima apertura dal menu ha aggiunto alla cronologia (null prima della prima). */
let pushed: string | null = null;
/**
 * «Indietro» chiesto e non ancora arrivato: il foglio resta aperto finché l'indirizzo non cambia, e un secondo ✕ o Esc
 * in quel momento (un doppio clic) non deve tornare indietro di un altro passo, fuori dalla pagina.
 */
let leaving = false;
const watched = new WeakSet<AccountPage>();

export function openAccountSheet(part?: AccountPart, opts: { replace?: boolean } = {}, page: AccountPage = browser()): void {
  const url = withAccount(here(page), part);
  if (opts.replace) {
    page.history.replaceState(null, "", url);
    return;
  }
  page.history.pushState(null, "", url);
  pushed = url;
  leaving = false;
}

export function closeAccountSheet(page: AccountPage = browser()): void {
  const current = here(page);
  if (pushed !== null && pushed === current) {
    // L'apertura aveva aggiunto questo passo: chiudere è tornare indietro (Next segue il «popstate», e così il foglio).
    if (leaving) return;
    if (!watched.has(page)) {
      watched.add(page);
      page.addEventListener("popstate", () => {
        leaving = false;
      });
    }
    leaving = true;
    page.history.back();
    return;
  }
  page.history.replaceState(null, "", withoutAccount(current));
}

/** Le pagine che hanno già mostrato il loro primo indirizzo: dopo, ogni indirizzo nuovo è una navigazione dell'app. */
const landed = new WeakSet<AccountPage>();

/**
 * La pagina è arrivata da fuori dell'app: una navigazione nuova del documento (non «Ricarica», non «Indietro» o
 * «Avanti»), senza un referrer dell'app. Un link di un'e-mail, di un altro programma, un indirizzo scritto. Il login
 * (`router.push` dopo `/login?callbackUrl=`) resta nello stesso documento: conta l'arrivo di prima del login.
 */
function arrivedFromOutside(page: AccountPage): boolean {
  const entry = page.performance?.getEntriesByType("navigation")[0] as { type?: string } | undefined;
  const origin = page.location.origin;
  if (entry?.type !== "navigate" || !origin) return false;
  const referrer = page.document?.referrer ?? "";
  if (!referrer) return true;
  try {
    return new URL(referrer).origin !== origin;
  } catch {
    return true;
  }
}

/**
 * (§2.4) `settings#cli` (i link della CLI e dell'Agent Factory) e `settings#granola` (il ritorno da Granola) aprono il
 * foglio sulla parte giusta, al posto dell'indirizzo di prima: senza un passo nuovo, e solo se non è già aperto.
 * (§3.12) Anche `settings` senza ancora né parametri, ma solo come primo indirizzo di una pagina arrivata da fuori
 * dell'app: è il link dell'e-mail «CLI collegata» alla persona, e si apre su «Claude e terminale». Dalla barra, da un
 * link dell'app, ricaricando o tornando indietro lo stesso indirizzo resta Impostazioni.
 */
export function openAccountForSettingsAnchor(pathname: string, workspaceId: string, page: AccountPage = browser()): void {
  const first = !landed.has(page);
  landed.add(page);
  const { search, hash } = page.location;
  if (new URLSearchParams(search).has(ACCOUNT_PARAM)) return;
  const target =
    accountPartForSettingsHash(pathname, hash, workspaceId) ??
    (first && arrivedFromOutside(page) ? accountPartForSettingsLanding(pathname, search, hash, workspaceId) : null);
  if (target) openAccountSheet(target, { replace: true }, page);
}
