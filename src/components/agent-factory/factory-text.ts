/**
 * I testi della pagina «Agent Factory» (rilascio 10, ondata 6b, docs/ui-10/PROPOSTA-10.md §3.6 e prototipo S5): la
 * testata con il «⋯», il prossimo passo, «Da fare per te», «La linea», le famiglie con i loro «Dettagli», le righe dei
 * casi, il pannello di un caso, «Chi costruisce» e «Repository da aggiornare».
 *
 * - Nella dashboard «casi» e «use case», mai «caso d'uso» né il vecchio nome della pagina; testi senza genere.
 * - I comandi della CLI stanno dove si agisce (il pannello del caso, «Il tuo account»), mai nella riga.
 * - Le righe di «Da fare per te» della CI restano quelle della 8.2b (`CI_TEXT.todo`, ci-text.ts).
 *
 * Modulo puro e senza import: lo usano la pagina sul server, la schermata nel browser e i test.
 */

export const FACTORY_TEXT = Object.freeze({
  title: "Agent Factory",
  /** Sotto il titolo, solo a chi non vede tutti i casi. */
  mine: "I casi dove sei nel team.",
  notReady: "Non ancora disponibile: riprova tra qualche minuto.",
  menu: Object.freeze({
    label: "Altre azioni dell'Agent Factory",
    builders: "Chi costruisce",
    queue: "Repository da aggiornare",
  }),

  /** «Da fare per te»: al massimo 3 righe sotto il pulsante pieno, poi «Altre N». */
  todo: Object.freeze({
    title: "Da fare per te",
    more: (n: number) => `Altre ${n}`,
    allTitle: "Da fare per te",
    /** Accanto a una modifica che si apre su GitHub, per i lettori di schermo. */
    external: "si apre su GitHub, in una nuova scheda",
    /** (Revisione 6b) Il pulsante pieno che porta a GitHub, per i lettori di schermo: «Rivedi una modifica (si apre in una nuova scheda)». */
    newTab: (label: string) => `${label} (si apre in una nuova scheda)`,
    collega: "Collega Claude Code",
    collegaWhy: (client: string) => `Serve per lavorare ai casi di ${client} dal terminale: la guida è in «Il tuo account».`,
    /** (Revisione 6b) Solo il verbo: il compito («T-3») sta nel grigio, accanto al codice del caso. */
    chiesto: "Rispondi a una richiesta",
    fermo: "Riprendi un compito fermo",
    fermoWhy: (ref: string) => `${ref} è fermo da giorni: riprendilo o lascialo con una nota.`,
    /** Il grigio della voce: il codice del caso e, se c'è, il compito. */
    grey: (code: string, ref: string | null) => [code, ref].filter(Boolean).join(" · "),
    approva: "Approva il progetto",
    domande: (n: number) => (n === 1 ? "Decidi una domanda sul codice" : `Decidi ${n} domande sul codice`),
    proposte: (n: number) => (n === 1 ? "Decidi una proposta di compito" : `Decidi ${n} proposte di compito`),
    rivedi: "Rivedi una modifica",
    rivediWhy: (what: string) => `${what} Si apre su GitHub.`,
    banco: "Guarda il banco di prova",
    evals: "Guarda le evals",
    /** Senza il nome del cliente: «questo workspace». */
    thisWorkspace: "questo workspace",
    /** Il verbo del pulsante pieno per la chiave nuova della CI da mettere su GitHub (la frase della 8.2b resta nella riga). */
    ciPut: "Metti la chiave su GitHub",
    /**
     * (8.0d) «Solo questo use case»: al manager «Togli …» quando il suo caso è chiuso (apre «Chi costruisce»), al
     * responsabile «Aggiungi … al team» (il team del dossier). La frase della specifica resta nel «?».
     */
    togliEsterno: (who: string) => `Togli ${who.trim() || "questa persona"}`,
    aggiungiEsterno: (who: string) => `Aggiungi ${who.trim() || "questa persona"} al team`,
  }),
  /** Quanto fa, nel pannello di un caso e nella riga di «oggi», «ieri», «N giorni fa». */
  since: Object.freeze({
    today: "oggi",
    yesterday: "ieri",
    daysAgo: (n: number) => `${n} giorni fa`,
  }),

  /** «La linea»: i filtri per stazione, senza zeri. */
  line: Object.freeze({
    title: "La linea",
    /** Il chip acceso, per i lettori di schermo: toccarlo toglie il filtro. */
    remove: (station: string) => `Togli il filtro ${station}`,
    filtered: (n: number, station: string) => `${n === 1 ? "1 caso" : `${n} casi`} · ${station}`,
  }),

  /** Le famiglie (i repository) e le righe dei casi. */
  family: Object.freeze({
    noRepo: "Ancora senza repository",
    details: "Dettagli",
    repo: "Repository",
    template: "Modello",
    common: "Comune",
    behind: (latest: string) => `indietro: c'è il ${latest}`,
    unknownVersion: "non ancora nota",
    /** (Revisione 6b) I «Dettagli» di una famiglia indietro: come si aggiorna, per chi ci lavora (prima la coda). */
    update: "Aggiornamento",
    updateHow: "«unbundle aggiorna» apre la pull request.",
    unknownHow: "la dice il prossimo «unbundle start», oppure «unbundle aggiorna».",
    /** Il nome del pulsante dei «Dettagli» di una famiglia, per i lettori di schermo. */
    detailsOf: (family: string) => `Dettagli di ${family}`,
  }),
  quality: Object.freeze({
    ok: (q: string) => `Qualità ${q}`,
    below: (q: string) => `Qualità ${q}, sotto soglia`,
  }),

  empty: Object.freeze({
    text: "Nessun caso ancora: entra con «Avvia la realizzazione» dalla scheda.",
    action: "Vai agli use case",
    /** (8.0d) «Solo questo use case», quando il suo caso non è (più) da costruire: niente link fuori dal suo perimetro. */
    caseOnly: "Nessuno use case da costruire, per ora.",
  }),

  /** Il pannello di un caso (`?apri=<codice>`). */
  panel: Object.freeze({
    station: "Stazione",
    next: "Prossimo passo",
    tasks: "Compiti",
    tasksLine: (done: number, live: number, going: number) => `${done} di ${live} fatti${going ? ` · ${going} in corso` : ""}`,
    noTasks: "Nessun compito ancora",
    changes: "Modifiche",
    changesLine: (open: number, merged: number) =>
      [open ? `${open} ${open === 1 ? "aperta" : "aperte"}` : null, merged ? `${merged} ${merged === 1 ? "unita" : "unite"}` : null].filter(Boolean).join(" · "),
    /** Quanto passa di solito dalla presa di un compito all'unione della sua modifica (da 3 modifiche unite in su). */
    timingUnderDay: "di solito in meno di un giorno dalla presa all'unione",
    timingDays: (days: string) => `di solito ${days} giorni dalla presa all'unione`,
    /** La media per modifica unita (da 3 modifiche unite in su): «in media 3,20 USD e 120.000 token per modifica unita». */
    perChange: (parts: readonly string[]) => `in media ${parts.join(" e ")} per modifica unita`,
    tokens: (n: string) => `${n} token`,
    /** Il totale del caso, solo al manager: «140,00 USD, 1.200.000 token». */
    total: (cost: string, tokens: string) => `${cost}, ${tokens} token`,
    sessions: "Sessioni dei coding agent",
    sessionsLine: (n: number, last: string | null) => `${n === 1 ? "1 sessione" : `${n} sessioni`}${last ? `, l'ultima ${last}` : ""}`,
    cost: "Costo delle sessioni",
    quality: "Qualità",
    bench: "Banco di prova",
    repo: "Repository",
    noRepoHow: (code: string) => `Il repository della famiglia lo crea, dal terminale, «unbundle repo create ${code}».`,
    importHow: (code: string) => `I compiti del progetto arrivano con «unbundle compiti importa ${code}».`,
    open: "Apri la costruzione",
  }),

  /** «Chi costruisce», il pannello dal «⋯» (solo il manager di Lateral Space). */
  builders: Object.freeze({
    title: "Chi costruisce",
    lead: "Lavorano ai casi del cliente da Unbundle e con Claude Code. Il progetto di ogni caso lo approva il suo responsabile.",
    empty: "Ancora nessuno: chi aggiungi qui lavora ai casi del cliente.",
    add: "Aggiungi",
    person: "Persona",
    role: "Ruolo",
    choose: "Scegli",
    /** Nell'elenco di «Persona»: una persona che non è ancora nel workspace. */
    newEmail: "Una persona nuova, per e-mail",
    emailLabel: "E-mail",
    /** (Revisione 6b) Unbundle non manda l'invito: crea il link, che manda chi aggiunge. */
    emailHint: "Ti diamo un link di invito come Analista, da mandare tu alla persona: quando entra, la aggiungi qui.",
    inviteFailed: "Non è riuscito. Riprova tra poco.",
    invite: "Crea l'invito",
    inviteReady: "Invito pronto: manda il link alla persona. Vale per una persona sola.",
    copyLink: "Copia il link",
    copied: "Copiato",
    copyFailed: "Non riesco a copiare: seleziona il link e copialo a mano.",
    notFound: "Non la trovi? Scrivi la sua e-mail con «Una persona nuova, per e-mail».",
    notFoundNoInvite: "Non la trovi? Invitala prima nel workspace, da Impostazioni › Team, come Analista.",
    where: "Dove",
    whereAll: "In tutti i casi, anche nei nuovi",
    whereSome: "Solo in alcuni casi",
    whereLabel: "I casi dove costruisce",
    noChoices: "Nessun caso da scegliere ancora.",
  }),

  /** «Repository da aggiornare», il pannello dal «⋯» (solo il manager). */
  queue: Object.freeze({
    title: "Repository da aggiornare",
    lead: "Hanno un modello più vecchio dell'ultimo. Chi ci lavora li prende: niente turni.",
  }),
});
