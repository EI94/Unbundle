/**
 * I pochi testi della pagina `/rispondi/<token>` che la SPEC non elenca in `REFERENT_PUBLIC_TEXT`
 * (labels.ts, di BACKEND): la scheda d'errore imprevisto, il caricamento per i lettori di schermo,
 * le etichette accessibili. Stesse regole dei testi di labels.ts (copy-guard, niente parole
 * tecniche); `copy.test.ts` li controlla con gli altri. Da spostare in labels.ts quando BACKEND
 * può (REQUESTS-PUBLIC.md).
 *
 * Modulo puro.
 */
export const REFERENT_PUBLIC_EXTRA_TEXT = Object.freeze({
  errorTitle: "Qualcosa non ha funzionato",
  errorText: "Può essere un problema momentaneo di connessione. Le risposte che hai già inviato sono salve: riprova tra poco.",
  retry: "Riprova",
  reload: "Ricarica la pagina",
  loading: "Caricamento…",
  /** Etichetta accessibile di «Togli» accanto a un file: «Togli preventivo.pdf». */
  removeFileAria: "Togli {file}",
  /** Etichetta accessibile dell'elenco dei file di una domanda. */
  filesAria: "File allegati",
  /** Chiude un file non accettato (è già stato cancellato): nessuna chiamata. */
  dismissRejectedAria: "Nascondi {file}",
  /** Il testo della domanda nell'etichetta accessibile della risposta. */
  answerAria: "{label}: {domanda}",
  uploading: "Carico e controllo il file…",
});
