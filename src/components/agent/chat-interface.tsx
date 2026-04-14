"use client";

import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useMemo } from "react";
import {
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
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

export function ChatInterface({
  workspaceId,
  conversationType,
  departmentId,
  welcomeMessage,
  suggestions = [],
  initialMessages = [],
}: ChatInterfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

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
            workspaceId: (body as Record<string, unknown>)?.workspaceId ?? workspaceId,
            conversationType: (body as Record<string, unknown>)?.conversationType ?? conversationType,
            departmentId: (body as Record<string, unknown>)?.departmentId ?? departmentId,
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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isLoading = status === "streaming" || status === "submitted";

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

  const renderContent = (text: string) => {
    const lines = text.split("\n");
    return lines.map((line, li) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      return (
        <span key={li}>
          {li > 0 && <br />}
          {parts.map((part, pi) => {
            if (part.startsWith("**") && part.endsWith("**")) {
              return (
                <strong key={pi} className="font-semibold text-foreground">
                  {part.slice(2, -2)}
                </strong>
              );
            }
            return <span key={pi}>{part}</span>;
          })}
        </span>
      );
    });
  };

  const toolLabels: Record<string, string> = {
    saveCompanyValueThesis: "Value thesis salvata",
    saveSystemBoundary: "Perimetro definito",
    createDepartment: "Funzione creata",
    saveStrategicGoal: "Obiettivo salvato",
    saveActivity: "Attivit\u00e0 salvata",
    updateActivityClassification: "Classificazione aggiornata",
    linkActivityDependency: "Dipendenza collegata",
    markDepartmentMapped: "Mapping completato",
    webSearch: "Ricerca web",
  };

  const showSuggestions =
    suggestions.length > 0 && messages.length <= 1 && !isLoading;

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6" ref={scrollRef}>
        <div className="mx-auto max-w-2xl space-y-6">
          {messages.map((message) => {
            const text = getMessageText(message);
            const toolParts =
              message.parts?.filter((p) =>
                p.type?.startsWith?.("tool-")
              ) ?? [];

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
              <div key={message.id} className="text-sm leading-relaxed text-muted-foreground">
                {text && (
                  <div className="whitespace-pre-wrap">
                    {renderContent(text)}
                  </div>
                )}
                {toolParts.map((part, i) => {
                  const p = part as Record<string, unknown>;
                  const toolName = (p.toolName as string) ?? "tool";
                  const state = p.state as string | undefined;
                  return (
                    <div
                      key={i}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs"
                    >
                      {state === "output" ? (
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                      ) : (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      <span>{toolLabels[toolName] ?? toolName}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {isLoading &&
            messages.length > 0 &&
            messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            )}

          {error && (
            <div className="rounded-lg border border-destructive/30 px-4 py-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Errore di connessione. Riprova.</span>
            </div>
          )}
        </div>
      </div>

      {/* Suggestions */}
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

      {/* Input */}
      <div className="border-t border-border px-6 py-4">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-2xl items-end gap-3"
        >
          <textarea
            ref={inputRef}
            onKeyDown={onKeyDown}
            placeholder="Scrivi la tua risposta..."
            className="flex-1 resize-none rounded-xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[48px] max-h-[200px]"
            rows={1}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
