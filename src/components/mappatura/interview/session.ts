/**
 * «Intervista iniziale»: la conversazione (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7).
 *
 * Un `Chat` di AI SDK con il trasporto di sempre: la rotta /api/ai/chat, il workspace e il tipo `leadership_setup`, lo
 * stesso della Discovery (i suoi messaggi salvati, il suo prompt, i suoi tool: dati dell'azienda, valore, perimetro,
 * unità, obiettivi). Della richiesta va solo il testo di ogni turno, senza le risposte rifiutate e le loro domande
 * (`chatTransportBody` di chat-view.ts). La chat parte dai messaggi salvati, o dal benvenuto, che non va al modello
 * (chatHistory lo toglie).
 *
 * Senza React: si prova con Node.
 */
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { chatTransportBody, type ChatUIMessage } from "../../agent/chat-view.ts";
import { INTERVIEW_TEXT } from "./text.ts";

/** Il tipo della conversazione: lo stesso della Discovery, così la conversazione di prima continua. */
export const INTERVIEW_CONVERSATION = "leadership_setup";

/** Un messaggio salvato della conversazione, come lo legge la pagina. */
export type SavedMessage = { id: string; role: "user" | "assistant"; content: string };

/** I messaggi da cui parte la chat: quelli salvati, o il benvenuto. */
export function interviewSeed(saved: readonly SavedMessage[]): ChatUIMessage[] {
  if (saved.length > 0) return saved.map((message) => ({ id: message.id, role: message.role, parts: [{ type: "text" as const, text: message.content }] }));
  return [{ id: "welcome", role: "assistant", parts: [{ type: "text", text: INTERVIEW_TEXT.welcome }] }];
}

export function createInterviewChat(deps: { workspaceId: string; initialMessages: readonly SavedMessage[]; fetch?: typeof fetch }): Chat<ChatUIMessage> {
  const context = { workspaceId: deps.workspaceId, conversationType: INTERVIEW_CONVERSATION };
  const transport = new DefaultChatTransport<ChatUIMessage>({
    api: "/api/ai/chat",
    body: context,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    prepareSendMessagesRequest: ({ messages, body }) => ({ body: chatTransportBody(messages, body, context) }),
  });
  return new Chat<ChatUIMessage>({ messages: interviewSeed(deps.initialMessages), transport });
}
