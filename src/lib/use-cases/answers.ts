/**
 * «Rispondi» su «Serve info» (decisione D17, 19/10/2026; docs/use-case/DESIGN.md §1.1, §3.4,
 * §3.5, §6.9, §10.3, §11).
 *
 * Chi ha proposto uno use case risponde alla domanda del team (la nota pubblica di «Serve info»)
 * dalla pagina: dal pannello e dalla scheda. La risposta:
 * - si aggiunge alla proposta in `intake.risposte`, una lista di `{ at, text }` (data ISO e
 *   testo semplice, al massimo `ANSWER_MAX` caratteri; si tengono le ultime `ANSWERS_KEPT`).
 *   È un testo dei dati raccolti: lo leggono i revisori nella scheda, lo oscura «Oscura testo»
 *   (campo «Dati raccolti da Claude»), non entra mai in un conteggio o in un filtro per persona;
 * - riporta la scheda in «Da decidere»: `portfolio_review_status` da `needs_inputs` a
 *   `in_review`, quindi per il connettore IN_VALUTAZIONE (o POSSIBILE_DOPPIONE, se segnata);
 * - resta «in attesa di una decisione» finché il team non decide: `intake.rispostaInAttesa` è la
 *   data (`at`) della risposta; ogni decisione la toglie (`decisions.ts`). Una scheda rimandata,
 *   o riaperta dopo «Non avviare», non ha più una risposta in attesa, anche se torna in «Da
 *   valutare»;
 * - lascia nella Storia una riga senza testo (`modificato`, campo `intake`, chi ha agito
 *   `proponente`, senza persona: la Storia non registra chi propone, §10.3);
 * - avvisa i revisori in campanella.
 *
 * Rispondono solo chi ha proposto (`isOwnProposal`) e solo in «Serve info»: lo controlla il
 * servizio (`answerInfoRequest`), con le regole di qui.
 *
 * Modulo puro: nessun import, nessun `server-only`.
 */

/** Una risposta salvata in `intake.risposte`. */
export interface InfoAnswer {
  /** Quando, ISO 8601 (UTC). */
  at: string;
  /** Il testo, semplice: niente markup, niente caratteri di controllo tranne gli a capo. */
  text: string;
}

/** «2.000»: le migliaia col punto anche sotto 10.000 (it-IT da solo non le raggruppa). */
export function groupedCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Lunghezza massima di una risposta, in caratteri. */
export const ANSWER_MAX = 2_000;
/** Lunghezza minima: «Sì» non basta a rispondere a una domanda del team. */
export const ANSWER_MIN = 3;
/** Le risposte tenute in `intake.risposte`: le ultime. */
export const ANSWERS_KEPT = 20;
/** La chiave di `intake`. */
export const ANSWERS_INTAKE_KEY = "risposte";
/**
 * La chiave di `intake` con la data (`at`) della risposta ancora da decidere. La scrive
 * `answerInfoRequest`, la toglie ogni decisione (`applyDecision`). Campo tecnico: non esce mai
 * dal server (non è in `REVIEWER_INTAKE_KEYS` né in `CARD_INTAKE_KEYS`).
 */
export const ANSWER_PENDING_INTAKE_KEY = "rispostaInAttesa";

/**
 * I testi di «Rispondi» (§14.3). Quelli che nominano chi valuta usano il nome del team da solo,
 * senza articolo né «team» davanti (§14.2): `askedTitle`, `questionLabel`, `answerHint`.
 */
export const ANSWER_TEXT = Object.freeze({
  label: "La tua risposta",
  placeholder: "Scrivi qui quello che serve sapere.",
  submit: "Invia la risposta",
  sending: "Invio…",
  toast: "Risposta inviata. Lo use case torna in valutazione.",
  /** I revisori, nella scheda. */
  reviewerTitle: "Risposte di chi ha proposto",
  /** I revisori, nel pannello laterale: l'ultima risposta, dopo la domanda. */
  reviewerLatestTitle: "Risposta di chi ha proposto",
  answeredOn: "Risposta del",
  tooShort: `Scrivi almeno ${ANSWER_MIN} caratteri.`,
  tooLong: `Scrivi al massimo ${groupedCount(ANSWER_MAX)} caratteri.`,
  notOwn: "Puoi rispondere solo agli use case che hai proposto.",
  notAsked: "Si risponde solo quando il team chiede informazioni.",
  /** La riga della Storia, senza testo. */
  history: "Risposta di chi ha proposto",
  /** La campanella dei revisori: titolo con il titolo della scheda, descrizione fissa. */
  signalTitlePrefix: "Risposta ricevuta",
  signalDescription: "Chi ha proposto ha risposto alla domanda: lo use case torna in «Da decidere».",
  /** La riga dei revisori in «Da decidere», al posto di «Nuova», finché non si decide. */
  received: "Risposta ricevuta",
});

/** Il titolo del capitolo e dell'avviso del contributore in «Serve info»: «AI Builder ti chiede informazioni». */
export function askedTitle(teamName: string): string {
  return `${teamName} ti chiede informazioni`;
}

/** La domanda, sopra il campo e sopra la risposta: «La domanda di AI Builder». */
export function questionLabel(teamName: string): string {
  return `La domanda di ${teamName}`;
}

/** L'aiuto sotto il campo della risposta. */
export function answerHint(teamName: string): string {
  return `La legge ${teamName}. Non scrivere dati personali.`;
}

/** I caratteri di controllo, tranne a capo e tabulazione. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Il testo di una risposta come si salva: a capo uniformi (`\n`), senza caratteri di controllo,
 * senza spazi ai lati, al massimo due righe vuote di fila. Errori in italiano.
 */
export function parseAnswerText(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: ANSWER_TEXT.tooShort };
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const length = [...text].length;
  if (length < ANSWER_MIN) return { ok: false, error: ANSWER_TEXT.tooShort };
  if (length > ANSWER_MAX) return { ok: false, error: ANSWER_TEXT.tooLong };
  return { ok: true, value: text };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Le risposte di `intake`, dalla più vecchia; quelle malformate si saltano. */
export function answersOf(intake: unknown): InfoAnswer[] {
  const list = isRecord(intake) ? intake[ANSWERS_INTAKE_KEY] : null;
  if (!Array.isArray(list)) return [];
  const out: InfoAnswer[] = [];
  for (const item of list) {
    if (!isRecord(item) || typeof item.at !== "string" || typeof item.text !== "string") continue;
    if (Number.isNaN(Date.parse(item.at)) || !item.text.trim()) continue;
    out.push({ at: item.at, text: item.text });
  }
  return out;
}

/** Le risposte dopo una nuova: in coda, tenute le ultime `ANSWERS_KEPT`. */
export function withAnswer(intake: unknown, answer: InfoAnswer): InfoAnswer[] {
  return [...answersOf(intake), answer].slice(-ANSWERS_KEPT);
}

/** La nota pubblica come la legge chi ha proposto (`projectForContributor`): null se vuota. */
function questionOf(note: unknown): string | null {
  return typeof note === "string" && note.trim() !== "" ? note : null;
}

/**
 * La domanda che la pagina mostrava (`seen`) è la nota pubblica di adesso (`current`)? Una
 * risposta vale per la domanda letta: se nel frattempo il team ne ha fatta un'altra, o ha
 * cambiato la nota, la risposta non si salva (§6.8).
 */
export function sameQuestion(seen: unknown, current: unknown): boolean {
  return questionOf(seen) === questionOf(current);
}

/**
 * Si può rispondere? Solo chi ha proposto (`own`) e solo in «Serve info»
 * (`da_valutare.serve_info`, cioè SERVONO_INFORMAZIONI per il connettore).
 */
export function answerRefusal(input: { own: boolean; phase: string; subState: string }): "non_propria" | "non_richiesta" | null {
  if (!input.own) return "non_propria";
  if (input.phase !== "da_valutare" || input.subState !== "serve_info") return "non_richiesta";
  return null;
}

/** I campi di `pendingAnswer`: `intake` della riga, fase e sotto-stato di adesso. */
export interface PendingAnswerInput {
  intake: unknown;
  phase: string;
  subState: string | null;
}

/**
 * L'ultima risposta, se è ancora in attesa di una decisione; altrimenti null. In attesa vuol dire:
 * `intake.rispostaInAttesa` è la data dell'ultima risposta (nessuna decisione dopo, `decisions.ts`
 * la toglie) e lo use case è in «Da valutare», non in «Serve info» di nuovo. Non la si indovina
 * dalla fase: «Da valutare» comprende anche le valutate e le rimandate, e «Riapri» riporta in
 * «Da decidere» una scheda che aveva risposte vecchie.
 */
export function pendingAnswer(input: PendingAnswerInput): InfoAnswer | null {
  if (input.phase !== "da_valutare" || input.subState === "serve_info") return null;
  const at = isRecord(input.intake) ? input.intake[ANSWER_PENDING_INTAKE_KEY] : null;
  if (typeof at !== "string") return null;
  const answers = answersOf(input.intake);
  const last = answers[answers.length - 1];
  return last && last.at === at ? last : null;
}

/** Una risposta arrivata e non ancora decisa (`pendingAnswer`). */
export function isAnswerPending(input: PendingAnswerInput): boolean {
  return pendingAnswer(input) !== null;
}

/** Il titolo del segnale della campanella: «Risposta ricevuta: XX-0024 Riepilogo…», al massimo 500 caratteri. */
export function answerSignalTitle(card: { code: string | null; title: string }): string {
  const name = card.code ? `${card.code} ${card.title}` : card.title;
  const text = `${ANSWER_TEXT.signalTitlePrefix}: ${name}`;
  return [...text].length > 500 ? `${[...text].slice(0, 499).join("")}…` : text;
}
