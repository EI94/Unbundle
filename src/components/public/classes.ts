/**
 * (Rilascio 10, ondata 4, PROPOSTA-10 §3.11, §5.5, §5.7) Le misure dei controlli delle pagine fuori dalla dashboard, in
 * un posto solo: il pulsante principale (il solo pieno della schermata, il prossimo passo) a tutta larghezza e alto 48 px;
 * gli altri pulsanti e i link almeno 44 px; i campi alti 44 px con il testo a 16 px, così iOS non ingrandisce.
 * Modulo puro: lo provano i test senza browser.
 */

/** Il pulsante principale: `<Button className={PUBLIC_PRIMARY}>`, pieno. */
export const PUBLIC_PRIMARY = "h-12 w-full text-base";

/** Un pulsante bordato nel flusso della pagina (`variant="outline"`): la stessa misura del principale. */
export const PUBLIC_SECONDARY = "h-12 w-full text-base";

/** Un link o un pulsante di testo: 44 px di bersaglio, sottolineato. */
export const PUBLIC_LINK = "inline-flex min-h-11 items-center text-left font-medium underline underline-offset-4 hover:text-foreground";

/** Un campo di testo o un elenco: 44 px, testo a 16 px a ogni larghezza. */
export const PUBLIC_FIELD = "h-11 text-base md:text-base";

/** L'etichetta di un campo: leggibile, non grigia. */
export const PUBLIC_LABEL = "text-sm font-medium text-foreground";
