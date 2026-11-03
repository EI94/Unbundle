/**
 * «Chiedi al referente» in tre passi (rilascio 4, §4, §6, §8, §9, §10): «A chi», «Cosa chiedi»,
 * «Controlla e invia». Lo stato puro della finestra: il passo, chi è scelto, quali domande proporre e
 * spuntare, dove tornare dopo un errore del server, cosa riprendere riaprendo la finestra, e la riga
 * «Ok di … dato.» dopo l'ok sui fornitori. Senza React: lo prova `ask-steps-state.test.ts`.
 *
 * Nessun conteggio per persona (art. 15.4): il solo numero è quello delle domande spuntate su questa
 * scheda («Avanti · 3 domande»). La proposta delle domande (`match.ts`) confronta solo il nome e il ruolo
 * scritto della persona con il «Chi» che chi guarda vede già; non si salva e non si manda.
 */
import type { ReferentActionResult, ReferentGate, ReferentRequestView, UseCaseReferentPanel } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_UI_TEXT, fillText } from "../../../../lib/use-cases/referent/labels.ts";
import { initialTicks, questionsForPerson } from "../../../../lib/use-cases/referent/match.ts";
import { ASK_MODE, NEW_CONTACT, askDraftErrors, chosenContact, chosenMember, memberIdOf, type AskDraft, type AskMode, type AskPeople } from "./ask-dialog-state.ts";

const T = REFERENT_UI_TEXT.askDialog;
const lower = (id: string) => id.toLowerCase();

export type AskStep = 1 | 2 | 3;

/** Di un'esigenza della scheda (id in minuscolo): il titolo, il «Chi» come lo mostra la scheda e il testo libero «Chi». */
export interface AskNeedInfo {
  title: string;
  /** `needOwnerText`: «Amministrazione · Cliente». */
  owner: string | null;
  /** Il testo libero «Chi», per la proposta delle domande. */
  ownerLabel: string | null;
  /** (Rilascio 5) Il tipo dell'esigenza: «Documento» spunta «Serve un file» di default. */
  kind?: string | null;
}

/** La finestra fra un passo e l'altro: la bozza, il passo, per chi sono le spunte e le domande già viste. */
export interface AskSession {
  step: AskStep;
  draft: AskDraft;
  /** La persona per cui sono state proposte le spunte (`personKey`): un'altra persona le rifà. */
  ticksFor: string | null;
  /** Le domande che si potevano chiedere quando la finestra le ha mostrate (per «Prepara le domande»). */
  seen: string[];
}

/** Il primo passo: «A chi»; in «Chiedi di nuovo» la persona non si cambia e si parte da «Cosa chiedi». */
export function firstStep(mode: AskMode = ASK_MODE): AskStep {
  return mode.kind === "again" ? 2 : 1;
}

export function initialSession(draft: AskDraft, panel: Pick<UseCaseReferentPanel, "askableNeedIds">, mode: AskMode = ASK_MODE): AskSession {
  return { step: firstStep(mode), draft, ticksFor: mode.kind === "again" ? `c:${lower(mode.lockedContactId ?? "")}` : null, seen: panel.askableNeedIds.map(lower) };
}

export type StepState = "fatto" | "adesso" | "dopo";

/** La barra dei passi: tre voci, una sola «adesso»; in «Chiedi di nuovo» «A chi» è già fatto. */
export function stepItems(step: AskStep): { step: AskStep; label: string; state: StepState }[] {
  const labels: Record<AskStep, string> = { 1: T.steps.who, 2: T.steps.what, 3: T.steps.check };
  return ([1, 2, 3] as const).map((n) => ({ step: n, label: labels[n], state: n < step ? "fatto" : n === step ? "adesso" : "dopo" }));
}

const STEP_KEYS: Record<AskStep, readonly string[]> = { 1: ["contact", "displayName", "email"], 2: ["needIds", "message"], 3: [] };

/** I controlli di un passo, con i testi del server; il passo 3 non ne ha (li rifà il server). */
export function stepErrors(step: AskStep, draft: AskDraft, panel: AskPeople & Pick<UseCaseReferentPanel, "limits">, mode: AskMode = ASK_MODE): Record<string, string> {
  const all = askDraftErrors(draft, panel, mode);
  return Object.fromEntries(Object.entries(all).filter(([key]) => STEP_KEYS[step].includes(key)));
}

/** La persona scelta, come la usano i passi 2 e 3. */
export interface AskPerson {
  /** Cambia quando cambia la persona (o, per una persona nuova, il nome o il ruolo scritto). */
  key: string;
  kind: "referente" | "persona" | "nuova";
  /** L'id per l'indirizzo intero (referente o persona); null per una persona nuova. */
  revealId: string | null;
  displayName: string;
  roleLabel: string | null;
  /** L'email coperta, oppure quella scritta per una persona nuova. */
  email: string | null;
}

/** Chi è scelto in «A chi», o la persona della richiesta in «Chiedi di nuovo»; null senza una scelta valida. */
export function personOf(draft: AskDraft, people: AskPeople, mode: AskMode = ASK_MODE, previous?: Pick<ReferentRequestView, "contact"> | null): AskPerson | null {
  if (mode.kind === "again" && mode.lockedContactId) {
    const id = lower(mode.lockedContactId);
    const contact = chosenContact(people, { choice: id });
    const from = contact
      ? { displayName: contact.displayName, roleLabel: contact.roleLabel, email: contact.emailMasked }
      : previous
        ? { displayName: previous.contact.name, roleLabel: previous.contact.roleLabel, email: previous.contact.emailMasked }
        : null;
    return from ? { key: `c:${id}`, kind: "referente", revealId: id, ...from } : null;
  }
  if (draft.choice === NEW_CONTACT) {
    const name = draft.name.replace(/\s+/g, " ").trim();
    const role = draft.role.replace(/\s+/g, " ").trim();
    if (!name) return null;
    return { key: `n:${name.toLowerCase()}|${role.toLowerCase()}`, kind: "nuova", revealId: null, displayName: name, roleLabel: role || null, email: draft.email.trim() || null };
  }
  const memberId = memberIdOf(draft.choice);
  if (memberId) {
    const member = chosenMember(people, draft);
    return member ? { key: `m:${memberId}`, kind: "persona", revealId: memberId, displayName: member.displayName, roleLabel: null, email: member.emailMasked } : null;
  }
  const contact = chosenContact(people, draft);
  return contact ? { key: `c:${lower(contact.id)}`, kind: "referente", revealId: lower(contact.id), displayName: contact.displayName, roleLabel: contact.roleLabel, email: contact.emailMasked } : null;
}

export interface AskQuestionItem {
  id: string;
  title: string;
  /** Il «Chi», solo per le domande sotto «Altre domande di questo use case». */
  meta: string | null;
}

/** Le domande di «Cosa chiedi»: proposte e altre, oppure tutte (nessuna è per la persona), oppure nessuna. */
export type AskQuestions =
  | { layout: "split"; proposed: AskQuestionItem[]; others: AskQuestionItem[] }
  | { layout: "all"; items: AskQuestionItem[] }
  | { layout: "empty" };

/**
 * Le domande che si possono chiedere, per la persona scelta: quelle che la riguardano e quelle
 * generiche spuntate in cima, le altre chiuse sotto «Altre domande di questo use case · n», con il loro
 * «Chi». Nessuna che nomini la persona (`matched` falso): tutte, non spuntate e aperte, anche le
 * generiche, perché una «Decisione» scritta per il team non si propone a chi nessun «Chi» nomina.
 * In «Chiedi di nuovo» le domande di prima. `fresh`: le domande che, arrivando a finestra aperta
 * («Prepara le domande»), arrivano spuntate (`mergeTicks`): le proposte, generiche comprese.
 */
export function questionsOf(input: {
  askableNeedIds: readonly string[];
  needInfo: Readonly<Record<string, AskNeedInfo>>;
  person: Pick<AskPerson, "displayName" | "roleLabel">;
  orgWords: ReadonlySet<string>;
  previous?: readonly string[] | null;
}): { questions: AskQuestions; proposed: string[]; fresh: string[] } {
  const ids = input.askableNeedIds.map(lower);
  if (ids.length === 0) return { questions: { layout: "empty" }, proposed: [], fresh: [] };
  const item = (id: string, withMeta: boolean): AskQuestionItem => ({ id, title: input.needInfo[id]?.title ?? id, meta: withMeta ? (input.needInfo[id]?.owner ?? null) : null });
  const result = questionsForPerson({
    person: { displayName: input.person.displayName, roleLabel: input.person.roleLabel },
    askable: ids.map((id) => ({ id, ownerLabel: input.needInfo[id]?.ownerLabel ?? null })),
    orgWords: input.orgWords,
    previous: input.previous ?? null,
  });
  if (result.proposed.length === 0 || !result.matched) return { questions: { layout: "all", items: ids.map((id) => item(id, false)) }, proposed: [], fresh: result.proposed };
  return { questions: { layout: "split", proposed: result.proposed.map((id) => item(id, false)), others: result.others.map((id) => item(id, true)) }, proposed: result.proposed, fresh: result.proposed };
}

/** Le spunte all'arrivo su «Cosa chiedi»: le prime 20 proposte. */
export function arrivalTicks(proposed: readonly string[], limit: number): string[] {
  return initialTicks({ proposed: [...proposed] }, limit);
}

/**
 * Da «A chi» a «Cosa chiedi»: con una persona diversa da quella delle spunte, le spunte si rifanno
 * (le prime 20 proposte); con la stessa restano quelle di chi guarda.
 */
export function enterQuestions(session: AskSession, person: Pick<AskPerson, "key">, proposed: readonly string[], limit: number): AskSession {
  if (session.ticksFor === person.key) return { ...session, step: 2 };
  return { ...session, step: 2, ticksFor: person.key, draft: { ...session.draft, needIds: arrivalTicks(proposed, limit) } };
}

/**
 * Le spunte quando le domande cambiano a finestra aperta (dopo «Prepara le domande», o una domanda
 * risposta dalla scheda): restano quelle ancora da chiedere; le nuove arrivano spuntate solo se sono
 * fra le proposte (`fresh` di `questionsOf`, generiche comprese) e solo in «Chiedi al referente»;
 * l'ordine è quello della scheda.
 */
export function mergeTicks(selected: readonly string[], seen: readonly string[], askableNow: readonly string[], proposedNow: readonly string[], mode: AskMode = ASK_MODE): string[] {
  const chosen = new Set(selected.map(lower));
  const before = new Set(seen.map(lower));
  const proposed = new Set(proposedNow.map(lower));
  return askableNow.map(lower).filter((id) => chosen.has(id) || (mode.kind === "ask" && !before.has(id) && proposed.has(id)));
}

/** «Avanti · 1 domanda», «Avanti · 3 domande», anche «Avanti · 0 domande» (il pulsante non si spegne mai). */
export function questionsNextLabel(ticked: number): string {
  return ticked === 1 ? T.nextOne : fillText(T.nextMany, { n: ticked });
}

/**
 * Il pulsante del passo sta nello stesso punto del piede in tutti e tre i passi: un doppio clic, o un
 * secondo tocco ravvicinato, premerebbe anche quello del passo dopo, e in «Controlla e invia» è «Invia».
 * Dopo un cambio di passo il piede aspetta `STEP_SETTLE_MS` e non conta il secondo clic di un doppio clic.
 * (Rilascio 5) La regola sta in `repeat-guard.ts`: la usa anche la pagina del referente.
 */
export { STEP_SETTLE_MS, isRepeatActivation } from "../../../../lib/use-cases/referent/repeat-guard.ts";

/** «Invia a Mario Rossi». */
export function sendLabel(person: Pick<AskPerson, "displayName">): string {
  return fillText(T.send, { Nome: person.displayName });
}

/** «Chiedi di nuovo»: «A Mario Rossi · m•••@topjet.it» sopra «Cosa chiedi», con l'indirizzo intero quando è arrivato. */
export function againLineOf(name: string, email: string | null): string {
  return email ? fillText(T.againTo, { Nome: name, email }) : `${T.to} ${name}`;
}

/** «A» di «Controlla e invia»: il nome e l'indirizzo intero quando è arrivato, altrimenti quello coperto (o scritto). */
export function toLine(person: Pick<AskPerson, "displayName" | "email">, revealed: string | null): string {
  const email = revealed ?? person.email;
  return email ? fillText(T.toValue, { Nome: person.displayName, email }) : person.displayName;
}

const STEP_ONE_CODES = new Set([
  "referente_non_valido",
  "referente_disattivato",
  "referente_lateral_space",
  "referente_sei_tu",
  "referente_in_dossier",
  "persona_non_disponibile",
  "richiesta_aperta",
  "email_in_uso",
  "email_mancante",
  "email_non_valida",
  "email_di_chi_chiede",
  "dati_non_validi",
]);
const STEP_TWO_CODES = new Set(["nessuna_domanda", "troppe_domande", "domande_cambiate", "messaggio_troppo_lungo"]);
const GATE_CODES = new Set(["sub_responsabili_mancanti", "email_non_configurata", "risposte_non_attive", "email_non_verificata"]);
/** Dopo questi i dati a schermo non sono più quelli veri: la pagina si rilegge, la finestra resta. */
const REFRESH_CODES = new Set(["domande_cambiate", "persona_non_disponibile", "referente_non_valido", "richiesta_chiusa", "versione_superata", ...GATE_CODES]);
/** Dopo questi non c'è più niente da chiedere qui: la finestra si chiude. */
export const ASK_CLOSE_CODES: ReadonlySet<string> = new Set(["non_trovato", "funzione_spenta", "permesso_mancante"]);

/**
 * Dove torna un errore del server (§9.3): sulla persona («A chi», in «Chiedi di nuovo» la riga
 * d'errore di «Controlla e invia»), sulle domande («Cosa chiedi»), oppure resta su «Controlla e invia»
 * (un motivo che blocca l'invio arrivato nel frattempo: la pagina si rilegge e lo mostra). `close`:
 * la finestra si chiude.
 */
export function askErrorStep(result: Extract<ReferentActionResult<unknown>, { ok: false }>, mode: AskMode = ASK_MODE): { step: AskStep; close: boolean; refresh: boolean } {
  const refresh = REFRESH_CODES.has(result.code);
  if (ASK_CLOSE_CODES.has(result.code)) return { step: 3, close: true, refresh };
  const fields = Object.keys(result.fieldErrors ?? {});
  if (GATE_CODES.has(result.code)) return { step: 3, close: false, refresh };
  const personError = STEP_ONE_CODES.has(result.code) || fields.some((key) => key === "contact" || key === "displayName" || key === "email" || key === "roleLabel");
  if (personError) return { step: mode.kind === "again" ? 3 : 1, close: false, refresh };
  if (STEP_TWO_CODES.has(result.code) || fields.some((key) => key === "needIds" || key === "message")) return { step: 2, close: false, refresh };
  return { step: 3, close: false, refresh };
}

/**
 * Riaprendo la finestra con la bozza di prima (§4, D13): lo stesso passo, se ogni passo prima vale
 * ancora (la persona c'è ancora o è scritta, almeno una spunta si può ancora chiedere); altrimenti il
 * primo passo che non vale.
 */
export function resumeStep(session: Pick<AskSession, "step" | "draft">, panel: AskPeople & Pick<UseCaseReferentPanel, "limits" | "askableNeedIds">, mode: AskMode = ASK_MODE): AskStep {
  const start = firstStep(mode);
  if (session.step <= start) return start;
  if (start === 1 && Object.keys(stepErrors(1, session.draft, panel, mode)).length) return 1;
  if (session.step === 2) return 2;
  const askable = new Set(panel.askableNeedIds.map(lower));
  const ticks = session.draft.needIds.filter((id) => askable.has(lower(id)));
  if (ticks.length === 0 || Object.keys(stepErrors(2, { ...session.draft, needIds: ticks }, panel, mode)).length) return 2;
  return 3;
}

/** La bozza da tenere quando la finestra si chiude: solo «Chiedi al referente» non inviato; un invio la cancella. */
export function draftToKeep(kind: AskMode["kind"], sent: boolean, session: AskSession): AskSession | null {
  return kind === "ask" && !sent ? session : null;
}

/** La sola riga di «Controlla e invia» quando l'ok sui fornitori arriva a finestra aperta. */
export function okNoticeOf(input: { sawSubGate: boolean; gatesNow: readonly ReferentGate[]; company: string }): string | null {
  if (!input.sawSubGate || input.gatesNow.some((gate) => gate.code === "sub_responsabili_mancanti")) return null;
  const given = fillText(T.okGiven, { Azienda: input.company });
  return input.gatesNow.length === 0 ? `${given}${T.okSend}` : given;
}
