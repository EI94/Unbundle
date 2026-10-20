/**
 * Date, orari e fusi (PIANO §3.9): tipi `data` e `data_ora`.
 *
 * - `data`: gg/mm/aaaa (anche con «-» o «.»), ISO `YYYY-MM-DD` o «3 marzo 2025»;
 *   la data deve esistere. Finestra con `config.min_date`/`max_date`
 *   (`'today'` = oggi a Roma: una data di estrazione non sta nel futuro).
 * - `data_ora`: `{local, tz}` → `{utc}`. Fuso IANA (default Europe/Rome,
 *   `config.tz`, oppure UTC se l'unità del template è «UTC»). Un'ora che non
 *   esiste per il passaggio all'ora legale è un errore; un'ora ripetuta al
 *   ritorno all'ora solare prende la prima occorrenza, con un avviso.
 *   Un orario senza data vale come orario locale ricorrente.
 *
 * Tutto con `Intl.DateTimeFormat`, senza dipendenze. Modulo puro.
 */
import { failed, issue, parsed, type Issue, type Parsed } from "./issues.ts";
import { cleanText, deaccent, isPlainObject, nonEmptyString } from "./strings.ts";
import { outcome, type NormalizeContext, type Outcome, type ResponseConfig } from "./types.ts";

export const DEFAULT_TZ = "Europe/Rome";

const MONTHS: Readonly<Record<string, number>> = {
  gennaio: 1, gen: 1,
  febbraio: 2, feb: 2,
  marzo: 3, mar: 3,
  aprile: 4, apr: 4,
  maggio: 5, mag: 5,
  giugno: 6, giu: 6,
  luglio: 7, lug: 7,
  agosto: 8, ago: 8,
  settembre: 9, set: 9, sett: 9,
  ottobre: 10, ott: 10,
  novembre: 11, nov: 11,
  dicembre: 12, dic: 12,
};

const WEEKDAY_PREFIX = /^(?:lun(?:edi)?|mar(?:tedi)?|mer(?:coledi)?|gio(?:vedi)?|ven(?:erdi)?|sab(?:ato)?|dom(?:enica)?)\.?,?\s+/;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

export function isoDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Vero se `YYYY-MM-DD` è una data esistente. */
export function isIsoDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

const DATE_MESSAGE = "Scrivi la data come gg/mm/aaaa, per esempio 30/09/2025.";

function checkDate(y: number, mo: number, d: number, field?: string): Parsed<string> {
  if (y < 1900 || y > 2100) return failed(issue("anno_non_valido", "Controlla l'anno.", field));
  if (mo < 1 || mo > 12) return failed(issue("data_inesistente", "Il mese va da 1 a 12.", field));
  if (d < 1 || d > daysInMonth(y, mo)) return failed(issue("data_inesistente", "Questa data non esiste nel calendario.", field));
  return parsed(isoDate(y, mo, d));
}

function readYear(text: string, warnings: Issue[], field?: string): number {
  if (text.length === 2) {
    warnings.push(issue("anno_a_due_cifre", "Ho letto l'anno a due cifre come anno dal 2000 in poi: controlla che sia giusto.", field));
    return 2000 + Number(text);
  }
  return Number(text);
}

/** Legge una data e la restituisce come `YYYY-MM-DD`. */
export function parseDateIt(input: unknown, field?: string): Parsed<string> {
  if (typeof input !== "string") return failed(issue("data_non_valida", DATE_MESSAGE, field));
  const text = deaccent(cleanText(input)).toLowerCase().replace(WEEKDAY_PREFIX, "");
  if (text === "") return failed(issue("data_mancante", "Scrivi la data.", field));
  const warnings: Issue[] = [];
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return withWarnings(checkDate(Number(m[1]), Number(m[2]), Number(m[3]), field), warnings);
  m = /^(\d{1,2})\s*([/.-])\s*(\d{1,2})\s*\2\s*(\d{4}|\d{2})$/.exec(text);
  if (m) {
    const y = readYear(m[4], warnings, field);
    return withWarnings(checkDate(y, Number(m[3]), Number(m[1]), field), warnings);
  }
  m = /^(\d{1,2})\s*(?:°|º)?\s+([a-z]+)\.?\s+(\d{4})$/.exec(text);
  if (m && MONTHS[m[2]] !== undefined) {
    return withWarnings(checkDate(Number(m[3]), MONTHS[m[2]], Number(m[1]), field), warnings);
  }
  return failed(issue("data_non_valida", DATE_MESSAGE, field), warnings);
}

function withWarnings<T>(p: Parsed<T>, warnings: Issue[]): Parsed<T> {
  return p.ok ? { ...p, warnings: [...warnings, ...p.warnings] } : { ...p, warnings: [...warnings, ...p.warnings] };
}

/** Giorno e mese senza anno («01/05», «1 maggio») come `MM-DD`. */
export function parseDayMonth(input: unknown, field?: string): Parsed<string> {
  if (typeof input !== "string") return failed(issue("data_non_valida", "Scrivi giorno e mese, per esempio 01/05.", field));
  const text = deaccent(cleanText(input)).toLowerCase();
  let day: number | null = null;
  let month: number | null = null;
  let m = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})$/.exec(text);
  if (m) [day, month] = [Number(m[1]), Number(m[2])];
  m = /^(\d{1,2})\s*(?:°|º)?\s+([a-z]+)\.?$/.exec(text);
  if (m && MONTHS[m[2]] !== undefined) [day, month] = [Number(m[1]), MONTHS[m[2]]];
  if (day === null || month === null) return failed(issue("data_non_valida", "Scrivi giorno e mese, per esempio 01/05.", field));
  // Anno bisestile: il 29/02 è ammesso come ricorrenza.
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(2024, month)) {
    return failed(issue("data_inesistente", "Questo giorno non esiste nel calendario.", field));
  }
  return parsed(`${pad(month)}-${pad(day)}`);
}

/** Orario «23:30», «23.30», «23h30», «ore 23», «h 7» → `HH:mm`. */
export function parseTimeIt(input: unknown, field?: string): Parsed<string> {
  const message = "Scrivi l'orario come hh:mm, per esempio 23:30.";
  if (typeof input !== "string") return failed(issue("orario_non_valido", message, field));
  const text = cleanText(input).toLowerCase().replace(/^(?:ore|h|alle|dalle)\s+/, "");
  const m = /^(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?(?:\s*(?:locali|local))?$/.exec(text);
  if (!m) return failed(issue("orario_non_valido", message, field));
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (h > 23 || min > 59) return failed(issue("orario_non_valido", "Le ore vanno da 00 a 23 e i minuti da 00 a 59.", field));
  return parsed(`${pad(h)}:${pad(min)}`);
}

/** `YYYY-MM-DD` di oggi nel fuso indicato (default Europe/Rome). */
export function romeToday(now: Date, tz: string = DEFAULT_TZ): string {
  const p = zonedParts(tz, now.getTime());
  return isoDate(p.year, p.month, p.day);
}

export function isValidTimeZone(tz: string): boolean {
  if (typeof tz !== "string" || tz === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    FORMATTERS.set(tz, f);
  }
  return f;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(tz: string, utcMs: number): ZonedParts {
  const out: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** Differenza in minuti tra l'ora locale del fuso e UTC in quell'istante. */
export function tzOffsetMinutes(tz: string, utcMs: number): number {
  const floored = Math.floor(utcMs / 1000) * 1000;
  const p = zonedParts(tz, floored);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wall - floored) / 60000);
}

/**
 * Istanti UTC che corrispondono a un'ora locale: 0 (ora inesistente), 1, oppure
 * 2 (ora ripetuta), in ordine di tempo.
 */
export function localToUtcCandidates(local: { year: number; month: number; day: number; hour: number; minute: number }, tz: string): number[] {
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const offsets = new Set([tzOffsetMinutes(tz, wall - 86_400_000), tzOffsetMinutes(tz, wall), tzOffsetMinutes(tz, wall + 86_400_000)]);
  const out = new Set<number>();
  for (const offset of offsets) {
    const utc = wall - offset * 60_000;
    if (tzOffsetMinutes(tz, utc) === offset) out.add(utc);
  }
  return [...out].sort((a, b) => a - b);
}

function resolveDateLimit(limit: unknown, today: string): string | null {
  if (limit === "today") return today;
  return typeof limit === "string" && isIsoDate(limit) ? limit : null;
}

function formatIt(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Controlla la finestra ammessa per una data. */
export function dateWindowIssues(iso: string, config: ResponseConfig, today: string, field?: string): Issue[] {
  const out: Issue[] = [];
  const min = resolveDateLimit(config.min_date, today);
  const max = resolveDateLimit(config.max_date, today);
  if (max !== null && iso > max) {
    out.push(
      config.max_date === "today"
        ? issue("data_futura", "La data non può essere nel futuro.", field)
        : issue("data_troppo_tardi", `La data non può essere dopo il ${formatIt(max)}.`, field),
    );
  }
  if (min !== null && iso < min) {
    out.push(
      config.min_date === "today"
        ? issue("data_passata", "La data non può essere nel passato.", field)
        : issue("data_troppo_presto", `La data non può essere prima del ${formatIt(min)}.`, field),
    );
  }
  return out;
}

/** Tipo `data`: valore e normalizzato `YYYY-MM-DD`. */
export function normalizeData(raw: unknown, config: ResponseConfig, ctx: Pick<NormalizeContext, "today">): Outcome {
  const input = isPlainObject(raw) ? raw.value ?? raw.date : raw;
  const p = parseDateIt(input);
  if (!p.ok) return outcome({ value: null, errors: p.errors, warnings: p.warnings });
  const errors = dateWindowIssues(p.value, config, ctx.today);
  return outcome({ value: p.value, normalized: errors.length === 0 ? p.value : null, errors, warnings: p.warnings });
}

/** Fuso della voce: `config.tz`, «UTC» dall'unità del template, altrimenti quello del contesto. */
export function itemTimeZone(config: ResponseConfig, fallback: string = DEFAULT_TZ): string {
  if (typeof config.tz === "string" && config.tz !== "") return config.tz;
  if (typeof config.unit === "string" && /^\s*utc\s*$/i.test(config.unit)) return "UTC";
  return fallback;
}

const DATE_TIME = /^(.+?)(?:\s*,\s*|\s+(?:alle\s+|ore\s+|h\s+)?|T)(\d{1,2}[:.h]\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/** Tipo `data_ora`: `{local, tz}` → `{utc}`, oppure `{local_time, tz}` per un orario ricorrente. */
export function normalizeDataOra(raw: unknown, config: ResponseConfig, ctx: Pick<NormalizeContext, "today" | "tz">): Outcome {
  const warnings: Issue[] = [];
  let tz = itemTimeZone(config, ctx.tz);
  let dateText: string | null = null;
  let timeText: string | null = null;
  let explicitOffset: string | null = null;

  if (isPlainObject(raw)) {
    const objTz = nonEmptyString(raw.tz);
    if (objTz) tz = objTz;
    if (typeof raw.local === "string") {
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(cleanText(raw.local));
      if (m) [dateText, timeText] = [m[1], m[2]];
      else return outcome({ value: null, errors: [issue("data_ora_non_valida", "Scrivi data e ora, per esempio 30/09/2025 23:30.", "local")] });
    } else {
      dateText = nonEmptyString(raw.date);
      timeText = nonEmptyString(raw.time) ?? nonEmptyString(raw.local_time);
    }
  } else if (typeof raw === "string") {
    const text = cleanText(raw);
    const m = DATE_TIME.exec(text);
    if (m) [dateText, timeText, explicitOffset] = [m[1], m[2], m[3] ?? null];
    else if (parseTimeIt(text).ok) timeText = text;
    else dateText = text;
  }

  if (!isValidTimeZone(tz)) {
    return outcome({ value: null, errors: [issue("fuso_non_valido", "Il fuso orario non è valido.", "tz")] });
  }
  if (timeText === null) {
    return outcome({ value: null, errors: [issue("orario_mancante", "Scrivi anche l'orario, per esempio 23:30.", "time")] });
  }
  const time = parseTimeIt(timeText, "time");
  if (!time.ok) return outcome({ value: null, errors: time.errors });

  if (dateText === null) {
    if (config.time_only !== true) {
      warnings.push(issue("solo_orario", "Orario senza data: vale come orario locale ricorrente.", "time"));
    }
    const value = { local_time: time.value, tz };
    return outcome({ value, normalized: value, warnings });
  }
  if (config.time_only === true) {
    warnings.push(issue("data_ignorata", "Qui serve solo l'orario: la data non si salva.", "date"));
    const value = { local_time: time.value, tz };
    return outcome({ value, normalized: value, warnings });
  }

  const date = parseDateIt(dateText, "date");
  if (!date.ok) return outcome({ value: null, errors: date.errors, warnings: date.warnings });
  warnings.push(...date.warnings);
  let local = `${date.value}T${time.value}`;
  const [y, mo, d] = date.value.split("-").map(Number);
  const [h, mi] = time.value.split(":").map(Number);

  let utcMs: number;
  if (explicitOffset !== null) {
    const sign = explicitOffset.toUpperCase() === "Z" ? 0 : explicitOffset.startsWith("-") ? -1 : 1;
    const digits = explicitOffset.replace(/[^0-9]/g, "");
    const offset = sign === 0 ? 0 : sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
    utcMs = Date.UTC(y, mo - 1, d, h, mi) - offset * 60_000;
    if (sign === 0) tz = "UTC";
    // L'ora locale si ricalcola nel fuso della voce: lo scostamento scritto vince.
    const p = zonedParts(tz, utcMs);
    local = `${isoDate(p.year, p.month, p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
  } else {
    const candidates = localToUtcCandidates({ year: y, month: mo, day: d, hour: h, minute: mi }, tz);
    if (candidates.length === 0) {
      return outcome({
        value: { local, tz },
        errors: [issue("ora_inesistente", "Quest'ora non esiste: quel giorno si passa all'ora legale. Controlla l'orario.", "time")],
        warnings,
      });
    }
    if (candidates.length > 1) {
      warnings.push(issue("ora_ambigua", "Quest'ora si ripete per il ritorno all'ora solare: vale la prima volta.", "time"));
    }
    utcMs = candidates[0];
  }
  const errors = dateWindowIssues(date.value, config, ctx.today, "date");
  return outcome({
    value: { local, tz },
    normalized: errors.length === 0 ? { utc: new Date(utcMs).toISOString(), tz } : null,
    errors,
    warnings,
  });
}
