/**
 * «Chiedi al referente»: il contratto condiviso tra il server (BACKEND), la pagina pubblica
 * `/rispondi/<token>` (PUBLIC) e il capitolo «Cosa serve» della scheda (REVIEWER_UI). Tipi,
 * percorsi e limiti: l'unica fonte per i tre. I testi italiani stanno in `labels.ts`.
 *
 * Modulo puro: import relativi `.ts`, nessun `server-only`, si usa anche nei componenti client.
 */
import type { Issue } from "../../uc/answers/issues.ts";
import type { SemaforoColor } from "../../uc/vocab.ts";
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
} as const;
export const reviewerFilesBase = (workspaceId: string, useCaseId: string) => `/dashboard/${workspaceId}/use-cases/${useCaseId}/allegati`;
export const reviewerFileHref = (workspaceId: string, useCaseId: string, fileId: string) => `${reviewerFilesBase(workspaceId, useCaseId)}/${fileId}`;
export const subprocessorsSettingsHref = (workspaceId: string) => `/dashboard/${workspaceId}/settings#sub-responsabili`;
export const REFERENT_CRON_PATH = "/api/cron/use-case-referents";
// (Parte 2) Nessun tipo di segnale in `weekly_signals`: le righe della campanella sono use_case_notifications.
export const cosaServeHref = (workspaceId: string, useCaseId: string) => `/dashboard/${workspaceId}/use-cases/${useCaseId}?capitolo=cosa-serve`;

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
  /** Solo mentre è «aperta». */
  draft: { text: string; dontKnow: boolean; savedAt: string } | null;
  /** Quando è «inviata». */
  answer: { text: string | null; dontKnow: boolean; submittedAt: string } | null;
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
  /** Nomi, email o telefoni trovati nel file (solo codici, mai i valori). */
  warning: string | null;
  /** Avviso presente e non ancora confermato: serve «Servono, lo lascio» prima di inviare. */
  needsConfirmation: boolean;
  submitted: boolean;
}

export interface ReferentUploadResult {
  fileId: string;
  fileName: string;
  sizeBytes: number | null;
  status: "pulito" | "in_revisione" | "rifiutato";
  usable: boolean;
  message: string | null;
  warning: string | null;
  needsConfirmation: boolean;
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
}
export interface SubmitBody {
  needIds?: string[];
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
  reason: "senza_email" | "lateral_space" | "richiesta_aperta" | "sei_tu" | null;
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
}

export interface ReferentRequestView {
  id: string;
  version: number;
  contact: { id: string; name: string; roleLabel: string | null; emailMasked: string | null; hubOnly: boolean };
  /** Stato per i revisori. Una richiesta «inviata» oltre `expires_at` si mostra «scaduta». Non esiste «in corso». */
  status: ReferentRequestStatus;
  statusLabel: string;
  tone: SemaforoColor;
  /** (Parte 2) Viva, reminder_count = 2 e domande aperte: statusLabel «Senza risposta», tono rosso, «Chiedi di nuovo» ammesso. */
  silent: boolean;
  /** Righe già scritte in italiano, per esempio «Inviata il 27/10 · scade il 26/11». Niente conteggi, mai dalla lettura dell'informativa. */
  lines: string[];
  /** Avvisi bloccanti su questa richiesta viva (promemoria fermi senza l'autorizzazione ai fornitori, email cambiata). */
  notices: string[];
  email: { state: "in_partenza" | "partita" | "non_partita"; label: string | null };
  needIds: string[];
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
}

export interface NeedAnswerView {
  id: string;
  source: "referente" | "revisore";
  authorLabel: string;
  dateLabel: string;
  text: string | null;
  dontKnow: boolean;
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
  /** «Può contenere dati personali»: dai codici degli avvisi, mai dai valori. */
  personalWarning: boolean;
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
}

export interface UseCaseReferentPanel {
  /** Funzione accesa e archivi pronti; false → REVIEWER_UI non mostra niente di questa funzione. */
  available: boolean;
  /** canEditNeeds */
  canAsk: boolean;
  /** abilities.isLateralSpace && canEditNeeds */
  canReviewFiles: boolean;
  /** Ogni controllo che blocca «Chiedi al referente», nell'ordine in cui si mostra; [] = si può inviare. */
  gates: ReferentGate[];
  /** Attivi, non anonimizzati; in ordine di created_at, id (mai per nome). */
  contacts: ReferentContactOption[];
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
  /** L'account di chi guarda. */
  requester: { name: string; email: string | null };
  /** clientUploadAvailable(process.env) */
  upload: { clientMode: boolean };
  limits: typeof REFERENT_LIMITS;
}

export type PreparedQuestionKey = "frequenza" | "tempo" | "persone" | "sistemi" | "esempio" | "costi";

// ── Server action (BACKEND le implementa in src/lib/actions/use-case-referents.ts) ──

export type ReferentActionResult<T = null> =
  | { ok: true; data: T; message: string | null }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };

export interface SendReferentRequestInput {
  contact: { kind: "esistente"; contactId: string } | { kind: "nuovo"; displayName: string; email: string; roleLabel?: string | null };
  needIds: string[];
  message?: string | null;
  /** «Chiedi di nuovo»: la richiesta che questa sostituisce (scaduta, o viva «Senza risposta»). */
  previousRequestId?: string | null;
}

export interface AddToReferentRequestInput {
  needIds: string[];
}

export type FileReviewOutcome = "accetta" | "rifiuta";
