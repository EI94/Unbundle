/**
 * «Scegli il referente» (rilascio 5, SPEC §8): la finestra di una schermata che sceglie il referente
 * dello use case e gli manda subito il suo compito (la conferma, la stima del tempo, poche domande).
 * Chi la apre, in che modo («scegli», «cambia», «di_nuovo», «chiedi»), chi si può scegliere, le domande
 * spuntate, le frasi e il contenuto dell'action. Modulo puro, senza React: lo prova
 * `assign-dialog-state.test.ts`.
 *
 * Nessun conteggio né ordinamento per persona (art. 15.4): le persone restano nell'ordine del pannello.
 */
import type { ReferentContactOption, ReferentGate, ReferentRequestView, SendReferentRequestInput, UseCaseReferentPanel } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_ASSIGN_TEXT, REFERENT_ERROR_MESSAGES, REFERENT_UI_TEXT, fillText } from "../../../../lib/use-cases/referent/labels.ts";
import { defaultAssignTicks, type AssignMode } from "../../../../lib/use-cases/referent/assign.ts";
import { NEW_CONTACT, chosenContact, memberIdOf, type AskDraft } from "./ask-dialog-state.ts";
import type { AskNeedInfo } from "./ask-steps-state.ts";

export type { AssignMode } from "../../../../lib/use-cases/referent/assign.ts";

const T = REFERENT_ASSIGN_TEXT;
const lower = (id: string) => id.toLowerCase();

type PanelForAssign = Pick<UseCaseReferentPanel, "available" | "canAsk" | "gates" | "contacts" | "requests" | "askableNeedIds" | "referent" | "latestReferentRequestId">;

/** I motivi che nessuno nel workspace può togliere: la finestra si apre e lo dice. */
const SYSTEM_GATES: ReadonlySet<ReferentGate["code"]> = new Set(["email_non_configurata", "risposte_non_attive"]);

function isOpenable(gate: ReferentGate): boolean {
  return SYSTEM_GATES.has(gate.code) || (gate.code === "sub_responsabili_mancanti" && gate.canDeclare === true);
}

export interface AssignEntry {
  /** La finestra si apre: chi guarda può arrivare in fondo (o legge perché non si può inviare). */
  canOpen: boolean;
  /** I motivi che bloccano l'invio, nell'ordine del server. «Nessuna domanda» non blocca mai (D5). */
  sendGates: readonly ReferentGate[];
  /** Il primo, in una riga in cima alla finestra. */
  notice: ReferentGate | null;
}

/** (§8.1) Chi apre «Scegli il referente»: come la finestra in tre passi, ma senza bisogno di domande. */
export function assignEntry(panel: Pick<UseCaseReferentPanel, "available" | "canAsk" | "gates">): AssignEntry {
  const blockers = panel.gates.filter((gate) => gate.code !== "nessuna_domanda");
  const canOpen = panel.available && panel.canAsk && blockers.every(isOpenable);
  return { canOpen, sendGates: blockers, notice: blockers[0] ?? null };
}

/** La richiesta R del referente (quella su cui si agisce), se il pannello la ha ancora. */
export function referentRequestOf(panel: Pick<UseCaseReferentPanel, "requests" | "referent">): ReferentRequestView | null {
  const id = panel.referent?.requestId;
  if (!id) return null;
  return panel.requests.find((r) => lower(r.id) === lower(id)) ?? null;
}

/**
 * Il modo del pulsante del blocco: «scegli» senza referente, «di_nuovo» con «Nessuna risposta»,
 * «chiedi» quando il referente ha risposto, la sua richiesta non è viva e ci sono domande che non ha
 * già rifiutato; altrimenti null (il blocco non ha un pulsante del referente, solo «Cambia referente»).
 */
export function assignModeOf(panel: Pick<UseCaseReferentPanel, "requests" | "referent">): AssignMode | null {
  const referent = panel.referent ?? null;
  if (!referent) return "scegli";
  if (referent.state === "nessuna_risposta") return "di_nuovo";
  if (!referent.live && referent.askableForReferent.length > 0 && (referent.state === "fatto" || referent.state === "da_verificare")) return "chiedi";
  return null;
}

/** La persona è bloccata: «Chiedi di nuovo» e «Chiedi al referente» vanno al referente. */
export function lockedPerson(mode: AssignMode): boolean {
  return mode === "di_nuovo" || mode === "chiedi";
}

/** Una persona dell'elenco: si sceglie o no, e il suffisso della riga. */
export interface AssignContactRow {
  selectable: boolean;
  /** «(è il referente)», «(ha già delle domande aperte)», oppure il motivo del rilascio 4. */
  suffix: string | null;
}

/** (§8.2) Le righe dell'elenco: il referente non si sceglie in «cambia»; chi ha già domande aperte sì (D49). */
export function assignContactRow(option: ReferentContactOption, panel: Pick<UseCaseReferentPanel, "referent">): AssignContactRow {
  const referentId = panel.referent?.contact.id ? lower(panel.referent.contact.id) : null;
  if (referentId && lower(option.id) === referentId) return { selectable: false, suffix: T.isReferent };
  const live = option.liveRequest ?? null;
  if (option.reason === "richiesta_aperta" || (option.selectable && live?.kind === "domande")) {
    // Una richiesta viva di sole domande: sceglierla la sostituisce. Una al referente è del referente.
    return live?.kind === "referente" ? { selectable: false, suffix: T.isReferent } : { selectable: true, suffix: T.hasQuestions };
  }
  if (!option.selectable && option.reason) return { selectable: false, suffix: REFERENT_UI_TEXT.askDialog.suffix[option.reason] };
  return { selectable: option.selectable, suffix: null };
}

/** I contatti con la riga già calcolata, per l'elenco della finestra. */
export function assignContacts(panel: Pick<UseCaseReferentPanel, "contacts" | "referent">): ReferentContactOption[] {
  return panel.contacts.map((option) => {
    const row = assignContactRow(option, panel);
    // Il motivo del rilascio 4 «richiesta già aperta» non vale qui: lo dice il suffisso nuovo.
    return { ...option, selectable: row.selectable, reason: row.selectable ? null : option.reason === "richiesta_aperta" ? null : option.reason };
  });
}

/** Il suffisso di una riga, in coda alla sua riga grigia. */
export function assignRowSuffix(option: ReferentContactOption, panel: Pick<UseCaseReferentPanel, "contacts" | "referent">): string | null {
  const original = panel.contacts.find((c) => lower(c.id) === lower(option.id)) ?? option;
  return assignContactRow(original, panel).suffix;
}

/**
 * Le domande aperte che passano alla richiesta nuova (D48, D49): in «cambia» quelle delle richieste
 * vive del referente di prima; per una persona scelta con una richiesta viva di sole domande, quelle
 * di quella richiesta. Solo quelle che nessun'altra richiesta viva chiede ancora.
 */
export function carriedNeedIds(panel: Pick<UseCaseReferentPanel, "requests" | "referent" | "contacts">, mode: AssignMode, draft: Pick<AskDraft, "choice">): string[] {
  if (mode !== "scegli" && mode !== "cambia") return [];
  const revoked = new Set<string>();
  const live = panel.requests.filter((r) => r.status === "inviata");
  if (mode === "cambia" && panel.referent) {
    const old = lower(panel.referent.contact.id);
    for (const r of live) if (lower(r.contact.id) === old) revoked.add(lower(r.id));
  }
  const chosen = draft.choice && draft.choice !== NEW_CONTACT && !memberIdOf(draft.choice) ? chosenContact(panel, draft) : null;
  if (chosen?.liveRequest?.kind === "domande") revoked.add(lower(chosen.liveRequest.id));
  if (!revoked.size) return [];
  const stillAsked = new Set(live.filter((r) => !revoked.has(lower(r.id))).flatMap((r) => (r.openNeedIds ?? []).map(lower)));
  const out: string[] = [];
  for (const r of live) {
    if (!revoked.has(lower(r.id))) continue;
    for (const id of r.openNeedIds ?? []) if (!stillAsked.has(lower(id)) && !out.includes(lower(id))) out.push(lower(id));
  }
  return out;
}

/** La persona scelta è una che ha già una richiesta viva di sole domande (la frase D49 della finestra). */
export function replacesQuestions(panel: Pick<UseCaseReferentPanel, "contacts">, draft: Pick<AskDraft, "choice">): boolean {
  const chosen = draft.choice && draft.choice !== NEW_CONTACT && !memberIdOf(draft.choice) ? chosenContact(panel, draft) : null;
  return chosen?.liveRequest?.kind === "domande";
}

/**
 * Le domande della finestra, nell'ordine della scheda (`order`, le chiavi di `needInfo`): quelle da
 * chiedere più quelle portate; in «chiedi» senza quelle rifiutate dal referente; in «di_nuovo» quelle
 * da chiedere (le domande della richiesta di prima arrivano spuntate).
 */
export function assignQuestionIds(panel: Pick<UseCaseReferentPanel, "askableNeedIds" | "referent">, mode: AssignMode, carried: readonly string[], order: readonly string[]): string[] {
  const set = new Set(panel.askableNeedIds.map(lower));
  for (const id of carried) set.add(lower(id));
  if (mode === "chiedi" || mode === "di_nuovo") for (const id of panel.referent?.declinedNeedIds ?? []) set.delete(lower(id));
  const ordered = order.map(lower).filter((id) => set.has(id));
  for (const id of set) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
}

/** Le spunte di partenza (§3.8), per la persona scelta. */
export function assignTicks(input: {
  mode: AssignMode;
  questions: readonly string[];
  carried: readonly string[];
  needInfo: Readonly<Record<string, AskNeedInfo>>;
  person: { displayName: string; roleLabel: string | null } | null;
  orgWords: ReadonlySet<string>;
  declined: readonly string[];
  previous: readonly string[] | null;
}): string[] {
  const askable = input.questions.map((id) => ({ id, ownerLabel: input.needInfo[id]?.ownerLabel ?? null }));
  return defaultAssignTicks({
    mode: input.mode,
    askable,
    carried: input.carried,
    declined: input.mode === "chiedi" ? input.declined : [],
    person: input.person,
    orgWords: input.orgWords,
    previous: input.previous,
  });
}

/** «Serve un file» spuntato di default: le domande di tipo «Documento». */
export function defaultFileRequired(ticked: readonly string[], needInfo: Readonly<Record<string, AskNeedInfo>>): string[] {
  return ticked.filter((id) => needInfo[id]?.kind === "documento");
}

/** Il titolo della finestra. */
export function assignTitle(mode: AssignMode): string {
  return T.title[mode];
}

/** (§8.2) La frase sotto il titolo, con il numero vero di domande spuntate. */
export function assignLead(mode: AssignMode, ticked: number, name: string | null): string {
  if (mode === "chiedi") return ticked === 1 ? fillText(T.askOne, { Nome: name ?? "" }) : fillText(T.askMany, { Nome: name ?? "", n: ticked });
  if (ticked <= 0) return T.leadNone;
  return ticked === 1 ? T.leadOne : fillText(T.leadMany, { n: ticked });
}

/** La frase del «Chiedi di nuovo» su una richiesta di sole domande (non chiede la conferma). */
export function assignLeadFor(mode: AssignMode, kind: "referente" | "domande", ticked: number, name: string | null): string {
  if (mode === "di_nuovo" && kind === "domande") return assignLead("chiedi", ticked, name);
  return assignLead(mode, ticked, name);
}

/** «Domande · 5 di 7», «Domande · 3» quando sono tutte spuntate. */
export function assignQuestionsSummary(ticked: number, all: number): string {
  return ticked === all ? fillText(T.questionsAll, { n: all }) : fillText(T.questionsSome, { t: ticked, a: all });
}

/** «L'altra resta da chiedere.», «Le altre 2 restano da chiedere.», oppure null. */
export function assignRestLine(ticked: number, all: number): string | null {
  const rest = all - ticked;
  if (rest <= 0) return null;
  return rest === 1 ? T.restOne : fillText(T.restMany, { k: rest });
}

/** La riga fuori dalle pieghe quando la descrizione perde frasi (§8.2). */
export function droppedLine(dropped: number): string | null {
  if (dropped <= 0) return null;
  return dropped === 1 ? T.droppedOne : fillText(T.droppedMany, { k: dropped });
}

/** «Invia a {Nome}», «Invia» prima di una scelta. */
export function assignSendLabel(name: string | null): string {
  return name ? fillText(T.send, { Nome: name }) : T.sendBare;
}

/** Il toast dopo l'invio. */
export function assignSentToast(mode: AssignMode, kind: "referente" | "domande", name: string): string {
  return (mode === "scegli" || mode === "cambia") && kind === "referente" ? fillText(T.sentReferent, { Nome: name }) : fillText(T.sent, { Nome: name });
}

/** Il tipo della richiesta che parte: in «di_nuovo» quello della richiesta di prima. */
export function assignKind(mode: AssignMode, previous: Pick<ReferentRequestView, "kind"> | null): "referente" | "domande" {
  if (mode === "chiedi") return "domande";
  if (mode === "di_nuovo") return previous?.kind === "domande" ? "domande" : "referente";
  return "referente";
}

export interface AssignDraft extends AskDraft {
  /** Le domande con «Serve un file», in minuscolo. */
  fileRequired: string[];
}

/** I controlli prima dell'invio: la persona, le domande, il messaggio. Il server rifà tutto. */
export function assignDraftErrors(draft: AssignDraft, panel: Pick<UseCaseReferentPanel, "contacts" | "limits">, mode: AssignMode, members: readonly { userId: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!lockedPerson(mode)) {
    if (!draft.choice) errors.contact = T.chooseFirst;
    else if (memberIdOf(draft.choice)) {
      if (!members.some((m) => lower(m.userId) === memberIdOf(draft.choice))) errors.contact = REFERENT_ERROR_MESSAGES.persona_non_disponibile;
    } else if (draft.choice === NEW_CONTACT) {
      const name = draft.name.trim();
      if (name.length < panel.limits.contactNameMin || name.length > panel.limits.contactNameMax) errors.displayName = REFERENT_ERROR_MESSAGES.dati_non_validi;
      if (!draft.email.trim()) errors.email = REFERENT_ERROR_MESSAGES.email_mancante;
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) errors.email = REFERENT_ERROR_MESSAGES.email_non_valida;
    } else if (!chosenContact(panel, draft)) errors.contact = REFERENT_ERROR_MESSAGES.referente_non_valido;
  }
  if (mode === "chiedi" && draft.needIds.length === 0) errors.needIds = REFERENT_ERROR_MESSAGES.nessuna_domanda;
  if (draft.needIds.length > panel.limits.questionsPerRequest) errors.needIds = REFERENT_ERROR_MESSAGES.troppe_domande;
  if (draft.message.trim().length > panel.limits.messageMax) errors.message = REFERENT_ERROR_MESSAGES.messaggio_troppo_lungo;
  return errors;
}

/** Il contenuto di `sendReferentRequestAction` (§8.3): le domande nell'ordine della finestra. */
export function assignPayload(
  draft: AssignDraft,
  ctx: { mode: AssignMode; questions: readonly string[]; panel: PanelForAssign; previous: Pick<ReferentRequestView, "id" | "kind"> | null },
): SendReferentRequestInput {
  const chosen = new Set(draft.needIds.map(lower));
  const needIds = ctx.questions.filter((id) => chosen.has(lower(id)));
  const files = new Set(draft.fileRequired.map(lower));
  const fileRequired = needIds.filter((id) => files.has(lower(id)));
  const message = draft.message.trim() || null;
  const kind = assignKind(ctx.mode, ctx.previous);
  const referent = ctx.panel.referent ?? null;
  const memberId = memberIdOf(draft.choice);
  const contact: SendReferentRequestInput["contact"] =
    lockedPerson(ctx.mode) && referent
      ? { kind: "esistente", contactId: referent.contact.id }
      : draft.choice === NEW_CONTACT
        ? { kind: "nuovo", displayName: draft.name.trim(), email: draft.email.trim(), roleLabel: draft.role.trim() || null }
        : memberId
          ? { kind: "membro", userId: memberId }
          : { kind: "esistente", contactId: draft.choice ?? "" };
  const out: SendReferentRequestInput = { kind, contact, needIds, message, fileRequired };
  if (kind === "referente") out.expectedReferentRequestId = ctx.panel.latestReferentRequestId ?? null;
  if (ctx.mode === "cambia") out.replaceReferent = true;
  if (ctx.mode === "di_nuovo" && ctx.previous) out.previousRequestId = ctx.previous.id;
  return out;
}

/** (D34) «Richieste inviate»: solo le richieste a persone che non sono il referente (il suo blocco dice le sue). */
export function requestsShown<R extends Pick<ReferentRequestView, "contact">>(panel: { requests: readonly R[]; referent?: { contact: { id: string } } | null; eligible?: boolean }): R[] {
  const referentId = panel.eligible && panel.referent ? lower(panel.referent.contact.id) : null;
  return referentId ? panel.requests.filter((r) => lower(r.contact.id) !== referentId) : [...panel.requests];
}

/** Dove va un errore del server: l'elenco, le domande, le porte (si rilegge), oppure una riga nel piede. */
export type AssignErrorPlace = "list" | "questions" | "gates" | "chosen" | "footer" | "close";

const LIST_CODES = new Set([
  "referente_non_valido",
  "referente_disattivato",
  "referente_lateral_space",
  "referente_sei_tu",
  "referente_in_dossier",
  "referente_uguale",
  "persona_non_disponibile",
  "richiesta_aperta",
  "email_in_uso",
  "email_mancante",
  "email_non_valida",
  "email_di_chi_chiede",
  "dati_non_validi",
]);
const QUESTION_CODES = new Set(["troppe_domande", "domande_cambiate", "nessuna_domanda", "messaggio_troppo_lungo"]);
const GATE_CODES = new Set(["sub_responsabili_mancanti", "email_non_configurata", "risposte_non_attive", "email_non_verificata"]);
const CLOSE_CODES = new Set(["non_trovato", "funzione_spenta", "permesso_mancante"]);
/** Dopo questi la pagina si rilegge: i dati a schermo non sono più quelli veri. */
export const ASSIGN_REFRESH_CODES: ReadonlySet<string> = new Set(["domande_cambiate", "persona_non_disponibile", "referente_non_valido", "richiesta_chiusa", "versione_superata", "referente_gia_scelto", ...GATE_CODES]);

export function assignErrorPlace(code: string, fieldErrors: Readonly<Record<string, string>> | undefined): AssignErrorPlace {
  if (CLOSE_CODES.has(code)) return "close";
  if (code === "referente_gia_scelto") return "chosen";
  if (GATE_CODES.has(code)) return "gates";
  const fields = Object.keys(fieldErrors ?? {});
  if (fields.includes("message") || code === "messaggio_troppo_lungo") return "questions";
  if (LIST_CODES.has(code) || fields.some((k) => k === "displayName" || k === "email" || k === "roleLabel" || k === "contact")) return "list";
  if (QUESTION_CODES.has(code) || fields.includes("needIds")) return "questions";
  return "footer";
}
