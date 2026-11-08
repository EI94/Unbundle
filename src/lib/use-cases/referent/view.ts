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
import type { ReferentItemState, ReferentRequestStatus } from "../../db/use-case-hub-referents-ddl.ts";
import type { ReferentAskView, ReferentCheckView, ReferentFileView, ReferentQuestionView } from "./contract.ts";
import { REFERENT_PRIVACY_NOTICE, REFERENT_REQUEST_WORD, REFERENT_UI_TEXT, fillText } from "./labels.ts";
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

/**
 * (Rilascio 4, §11) La parola di una richiesta, una sola, calcolata qui per tutti: «In attesa» (viva),
 * «Nessuna risposta» (viva dopo i due promemoria con domande aperte, oppure scaduta con domande
 * aperte), «Risposte ricevute» (completata), «Chiusa» (scaduta senza domande aperte, o revocata).
 * `status` è quello dei revisori (`reviewerStatus`: oltre la scadenza è già «scaduta»).
 */
export function requestWordOf(r: { status: ReferentRequestStatus; silent: boolean; openItems: number }): string {
  const w = REFERENT_REQUEST_WORD;
  if (r.status === "inviata") return r.silent ? w.silent : w.waiting;
  if (r.status === "completata") return w.answered;
  if (r.status === "scaduta" && r.openItems > 0) return w.silent;
  return w.closed;
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
  /** (Rilascio 5) «Serve un file». */
  fileRequired?: boolean;
  draft: { body: string | null; dontKnow: boolean; alreadyAttached?: boolean; comment?: string | null; updatedAt: Date } | null;
  answer: { body: string | null; dontKnow: boolean; alreadyAttached?: boolean; comment?: string | null; submittedAt: Date } | null;
  files: PublicFileRow[];
}

export interface PublicFileRow {
  id: string;
  fileName: string;
  sizeBytes: number | null;
  scanStatus: ReferentFileView["status"];
  message: string | null;
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
  /** (Rilascio 5) La conferma e la stima: solo per una richiesta al referente. */
  check?: ReferentCheckView | null;
  /** (Rilascio 5) Adesso, per sapere se la conferma si può ancora inviare (di default l'orologio). */
  now?: Date;
}

/** (Rilascio 5.1) Un file della pagina: mai un avviso su nomi, email o telefoni, niente da confermare. */
function fileView(f: PublicFileRow): ReferentFileView {
  return { id: f.id, name: f.fileName, sizeBytes: f.sizeBytes, status: f.scanStatus, message: f.message, submitted: f.submitted };
}

/** (Parte 3) Una domanda a cui ha già pensato il team: solo il titolo, mai quello che hanno scritto gli altri. */
const isHandled = (i: PublicItemRow) => !i.open && i.state === "aperta" && i.visible && i.handled === true;

function questionView(i: PublicItemRow): ReferentQuestionView {
  const fileRequired = i.fileRequired === true;
  if (isHandled(i)) return { needId: i.needId, position: i.position, title: i.question, state: "gestita", fileRequired, draft: null, answer: null, files: [] };
  const sent = !i.open;
  // (Rilascio 5) Le chiusure lette come sono salvate: «Non ce l'ho» vince, poi «È già allegato», poi il testo.
  const closureOf = (dontKnow: boolean, attached: boolean | undefined) => ({ dontKnow, alreadyAttached: !dontKnow && attached === true });
  return {
    needId: i.needId,
    position: i.position,
    title: i.question,
    state: sent ? "inviata" : "aperta",
    fileRequired,
    draft:
      !sent && i.draft
        ? { text: i.draft.dontKnow || i.draft.alreadyAttached ? "" : (i.draft.body ?? ""), ...closureOf(i.draft.dontKnow, i.draft.alreadyAttached), comment: i.draft.comment ?? null, savedAt: i.draft.updatedAt.toISOString() }
        : null,
    answer:
      sent && i.answer
        ? { text: i.answer.body, ...closureOf(i.answer.dontKnow, i.answer.alreadyAttached), comment: i.answer.comment ?? null, submittedAt: i.answer.submittedAt.toISOString() }
        : null,
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
  const check = rows.check ?? null;
  // (Rilascio 5) La conferma ancora da inviare tiene aperta la pagina, anche senza domande.
  const live = rows.request.status === "inviata" && rows.request.expiresAt.getTime() > (rows.now ?? new Date()).getTime();
  const checkOpen = check !== null && check.submittedAt === null && live;
  const open = shown.filter((i) => i.open).length + (checkOpen ? 1 : 0);
  const answered = shown.filter((i) => !i.open && i.state !== "aperta").length + (check?.submittedAt ? 1 : 0);
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
    kind: check ? "referente" : "domande",
    check,
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
  "questions[].fileRequired",
  "questions[].draft",
  "questions[].draft.text",
  "questions[].draft.dontKnow",
  "questions[].draft.alreadyAttached",
  "questions[].draft.comment",
  "questions[].draft.savedAt",
  "questions[].answer",
  "questions[].answer.text",
  "questions[].answer.dontKnow",
  "questions[].answer.alreadyAttached",
  "questions[].answer.comment",
  "questions[].answer.submittedAt",
  "questions[].files",
  "questions[].files[].id",
  "questions[].files[].name",
  "questions[].files[].sizeBytes",
  "questions[].files[].status",
  "questions[].files[].message",
  "questions[].files[].submitted",
  "upload",
  "upload.clientMode",
  // (Rilascio 5) La richiesta al referente: la conferma e la stima, mai euro, quote o punteggi.
  "kind",
  "check",
  "check.description",
  // (Rilascio 5.1) Le righe del passo «L'impatto».
  "check.benefits",
  "check.benefits[].key",
  "check.benefits[].form",
  "check.benefits[].label",
  "check.benefits[].team",
  "check.benefits[].team.kind",
  "check.benefits[].team.volumeYear",
  "check.benefits[].team.minutes",
  "check.benefits[].team.eurYear",
  "check.benefits[].draft",
  "check.benefits[].draft.answer",
  "check.benefits[].draft.timesPerMonth",
  "check.benefits[].draft.minutesEach",
  "check.benefits[].draft.eurYear",
  "check.benefits[].draft.comment",
  "check.benefits[].draft.stale",
  "check.draft",
  "check.draft.confirm",
  "check.draft.note",
  "check.draft.estimate",
  "check.draft.timesPerMonth",
  "check.draft.minutesEach",
  "check.draft.stale",
  "check.draft.savedAt",
  "check.submittedAt",
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
  // (Rilascio 5) La richiesta viva della persona su questo use case (id e tipo, mai un conteggio).
  "contacts[].liveRequest",
  "contacts[].liveRequest.id",
  "contacts[].liveRequest.kind",
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
  // (Rilascio 5) Le domande aperte, il tipo, le date per il blocco «Referente».
  "requests[].openNeedIds",
  "requests[].openNeedIds[]",
  "requests[].kind",
  "requests[].sentAt",
  "requests[].lastReminderAt",
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
  "needs{}.answers[].alreadyAttached",
  "needs{}.answers[].comment",
  "needs{}.files",
  "needs{}.files[].id",
  "needs{}.files[].name",
  "needs{}.files[].sizeLabel",
  "needs{}.files[].dateLabel",
  "needs{}.files[].source",
  "needs{}.files[].authorLabel",
  "needs{}.files[].status",
  "needs{}.files[].href",
  "needs{}.files[].canDelete",
  "needs{}.files[].canReview",
  "needs{}.reviewExpired",
  "askableNeedIds",
  "askableNeedIds[]",
  "answerableNeedIds",
  "answerableNeedIds[]",
  "preparable",
  "preparable[]",
  "prepareGaps",
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
  // (Rilascio 5, §9.5) Il referente dello use case, calcolato dalle richieste.
  "eligible",
  "latestReferentRequestId",
  "referent",
  "referent.contact",
  "referent.contact.id",
  "referent.contact.name",
  "referent.contact.roleLabel",
  "referent.contact.emailMasked",
  "referent.contact.team",
  "referent.requestId",
  "referent.referentRequestId",
  "referent.state",
  "referent.review",
  "referent.live",
  "referent.check",
  "referent.check.submittedAt",
  "referent.check.confirm",
  "referent.check.note",
  "referent.check.estimate",
  "referent.check.timesPerMonth",
  "referent.check.minutesEach",
  "referent.check.correctionDoneAt",
  "referent.check.outcome",
  "referent.check.outcomeAt",
  "referent.check.team",
  "referent.check.team.key",
  "referent.check.team.volumeYear",
  "referent.check.team.minutes",
  "referent.check.team.hours",
  "referent.check.team.perMonth",
  "referent.check.teamChanged",
  "referent.check.teamNow",
  "referent.check.referentHours",
  "referent.check.version",
  // (Rilascio 5.1) La risposta su ogni voce di «Benefici e costi».
  "referent.check.benefits",
  "referent.check.benefits[].key",
  "referent.check.benefits[].form",
  "referent.check.benefits[].label",
  "referent.check.benefits[].team",
  "referent.check.benefits[].team.kind",
  "referent.check.benefits[].team.volumeYear",
  "referent.check.benefits[].team.minutes",
  "referent.check.benefits[].team.eurYear",
  "referent.check.benefits[].answer",
  "referent.check.benefits[].timesPerMonth",
  "referent.check.benefits[].minutesEach",
  "referent.check.benefits[].eurYear",
  "referent.check.benefits[].comment",
  "referent.check.benefits[].outcome",
  "referent.check.benefits[].outcomeAt",
  "referent.check.benefits[].changed",
  "referent.check.benefits[].needsReview",
  "referent.check.benefits[].adoptable",
  "referent.declinedNeedIds",
  "referent.declinedNeedIds[]",
  "referent.hints",
  "referent.hints[]",
  "referent.askableForReferent",
  "referent.askableForReferent[]",
  // (Rilascio 6) «Il filo con il referente»: i messaggi, le proposte dell'AI, «Chiedi un chiarimento», il turno.
  "needs{}.answers[].clarify",
  "needs{}.answers[].clarify.requestId",
  "needs{}.answers[].clarify.anchor",
  "needs{}.answers[].clarify.needId",
  "needs{}.answers[].clarify.componentKey",
  "needs{}.answers[].clarify.contactName",
  "needs{}.answers[].clarify.quote",
  "needs{}.answers[].clarify.pending",
  "needs{}.answers[].editedLabel",
  "referent.turn",
  "referent.check.clarify",
  "referent.check.clarify.requestId",
  "referent.check.clarify.anchor",
  "referent.check.clarify.needId",
  "referent.check.clarify.componentKey",
  "referent.check.clarify.contactName",
  "referent.check.clarify.quote",
  "referent.check.clarify.pending",
  "referent.check.benefits[].clarify",
  "referent.check.benefits[].clarify.requestId",
  "referent.check.benefits[].clarify.anchor",
  "referent.check.benefits[].clarify.needId",
  "referent.check.benefits[].clarify.componentKey",
  "referent.check.benefits[].clarify.contactName",
  "referent.check.benefits[].clarify.quote",
  "referent.check.benefits[].clarify.pending",
  "thread",
  "thread.messages",
  "thread.messages[].id",
  "thread.messages[].requestId",
  "thread.messages[].anchor",
  "thread.messages[].needId",
  "thread.messages[].componentKey",
  "thread.messages[].anchorKey",
  "thread.messages[].anchorLabel",
  "thread.messages[].side",
  "thread.messages[].kind",
  "thread.messages[].header",
  "thread.messages[].text",
  "thread.messages[].waiting",
  "thread.messages[].canReply",
  "thread.messages[].canDone",
  "thread.suggestions",
  "thread.suggestions[].id",
  "thread.suggestions[].requestId",
  "thread.suggestions[].anchorKey",
  "thread.suggestions[].text",
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
