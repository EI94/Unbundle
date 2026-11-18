/**
 * (Rilascio 10, ondata 1 · docs/ui-10/PROPOSTA-10.md §1 regola 7, §5.4) I testi delle finestre di conferma che hanno
 * preso il posto delle finestre del browser (`window.confirm`, `window.alert`, `window.prompt`): la domanda come
 * titolo, una frase con la conseguenza, «Annulla» e il verbo. Genere neutro, nessun codice a schermo, niente
 * «OK/Annulla» da spiegare. I testi che hanno già un modulo loro (Contesto › Granola, Impostazioni › Valutazione)
 * restano lì: la finestra li divide con `splitQuestion`.
 *
 * Modulo puro, senza import: lo usano i componenti client e i test.
 */

/** «1 invito», «3 inviti». */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** La parola da scrivere per eliminare una rilevazione di AI Readiness: la stessa che il server controlla. */
export const DELETE_WORD = "ELIMINA";

/** Il testo scritto vale come conferma: come prima, senza badare a spazi e maiuscole. */
export function matchesDeleteWord(text: string): boolean {
  return text.trim().toUpperCase() === DELETE_WORD;
}

/**
 * Un testo «Domanda? Frase.» di un modulo che non cambia qui: la domanda diventa il titolo, il resto la frase sotto.
 * Senza «? » tutto il testo è il titolo.
 */
export function splitQuestion(text: string): { title: string; description: string | null } {
  const at = text.indexOf("? ");
  if (at < 0) return { title: text.trim(), description: null };
  return { title: text.slice(0, at + 1).trim(), description: text.slice(at + 2).trim() || null };
}

export const CONFIRM_TEXT = Object.freeze({
  cancel: "Annulla",

  /** Impostazioni › Persone. */
  people: Object.freeze({
    roleTitle: (email: string, role: string) => `Cambiare il ruolo di ${email} in «${role}»?`,
    roleBody: "Vale da subito.",
    roleConfirm: "Cambia ruolo",
    removeTitle: (email: string) => `Rimuovere ${email} dal workspace?`,
    removeBody: "Perde subito l'accesso a tutti i dati di questo workspace.",
    removeConfirm: "Rimuovi",
    revokeLinkTitle: (email: string | null) => (email ? `Disattivare il link per ${email}?` : "Disattivare il link senza email?"),
    revokeLinkBody: "Chi lo apre non potrà più entrare.",
    revokeLinkConfirm: "Disattiva",
    recreateLinkTitle: "Creare un nuovo link per questo invito?",
    recreateLinkBody: "Quello vecchio smetterà di funzionare.",
    recreateLinkConfirm: "Crea un nuovo link",
  }),

  /** Impostazioni › Integrazioni: i link pubblici al portfolio. */
  shareLinks: Object.freeze({
    title: "Disattivare tutti i link pubblici al portfolio già condivisi?",
    body: "Chi ha accesso con il suo account continua a entrare.",
    confirm: "Disattiva",
  }),

  /** Le chiavi di Claude: «Claude per Unbundle», le realizzazioni, «Claude per il team», il connettore. */
  claude: Object.freeze({
    revokeTitle: (label: string) => `Revocare «${label}»?`,
    revoke: "Revoca",
    setupBody: "Claude non potrà più proporre use case con questa configurazione.",
    realizationBody: "Claude Code non potrà più leggere la realizzazione con questa chiave.",
    teamBody: "Claude non potrà più usarlo.",
    revokeAllTitle: (active: number) => (active === 1 ? "Revocare l'accesso attivo nel workspace?" : `Revocare i ${active} accessi attivi nel workspace?`),
    revokeAllBody: "Claude smette di funzionare per tutte le persone che lo usano con Unbundle Use case.",
    revokeAll: "Revoca tutti",
    connectorRevokeBody: "Se è quello inserito in Claude, il connettore si ferma per tutta l'organizzazione finché l'Owner non ne aggiunge uno nuovo.",
    resumeTitle: "Riattivare il connettore?",
    resumeBody: "Chi lo ha in Claude potrà di nuovo cercare, inviare e chiedere lo stato delle segnalazioni.",
    resume: "Riattiva",
    suspendTitle: "Sospendere il connettore?",
    suspendBody: "Per tutta l'organizzazione Claude risponderà che il servizio è sospeso e proporrà di inviare il riepilogo per email.",
    suspend: "Sospendi",
  }),

  /** Impostazioni › Valutazione: i criteri ESG. */
  esg: Object.freeze({
    onTitle: "Attivare i criteri ESG?",
    onBody: "Vale per tutto il team: i prossimi use case saranno valutati anche su ambiente, impatto sociale e governance.",
    on: "Attiva",
    offTitle: "Disattivare i criteri ESG?",
    offBody: "Vale per tutto il team: i nuovi use case non saranno più valutati su questi criteri.",
    off: "Disattiva",
  }),

  /** Il modello di valutazione: la domanda è quella del modulo (`copy.confirm`). */
  scoring: Object.freeze({ confirm: "Salva" }),

  /** La zona dei dati personali di una realizzazione. */
  personalZone: Object.freeze({
    title: (name: string | null) => (name ? `Togliere a ${name} l'accesso ai dati personali?` : "Togliere il tuo accesso ai dati personali?"),
    body: "Vale da subito: per riaverlo servono una nuova proposta e la firma dell'approvatore privacy.",
    confirm: "Togli",
  }),

  /** AI Readiness: per chi gestisce la rilevazione. */
  aiReadiness: Object.freeze({
    thresholdTitle: "Cambiare la soglia di aggregazione?",
    thresholdBody: "Vale per tutto il team: punteggi e insight si ricalcolano con la nuova soglia.",
    threshold: "Cambia soglia",
    removeQuestionTitle: "Rimuovere questa domanda dal questionario?",
    removeQuestionBody: "Chi risponde non la vede più; puoi ripristinarla dalle domande rimosse.",
    removeQuestion: "Rimuovi",
    newLinkTitle: "Generare un nuovo link condivisibile?",
    newLinkBody: "Quello di prima smette di funzionare per chi non ha ancora iniziato.",
    newLink: "Rigenera il link",
    closeTitle: "Chiudere la rilevazione?",
    closeBody: "Chi risponde non può più inviare risposte né riprendere le bozze finché non la riapri.",
    close: "Chiudi",
    deleteTitle: (name: string) => (name.trim() ? `Eliminare la rilevazione «${name.trim()}»?` : "Eliminare questa rilevazione?"),
    deleteBody: (invitations: number, submitted: number) =>
      `Per tutto il team si cancellano ${count(invitations, "invito", "inviti")} (i link smettono di funzionare), ${count(submitted, "risposta inviata", "risposte inviate")}, punteggi, insight ed export: non si può annullare.`,
    deleteField: `Per confermare, scrivi ${DELETE_WORD}`,
    delete: "Elimina",
  }),

  /** Formazione: le modifiche non salvate di un modulo, prima di uscire o di continuare. */
  learning: Object.freeze({
    leaveTitle: "Lasciare la pagina?",
    leave: "Esci senza salvare",
    continueTitle: "Continuare senza salvare?",
    continue: "Continua senza salvare",
    discardTitle: "Scartare le modifiche?",
    discard: "Scarta",
    lostBody: "Le modifiche non salvate si perdono.",
    stay: "Resta",
    waitTitle: "Operazione in corso",
    waitBody: "Attendi la conferma prima di lasciare la pagina.",
    waitOk: "Ho capito",
  }),
});
