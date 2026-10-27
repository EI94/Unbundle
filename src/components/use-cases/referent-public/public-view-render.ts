/**
 * Dalla vista della richiesta (`ReferentAskView`) a quello che la pagina `/rispondi/<token>` mostra
 * (SPEC §4.4, Parte 3 §P3.7). Funzioni pure, così ogni testo e ogni stato si prova senza browser.
 * Tutti i testi vengono da `REFERENT_PUBLIC_TEXT` e `REFERENT_PRIVACY_NOTICE` (labels.ts).
 *
 * La pagina non mostra mai: dettaglio o responsabile delle esigenze, stati, altre richieste, il nome o
 * l'email del referente, punteggi, valori, note, Storia, dati di chi ha proposto, né cosa ha scritto il
 * team su una domanda «gestita».
 *
 * Modulo puro: import relativi `.ts`.
 */
import { formatCountIt, formatLongDayIt } from "../../../lib/uc/views/format.ts";
import type { ReferentAskView, ReferentFileView, ReferentPageResult, ReferentQuestionView, ReferentUploadResult, SubmitResult } from "../../../lib/use-cases/referent/contract.ts";
import { REFERENT_LIMITS } from "../../../lib/use-cases/referent/contract.ts";
import { REFERENT_PRIVACY_NOTICE, REFERENT_PUBLIC_TEXT, companyLabel, fillText, privacyNoticeTexts } from "../../../lib/use-cases/referent/labels.ts";
import { referentDateLabel } from "../../../lib/use-cases/referent/view.ts";

const T = REFERENT_PUBLIC_TEXT;

// ─── Le schede di servizio ───────────────────────────────────────────

export type StateCardKind = "invalid" | "revoked" | "expired" | "unavailable";

/** La scheda di un link che non si può usare: ogni accesso che non è `ok` ha la sua. */
export function stateCardKindOf(access: Exclude<ReferentPageResult["access"], "ok">): StateCardKind {
  switch (access) {
    case "revocato":
      return "revoked";
    case "scaduto":
      return "expired";
    case "non_disponibile":
      return "unavailable";
    default:
      return "invalid";
  }
}

export function stateCardText(kind: StateCardKind): { title: string; text: string } {
  return { ...T.states[kind] };
}

// ─── Intestazione e informativa ──────────────────────────────────────

/** «26 novembre 2026» dalla data ISO della scadenza (Roma). */
export function expiryLabel(expiresOn: string): string {
  return formatLongDayIt(expiresOn) ?? expiresOn;
}

export interface HeaderTexts {
  /** Il nome dell'azienda (workspace), in piccolo. */
  company: string;
  /** «TJ-0004 · Fatture fornitori», o solo il titolo. */
  title: string;
  /** «Giulia Neri ti chiede alcune informazioni.» */
  requestedBy: string;
  /** Il messaggio di chi chiede, con il suo titolo; null senza messaggio. */
  message: { title: string; text: string } | null;
}

export function headerTexts(view: ReferentAskView): HeaderTexts {
  const name = view.requester.name;
  const code = view.useCase.code?.trim();
  const message = view.message?.trim() ? view.message.trim() : null;
  return {
    company: companyLabel(view.company),
    title: code ? `${code} · ${view.useCase.title}` : view.useCase.title,
    requestedBy: fillText(T.requestedBy, { Nome: name }),
    message: message ? { title: fillText(T.messageTitle, { Nome: name }), text: message } : null,
  };
}

/** L'informativa con i valori di questa richiesta. */
export function privacyTexts(view: ReferentAskView): { title: string; lead: string; summary: string[]; fullTextLabel: string; paragraphs: string[]; button: string; footerLabel: string } {
  const filled = privacyNoticeTexts({ company: view.company, expires: expiryLabel(view.expiresOn), requester: view.requester.name, contact: view.privacy.contact });
  const n = REFERENT_PRIVACY_NOTICE;
  return { title: n.title, lead: n.lead, summary: filled.summary, fullTextLabel: n.fullTextLabel, paragraphs: filled.paragraphs, button: n.button, footerLabel: n.footerLabel };
}

// ─── Cosa mostra la pagina ───────────────────────────────────────────

/**
 * La schermata: l'informativa prima di tutto quando c'è ancora da rispondere e non è letta (o è
 * cambiata); poi le domande; altrimenti la scheda finale («completata» o «vuota») con le domande in sola
 * lettura sotto.
 */
export type ScreenKind = "privacy" | "questions" | "completed" | "empty";

export function screenOf(view: ReferentAskView): ScreenKind {
  if (view.state === "aperta") return view.privacy.accepted ? "questions" : "privacy";
  return view.state === "completata" ? "completed" : "empty";
}

export function finalCardText(kind: "completed" | "empty"): string {
  return kind === "completed" ? T.completed : T.empty;
}

export interface QuestionSection {
  needId: string;
  /** «Domanda 2 di 3»: conta ogni domanda mostrata, anche quelle «gestita». */
  label: string;
  title: string;
  kind: ReferentQuestionView["state"];
  question: ReferentQuestionView;
}

/** Le domande in ordine di posizione, con «Domanda n di m». */
export function questionSections(view: ReferentAskView): QuestionSection[] {
  const ordered = [...view.questions].sort((a, b) => a.position - b.position);
  return ordered.map((q, i) => ({
    needId: q.needId,
    label: fillText(T.questionOf, { n: i + 1, total: ordered.length }),
    title: q.title,
    kind: q.state,
    question: q,
  }));
}

/** Ci sono domande a cui rispondere adesso. */
export function hasOpenQuestions(view: ReferentAskView): boolean {
  return view.questions.some((q) => q.state === "aperta");
}

/**
 * Una domanda già inviata, in sola lettura: «Inviata il 27/10», il testo o «Non lo so», i nomi dei
 * file. `today` è il giorno di Roma (`YYYY-MM-DD`): l'anno compare solo se è un altro.
 */
export function sentAnswerView(q: ReferentQuestionView, today: string): { sentOn: string; text: string | null; files: string[] } | null {
  if (q.state !== "inviata" || !q.answer) return null;
  return {
    sentOn: fillText(T.sentOn, { data: referentDateLabel(q.answer.submittedAt, today) }),
    text: q.answer.dontKnow ? T.dontKnow : q.answer.text?.trim() ? q.answer.text : null,
    files: q.files.map((f) => f.name),
  };
}

/** Il testo di una domanda a cui ha già pensato il team: mai cosa ha scritto, mai chi. */
export function handledText(): string {
  return T.handledByTeam;
}

// ─── Risposta e file ─────────────────────────────────────────────────

/** «3.612 di 4.000 caratteri» dai 3.500 caratteri in su, altrimenti null. */
export function counterLabel(length: number): string | null {
  if (length < 3500) return null;
  return fillText(T.counter, { n: formatCountIt(length) });
}

/** La riga d'aiuto dei file: 20 MB con il caricamento diretto, altrimenti 4 MB. */
export function attachHelp(clientMode: boolean): string {
  return clientMode ? T.attachHelp : T.attachHelpServerOnly;
}

/** Il limite di dimensione che vale per un file, in byte. */
export function maxFileBytes(clientMode: boolean): number {
  return clientMode ? REFERENT_LIMITS.clientMaxBytes : REFERENT_LIMITS.serverMaxBytes;
}

/** Un file della pagina: quelli della vista e quelli appena caricati. */
export type PublicFile = ReferentFileView;

/** Il risultato di un caricamento come file della pagina (non ancora inviato). */
export function fileFromUpload(r: ReferentUploadResult): PublicFile {
  return {
    id: r.fileId,
    name: r.fileName,
    sizeBytes: r.sizeBytes,
    status: r.status,
    message: r.message,
    warning: r.warning,
    needsConfirmation: r.needsConfirmation,
    submitted: false,
  };
}

/** Lo stato di un file in parole: «Controllo in corso…», «Allegato», «In controllo da Lateral Space…», «Non accettato: …». */
export function fileStateLabel(f: Pick<PublicFile, "status" | "message">): string {
  return fillText(T.fileStates[f.status], { message: f.message?.trim() || "" }).replace(/:\s*$/, "");
}

export interface FileRow {
  id: string;
  name: string;
  state: string;
  tone: "info" | "ok" | "attenzione" | "errore";
  /** «Il file sembra contenere nomi…» con «Togli» e «Servono, lo lascio». */
  confirm: { warning: string; keep: string } | null;
  /** «Togli»: solo per i file non ancora inviati e non rifiutati (un file rifiutato è già cancellato). */
  removable: boolean;
}

export function fileRow(f: PublicFile): FileRow {
  const tone = f.status === "pulito" ? "ok" : f.status === "in_revisione" ? "attenzione" : f.status === "rifiutato" ? "errore" : "info";
  return {
    id: f.id,
    name: f.name,
    state: fileStateLabel(f),
    tone,
    confirm: f.needsConfirmation && !f.submitted && f.status !== "rifiutato" ? { warning: T.fileWarning, keep: T.keepFile } : null,
    removable: !f.submitted && f.status !== "rifiutato",
  };
}

/** Si può inviare la domanda con questi file: nessun controllo in corso, nessuna conferma che manca. */
export function filesBlockSubmit(files: readonly PublicFile[]): "file_in_controllo" | "file_da_confermare" | null {
  const live = files.filter((f) => !f.submitted && f.status !== "rifiutato");
  if (live.some((f) => f.status === "in_quarantena")) return "file_in_controllo";
  if (live.some((f) => f.needsConfirmation)) return "file_da_confermare";
  return null;
}

// ─── Invio ───────────────────────────────────────────────────────────

/** «Invii solo le domande a cui hai risposto. … fino al 26 novembre 2026.» */
export function submitHint(view: ReferentAskView): string {
  return fillText(T.submitHint, { data: expiryLabel(view.expiresOn) });
}

/** La schermata dopo l'invio. */
export function thanksTexts(result: SubmitResult, view: ReferentAskView): { title: string; seen: string; remaining: string | null; back: string | null } {
  const data = expiryLabel(view.expiresOn);
  const remaining = result.open <= 0 ? null : result.open === 1 ? fillText(T.remainingOne, { data }) : fillText(T.remainingMany, { n: result.open, data });
  return { title: T.thanksTitle, seen: fillText(T.thanksSeen, { Nome: view.requester.name }), remaining, back: remaining ? T.backToQuestions : null };
}

/** I problemi dell'invio per domanda (`field` = id dell'esigenza), e la prima domanda da mostrare. */
export function issuesByQuestion(
  issues: readonly { code: string; message: string; field?: string }[],
  order: readonly string[],
): { byNeed: Map<string, string[]>; first: string | null; general: string[] } {
  const byNeed = new Map<string, string[]>();
  const general: string[] = [];
  const known = new Set(order.map((id) => id.toLowerCase()));
  for (const i of issues) {
    const field = i.field?.toLowerCase().split(/[.[]/)[0] ?? "";
    if (field && known.has(field)) {
      const list = byNeed.get(field) ?? [];
      if (!list.includes(i.message)) list.push(i.message);
      byNeed.set(field, list);
    } else if (!general.includes(i.message)) general.push(i.message);
  }
  const first = order.map((id) => id.toLowerCase()).find((id) => byNeed.has(id)) ?? null;
  return { byNeed, first, general };
}

export const FOOTER_TEXT = T.footer;
export const BRAND_TEXT = T.brand;
