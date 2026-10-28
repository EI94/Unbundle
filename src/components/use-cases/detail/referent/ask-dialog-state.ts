/**
 * «Chiedi al referente» e «Chiedi di nuovo»: la bozza della finestra, i controlli prima dell'invio e
 * il contenuto dell'action (SPEC §5.2, §P3.7). Modulo puro, senza React: lo provano
 * `ask-dialog-state.test.ts` e la prova della pagina vera (`referent-render.integration.test.ts`).
 *
 * I testi vengono tutti da `labels.ts`; qui si scelgono e si riempiono. Nessun ordinamento né
 * conteggio per persona (art. 15.4): i referenti restano nell'ordine del pannello (created_at, id).
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

/** Il valore della scelta «+ Nuovo referente» nel selettore. */
export const NEW_CONTACT = "__nuovo__";

/** (Referente già iscritto) Il valore di una persona del workspace nel selettore: `membro:<userId>`. */
export const MEMBER_PREFIX = "membro:";
const memberValue = (userId: string) => `${MEMBER_PREFIX}${userId.toLowerCase()}`;
const memberIdOf = (choice: string | null): string | null => (choice && choice.startsWith(MEMBER_PREFIX) ? choice.slice(MEMBER_PREFIX.length) : null);

type PanelPeople = Pick<UseCaseReferentPanel, "contacts"> & Partial<Pick<UseCaseReferentPanel, "members">>;

export interface AskDraft {
  /** L'id del referente scelto, `NEW_CONTACT`, oppure null (niente ancora). */
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
  /** «Chiedi di nuovo» su una richiesta ancora viva («Senza risposta»): il link di prima smette di valere. */
  liveHint: boolean;
}

export const ASK_MODE: AskMode = Object.freeze({ kind: "ask", lockedContactId: null, previousRequestId: null, liveHint: false });

const lower = (id: string) => id.toLowerCase();

/** La modalità «Chiedi di nuovo» di una richiesta. */
export function askAgainMode(request: Pick<ReferentRequestView, "id" | "status" | "contact">): AskMode {
  return { kind: "again", lockedContactId: request.contact.id, previousRequestId: request.id, liveHint: request.status === "inviata" };
}

/**
 * La bozza di partenza: tutte le domande che si possono chiedere spuntate; con «Chiedi di nuovo» il
 * referente della richiesta e le sue domande di prima che si possono ancora chiedere.
 */
export function initialAskDraft(panel: Pick<UseCaseReferentPanel, "askableNeedIds">, mode: AskMode = ASK_MODE, previous?: Pick<ReferentRequestView, "needIds"> | null): AskDraft {
  const askable = panel.askableNeedIds.map(lower);
  const before = new Set((previous?.needIds ?? []).map(lower));
  return {
    choice: mode.lockedContactId,
    name: "",
    email: "",
    role: "",
    needIds: mode.kind === "again" && previous ? askable.filter((id) => before.has(id)) : askable,
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
  /** Il pulsante «Chiedi al referente» apre la finestra. */
  canOpen: boolean;
  /** I motivi da scrivere sotto il pulsante spento, nell'ordine del server; [] quando si apre. */
  gates: readonly ReferentGate[];
  /**
   * «Prepara le domande» accanto a «Chiedi al referente» spento: c'è qualcosa da preparare ma un
   * altro motivo (fornitori, email, link, email non verificata) tiene chiusa la finestra. Preparare
   * non manda niente, quindi si può anche mentre quei motivi bloccano, come prima del rilascio.
   */
  showPrepare: boolean;
}

/**
 * Il pulsante «Chiedi al referente» del capitolo: si apre quando niente blocca, oppure quando blocca
 * solo «non ci sono domande da fare» e «Prepara le domande» ha qualcosa da aggiungere (la finestra lo
 * offre). Altrimenti resta spento con ogni motivo, nell'ordine del server; con qualcosa da preparare
 * c'è «Prepara le domande» accanto (`showPrepare`), e il motivo «Non ci sono domande da fare» che lo
 * nomina dice il vero. Senza niente da preparare quel motivo nomina solo «Aggiungi»
 * (`gates.noQuestionsPage`): la scheda non mostra un pulsante che non c'è.
 */
export function askEntry(panel: Pick<UseCaseReferentPanel, "gates" | "preparable">): AskEntry {
  const canPrepare = panel.preparable.length > 0;
  const canOpen = panel.gates.every((gate) => gate.code === "nessuna_domanda" && canPrepare);
  if (canOpen) return { canOpen: true, gates: [], showPrepare: false };
  const gates = canPrepare
    ? panel.gates
    : panel.gates.map((gate): ReferentGate => (gate.code === "nessuna_domanda" ? { ...gate, message: REFERENT_UI_TEXT.gates.noQuestionsPage } : gate));
  return { canOpen: false, gates, showPrepare: canPrepare };
}

/** «Mario Rossi · Ufficio acquisti · m•••@topjet.it», con « · Fa parte del team» e il motivo se non si può scegliere. */
export function contactOptionLabel(option: ReferentContactOption): string {
  const values = { Nome: option.displayName, ruolo: option.roleLabel ?? "", email: option.emailMasked ?? "" };
  const template = option.roleLabel && option.emailMasked ? T.option : option.emailMasked ? T.optionNoRole : option.roleLabel ? T.optionNoEmail : T.optionNameOnly;
  let label = fillText(template, values);
  // «Fa parte del team» solo per i colleghi: chi guarda (sei tu) ha già il suo motivo.
  if (option.team && option.reason !== "sei_tu") label += ` · ${T.teamTag}`;
  if (!option.selectable && option.reason) label += ` ${T.suffix[option.reason]}`;
  return label;
}

/** (Referente già iscritto) «Mario Rossi · m•••@topjet.it», con « · Fa parte del team» per i revisori; mai un ruolo, niente dei corsi. */
export function memberOptionLabel(option: ReferentMemberOption): string {
  let label = option.emailMasked ? fillText(T.optionNoRole, { Nome: option.displayName, email: option.emailMasked }) : fillText(T.optionNameOnly, { Nome: option.displayName });
  if (option.team) label += ` · ${T.teamTag}`;
  return label;
}

/**
 * Le voci del selettore «A chi chiedi?» vanno a capo invece di essere tagliate: su un telefono (375 px)
 * «Federico Barsi · f•••@topjet.it · Fa parte del team» non sta in una riga, e «Fa parte del team» è
 * l'unica cosa che distingue un revisore. Va sul `SelectItem`; tocca solo il testo della voce (il primo
 * figlio, `ItemText`, che di suo è `shrink-0 whitespace-nowrap`).
 */
export const ASK_OPTION_CLASS = "[&>*:first-child]:min-w-0 [&>*:first-child]:shrink [&>*:first-child]:whitespace-normal [&>*:first-child]:[overflow-wrap:anywhere]";

export interface AskContactChoice {
  value: string;
  label: string;
  disabled: boolean;
  /** (Referente già iscritto) Il gruppo del selettore: i referenti, le persone del workspace, «+ Nuovo referente». */
  group: "referenti" | "persone" | "nuovo";
}

/**
 * Le voci del selettore «A chi chiedi?»: i referenti nell'ordine del pannello, poi le persone del
 * workspace che hanno già un account (in ordine alfabetico, dal pannello), poi «+ Nuovo referente».
 * Con «Chiedi di nuovo» il referente della richiesta resta scelto e si può tenere anche se la sua
 * richiesta di prima è ancora aperta (è quella che si sostituisce); le persone non compaiono.
 */
export function contactChoices(panel: PanelPeople, mode: AskMode = ASK_MODE): AskContactChoice[] {
  const locked = mode.lockedContactId ? lower(mode.lockedContactId) : null;
  const out: AskContactChoice[] = panel.contacts.map((option) => {
    const isLocked = locked !== null && lower(option.id) === locked;
    const keep = isLocked && option.reason === "richiesta_aperta";
    return {
      value: option.id,
      label: keep ? contactOptionLabel({ ...option, selectable: true, reason: null }) : contactOptionLabel(option),
      disabled: locked !== null ? !isLocked : !option.selectable,
      group: "referenti" as const,
    };
  });
  if (!locked) {
    for (const member of panel.members ?? []) out.push({ value: memberValue(member.userId), label: memberOptionLabel(member), disabled: false, group: "persone" });
    out.push({ value: NEW_CONTACT, label: T.newContact, disabled: false, group: "nuovo" });
  }
  return out;
}

/** (Referente già iscritto) Le voci a gruppi, per il selettore: le etichette dei gruppi solo quando ci sono anche persone del workspace. */
export function contactChoiceGroups(choices: readonly AskContactChoice[]): { label: string | null; choices: AskContactChoice[] }[] {
  const of = (group: AskContactChoice["group"]) => choices.filter((c) => c.group === group);
  const people = of("persone");
  if (people.length === 0) return [{ label: null, choices: [...choices] }];
  const contacts = of("referenti");
  return [
    ...(contacts.length ? [{ label: T.contactsGroup, choices: contacts }] : []),
    { label: T.membersGroup, choices: people },
    { label: null, choices: of("nuovo") },
  ];
}

function chosenMember(panel: PanelPeople, draft: Pick<AskDraft, "choice">): ReferentMemberOption | null {
  const id = memberIdOf(draft.choice);
  if (!id) return null;
  return (panel.members ?? []).find((m) => lower(m.userId) === id) ?? null;
}

/** Chi guarda è tra i referenti («(sei tu)»): sotto il selettore, il suggerimento di rispondere dalla scheda. */
export function askSelfHint(panel: Pick<UseCaseReferentPanel, "contacts">): string | null {
  return panel.contacts.some((option) => option.reason === "sei_tu") ? T.selfHint : null;
}

function chosenContact(panel: Pick<UseCaseReferentPanel, "contacts">, draft: Pick<AskDraft, "choice">): ReferentContactOption | null {
  if (!draft.choice || draft.choice === NEW_CONTACT || memberIdOf(draft.choice)) return null;
  const id = lower(draft.choice);
  return panel.contacts.find((option) => lower(option.id) === id) ?? null;
}

/** «{Nome} ha già domande aperte su altri use case: i promemoria arriveranno in un'unica email.» (un sì o un no, mai un numero). */
export function askOtherRequestsHint(panel: Pick<UseCaseReferentPanel, "contacts">, draft: Pick<AskDraft, "choice">): string | null {
  const contact = chosenContact(panel, draft);
  return contact?.hasOtherRequests ? fillText(T.otherRequestsHint, { Nome: contact.displayName }) : null;
}

/**
 * Il riepilogo sotto la finestra: a chi scriviamo e dove arrivano le risposte. Per un referente
 * esistente l'indirizzo intero quando è arrivato (`revealed`), fino ad allora quello coperto.
 */
export function askSummary(
  panel: Pick<UseCaseReferentPanel, "contacts" | "requester"> & Partial<Pick<UseCaseReferentPanel, "members">>,
  draft: Pick<AskDraft, "choice" | "email">,
  revealed: string | null,
): string | null {
  let email: string | null = null;
  if (draft.choice === NEW_CONTACT) email = draft.email.trim() || null;
  else if (memberIdOf(draft.choice)) email = chosenMember(panel, draft)?.emailMasked ?? null;
  else email = revealed ?? chosenContact(panel, draft)?.emailMasked ?? null;
  if (!email) return null;
  return fillText(T.summary, { email, tuaEmail: panel.requester.email ?? "" });
}

/** I controlli prima dell'invio, con i testi del server: il server rifà tutto. Chiavi: `contact`, `displayName`, `email`, `message`, `needIds`. */
export function askDraftErrors(
  draft: AskDraft,
  panel: Pick<UseCaseReferentPanel, "contacts" | "limits"> & Partial<Pick<UseCaseReferentPanel, "members">>,
  mode: AskMode = ASK_MODE,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.choice) errors.contact = T.whoPlaceholder;
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
