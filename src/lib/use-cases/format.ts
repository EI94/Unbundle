/**
 * Come si scrivono a schermo cifre, fonti, fasce e date dell'area «Use case»
 * (docs/use-case/DESIGN.md §4.5, §4.6, §6.3, §7.1, §7.2, §14.3, §14.5; PIANO-LAVORI H2d).
 *
 * - **Importi**: «40.000 €», senza decimali, con il punto delle migliaia anche sotto 10.000
 *   (come le etichette delle fasce di `cost-bands.ts`; `Intl.NumberFormat("it-IT")` da solo
 *   non raggruppa le quattro cifre).
 * - **Date**: `it-IT`, fuso `Europe/Rome`: «14 ott», «14 ott 2026», «ott 2026». Mai ISO a
 *   schermo: una data illeggibile dà `null`, e chi chiama non scrive nulla. Un timestamp senza
 *   zona si legge come UTC, mai nel fuso del processo (vedi `toInstant`).
 * - **Fonti** (§7.2, §14.3): corte nella riga, nel pannello e nella card della Roadmap
 *   («team», «AI», «dossier», «stimato»), lunghe nella scheda («importo del team», «fascia
 *   del team», «stimato dall'impegno», «dal dossier»). Mai «da dossier».
 * - **Costo**: una sola forma corta per la riga e per la card della Roadmap («€€ · 40.000 € ·
 *   team», «€€ · fascia · team», «€€€ · fascia · stimato», «da stimare»); la forma lunga
 *   della scheda scrive per una fascia la sua etichetta nelle fasce del workspace (D15), con
 *   l'iniziale minuscola: «€€ · fascia da 25.000 a 65.000 €».
 * - Le funzioni che scrivono l'etichetta di una fascia ricevono le fasce del workspace come
 *   ultimo argomento `bands` (tipo `CostBandInfo` di `cost-bands.ts`), predefinite
 *   `COST_BANDS`. Le fasce del workspace le passano le pagine (H3c, H4a, H4b), che le leggono
 *   con `resolveCostBands`.
 *
 * Lo usano i pezzi comuni di `src/components/use-cases/` sul server e nel browser: le stesse
 * stringhe nei due posti, nessuna differenza all'idratazione.
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import { COST_BANDS, costBandInfo, type CostBandInfo } from "./cost-bands.ts";
import {
  COST_BAND_WORD,
  COST_SOURCE_LABEL,
  NOT_ESTIMATED_LABEL,
  VALUE_EUR_SOURCE_LABEL,
  VALUE_SOURCE_LABEL,
  VALUE_WORD_LABEL,
  type CostSource,
  type ValueEurSource,
  type ValueSource,
  type ValueWord,
} from "./labels.ts";
import { PHASE_TONE } from "./phase.ts";
import type { CostBand, Phase, PhaseTone, SubState } from "./types.ts";

/** Separatore delle parti di una cifra: «€€ · 40.000 € · team». */
export const FIGURE_SEPARATOR = " · ";

// ─── Importi e punteggi ──────────────────────────────────────────────

/** «40.000»: intero, con il punto delle migliaia anche sotto 10.000. */
function groupedInteger(n: number): string {
  const rounded = Math.round(Math.abs(n));
  const digits = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return n < 0 && rounded !== 0 ? `-${digits}` : digits;
}

/**
 * «40.000 €»: un importo in euro, arrotondato all'euro (il ROI del dossier può avere i
 * centesimi). Un valore che non è un numero finito dà «da stimare».
 */
export function formatEuro(amount: number): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return NOT_ESTIMATED_LABEL;
  return `${groupedInteger(amount)} €`;
}

const SCORE = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** «3,8»: un punteggio da 1 a 5 con un decimale. Un valore che non è un numero finito dà «da stimare». */
export function formatScore(score: number): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return NOT_ESTIMATED_LABEL;
  return SCORE.format(score);
}

// ─── Date (§14.5) ────────────────────────────────────────────────────

export const DATE_TIME_ZONE = "Europe/Rome";

const DAY_MONTH = new Intl.DateTimeFormat("it-IT", { timeZone: DATE_TIME_ZONE, day: "numeric", month: "short" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("it-IT", { timeZone: DATE_TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
const MONTH_YEAR = new Intl.DateTimeFormat("it-IT", { timeZone: DATE_TIME_ZONE, month: "short", year: "numeric" });
const YEAR = new Intl.DateTimeFormat("en-CA", { timeZone: DATE_TIME_ZONE, year: "numeric" });

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Data e ora: «AAAA-MM-GG», «T» o spazio, «hh:mm», secondi e frazione facoltativi, poi la zona
 * facoltativa: «Z», «+hh», «+hhmm» o «+hh:mm». Ci sta la forma ISO e quella testuale di
 * Postgres per `timestamptz` («2026-10-14 21:30:00.123456+00»).
 */
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

function isCalendarDay(year: number, month: number, date: number): boolean {
  const day = new Date(Date.UTC(year, month - 1, date, 12));
  return day.getUTCFullYear() === year && day.getUTCMonth() === month - 1 && day.getUTCDate() === date;
}

/** La zona di `TIMESTAMP` nella forma che ogni motore legge: «Z» oppure «+hh:mm». Senza zona: UTC. */
function isoOffset(zone: string | undefined): string {
  if (!zone || zone.toUpperCase() === "Z") return "Z";
  const digits = zone.slice(1).replace(":", "");
  return `${zone[0]}${digits.slice(0, 2)}:${digits.slice(2) || "00"}`;
}

/**
 * Un istante da una data. `AAAA-MM-GG` è un giorno di calendario (`review_by`, il giorno di
 * arrivo): si legge a mezzogiorno UTC, che a Roma è sempre lo stesso giorno. Un timestamp
 * (`TIMESTAMP`) si legge con la sua zona e si mostra nel fuso di Roma. Un timestamp senza zona
 * (una colonna `timestamp` senza fuso, es. `use_cases.created_at`, letta con `db.execute`) si
 * legge come UTC, come fa Drizzle per le stesse colonne: mai nel fuso del processo, così
 * server e browser scrivono lo stesso giorno. Una data che non esiste dà `null`.
 */
function toInstant(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const day = CALENDAR_DAY.exec(text);
  if (day) {
    const [year, month, date] = [Number(day[1]), Number(day[2]), Number(day[3])];
    return isCalendarDay(year, month, date) ? new Date(Date.UTC(year, month - 1, date, 12)) : null;
  }
  // Solo forme con data e ora: niente `Date.parse` su testo libero.
  const stamp = TIMESTAMP.exec(text);
  if (!stamp) return null;
  const [, year, month, date, hours, minutes, seconds = "00", fraction = "", zone] = stamp;
  if (!isCalendarDay(Number(year), Number(month), Number(date))) return null;
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) return null;
  // Al millesimo: oltre, non tutti i motori leggono la frazione.
  const instant = new Date(`${year}-${month}-${date}T${hours}:${minutes}:${seconds}${fraction.slice(0, 4)}${isoOffset(zone)}`);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** «14 ott». */
export function formatDayMonth(value: Date | string | null | undefined): string | null {
  const instant = toInstant(value);
  return instant ? DAY_MONTH.format(instant) : null;
}

/** «14 ott 2026». */
export function formatDate(value: Date | string | null | undefined): string | null {
  const instant = toInstant(value);
  return instant ? DAY_MONTH_YEAR.format(instant) : null;
}

/** «ott 2026» (il mese di «Fatti» nella Roadmap). */
export function formatMonthYear(value: Date | string | null | undefined): string | null {
  const instant = toInstant(value);
  return instant ? MONTH_YEAR.format(instant) : null;
}

/**
 * «14 gen» se la data è nell'anno di `today` (a Roma), «14 gen 2027» altrimenti: la forma
 * delle date nelle righe («Rimandato al 14 gen», «Diffusa il 3 ott.»).
 */
export function formatDayInYear(value: Date | string | null | undefined, today: Date | string = new Date()): string | null {
  const instant = toInstant(value);
  if (!instant) return null;
  const now = toInstant(today);
  const sameYear = now !== null && YEAR.format(instant) === YEAR.format(now);
  return (sameYear ? DAY_MONTH : DAY_MONTH_YEAR).format(instant);
}

// ─── Fase (§3.4) ─────────────────────────────────────────────────────

/**
 * Il tono della pillola dalla fase e dal sotto-stato: «Da rivedere» è giallo, il resto il
 * tono della fase. Serve a chi non riceve il tono già calcolato (il contributore riceve
 * solo fase, sotto-stato e pillola).
 */
export function phaseTone(phase: Phase, subState?: SubState | null): PhaseTone {
  return subState === "da_rivedere" ? "giallo" : PHASE_TONE[phase];
}

// ─── Fonti (§7.1, §7.2, §14.3) ───────────────────────────────────────

/** Forma della fonte: corta nella riga, nel pannello e nella card; lunga nella scheda. */
export type SourceForm = "corta" | "lunga";

/** La fonte del costo: «team», «dossier», «stimato»; per esteso «importo del team», «fascia del team», «stimato dall'impegno», «dal dossier». */
export function costSourceText(source: CostSource, form: SourceForm): string {
  const label = COST_SOURCE_LABEL[source];
  return form === "lunga" ? label.long : label.short;
}

/** La fonte del punteggio del Valore: «team» o «AI», nelle due forme. */
export function valueSourceText(source: ValueSource): string {
  return VALUE_SOURCE_LABEL[source];
}

/** La fonte degli euro all'anno: «dossier» o «team»; per esteso «dal dossier» o «team». */
export function valueEurSourceText(source: ValueEurSource, form: SourceForm): string {
  const label = VALUE_EUR_SOURCE_LABEL[source];
  return form === "lunga" ? label.long : label.short;
}

// ─── Valore (§7.1) ───────────────────────────────────────────────────

/** Le parti del Valore che servono qui: tipo strutturale, `ValueFigure` di `valuation.ts` è assegnabile. */
export interface ValueParts {
  score: number | null;
  word: ValueWord | null;
  source: ValueSource | null;
  perYear: { amount: number; source: ValueEurSource } | null;
}

/** «Alto», «Medio», «Basso»; senza punteggio «da stimare». La forma della riga e della card. */
export function valueWordText(value: Pick<ValueParts, "word"> | null | undefined): string {
  return value?.word ? VALUE_WORD_LABEL[value.word] : NOT_ESTIMATED_LABEL;
}

/** «Alto · 3,8»: la cifra grande della scheda; senza punteggio «da stimare». */
export function valueLongText(value: Pick<ValueParts, "word" | "score"> | null | undefined): string {
  if (!value?.word || typeof value.score !== "number" || !Number.isFinite(value.score)) return NOT_ESTIMATED_LABEL;
  return `${VALUE_WORD_LABEL[value.word]}${FIGURE_SEPARATOR}${formatScore(value.score)}`;
}

/** «60.000 € all'anno»; `null` senza una cifra. */
export function perYearText(perYear: ValueParts["perYear"] | null | undefined): string | null {
  if (!perYear || !Number.isFinite(perYear.amount)) return null;
  return `${formatEuro(perYear.amount)} all'anno`;
}

// ─── Fasce (§5.4, §7.2, D15) ─────────────────────────────────────────

/** La fascia nelle fasce del workspace (predefinite `COST_BANDS`). */
function bandInfo(band: CostBand, bands: readonly CostBandInfo[] = COST_BANDS): CostBandInfo {
  return costBandInfo(band, bands.length === 5 ? bands : COST_BANDS);
}

/** «€€»: il simbolo di una fascia. I simboli non cambiano con le fasce del workspace. */
export function costBandSymbol(band: CostBand, bands: readonly CostBandInfo[] = COST_BANDS): string {
  return bandInfo(band, bands).symbol;
}

/** «Da 25.000 a 65.000 €»: l'etichetta della scelta nel campo costo, nelle fasce del workspace. */
export function costBandLabel(band: CostBand, bands: readonly CostBandInfo[] = COST_BANDS): string {
  return bandInfo(band, bands).label;
}

/**
 * L'iniziale minuscola, per l'etichetta dentro una frase: «Da 25.000 a 65.000 €» →
 * «da 25.000 a 65.000 €». Una sigla in testa resta com'è («SAP minore»).
 */
export function lowerFirst(text: string): string {
  const first = text.split(/\s/, 1)[0] ?? "";
  const letters = first.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return text;
  return text.charAt(0).toLocaleLowerCase("it-IT") + text.slice(1);
}

/** «fascia da 25.000 a 65.000 €»: la fascia per esteso, con l'etichetta delle fasce del workspace. */
export function costBandLongText(band: CostBand, bands: readonly CostBandInfo[] = COST_BANDS): string {
  return `${COST_BAND_WORD} ${lowerFirst(costBandLabel(band, bands))}`;
}

// ─── Costo di realizzazione (§7.2) ───────────────────────────────────

/**
 * Le parti del costo che servono qui: tipo strutturale, `CostFigure` di `valuation.ts` è
 * assegnabile. `bandLabel`, se c'è, è già l'etichetta nelle fasce del workspace.
 */
export interface CostParts {
  source: CostSource;
  amount: number | null;
  band: CostBand;
  bandLabel?: string;
  fromBand: boolean;
}

/** Il costo a schermo in due parti: la cifra e la sua fonte. Senza costo: «da stimare», nessuna fonte. */
export interface CostTextParts {
  figure: string;
  source: string | null;
  /** Vero per «da stimare». */
  estimated: boolean;
}

/** L'etichetta della fascia del costo: quella scritta da `costFigure`, altrimenti quella di `bands`. */
function costBandLabelOf(cost: CostParts, bands: readonly CostBandInfo[]): string {
  return typeof cost.bandLabel === "string" && cost.bandLabel.trim() ? cost.bandLabel : costBandLabel(cost.band, bands);
}

/**
 * Le parti del costo nella forma `form`:
 * - corta (riga, pannello, card della Roadmap): «€€ · 40.000 €» oppure «€€ · fascia», fonte
 *   «team», «dossier», «stimato»;
 * - lunga (scheda): «€€ · 40.000 €» oppure «€€ · fascia da 25.000 a 65.000 €», fonte
 *   «importo del team», «fascia del team», «stimato dall'impegno», «dal dossier».
 */
export function costTextParts(cost: CostParts | null | undefined, form: SourceForm, bands: readonly CostBandInfo[] = COST_BANDS): CostTextParts {
  if (!cost) return { figure: NOT_ESTIMATED_LABEL, source: null, estimated: true };
  const symbol = costBandSymbol(cost.band, bands);
  let detail: string;
  if (!cost.fromBand && typeof cost.amount === "number" && Number.isFinite(cost.amount)) detail = formatEuro(cost.amount);
  else detail = form === "lunga" ? `${COST_BAND_WORD} ${lowerFirst(costBandLabelOf(cost, bands))}` : COST_BAND_WORD;
  return { figure: `${symbol}${FIGURE_SEPARATOR}${detail}`, source: costSourceText(cost.source, form), estimated: false };
}

/**
 * La forma corta del costo, una sola per la riga e per la card della Roadmap (§4.5, §4.6,
 * §7.2): «€€ · 40.000 € · team», «€€ · fascia · team», «€€€ · fascia · stimato»,
 * «€ · 18.500 € · dossier», «da stimare».
 */
export function costShortText(cost: CostParts | null | undefined, bands: readonly CostBandInfo[] = COST_BANDS): string {
  const parts = costTextParts(cost, "corta", bands);
  return parts.source ? `${parts.figure}${FIGURE_SEPARATOR}${parts.source}` : parts.figure;
}

/** La cifra del costo nella scheda (§6.3): «€€ · 40.000 €», «€€ · fascia da 25.000 a 65.000 €», «da stimare». La fonte va accanto, per esteso. */
export function costLongText(cost: CostParts | null | undefined, bands: readonly CostBandInfo[] = COST_BANDS): string {
  return costTextParts(cost, "lunga", bands).figure;
}
