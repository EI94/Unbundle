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

/** Che cosa il browser rimanda alla rotta: un turno di testo per messaggio, senza le risposte rifiutate. */
export function chatRequestMessages(messages: readonly MessageLike[]): Array<{ role: string; content: string }> {
  return messages.filter((message) => !isRefusedReply(message)).map((message) => ({ role: message.role, content: messageText(message) }));
}
