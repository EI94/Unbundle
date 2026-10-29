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
 * - **Fonti** (§7.2, §14.3): corte nella riga, nel pannello e nelle card della Panoramica
 *   («team», «AI», «dossier», «stimato»), lunghe nella scheda («importo del team», «fascia
 *   del team», «stimato dall'impegno», «dal dossier»). Mai «da dossier».
 * - **Costo**: una sola forma corta per la riga, il pannello e la matrice («€€ · 40.000 € ·
 *   team», «€€ · fascia · team», «€€€ · fascia · stimato», «da stimare»); la forma lunga
 *   della scheda scrive per una fascia la sua etichetta nelle fasce del workspace (D15), con
 *   l'iniziale minuscola: «€€ · fascia da 25.000 a 65.000 €». Le card della Panoramica scrivono
 *   solo l'avvio: «avvio 30.000 € · team», «avvio €€ · fascia · team» (`startCostParts`).
 * - Le funzioni che scrivono l'etichetta di una fascia ricevono le fasce del workspace come
 *   ultimo argomento `bands` (tipo `CostBandInfo` di `cost-bands.ts`), predefinite
 *   `COST_BANDS`. Le fasce del workspace le passano le pagine (H3c, H4a, H4b), che le leggono
 *   con `resolveCostBands`.
 * - **Valore a schermo**: con una cifra in euro la pagina scrive solo la cifra, senza parola,
 *   punteggio né zona (`valueScreenText`, `valueScreenLongText`, `showsZone`); senza beneficio
 *   contato («qualitativo») nemmeno la zona; il MCP del team e l'export tengono la parola e la zona.
 *
 * Lo usano i pezzi comuni di `src/components/use-cases/` sul server e nel browser: le stesse
 * stringhe nei due posti, nessuna differenza all'idratazione.
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import { COST_BANDS, costBandInfo, type CostBandInfo } from "./cost-bands.ts";
import {
  COST_BAND_WORD,
  COST_ONEOFF_WORD,
  COST_RUN_WORD,
  COST_SOURCE_LABEL,
  NOT_ESTIMATED_LABEL,
  PER_YEAR_SHORT_SUFFIX,
  UP_TO_WORD,
  VALUE_EUR_SOURCE_LABEL,
  VALUE_MODEL_STATE_LABEL,
  VALUE_SOURCE_LABEL,
  VALUE_WORD_LABEL,
  ZONE_LABEL,
  type CostSource,
  type Zone,
  type ValueEurSource,
  type ValueSource,
  type ValueWord,
} from "./labels.ts";
import { PHASE_TONE } from "./phase.ts";
import type { CostBand, Phase, PhaseTone, SubState } from "./types.ts";

/** Separatore delle parti di una cifra: «€€ · 40.000 € · team». */
export const FIGURE_SEPARATOR = " · ";

// ─── Importi e punteggi ──────────────────────────────────────────────

/**
 * Arrotondato all'intero, la metà in su lontano dallo zero, con una tolleranza di 1e-9: una coda
 * di virgola mobile (2.183,4999999999995 dove il conto esatto dà 2.183,5) non sposta la cifra.
 * Nessun altro arrotondamento prima: 1.234,497 resta 1.234 e 2,4951 resta 2.
 */
export function roundAmount(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n) + 1e-9);
}

/** «40.000»: intero, con il punto delle migliaia anche sotto 10.000. */
function groupedInteger(n: number): string {
  const rounded = roundAmount(Math.abs(n));
  const digits = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return n < 0 && rounded !== 0 ? `-${digits}` : digits;
}

/** «1.250»: un numero intero (ore, volte), con il punto delle migliaia. */
export function formatInteger(n: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return NOT_ESTIMATED_LABEL;
  return groupedInteger(n);
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

/** «ott 2026» (il mese di «Realizzati» nella Panoramica). */
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

/**
 * Le parti del Valore che servono qui: tipo strutturale, `ValueFigure` di `valuation.ts` è
 * assegnabile. `benefits` c'è solo con «Benefici e costi» (`value_model`).
 */
export interface ValueParts {
  score: number | null;
  word: ValueWord | null;
  source: ValueSource | null;
  perYear: { amount: number; source: ValueEurSource } | null;
  benefits?: {
    state: "contato" | "da_misurare" | "qualitativo";
    benefitEur: number;
    pendingEur: number;
    hours: number;
  } | null;
}

/** «4.043 €/anno»: un importo all'anno nella forma corta. */
export function perYearShortText(amount: number): string {
  return `${formatEuro(amount)}${PER_YEAR_SHORT_SUFFIX}`;
}

/** «da misurare · fino a 5.840 €» oppure «qualitativo»: un modello senza beneficio contato. */
function uncountedText(benefits: NonNullable<ValueParts["benefits"]>): string {
  if (benefits.state === "da_misurare") return `${VALUE_MODEL_STATE_LABEL.da_misurare}${FIGURE_SEPARATOR}${UP_TO_WORD} ${formatEuro(benefits.pendingEur)}`;
  return VALUE_MODEL_STATE_LABEL.qualitativo;
}

/**
 * C'è qualcosa da scrivere per il Valore? Una parola, «Benefici e costi» o gli euro all'anno.
 * Senza, la cifra è «da stimare».
 */
export function hasValueText(value: Pick<ValueParts, "word" | "perYear" | "benefits"> | null | undefined): boolean {
  return Boolean(value?.word || value?.benefits || (value?.perYear && Number.isFinite(value.perYear.amount)));
}

/**
 * «Alto», «Medio», «Basso»; con un modello senza beneficio contato «qualitativo» o «da
 * misurare»; senza punteggio «da stimare». La parola sola, per il MCP del team e l'export
 * (etichette); la pagina usa `valueScreenText` e `valueScreenLongText`, che con una cifra in euro
 * non scrivono la parola.
 */
export function valueWordText(value: Pick<ValueParts, "word" | "benefits"> | null | undefined): string {
  if (value?.word) return VALUE_WORD_LABEL[value.word];
  if (value?.benefits && value.benefits.state !== "contato") return VALUE_MODEL_STATE_LABEL[value.benefits.state];
  return NOT_ESTIMATED_LABEL;
}

/**
 * La forma corta del Valore con la parola, per il MCP del team e l'export:
 * - con «Benefici e costi»: «Medio · 4.043 €/anno», «da misurare · fino a 5.840 €», «qualitativo»;
 * - senza: «Alto»; senza parola ma con gli euro all'anno «12.250 € all'anno»; altrimenti «da stimare».
 * Riga, pannello e card della Panoramica usano `valueScreenText`: con una cifra in euro solo la cifra.
 */
export function valueShortText(value: Pick<ValueParts, "word" | "perYear" | "benefits"> | null | undefined): string {
  const benefits = value?.benefits;
  if (benefits) {
    if (benefits.state !== "contato" || !value.word) return uncountedText(benefits);
    const amount = value.perYear && Number.isFinite(value.perYear.amount) ? value.perYear.amount : benefits.benefitEur;
    return `${VALUE_WORD_LABEL[value.word]}${FIGURE_SEPARATOR}${perYearShortText(amount)}`;
  }
  if (value?.word) return VALUE_WORD_LABEL[value.word];
  return perYearText(value?.perYear) ?? NOT_ESTIMATED_LABEL;
}

/**
 * «Alto · 3,8»: la forma lunga con la parola e il punteggio, per il MCP del team e l'export; con un
 * modello senza beneficio contato «da misurare · fino a 5.840 €» o «qualitativo»; senza punteggio
 * «da stimare». La cifra grande della scheda è `valueScreenLongText`: con gli euro all'anno solo
 * la cifra.
 */
export function valueLongText(value: Pick<ValueParts, "word" | "score" | "benefits"> | null | undefined): string {
  if (value?.benefits && (value.benefits.state !== "contato" || !value.word)) return uncountedText(value.benefits);
  if (!value?.word || typeof value.score !== "number" || !Number.isFinite(value.score)) return NOT_ESTIMATED_LABEL;
  return `${VALUE_WORD_LABEL[value.word]}${FIGURE_SEPARATOR}${formatScore(value.score)}`;
}

/** La zona di una scheda con «Benefici e costi» ma senza beneficio contato: non è «da stimare». */
export const NO_COUNTED_BENEFIT_LABEL = "senza beneficio contato";

/**
 * La zona a parole (§7.4): «Subito», «Se avanza tempo»…; senza zona «da stimare», oppure, per una
 * scheda con «Benefici e costi» che non ha un beneficio contato (Valore «qualitativo» o «da
 * misurare»), «senza beneficio contato»: la stessa cosa che dice il Valore. La forma che va con
 * la parola del Valore, per il MCP del team e l'export; la pagina la scrive solo se `showsZone`.
 */
export function zoneText(zone: Zone | null, value: Pick<ValueParts, "benefits"> | null | undefined): string {
  if (zone) return ZONE_LABEL[zone];
  if (value?.benefits && value.benefits.state !== "contato") return NO_COUNTED_BENEFIT_LABEL;
  return NOT_ESTIMATED_LABEL;
}

/** «60.000 € all'anno»; `null` senza una cifra. Basta l'importo: i gruppi «Per agente» sommano euro di fonti diverse. */
export function perYearText(perYear: Pick<NonNullable<ValueParts["perYear"]>, "amount"> | null | undefined): string | null {
  if (!perYear || !Number.isFinite(perYear.amount)) return null;
  return `${formatEuro(perYear.amount)} all'anno`;
}

// ─── Valore a schermo (rilascio «Pulizia») ───────────────────────────

/** Gli euro all'anno da scrivere a schermo: una cifra finita e maggiore di zero, altrimenti null (0 € non è una cifra: resta la parola). */
export function shownPerYear(value: Pick<ValueParts, "perYear"> | null | undefined): ValueParts["perYear"] {
  const perYear = value?.perYear;
  return perYear && Number.isFinite(perYear.amount) && perYear.amount > 0 ? perYear : null;
}

/**
 * Gli euro all'anno come li scrive la card: `shownPerYear` arrotondato all'euro (`roundAmount`, come
 * `formatEuro`); null senza una cifra a schermo. Le somme della Panoramica sommano questi.
 */
export function shownPerYearEur(value: Pick<ValueParts, "perYear"> | null | undefined): number | null {
  const perYear = shownPerYear(value);
  return perYear ? roundAmount(perYear.amount) : null;
}

/** Il Valore ha una cifra in euro: gli euro all'anno, oppure il tetto «da misurare · fino a X €» di «Benefici e costi». */
export function hasEuroValue(value: Pick<ValueParts, "perYear" | "benefits"> | null | undefined): boolean {
  return shownPerYear(value) !== null || (value?.benefits?.state === "da_misurare" && value.benefits.pendingEur > 0);
}

/**
 * La zona si scrive a schermo solo per un Valore senza cifra in euro e non «senza beneficio
 * contato»: per un modello «qualitativo» o «da misurare» la zona ripeterebbe quello che dice già il
 * Valore. La matrice la disegna sempre; il MCP del team e l'export tengono `zoneText`.
 */
export function showsZone(value: Pick<ValueParts, "perYear" | "benefits"> | null | undefined): boolean {
  if (hasEuroValue(value)) return false;
  return !(value?.benefits && value.benefits.state !== "contato");
}

/** La forma corta a schermo: con gli euro all'anno solo la cifra, «12.250 €/anno»; altrimenti `valueShortText` («da misurare · fino a 5.840 €», «Alto», «qualitativo», «da stimare»). */
export function valueScreenText(value: Pick<ValueParts, "word" | "perYear" | "benefits"> | null | undefined): string {
  const perYear = shownPerYear(value);
  return perYear ? perYearShortText(perYear.amount) : valueShortText(value);
}

/** La cifra grande della scheda: con gli euro all'anno «12.250 € all'anno», senza parola né punteggio; altrimenti `valueLongText`. */
export function valueScreenLongText(value: Pick<ValueParts, "word" | "score" | "perYear" | "benefits"> | null | undefined): string {
  const perYear = shownPerYear(value);
  return (perYear && perYearText(perYear)) || valueLongText(value);
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
  /** Solo per la fonte «stima»: i costi ricorrenti, euro all'anno. */
  runEurYear?: number | null;
}

/** «116 ore»: le ore liberate all'anno (grafici di «Benefici e costi»). */
export function hoursFreedText(hours: number): string {
  return `${formatInteger(hours)} ${roundAmount(hours) === 1 ? "ora" : "ore"}`;
}

/** «(1 qualitativo)», «(3 qualitativi)»: le voci qualitative di un tipo di ritorno. */
export function qualitativeCountText(count: number): string {
  return count === 1 ? "(1 qualitativo)" : `(${count} qualitativi)`;
}

/**
 * «avvio 560 €» e «ricorrenti 600 €/anno», le due parti che a schermo non si spezzano; i ricorrenti
 * a zero non si scrivono (solo «avvio 280 €»).
 */
export function oneoffRunParts(oneoffEur: number, runEurYear: number | null | undefined): string[] {
  const oneoff = `${COST_ONEOFF_WORD} ${formatEuro(oneoffEur)}`;
  return typeof runEurYear === "number" && Number.isFinite(runEurYear) && runEurYear > 0 ? [oneoff, `${COST_RUN_WORD} ${perYearShortText(runEurYear)}`] : [oneoff];
}

/** «avvio 560 € · ricorrenti 600 €/anno»; i ricorrenti a zero non si scrivono («avvio 280 €»). */
export function oneoffRunText(oneoffEur: number, runEurYear: number | null | undefined): string {
  return oneoffRunParts(oneoffEur, runEurYear).join(FIGURE_SEPARATOR);
}

/** Il costo a schermo in due parti: la cifra e la sua fonte. Senza costo: «da stimare», nessuna fonte. */
export interface CostTextParts {
  figure: string;
  /**
   * La cifra nei pezzi che non vanno spezzati: con «Benefici e costi» «avvio 560 €» e «ricorrenti
   * 600 €/anno» (uniti da « · » fanno `figure`), altrimenti la cifra intera.
   */
  figureParts: string[];
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
 * - corta (riga, pannello, matrice): «€€ · 40.000 €» oppure «€€ · fascia», fonte
 *   «team», «dossier», «stimato»; con «Benefici e costi» «avvio 560 € · ricorrenti 600 €/anno»,
 *   senza fonte (`source` null);
 * - lunga (scheda): «€€ · 40.000 €» oppure «€€ · fascia da 25.000 a 65.000 €», fonte
 *   «importo del team», «fascia del team», «stimato dall'impegno», «dal dossier».
 */
export function costTextParts(cost: CostParts | null | undefined, form: SourceForm, bands: readonly CostBandInfo[] = COST_BANDS): CostTextParts {
  if (!cost) return { figure: NOT_ESTIMATED_LABEL, figureParts: [NOT_ESTIMATED_LABEL], source: null, estimated: true };
  // «Benefici e costi»: avvio e ricorrenti, senza simbolo della fascia (la fascia resta per zone e
  // matrice). Nella forma corta senza fonte, come la spec la scrive: la cifra è già lunga, e «stima
  // del team» la dice la scheda.
  if (cost.source === "stima" && typeof cost.amount === "number" && Number.isFinite(cost.amount)) {
    const figureParts = oneoffRunParts(cost.amount, cost.runEurYear);
    return { figure: figureParts.join(FIGURE_SEPARATOR), figureParts, source: form === "lunga" ? costSourceText(cost.source, form) : null, estimated: false };
  }
  const symbol = costBandSymbol(cost.band, bands);
  let detail: string;
  if (!cost.fromBand && typeof cost.amount === "number" && Number.isFinite(cost.amount)) detail = formatEuro(cost.amount);
  else detail = form === "lunga" ? `${COST_BAND_WORD} ${lowerFirst(costBandLabelOf(cost, bands))}` : COST_BAND_WORD;
  const figure = `${symbol}${FIGURE_SEPARATOR}${detail}`;
  return { figure, figureParts: [figure], source: costSourceText(cost.source, form), estimated: false };
}

/**
 * La forma corta del costo, una sola per la riga, la matrice e il MCP del team (§4.6, §7.2):
 * «€€ · 40.000 € · team», «€€ · fascia · team», «€€€ · fascia · stimato»,
 * «€ · 18.500 € · dossier», «da stimare». Le card della Panoramica scrivono solo l'avvio
 * (`startCostParts`).
 */
export function costShortText(cost: CostParts | null | undefined, bands: readonly CostBandInfo[] = COST_BANDS): string {
  const parts = costTextParts(cost, "corta", bands);
  return parts.source ? `${parts.figure}${FIGURE_SEPARATOR}${parts.source}` : parts.figure;
}

/**
 * Il costo d'avvio nelle card della Panoramica (rilascio «Panoramica»), con la fonte corta a parte:
 * - un importo (dossier, «Benefici e costi», importo del team): «avvio 700 €», «avvio 30.000 €»,
 *   fonte «dossier» o «team»; per «Benefici e costi» nessuna fonte, come nella forma corta (la dice
 *   la scheda);
 * - una fascia (del team o dall'impegno): «avvio €€ · fascia», fonte «team» o «stimato».
 * Senza costo null: la card non scrive «da stimare», lo dice il pannello.
 */
export function startCostParts(cost: CostParts | null | undefined, bands: readonly CostBandInfo[] = COST_BANDS): { figure: string; source: string | null } | null {
  if (!cost) return null;
  if (!cost.fromBand && typeof cost.amount === "number" && Number.isFinite(cost.amount)) {
    return { figure: `${COST_ONEOFF_WORD} ${formatEuro(cost.amount)}`, source: cost.source === "stima" ? null : costSourceText(cost.source, "corta") };
  }
  return { figure: `${COST_ONEOFF_WORD} ${costBandSymbol(cost.band, bands)}${FIGURE_SEPARATOR}${COST_BAND_WORD}`, source: costSourceText(cost.source, "corta") };
}

/** La cifra del costo nella scheda (§6.3): «€€ · 40.000 €», «€€ · fascia da 25.000 a 65.000 €», «da stimare». La fonte va accanto, per esteso. */
export function costLongText(cost: CostParts | null | undefined, bands: readonly CostBandInfo[] = COST_BANDS): string {
  return costTextParts(cost, "lunga", bands).figure;
}
