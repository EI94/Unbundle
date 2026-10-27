/**
 * La campanella della barra in alto, per persona (SPEC §P2.3.2, §P2.5): il contratto unico tra chi
 * legge i dati (`bell-data.ts`), le action, la rotta `/api/workspaces/<ws>/bell` e il componente.
 *
 * Tre fonti, in una sola lista:
 * - **segnale**: i `weekly_signals` del workspace che il ruolo vede, con la lettura **per persona**
 *   (`weekly_signal_reads`; `is_read = true` vale per tutti, solo per le righe vecchie);
 * - **dossier**: le notifiche dei casi d'uso (`uc_notifications`, solo Lateral Space), invariate;
 * - **use_case**: le notifiche degli use case per ogni revisore (`use_case_notifications`).
 *
 * Il numero rosso conta le righe **non lette da questa persona** e **più nuove della sua ultima
 * apertura** della campanella (`seenAt`): aprirla lo azzera; le righe non aperte restano evidenziate.
 * Ogni `activityAt` viene dal database, troncato ai millisecondi, e ogni confronto in SQL con un
 * istante rimandato dal client tronca la colonna allo stesso modo.
 *
 * Modulo puro: import relativi `.ts`.
 */
import type { UcBellItem } from "../uc/notify/bell.ts";
import { formatRelativeIt } from "../uc/views/format.ts";
import type { FollowUpReason, UseCaseNotificationKind } from "../db/use-case-hub-referents-ddl.ts";
import { hubSignalHref } from "../use-cases/digest.ts";
import { noticeContextOf, noticeTextOf } from "../use-cases/notices.ts";
import { cosaServeHref } from "../use-cases/referent/contract.ts";

export type BellSource = "segnale" | "dossier" | "use_case";

/**
 * Quello che il client rimanda per segnare letta una riga. `id` è un uuid; per «dossier» l'id più
 * recente di una riga raggruppata. `at` (obbligatorio per «use_case», ignorato altrimenti) è
 * l'`activityAt` che la persona ha visto: una riga raggruppata cresciuta dopo non si segna letta.
 */
export type BellReadRef = { source: "segnale" | "dossier"; id: string } | { source: "use_case"; id: string; at: string };

export interface BellEntry {
  /** "s:<id>" | "uc:<id>" | "n:<id>", unica nel payload. */
  key: string;
  source: BellSource;
  ref: BellReadRef;
  /** Prima riga, per esempio «TJ-0004 · Fatture fornitori». */
  context: string | null;
  title: string;
  description: string | null;
  /** Percorso interno, oppure null (la riga non porta a una pagina). */
  href: string | null;
  /** ISO, ora del database troncata ai millisecondi: quando la riga è cambiata l'ultima volta. */
  activityAt: string;
  /** Già scritto: «14 ott, 09:30» (segnali) oppure «3 ore fa» (dossier e use case). */
  when: string;
  /** Non letta da QUESTA persona. */
  unread: boolean;
}

export interface BellPayload {
  workspaceId: string;
  /** Dalla più recente (activityAt decrescente, poi key), al massimo BELL_MAX_ENTRIES. */
  entries: BellEntry[];
  /** Il numero rosso: righe non lette con activityAt > seenAt (o tutte le non lette senza seenAt). */
  newCount: number;
  /** Righe non lette («Segna tutte come lette»). */
  unreadCount: number;
  /** «Visto fino a» della persona, oppure, senza riga, l'inizio della sua iscrizione; null solo senza utente. */
  seenAt: string | null;
  /** L'activityAt più recente delle righe, oppure null: quello che il client ha mostrato. */
  latestAt: string | null;
  /** La scelta sulle email (R11): si mostra solo a chi ha già chiesto almeno una volta. */
  emailAlerts: { shown: boolean; on: boolean };
  /** Ora dell'applicazione presa PRIMA della prima lettura: il client tiene il payload più nuovo. */
  generatedAt: string;
}

export const BELL_MAX_ENTRIES = 40;
export const BELL_SIGNALS_LIMIT = 30;
export const BELL_DOSSIER_LIMIT = 20;
export const BELL_USE_CASE_LIMIT = 30;
export const BELL_USE_CASE_DAYS = 60;
/** Quanto aspetta un clic la scrittura della lettura (POST) prima di navigare comunque. */
export const BELL_READ_WAIT_MS = 1200;
export const bellApiPath = (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}/bell`;

/** Corpo della POST su bellApiPath. */
export type BellWriteBody = { op: "seen" } | { op: "read"; ref: BellReadRef };
export type BellWriteResult =
  | { ok: true; seenAt: string | null }
  | { ok: false; code: "non_autenticato" | "non_disponibile" | "dati_non_validi" | "riprova"; message: string };

export interface BellTexts {
  title: string;
  ariaNone: string;
  ariaOne: string;
  ariaMany: string;
  unreadSr: string;
  readAll: string;
  empty: string;
  refreshFailed: string;
  emailAlerts: string;
  errors: { readOne: string; readAll: string; preference: string; session: string; unavailable: string };
}

export const BELL_TEXT: Readonly<BellTexts> = Object.freeze({
  title: "Notifiche",
  ariaNone: "Notifiche",
  ariaOne: "Notifiche, 1 nuova",
  ariaMany: "Notifiche, {n} nuove",
  unreadSr: "Non letta",
  readAll: "Segna tutte come lette",
  empty: "Nessuna notifica.",
  refreshFailed: "Non riesco ad aggiornare le notifiche.",
  emailAlerts: "Avvisami per email sulle novità delle mie richieste al referente",
  errors: Object.freeze({
    readOne: "Non riesco a segnarla come letta. Riprova.",
    readAll: "Non riesco a segnarle come lette. Riprova.",
    preference: "Non riesco a salvare la scelta. Riprova.",
    session: "Accedi di nuovo per continuare.",
    unavailable: "Notifiche non disponibili.",
  }),
});

/** Il testo del pallino rosso: niente con 0, «1»…«9», «9+» da 10. */
export function bellBadgeText(newCount: number): string | null {
  if (!Number.isFinite(newCount) || newCount <= 0) return null;
  return newCount >= 10 ? "9+" : String(Math.floor(newCount));
}

/** Il nome accessibile del pulsante: «Notifiche», «Notifiche, 1 nuova», «Notifiche, {n} nuove». */
export function bellAriaLabel(newCount: number): string {
  if (!Number.isFinite(newCount) || newCount <= 0) return BELL_TEXT.ariaNone;
  return newCount === 1 ? BELL_TEXT.ariaOne : BELL_TEXT.ariaMany.replace("{n}", String(Math.floor(newCount)));
}

/** La riga conta nel numero rosso: non letta e più nuova di `seenAt` (senza seenAt, ogni non letta). */
export function isNewEntry(e: Pick<BellEntry, "unread" | "activityAt">, seenAt: string | null): boolean {
  if (!e.unread) return false;
  if (seenAt === null) return true;
  return Date.parse(e.activityAt) > Date.parse(seenAt);
}

/** Il più tardo di due istanti ISO, accettando null. */
export function laterIso(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? null : b;
  if (Number.isNaN(tb)) return a;
  return tb > ta ? b : a;
}

/** ISO troncato ai millisecondi (un Date di JavaScript lo è già). */
function iso(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

export interface BellSignalInput {
  id: string;
  title: string;
  description: string | null;
  signalType: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: Date | string;
  read: boolean;
}

export interface BellUseCaseInput {
  id: string;
  useCaseId: string;
  code: string | null;
  title: string;
  kind: UseCaseNotificationKind;
  answers: number;
  unknowns: number;
  documents: number;
  followUp: FollowUpReason | null;
  lastEventAt: Date;
  readAt: Date | null;
}

/**
 * Dove porta un segnale (le regole di oggi di `workspace-topbar.tsx`, spostate qui). Con l'area
 * «Use case» accesa un nuovo use case apre la sua scheda e i riepiloghi dell'area la loro vista;
 * spenta, solo il nuovo contributo, verso la pagina di revisione.
 */
export function signalHref(
  workspaceId: string,
  s: Pick<BellSignalInput, "signalType" | "relatedEntityType" | "relatedEntityId">,
  useCaseHub: boolean,
): string | null {
  if (s.signalType === "new_portfolio_item" && s.relatedEntityType === "use_case" && s.relatedEntityId) {
    const id = encodeURIComponent(s.relatedEntityId);
    return useCaseHub ? `/dashboard/${workspaceId}/use-cases/${id}` : `/dashboard/${workspaceId}/portfolio/review/${id}`;
  }
  return useCaseHub ? hubSignalHref(workspaceId, s.signalType) : null;
}

/** La data di un segnale in `it-IT`, a Roma («14 ott, 09:30»): la stessa sul server e nel browser. */
const SIGNAL_DATE = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });

export function signalEntry(workspaceId: string, s: BellSignalInput, useCaseHub: boolean): BellEntry {
  const activityAt = iso(s.createdAt);
  return {
    key: `s:${s.id}`,
    source: "segnale",
    ref: { source: "segnale", id: s.id },
    context: null,
    title: s.title,
    description: s.description,
    href: signalHref(workspaceId, s, useCaseHub),
    activityAt,
    when: SIGNAL_DATE.format(new Date(activityAt)),
    unread: !s.read,
  };
}

/** Una riga dei dossier: i testi di oggi (`uc/notify/bell.ts`), con «Casi d'uso» solo ad area spenta. */
export function dossierEntry(item: UcBellItem, useCaseHub: boolean): BellEntry {
  return {
    key: `uc:${item.id}`,
    source: "dossier",
    ref: { source: "dossier", id: item.id },
    context: item.context ?? (useCaseHub ? null : "Casi d'uso"),
    title: item.title,
    description: item.description,
    href: item.href,
    activityAt: iso(item.createdAt),
    when: item.when,
    unread: true,
  };
}

/** Una notifica di use case: codice e titolo, cosa è successo, i conteggi; porta a «Cosa serve». */
export function noticeEntry(workspaceId: string, n: BellUseCaseInput, now: Date): BellEntry {
  const activityAt = iso(n.lastEventAt);
  const text = noticeTextOf(n);
  return {
    key: `n:${n.id}`,
    source: "use_case",
    ref: { source: "use_case", id: n.id, at: activityAt },
    context: noticeContextOf(n.code, n.title),
    title: text.title,
    description: text.description,
    href: cosaServeHref(workspaceId, n.useCaseId),
    activityAt,
    when: formatRelativeIt(n.lastEventAt, now) ?? "",
    unread: n.readAt === null,
  };
}

function byActivity(a: BellEntry, b: BellEntry): number {
  const diff = Date.parse(b.activityAt) - Date.parse(a.activityAt);
  if (diff !== 0) return diff;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Ordina, taglia a BELL_MAX_ENTRIES e solo dopo conta: il numero corrisponde sempre alle righe che si vedono. */
export function mergeBell(i: {
  workspaceId: string;
  signals: readonly BellEntry[];
  dossier: readonly BellEntry[];
  useCase: readonly BellEntry[];
  seenAt: Date | null;
  emailAlerts: BellPayload["emailAlerts"];
  now: Date;
}): BellPayload {
  const seen = new Set<string>();
  const all = [...i.signals, ...i.dossier, ...i.useCase].filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
  const entries = all.sort(byActivity).slice(0, BELL_MAX_ENTRIES);
  const seenAt = i.seenAt && !Number.isNaN(i.seenAt.getTime()) ? i.seenAt.toISOString() : null;
  let latestAt: string | null = null;
  for (const e of entries) latestAt = laterIso(latestAt, e.activityAt);
  return {
    workspaceId: i.workspaceId,
    entries,
    newCount: entries.filter((e) => isNewEntry(e, seenAt)).length,
    unreadCount: entries.filter((e) => e.unread).length,
    seenAt,
    latestAt,
    emailAlerts: { shown: i.emailAlerts.shown, on: i.emailAlerts.on },
    generatedAt: i.now.toISOString(),
  };
}

export function emptyBellPayload(workspaceId: string, now: Date): BellPayload {
  return mergeBell({ workspaceId, signals: [], dossier: [], useCase: [], seenAt: null, emailAlerts: { shown: false, on: true }, now });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const SOURCES: readonly BellSource[] = ["segnale", "dossier", "use_case"];
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function parseIso(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 40 || !ISO_INSTANT.test(raw)) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Il riferimento di una riga dal client; null per qualunque altra cosa. */
export function parseBellReadRef(raw: unknown): BellReadRef | null {
  if (!isRecord(raw)) return null;
  const { source, id } = raw;
  if (typeof source !== "string" || !(SOURCES as readonly string[]).includes(source)) return null;
  if (typeof id !== "string" || !UUID.test(id)) return null;
  const clean = id.toLowerCase();
  if (source === "use_case") {
    const at = parseIso(raw.at);
    return at ? { source: "use_case", id: clean, at } : null;
  }
  return { source: source as "segnale" | "dossier", id: clean };
}

/** Il corpo della POST: «seen» (nessun'altra chiave) oppure «read» con il riferimento. */
export function parseBellWriteBody(raw: unknown): BellWriteBody | null {
  if (!isRecord(raw)) return null;
  if (raw.op === "seen") return Object.keys(raw).length === 1 ? { op: "seen" } : null;
  if (raw.op === "read") {
    if (Object.keys(raw).some((key) => key !== "op" && key !== "ref")) return null;
    const ref = parseBellReadRef(raw.ref);
    return ref ? { op: "read", ref } : null;
  }
  return null;
}

/** «Fino a» di «Segna tutte come lette»: un istante ISO, altrimenti null (la SQL lo limita a now()). */
export function parseUpTo(raw: unknown): Date | null {
  const at = parseIso(raw);
  return at ? new Date(at) : null;
}
