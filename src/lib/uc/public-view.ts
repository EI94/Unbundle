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
import { R_TEXT } from "./views/referente-text.ts";
import type {
  AnswerKind,
  ItemStatus,
  PrivacyClass,
  RequestItemState,
  ResponseType,
  ScanStatus,
} from "./vocab.ts";

// ── Informativa privacy ───────────────────────────────────────────────

/** Il testo dell'informativa di una versione, come `REFERENT_PRIVACY_NOTICE` e come il server lo manda nella vista. */
export interface ReferentNoticeText {
  version: string;
  title: string;
  lead: string;
  summary: readonly string[];
  fullTextLabel: string;
  footerLabel: string;
  contact: string;
  button: string;
  error: string;
  paragraphs: readonly string[];
}

/**
 * Informativa a due livelli (DESIGN §4.3 R0), mostrata al primo accesso di ogni
 * richiesta: tre punti da sapere e il testo completo in un riquadro chiuso. La
 * versione si registra sulla richiesta (`privacy_notice_version`) con «Ho
 * letto, iniziamo»: se il testo cambia, cambia anche la versione e
 * l'informativa torna a comparire. I testi stanno tutti qui, così si cambiano
 * in un commit (testo legale da confermare: DESIGN §9.2 domanda 2).
 *
 * (Ondata 0) Versione `uc-2026-11-1`, come quella di `/rispondi` dal rilascio
 * 5.1: nomi, email e telefoni non si bloccano più (`referentLinkScan`), la
 * casella sui file non c'è più e il controllo automatico dei file lo dice una
 * riga; «caso d'uso» al posto di «caso». Chi aveva letto `uc-2026-10-2` la
 * rivede una volta. Testo da approvare dal titolare prima del rilascio.
 *
 * Quando la versione cambia, le scritture di chi aveva letto la vecchia
 * aspettano con `informativa_aggiornata` (un 503: la pagina aperta da prima
 * del rilascio tiene così le bozze e riprova) e la vista manda il testo nuovo,
 * che la pagina mostra al posto del suo (`noticeFor`).
 */
export const REFERENT_PRIVACY_NOTICE = {
  version: "uc-2026-11-1",
  title: "Prima di iniziare",
  lead: "Tre cose da sapere sulle tue risposte.",
  summary: [
    "Ti chiediamo del lavoro, non di te. Non servono dati sanitari: se ne troviamo, ti chiediamo di toglierli.",
    "Le risposte le vedono Lateral Space e chi segue il caso d'uso nella tua azienda. Non misuriamo i tuoi tempi.",
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
    "Ti chiediamo informazioni sul lavoro, non su di te. Se scrivi il nome di un collega, un'email o un telefono, li usiamo solo per questo caso d'uso. Non servono dati sanitari, codici fiscali, date di nascita o preferenze su genere, età, origine o religione: se ne troviamo, ti chiediamo di toglierli.",
    "Ogni file passa da un controllo automatico prima di essere usato.",
    "Salviamo le tue risposte, il tuo nome, il ruolo e l'email che ci ha dato la tua azienda. Dell'indirizzo IP teniamo solo un'impronta cifrata, mai il numero.",
    "Non misuriamo i tuoi tempi e non facciamo classifiche tra persone. Le risposte le vedono Lateral Space e le persone della tua azienda che seguono il caso d'uso.",
    "Il link è personale e scade dopo 30 giorni. Non inoltrarlo: se serve, usa «Chiedi a un collega». Per domande o per cancellare i tuoi dati scrivi a chi ti ha mandato il link.",
  ],
} as const satisfies ReferentNoticeText;

/**
 * (Ondata 0) Il testo da mostrare per la versione che il server chiede di accettare (`privacy.version`): quello della
 * vista, che il server manda da Ondata 0, oppure quello di questa pagina se è della stessa versione. null se nessuno
 * dei due lo è (una pagina e un server di rilasci diversi, senza Skew Protection): la pagina chiede di ricaricarsi,
 * perché non si accetta mai una versione di cui si è letto un altro testo.
 */
export function noticeFor(privacy: { version: string; notice?: ReferentNoticeText }, own: ReferentNoticeText = REFERENT_PRIVACY_NOTICE): ReferentNoticeText | null {
  if (privacy.notice && privacy.notice.version === privacy.version) return privacy.notice;
  return own.version === privacy.version ? own : null;
}

/**
 * Il corpo di «Ho letto, iniziamo» (`POST /api/r/[token]/privacy-ack`): la versione accettata e (rilascio del 19/11)
 * `shown`, la versione del testo che la pagina aveva sullo schermo (`noticeFor`). La pagina di produzione (49414cc9)
 * non lo manda.
 */
export interface PrivacyAckBody {
  version: string;
  shown: string;
}

/**
 * (Rilascio del 19/11) «Ho letto, iniziamo» si registra solo con la prova del testo mostrato: `version` e `shown` sono
 * tutte e due la versione di adesso. La pagina di produzione (49414cc9) mostra il testo che ha dentro (`uc-2026-10-2`)
 * e manda solo `version`: al primo tocco ha `informativa_cambiata` e rilegge la vista, che porta la versione del server;
 * senza la prova, il secondo tocco registrerebbe un consenso a un testo che il referente non ha visto.
 */
export function privacyAckShown(body: { version?: unknown; shown?: unknown }, current: string = REFERENT_PRIVACY_NOTICE.version): boolean {
  return body.version === current && body.shown === current;
}

// ── Messaggi uniformi ─────────────────────────────────────────────────

/**
 * Token sbagliato, scaduto, revocato o sezione spenta: sempre lo stesso testo. (Rilascio 10, §3.11) Le parole della
 * scheda unica delle pagine pubbliche: «Questo link non vale più.» e la risposta all'email, che arriva a chi ha scritto.
 */
export const INVALID_LINK_MESSAGE = `${R_TEXT.invalidLink.title} ${R_TEXT.invalidLink.body}`;
export const PAUSED_CASE_MESSAGE = "Il caso d'uso è in pausa: per ora non serve rispondere.";
/** Il pulsante dell'informativa con le sue parole: se l'informativa cambia, il messaggio la segue. */
export const PRIVACY_PENDING_MESSAGE = `Prima leggi l'informativa e premi «${REFERENT_PRIVACY_NOTICE.button}».`;
/**
 * (Ondata 0) L'informativa letta su questa richiesta è di una versione vecchia (`informativa_aggiornata`): le
 * scritture aspettano «Ho letto, iniziamo» sulla nuova. Il testo è per chi ha la pagina aperta da prima del rilascio,
 * che l'informativa non sa mostrarla di nuovo.
 */
export const PRIVACY_UPDATED_MESSAGE = "Abbiamo aggiornato l'informativa: ricarica la pagina per leggerla e continuare.";

/**
 * (Ondata 0) Una scrittura aspetta l'informativa: mai letta (`informativa_da_leggere`), oppure letta in una versione
 * vecchia (`informativa_aggiornata`). Non rifiuta quello che il referente ha scritto: la pagina lo tiene, anche sul
 * dispositivo, e mostra di nuovo l'informativa.
 */
export function waitsForPrivacy(code: string): boolean {
  return code === "informativa_da_leggere" || code === "informativa_aggiornata";
}
/**
 * Domanda personale con la zona personale chiusa (DESIGN §4.3, «Si apriranno più avanti»). (Rilascio 10, RD-5) Senza
 * il nome della scheda: «dà l'ok», come per i fornitori. È il messaggio dei rifiuti; la chiave della vista è
 * `PERSONAL_LOCKED_KEY_BEFORE`, per questo rilascio.
 */
export const PERSONAL_LOCKED_MESSAGE = "Riguarda dati personali: si apre quando la tua azienda dà l'ok.";
/**
 * (Rilascio 10) Il testo di prima, che è anche la chiave con cui la pagina riconosce una domanda personale ancora chiusa
 * (`isLockedPersonal` sul `lockedReason` della vista). Senza Skew Protection, per questo rilascio la vista la manda
 * ancora e la pagina accetta tutte e due: una scheda aperta prima del rilascio (il codice di prima conosce solo questa)
 * e una aperta prima di un rollback continuano a mostrare «Si apriranno più avanti». La pagina non la mostra mai. Dal
 * rilascio dopo la vista può mandare `PERSONAL_LOCKED_MESSAGE`.
 */
export const PERSONAL_LOCKED_KEY_BEFORE = "Riguarda dati personali: si apre quando la tua azienda approva la scheda privacy.";
/** Le chiavi di una domanda personale chiusa che la pagina riconosce: la nuova e quella di prima. */
const PERSONAL_LOCKED_KEYS: readonly string[] = [PERSONAL_LOCKED_MESSAGE, PERSONAL_LOCKED_KEY_BEFORE];
/** Le risposte personali, ai chiarimenti e le deleghe partono da sole, mai in un invio a gruppi (DESIGN §4.2). */
export const SINGLE_SEND_MESSAGE = "Questa risposta parte da sola: aprila e premi «Invia».";

// ── Scansione dei testi del referente ─────────────────────────────────

/** Le opzioni di scansione dei testi scritti su `/r` (`ScanOptions` di `text/scan.ts`). */
export interface ReferentLinkScan {
  context: "risposta";
  allowNamesAndContacts: true;
  healthRuleQuestion?: { questionText: string };
}

/**
 * (Ondata 0) La scansione dei testi del referente su `/r`, come su `/rispondi`
 * dal rilascio 5.1 (decisione del titolare del 04/11/2026, «basta che lo
 * diciamo prima nelle informative»): nomi di persone, email e telefoni
 * passano; dati sanitari e preferenze discriminatorie si fermano sempre, anche
 * in bozza; codici fiscali e date di nascita all'invio. Vale per ogni testo
 * della pagina: risposte, note, motivi, «Chi potrebbe saperlo», la delega e
 * «Non approvo». La usano il server (`uc-public.ts`) e il controllo prima
 * dell'invio nel browser (`views/referente-form.ts`). Con una domanda sulla
 * regola sanitaria, i termini del suo testo danno solo un avviso.
 */
export function referentLinkScan(question?: { healthRuleQuestion: boolean; title: string }): ReferentLinkScan {
  return question?.healthRuleQuestion
    ? { context: "risposta", allowNamesAndContacts: true, healthRuleQuestion: { questionText: question.title } }
    : { context: "risposta", allowNamesAndContacts: true };
}

/** Risposte al massimo per ogni `POST /api/r/[token]/answers` (DESIGN §7.1 P0-11). */
export const MAX_BATCH_ANSWERS = 50;

/** Esito di un comando pubblico: come `Result`, con gli `Issue` da mostrare accanto ai campi. */
export type PublicOutcome<T> = { ok: true; value: T } | { ok: false; code: string; message: string; issues?: Issue[] };

export function publicFail<T = never>(code: string, message: string, issues?: Issue[]): PublicOutcome<T> {
  return issues && issues.length > 0 ? { ok: false, code, message, issues } : { ok: false, code, message };
}

/** Il 503 calmo delle pagine pubbliche (`non_disponibile`): si riprova, senza dire perché. */
export const PUBLIC_UNAVAILABLE_MESSAGE = "Il servizio non è disponibile in questo momento. Riprova tra poco.";

/**
 * (8.0c) Per chi apre il link, un controllo che adesso non si è potuto fare (`non_disponibile`: per esempio non si riesce
 * a leggere chi costruisce il caso, e la firma o la delega non passano alla cieca) è il 503 calmo delle pagine
 * pubbliche, «riprova tra poco», mai un altro motivo («non sei più il firmatario», «è di Lateral Space»). null per ogni
 * altro esito.
 */
export function publicUnavailable(r: Result<unknown>): PublicOutcome<never> | null {
  return !r.ok && r.code === "non_disponibile" ? publicFail("non_disponibile", PUBLIC_UNAVAILABLE_MESSAGE) : null;
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
  // (Rilascio 10) La chiave di prima, che anche le pagine aperte prima del rilascio riconoscono (`isLockedPersonal`).
  if (personal && !f.personalZoneOpen) return locked(PERSONAL_LOCKED_KEY_BEFORE);
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
 * (Rilascio 10) Con la chiave nuova o con quella di prima: una vista di un
 * server di un altro rilascio (prima del rilascio, dopo un rollback) vale lo
 * stesso.
 */
export function isLockedPersonal(i: { personal: boolean; can: Pick<ReferentCapabilities, "answer" | "lockedReason"> }): boolean {
  return i.personal && !i.can.answer && i.can.lockedReason !== null && PERSONAL_LOCKED_KEYS.includes(i.can.lockedReason);
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
  privacy: {
    acknowledged: boolean;
    version: string;
    /** (Ondata 0) Il testo di `version`: la pagina mostra questo, non il suo, se non è lo stesso. Manca da un server di prima. */
    notice?: ReferentNoticeText;
  };
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
