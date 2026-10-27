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
 * Modulo puro: import relativi `.ts`.
 */
import type { ReferentItemState, ReferentRequestStatus } from "../db/use-case-hub-referents-ddl.ts";
import { romeDate } from "../uc/calendar.ts";
import type { SemaforoColor } from "../uc/vocab.ts";
import type { NeedStatus, NeedView } from "./needs.ts";
import { reviewerStatus } from "./referent/state.ts";
import { referentDateLabel } from "./referent/view.ts";

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
}

export interface InfoProgressView {
  state: InfoProgressState;
  param: string;
  tone: SemaforoColor;
  /** Testo corto per righe e schede: «Info: da verificare». */
  chip: string;
  /** Testo dell'opzione del filtro: «Da verificare». */
  option: string;
  /** Testo lungo per il chip della testata e il riepilogo: «Informazioni: in attesa dal 27/10 · promemoria inviato». */
  label: string;
  /** «2 di 6 informazioni ricevute» oppure «Nessuna informazione serve dal cliente.» */
  count: string;
  /** Una frase sotto il riepilogo, oppure null. Non ripete la data né il promemoria di `label`. */
  hint: string | null;
  /** «Raccolta informazioni: {label}» */
  ariaLabel: string;
  /** state ∈ INFO_ROW_STATES */
  showInRows: boolean;
  received: number;
  total: number;
}

export const INFO_PROGRESS_TEXT = Object.freeze({
  states: Object.freeze({
    da_chiedere: Object.freeze({ chip: "Info: da chiedere", option: "Da chiedere", label: "Informazioni: da chiedere" }),
    in_attesa: Object.freeze({ chip: "Info: in attesa", option: "In attesa", label: "Informazioni: in attesa dal {date}", labelUndated: "Informazioni: in attesa" }),
    da_verificare: Object.freeze({ chip: "Info: da verificare", option: "Da verificare", label: "Informazioni: da verificare" }),
    senza_risposta: Object.freeze({ chip: "Info: senza risposta", option: "Senza risposta", label: "Informazioni: senza risposta" }),
    complete: Object.freeze({ chip: "Info: complete", option: "Complete", label: "Informazioni: complete" }),
  }),
  reminded: " · promemoria inviato",
  count: Object.freeze({ one: "{received} di 1 informazione ricevuta", many: "{received} di {total} informazioni ricevute", none: "Nessuna informazione serve dal cliente." }),
  hints: Object.freeze({
    askReferent: "Usa «Chiedi al referente» per raccoglierle.",
    blocked: "Le informazioni che mancano sono bloccate: sbloccale in «Cosa serve» per chiederle.",
    notAskedOneAdd: "1 domanda non è ancora stata chiesta: usa «Aggiungi domande».",
    notAskedManyAdd: "{n} domande non sono ancora state chieste: usa «Aggiungi domande».",
    notAskedOneAsk: "1 domanda non è ancora stata chiesta: usa «Chiedi al referente».",
    notAskedManyAsk: "{n} domande non sono ancora state chieste: usa «Chiedi al referente».",
    until: "Il link vale fino al {date}.",
    toVerify: "Sono arrivate risposte o documenti: per ognuno scegli A posto, Risposta parziale o Manca il dato.",
    silentLastReminder: "Nessuna risposta dopo l'ultimo promemoria. Puoi chiedere di nuovo o chiedere a un'altra persona.",
    silentExpired: "Il link è scaduto senza risposta. Puoi chiedere di nuovo o chiedere a un'altra persona.",
    complete: "Ci sono tutte le informazioni che servono dal cliente.",
  }),
  summaryHeading: "Raccolta informazioni",
  chipAria: "Raccolta informazioni: {label}",
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
  const base = { since: null, reminded: false, until: null, silentReason: null, blocked: false, received, total, toAsk };
  if (needs.every((n) => DONE.includes(n.status))) return { ...base, state: "complete" };
  if (needs.some((n) => n.status === "in_verifica")) return { ...base, state: "da_verificare" };
  const asked = needs.filter((n) => n.status === "chiesta").map((n) => ({ need: n, ask: latestAsk(asks, n.id) }));
  const silent = asked.filter((x) => x.ask !== null && askIsSilent(x.ask, now));
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

/** I testi di §P2.8.2 per uno stato; null quando non c'è niente da mostrare. */
export function infoProgressView(p: InfoProgress | null, o: { today: string; canAsk: boolean }): InfoProgressView | null {
  if (!p) return null;
  const t = INFO_PROGRESS_TEXT;
  const texts = t.states[p.state];
  let label: string = texts.label;
  if (p.state === "in_attesa") {
    label = p.since ? fill(t.states.in_attesa.label, { date: referentDateLabel(p.since, o.today) }) : t.states.in_attesa.labelUndated;
    if (p.since && p.reminded) label += t.reminded;
  }
  const count = p.total === 0 ? t.count.none : p.total === 1 ? fill(t.count.one, { received: p.received }) : fill(t.count.many, { received: p.received, total: p.total });
  let hint: string | null = null;
  switch (p.state) {
    case "da_chiedere":
      hint = p.blocked ? t.hints.blocked : o.canAsk ? t.hints.askReferent : null;
      break;
    case "in_attesa":
      if (p.toAsk > 0 && o.canAsk) {
        const dated = p.since !== null;
        hint = p.toAsk === 1 ? (dated ? t.hints.notAskedOneAdd : t.hints.notAskedOneAsk) : fill(dated ? t.hints.notAskedManyAdd : t.hints.notAskedManyAsk, { n: p.toAsk });
      } else if (p.until) {
        hint = fill(t.hints.until, { date: referentDateLabel(p.until, o.today) });
      }
      break;
    case "da_verificare":
      hint = t.hints.toVerify;
      break;
    case "senza_risposta":
      hint = p.silentReason === "scaduta" ? t.hints.silentExpired : t.hints.silentLastReminder;
      break;
    case "complete":
      hint = t.hints.complete;
      break;
  }
  return {
    state: p.state,
    param: INFO_PROGRESS_PARAM[p.state],
    tone: TONE[p.state],
    chip: texts.chip,
    option: texts.option,
    label,
    count,
    hint,
    ariaLabel: fill(t.chipAria, { label }),
    showInRows: INFO_ROW_STATES.includes(p.state),
    received: p.received,
    total: p.total,
  };
}
