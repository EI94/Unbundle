/**
 * «Quando» e date di calendario (docs/use-case/DESIGN.md §3.6, §1.2 punto 1).
 *
 * - Il dato è un trimestre, non una parola relativa: `target_quarter` salva `2026-Q4`
 *   (CHECK `^[0-9]{4}-Q[1-4]$`), `NULL` vuol dire «Più avanti». Non invecchia: a gennaio
 *   2027 uno use case approvato «Questo trimestre» a ottobre mostra «T4 2026».
 * - A schermo «T1 2027»: «Q» è inglese e non compare mai.
 * - Oggi e il trimestre di oggi si calcolano nel fuso `Europe/Rome`, qualunque sia il fuso
 *   del server (Vercel gira in UTC).
 *
 * Modulo puro: solo import di tipi relativi `.ts`.
 */
import type { IsoDate, QuarterCode, WhenChoice } from "./types.ts";

export const TIME_ZONE = "Europe/Rome";

/** «Più avanti»: `target_quarter = NULL`. */
export const WHEN_LATER_LABEL = "Più avanti";

export type QuarterNumber = 1 | 2 | 3 | 4;
export interface ParsedQuarter {
  year: number;
  quarter: QuarterNumber;
}

const QUARTER_PATTERN = /^([0-9]{4})-Q([1-4])$/;
const DATE_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

const romeDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// ─── Date ────────────────────────────────────────────────────────────

/** La data di oggi a Roma, `AAAA-MM-GG` (es. `review_by`, `today` di `phaseOfUseCase`). */
export function romeToday(now: Date = new Date()): IsoDate {
  const parts = romeDateFormat.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}` as IsoDate;
}

/** Anno, mese e giorno di una data `AAAA-MM-GG` che esiste nel calendario; altrimenti `null`. */
export function parseIsoDate(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value !== "string") return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return { year, month, day };
}

export function isIsoDate(value: unknown): value is IsoDate {
  return parseIsoDate(value) !== null;
}

// ─── Trimestri ───────────────────────────────────────────────────────

/** Anno e numero di un trimestre `AAAA-Qn`; `null` per ogni altro valore. */
export function parseQuarter(value: unknown): ParsedQuarter | null {
  if (typeof value !== "string") return null;
  const match = QUARTER_PATTERN.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), quarter: Number(match[2]) as QuarterNumber };
}

export function isQuarterCode(value: unknown): value is QuarterCode {
  return parseQuarter(value) !== null;
}

function formatQuarter({ year, quarter }: ParsedQuarter): QuarterCode {
  if (!Number.isInteger(year) || year < 0 || year > 9999) throw new RangeError("Anno del trimestre fuori intervallo");
  return `${String(year).padStart(4, "0")}-Q${quarter}` as QuarterCode;
}

function mustParse(q: string): ParsedQuarter {
  const parsed = parseQuarter(q);
  if (!parsed) throw new RangeError(`Trimestre non valido: ${q}`);
  return parsed;
}

/** Il trimestre di una data `AAAA-MM-GG`. */
export function quarterOfDate(date: string): QuarterCode {
  const parsed = parseIsoDate(date);
  if (!parsed) throw new RangeError(`Data non valida: ${date}`);
  return formatQuarter({ year: parsed.year, quarter: (Math.floor((parsed.month - 1) / 3) + 1) as QuarterNumber });
}

/** Il trimestre di oggi a Roma, es. `2026-Q4`. */
export function currentQuarter(now: Date = new Date()): QuarterCode {
  return quarterOfDate(romeToday(now));
}

/** Il trimestre dopo: `2026-Q4` → `2027-Q1`. */
export function nextQuarter(q: string): QuarterCode {
  const { year, quarter } = mustParse(q);
  return quarter === 4 ? formatQuarter({ year: year + 1, quarter: 1 }) : formatQuarter({ year, quarter: (quarter + 1) as QuarterNumber });
}

/** Negativo se `a` viene prima di `b`, zero se coincidono, positivo se viene dopo. */
export function compareQuarters(a: string, b: string): number {
  const pa = mustParse(a);
  const pb = mustParse(b);
  return pa.year * 4 + pa.quarter - (pb.year * 4 + pb.quarter);
}

/** Vero se il trimestre è già finito a Roma (nella Panoramica: «Scaduto», se non è partito). */
export function isPastQuarter(q: string, now: Date = new Date()): boolean {
  return compareQuarters(q, currentQuarter(now)) < 0;
}

/** Primo giorno del trimestre, es. `2027-Q1` → `2027-01-01` (Rimanda «All'inizio del prossimo trimestre»). */
export function quarterStart(q: string): IsoDate {
  const { year, quarter } = mustParse(q);
  return `${String(year).padStart(4, "0")}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01` as IsoDate;
}

/** «T1 2027». Un valore che non è un trimestre (dato rovinato) torna com'è, senza errori in pagina. */
export function quarterLabel(q: string): string {
  const parsed = parseQuarter(q);
  return parsed ? `T${parsed.quarter} ${String(parsed.year).padStart(4, "0")}` : q;
}

/** «Quando» di uno use case approvato: il trimestre, oppure «Più avanti» se non c'è. */
export function whenLabel(targetQuarter: string | null | undefined): string {
  return targetQuarter ? quarterLabel(targetQuarter) : WHEN_LATER_LABEL;
}

// ─── Scelte di «Quando» ──────────────────────────────────────────────

/** Cosa si salva per una scelta: il trimestre di oggi, quello dopo, oppure `null`. */
export function whenChoiceToQuarter(choice: WhenChoice, now: Date = new Date()): QuarterCode | null {
  switch (choice) {
    case "questo_trimestre":
      return currentQuarter(now);
    case "prossimo_trimestre":
      return nextQuarter(currentQuarter(now));
    case "piu_avanti":
      return null;
  }
}

/** «Questo trimestre (T4 2026)», «Prossimo trimestre (T1 2027)», «Più avanti». */
export function whenChoiceLabel(choice: WhenChoice, now: Date = new Date()): string {
  switch (choice) {
    case "questo_trimestre":
      return `Questo trimestre (${quarterLabel(currentQuarter(now))})`;
    case "prossimo_trimestre":
      return `Prossimo trimestre (${quarterLabel(nextQuarter(currentQuarter(now)))})`;
    case "piu_avanti":
      return WHEN_LATER_LABEL;
  }
}

/**
 * Le due parti di una scelta, per i controlli stretti (pannello, telefono): «Questo trimestre» e
 * «T4 2026»; «Più avanti» senza trimestre. Le stesse parole di `whenChoiceLabel`.
 */
export function whenChoiceParts(choice: WhenChoice, now: Date = new Date()): { title: string; quarter: string | null } {
  switch (choice) {
    case "questo_trimestre":
      return { title: "Questo trimestre", quarter: quarterLabel(currentQuarter(now)) };
    case "prossimo_trimestre":
      return { title: "Prossimo trimestre", quarter: quarterLabel(nextQuarter(currentQuarter(now))) };
    case "piu_avanti":
      return { title: WHEN_LATER_LABEL, quarter: null };
  }
}

/**
 * Una scelta di «Quando» oppure un trimestre esplicito (il MCP del team accetta `2027-Q3`).
 * `{ ok: false }` per ogni altro valore.
 */
export function resolveWhen(
  input: unknown,
  now: Date = new Date(),
): { ok: true; quarter: QuarterCode | null } | { ok: false } {
  if (input === "questo_trimestre" || input === "prossimo_trimestre" || input === "piu_avanti") {
    return { ok: true, quarter: whenChoiceToQuarter(input, now) };
  }
  return isQuarterCode(input) ? { ok: true, quarter: input } : { ok: false };
}
