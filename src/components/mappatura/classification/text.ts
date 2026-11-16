/**
 * «Mappatura board»: le scritte della scheda «Classificazione» e del completamento (docs/mappatura/MAPPATURA-BOARD-PIANO.md
 * §7.3).
 *
 * Stile della casa: frasi semplici e corte, genere neutro, maiuscola solo all'inizio, «use case». Gli stream sono nomi
 * di prodotto e non si traducono. I componenti importano le scritte da qui e non ne scrivono: così un test le legge
 * tutte. Le maiuscole che si vedono in etichette e badge le mette il CSS.
 *
 * Modulo puro.
 */
import { STREAM_LABEL, counted, formatCount, formatHours } from "../../../lib/mappatura/text.ts";
import type { Stream } from "../../../lib/mappatura/vocab.ts";

export const CLASSIFICATION_TEXT = Object.freeze({
  eyebrow: "Classificazione",
  /** «Stessi processi, *tre stream*». */
  title: Object.freeze({ plain: "Stessi processi,", accent: "tre stream" }),
  lede: "Ogni passo mostra lo stream in cui cade e il punto in cui decide una persona.",
  reset: "Usa gli stream proposti",
  resetDone: "Stream riportati alla proposta.",
  exposureTile: "AI exposure media",
  legend: Object.freeze({ unclassified: "da classificare", decides: "decide una persona" }),
  filters: Object.freeze({ label: "Mostra i passi", all: "Tutti", unclassified: "Da classificare" }),
  card: Object.freeze({ unclassified: "da classificare" }),
  before: Object.freeze({
    title: "La classificazione arriva alla fine",
    text: "Quando i processi sono a posto, completa la mappatura: ogni passo entra in uno dei tre stream.",
  }),
  button: Object.freeze({ complete: "Completa la mappatura", working: "Classificazione in corso…" }),
  after: Object.freeze({ failed: "Classificazione non riuscita. Riprova.", completed: "Mappatura completata.", open: "Apri" }),
  cases: Object.freeze({ title: "Use case nati da questa mappatura", none: "Ancora nessuno.", goTo: "Vai a Use case", open: "Apri" }),
  drawer: Object.freeze({
    today: "Oggi",
    classification: "Classificazione",
    stream: "Stream",
    potential: "Potenziale con l'AI",
    decides: "Decide una persona",
    exposure: "AI exposure",
    tools: "Strumenti",
    frictions: "Attriti di oggi",
    ideas: "Idee del team",
    useCases: "Use case",
    unclassified: "Resta da classificare.",
    addIdea: "+ idea",
    addIdeaLabel: "Aggiungi un'idea del team",
    ideaLabel: "Idea del team",
    selector: "Stream del passo",
    none: "—",
    noneLabel: "Nessuno stream",
    proposed: "Proposto dall'assistente",
  }),
});

/** Il riquadro di uno stream: «Automate · 12,5 h a settimana». */
export const streamTileLabel = (stream: Stream, hoursWeek: number): string => `${STREAM_LABEL[stream]} · ${formatHours(hoursWeek)} h a settimana`;

/** La media dell'esposizione all'AI, o «—» se nessun passo ha il match O*NET. */
export const exposureTileValue = (pct: number | null): string => (pct === null ? "—" : `${formatCount(pct)}%`);

/** «3 passi da classificare.», «1 passo da classificare.». */
export const toClassifyLine = (n: number): string => `${counted(n, "passo", "passi")} da classificare.`;

/** Il bottone che classifica quello che resta: «Classifica 3 passi», «Classifica 1 passo». */
export const classifyButtonLabel = (n: number): string => `Classifica ${counted(n, "passo", "passi")}`;

/** Dopo il bottone, tutto classificato: «Mappatura completata: 5 passi classificati.». */
export const completedClassifiedText = (n: number): string => `Mappatura completata: ${counted(n, "passo classificato", "passi classificati")}.`;

/**
 * Dopo «Classifica {n} passi» su un'unità già completa: «5 passi classificati.», «1 passo classificato.»; niente da
 * fare (un altro giro li ha classificati prima): «Nessun passo da classificare.».
 */
export const classifiedText = (n: number): string => (n > 0 ? `${counted(n, "passo classificato", "passi classificati")}.` : "Nessun passo da classificare.");

/** Dopo il bottone, una parte classificata: «Classificati 3 passi su 5. Riprova per gli altri.». */
export const partialText = (classified: number, of: number): string =>
  `${classified === 1 ? "Classificato" : "Classificati"} ${counted(classified, "passo", "passi")} su ${formatCount(of)}. Riprova per gli altri.`;

/** La confidenza del classificatore: «Affidabilità 86%». */
export const reliabilityText = (confidence: number): string => `Affidabilità ${formatCount(Math.round(confidence * 100))}%`;

/** Il match O*NET: «O*NET 13-1023.00 · Purchasing agents», o il solo codice. */
export const onetLine = (code: string, title: string | null): string => (title?.trim() ? `O*NET ${code} · ${title.trim()}` : `O*NET ${code}`);

/** Il nome di una riga di use case per gli screen reader: «Apri» e il titolo, come si leggono. */
export const caseRowLabel = (code: string | null, title: string): string => [CLASSIFICATION_TEXT.cases.open, code, title].filter(Boolean).join(" ");
