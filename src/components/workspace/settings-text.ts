/**
 * I testi delle Impostazioni del workspace in cinque schede (rilascio 10, ondata 6b, docs/ui-10/PROPOSTA-10.md §3.10,
 * audit AUDIT-REALIZZAZIONE.md §3.38-3.43 e F-217…F-237): Team · Collegamenti · Valutazione · Privacy · Zona pericolosa.
 * Si vede solo quello che chi guarda può fare; ciò che è personale (le e-mail, Claude e il terminale, Granola) sta in
 * «Il tuo account».
 *
 * - Nella dashboard «use case»; i fornitori sono «fornitori», il testo legale sta in «Leggi il testo».
 * - Niente codici, chiavi o inglese tecnico in vista: i dettagli per chi gestisce l'app Slack li vede solo Lateral
 *   Space, in «Dettagli tecnici».
 * - Testi senza genere.
 *
 * Modulo puro e senza import.
 */

export const SETTINGS_TEXT = Object.freeze({
  title: "Impostazioni",
  tabsLabel: "Le schede delle impostazioni",
  tabs: Object.freeze({
    team: "Team",
    collegamenti: "Collegamenti",
    valutazione: "Valutazione",
    privacy: "Privacy",
    "zona-pericolosa": "Zona pericolosa",
  }),
  /**
   * (F-005) La configurazione di Lateral Space che manca (i suoi domini): ogni realizzazione è in sola lettura. La legge
   * qui chi gestisce il workspace, con il log; prima era un avviso nella testata di ogni realizzazione.
   */
  configIncomplete: "Configurazione da completare: le realizzazioni sono in sola lettura finché Lateral Space non la completa.",
  technical: "Dettagli tecnici",

  team: Object.freeze({
    who: (n: number) => `Chi ha accesso (${n})`,
    you: "(tu)",
    fromOrganization: "dall'organizzazione",
    invited: "su invito",
    roleOf: (email: string) => `Ruolo di ${email}`,
    remove: "Rimuovi",
    removeOf: (email: string) => `Rimuovi ${email}`,
    invite: "Invita",
    inviteTitle: "Invita una persona",
    email: "E-mail (facoltativa)",
    emailHint: "Con l'e-mail, il link vale solo per chi entra con quella.",
    role: "Ruolo",
    create: "Crea il link",
    creating: "Creo il link…",
    oneLink: (days: number) => `Un link vale per una persona sola e per ${days} giorni.`,
    ready: (who: string | null) => `Link pronto per ${who ?? "una persona"}`,
    readyFact: (role: string, until: string) => `${role} · scade il ${until}`,
    linkLabel: "Link di invito",
    copyLink: "Copia il link",
    copied: "Copiato",
    copyMessage: "Copia un messaggio pronto",
    messageCopied: "Messaggio copiato",
    share: "Condividi",
    another: (role: string) => `Crea un altro link (${role})`,
    once: "Il link si vede solo adesso: mandalo tu, in privato. Unbundle non manda e-mail.",
    manual: "Copia automatica non disponibile: il link è selezionato, copialo con Cmd/Ctrl+C.",
    invites: (n: number) => `Inviti aperti (${n})`,
    history: (n: number) => `Inviti passati (${n})`,
    noEmail: "Link senza e-mail",
    status: Object.freeze({ active: "In attesa", expired: "Scaduto", used: "Usato", revoked: "Disattivato" }),
    usedBy: (email: string | null) => `usato${email ? ` da ${email}` : ""}`,
    stopped: "non funziona più",
    expiredOn: (day: string) => `scaduto il ${day}`,
    expiresOn: (day: string) => `scade il ${day}`,
    createdBy: (name: string) => `creato da ${name}`,
    revoke: "Disattiva",
    revokeOf: (email: string | null) => `Disattiva il link ${email ? `per ${email}` : "senza e-mail"}`,
    recreate: "Nuovo link",
    recreateOf: (email: string | null) => `Nuovo link ${email ? `per ${email}` : "senza e-mail"}`,
    learners: (n: number) => (n === 1 ? "1 partecipante ai corsi: vede solo i suoi corsi." : `${n} partecipanti ai corsi: vedono solo i loro corsi.`),
    learnersLink: "Gestisci da Formazione",
    message: (workspace: string, role: string, until: string, personal: boolean) =>
      `Ciao! Ti invito a collaborare su «${workspace}» in Unbundle come ${role}.\nApri il link entro il ${until}${personal ? " (vale solo per te)" : ""}:\n`,
  }),

  links: Object.freeze({
    /** Le righe della scheda: icona · nome · stato in una parola · un pulsante bordato. */
    label: "I collegamenti",
    manage: "Gestisci",
    connect: "Collega",
    slack: Object.freeze({
      name: "Slack",
      on: "Collegato",
      off: "Da collegare",
      onTeam: (team: string) => `Collegato a ${team}`,
      howTo: "Per usarlo in un canale aggiungi il bot con /invite @Unbundle e menzionalo; puoi anche scrivergli in privato.",
      howToBefore: "Dopo il collegamento aggiungi il bot ai canali con /invite @Unbundle.",
      shared: "Nei canali condivisi con altre aziende, ogni contributo va al workspace dell'azienda di chi scrive.",
      installed: "Slack collegato.",
      mismatchTitle: "Slack ha dato l'ok, ma questo workspace non risulta collegato.",
      mismatchBody: "Controlla di essere nel workspace giusto e tocca di nuovo «Collega».",
      mismatchTechnical: "Succede se l'indirizzo contiene ?slack=installed ma sei in un altro workspace, o se l'installazione è finita su un altro database (un'anteprima).",
      errorTitle: "Non siamo riusciti a collegare Slack.",
      errorBody: "Riprova tra qualche minuto.",
      technicalApp:
        "Se nei messaggi diretti compare «invio messaggi disattivato», in api.slack.com/apps › App Home abilita la scheda Messaggi. Le menzioni chiedono che Event Subscriptions punti a …/api/slack/events sullo stesso rilascio che ha salvato l'installazione.",
    }),
    organization: Object.freeze({
      name: "Claude per l'organizzazione",
      lead: "Le persone dell'organizzazione propongono use case dialogando con Claude: ogni proposta arriva qui con un codice.",
      state: Object.freeze({ attivo: "Attivo", sospeso: "Sospeso", senza_token: "Senza accesso", non_configurato: "Da configurare" }),
      loadFailed: "Non riesco a leggere il connettore. Riprova tra poco.",
    }),
    accesses: Object.freeze({
      name: "Accessi del team e delle realizzazioni",
      state: (n: number) => (n === 1 ? "1 attivo" : n > 1 ? `${n} attivi` : "Nessuno attivo"),
      team: "Accessi del team",
      teamLine: (n: number) => (n === 1 ? "1 accesso personale a Claude attivo nel workspace." : `${n} accessi personali a Claude attivi nel workspace.`),
      teamHint: "Ognuno crea e revoca il suo in «Il tuo account».",
      realizations: "Accessi delle realizzazioni",
      old: "Accessi di prima",
    }),
    alerts: Object.freeze({
      name: "Altri avvisi",
      on: "WhatsApp attivo",
      off: "Spenti",
      lead: "Avvisa un gruppo WhatsApp tramite un servizio esterno: a ogni nuovo use case Unbundle manda un messaggio all'indirizzo che scrivi qui.",
      field: "Indirizzo del servizio",
      placeholder: "https://…",
      technical: "Unbundle manda una richiesta POST con il testo, il link e il tipo di avviso (text, link, event). Va bene un servizio come Make, Zapier o Twilio.",
      save: "Salva",
      saving: "Salvo…",
    }),
  }),

  esg: Object.freeze({
    title: "Criteri ESG",
    lead: "Aggiungono ambiente, impatto sociale e governance ai criteri con cui valuti gli use case.",
  }),

  privacy: Object.freeze({
    suppliers: "Fornitori dei dati",
    suppliersPanel: "Fornitori dei dati",
    pending: "Da autorizzare",
    authorize: "Autorizza",
    read: "Leggi il testo",
    links: "Link condivisi",
    linksLead: "I link mandati su Slack aprono una copia in sola lettura degli use case per 30 giorni. Si disattivano da soli quando togli una persona.",
  }),

  danger: Object.freeze({
    title: "Zona pericolosa",
  }),
});
