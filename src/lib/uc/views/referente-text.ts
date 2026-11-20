/**
 * Le parole della pagina del link della realizzazione `/r/[token]` (rilascio 10, ondata 4 «Fuori»,
 * docs/ui-10/PROPOSTA-10.md §3.11 «/r», §4), in un file solo.
 *
 * Il kit del referente (D5): `/r` dice le stesse cose di `/rispondi` e delle email.
 * - «Non lo so», mai «Non ce l'ho»; «caso d'uso», mai «use case»; «Avanti» senza la freccia;
 *   «Chiedi a un'altra persona» (§4.1), con il genere neutro.
 * - Un solo numero di avanzamento per schermata, con lo stato del salvataggio accanto: «3 di 12 · salvato».
 * - Il guscio delle pagine pubbliche (§3.11): in alto «{Cliente} · con Lateral Space»; una scheda sola per il link
 *   che non vale («Questo link non vale più.») e una sola per l'errore, con il solo «Riprova».
 * - La fonte del dato sta dentro «Altre opzioni»; nelle schermate «È più comodo dal computer» il pulsante pieno è
 *   «Rispondi dopo».
 *
 * L'informativa non sta qui: è `REFERENT_PRIVACY_NOTICE` in `public-view.ts`, con la sua versione, e all'unione passa
 * all'informativa comune del kit. I messaggi dell'API che la pagina mostra (`INVALID_LINK_MESSAGE`, …) stanno in
 * `public-view.ts` e prendono da qui le parole della scheda del link.
 *
 * Modulo puro e senza import: lo leggono i componenti del referente (anche nel browser), `public-view.ts` e i test.
 */

/** I conteggi come nelle pagine del caso: interi, con il punto delle migliaia anche a 4 cifre («2.812»). */
const COUNT_IT = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });

function count(n: number): string {
  return COUNT_IT.format(Number.isFinite(n) ? Math.round(n) : 0);
}

/** «1 risposta», «3 risposte». */
function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${count(n)} ${many}`;
}

export const R_TEXT = Object.freeze({
  /** Il guscio di ogni schermata (§3.11). */
  shell: Object.freeze({
    brand: "Unbundle",
    /** La riga in alto, non cliccabile: «Cliente Demo · con Lateral Space». Senza cliente, solo il marchio. */
    client: (client: string) => `${client} · con Lateral Space`,
    loading: "Caricamento…",
  }),

  /** La scheda del link che non si può usare: token sbagliato, scaduto, revocato, sezione spenta (sempre la stessa). */
  invalidLink: Object.freeze({
    title: "Questo link non vale più.",
    body: "Rispondi all'email che hai ricevuto: arriva a chi ti ha scritto.",
  }),

  /** La scheda dell'errore, con il solo «Riprova» (anche quando il servizio non risponde). */
  error: Object.freeze({
    title: "Questa pagina non si è caricata.",
    body: "Le risposte che hai già inviato sono salve.",
    retry: "Riprova",
  }),

  /** L'informativa cambiata con un rilascio, quando la pagina non ne ha il testo: si ricarica. */
  privacyReload: "Ricarica la pagina",
  privacyAckError: "Non riesco a registrarlo. Riprova tra poco.",

  /** La Home (R1). */
  home: Object.freeze({
    hello: (name: string | null) => (name ? `Ciao ${name}` : "Ciao"),
    finished: (name: string | null) => `Hai finito. Grazie${name ? `, ${name}` : ""}!`,
    pausedTitle: "Per ora non serve rispondere",
    pausedText: "Il caso d'uso è in pausa. Ti scriviamo quando riparte. Quello che hai scritto resta salvato.",
    finishedText: "Lateral Space controlla le risposte e ti scrive solo se serve un chiarimento. Puoi chiudere questa pagina.",
    intro: "Ci servono alcune risposte sul vostro lavoro. Puoi rispondere a più riprese: si salva tutto da solo.",
    preview: "Anteprima: così la vede il referente.",
    progressLabel: "Risposte date",
    topics: "Per argomento",
    sentMark: "Inviato",
    skipped: "Lasciate per dopo",
    computer: "Meglio dal computer",
    computerText: "Tabelle e file: apri questo stesso link dal computer e ritrovi tutto.",
    locked: "Si apriranno più avanti",
    lockedText: "Riguardano dati personali: si aprono quando la tua azienda dà l'ok.",
    sent: "Già inviate",
    update: "È cambiato qualcosa? Aggiorna la risposta",
    answerNow: "Rispondi ora",
    linkOnlyYours: "Il link è solo tuo: non inoltrarlo.",
    /** Il titolo di un elenco chiuso con il suo conteggio: «Già inviate (12)». */
    list: (title: string, n: number) => `${title} (${count(n)})`,
  }),

  /** Il giro delle risposte con un tocco, fra argomenti (il ritorno da «Controlla e invia»). */
  quickTopic: "Le più veloci",

  /** Il caso d'uso in pausa, nella pagina delle firme. */
  pausedNotice: "Il caso d'uso è in pausa. Ti scriviamo quando riparte.",

  /** Gli avvisi in linea della pagina, dopo un'azione. */
  notices: Object.freeze({
    refreshFailed: "Non riesco ad aggiornare la pagina. Ricaricala tra poco: le risposte inviate sono salve.",
    answerSent: "Risposta inviata. Lateral Space la controlla e ti scrive solo se serve un chiarimento.",
    clarificationSent: "Grazie: abbiamo inviato la tua risposta al chiarimento.",
  }),

  /** Gli annunci per i lettori di schermo (`aria-live`). */
  say: Object.freeze({
    saved: "Salvato.",
    checkFields: "Controlla i campi segnati.",
    sentOne: "Inviata.",
    sentAll: "Inviate.",
    notKnown: "Salvato: «Non lo so».",
    confirmed: "Confermato.",
    offline: "Sei offline: per inviare serve la connessione.",
    done: "Fatto.",
    partial: (sent: number, failed: number) => `${count(sent)} inviate, ${count(failed)} da sistemare.`,
  }),

  /** Il titolo della scheda del browser. */
  documentTitle: Object.freeze({
    page: "Unbundle",
    review: "Controlla e invia · Unbundle",
    delegate: "Chiedi a un'altra persona · Unbundle",
  }),

  /** La barra in alto di una domanda: un numero solo, con «salvato» accanto (§3.11, come «2 di 5 · salvato»). */
  step: Object.freeze({
    back: "Argomenti",
    later: "Rispondi dopo",
    /** «3 di 12», poi «3 di 12 · salvato» dopo la prima modifica di questa visita. */
    count: (n: number, total: number, saved: boolean) => `${count(n)} di ${count(total)}${saved ? " · salvato" : ""}`,
    /** `aria-valuetext` della barra: «Domanda 3 di 12». */
    valueText: (n: number, total: number) => `Domanda ${count(n)} di ${count(total)}`,
    barLabel: "Domande dell'argomento",
    /** L'argomento di una domanda senza modulo. */
    otherTopic: "Domande",
  }),

  /** Le azioni di una domanda (R2). «Avanti» senza la freccia, come su `/rispondi`. */
  actions: Object.freeze({
    next: "Avanti",
    send: "Invia",
    sendNewVersion: "Invia la nuova versione",
    review: "Rivedi e invia",
    notKnown: "Non lo so",
    cancel: "Annulla",
    confirm: "È così",
    correct: "Correggi",
    undoCorrection: "Annulla la correzione",
  }),

  /** Una domanda (R2a-R2d). */
  question: Object.freeze({
    stillTrue: "È ancora così?",
    validFrom: "Da quando vale?",
    validFromHint: "Se non lo sai con precisione, metti una data vicina.",
    alreadyTold: "Ci avete già detto",
    alreadyToldLine: "Ci avete già detto:",
    checkFormat: "Controlla il valore nel formato giusto.",
    /** R2d, il dato personale: parte solo con «Invia» (RD-5). */
    personal: "Questo dato parte solo quando premi «Invia».",
    yourAnswer: "La tua risposta:",
    sentFallback: "inviata",
    allSet: "A posto",
    updateAnswer: "È cambiato qualcosa? Aggiorna la risposta",
    exampleFold: "Esempio e dove trovarlo",
    example: "Esempio:",
    where: "Dove trovarlo:",
    /** «Ho letto 12 righe da «costi.xlsx»: controlla la tabella qui sotto.» */
    imported: (rows: number, fileName: string, note: string | null) =>
      `Ho letto ${rows === 1 ? "1 riga" : `${count(rows)} righe`} da «${fileName}»: controlla la tabella qui sotto.${note ? ` ${note}` : ""}`,
  }),

  /** R2c, tabelle e file al telefono: il pulsante pieno è «Rispondi dopo» (`step.later`). */
  heavy: Object.freeze({
    title: "È più comodo dal computer",
    text: "Apri questo stesso link dal computer: ritrovi tutto dove l'hai lasciato.",
    fillTable: "Compila qui, riga per riga",
    uploadFile: "Carica il file da qui",
    fill: "Compila qui",
    excel: "Carica un Excel",
    template: "Scarica il modello Excel",
  }),

  /** «▸ Altre opzioni» (R2b), con dentro la fonte del dato (RD-3). */
  more: Object.freeze({
    fold: "Altre opzioni",
    note: "Nota (facoltativa)",
    partialHint: "Scrivi cosa manca: ci aiuta a chiedere il resto.",
    naReason: "Perché da voi non si applica?",
    naHint: "Lateral Space e chi segue il caso d'uso nella tua azienda lo controllano prima di chiudere la domanda.",
    naUndo: "Annulla: rispondo alla domanda",
    addNote: "Aggiungi una nota",
    attach: "Allega un file",
    estimate: "È una stima",
    partial: "Ho risposto solo in parte",
    delegate: "Chiedi a un'altra persona",
    notApplicable: "Da noi non si applica",
    /** La fonte del dato: Sistema, Documento, Calcolo, A memoria. Dentro «Altre opzioni» è già facoltativa. */
    source: "Da dove viene?",
  }),

  /** R3, «Non lo so»: un pannello calmo. */
  dontKnow: Object.freeze({
    lead: "Va benissimo: ci dice cosa manca.",
    who: "Chi potrebbe saperlo? (facoltativo)",
    whoPlaceholder: "Per esempio: l'ufficio acquisti",
    delegate: "Chiedi a un'altra persona",
  }),

  /** R1b, l'inizio di un argomento. */
  intro: Object.freeze({
    instructions: "Istruzioni",
    start: "Inizia",
    delegateTopic: "Gira tutto l'argomento a un'altra persona",
  }),

  /** R6, «Controlla e invia». */
  review: Object.freeze({
    title: "Controlla e invia",
    ready: (n: number) => (n === 0 ? "Non ci sono risposte pronte." : `${plural(n, "risposta pronta", "risposte pronte")}.`),
    partial: (sent: number, failed: number) => `${count(sent)} ${sent === 1 ? "inviata" : "inviate"}, ${count(failed)} da sistemare.`,
    offline: "Sei offline. Quello che hai scritto resta su questo telefono; per inviare serve la connessione.",
    fix: "Sistema",
    edit: "Modifica",
    later: (n: number) => plural(n, "lasciata per dopo", "lasciate per dopo"),
    answerNow: "Rispondi ora",
    afterSend: "Dopo l'invio le controlla Lateral Space: nel frattempo non si modificano.",
    sending: "Invio in corso…",
    send: (n: number) => `Invia ${plural(n, "risposta", "risposte")}`,
    continueLater: "Continua più tardi",
  }),

  /** R7, «Inviate». */
  sent: Object.freeze({
    title: "Inviate. Grazie!",
    text: "Lateral Space le controlla e ti scrive solo se serve un chiarimento.",
    next: (topic: string) => `Prossimo: ${topic}`,
    continue: "Continua",
    enough: "Basta per oggi",
  }),

  /** R5, «Chiedi a un'altra persona» (§4.1): genere neutro, niente pronomi. */
  delegate: Object.freeze({
    title: "Chiedi a un'altra persona",
    back: "Indietro",
    leadEmail: "Mandiamo noi un link personale, solo per le domande che scegli.",
    leadCopy: "Ti diamo un link personale da mandare, solo per le domande che scegli.",
    name: "Nome e cognome",
    email: "Email di lavoro",
    message: "Un messaggio (facoltativo)",
    which: "Quali domande giri",
    onlyThis: "Solo questa domanda",
    topic: (n: number, topic: string) => `Le ${count(n)} domande aperte di «${topic}»`,
    choose: "Scelgo io…",
    group: (title: string, chosen: number, total: number) => `${title} (${count(chosen)} di ${count(total)})`,
    sendEmail: "Manda il link",
    createLink: "Crea il link",
    checkFields: "Controlla i campi segnati.",
    toApprove: (name: string) => `Prima di mandarlo, Lateral Space controlla l'indirizzo di ${name}. Intanto queste domande escono dalla tua lista.`,
    copy: (name: string) => `Copia il link e mandalo a ${name}. Lo vedi solo adesso.`,
    doneOne: (name: string) => `Fatto: la domanda passa a ${name}. Non è più nella tua lista.`,
    doneMany: (n: number, name: string) => `Fatto: ${count(n)} domande passano a ${name}. Non sono più nella tua lista.`,
    backHome: "Torna agli argomenti",
    linkLabel: (name: string) => `Link per ${name}`,
    copied: "Link copiato",
    copyLink: "Copia il link",
  }),

  /** R8, il chiarimento di Lateral Space. */
  clarification: Object.freeze({
    asks: "Lateral Space ti chiede",
    before: "La tua risposta di prima: ",
    reply: "La tua risposta",
    rightValue: "Il valore corretto",
    rightValueLabel: (title: string) => `${title}: valore corretto`,
    correct: "Correggi anche il valore",
    send: "Invia la risposta",
  }),
});
