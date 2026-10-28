/**
 * «Raccolta informazioni»: a che punto è la raccolta delle informazioni del cliente su una scheda
 * (SPEC §P2.8). Uno stato **derivato**, mai salvato né scelto a mano, calcolato da una funzione
 * pura sulle esigenze del cliente della scheda e sulle richieste ai referenti:
 *
 * - **da chiedere**: ci sono informazioni del cliente da chiedere e nessuno le aspetta;
 * - **in attesa** dal giorno della richiesta (con «promemoria inviato» quando è partito);
 * - **da verificare**: sono arrivate risposte o documenti (un'esigenza è «Da verificare»);
 * - **senza risposta**: il link è scaduto, o dopo l'ultimo promemoria nessuno ha risposto;
 * - **complete**: ogni informazione del cliente è «A posto» o «Non si applica».
 * Senza esigenze del cliente non si mostra niente (null).
 *
 * L'ordine mette prima quello che chiede un'azione di un revisore: verificare, poi sollecitare,
 * poi aspettare, poi chiedere. La fase della scheda (Da valutare, Approvato…) è una decisione delle
 * persone: qui non entra e non si scrive mai. I conteggi sono delle esigenze di una scheda, mai di
 * persone; nessun testo nomina una persona o una durata. Lo vedono solo i revisori.
 *
 * Sulla scheda (rilascio «Pulizia»): la testata dice solo lo stato a parole; in cima a «Cosa serve»
 * una riga con i conteggi e che cosa resta. Le date (richiesta, promemoria, scadenza) non si ripetono
 * qui: stanno nelle righe delle «Richieste».
 *
 * Modulo puro: import relativi `.ts`.
 */
import type { ReferentItemState, ReferentRequestStatus } from "../db/use-case-hub-referents-ddl.ts";
import { romeDate } from "../uc/calendar.ts";
import type { SemaforoColor } from "../uc/vocab.ts";
import type { NeedStatus, NeedView } from "./needs.ts";
import { reviewerStatus } from "./referent/state.ts";

export const INFO_PROGRESS_STATES = ["da_chiedere", "in_attesa", "da_verificare", "senza_risposta", "complete"] as const;
export type InfoProgressState = (typeof INFO_PROGRESS_STATES)[number];

/** Gli stati che chiedono a qualcuno di fare qualcosa: gli unici con il chip nelle righe e nelle schede della Roadmap. */
export const INFO_ROW_STATES: readonly InfoProgressState[] = Object.freeze(["da_verificare", "senza_risposta"]);

/** I valori di `?info=` dell'area. */
export const INFO_PROGRESS_PARAM: Readonly<Record<InfoProgressState, string>> = Object.freeze({
  da_chiedere: "da-chiedere",
  in_attesa: "in-attesa",
  da_verificare: "da-verificare",
  senza_risposta: "senza-risposta",
  complete: "complete",
});

/** Lo stato di un valore di `?info=`; null per ogni altro valore. */
export function parseInfoParam(raw: string | null): InfoProgressState | null {
  if (typeof raw !== "string") return null;
  const found = INFO_PROGRESS_STATES.find((state) => INFO_PROGRESS_PARAM[state] === raw);
  return found ?? null;
}

/** Un requisito del cliente della scheda (già filtrato da `clientSideNeeds`). */
export interface InfoNeedFact {
  id: string;
  status: NeedStatus;
}

/** Una domanda di una richiesta su un'esigenza della scheda. Nessun referente, nessuna persona, niente informativa. */
export interface InfoAskFact {
  needId: string;
  requestId: string;
  status: ReferentRequestStatus;
  expiresAt: Date;
  createdAt: Date;
  sentAt: Date | null;
  reminderCount: number;
  lastReminderAt: Date | null;
  itemState: ReferentItemState;
}

export interface InfoProgress {
  state: InfoProgressState;
  /** in_attesa: data ISO (Roma) della richiesta viva più vecchia (sentAt ?? createdAt); null senza data. */
  since: string | null;
  /** in_attesa: su una richiesta viva è già partito un promemoria (automatico o a mano). */
  reminded: boolean;
  /** in_attesa: data ISO (Roma) della scadenza più vicina tra le richieste vive; null senza data. */
  until: string | null;
  /** senza_risposta: «scaduta» se una richiesta senza risposta è scaduta, altrimenti «ultimo_promemoria». */
  silentReason: "scaduta" | "ultimo_promemoria" | null;
  /** da_chiedere: ogni esigenza aperta è «Bloccata» (non si può chiedere finché non si sblocca). */
  blocked: boolean;
  /** «N di M informazioni ricevute»: esigenze della scheda, mai persone. received = in_verifica + validata. */
  received: number;
  total: number;
  /** Esigenze ancora da chiedere: da_chiedere, mancante, parziale. Un conteggio di esigenze, mai di persone. */
  toAsk: number;
  /** Esigenze «in_verifica»: è arrivata una risposta o un documento da guardare. */
  toVerify: number;
  /** Esigenze chieste che aspettano ancora: le «chiesta» meno quelle senza risposta. */
  waiting: number;
  /** Esigenze «chiesta» la cui ultima richiesta è senza risposta (scaduta, o dopo l'ultimo promemoria). */
  unanswered: number;
  /** Esigenze «bloccata»: non si possono chiedere finché non si sbloccano. */
  blockedCount: number;
}

export interface InfoProgressView {
  state: InfoProgressState;
  param: string;
  tone: SemaforoColor;
  /** Testo corto per righe e schede: «Info: da verificare». */
  chip: string;
  /** Testo dell'opzione del filtro: «Da verificare». */
  option: string;
  /** Testo del chip della testata: solo lo stato, «Informazioni: in attesa». Niente date né conteggi. */
  label: string;
  /** «2 di 6 informazioni ricevute» oppure «Nessuna informazione serve dal cliente.» */
  count: string;
  /** Delle ricevute, quelle da guardare: «1 da verificare» (tra parentesi dopo `count`); null senza. */
  receivedNote: string | null;
  /**
   * Che cosa resta dopo il conteggio, es. «1 in attesa · 2 da chiedere»: ogni gruppo non ricevuto con
   * almeno un'esigenza, così ricevute e gruppi fanno il totale; «tutte a posto» a scheda completa;
   * null con total 0 o senza niente che resta.
   */
  next: string | null;
  /** La riga di «Cosa serve»: `count`, « (`receivedNote`)» e « · » `next` quando ci sono. */
  line: string;
  /** Uguale a `label`. */
  ariaLabel: string;
  /** state ∈ INFO_ROW_STATES */
  showInRows: boolean;
  received: number;
  total: number;
}

export const INFO_PROGRESS_TEXT = Object.freeze({
  states: Object.freeze({
    da_chiedere: Object.freeze({ chip: "Info: da chiedere", option: "Da chiedere", label: "Informazioni: da chiedere" }),
    in_attesa: Object.freeze({ chip: "Info: in attesa", option: "In attesa", label: "Informazioni: in attesa" }),
    da_verificare: Object.freeze({ chip: "Info: da verificare", option: "Da verificare", label: "Informazioni: da verificare" }),
    senza_risposta: Object.freeze({ chip: "Info: senza risposta", option: "Senza risposta", label: "Informazioni: senza risposta" }),
    complete: Object.freeze({ chip: "Info: complete", option: "Complete", label: "Informazioni: complete" }),
  }),
  count: Object.freeze({ one: "{received} di 1 informazione ricevuta", many: "{received} di {total} informazioni ricevute", none: "Nessuna informazione serve dal cliente." }),
  // Che cosa resta, dopo il conteggio: un pezzo per gruppo, separati da « · », che con le ricevute
  // fanno il totale; «da verificare» sta tra parentesi dopo le ricevute, perché ne fa parte.
  next: Object.freeze({
    separator: " · ",
    toAsk: "{n} da chiedere",
    waiting: "{n} in attesa",
    toVerify: "{n} da verificare",
    unanswered: "{n} senza risposta",
    blockedOne: "1 da chiedere, bloccata",
    blockedMany: "{n} da chiedere, bloccate",
    blockedShortOne: "1 bloccata",
    blockedShortMany: "{n} bloccate",
    oneDone: "a posto",
    allDone: "tutte a posto",
  }),
  // Solo l'etichetta del blocco in cima a «Cosa serve», per i lettori di schermo.
  summaryHeading: "Raccolta informazioni",
  filterLabel: "Informazioni",
  filterAny: "Tutte",
});

const TONE: Readonly<Record<InfoProgressState, SemaforoColor>> = Object.freeze({
  da_chiedere: "grigio",
  in_attesa: "blu",
  da_verificare: "giallo",
  senza_risposta: "rosso",
  complete: "verde",
});

const CLIENT_SIDES: readonly (string | null)[] = [null, "cliente", "insieme"];
const TO_ASK: readonly NeedStatus[] = ["da_chiedere", "mancante", "parziale"];
const DONE: readonly NeedStatus[] = ["validata", "non_applicabile"];
const RECEIVED: readonly NeedStatus[] = ["in_verifica", "validata"];

/** I requisiti del cliente della scheda: tipo «requisito», non archiviati, collegati, da che parte non impostato, «Cliente» o «Insieme». */
export function clientSideNeeds(
  needs: readonly Pick<NeedView, "id" | "type" | "ownerSide" | "status" | "archivedAt" | "useCaseIds">[],
  useCaseId: string,
): InfoNeedFact[] {
  const id = useCaseId.toLowerCase();
  return needs
    .filter(
      (need) =>
        need.type === "requisito" &&
        !need.archivedAt &&
        CLIENT_SIDES.includes(need.ownerSide ?? null) &&
        need.useCaseIds.some((linked) => linked.toLowerCase() === id),
    )
    .map((need) => ({ id: need.id, status: need.status }));
}

/** La domanda aspetta ancora una risposta su una richiesta viva. */
export function askIsLive(a: InfoAskFact, now: Date): boolean {
  return reviewerStatus(a, now) === "inviata" && a.itemState === "aperta";
}

/** La domanda è senza risposta: scaduta, oppure viva dopo l'ultimo promemoria. */
export function askIsSilent(a: InfoAskFact, now: Date): boolean {
  if (a.itemState !== "aperta") return false;
  const status = reviewerStatus(a, now);
  return status === "scaduta" || (status === "inviata" && a.reminderCount >= 2);
}

/** L'ultima richiesta (per data, poi id) su un'esigenza, tra quelle non revocate. */
export function latestAsk(asks: readonly InfoAskFact[], needId: string): InfoAskFact | null {
  const id = needId.toLowerCase();
  let best: InfoAskFact | null = null;
  for (const a of asks) {
    if (a.needId.toLowerCase() !== id || a.status === "revocata") continue;
    if (!best || a.createdAt.getTime() > best.createdAt.getTime() || (a.createdAt.getTime() === best.createdAt.getTime() && a.requestId > best.requestId)) best = a;
  }
  return best;
}

/** Le esigenze «chiesta» la cui ultima richiesta è senza risposta: si possono chiedere di nuovo. */
export function silentNeedIds(needs: readonly InfoNeedFact[], asks: readonly InfoAskFact[], now: Date): Set<string> {
  const out = new Set<string>();
  for (const need of needs) {
    if (need.status !== "chiesta") continue;
    const a = latestAsk(asks, need.id);
    if (a && askIsSilent(a, now)) out.add(need.id.toLowerCase());
  }
  return out;
}

function minTime(values: readonly Date[]): Date | null {
  let best: Date | null = null;
  for (const v of values) if (!best || v.getTime() < best.getTime()) best = v;
  return best;
}

/** Lo stato derivato della scheda (vedi l'intestazione del modulo); null senza esigenze del cliente. */
export function deriveInfoProgress(needs: readonly InfoNeedFact[], asks: readonly InfoAskFact[], now: Date): InfoProgress | null {
  if (needs.length === 0) return null;
  const total = needs.filter((n) => n.status !== "non_applicabile").length;
  const received = needs.filter((n) => RECEIVED.includes(n.status)).length;
  const toAsk = needs.filter((n) => TO_ASK.includes(n.status)).length;
  const toVerify = needs.filter((n) => n.status === "in_verifica").length;
  const blockedCount = needs.filter((n) => n.status === "bloccata").length;
  const asked = needs.filter((n) => n.status === "chiesta").map((n) => ({ need: n, ask: latestAsk(asks, n.id) }));
  const silent = asked.filter((x) => x.ask !== null && askIsSilent(x.ask, now));
  const base = {
    since: null,
    reminded: false,
    until: null,
    silentReason: null,
    blocked: false,
    received,
    total,
    toAsk,
    toVerify,
    waiting: asked.length - silent.length,
    unanswered: silent.length,
    blockedCount,
  };
  if (needs.every((n) => DONE.includes(n.status))) return { ...base, state: "complete" };
  if (needs.some((n) => n.status === "in_verifica")) return { ...base, state: "da_verificare" };
  if (silent.length > 0) {
    const expired = silent.some((x) => reviewerStatus(x.ask!, now) === "scaduta");
    return { ...base, state: "senza_risposta", silentReason: expired ? "scaduta" : "ultimo_promemoria" };
  }
  if (asked.length > 0) {
    const live = asked.filter((x) => x.ask !== null && askIsLive(x.ask, now)).map((x) => x.ask!);
    const since = minTime(live.map((a) => a.sentAt ?? a.createdAt));
    const until = minTime(live.map((a) => a.expiresAt));
    return {
      ...base,
      state: "in_attesa",
      since: since ? romeDate(since) : null,
      until: until ? romeDate(until) : null,
      reminded: live.some((a) => a.reminderCount >= 1 || a.lastReminderAt !== null),
    };
  }
  return { ...base, state: "da_chiedere", blocked: toAsk === 0 };
}

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));

/**
 * Che cosa resta: un pezzo per ogni gruppo non ricevuto con almeno un'esigenza, nell'ordine degli
 * stati (senza risposta, in attesa, da chiedere, bloccate), così il primo dice lo stato della
 * testata e ricevute più pezzi fanno il totale. Le bloccate da sole «1 da chiedere, bloccata»;
 * accanto ad altre, «1 bloccata». null quando non resta niente.
 */
function infoNext(p: InfoProgress): string | null {
  const n = INFO_PROGRESS_TEXT.next;
  if (p.state === "complete") return p.total === 1 ? n.oneDone : n.allDone;
  const pieces: string[] = [];
  if (p.unanswered > 0) pieces.push(fill(n.unanswered, { n: p.unanswered }));
  if (p.waiting > 0) pieces.push(fill(n.waiting, { n: p.waiting }));
  if (p.toAsk > 0) pieces.push(fill(n.toAsk, { n: p.toAsk }));
  if (p.blockedCount > 0) {
    const alone = pieces.length === 0;
    pieces.push(p.blockedCount === 1 ? (alone ? n.blockedOne : n.blockedShortOne) : fill(alone ? n.blockedMany : n.blockedShortMany, { n: p.blockedCount }));
  }
  return pieces.length ? pieces.join(n.separator) : null;
}

/** I testi di §P2.8.2 per uno stato; null quando non c'è niente da mostrare. */
export function infoProgressView(p: InfoProgress | null): InfoProgressView | null {
  if (!p) return null;
  const t = INFO_PROGRESS_TEXT;
  const texts = t.states[p.state];
  const count = p.total === 0 ? t.count.none : p.total === 1 ? fill(t.count.one, { received: p.received }) : fill(t.count.many, { received: p.received, total: p.total });
  const next = p.total === 0 ? null : infoNext(p);
  const receivedNote = p.toVerify > 0 ? fill(t.next.toVerify, { n: p.toVerify }) : null;
  const head = receivedNote ? `${count} (${receivedNote})` : count;
  return {
    state: p.state,
    param: INFO_PROGRESS_PARAM[p.state],
    tone: TONE[p.state],
    chip: texts.chip,
    option: texts.option,
    label: texts.label,
    count,
    receivedNote,
    next,
    line: next ? head + t.next.separator + next : head,
    ariaLabel: texts.label,
    showInRows: INFO_ROW_STATES.includes(p.state),
    received: p.received,
    total: p.total,
  };
}
