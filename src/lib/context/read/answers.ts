/**
 * Le risposte del referente come fonte di «Contesto» (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.11, D2): il
 * testo che la lettura riceve non si salva da nessuna parte. Si compone dal vivo dalle risposte inviate di una richiesta
 * (src/lib/db/queries/context-referent.ts), nell'ordine delle sue domande:
 *
 *   Domanda: Quanti ordini arrivano ogni mese?
 *   Risposta: Circa 200, quasi tutti per e-mail.
 *   Nota: L'elenco dei fornitori è nel file allegato.
 *
 * - Solo il testo del referente: le risposte del team (`revisore`) restano fuori, e così «Non ce l'ho» con il suo
 *   commento («Chi potrebbe saperlo?»: spesso un nome). Un file senza parole non è testo.
 * - Il filo: «Aggiungi qualcosa» è una nota della sua domanda; la risposta a un chiarimento porta con sé la domanda del
 *   team. I dubbi del referente e le risposte del team ai dubbi restano fuori, e così la conferma dello use case e le voci
 *   dei benefici: sono stime sul caso, non il lavoro del cliente.
 * - Solo quello che il referente ha scritto dopo aver accettato un'informativa che lo permette (`afterNotice`, calcolato
 *   dalla query): una risposta data prima resta fuori finché non la cambia.
 *
 * Modulo puro.
 */

/** Le parole davanti alle righe del testo composto (per il modello, non per lo schermo). */
export const ANSWER_LINE = Object.freeze({ question: "Domanda", answer: "Risposta", note: "Nota" });

/** Una domanda della richiesta, come l'ha vista il referente. */
export interface AnswerQuestion {
  needId: string;
  question: string;
  position: number;
}

/** Una risposta inviata e non tolta. `afterNotice`: inviata (o cambiata) dopo l'informativa che permette di leggerla. */
export interface AnswerEntry {
  needId: string;
  source: string;
  body: string | null;
  dontKnow: boolean;
  comment: string | null;
  afterNotice: boolean;
}

/** Un messaggio del filo, nell'ordine in cui è stato scritto. */
export interface AnswerMessage {
  id: string;
  anchor: string;
  needId: string | null;
  side: string;
  kind: string;
  replyToId: string | null;
  body: string | null;
  afterNotice: boolean;
}

export interface RequestAnswers {
  questions: readonly AnswerQuestion[];
  answers: readonly AnswerEntry[];
  messages: readonly AnswerMessage[];
}

/** Un testo del referente: a capo di un tipo solo, al massimo una riga vuota di fila, niente spazi in testa e in coda. */
function cleanText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Una domanda su una riga. */
function questionLine(value: string | null | undefined): string {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

const line = (label: string, text: string) => `${label}: ${text}`;

/**
 * Il testo delle risposte di una richiesta, per la lettura: un blocco per domanda con qualcosa del referente, separati da
 * una riga vuota. Vuoto se il referente non ha scritto niente che si possa leggere.
 */
export function composeAnswersText(i: RequestAnswers): string {
  const questions = [...(Array.isArray(i?.questions) ? i.questions : [])].sort((a, b) => a.position - b.position);
  const answers = Array.isArray(i?.answers) ? i.answers : [];
  const messages = Array.isArray(i?.messages) ? i.messages : [];
  const byId = new Map(messages.map((m) => [m.id, m]));
  const blocks: string[] = [];
  for (const q of questions) {
    const lines: string[] = [];
    const answer = answers.find((a) => a.needId === q.needId && a.source === "referente" && a.afterNotice === true) ?? null;
    if (answer && answer.dontKnow !== true) {
      const body = cleanText(answer.body);
      const comment = cleanText(answer.comment);
      if (body) lines.push(line(ANSWER_LINE.answer, body));
      if (comment) lines.push(line(ANSWER_LINE.note, comment));
    }
    for (const m of messages) {
      if (m.anchor !== "domanda" || m.needId !== q.needId || m.side !== "referente" || m.afterNotice !== true) continue;
      const body = cleanText(m.body);
      if (!body) continue;
      if (m.kind === "aggiunta") lines.push(line(ANSWER_LINE.note, body));
      else if (m.kind === "risposta") {
        // La domanda del team a cui risponde: senza, «400» non vorrebbe dire niente.
        const asked = m.replyToId ? byId.get(m.replyToId) : undefined;
        const clarification = asked && asked.side === "team" && asked.kind === "chiarimento" ? questionLine(asked.body) : "";
        if (clarification) lines.push(line(ANSWER_LINE.question, clarification));
        lines.push(line(ANSWER_LINE.answer, body));
      }
    }
    const title = questionLine(q.question);
    if (lines.length > 0 && title) blocks.push([line(ANSWER_LINE.question, title), ...lines].join("\n"));
  }
  return blocks.join("\n\n");
}
