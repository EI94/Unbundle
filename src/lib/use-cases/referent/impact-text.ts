/**
 * (Rilascio 5.1) Le parole di una riga del passo «L'impatto»: la domanda per ogni voce di «Benefici e
 * costi», le scelte, la risposta in sola lettura, le cifre in italiano. Le usano la pagina del referente,
 * l'anteprima di «Scegli il referente» e il blocco «Referente» della scheda.
 *
 * Quattro forme, una per voce:
 * - **ore**: volte e minuti del team, «Ti torna?» con «Sì» / «È di meno» / «È di più» e due numeri facoltativi;
 * - **ore_numeri**: una voce a ore senza i numeri del team: si chiedono i due numeri;
 * - **euro**: gli euro del team, «Ti torna?» con «Sì» / «È di meno» / «È di più» e una cifra facoltativa;
 * - **fatto**: una voce qualitativa (o in euro senza cifra): «Succede davvero?» con «Sì» / «No» / «Non so».
 *
 * Modulo puro, senza `zod`: lo carica anche la pagina pubblica.
 */
import type { ReferentBenefitAnswer, ReferentBenefitKind } from "../../db/use-case-hub-referent-benefits-ddl.ts";
import { formatCountIt } from "../../uc/views/format.ts";
import { formatDecimalIt, minutesText } from "./estimate.ts";
import { REFERENT_IMPACT_TEXT, fillText } from "./labels.ts";

const T = REFERENT_IMPACT_TEXT;

export type BenefitForm = "ore" | "ore_numeri" | "euro" | "fatto";
export type { ReferentBenefitAnswer, ReferentBenefitKind };

/** La cifra del team su una voce, come la vede il referente (l'istantanea, a due decimali). */
export interface BenefitTeam {
  kind: ReferentBenefitKind;
  /** Solo «ore»: volte l'anno e minuti ogni volta. */
  volumeYear: number | null;
  minutes: number | null;
  /** Solo «euro». */
  eurYear: number | null;
}

/** La forma della riga dalla voce: con i numeri del team, senza, in euro, qualitativa. */
export function benefitFormOf(team: BenefitTeam): BenefitForm {
  // A due decimali, come le colonne: 0,004 € è zero anche per il CHECK della 0027.
  const positive = (n: number | null) => n !== null && Number.isFinite(n) && Math.round(n * 100) > 0;
  if (team.kind === "ore") return positive(team.volumeYear) && positive(team.minutes) ? "ore" : "ore_numeri";
  if (team.kind === "euro") return positive(team.eurYear) ? "euro" : "fatto";
  return "fatto";
}

/** Le scelte di una forma, nell'ordine dei pulsanti (nessuna per «ore_numeri»). */
export function benefitChoices(form: BenefitForm): { answer: ReferentBenefitAnswer; label: string }[] {
  if (form === "ore" || form === "euro") {
    return [
      { answer: "si", label: T.yes },
      { answer: "meno", label: T.less },
      { answer: "piu", label: T.more },
    ];
  }
  if (form === "fatto") {
    return [
      { answer: "si", label: T.yes },
      { answer: "no", label: T.no },
      { answer: "non_so", label: T.dunno },
    ];
  }
  return [];
}

/** Le risposte che una forma accetta (null: nessuna scelta, solo con i due numeri o come bozza). */
export function answersOf(form: BenefitForm): readonly ReferentBenefitAnswer[] {
  return benefitChoices(form).map((c) => c.answer);
}

/** «1 volta», «250 volte». */
function timesText(n: number): string {
  const r = Math.round(n);
  return r === 1 ? "1 volta" : `${formatCountIt(r)} volte`;
}

/** «1.200 €», «meno di 1 €». */
export function euroText(n: number): string {
  if (!Number.isFinite(n) || n < 0.5) return T.euroLess;
  return fillText(T.euroAmount, { n: formatCountIt(n) });
}

/** Il nome della voce senza la punteggiatura finale che la frase aggiunge già. */
function bare(label: string): string {
  return label.replace(/\s+/g, " ").trim().replace(/[\s.:;,]+$/u, "");
}

/** La domanda della riga, in parole semplici. */
export function benefitQuestion(row: { label: string; team: BenefitTeam }): string {
  const form = benefitFormOf(row.team);
  const label = bare(row.label);
  if (form === "ore") {
    const volume = row.team.volumeYear ?? 0;
    const minuti = minutesText(row.team.minutes ?? 0);
    if (volume < 12) return fillText(T.oreYear, { label, volte: timesText(volume), minuti });
    return fillText(T.ore, { label, volte: timesText(volume / 12), minuti });
  }
  if (form === "ore_numeri") return fillText(T.oreNumbers, { label });
  if (form === "euro") return fillText(T.euro, { label, euro: euroText(row.team.eurYear ?? 0) });
  return /[?!]$/u.test(label) ? fillText(T.fattoBare, { label }) : fillText(T.fatto, { label });
}

/** La risposta di una riga, come la scrive la pagina del referente o la bozza salvata. */
export interface BenefitDraft {
  answer: ReferentBenefitAnswer | null;
  timesPerMonth: number | null;
  minutesEach: number | null;
  eurYear: number | null;
}

/** La riga ha una risposta che la chiude, per la sua forma. */
export function benefitAnswered(form: BenefitForm, d: BenefitDraft): boolean {
  if (form === "ore_numeri") return d.timesPerMonth !== null && d.minutesEach !== null;
  return d.answer !== null && answersOf(form).includes(d.answer);
}

/** Un numero com'è scritto in sola lettura: «1,5», «1.200». */
function numberIt(n: number): string {
  return formatDecimalIt(n);
}

/** La risposta in sola lettura, dopo l'invio: «Controllo delle fatture: è di più. 300 volte al mese, 12 minuti ogni volta.» */
export function benefitSentLine(row: { label: string; team: BenefitTeam }, d: BenefitDraft): string {
  const form = benefitFormOf(row.team);
  const label = bare(row.label);
  if (form === "ore_numeri") {
    return fillText(T.sentNumbers, { label, n: d.timesPerMonth !== null ? numberIt(d.timesPerMonth) : "—", m: d.minutesEach !== null ? minutesText(d.minutesEach) : "—" });
  }
  const head =
    d.answer === "meno" ? T.sentLess : d.answer === "piu" ? T.sentMore : d.answer === "no" ? T.sentNo : d.answer === "non_so" ? T.sentDunno : T.sentYes;
  let line = fillText(head, { label });
  if (form === "ore" && (d.timesPerMonth !== null || d.minutesEach !== null)) {
    const perMonth = d.timesPerMonth ?? (row.team.volumeYear ?? 0) / 12;
    const minutes = d.minutesEach ?? row.team.minutes ?? 0;
    line += fillText(T.sentTimesTail, { n: numberIt(perMonth), m: minutesText(minutes) });
  }
  if (form === "euro" && d.eurYear !== null) line += fillText(T.sentEuroTail, { euro: euroText(d.eurYear) });
  return line;
}
