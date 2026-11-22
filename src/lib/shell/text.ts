/**
 * I testi della cornice (rilascio 10, ondata 2a «Cornice», docs/ui-10/PROPOSTA-10.md §2.1-§2.4, §3.1, §3.2, §3.10):
 * la barra laterale, il selettore del workspace, il menu sotto il nome, la barra in alto del telefono, il foglio
 * «Il tuo account» e la pagina «I tuoi workspace». Una parola per ogni cosa (§4): «use case» nella dashboard, genere
 * neutro, niente codici o chiavi a schermo.
 *
 * Modulo puro: lo leggono i componenti client della cornice e i test con `node --test`.
 */

export const SHELL_TEXT = Object.freeze({
  brand: "Unbundle",
  skipToContent: "Salta al contenuto",

  /** Le voci della barra laterale (§2.1, §2.2). */
  nav: Object.freeze({
    label: "Sezioni del workspace",
    home: "Home",
    useCase: "Use case",
    factory: "Agent Factory",
    context: "Contesto",
    people: "Persone",
    /** Le viste di «Contesto» e di «Persone» che stanno sotto la voce accesa, finché le pagine non hanno le loro. */
    processes: "Processi",
    interview: "Intervista iniziale",
    readiness: "AI Readiness",
    learning: "Formazione",
    /** L'elenco delle realizzazioni, finché non ogni realizzazione ha la sua scheda (P0-16). */
    realizations: "Realizzazioni",
    /** Gli strumenti di oggi, sotto una linea sottile e senza titolo (D11 respinta dal titolare il 18/11). */
    toolsLabel: "Strumenti",
    valueMap: "Value map",
    reports: "Report",
    blueprints: "Blueprints",
    simulation: "Simulazione",
    intelligence: "Intelligence",
    settings: "Impostazioni",
    /** Fuori da un workspace (`/dashboard`). */
    workspaces: "I tuoi workspace",
  }),

  /**
   * La barra dei workspace con l'area «Use case» spenta: le voci di prima, come prima (vanno via con l'ondata 8), con
   * le parole di §4 dove una voce ha la stessa cosa della barra nuova: «Intervista iniziale», «Processi», «Use case»,
   * «Realizzazioni».
   */
  legacy: Object.freeze({
    overview: "Overview",
    readiness: "AI Readiness",
    learning: "Formazione",
    portfolio: "Raccolta & ranking",
    discovery: "Intervista iniziale",
    context: "Contesto",
    strategy: "Strategia",
    mapping: "Processi",
    valueMap: "Value map",
    useCases: "Use case",
    cases: "Realizzazioni",
    plan: "Piano",
    reports: "Report",
    blueprints: "Blueprints",
    simulation: "Simulazione",
    intelligence: "Intelligence",
    settings: "Impostazioni",
  }),

  /** Il nome del workspace in cima alla barra è un selettore (§2.1). */
  switcher: Object.freeze({
    label: (workspace: string) => `${workspace}: cambia workspace`,
    all: "Tutti i workspace",
    create: "Nuovo workspace",
  }),

  /** Il menu sotto il nome, in fondo alla barra (§2.1). */
  user: Object.freeze({
    fallbackName: "Utente",
    account: "Il tuo account",
    theme: "Tema",
    signOut: "Esci",
  }),

  /** La barra in alto del telefono (§2.1, §5.7). */
  topbar: Object.freeze({
    openMenu: "Apri il menu",
  }),

  /** Il foglio «Il tuo account» (§3.10), con l'indirizzo `?account=`. */
  account: Object.freeze({
    title: "Il tuo account",
    description: "Le tue preferenze e i tuoi accessi in questo workspace.",
    close: "Chiudi",
    loading: "Caricamento…",
    loadFailed: "Non riesco a leggere il tuo account.",
    retry: "Riprova",
    email: Object.freeze({
      title: "Notifiche via email",
      toggle: "Avvisami per email sulle mie richieste al referente",
      saveFailed: "Non è stato possibile salvare. Riprova tra poco.",
    }),
    claude: Object.freeze({
      title: "Claude e terminale",
      listLabel: "I tuoi accessi",
      kindClaude: "Claude",
      kindTerminal: "Terminale",
      readOnly: "solo lettura",
      readWrite: "lettura e scrittura",
      expiresIn: (when: string) => `scade ${when}`,
      expiresOn: (day: string) => `scade il ${day}`,
      usedOn: (day: string) => `usato il ${day}`,
      neverUsed: "mai usato",
      onlyCase: (code: string) => `solo ${code}`,
      /** (F-227) L'inizio di un collegamento del terminale: «ubc_cd34…». */
      linkPrefix: (prefix: string) => `${prefix}…`,
      allCases: "tutti i tuoi use case",
      exposed: "esposto: revocalo",
      revoke: "Revoca",
      revokeTitle: (label: string) => `Revocare «${label}»?`,
      revokeClaude: "Claude non entra più in Unbundle con questo accesso.",
      revokeTerminal: "La CLI di quel computer non entra più in Unbundle. Per collegarla di nuovo serve «unbundle login».",
      cancel: "Annulla",
      revoked: "Accesso revocato.",
      failed: "Non è riuscito. Riprova tra poco.",
      connectLabel: "Come ti colleghi",
      choiceClaude: "Claude",
      choiceTerminal: "Terminale",
      claudeLead: (days: number) => `Crea il tuo accesso e incollalo in Claude: vale ${days} giorni, con i tuoi permessi.`,
      claudeOff: "Il collegamento con Claude non è ancora acceso: l'accesso funzionerà quando lo accendiamo.",
      claudeLoadFailed: "Non riesco a leggere i tuoi accessi. Riprova tra poco.",
      nameLabel: "Nome",
      nameHint: "Per riconoscerlo, per esempio «Claude Code sul portatile».",
      readOnlyLabel: "Solo lettura",
      readOnlyHint: "Claude cerca e legge, ma non crea e non decide.",
      create: "Crea l'accesso",
      creating: "Creo l'accesso…",
      createdTitle: "Copialo ora: non lo vedrai più.",
      copy: "Copia",
      copied: "Copiato",
      copyFailed: "Non riesco a copiare. Selezionalo e copialo.",
      claudeCode: "Per Claude Code, nel terminale:",
      copyCommand: "Copia il comando",
      claudeAi: (connector: string, url: string) => `Per claude.ai: un connettore personalizzato «${connector}», indirizzo ${url}, con questa intestazione:`,
      secret: "Vale come te: non mandarlo in chat o per email.",
      terminalLead: "Nel repository del caso scrivi «unbundle login»: il browser apre una pagina per confermare. Vale 90 giorni.",
      /** (Ondata 6b) Quello che la card «Claude per il team» delle Impostazioni diceva, ora qui. */
      exposedNotice: (label: string, day: string) => `«${label}» è arrivato dentro un indirizzo web il ${day}: revocalo e creane uno nuovo.`,
      expiringNotice: (label: string, when: string) => `«${label}» scade ${when}: crea un accesso nuovo e sostituiscilo in Claude.`,
      expiringHint: (days: number) => `Da ${days} giorni prima della scadenza qui compare un avviso.`,
      inactive: (n: number) => `Non più attivi (${n})`,
      revokedState: "revocato",
      expiredState: "scaduto",
      createAnother: "Crea un altro accesso",
      hide: "Nascondi",
      guide: "Come collegare Claude",
      guideClaudeCode: "Claude Code: nel terminale, con il tuo accesso al posto di IL_TUO_ACCESSO.",
      guideClaudeAi: (connector: string, url: string) => `claude.ai: aggiungi un connettore personalizzato «${connector}», indirizzo ${url}, con questa intestazione.`,
      guideOnlyYou: "Aggiungilo solo per te, mai come connettore dell'organizzazione: chi lo usa agisce con il tuo nome e i tuoi permessi.",
      skill: (name: string) => `Dopo un AI Lab, la skill «${name}» trasforma gli appunti in use case con questo collegamento: carica il suo zip in Claude, in Impostazioni › Funzionalità.`,
    }),
    granola: Object.freeze({
      title: "Granola",
      /** Il link alle regole di questo cliente («Quali call sono di …»), che stanno in Contesto › Fonti. */
      rules: "Regole delle call",
    }),
    theme: Object.freeze({
      title: "Tema",
    }),
  }),

  /** `/dashboard` · I tuoi workspace (§3.2). */
  picker: Object.freeze({
    title: "I tuoi workspace",
    create: "Nuovo workspace",
    empty: "Non hai ancora un workspace.",
    shared: "Condiviso",
    deleted: "Workspace eliminato.",
    slackInvalidWorkspace: "Link Slack non valido. Apri Impostazioni dal workspace e riprova.",
    slackForbidden: "Non hai permesso di installare Slack per quel workspace.",
    /** (Ondata 0) Ogni altro motivo: una frase, mai la chiave dell'errore. */
    slackOther: "Non siamo riusciti a collegare Slack. Riprova da Impostazioni.",
  }),
});
