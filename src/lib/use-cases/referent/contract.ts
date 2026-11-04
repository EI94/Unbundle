/**
 * «Chiedi al referente»: il contratto condiviso tra il server (BACKEND), la pagina pubblica
 * `/rispondi/<token>` (PUBLIC) e il capitolo «Cosa serve» della scheda (REVIEWER_UI). Tipi,
 * percorsi e limiti: l'unica fonte per i tre. I testi italiani stanno in `labels.ts`.
 *
 * Modulo puro: import relativi `.ts`, nessun `server-only`, si usa anche nei componenti client.
 */
import type { Issue } from "../../uc/answers/issues.ts";
import type { ReferentRequestStatus } from "../../db/use-case-hub-referents-ddl.ts";
export type { ReferentRequestStatus } from "../../db/use-case-hub-referents-ddl.ts";

// ── Percorsi ─────────────────────────────────────────────────────────

export const REFERENT_TOKEN_PREFIX = "ucq_";
export const referentPagePath = (token: string) => `/rispondi/${token}`;
export const referentApiBase = (token: string) => `/api/rispondi/${encodeURIComponent(token)}`;
export const REFERENT_API = {
  privacy: "privacy",
  draft: "draft",
  submit: "submit",
  upload: "upload",
  uploadToken: "upload-token",
  uploadComplete: "upload-complete",
  fileRemove: "file-remove",
  fileConfirm: "file-confirm",
  /** (Rilascio 5) La conferma dello use case e la stima del tempo. */
  check: "check",
} as const;
export const reviewerFilesBase = (workspaceId: string, useCaseId: string) => `/dashboard/${workspaceId}/use-cases/${useCaseId}/allegati`;
export const reviewerFileHref = (workspaceId: string, useCaseId: string, fileId: string) => `${reviewerFilesBase(workspaceId, useCaseId)}/${fileId}`;
export const subprocessorsSettingsHref = (workspaceId: string) => `/dashboard/${workspaceId}/settings#sub-responsabili`;
export const REFERENT_CRON_PATH = "/api/cron/use-case-referents";
// (Parte 2) Nessun tipo di segnale in `weekly_signals`: le righe della campanella sono use_case_notifications.
export const cosaServeHref = (workspaceId: string, useCaseId: string) => `/dashboard/${workspaceId}/use-cases/${useCaseId}?capitolo=cosa-serve`;
/**
 * «Nessuna risposta»: la scheda con «Richieste inviate» di «Cosa serve» aperta e il fuoco sul suo
 * riassunto, dove si chiede di nuovo; senza richieste a vista arriva a «Cosa serve» (`arrivalTarget`).
 */
export const richiesteHref = (workspaceId: string, useCaseId: string) => `/dashboard/${workspaceId}/use-cases/${useCaseId}?capitolo=richieste`;
/**
 * (0025) «Pronto da avviare»: la scheda a `?capitolo=realizzazione`. Sulla scheda pronta l'avvio sta
 * nel riquadro «Prossimo passo» (G9) e l'arrivo va lì (`arrivalTarget`), anche dalle email già
 * partite; quando lo use case non è più pronto lo stesso link apre la piega «Realizzazione».
 */
export const realizzazioneHref = (workspaceId: string, useCaseId: string) => `/dashboard/${workspaceId}/use-cases/${useCaseId}?capitolo=realizzazione`;

export const REFERENT_LIMITS = Object.freeze({
  questionsPerRequest: 20,
  messageMax: 1000,
  answerMax: 4000,
  filesPerQuestion: 5,
  /** I limiti di `prepareContact` (uc_contacts). */
  contactNameMin: 2,
  contactNameMax: 255,
  roleLabelMax: 255,
  serverMaxBytes: 4 * 1024 * 1024,
  clientMaxBytes: 20 * 1024 * 1024,
  linkDays: 30,
  retentionMonths: 12,
  accept: ".pdf,.docx,.xlsx,.pptx,.csv,.tsv,.txt,.md",
});

// ── Pagina pubblica (la legge PUBLIC; la produce BACKEND) ─────────────

export type ReferentPageResult =
  | { access: "ok"; view: ReferentAskView }
  | { access: "non_valido" | "revocato" | "scaduto" | "non_disponibile" };

export interface ReferentAskView {
  /**
   * «aperta»: c'è qualcosa a cui rispondere; «completata»: niente di aperto e almeno una risposta del
   * referente (o la richiesta chiusa senza domande già fatte dal team); «vuota»: niente da rispondere
   * e nessuna risposta del referente (domande ritirate, o tutte «gestita» dal team: Parte 3).
   */
  state: "aperta" | "completata" | "vuota";
  /** accepted = privacy_accepted_at presente E privacy_notice_version = REFERENT_PRIVACY_NOTICE.version. */
  privacy: { accepted: boolean; version: string; contact: string };
  /** workspaces.name */
  company: string;
  useCase: { code: string | null; title: string };
  requester: { name: string };
  message: string | null;
  /** Data ISO (Roma) della scadenza, per «entro il …». */
  expiresOn: string;
  /** In ordine di posizione. */
  questions: ReferentQuestionView[];
  /** Blob configurato fuori dal harness. */
  upload: { clientMode: boolean };
  /** (Rilascio 5) «referente»: la richiesta al referente, con la conferma e la stima; «domande»: solo domande. */
  kind: "referente" | "domande";
  /** (Rilascio 5) La conferma dello use case e la stima del tempo: solo per le richieste al referente. */
  check: ReferentCheckView | null;
}

/**
 * (Rilascio 5, §6.1) Quello che il referente conferma: la descrizione senza importi, quote, punteggi o
 * dati personali, e la sua bozza. (Rilascio 5.1) L'impatto: una riga per ogni voce di «Benefici e costi»
 * con la cifra del team di quella voce (volte e minuti, o gli euro di una voce in euro: mai quota che si
 * risparmia, ore liberate, fiducia, fonte, punteggi, costi); senza modello del valore, i due numeri del
 * tempo del rilascio 5 (`benefits` null).
 */
export interface ReferentCheckView {
  /** `referentDescription()`: le frasi che il referente può vedere; null quando non ne resta nessuna. */
  description: string | null;
  /**
   * (Rilascio 5.1) Le righe del passo «L'impatto», nell'ordine del modello: prima dell'invio quelle di
   * adesso con la bozza di ognuna, dopo l'invio quelle inviate. null: niente modello del valore.
   */
  benefits: ReferentBenefitView[] | null;
  /**
   * La bozza della conferma e, senza modello del valore, della stima del tempo (i due numeri); la stima
   * è vuota quando l'istantanea salvata non è più quella di adesso (`stale`). Dopo l'invio, quello inviato
   * (anche la stima del tempo del rilascio 5 sulla voce «ore», per le richieste di allora).
   */
  draft: { confirm: "si" | "correggi" | null; note: string | null; estimate: "si" | "meno" | "piu" | null; timesPerMonth: number | null; minutesEach: number | null; stale: boolean; savedAt: string | null };
  submittedAt: string | null;
}

/** (Rilascio 5.1) Una riga del passo «L'impatto»: una voce di «Benefici e costi» e la risposta del referente. */
export interface ReferentBenefitView {
  /** La chiave della voce: torna al server con la risposta. */
  key: string;
  /** «ore»: volte e minuti del team; «ore_numeri»: il team non ha i numeri; «euro»: gli euro del team; «fatto»: succede davvero? */
  form: "ore" | "ore_numeri" | "euro" | "fatto";
  /** Il nome della voce, o il suo tipo di ritorno («Più qualità») quando il nome non passa i controlli. */
  label: string;
  /** La cifra del team che la riga mostra (torna come `seen`): volte l'anno e minuti, oppure euro l'anno. */
  team: { kind: "ore" | "euro" | "qualitativo"; volumeYear: number | null; minutes: number | null; eurYear: number | null };
  /** La bozza della riga (dopo l'invio, la risposta inviata); vuota (`stale`) se la cifra del team è cambiata. */
  draft: { answer: "si" | "meno" | "piu" | "no" | "non_so" | null; timesPerMonth: number | null; minutesEach: number | null; eurYear: number | null; comment: string | null; stale: boolean } | null;
}

export interface ReferentQuestionView {
  needId: string;
  position: number;
  /** Il testo della domanda com'era all'invio, mai `need.detail`. */
  title: string;
  /**
   * (Parte 3) «gestita»: la domanda era per il referente, ma qualcuno l'ha già data dalla scheda
   * (l'esigenza è «Da verificare» o «A posto» senza una sua risposta). Si mostra in sola
   * lettura con «Non serve più: ci ha già pensato il team.»: niente bozza, niente risposta, niente file,
   * mai cosa hanno scritto gli altri.
   */
  state: "aperta" | "inviata" | "gestita";
  /** (Rilascio 5) «Serve un file»: lo ha scelto chi chiede; la domanda si chiude con un file, «È già allegato» o «Non ce l'ho». */
  fileRequired: boolean;
  /** Solo mentre è «aperta». (Rilascio 5) `dontKnow` è «Non ce l'ho»; `alreadyAttached` «È già allegato»; `comment` il commento o «Chi potrebbe saperlo?». */
  draft: { text: string; dontKnow: boolean; alreadyAttached: boolean; comment: string | null; savedAt: string } | null;
  /** Quando è «inviata». */
  answer: { text: string | null; dontKnow: boolean; alreadyAttached: boolean; comment: string | null; submittedAt: string } | null;
  files: ReferentFileView[];
}

export interface ReferentFileView {
  id: string;
  name: string;
  sizeBytes: number | null;
  /** «in_revisione»: un PDF con poco testo, che controlla Lateral Space; si può inviare. */
  status: "in_quarantena" | "in_revisione" | "pulito" | "rifiutato";
  /** Messaggio di rifiuto o di revisione, in italiano. */
  message: string | null;
  submitted: boolean;
}

export interface ReferentUploadResult {
  fileId: string;
  fileName: string;
  sizeBytes: number | null;
  status: "pulito" | "in_revisione" | "rifiutato";
  usable: boolean;
  message: string | null;
}

export interface ReferentClientTicket {
  fileId: string;
  pathname: string;
  clientToken: string;
  contentType: string;
}

// Corpi delle API pubbliche
export interface PrivacyBody {
  version: string;
}
export interface DraftBody {
  needId: string;
  text: string | null;
  dontKnow: boolean;
  /** (Rilascio 5) «È già allegato»: esclude «Non ce l'ho» e il testo. */
  alreadyAttached?: boolean;
  /** (Rilascio 5) Il commento: solo con «Non ce l'ho», «È già allegato» o un file. */
  comment?: string | null;
}
export interface SubmitBody {
  needIds?: string[];
  /** (Rilascio 5) Le domande aperte che la pagina mostrava: una domanda nuova del team fa rileggere la pagina. */
  shown?: string[];
}
/** (Rilascio 5) Il passo «Lo use case» o il passo dell'impatto (rilascio 5.1: una riga per voce, o i due numeri senza modello). */
export type CheckBody =
  | { step: 1; confirm: "si" | "correggi" | null; note: string | null }
  | { step: 2; teamSeen: { key: string; volumeYear: number; minutes: number } | null; estimate: "si" | "meno" | "piu" | null; timesPerMonth: number | string | null; minutesEach: number | string | null }
  | { step: 2; benefit: BenefitBody };

/** (Rilascio 5.1) La risposta su una voce: la cifra del team che la riga mostrava (`seen`), la scelta, i numeri, il commento. */
export interface BenefitBody {
  key: string;
  seen: ReferentBenefitView["team"];
  answer: "si" | "meno" | "piu" | "no" | "non_so" | null;
  timesPerMonth?: number | string | null;
  minutesEach?: number | string | null;
  eurYear?: number | string | null;
  comment?: string | null;
}
export interface CheckResult {
  savedAt: string;
  warnings: Issue[];
}
export interface UploadTokenBody {
  needId: string;
  fileName: string;
  size: number;
  declaration: boolean;
}
export interface UploadCompleteBody {
  fileId: string;
}
export interface FileRemoveBody {
  fileId: string;
}
export interface FileConfirmBody {
  fileId: string;
}
export interface DraftResult {
  savedAt: string;
  warnings: Issue[];
}
export interface SubmitResult {
  submitted: number;
  open: number;
  state: "aperta" | "completata";
}

// ── Pannello dei revisori (lo legge REVIEWER_UI; lo produce BACKEND) ──

export type ReferentGate =
  | { code: "sub_responsabili_mancanti"; message: string; canDeclare: boolean; settingsHref: string; linkLabel: string }
  | { code: "email_non_configurata"; message: string }
  | { code: "risposte_non_attive"; message: string }
  | { code: "email_non_verificata"; message: string }
  | { code: "nessuna_domanda"; message: string };

export interface ReferentContactOption {
  id: string;
  displayName: string;
  roleLabel: string | null;
  /** «m•••@topjet.it»: la prima lettera, poi •••, poi @dominio. L'indirizzo intero non arriva mai al pannello. */
  emailMasked: string | null;
  selectable: boolean;
  /** (Parte 3) «sei_tu»: il contatto è chi guarda (account collegato o email verificata): risponde dalla scheda. */
  reason: "senza_email" | "lateral_space" | "richiesta_aperta" | "sei_tu" | "referente" | null;
  /**
   * (Parte 3) Il contatto è adesso un revisore di questo workspace: il selettore aggiunge «Fa parte del
   * team». Falso per tutti gli altri ruoli e per chi non ha un account; nessuna altra informazione su
   * ruoli o corsi arriva al pannello.
   */
  team: boolean;
  /**
   * Ha già domande aperte su altri use case del workspace: la finestra dice «… i promemoria
   * arriveranno in un'unica email.» (un sì o un no, mai un numero).
   */
  hasOtherRequests: boolean;
  /**
   * (Rilascio 5) La richiesta viva di questa persona su questo use case, se c'è: «referente» (è il
   * referente) o «domande» (ha già delle domande aperte: sceglierla come referente la sostituisce, D49).
   */
  liveRequest?: { id: string; kind: "referente" | "domande" } | null;
}

/**
 * (Referente già iscritto) Una persona del workspace che ha già un account Unbundle e non è ancora tra
 * i referenti: le persone che chi guarda vede in Impostazioni › Persone («Chi ha accesso») e, dal
 * rilascio 4, nella finestra in tre passi anche i partecipanti ai corsi di questo workspace
 * (`listReferentPeopleAction`); mai Lateral Space, mai chi guarda. Nome ed email coperta, più «Fa
 * parte del team» per i revisori; nessun ruolo, niente dei corsi, niente che distingua un
 * partecipante. Sceglierla crea (o riusa) il suo referente.
 */
export interface ReferentMemberOption {
  userId: string;
  displayName: string;
  /** «m•••@topjet.it», come per i referenti. */
  emailMasked: string | null;
  team: boolean;
}

export interface ReferentRequestView {
  id: string;
  version: number;
  contact: { id: string; name: string; roleLabel: string | null; emailMasked: string | null; hubOnly: boolean };
  /** Stato per i revisori. Una richiesta «inviata» oltre `expires_at` si mostra «scaduta». Non esiste «in corso». */
  status: ReferentRequestStatus;
  /** (Rilascio 4) La parola della richiesta, una sola (`requestWordOf`): «In attesa», «Nessuna risposta», «Risposte ricevute», «Chiusa». */
  statusLabel: string;
  /** (Parte 2) Viva, reminder_count = 2 e domande aperte: «Nessuna risposta», «Chiedi di nuovo» ammesso. */
  silent: boolean;
  /** Righe già scritte in italiano, per esempio «Inviata il 27/10 · scade il 26/11». Niente conteggi, mai dalla lettura dell'informativa. */
  lines: string[];
  /** Avvisi bloccanti su questa richiesta viva (promemoria fermi senza l'autorizzazione ai fornitori, email cambiata). */
  notices: string[];
  email: { state: "in_partenza" | "partita" | "non_partita"; label: string | null };
  needIds: string[];
  /** (Rilascio 5) Le domande ancora aperte di questa richiesta (quelle che un cambio di referente porta con sé). */
  openNeedIds?: string[];
  /** (Rilascio 5) «referente»: la richiesta al referente (con la conferma e la stima); «domande»: solo domande. */
  kind?: "referente" | "domande";
  actions: {
    remind: { allowed: boolean; reason: string | null };
    add: { allowed: boolean; reason: string | null };
    revoke: boolean;
    askAgain: boolean;
    retry: boolean;
    /** contact.hubOnly */
    correctEmail: boolean;
    /** «Cancella i dati di questa persona» */
    erase: boolean;
  };
  createdAt: string;
  expiresAt: string;
  /** (Rilascio 5) Quando è partita l'email della richiesta, e l'ultimo promemoria (per il blocco «Referente»). */
  sentAt?: string | null;
  lastReminderAt?: string | null;
}

export interface NeedAnswerView {
  id: string;
  source: "referente" | "revisore";
  authorLabel: string;
  dateLabel: string;
  text: string | null;
  dontKnow: boolean;
  /** (Rilascio 5) «È già allegato». */
  alreadyAttached?: boolean;
  /** (Rilascio 5) Il commento del referente («Chi potrebbe saperlo?» con «Non ce l'ho»). */
  comment?: string | null;
  canRemove: boolean;
}

export interface NeedFileView {
  id: string;
  name: string;
  sizeLabel: string | null;
  dateLabel: string;
  source: "referente" | "revisore";
  authorLabel: string;
  status: "pulito" | "in_revisione";
  /** null quando chi guarda non lo può scaricare. */
  href: string | null;
  canDelete: boolean;
  /** Solo per «in_revisione» e solo per una persona di Lateral Space che non l'ha caricato. */
  canReview: boolean;
}

export interface NeedReferentView {
  needId: string;
  /** «Chiesta a Mario Rossi il 27/10 · Promemoria inviato il 30/10», oppure null se mai chiesta. */
  line: string | null;
  /** (Parte 2) Stato «chiesta» e l'ultima richiesta è scaduta o oltre l'ultimo promemoria: «Senza risposta». */
  silent: boolean;
  /** Inviate, non eliminate, dalla più recente. */
  answers: NeedAnswerView[];
  /** Non eliminati; quelli del referente solo dopo l'invio; «in_revisione» solo con canReviewFiles. */
  files: NeedFileView[];
  /** L'ultimo file dell'esigenza è un PDF non controllato in tempo: «File non controllato in tempo: …». */
  reviewExpired?: boolean;
}

/**
 * (Rilascio 5, §9.2, §9.5) Il referente dello use case per il blocco «Referente» di «Cosa serve»:
 * calcolato dalle richieste (mai salvato). R* è l'ultima richiesta al referente (la conferma e la
 * stima), R l'ultima non revocata alla sua persona (attesa, promemoria, revoca, «Chiedi di nuovo»).
 * Mai conteggi per persona; l'email arriva coperta.
 */
export interface ReferentBlockView {
  contact: { id: string; name: string; roleLabel: string | null; emailMasked: string | null; team: boolean };
  /** R: la richiesta su cui agiscono promemoria, revoca, «Chiedi di nuovo», «Correggi l'email». */
  requestId: string | null;
  /** R*: l'ultima richiesta al referente. */
  referentRequestId: string;
  state: "in_attesa" | "nessuna_risposta" | "da_verificare" | "fatto";
  /** Che cosa aspetta il team dalla risposta: una correzione, una stima, niente. */
  review: "correzione" | "stima" | null;
  /** R è viva («inviata» e non scaduta). */
  live: boolean;
  /** La conferma e la stima di R* (null: non è mai arrivata, solo dopo un ritorno alla versione di prima). */
  check: ReferentBlockCheck | null;
  /** Le domande a cui il referente ha risposto «Non ce l'ho» e ancora da chiedere (§3.7). */
  declinedNeedIds: string[];
  /** Fino a 3 «Chi potrebbe saperlo?» del referente sulle domande che non ha (§8.4). */
  hints: string[];
  /** Le domande da chiedere che il referente non ha già rifiutato (per «Chiedi al referente»). */
  askableForReferent: string[];
}

/** (Rilascio 5) La conferma e la stima del referente come le legge il blocco (§9.2). */
export interface ReferentBlockCheck {
  submittedAt: string | null;
  confirm: "si" | "correggi" | null;
  note: string | null;
  estimate: "si" | "meno" | "piu" | null;
  timesPerMonth: number | null;
  minutesEach: number | null;
  correctionDoneAt: string | null;
  outcome: "adottata" | "tenuta" | null;
  outcomeAt: string | null;
  /** La stima del team che il referente ha visto (l'istantanea), in ore di lavoro. */
  team: { key: string; volumeYear: number; minutes: number; hours: number; perMonth: number | null } | null;
  /** La stima del team di adesso è diversa dall'istantanea. */
  teamChanged: boolean;
  /** Lo use case ha adesso una stima del team in ore. */
  teamNow: boolean;
  /** Le ore di lavoro l'anno del referente, quando ha dato almeno un numero. */
  referentHours: number | null;
  /** La versione della richiesta R* (per le azioni del team sulla risposta). */
  version: number;
  /**
   * (Rilascio 5.1) La risposta su ogni voce di «Benefici e costi», nell'ordine delle righe che il referente
   * ha visto; null: la stima del tempo del rilascio 5 (le righe qui sopra), o niente inviato.
   */
  benefits?: ReferentBlockBenefit[] | null;
}

/** (Rilascio 5.1) La risposta del referente su una voce, come la legge il blocco «Referente». */
export interface ReferentBlockBenefit {
  key: string;
  form: ReferentBenefitView["form"];
  /** Il nome della voce come l'ha letto il referente. */
  label: string;
  /** La cifra del team che il referente ha visto (l'istantanea). */
  team: ReferentBenefitView["team"];
  answer: "si" | "meno" | "piu" | "no" | "non_so" | null;
  timesPerMonth: number | null;
  minutesEach: number | null;
  eurYear: number | null;
  comment: string | null;
  outcome: "adottata" | "tenuta" | null;
  outcomeAt: string | null;
  /** «cambiata»: la cifra di adesso non è quella vista; «tolta»: la voce non c'è più nel modello. */
  changed: "cambiata" | "tolta" | null;
  /** La risposta aspetta il team (e il team non ha ancora deciso). */
  needsReview: boolean;
  /** «Usa la stima di {Nome}» ha dei numeri da usare su questa voce. */
  adoptable: boolean;
}

export interface UseCaseReferentPanel {
  /** Funzione accesa e archivi pronti; false → REVIEWER_UI non mostra niente di questa funzione. */
  available: boolean;
  /** canEditNeeds */
  canAsk: boolean;
  /** canEditNeeds: i revisori del workspace controllano i PDF con poco testo (non chi li ha caricati). */
  canReviewFiles: boolean;
  /** Ogni controllo che blocca «Chiedi al referente», nell'ordine in cui si mostra; [] = si può inviare. */
  gates: ReferentGate[];
  /** Attivi, non anonimizzati; in ordine di created_at, id (mai per nome). */
  contacts: ReferentContactOption[];
  // (Rilascio 4) Le persone del workspace non stanno più nel pannello di ogni scheda: la finestra le
  // legge quando si apre (`listReferentPeopleAction`).
  /** Di questo use case, dalla più recente, al massimo 20. */
  requests: ReferentRequestView[];
  /** Chiave: id dell'esigenza in minuscolo, per le esigenze collegate a questa scheda. */
  needs: Record<string, NeedReferentView>;
  /** askableNeeds() per questa scheda, nell'ordine della scheda. */
  askableNeedIds: string[];
  /** Esigenze che accettano una risposta o un file del team (§3.9). */
  answerableNeedIds: string[];
  /** Cosa aggiungerebbe adesso «Prepara le domande». */
  preparable: PreparedQuestionKey[];
  /**
   * Alla scheda mancano dati che le domande standard chiedono (frequenza, tempo, …), anche se le
   * domande ci sono già o sono archiviate: il motivo di «Prepara le domande» spento lo dice.
   */
  prepareGaps?: boolean;
  /** L'account di chi guarda. */
  requester: { name: string; email: string | null };
  /** clientUploadAvailable(process.env) */
  upload: { clientMode: boolean };
  limits: typeof REFERENT_LIMITS;
  /**
   * (Rilascio 5) Lo use case ha un referente da scegliere («Da costruire», in valutazione o approvato):
   * il blocco «Referente» c'è. false: «Chiedi al referente» del rilascio 4, come prima.
   */
  eligible?: boolean;
  /** (Rilascio 5) Il referente dello use case; null: manca (o lo use case non ne ha uno da scegliere). */
  referent?: ReferentBlockView | null;
  /**
   * (Rilascio 5, §3.1) L'ultima richiesta al referente, anche revocata (null: mai): la finestra la
   * rimanda al server, che rifiuta l'invio se nel frattempo un collega ha scelto un altro referente.
   */
  latestReferentRequestId?: string | null;
}

export type PreparedQuestionKey = "frequenza" | "tempo" | "persone" | "sistemi" | "esempio" | "costi";

// ── Server action (BACKEND le implementa in src/lib/actions/use-case-referents.ts) ──

export type ReferentActionResult<T = null> =
  | { ok: true; data: T; message: string | null }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };

export interface SendReferentRequestInput {
  contact:
    | { kind: "esistente"; contactId: string }
    | { kind: "nuovo"; displayName: string; email: string; roleLabel?: string | null }
    /** (Referente già iscritto) Una persona del workspace scelta dall'elenco: il server la ricontrolla e crea o riusa il suo referente. */
    | { kind: "membro"; userId: string };
  needIds: string[];
  message?: string | null;
  /** «Chiedi di nuovo»: la richiesta che questa sostituisce (scaduta, o viva «Senza risposta»). */
  previousRequestId?: string | null;
  /**
   * (Rilascio 5) «referente»: la richiesta al referente dello use case (la conferma, la stima, le
   * domande, anche nessuna); «domande» (o assente): solo domande, come nel rilascio 4.
   */
  kind?: "referente" | "domande";
  /** (Rilascio 5) Le domande con «Serve un file»: un sottoinsieme di `needIds`. */
  fileRequired?: string[];
  /**
   * (Rilascio 5, solo «referente») L'ultima richiesta al referente come la vedeva la finestra (null se
   * non c'era): un'altra persona che nel frattempo ha scelto il referente fa rifiutare l'invio.
   */
  expectedReferentRequestId?: string | null;
  /** (Rilascio 5, solo «referente») «Cambia referente»: le richieste vive del referente di prima si revocano. */
  replaceReferent?: boolean;
}

export interface AddToReferentRequestInput {
  needIds: string[];
  /** (Rilascio 5) Le domande nuove con «Serve un file». */
  fileRequired?: string[];
}

export type FileReviewOutcome = "accetta" | "rifiuta";
