/**
 * La freschezza dei fatti (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.10, D9): un fatto attivo non
 * riconfermato da 6 mesi diventa «da verificare». La regola è per giorni di Roma: ogni notte il giro segna i fatti con
 * l'ultima conferma prima della mezzanotte di Roma di sei mesi fa. Così un fatto confermato il 18 maggio lo segna la notte
 * del 19 novembre, a qualunque ora sia stato confermato, con l'ora legale o senza.
 *
 * Modulo puro: import relativi `.ts`.
 */
import { romeLocalToUtc, romeParts } from "../../uc/calendar.ts";
import { CONTEXT_LIMITS } from "../vocab.ts";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * L'istante prima del quale un fatto è «da verificare»: la mezzanotte di Roma dello stesso giorno, `staleMonths` mesi
 * prima di oggi (a Roma). Un giorno che quel mese non ha (il 31 agosto, sei mesi dopo il 31 febbraio che non c'è) vale
 * l'ultimo giorno del mese.
 */
export function staleBefore(now: Date): Date {
  const today = romeParts(now);
  const months = today.year * 12 + (today.month - 1) - CONTEXT_LIMITS.staleMonths;
  const year = Math.floor(months / 12);
  const month = (months % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return romeLocalToUtc(`${year}-${pad(month)}-${pad(Math.min(today.day, lastDay))}`, 0, 0);
}
