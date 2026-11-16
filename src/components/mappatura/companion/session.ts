/**
 * «Mappatura board»: la conversazione dell'assistente accanto alla board, e come i suoi salvataggi arrivano alla board
 * aperta (docs/mappatura/MAPPATURA-BOARD-PIANO.md §5.3).
 *
 * - La conversazione è un `Chat` di AI SDK con il trasporto di sempre (`chatTransportBody` di chat-view.ts, la rotta
 *   /api/ai/chat, il tipo «activity_mapping» e l'unità). Vive fuori dal componente, una per board aperta (lo store
 *   della board fa da chiave): se il pannello dell'assistente si chiude e si riapre, la risposta che stava arrivando e i
 *   messaggi di questa visita restano.
 * - Ogni parte di un tool della board (salvare, aggiornare, collegare, completare) che finisce bene (`toolOutcome`
 *   «done») rilegge la board, una volta per `toolCallId`: il passo compare sulla mappa un momento dopo «Passo salvato»,
 *   senza ricaricare e senza toccare quello che la persona sta scrivendo (`pull` rimette sopra le sue modifiche). Un tool
 *   fallito o nascosto non rilegge niente.
 * - Alla fine del turno la board si rilegge ancora una volta (un tool la cui parte non è arrivata al browser).
 * - Dopo «Completa la mappatura» della chat, il toast della board «Mappatura completata.» con «Apri», che porta alla
 *   scheda «Classificazione»: la scheda non cambia da sola sotto chi sta leggendo.
 *
 * Senza React: si prova con Node, con il Claude finto e la rotta vera.
 */
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { HIDDEN_TOOLS, MAPPING_TOOL_LABELS, chatTransportBody, toolNameOf, toolOutcome, type ChatUIMessage } from "../../agent/chat-view.ts";
import type { BoardClient } from "../store/board-client.ts";
import { CLASSIFICATION_TEXT } from "../classification/text.ts";
import { welcomeText } from "./text.ts";

/** I tool che scrivono sulla board: dopo ognuno la board si rilegge. */
export const BOARD_TOOLS: ReadonlySet<string> = new Set(Object.keys(MAPPING_TOOL_LABELS));
/** Il tool che completa la mappatura: dopo di lui il toast con «Apri». */
export const COMPLETION_TOOL = "markDepartmentMapped";

type PartLike = { type: string; toolCallId?: unknown; toolName?: unknown; state?: unknown; output?: unknown };
type MessageLike = { role: string; parts?: ReadonlyArray<PartLike> };

/** Le chiamate dei tool della board finite bene, nell'ordine dei messaggi. */
export function finishedBoardTools(messages: readonly MessageLike[]): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts ?? []) {
      if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") continue;
      const name = toolNameOf(part);
      if (!BOARD_TOOLS.has(name) || HIDDEN_TOOLS.has(name)) continue;
      if (typeof part.toolCallId !== "string" || part.toolCallId === "" || toolOutcome(part) !== "done") continue;
      out.push({ id: part.toolCallId, name });
    }
  }
  return out;
}

/** Chi tiene il conto dei tool già visti: ognuno rilegge la board una volta sola. */
export function createToolWatch(initial: readonly MessageLike[] = []) {
  const seen = new Set(finishedBoardTools(initial).map((call) => call.id));
  return {
    /** I tool finiti e non ancora visti: `pull` se ce n'è almeno uno, `completed` se tra loro c'è il completamento. */
    take(messages: readonly MessageLike[]): { pull: boolean; completed: boolean } {
      let pull = false;
      let completed = false;
      for (const call of finishedBoardTools(messages)) {
        if (seen.has(call.id)) continue;
        seen.add(call.id);
        pull = true;
        if (call.name === COMPLETION_TOOL) completed = true;
      }
      return { pull, completed };
    },
  };
}

export interface CompanionSessionDeps {
  workspaceId: string;
  departmentId: string;
  unitName: string;
  hasDocuments: boolean;
  initialMessages: ReadonlyArray<{ id: string; role: "user" | "assistant"; content: string }>;
  client: Pick<BoardClient, "pull" | "notify">;
  openClassification(): void;
  /** Solo per i test: la fetch del trasporto. */
  fetch?: typeof fetch;
}

export interface CompanionSession {
  chat: Chat<ChatUIMessage>;
  /** I messaggi come arrivano: rilegge la board dopo ogni tool della board finito. */
  observe(messages: readonly MessageLike[]): void;
}

/** I messaggi da cui parte la chat: quelli salvati, o il benvenuto (che non va al modello: chatHistory lo toglie). */
export function seedMessages(deps: Pick<CompanionSessionDeps, "initialMessages" | "unitName" | "hasDocuments">): ChatUIMessage[] {
  if (deps.initialMessages.length > 0) {
    return deps.initialMessages.map((message) => ({ id: message.id, role: message.role, parts: [{ type: "text" as const, text: message.content }] }));
  }
  return [{ id: "welcome", role: "assistant", parts: [{ type: "text", text: welcomeText(deps.unitName, deps.hasDocuments) }] }];
}

export function createCompanionSession(deps: CompanionSessionDeps): CompanionSession {
  const messages = seedMessages(deps);
  const watch = createToolWatch(messages);
  const completed = () =>
    deps.client.notify(CLASSIFICATION_TEXT.after.completed, { label: CLASSIFICATION_TEXT.after.open, run: () => deps.openClassification() });
  const observe = (current: readonly MessageLike[]) => {
    const seen = watch.take(current);
    if (seen.pull) void deps.client.pull();
    if (seen.completed) completed();
  };
  const context = { workspaceId: deps.workspaceId, conversationType: "activity_mapping", departmentId: deps.departmentId };
  const transport = new DefaultChatTransport<ChatUIMessage>({
    api: "/api/ai/chat",
    body: context,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    // Solo il testo di ogni turno, senza le risposte rifiutate e le loro domande (chat-view.ts).
    prepareSendMessagesRequest: ({ messages: sent, body }) => ({ body: chatTransportBody(sent, body, context) }),
  });
  const chat = new Chat<ChatUIMessage>({
    messages,
    transport,
    // Alla fine del turno (anche interrotto): i tool non ancora visti, e la board riletta una volta.
    onFinish: ({ messages: final }) => {
      if (watch.take(final).completed) completed();
      void deps.client.pull();
    },
  });
  return { chat, observe };
}

const sessions = new WeakMap<object, CompanionSession>();

/** La conversazione della board aperta: una per store della board, creata la prima volta che serve. */
export function companionSessionFor(client: object, create: () => CompanionSession): CompanionSession {
  let session = sessions.get(client);
  if (!session) {
    session = create();
    sessions.set(client, session);
  }
  return session;
}
