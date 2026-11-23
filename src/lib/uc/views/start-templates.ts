/**
 * Lo schema di partenza di «Avvia la realizzazione» (R2 di
 * `docs/dossier/SCHEMA-DI-PARTENZA.md`): quali schemi si propongono, in che
 * ordine, quale è scelto all'apertura, la riga «per che tipo di caso · N
 * domande» di ognuno e la domanda di conferma per gli schemi grandi.
 *
 * - «Dal caso d'uso» viene sempre per primo ed è quello scelto all'apertura:
 *   le sue domande sono le voci di «Cosa serve» dello use case (le conta chi
 *   chiama), non quelle della definizione.
 * - Uno schema riservato al workspace non è mai scelto all'apertura: senza
 *   «Dal caso d'uso» non è scelto nessuno, e si sceglie a mano.
 * - Regola di proposta degli schemi di settore, prudente: **nel dubbio non si
 *   propone**. Uno schema si propone solo se ha un'area di funzione
 *   (`function_area`) e **ogni** sua parola significativa compare nel titolo,
 *   nel problema o nel flusso dello use case. Le parole si confrontano in
 *   minuscolo e senza accenti; sono significative quelle di almeno 4 lettere
 *   che non sono parole vuote («della», «per», «ogni»…). Una parola compare se
 *   c'è uguale oppure con la stessa radice, cioè la parola senza le vocali
 *   finali, di almeno 3 lettere: «turno» e «turni», «equipaggio» ed
 *   «equipaggi», mai «regole» e «regolamento». Senza area di funzione, o con
 *   un'area senza parole significative, lo schema non si propone mai. Settore
 *   (`industry`) e archetipo non bastano: sono troppo larghi (un caso di vendita
 *   di un cliente del trasporto aereo non è un caso di turni).
 * - Gli schemi che non si propongono restano dietro «Mostra anche gli altri
 *   schemi», nello stesso ordine: riservati prima, poi per nome.
 * - Oltre `LARGE_TEMPLATE_QUESTIONS` domande, prima di avviare si chiede
 *   conferma («Questo schema porta N domande: è quello giusto per questo
 *   caso?»).
 *
 * Modulo puro e senza dipendenze di Node: lo usano la pagina, il modulo client
 * e i test.
 */
import { formatCountIt } from "./format.ts";

/** Oltre queste domande si chiede conferma prima di avviare. */
export const LARGE_TEMPLATE_QUESTIONS = 50;

/** Lo schema porta tante domande da chiedere conferma (più di `LARGE_TEMPLATE_QUESTIONS`). */
export function needsLargeTemplateConfirm(questions: number): boolean {
  return Number.isFinite(questions) && questions > LARGE_TEMPLATE_QUESTIONS;
}

/** «1 domanda», «6 domande», «2.812 domande». */
function questionsLabel(n: number): string {
  const count = Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  return count === 1 ? "1 domanda" : `${formatCountIt(count)} domande`;
}

export const START_TEMPLATE_TEXT = {
  /** L'etichetta della scelta nel modulo. */
  label: "Schema di partenza",
  /** «per ogni use case»: «Dal caso d'uso» va bene per qualunque use case. */
  fromUseCaseFor: "per ogni use case",
  /** «per assistenza clienti»: il tipo di caso di uno schema di settore. */
  sectorFor: (type: string) => `per ${type}`,
  questions: questionsLabel,
  /** La riga sotto il nome: «per ogni use case · 6 domande». */
  line: (forLabel: string, questions: number) => `${forLabel} · ${questionsLabel(questions)}`,
  showOthers: (n: number) => (n === 1 ? "Mostra anche l'altro schema" : "Mostra anche gli altri schemi"),
  hideOthers: (n: number) => (n === 1 ? "Nascondi l'altro schema" : "Nascondi gli altri schemi"),
  othersHint: "Non combaciano con il tipo di questo use case: vanno scelti solo se sono davvero quelli giusti.",
  /** Nessuno schema scelto (senza «Dal caso d'uso» non si sceglie niente all'apertura). */
  chooseOne: "Scegli lo schema di partenza.",
  /** «Dal caso d'uso» scelto su uno use case senza voci in «Cosa serve». */
  fromUseCaseEmpty: "Lo use case non ha ancora voci in «Cosa serve»: conviene aggiungerle prima di avviare.",
  /** La conferma per gli schemi grandi. */
  largeTitle: (questions: number) => `Questo schema porta ${formatCountIt(Math.max(0, Math.round(questions)))} domande: è quello giusto per questo caso?`,
  largeBody: "Tutte le sue domande entrano nella realizzazione, con la mappa e le regole dello schema. Se lo use case è di un altro tipo, «Dal caso d'uso» parte dalle voci di «Cosa serve».",
  largeConfirm: "Sì, usa questo schema",
  largeCancel: "Scegli un altro schema",
} as const;

// ── Regola di proposta ────────────────────────────────────────────────

/** Parole vuote di almeno 4 lettere (quelle più corte non contano già). */
const STOPWORDS = new Set([
  "agli",
  "alla",
  "alle",
  "allo",
  "altra",
  "altre",
  "altri",
  "altro",
  "anche",
  "come",
  "contro",
  "dagli",
  "dalla",
  "dalle",
  "dallo",
  "degli",
  "dell",
  "della",
  "delle",
  "dello",
  "dentro",
  "dopo",
  "dove",
  "dall",
  "nell",
  "negli",
  "nella",
  "nelle",
  "nello",
  "ogni",
  "oltre",
  "presso",
  "prima",
  "quale",
  "quali",
  "quando",
  "quella",
  "quelle",
  "quelli",
  "quello",
  "questa",
  "queste",
  "questi",
  "questo",
  "senza",
  "sugli",
  "sull",
  "sulla",
  "sulle",
  "sullo",
  "tipo",
  "tutta",
  "tutte",
  "tutti",
  "tutto",
  "verso",
]);

/** Le parole di un testo, in minuscolo e senza accenti. */
export function normalizedWords(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

/** Le parole che contano di un'area di funzione: almeno 4 lettere, non vuote, non solo cifre. */
export function significantWords(text: string | null | undefined): string[] {
  return [...new Set(normalizedWords(text).filter((w) => w.length >= 4 && !STOPWORDS.has(w) && /[a-z]/.test(w)))];
}

/** La radice: la parola senza le vocali finali («turni» → «turn», «equipaggio» → «equipagg»). */
function stemOf(word: string): string {
  return word.replace(/[aeiou]+$/, "");
}

const MIN_STEM = 3;

export interface TemplateTypeFacts {
  key: string;
  functionArea: string | null;
  industry: string | null;
  archetype: string;
}

export interface UseCaseTypeFacts {
  title: string;
  problem?: string | null;
  flow?: string | null;
}

/**
 * Lo schema di settore combacia con lo use case (la regola in testa al modulo):
 * ogni parola significativa della sua area di funzione compare, uguale o con
 * la stessa radice, nel titolo, nel problema o nel flusso. Senza area di
 * funzione, o senza parole significative, mai.
 */
export function templateMatchesUseCase(t: TemplateTypeFacts, useCase: UseCaseTypeFacts): boolean {
  const wanted = significantWords(t.functionArea);
  if (wanted.length === 0) return false;
  const words = new Set([...normalizedWords(useCase.title), ...normalizedWords(useCase.problem), ...normalizedWords(useCase.flow)]);
  if (words.size === 0) return false;
  const stems = new Set([...words].map(stemOf).filter((s) => s.length >= MIN_STEM));
  return wanted.every((w) => {
    if (words.has(w)) return true;
    const stem = stemOf(w);
    return stem.length >= MIN_STEM && stems.has(stem);
  });
}

// ── Opzioni del modulo ────────────────────────────────────────────────

/** Uno schema visibile al workspace, come lo legge la pagina. */
export interface StartTemplateSource extends TemplateTypeFacts {
  id: string;
  name: string;
  restricted: boolean;
  /** Domande della definizione (per «Dal caso d'uso» non contano: contano le voci di «Cosa serve»). */
  questions: number;
  /** Lo schema «Dal caso d'uso» (lo decide chi chiama, dalla chiave). */
  fromUseCase: boolean;
}

/** Una scelta del modulo, con la riga «per che tipo di caso · N domande». */
export interface StartTemplateOption {
  id: string;
  key: string;
  name: string;
  questions: number;
  line: string;
  /** Riservato a questo workspace: mai scelto all'apertura. */
  restricted: boolean;
  fromUseCase: boolean;
}

export interface StartTemplateChoice {
  /** «Dal caso d'uso» per primo, poi gli schemi di settore che combaciano. */
  proposed: StartTemplateOption[];
  /** Gli schemi che non combaciano, dietro «Mostra anche gli altri schemi». */
  others: StartTemplateOption[];
  /** Sempre «Dal caso d'uso» se c'è; altrimenti nessuno, mai uno schema riservato. */
  preselectedId: string | null;
}

/** «assistenza clienti», altrimenti il settore, altrimenti l'archetipo leggibile. */
function sectorTypeOf(t: TemplateTypeFacts): string {
  const area = t.functionArea?.trim();
  if (area) return area;
  const industry = t.industry?.trim();
  if (industry) return industry;
  return t.archetype.replace(/[_.]+/g, " ").trim() || "un tipo di caso";
}

function optionOf(t: StartTemplateSource, fromUseCaseQuestions: number): StartTemplateOption {
  const questions = t.fromUseCase ? Math.max(0, Math.round(fromUseCaseQuestions)) : Math.max(0, Math.round(t.questions));
  const forLabel = t.fromUseCase ? START_TEMPLATE_TEXT.fromUseCaseFor : START_TEMPLATE_TEXT.sectorFor(sectorTypeOf(t));
  return { id: t.id, key: t.key, name: t.name, questions, line: START_TEMPLATE_TEXT.line(forLabel, questions), restricted: t.restricted, fromUseCase: t.fromUseCase };
}

/** Riservati prima (sono del workspace), poi per nome. */
function bySector(a: StartTemplateSource, b: StartTemplateSource): number {
  return Number(b.restricted) - Number(a.restricted) || a.name.localeCompare(b.name, "it") || a.key.localeCompare(b.key);
}

/**
 * Le scelte di «Schema di partenza»: «Dal caso d'uso» per primo (uno solo, il
 * primo trovato), poi gli schemi di settore che combaciano con lo use case;
 * gli altri a parte. All'apertura è scelto «Dal caso d'uso», se c'è; altrimenti
 * nessuno.
 */
export function startTemplateOptions(
  templates: readonly StartTemplateSource[],
  i: { fromUseCaseQuestions: number; useCase: UseCaseTypeFacts },
): StartTemplateChoice {
  const fromUseCase = templates.find((t) => t.fromUseCase) ?? null;
  const sector = templates.filter((t) => !t.fromUseCase).sort(bySector);
  const proposed: StartTemplateOption[] = fromUseCase ? [optionOf(fromUseCase, i.fromUseCaseQuestions)] : [];
  const others: StartTemplateOption[] = [];
  for (const t of sector) (templateMatchesUseCase(t, i.useCase) ? proposed : others).push(optionOf(t, i.fromUseCaseQuestions));
  return { proposed, others, preselectedId: fromUseCase && !fromUseCase.restricted ? fromUseCase.id : null };
}
