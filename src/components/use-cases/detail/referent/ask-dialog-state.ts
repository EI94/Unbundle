/**
 * «Chiedi al referente» e «Chiedi di nuovo»: la bozza della finestra, chi la può aprire, i controlli
 * prima dell'invio e il contenuto dell'action (SPEC §5.2, §P3.7; rilascio 4 §3, §4, §6). Modulo puro,
 * senza React: lo provano `ask-dialog-state.test.ts`, `ask-steps-state.test.ts` e la prova della
 * pagina vera (`referent-render.integration.test.ts`). I passi della finestra stanno in `ask-steps-state.ts`.
 *
 * I testi vengono tutti da `labels.ts`; qui si scelgono e si riempiono. Nessun ordinamento né
 * conteggio per persona (art. 15.4): i referenti restano nell'ordine del pannello (created_at, id),
 * le persone del workspace in quello alfabetico del server.
 */
import type {
  ReferentActionResult,
  ReferentContactOption,
  ReferentGate,
  ReferentMemberOption,
  ReferentRequestView,
  SendReferentRequestInput,
  UseCaseReferentPanel,
} from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_ERROR_MESSAGES, REFERENT_UI_TEXT, fillText } from "../../../../lib/use-cases/referent/labels.ts";

const T = REFERENT_UI_TEXT.askDialog;

/** Il valore della scelta «Una persona nuova». */
export const NEW_CONTACT = "__nuovo__";

/** (Referente già iscritto) Il valore di una persona del workspace nell'elenco: `membro:<userId>`. */
export const MEMBER_PREFIX = "membro:";
export const memberValue = (userId: string) => `${MEMBER_PREFIX}${userId.toLowerCase()}`;
export const memberIdOf = (choice: string | null): string | null => (choice && choice.startsWith(MEMBER_PREFIX) ? choice.slice(MEMBER_PREFIX.length) : null);

/**
 * Le persone che «A chi» propone: i referenti del pannello e (rilascio 4) le persone del workspace
 * lette quando la finestra si apre (`listReferentPeopleAction`), mai dal pannello della scheda.
 */
export type AskPeople = Pick<UseCaseReferentPanel, "contacts"> & { members?: readonly ReferentMemberOption[] | null };

export interface AskDraft {
  /** L'id del referente scelto, `membro:<userId>`, `NEW_CONTACT`, oppure null (niente ancora). */
  choice: string | null;
  name: string;
  email: string;
  role: string;
  /** Le domande spuntate, in minuscolo, nell'ordine della scheda. */
  needIds: string[];
  message: string;
}

/** Come si apre la finestra: «Chiedi al referente», oppure «Chiedi di nuovo» su una richiesta. */
export interface AskMode {
  kind: "ask" | "again";
  /** «Chiedi di nuovo»: il referente della richiesta, che non si cambia. */
  lockedContactId: string | null;
  /** «Chiedi di nuovo»: la richiesta che questa sostituisce. */
  previousRequestId: string | null;
  /** «Chiedi di nuovo» su una richiesta ancora viva («Nessuna risposta»): il link di prima smette di valere. */
  liveHint: boolean;
}

export const ASK_MODE: AskMode = Object.freeze({ kind: "ask", lockedContactId: null, previousRequestId: null, liveHint: false });

const lower = (id: string) => id.toLowerCase();

/** La modalità «Chiedi di nuovo» di una richiesta. */
export function askAgainMode(request: Pick<ReferentRequestView, "id" | "status" | "contact">): AskMode {
  return { kind: "again", lockedContactId: request.contact.id, previousRequestId: request.id, liveHint: request.status === "inviata" };
}

/**
 * La bozza di partenza: nessuno scelto e nessuna domanda spuntata (le spunte arrivano con la persona,
 * in «Cosa chiedi»); con «Chiedi di nuovo» il referente della richiesta e le sue domande di prima che
 * si possono ancora chiedere.
 */
export function initialAskDraft(panel: Pick<UseCaseReferentPanel, "askableNeedIds">, mode: AskMode = ASK_MODE, previous?: Pick<ReferentRequestView, "needIds"> | null): AskDraft {
  const askable = panel.askableNeedIds.map(lower);
  const before = new Set((previous?.needIds ?? []).map(lower));
  return {
    choice: mode.lockedContactId,
    name: "",
    email: "",
    role: "",
    needIds: mode.kind === "again" && previous ? askable.filter((id) => before.has(id)) : [],
    message: "",
  };
}

/**
 * Le domande spuntate quando il pannello cambia a finestra aperta (dopo «Prepara le domande»): quelle
 * che si possono chiedere adesso, in minuscolo e nell'ordine del pannello. Restano spuntate quelle già
 * spuntate; una tolta resta tolta; le nuove (mai viste in `seen`) arrivano spuntate in «Chiedi al
 * referente» e non spuntate in «Chiedi di nuovo»; quelle che non si possono più chiedere escono.
 */
export function mergeAskSelection(selected: readonly string[], seen: readonly string[], askableNow: readonly string[], mode: AskMode = ASK_MODE): string[] {
  const chosen = new Set(selected.map(lower));
  const before = new Set(seen.map(lower));
  return askableNow.map(lower).filter((id) => chosen.has(id) || (mode.kind === "ask" && !before.has(id)));
}

/**
 * «Prepara le domande» dentro «Cosa chiedi»: solo in «Chiedi al referente» (non in «Chiedi di nuovo»)
 * e solo quando mancano domande standard. Il numero è di domande della scheda, mai di persone.
 */
export function askPrepareOffer(panel: Pick<UseCaseReferentPanel, "preparable">, mode: AskMode = ASK_MODE): { count: number; hint: string } | null {
  if (mode.kind !== "ask" || panel.preparable.length === 0) return null;
  const count = panel.preparable.length;
  return { count, hint: count === 1 ? T.prepareHintOne : fillText(T.prepareHintMany, { n: count }) };
}

export interface AskEntry {
  /** Il riquadro «Prossimo passo» ha «Chiedi al referente» (G5). */
  canOpen: boolean;
  /** I motivi che lo bloccano, nell'ordine del server; [] quando si apre. */
  gates: readonly ReferentGate[];
}

/**
 * «Chiedi al referente» del riquadro «Prossimo passo» (G5): quando niente blocca, oppure quando blocca
 * solo «non ci sono domande da fare» e «Prepara le domande» ha qualcosa da aggiungere (la finestra lo
 * offre). Altrimenti ogni motivo, nell'ordine del server, che il riquadro dice (G4, G6). Senza niente da
 * preparare il motivo «Non ci sono domande da fare» nomina solo «Aggiungi» (`gates.noQuestionsPage`).
 */
export function askEntry(panel: Pick<UseCaseReferentPanel, "gates" | "preparable">): AskEntry {
  const canPrepare = panel.preparable.length > 0;
  const canOpen = panel.gates.every((gate) => gate.code === "nessuna_domanda" && canPrepare);
  if (canOpen) return { canOpen: true, gates: [] };
  const gates = canPrepare
    ? panel.gates
    : panel.gates.map((gate): ReferentGate => (gate.code === "nessuna_domanda" ? { ...gate, message: REFERENT_UI_TEXT.gates.noQuestionsPage } : gate));
  return { canOpen: false, gates };
}

/** I motivi che nessuno nel workspace può togliere (email spente, risposte dal link spente): si passa e si dice. */
const SYSTEM_GATES: ReadonlySet<ReferentGate["code"]> = new Set(["email_non_configurata", "risposte_non_attive"]);

/** Un motivo con cui chi guarda arriva comunque in fondo ai passi: un'interruzione, o l'ok che può dare lui. */
function isOpenable(gate: ReferentGate): boolean {
  return SYSTEM_GATES.has(gate.code) || (gate.code === "sub_responsabili_mancanti" && gate.canDeclare === true);
}

export interface AskDialogEntry {
  /** Il pulsante «Chiedi al referente» della riga di «Cosa serve» c'è (e apre la finestra). */
  canOpen: boolean;
  /** «Chiedi di nuovo» si può offrire su una richiesta. */
  canAskAgain: boolean;
  /** I motivi che bloccano l'invio, nell'ordine del server: «Controlla e invia» li dice tutti. */
  sendGates: readonly ReferentGate[];
  /** Il primo, in una riga in cima ad «A chi»: nessuno compone senza saperlo. */
  notice: ReferentGate | null;
}

/**
 * (Rilascio 4, §3) La finestra si apre solo a chi può arrivare in fondo: nessun motivo, chi può dare
 * l'ok sui fornitori quando manca quello, oppure le email o le risposte dal link spente (nessuno nel
 * workspace le accende: la finestra lo dice e si passa). Mai a chi non può finire (l'ok lo dà un'altra
 * persona, l'email di chi guarda non è verificata): lì il riquadro «Prossimo passo» dice chi deve
 * muoversi. Ci vuole qualcosa da chiedere o da preparare.
 */
export function askDialogEntry(panel: Pick<UseCaseReferentPanel, "available" | "canAsk" | "gates" | "askableNeedIds" | "preparable">): AskDialogEntry {
  const blockers = panel.gates.filter((gate) => gate.code !== "nessuna_domanda");
  const gatesOk = blockers.every(isOpenable);
  const base = panel.available && panel.canAsk && gatesOk;
  return {
    canOpen: base && (panel.askableNeedIds.length > 0 || panel.preparable.length > 0),
    canAskAgain: base && panel.askableNeedIds.length > 0,
    sendGates: blockers,
    notice: blockers[0] ?? null,
  };
}

const SEPARATOR = " · ";

/**
 * La riga grigia di un referente in «A chi»: «Ufficio acquisti · m•••@topjet.it», con « · Fa parte del
 * team» per un collega revisore e il motivo quando non si può scegliere («(senza email)»…).
 */
export function contactRowLine(option: ReferentContactOption): string {
  const parts = [option.roleLabel, option.emailMasked].filter((part): part is string => Boolean(part));
  // «Fa parte del team» solo per i colleghi: chi guarda (sei tu) ha già il suo motivo.
  if (option.team && option.reason !== "sei_tu") parts.push(T.teamTag);
  let line = parts.join(SEPARATOR);
  const reason = option.selectable ? null : option.reason;
  if (reason) line = line ? `${line} ${T.suffix[reason]}` : T.suffix[reason];
  return line;
}

/** (Referente già iscritto) La riga grigia di una persona del workspace: l'email coperta, « · Fa parte del team» per i revisori; niente dei corsi. */
export function memberRowLine(option: ReferentMemberOption): string {
  return [option.emailMasked, option.team ? T.teamTag : null].filter((part): part is string => Boolean(part)).join(SEPARATOR);
}

export function chosenMember(people: Pick<AskPeople, "members">, draft: Pick<AskDraft, "choice">): ReferentMemberOption | null {
  const id = memberIdOf(draft.choice);
  if (!id) return null;
  return (people.members ?? []).find((m) => lower(m.userId) === id) ?? null;
}

/** Chi guarda è tra i referenti («(sei tu)»): sotto l'elenco, il suggerimento di rispondere dalla scheda. */
export function askSelfHint(panel: Pick<UseCaseReferentPanel, "contacts">): string | null {
  return panel.contacts.some((option) => option.reason === "sei_tu") ? T.selfHint : null;
}

export function chosenContact(panel: Pick<UseCaseReferentPanel, "contacts">, draft: Pick<AskDraft, "choice">): ReferentContactOption | null {
  if (!draft.choice || draft.choice === NEW_CONTACT || memberIdOf(draft.choice)) return null;
  const id = lower(draft.choice);
  return panel.contacts.find((option) => lower(option.id) === id) ?? null;
}

/** «{Nome} ha già domande aperte su altri use case: i promemoria arriveranno in un'unica email.» (un sì o un no, mai un numero). */
export function askOtherRequestsHint(panel: Pick<UseCaseReferentPanel, "contacts">, draft: Pick<AskDraft, "choice">): string | null {
  const contact = chosenContact(panel, draft);
  return contact?.hasOtherRequests ? fillText(T.otherRequestsHint, { Nome: contact.displayName }) : null;
}

/** I controlli prima dell'invio, con i testi del server: il server rifà tutto. Chiavi: `contact`, `displayName`, `email`, `message`, `needIds`. */
export function askDraftErrors(draft: AskDraft, panel: AskPeople & Pick<UseCaseReferentPanel, "limits">, mode: AskMode = ASK_MODE): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.choice) errors.contact = T.whoMissing;
  else if (memberIdOf(draft.choice)) {
    if (mode.lockedContactId !== null || !chosenMember(panel, draft)) errors.contact = REFERENT_ERROR_MESSAGES.persona_non_disponibile;
  } else if (draft.choice === NEW_CONTACT) {
    const name = draft.name.trim();
    if (name.length < panel.limits.contactNameMin || name.length > panel.limits.contactNameMax) errors.displayName = REFERENT_ERROR_MESSAGES.dati_non_validi;
    if (!draft.email.trim()) errors.email = REFERENT_ERROR_MESSAGES.email_mancante;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) errors.email = REFERENT_ERROR_MESSAGES.email_non_valida;
  } else {
    const contact = chosenContact(panel, draft);
    const locked = mode.lockedContactId !== null && lower(mode.lockedContactId) === lower(draft.choice);
    if (!contact) errors.contact = REFERENT_ERROR_MESSAGES.referente_non_valido;
    else if (!contact.selectable && !(locked && contact.reason === "richiesta_aperta")) {
      errors.contact = contact.reason === "sei_tu" ? REFERENT_ERROR_MESSAGES.referente_sei_tu : contact.reason === "senza_email" ? REFERENT_ERROR_MESSAGES.email_mancante_esistente : REFERENT_ERROR_MESSAGES.referente_non_valido;
    }
  }
  if (draft.needIds.length === 0) errors.needIds = REFERENT_ERROR_MESSAGES.nessuna_domanda;
  else if (draft.needIds.length > panel.limits.questionsPerRequest) errors.needIds = REFERENT_ERROR_MESSAGES.troppe_domande;
  if (draft.message.trim().length > panel.limits.messageMax) errors.message = REFERENT_ERROR_MESSAGES.messaggio_troppo_lungo;
  return errors;
}

/** Il contenuto di `sendReferentRequestAction`: le domande nell'ordine della scheda, i testi senza spazi in più. */
export function askPayload(draft: AskDraft, panel: Pick<UseCaseReferentPanel, "askableNeedIds">, mode: AskMode = ASK_MODE): SendReferentRequestInput {
  const chosen = new Set(draft.needIds.map(lower));
  const needIds = panel.askableNeedIds.filter((id) => chosen.has(lower(id)));
  const message = draft.message.trim();
  const memberId = memberIdOf(draft.choice);
  const contact: SendReferentRequestInput["contact"] =
    draft.choice === NEW_CONTACT
      ? { kind: "nuovo", displayName: draft.name.trim(), email: draft.email.trim(), roleLabel: draft.role.trim() || null }
      : memberId
        ? { kind: "membro", userId: memberId }
        : { kind: "esistente", contactId: draft.choice ?? "" };
  return {
    contact,
    needIds,
    message: message || null,
    ...(mode.previousRequestId ? { previousRequestId: mode.previousRequestId } : {}),
  };
}

/** I campi della finestra a cui va un errore del server; gli altri vanno nell'area degli errori. */
const ASK_FIELDS = new Set(["displayName", "email", "roleLabel", "message", "needIds"]);

/**
 * Dove mostrare un errore del server: i campi della finestra (`fieldErrors`) e l'area degli errori.
 * «Sei tu il referente» si legge sempre nell'area degli errori; per un referente nuovo anche sotto
 * «Email» (Parte 3).
 */
export function askErrorView(
  result: Extract<ReferentActionResult<unknown>, { ok: false }>,
  draft: Pick<AskDraft, "choice">,
): { formError: string | null; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  let formError: string | null = null;
  const isNew = draft.choice === NEW_CONTACT;
  for (const [key, message] of Object.entries(result.fieldErrors ?? {})) {
    if (ASK_FIELDS.has(key) && (isNew || (key !== "displayName" && key !== "email" && key !== "roleLabel"))) fieldErrors[key] = message;
    else formError ??= message;
  }
  if (result.code === "referente_sei_tu") {
    formError = result.message;
    if (!isNew) delete fieldErrors.email;
  } else if (Object.keys(fieldErrors).length === 0) {
    formError ??= result.message;
  }
  return { formError, fieldErrors };
}
