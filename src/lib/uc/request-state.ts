/**
 * Richieste ai referenti: stati, ciclo di vita del link, deleghe e tempo
 * stimato (PIANO §2.3 tabella 9, §3.11, D42, b30, b33).
 *
 * Il predicato SQL unico sta in `sql/requests.ts` (`uc_request_live` /
 * `uc_request_visible`, con l'orologio del database). Qui c'è la sua copia
 * pura per i test e per l'interfaccia: le due vanno tenute uguali.
 *
 * Stati delle voci nella richiesta (`uc_request_items.state`):
 * - `da_fare`: la voce aspetta la risposta del referente (anche dopo l'invio);
 * - `bozza`: il referente ha salvato una bozza;
 * - `inviata`: il referente ha inviato la risposta (resta attiva per chiarimenti
 *   e nuove versioni);
 * - `delegata`, `non_so`, `riassegnata`: la voce è uscita dal link.
 * Una richiesta è completata quando non ha più voci `da_fare` o `bozza`.
 *
 * Modulo puro: import relativi `.ts`, nessun accesso a DB o ambiente.
 */
import { emailDomain } from "./lateral-space.ts";
import { fail, ok, type Result } from "./types.ts";
import {
  ACTIVE_REQUEST_ITEM_STATES,
  LIVE_REQUEST_STATUSES,
  type CaseStatus,
  type RequestItemState,
  type RequestStatus,
  type ResponseType,
} from "./vocab.ts";
import { REQUEST_LINK_TTL_DAYS } from "./sql/requests.ts";

const DAY_MS = 86_400_000;

/** Profondità massima delle deleghe (referente → collega → collega). */
export const MAX_DELEGATION_DEPTH = 2;
/** Deleghe al giorno per richiesta. */
export const MAX_DELEGATIONS_PER_DAY = 5;
/** Minuti stimati per voce quando il modulo non ha una stima. */
export const DEFAULT_MINUTES_PER_ITEM = 2;

// ── Stati della richiesta ─────────────────────────────────────────────

export const REQUEST_TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  bozza: ["inviata", "revocata"],
  inviata: ["aperta", "in_corso", "completata", "scaduta", "revocata"],
  aperta: ["in_corso", "completata", "scaduta", "revocata"],
  in_corso: ["completata", "scaduta", "revocata"],
  completata: ["in_corso", "scaduta", "revocata"],
  scaduta: [],
  revocata: [],
};

/**
 * Cosa è successo alla richiesta.
 * - `inviata`: primo invio (email o «Copia link»).
 * - `aperta`: primo POST «apertura» dal link (mai su GET).
 * - `in_corso`: bozza o risposta salvata con voci ancora da fare, oppure una voce
 *   torna da fare (chiarimento).
 * - `completata`: nessuna voce `da_fare` o `bozza`.
 * - `scaduta`: `expires_at` passato.
 * - `revocata`: revoca singola, in blocco o chiusura del caso.
 */
export type RequestEvent = "inviata" | "aperta" | "in_corso" | "completata" | "scaduta" | "revocata";

export interface RequestSnapshot {
  status: RequestStatus;
  expiresAt: Date | null;
}

/**
 * Prossimo stato della richiesta. Un evento che non cambia nulla (es. una
 * seconda apertura) non è un errore: `changed = false`.
 */
export function nextRequestStatus(
  req: RequestSnapshot,
  event: RequestEvent,
  now: Date = new Date(),
): Result<{ status: RequestStatus; changed: boolean }> {
  const s = req.status;
  const same = () => ok({ status: s, changed: false });
  const to = (status: RequestStatus) => ok({ status, changed: true });
  if (s === "revocata" || s === "scaduta") {
    return fail("richiesta_chiusa", "Questo link non è più valido. Chiedi a chi te l'ha mandato un link nuovo.");
  }
  switch (event) {
    case "inviata":
      if (s === "bozza") return to("inviata");
      return fail("gia_inviata", "La richiesta è già stata inviata.");
    case "aperta":
      if (s === "bozza") return fail("non_inviata", "La richiesta non è ancora stata inviata.");
      return s === "inviata" ? to("aperta") : same();
    case "in_corso":
      if (s === "bozza") return fail("non_inviata", "La richiesta non è ancora stata inviata.");
      return s === "in_corso" ? same() : to("in_corso");
    case "completata":
      if (s === "bozza") return fail("non_inviata", "La richiesta non è ancora stata inviata.");
      return s === "completata" ? same() : to("completata");
    case "scaduta":
      if (s === "bozza") return fail("non_inviata", "Una bozza non scade: non è mai stata inviata.");
      if (!req.expiresAt || req.expiresAt.getTime() > now.getTime()) return fail("non_scaduta", "Il link non è ancora scaduto.");
      return to("scaduta");
    case "revocata":
      return to("revocata");
  }
}

/** Stato dopo una bozza o una risposta: completata se non resta nulla da fare. */
export function statusAfterActivity(req: RequestSnapshot, openItemCount: number): Result<{ status: RequestStatus; changed: boolean }> {
  if (!Number.isInteger(openItemCount) || openItemCount < 0) throw new Error("Numero di voci aperte non valido");
  return nextRequestStatus(req, openItemCount === 0 ? "completata" : "in_corso");
}

/** Voci che contano come «ancora da fare» per il completamento. */
export function isOpenRequestItem(state: RequestItemState): boolean {
  return state === "da_fare" || state === "bozza";
}

/** Voci che contano come «richiesta attiva» della voce (al massimo una per voce). */
export function isActiveRequestItem(state: RequestItemState): boolean {
  return (ACTIVE_REQUEST_ITEM_STATES as readonly string[]).includes(state);
}

// ── Stati delle voci nella richiesta ──────────────────────────────────

export const REQUEST_ITEM_TRANSITIONS: Readonly<Record<RequestItemState, readonly RequestItemState[]>> = {
  da_fare: ["bozza", "inviata", "delegata", "non_so", "riassegnata"],
  bozza: ["bozza", "inviata", "delegata", "non_so", "riassegnata"],
  // Dopo la risposta: nuova bozza o nuova versione, oppure di nuovo da fare (chiarimento).
  inviata: ["bozza", "inviata", "da_fare", "riassegnata"],
  // «Non lo so» non chiude il link: una risposta tardiva resta possibile.
  non_so: ["bozza", "inviata", "riassegnata"],
  delegata: [],
  riassegnata: [],
};

export function isAllowedRequestItemTransition(from: RequestItemState, to: RequestItemState): boolean {
  return REQUEST_ITEM_TRANSITIONS[from].includes(to);
}

// ── Link: validità, scadenza, proroga ─────────────────────────────────

export interface RequestLinkState {
  status: RequestStatus;
  revokedAt: Date | null;
  expiresAt: Date | null;
  shareEpoch: number;
}

export interface CaseLinkState {
  status: CaseStatus;
  shareEpoch: number;
  setupCompletedAt: Date | null;
}

function baseLive(r: RequestLinkState, c: CaseLinkState, now: Date): boolean {
  return (
    (LIVE_REQUEST_STATUSES as readonly string[]).includes(r.status) &&
    r.revokedAt === null &&
    r.expiresAt !== null &&
    r.expiresAt.getTime() > now.getTime() &&
    r.shareEpoch === c.shareEpoch &&
    c.setupCompletedAt !== null
  );
}

/** Copia pura di `uc_request_live`: il link vale e si può scrivere. */
export function isRequestLive(r: RequestLinkState, c: CaseLinkState, now: Date): boolean {
  return baseLive(r, c, now) && c.status !== "chiuso" && c.status !== "sospeso";
}

/** Copia pura di `uc_request_visible`: il link si apre, in sola lettura se il caso è sospeso. */
export function isRequestVisible(r: RequestLinkState, c: CaseLinkState, now: Date): boolean {
  return baseLive(r, c, now) && c.status !== "chiuso";
}

/** Cosa mostra `/r/[token]`: scheda generica, sola lettura («Il caso è in pausa») o pagina scrivibile. */
export function requestLinkAccess(
  r: RequestLinkState,
  c: CaseLinkState,
  now: Date,
  tokenRevoked = false,
): "scrivibile" | "sola_lettura" | "non_valido" {
  if (tokenRevoked) return "non_valido";
  if (isRequestLive(r, c, now)) return "scrivibile";
  if (isRequestVisible(r, c, now)) return "sola_lettura";
  return "non_valido";
}

/** Scadenza all'invio: `sent_at + 30 giorni`. */
export function expiryOnSend(sentAt: Date): Date {
  return new Date(sentAt.getTime() + REQUEST_LINK_TTL_DAYS * DAY_MS);
}

/**
 * Proroga della scadenza (`extendExpiry`): solo su richieste vive, mai oltre
 * `now + 30 giorni` (la data chiesta viene limitata) e mai indietro.
 */
export function checkExtendExpiry(i: { status: RequestStatus; revokedAt: Date | null; currentExpiresAt: Date | null; requested: Date; now: Date }): Result<{ expiresAt: Date; clamped: boolean }> {
  if (!(LIVE_REQUEST_STATUSES as readonly string[]).includes(i.status) || i.revokedAt !== null) {
    return fail("richiesta_non_viva", "Si può prorogare solo un link ancora valido.");
  }
  if (!i.currentExpiresAt || i.currentExpiresAt.getTime() <= i.now.getTime()) {
    return fail("richiesta_non_viva", "Il link è già scaduto: invia una richiesta nuova.");
  }
  if (Number.isNaN(i.requested.getTime()) || i.requested.getTime() <= i.now.getTime()) {
    return fail("data_non_valida", "Scegli una data futura.");
  }
  const max = i.now.getTime() + REQUEST_LINK_TTL_DAYS * DAY_MS;
  const clamped = i.requested.getTime() > max;
  const expiresAt = new Date(Math.min(i.requested.getTime(), max));
  if (expiresAt.getTime() < i.currentExpiresAt.getTime()) {
    // Limitata al massimo ma già oltre: la scadenza è già al massimo (link appena
    // mandato, orologi di app e database un poco diversi). Resta com'è.
    if (clamped) return ok({ expiresAt: i.currentExpiresAt, clamped });
    return fail("data_non_valida", "La nuova scadenza non può essere prima di quella attuale.");
  }
  return ok({ expiresAt, clamped });
}

// ── Deleghe ───────────────────────────────────────────────────────────

export interface DelegationInput {
  /** `delegation_depth` della richiesta da cui si delega. */
  parentDepth: number;
  /** Deleghe già create oggi da questa richiesta (`uc_rate_limits`). */
  delegationsToday: number;
  delegateEmail: string;
  /** Domini delle email dei contatti già presenti nel caso. */
  caseContactDomains: readonly string[];
  /** Domini di Lateral Space: una delega verso LS si rifiuta (quattro occhi). */
  lsDomains: readonly string[];
  /** Voci da delegare e voci attive della richiesta. */
  itemIds: readonly string[];
  activeItemIds: readonly string[];
}

/**
 * Regole della delega (b33): profondità ≤ 2, ≤ 5 al giorno per richiesta, voci
 * tra quelle attive della richiesta, email valida e non di Lateral Space (chi
 * risponde non deve poter poi validare). Con un dominio che non è tra i contatti
 * del caso la delega resta in bozza finché Lateral Space non la approva.
 */
export function checkDelegation(i: DelegationInput): Result<{ depth: number; needsApproval: boolean }> {
  const depth = i.parentDepth + 1;
  if (!Number.isInteger(i.parentDepth) || i.parentDepth < 0) throw new Error("Profondità non valida");
  if (depth > MAX_DELEGATION_DEPTH) {
    return fail("delega_troppo_profonda", "Questa domanda è già stata girata due volte: chiedi a Lateral Space di riassegnarla.");
  }
  if (i.delegationsToday >= MAX_DELEGATIONS_PER_DAY) {
    return fail("troppe_deleghe", "Hai già chiesto a molti colleghi oggi. Riprova domani o scrivi a Lateral Space.");
  }
  const domain = emailDomain(i.delegateEmail);
  if (!domain) return fail("email_non_valida", "Controlla l'indirizzo email del collega.");
  if (i.lsDomains.includes(domain)) {
    return fail("delega_a_lateral_space", "Non si può girare una domanda a Lateral Space: chiedi a un collega della tua azienda.");
  }
  if (i.itemIds.length === 0) return fail("nessuna_voce", "Scegli almeno una domanda da girare.");
  const active = new Set(i.activeItemIds);
  if (new Set(i.itemIds).size !== i.itemIds.length || i.itemIds.some((id) => !active.has(id))) {
    return fail("voce_non_della_richiesta", "Puoi girare solo le domande di questo link ancora aperte.");
  }
  return ok({ depth, needsApproval: !i.caseContactDomains.map((d) => d.toLowerCase()).includes(domain) });
}

// ── Tempo stimato ─────────────────────────────────────────────────────

/**
 * Tipi «pesanti» (DESIGN §4.4 punto 3): vanno in fondo al loro argomento e, al
 * telefono, anche in «Meglio dal computer».
 */
export const HEAVY_RESPONSE_TYPES = ["tabella", "file", "dataset", "collegamento_sistema", "caso_prova"] as const satisfies readonly ResponseType[];

export function isHeavyResponseType(type: ResponseType | null | undefined): boolean {
  return type !== null && type !== undefined && (HEAVY_RESPONSE_TYPES as readonly string[]).includes(type);
}

const HALF_MINUTE_TYPES: readonly ResponseType[] = ["si_no", "scelta"];
const TWO_MINUTE_TYPES: readonly ResponseType[] = ["testo"];

/**
 * Minuti per domanda, a pesi fissi (DESIGN §4.4 punto 5): mezzo minuto per una
 * conferma con un tocco, un sì/no o una scelta; un minuto per numeri, date,
 * intervalli, codici, scelte multiple e conferme di regole o formule; due per
 * un testo; cinque per i tipi pesanti. Senza tipo valgono i 2 minuti di sempre.
 * Mai calcolati dal comportamento della persona.
 */
export function minutesForQuestion(i: { responseType?: ResponseType | null; oneTap?: boolean }): number {
  if (i.oneTap) return 0.5;
  const type = i.responseType;
  if (type === undefined) return DEFAULT_MINUTES_PER_ITEM;
  if (type === null) return 2;
  if (isHeavyResponseType(type)) return 5;
  if (HALF_MINUTE_TYPES.includes(type)) return 0.5;
  if (TWO_MINUTE_TYPES.includes(type)) return 2;
  return 1;
}

export interface EstimateModule {
  key: string;
  estimatedMinutes: number | null;
  /**
   * Domande dell'argomento nel caso. Con questo numero la stima del modulo si
   * divide in proporzione alle domande della richiesta; senza, vale tutta.
   */
  questionCount?: number | null;
}

export interface EstimateItem {
  moduleKey: string | null;
  responseType?: ResponseType | null;
  /** Conferma di un valore già noto con un tocco. */
  oneTap?: boolean;
}

/**
 * Minuti stimati per il referente (DESIGN §4.4 punto 5).
 * - Argomento con `estimated_minutes` e il numero delle sue domande:
 *   `minuti_argomento × domande_della_richiesta_nell_argomento / domande_dell_argomento`.
 * - Argomento con la stima ma senza quel numero: la stima intera, una volta.
 * - Altrimenti la somma dei pesi fissi di `minutesForQuestion`.
 * Il totale si arrotonda per eccesso al minuto.
 */
export function estimateMinutes(modules: readonly EstimateModule[], items: readonly EstimateItem[]): number {
  const byKey = new Map(modules.map((m) => [m.key, m]));
  const perModule = new Map<string, number>();
  let minutes = 0;
  for (const item of items) {
    const mod = item.moduleKey !== null ? byKey.get(item.moduleKey) : undefined;
    const est = mod?.estimatedMinutes;
    if (mod && typeof est === "number" && est > 0) perModule.set(mod.key, (perModule.get(mod.key) ?? 0) + 1);
    else minutes += minutesForQuestion(item);
  }
  for (const [key, n] of perModule) {
    const mod = byKey.get(key)!;
    const est = mod.estimatedMinutes as number;
    const total = mod.questionCount;
    minutes += typeof total === "number" && total > 0 ? (est * Math.min(n, total)) / total : est;
  }
  return minutes > 0 ? Math.ceil(minutes - 1e-9) : 0;
}

// ── Etichette ─────────────────────────────────────────────────────────

const LS_REQUEST_LABEL: Readonly<Record<RequestStatus, string>> = {
  bozza: "Bozza",
  inviata: "Inviata",
  aperta: "Aperta",
  in_corso: "In corso",
  completata: "Completata",
  scaduta: "Scaduta",
  revocata: "Revocata",
};

/**
 * Etichetta dello stato. Per i ruoli del cliente `inviata`, `aperta` e
 * `in_corso` sono tutti «In attesa» (art. 15.4: anche «aperta» rivela un
 * comportamento della persona).
 */
export function requestStatusLabel(status: RequestStatus, audience: "lateral_space" | "cliente"): string {
  if (audience === "cliente" && (status === "inviata" || status === "aperta" || status === "in_corso")) return "In attesa";
  return LS_REQUEST_LABEL[status];
}
