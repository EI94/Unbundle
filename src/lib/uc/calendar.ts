/**
 * Calendario lavorativo italiano e finestra d'invio a Roma (PIANO §3.11, b9).
 *
 * - Feste nazionali più Pasquetta (Pasqua calcolata). Le feste patronali non
 *   ci sono: valgono in un solo comune.
 * - I «ponti» non sono festivi: un lunedì tra la domenica e un martedì di festa
 *   è un giorno lavorativo.
 * - Finestra d'invio: lunedì–venerdì non festivi, dalle 09:00 alle 18:00 ora di
 *   Roma (18:00 esclusa), con ora legale e solare gestite da `Intl`.
 *
 * Le date civili sono stringhe `YYYY-MM-DD`; un `Date` (istante) si converte
 * prima nella data di Roma. Modulo puro.
 */

export const ROME_TIME_ZONE = "Europe/Rome";
/** Finestra d'invio, ore di Roma: [startHour, endHour). */
export const ROME_SEND_WINDOW = Object.freeze({ startHour: 9, endHour: 18 });

/** Data civile `YYYY-MM-DD`. */
export type CivilDate = string;

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function civil(year: number, month: number, day: number): CivilDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Legge e controlla una data civile; lancia se non esiste (es. 2026-02-30). */
export function parseCivilDate(date: CivilDate): { year: number; month: number; day: number } {
  const match = CIVIL_DATE.exec(date);
  if (!match) throw new RangeError(`Data non valida: ${JSON.stringify(date)}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2999 || probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new RangeError(`Data non valida: ${JSON.stringify(date)}`);
  }
  return { year, month, day };
}

function toUtcMidnight(date: CivilDate): number {
  const { year, month, day } = parseCivilDate(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMidnight(ms: number): CivilDate {
  const d = new Date(ms);
  return civil(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** `date` + `days` giorni di calendario. */
export function addCalendarDays(date: CivilDate, days: number): CivilDate {
  if (!Number.isInteger(days)) throw new RangeError("Numero di giorni non valido");
  return fromUtcMidnight(toUtcMidnight(date) + days * DAY_MS);
}

/** Giorno della settimana ISO: 1 = lunedì … 7 = domenica. */
export function isoWeekday(date: CivilDate): number {
  const day = new Date(toUtcMidnight(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

// ── Ora di Roma ───────────────────────────────────────────────────────

export interface RomeParts {
  date: CivilDate;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 1 = lunedì … 7 = domenica. */
  weekday: number;
}

let romeFormatter: Intl.DateTimeFormat | null = null;

function formatter(): Intl.DateTimeFormat {
  romeFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: ROME_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return romeFormatter;
}

function assertInstant(instant: Date): void {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) throw new RangeError("Istante non valido");
}

/** Data, ora e giorno della settimana di un istante, a Roma. */
export function romeParts(instant: Date): RomeParts {
  assertInstant(instant);
  const parts: Record<string, string> = {};
  for (const part of formatter().formatToParts(instant)) parts[part.type] = part.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const date = civil(year, month, day);
  return { date, year, month, day, hour: Number(parts.hour), minute: Number(parts.minute), weekday: isoWeekday(date) };
}

/** Data civile di Roma per un istante (es. chiavi di deduplica «al giorno»). */
export function romeDate(instant: Date): CivilDate {
  return romeParts(instant).date;
}

/** Scarto di Roma rispetto a UTC, in minuti, nell'istante dato (+60 o +120). */
function romeOffsetMinutes(ms: number): number {
  const p = romeParts(new Date(ms));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(ms / 60_000) * 60_000) / 60_000);
}

/**
 * Istante UTC di un'ora locale di Roma. Pensato per le ore della finestra
 * d'invio, che non cadono mai nel salto del cambio d'ora (02:00–03:00).
 */
export function romeLocalToUtc(date: CivilDate, hour: number, minute = 0): Date {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError("Ora non valida");
  }
  const { year, month, day } = parseCivilDate(date);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = guess - romeOffsetMinutes(guess) * 60_000;
  const second = romeOffsetMinutes(result);
  result = guess - second * 60_000;
  return new Date(result);
}

// ── Feste ─────────────────────────────────────────────────────────────

/** Domenica di Pasqua (calendario gregoriano, algoritmo anonimo di Meeus/Jones/Butcher). */
export function easterSunday(year: number): CivilDate {
  if (!Number.isInteger(year) || year < 1900 || year > 2999) throw new RangeError("Anno non valido");
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return civil(year, month, day);
}

export interface Holiday {
  date: CivilDate;
  name: string;
}

/**
 * Prima annualità della festa nazionale del 4 ottobre (San Francesco d'Assisi e
 * Santa Caterina da Siena), ripristinata come giorno festivo dalla legge
 * approvata nel 2025.
 */
export const FOUR_OCTOBER_HOLIDAY_FROM_YEAR = 2026;

const cache = new Map<number, ReadonlyMap<CivilDate, string>>();

/** Feste nazionali italiane dell'anno, più Pasqua e Pasquetta, in ordine di data. */
export function italianHolidays(year: number): Holiday[] {
  return [...holidayMap(year)].map(([date, name]) => ({ date, name }));
}

function holidayMap(year: number): ReadonlyMap<CivilDate, string> {
  const cached = cache.get(year);
  if (cached) return cached;
  const easter = easterSunday(year);
  const list: [CivilDate, string][] = [
    [civil(year, 1, 1), "Capodanno"],
    [civil(year, 1, 6), "Epifania"],
    [easter, "Pasqua"],
    [addCalendarDays(easter, 1), "Lunedì dell'Angelo"],
    [civil(year, 4, 25), "Festa della Liberazione"],
    [civil(year, 5, 1), "Festa del Lavoro"],
    [civil(year, 6, 2), "Festa della Repubblica"],
    [civil(year, 8, 15), "Ferragosto"],
    [civil(year, 11, 1), "Ognissanti"],
    [civil(year, 12, 8), "Immacolata Concezione"],
    [civil(year, 12, 25), "Natale"],
    [civil(year, 12, 26), "Santo Stefano"],
  ];
  if (year >= FOUR_OCTOBER_HOLIDAY_FROM_YEAR) list.push([civil(year, 10, 4), "San Francesco d'Assisi e Santa Caterina da Siena"]);
  list.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const map = new Map(list);
  cache.set(year, map);
  return map;
}

function asCivil(date: CivilDate | Date): CivilDate {
  if (date instanceof Date) return romeDate(date);
  parseCivilDate(date);
  return date;
}

/** Vero nei giorni di festa nazionale (un `Date` vale per la sua data di Roma). */
export function isItalianHoliday(date: CivilDate | Date): boolean {
  const d = asCivil(date);
  return holidayMap(Number(d.slice(0, 4))).has(d);
}

/** Lunedì–venerdì e non festivo. */
export function isWorkingDay(date: CivilDate | Date): boolean {
  const d = asCivil(date);
  return isoWeekday(d) <= 5 && !isItalianHoliday(d);
}

const MAX_WORKING_DAYS = 3660;

/**
 * La data che cade `days` giorni lavorativi dopo `start` (escluso). Con
 * `days = 0` restituisce `start`. Es. un invio di venerdì + 1 = lunedì, salvo
 * festa.
 */
export function addWorkingDays(start: CivilDate | Date, days: number): CivilDate {
  if (!Number.isInteger(days) || days < 0 || days > MAX_WORKING_DAYS) throw new RangeError("Numero di giorni lavorativi non valido");
  let current = asCivil(start);
  let left = days;
  while (left > 0) {
    current = addCalendarDays(current, 1);
    if (isWorkingDay(current)) left--;
  }
  return current;
}

/**
 * Giorni lavorativi `d` con `from < d ≤ to`. Così
 * `workingDaysBetween(x, addWorkingDays(x, n)) === n`. Zero se `to ≤ from`.
 */
export function workingDaysBetween(from: CivilDate | Date, to: CivilDate | Date): number {
  const start = asCivil(from);
  const end = asCivil(to);
  if (end <= start) return 0;
  const span = (toUtcMidnight(end) - toUtcMidnight(start)) / DAY_MS;
  if (span > MAX_WORKING_DAYS * 2) throw new RangeError("Intervallo troppo lungo");
  let count = 0;
  let current = start;
  while (current < end) {
    current = addCalendarDays(current, 1);
    if (isWorkingDay(current)) count++;
  }
  return count;
}

// ── Finestra d'invio ──────────────────────────────────────────────────

/** Vero in un giorno lavorativo tra le 09:00 e le 18:00 (esclusa) di Roma. */
export function inRomeSendWindow(now: Date): boolean {
  const p = romeParts(now);
  return isWorkingDay(p.date) && p.hour >= ROME_SEND_WINDOW.startHour && p.hour < ROME_SEND_WINDOW.endHour;
}

/**
 * Primo istante utile per un invio: `now` se è già nella finestra, altrimenti
 * le 09:00 di Roma del primo giorno lavorativo utile.
 */
export function nextRomeSendWindowStart(now: Date): Date {
  if (inRomeSendWindow(now)) return new Date(now.getTime());
  const p = romeParts(now);
  let day = p.date;
  if (!(isWorkingDay(day) && p.hour < ROME_SEND_WINDOW.startHour)) day = addWorkingDays(day, 1);
  return romeLocalToUtc(day, ROME_SEND_WINDOW.startHour, 0);
}
