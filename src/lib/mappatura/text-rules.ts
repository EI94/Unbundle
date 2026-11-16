/**
 * Solo per i test delle scritte della mappatura (`text.test.ts` qui e nei due pacchetti delle schermate): nessun file
 * dell'app lo importa. Le regole della casa, da controllare su ogni scritta che arriva a schermo
 * (docs/mappatura/MAPPATURA-BOARD-PIANO.md §7, §8.1).
 *
 * Modulo puro.
 */
import { FREQUENCIES, STEP_STATUSES, UNIT_STATUSES, WORK_TYPES } from "./vocab.ts";

/** Tutte le scritte dentro un oggetto di testi: le stringhe, a ogni profondità. Le funzioni si chiamano a parte. */
export function collectTexts(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectTexts(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectTexts(item, out);
  return out;
}

/** Le chiavi interne che non devono mai arrivare a schermo: quelle salvate nel database e i nomi dei tipi di lavoro. */
const INTERNAL_KEYS = [...UNIT_STATUSES, ...WORK_TYPES, ...FREQUENCIES.filter((value) => value.includes("_")), ...STEP_STATUSES.filter((value) => value.includes("_")), "automatable", "augmentable"];
/** Gli stream sono nomi di prodotto e si scrivono con la maiuscola: in minuscolo sono la chiave salvata. */
const LOWERCASE_STREAMS = /(^|[^\p{L}])(automate|differentiate|innovate)([^\p{L}]|$)/u;
/** Le parole che possono avere la maiuscola a metà frase: nomi di prodotto e di schede. */
const PROPER = new Set(["Automate", "Differentiate", "Innovate", "Discovery", "Activity", "Use", "Classificazione", "Assistente", "Roma"]);

/**
 * I difetti di una scritta rispetto allo stile della casa; vuoto se è a posto.
 * - «use case», mai «caso d'uso» o «casi d'uso»; mai «wave»;
 * - nessuna chiave interna (`not_started`, `da_validare`, `enrichment`…), nessuna parola con il trattino basso;
 * - maiuscola solo all'inizio: dentro una frase, solo nomi di prodotto, sigle e quello che sta tra « »;
 * - niente spazi doppi né ai bordi.
 */
export function houseStyleFaults(text: string): string[] {
  const faults: string[] = [];
  if (/cas[oi] d[’']uso/i.test(text)) faults.push("«caso d'uso»: nel dashboard si dice «use case»");
  if (/\bwave\b/i.test(text)) faults.push("«wave»");
  if (/[a-z]_[a-z]/.test(text)) faults.push("una chiave interna con il trattino basso");
  for (const key of INTERNAL_KEYS) if (new RegExp(`(^|[^\\p{L}_])${key}([^\\p{L}_]|$)`, "u").test(text)) faults.push(`la chiave interna «${key}»`);
  if (LOWERCASE_STREAMS.test(text)) faults.push("uno stream in minuscolo (è la chiave salvata)");
  if (text !== text.trim() || / {2,}/.test(text)) faults.push("spazi doppi o ai bordi");
  // Maiuscole a metà frase: si guarda fuori da « », e non dopo un punto, due punti, un punto di domanda o un a capo.
  const outside = text.replace(/«[^»]*»/g, "«»");
  for (const sentence of outside.split(/[.!?:…]\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/).slice(1);
    for (const word of words) {
      const bare = word.replace(/^[^\p{L}]+|[^\p{L}*]+$/gu, "");
      if (!bare || !/^\p{Lu}/u.test(bare)) continue;
      if (bare === bare.toUpperCase()) continue; // una sigla: AI, O*NET
      if (PROPER.has(bare)) continue;
      faults.push(`maiuscola a metà frase: «${word}»`);
    }
  }
  return faults;
}

/** Ogni scritta dell'elenco rispetta lo stile della casa: altrimenti l'errore dice quale e perché. */
export function assertHouseStyle(texts: readonly string[]): void {
  const problems = texts.flatMap((text) => houseStyleFaults(text).map((fault) => `«${text}»: ${fault}`));
  if (problems.length > 0) throw new Error(`Scritte fuori stile:\n${problems.join("\n")}`);
}
