/**
 * (Rilascio 10, docs/ui-10/PROPOSTA-10.md §4) Le parole della Formazione scritte fuori dai componenti: «Corso ·
 * Lezione · Esercizio · Prova · Risultato». Modulo puro.
 *
 * (Ondata 7a «Formazione», §3.9) Anche le parole della Formazione di chi segue un corso: l'ingresso (un corso solo:
 * dentro; più corsi: le card con «Prossima lezione») e la pagina del corso (la card «Adesso» con il solo pulsante
 * pieno, «Scaletta», «Esercizi», «Materiali», «Prossimi moduli», «Chi vede le tue risposte»). «AI», mai «IA»; genere
 * neutro; niente codici né fusi orari a schermo.
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
  /** Il ritorno alla Formazione del workspace, dalle pagine che non hanno un corso. */
  backToLearning: "Formazione",
  /** Il ritorno al corso, dalle pagine dentro un corso (esercizio, prova, idea, risultati, Gestisci). */
  backToCourse: "Torna al corso",
  /** L'attesa di una pagina della Formazione (`learning/loading.tsx`): vale per il corso, i risultati, Gestisci e il registro. */
  loading: "Caricamento…",

  /** L'ingresso della Formazione (`learning/page.tsx`): con un corso solo si entra diretti, altrimenti le card. */
  home: Object.freeze({
    title: "Formazione",
    /** La riga grigia della card: «Prossima lezione: lun 24 nov, 14:30». */
    nextLesson: (when: string) => `Prossima lezione: ${when}`,
    courses: "I tuoi corsi",
    manage: "Gestisci",
    off: "La formazione non è attiva in questo workspace.",
    empty: "Non hai ancora un corso in questo workspace.",
    emptyManager: "Nessun corso ancora: si prepara da Gestisci.",
  }),

  /** La pagina del corso (`program-overview.tsx`). */
  course: Object.freeze({
    /** Sotto il titolo: «La tua lezione: lunedì 24 novembre, 14:30–16:30». */
    lesson: (when: string) => `La tua lezione: ${when}`,
    /** Sotto il titolo, per chi tiene il corso e non lo segue. */
    trainerLine: "Vedi il corso come chi lo tiene: tutte le scalette e tutti i materiali.",
    results: "Risultati",
    manage: "Gestisci",

    /** La card «Adesso»: il solo pulsante pieno della pagina. */
    now: Object.freeze({
      title: "Adesso",
      /** Il «?» accanto al pulsante. */
      why: "È il passo che serve adesso, secondo l'ora della lezione e gli esercizi già fatti.",
      start: (title: string) => `Inizia: ${title}`,
      resume: (title: string) => `Continua: ${title}`,
      redo: (title: string) => `Rifai: ${title}`,
      download: "Scarica i materiali",
      /** Prima della lezione. */
      before: "Gli esercizi si aprono durante la lezione.",
      beforeNoMaterials: "Gli esercizi si aprono durante la lezione: non serve preparare niente.",
      /** In lezione. */
      live: "La lezione è in corso.",
      nextOpens: (time: string) => `Il prossimo esercizio si apre alle ${time}.`,
      nextOpensLater: "I prossimi esercizi si aprono durante la lezione.",
      allOpenDone: "Hai fatto tutti gli esercizi aperti.",
      suspended: "Le risposte sono sospese: riprendi quando chi tiene il corso le riapre.",
      /** Dopo la lezione: un numero solo. */
      done: (done: number, total: number) => `${done} di ${total} ${total === 1 ? "esercizio fatto" : "esercizi fatti"}`,
      toDo: (total: number) => (total === 1 ? "1 esercizio da fare" : `${total} esercizi da fare`),
      achieved: "Obiettivo raggiunto.",
      practice: "Alcuni punti da ripassare.",
      allDone: "Hai fatto tutti gli esercizi.",
      /** Senza una lezione in calendario. */
      noLesson: "La data della lezione non è ancora fissata.",
      closed: "Il corso è chiuso: le risposte salvate restano da rileggere.",
    }),

    /** «Scaletta»: aperta in lezione, con gli orari veri. */
    agenda: Object.freeze({
      title: "Scaletta",
      label: "Scaletta della lezione",
      here: "Siamo qui",
      /** Chi tiene il corso, senza una lezione: la durata del blocco. */
      minutes: (minutes: number) => `${minutes} min`,
    }),

    /** «Esercizi»: l'unico posto con gli esiti. */
    exercises: Object.freeze({
      title: "Esercizi",
      label: "Gli esercizi del corso",
      todo: "Da fare",
      inProgress: "In corso",
      saved: "Risposte salvate",
      submitted: "Consegnato",
      opensAt: (time: string) => `Si apre alle ${time}`,
      opensOn: (when: string) => `Si apre ${when}`,
      notOpen: "Non ancora aperto",
      closed: "Chiuso",
      /** «4 di 5 giuste». */
      score: (correct: number, total: number) => `${correct} di ${total} giuste`,
      minutes: (minutes: number) => `circa ${minutes} ${minutes === 1 ? "minuto" : "minuti"}`,
      notCounted: "non conta per il risultato",
      /** «Tutte le prove»: lo storico, che prima aveva una pagina sua («Il mio risultato»). */
      attempts: (n: number) => `Tutte le prove (${n})`,
      attempt: (title: string, number: number) => `${title} · ${number}ª prova`,
      review: "Rivedi",
      resume: "Continua",
      idea: "Dal corso al tuo lavoro",
    }),

    materials: Object.freeze({
      title: "Materiali",
      download: "Scarica",
      notYet: "Non ancora disponibile",
      forTrainers: "solo per chi tiene il corso",
    }),

    takeaways: Object.freeze({
      title: "Da portare a casa",
      nextSteps: "Prima del prossimo modulo",
    }),

    nextModules: Object.freeze({
      title: (n: number) => `Prossimi moduli (${n})`,
      dates: "Date",
      planned: "In programma: gli esercizi si aprono nella lezione di questo modulo.",
    }),

    privacy: Object.freeze({
      title: "Chi vede le tue risposte",
      retention: (days: number) => `Le risposte restano conservate ${days} giorni dopo la chiusura del corso.`,
      trainers: (names: string) => `Chi tiene il tuo corso: ${names}.`,
    }),

    /** «Vedi tutti (N)» sotto le prime tre righe di una lista. */
    showAll: (n: number) => `Vedi tutti (${n})`,
  }),

  /**
   * L'esercizio (`activity-player.tsx` e la pagina dell'esercizio non ancora aperto), §3.9: la barra fissa «3 di 5 ·
   * Invia» con una conferma breve; «Riprova l'esercizio» pieno quando c'è da ripassare; un errore in una frase, con
   * «Riprova» e «Altre opzioni». Le regole che lo salvano, lo controllano e lo inviano non cambiano.
   */
  exercise: Object.freeze({
    /** La barra fissa: il numero e il pulsante pieno. */
    progress: (done: number, total: number) => `${done} di ${total}`,
    progressLabel: "Parti completate",
    send: "Invia",
    sending: "Invio…",
    /** La conferma breve, nella finestra dell'app. */
    confirmTitle: "Inviare le risposte?",
    confirmQuiz: "Dopo l'invio non potrai cambiarle: vedi subito il risultato.",
    confirmDecisions: "Dopo l'invio non potrai cambiarle: poi confronti con l'esempio preparato.",
    confirmReflection: "Dopo l'invio vedi il risultato dell'esercizio.",
    cancel: "Annulla",
    /** L'esito. */
    retake: "Riprova l'esercizio",
    retakeOpening: "Apertura…",
    back: "Torna al corso",
    retakeBlocked: "Per ora non puoi riprovare l'esercizio.",
    /** Un problema: una frase, «Riprova» e il resto in «Altre opzioni». */
    retry: "Riprova",
    more: "Altre opzioni",
    copy: "Scarica una copia",
    refresh: "Aggiorna la pagina",
    openSaved: "Apri le risposte salvate",
    signIn: "Accedi di nuovo in una nuova scheda",
    conflict: "Queste risposte sono state cambiate in un'altra scheda.",
    conflictHelp: "Qui restano come le vedi: scaricane una copia prima di aggiornare la pagina.",
    technical: "Il salvataggio non è stato confermato. Le risposte restano qui.",
    unauthenticated: "La sessione è scaduta: accedi di nuovo in un'altra scheda, poi riprova qui.",
    fallback: "Qualcosa non ha funzionato. Le risposte restano qui.",
    readOnly: "Per ora non puoi cambiare o inviare queste risposte.",
    unsavedHere: "Le modifiche non salvate restano solo in questa pagina.",
    /** La copia leggibile delle risposte, nel file scaricato. */
    copyTitle: (title: string) => `Le mie risposte · ${title}`,
    copyQuestion: (n: number, prompt: string) => `Domanda ${n}: ${prompt}`,
    copyAnswer: (text: string) => `Risposta: ${text}`,
    copyNoAnswer: "Risposta: (nessuna)",
    copyMode: (mode: string) => `Come hai lavorato: ${mode}`,
    /** L'esercizio non ancora aperto: una frase sola e il controllo da solo. */
    opensAt: (time: string) => `Si apre alle ${time}, quando chi tiene il corso dà il via.`,
    opensOn: (when: string) => `Si apre ${when}, quando chi tiene il corso dà il via.`,
    notOpen: "Per ora non è aperto.",
  }),

  /**
   * Risultati (`results/page.tsx`, `results-*.tsx`), §3.9: l'H1 è il titolo del corso; due schede, «In aula» (senza
   * nomi, da proiettare) e «Persone» (con i nomi); un numero, «12 su 20 hanno finito»; «Presenta in aula» il solo
   * pulsante pieno; «Scarica» bordato in testata, con il suo pannello; le lezioni da scegliere solo se sono più d'una.
   */
  results: Object.freeze({
    tabs: Object.freeze({ label: "Sezioni dei risultati", group: "In aula", people: "Persone", locked: "serve un permesso" }),
    closed: "Chiuso alle nuove risposte",
    lessons: "Lezione",
    allLessons: "Tutte le lezioni",
    live: "In corso",
    /** Il numero della pagina. */
    finished: (done: number, total: number) => `${done} su ${total}`,
    finishedLabel: "hanno finito",
    finishedNote: (required: number) => (required === 1 ? "l'esercizio da fare" : `tutti i ${required} esercizi da fare`),
    updatedAt: "Aggiornato alle",
    showAnswers: "Mostra le risposte giuste",
    present: "Presenta in aula",
    noNames: "Qui non ci sono nomi: si può proiettare.",
    withNames: "Con i nomi: non proiettarla.",
    allNumbers: "Tutti i numeri",
    enrolled: "Iscritti",
    started: "Hanno iniziato",
    completed: "Hanno finito gli esercizi",
    achieved: "Obiettivo raggiunto",
    leftOut: (turns: number, minimum: number) =>
      turns === 1
        ? `Una lezione con meno di ${minimum} iscritti non è contata qui: i suoi risultati restano privati.`
        : `${turns} lezioni con meno di ${minimum} iscritti non sono contate qui: i loro risultati restano privati.`,
    suppressed: (minimum: number) => `I risultati di gruppo compaiono quando nella lezione ci sono almeno ${minimum} iscritti.`,
    refreshesItself: "La pagina si aggiorna da sola.",
    noExercises: "Questo corso non ha ancora esercizi.",
    submitted: (n: number, total: number) => `${n} su ${total} hanno consegnato`,
    answering: (n: number) => (n === 1 ? "1 persona sta ancora rispondendo" : `${n} persone stanno ancora rispondendo`),
    optional: "facoltativo",
    hiddenUntil: (minimum: number, now: number) => `Le risposte compaiono da ${minimum} consegne (ora ${now}).`,
    hiddenAllLessons: (minimum: number) => `Con tutte le lezioni insieme, le risposte compaiono quando ogni lezione ha almeno ${minimum} consegne. Scegli una lezione per vederle.`,
    noPeople: "Ancora nessun iscritto in questa lezione.",
    peopleArrive: "Le persone compaiono qui appena entrano nel corso.",
    openAnswers: "Tocca un risultato per leggere le risposte.",
    /** «Scarica»: il pannello, con le colonne in una piega. */
    download: "Scarica",
    downloadTitle: "Scarica l'elenco",
    downloadText: "Una riga per ogni persona e per ogni volta che ha fatto un esercizio, di tutte le lezioni che puoi vedere. Si apre in Excel.",
    downloadColumns: "Le colonne",
    downloadButton: "Scarica l'elenco",
    downloadCare: "L'elenco ha nomi ed email: ogni download resta nello storico delle operazioni del corso.",
    manage: "Gestisci",
    /** Un permesso che manca, solo per chi gestisce il corso. */
    lockedTitle: (section: string) => `${section}: serve un permesso`,
    grantSelf: "Attiva per me",
    grantSelfNote: "Gestisci tu il corso: puoi darti questo permesso. Resta nello storico delle operazioni del corso.",
  }),

  /** «Gestisci formazione» (`admin-catalog.tsx`), audit Fuori §4.10: i corsi in righe, il registro, «Nuovo corso». */
  catalog: Object.freeze({
    newCourse: "Nuovo corso",
    courses: (n: number) => (n === 1 ? "Il corso" : `I corsi (${n})`),
    open: "In corso",
    closed: "Chiuso",
    visible: "visibile",
    hidden: "nascosto",
    someLessons: "solo alcune lezioni",
    emptyCreate: "Nessun corso ancora: si comincia da «Nuovo corso».",
    emptyAsk: "Nessun corso da gestire: chiedi il permesso a chi tiene il corso.",
    register: "Registro della formazione AI",
    registerFact: "Chi ha partecipato, quando, a quale contenuto",
    step1: "Scegli il file del corso e controllalo.",
    step2: "Leggi il riepilogo: moduli, lezioni ed esercizi.",
    step3: "Dai il nome, l'informativa e la conservazione, poi importa.",
    packLabel: "Il file del corso (fino a 5 MB)",
    check: "Controlla il file",
    cancel: "Annulla",
    summary: "Riepilogo del corso",
    import: "Importa il corso",
  }),

  /**
   * «Gestisci» un corso (`admin-program.tsx` e le sue schede), §3.9 e audit Fuori §4.11: H1 = il titolo del corso, lo
   * stato in una riga, «Risultati» bordato e il «⋯»; quattro schede (Lezioni · Materiali · Persone · Impostazioni), un
   * solo pulsante pieno per scheda. «Lezioni» unisce l'ingresso, le attività e il QR a schermo intero.
   */
  manage: Object.freeze({
    title: "Gestisci corso",
    statusOpen: "In corso",
    statusClosed: "Chiuso alle nuove risposte",
    visible: "visibile ai partecipanti",
    hidden: "nascosto ai partecipanti",
    scoped: (lessons: string) => `Gestisci solo: ${lessons}.`,
    results: "Risultati",
    more: "Altre azioni",
    copyLink: "Copia link del corso",
    copied: "Link del corso copiato: apre il corso a chi è già iscritto.",
    copyFailed: (url: string) => `Copia automatica non disponibile. Il link del corso è ${url}`,
    asParticipant: "Vedi come partecipante",
    refresh: "Aggiorna",
    noEmail: "L'assegnazione di un corso non invia email.",
    tabs: Object.freeze({ label: "Gestione del corso", lezioni: "Lezioni", materiali: "Materiali", persone: "Persone", impostazioni: "Impostazioni" }),
    lessons: Object.freeze({
      enrolled: (n: number) => (n === 1 ? "1 iscritto" : `${n} iscritti`),
      openNow: "Apri le attività ora",
      openNowAsk: "Aprire subito tutte le attività della lezione? Chi è iscritto può rispondere da adesso, senza aspettare la scaletta.",
      suspend: "Sospendi le risposte",
      suspendAsk: "Sospendere le risposte della lezione? Salvataggi e consegne si fermano finché non le riapri; le risposte già salvate restano.",
      backToPlan: "Torna alla scaletta",
      backToPlanAsk: "Tornare alla scaletta? Gli esercizi si aprono alle loro ore; quelli già aperti restano aperti.",
      createLink: "Crea il link",
      creating: "Creazione…",
      createFailed: "Link non creato: controlla la connessione e riprova.",
      options: "Opzioni del link",
      linkName: "Nome del link (facoltativo)",
      linkNameHint: "Es. aula, ritardatari",
      seats: "Posti",
      hours: "Valido per (ore)",
      ready: "Link pronto",
      readyHelp: "Compare una volta sola: copialo adesso, oppure mostra il QR. Nasce con l'ingresso chiuso: aprilo quando la lezione comincia.",
      copy: "Copia il link",
      copiedShort: "Copiato",
      copyError: "Copia non riuscita: seleziona l'indirizzo e copialo a mano.",
      showQr: "Mostra il QR",
      qrTitle: "Inquadra il QR per entrare nel corso",
      exit: "Esci",
      openDoor: "Apri l'ingresso",
      closeDoor: "Chiudi l'ingresso",
      addSeats: "Aggiungi 20 posti",
      revoke: "Disattiva il link",
      revokeAsk: (lesson: string) => `Disattivare questo link per la ${lesson}? Chi è già entrato mantiene l'accesso al corso; chi riceve il link da ora non può più iscriversi.`,
      seatsLine: (joined: number, left: number, max: number) =>
        `${joined} ${joined === 1 ? "persona entrata" : "persone entrate"} · ${left} ${left === 1 ? "posto libero" : "posti liberi"} su ${max}`,
      validUntil: (when: string) => `valido fino al ${when}`,
      closedLinks: (n: number) => `Link non più validi (${n})`,
      reopen: (n: number, lessons: string) =>
        `${n === 1 ? "1 persona chiede" : `${n} persone chiedono`} di riaprire la sua lezione (${lessons}): per farla rispondere oggi, apri le attività di quella lezione.`,
      otherModules: (n: number) => `Altri moduli (${n})`,
      planned: "In programma: le attività si aprono nella lezione di quel modulo.",
      none: "Il corso non ha ancora lezioni.",
    }),
    history: "Storico delle operazioni",
    historyNote: "Le operazioni recenti che puoi vedere. Non contiene risposte né voti.",
    historyEmpty: "Nessuna operazione registrata.",
    purge: "Cancellazione dei dati scaduti",
    lifecycle: "Visibilità e chiusura",
  }),
});

/** Le righe di una lista in vista (§1, regola 4): tre, poi «Vedi tutti (N)». */
export const LEARNING_ROWS_SHOWN = 3;
