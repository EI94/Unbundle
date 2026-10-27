/**
 * «Prepara le domande» (SPEC §6): aggiunge a «Cosa serve» le domande standard sui dati che mancano
 * alla scheda (quante volte, quanto tempo, quante persone, quali programmi, un esempio di documento,
 * i costi), solo quelle che mancano davvero e solo se non ci sono già. Deterministico, senza AI.
 *
 * Una domanda nasce come requisito «Non ancora chiesta», dalla parte del cliente, «Subito», con la
 * chiave di importazione `referente:<useCaseId>:<chiave>`: una seconda volta non aggiunge niente,
 * e una domanda archiviata non torna (la chiave esiste ancora nel workspace).
 *
 * Modulo puro.
 */
import type { NeedInput, NeedKind, NeedView } from "../needs.ts";
import type { ValueModel } from "../value-model.ts";
import { RUNS_PER_YEAR } from "../views.ts";
import type { PreparedQuestionKey } from "./contract.ts";

export interface PreparedQuestion {
  key: PreparedQuestionKey;
  kind: NeedKind;
  title: string;
  detail: string;
  sortOrder: number;
}

export const PREPARED_QUESTIONS: readonly PreparedQuestion[] = Object.freeze([
  {
    key: "frequenza",
    kind: "dato",
    sortOrder: 100,
    title: "Ogni quanto fate questo lavoro, e quante volte in un anno? Per esempio: 20 fatture al giorno, circa 5.000 all'anno.",
    detail: "Serve per stimare il risparmio di tempo in «Benefici e costi»: quante volte all'anno.",
  },
  {
    key: "tempo",
    kind: "dato",
    sortOrder: 110,
    title: "Quanto tempo serve ogni volta, più o meno? Basta una stima in minuti.",
    detail: "Serve per stimare il risparmio di tempo in «Benefici e costi»: minuti per volta.",
  },
  {
    key: "persone",
    kind: "dato",
    sortOrder: 120,
    title: "Quante persone se ne occupano oggi? Basta il numero, senza nomi.",
    detail: "Serve per capire quante persone ne beneficiano.",
  },
  {
    key: "sistemi",
    kind: "dato",
    sortOrder: 130,
    title: "Quali programmi o sistemi usate per farlo? Per esempio: il gestionale, Excel, la posta elettronica.",
    detail: "Serve per capire a quali sistemi collegarsi e quali accessi chiedere.",
  },
  {
    key: "esempio",
    kind: "documento",
    sortOrder: 140,
    title: "Ci mandi un esempio dei documenti su cui lavorate? Prima togli nomi e dati personali.",
    detail: "Un esempio vero, senza dati personali, aiuta a capire il lavoro e a provare la soluzione.",
  },
  {
    key: "costi",
    kind: "dato",
    sortOrder: 150,
    title: "Oggi questo lavoro costa qualcosa oltre al tempo delle persone? Per esempio servizi esterni o licenze: quanto all'anno, più o meno?",
    detail: "Serve per stimare i costi evitati in «Benefici e costi».",
  },
] satisfies PreparedQuestion[]);

/** `referente:<useCaseId>:<chiave>`, con l'id in minuscolo. */
export function preparedImportKey(useCaseId: string, key: PreparedQuestionKey): string {
  return `referente:${useCaseId.toLowerCase()}:${key}`;
}

export interface PrepareInput {
  useCaseId: string;
  intake: Record<string, unknown> | null;
  valueModel: ValueModel | null;
  linkedNeeds: readonly Pick<NeedView, "kind" | "archivedAt">[];
  existingImportKeys: ReadonlySet<string>;
}

const positive = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v > 0;
const positiveInteger = (v: unknown): boolean => positive(v) && Number.isInteger(v);
const text = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;

/** Le lacune della scheda, nell'ordine di `PREPARED_QUESTIONS` (§6.2). */
export function gapsOf(input: Omit<PrepareInput, "existingImportKeys">): PreparedQuestionKey[] {
  const intake = input.intake ?? {};
  const components = input.valueModel?.components ?? [];
  const hours = components.filter((c) => c.kind === "ore");
  const gaps: PreparedQuestionKey[] = [];
  const frequency = intake.frequency;
  const knownFrequency = typeof frequency === "string" && Object.prototype.hasOwnProperty.call(RUNS_PER_YEAR, frequency);
  if (!hours.some((c) => c.kind === "ore" && c.volumeYear > 0) && !knownFrequency) gaps.push("frequenza");
  if (!hours.some((c) => c.kind === "ore" && c.minutesPerUnit > 0) && !positive(intake.timeSavedMinutesPerRun)) gaps.push("tempo");
  if (!positiveInteger(intake.beneficiaries)) gaps.push("persone");
  const tools = Array.isArray(intake.tools) ? intake.tools.filter((t) => text(t) && t !== "altro") : [];
  if (tools.length === 0 && !text(intake.toolsOther)) gaps.push("sistemi");
  if (!input.linkedNeeds.some((need) => need.kind === "documento" && !need.archivedAt)) gaps.push("esempio");
  const costs = components.some((c) => c.kind === "euro" && c.lever === "costi" && c.eurYear > 0);
  if (!costs && !positive(intake.valuePerRunEur)) gaps.push("costi");
  return gaps;
}

/** Le domande da aggiungere adesso: le lacune meno le chiavi già nel workspace (archiviate comprese). */
export function missingPreparedQuestions(input: PrepareInput): PreparedQuestion[] {
  const gaps = new Set(gapsOf(input));
  return PREPARED_QUESTIONS.filter((q) => gaps.has(q.key) && !input.existingImportKeys.has(preparedImportKey(input.useCaseId, q.key)));
}

/** L'esigenza nuova di una domanda preparata. */
export function preparedNeedInput(q: PreparedQuestion, useCaseId: string): NeedInput {
  return {
    type: "requisito",
    kind: q.kind,
    title: q.title,
    detail: q.detail,
    ownerLabel: null,
    ownerSide: "cliente",
    status: "da_chiedere",
    availability: "subito",
    dueOn: null,
    dueLabel: null,
    dueIsProposal: false,
    forLabel: null,
    sortOrder: q.sortOrder,
    importKey: preparedImportKey(useCaseId, q.key),
  };
}
