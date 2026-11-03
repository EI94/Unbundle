/**
 * «Referente in un tocco» (rilascio 5, SPEC §3.3, D6–D8, D10, D47, D53): la stima del team che il
 * referente conferma o corregge, sempre in ore di lavoro.
 *
 * - **La stima del team**: la voce «ore» del modello con più ore di lavoro (volte l'anno × minuti), la
 *   prima a parità, solo con volte e minuti maggiori di zero; altrimenti nessuna stima del team.
 * - **Cosa vede il referente**: le ore di lavoro l'anno, le volte al mese (o l'anno, sotto le 12), i
 *   minuti ogni volta, che cosa si conta e (con più voci «ore») il nome della voce, se passano il filtro
 *   della descrizione. Mai euro, quota che si risparmia, ore liberate, fiducia, fonte, punteggi.
 * - **I numeri del referente**: facoltativi con «È di meno» / «È di più», tutti e due senza una stima
 *   del team; le ore del referente usano i numeri del team per quello che non ha dato.
 * - **Freschezza**: l'istantanea (chiave, volte, minuti, a due decimali) si confronta con la stima di
 *   adesso quando il passo «Il tempo» si salva, e quando il team usa la stima del referente.
 *
 * Modulo puro.
 */
import { REFERENT_CHECK_LIMITS } from "../../db/use-case-hub-referent-check-ddl.ts";
import { formatCountIt } from "../../uc/views/format.ts";
import { checkQuestionTitle } from "./text.ts";
import { shortTextIsShown } from "./description.ts";
import { REFERENT_ESTIMATE_TEXT, fillText } from "./labels.ts";

const T = REFERENT_ESTIMATE_TEXT;

/** Una voce «ore» del modello, quanto basta (il modello completo sta in `value-model.ts`). */
interface HoursComponent {
  kind: "ore";
  key: string;
  label?: string;
  unit?: string;
  volumeYear: number;
  minutesPerUnit: number;
}

function hoursComponentsOf(model: unknown): HoursComponent[] {
  const components = model && typeof model === "object" && Array.isArray((model as { components?: unknown }).components) ? ((model as { components: unknown[] }).components as unknown[]) : [];
  return components.filter(
    (c): c is HoursComponent =>
      !!c && typeof c === "object" && (c as { kind?: unknown }).kind === "ore" && typeof (c as { key?: unknown }).key === "string" && Number.isFinite((c as { volumeYear?: unknown }).volumeYear) && Number.isFinite((c as { minutesPerUnit?: unknown }).minutesPerUnit),
  );
}

/** La stima del team come la vede il referente (§3.3). */
export interface TeamEstimate {
  /** La chiave della voce: torna al server come `teamSeen`. */
  key: string;
  volumeYear: number;
  minutes: number;
  /** Ore di lavoro l'anno, arrotondate. */
  hours: number;
  /** Volte al mese, arrotondate; null sotto le 12 volte l'anno. */
  perMonth: number | null;
  /** Volte l'anno, arrotondate, solo sotto le 12. */
  perYear: number | null;
  /** Che cosa si conta, se passa i controlli. */
  unit: string | null;
  /** Il nome della voce, solo con più voci «ore» e se passa i controlli. */
  label: string | null;
}

const shown = (text: string | undefined): string | null => {
  const clean = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  return clean && shortTextIsShown(clean) && checkQuestionTitle(clean).ok ? clean : null;
};

/** La stima del team di un modello del valore (D7, D8), oppure null. */
export function teamEstimateOf(model: unknown): TeamEstimate | null {
  const all = hoursComponentsOf(model);
  let best: HoursComponent | null = null;
  for (const c of all) {
    if (!(c.volumeYear > 0 && c.minutesPerUnit > 0)) continue;
    if (!best || c.volumeYear * c.minutesPerUnit > best.volumeYear * best.minutesPerUnit) best = c;
  }
  if (!best) return null;
  const small = best.volumeYear < 12;
  return {
    key: best.key,
    volumeYear: best.volumeYear,
    minutes: best.minutesPerUnit,
    hours: Math.round((best.volumeYear * best.minutesPerUnit) / 60),
    perMonth: small ? null : Math.round(best.volumeYear / 12),
    perYear: small ? Math.round(best.volumeYear) : null,
    unit: shown(best.unit),
    label: all.length > 1 ? shown(best.label) : null,
  };
}

/** La voce «ore» con quella chiave, se c'è ancora (per l'adozione). */
export function hoursComponentByKey(model: unknown, key: string): HoursComponent | null {
  return hoursComponentsOf(model).find((c) => c.key === key) ?? null;
}

// ─── Numeri in italiano ──────────────────────────────────────────────

const DECIMAL = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1, useGrouping: "always" });

/** «12», «1,5», «1.200»: al massimo un decimale, con la virgola. */
export function formatDecimalIt(n: number): string {
  return DECIMAL.format(Number.isFinite(n) ? n : 0);
}

/** «600 ore di lavoro l'anno», «1 ora di lavoro l'anno», «meno di un'ora di lavoro l'anno». */
export function hoursText(hours: number): string {
  const h = Math.round(Number.isFinite(hours) ? hours : 0);
  if (h < 1) return T.hoursLess;
  if (h === 1) return T.hoursOne;
  return fillText(T.hoursMany, { n: formatCountIt(h) });
}

/** «12 minuti», «1 minuto», «1,5 minuti». */
export function minutesText(minutes: number): string {
  return minutes === 1 ? T.minutesOne : fillText(T.minutesMany, { n: formatDecimalIt(minutes) });
}

/** «Il team stima 600 ore di lavoro l'anno: ti torna?» */
export function teamEstimateQuestion(t: Pick<TeamEstimate, "hours">): string {
  return fillText(T.question, { ore: hoursText(t.hours) });
}

/** «Il team stima 600 ore di lavoro l'anno.» */
export function teamEstimateStatement(t: Pick<TeamEstimate, "hours">): string {
  return fillText(T.statement, { ore: hoursText(t.hours) });
}

/** «Circa 292 fatture al mese, 12 minuti ogni volta.» (sotto le 12 volte l'anno: «… l'anno, …»). */
export function teamEstimateDetail(t: Pick<TeamEstimate, "perMonth" | "perYear" | "unit" | "minutes">): string {
  const unita = t.unit ?? T.defaultUnit;
  const minuti = minutesText(t.minutes);
  if (t.perMonth === null) return fillText(T.perYear, { n: formatCountIt(t.perYear ?? 0), unita, minuti });
  return fillText(T.perMonth, { n: formatCountIt(t.perMonth), unita, minuti });
}

/**
 * Un numero scritto da una persona: «20», «1,5», «1.200», «1.200,5», «  20 ». Non negativo, al massimo
 * due decimali; null per tutto il resto (anche il vuoto).
 */
export function parseItalianNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 && Math.round(raw * 100) === raw * 100 ? raw : null;
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, "");
  if (!s) return null;
  let normal: string | null = null;
  if (s.includes(",")) {
    const m = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/.exec(s);
    if (m) normal = `${m[1].replace(/\./g, "")}.${m[2]}`;
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) normal = s.replace(/\./g, "");
  else if (/^\d+(?:\.\d{1,2})?$/.test(s)) normal = s;
  if (normal === null) return null;
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Il numero scritto, se è valido e dentro il limite. */
export function referentNumber(raw: unknown, max: number): { ok: true; value: number | null } | { ok: false } {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return { ok: true, value: null };
  const n = parseItalianNumber(raw);
  if (n === null || n > max) return { ok: false };
  return { ok: true, value: n };
}

export const REFERENT_NUMBER_MAX = Object.freeze({ timesPerMonth: REFERENT_CHECK_LIMITS.timesPerMonthMax, minutesEach: REFERENT_CHECK_LIMITS.minutesEachMax });

// ─── Le ore del referente, la freschezza, l'adozione ─────────────────

/** L'istantanea della stima del team (chiave, volte, minuti a due decimali, come nella colonna numeric). */
export interface TeamSnapshot {
  key: string;
  volumeYear: number;
  minutes: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function teamSnapshotOf(t: Pick<TeamEstimate, "key" | "volumeYear" | "minutes"> | null): TeamSnapshot | null {
  return t ? { key: t.key, volumeYear: round2(t.volumeYear), minutes: round2(t.minutes) } : null;
}

/** La stima che il referente ha visto è ancora quella di adesso (chiave, volte, minuti; null con null). */
export function sameTeamEstimate(a: Pick<TeamSnapshot, "key" | "volumeYear" | "minutes"> | null, b: Pick<TeamSnapshot, "key" | "volumeYear" | "minutes"> | null): boolean {
  if (a === null || b === null) return a === null && b === null;
  return a.key === b.key && round2(a.volumeYear) === round2(b.volumeYear) && round2(a.minutes) === round2(b.minutes);
}

/**
 * Le ore di lavoro l'anno del referente: (volte al mese o quelle del team) × 12 × (minuti o quelli del
 * team) / 60, sull'istantanea. null quando manca un numero e non c'è la stima del team.
 */
export function referentHours(snapshot: Pick<TeamSnapshot, "volumeYear" | "minutes"> | null, numbers: { timesPerMonth: number | null; minutesEach: number | null }): number | null {
  const perMonth = numbers.timesPerMonth ?? (snapshot ? snapshot.volumeYear / 12 : null);
  const minutes = numbers.minutesEach ?? (snapshot ? snapshot.minutes : null);
  if (perMonth === null || minutes === null) return null;
  return (perMonth * 12 * minutes) / 60;
}

/** Quello che «Usa la stima di {Nome}» cambia nella voce: solo i numeri dati (D10). */
export function adoptionPatch(numbers: { timesPerMonth: number | null; minutesEach: number | null }): { volumeYear?: number; minutesPerUnit?: number } {
  const out: { volumeYear?: number; minutesPerUnit?: number } = {};
  if (numbers.timesPerMonth !== null) out.volumeYear = round2(numbers.timesPerMonth * 12);
  if (numbers.minutesEach !== null) out.minutesPerUnit = numbers.minutesEach;
  return out;
}
