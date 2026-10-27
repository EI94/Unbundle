/**
 * Il link alla scheda di uno use case, al capitolo «Cosa serve», nelle email (SPEC §P2.7.4 e Parte 3
 * §P3.4): nell'avviso a chi ha chiesto e, solo per un referente che è già revisore del workspace,
 * nell'email al referente («Hai già accesso a Unbundle: puoi rispondere anche dalla scheda.»).
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
