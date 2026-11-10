/**
 * «Chiedi al referente» in tre passi (rilascio 4): quali domande proporre alla persona scelta in
 * «A chi». Si confrontano il nome e il ruolo scritto della persona con il «Chi» delle domande della
 * scheda, che il revisore vede già: è solo una proposta, le spunte restano sue.
 *
 * - Le parole: senza accenti, minuscole, divise su tutto ciò che non è lettera o cifra, almeno 2
 *   caratteri (`wordsOf`).
 * - Le parole che non dicono chi è una persona non contano mai: articoli e preposizioni, i lati
 *   («cliente», «fornitore», «Lateral Space», «insieme»), gli uffici generici («ufficio», «area»,
 *   «responsabile»…) e le parole dell'azienda (il nome del workspace e quello del connettore,
 *   `orgWordsOf`: «Rondine», «Ferralba»). Un «Chi» fatto solo di queste è **generico**: va bene per
 *   chiunque e si propone sempre (anche le domande preparate, che un «Chi» non l'hanno).
 * - Una domanda è **della persona** quando il suo «Chi» nomina il suo nome, il suo cognome (almeno 4
 *   lettere) o una parola del suo ruolo (almeno 3 lettere; solo referenti e persone nuove hanno un ruolo).
 * - «Chiedi di nuovo»: le domande di prima che si possono ancora chiedere, senza confronti di nomi.
 *
 * Non legge mai il lato dell'esigenza, l'account, il ruolo nel workspace, la storia o le risposte
 * della persona. Niente si salva, si registra o si manda: il server riceve solo gli id spuntati.
 * Nessun conteggio per persona (art. 15.4). Modulo puro.
 */

/** Le parole che non dicono mai chi è una persona. */
export const MATCH_STOP_WORDS: ReadonlySet<string> = new Set([
  // Articoli e preposizioni
  "il", "lo", "la", "i", "gli", "le", "l", "un", "una", "uno", "di", "del", "dello", "della", "dei", "degli", "delle", "d",
  "a", "al", "allo", "alla", "ai", "agli", "alle", "ad", "da", "dal", "dalla", "dai", "e", "ed", "o", "per", "con", "su",
  "in", "nel", "nella", "tra", "fra",
  // I lati e i gruppi
  "cliente", "clienti", "insieme", "fornitore", "fornitori", "lateral", "space", "team", "gruppo",
  // Gli uffici generici
  "ufficio", "uff", "area", "reparto", "settore", "funzione", "direzione", "responsabile", "resp", "referente",
]);

/** Le parole di un testo: senza accenti, minuscole, almeno 2 caratteri, nell'ordine del testo. */
export function wordsOf(text: string | null | undefined): string[] {
  if (typeof text !== "string" || !text) return [];
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("it-IT")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2);
}

/** Le parole dell'azienda (nome del workspace, nome del connettore): non dicono mai chi è una persona. */
export function orgWordsOf(names: readonly (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const name of names) for (const word of wordsOf(name)) if (!MATCH_STOP_WORDS.has(word)) out.add(word);
  return out;
}

/** Una domanda che si può chiedere, nell'ordine della scheda. */
export interface MatchQuestion {
  id: string;
  /** Il «Chi» dell'esigenza (testo libero); null senza. */
  ownerLabel: string | null;
}

/** La persona scelta in «A chi»: il nome e, per referenti e persone nuove, il ruolo scritto. */
export interface MatchPerson {
  displayName: string;
  roleLabel: string | null;
}

export interface QuestionsForPerson {
  /** Le domande proposte (spuntate all'arrivo, fino a 20), nell'ordine della scheda. */
  proposed: string[];
  /** Le altre domande della scheda, sotto «Altre domande di questo use case». */
  others: string[];
  /** Almeno una domanda nomina la persona (o, con «Chiedi di nuovo», almeno una di prima resta). */
  matched: boolean;
}

function without(words: readonly string[], ...sets: ReadonlySet<string>[]): string[] {
  return words.filter((word) => !sets.some((set) => set.has(word)));
}

/** Il «Chi» non nomina nessuno: vuoto, oppure solo azienda, lati e uffici generici. */
export function isGenericOwner(ownerLabel: string | null | undefined, orgWords: ReadonlySet<string>): boolean {
  return without(wordsOf(ownerLabel ?? ""), MATCH_STOP_WORDS, orgWords).length === 0;
}

/**
 * Le domande da proporre alla persona: quelle che la nominano e quelle generiche, nell'ordine della
 * scheda; le altre a parte. Con `previous` («Chiedi di nuovo») le domande di prima ancora aperte.
 */
export function questionsForPerson(input: {
  person: MatchPerson;
  askable: readonly MatchQuestion[];
  orgWords: ReadonlySet<string>;
  previous?: readonly string[] | null;
}): QuestionsForPerson {
  const ids = input.askable.map((q) => q.id.toLowerCase());
  if (input.previous) {
    const before = new Set(input.previous.map((id) => id.toLowerCase()));
    const proposed = ids.filter((id) => before.has(id));
    return { proposed, others: ids.filter((id) => !before.has(id)), matched: proposed.length > 0 };
  }
  const ignore = [MATCH_STOP_WORDS, input.orgWords] as const;
  const personWords = without(wordsOf(input.person.displayName), ...ignore).filter((word) => word.length >= 3);
  const first = personWords[0] ?? null;
  const last = personWords.length >= 2 ? personWords[personWords.length - 1] : null;
  const personSet = new Set(personWords);
  const roleWords = without(wordsOf(input.person.roleLabel ?? ""), ...ignore, personSet).filter((word) => word.length >= 3);
  const proposed: string[] = [];
  const others: string[] = [];
  let matched = false;
  input.askable.forEach((question, index) => {
    const label = new Set(without(wordsOf(question.ownerLabel ?? ""), ...ignore));
    const generic = label.size === 0;
    const mine =
      !generic && ((first !== null && label.has(first)) || (last !== null && last.length >= 4 && label.has(last)) || roleWords.some((word) => label.has(word)));
    if (mine) matched = true;
    (mine || generic ? proposed : others).push(ids[index]);
  });
  return { proposed, others, matched };
}

/** Le domande spuntate all'arrivo su «Cosa chiedi»: le prime `limit` proposte. */
export function initialTicks(result: Pick<QuestionsForPerson, "proposed">, limit: number): string[] {
  return result.proposed.slice(0, Math.max(0, limit));
}
