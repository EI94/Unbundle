/**
 * Il link alla scheda di uno use case, al capitolo «Cosa serve», nelle email (SPEC §P2.7.4 e Parte 3
 * §P3.4): nell'avviso a chi ha chiesto e, solo per un referente che è già revisore del workspace,
 * nell'email al referente («Hai già accesso a Unbundle: puoi rispondere anche dalla scheda.»).
 * (0025) Anche la scheda a `?capitolo=realizzazione` («Pronto da avviare»), a `?capitolo=richieste`
 * («Nessuna risposta» a chi ha chiesto: «Richieste inviate», dove si chiede di nuovo) e Impostazioni ›
 * Sub-responsabili («Autorizza i fornitori»), con lo stesso controllo della forma.
 *
 * Il link apre la dashboard: serve l'accesso, quindi non dà niente a chi non ce l'ha. Si costruisce
 * solo da uuid e dall'origine pubblica, e prima di finire in un'email si ricontrolla la forma.
 *
 * Modulo puro.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)$/i;
const CARD_PATH = /^\/dashboard\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/use-cases\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CARD_QUERY = "?capitolo=cosa-serve";

/** Il link alla scheda, al capitolo «Cosa serve»: https (http solo in locale), solo uuid. */
export function cardLink(origin: string, workspaceId: string, useCaseId: string): string {
  if (!UUID.test(workspaceId) || !UUID.test(useCaseId)) throw new Error("Identificativo non valido nel link");
  const url = new URL(origin);
  if (url.username || url.password) throw new Error("Origine non valida");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.test(url.hostname))) throw new Error("Il link dell'email deve essere https");
  return `${url.origin}/dashboard/${workspaceId.toLowerCase()}/use-cases/${useCaseId.toLowerCase()}${CARD_QUERY}`;
}

/** Il link alla scheda è pulito? La stessa forma di `cardLink`, nient'altro: niente credenziali, frammenti o altri parametri. */
export function checkCardLink(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("Link della scheda non valido");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.test(url.hostname))) throw new Error("Il link della scheda deve essere https");
  if (url.username || url.password || url.hash || url.search !== CARD_QUERY) throw new Error("Il link della scheda non può avere altri parametri");
  if (!CARD_PATH.test(url.pathname)) throw new Error("Percorso del link della scheda non ammesso");
  return url.toString();
}

/** I capitoli della scheda che un'email può aprire. */
export const CARD_LINK_CHAPTERS = ["cosa-serve", "realizzazione", "richieste"] as const;
export type CardLinkChapter = (typeof CARD_LINK_CHAPTERS)[number];

/** Il link alla scheda, a un capitolo: come `cardLink` (che resta per «Cosa serve»). */
export function cardLinkTo(origin: string, workspaceId: string, useCaseId: string, chapter: CardLinkChapter): string {
  const link = cardLink(origin, workspaceId, useCaseId);
  if (chapter === "cosa-serve") return link;
  if (!CARD_LINK_CHAPTERS.includes(chapter)) throw new Error("Capitolo non ammesso nel link");
  return checkChapterLink(`${link.slice(0, -CARD_QUERY.length)}?capitolo=${chapter}`, chapter);
}

/** Il link alla scheda a quel capitolo è pulito? La forma di `cardLinkTo`, nient'altro. */
export function checkChapterLink(link: string, chapter: CardLinkChapter): string {
  if (chapter === "cosa-serve") return checkCardLink(link);
  if (!CARD_LINK_CHAPTERS.includes(chapter)) throw new Error("Capitolo non ammesso nel link");
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("Link della scheda non valido");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.test(url.hostname))) throw new Error("Il link della scheda deve essere https");
  if (url.username || url.password || url.hash || url.search !== `?capitolo=${chapter}`) throw new Error("Il link della scheda non può avere altri parametri");
  if (!CARD_PATH.test(url.pathname)) throw new Error("Percorso del link della scheda non ammesso");
  return url.toString();
}

const SETTINGS_PATH = /^\/dashboard\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/settings$/;
const SETTINGS_HASH = "#sub-responsabili";

/** Il link a Impostazioni › Sub-responsabili del workspace: https (http solo in locale), solo uuid. */
export function settingsLink(origin: string, workspaceId: string): string {
  if (!UUID.test(workspaceId)) throw new Error("Identificativo non valido nel link");
  const url = new URL(origin);
  if (url.username || url.password) throw new Error("Origine non valida");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.test(url.hostname))) throw new Error("Il link dell'email deve essere https");
  return checkSettingsLink(`${url.origin}/dashboard/${workspaceId.toLowerCase()}/settings${SETTINGS_HASH}`);
}

/** Il link alle Impostazioni è pulito? La forma di `settingsLink`, nient'altro: niente credenziali né parametri. */
export function checkSettingsLink(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("Link delle impostazioni non valido");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.test(url.hostname))) throw new Error("Il link delle impostazioni deve essere https");
  if (url.username || url.password || url.search || url.hash !== SETTINGS_HASH) throw new Error("Il link delle impostazioni non può avere altri parametri");
  if (!SETTINGS_PATH.test(url.pathname)) throw new Error("Percorso del link delle impostazioni non ammesso");
  return url.toString();
}
