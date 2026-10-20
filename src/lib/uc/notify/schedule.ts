/**
 * Calendario dei solleciti (PIANO §3.11, §5.7, §7.1).
 *
 * - Calendario lavorativo italiano in ora di Roma: sabato, domenica e feste
 *   nazionali (con Pasquetta) non sono lavorativi; le feste patronali non ci sono
 *   (default b9). Finestra di invio: lun–ven 09:00–18:00 a Roma, festivi esclusi.
 * - `reminderAction`: primo promemoria a 3 giorni lavorativi dall'invio, secondo
 *   a 7, segnalazione all'Owner a 10. Mai un terzo promemoria al referente.
 * - `itemsToMarkMissing` (regola 7a), `requestsToExpire` (regola 7d),
 *   `weeklySummaryDue` (riepilogo del lunedì, o del primo giorno lavorativo della
 *   settimana).
 *
 * Il calendario si può iniettare (`WorkingCalendar`): il cron passa
 * `{ isWorkingDay }` di `src/lib/uc/calendar.ts`, così promemoria e finestra
 * d'invio usano un solo calendario. Quello qui sotto ne è una copia con le stesse
 * regole (4 ottobre compreso), per i test e per l'uso senza iniezione.
 * Modulo puro (solo `Intl`).
 */
import type { CaseStatus, ItemStatus, RequestPurpose, RequestStatus } from "../vocab.ts";

export const ROME_TZ = "Europe/Rome";

/** Soglie in giorni lavorativi dall'invio della richiesta. */
export const REMINDER_THRESHOLDS = { promemoria_1: 3, promemoria_2: 7, segnalazione_owner: 10 } as const;
/** Finestra di invio a Roma: dalle 9 (compresa) alle 18 (esclusa). */
export const SEND_WINDOW = { startHour: 9, endHour: 18 } as const;
/** Massimo dei promemoria al referente per richiesta. */
export const MAX_REMINDERS = 2;

// ── Ora di Roma ───────────────────────────────────────────────────────

const ROME_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: ROME_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

const WEEKDAYS: Readonly<Record<string, number>> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export interface RomeParts {
  /** `YYYY-MM-DD` a Roma. */
  date: string;
  hour: number;
  minute: number;
  /** 1 = lunedì … 7 = domenica. */
  weekday: number;
}

export function romeParts(instant: Date): RomeParts {
  if (Number.isNaN(instant.getTime())) throw new Error("Data non valida");
  const parts = Object.fromEntries(ROME_PARTS.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

/** Data `YYYY-MM-DD` dell'istante, a Roma. */
export function romeDate(instant: Date): string {
  return romeParts(instant).date;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function utcOf(date: string): Date {
  const m = DATE.exec(date);
  if (!m) throw new Error(`Data non valida: ${date}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.toISOString().slice(0, 10) !== date) throw new Error(`Data inesistente: ${date}`);
  return d;
}

/** Somma giorni di calendario a una data `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const d = utcOf(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 1 = lunedì … 7 = domenica. */
export function weekdayOf(date: string): number {
  const day = utcOf(date).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Settimana ISO `YYYY-Www` di una data `YYYY-MM-DD`. */
export function isoWeekOf(date: string): string {
  const d = utcOf(date);
  const weekday = weekdayOf(date);
  d.setUTCDate(d.getUTCDate() + 4 - weekday); // giovedì della stessa settimana
  const year = d.getUTCFullYear();
  const firstJan = Date.UTC(year, 0, 1);
  const week = Math.floor((d.getTime() - firstJan) / 86_400_000 / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Settimana ISO a Roma dell'istante. */
export function isoWeekRome(instant: Date): string {
  return isoWeekOf(romeDate(instant));
}

/**
 * Istante UTC dell'ora locale `hour:00` di Roma in quella data. Nei giorni del
 * cambio d'ora vale l'ora effettiva (le 9 e le 18 non cadono mai nel salto).
 */
export function romeLocalToUtc(date: string, hour: number, minute = 0): Date {
  const base = utcOf(date).getTime() + (hour * 60 + minute) * 60_000;
  for (const offsetHours of [1, 2, 0]) {
    const candidate = new Date(base - offsetHours * 3_600_000);
    const p = romeParts(candidate);
    if (p.date === date && p.hour === hour && p.minute === minute) return candidate;
  }
  throw new Error(`Ora inesistente a Roma: ${date} ${hour}:${minute}`);
}

// ── Calendario lavorativo italiano ────────────────────────────────────

/** Domenica di Pasqua (calendario gregoriano, algoritmo anonimo). */
export function easterSunday(year: number): string {
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
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Feste nazionali italiane a data fissa (MM-DD). */
export const ITALIAN_FIXED_HOLIDAYS: readonly string[] = [
  "01-01", // Capodanno
  "01-06", // Epifania
  "04-25", // Festa della Liberazione
  "05-01", // Festa del lavoro
  "06-02", // Festa della Repubblica
  "08-15", // Ferragosto
  "11-01", // Ognissanti
  "12-08", // Immacolata
  "12-25", // Natale
  "12-26", // Santo Stefano
];

/**
 * Prima annualità della festa nazionale del 4 ottobre (San Francesco d'Assisi e
 * Santa Caterina da Siena), ripristinata dalla legge del 2025. Stessa regola di
 * `src/lib/uc/calendar.ts`.
 */
export const FOUR_OCTOBER_HOLIDAY_FROM_YEAR = 2026;

/** Festa nazionale italiana (con Pasqua e Pasquetta). Le feste patronali non contano. */
export function isItalianHoliday(date: string): boolean {
  utcOf(date);
  if (ITALIAN_FIXED_HOLIDAYS.includes(date.slice(5))) return true;
  if (date.slice(5) === "10-04" && Number(date.slice(0, 4)) >= FOUR_OCTOBER_HOLIDAY_FROM_YEAR) return true;
  const easter = easterSunday(Number(date.slice(0, 4)));
  return date === easter || date === addDays(easter, 1);
}

export interface WorkingCalendar {
  /** `date` è `YYYY-MM-DD` a Roma. */
  isWorkingDay(date: string): boolean;
}

export const ITALIAN_CALENDAR: WorkingCalendar = {
  isWorkingDay: (date) => weekdayOf(date) <= 5 && !isItalianHoliday(date),
};

const MAX_SPAN_DAYS = 3_660;

/** Giorni lavorativi `d` con `data(from) < d ≤ data(to)`, a Roma. 0 se `to` precede `from`. */
export function workingDaysBetween(from: Date, to: Date, cal: WorkingCalendar = ITALIAN_CALENDAR): number {
  const start = romeDate(from);
  const end = romeDate(to);
  if (end <= start) return 0;
  let count = 0;
  let day = start;
  for (let i = 0; i < MAX_SPAN_DAYS; i++) {
    day = addDays(day, 1);
    if (day > end) break;
    if (cal.isWorkingDay(day)) count++;
  }
  return count;
}

/** Data del giorno lavorativo che arriva dopo `n` giorni lavorativi da `date` (esclusa). */
export function addWorkingDays(date: string, n: number, cal: WorkingCalendar = ITALIAN_CALENDAR): string {
  if (!Number.isInteger(n) || n < 0) throw new Error("Numero di giorni non valido");
  let day = date;
  let left = n;
  for (let i = 0; left > 0 && i < MAX_SPAN_DAYS; i++) {
    day = addDays(day, 1);
    if (cal.isWorkingDay(day)) left--;
  }
  return day;
}

/** Lun–ven, festivi esclusi, dalle 9 alle 18 a Roma. */
export function inRomeSendWindow(now: Date, cal: WorkingCalendar = ITALIAN_CALENDAR): boolean {
  const p = romeParts(now);
  return cal.isWorkingDay(p.date) && p.hour >= SEND_WINDOW.startHour && p.hour < SEND_WINDOW.endHour;
}

// ── Solleciti ─────────────────────────────────────────────────────────

export type ReminderAction = "promemoria_1" | "promemoria_2" | "segnalazione_owner";

export interface ReminderRequestState {
  status: RequestStatus;
  purpose: RequestPurpose;
  sentAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  /** `uc_requests.reminder_count` (0–2). */
  reminderCount: number;
  escalatedAt: Date | null;
  caseStatus?: CaseStatus;
}

/** Stati in cui la richiesta aspetta ancora risposte. */
const WAITING: ReadonlySet<RequestStatus> = new Set(["inviata", "aperta", "in_corso"]);

function waiting(req: ReminderRequestState, now: Date): boolean {
  if (!WAITING.has(req.status) || !req.sentAt || req.revokedAt) return false;
  if (!req.expiresAt || req.expiresAt.getTime() <= now.getTime()) return false;
  if (req.caseStatus === "sospeso" || req.caseStatus === "chiuso") return false;
  return req.purpose === "raccolta";
}

/**
 * Cosa fare oggi per la richiesta: primo promemoria (3 giorni lavorativi),
 * secondo (7), segnalazione all'Owner (10), oppure niente. Solo nella finestra
 * di invio; le richieste di approvazione non ricevono solleciti.
 */
export function reminderAction(req: ReminderRequestState, now: Date, cal: WorkingCalendar = ITALIAN_CALENDAR): ReminderAction | null {
  if (!waiting(req, now) || !inRomeSendWindow(now, cal)) return null;
  const days = workingDaysBetween(req.sentAt as Date, now, cal);
  if (req.reminderCount <= 0) return days >= REMINDER_THRESHOLDS.promemoria_1 ? "promemoria_1" : null;
  if (req.reminderCount === 1) return days >= REMINDER_THRESHOLDS.promemoria_2 ? "promemoria_2" : null;
  if (!req.escalatedAt && days >= REMINDER_THRESHOLDS.segnalazione_owner) return "segnalazione_owner";
  return null;
}

/**
 * Quando scatta il prossimo sollecito (`uc_requests.next_reminder_at`): le 9 a
 * Roma del giorno lavorativo della soglia. Null se non ne restano.
 */
export function nextReminderAt(req: ReminderRequestState, now: Date, cal: WorkingCalendar = ITALIAN_CALENDAR): Date | null {
  if (!waiting(req, now)) return null;
  const threshold =
    req.reminderCount <= 0
      ? REMINDER_THRESHOLDS.promemoria_1
      : req.reminderCount === 1
        ? REMINDER_THRESHOLDS.promemoria_2
        : req.escalatedAt
          ? null
          : REMINDER_THRESHOLDS.segnalazione_owner;
  if (threshold === null) return null;
  const day = addWorkingDays(romeDate(req.sentAt as Date), threshold, cal);
  const at = romeLocalToUtc(day, SEND_WINDOW.startHour);
  return req.expiresAt && at.getTime() >= req.expiresAt.getTime() ? null : at;
}

/** Regola 7a: voci `chiesta` con scadenza passata e 2 promemoria già inviati → `mancante`. */
export function itemsToMarkMissing(
  items: readonly { id: string; status: ItemStatus; dueAt: Date | null; requestReminderCount: number }[],
  now: Date,
): string[] {
  return items
    .filter((i) => i.status === "chiesta" && i.dueAt !== null && i.dueAt.getTime() < now.getTime() && i.requestReminderCount >= MAX_REMINDERS)
    .map((i) => i.id);
}

/** Motivi mostrati sulle voci che diventano `mancante` (sempre visibili). */
export const MISSING_REASONS = {
  scaduta_dopo_promemoria: "Scaduta dopo 2 promemoria",
  link_scaduto: "Link scaduto senza risposta",
} as const;

/** Regola 7d: richieste ancora in attesa oltre `expires_at` → `scaduta`. */
export function requestsToExpire(reqs: readonly { id: string; status: RequestStatus; expiresAt: Date | null }[], now: Date): string[] {
  return reqs.filter((r) => WAITING.has(r.status) && r.expiresAt !== null && r.expiresAt.getTime() <= now.getTime()).map((r) => r.id);
}

/**
 * Riepilogo settimanale: si mette in coda nel primo giorno lavorativo della
 * settimana ISO (di solito il lunedì; con Pasquetta il martedì), nella finestra
 * di invio. La chiave di deduplica usa `week`.
 */
export function weeklySummaryDue(now: Date, cal: WorkingCalendar = ITALIAN_CALENDAR): { due: boolean; week: string } {
  const p = romeParts(now);
  const week = isoWeekOf(p.date);
  if (!inRomeSendWindow(now, cal)) return { due: false, week };
  let first: string | null = null;
  const monday = addDays(p.date, 1 - p.weekday);
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (cal.isWorkingDay(d)) {
      first = d;
      break;
    }
  }
  return { due: first === p.date, week };
}
