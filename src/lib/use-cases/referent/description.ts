/**
 * «Referente in un tocco» (rilascio 5, SPEC §3.5, D12, D55): la descrizione dello use case come la
 * vede il referente al passo «Lo use case», e come la vede chi chiede in «Cosa riceve {Nome}».
 *
 * La descrizione si divide in frasi; una frase resta fuori quando ha:
 * - un importo, una quota o un punteggio: «€», «EUR», «euro», «k€», «mila», «milion», «%», «percent»,
 *   «ROI», «punteggi», «score», un numero seguito da «k»;
 * - una cifra insieme a «risparmi» o «cost» (costo, costi): «riduce i costi» senza cifre resta;
 * - un dato personale o sanitario che la scansione delle risposte blocca (email, telefono, dati
 *   sanitari o discriminatori, data di nascita, codice fiscale, nome e cognome).
 * Le frasi che restano si riuniscono. Senza nessuna frase: null (il passo mostra il titolo).
 *
 * Modulo puro.
 */
import { scanText } from "../../uc/text/scan.ts";

/** Gli indicatori di importi, quote e punteggi (minuscole, senza accenti da togliere). */
const MONEY_OR_SCORE = /€|\beur\b|\beuro\b|\bmila\b|milion|%|percent|\broi\b|punteggi|\bscore\b|\d\s?k\b/i;
/** Una cifra insieme a «risparmi…» o «cost…». */
const DIGIT = /\d/;
const SAVINGS_OR_COST = /risparmi|cost/i;

/** Le frasi di un testo: si divide dopo «.», «!», «?» e «…» seguiti da uno spazio. */
export function sentencesOf(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** La frase resta fuori: importi, quote, punteggi, cifre di risparmi o costi, dati personali. */
export function sentenceIsHidden(sentence: string): boolean {
  if (MONEY_OR_SCORE.test(sentence)) return true;
  if (DIGIT.test(sentence) && SAVINGS_OR_COST.test(sentence)) return true;
  return scanText(sentence, { context: "risposta" }).blocking.length > 0;
}

export interface ReferentDescription {
  /** Le frasi che il referente vede, riunite; null quando non ne resta nessuna. */
  text: string | null;
  /** Quante frasi restano fuori (per la riga di chi chiede). */
  dropped: number;
}

/** La descrizione per il referente (§3.5). */
export function referentDescription(description: string | null | undefined): ReferentDescription {
  const sentences = sentencesOf(typeof description === "string" ? description : "");
  const kept = sentences.filter((s) => !sentenceIsHidden(s));
  const text = kept.join(" ").trim();
  return { text: text || null, dropped: sentences.length - kept.length };
}

/** Una parola breve (l'unità o l'etichetta della stima) passa lo stesso filtro delle frasi. */
export function shortTextIsShown(text: string | null | undefined): boolean {
  const clean = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  return clean.length > 0 && !sentenceIsHidden(clean);
}
