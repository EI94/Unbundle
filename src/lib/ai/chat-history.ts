/**
 * La storia della chat che arriva dal browser, come la vuole streamText: un messaggio di testo per turno.
 * Modulo puro (lo importano anche i test con Node).
 *
 * Quattro regole nate con Claude Sonnet 5.5 (src/lib/ai/models.ts):
 * - un turno senza testo si toglie. Il browser rimanda solo le parti di testo, quindi un turno
 *   dell'assistente rifiutato dal modello, o fatto di soli tool, arriverebbe vuoto: l'API risponde 400
 *   a un blocco di testo vuoto e la chat resterebbe ferma fino al ricaricamento della pagina;
 * - passano solo i ruoli `user` e `assistant`. Questo modello accetta messaggi `system` dentro la
 *   conversazione, con l'autorità delle istruzioni dell'app: dal browser non devono arrivare;
 * - del turno resta solo il testo: le parti di ragionamento (le note tra i tool, con le loro firme) si tolgono
 *   intere. Un blocco di ragionamento vale solo nella conversazione che l'ha prodotto, e toglierli tutti è ammesso;
 *   modificarne uno no. Dentro il giro dei tool di un turno li rimanda l'SDK, uguali;
 * - la storia comincia con un turno dell'utente: quelli dell'assistente prima del primo turno dell'utente si tolgono.
 *   In una conversazione nuova il browser manda per primo il messaggio di benvenuto, che sta solo nell'interfaccia
 *   (chat-interface.tsx) e che il modello non ha scritto; l'API risponde 400 a un primo messaggio dell'assistente
 *   («First message must be user»). Il server decide: il browser può continuare a mandarlo.
 */
export type ChatHistoryMessage = { role: "user" | "assistant"; content: string };

function extractContent(msg: Record<string, unknown>): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.parts)) {
    return (msg.parts as Array<{ type?: string; text?: string }>)
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text!)
      .join("");
  }
  return "";
}

export function chatHistory(rawMessages: Array<Record<string, unknown>>): ChatHistoryMessage[] {
  const turns = rawMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as ChatHistoryMessage["role"], content: extractContent(m) }))
    .filter((m) => m.content.trim().length > 0);
  const firstUserTurn = turns.findIndex((m) => m.role === "user");
  return firstUserTurn === -1 ? [] : turns.slice(firstUserTurn);
}

/**
 * Il testo delle domande che chiudono la storia di chatHistory, dalla più recente: dopo un turno interrotto (la domanda
 * salvata, nessuna risposta) sono più d'una, e il modello le riceve unite, come un turno solo.
 */
export function closingQuestions(history: readonly ChatHistoryMessage[]): string[] {
  const questions: string[] = [];
  for (let at = history.length - 1; at >= 0 && history[at].role === "user"; at -= 1) questions.push(history[at].content);
  return questions;
}

/**
 * Le domande da togliere dai messaggi salvati quando il modello rifiuta le domande che chiudono la storia (`closing`, da
 * closingQuestions, dalla più recente): quella appena salvata, `questionId`, e le altre tra quelle salvate prima di lei,
 * fino alla prima risposta. Il browser le toglie tutte dalla sua storia (chatRequestMessages in
 * src/components/agent/chat-view.ts); ricaricando la pagina, una rimasta tornerebbe al modello unita alla domanda dopo.
 *
 * Non per posizione soltanto: la conversazione è di tutto il workspace e i messaggi non hanno autore, quindi tra due
 * domande unite può esserci quella di un'altra persona, salvata nel frattempo. Andando all'indietro, una domanda si
 * toglie solo se il suo testo è quello della prossima domanda da trovare; le altre si saltano. `saved`: i messaggi della
 * conversazione, in ordine.
 */
export function refusedQuestionIds(
  saved: ReadonlyArray<{ id: string; role: string; content: string }>,
  questionId: string,
  closing: readonly string[],
): string[] {
  const ids = [questionId];
  let next = 1;
  for (let at = saved.findIndex((m) => m.id === questionId) - 1; at >= 0 && next < closing.length && saved[at].role === "user"; at -= 1) {
    if (saved[at].content !== closing[next]) continue;
    ids.push(saved[at].id);
    next += 1;
  }
  return ids;
}
