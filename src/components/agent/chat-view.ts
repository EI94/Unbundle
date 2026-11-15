import type { UIMessage } from "ai";

/**
 * Che cosa la chat (chat-interface.tsx) mostra di un messaggio e che cosa rimanda alla rotta. Modulo puro: lo
 * importano anche i test con Node.
 */

/** I metadati che la rotta della chat mette sulla risposta: perché il modello si è fermato. */
export type ChatMessageMetadata = { finishReason?: string };
export type ChatUIMessage = UIMessage<ChatMessageMetadata>;

type MessageLike = { role: string; metadata?: unknown; parts?: ReadonlyArray<{ type: string; text?: string }> };

/** Al posto di una risposta che il modello ha rifiutato. */
export const CHAT_REFUSAL_NOTICE = "Non posso rispondere a questa richiesta. Prova a riformularla.";

/**
 * Una risposta rifiutata dai classificatori del modello (finishReason «content-filter»): il suo testo parziale non
 * si mostra come una risposta finita e non torna al modello nel turno dopo.
 */
export function isRefusedReply(message: MessageLike): boolean {
  return message.role === "assistant" && (message.metadata as ChatMessageMetadata | undefined)?.finishReason === "content-filter";
}

/** Il testo di un messaggio: le sole parti di testo, unite. */
export function messageText(message: MessageLike): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

/**
 * Che cosa il browser rimanda alla rotta: un turno di testo per messaggio, senza le risposte rifiutate e senza le
 * domande che le hanno avute (i turni dell'utente subito prima). Altrimenti la domanda rifiutata tornerebbe al modello
 * unita alla domanda dopo, a ogni turno. A schermo restano tutte e due, fino al ricaricamento della pagina; la rotta
 * toglie la domanda rifiutata anche dai messaggi salvati.
 */
export function chatRequestMessages(messages: readonly MessageLike[]): Array<{ role: string; content: string }> {
  const kept: MessageLike[] = [];
  for (const message of messages) {
    if (!isRefusedReply(message)) {
      kept.push(message);
      continue;
    }
    while (kept.length > 0 && kept[kept.length - 1].role === "user") kept.pop();
  }
  return kept.map((message) => ({ role: message.role, content: messageText(message) }));
}

/** Il nome del tool di una parte `tool-…` del messaggio. */
export function toolNameOf(part: { type: string; toolName?: unknown }): string {
  if (typeof part.toolName === "string" && part.toolName.length > 0) return part.toolName;
  return part.type.startsWith("tool-") ? part.type.slice(5) : "tool";
}

/** Il testo che l'API mette (in inglese) al posto di una nota interrotta dal limite dei token: non è un avanzamento. */
const INTERRUPTED_UPDATE = "This part of the response was interrupted before it finished.";

/** Una nota di avanzamento o un tool visibile, nell'ordine della risposta. */
export type ProgressItem<P> = { kind: "note"; text: string } | { kind: "tool"; part: P };

/**
 * Le note di avanzamento e i tool visibili di una risposta, nell'ordine in cui sono arrivati. Con Claude Sonnet 5.5
 * (e `display: "updates"`, src/lib/ai/models.ts) la nota che il modello scrive tra un tool e l'altro arriva come
 * parte di ragionamento, subito prima del tool che introduce: qui resta prima di quel tool. Le parti di ragionamento
 * vuote (il ragionamento vero, nascosto) non contano; i tool di `hiddenTools` non si mostrano, le loro note sì.
 */
export function progressItems<P extends { type: string; text?: string; toolName?: unknown }>(
  parts: readonly P[],
  hiddenTools: ReadonlySet<string>,
): ProgressItem<P>[] {
  const items: ProgressItem<P>[] = [];
  for (const part of parts) {
    if (part.type === "reasoning") {
      const text = part.text?.trim() ?? "";
      if (text && text !== INTERRUPTED_UPDATE) items.push({ kind: "note", text });
    } else if (part.type.startsWith("tool-") && !hiddenTools.has(toolNameOf(part))) {
      items.push({ kind: "tool", part });
    }
  }
  return items;
}
