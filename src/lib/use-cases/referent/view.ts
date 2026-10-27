/**
 * «Chiedi al referente»: le proiezioni pure verso la pagina pubblica e verso il pannello dei
 * revisori, e le righe già scritte (SPEC §2.1 `view.ts`, §8).
 *
 * Art. 15.4 (eccezione approvata dal titolare il 27/10/2026, da riportare in docs/use-case/DESIGN.md):
 * nel capitolo «Cosa serve» di una scheda i revisori vedono a chi è stata chiesta un'esigenza e le
 * date («Chiesta a … il …», «Risposta ricevuta il …», «Promemoria inviato il …») e chi ha scritto
 * ogni risposta. Solo lì, solo per quella scheda: mai sommato tra schede o persone, mai ordinato o
 * filtrato per persona, mai trasformato in durate o ritardi. Lo stato «In corso» non esiste: chi
 * ha aperto il link non si vede. Per questo i tipi di ingresso di queste funzioni non hanno
 * l'accettazione dell'informativa né differenze tra date.
 *
 * `toPublicView` è un elenco chiuso (`PUBLIC_VIEW_KEYS`): copia solo i campi del contratto, mai
 * dettaglio, responsabile o stato delle esigenze, mai dati di chi ha proposto, punteggi o note.
 *
 * Modulo puro.
 */
import { parseCivilDate, romeDate } from "../../uc/calendar.ts";
import type { SemaforoColor } from "../../uc/vocab.ts";
import type { ReferentItemState, ReferentRequestStatus } from "../../db/use-case-hub-referents-ddl.ts";
import type { ReferentAskView, ReferentFileView, ReferentQuestionView } from "./contract.ts";
import { REFERENT_PRIVACY_NOTICE, REFERENT_PUBLIC_TEXT, REFERENT_STATUS_LABEL, REFERENT_STATUS_TONE, REFERENT_UI_TEXT, fillText } from "./labels.ts";
import { nextReminderOn } from "./schedule.ts";
import { privacyAccepted, reviewerStatus } from "./state.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function civilOf(at: Date | string): string | null {
  if (typeof at === "string" && ISO_DATE.test(at)) return at;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : romeDate(d);
}

/** «27/10», oppure «27/10/2025» in un altro anno (a Roma). */
export function referentDateLabel(at: Date | string, today: string): string {
  const civil = civilOf(at);
  if (!civil) return "";
  const { year, month, day } = parseCivilDate(civil);
  const base = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
  return today.slice(0, 4) === String(year) ? base : `${base}/${year}`;
}

/** «m•••@topjet.it»: la prima lettera, poi •••, poi @dominio; null senza email. */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const clean = email.trim().toLowerCase();
  const at = clean.lastIndexOf("@");
  if (at < 1 || at === clean.length - 1) return null;
  return `${clean[0]}•••${clean.slice(at)}`;
}

/** Parola e colore dello stato di una richiesta. */
export function requestStatusView(status: ReferentRequestStatus): { label: string; tone: SemaforoColor } {
  return { label: REFERENT_STATUS_LABEL[status], tone: REFERENT_STATUS_TONE[status] };
}

/** Le colonne di una richiesta per le sue righe. Nessun campo dell'informativa, nessuna differenza tra date. */
export interface RequestRowForView {
  status: ReferentRequestStatus;
  createdAt: Date;
  sentAt: Date | null;
  expiresAt: Date;
  lastEmailAt: Date | null;
  lastReminderAt: Date | null;
  reminderCount: number;
  completedAt: Date | null;
  expiredAt: Date | null;
  revokedAt: Date | null;
  openItems: number;
}

/** «Inviata il 27/10 · scade il 26/11», i promemoria, il prossimo promemoria, la fine. */
export function requestLines(r: RequestRowForView, today: string, now: Date): string[] {
  const t = REFERENT_UI_TEXT.requestLines;
  const out: string[] = [];
  const d = (at: Date | string) => referentDateLabel(at, today);
  if (r.sentAt) out.push(fillText(t.sent, { data: d(r.sentAt), scadenza: d(r.expiresAt) }));
  if (r.lastReminderAt) out.push(fillText(r.reminderCount >= 2 ? t.lastReminder : t.reminded, { data: d(r.lastReminderAt) }));
  const status = reviewerStatus(r, now);
  if (status === "inviata") {
    const next = nextReminderOn({ status: r.status, sentAt: r.sentAt, expiresAt: r.expiresAt, revokedAt: r.revokedAt, reminderCount: r.reminderCount, lastEmailAt: r.lastEmailAt, openItems: r.openItems }, now);
    if (next) out.push(fillText(t.nextReminder, { data: d(next) }));
  } else if (status === "completata" && r.completedAt) {
    out.push(fillText(t.completed, { data: d(r.completedAt) }));
  } else if (status === "revocata" && r.revokedAt) {
    out.push(fillText(t.revoked, { data: d(r.revokedAt) }));
  } else if (status === "scaduta") {
    out.push(fillText(t.expired, { data: d(r.expiredAt ?? r.expiresAt) }));
  }
  return out;
}

/** L'ultima richiesta di un'esigenza, per la sua riga. Nessun campo dell'informativa. */
export interface LatestAskForNeed {
  contactName: string;
  /** Lo use case della richiesta (un'esigenza può essere di più schede). */
  useCaseId: string;
  useCaseCode: string | null;
  /** Lo stato come lo vedono i revisori (`reviewerStatus`: oltre la scadenza è già «scaduta»). */
  status: ReferentRequestStatus;
  createdAt: Date;
  sentAt: Date | null;
  expiresAt: Date;
  expiredAt: Date | null;
  revokedAt: Date | null;
  reminderCount: number;
  lastReminderAt: Date | null;
  itemState: ReferentItemState;
  answeredAt: Date | null;
}

/**
 * La riga di un'esigenza: «Chiesta a Mario Rossi il 27/10 · Promemoria inviato il 30/10»,
 * «… · Risposta ricevuta il 2/11», «Link scaduto il 26/11 senza risposta», «Link revocato il …»,
 * «Email non ancora partita»; « (per TJ-0004)» quando la richiesta era per un'altra scheda.
 */
export function needReferentLine(latest: LatestAskForNeed | null, today: string, currentUseCaseId: string): string | null {
  if (!latest) return null;
  const t = REFERENT_UI_TEXT.needLine;
  const d = (at: Date) => referentDateLabel(at, today);
  const asked = fillText(t.askedTo, { Nome: latest.contactName, data: d(latest.sentAt ?? latest.createdAt) });
  let line: string;
  if (latest.itemState === "risposta") line = `${asked}${fillText(t.answered, { data: d(latest.answeredAt ?? latest.createdAt) })}`;
  else if (latest.itemState === "non_so") line = `${asked}${fillText(t.dontKnow, { data: d(latest.answeredAt ?? latest.createdAt) })}`;
  else if (latest.status === "revocata") line = fillText(t.revoked, { data: d(latest.revokedAt ?? latest.createdAt) });
  else if (latest.status === "scaduta") line = fillText(t.expired, { data: d(latest.expiredAt ?? latest.expiresAt) });
  else if (latest.status === "inviata" && !latest.sentAt) line = t.notSent;
  else {
    line = asked;
    if (latest.lastReminderAt) line += fillText(latest.reminderCount >= 2 ? t.lastReminder : t.reminded, { data: d(latest.lastReminderAt) });
  }
  if (latest.useCaseId.toLowerCase() !== currentUseCaseId.toLowerCase() && latest.useCaseCode) line += fillText(t.forOther, { CODE: latest.useCaseCode });
  return line;
}

// ─── Pagina pubblica ─────────────────────────────────────────────────

/** Una domanda della richiesta come la legge il server: già con il suo stato e i suoi file. */
export interface PublicItemRow {
  needId: string;
  position: number;
  /** Il testo all'invio (`use_case_referent_request_items.question`). */
  question: string;
  state: ReferentItemState;
  /** `itemIsOpen`. */
  open: boolean;
  /** L'esigenza è ancora collegata e non archiviata. */
  visible: boolean;
  /**
   * (Parte 3) La domanda è ancora «aperta» per il referente ma l'esigenza è già stata data da altri
   * (`itemHandledByTeam`: «Da verificare» o «A posto»): si mostra «gestita».
   */
  handled?: boolean;
  draft: { body: string | null; dontKnow: boolean; updatedAt: Date } | null;
  answer: { body: string | null; dontKnow: boolean; submittedAt: Date } | null;
  files: PublicFileRow[];
}

export interface PublicFileRow {
  id: string;
  fileName: string;
  sizeBytes: number | null;
  scanStatus: ReferentFileView["status"];
  message: string | null;
  personalWarning: boolean;
  warningConfirmed: boolean;
  submitted: boolean;
}

export interface PublicRows {
  request: {
    status: ReferentRequestStatus;
    expiresAt: Date;
    privacyAcceptedAt: Date | null;
    privacyNoticeVersion: string | null;
    requesterName: string;
    message: string | null;
  };
  company: string;
  useCase: { code: string | null; title: string };
  items: PublicItemRow[];
  privacyContact: string;
  clientMode: boolean;
}

function fileView(f: PublicFileRow): ReferentFileView {
  const warning = f.personalWarning ? REFERENT_PUBLIC_TEXT.fileWarning : null;
  return {
    id: f.id,
    name: f.fileName,
    sizeBytes: f.sizeBytes,
    status: f.scanStatus,
    message: f.message,
    warning,
    needsConfirmation: f.personalWarning && !f.warningConfirmed && !f.submitted,
    submitted: f.submitted,
  };
}

/** (Parte 3) Una domanda a cui ha già pensato il team: solo il titolo, mai quello che hanno scritto gli altri. */
const isHandled = (i: PublicItemRow) => !i.open && i.state === "aperta" && i.visible && i.handled === true;

function questionView(i: PublicItemRow): ReferentQuestionView {
  if (isHandled(i)) return { needId: i.needId, position: i.position, title: i.question, state: "gestita", draft: null, answer: null, files: [] };
  const sent = !i.open;
  return {
    needId: i.needId,
    position: i.position,
    title: i.question,
    state: sent ? "inviata" : "aperta",
    draft: !sent && i.draft ? { text: i.draft.body ?? "", dontKnow: i.draft.dontKnow, savedAt: i.draft.updatedAt.toISOString() } : null,
    answer: sent && i.answer ? { text: i.answer.body, dontKnow: i.answer.dontKnow, submittedAt: i.answer.submittedAt.toISOString() } : null,
    files: i.files.filter((f) => (sent ? f.submitted : true) && f.scanStatus !== "rifiutato").map(fileView),
  };
}

/**
 * La vista della pagina pubblica: solo i campi di `ReferentAskView`. Le domande ritirate (esigenza
 * cambiata di stato, archiviata o scollegata) non si vedono; quelle già risposte si vedono in sola
 * lettura, se l'esigenza è ancora della scheda.
 */
export function toPublicView(rows: PublicRows): ReferentAskView {
  const shown = rows.items
    .filter((i) => i.open || (i.state !== "aperta" && i.visible) || isHandled(i))
    .slice()
    .sort((a, b) => a.position - b.position);
  const open = shown.filter((i) => i.open).length;
  const answered = shown.filter((i) => !i.open && i.state !== "aperta").length;
  const handled = shown.filter(isHandled).length;
  // (Parte 3) Tutto fatto dal team, niente dal referente: «vuota», mai «Hai risposto a tutte le domande».
  const state: ReferentAskView["state"] = open > 0 ? "aperta" : answered > 0 || (rows.request.status === "completata" && handled === 0) ? "completata" : "vuota";
  return {
    state,
    privacy: { accepted: privacyAccepted(rows.request), version: REFERENT_PRIVACY_NOTICE.version, contact: rows.privacyContact },
    company: rows.company,
    useCase: { code: rows.useCase.code, title: rows.useCase.title },
    requester: { name: rows.request.requesterName },
    message: rows.request.message,
    expiresOn: romeDate(rows.request.expiresAt),
    questions: shown.map(questionView),
    upload: { clientMode: rows.clientMode },
  };
}

/** Ogni chiave che la vista pubblica può avere (`[]` = elemento di un elenco). */
export const PUBLIC_VIEW_KEYS: readonly string[] = Object.freeze([
  "state",
  "privacy",
  "privacy.accepted",
  "privacy.version",
  "privacy.contact",
  "company",
  "useCase",
  "useCase.code",
  "useCase.title",
  "requester",
  "requester.name",
  "message",
  "expiresOn",
  "questions",
  "questions[].needId",
  "questions[].position",
  "questions[].title",
  "questions[].state",
  "questions[].draft",
  "questions[].draft.text",
  "questions[].draft.dontKnow",
  "questions[].draft.savedAt",
  "questions[].answer",
  "questions[].answer.text",
  "questions[].answer.dontKnow",
  "questions[].answer.submittedAt",
  "questions[].files",
  "questions[].files[].id",
  "questions[].files[].name",
  "questions[].files[].sizeBytes",
  "questions[].files[].status",
  "questions[].files[].message",
  "questions[].files[].warning",
  "questions[].files[].needsConfirmation",
  "questions[].files[].submitted",
  "upload",
  "upload.clientMode",
]);

/** Ogni chiave del pannello dei revisori (`UseCaseReferentPanel` e le viste dentro). `{}` = chiave di un dizionario. */
export const PANEL_VIEW_KEYS: readonly string[] = Object.freeze([
  "available",
  "canAsk",
  "canReviewFiles",
  "gates",
  "gates[].code",
  "gates[].message",
  "gates[].canDeclare",
  "gates[].settingsHref",
  "gates[].linkLabel",
  "contacts",
  "contacts[].id",
  "contacts[].displayName",
  "contacts[].roleLabel",
  "contacts[].emailMasked",
  "contacts[].selectable",
  "contacts[].reason",
  "contacts[].team",
  "contacts[].hasOtherRequests",
  "requests",
  "requests[].id",
  "requests[].version",
  "requests[].contact",
  "requests[].contact.id",
  "requests[].contact.name",
  "requests[].contact.roleLabel",
  "requests[].contact.emailMasked",
  "requests[].contact.hubOnly",
  "requests[].status",
  "requests[].statusLabel",
  "requests[].tone",
  "requests[].silent",
  "requests[].lines",
  "requests[].lines[]",
  "requests[].notices",
  "requests[].notices[]",
  "requests[].email",
  "requests[].email.state",
  "requests[].email.label",
  "requests[].needIds",
  "requests[].needIds[]",
  "requests[].actions",
  "requests[].actions.remind",
  "requests[].actions.remind.allowed",
  "requests[].actions.remind.reason",
  "requests[].actions.add",
  "requests[].actions.add.allowed",
  "requests[].actions.add.reason",
  "requests[].actions.revoke",
  "requests[].actions.askAgain",
  "requests[].actions.retry",
  "requests[].actions.correctEmail",
  "requests[].actions.erase",
  "requests[].createdAt",
  "requests[].expiresAt",
  "needs",
  "needs{}",
  "needs{}.needId",
  "needs{}.line",
  "needs{}.silent",
  "needs{}.answers",
  "needs{}.answers[].id",
  "needs{}.answers[].source",
  "needs{}.answers[].authorLabel",
  "needs{}.answers[].dateLabel",
  "needs{}.answers[].text",
  "needs{}.answers[].dontKnow",
  "needs{}.answers[].canRemove",
  "needs{}.files",
  "needs{}.files[].id",
  "needs{}.files[].name",
  "needs{}.files[].sizeLabel",
  "needs{}.files[].dateLabel",
  "needs{}.files[].source",
  "needs{}.files[].authorLabel",
  "needs{}.files[].status",
  "needs{}.files[].personalWarning",
  "needs{}.files[].href",
  "needs{}.files[].canDelete",
  "needs{}.files[].canReview",
  "askableNeedIds",
  "askableNeedIds[]",
  "answerableNeedIds",
  "answerableNeedIds[]",
  "preparable",
  "preparable[]",
  "requester",
  "requester.name",
  "requester.email",
  "upload",
  "upload.clientMode",
  "limits",
  "limits.questionsPerRequest",
  "limits.messageMax",
  "limits.answerMax",
  "limits.filesPerQuestion",
  "limits.contactNameMin",
  "limits.contactNameMax",
  "limits.roleLabelMax",
  "limits.serverMaxBytes",
  "limits.clientMaxBytes",
  "limits.linkDays",
  "limits.retentionMonths",
  "limits.accept",
]);

/** Le chiavi di un valore, con lo stesso formato di `PUBLIC_VIEW_KEYS` e `PANEL_VIEW_KEYS` (per i test). */
export function keyPaths(value: unknown, opts: { dictionaries?: readonly string[] } = {}, prefix = ""): string[] {
  const out: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item === "object") out.push(...keyPaths(item, opts, `${prefix}[]`));
      else out.push(`${prefix}[]`);
    }
    return [...new Set(out)];
  }
  if (value === null || typeof value !== "object") return out;
  const dictionary = (opts.dictionaries ?? []).includes(prefix);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = dictionary ? `${prefix}{}` : prefix ? `${prefix}.${key}` : key;
    out.push(path);
    out.push(...keyPaths(child, opts, path));
  }
  return [...new Set(out)];
}
