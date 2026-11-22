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
    collega: "Collega Claude Code",
    collegaWhy: (client: string) => `Serve per lavorare ai casi di ${client} dal terminale: la guida è in «Il tuo account».`,
    chiesto: (ref: string) => `Rispondi su ${ref}`,
    fermo: (ref: string) => `Riprendi ${ref}`,
    approva: "Approva il progetto",
    domande: (n: number) => (n === 1 ? "Decidi una domanda sul codice" : `Decidi ${n} domande sul codice`),
    proposte: (n: number) => (n === 1 ? "Decidi una proposta di compito" : `Decidi ${n} proposte di compito`),
    rivedi: "Rivedi una modifica",
    rivediWhy: (what: string) => `${what} Si apre su GitHub.`,
    banco: "Guarda il banco di prova",
    evals: "Guarda le evals",
  }),

  /** «La linea»: i filtri per stazione, senza zeri. */
  line: Object.freeze({
    title: "La linea",
    all: "Tutte le stazioni",
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
    openRepo: "Apri su GitHub",
    unknownVersion: "non ancora nota",
  }),
  quality: Object.freeze({
    ok: (q: string) => `Qualità ${q}`,
    below: (q: string) => `Qualità ${q}, sotto soglia`,
  }),

  empty: Object.freeze({
    text: "Nessun caso ancora: entra con «Avvia la realizzazione» dalla scheda.",
    action: "Vai agli use case",
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
    emailHint: "Riceve un link di invito come Analista: quando entra, la aggiungi qui.",
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
