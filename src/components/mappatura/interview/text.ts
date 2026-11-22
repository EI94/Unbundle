/**
 * «Intervista iniziale» (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7; prima «Discovery»): le scritte della pagina, della
 * chat e del riepilogo accanto.
 *
 * Stile della casa: frasi semplici e corte, genere neutro, maiuscola solo all'inizio, niente inglese. I componenti
 * importano le scritte da qui e non ne scrivono: così un test le legge tutte. Le parole che «Contesto» ha già (il titolo,
 * «Vedi tutti (N)», «Obiettivo · Risultato chiave», «Dove fa la differenza») vengono da `CONTEXT_TEXT`, non si
 * ripetono.
 *
 * Modulo puro.
 */
import { CONTEXT_TEXT } from "../../../lib/context/text.ts";
import { TOOL_LABELS } from "../../agent/chat-view.ts";

const C = CONTEXT_TEXT;

export const INTERVIEW_TEXT = Object.freeze({
  /** Il titolo della pagina e l'ultima voce del percorso «Contesto › Intervista iniziale». */
  title: C.page.interview,
  /** Il benvenuto, in una riga: la domanda da cui parte l'intervista (in grassetto). Non va al modello (chatHistory). */
  welcome: "Partiamo dall'azienda: **come si chiama e di cosa si occupa?**",
  /** Tre risposte pronte, da mandare così come sono. */
  suggestions: Object.freeze(["Siamo un'azienda manifatturiera", "Offriamo servizi alle imprese", "Sviluppiamo software"]),
  /** Dopo 45 secondi, quando tocca alla persona. */
  nudge: "Rispondi per continuare l'intervista.",
  documents: Object.freeze({
    upload: "Carica documenti",
    uploading: "Carico…",
    failed: (fileName: string) => `${fileName}: caricamento non riuscito. Riprova.`,
  }),
  summary: Object.freeze({
    /** Il titolo della colonna accanto alla chat, e del foglio che la sostituisce al telefono. */
    title: "Riepilogo",
    /** Il bottone che apre il foglio, dove la colonna non sta. */
    open: "Riepilogo",
    /** Prima che l'intervista raccolga qualcosa: una frase sola, senza sezioni vuote. */
    empty: "Qui compare quello che emerge dall'intervista.",
    value: "Dove crea valore",
    goals: "Obiettivi",
    differs: C.live.strategicNodes,
    people: C.live.people,
    goalTag: C.live.goalTag,
    showAll: C.page.showAll,
    showLess: C.page.showLess,
  }),
});

/**
 * Le etichette dei tool dell'intervista: quelle di sempre (`TOOL_LABELS` di chat-view.ts), con l'italiano semplice al
 * posto delle parole tecniche («value thesis», «terminologia»).
 */
export const INTERVIEW_TOOL_LABELS: Readonly<Record<string, { active: string; done: string }>> = Object.freeze({
  ...TOOL_LABELS,
  saveCompanyValueThesis: Object.freeze({ active: "Salvo dove l'azienda crea valore", done: "Valore dell'azienda salvato" }),
  saveUnitTerminology: Object.freeze({ active: "Salvo come chiamate le unità", done: "Nome delle unità salvato" }),
});

/** La prima lettera maiuscola: il nome delle unità del workspace come titolo («reparti» → «Reparti»). */
export const capitalized = (text: string): string => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);
