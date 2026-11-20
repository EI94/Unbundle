/**
 * «Periodo» di Attività (DESIGN §3.12): i giorni `dal` e `al` (`YYYY-MM-DD`,
 * giorno di Roma). Lo usano il filtro dell'URL (`parseAuditFilter`) e il filtro
 * comune della pagina: sta da solo, senza SQL. Modulo puro.
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

// ── (Rilascio 10, §3.5) Il periodo nel filtro comune di Attività ─────

/**
 * Il periodo come un solo parametro (`periodo=AAAA-MM-GG_AAAA-MM-GG`, un lato vuoto = nessun limite), così il filtro
 * comune (`FilterChips`) lo tratta come gli altri: una scelta nel foglio «Filtri», un chip con ✕. I link di prima con
 * `dal` e `al` valgono ancora (`parseAuditFilter`).
 */
export const PERIOD_PARAM = "periodo";

/** `periodo` letto: le date valide, altrimenti nessun limite. */
export function parsePeriod(v: string | null | undefined): { dal: string | null; al: string | null } {
  const [dal = "", al = ""] = (v ?? "").split("_");
  return { dal: periodDay(dal || null), al: periodDay(al || null) };
}

/** Il valore di `periodo` per un intervallo; null senza limiti. */
export function periodValue(dal: string | null, al: string | null): string | null {
  return dal || al ? `${dal ?? ""}_${al ?? ""}` : null;
}

/** Un giorno `AAAA-MM-GG` spostato di `days` (anche indietro). */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const SHORT_DAY = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "UTC" });
const short = (day: string) => SHORT_DAY.format(new Date(`${day}T12:00:00Z`)).replace(".", "");

/** «dal 3 ott al 9 ott», «dal 3 ott», «fino al 9 ott». */
export function periodLabel(dal: string | null, al: string | null): string {
  if (dal && al) return dal === al ? `il ${short(dal)}` : `dal ${short(dal)} al ${short(al)}`;
  if (dal) return `dal ${short(dal)}`;
  return al ? `fino al ${short(al)}` : "";
}

/**
 * Le scelte del «Periodo» (oggi è il giorno di Roma): oggi, gli ultimi 7, 30 e 90 giorni; con un periodo diverso già
 * nell'indirizzo (un link di prima con `dal`/`al`), anche quello, così il chip lo dice e si toglie.
 */
export function periodOptions(today: string, current: { dal: string | null; al: string | null }): { value: string; label: string }[] {
  const presets = [
    { value: `${today}_${today}`, label: "Oggi" },
    { value: `${shiftDay(today, -6)}_`, label: "Ultimi 7 giorni" },
    { value: `${shiftDay(today, -29)}_`, label: "Ultimi 30 giorni" },
    { value: `${shiftDay(today, -89)}_`, label: "Ultimi 90 giorni" },
  ];
  const now = periodValue(current.dal, current.al);
  return now && !presets.some((p) => p.value === now) ? [...presets, { value: now, label: periodLabel(current.dal, current.al) }] : presets;
}
