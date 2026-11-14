/**
 * L'ancora che un rinvio interno riattacca all'indirizzo d'arrivo (`RedirectKeepingHash`): solo un'ancora semplice
 * della pagina («#banco», «#compiti»), mai altro. Modulo puro.
 */
const ANCHOR_RE = /^#[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** «#banco» resta «#banco»; vuota, troppo lunga o con altri caratteri diventa «». */
export function keptHash(hash: string): string {
  return ANCHOR_RE.test(hash) ? hash : "";
}

/** Vero solo per un indirizzo di questo sito: comincia con «/» e non con «//». */
export function isInternalPath(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\");
}
