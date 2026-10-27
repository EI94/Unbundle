/**
 * Lo stato della campanella nel browser (SPEC §P2.5.2), senza React: il riduttore, che cosa mostra il
 * menu e la sequenza di un clic su una riga. Lo prova `notifications-bell-state.test.ts`, gare comprese.
 *
 * Tre regole tengono fermo quello che la persona ha già visto o fatto, anche quando arriva un payload
 * letto un attimo prima della sua scrittura:
 * - **numero rosso**: aprire la campanella lo azzera subito (`seenOverride` = l'ultima riga mostrata);
 *   torna solo per righe più nuove del «visto fino a» del server o di quello locale, il più tardo;
 * - **riga cliccata**: resta letta finché un payload non la dà letta, non la toglie, o non la mostra
 *   cambiata dopo il clic (una riga raggruppata con una risposta nuova torna non letta, giustamente);
 * - **«Segna tutte come lette»**: tutte le righe fino all'ultima mostrata restano lette finché un
 *   payload non lo conferma.
 *
 * Modulo puro: import relativi `.ts`.
 */
import {
  BELL_READ_WAIT_MS,
  BELL_TEXT,
  laterIso,
  type BellEntry,
  type BellPayload,
  type BellReadRef,
  type BellWriteResult,
} from "../../lib/notifications/bell.ts";

export interface BellState {
  payload: BellPayload;
  open: boolean;
  /**
   * Le righe cliccate (chiave → `activityAt` mostrato al clic), lette in locale finché un payload non
   * le dà lette, non le toglie o non le mostra cambiate dopo il clic.
   */
  readKeys: ReadonlyMap<string, string>;
  /** «Visto fino a» locale, mai più vecchio di quello del server: l'ultima riga mostrata all'apertura e ogni `seenAt` di «seen». */
  seenOverride: string | null;
  /** «Segna tutte come lette» fino a questo `activityAt` (il `latestAt` di quel momento), finché un payload non lo conferma. */
  readAllUpTo: string | null;
  error: "aggiornamento" | null;
}

export type BellEvent =
  | { type: "payload"; payload: BellPayload }
  | { type: "open" }
  | { type: "close" }
  | { type: "seen"; seenAt: string }
  | { type: "optimisticRead"; key: string; at?: string }
  | { type: "revertRead"; key: string }
  | { type: "optimisticReadAll" }
  | { type: "revertReadAll"; previous: BellState }
  | { type: "refreshFailed" };

export function initialBellState(payload: BellPayload): BellState {
  return { payload, open: false, readKeys: new Map(), seenOverride: null, readAllUpTo: null, error: null };
}

const time = (iso: string | null): number => (iso === null ? Number.NaN : Date.parse(iso));
/** a ≥ b, con null come «il più vecchio possibile». */
function atLeast(a: string | null, b: string | null): boolean {
  if (b === null) return true;
  if (a === null) return false;
  return time(a) >= time(b);
}

function adopt(s: BellState, payload: BellPayload): BellState {
  if (!atLeast(payload.generatedAt, s.payload.generatedAt)) return s;
  const byKey = new Map(payload.entries.map((entry) => [entry.key, entry]));
  const readKeys = new Map<string, string>();
  for (const [key, at] of s.readKeys) {
    const entry = byKey.get(key);
    // Resta letta in locale solo se il payload la mostra ancora non letta e non cambiata dopo il clic.
    if (entry && entry.unread && !(time(entry.activityAt) > time(at))) readKeys.set(key, at);
  }
  const upTo = s.readAllUpTo;
  const readAllUpTo = upTo !== null && payload.entries.some((entry) => entry.unread && time(entry.activityAt) <= time(upTo)) ? upTo : null;
  const seenOverride = s.seenOverride !== null && atLeast(payload.seenAt, s.seenOverride) ? null : s.seenOverride;
  return { ...s, payload, readKeys, readAllUpTo, seenOverride, error: null };
}

export function bellReducer(s: BellState, e: BellEvent): BellState {
  switch (e.type) {
    case "payload":
      return adopt(s, e.payload);
    case "open":
      return { ...s, open: true, seenOverride: laterIso(s.seenOverride, s.payload.latestAt) };
    case "close":
      return s.open ? { ...s, open: false } : s;
    case "seen":
      return { ...s, seenOverride: laterIso(s.seenOverride, e.seenAt) };
    case "optimisticRead": {
      const at = e.at ?? s.payload.entries.find((entry) => entry.key === e.key)?.activityAt ?? new Date(0).toISOString();
      const readKeys = new Map(s.readKeys);
      readKeys.set(e.key, at);
      return { ...s, readKeys };
    }
    case "revertRead": {
      if (!s.readKeys.has(e.key)) return s;
      const readKeys = new Map(s.readKeys);
      readKeys.delete(e.key);
      return { ...s, readKeys };
    }
    case "optimisticReadAll":
      return { ...s, readAllUpTo: laterIso(s.readAllUpTo, s.payload.latestAt), seenOverride: laterIso(s.seenOverride, s.payload.latestAt) };
    case "revertReadAll":
      return { ...e.previous, payload: atLeast(s.payload.generatedAt, e.previous.payload.generatedAt) ? s.payload : e.previous.payload, open: s.open };
    case "refreshFailed":
      return { ...s, error: "aggiornamento" };
  }
}

function locallyUnread(s: BellState, entry: BellEntry): boolean {
  if (!entry.unread) return false;
  if (s.readKeys.has(entry.key)) return false;
  if (s.readAllUpTo !== null && time(entry.activityAt) <= time(s.readAllUpTo)) return false;
  return true;
}

/** Le righe con il «non letta» di adesso (server più quello che la persona ha appena fatto). */
export function visibleEntries(s: BellState): BellEntry[] {
  return s.payload.entries.map((entry) => {
    const unread = locallyUnread(s, entry);
    return unread === entry.unread ? entry : { ...entry, unread };
  });
}

/** Il numero rosso: 0 con il menu aperto; altrimenti le righe non lette più nuove del «visto fino a». */
export function visibleNewCount(s: BellState): number {
  if (s.open) return 0;
  const seen = laterIso(s.seenOverride, s.payload.seenAt);
  return visibleEntries(s).filter((entry) => entry.unread && (seen === null || time(entry.activityAt) > time(seen))).length;
}

export interface BellMenuRow {
  key: string;
  href: string | null;
  unread: boolean;
  context: string | null;
  title: string;
  description: string | null;
  when: string;
}

export interface BellMenuModel {
  rows: BellMenuRow[];
  /** Qualche riga non letta. */
  showReadAll: boolean;
  /** La scelta sulle email (`payload.emailAlerts.shown`). */
  showEmailToggle: boolean;
  emailChecked: boolean;
  /** «Nessuna notifica.» senza righe. */
  emptyText: string | null;
  /** «Non riesco ad aggiornare le notifiche.» sopra le ultime righe. */
  refreshText: string | null;
}

/** Tutto quello che il menu disegna, deciso qui. */
export function bellMenuModel(s: BellState): BellMenuModel {
  const rows = visibleEntries(s).map((entry) => ({
    key: entry.key,
    href: entry.href,
    unread: entry.unread,
    context: entry.context,
    title: entry.title,
    description: entry.description,
    when: entry.when,
  }));
  return {
    rows,
    showReadAll: rows.some((row) => row.unread),
    showEmailToggle: s.payload.emailAlerts.shown,
    emailChecked: s.payload.emailAlerts.on,
    emptyText: rows.length === 0 ? BELL_TEXT.empty : null,
    refreshText: s.error === "aggiornamento" ? BELL_TEXT.refreshFailed : null,
  };
}

export interface RowClickDeps {
  markRead(ref: BellReadRef): Promise<BellWriteResult>;
  push(href: string): void;
  toast(message: string): void;
  dispatch(e: BellEvent): void;
  timeout(ms: number): Promise<"timeout">;
  refetch(): void;
  /**
   * `router.refresh()`: dopo una lettura riuscita senza navigazione (riga senza link, o aperta in
   * un'altra scheda), le altre viste della pagina con lo stesso stato per persona (Intelligence
   * «non letti») si rileggono dal server. Con la navigazione ci pensa la pagina nuova.
   */
  refreshPage?(): void;
}

const READ_FAILED: BellWriteResult = { ok: false, code: "riprova", message: BELL_TEXT.errors.readOne };

/** La scrittura della lettura, che non rifiuta mai: un errore di rete vale «riprova». */
function safeMarkRead(entry: BellEntry, deps: RowClickDeps): Promise<BellWriteResult> {
  try {
    return deps.markRead(entry.ref).catch(() => READ_FAILED);
  } catch {
    return Promise.resolve(READ_FAILED);
  }
}

function applyRead(entry: BellEntry, result: BellWriteResult, deps: RowClickDeps, navigates: boolean): void {
  if (result.ok) {
    deps.refetch();
    if (!navigates) deps.refreshPage?.();
    return;
  }
  deps.dispatch({ type: "revertRead", key: entry.key });
  deps.toast(result.message || BELL_TEXT.errors.readOne);
}

/**
 * Il clic su una riga (`entry` con il «non letta» di adesso, da `visibleEntries`):
 * - clic con un tasto o un modificatore (nuova scheda): il link fa da sé; se la riga è non letta si
 *   segna letta subito e la scrittura parte senza aspettarla;
 * - clic semplice o Invio, letta o no: il menu si chiude; se è non letta si segna letta, si aspetta la
 *   scrittura al massimo BELL_READ_WAIT_MS (il risultato in ritardo vale lo stesso), poi si naviga.
 *   La navigazione aspetta solo la scrittura, mai la rilettura della campanella.
 */
export async function runRowClick(entry: BellEntry, click: { plain: boolean }, deps: RowClickDeps): Promise<void> {
  if (!click.plain) {
    if (!entry.unread) return;
    deps.dispatch({ type: "optimisticRead", key: entry.key, at: entry.activityAt });
    void safeMarkRead(entry, deps).then((result) => applyRead(entry, result, deps, false));
    return;
  }
  deps.dispatch({ type: "close" });
  if (entry.unread) {
    deps.dispatch({ type: "optimisticRead", key: entry.key, at: entry.activityAt });
    const write = safeMarkRead(entry, deps);
    const navigates = Boolean(entry.href);
    const first = await Promise.race([write, deps.timeout(BELL_READ_WAIT_MS)]);
    if (first === "timeout") void write.then((result) => applyRead(entry, result, deps, navigates));
    else applyRead(entry, first, deps, navigates);
  }
  if (entry.href) deps.push(entry.href);
}
