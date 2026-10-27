/**
 * «Chiedi al referente»: tutti i testi italiani, parola per parola dalla SPEC (§4, §5, §P2.10).
 * La pagina pubblica e il capitolo «Cosa serve» li importano da qui e non scrivono testi propri.
 *
 * Regole dei testi (copy-guard e `copy.test.ts`): «use case», mai «caso d'uso»; frasi corte e
 * attive; niente «token», «MCP», «workflow»; gli stati delle informazioni si chiamano come nel
 * modulo di «Cosa serve» («A posto», «Risposta parziale», «Manca il dato»), mai con i nomi interni.
 * I segnaposto `{Nome}`, `{Azienda}`, `{data}`… li riempiono le funzioni di questo modulo.
 *
 * Modulo puro: import relativi `.ts`, si usa anche nei componenti client.
 */
import type { SemaforoColor } from "../../uc/vocab.ts";
import type { ReferentRequestStatus } from "../../db/use-case-hub-referents-ddl.ts";

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
  prepareDisabledTitle: "Non manca niente da chiedere su questa scheda.",
  ask: "Chiedi al referente",
  // Avvisi che bloccano «Chiedi al referente»
  gates: Object.freeze({
    subprocessorsCanDeclare: "{Azienda} deve autorizzare i fornitori che usiamo, per esempio quello delle email: puoi farlo tu, in Impostazioni › Sub-responsabili.",
    subprocessorsOther:
      "{Azienda} deve autorizzare i fornitori che usiamo, per esempio quello delle email. La dà una persona di {Azienda} con ruolo Sponsor esecutivo, Responsabile della trasformazione o Responsabile di funzione, in Impostazioni › Sub-responsabili.",
    subprocessorsLink: "Apri Impostazioni",
    emailNotConfigured: "Le email non sono ancora attive: per ora non possiamo scrivere al referente.",
    emailNotVerified: "Per chiedere serve un account con l'email verificata: le risposte all'email arrivano a te.",
    noQuestions: "Non ci sono domande da fare: aggiungile in «Cosa serve» o usa «Prepara le domande».",
  }),
  // Riga di un'esigenza (composta da `needReferentLine`)
  needLine: Object.freeze({
    askedTo: "Chiesta a {Nome} il {data}",
    reminded: " · Promemoria inviato il {data}",
    lastReminder: " · Ultimo promemoria il {data}",
    answered: " · Risposta ricevuta il {data}",
    dontKnow: " · Risposta: «Non lo so» ({data})",
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
  dontKnowAnswer: "Non lo sa",
  removeAnswer: "Elimina la risposta",
  removeAnswerConfirmTitle: "Eliminare la risposta?",
  removeAnswerConfirmText: "Il testo si cancella e non si può recuperare.",
  removeConfirm: "Elimina",
  filePersonalWarning: "Può contenere dati personali",
  fileDownload: "Scarica",
  fileDelete: "Elimina",
  fileDeleteConfirmTitle: "Eliminare il file?",
  fileDeleteConfirmText: "Non si può recuperare.",
  fileInReview: "Da controllare: PDF con poco testo",
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
  // Finestra «Chiedi al referente»
  askDialog: Object.freeze({
    title: "Chiedi al referente",
    titleAgain: "Chiedi di nuovo",
    confirm: "Invia la richiesta",
    whoLabel: "A chi chiedi?",
    whoPlaceholder: "Scegli un referente",
    option: "{Nome} · {ruolo} · {email}",
    optionNoRole: "{Nome} · {email}",
    optionNoEmail: "{Nome} · {ruolo}",
    optionNameOnly: "{Nome}",
    suffix: Object.freeze({ senza_email: "(senza email)", lateral_space: "(di Lateral Space)", richiesta_aperta: "(richiesta già aperta)", sei_tu: "(sei tu)" }),
    // (Parte 3) Il contatto è un revisore del workspace: in coda all'opzione, « · Fa parte del team».
    teamTag: "Fa parte del team",
    // (Parte 3) Sotto il selettore, quando chi guarda è tra i contatti (opzione «(sei tu)», non selezionabile).
    selfHint: "Non serve chiedere a te stesso: rispondi direttamente qui in «Cosa serve», con «Aggiungi una risposta» o «Allega un file».",
    newContact: "+ Nuovo referente",
    newName: "Nome e cognome",
    newEmail: "Email",
    newRole: "Ruolo (facoltativo)",
    newHint: "Una persona del cliente. Non può avere un'email di Lateral Space.",
    otherRequestsHint: "{Nome} ha già domande aperte su altri use case: i promemoria arriveranno in un'unica email.",
    questionsLabel: "Cosa chiedi",
    questionsHint: "Il referente vede solo il testo delle domande, non i dettagli.",
    questionsEmpty: "Non ci sono domande da fare: aggiungile in «Cosa serve» o usa «Prepara le domande».",
    messageLabel: "Messaggio (facoltativo)",
    messagePlaceholder: "Per esempio: ci serve per la stima di fine mese.",
    messageHint: "Non scrivere dati sanitari, nomi, email o telefoni di altre persone.",
    summary:
      "Mandiamo un'email a {email} da «Lateral Space via Unbundle». Se risponde all'email, la risposta arriva a te ({tuaEmail}). Il link vale 30 giorni; se serve, partono due promemoria dopo 3 e 7 giorni lavorativi.",
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
    hint: "La vedono solo le persone che valutano gli use case. Non scrivere dati sanitari, nomi, email o telefoni di persone.",
    confirm: "Salva la risposta",
    /** (Parte 2) «L'ho già verificata»: l'informazione diventa «A posto» nello stesso passo. */
    validate: "L'ho già verificata: segna l'informazione come «A posto»",
  }),
  fileDialog: Object.freeze({
    title: "Allega un file",
    help: "PDF, Word, Excel, PowerPoint, CSV o testo. Fino a 20 MB. Niente foto.",
    helpServerOnly: "PDF, Word, Excel, PowerPoint, CSV o testo. Fino a 4 MB. Niente foto.",
    declaration: "Il file non contiene dati sanitari né dati personali che non servono.",
    confirm: "Allega",
    /** «Allega» premuto senza aver scelto un file. */
    chooseFile: "Scegli un file da allegare.",
    personalWarning: "Allegato. Il file sembra contenere nomi, email o telefoni di persone: se non servono, toglilo e caricalo di nuovo.",
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
    remindedLater: "Promemoria in partenza alle 9 del prossimo giorno lavorativo.",
    revoked: "Link revocato.",
    retried: "Invio riprovato.",
    emailCorrected: "Email corretta. Con «Manda un promemoria» parte il link al nuovo indirizzo.",
    erased: "Dati cancellati.",
    erasedHubOnly: "Abbiamo cancellato i dati raccolti con gli use case. La persona è anche in un dossier: lì i dati li cancella Lateral Space.",
    answerAdded: "Risposta aggiunta.",
    answerAddedValidated: "Risposta aggiunta e informazione segnata «A posto».",
    answerRemoved: "Risposta eliminata.",
    fileAttached: "File allegato.",
    fileAttachedReview: "File allegato: lo controlla una persona di Lateral Space.",
    fileAttachedValidated: "File allegato e informazione segnata «A posto».",
    fileAttachedReviewValidate: "File allegato: lo controlla una persona di Lateral Space. L'informazione resta da verificare.",
    fileDeleted: "File eliminato.",
    fileAccepted: "File accettato.",
    fileRejected: "File rifiutato.",
  }),
});

// ─── Stati delle richieste (§5.2) ────────────────────────────────────

export const REFERENT_STATUS_LABEL: Readonly<Record<ReferentRequestStatus, string>> = Object.freeze({
  inviata: "In attesa",
  completata: "Risposte ricevute",
  scaduta: "Scaduta",
  revocata: "Revocata",
});

export const REFERENT_STATUS_TONE: Readonly<Record<ReferentRequestStatus, SemaforoColor>> = Object.freeze({
  inviata: "blu",
  completata: "verde",
  scaduta: "giallo",
  revocata: "grigio",
});

/** (Parte 2) Le due varianti «senza risposta» degli stati: sempre in rosso. */
export const REFERENT_SILENT_STATUS = Object.freeze({
  live: { label: "Senza risposta", tone: "rosso" as SemaforoColor },
  expired: { label: "Scaduta senza risposta", tone: "rosso" as SemaforoColor },
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
  dontKnow: "Non lo so",
  answerLabel: "La tua risposta",
  answerPlaceholder: "Scrivi qui. Bastano poche righe.",
  counter: "{n} di 4.000 caratteri",
  attach: "Allega un file",
  attachHelp: "PDF, Word, Excel, PowerPoint, CSV o testo. Fino a 20 MB. Niente foto.",
  attachHelpServerOnly: "PDF, Word, Excel, PowerPoint, CSV o testo. Fino a 4 MB. Niente foto.",
  declaration: "Il file non contiene dati sanitari né dati personali che non ti abbiamo chiesto.",
  fileStates: Object.freeze({
    in_quarantena: "Controllo in corso…",
    pulito: "Allegato",
    in_revisione: "In controllo da Lateral Space: puoi inviare lo stesso",
    rifiutato: "Non accettato: {message}",
  }),
  removeFile: "Togli",
  fileWarning: "Il file sembra contenere nomi, email o telefoni di persone. Se non servono, toglili e caricalo di nuovo.",
  keepFile: "Servono, lo lascio",
  autosave: Object.freeze({ saved: "Salvato", saving: "Salvataggio…", error: "Non salvato: riprova" }),
  submit: "Invia le risposte",
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
  aria: Object.freeze({ removeFile: "Togli {file}", dismissRejected: "Nascondi {file}", files: "File allegati" }),
});

// ─── Informativa (§5.3) ──────────────────────────────────────────────

/**
 * L'informativa a due livelli della pagina pubblica, versione `ucq-2026-10-1`. L'accettazione si
 * registra sulla richiesta con questa versione; una versione nuova mostra di nuovo il riquadro.
 * Testo legale da confermare con il titolare (indirizzo di contatto, 12 mesi).
 */
export const REFERENT_PRIVACY_NOTICE = Object.freeze({
  version: "ucq-2026-10-1",
  title: "Prima di iniziare",
  lead: "Tre cose da sapere sulle tue risposte.",
  summary: Object.freeze([
    "Ti chiediamo del lavoro, non di te. Nelle risposte il sistema blocca dati sanitari, nomi, email e telefoni di persone. Nei file ti avvisiamo se ne troviamo: toglili tu.",
    "Le risposte e i file li vedono solo Lateral Space e le persone di {Azienda} che valutano gli use case.",
    "Il link è solo tuo e vale fino al {data}.",
  ]),
  fullTextLabel: "Leggi l'informativa completa",
  paragraphs: Object.freeze([
    "Lateral Space raccoglie queste informazioni per conto di {Azienda}, per valutare e preparare lo use case. Le usiamo solo per questo.",
    "Ti chiediamo informazioni sul lavoro, non su di te. Nelle risposte non scrivere dati sanitari, nomi di persone, email, telefoni, date di nascita o preferenze su genere, età, origine o religione: il sistema li blocca. Nei file non possiamo bloccare tutto: se troviamo nomi, email o telefoni ti avvisiamo. Toglili prima di caricare.",
    "Salviamo le tue risposte, i file che alleghi, il tuo nome, l'email con cui ti abbiamo scritto e quando hai letto questa informativa. Dell'indirizzo IP teniamo solo un'impronta cifrata, mai il numero, per due giorni.",
    "{Richiedente} e le altre persone di {Azienda} che valutano gli use case vedono le tue risposte e quando sono arrivate. Non misuriamo i tuoi tempi e non facciamo classifiche tra persone.",
    "Teniamo risposte e file per 12 mesi dopo la chiusura della richiesta, poi li cancelliamo.",
    "Puoi chiedere di vedere, correggere o cancellare i tuoi dati scrivendo a {contatto}. Puoi anche fare reclamo al Garante per la protezione dei dati personali.",
    "Il link è personale e scade dopo 30 giorni. Non inoltrarlo.",
  ]),
  footerLabel: "Come usiamo le tue risposte",
  button: "Ho letto, iniziamo",
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
 * `USE_CASE_REFERENTS_PRIVACY_EMAIL`, altrimenti l'indirizzo dentro `UC_EMAIL_FROM` (in produzione
 * pierpaolo@lateralspace.ai), altrimenti «chi ti ha mandato il link».
 */
export function REFERENT_PRIVACY_CONTACT(env: Readonly<Record<string, string | undefined>>): string {
  const explicit = env.USE_CASE_REFERENTS_PRIVACY_EMAIL?.trim();
  if (explicit && /^[^\s@<>]+@[^\s@<>]+$/.test(explicit)) return explicit;
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
  sub_responsabili_mancanti: "Prima {Azienda} deve autorizzare i fornitori che usiamo, in Impostazioni › Sub-responsabili.",
  email_non_verificata: "Per chiedere serve un account con l'email verificata: le risposte all'email arrivano a te.",
  referente_non_valido: "Questo referente non è più attivo: scegline un altro.",
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
  nessuna_domanda: "Scegli almeno una domanda aperta.",
  troppe_domande: "Al massimo 20 domande per richiesta.",
  domande_cambiate: "Qualcuno ha appena cambiato queste domande. Ho ricaricato i dati: riprova.",
  messaggio_troppo_lungo: "Il messaggio può avere al massimo 1.000 caratteri.",
  richiesta_chiusa: "Questa richiesta è chiusa.",
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
  revisore_uguale: "Il file lo controlla un'altra persona di Lateral Space, non chi l'ha caricato.",
  revisione_non_ammessa: "Il controllo dei PDF lo fa una persona di Lateral Space.",
  non_trovato: "Use case non trovato.",
  riprova: "Non riusciamo a salvare. Riprova.",
  // Pagina pubblica (§4.3)
  link_non_valido: "Questo link non è più valido. Chiedi a chi te l'ha mandato un link nuovo.",
  informativa_da_leggere: "Prima leggi l'informativa e premi «Ho letto, iniziamo».",
  informativa_cambiata: "L'informativa è cambiata: ricarica la pagina e leggila di nuovo.",
  gia_inviata: "Hai già inviato questa risposta.",
  risposte_da_correggere: "Alcune risposte vanno corrette: le trovi evidenziate.",
  nessuna_risposta: "Scrivi almeno una risposta, oppure scegli «Non lo so».",
  risposta_vuota_pubblica: "Scrivi la risposta, scegli «Non lo so» o allega un file.",
  non_so_con_file: "Hai allegato un file: togli «Non lo so» oppure togli il file.",
  file_in_controllo: "Aspetta che finisca il controllo del file, poi invia.",
  file_da_confermare: "Un file sembra contenere nomi, email o telefoni: toglilo oppure conferma che servono, poi invia.",
  file_gia_inviato: "Questo file è già stato inviato: non si può togliere.",
  modalita_non_disponibile: "Per questo file serve il caricamento diretto, che qui non è attivo: usa un file fino a 4 MB.",
  domanda_non_disponibile_pubblica: "Questa domanda non è più tra quelle per te.",
  pdf_in_revisione: "Questo PDF ha poco testo, forse è una scansione: lo controlla una persona di Lateral Space. Puoi inviare lo stesso.",
  revisione_rifiutata: "Il file non è stato accettato dopo il controllo.",
  revisione_scaduta: "Il controllo del file non è stato fatto in tempo: caricalo di nuovo.",
  quarantena_scaduta: "Il controllo del file non è finito: caricalo di nuovo.",
});

/** Il messaggio di un codice, con i segnaposto riempiti; un codice sconosciuto dà «Non riusciamo a salvare. Riprova.». */
export function referentErrorMessage(code: string, values: Readonly<Record<string, string | number>> = {}): string {
  const template = REFERENT_ERROR_MESSAGES[code] ?? REFERENT_ERROR_MESSAGES.riprova;
  return fillText(template, { ...values, ...(values.Azienda !== undefined ? { Azienda: companyLabel(String(values.Azienda)) } : {}) });
}
