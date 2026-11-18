/**
 * (Rilascio 10, docs/ui-10/PROPOSTA-10.md §4) Le parole della Formazione scritte fuori dai componenti: «Corso ·
 * Lezione · Esercizio · Prova · Risultato». Modulo puro.
 */
export const LEARNING_TEXT = Object.freeze({
  /**
   * Un corso che questo account non può aprire (`forbidden`): un altro account, nessuna iscrizione, un corso sospeso o
   * nascosto. La spiegazione di prima, al posto di «Questa pagina non si è caricata» e «Riprova», che restano per gli
   * errori veri (`learning/error.tsx`).
   */
  programUnavailable: Object.freeze({
    title: "Formazione",
    body: "Il corso potrebbe essere sospeso o non assegnato a questo account. Le risposte già inviate restano salvate. Controlla di essere nel workspace giusto, oppure chiedi a chi tiene il corso.",
  }),
});
