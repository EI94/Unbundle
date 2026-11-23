/**
 * La copia del link per tutti che il browser tiene (rilascio 10, ondata 7b): una per rilevazione, legata alla versione
 * del link (`open-link-version.ts`). «Copia il link per tutti» la riusa finché il link è lo stesso; con un link nuovo,
 * o su un'altra rilevazione, non vale più e se ne chiede una al server. Così ogni browser emette una copia sola per
 * versione, e le copie in giro restano poche. Si tiene il link con il suo token, mai l'hash.
 *
 * Modulo puro: la memoria arriva da fuori (`window.localStorage`, o niente quando il browser non la dà).
 */

export const OPEN_LINK_CACHE_PREFIX = "unbundle-air-link:";

export interface LinkStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const keyOf = (assessmentId: string) => `${OPEN_LINK_CACHE_PREFIX}${assessmentId}`;

/** Un link del questionario per tutti: https (o http in locale), sul percorso `/s/<token>`. */
function isOpenLinkUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && /^\/s\/[^/]+$/.test(url.pathname) && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** La copia tenuta per questa rilevazione e questa versione del link, oppure null. */
export function cachedOpenLink(storage: LinkStorage | null, assessmentId: string, version: string | null): string | null {
  if (!storage || !version) return null;
  try {
    const raw = storage.getItem(keyOf(assessmentId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as { v?: unknown; url?: unknown };
    return entry && entry.v === version && isOpenLinkUrl(entry.url) ? entry.url : null;
  } catch {
    return null;
  }
}

/** Tiene la copia per questa rilevazione e questa versione: prende il posto di quella di prima. */
export function rememberOpenLink(storage: LinkStorage | null, assessmentId: string, version: string | null, url: string): void {
  if (!storage || !version || !isOpenLinkUrl(url)) return;
  try {
    storage.setItem(keyOf(assessmentId), JSON.stringify({ v: version, url }));
  } catch {
    // Memoria piena o negata: la prossima copia si chiede al server.
  }
}

/** La memoria del browser, se c'è e si può usare. */
export function browserLinkStorage(): LinkStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
