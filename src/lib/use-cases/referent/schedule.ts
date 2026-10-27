/**
 * Il calendario di «Chiedi al referente» (SPEC §3.6): promemoria, scadenze, conservazione.
 *
 * - Primo promemoria dopo 3 giorni lavorativi dall'invio, ultimo dopo 7 (le soglie dei dossier,
 *   `REMINDER_THRESHOLDS`). Mai un terzo promemoria automatico. Solo da lunedì a venerdì, dalle 9
 *   alle 18 di Roma, feste italiane escluse (`calendar.ts`).
 * - Mai due email della stessa richiesta lo stesso giorno, e un promemoria automatico solo dopo
 *   almeno 2 giorni lavorativi dall'ultima email: un promemoria a mano il giorno 2 sposta il primo
 *   al giorno 4.
 * - «Manda un promemoria»: la stessa finestra (fuori orario parte alle 9 del giorno lavorativo
 *   dopo) e al massimo un promemoria al giorno per persona, su tutte le sue richieste.
 * - Una riga della coda ancora da inviare 2 giorni lavorativi dopo `due_at` si annulla: niente
 *   email vecchie.
 * - Risposte e file si cancellano 12 mesi (di calendario, a Roma) dopo la fine della richiesta.
 *
 * Modulo puro.
 */
import type { ReferentRequestStatus } from "../../db/use-case-hub-referents-ddl.ts";
import {
  addWorkingDays,
  inRomeSendWindow,
  isWorkingDay,
  nextRomeSendWindowStart,
  parseCivilDate,
  romeDate,
  romeLocalToUtc,
  romeParts,
  workingDaysBetween,
  ROME_SEND_WINDOW,
} from "../../uc/calendar.ts";
import { REMINDER_THRESHOLDS } from "../../uc/notify/schedule.ts";
import { REQUEST_LINK_TTL_DAYS } from "../../uc/sql/requests.ts";

export const REFERENT_REMINDER_DAYS = { primo: REMINDER_THRESHOLDS.promemoria_1, ultimo: REMINDER_THRESHOLDS.promemoria_2 } as const;
/** Un promemoria automatico vuole almeno tanti giorni lavorativi dall'ultima email della richiesta. */
export const MIN_WORKING_DAYS_SINCE_LAST_EMAIL = 2;
/** Una riga in coda o in errore tanti giorni lavorativi dopo il suo `due_at` si annulla. */
export const STALE_AFTER_WORKING_DAYS = 2;
export const REFERENT_RETENTION_MONTHS = 12;

const DAY_MS = 86_400_000;

/** La scadenza di una richiesta: 30 giorni dalla creazione. */
export function referentExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + REQUEST_LINK_TTL_DAYS * DAY_MS);
}

export interface ReminderState {
  status: ReferentRequestStatus;
  sentAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  reminderCount: number;
  lastEmailAt: Date | null;
  /** Domande ancora aperte (`itemIsOpen`). */
  openItems: number;
  /**
   * L'indirizzo del referente è stato corretto dopo l'ultima email: nessun link valido per l'email di
   * adesso. Le email partite oggi sono andate all'indirizzo sbagliato, quindi «Manda un promemoria»
   * può partire anche oggi (è l'unico modo di dare il link al nuovo indirizzo).
   */
  addressChanged?: boolean;
}

/** Due istanti nello stesso giorno di Roma (`a` null: no). */
export function sameRomeDay(a: Date | null, b: Date): boolean {
  return a !== null && romeDate(a) === romeDate(b);
}

function live(r: ReminderState, now: Date): boolean {
  return r.status === "inviata" && r.revokedAt === null && r.expiresAt.getTime() > now.getTime();
}

/** Il promemoria automatico dovuto adesso, oppure null. */
export function referentReminderDue(r: ReminderState, now: Date): "primo" | "ultimo" | null {
  if (!live(r, now) || !r.sentAt || r.openItems <= 0) return null;
  if (!inRomeSendWindow(now)) return null;
  if (r.lastEmailAt && (sameRomeDay(r.lastEmailAt, now) || workingDaysBetween(r.lastEmailAt, now) < MIN_WORKING_DAYS_SINCE_LAST_EMAIL)) return null;
  const days = workingDaysBetween(r.sentAt, now);
  if (r.reminderCount === 0 && days >= REFERENT_REMINDER_DAYS.primo) return "primo";
  if (r.reminderCount === 1 && days >= REFERENT_REMINDER_DAYS.ultimo) return "ultimo";
  return null;
}

/** Il giorno (data ISO di Roma) del prossimo promemoria automatico, per «Prossimo promemoria dal …»; null se non ce ne sono. */
export function nextReminderOn(r: ReminderState, now: Date): string | null {
  if (!live(r, now) || !r.sentAt || r.openItems <= 0 || r.reminderCount >= 2) return null;
  const threshold = r.reminderCount === 0 ? REFERENT_REMINDER_DAYS.primo : REFERENT_REMINDER_DAYS.ultimo;
  let day = addWorkingDays(r.sentAt, threshold);
  if (r.lastEmailAt) {
    const afterLast = addWorkingDays(r.lastEmailAt, MIN_WORKING_DAYS_SINCE_LAST_EMAIL);
    if (afterLast > day) day = afterLast;
  }
  const today = romeDate(now);
  if (day < today) day = today;
  if (day === today && !(isWorkingDay(today) && romeParts(now).hour < ROME_SEND_WINDOW.endHour)) day = addWorkingDays(today, 1);
  if (romeLocalToUtc(day, ROME_SEND_WINDOW.startHour).getTime() >= r.expiresAt.getTime()) return null;
  return day;
}

export type ManualReminderRefusal = "non_ancora_inviata" | "richiesta_chiusa" | "nessuna_domanda_aperta" | "promemoria_gia_inviato";

/**
 * «Manda un promemoria»: quando parte (adesso nella finestra, altrimenti alle 9 del prossimo giorno
 * lavorativo) e se si può. `contact.remindedOn` sono i giorni di Roma in cui la persona ha già un
 * promemoria partito o in coda, su qualunque richiesta.
 */
export function manualReminderCheck(
  r: ReminderState,
  now: Date,
  contact: { remindedOn: ReadonlySet<string> },
): { ok: true; scheduledAt: Date } | { ok: false; code: ManualReminderRefusal } {
  if (!live(r, now)) return { ok: false, code: "richiesta_chiusa" };
  if (!r.sentAt) return { ok: false, code: "non_ancora_inviata" };
  if (r.openItems <= 0) return { ok: false, code: "nessuna_domanda_aperta" };
  const scheduledAt = inRomeSendWindow(now) ? new Date(now.getTime()) : nextRomeSendWindowStart(now);
  if (scheduledAt.getTime() >= r.expiresAt.getTime()) return { ok: false, code: "richiesta_chiusa" };
  if (!r.addressChanged && (sameRomeDay(r.lastEmailAt, scheduledAt) || contact.remindedOn.has(romeDate(scheduledAt)))) {
    return { ok: false, code: "promemoria_gia_inviato" };
  }
  return { ok: true, scheduledAt };
}

/** Una riga della coda è troppo vecchia per partire: più di 2 giorni lavorativi dopo `due_at`. */
export function isStaleEmail(dueAt: Date, now: Date): boolean {
  return workingDaysBetween(dueAt, now) > STALE_AFTER_WORKING_DAYS;
}

/** Sono passati 12 mesi di calendario (a Roma) dalla fine della richiesta. */
export function retentionDue(endedAt: Date, now: Date): boolean {
  const { year, month, day } = parseCivilDate(romeDate(endedAt));
  const months = month - 1 + REFERENT_RETENTION_MONTHS;
  const y = year + Math.floor(months / 12);
  const m = (months % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const due = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
  return romeDate(now) >= due;
}
