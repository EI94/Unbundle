/**
 * «Periodo» di Attività (DESIGN §3.12): i giorni `dal` e `al` (`YYYY-MM-DD`,
 * giorno di Roma). Lo usano il filtro dell'URL (`parseAuditFilter`) e i campi
 * data di «Filtra», che lo importano nel browser: per questo sta da solo,
 * senza SQL. Modulo puro.
 */

/**
 * Anno più vecchio del «Periodo». Mentre si scrive l'anno in un campo data,
 * «0002-10-14» è già una data valida: prima del 2000 non è un filtro.
 */
export const ACTIVITY_MIN_YEAR = 2000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Una data `YYYY-MM-DD` esistente, dal 2000 in poi; altrimenti null. */
export function periodDay(v: string | null): string | null {
  if (!v || !ISO_DATE.test(v) || Number(v.slice(0, 4)) < ACTIVITY_MIN_YEAR) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/**
 * Valore di un campo data del «Periodo» quando lo si applica (Invio, uscita dal
 * campo, chiusura di «Filtra»): vuoto vuol dire nessun limite; una data
 * completa dal 2000 in poi vale; altrimenti (anno scritto a metà, data
 * impossibile) resta quella già applicata.
 */
export function periodDateInput(raw: string, applied: string | null): string | null {
  const v = raw.trim();
  if (v === "") return null;
  return periodDay(v) ?? applied;
}
