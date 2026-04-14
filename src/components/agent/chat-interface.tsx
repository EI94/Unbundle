"use client";

import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useMemo, useState } from "react";
import {
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Globe,
  Search,
} from "lucide-react";

interface ChatInterfaceProps {
  workspaceId: string;
  conversationType: string;
  departmentId?: string;
  welcomeMessage?: string;
  suggestions?: string[];
  initialMessages?: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
  }>;
}

const THINKING_MESSAGES = [
  "Sto ragionando...",
  "Analizzo le informazioni...",
  "Elaboro la risposta...",
];

const TOOL_THINKING: Record<string, string> = {
  webSearch: "Cerco informazioni online...",
  saveCompanyValueThesis: "Salvo la value thesis...",
  saveSystemBoundary: "Definisco il perimetro...",
  createDepartment: "Creo la funzione...",
  saveStrategicGoal: "Salvo l'obiettivo...",
  saveActivity: "Salvo l'attività...",
  updateActivityClassification: "Classifico l'attività...",
  linkActivityDependency: "Collego la dipendenza...",
  markDepartmentMapped: "Completo il mapping...",
};

const TOOL_DONE: Record<string, string> = {
  webSearch: "Ricerca completata",
  saveCompanyValueThesis: "Value thesis salvata",
  saveSystemBoundary: "Perimetro definito",
  createDepartment: "Funzione creata",
  saveStrategicGoal: "Obiettivo salvato",
  saveActivity: "Attività salvata",
  updateActivityClassification: "Classificazione aggiornata",
  linkActivityDependency: "Dipendenza collegata",
  markDepartmentMapped: "Mapping completato",
};

export function ChatInterface({
  workspaceId,
  conversationType,
  departmentId,
  welcomeMessage,
  suggestions = [],
  initialMessages = [],
}: ChatInterfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [waitingSeconds, setWaitingSeconds] = useState(0);

  const welcomeMessages: UIMessage[] = [];
  if (initialMessages.length === 0 && welcomeMessage) {
    welcomeMessages.push({
      id: "welcome",
      role: "assistant",
      parts: [{ type: "text" as const, text: welcomeMessage }],
    });
  }

  const seedMessages: UIMessage[] =
    initialMessages.length > 0
      ? initialMessages.map((m) => ({
          id: m.id,
          role: m.role,
          parts: [{ type: "text" as const, text: m.content }],
        }))
      : welcomeMessages;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/chat",
        body: { workspaceId, conversationType, departmentId },
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            messages: messages.map((m) => ({
              role: m.role,
              content:
                m.parts
                  ?.filter(
                    (p): p is { type: "text"; text: string } =>
                      p.type === "text"
                  )
                  .map((p) => p.text)
                  .join("") ?? "",
            })),
            workspaceId:
              (body as Record<string, unknown>)?.workspaceId ?? workspaceId,
            conversationType:
              (body as Record<string, unknown>)?.conversationType ??
              conversationType,
            departmentId:
              (body as Record<string, unknown>)?.departmentId ?? departmentId,
          },
        }),
      }),
    [workspaceId, conversationType, departmentId]
  );

  const chat = useChat({
    transport,
    messages: seedMessages,
  });

  const { messages, status, error } = chat;
  const isLoading = status === "streaming" || status === "submitted";
  const isThinking = status === "submitted";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (!isLoading) {
      setWaitingSeconds(0);
      return;
    }
    setWaitingSeconds(0);
    const interval = setInterval(() => {
      setWaitingSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isLoading]);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = inputRef.current?.value?.trim();
    if (!value || isLoading) return;
    if (inputRef.current) inputRef.current.value = "";
    chat.sendMessage({
      role: "user",
      parts: [{ type: "text", text: value }],
    });
  };

  const handleSuggestion = (text: string) => {
    if (isLoading) return;
    chat.sendMessage({
      role: "user",
      parts: [{ type: "text", text }],
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const getMessageText = (message: UIMessage): string =>
    message.parts
      ?.filter(
        (p): p is { type: "text"; text: string } => p.type === "text"
      )
      .map((p) => p.text)
      .join("") ?? "";

  const renderMarkdown = (text: string) => {
    const lines = text.split("\n");
    return lines.map((line, li) => {
      if (line.startsWith("— ") || line.startsWith("- ")) {
        const content = line.replace(/^[—-]\s*/, "");
        return (
          <div key={li} className="flex gap-2 ml-1">
            <span className="text-muted-foreground shrink-0">—</span>
            <span>{renderInline(content)}</span>
          </div>
        );
      }
      return (
        <span key={li}>
          {li > 0 && <br />}
          {renderInline(line)}
        </span>
      );
    });
  };

  const renderInline = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, pi) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={pi} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={pi}>{part}</span>;
    });
  };

  const getThinkingMessage = () => {
    if (waitingSeconds < 3) return THINKING_MESSAGES[0];
    if (waitingSeconds < 8) return THINKING_MESSAGES[1];
    if (waitingSeconds < 15) return THINKING_MESSAGES[2];
    return `Ancora in elaborazione (${waitingSeconds}s)...`;
  };

  const showSuggestions =
    suggestions.length > 0 && messages.length <= 1 && !isLoading;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6" ref={scrollRef}>
        <div className="mx-auto max-w-2xl space-y-6">
          {messages.map((message) => {
            const text = getMessageText(message);
            const toolParts =
              message.parts?.filter((p) => p.type?.startsWith?.("tool-")) ??
              [];

            if (message.role === "user") {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl bg-accent px-4 py-3 text-sm">
                    {text}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={message.id}
                className="text-sm leading-relaxed text-muted-foreground"
              >
                {text && (
                  <div className="whitespace-pre-wrap">{renderMarkdown(text)}</div>
                )}
                {toolParts.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {toolParts.map((part, i) => {
                      const p = part as Record<string, unknown>;
                      const toolName = (p.toolName as string) ?? "tool";
                      const state = p.state as string | undefined;
                      const isDone = state === "output";
                      const isSearch = toolName === "webSearch";

                      return (
                        <div
                          key={i}
                          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                            isDone
                              ? "border-border text-muted-foreground"
                              : "border-foreground/10 text-foreground animate-pulse"
                          }`}
                        >
                          {isDone ? (
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                          ) : isSearch ? (
                            <Search className="h-3 w-3 animate-spin" />
                          ) : (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          )}
                          <span>
                            {isDone
                              ? TOOL_DONE[toolName] ?? toolName
                              : TOOL_THINKING[toolName] ?? "Elaboro..."}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Thinking indicator */}
          {isLoading &&
            messages.length > 0 &&
            messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-foreground/30 animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-foreground/30 animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-foreground/30 animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
                <span className="text-xs">{getThinkingMessage()}</span>
              </div>
            )}

          {/* Streaming indicator */}
          {status === "streaming" && waitingSeconds > 20 && (
            <div className="text-xs text-muted-foreground/60">
              La risposta sta arrivando, potrebbe richiedere qualche secondo in pi&ugrave;...
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Si &egrave; verificato un errore</p>
                <p className="text-xs mt-0.5 opacity-80">
                  {error.message?.includes("fetch")
                    ? "Connessione persa. Controlla la rete e riprova."
                    : error.message?.includes("401")
                      ? "Sessione scaduta. Ricarica la pagina."
                      : error.message?.includes("429")
                        ? "Troppe richieste. Attendi qualche secondo."
                        : "Errore imprevisto. Riprova a inviare il messaggio."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {showSuggestions && (
        <div className="px-6 pb-3">
          <div className="mx-auto max-w-2xl flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleSuggestion(s)}
                className="rounded-full border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-border px-6 py-4">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-2xl items-end gap-3"
        >
          <textarea
            ref={inputRef}
            onKeyDown={onKeyDown}
            placeholder={
              isLoading ? "Attendi la risposta..." : "Scrivi la tua risposta..."
            }
            className="flex-1 resize-none rounded-xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[48px] max-h-[200px] disabled:opacity-50"
            rows={1}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-20"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
