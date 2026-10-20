/**
 * Stati della voce e transizioni ammesse, controllate solo lato server
 * (PIANO §3.2, D10, D28).
 *
 * Whitelist di 33 coppie (da → a): le 28 della specifica più 5 [D10]
 * (parziale → bloccata, in_verifica → bloccata, chiesta → da_chiedere per la
 * revoca, chiesta → non_applicabile per la NA proposta da Lateral Space,
 * non_applicabile → bloccata per la riapertura di una voce con un blocco attivo:
 * il lucchetto non si apre riaprendo una NA). Ogni coppia ammette solo certi
 * motivi (`ItemTrigger`) e certi attori; le guardie dei quattro occhi stanno in
 * `permissions.ts`. Il referente agisce solo sulle voci assegnate a lui e
 * presenti nella sua richiesta (`actorRequestItem`).
 *
 * Lo stato iniziale (`import`) lo scrivono solo la creazione del caso e il seed,
 * fuori da questa macchina (`checkImportedState`).
 *
 * Modulo puro: import relativi `.ts`, nessun accesso a DB o ambiente. Il comando
 * legge lo snapshot, chiama `checkItemTransition` e scrive con CAS
 * (`WHERE status = <from>`).
 */
import { isCasePastG1 } from "./case-state.ts";
import { computeStaleAt } from "./freshness.ts";
import { isRequired } from "./gates.ts";
import { actorClasses, approvalsComplete, canValidate, naSignatures, ownerRoleSatisfied, type ActorClass } from "./permissions.ts";
import { fail, ok, type Actor, type ItemSnapshot, type Result, type UserContext } from "./types.ts";
import {
  ACTIVE_REQUEST_ITEM_STATES,
  ITEM_STATUSES,
  type AnswerKind,
  type CaseStatus,
  type ItemStatus,
  type RequestItemState,
  type SourceKind,
} from "./vocab.ts";

export type ItemTrigger =
  | "invio_richiesta"
  | "richiesta_conferma"
  | "risposta"
  | "risposta_parziale"
  | "inserimento_ls"
  | "import"
  | "valida"
  | "chiarimento"
  | "esito_parziale"
  | "esito_mancante"
  | "scadenza"
  | "non_so"
  | "delega"
  | "riassegna"
  | "blocco_attivato"
  | "blocco_sciolto"
  | "na_approvata"
  | "na_respinta"
  | "riapri"
  | "dato_scaduto"
  | "nuova_versione"
  | "richiesta_revocata";

export const ITEM_TRIGGERS: readonly ItemTrigger[] = [
  "invio_richiesta",
  "richiesta_conferma",
  "risposta",
  "risposta_parziale",
  "inserimento_ls",
  "import",
  "valida",
  "chiarimento",
  "esito_parziale",
  "esito_mancante",
  "scadenza",
  "non_so",
  "delega",
  "riassegna",
  "blocco_attivato",
  "blocco_sciolto",
  "na_approvata",
  "na_respinta",
  "riapri",
  "dato_scaduto",
  "nuova_versione",
  "richiesta_revocata",
];

/** Colonne di `uc_items` che una transizione può scrivere (camelCase). */
export interface ItemPatch {
  status: ItemStatus;
  statusReason?: string | null;
  /** Assente quando lo stato non cambia (riga 8). */
  statusChangedAt?: Date;
  validatedAnswerId?: string | null;
  validatedByUserId?: string | null;
  validatedAt?: Date | null;
  staleAt?: Date | null;
  naReason?: string | null;
  naProposedAt?: Date | null;
  naProposedByUserId?: string | null;
  naProposedByContactId?: string | null;
  naApprovedByUserId?: string | null;
  naClientApprovedByUserId?: string | null;
  naApprovedByContactId?: string | null;
  naApprovedAt?: Date | null;
  /**
   * Conferma di chi possiede il dato. Ogni transizione che porta una risposta
   * nuova la riscrive: `null`, oppure il contatto che conferma (`kind = conferma`
   * dal link). `confirmedByRoleKey` non è una colonna: si ricava da questa, quindi
   * si azzera con lei (guardie 5 e 6, D11, D44).
   */
  confirmedByContactId?: string | null;
}

/** Effetti da eseguire nello stesso batch della transizione. */
export type ItemSideEffect =
  /** Primo invio del caso: caso da bozza a raccolta (riga 1). */
  | "caso_in_raccolta"
  /** Commento `chiarimento_richiesto` ed email al referente (riga 19). */
  | "chiarimento_al_referente"
  /** La voce entra in una richiesta di conferma al ruolo titolare (riga 19). */
  | "richiesta_conferma"
  /** Campanella LS «dato scaduto» (riga 24). */
  | "campanella_dato_scaduto"
  /** Firme NA azzerate (restano negli eventi). */
  | "firme_na_azzerate";

export interface ItemTransitionPlan {
  /** Riga della tabella del PIANO (§3.2), es. "7d". */
  row: string;
  patch: ItemPatch;
  eventType: "voce.stato_cambiato" | "voce.assegnata";
  /** Il caso è oltre G1 e una voce di R(G1) lascia il verde/blu: «Gate da riconfermare». */
  gateReconfirm: boolean;
  /** Nuovo stato del `request_item` attivo della voce, se cambia. */
  requestItemState: RequestItemState | null;
  sideEffects: ItemSideEffect[];
}

/**
 * Voce della richiesta da cui agisce il referente: la riga `uc_request_items`
 * con `request_id = actor.requestId` per questa voce, letta dal comando.
 */
export interface ActorRequestItem {
  requestId: string;
  state: RequestItemState;
}

export interface IncomingAnswer {
  kind: AnswerKind;
  sourceKind: SourceKind;
  sourceRef?: string | null;
}

export interface ItemTransitionInput {
  item: ItemSnapshot;
  to: ItemStatus;
  trigger: ItemTrigger;
  actor: Actor;
  now: Date;
  /** Motivo visibile (`status_reason`); obbligatorio per esiti, riapertura, NA respinta. */
  reason?: string | null;
  case: { status: CaseStatus; statusBeforeSuspension?: CaseStatus | null };
  /** Utente che agisce, con «è Lateral Space» ricalcolato: i ruoli `ls_*` valgono solo così. */
  user?: UserContext | null;
  /** Risposta che arriva con la transizione (risposta, inserimento_ls, non_so, nuova_versione). */
  answer?: IncomingAnswer | null;
  /** Chiavi dei blocchi `attivo`/`permanente` sulla voce dopo il cambio. Default: `item.activeBlockerKeys`. */
  blockerKeys?: readonly string[] | null;
  /** Richiesta della voce: promemoria inviati e scadenza del link (riga 7). */
  request?: { reminderCount: number; expiresAt: Date | null } | null;
  /** Scadenza della voce (`due_at`, riga 7a). */
  dueAt?: Date | null;
  /**
   * Per il referente dal link: la sua riga `uc_request_items` per questa voce.
   * Senza, nessuna azione del referente passa (privacy 12: ogni link è legato a
   * un referente e alle sue voci).
   */
  actorRequestItem?: ActorRequestItem | null;
  /**
   * Contatto designato oggi come firmatario Owner (`signers_designation.owner`).
   * Con il valore passato, una firma NA dal link di un contatto non più
   * designato non conta (§3.3: un cambio di designazione annulla le firme in attesa).
   */
  designatedOwnerContactId?: string | null;
}

type Ctx = ItemTransitionInput & { blockers: readonly string[] };
type Guard = (c: Ctx) => Result<void>;

interface Rule {
  row: string;
  from: ItemStatus;
  to: ItemStatus;
  triggers: readonly ItemTrigger[];
  actors: readonly ActorClass[];
  /** `true`: motivo obbligatorio. Una stringa: motivo fisso. */
  reason?: true | string;
  /** Con `reason` stringa: il motivo scritto da chi agisce, se c'è, sostituisce quello fisso. */
  optionalReason?: boolean;
  guard?: Guard;
  requestItemState?: RequestItemState | ((c: Ctx) => RequestItemState | null);
  effects?: (c: Ctx) => { patch?: Partial<ItemPatch>; sideEffects?: ItemSideEffect[]; reason?: string };
}

const LS: readonly ActorClass[] = ["ls_lead", "ls_analista"];
const ANSWER_KINDS_FOR_REPLY: readonly AnswerKind[] = ["valore", "conferma", "correzione", "proposta_na", "risposta_chiarimento"];
const ANSWER_KINDS_FOR_DATA: readonly AnswerKind[] = ["valore", "conferma", "correzione"];
const LS_SOURCE_KINDS: readonly SourceKind[] = ["lateral_space", "documento", "sistema"];
const MIN_REASON = 3;
const MIN_NA_REASON = 10;
/** Motivi che portano una risposta nuova (una nuova riga `uc_answers`). */
const ANSWER_TRIGGERS: readonly ItemTrigger[] = ["risposta", "risposta_parziale", "inserimento_ls", "non_so", "nuova_versione"];

// ── Guardie ───────────────────────────────────────────────────────────

const pass: Guard = () => ok(undefined);

function all(...guards: Guard[]): Guard {
  return (c) => {
    for (const g of guards) {
      const r = g(c);
      if (!r.ok) return r;
    }
    return ok(undefined);
  };
}

const noBlockers: Guard = (c) =>
  c.blockers.length === 0 ? ok(undefined) : fail("blocco_attivo", "La voce è ancora bloccata: prima va sciolto il blocco.");

const hasBlockers: Guard = (c) =>
  c.blockers.length > 0 ? ok(undefined) : fail("blocco_assente", "Nessun blocco attivo riguarda questa voce.");

const hasAssignee: Guard = (c) =>
  c.item.assigneeContactId ? ok(undefined) : fail("referente_assente", "Assegna prima la voce a un referente.");

const inActiveRequest: Guard = (c) =>
  c.item.hasActiveRequestItem ? ok(undefined) : fail("richiesta_assente", "La voce non è in una richiesta aperta.");

/** Riga 1 e simili: voce in una richiesta, con referente e senza blocchi. */
const sendable = all(noBlockers, hasAssignee, inActiveRequest);

const LATE_ANSWER_STATES: readonly RequestItemState[] = [...ACTIVE_REQUEST_ITEM_STATES, "non_so"];

/**
 * Il referente agisce solo sulle proprie voci: la riga della sua richiesta
 * (`actor.requestId`) è in uno degli stati ammessi e la voce è assegnata a lui.
 * Un referente che ha delegato, o la cui voce è stata riassegnata, non risponde più.
 */
function referentOwnsItem(states: readonly RequestItemState[]): Guard {
  return (c) => {
    if (c.actor.type !== "referente") return ok(undefined);
    const ri = c.actorRequestItem;
    if (!ri || ri.requestId !== c.actor.requestId || !states.includes(ri.state)) {
      return fail("richiesta_assente", "La voce non è in una richiesta aperta di questo link.");
    }
    if (!c.item.assigneeContactId || c.item.assigneeContactId !== c.actor.contactId) {
      return fail("referente_non_assegnato", "Questa voce non è più assegnata a te.");
    }
    return ok(undefined);
  };
}

const referentActive = referentOwnsItem(ACTIVE_REQUEST_ITEM_STATES);

function answerOf(kinds: readonly AnswerKind[]): Guard {
  return (c) => {
    if (!c.answer) return fail("risposta_assente", "Manca la risposta.");
    if (!kinds.includes(c.answer.kind)) return fail("tipo_risposta_non_ammesso", "Questo tipo di risposta non è ammesso qui.");
    if (c.answer.kind === "proposta_na" && (c.reason?.trim().length ?? 0) < MIN_NA_REASON) {
      return fail("motivo_obbligatorio", "Spiega in almeno 10 caratteri perché la voce non si applica.");
    }
    return ok(undefined);
  };
}

/**
 * Risposta dal link: la voce è del referente e sta nella sua richiesta (attiva;
 * per la risposta tardiva della riga 11 anche dopo «Non lo so»).
 */
function referentAnswer(kinds: readonly AnswerKind[], late = false): Guard {
  return (c) => {
    if (c.actor.type !== "referente") return answerOf(kinds)(c);
    const own = late ? referentOwnsItem(LATE_ANSWER_STATES)(c) : all(inActiveRequest, referentActive)(c);
    if (!own.ok) return own;
    if (c.answer && c.answer.sourceKind !== "referente") return fail("fonte_non_ammessa", "Una risposta dal link ha come fonte il referente.");
    return answerOf(kinds)(c);
  };
}

/** Riga 2 e simili: valore inserito da Lateral Space da una fonte nota, con riferimento. */
const lsAnswer: Guard = (c) => {
  if (!c.answer) return fail("risposta_assente", "Manca il valore da inserire.");
  if (!ANSWER_KINDS_FOR_DATA.includes(c.answer.kind)) return fail("tipo_risposta_non_ammesso", "Lateral Space inserisce solo valori da una fonte.");
  if (!LS_SOURCE_KINDS.includes(c.answer.sourceKind)) {
    return fail("fonte_non_ammessa", "Indica la fonte del valore: Lateral Space, documento o sistema.");
  }
  if (!c.answer.sourceRef || !c.answer.sourceRef.trim()) return fail("fonte_obbligatoria", "Indica il riferimento della fonte.");
  return ok(undefined);
};

const naComplete: Guard = (c) => {
  if (!c.item.na.reason || c.item.na.reason.trim().length < MIN_NA_REASON) {
    return fail("motivo_na_mancante", "Manca il motivo per cui la voce non si applica.");
  }
  if (!c.item.na.proposedAt) return fail("na_non_proposta", "Nessuno ha proposto che la voce non si applichi.");
  const s = naSignatures(c.item, c.designatedOwnerContactId);
  if (!s.complete) {
    return fail("firme_mancanti", s.ls ? "Manca la firma del cliente." : "Manca la firma di Lateral Space.");
  }
  return ok(undefined);
};

function validates(c: Ctx): Result<void> {
  if (c.actor.type !== "utente") return fail("attore_non_ammesso", "Solo una persona di Lateral Space può validare.");
  return canValidate(c.item, c.actor.userId, c.actor.roles, c.user);
}

/** Parte mancante non applicabile: data di approvazione e le due firme salvate (come deroghe e ripieghi). */
const partialNaApproved: Guard = (c) => {
  const p = c.item.partialNa;
  return p?.approved_at && approvalsComplete(p.approvazioni ?? [], "parziale_na").complete
    ? ok(undefined)
    : fail("parte_mancante_non_approvata", "La parte mancante va dichiarata non applicabile con le due firme.");
};

/** Riga 7: (a) due_at passato dopo 2 promemoria, oppure (d) link scaduto. */
function expiryReason(c: Ctx): Result<string> {
  const now = c.now.getTime();
  if (c.request?.expiresAt && c.request.expiresAt.getTime() <= now) return ok("Link scaduto senza risposta");
  if (c.dueAt && c.dueAt.getTime() < now && (c.request?.reminderCount ?? 0) >= 2) return ok("Scaduta dopo 2 promemoria");
  return fail("non_scaduta", "La voce non è ancora scaduta.");
}

const expired: Guard = (c) => {
  const r = expiryReason(c);
  return r.ok ? ok(undefined) : r;
};

/** Riga 19, richiesta di conferma: il dato non viene ancora da chi lo possiede. */
const needsConfirmation: Guard = (c) => {
  const a = c.item.currentAnswer;
  const fromContact = Boolean(a?.responderContactId || c.item.confirmedByContactId);
  if (a && fromContact && ownerRoleSatisfied(c.item)) {
    return fail("conferma_non_necessaria", "Il dato viene già dal referente che lo possiede: chiedi un chiarimento.");
  }
  return ok(undefined);
};

const clarifiable: Guard = (c) =>
  c.item.currentAnswer?.responderContactId
    ? ok(undefined)
    : fail("referente_assente", "La risposta non viene da un referente: chiedi una conferma invece di un chiarimento.");

/** NA proposta dal referente (risposta `proposta_na` in verifica). */
const referentNaProposal: Guard = (c) =>
  c.item.na.proposedAt && c.item.currentAnswer?.kind === "proposta_na"
    ? ok(undefined)
    : fail("na_non_proposta", "Non c'è una proposta di «non applicabile» del referente da respingere.");

const stale: Guard = (c) =>
  c.item.staleAt && c.item.staleAt.getTime() <= c.now.getTime() ? ok(undefined) : fail("non_scaduta", "Il dato non è ancora scaduto.");

// ── Effetti ───────────────────────────────────────────────────────────

/** Proposta NA nella risposta del referente: la voce va in verifica con la proposta [S]. */
function naProposalEffect(c: Ctx): { patch?: Partial<ItemPatch>; reason?: string } {
  if (c.answer?.kind !== "proposta_na") return {};
  return {
    reason: "Proposta: non applicabile",
    patch: {
      naReason: c.reason!.trim().slice(0, 2000),
      naProposedAt: c.now,
      naProposedByContactId: c.actor.type === "referente" ? c.actor.contactId : null,
      naProposedByUserId: c.actor.type === "utente" ? c.actor.userId : null,
      naApprovedByUserId: null,
      naClientApprovedByUserId: null,
      naApprovedByContactId: null,
      naApprovedAt: null,
    },
  };
}

/** Righe 4, 12, 22, 29, 32: con le due firme la NA vale da adesso. */
const naApproved = (c: Ctx) => ({ patch: { naApprovedAt: c.now } });

const NA_RESET: Partial<ItemPatch> = {
  naReason: null,
  naProposedAt: null,
  naProposedByUserId: null,
  naProposedByContactId: null,
  naApprovedByUserId: null,
  naClientApprovedByUserId: null,
  naApprovedByContactId: null,
  naApprovedAt: null,
};

function validateEffect(c: Ctx): { patch: Partial<ItemPatch> } {
  const answer = c.item.currentAnswer!;
  return {
    patch: {
      statusReason: null,
      validatedAnswerId: answer.id,
      validatedByUserId: c.actor.type === "utente" ? c.actor.userId : null,
      validatedAt: c.now,
      staleAt: computeStaleAt({ freshnessDays: c.item.freshnessDays, validFrom: answer.validFrom, answeredAt: answer.createdAt }),
    },
  };
}

const blockReason = (c: Ctx) => ({ reason: `Bloccata: ${[...c.blockers].sort().join(", ")}`.slice(0, 500) });

/** Stato del request_item: referente → inviata; LS che inserisce un valore → la voce esce dal link. */
const replyRequestItem = (c: Ctx): RequestItemState | null => (c.actor.type === "referente" ? "inviata" : c.item.hasActiveRequestItem ? "riassegnata" : null);

// ── Tabella ───────────────────────────────────────────────────────────

const RULES: readonly Rule[] = [
  { row: "1", from: "da_chiedere", to: "chiesta", triggers: ["invio_richiesta"], actors: ["ls_lead"], guard: sendable,
    effects: (c) => ({ sideEffects: c.case.status === "bozza" ? ["caso_in_raccolta"] : [] }) },
  { row: "2", from: "da_chiedere", to: "in_verifica", triggers: ["inserimento_ls"], actors: LS, guard: all(noBlockers, lsAnswer) },
  { row: "3", from: "da_chiedere", to: "bloccata", triggers: ["blocco_attivato"], actors: ["sistema"], guard: hasBlockers, effects: blockReason },
  { row: "4", from: "da_chiedere", to: "non_applicabile", triggers: ["na_approvata"], actors: ["ls_lead", "cliente"], guard: naComplete,
    effects: naApproved },

  { row: "5", from: "chiesta", to: "in_verifica", triggers: ["risposta"], actors: ["referente"], guard: referentAnswer(ANSWER_KINDS_FOR_REPLY),
    requestItemState: "inviata", effects: naProposalEffect },
  { row: "5", from: "chiesta", to: "in_verifica", triggers: ["inserimento_ls"], actors: LS, guard: lsAnswer, requestItemState: replyRequestItem },
  { row: "6", from: "chiesta", to: "parziale", triggers: ["risposta_parziale"], actors: ["referente", "sistema"], reason: true,
    guard: (c) => (c.actor.type === "referente" ? referentAnswer(ANSWER_KINDS_FOR_DATA)(c) : ok(undefined)),
    requestItemState: (c) => (c.actor.type === "referente" ? "inviata" : null) },
  { row: "7a/7d", from: "chiesta", to: "mancante", triggers: ["scadenza"], actors: ["sistema"], guard: expired,
    effects: (c) => {
      const r = expiryReason(c);
      return { reason: r.ok ? r.value : undefined };
    } },
  { row: "7b", from: "chiesta", to: "mancante", triggers: ["non_so"], actors: ["referente"], reason: "Il referente ha risposto «Non lo so»",
    guard: referentAnswer(["non_so"]), requestItemState: "non_so" },
  { row: "7c", from: "chiesta", to: "mancante", triggers: ["esito_mancante"], actors: LS, reason: true },
  { row: "8", from: "chiesta", to: "chiesta", triggers: ["delega"], actors: ["referente"], guard: all(inActiveRequest, referentActive), requestItemState: "delegata" },
  { row: "8", from: "chiesta", to: "chiesta", triggers: ["riassegna"], actors: ["ls_lead", "cliente"], requestItemState: "riassegnata" },
  { row: "9", from: "chiesta", to: "bloccata", triggers: ["blocco_attivato"], actors: ["sistema"], guard: hasBlockers,
    requestItemState: "riassegnata", effects: blockReason },

  { row: "10", from: "mancante", to: "chiesta", triggers: ["invio_richiesta"], actors: ["ls_lead"], guard: sendable,
    effects: (c) => ({ sideEffects: c.case.status === "bozza" ? ["caso_in_raccolta"] : [] }) },
  { row: "10", from: "mancante", to: "chiesta", triggers: ["riassegna"], actors: ["ls_lead", "cliente"], guard: sendable },
  // Risposta tardiva: il link del referente lo controlla `uc_request_live`, il request_item può essere «non_so».
  { row: "11", from: "mancante", to: "in_verifica", triggers: ["risposta"], actors: ["referente"],
    guard: referentAnswer(ANSWER_KINDS_FOR_REPLY, true), requestItemState: "inviata",
    effects: naProposalEffect },
  { row: "11", from: "mancante", to: "in_verifica", triggers: ["inserimento_ls"], actors: LS, guard: lsAnswer, requestItemState: replyRequestItem },
  { row: "12", from: "mancante", to: "non_applicabile", triggers: ["na_approvata"], actors: ["ls_lead", "cliente"], guard: naComplete,
    effects: naApproved },
  { row: "13", from: "mancante", to: "bloccata", triggers: ["blocco_attivato"], actors: ["sistema", "ls_lead"], guard: hasBlockers,
    requestItemState: (c) => (c.item.hasActiveRequestItem ? "riassegnata" : null), effects: blockReason },

  { row: "14", from: "parziale", to: "in_verifica", triggers: ["risposta"], actors: ["referente"], guard: referentAnswer(ANSWER_KINDS_FOR_REPLY),
    requestItemState: "inviata", effects: naProposalEffect },
  { row: "14", from: "parziale", to: "in_verifica", triggers: ["inserimento_ls"], actors: LS, guard: lsAnswer, requestItemState: replyRequestItem },
  { row: "15", from: "parziale", to: "chiesta", triggers: ["invio_richiesta"], actors: ["ls_lead"], guard: sendable },
  { row: "16", from: "parziale", to: "validata", triggers: ["valida"], actors: LS, guard: all(partialNaApproved, validates), effects: validateEffect },
  { row: "17", from: "parziale", to: "mancante", triggers: ["esito_mancante"], actors: LS, reason: true },

  { row: "18", from: "in_verifica", to: "validata", triggers: ["valida"], actors: LS, guard: validates, effects: validateEffect },
  { row: "19", from: "in_verifica", to: "chiesta", triggers: ["chiarimento"], actors: LS, reason: "Chiarimento richiesto", guard: clarifiable,
    requestItemState: "da_fare", effects: () => ({ sideEffects: ["chiarimento_al_referente"] }) },
  { row: "19", from: "in_verifica", to: "chiesta", triggers: ["richiesta_conferma"], actors: LS, reason: "Conferma richiesta al titolare del dato",
    guard: all(hasAssignee, inActiveRequest, needsConfirmation), effects: () => ({ sideEffects: ["richiesta_conferma"] }) },
  // NA proposta dal referente e respinta: si torna a chiedere, con motivo (§3.2).
  { row: "19-na", from: "in_verifica", to: "chiesta", triggers: ["na_respinta"], actors: ["ls_lead", "cliente"], reason: true,
    guard: referentNaProposal, requestItemState: "da_fare",
    effects: () => ({ patch: { ...NA_RESET }, sideEffects: ["firme_na_azzerate"] }) },
  { row: "20", from: "in_verifica", to: "parziale", triggers: ["esito_parziale"], actors: LS, reason: true },
  { row: "21", from: "in_verifica", to: "mancante", triggers: ["esito_mancante"], actors: LS, reason: true },
  { row: "22", from: "in_verifica", to: "non_applicabile", triggers: ["na_approvata"], actors: ["ls_lead", "cliente"], guard: naComplete,
    effects: naApproved },

  { row: "23", from: "validata", to: "in_verifica", triggers: ["nuova_versione"], actors: ["referente"],
    guard: referentAnswer(ANSWER_KINDS_FOR_DATA), requestItemState: "inviata", reason: "Nuova versione della risposta" },
  { row: "23", from: "validata", to: "in_verifica", triggers: ["nuova_versione"], actors: LS, guard: lsAnswer,
    requestItemState: replyRequestItem, reason: "Nuova versione della risposta" },
  { row: "24", from: "validata", to: "in_verifica", triggers: ["dato_scaduto"], actors: ["sistema"], guard: stale, reason: "dato scaduto",
    effects: () => ({ sideEffects: ["campanella_dato_scaduto"] }) },
  { row: "25", from: "validata", to: "bloccata", triggers: ["blocco_attivato"], actors: ["sistema"], guard: hasBlockers,
    requestItemState: (c) => (c.item.hasActiveRequestItem ? "riassegnata" : null), effects: blockReason },

  { row: "26", from: "non_applicabile", to: "da_chiedere", triggers: ["riapri"], actors: ["ls_lead"], reason: true, guard: noBlockers,
    effects: () => ({ patch: { ...NA_RESET }, sideEffects: ["firme_na_azzerate"] }) },
  // [!] Riaperta con un blocco attivo o permanente (a8, sanitario…): torna sotto il lucchetto, mai da chiedere.
  { row: "26b", from: "non_applicabile", to: "bloccata", triggers: ["riapri"], actors: ["ls_lead"], reason: true, guard: hasBlockers,
    effects: (c) => ({ ...blockReason(c), patch: { ...NA_RESET }, sideEffects: ["firme_na_azzerate"] }) },

  { row: "27", from: "bloccata", to: "da_chiedere", triggers: ["blocco_sciolto"], actors: ["sistema"], guard: noBlockers },
  { row: "28", from: "bloccata", to: "chiesta", triggers: ["invio_richiesta"], actors: ["ls_lead"], guard: sendable,
    effects: (c) => ({ sideEffects: c.case.status === "bozza" ? ["caso_in_raccolta"] : [] }) },
  { row: "29", from: "bloccata", to: "non_applicabile", triggers: ["na_approvata"], actors: ["ls_lead", "cliente"], guard: naComplete,
    effects: naApproved },

  { row: "30", from: "parziale", to: "bloccata", triggers: ["blocco_attivato"], actors: ["sistema"], guard: hasBlockers,
    requestItemState: (c) => (c.item.hasActiveRequestItem ? "riassegnata" : null), effects: blockReason },
  { row: "30", from: "in_verifica", to: "bloccata", triggers: ["blocco_attivato"], actors: ["sistema"], guard: hasBlockers,
    requestItemState: (c) => (c.item.hasActiveRequestItem ? "riassegnata" : null), effects: blockReason },
  { row: "31", from: "chiesta", to: "da_chiedere", triggers: ["richiesta_revocata"], actors: ["ls_lead", "sistema"],
    reason: "Richiesta revocata", optionalReason: true, requestItemState: "riassegnata" },
  { row: "32", from: "chiesta", to: "non_applicabile", triggers: ["na_approvata"], actors: ["ls_lead", "cliente"], guard: naComplete,
    requestItemState: "riassegnata", effects: naApproved },
];

/** Whitelist delle coppie (da → a), ricavata dalla tabella. */
export const ITEM_TRANSITIONS: Readonly<Record<ItemStatus, readonly ItemStatus[]>> = (() => {
  const out = {} as Record<ItemStatus, readonly ItemStatus[]>;
  for (const from of ITEM_STATUSES) out[from] = ITEM_STATUSES.filter((to) => RULES.some((r) => r.from === from && r.to === to));
  return out;
})();

export function isAllowedItemTransition(from: ItemStatus, to: ItemStatus): boolean {
  return ITEM_TRANSITIONS[from].includes(to);
}

/** Motivi (`ItemTrigger`) ammessi per la coppia. */
export function triggersFor(from: ItemStatus, to: ItemStatus): ItemTrigger[] {
  return [...new Set(RULES.filter((r) => r.from === from && r.to === to).flatMap((r) => r.triggers))];
}

/** Righe della tabella (per i test e per la documentazione). */
export function itemTransitionRules(): readonly { row: string; from: ItemStatus; to: ItemStatus; triggers: readonly ItemTrigger[]; actors: readonly ActorClass[]; reasonRequired: boolean }[] {
  return RULES.map((r) => ({ row: r.row, from: r.from, to: r.to, triggers: r.triggers, actors: r.actors, reasonRequired: r.reason === true }));
}

const RESTING: readonly ItemStatus[] = ["validata", "non_applicabile"];

/** Controllo del caso prima della voce: chiuso o sospeso fermano quasi tutto. */
function caseAllows(i: ItemTransitionInput): Result<void> {
  if (i.case.status === "chiuso" && i.trigger !== "richiesta_revocata") {
    return fail("caso_chiuso", "Il caso è chiuso: le voci non cambiano più.");
  }
  if (i.case.status === "sospeso") {
    if (i.actor.type === "referente" || i.actor.type === "owner_link") {
      return fail("caso_sospeso", "Il caso è in pausa: per ora non serve rispondere.");
    }
    if (i.trigger === "invio_richiesta" || i.trigger === "scadenza" || i.trigger === "richiesta_conferma" || i.trigger === "chiarimento") {
      return fail("caso_sospeso", "Il caso è in pausa: niente invii né scadenze finché non riprende.");
    }
  }
  return ok(undefined);
}

/**
 * Controlla una transizione della voce e restituisce cosa scrivere. Rifiuta:
 * coppia non ammessa, motivo non ammesso per la coppia, attore sbagliato, motivo
 * mancante dove serve, guardie non soddisfatte, `import` (fuori macchina).
 */
export function checkItemTransition(i: ItemTransitionInput): Result<ItemTransitionPlan> {
  if (i.trigger === "import") {
    return fail("import_fuori_macchina", "Lo stato iniziale lo scrivono solo la creazione del caso e il seed.");
  }
  const from = i.item.status;
  if (!isAllowedItemTransition(from, i.to)) return fail("transizione_non_ammessa", "Questo cambio di stato non è ammesso.");
  const candidates = RULES.filter((r) => r.from === from && r.to === i.to && r.triggers.includes(i.trigger));
  if (candidates.length === 0) return fail("motivo_non_ammesso", "Questo cambio di stato non avviene per questo motivo.");

  const classes = actorClasses(i.actor, i.user);
  const rule = candidates.find((r) => r.actors.some((a) => classes.has(a)));
  if (!rule) return fail("attore_non_ammesso", "Non puoi fare questo cambio di stato.");

  const caseCheck = caseAllows(i);
  if (!caseCheck.ok) return caseCheck;

  const reasonText = i.reason?.trim() ?? "";
  if (rule.reason === true && reasonText.length < MIN_REASON) {
    return fail("motivo_obbligatorio", "Scrivi il motivo: resta visibile sulla voce.");
  }

  const ctx: Ctx = { ...i, blockers: i.blockerKeys ?? i.item.activeBlockerKeys };
  const guard = (rule.guard ?? pass)(ctx);
  if (!guard.ok) return guard;

  const effects: ReturnType<NonNullable<Rule["effects"]>> = rule.effects?.(ctx) ?? {};
  const statusChanges = from !== i.to;
  let statusReason: string | null = null;
  // Il motivo calcolato (es. «Bloccata: a8») vince su quello scritto, che resta nell'evento.
  if (effects.reason) statusReason = effects.reason;
  else if (rule.reason === true) statusReason = reasonText;
  else if (typeof rule.reason === "string") statusReason = rule.optionalReason && reasonText ? reasonText : rule.reason;
  const patch: ItemPatch = {
    status: i.to,
    ...(statusChanges ? { statusChangedAt: i.now, statusReason: statusReason ? statusReason.slice(0, 500) : null } : {}),
    ...effects.patch,
  };
  // Una risposta nuova non eredita la conferma di quella vecchia (guardie 5 e 6).
  if (ANSWER_TRIGGERS.includes(i.trigger)) {
    patch.confirmedByContactId = i.actor.type === "referente" && i.answer?.kind === "conferma" ? i.actor.contactId : null;
  }
  if (statusChanges && i.to === "mancante" && !patch.statusReason) {
    return fail("motivo_obbligatorio", "Una voce mancante mostra sempre il motivo.");
  }
  const requestItemState = typeof rule.requestItemState === "function" ? rule.requestItemState(ctx) : rule.requestItemState ?? null;
  return ok({
    row: rule.row,
    patch,
    eventType: statusChanges ? "voce.stato_cambiato" : "voce.assegnata",
    gateReconfirm: statusChanges && RESTING.includes(from) && isRequired(i.item, "G1") && isCasePastG1(i.case.status, i.case.statusBeforeSuspension),
    requestItemState,
    sideEffects: effects.sideEffects ?? [],
  });
}

/** Stati con cui una voce può nascere: gli altri hanno bisogno di una richiesta, una risposta o delle firme. */
export const IMPORTABLE_ITEM_STATUSES: readonly ItemStatus[] = ["da_chiedere", "in_verifica", "mancante", "bloccata"];

/**
 * Stato iniziale scritto da creazione del caso o seed (`import`), fuori dalla
 * macchina a stati: solo il sistema, solo `IMPORTABLE_ITEM_STATUSES`, e una voce
 * con blocchi nasce `bloccata`. L'evento è `voce.stato_importato`, in forma aggregata.
 */
export function checkImportedState(i: { actor: Actor; status: ItemStatus; blockerKeys: readonly string[]; statusReason?: string | null }): Result<{ status: ItemStatus }> {
  if (i.actor.type !== "sistema" || (i.actor.job !== "seed" && i.actor.job !== "creazione")) {
    return fail("attore_non_ammesso", "Lo stato iniziale lo scrivono solo la creazione del caso e il seed.");
  }
  if (i.blockerKeys.length > 0 && i.status !== "bloccata") {
    return fail("blocco_attivo", "Una voce con un blocco attivo nasce bloccata.");
  }
  if (i.status === "bloccata" && i.blockerKeys.length === 0) return fail("blocco_assente", "Una voce bloccata ha sempre un blocco.");
  if (!IMPORTABLE_ITEM_STATUSES.includes(i.status)) {
    return fail("stato_non_importabile", "Una voce nasce da chiedere, in verifica, mancante o bloccata: gli altri stati richiedono una richiesta, una risposta o le firme.");
  }
  if (i.status === "mancante" && !(i.statusReason && i.statusReason.trim())) {
    return fail("motivo_obbligatorio", "Una voce mancante mostra sempre il motivo.");
  }
  return ok({ status: i.status });
}

// ── «Non applicabile» proposto da Lateral Space ───────────────────────

/** Stati in cui Lateral Space propone NA senza cambiare stato [D]. */
const LS_NA_PROPOSAL_STATUSES: readonly ItemStatus[] = ["da_chiedere", "chiesta", "mancante", "bloccata", "in_verifica"];

/**
 * Proposta NA di Lateral Space (`proposeNa`): lo stato resta, la proposta e il
 * motivo si registrano e le firme ripartono da zero. Con le due firme si
 * applicano le righe 4, 32, 12, 29 o 22. Dal referente la proposta arriva come
 * risposta `proposta_na` (righe 5, 11, 14).
 */
export function checkNaProposal(i: { item: ItemSnapshot; actor: Actor; user?: UserContext | null; reason: string; now: Date; case: { status: CaseStatus } }): Result<{ patch: Partial<ItemPatch> }> {
  if (i.case.status === "chiuso") return fail("caso_chiuso", "Il caso è chiuso: le voci non cambiano più.");
  if (i.actor.type !== "utente") return fail("attore_non_ammesso", "Solo Lateral Space propone «non applicabile» da qui.");
  const classes = actorClasses(i.actor, i.user);
  if (!classes.has("ls_lead") && !classes.has("ls_analista")) return fail("attore_non_ammesso", "Solo Lateral Space propone «non applicabile» da qui.");
  if (!LS_NA_PROPOSAL_STATUSES.includes(i.item.status)) {
    return fail("stato_non_ammesso", "In questo stato la voce non si può proporre come non applicabile.");
  }
  if (i.item.na.proposedAt) return fail("na_gia_proposta", "C'è già una proposta in attesa delle firme.");
  if (i.reason.trim().length < MIN_NA_REASON) return fail("motivo_obbligatorio", "Spiega in almeno 10 caratteri perché la voce non si applica.");
  return ok({
    patch: {
      ...NA_RESET,
      naReason: i.reason.trim().slice(0, 2000),
      naProposedAt: i.now,
      naProposedByUserId: i.actor.userId,
    },
  });
}

/**
 * NA respinta. Proposta del referente: la voce torna `chiesta` con motivo
 * (riga «19-na», via `checkItemTransition`). Proposta di Lateral Space: lo stato
 * resta e la proposta si azzera [D].
 */
export function checkNaRejection(i: { item: ItemSnapshot; actor: Actor; user?: UserContext | null; reason: string; now: Date; case: { status: CaseStatus; statusBeforeSuspension?: CaseStatus | null } }):
  Result<{ kind: "transizione"; plan: ItemTransitionPlan } | { kind: "azzera"; patch: Partial<ItemPatch> }> {
  if (!i.item.na.proposedAt) return fail("na_non_proposta", "Non c'è una proposta di «non applicabile» da respingere.");
  if (i.item.status === "in_verifica" && i.item.currentAnswer?.kind === "proposta_na") {
    const r = checkItemTransition({ item: i.item, to: "chiesta", trigger: "na_respinta", actor: i.actor, user: i.user, reason: i.reason, now: i.now, case: i.case });
    return r.ok ? ok({ kind: "transizione", plan: r.value }) : r;
  }
  const classes = actorClasses(i.actor, i.user);
  if (!classes.has("ls_lead") && !classes.has("cliente")) return fail("attore_non_ammesso", "Solo chi firma può respingere la proposta.");
  if (i.reason.trim().length < MIN_REASON) return fail("motivo_obbligatorio", "Scrivi il motivo: resta negli eventi.");
  return ok({ kind: "azzera", patch: { ...NA_RESET } });
}
