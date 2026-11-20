/**
 * (Rilascio 10, ondata 4 «Fuori», docs/ui-10/PROPOSTA-10.md §3.11, audit Realizzazione §3.44) I testi di «Collega la CLI»
 * (`/cli/collega`): parla a chi costruisce con la CLI, con le parole della CLI («caso», mai «caso d'uso» né «use case»;
 * il comando «unbundle login» si scrive com'è). In fondo un link a «Il tuo account › Claude e terminale» e uno
 * all'Agent Factory; nell'errore, il campo per riscrivere il codice. Modulo puro, senza import.
 */
export const CLI_PAGE_TEXT = Object.freeze({
  metaTitle: "Collega la CLI",
  title: "Collega la CLI",
  ask: "Scrivi il codice che vedi nel terminale dopo «unbundle login».",
  codeLabel: "Codice",
  codePlaceholder: "BCDF-GHJK",
  continue: "Continua",
  invalid: "Il codice non è valido: sono otto lettere, come BCDF-GHJK.",
  retype: "Riscrivi il codice",
  notFound: Object.freeze({ title: "Codice non trovato", body: "Controlla il codice nel terminale, oppure rifai «unbundle login»." }),
  done: Object.freeze({
    scaduto: Object.freeze({ title: "Il codice è scaduto", body: "I codici valgono 10 minuti. Nel terminale rifai «unbundle login»." }),
    confermato: Object.freeze({ title: "Già confermato", body: "Questo codice è già stato confermato: torna al terminale." }),
    consegnato: Object.freeze({ title: "Già usato", body: "Questo codice è già stato usato. Se non l'hai usato tu, revoca il collegamento da «Il tuo account › Claude e terminale»." }),
    negato: Object.freeze({ title: "Codice annullato", body: "Hai detto «Non l'ho chiesto io»: nessuna CLI è stata collegata." }),
  }),
  confirmTitle: "Collega questa CLI?",
  confirmAsk: "Conferma solo se questo è il codice che vedi adesso nel tuo terminale. Se non hai chiesto tu un collegamento, scegli «Non l'ho chiesto io».",
  from: "Da:",
  scope: "Per 90 giorni la CLI potrà fare quello che fai tu nei casi dove sei nel team. Si revoca da «Il tuo account › Claude e terminale» o con «unbundle logout».",
  /** I due link in fondo. */
  account: "Il tuo account › Claude e terminale",
  factory: "Agent Factory",
  /** Senza un workspace da proporre, il link porta all'elenco. */
  workspaces: "I tuoi workspace",
});
