/**
 * «Chiedi al referente»: tutti i testi italiani, parola per parola dalla SPEC (§4, §5, §P2.10).
 * La pagina pubblica e il capitolo «Cosa serve» li importano da qui e non scrivono testi propri.
 *
 * Regole dei testi (copy-guard e `copy.test.ts`): nella dashboard «use case», mai «caso d'uso»;
 * (rilascio 5.1, decisione del titolare del 04/11/2026) sulla pagina pubblica `/rispondi` e nelle
 * email «caso d'uso», mai «use case» (REFERENT_PUBLIC_TEXT, REFERENT_CHECK_TEXT, l'informativa, i
 * messaggi della pagina pubblica); frasi corte e attive; niente «token», «MCP», «workflow»; gli stati delle informazioni si chiamano come nel
 * modulo di «Cosa serve» («A posto», «Risposta parziale», «Manca il dato»), mai con i nomi interni.
 * I segnaposto `{Nome}`, `{Azienda}`, `{data}`… li riempiono le funzioni di questo modulo.
 *
 * Modulo puro: import relativi `.ts`, si usa anche nei componenti client.
 */

/** Riempie `{chiave}` con i valori dati; i segnaposto senza valore restano com'erano. */
export function fillText(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (whole, key: string) => (Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole));
}

/** Il nome dell'azienda come lo leggono i testi: il nome del workspace, oppure «la tua azienda». */
export function companyLabel(name: string | null | undefined): string {
  const clean = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
  return clean || "la tua azienda";
}

// ─── Capitolo «Cosa serve», revisori (§5.2) ──────────────────────────

export const REFERENT_UI_TEXT = Object.freeze({
  // Riga delle azioni
  prepare: "Prepara le domande",
  ask: "Chiedi al referente",
  // Avvisi che bloccano «Chiedi al referente»
  gates: Object.freeze({
    subprocessorsCanDeclare: "{Azienda} deve autorizzare i fornitori che usiamo, per esempio quello delle email: puoi farlo tu, in Impostazioni › Sub-responsabili.",
    // (Rilascio 5.1) Lateral Space, con un ruolo da revisore che autorizza, registra l'ok per conto del cliente.
    subprocessorsLsCanDeclare: "Manca l'ok di {Azienda} sui fornitori che usiamo, per esempio quello delle email: puoi registrarlo tu per conto di {Azienda}, in Impostazioni › Sub-responsabili.",
    subprocessorsOther:
      "{Azienda} deve autorizzare i fornitori che usiamo, per esempio quello delle email. La dà una persona di {Azienda} con ruolo Sponsor esecutivo, Responsabile della trasformazione o Responsabile di funzione, oppure Lateral Space per suo conto, in Impostazioni › Sub-responsabili.",
    subprocessorsLink: "Apri Impostazioni",
    emailNotConfigured: "Le email non sono ancora attive: per ora non possiamo scrivere al referente.",
    publicWritesOff: "Le risposte dal link non sono attive in questo momento: per ora non possiamo scrivere al referente. Riprova più tardi.",
    emailNotVerified: "Per chiedere serve un account con l'email verificata: le risposte all'email arrivano a te.",
    noQuestions: "Non ci sono domande da fare: aggiungile in «Cosa serve» o usa «Prepara le domande».",
    // Sulla scheda, al posto di `noQuestions`, quando «Prepara le domande» non ha niente da aggiungere
    // e quindi non c'è: nomina solo il pulsante che c'è.
    noQuestionsPage: "Non ci sono domande da fare: aggiungile con «Aggiungi».",
  }),
  // Riga di un'esigenza (composta da `needReferentLine`)
  needLine: Object.freeze({
    askedTo: "Chiesta a {Nome} il {data}",
    reminded: " · Promemoria inviato il {data}",
    lastReminder: " · Ultimo promemoria il {data}",
    answered: " · Risposta ricevuta il {data}",
    dontKnow: " · Risposta: «Non ce l'ho» ({data})",
    expired: "Link scaduto il {data} senza risposta",
    revoked: "Link revocato il {data}",
    notSent: "Email non ancora partita",
    forOther: " (per {CODE})",
  }),
  silentTag: "Senza risposta",
  entriesSummary: "Risposte e file · {n}",
  entryHeader: "{autore} · {data}",
  teamAuthor: "{Nome} (team)",
  teamAuthorFallback: "Il team",
  referentAuthorFallback: "Referente",
  dontKnowAnswer: "Non ce l'ha",
  /** (Rilascio 5, §9.4) Le chiusure nuove del referente sotto l'esigenza. */
  alreadyAttachedAnswer: "Dice che è già allegato",
  whoMightKnow: "Chi potrebbe saperlo: «{testo}»",
  commentLine: "Commento: «{testo}»",
  removeAnswer: "Elimina la risposta",
  removeAnswerConfirmTitle: "Eliminare la risposta?",
  removeAnswerConfirmText: "Il testo si cancella e non si può recuperare.",
  removeConfirm: "Elimina",
  fileDownload: "Scarica",
  fileDelete: "Elimina",
  fileDeleteConfirmTitle: "Eliminare il file?",
  fileDeleteConfirmText: "Non si può recuperare.",
  fileInReview: "Da controllare: PDF con poco testo",
  fileReviewExpired: "File non controllato in tempo: chiedi di caricarlo di nuovo.",
  fileDownloadToReview: "Scarica per controllarlo",
  fileAccept: "Accetta il file",
  fileReject: "Rifiuta il file",
  fileRejectConfirmTitle: "Rifiutare il file?",
  fileRejectConfirmText: "Il file si cancella.",
  fileRejectConfirm: "Rifiuta",
  rowAddAnswer: "Aggiungi una risposta",
  rowAttachFile: "Allega un file",
  // Blocco «Richieste»
  requestsHeading: "Richieste",
  /** Il titolo, chiuso di default, delle richieste di «Cosa serve» della scheda (rilascio 3). */
  requestsSentSummary: "Richieste inviate · {n}",
  requestLines: Object.freeze({
    sent: "Inviata il {data} · scade il {scadenza}",
    reminded: "Promemoria inviato il {data}",
    lastReminder: "Ultimo promemoria inviato il {data}",
    nextReminder: "Prossimo promemoria dal {data}",
    completed: "Risposte ricevute il {data}",
    revoked: "Revocata il {data}",
    expired: "Scaduta il {data}",
  }),
  notices: Object.freeze({
    remindersStopped: "Promemoria fermi: serve l'autorizzazione dei fornitori in Impostazioni › Sub-responsabili.",
    emailChanged: "L'email del referente è cambiata: il vecchio link non vale più. Con «Manda un promemoria» parte un link nuovo.",
  }),
  emailState: Object.freeze({ in_partenza: "Email in partenza", non_partita: "Email non partita: riprova l'invio" }),
  remind: "Manda un promemoria",
  remindReasons: Object.freeze({
    alreadyToday: "Oggi a {Nome} è già partita un'email: puoi mandare un promemoria domani.",
    notSent: "L'email della richiesta non è ancora partita: usa «Riprova l'invio».",
    closed: "Questa richiesta è chiusa.",
    noOpen: "Non ci sono più domande aperte in questa richiesta.",
    gate: "Per ora non possiamo scrivere al referente.",
  }),
  add: "Aggiungi domande",
  addConfirm: "Aggiungi alla richiesta",
  addReasons: Object.freeze({
    nothing: "Non ci sono altre domande da aggiungere.",
    full: "Questa richiesta ha già 20 domande.",
    closed: "Questa richiesta è chiusa.",
  }),
  revoke: "Revoca il link",
  revokeConfirmTitle: "Revocare il link?",
  revokeConfirmText: "{Nome} non potrà più rispondere da questo link. Le risposte già arrivate restano.",
  revokeConfirm: "Revoca",
  askAgain: "Chiedi di nuovo",
  askAgainLiveHint: "Il link di prima smette di funzionare e ne parte uno nuovo, valido 30 giorni.",
  retry: "Riprova l'invio",
  more: "Altro",
  correctEmail: "Correggi l'email",
  correctEmailInDossier: "Questo referente è anche in un dossier: l'email si corregge in «Persone» del dossier.",
  erase: "Cancella i dati di questa persona",
  eraseConfirmTitle: "Cancellare i dati di {Nome}?",
  eraseConfirmText:
    "Cancelliamo le sue risposte e i suoi file su tutti gli use case di questo workspace e revochiamo i suoi link. Le domande aperte tornano da chiedere. Non si può annullare.",
  eraseConfirm: "Cancella i dati",
  // Finestra «Chiedi al referente» in tre passi (rilascio 4): «A chi», «Cosa chiedi», «Controlla e invia».
  askDialog: Object.freeze({
    title: "Chiedi al referente",
    titleAgain: "Chiedi di nuovo",
    steps: Object.freeze({ label: "Passi", who: "A chi", what: "Cosa chiedi", check: "Controlla e invia", done: " (fatto)", now: " (adesso)" }),
    cancel: "Annulla",
    next: "Avanti",
    back: "Indietro",
    nextOne: "Avanti · 1 domanda",
    nextMany: "Avanti · {n} domande",
    send: "Invia a {Nome}",
    close: "Chiudi",
    // Passo 1 «A chi»
    whoLabel: "A chi chiedi?",
    whoLead: "Scegli chi conosce i dati: ti proponiamo solo le domande che lo riguardano.",
    whoMissing: "Scegli un referente",
    suffix: Object.freeze({ senza_email: "(senza email)", lateral_space: "(di Lateral Space)", richiesta_aperta: "(richiesta già aperta)", sei_tu: "(sei tu)", referente: "(è il referente)" }),
    // (Parte 3) Il contatto è un revisore del workspace: in coda alla riga, « · Fa parte del team».
    teamTag: "Fa parte del team",
    // (Parte 3) Sotto l'elenco, quando chi guarda è tra i contatti (riga «(sei tu)», non si sceglie).
    selfHint: "Non serve chiedere a te stesso: rispondi direttamente qui in «Cosa serve», con «Aggiungi una risposta» o «Allega un file».",
    // (Referente già iscritto) I due gruppi dell'elenco, quando ci sono anche persone del workspace.
    contactsGroup: "Referenti",
    membersGroup: "Persone del workspace",
    peopleLoading: "Carico le persone del workspace…",
    peopleFailed: "Adesso non riesco a mostrare le persone del workspace: puoi scegliere un referente o una persona nuova.",
    newPerson: "Una persona nuova",
    newName: "Nome e cognome",
    newEmail: "Email",
    newRole: "Ruolo (facoltativo)",
    newHint: "Una persona del cliente. Non può avere un'email di Lateral Space.",
    otherRequestsHint: "{Nome} ha già domande aperte su altri use case: i promemoria arriveranno in un'unica email.",
    // Passo 2 «Cosa chiedi»
    whatHeading: "Cosa chiedi a {Nome}?",
    againTo: "A {Nome} · {email}",
    questionsNone: "Nessuna domanda è segnata per {Nome}: scegli tu.",
    questionsOthers: "Altre domande di questo use case · {n}",
    questionsEmpty: "Non ci sono ancora domande da fare.",
    // «Aggiungi domande» (una richiesta viva): il titolo dell'elenco e il suggerimento.
    questionsLabel: "Cosa chiedi",
    questionsHint: "Il referente vede solo il testo delle domande, non i dettagli.",
    // Sotto «Cosa chiedi», accanto a «Prepara le domande», quando mancano domande standard.
    prepareHintOne: "Aggiunge una domanda standard, già spuntata.",
    prepareHintMany: "Aggiunge {n} domande standard, già spuntate.",
    // Il messaggio sta chiuso sotto questo titolo; aperto ha la sua etichetta.
    messageAdd: "Aggiungi un messaggio",
    messageLabel: "Messaggio (facoltativo)",
    messagePlaceholder: "Per esempio: ci serve per la stima di fine mese.",
    // (Rilascio 5.1) Nomi, email e telefoni passano, come per il referente.
    messageHint: "Non scrivere dati sanitari, codici fiscali o date di nascita.",
    // Passo 3 «Controlla e invia»
    checkHeading: "Ecco l'email che riceve {Nome}.",
    previewLabel: "Anteprima dell'email",
    from: "Da",
    to: "A",
    subject: "Oggetto",
    toValue: "{Nome} · {email}",
    questionsOnLink: "Aprendo il link trova queste domande:",
    replyNote: "Le risposte all'email arrivano a te ({tuaEmail}). Se serve, partono due promemoria dopo 3 e 7 giorni lavorativi.",
    newTab: " (si apre in una nuova scheda)",
    // Dopo l'ok sui fornitori dato in un'altra scheda, una volta sola.
    okGiven: "Ok di {Azienda} dato.",
    okSend: " Puoi inviare.",
  }),
  correctDialog: Object.freeze({
    title: "Correggi l'email",
    field: "Email nuova",
    hint: "Il vecchio link smette di funzionare. Con «Manda un promemoria» parte un link nuovo al nuovo indirizzo.",
    confirm: "Correggi",
  }),
  answerDialog: Object.freeze({
    title: "Aggiungi una risposta",
    field: "Risposta",
    hint: "La vedono solo le persone che valutano gli use case. Non scrivere dati sanitari, codici fiscali o date di nascita.",
    confirm: "Salva la risposta",
    /** (Parte 2) «L'ho già verificata»: l'informazione diventa «A posto» nello stesso passo. */
    validate: "L'ho già verificata: segna l'informazione come «A posto»",
  }),
  fileDialog: Object.freeze({
    title: "Allega un file",
    help: "PDF, Word, Excel, PowerPoint, CSV o testo. Fino a 20 MB. Niente foto.",
    helpServerOnly: "PDF, Word, Excel, PowerPoint, CSV o testo. Fino a 4 MB. Niente foto.",
    confirm: "Allega",
    /** «Allega» premuto senza aver scelto un file. */
    chooseFile: "Scegli un file da allegare.",
    /** (Parte 2) */
    validate: "L'ho già verificata: segna l'informazione come «A posto»",
  }),
  toasts: Object.freeze({
    prepareOne: "Aggiunta una domanda a «Cosa serve».",
    prepareMany: "Aggiunte {n} domande a «Cosa serve».",
    prepareAlready: "Le domande che servono sono già in «Cosa serve».",
    prepareNothing: "Su questa scheda non manca niente da chiedere.",
    sent: "Richiesta inviata a {Nome}.",
    addedEmail: "Domande aggiunte: avvisiamo {Nome} con un'email.",
    addedSameLink: "Domande aggiunte: {Nome} le trova nello stesso link.",
    remindedNow: "Promemoria inviato.",
    remindedLater: "Il promemoria parte il prossimo giorno lavorativo, in mattinata.",
    revoked: "Link revocato.",
    retried: "Invio riprovato.",
    emailCorrected: "Email corretta. Con «Manda un promemoria» parte il link al nuovo indirizzo.",
    erased: "Dati cancellati.",
    erasedHubOnly: "Abbiamo cancellato i dati raccolti con gli use case. La persona è anche in un dossier: lì i dati li cancella Lateral Space.",
    answerAdded: "Risposta aggiunta.",
    answerAddedValidated: "Risposta aggiunta e informazione segnata «A posto».",
    answerRemoved: "Risposta eliminata.",
    fileAttached: "File allegato.",
    fileAttachedReview: "File allegato: è un PDF con poco testo, lo controlla un'altra persona del team. Conta come risposta quando è accettato.",
    fileAttachedValidated: "File allegato e informazione segnata «A posto».",
    fileAttachedReviewValidate: "File allegato: è un PDF con poco testo, lo controlla un'altra persona del team. Conta come risposta quando è accettato, e l'informazione resta da verificare.",
    fileDeleted: "File eliminato.",
    fileAccepted: "File accettato.",
    fileRejected: "File rifiutato.",
  }),
});

// ─── Stati delle richieste (§5.2; rilascio 4 §11) ────────────────────

/**
 * (Rilascio 4) La parola di una richiesta in «Richieste inviate», una sola e senza colore: i cinque
 * colori restano quelli dei gruppi di «Cosa serve». «Nessuna risposta» è la parola della campanella
 * per lo stesso fatto.
 */
export const REFERENT_REQUEST_WORD = Object.freeze({
  waiting: "In attesa",
  silent: "Nessuna risposta",
  answered: "Risposte ricevute",
  closed: "Chiusa",
});

// ─── La stima del tempo (rilascio 5, §3.3) ───────────────────────────

/**
 * (Rilascio 5) La stima del team in parole semplici, sempre in ore di lavoro (mai euro, quote o
 * punteggi): la vede il referente al passo «Il tempo», chi chiede in «Cosa riceve {Nome}», il team sulla
 * scheda. `estimate.ts` sceglie quale frase e riempie i numeri.
 */
export const REFERENT_ESTIMATE_TEXT = Object.freeze({
  hoursOne: "1 ora di lavoro l'anno",
  hoursLess: "meno di un'ora di lavoro l'anno",
  hoursMany: "{n} ore di lavoro l'anno",
  question: "Il team stima {ore}: ti torna?",
  statement: "Il team stima {ore}.",
  /** Sempre «volte»: l'unità del modello è scritta al singolare («pratica in entrata») e dopo un numero non si legge. */
  perMonth: "Circa {volte} al mese, {minuti} ogni volta.",
  perYear: "Circa {volte} l'anno, {minuti} ogni volta.",
  timesOne: "1 volta",
  timesMany: "{n} volte",
  minutesOne: "1 minuto",
  minutesMany: "{n} minuti",
});

// ─── L'impatto, per ogni beneficio (rilascio 5.1) ────────────────────

/**
 * (Rilascio 5.1) Il passo «L'impatto» della pagina del referente: una riga per ogni voce di «Benefici e
 * costi», con parole semplici. Una voce a ore dice volte e minuti, una voce in euro la sua cifra, una voce
 * qualitativa solo il suo nome; senza i numeri del team si chiedono i due numeri. `impact-text.ts` sceglie
 * la frase e riempie i numeri. Mai quote, ore liberate, fiducia, fonti o punteggi.
 */
export const REFERENT_IMPACT_TEXT = Object.freeze({
  title: "Cosa cambia, secondo il team",
  ore: "{label}: circa {volte} al mese, {minuti} ogni volta. Ti torna?",
  oreYear: "{label}: circa {volte} l'anno, {minuti} ogni volta. Ti torna?",
  oreNumbers: "{label}: quante volte al mese, e quanti minuti ogni volta?",
  euro: "{label}: circa {euro} l'anno. Ti torna?",
  // (Rilascio 5.1, decisione del titolare del 04/11/2026) «Ti torna?» come sulle cifre del team.
  fatto: "{label}. Ti torna?",
  /** Il nome finisce già con «?» o «!». */
  fattoBare: "{label} Ti torna?",
  euroAmount: "{n} €",
  euroLess: "meno di 1 €",
  yes: "Sì",
  less: "È di meno",
  more: "È di più",
  no: "No",
  dunno: "Non so",
  numbersLead: "Se vuoi, dacci i tuoi numeri:",
  euroLead: "Se vuoi, dacci la tua cifra:",
  perMonth: "Volte al mese",
  minutesEach: "Minuti ogni volta",
  eurYear: "Euro l'anno",
  numbersMissing: "Scrivi quante volte al mese e quanti minuti ogni volta.",
  /** (Rilascio 5.1) Una voce a ore senza i numeri del team: i due numeri, oppure «Non so». */
  numbersOrDunno: "Scrivi i due numeri, oppure scegli «Non so».",
  invalid: "Scrivi un numero, per esempio 20 o 1,5.",
  pick: "Scegli una risposta.",
  missingOne: "Manca ancora una risposta: la trovi evidenziata.",
  missingMany: "Mancano ancora {n} risposte: le trovi evidenziate.",
  addComment: "Aggiungi un commento",
  commentLabel: "Commento (facoltativo)",
  commentPlaceholder: "Per esempio: succede solo a fine mese.",
  stale: "Il team ha appena cambiato la stima: controlla di nuovo.",
  /** Dopo l'invio, in sola lettura. */
  sentYes: "{label}: sì.",
  sentLess: "{label}: è di meno.",
  sentMore: "{label}: è di più.",
  sentNo: "{label}: no.",
  sentDunno: "{label}: non so.",
  sentNothing: "{label}: nessuna risposta.",
  sentNumbers: "{label}: {n} volte al mese, {m} ogni volta.",
  sentTimesTail: " {n} volte al mese, {m} ogni volta.",
  sentEuroTail: " Circa {euro} l'anno.",
  sentComment: "Commento: {testo}",
});

// ─── «Scegli il referente» e il blocco «Referente» (rilascio 5, §8, §9) ─

/**
 * (Rilascio 5, §8.2) La finestra di una schermata che sceglie il referente e gli manda subito il suo
 * compito: la conferma dello use case, la stima del tempo e poche domande.
 */
export const REFERENT_ASSIGN_TEXT = Object.freeze({
  title: Object.freeze({ scegli: "Scegli il referente", cambia: "Cambia referente", di_nuovo: "Chiedi di nuovo", chiedi: "Chiedi al referente" }),
  // (Rilascio 5.1) L'impatto: ogni voce di «Benefici e costi», o il tempo senza modello del valore.
  leadMany: "Riceve subito un'email: conferma lo use case e l'impatto, poi risponde a {n} domande.",
  leadOne: "Riceve subito un'email: conferma lo use case e l'impatto, poi risponde a una domanda.",
  leadNone: "Riceve subito un'email: conferma lo use case e l'impatto.",
  askMany: "{Nome} riceve subito un'email con {n} domande.",
  askOne: "{Nome} riceve subito un'email con una domanda.",
  changeHint: "{Nome} non riceve più promemoria e il suo link smette di funzionare.",
  replaceHint: "Le domande che ha già ricevuto passano qui: il link di prima smette di funzionare.",
  droppedOne: "Una frase della descrizione resta fuori: ha importi, percentuali o dati personali.",
  droppedMany: "{k} frasi della descrizione restano fuori: hanno importi, percentuali o dati personali.",
  whoLabel: "Chi è il referente?",
  isReferent: "(è il referente)",
  hasQuestions: "(ha già delle domande aperte)",
  to: "A {Nome} · {email}",
  questionsSome: "Domande · {t} di {a}",
  questionsAll: "Domande · {n}",
  fileRequired: "Serve un file",
  restOne: "L'altra resta da chiedere.",
  restMany: "Le altre {k} restano da chiedere.",
  questionsEmpty: "Nessuna domanda: conferma solo lo use case e l'impatto.",
  preview: "Cosa riceve {Nome}",
  previewSomeone: "Cosa riceve",
  onPage: "Nella pagina trova:",
  noTeamEstimate: "Nessuna stima del team: gli chiediamo quante volte al mese e quanti minuti.",
  send: "Invia a {Nome}",
  sendBare: "Invia",
  chooseFirst: "Scegli il referente.",
  sentReferent: "{Nome} è il referente: l'email parte adesso.",
  sent: "Richiesta inviata a {Nome}.",
  /** «Chiedi a un'altra persona» (§8.4): la finestra in tre passi per chi non è il referente. */
  other: "Chiedi a un'altra persona",
  hintsLead: "Secondo {Nome}, potrebbe saperlo:",
});

/** (Rilascio 5, §9.1, §9.2) Il blocco «Referente» della scheda e la riga sotto il titolo. */
export const REFERENT_BLOCK_TEXT = Object.freeze({
  heading: "Referente",
  headerLine: "Referente: {Nome} · {stato}",
  missing: "Manca il referente.",
  choose: "Scegli il referente",
  teamTag: "Fa parte del team",
  waitingLine: "{stato} · inviata il {inviata} · scade il {scade}",
  expiredLine: "{stato} · inviata il {inviata} · scaduta il {scade}",
  remindedTail: " · promemoria inviato il {data}",
  answeredOn: "Ha risposto il {data}.",
  confirmed: "Lo use case: confermato.",
  toCorrect: "Lo use case: da correggere.",
  corrected: "Lo use case: corretto il {data}.",
  noConfirm: "Lo use case: nessuna conferma.",
  timeTeam: "Il tempo: il team stimava {ore}.",
  timeNoTeam: "Il tempo: nessuna stima del team.",
  saysYes: "{Nome}: sì.",
  saysNothing: "{Nome}: nessuna risposta.",
  saysLess: "{Nome}: è di meno.",
  saysMore: "{Nome}: è di più.",
  numbersTail: " Circa {ore} ({n} al mese, {m}).",
  numbersNoTeam: "{Nome}: circa {ore} ({n} al mese, {m}).",
  teamChanged: "La stima del team è cambiata dopo la risposta.",
  // (Rilascio 5.1) La risposta per ogni voce di «Benefici e costi».
  benefitTeamOre: "{label}: il team stimava {ore}.",
  benefitTeamOreNone: "{label}: nessuna stima del team.",
  benefitTeamEuro: "{label}: il team stimava {euro} l'anno.",
  benefitTeamFatto: "{label}.",
  // (Rilascio 6, B.5) Sulle righe senza cifra la risposta a «Ti torna?»: «sì», «no», «non lo sa».
  saysHappens: "{Nome}: sì.",
  saysNotHappens: "{Nome}: no.",
  saysDunno: "{Nome}: non lo sa.",
  euroTail: " Circa {euro} l'anno.",
  benefitGone: "Questa voce non c'è più nella valutazione.",
  adoptedEuroToast: "Stima aggiornata: {prima} → {dopo} l'anno.",
  hoursShort: "{n} ore",
  hourOne: "1 ora",
  hourLess: "meno di un'ora",
  // Le azioni del team sulla risposta (§9.2, §9.3)
  done: "Fatto",
  adopt: "Usa la stima di {Nome}",
  keep: "Tieni la nostra",
  review: "Rivedi la stima",
  addEstimate: "Aggiungi alla stima",
  notNeeded: "Non serve",
  adoptedOn: "Stima del referente usata il {data}.",
  kept: "Tenuta la stima del team.",
  seenOn: "Vista il {data}.",
  notUsed: "Stima del referente non usata.",
  teamAdded: "Il team ha aggiunto una stima.",
  adoptedToast: "Stima aggiornata: {prima} → {dopo} ore di lavoro l'anno.",
  adoptChanged: "La stima del team è cambiata dopo la risposta: rivedila in «Valutazione del team».",
  /** «Aggiungi alla stima»: la voce nuova già scritta in «Modifica valutazione». */
  prefillLabel: "Lavoro di oggi",
  prefillBasis: "Stima del referente del {data}.",
  keptToast: "Fatto.",
  // Il menu «Altro» e le azioni sulla richiesta
  more: "Altro",
  change: "Cambia referente",
  askMore: "Chiedi al referente",
  revokeReferent: "{Nome} non è più il referente: il suo link smette di funzionare.",
});

// ─── Pagina pubblica (§4.4) ──────────────────────────────────────────

export const REFERENT_PUBLIC_TEXT = Object.freeze({
  brand: "Unbundle",
  footer: "Lateral Space via Unbundle.",
  requestedBy: "{Nome} ti chiede alcune informazioni.",
  messageTitle: "Il messaggio di {Nome}",
  states: Object.freeze({
    invalid: Object.freeze({ title: "Link non valido", text: "Questo link non è più valido. Chiedi a chi te l'ha mandato un link nuovo." }),
    revoked: Object.freeze({ title: "Link revocato", text: "Questo link non vale più. Se serve, chiedi a chi te l'ha mandato un link nuovo." }),
    expired: Object.freeze({ title: "Link scaduto", text: "Questo link è scaduto. Se serve, chiedi a chi te l'ha mandato un link nuovo." }),
    unavailable: Object.freeze({ title: "Non disponibile", text: "La pagina non è disponibile in questo momento. Riprova tra poco." }),
  }),
  questionOf: "Domanda {n} di {total}",
  sentOn: "Inviata il {data}",
  dontKnow: "Non ce l'ho",
  answerLabel: "La tua risposta",
  answerPlaceholder: "Scrivi qui. Bastano poche righe.",
  counter: "{n} di 4.000 caratteri",
  attach: "Allega un file",
  attachHelp: "PDF, Word, Excel, PowerPoint, CSV o testo. Fino a 20 MB. Niente foto.",
  attachHelpServerOnly: "PDF, Word, Excel, PowerPoint, CSV o testo. Fino a 4 MB. Niente foto.",
  fileStates: Object.freeze({
    in_quarantena: "Controllo in corso…",
    pulito: "Allegato",
    in_revisione: "Lo controlla il team prima di usarlo: puoi inviare lo stesso",
    rifiutato: "Non accettato. {message}",
  }),
  removeFile: "Togli",
  /**
   * (Rilascio 5.1) I rifiuti dei dati che qui non teniamo, detti con calma: nomi, email e telefoni nei
   * file passano, il controllo automatico resta.
   */
  fileRejected: Object.freeze({
    sanitario: "Il file ha dati sanitari, che qui non teniamo: non l'abbiamo salvato. Se ti serve, toglili e caricalo di nuovo.",
    identificativi: "Il file ha codici fiscali o date di nascita, che qui non teniamo: non l'abbiamo salvato. Se ti serve, toglili e caricalo di nuovo.",
    altriDati: "Il file ha IBAN, documenti d'identità o il sesso delle persone, che qui non teniamo: non l'abbiamo salvato. Se ti serve, toglili e caricalo di nuovo.",
    discriminatorio: "Il file ha preferenze su genere, età, origine o religione, che qui non teniamo: non l'abbiamo salvato. Se ti serve, toglile e caricalo di nuovo.",
  }),
  autosave: Object.freeze({ saved: "Salvato", saving: "Salvataggio…", error: "Non salvato: riprova" }),
  submit: "Invia",
  submitHint: "Invii solo le domande a cui hai risposto. Le altre restano qui: puoi tornare con lo stesso link fino al {data}.",
  thanksTitle: "Grazie, abbiamo ricevuto le tue risposte.",
  thanksSeen: "{Nome} le vede subito.",
  remainingOne: "Resta una domanda: puoi rispondere quando vuoi, entro il {data}.",
  remainingMany: "Restano {n} domande: puoi rispondere quando vuoi, entro il {data}.",
  backToQuestions: "Torna alle domande",
  completed: "Hai risposto a tutte le domande. Grazie!",
  empty: "Non ci sono più domande per te. Grazie per la disponibilità.",
  // (Parte 3) Una domanda a cui ha già pensato il team dalla scheda: in sola lettura, mai cosa ha scritto.
  handledByTeam: "Non serve più: ci ha già pensato il team.",
  privacyFooterLabel: "Come usiamo le tue risposte",
  /** La scheda d'errore imprevisto (`error.tsx`). */
  error: Object.freeze({
    title: "Qualcosa non ha funzionato",
    text: "Può essere un problema momentaneo di connessione. Le risposte che hai già inviato sono salve: riprova tra poco.",
    retry: "Riprova",
    reload: "Ricarica la pagina",
  }),
  /** Il caricamento, per i lettori di schermo (`loading.tsx`). */
  loading: "Caricamento…",
  uploading: "Carico e controllo il file…",
  /** Etichette accessibili: «Togli preventivo.pdf», l'elenco dei file di una domanda. */
  aria: Object.freeze({ removeFile: "Togli {file}", dismissRejected: "Nascondi {file}", files: "File allegati", closures: "Altri modi di chiudere la domanda" }),
  // (Rilascio 5) Ogni domanda si chiude: una risposta, un file, «Non ce l'ho» o «È già allegato».
  alreadyAttached: "È già allegato",
  whoKnows: "Chi potrebbe saperlo? (facoltativo)",
  whoKnowsPlaceholder: "Per esempio: l'ufficio acquisti, o tra una settimana.",
  addComment: "Aggiungi un commento",
  commentLabel: "Commento (facoltativo)",
  commentPlaceholder: "Per esempio: è nel file della domanda 2.",
  fileRequired: "Serve un file",
  questionsOne: "Una domanda",
  questionsMany: "{n} domande",
  questionsLead: "Per ognuna: rispondi, allega un file o scegli «Non ce l'ho».",
  savesItself: "Si salva da solo: puoi tornare fino al {data}.",
  doneCount: "{k} di {n} fatte",
  doneSuffix: " (fatta)",
  missingOne: "Manca ancora la domanda {k}.",
  missingMany: "Mancano ancora le domande {list}.",
  goToQuestion: "Vai alla domanda {k}",
  send: "Invia",
  thanksDone: "Grazie, è tutto.",
  thanksSeenNow: "{Nome} lo vede subito.",
  answeredOn: "Hai risposto il {data}. Grazie!",
  sentUseCaseYes: "Il caso d'uso: sì, è così.",
  sentUseCaseFix: "Il caso d'uso: da correggere.",
  sentTimeYes: "Il tempo: sì.",
  sentTimeLess: "Il tempo: è di meno.",
  sentTimeMore: "Il tempo: è di più.",
  sentTimeOwn: "Il tempo:",
  sentTimeNumbers: "{n} volte al mese, {m} minuti ogni volta.",
  sentComment: "Commento: {testo}",
  sentWhoKnows: "Chi potrebbe saperlo: {testo}",
  /**
   * (Rilascio 6) «Il filo con il team»: dopo «Invia» il link resta vivo. In alto «Da completare» con solo le
   * cose nuove (un chiarimento del team, una domanda nuova, la risposta a un tuo dubbio), sotto quello che hai
   * già inviato, con «Ho un dubbio», «Aggiungi qualcosa» e «Modifica». Mai chi del team ha scritto: «il team».
   */
  thread: Object.freeze({
    /** «Invia» con un messaggio per il team ancora aperto sotto una risposta. */
    composerOpen: "Hai un messaggio per il team ancora da inviare: invialo o annullalo.",
    newsTitle: "Da completare",
    newsOne: "Hai una novità.",
    newsMany: "Hai {n} novità.",
    sentTitle: "Già inviato",
    sentCount: "Già inviato · {n}",
    itemOf: "{k} di {n}",
    clarification: "Chiarimento",
    newQuestion: "Nuova domanda",
    teamReply: "Risposta del team",
    onAnchor: "Su «{testo}»",
    cut: "{testo}…",
    general: "Sul caso d'uso",
    teamAsks: "Il team chiede: «{testo}»",
    youAsked: "Il tuo dubbio: «{testo}»",
    replyLabel: "La tua risposta",
    replyPlaceholder: "Scrivi qui. Basta una riga.",
    replyMissing: "Scrivi la tua risposta.",
    lineTeamAsked: "Il team ha chiesto: «{testo}»",
    lineYouAnswered: "Hai risposto: «{testo}»",
    lineYouAsked: "Hai chiesto: «{testo}»",
    lineTeamAnswered: "Il team ha risposto: «{testo}»",
    lineYouAdded: "Hai aggiunto: «{testo}»",
    lineDate: " · {data}",
    updatedOn: "Aggiornata il {data}.",
    doubt: "Ho un dubbio",
    add: "Aggiungi qualcosa",
    edit: "Modifica",
    doubtLabel: "Che cosa non ti è chiaro?",
    doubtPlaceholder: "Per esempio: cosa intendete per pratica?",
    addLabel: "Che cosa vuoi aggiungere?",
    addPlaceholder: "Per esempio: d'estate sono il doppio.",
    editLabel: "La tua risposta",
    send: "Invia al team",
    cancel: "Annulla",
    empty: "Scrivi qualcosa prima di inviare.",
    sent: "Inviato. Il team lo vede subito.",
    generalDoubt: "Hai un dubbio sul caso d'uso?",
    missingOne: "Manca ancora il punto {k}.",
    missingMany: "Mancano ancora i punti {list}.",
    goTo: "Vai al punto {k}",
    aria: Object.freeze({
      doubtOn: "Ho un dubbio su «{testo}»",
      addOn: "Aggiungi qualcosa a «{testo}»",
      editOn: "Modifica la risposta a «{testo}»",
      thread: "Messaggi con il team",
    }),
  }),
});

// ─── La pagina del referente: la conferma e la stima (rilascio 5, §7) ─

/**
 * (Rilascio 5) I passi di una richiesta al referente: «Lo use case» (è descritto bene?), «L'impatto»
 * (rilascio 5.1: una riga per ogni voce di «Benefici e costi», REFERENT_IMPACT_TEXT; senza modello del
 * valore le due domande del tempo), «Le domande». Testi corti: il passo dice solo quello che serve per
 * rispondere.
 */
export const REFERENT_CHECK_TEXT = Object.freeze({
  requestedBy: "{Nome} ti ha indicato come referente.",
  // (Rilascio 5.1) Il passo 2 è l'impatto: ogni beneficio, non solo il tempo.
  steps: Object.freeze({ label: "Passi", useCase: "Il caso d'uso", time: "L'impatto", questions: "Le domande", done: " (fatto)", current: " (adesso)" }),
  confirm: Object.freeze({
    title: "È così?",
    group: "Il caso d'uso è descritto bene?",
    yes: "Sì, è così",
    fix: "Correggi",
    noteLabel: "Cosa cambieresti?",
    notePlaceholder: "Per esempio: le fatture arrivano anche via PEC.",
    noteMissing: "Scrivi cosa cambieresti.",
  }),
  // (Rilascio 5.1) Senza modello del valore: le due domande del tempo. Con un modello, REFERENT_IMPACT_TEXT.
  estimate: Object.freeze({
    noTeamTitle: "Quanto tempo vi prende questo lavoro?",
    noTeamTimes: "Quante volte al mese?",
    noTeamMinutes: "Quanti minuti ogni volta?",
    noTeamHint: "Basta una stima.",
    noTeamMissing: "Scrivi quante volte al mese e quanti minuti ogni volta.",
    invalid: "Scrivi un numero, per esempio 20 o 1,5.",
    stale: "Il team ha appena cambiato la stima: controlla di nuovo.",
  }),
  back: "Indietro",
  next: "Avanti",
  send: "Invia",
});

// ─── Informativa (§5.3) ──────────────────────────────────────────────

/**
 * L'informativa a due livelli della pagina pubblica, versione `ucq-2026-11-2` (rilascio 6: l'aiuto dell'AI; rilascio 5.1: nomi,
 * email e telefoni non si bloccano più, «basta che lo diciamo prima nelle informative», decisione del
 * titolare del 04/11/2026). Sopra due righe calme; il testo completo, intero, a un tocco. L'accettazione
 * si registra sulla richiesta con questa versione; una versione nuova mostra di nuovo il riquadro.
 * Testo legale da confermare con il titolare (indirizzo di contatto, 12 mesi).
 */
export const REFERENT_PRIVACY_NOTICE = Object.freeze({
  // (Rilascio 6) `ucq-2026-11-2`: una frase calma sull'aiuto dell'AI (decisione 2 del titolare dell'08/11/2026).
  version: "ucq-2026-11-2",
  title: "Prima di iniziare",
  lead: "Ti chiediamo del tuo lavoro, non di te.",
  summary: Object.freeze([
    "Le risposte e i file li vedono solo Lateral Space e chi valuta i casi d'uso di {Azienda}.",
    "Il link è solo tuo e vale fino al {data}.",
  ]),
  fullTextLabel: "Leggi l'informativa completa",
  paragraphs: Object.freeze([
    "Lateral Space raccoglie queste informazioni per conto di {Azienda}, per valutare e preparare il caso d'uso. Le usiamo solo per questo.",
    "Ti chiediamo informazioni sul lavoro, non su di te. Se scrivi il nome di un collega o alleghi un file con nomi, email o telefoni, li usiamo solo per questo caso d'uso. Non servono dati sanitari, codici fiscali, date di nascita o preferenze su genere, età, origine o religione: se ne troviamo, ti chiediamo di toglierli.",
    "Ogni file passa da un controllo automatico prima di essere usato.",
    "Per farti solo le domande che servono, un sistema di intelligenza artificiale può leggere le tue risposte e suggerire al team una domanda in più. Non decide niente e non scrive a nessuno: la domanda, se serve, la manda una persona del team.",
    "Salviamo le tue risposte, i file che alleghi, il tuo nome, l'email con cui ti abbiamo scritto e quando hai premuto «Iniziamo». Dell'indirizzo IP teniamo solo un'impronta cifrata, mai il numero, per due giorni.",
    "{Richiedente} e le altre persone di {Azienda} che valutano i casi d'uso vedono le tue risposte e quando sono arrivate. Non misuriamo i tuoi tempi e non facciamo classifiche tra persone.",
    "Teniamo risposte, messaggi e file per 12 mesi dopo la chiusura della richiesta o l'ultimo messaggio, poi li cancelliamo.",
    "Puoi chiedere di vedere, correggere o cancellare i tuoi dati scrivendo a {contatto}. Puoi anche fare reclamo al Garante per la protezione dei dati personali.",
    // (Rilascio 6) Ogni novità del team rinnova il link per 30 giorni.
    "Il link è personale e scade 30 giorni dopo l'ultima novità. Non inoltrarlo.",
  ]),
  footerLabel: "Come usiamo le tue risposte",
  button: "Iniziamo",
  error: "Non riesco a registrarlo. Riprova tra poco.",
});

/** I valori dei segnaposto dell'informativa. */
export interface PrivacyNoticeValues {
  /** Nome dell'azienda (workspace). */
  company: string;
  /** Data di scadenza già scritta («26 novembre 2026»). */
  expires: string;
  requester: string;
  contact: string;
}

/** L'informativa con i segnaposto riempiti. */
export function privacyNoticeTexts(v: PrivacyNoticeValues): { summary: string[]; paragraphs: string[] } {
  const values = { Azienda: companyLabel(v.company), data: v.expires, Richiedente: v.requester, contatto: v.contact };
  return {
    summary: REFERENT_PRIVACY_NOTICE.summary.map((t) => fillText(t, values)),
    paragraphs: REFERENT_PRIVACY_NOTICE.paragraphs.map((t) => fillText(t, values)),
  };
}

const ADDRESS = /<([^<>\s@]+@[^<>\s@]+)>\s*$|^([^<>\s@]+@[^<>\s@]+)$/;

/**
 * L'indirizzo dell'informativa per vedere, correggere o cancellare i dati:
 * `USE_CASE_REFERENTS_PRIVACY_EMAIL`, altrimenti il reply-to `UC_EMAIL_REPLY_TO` (in produzione
 * pierpaolo@lateralspace.ai), altrimenti l'indirizzo dentro `UC_EMAIL_FROM` (un sottodominio che può
 * non ricevere posta: per questo viene dopo il reply-to), altrimenti «chi ti ha mandato il link».
 */
export function REFERENT_PRIVACY_CONTACT(env: Readonly<Record<string, string | undefined>>): string {
  const explicit = env.USE_CASE_REFERENTS_PRIVACY_EMAIL?.trim();
  if (explicit && /^[^\s@<>]+@[^\s@<>]+$/.test(explicit)) return explicit;
  const reply = env.UC_EMAIL_REPLY_TO?.trim();
  if (reply && /^[^\s@<>,;"]+@[^\s@<>,;"]+$/.test(reply)) return reply.toLowerCase();
  const from = env.UC_EMAIL_FROM?.trim() ?? "";
  const m = ADDRESS.exec(from);
  const address = m?.[1] ?? m?.[2];
  return address ? address.toLowerCase() : "chi ti ha mandato il link";
}

// ─── Messaggi d'errore (§5.4, §4.3) ──────────────────────────────────

export const REFERENT_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  // Revisori
  funzione_spenta: "Questa funzione non è attiva per questo workspace.",
  permesso_mancante: "Non hai i permessi per farlo.",
  email_non_configurata: "Le email non sono ancora attive: per ora non possiamo scrivere al referente.",
  risposte_non_attive: "Le risposte dal link non sono attive in questo momento: per ora non possiamo scrivere al referente. Riprova più tardi.",
  sub_responsabili_mancanti: "Prima {Azienda} deve autorizzare i fornitori che usiamo, in Impostazioni › Sub-responsabili.",
  email_non_verificata: "Per chiedere serve un account con l'email verificata: le risposte all'email arrivano a te.",
  referente_non_valido: "Questo referente non è più attivo: scegline un altro.",
  // (Referente già iscritto) L'email scritta in «+ Nuovo referente» è di un referente disattivato.
  referente_disattivato: "Questa email è di un referente non più attivo: usa un altro indirizzo.",
  // (Referente già iscritto) Una persona del workspace che non si può più scegliere: non è mai stata un referente.
  persona_non_disponibile: "Questa persona non si può più scegliere: scegline un'altra.",
  email_mancante: "Scrivi l'email del referente.",
  email_mancante_esistente: "Questo referente non ha un'email: scegli un'altra persona o aggiungine una nuova.",
  email_non_valida: "Controlla l'indirizzo email del referente.",
  referente_lateral_space: "Il referente è una persona del cliente: non può essere di Lateral Space.",
  email_in_uso: "C'è già un referente con questa email: sceglilo dall'elenco.",
  referente_in_dossier: "Questo referente è anche in un dossier: l'email si corregge in «Persone» del dossier.",
  dati_non_validi: "Scrivi il nome del referente.",
  richiesta_aperta: "C'è già una richiesta aperta per questa persona su questo use case: usa «Aggiungi domande».",
  // (Parte 3) Chi chiede ha scelto se stesso.
  referente_sei_tu: "Sei tu il referente: non serve un'email. Rispondi direttamente qui in «Cosa serve», con «Aggiungi una risposta» o «Allega un file».",
  email_di_chi_chiede: "Questa è l'email di chi ha fatto la richiesta: chi chiede risponde direttamente in «Cosa serve». Scrivi l'email del referente.",
  nessuna_domanda: "Scegli almeno una domanda aperta.",
  troppe_domande: "Al massimo 20 domande per richiesta.",
  domande_cambiate: "Qualcuno ha appena cambiato queste domande. Ho ricaricato i dati: riprova.",
  messaggio_troppo_lungo: "Il messaggio può avere al massimo 1.000 caratteri.",
  richiesta_chiusa: "Questa richiesta è chiusa.",
  // (Rilascio 5) Un altro revisore ha scelto o cambiato il referente mentre la finestra era aperta.
  referente_gia_scelto: "Nel frattempo un collega ha cambiato il referente: ricarico la scheda.",
  referente_uguale: "È già il referente: scegli un'altra persona.",
  // (Rilascio 5) Lo use case non è più da valutare né approvato (avviato, archiviato) o è «Da diffondere».
  referente_non_previsto: "Questo use case non ha più un referente da scegliere: ricarico la scheda.",
  promemoria_gia_inviato: "Oggi a {Nome} è già partita un'email: puoi mandare un promemoria domani.",
  non_ancora_inviata: "L'email della richiesta non è ancora partita: usa «Riprova l'invio».",
  nessuna_domanda_aperta: "Non ci sono più domande aperte in questa richiesta.",
  riprova_non_ammessa: "L'email è già partita, oppure hai già riprovato tre volte.",
  versione_superata: "Qualcuno ha appena cambiato questa richiesta. Ho ricaricato i dati: riprova.",
  domanda_non_disponibile: "Questa esigenza non accetta risposte o file.",
  risposta_non_trovata: "Risposta non trovata.",
  risposta_vuota: "Scrivi la risposta.",
  testo_troppo_lungo: "Al massimo 4.000 caratteri.",
  troppi_file: "Al massimo 5 file per domanda.",
  file_non_trovato: "File non trovato.",
  revisore_uguale: "Il file lo controlla un'altra persona del team, non chi l'ha caricato.",
  revisione_non_ammessa: "Il controllo dei PDF lo fa chi può modificare «Cosa serve».",
  non_trovato: "Use case non trovato.",
  riprova: "Non riusciamo a salvare. Riprova.",
  // Pagina pubblica (§4.3)
  link_non_valido: "Questo link non è più valido. Chiedi a chi te l'ha mandato un link nuovo.",
  informativa_da_leggere: "Prima premi «Iniziamo».",
  informativa_cambiata: "L'informativa è cambiata: ricarica la pagina e leggila di nuovo.",
  gia_inviata: "Hai già inviato questa risposta.",
  risposte_da_correggere: "Alcune risposte vanno corrette: le trovi evidenziate.",
  nessuna_risposta: "Scrivi almeno una risposta, oppure scegli «Non ce l'ho».",
  risposta_vuota_pubblica: "Scrivi la risposta, scegli «Non ce l'ho» o allega un file.",
  non_so_con_file: "Hai allegato un file: togli «Non ce l'ho» oppure togli il file.",
  file_in_controllo: "Aspetta che finisca il controllo del file, poi invia.",
  file_gia_inviato: "Questo file è già stato inviato: non si può togliere.",
  modalita_non_disponibile: "Per questo file serve il caricamento diretto, che qui non è attivo: usa un file fino a 4 MB.",
  domanda_non_disponibile_pubblica: "Questa domanda non è più tra quelle per te.",
  pdf_in_revisione: "Questo PDF ha poco testo, forse è una scansione: lo controlla il team prima di usarlo. Puoi inviare lo stesso.",
  revisione_rifiutata: "Il file non è stato accettato dopo il controllo.",
  revisione_scaduta: "Il controllo del file non è stato fatto in tempo: caricalo di nuovo.",
  nessun_altro_revisore:
    "Questo PDF ha poco testo, forse è una scansione: lo deve controllare un'altra persona del team, e qui non c'è. Allega un PDF con testo, un DOCX o un file di testo.",
  quarantena_scaduta: "Il controllo del file non è finito: caricalo di nuovo.",
  // (Rilascio 5) La conferma dello use case e la stima del tempo.
  // Pagina pubblica: «caso d'uso» (rilascio 5.1).
  conferma_mancante: "Prima conferma il caso d'uso, o scrivi cosa cambieresti.",
  stima_mancante: "Prima rispondi sull'impatto: manca ancora una risposta.",
  stima_cambiata: "Il team ha appena cambiato la stima: controlla di nuovo.",
  numero_non_valido: "Scrivi un numero, per esempio 20 o 1,5.",
  nota_troppo_lunga: "Al massimo 1.000 caratteri.",
  // (Rilascio 5.1) Il commento di una riga del passo «L'impatto».
  commento_troppo_lungo: "Al massimo 500 caratteri.",
  // (Rilascio 5) «Invia» solo con ogni domanda chiusa.
  domande_aperte: "Mancano ancora alcune domande: le trovi evidenziate.",
  domande_aperte_una: "Manca ancora una domanda: la trovi evidenziata.",
  domanda_aperta: "Per chiudere: rispondi, allega un file o scegli «Non ce l'ho».",
  domanda_aperta_file: "Per chiudere: allega il file o scegli «Non ce l'ho».",
  domande_nuove: "Ci sono domande nuove: le trovi qui sotto.",
  // (Rilascio 6) «Il filo con il referente».
  testo_vuoto: "Scrivi la domanda.",
  riga_troppo_lunga: "Al massimo 300 caratteri.",
  chiarimento_aperto: "Su questa risposta c'è già un chiarimento in attesa.",
  filo_non_disponibile: "Questa risposta non accetta più chiarimenti: chiedi di nuovo al referente.",
  messaggio_non_trovato: "Messaggio non trovato: ricarico la scheda.",
  messaggio_gestito: "Qualcuno del team ha già risposto: ricarico la scheda.",
  filo_pieno: "Su questa richiesta ci sono già molti messaggi: chiedi di nuovo al referente.",
  suggerimento_non_trovato: "Questo suggerimento non c'è più: ricarico la scheda.",
  // Pagina pubblica: «caso d'uso».
  risposta_chiusa: "Il team ha già segnato questa informazione «A posto»: puoi aggiungere qualcosa.",
});

/** Il messaggio di un codice, con i segnaposto riempiti; un codice sconosciuto dà «Non riusciamo a salvare. Riprova.». */
export function referentErrorMessage(code: string, values: Readonly<Record<string, string | number>> = {}): string {
  const template = REFERENT_ERROR_MESSAGES[code] ?? REFERENT_ERROR_MESSAGES.riprova;
  return fillText(template, { ...values, ...(values.Azienda !== undefined ? { Azienda: companyLabel(String(values.Azienda)) } : {}) });
}

/**
 * (Rilascio 6) «Il filo con il referente» sulla scheda (dashboard: «use case»): «Chiedi un chiarimento» su
 * ogni risposta del referente, «Rispondi» a un suo dubbio, «Fatto» su una sua risposta, il turno, il
 * suggerimento dell'AI. Poche parole: una riga per messaggio, il resto un tocco più in là.
 */
export const REFERENT_THREAD_TEXT = Object.freeze({
  clarify: "Chiedi un chiarimento",
  clarifyTitle: "Chiedi un chiarimento",
  clarifyLead: "{Nome} lo riceve con lo stesso link.",
  clarifyLabel: "Che cosa vuoi sapere?",
  clarifyPlaceholder: "Per esempio: quanto, più o meno?",
  clarifySend: "Invia a {Nome}",
  clarifySent: "Chiarimento chiesto a {Nome}.",
  reply: "Rispondi",
  replyTitle: "Rispondi a {Nome}",
  replyLabel: "La tua risposta",
  replySend: "Invia a {Nome}",
  replySent: "Risposta inviata a {Nome}.",
  done: "Fatto",
  cancel: "Annulla",
  close: "Chiudi",
  hint: "Una riga. Non scrivere dati sanitari, codici fiscali o date di nascita.",
  heading: "Messaggi",
  turnReferent: "Tocca al referente",
  turnTeam: "Tocca a noi",
  header: "{autore} · {data}",
  onQuestion: "Su «{testo}»",
  onBenefit: "Su «{testo}»",
  general: "In generale",
  removed: "Testo cancellato.",
  pending: "Chiarimento in attesa: «{testo}»",
  answered: "{Nome} ha risposto: «{testo}»",
  updated: "Aggiornata il {data}.",
  suggestion: "Forse chiedere: «{testo}»",
  suggestionAsk: "Chiedi questo",
  suggestionDismiss: "Lascia stare",
  kind: Object.freeze({
    chiarimento: "chiede un chiarimento",
    dubbio: "ha un dubbio",
    risposta: "risponde",
    aggiunta: "aggiunge",
  }),
});
