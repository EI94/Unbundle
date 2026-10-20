/**
 * Coda di verifica (PIANO §5.1, `verifica/`): voci in verifica o parziali a cui
 * l'utente non ha risposto (in nessuna versione) e di cui non ha copiato il
 * link, in ordine di arrivo della risposta. Per ognuna: valore (secondo la
 * visibilità), provenienza, controlli automatici in evidenza ed esito
 * anticipato di «Valida» con le stesse guardie del comando (`canValidate`).
 *
 * Modulo puro.
 */
import { canValidate } from "../permissions.ts";
import { rowBool, rowIsoDate, rowJson, rowString, rowVocab, type Row } from "../sql/readiness.ts";
import type { LoadedItem } from "../sql/transitions.ts";
import type { UserContext } from "../types.ts";
import { CONFIDENCE, VALIDATION_OUTCOMES, VALUE_VISIBILITY, type CaseRole, type ItemKind, type ItemStatus, type Priority } from "../vocab.ts";
import { answerValueView, formatCountIt, formatDateIt, formatDateTimeIt, provenanceText, type ValueView } from "./format.ts";
import { ANSWER_KIND_LABEL, CONFIDENCE_LABEL } from "./labels.ts";

export interface QueueCheck {
  checkKey: string;
  outcome: "ok" | "avviso" | "errore";
  message: string;
}

export interface QueueEntry {
  id: string;
  key: string;
  kind: ItemKind;
  title: string;
  status: ItemStatus;
  statusReason: string | null;
  priority: Priority | null;
  answerKind: string | null;
  provenance: string | null;
  declared: boolean;
  value: ValueView;
  confidence: string | null;
  validFrom: string | null;
  /** Chi ha risposto: solo per Lateral Space (la coda è solo loro). */
  responder: string | null;
  roleLabel: string | null;
  arrivedAt: string | null;
  checks: QueueCheck[];
  /** «Valida» si può fare adesso? Altrimenti il motivo. */
  validate: { ok: true } | { ok: false; message: string };
  openClarification: boolean;
}

/** Voci per pagina della coda di verifica: una coda lunga non si disegna tutta. */
export const VERIFICATION_PAGE_SIZE = 50;

/** Pagina della coda (da 1; oltre l'ultima, l'ultima). */
export function queuePage<T>(entries: readonly T[], page: number): { entries: T[]; total: number; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(entries.length / VERIFICATION_PAGE_SIZE));
  const current = Math.min(Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1), pages);
  const start = (current - 1) * VERIFICATION_PAGE_SIZE;
  return { entries: entries.slice(start, start + VERIFICATION_PAGE_SIZE), total: entries.length, page: current, pages };
}

/** L'utente ha risposto o ha copiato il link della risposta: la voce non è sua da verificare. */
export function excludedFromQueue(item: LoadedItem, userId: string): boolean {
  const s = item.snapshot;
  return s.answerResponderUserIds.includes(userId) || s.currentAnswer?.responderUserId === userId || s.currentAnswerTokenIssuerUserIds.includes(userId);
}

export function buildQueue(i: {
  items: readonly LoadedItem[];
  answers: readonly Row[];
  checks: readonly Row[];
  user: UserContext;
  roles: readonly CaseRole[];
  roleLabels: Readonly<Record<string, string>>;
}): { entries: QueueEntry[]; excludedMine: number } {
  const answers = new Map(i.answers.map((r) => [String(r.item_id), r]));
  const checks = new Map<string, QueueCheck[]>();
  for (const r of i.checks) {
    const id = String(r.item_id);
    const list = checks.get(id) ?? [];
    list.push({ checkKey: String(r.check_key), outcome: rowVocab(VALIDATION_OUTCOMES, r.outcome) ?? "avviso", message: rowString(r.message) ?? "" });
    checks.set(id, list);
  }
  let excludedMine = 0;
  const entries: { sortAt: number; entry: QueueEntry }[] = [];
  for (const item of i.items) {
    const s = item.snapshot;
    if (s.status !== "in_verifica" && s.status !== "parziale") continue;
    if (excludedFromQueue(item, i.user.userId)) {
      excludedMine++;
      continue;
    }
    const a = answers.get(s.id);
    const value = a
      ? answerValueView({
          value: rowJson(a.value),
          encrypted: rowBool(a.encrypted),
          erased: rowBool(a.erased),
          privacyClass: s.privacyClass,
          valueVisibility: rowVocab(VALUE_VISIBILITY, item.extra.valueVisibility) ?? "owner_e_ls",
          roles: i.roles,
        })
      : ({ kind: "none" } as const);
    const confidence = a ? rowVocab(CONFIDENCE, a.confidence) : null;
    const actingRole = a ? rowString(a.acting_role_key) : null;
    const check = canValidate(s, i.user.userId, i.roles, i.user);
    entries.push({
      sortAt: s.currentAnswer?.createdAt.getTime() ?? Number.MAX_SAFE_INTEGER,
      entry: {
        id: s.id,
        key: s.key,
        kind: s.kind,
        title: item.extra.title,
        status: s.status,
        statusReason: item.extra.statusReason,
        priority: s.priority,
        answerKind: s.currentAnswer ? ANSWER_KIND_LABEL[s.currentAnswer.kind] : null,
        provenance: s.currentAnswer ? provenanceText(s.currentAnswer.sourceKind, a ? rowString(a.source_ref) : null) : null,
        declared: s.currentAnswer?.sourceKind === "dichiarato_in_call",
        value,
        confidence: confidence ? CONFIDENCE_LABEL[confidence] : null,
        validFrom: formatDateIt(a ? rowIsoDate(a.valid_from) : null),
        responder: a ? rowString(a.responder_contact_name) : null,
        roleLabel: actingRole ? (i.roleLabels[actingRole] ?? actingRole) : null,
        arrivedAt: s.currentAnswer ? formatDateTimeIt(s.currentAnswer.createdAt) : null,
        checks: checks.get(s.id) ?? [],
        validate: check.ok ? { ok: true } : { ok: false, message: check.message },
        openClarification: s.openClarification,
      },
    });
  }
  entries.sort((a, b) => a.sortAt - b.sortAt || a.entry.key.localeCompare(b.entry.key));
  return { entries: entries.map((e) => e.entry), excludedMine };
}

// ── Verifica una alla volta (DESIGN §3.6.4) ───────────────────────────

/** La coda da `reviewQueueSql`: gli id nell'ordine (dalla risposta più vecchia) e quante sono di chi guarda. */
export function rowsToReviewQueue(rows: readonly Row[]): { ids: string[]; mine: number } {
  const ids: string[] = [];
  let mine = 0;
  for (const r of rows) {
    if (rowBool(r.mine)) mine++;
    else ids.push(String(r.id));
  }
  return { ids, mine };
}

export interface ReviewPosition {
  /** La scheda aperta; null a coda vuota. */
  currentId: string | null;
  /** Da 1. */
  index: number;
  total: number;
  prevId: string | null;
  nextId: string | null;
}

/**
 * Dove si è nella coda: la scheda chiesta (`?voce=`) se c'è ancora. Se non
 * c'è più (l'ha verificata un collega nel frattempo), la scheda che adesso sta
 * al posto atteso (`?posto=`, da 1), cioè quella che la seguiva; senza posto,
 * la prima.
 */
export function reviewPosition(ids: readonly string[], requested: string | null, slot: number | null = null): ReviewPosition {
  if (ids.length === 0) return { currentId: null, index: 0, total: 0, prevId: null, nextId: null };
  const want = requested?.toLowerCase() ?? null;
  const at = want ? ids.findIndex((id) => id.toLowerCase() === want) : -1;
  const i = at >= 0 ? at : slot !== null && Number.isInteger(slot) && slot >= 1 ? Math.min(slot, ids.length) - 1 : 0;
  return { currentId: ids[i], index: i + 1, total: ids.length, prevId: i > 0 ? ids[i - 1] : null, nextId: i + 1 < ids.length ? ids[i + 1] : null };
}

/** `?posto=` dall'URL: un intero da 1, altrimenti null. */
export function parseReviewSlot(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== "string" || !/^\d{1,5}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? n : null;
}

/**
 * Dove va la verifica, come indirizzo: la scheda e il posto in cui la si
 * aspetta nella coda di quel momento. Dopo un'azione la scheda fatta esce
 * dalla coda: la successiva prende il suo posto (`done`). Con «Salta» o le
 * frecce la coda non cambia: il posto è quello della scheda. Così, se un
 * collega ha già verificato la scheda attesa, si apre quella che la seguiva e
 * non si torna alla prima.
 */
export function reviewHref(baseHref: string, position: ReviewPosition, to: "next" | "prev" | "done"): string {
  const id = to === "prev" ? position.prevId : position.nextId;
  if (!id) return baseHref;
  const slot = to === "prev" ? position.index - 1 : to === "next" ? position.index + 1 : position.index;
  return `${baseHref}?voce=${id}&posto=${slot}`;
}

export type ReviewKeyAction = "validate" | "clarify" | "next" | "prev";

/**
 * Tasti rapidi (§3.6.4): V valida, C chiarimento, → salta, ← indietro. Mai
 * mentre si scrive in un campo o con un tasto modificatore.
 */
export function reviewKeyAction(e: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; typing: boolean }): ReviewKeyAction | null {
  if (e.typing || e.altKey || e.ctrlKey || e.metaKey) return null;
  switch (e.key) {
    case "v":
    case "V":
      return "validate";
    case "c":
    case "C":
      return "clarify";
    case "ArrowRight":
      return "next";
    case "ArrowLeft":
      return "prev";
    default:
      return null;
  }
}

/** «12 risposte non sono qui perché le hai date tu: le verifica un collega.» */
export function mineExcludedText(n: number, where: "elenco" | "fine"): string | null {
  if (n <= 0) return null;
  const answers = n === 1 ? "1 risposta" : `${formatCountIt(n)} risposte`;
  if (where === "fine") return `${answers} ${n === 1 ? "l'hai data" : "le hai date"} tu: ${n === 1 ? "la verifica" : "le verifica"} un collega.`;
  return `${answers} non ${n === 1 ? "è qui perché l'hai data" : "sono qui perché le hai date"} tu: ${n === 1 ? "la verifica" : "le verifica"} un collega.`;
}
