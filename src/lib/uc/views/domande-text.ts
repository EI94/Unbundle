/**
 * I testi di Domande, del pannello della domanda, di «Verifica una alla volta» e del pannello «File» (rilascio 10,
 * ondata 5a, docs/ui-10/PROPOSTA-10.md §3.5 «Domande»): le parole del vocabolario unico (§4), genere neutro, niente
 * codici né inglese. Le pagine e i componenti li chiedono per chiave; le copy guard li controllano
 * (`domande-text.test.ts`).
 *
 * Modulo puro.
 */
import { formatCountIt } from "./format.ts";

const n = formatCountIt;

/** «1 domanda», «12 domande». */
function questions(count: number): string {
  return `${n(count)} ${count === 1 ? "domanda" : "domande"}`;
}

export const DOMANDE_TEXT = Object.freeze({
  /** Il controllo dei segmenti, per i lettori di schermo. */
  segments: "Domande per stato",
  /** Il gruppo delle domande ferme per un blocco, in cima a «Da fare» (per Lateral Space e per il cliente). */
  waiting: "In attesa",
  /** La riga grigia del gruppo «In attesa». */
  waitingFact: "Ferme per un blocco",
  /** Le domande senza argomento (il catalogo intero, i documenti del caso). */
  noTopic: "Senza argomento",
  otherTopic: "Altro argomento",
  /** L'elenco degli argomenti chiusi, per i lettori di schermo. */
  topics: "Argomenti",

  bar: Object.freeze({
    select: "Seleziona",
    selectDone: "Fine",
    /** «File (6)»; senza file solo «File» (lo zero non si mostra). */
    files: (count: number) => (count > 0 ? `File (${n(count)})` : "File"),
    /** In selezione con gli argomenti chiusi: si scelgono argomenti interi. */
    selectTopics: "Scegli gli argomenti: si selezionano tutte le loro domande.",
    /** «Verifica una alla volta», quando il pulsante pieno della testata non ci porta già. */
    review: "Verifica una alla volta",
  }),

  filters: Object.freeze({
    referente: "Referente",
    senzaReferente: "Senza referente",
    /** La voce del foglio con il conteggio: «Senza referente (137)». */
    senzaReferenteCount: (count: number) => (count > 0 ? `Senza referente (${n(count)})` : "Senza referente"),
    argomento: "Argomento",
    chiRisponde: "Chi risponde",
    stato: "Stato",
    aPosto: "A posto",
    /** Lo stato di dettaglio «validata», accanto al gruppo «A posto» (che comprende anche «Non si applica»). */
    validata: "Validata",
    riservatezza: "Riservatezza",
    contratto: "Contratto",
    /** Il campo delle indispensabili: la voce vuota dice il predefinito. */
    domande: "Domande",
    soloIndispensabili: "Solo le indispensabili",
    ancheFacoltative: "Anche le facoltative",
    tutte: "Tutte",
    mostra: "Mostra",
    /** «Mostra»: la voce vuota. */
    soloDomande: "Domande",
    documenti: "Documenti",
    catalogo: (size: number | null) => (size !== null ? `Tutto il catalogo (${n(size)})` : "Tutto il catalogo"),
    tipo: "Tipo",
    tuttiITipi: "Tutti i tipi",
  }),

  empty: Object.freeze({
    search: (q: string) => `Nessuna domanda trovata per “${q}”.`,
    filters: "Nessuna domanda con questi filtri.",
    clear: "Togli i filtri",
    ls: Object.freeze({
      "da-fare": "Nessuna domanda da fare.",
      "da-verificare": "Niente da verificare, adesso.",
      bloccate: "Nessuna domanda in attesa.",
      "a-posto": "Ancora nessuna domanda a posto.",
      tutte: "Nessuna domanda.",
    }),
    cliente: Object.freeze({
      "da-fare": "Nessuna domanda da rispondere.",
      "da-verificare": "Nessuna risposta in verifica.",
      bloccate: "Nessuna domanda in attesa.",
      "a-posto": "Ancora nessuna domanda a posto.",
      tutte: "Nessuna domanda.",
    }),
  }),

  pages: Object.freeze({
    label: "Pagine",
    previous: "Precedenti",
    next: "Successive",
    /** «1–50 di 245». */
    range: (first: number, last: number, total: number) => `${n(first)}–${n(last)} di ${n(total)}`,
  }),

  row: Object.freeze({
    noReferent: "Senza referente",
    /** La scadenza, solo quando è passata: «scaduta il 20 ott». */
    overdue: (day: string) => `scaduta ${day}`,
    /** La riga di una domanda da verificare (Lateral Space): chi ha risposto e quando. */
    answeredBy: (who: string | null, when: string | null) => [who, when].filter(Boolean).join(" · "),
    select: (title: string) => `Seleziona «${title}»`,
    selectTopic: (title: string) => `Seleziona le domande di «${title}»`,
  }),

  /** Tornando da una domanda a tutta pagina: la lista con i suoi filtri e la sua pagina. */
  back: "Domande",

  panel: Object.freeze({
    fullPage: "Apri a tutta pagina",
    answer: Object.freeze({ ls: "Risposta", cliente: "Risposta del referente" }),
    question: "La domanda",
    activity: (count: number) => (count > 0 ? `Attività · ${n(count)}` : "Attività"),
    /** La pagina intera: a lato solo il referente, il resto in una piega. */
    referent: "Referente",
    more: "Altri dettagli",
    due: "Scadenza",
    linked: (count: number) => `Collegata a ${questions(count)}`,
    /** Il link al pannello «File» dalla domanda che chiede un file. */
    manageFiles: "Tutti i file",
  }),

  /** Le azioni della domanda: le stesse parole nella selezione e in Persone (§4: «Affida a…», «Chiedi al referente»). */
  actions: Object.freeze({
    askReferent: "Chiedi al referente",
    record: "Inserisci il valore",
    propose: "Proponi…",
    proposeStep: "Che cosa proponi?",
    proposeNext: "Avanti",
    proposeChoice: Object.freeze({
      proposeNa: "Non si applica",
      proposeWaiver: "Partire senza risposta",
      proposeFallback: "Una soluzione provvisoria",
    }),
    /** Il passo di scelta, sotto ogni voce. */
    proposeHint: Object.freeze({
      proposeNa: "La domanda non riguarda questo caso.",
      proposeWaiver: "Si parte e la risposta arriva dopo.",
      proposeFallback: "Si parte con una soluzione temporanea.",
    }),
    /** Partire senza risposta: la regola in una frase calma. */
    waiverNote: "Solo per poche domande indispensabili, mai su dati personali o regole di legge.",
    signaturesNote: "Poi firmano Lateral Space e il cliente.",
    cancel: "Annulla",
    reassign: "Affida a…",
    reassignSubmit: "Affida",
    reassignPick: "Scegli la persona",
    reassignNone: "Nessun'altra persona a cui affidarla: aggiungila da Persone.",
    reassignDone: "Domanda affidata.",
    askDone: "Domanda inviata al referente.",
    recordDone: "Valore inserito: ora lo verifica un'altra persona.",
  }),

  /** «Inserisci il valore»: Valore e Fonte in vista, il resto in «Altri dettagli». */
  record: Object.freeze({
    calm: "Poi lo verifica un'altra persona.",
    value: "Valore",
    values: "Valori",
    outcome: "Esito",
    source: "Fonte",
    sourceRef: "Riferimento",
    sourceRefPlaceholder: "Es. Listino 2026, pagina 3",
    more: "Altri dettagli",
    basis: "Da dove viene",
    basisUnknown: "Non indicato",
    confidence: "Affidabilità",
    confidenceUnknown: "Non indicata",
    validFrom: "Valido dal",
    validFromRequired: "Valido dal (obbligatorio)",
    note: "Nota",
    choose: "Scegli",
  }),

  comments: Object.freeze({
    placeholder: "Il tuo commento",
  }),

  verify: Object.freeze({
    /** L'interruttore dei tasti rapidi (WCAG 2.1.4). */
    shortcuts: "Tasti rapidi",
    hint: "V valida · C chiarimento · → salta · ← indietro",
  }),

  /** Il pannello «File» (`?apri=file`): l'archivio della realizzazione. */
  files: Object.freeze({
    title: "File",
    upload: "Carica un file",
    uploadFor: "Per",
    caseDocument: "Documento della realizzazione",
    zoneStandard: "Il file si controlla e si mostra con le colonne personali nascoste.",
    zonePersonal: "Zona personale: il file resta cifrato e si apre dopo la scheda privacy.",
    uploadUnavailable: "Qui non puoi caricare file.",
    toCheck: (count: number) => `Da controllare · ${n(count)}`,
    toCheckNote: "PDF che non riusciamo a leggere bene: aprili e controlla che non ci siano dati personali non richiesti.",
    uploaded: "File caricati",
    none: "Nessun file caricato.",
    withoutFile: "Schede senza file",
    seeAll: (count: number) => `Vedi tutti (${n(count)})`,
    /** I documenti che chiediamo: il filtro «Documenti» di Domande. */
    required: (count: number) => `Documenti richiesti (${n(count)})`,
    personalNote: "I file della zona personale mostrano solo i dati del file, mai il contenuto.",
    forQuestion: "Per la domanda",
    menu: (name: string) => `Azioni sul file ${name}`,
    download: "Scarica",
    createDataset: "Crea la scheda dataset",
    validateDataset: "Valida la scheda",
    rejectDataset: "Rifiuta la scheda",
    decideBlocked: "La verifica un'altra persona di Lateral Space.",
    delete: "Cancella",
    deleteTitle: (name: string) => `Cancellare «${name}»?`,
    deleteBody: "Il file sparisce dall'archivio; nell'attività resta che è stato cancellato. Le prove già usate restano.",
    deleted: "File cancellato.",
    datasetValidated: "Scheda dataset validata.",
    datasetRejected: "Scheda dataset rifiutata.",
    dataset: "Scheda dataset",
    datasetError: "Un controllo di qualità ha trovato un errore.",
  }),
});
