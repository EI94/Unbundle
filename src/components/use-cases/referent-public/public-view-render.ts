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
import type {
  ReferentAskView,
  ReferentFileView,
  ReferentPageResult,
  ReferentQuestionView,
  ReferentThreadMessageView,
  ReferentUploadResult,
  SubmitResult,
} from "../../../lib/use-cases/referent/contract.ts";
import { referentTemplateHref } from "../../../lib/use-cases/referent/contract.ts";
import { formatFileSize } from "../../../lib/use-cases/referent/upload-transport.ts";
import { kitClientLine, kitProgress } from "../../../lib/use-cases/referent/kit.ts";
import { REFERENT_CHECK_TEXT, REFERENT_ERROR_MESSAGES, REFERENT_IMPACT_TEXT, REFERENT_PRIVACY_NOTICE, REFERENT_PUBLIC_TEXT, fillText, privacyNoticeTexts } from "../../../lib/use-cases/referent/labels.ts";
import { benefitSentLine } from "../../../lib/use-cases/referent/impact-text.ts";
import { referentDateLabel } from "../../../lib/use-cases/referent/view.ts";

const T = REFERENT_PUBLIC_TEXT;

// ─── Le schede di servizio ───────────────────────────────────────────

/**
 * (Rilascio 10, §3.11) Due schede sole: «gone», il link che non vale più (sbagliato, revocato o scaduto: sempre le stesse
 * parole, così non si capisce quale), ed «error», la pagina che non si è caricata (la funzione spenta, gli archivi non
 * pronti, un errore), con il solo «Riprova».
 */
export type StateCardKind = "gone" | "error";

/** La scheda di un accesso che non è `ok`. */
export function stateCardKindOf(access: Exclude<ReferentPageResult["access"], "ok">): StateCardKind {
  return access === "non_disponibile" ? "error" : "gone";
}

export function stateCardText(kind: StateCardKind): { title: string; text: string } {
  return kind === "gone" ? { title: T.linkGone.title, text: T.linkGone.text } : { title: T.error.title, text: T.error.text };
}

// ─── Intestazione e informativa ──────────────────────────────────────

/** «26 novembre 2026» dalla data ISO della scadenza (Roma). */
export function expiryLabel(expiresOn: string): string {
  return formatLongDayIt(expiresOn) ?? expiresOn;
}

export interface HeaderTexts {
  /** (Rilascio 10, §3.11) Il nome del cliente per la riga in alto («Rondine · con Lateral Space»); null senza. */
  client: string | null;
  /** (Rilascio 10, D6) Il titolo del caso d'uso, senza il codice. */
  title: string;
  /** (Rilascio 10, D6) «Riferimento RD-0004», in piccolo in fondo alla pagina; null senza codice. */
  reference: string | null;
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
    client: kitClientLine(view.company) ? view.company.replace(/\s+/g, " ").trim() : null,
    title: view.useCase.title,
    reference: code ? `${REFERENT_PUBLIC_TEXT.reference} ${code}` : null,
    // (Rilascio 5) La richiesta al referente lo dice subito: «{Nome} ti ha indicato come referente.»
    requestedBy: fillText(view.kind === "referente" ? REFERENT_CHECK_TEXT.requestedBy : T.requestedBy, { Nome: name }),
    message: message ? { title: fillText(T.messageTitle, { Nome: name }), text: message } : null,
  };
}

/** L'informativa di questa pagina, con i valori di questa richiesta. */
export function privacyTexts(view: ReferentAskView): { title: string; lead: string; summary: string[]; fullTextLabel: string; paragraphs: string[]; button: string; footerLabel: string } {
  const filled = privacyNoticeTexts({ company: view.company, expires: expiryLabel(view.expiresOn), requester: view.requester.name, contact: view.privacy.contact });
  const n = REFERENT_PRIVACY_NOTICE;
  return { title: n.title, lead: n.lead, summary: filled.summary, fullTextLabel: n.fullTextLabel, paragraphs: filled.paragraphs, button: n.button, footerLabel: n.footerLabel };
}

/** (Rilascio 9b) Il testo dell'informativa da mostrare, con la sua versione. */
export type NoticeTexts = ReturnType<typeof privacyTexts> & { version: string };

/**
 * (Rilascio 9b) Il testo da mostrare per la versione che il server chiede di accettare (`privacy.version`): quello della
 * vista (`privacy.notice`); senza (un server di prima), quello di questa pagina se è della stessa versione; altrimenti
 * null, e il riquadro chiede di ricaricare la pagina. Mai «Iniziamo» sotto un testo diverso da quello che si accetta:
 * «Iniziamo» manda come prova la versione di questo testo (`shown`).
 */
export function noticeOf(view: ReferentAskView): NoticeTexts | null {
  const n = view.privacy.notice;
  if (n && n.version === view.privacy.version) {
    return { version: n.version, title: n.title, lead: n.lead, summary: [...n.summary], fullTextLabel: n.fullTextLabel, paragraphs: [...n.paragraphs], button: n.button, footerLabel: n.footerLabel };
  }
  return REFERENT_PRIVACY_NOTICE.version === view.privacy.version ? { version: REFERENT_PRIVACY_NOTICE.version, ...privacyTexts(view) } : null;
}

/**
 * (Rilascio 9b) La schermata che c'è sotto l'informativa: quella che la pagina mostrerebbe con l'informativa letta.
 * Quando l'informativa torna a metà visita la pagina la tiene aperta, nascosta, così niente di scritto si perde.
 */
export function screenUnderNotice(view: ReferentAskView): Exclude<ScreenKind, "privacy"> {
  const under = screenOf({ ...view, privacy: { ...view.privacy, accepted: true } });
  return under === "privacy" ? "questions" : under;
}

// ─── Cosa mostra la pagina ───────────────────────────────────────────

/**
 * La schermata: l'informativa prima di tutto quando c'è ancora da rispondere e non è letta (o è
 * cambiata); poi le domande; altrimenti la scheda finale («completata» o «vuota») con le domande in sola
 * lettura sotto. (Rilascio 6) Dopo il primo invio, con qualcosa di nuovo (un chiarimento del team, una
 * domanda nuova, la risposta a un dubbio) la pagina apre su «Da completare» («news»); una risposta da
 * leggere non chiede l'informativa, un chiarimento o una domanda sì.
 */
export type ScreenKind = "privacy" | "questions" | "news" | "completed" | "empty";

export function screenOf(view: ReferentAskView): ScreenKind {
  const news = newsOf(view);
  const act = view.state === "aperta" || news.clarifications.length > 0;
  if (act && !view.privacy.accepted) return "privacy";
  if (view.thread.followUp && news.total > 0) return "news";
  if (view.state === "aperta") return "questions";
  return view.state === "completata" ? "completed" : "empty";
}

export function finalCardText(kind: "completed" | "empty", view?: ReferentAskView, today?: string): string {
  if (kind === "completed") {
    // (Rilascio 5) «Hai risposto il 3/11. Grazie!»
    const on = view ? lastSentOn(view) : null;
    return on && today ? fillText(T.answeredOn, { data: referentDateLabel(on, today) }) : T.completed;
  }
  return T.empty;
}

export interface QuestionSection {
  needId: string;
  /**
   * (Rilascio 10, §3.11) Il numero della scheda, «1», «2»…: conta ogni domanda mostrata, anche quelle «gestita». Lo
   * stesso numero di «Manca ancora la domanda 2.».
   */
  number: number;
  /** (Rilascio 10, §3.11) Al posto del numero, in «Novità»: «Nuova domanda». */
  label?: string;
  title: string;
  kind: ReferentQuestionView["state"];
  question: ReferentQuestionView;
}

/** Le domande in ordine di posizione, numerate. */
export function questionSections(view: ReferentAskView): QuestionSection[] {
  const ordered = [...view.questions].sort((a, b) => a.position - b.position);
  return ordered.map((q, i) => ({
    needId: q.needId,
    number: i + 1,
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
export function sentAnswerView(q: ReferentQuestionView, today: string): { sentOn: string; text: string | null; files: string[]; comment?: string | null } | null {
  if (q.state !== "inviata" || !q.answer) return null;
  // (Rilascio 5) «Non lo so», «È già allegato», il commento o «Chi potrebbe saperlo».
  const comment = q.answer.comment?.trim() ? fillText(q.answer.dontKnow ? T.sentWhoKnows : T.sentComment, { testo: q.answer.comment.trim() }) : null;
  return {
    sentOn: fillText(T.sentOn, { data: referentDateLabel(q.answer.submittedAt, today) }),
    text: q.answer.dontKnow ? T.dontKnow : q.answer.alreadyAttached ? T.alreadyAttached : q.answer.text?.trim() ? q.answer.text : null,
    files: q.files.map((f) => f.name),
    ...(comment ? { comment } : {}),
  };
}

// ─── Le chiusure (rilascio 5, §3.6) ──────────────────────────────────

/** Quello che c'è adesso in una domanda aperta, per sapere se è chiusa. */
export interface ClosureState {
  text: string;
  dontKnow: boolean;
  alreadyAttached: boolean;
  files: readonly PublicFile[];
}

/** Un file che chiude la domanda: caricato e controllato. */
export function usableFile(f: Pick<PublicFile, "status">): boolean {
  return f.status === "pulito" || f.status === "in_revisione";
}

/** La domanda è chiusa: un testo (non su «Serve un file»), un file, «Non lo so» o «È già allegato». */
export function questionClosed(q: Pick<ReferentQuestionView, "state" | "fileRequired">, c: ClosureState | null): boolean {
  if (q.state !== "aperta") return true;
  if (!c) return false;
  if (c.dontKnow || c.alreadyAttached) return true;
  if (c.files.some(usableFile)) return true;
  return !q.fileRequired && c.text.trim().length > 0;
}

/** Il commento si offre solo con una chiusura senza testo: «Non lo so», «È già allegato» o un file. */
export function commentOffered(c: Pick<ClosureState, "dontKnow" | "alreadyAttached" | "files">): boolean {
  return c.dontKnow || c.alreadyAttached || c.files.some(usableFile);
}

/** Lo stato del salvataggio di una domanda aperta, per l'unico «salvato» della barra. */
export type QuestionSave = "saved" | "saving" | "error" | "held";

/**
 * (Rilascio 10, §3.11) Il solo numero della pagina, nella barra, con lo stato del salvataggio accanto: «2 di 5 ·
 * salvato»; «salvataggio…» mentre una domanda salva; solo «2 di 5» con un salvataggio non riuscito o in attesa
 * dell'informativa (lo dice la domanda). `unsent`: c'è un testo che parte solo con «Invia» (la risposta a un
 * chiarimento): niente «salvato».
 */
export function progressText(done: number, total: number, saves: Iterable<QuestionSave>, o: { unsent?: boolean } = {}): string {
  let state: "saved" | "saving" | null = o.unsent ? null : "saved";
  for (const save of saves) {
    if (save === "error" || save === "held") return kitProgress(done, total, null);
    if (save === "saving") state = "saving";
  }
  return kitProgress(done, total, state);
}

/** «Manca ancora la domanda 4.», «Mancano ancora le domande 2, 4 e 6.» (i numeri di «Domanda k di n»). */
export function missingText(positions: readonly number[]): string {
  const list = [...positions].sort((a, b) => a - b);
  if (list.length === 1) return fillText(T.missingOne, { k: list[0] });
  const joined = `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
  return fillText(T.missingMany, { list: joined });
}

/** La riga sotto una domanda che manca. */
export function closeHint(fileRequired: boolean): string {
  return fileRequired ? REFERENT_ERROR_MESSAGES.domanda_aperta_file : REFERENT_ERROR_MESSAGES.domanda_aperta;
}

/** (Rilascio 5) Il giorno dell'ultimo invio del referente (la conferma, una risposta o, rilascio 6, un suo messaggio), oppure null. */
export function lastSentOn(view: ReferentAskView): string | null {
  const dates = [
    view.check?.submittedAt ?? null,
    ...view.questions.map((q) => q.answer?.editedAt ?? q.answer?.submittedAt ?? null),
    ...view.thread.messages.filter((m) => m.side === "referente").map((m) => m.createdAt),
  ].filter((d): d is string => Boolean(d));
  if (!dates.length) return null;
  return dates.sort().at(-1) ?? null;
}

/** (Rilascio 5) La conferma e la stima inviate, in sola lettura: «Il caso d'uso: …», «Il tempo: …», i numeri. */
export function sentCheckLines(view: ReferentAskView): {
  useCase: string;
  note: string | null;
  time: string | null;
  numbers: string | null;
  /** (Rilascio 5.1) Una riga per voce, con il commento; vuoto per la stima del tempo. */
  benefits: { key: string; line: string; comment: string | null }[];
} | null {
  const c = view.check;
  if (!c?.submittedAt) return null;
  const d = c.draft;
  const useCase = d.confirm === "correggi" ? T.sentUseCaseFix : T.sentUseCaseYes;
  const note = d.confirm === "correggi" ? (d.note?.trim() || null) : null;
  if (c.benefits) {
    return {
      useCase,
      note,
      time: null,
      numbers: null,
      benefits: c.benefits.map((b) => ({
        key: b.key,
        line: benefitSentLine(b, b.draft ?? { answer: null, timesPerMonth: null, minutesEach: null, eurYear: null }),
        comment: b.draft?.comment ? fillText(REFERENT_IMPACT_TEXT.sentComment, { testo: b.draft.comment }) : null,
      })),
    };
  }
  const time = d.estimate === "meno" ? T.sentTimeLess : d.estimate === "piu" ? T.sentTimeMore : d.estimate === "si" ? T.sentTimeYes : T.sentTimeOwn;
  const fmt = (n: number) => String(n).replace(".", ",");
  const numbers =
    d.timesPerMonth !== null || d.minutesEach !== null
      ? fillText(T.sentTimeNumbers, { n: d.timesPerMonth !== null ? fmt(d.timesPerMonth) : "—", m: d.minutesEach !== null ? fmt(d.minutesEach) : "—" })
      : null;
  return { useCase, note, time, numbers, benefits: [] };
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
    submitted: false,
  };
}

/** Lo stato di un file in parole: «Controllo in corso…», «Allegato», «Lo controlla il team…», «Non accettato. …». */
export function fileStateLabel(f: Pick<PublicFile, "status" | "message">): string {
  const message = f.message?.trim() || "";
  const label = fillText(T.fileStates[f.status], { message });
  return message ? label : label.replace(/[.:]\s*$/, "");
}

export interface FileRow {
  id: string;
  name: string;
  state: string;
  tone: "info" | "ok" | "attenzione" | "errore";
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
    removable: !f.submitted && f.status !== "rifiutato",
  };
}

// ─── File da compilare ───────────────────────────────────────────────

/** («File da compilare») Un link «Scarica il file da compilare» sotto il titolo della domanda, con nome e dimensione. */
export interface TemplateLink {
  id: string;
  href: string;
  /** «Scarica il file da compilare». */
  label: string;
  /** «modello.xlsx · 48 KB». */
  detail: string;
  /** «Scarica il file da compilare modello.xlsx»: più link nella pagina, ognuno con il suo nome. */
  ariaLabel: string;
}

/**
 * I link dei file da compilare di una domanda: sulle domande aperte e su quelle già inviate, mai su una «gestita» (il
 * team ci ha già pensato). Il download risponde solo per un file che la pagina offre.
 */
export function templateLinks(token: string, question: Pick<ReferentQuestionView, "state" | "templates">): TemplateLink[] {
  if (question.state === "gestita") return [];
  return (question.templates ?? []).map((t) => ({
    id: t.id,
    href: referentTemplateHref(token, t.id),
    label: T.templateDownload,
    detail: [t.name, formatFileSize(t.sizeBytes)].filter(Boolean).join(" · "),
    ariaLabel: fillText(T.aria.templateDownload, { file: t.name }),
  }));
}

/** Il caricamento di sempre: «Allega il file compilato» quando la domanda ha un file da compilare, altrimenti «Allega un file». */
export function attachLabel(question: Pick<ReferentQuestionView, "templates">): string {
  return (question.templates ?? []).length > 0 ? T.attachFilled : T.attach;
}

/** Si può inviare la domanda con questi file: nessun controllo in corso. (Rilascio 5.1) Niente da confermare. */
export function filesBlockSubmit(files: readonly PublicFile[]): "file_in_controllo" | null {
  const live = files.filter((f) => !f.submitted && f.status !== "rifiutato");
  return live.some((f) => f.status === "in_quarantena") ? "file_in_controllo" : null;
}

// ─── Invio ───────────────────────────────────────────────────────────

/**
 * La schermata dopo l'invio. (Rilascio 5) Si invia solo con tutto chiuso: «Grazie, è tutto.» e «{Nome} lo
 * vede subito.», senza pulsanti; resta il ripiego del rilascio 4 se qualcosa è ancora aperto.
 */
export function thanksTexts(result: SubmitResult, view: ReferentAskView): { title: string; seen: string; remaining: string | null; back: string | null } {
  const data = expiryLabel(view.expiresOn);
  if (result.open <= 0) return { title: T.thanksDone, seen: fillText(T.thanksSeenNow, { Nome: view.requester.name }), remaining: null, back: null };
  const remaining = result.open === 1 ? fillText(T.remainingOne, { data }) : fillText(T.remainingMany, { n: result.open, data });
  return { title: T.thanksTitle, seen: fillText(T.thanksSeen, { Nome: view.requester.name }), remaining, back: T.backToQuestions };
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


// ─── (Rilascio 6) Il filo con il team ────────────────────────────────

const TT = T.thread;

/** Dove sta un messaggio: una domanda, una voce dell'impatto, «Generale». */
export type ThreadTarget = { anchor: "domanda"; needId: string } | { anchor: "beneficio"; componentKey: string } | { anchor: "generale" };

/** La chiave di un'ancora: «d:<esigenza>», «b:<voce>», «g» (la stessa del server, `anchorKeyOf`). */
export function threadKeyOf(a: { anchor: string; needId?: string | null; componentKey?: string | null }): string {
  if (a.anchor === "domanda") return `d:${(a.needId ?? "").toLowerCase()}`;
  if (a.anchor === "beneficio") return `b:${a.componentKey ?? ""}`;
  return "g";
}

/** Il corpo dell'ancora per le API (`ThreadAnchorBody`). */
export function threadTargetOf(key: string): ThreadTarget {
  if (key.startsWith("d:")) return { anchor: "domanda", needId: key.slice(2) };
  if (key.startsWith("b:")) return { anchor: "beneficio", componentKey: key.slice(2) };
  return { anchor: "generale" };
}

/**
 * Le ancore che la pagina mostra: le domande mostrate e le voci dell'impatto. Un messaggio su una domanda o una
 * voce che non c'è più va con quelli «Generale», così non si perde.
 */
function shownKeys(view: ReferentAskView): Set<string> {
  return new Set([
    ...view.questions.map((q) => threadKeyOf({ anchor: "domanda", needId: q.needId })),
    ...(view.check?.benefits ?? []).map((b) => threadKeyOf({ anchor: "beneficio", componentKey: b.key })),
  ]);
}

/**
 * I messaggi di un'ancora, in ordine di tempo (quelli di un'ancora che non si vede più stanno in «g»). Con
 * `withFresh: false` senza le risposte del team non ancora viste: in «Da completare» hanno la loro scheda.
 */
export function messagesOf(view: ReferentAskView, key: string, o: { withFresh?: boolean } = {}): ReferentThreadMessageView[] {
  const shown = shownKeys(view);
  return view.thread.messages.filter((m) => {
    if (o.withFresh === false && m.side === "team" && m.fresh) return false;
    const k = threadKeyOf(m);
    return key === "g" ? k === "g" || !shown.has(k) : k === key;
  });
}

/** Una riga del filo sotto una risposta: «Il team ha chiesto: «…» · 08/11», «Hai risposto: «…» · 08/11». */
export function threadLineOf(m: ReferentThreadMessageView, today: string): string {
  const template =
    m.side === "team"
      ? m.kind === "chiarimento"
        ? TT.lineTeamAsked
        : TT.lineTeamAnswered
      : m.kind === "dubbio"
        ? TT.lineYouAsked
        : m.kind === "aggiunta"
          ? TT.lineYouAdded
          : TT.lineYouAnswered;
  return `${fillText(template, { testo: m.text })}${fillText(TT.lineDate, { data: referentDateLabel(m.createdAt, today) })}`;
}

/** Un testo lungo, accorciato a 60 caratteri con «…». */
const shortText = (text: string) => (text.length > 60 ? fillText(TT.cut, { testo: text.slice(0, 59).trimEnd() }) : text);

/**
 * (Rilascio 10, §3.11) Dove sta un messaggio, nella riga grigia sotto il titolo della scheda: «Sulla domanda «Volumi
 * mensili»», «Sulla voce «Meno errori»», «Sul caso d'uso».
 */
export function anchorLabelOf(view: ReferentAskView, a: { anchor: string; needId?: string | null; componentKey?: string | null }): string {
  if (a.anchor === "domanda") {
    const q = view.questions.find((x) => x.needId.toLowerCase() === (a.needId ?? "").toLowerCase());
    if (q) return fillText(TT.onQuestion, { testo: shortText(q.title) });
  }
  if (a.anchor === "beneficio") {
    const b = view.check?.benefits?.find((x) => x.key === a.componentKey);
    if (b) return fillText(TT.onBenefit, { testo: shortText(b.label.replace(/[.!?]+$/, "")) });
  }
  return TT.general;
}

export interface NewsView {
  /** I chiarimenti del team che aspettano la risposta del referente. */
  clarifications: ReferentThreadMessageView[];
  /** Le domande ancora aperte (dopo il primo invio: «Nuove domande»). */
  questions: QuestionSection[];
  /** Le risposte del team ai suoi dubbi che la pagina non ha ancora mostrato. */
  replies: ReferentThreadMessageView[];
  total: number;
}

/** «Da completare»: solo le cose nuove, un tocco ciascuna. */
export function newsOf(view: ReferentAskView): NewsView {
  const clarifications = view.thread.messages.filter((m) => m.side === "team" && m.kind === "chiarimento" && m.waiting);
  const questions = questionSections(view).filter((q) => q.kind === "aperta");
  const replies = view.thread.messages.filter((m) => m.side === "team" && m.kind === "risposta" && m.fresh);
  return { clarifications, questions, replies, total: clarifications.length + questions.length + replies.length };
}

/** Una voce di «Da completare»: il suo numero, il tipo, l'ancora. */
export interface NewsEntry {
  /** Il messaggio (chiarimento, risposta del team) o l'esigenza (domanda). */
  id: string;
  kind: "chiarimento" | "domanda" | "risposta";
  /** (Rilascio 10, §3.11) Il tipo, senza numeri: «Chiarimento», «Nuova domanda», «Risposta del team». */
  label: string;
  /** «Sulla domanda «Volumi mensili»»; vuota per una domanda nuova. */
  anchorLabel: string;
  /** La posizione (1…n), per «Manca ancora il punto 2.». */
  position: number;
}

/**
 * Le voci di «Novità» in ordine: prima i chiarimenti, poi le domande nuove, poi le risposte da leggere. (Rilascio 10,
 * §3.11) Il tipo senza «1 di 3»: il solo numero della pagina sta nella barra.
 */
export function newsEntries(view: ReferentAskView): NewsEntry[] {
  const n = newsOf(view);
  const out: Omit<NewsEntry, "label" | "position">[] = [
    ...n.clarifications.map((m) => ({ id: m.id, kind: "chiarimento" as const, anchorLabel: anchorLabelOf(view, m) })),
    ...n.questions.map((q) => ({ id: q.needId, kind: "domanda" as const, anchorLabel: "" })),
    ...n.replies.map((m) => ({ id: m.id, kind: "risposta" as const, anchorLabel: anchorLabelOf(view, m) })),
  ];
  return out.map((e, i) => ({ ...e, position: i + 1, label: e.kind === "chiarimento" ? TT.clarification : e.kind === "domanda" ? TT.newQuestion : TT.teamReply }));
}

/** «Manca ancora il punto 2.», «Mancano ancora i punti 1 e 3.» */
export function newsMissingText(positions: readonly number[]): string {
  const list = [...positions].sort((a, b) => a - b);
  if (list.length === 1) return fillText(TT.missingOne, { k: list[0] });
  return fillText(TT.missingMany, { list: `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}` });
}

/** Il dubbio del referente a cui risponde una risposta del team (per «Il tuo dubbio: «…»»), oppure null. */
export function doubtOf(view: ReferentAskView, reply: ReferentThreadMessageView): ReferentThreadMessageView | null {
  return reply.replyTo ? (view.thread.messages.find((m) => m.id === reply.replyTo) ?? null) : null;
}

/** Che cosa si può fare su una risposta già inviata: «Modifica» finché non è «A posto», poi «Aggiungi qualcosa»; e «Ho un dubbio». */
export type ThreadAction = "edit" | "add" | "doubt";

export function threadActionsOf(view: ReferentAskView, target: { kind: "domanda"; question: ReferentQuestionView } | { kind: "beneficio" } | { kind: "generale" }): ThreadAction[] {
  if (!view.thread.open) return [];
  if (target.kind === "domanda") {
    const q = target.question;
    if (q.state === "gestita") return [];
    if (q.state === "aperta") return ["doubt"];
    return q.editable ? ["edit", "doubt"] : ["add", "doubt"];
  }
  const sent = Boolean(view.check?.submittedAt);
  if (target.kind === "beneficio") return sent ? ["add", "doubt"] : [];
  return sent ? ["add", "doubt"] : ["doubt"];
}

/** «Aggiornata il 08/11.» per una risposta cambiata dopo l'invio, oppure null. */
export function updatedLine(q: ReferentQuestionView, today: string): string | null {
  return q.answer?.editedAt ? fillText(TT.updatedOn, { data: referentDateLabel(q.answer.editedAt, today) }) : null;
}

/** Il testo che «Modifica» mette nel campo: la risposta scritta, mai «Non lo so». */
export function editableText(q: ReferentQuestionView): string {
  if (!q.answer || q.answer.dontKnow || q.answer.alreadyAttached) return "";
  return q.answer.text ?? "";
}

/** Le risposte del team che la pagina mostra adesso e non ha ancora segnato «viste». */
export function freshReplyIds(view: ReferentAskView): string[] {
  return view.thread.messages.filter((m) => m.side === "team" && m.fresh).map((m) => m.id);
}

// ─── (Rilascio 10, §3.11) Lavoro finito: «Le tue risposte» e «Scrivi al team» ─

/**
 * Quante righe ha «Le tue risposte (n)»: la conferma del caso d'uso, ogni voce delle stime (o la riga del tempo) e ogni
 * domanda già chiusa (inviata, o a cui ha pensato il team). Zero: niente da mostrare.
 */
export function sentCount(view: ReferentAskView): number {
  const sent = view.check?.submittedAt ? 1 + (view.check.benefits ? view.check.benefits.length : 1) : 0;
  return sent + view.questions.filter((q) => q.state !== "aperta").length;
}

/** «Le tue risposte (10)». */
export function sentSummary(view: ReferentAskView): string {
  return fillText(TT.yourAnswers, { n: sentCount(view) });
}

/** Una scelta di «Su cosa?»: dove va il messaggio e che cosa si può scrivere lì. */
export interface WriteTarget {
  /** La chiave dell'ancora (`threadKeyOf`). */
  key: string;
  /** Il testo dell'opzione: «Il caso d'uso», il nome della voce, il titolo della domanda. */
  label: string;
  /** «Aggiungi qualcosa» e/o «Ho un dubbio»: mai «Modifica», che sta nella riga della risposta. */
  kinds: ("add" | "doubt")[];
}

/**
 * (Rilascio 10, §3.11) Le scelte di «Scrivi al team» con «Su cosa?», nell'ordine della pagina: il caso d'uso, le voci
 * delle stime, le domande già inviate. Le stesse regole del filo (`threadActionsOf`): su una risposta che si modifica
 * ancora solo «Ho un dubbio» (un'aggiunta la chiuderebbe: «Modifica» resta nella sua riga); niente sulle domande a cui ha
 * pensato il team, niente con il link chiuso.
 */
export function writeTargets(view: ReferentAskView): WriteTarget[] {
  const kindsOf = (actions: readonly ThreadAction[]) => actions.filter((a): a is "add" | "doubt" => a === "add" || a === "doubt");
  const out: WriteTarget[] = [];
  const general = kindsOf(threadActionsOf(view, { kind: "generale" }));
  if (general.length) out.push({ key: "g", label: TT.writeGeneral, kinds: general });
  for (const b of view.check?.submittedAt ? (view.check.benefits ?? []) : []) {
    const kinds = kindsOf(threadActionsOf(view, { kind: "beneficio" }));
    if (kinds.length) out.push({ key: threadKeyOf({ anchor: "beneficio", componentKey: b.key }), label: shortText(b.label.replace(/[.!?]+$/, "")), kinds });
  }
  for (const q of questionSections(view)) {
    if (q.kind !== "inviata") continue;
    const kinds = kindsOf(threadActionsOf(view, { kind: "domanda", question: q.question }));
    if (kinds.length) out.push({ key: threadKeyOf({ anchor: "domanda", needId: q.needId }), label: shortText(q.title), kinds });
  }
  return out;
}

/** (Rilascio 10, §3.11) La descrizione del passo 1 si legge in 6 righe; il resto con «Leggi tutto». */
export const DESCRIPTION_LINES = 6;
/** I caratteri di una riga della descrizione, circa: al telefono (375 px) e dai 640 px (la colonna di 40rem). */
const LINE_CHARS = { phone: 40, wide: 72 } as const;

function linesOf(text: string, perLine: number): number {
  return text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.trim().length / perLine)), 0);
}

/**
 * Dove la descrizione supera le 6 righe e si accorcia, con «Leggi tutto»: al telefono e dai 640 px. Una stima dal testo,
 * senza misurare la pagina: lo stesso risultato sul server e nel browser.
 */
export function descriptionClamp(text: string | null | undefined): { phone: boolean; wide: boolean } {
  if (!text) return { phone: false, wide: false };
  return { phone: linesOf(text, LINE_CHARS.phone) > DESCRIPTION_LINES, wide: linesOf(text, LINE_CHARS.wide) > DESCRIPTION_LINES };
}
