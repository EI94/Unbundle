/**
 * (Rilascio 5.1) L'impatto che il referente conferma o corregge: una riga per ogni voce di «Benefici e
 * costi», nell'ordine del modello (da 1 a 6).
 *
 * - **Le righe** (`impactRowsOf`): chiave, posizione, tipo, il nome che il referente legge (quello della
 *   voce se passa il filtro della descrizione e dei titoli, altrimenti il tipo di ritorno: «Più qualità»,
 *   «Meno costi», …) e l'istantanea della cifra del team: volte l'anno e minuti per «ore», euro l'anno per
 *   «euro», niente per «qualitativo». Mai quota che si risparmia, ore liberate, fiducia, fonte, punteggi.
 *   Senza modello, o con un modello senza voci, null: resta la stima del tempo del rilascio 5.
 * - **La risposta** (`benefitAnswerOf`): i controlli di quello che la pagina manda per una riga.
 * - **La revisione del team** (`benefitNeedsReview`, `BENEFIT_REVIEW_SQL`): il referente dice «È di
 *   meno», «È di più» o «No», oppure scrive i due numeri che il team non aveva (`benefitDiffers`), oppure
 *   (decisione del titolare del 04/11/2026) «Non so» su una voce in ore o in euro (`benefitUnknown`), e il
 *   team non ha ancora deciso.
 * - **L'adozione** (`benefitAdoptionPatch`): «Usa la stima di {Nome}» cambia solo i numeri di quella voce.
 *
 * Modulo puro.
 */
import { LEVER_LABELS } from "../value-model.ts";
import { REFERENT_BENEFIT_LIMITS, type ReferentBenefitAnswer, type ReferentBenefitKind, type ReferentBenefitOutcome } from "../../db/use-case-hub-referent-benefits-ddl.ts";
import { checkQuestionTitle } from "./text.ts";
import { shortTextIsShown } from "./description.ts";
import { referentNumber } from "./estimate.ts";
import { answersOf, benefitAnswered, benefitFormOf, type BenefitDraft, type BenefitForm, type BenefitTeam } from "./impact-text.ts";

export type { BenefitDraft, BenefitForm, BenefitTeam };

/** Una riga del passo «L'impatto», come la calcola il server dal modello di adesso. */
export interface ImpactRow {
  key: string;
  /** Da 1, nell'ordine del modello. */
  position: number;
  form: BenefitForm;
  /** Il nome che il referente legge. */
  label: string;
  /** L'istantanea della cifra del team (torna come `seen`). */
  team: BenefitTeam;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? round2(v) : null);

function shownLabel(text: unknown): string | null {
  const clean = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  return clean && shortTextIsShown(clean) && checkQuestionTitle(clean).ok ? clean.slice(0, REFERENT_BENEFIT_LIMITS.label) : null;
}

const KINDS = new Set<ReferentBenefitKind>(["ore", "euro", "qualitativo"]);

/** La cifra del team di una voce, a due decimali come nelle colonne. */
function teamOf(kind: ReferentBenefitKind, c: Record<string, unknown>): BenefitTeam {
  if (kind === "ore") return { kind, volumeYear: finite(c.volumeYear) ?? 0, minutes: finite(c.minutesPerUnit) ?? 0, eurYear: null };
  if (kind === "euro") return { kind, volumeYear: null, minutes: null, eurYear: finite(c.eurYear) ?? 0 };
  return { kind, volumeYear: null, minutes: null, eurYear: null };
}

/** Le righe del passo «L'impatto» per un modello del valore; null senza voci. */
export function impactRowsOf(model: unknown): ImpactRow[] | null {
  const components = model && typeof model === "object" && Array.isArray((model as { components?: unknown }).components) ? ((model as { components: unknown[] }).components as unknown[]) : [];
  const rows: ImpactRow[] = [];
  const seen = new Set<string>();
  for (const raw of components) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const kind = c.kind as ReferentBenefitKind;
    const key = typeof c.key === "string" ? c.key : "";
    if (!KINDS.has(kind) || !key || key.length > REFERENT_BENEFIT_LIMITS.key || seen.has(key)) continue;
    seen.add(key);
    const team = teamOf(kind, c);
    const lever = typeof c.lever === "string" && Object.prototype.hasOwnProperty.call(LEVER_LABELS, c.lever) ? LEVER_LABELS[c.lever as keyof typeof LEVER_LABELS] : null;
    const label = shownLabel(c.label) ?? lever ?? LEVER_LABELS.tempo;
    rows.push({ key, position: rows.length + 1, form: benefitFormOf(team), label, team });
    if (rows.length === REFERENT_BENEFIT_LIMITS.components) break;
  }
  return rows.length ? rows : null;
}

/** La riga con quella chiave, se la voce c'è ancora. */
export function impactRowByKey(model: unknown, key: string): ImpactRow | null {
  return impactRowsOf(model)?.find((r) => r.key === key) ?? null;
}

/** La cifra che il referente ha visto è ancora quella di adesso (tipo e numeri, a due decimali). */
export function sameBenefitTeam(a: BenefitTeam | null, b: BenefitTeam | null): boolean {
  if (a === null || b === null) return a === null && b === null;
  const eq = (x: number | null, y: number | null) => (x === null ? y === null : y !== null && round2(x) === round2(y));
  return a.kind === b.kind && eq(a.volumeYear, b.volumeYear) && eq(a.minutes, b.minutes) && eq(a.eurYear, b.eurYear);
}

/** `seen` dal corpo della richiesta: la cifra che la pagina mostrava, oppure null se non è valida. */
export function benefitTeamFromBody(value: unknown): BenefitTeam | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!KINDS.has(v.kind as ReferentBenefitKind)) return null;
  const num = (x: unknown): number | null | "x" => (x === null || x === undefined ? null : typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : "x");
  const volumeYear = num(v.volumeYear);
  const minutes = num(v.minutes);
  const eurYear = num(v.eurYear);
  if (volumeYear === "x" || minutes === "x" || eurYear === "x") return null;
  return { kind: v.kind as ReferentBenefitKind, volumeYear, minutes, eurYear };
}

export type BenefitAnswerCheck = { ok: true; value: BenefitDraft } | { ok: false; code: "dati_non_validi" | "numero_non_valido" };

/**
 * Quello che la pagina manda per una riga, per la sua forma: la scelta (o nessuna, come bozza), i numeri
 * solo con «È di meno» / «È di più» (o i due numeri senza la cifra del team), mai numeri con «Sì», «No» o
 * «Non so» («Non so» vale su ogni forma, anche al posto dei due numeri).
 */
export function benefitAnswerOf(form: BenefitForm, body: { answer?: unknown; timesPerMonth?: unknown; minutesEach?: unknown; eurYear?: unknown }): BenefitAnswerCheck {
  const raw = body.answer === undefined ? null : body.answer;
  if (raw !== null && (typeof raw !== "string" || !answersOf(form).includes(raw as ReferentBenefitAnswer))) return { ok: false, code: "dati_non_validi" };
  const answer = raw as ReferentBenefitAnswer | null;
  const times = referentNumber(body.timesPerMonth, REFERENT_BENEFIT_LIMITS.timesPerMonthMax);
  const minutes = referentNumber(body.minutesEach, REFERENT_BENEFIT_LIMITS.minutesEachMax);
  const euro = referentNumber(body.eurYear, REFERENT_BENEFIT_LIMITS.eurYearMax);
  if (!times.ok || !minutes.ok || !euro.ok) return { ok: false, code: "numero_non_valido" };
  const different = answer === "meno" || answer === "piu";
  if (form === "ore_numeri") {
    if (answer === "non_so") return { ok: true, value: { answer, timesPerMonth: null, minutesEach: null, eurYear: null } };
    return { ok: true, value: { answer: null, timesPerMonth: times.value, minutesEach: minutes.value, eurYear: null } };
  }
  if (form === "ore") return { ok: true, value: { answer, timesPerMonth: different ? times.value : null, minutesEach: different ? minutes.value : null, eurYear: null } };
  if (form === "euro") return { ok: true, value: { answer, timesPerMonth: null, minutesEach: null, eurYear: different ? euro.value : null } };
  return { ok: true, value: { answer, timesPerMonth: null, minutesEach: null, eurYear: null } };
}

/** Una risposta per beneficio come è salvata (la bozza o quella inviata). */
export interface StoredBenefit extends BenefitDraft {
  key: string;
  position: number;
  label: string;
  team: BenefitTeam;
  comment: string | null;
  outcome: ReferentBenefitOutcome | null;
  outcomeAt: Date | null;
}

/** Un numero di una colonna numeric (testo dal driver locale, numero da Neon), oppure null. */
function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? n : null;
}
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : value === null || value === undefined ? null : String(value));
const date = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Una riga di `use_case_referent_check_benefits` letta dal database, come risposta per beneficio. */
export function storedBenefitOf(b: Readonly<Record<string, unknown>>): StoredBenefit {
  const kind: ReferentBenefitKind = b.kind === "euro" ? "euro" : b.kind === "ore" ? "ore" : "qualitativo";
  const answer = text(b.answer);
  const outcome = text(b.outcome);
  return {
    key: String(b.component_key),
    position: numeric(b.position) ?? 0,
    label: text(b.label) ?? "",
    team: { kind, volumeYear: numeric(b.team_volume_year), minutes: numeric(b.team_minutes), eurYear: numeric(b.team_eur_year) },
    answer: answer === "si" || answer === "meno" || answer === "piu" || answer === "no" || answer === "non_so" ? answer : null,
    timesPerMonth: numeric(b.times_per_month),
    minutesEach: numeric(b.minutes_each),
    eurYear: numeric(b.eur_year),
    comment: text(b.comment),
    outcome: outcome === "adottata" || outcome === "tenuta" ? outcome : null,
    outcomeAt: date(b.outcome_at),
  };
}

/** La riga salvata chiude la voce, per la sua istantanea. */
export function storedBenefitAnswered(b: Pick<StoredBenefit, "team" | "answer" | "timesPerMonth" | "minutesEach" | "eurYear">): boolean {
  return benefitAnswered(benefitFormOf(b.team), b);
}

type ReviewFacts = Pick<StoredBenefit, "team" | "answer" | "timesPerMonth" | "minutesEach" | "eurYear" | "outcome">;

/**
 * La risposta è diversa da quella del team: «È di meno», «È di più» o «No», oppure i due numeri su una voce
 * senza i numeri del team; e il team non ha ancora deciso.
 */
export function benefitDiffers(b: ReviewFacts): boolean {
  if (b.outcome !== null || !storedBenefitAnswered(b)) return false;
  if (b.answer === "non_so") return false;
  if (benefitFormOf(b.team) === "ore_numeri") return true;
  return b.answer === "meno" || b.answer === "piu" || b.answer === "no";
}

/**
 * (Decisione del titolare del 04/11/2026) Il referente non sa la cifra di una voce in ore o in euro («Non
 * so», anche al posto dei due numeri) e il team non ha ancora deciso: la stima resta da guardare. «Non so» su
 * una voce senza cifra (qualitativa, o in euro senza cifra) non chiede niente, come «Sì».
 */
export function benefitUnknown(b: ReviewFacts): boolean {
  return b.outcome === null && b.answer === "non_so" && benefitFormOf(b.team) !== "fatto";
}

/** La risposta aspetta il team: diversa dalla sua (`benefitDiffers`) o «Non so» su una sua cifra (`benefitUnknown`). «Sì» non chiede niente. */
export function benefitNeedsReview(b: ReviewFacts): boolean {
  return benefitDiffers(b) || benefitUnknown(b);
}

/**
 * La conferma ha davvero le risposte per beneficio, in SQL su una riga `alias` di
 * `use_case_referent_checks`: `benefits` e nessuna colonna della stima del tempo del rilascio 5. Il 5.1
 * svuota sempre quelle colonne quando scrive una voce; dopo un ritorno indietro il codice di prima le
 * scrive (la sua stima, poi «Invia») senza toccare `benefits`: allora l'ultima risposta è la sua, e la
 * conferma si legge come nel rilascio 5 (RUNBOOK §10.10). Ogni lettore di `benefits` passa da qui.
 */
export const BENEFITS_FLAG_SQL = (alias: string) =>
  `(${alias}.benefits AND ${alias}.team_component_key IS NULL AND ${alias}.estimate IS NULL AND ${alias}.times_per_month IS NULL AND ${alias}.minutes_each IS NULL)`;

/** `benefitDiffers` in SQL, su una riga `alias` di `use_case_referent_check_benefits`. */
export const BENEFIT_DIFFERS_SQL = (alias: string) =>
  `(${alias}.outcome IS NULL AND (${alias}.answer IN ('meno', 'piu', 'no') OR (${alias}.answer IS NULL AND ${alias}.times_per_month IS NOT NULL AND ${alias}.minutes_each IS NOT NULL)))`;

/** `benefitUnknown` in SQL: «Non so» su una voce in ore, o in euro con la cifra del team (le colonne hanno due decimali, come `benefitFormOf`). */
export const BENEFIT_UNKNOWN_SQL = (alias: string) =>
  `(${alias}.outcome IS NULL AND ${alias}.answer = 'non_so' AND (${alias}.kind = 'ore' OR (${alias}.kind = 'euro' AND ${alias}.team_eur_year > 0)))`;

/** `benefitNeedsReview` in SQL. */
export const BENEFIT_REVIEW_SQL = (alias: string) => `(${BENEFIT_DIFFERS_SQL(alias)} OR ${BENEFIT_UNKNOWN_SQL(alias)})`;

/** Quello che «Usa la stima di {Nome}» cambia nella voce: solo i numeri dati; vuoto se non c'è niente da usare. */
export function benefitAdoptionPatch(b: Pick<StoredBenefit, "team" | "answer" | "timesPerMonth" | "minutesEach" | "eurYear">): { volumeYear?: number; minutesPerUnit?: number; eurYear?: number } {
  const form = benefitFormOf(b.team);
  const out: { volumeYear?: number; minutesPerUnit?: number; eurYear?: number } = {};
  if (form === "ore_numeri") {
    if (b.timesPerMonth !== null && b.minutesEach !== null) {
      out.volumeYear = round2(b.timesPerMonth * 12);
      out.minutesPerUnit = b.minutesEach;
    }
    return out;
  }
  if (b.answer !== "meno" && b.answer !== "piu") return out;
  if (form === "ore") {
    if (b.timesPerMonth !== null) out.volumeYear = round2(b.timesPerMonth * 12);
    if (b.minutesEach !== null) out.minutesPerUnit = b.minutesEach;
  }
  if (form === "euro" && b.eurYear !== null) out.eurYear = b.eurYear;
  return out;
}

/** La cifra del team dopo «Usa la stima di {Nome}»: l'istantanea con i numeri del referente. */
export function adoptedTeamOf(b: Pick<StoredBenefit, "team" | "answer" | "timesPerMonth" | "minutesEach" | "eurYear">): BenefitTeam {
  const p = benefitAdoptionPatch(b);
  return {
    kind: b.team.kind,
    volumeYear: p.volumeYear ?? b.team.volumeYear,
    minutes: p.minutesPerUnit ?? b.team.minutes,
    eurYear: p.eurYear ?? b.team.eurYear,
  };
}
