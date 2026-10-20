/**
 * Pagina e API pubbliche del referente (`/r/[token]`, `/api/r/[token]/…`):
 * tipi della vista, informativa, messaggi uniformi e regole pure su cosa il
 * referente può fare su una voce (PIANO §5.4, §5.5, D14, D28, D42, b30, b33).
 *
 * Le regole qui sotto rispecchiano la tabella delle transizioni
 * (`item-state.ts`) dal punto di vista del referente: il server le ricontrolla
 * sempre con `checkItemTransition` dentro `applyItemTransitions`. Servono alla
 * pagina per mostrare solo le azioni possibili e all'API per scegliere la
 * transizione giusta.
 *
 * Modulo puro e senza dipendenze dal server: i componenti del referente lo
 * possono importare anche nel browser.
 */
import type { Issue } from "./answers/issues.ts";
import type { ItemTrigger } from "./item-state.ts";
import { fail, ok, type Json, type Result } from "./types.ts";
import type {
  AnswerKind,
  ItemStatus,
  PrivacyClass,
  RequestItemState,
  ResponseType,
  ScanStatus,
} from "./vocab.ts";

// ── Informativa privacy ───────────────────────────────────────────────

/**
 * Informativa a due livelli (DESIGN §4.3 R0), mostrata al primo accesso di ogni
 * richiesta: tre punti da sapere e il testo completo in un riquadro chiuso. La
 * versione si registra sulla richiesta (`privacy_notice_version`) con «Ho
 * letto, iniziamo»: se il testo cambia, cambia anche la versione e
 * l'informativa torna a comparire. I testi stanno tutti qui, così si cambiano
 * in un commit (testo legale da confermare: DESIGN §9.2 domanda 2).
 */
export const REFERENT_PRIVACY_NOTICE = {
  version: "uc-2026-10-2",
  title: "Prima di iniziare",
  lead: "Tre cose da sapere sulle tue risposte.",
  summary: [
    "Ti chiediamo del lavoro, non di te. Non scrivere dati sanitari né nomi di persone: il sistema li blocca.",
    "Le risposte le vedono Lateral Space e chi segue il caso nella tua azienda. Non misuriamo i tuoi tempi.",
    "Il link è solo tuo e vale 30 giorni.",
  ],
  fullTextLabel: "Leggi l'informativa completa",
  /** Dopo la conferma l'informativa resta nel piè di pagina della Home con questo titolo. */
  footerLabel: "Come usiamo le tue risposte",
  contact: "Per domande o per cancellare i tuoi dati, scrivi a chi ti ha mandato il link.",
  button: "Ho letto, iniziamo",
  error: "Non riesco a registrarlo. Riprova tra poco.",
  paragraphs: [
    "Lateral Space raccoglie queste informazioni per conto della tua azienda, per preparare il caso d'uso. Le usiamo solo per questo.",
    "Ti chiediamo informazioni sul lavoro, non su di te. Non scrivere dati sanitari, nomi di persone, date di nascita o preferenze su genere, età, origine o religione: il sistema li blocca.",
    "Salviamo le tue risposte, il tuo nome, il ruolo e l'email che ci ha dato la tua azienda. Dell'indirizzo IP teniamo solo un'impronta cifrata, mai il numero.",
    "Non misuriamo i tuoi tempi e non facciamo classifiche tra persone. Le risposte le vedono Lateral Space e le persone della tua azienda che seguono il caso.",
    "Il link è personale e scade dopo 30 giorni. Non inoltrarlo: se serve, usa «Chiedi a un collega». Per domande o per cancellare i tuoi dati scrivi a chi ti ha mandato il link.",
  ],
} as const;

// ── Messaggi uniformi ─────────────────────────────────────────────────

/** Token sbagliato, scaduto, revocato o sezione spenta: sempre lo stesso testo. */
export const INVALID_LINK_MESSAGE = "Questo link non è più valido. Chiedi a chi te l'ha mandato un link nuovo.";
export const PAUSED_CASE_MESSAGE = "Il caso è in pausa: per ora non serve rispondere.";
export const PRIVACY_PENDING_MESSAGE = "Prima leggi l'informativa e premi «Ho letto, iniziamo».";
/** Domanda personale con la zona personale chiusa (DESIGN §4.3, «Si apriranno più avanti»). */
export const PERSONAL_LOCKED_MESSAGE = "Riguarda dati personali: si apre quando la tua azienda approva la scheda privacy.";
/** Le risposte personali, ai chiarimenti e le deleghe partono da sole, mai in un invio a gruppi (DESIGN §4.2). */
export const SINGLE_SEND_MESSAGE = "Questa risposta parte da sola: aprila e premi «Invia».";

/** Risposte al massimo per ogni `POST /api/r/[token]/answers` (DESIGN §7.1 P0-11). */
export const MAX_BATCH_ANSWERS = 50;

/** Esito di un comando pubblico: come `Result`, con gli `Issue` da mostrare accanto ai campi. */
export type PublicOutcome<T> = { ok: true; value: T } | { ok: false; code: string; message: string; issues?: Issue[] };

export function publicFail<T = never>(code: string, message: string, issues?: Issue[]): PublicOutcome<T> {
  return issues && issues.length > 0 ? { ok: false, code, message, issues } : { ok: false, code, message };
}

// ── Cosa può fare il referente su una voce ────────────────────────────

/** Tipi di risposta che il referente invia dal link (`POST …/answer`). */
export const REFERENT_ANSWER_KINDS = ["valore", "conferma", "correzione", "non_so", "proposta_na", "risposta_chiarimento"] as const satisfies readonly AnswerKind[];
export type ReferentAnswerKind = (typeof REFERENT_ANSWER_KINDS)[number];

/** Righe `uc_request_items` mostrate nella pagina del referente. */
export const VISIBLE_REQUEST_ITEM_STATES = ["da_fare", "bozza", "inviata", "non_so"] as const satisfies readonly RequestItemState[];

const ACTIVE: readonly RequestItemState[] = ["da_fare", "bozza", "inviata"];
const DATA_KINDS: readonly ReferentAnswerKind[] = ["valore", "conferma", "correzione"];
const REPLY_KINDS: readonly ReferentAnswerKind[] = ["valore", "conferma", "correzione", "proposta_na", "risposta_chiarimento"];

/** Classi i cui valori vanno solo cifrati nella zona personale. */
export const PERSONAL_CLASSES: readonly PrivacyClass[] = ["personale", "personale_equipaggio"];

export function isPersonalClass(privacyClass: PrivacyClass): boolean {
  return PERSONAL_CLASSES.includes(privacyClass);
}

/** Profondità massima delle deleghe (`uc_requests.delegation_depth`, b33). */
export const MAX_DELEGATION_DEPTH = 2;

export interface ReferentItemFacts {
  status: ItemStatus;
  requestItemState: RequestItemState;
  /** La voce è ancora assegnata al referente del link. */
  assignedToMe: boolean;
  privacyClass: PrivacyClass;
  /** `a8` sciolto e chiave della zona personale configurata. */
  personalZoneOpen: boolean;
  /** Link scrivibile (`uc_request_live`): falso con il caso in pausa. */
  writable: boolean;
  /** `delegation_depth` della richiesta del link. */
  delegationDepth: number;
}

export interface ReferentCapabilities {
  /** Inviare un valore, una conferma, una correzione o la risposta a un chiarimento. */
  answer: boolean;
  /** Solo valori (nuova versione di una voce già validata). */
  newVersionOnly: boolean;
  /** «Ho risposto solo in parte». */
  partial: boolean;
  /** «Non lo so». */
  notKnown: boolean;
  /** «Chiedi a un collega». */
  delegate: boolean;
  /** «Non si applica». */
  proposeNa: boolean;
  /** Salvataggio automatico della bozza sul server (mai per le voci personali). */
  draft: boolean;
  /** Perché la voce non si può modificare adesso, se non si può. */
  lockedReason: string | null;
}

const NONE: ReferentCapabilities = {
  answer: false,
  newVersionOnly: false,
  partial: false,
  notKnown: false,
  delegate: false,
  proposeNa: false,
  draft: false,
  lockedReason: null,
};

function locked(reason: string): ReferentCapabilities {
  return { ...NONE, lockedReason: reason };
}

/**
 * Azioni possibili sulla voce, secondo la tabella delle transizioni (righe 5,
 * 6, 7b, 8, 11, 14, 23) e le regole della pagina:
 * - `chiesta` con la riga attiva: risposta, parziale, «Non lo so», delega, NA;
 * - `mancante` (anche dopo «Non lo so», risposta tardiva): risposta e NA;
 * - `parziale`: risposta completa e NA;
 * - `validata`: solo una nuova versione del valore;
 * - `in_verifica`: niente, finché Lateral Space non risponde.
 * Le voci sanitarie non ammettono valori; quelle personali solo con la zona
 * personale aperta e mai in bozza.
 */
export function referentCapabilities(f: ReferentItemFacts): ReferentCapabilities {
  if (!f.writable) return locked(PAUSED_CASE_MESSAGE);
  if (!f.assignedToMe) return locked("Questa domanda non è più assegnata a te.");
  if (f.privacyClass === "escluso_sanitario") return locked("Qui non raccogliamo dati sanitari.");
  const personal = isPersonalClass(f.privacyClass);
  if (personal && !f.personalZoneOpen) return locked(PERSONAL_LOCKED_MESSAGE);
  const active = ACTIVE.includes(f.requestItemState);
  const draft = !personal;
  switch (f.status) {
    case "chiesta":
      if (!active) return locked("Questa domanda non è più nel tuo link.");
      return {
        answer: true,
        newVersionOnly: false,
        partial: true,
        notKnown: true,
        delegate: f.delegationDepth < MAX_DELEGATION_DEPTH,
        proposeNa: true,
        draft,
        lockedReason: null,
      };
    case "mancante":
      if (!active && f.requestItemState !== "non_so") return locked("Questa domanda non è più nel tuo link.");
      return { ...NONE, answer: true, proposeNa: true, draft };
    case "parziale":
      if (!active) return locked("Questa domanda non è più nel tuo link.");
      return { ...NONE, answer: true, proposeNa: true, draft };
    case "validata":
      if (!active) return locked("Questa domanda non è più nel tuo link.");
      return { ...NONE, answer: true, newVersionOnly: true, draft };
    case "in_verifica":
      return locked("La risposta è in verifica da Lateral Space.");
    default:
      return locked("Per ora questa domanda non si può modificare.");
  }
}

/**
 * Transizione per una risposta del referente. `partial` vale solo da
 * `chiesta` (riga 6); «Non lo so» solo da `chiesta` (riga 7b, D28); da
 * `validata` solo valori, conferme e correzioni (riga 23).
 */
export function planReferentAnswer(i: { status: ItemStatus; requestItemState: RequestItemState; kind: ReferentAnswerKind; partial: boolean }): Result<{ to: ItemStatus; trigger: ItemTrigger }> {
  const active = ACTIVE.includes(i.requestItemState);
  if (i.kind === "non_so") {
    if (i.status === "chiesta" && active) return ok({ to: "mancante", trigger: "non_so" });
    return fail("stato_non_ammesso", "«Non lo so» si può dire solo su una domanda ancora aperta.");
  }
  if (i.partial) {
    if (i.status === "chiesta" && active && DATA_KINDS.includes(i.kind)) return ok({ to: "parziale", trigger: "risposta_parziale" });
    if (i.status === "chiesta" && active) return fail("tipo_risposta_non_ammesso", "Una risposta parziale contiene un valore.");
    return fail("stato_non_ammesso", "La risposta parziale si invia solo su una domanda ancora aperta: completa la risposta.");
  }
  switch (i.status) {
    case "chiesta":
      if (active && REPLY_KINDS.includes(i.kind)) return ok({ to: "in_verifica", trigger: "risposta" });
      break;
    case "mancante":
      if ((active || i.requestItemState === "non_so") && REPLY_KINDS.includes(i.kind)) return ok({ to: "in_verifica", trigger: "risposta" });
      break;
    case "parziale":
      if (active && REPLY_KINDS.includes(i.kind)) return ok({ to: "in_verifica", trigger: "risposta" });
      break;
    case "validata":
      if (active && DATA_KINDS.includes(i.kind)) return ok({ to: "in_verifica", trigger: "nuova_versione" });
      if (active) return fail("tipo_risposta_non_ammesso", "Su una risposta validata puoi solo inviare una nuova versione del valore.");
      break;
    case "in_verifica":
      return fail("stato_non_ammesso", "La risposta è già in verifica da Lateral Space.");
    default:
      break;
  }
  return fail("stato_non_ammesso", "Per ora questa domanda non si può modificare.");
}

// ── Etichette per il referente ────────────────────────────────────────

export type ReferentTone = "da_fare" | "bozza" | "chiarimento" | "inviata" | "validata" | "parziale" | "non_so" | "mancante" | "ferma";

/**
 * Stato della voce come lo legge il referente, con le parole del cliente di
 * DESIGN §2.6 («Da rispondere», «Da completare», «In verifica», «A posto»):
 * niente gergo interno, nessun colore del semaforo di Lateral Space.
 */
export function referentStatusLabel(i: { status: ItemStatus; requestItemState: RequestItemState; clarification: boolean; hasDraft: boolean }): { label: string; tone: ReferentTone } {
  if (i.status === "chiesta" && i.clarification) return { label: "Ti chiediamo un chiarimento", tone: "chiarimento" };
  switch (i.status) {
    case "chiesta":
      return i.hasDraft || i.requestItemState === "bozza" ? { label: "Bozza salvata", tone: "bozza" } : { label: "Da rispondere", tone: "da_fare" };
    case "in_verifica":
      return { label: "In verifica", tone: "inviata" };
    case "validata":
      return { label: "A posto", tone: "validata" };
    case "parziale":
      return { label: "Da completare", tone: "parziale" };
    case "mancante":
      return i.requestItemState === "non_so" ? { label: "Hai risposto «Non lo so»", tone: "non_so" } : { label: "Da rispondere", tone: "mancante" };
    case "non_applicabile":
      return { label: "Non si applica", tone: "validata" };
    default:
      return { label: "In attesa", tone: "ferma" };
  }
}

/** La voce conta come «fatta» nell'avanzamento («3 di 8»). */
export function referentItemDone(i: { status: ItemStatus; requestItemState: RequestItemState }): boolean {
  if (i.requestItemState === "non_so") return true;
  return i.requestItemState === "inviata" && i.status !== "chiesta";
}

/**
 * Domanda personale ancora chiusa (zona personale non aperta): non conta
 * nell'avanzamento e sta in «Si apriranno più avanti» (DESIGN §4.4 punto 6).
 */
export function isLockedPersonal(i: { personal: boolean; can: Pick<ReferentCapabilities, "answer" | "lockedReason"> }): boolean {
  return i.personal && !i.can.answer && i.can.lockedReason === PERSONAL_LOCKED_MESSAGE;
}

/**
 * Avanzamento del link: fatte / (fatte + rispondibili adesso). Le domande
 * personali chiuse, e ogni domanda che per ora non si può toccare, restano
 * fuori dal totale (DESIGN §4.4 punto 6).
 */
export function referentProgress(items: readonly { done: boolean; personal: boolean; can: Pick<ReferentCapabilities, "answer" | "lockedReason"> }[]): { done: number; total: number } {
  const counted = items.filter((i) => !isLockedPersonal(i) && (i.done || i.can.answer));
  return { done: counted.filter((i) => i.done).length, total: counted.length };
}

/**
 * Nome per il saluto («Ciao Marco»): la prima parola del nome del referente,
 * solo se sembra un nome (lettere, apostrofo, trattino). Altrimenti null e la
 * pagina dice solo «Ciao».
 */
export function greetingNameFrom(displayName: string | null | undefined): string | null {
  const first = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  if (first.length < 2 || first.length > 30) return null;
  if (!/^\p{Lu}[\p{L}'’-]*$/u.test(first)) return null;
  return first;
}

// ── Invio a gruppi ────────────────────────────────────────────────────

/** Esito di una risposta dentro `POST /api/r/[token]/answers`: ognuna ha il suo. */
export type BatchAnswerOutcome =
  | { itemId: string; ok: true; status: string; label: string }
  | { itemId: string; ok: false; code: string; message: string; issues?: Issue[] };

export interface BatchAnswersResult {
  sent: number;
  failed: number;
  results: BatchAnswerOutcome[];
}

// ── Vista della pagina ────────────────────────────────────────────────

export interface ReferentFileView {
  id: string;
  name: string;
  sizeBytes: number | null;
  status: ScanStatus;
  /** Pulito e scansionato (o revisionato): si può allegare a una risposta. */
  usable: boolean;
}

/** Valore già noto da confermare («Ci avete già detto: …»). */
export interface ReferentDeclaredValue {
  /** Id della risposta da confermare (`supersedes_answer_id`). */
  answerId: string;
  /**
   * Il valore come testo. Un valore che il referente non vede (`solo_ls`) non
   * arriva nemmeno qui: la domanda si pone normalmente (DESIGN §4.3 R2a).
   */
  display: string | null;
  /** Il valore come salvato, per precompilare il campo con «Correggi». */
  value: Json | null;
  /** «In una call con Lateral Space», «Da un documento: …», mai codici. */
  sourceLabel: string;
  declaredInCall: boolean;
  /** «Confermo» con un clic: il valore è già nel formato richiesto (D45). */
  canConfirm: boolean;
  /** Valore letto dal testo per precompilare l'input tipizzato («Controlla e invia»). */
  prefill: Json | null;
  /** Cosa manca ancora nel valore precompilato (per esempio l'IVA). */
  missing: Issue[];
}

export interface ReferentOwnAnswer {
  kind: AnswerKind;
  version: number;
  /** Il valore inviato come testo; null per i valori personali (restano cifrati). */
  display: string | null;
  /** Il valore inviato, per ripartire da lì (nuova versione, chiarimento); null per i valori personali. */
  value: Json | null;
  estimate: boolean;
  encrypted: boolean;
}

export interface ReferentItemView {
  id: string;
  key: string;
  title: string;
  explanation: string | null;
  why: string | null;
  example: string | null;
  help: string | null;
  /** Suggerimento del template sull'allegato. */
  attachmentHint: string | null;
  responseType: ResponseType | null;
  config: Record<string, Json>;
  status: ItemStatus;
  statusReason: string | null;
  requestItemState: RequestItemState;
  label: string;
  tone: ReferentTone;
  done: boolean;
  personal: boolean;
  requiresValidFrom: boolean;
  /** Domanda sulla regola dei dati sanitari: la pagina avvisa prima dell'invio. */
  healthRuleQuestion: boolean;
  /** Risposta corrente della voce (controllo di concorrenza: `supersedes_answer_id`). */
  currentAnswerId: string | null;
  toConfirm: ReferentDeclaredValue | null;
  ownAnswer: ReferentOwnAnswer | null;
  /** Domanda di chiarimento di Lateral Space ancora aperta. */
  clarification: string | null;
  /** Bozza salvata sul server (mai per le voci personali). */
  draft: Json | null;
  files: ReferentFileView[];
  can: ReferentCapabilities;
}

export interface ReferentModuleView {
  /** null = «Altre domande» (voci fuori dai moduli del template). */
  key: string | null;
  title: string;
  why: string | null;
  instructions: string | null;
  estimatedMinutes: number | null;
  estimatedLabel: string | null;
  /** Domande dell'argomento in tutto il caso (per dividere `estimatedMinutes` in proporzione). */
  questionCount: number | null;
  items: ReferentItemView[];
}

export const APPROVAL_KINDS = ["na", "deroga", "ripiego", "gate", "a8", "zona_personale"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

/** Una firma in attesa del firmatario designato (link di approvazione). */
export interface ApprovalView {
  kind: ApprovalKind;
  /** Voce, revisione del gate, blocco o utente (zona personale). */
  targetId: string;
  designation: "owner" | "privacy";
  title: string;
  /** Testo di riepilogo canonico, riga per riga. */
  lines: string[];
  /** Impronta del testo mostrato: torna con «Approvo» o «Non approvo». */
  textHash: string;
  /** «Non approvo» possibile (NA e gate); per gli altri basta non firmare. */
  canReject: boolean;
  /** Lateral Space non ha ancora firmato. */
  waitingForLs: boolean;
}

export interface ReferentView {
  /** `sola_lettura` con il caso in pausa. */
  access: "scrivibile" | "sola_lettura";
  mode: "raccolta" | "approvazioni";
  clientLabel: string;
  caseCode: string;
  caseTitle: string;
  /** Nome del referente per «Ciao Marco» (DESIGN §9.1 punto 17), oppure null: «Ciao». */
  greetingName: string | null;
  paused: boolean;
  /** Scadenza del link (ISO). */
  expiresAt: string;
  privacy: { acknowledged: boolean; version: string };
  /**
   * Avanzamento = fatte / rispondibili adesso (DESIGN §4.4 punto 6): le domande
   * personali ancora chiuse non contano e stanno in un elenco a parte.
   */
  progress: { done: number; total: number };
  estimatedMinutes: number;
  modules: ReferentModuleView[];
  delegation: { allowed: boolean; depth: number; max: number };
  approvals: ApprovalView[];
  /** Le email partono davvero: altrimenti dopo una delega si copia il link. */
  emailConfigured: boolean;
}

/** Cosa legge `/r/[token]`: la scheda generica, oppure la pagina (scrivibile o in sola lettura). */
export type ReferentPage = { access: "non_valido" } | { access: "scrivibile" | "sola_lettura"; view: ReferentView };

/** Titolo del gruppo delle voci fuori dai moduli. */
export const OTHER_QUESTIONS_TITLE = "Altre domande";
