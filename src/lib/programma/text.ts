/**
 * I testi della pagina «Programma» (rilascio 7) e del PDF del SAL: un posto solo.
 *
 * Regole (ui-less-is-more, external-copy): poche parole, la cifra prima delle parole, mai «wave» o
 * «ondata» (decisione 2: solo il trimestre), mai «quota», «fee» o «proposta a valore» (la pagina la vede
 * il cliente), mai una persona. «use case» come nel resto della dashboard.
 * Modulo puro: import relativi `.ts`.
 */
import { formatEuro, formatInteger } from "../use-cases/format.ts";
import { quarterLabel } from "../use-cases/quarter.ts";
import { monthLabel, monthLongLabel } from "../use-cases/value-calc.ts";
import type { ProgramStage } from "./curve.ts";
import type { IndexPillar, PillarGap } from "./figures.ts";
import type { NextStep, SalChange } from "./view.ts";

export const PROGRAM_TEXT = Object.freeze({
  title: "Programma",
  subtitle: (company: string) => `A che punto è la trasformazione AI-native di ${company}`,
  exportSal: "Esporta il SAL",
  closeSal: "Chiudi il SAL",
  closeSalHint: "Fotografa i numeri di oggi: il prossimo SAL mostrerà cosa è cambiato da qui.",
  salClosed: (on: string) => `SAL del ${longDate(on)} chiuso.`,
  results: "Risultati",
  estimated: "Valore stimato all'anno",
  inUse: "Valore già in uso",
  perEmployee: "Valore per dipendente",
  index: "Indice AI-native",
  noneInUse: "ancora nessuno",
  firstGoLive: (month: string) => `primo in uso: ${monthLabel(month)}`,
  onUseCases: (n: number) => (n === 1 ? "su 1 use case" : `su ${formatInteger(n)} use case`),
  ofRevenue: (pct: number) => `${formatPct(pct, 1)} del ricavo per dipendente`,
  sinceSal: (on: string) => `dal SAL del ${shortDate(on)}`,
  employeesAsk: (company: string) => `Quante persone lavorano in ${company}?`,
  employeesPlaceholder: "Per esempio 420",
  revenueAsk: "E il ricavo dell'ultimo anno? Facoltativo.",
  revenuePlaceholder: "Per esempio 12 mln",
  save: "Salva",
  skip: "Salta",
  cancel: "Annulla",
  edit: "Modifica",
  employeesMissing: "Manca il numero di dipendenti",
  chart: "Valore e costo, cumulati",
  chartMore: "Scenari e numeri",
  value: "Valore",
  cost: "Costo",
  forecast: "previsione",
  today: "oggi",
  breakeven: "Pareggio",
  programBreakeven: "Pareggio del programma",
  noValueYet: "Ancora nessun valore o costo da disegnare: arrivano con le stime degli use case.",
  perEmployeeLater: "dal primo use case in uso",
  onPillars: (n: number) => `su ${n} pilastri di 4`,
  breakevenNow: "Pareggio subito",
  breakevenBeyond: (month: string) => `Pareggio oltre ${monthLabel(month)}`,
  noBreakeven: "Nessun valore o costo ancora.",
  initiatives: "Iniziative",
  colValue: "Valore all'anno",
  colOneoff: "Costo di avvio",
  colRun: "Mantenimento all'anno",
  stage: Object.freeze({ in_uso: "In uso", in_realizzazione: "In realizzazione", da_avviare: "Da avviare" } satisfies Record<ProgramStage, string>),
  support: "Supporto Lateral Space",
  supportMonth: (eur: number) => `${formatEuro(eur)} al mese`,
  training: "Formazione",
  trainingLine: (people: number, hours: number) => `${people === 1 ? "1 persona" : `${formatInteger(people)} persone`} · ${formatHours(hours)}`,
  review: (n: number) => (n === 1 ? "1 use case in uso da rivedere" : `${formatInteger(n)} use case in uso da rivedere`),
  reviewWhy: "rende meno del doppio di quanto costa tenerlo acceso",
  reviewWhyMany: "rendono meno del doppio di quanto costa tenerli accesi",
  people: "Persone",
  peopleMore: "Livelli e aree",
  trained: (n: number, of: number | null) => (of ? `${formatInteger(n)} formate su ${formatInteger(of)}` : `${formatInteger(n)} ${n === 1 ? "formata" : "formate"}`),
  hoursTraining: (h: number) => `${formatHours(h)} di formazione`,
  weeklyUse: (pct: number) => `${formatPct(pct, 0)} usa l'AI ogni settimana`,
  levelsLabel: "Livello AI delle persone",
  levelLow: "Livello 0 · non la usa",
  levelHigh: "Livello 5 · costruisce con l'AI",
  lessThanFive: "meno di 5",
  levelsHidden: "I livelli si vedono quando le risposte all'AI Readiness superano la soglia del questionario (almeno 5).",
  goals: "Obiettivi",
  goalsMore: "OKR e KPI",
  noGoals: "Nessun risultato chiave ancora.",
  addInStrategy: "Aggiungi nella Strategia",
  chooseKpis: "Scegli i KPI",
  sal: "Per il SAL",
  changedSince: (on: string | null) => (on ? `Cosa è cambiato dal ${longDate(on)}` : "Cosa è cambiato"),
  noSalYet: "Dopo il primo SAL, qui trovi cosa è cambiato.",
  nothingChanged: "Niente di nuovo dai numeri dell'ultimo SAL.",
  nextSteps: "Prossimi passi",
  asks: "Decisioni per la leadership",
  noAsks: "Nessuna decisione da chiedere.",
  addAsk: "Aggiungi una decisione",
  sources: "Valore e costi dagli use case · formazione dal registro · livelli dall'AI Readiness, solo per gruppi di almeno 5 persone.",
  notReady: "«Programma» si sta preparando su questo workspace. Riprova tra qualche minuto.",
  close: "Chiudi",
});

export const PILLAR_TEXT: Readonly<Record<IndexPillar, string>> = Object.freeze({ persone: "Persone", use_case: "Use case", valore: "Valore", adozione: "Adozione" });

export const PILLAR_HOW: Readonly<Record<IndexPillar, string>> = Object.freeze({
  persone: "Persone formate sui dipendenti.",
  use_case: "Avanzamento delle fasi: approvato vale un terzo, in realizzazione due terzi, in uso tutto.",
  valore: "Valore in uso sul valore stimato.",
  adozione: "Chi usa l'AI ogni settimana; senza, il pilastro «Adozione» dell'AI Readiness.",
});

/** I pilastri dell'AI Readiness, in italiano (le chiavi del questionario). */
export const READINESS_PILLAR_TEXT: Readonly<Record<string, string>> = Object.freeze({
  technology: "Tecnologia",
  context: "Contesto",
  workflow: "Processi",
  adoption: "Adozione",
  use_cases: "Use case",
});

export function readinessPillarText(key: string): string {
  return READINESS_PILLAR_TEXT[key] ?? key.replace(/_/g, " ");
}

export const GAP_TEXT: Readonly<Record<PillarGap, string>> = Object.freeze({
  dipendenti: "Non conta: manca il numero di dipendenti.",
  formazione: "Non conta: nessuna formazione registrata.",
  use_case: "Non conta: nessuno use case approvato.",
  valore: "Non conta: nessun valore stimato.",
  adozione: "Non conta: manca l'uso settimanale e l'AI Readiness è sotto soglia.",
});

export const SAL_CHANGE_TEXT: Readonly<Record<SalChange["key"], string>> = Object.freeze({
  valore_stimato: "Valore stimato all'anno",
  valore_in_uso: "Valore già in uso",
  indice_ai_native: "Indice AI-native",
  use_case_in_uso: "Use case in uso",
  use_case_in_realizzazione: "Use case in realizzazione",
  persone_formate: "Persone formate",
  agenti_da_rivedere: "Use case da rivedere",
});

const EURO_KEYS: ReadonlySet<SalChange["key"]> = new Set(["valore_stimato", "valore_in_uso"]);

/** «Valore stimato all'anno: +122.000 €», «Use case in uso: da 0 a 3». */
export function salChangeText(change: SalChange): string {
  const label = SAL_CHANGE_TEXT[change.key];
  if (EURO_KEYS.has(change.key)) return `${label}: ${signedEuro(change.to - change.from)}`;
  return `${label}: da ${formatInteger(Math.round(change.from))} a ${formatInteger(Math.round(change.to))}`;
}

/** Il testo di un prossimo passo. */
export function nextStepText(step: NextStep, company: string): string {
  switch (step.kind) {
    case "dipendenti":
      return `Indicare quante persone lavorano in ${company}`;
    case "decisioni":
      return step.count === 1 ? "Decidere 1 use case in attesa" : `Decidere ${formatInteger(step.count)} use case in attesa`;
    case "avviare":
      return step.count === 1 ? `Avviare 1 use case del ${quarterLabel(step.quarter)}` : `Avviare ${formatInteger(step.count)} use case del ${quarterLabel(step.quarter)}`;
    case "rivedere":
      return `Rivedere ${step.title}`;
    case "primo_sal":
      return "Chiudere il primo SAL";
  }
}

// ─── Formati ─────────────────────────────────────────────────────────

const PCT = (digits: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** «38 %», «0,4 %». */
export function formatPct(n: number, digits = 0): string {
  return `${PCT(digits).format(n)} %`;
}

/** «36 h», «1,5 h». */
export function formatHours(h: number): string {
  return `${PCT(1).format(h)} h`;
}

/** «+122.000 €», «−4.000 €», «0 €». */
export function signedEuro(n: number): string {
  const r = Math.round(n);
  if (r === 0) return "0 €";
  return r > 0 ? `+${formatEuro(r)}` : `−${formatEuro(-r)}`;
}

/** «+5», «−2», «0». */
export function signedInteger(n: number): string {
  const r = Math.round(n);
  if (r === 0) return "0";
  return r > 0 ? `+${formatInteger(r)}` : `−${formatInteger(-r)}`;
}

const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

/** «9 novembre 2026». */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** «9 novembre». */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** «nov 26», «novembre 2026». */
export { monthLabel, monthLongLabel };

/** Un valore di un KPI con la sua unità: «12.400 €», «38 %», «46/100», «3,5 giorni». */
export function kpiValueText(value: number | null, unit: string): string {
  if (value === null) return "—";
  if (unit === "€") return formatEuro(value);
  if (unit === "%") return formatPct(value, 1);
  const n = PCT(Math.abs(value) < 10 ? 1 : 0).format(value);
  if (!unit) return n;
  if (unit.startsWith("/")) return `${n}${unit}`;
  return `${n} ${unit}`;
}
