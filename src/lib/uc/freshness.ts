/**
 * Freschezza dei dati validati (PIANO §3.8).
 *
 * Un dato validato «scade» `freshness_days` giorni dopo la data da cui vale
 * (`valid_from`) oppure, se manca, dopo la data della risposta. La scadenza cade
 * alle 00:00 di Roma di quel giorno [D], salvata come istante UTC (`stale_at`).
 *
 * Calendario e ore in `Europe/Rome` con `Intl.DateTimeFormat`: niente librerie.
 * A Roma il cambio d'ora avviene alle 02:00/03:00, quindi la mezzanotte esiste
 * sempre ed è unica.
 *
 * Modulo puro: import relativi `.ts`, nessun accesso a DB o ambiente.
 */
import type { ItemStatus, ResponseType } from "./vocab.ts";

export const ROME_TZ = "Europe/Rome";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

const romeParts = new Intl.DateTimeFormat("en-US", {
  timeZone: ROME_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function partsOf(date: Date): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const out: Record<string, number> = {};
  for (const p of romeParts.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, h: out.hour, min: out.minute, s: out.second };
}

/** Minuti di cui l'ora di Roma è avanti rispetto a UTC in quell'istante (60 o 120). */
export function romeOffsetMinutes(date: Date): number {
  const p = partsOf(date);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  const exact = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - exact) / 60_000);
}

/** Data di calendario a Roma (`YYYY-MM-DD`) di un istante. */
export function romeDateOf(date: Date): string {
  const p = partsOf(date);
  return `${String(p.y).padStart(4, "0")}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Vero se la stringa è una data `YYYY-MM-DD` esistente. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Aggiunge giorni di calendario a una data `YYYY-MM-DD`. */
export function addDaysToDate(date: string, days: number): string {
  if (!isIsoDate(date)) throw new Error("Data non valida");
  if (!Number.isInteger(days)) throw new Error("Numero di giorni non valido");
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return t.toISOString().slice(0, 10);
}

/** Istante UTC delle 00:00 di Roma del giorno indicato. */
export function romeMidnightUtc(date: string): Date {
  if (!isIsoDate(date)) throw new Error("Data non valida");
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let candidate = guess - romeOffsetMinutes(new Date(guess)) * 60_000;
  // L'offset va letto nell'istante giusto: con un cambio d'ora vicino si ricalcola.
  const corrected = guess - romeOffsetMinutes(new Date(candidate)) * 60_000;
  if (corrected !== candidate) candidate = corrected;
  return new Date(candidate);
}

/**
 * Quando scade un dato validato: `(validFrom ?? data della risposta) + giorni`,
 * alle 00:00 di Roma. Senza `freshnessDays` non scade mai (null).
 */
export function computeStaleAt(i: { freshnessDays: number | null; validFrom: string | null; answeredAt: Date }): Date | null {
  if (i.freshnessDays === null || i.freshnessDays === undefined) return null;
  if (!Number.isInteger(i.freshnessDays) || i.freshnessDays <= 0) throw new Error("freshness_days deve essere un intero positivo");
  const base = i.validFrom !== null && i.validFrom !== undefined ? i.validFrom : romeDateOf(i.answeredAt);
  if (!isIsoDate(base)) throw new Error("valid_from non valido");
  return romeMidnightUtc(addDaysToDate(base, i.freshnessDays));
}

/**
 * Voci validate il cui dato è scaduto (`stale_at ≤ now`): il cron
 * `uc-freshness` le porta a `in_verifica` con «dato scaduto» (riga 24).
 */
export function itemsToExpire(items: readonly { id: string; status: ItemStatus; staleAt: Date | null }[], now: Date): string[] {
  const t = now.getTime();
  return items.filter((i) => i.status === "validata" && i.staleAt !== null && i.staleAt.getTime() <= t).map((i) => i.id);
}

/** `requires_validity_period` di default: vero per gli importi (`valuta`) [D]. */
export function defaultRequiresValidityPeriod(responseType: ResponseType | null): boolean {
  return responseType === "valuta";
}
