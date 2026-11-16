/**
 * «Mappatura board»: le scritte dell'assistente accanto alla board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §7.4).
 *
 * Stile della casa: frasi semplici e corte, genere neutro, maiuscola solo all'inizio. I componenti importano le
 * scritte da qui e non ne scrivono: così un test le legge tutte. L'avviso di una risposta rifiutata è quello di sempre
 * (`CHAT_REFUSAL_NOTICE` in src/components/agent/chat-view.ts); le etichette dei tool sono `MAPPING_TOOL_LABELS`.
 *
 * Modulo puro.
 */
import { counted, formatCount } from "../../../lib/mappatura/text.ts";

export const COMPANION_TEXT = Object.freeze({
  panel: Object.freeze({ title: "Assistente", close: "Chiudi" }),
  /** Il benvenuto, prima del nome dell'unità e dopo (in grassetto: `**{unità}**`). */
  welcome: Object.freeze({
    lead: "Mappiamo il lavoro di",
    rest: "Racconta una settimana tipo: su cosa va più tempo? Salvo ogni passo sulla board mentre parliamo.",
    documents: "Ho già i documenti caricati: li uso per fare domande più precise.",
  }),
  suggestions: Object.freeze([
    "Le attività principali sono quattro o cinque",
    "Molto tempo va in report e controlli",
    "Il lavoro è frammentato",
    "Tanti passaggi si fanno a mano",
  ]),
  field: Object.freeze({ label: "Messaggio per l'assistente", placeholder: "Scrivi qui…", waiting: "Attendi la risposta…", send: "Invia" }),
  nudge: "Tocca a te: rispondi per continuare la mappatura.",
  errors: Object.freeze({
    title: "Errore",
    network: "Connessione persa. Controlla la rete e riprova.",
    session: "Sessione scaduta. Ricarica la pagina.",
    rate: "Troppe richieste. Attendi qualche secondo.",
    other: "Qualcosa non ha funzionato. Riprova.",
  }),
  documents: Object.freeze({ upload: "Carica documenti", uploading: "Carico…", uploaded: "Documento caricato.", failed: "Caricamento non riuscito. Riprova." }),
  proposals: Object.freeze({
    propose: "Proponi passi dai documenti",
    reading: "Leggo i documenti…",
    none: "Dai documenti non emergono passi chiari.",
    drawerTitle: "Passi dai documenti",
    cancel: "Annulla",
    failed: "Qualcosa non ha funzionato. Riprova.",
  }),
});

/** Il benvenuto della chat di un'unità: il suo nome in grassetto; con i documenti, una frase in più. */
export function welcomeText(unitName: string, hasDocuments: boolean): string {
  const W = COMPANION_TEXT.welcome;
  const name = unitName.replace(/\*/g, "").trim();
  return [`${W.lead} **${name}**.`, W.rest, hasDocuments ? W.documents : ""].filter(Boolean).join(" ");
}

/** L'attesa della risposta, secondo i secondi passati. */
export function waitingText(seconds: number): string {
  if (seconds < 5) return "Sto ragionando…";
  if (seconds < 15) return "Elaboro la risposta…";
  const s = formatCount(seconds);
  return seconds < 30 ? `Ancora un momento (${s} s)…` : `Ci sto mettendo un po' (${s} s)…`;
}

/**
 * L'errore della chat in parole: la rete, la sessione, troppe richieste, o altro. Mai il messaggio dell'errore, che può
 * portare testi del server.
 */
export function chatErrorText(error: { message?: unknown; name?: unknown } | null | undefined): string {
  const E = COMPANION_TEXT.errors;
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
  if (error?.name === "TypeError" || message.includes("fetch") || message.includes("network")) return E.network;
  if (message.includes("401") || message.includes("unauthorized")) return E.session;
  if (message.includes("429") || message.includes("too many")) return E.rate;
  return E.other;
}

/** La riga del contesto del drawer delle proposte: «3 di 5 scelti». */
export const chosenText = (chosen: number, of: number): string => `${formatCount(chosen)} di ${formatCount(of)} scelti`;

/** Il bottone del drawer delle proposte: «Aggiungi 3 passi», «Aggiungi 1 passo». */
export const addStepsLabel = (n: number): string => `Aggiungi ${counted(n, "passo", "passi")}`;

/** Dopo «Aggiungi»: «3 passi aggiunti: sono da validare.», «1 passo aggiunto: è da validare.». */
export const stepsAddedText = (n: number): string => (n === 1 ? "1 passo aggiunto: è da validare." : `${formatCount(n)} passi aggiunti: sono da validare.`);
