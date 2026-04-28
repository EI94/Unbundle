"use client";

import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import {
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
  MessageCircle,
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

const TOOL_LABELS: Record<string, { active: string; done: string }> = {
  confirmContributionKind: {
    active: "Imposto tipologia contributo",
    done: "Tipologia impostata",
  },
  classifyContributionIntent: {
    active: "Classifico intent",
    done: "Intent classificato",
  },
  saveCompanyValueThesis: {
    active: "Salvo la value thesis",
    done: "Value thesis salvata",
  },
  saveSystemBoundary: {
    active: "Definisco il perimetro",
    done: "Perimetro definito",
  },
  saveUnitTerminology: {
    active: "Salvo la terminologia",
    done: "Terminologia salvata",
  },
  createDepartment: { active: "Creo l'unità", done: "Unità creata" },
  saveStrategicGoal: {
    active: "Salvo l'obiettivo",
    done: "Obiettivo salvato",
  },
  saveActivity: { active: "Salvo l'attività", done: "Attività salvata" },
  updateActivityClassification: {
    active: "Classifico",
    done: "Classificazione aggiornata",
  },
  linkActivityDependency: {
    active: "Collego dipendenza",
    done: "Dipendenza collegata",
  },
  markDepartmentMapped: {
    active: "Completo mapping",
    done: "Mapping completato",
  },
};

function toolNameFromPart(part: Record<string, unknown>): string {
  const n = part.toolName;
  if (typeof n === "string" && n.length > 0) return n;
  const t = part.type;
  if (typeof t === "string" && t.startsWith("tool-")) return t.slice(5);
  return "tool";
}

function WaitingStatus() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-3 py-1 text-sm text-muted-foreground">
      <div className="flex items-center gap-1">
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/30"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/30"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/30"
          style={{ animationDelay: "300ms" }}
        />
      </div>
      <span className="text-xs">
        {seconds < 5
          ? "Sto ragionando..."
          : seconds < 15
            ? "Elaboro la risposta..."
            : seconds < 30
              ? `Ancora un momento (${seconds}s)...`
              : `Ci sto mettendo un po' (${seconds}s)...`}
      </span>
    </div>
  );
}

function IdleNudge() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  if (seconds < 45) return null;

  return (
    <div className="px-6 pb-2">
      <div className="mx-auto max-w-2xl">
        <div className="flex animate-in items-center gap-2 rounded-lg border border-foreground/10 bg-accent/50 px-4 py-2.5 text-xs text-muted-foreground fade-in slide-in-from-bottom-2">
          <MessageCircle className="h-3.5 w-3.5 shrink-0" />
          <span>
            È il tuo turno — rispondi alla domanda per continuare la Discovery.
          </span>
        </div>
      </div>
    </div>
  );
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const chat = useChat({ transport, messages: seedMessages });
  const { messages, status, error } = chat;
  const isLoading = status === "streaming" || status === "submitted";

  const isUserTurn =
    !isLoading &&
    messages.length > 0 &&
    messages[messages.length - 1]?.role === "assistant";

  // Scroll automatico
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Auto-focus input quando è turno utente
  useEffect(() => {
    if (isUserTurn && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isUserTurn]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const value = inputRef.current?.value?.trim();
      if (!value || isLoading) return;
      if (inputRef.current) inputRef.current.value = "";
      chat.sendMessage({
        role: "user",
        parts: [{ type: "text", text: value }],
      });
    },
    [isLoading, chat]
  );

  const handleSuggestion = useCallback(
    (text: string) => {
      if (isLoading) return;
      chat.sendMessage({
        role: "user",
        parts: [{ type: "text", text }],
      });
    },
    [isLoading, chat]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit]
  );

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
                  <div className="whitespace-pre-wrap">
                    {renderMarkdown(text)}
                  </div>
                )}
                {toolParts.length > 0 && (() => {
                  const HIDDEN_TOOLS = new Set(["webSearch"]);
                  const visibleTools = toolParts.filter((part) => {
                    const p = part as Record<string, unknown>;
                    const name = toolNameFromPart(p);
                    return !HIDDEN_TOOLS.has(name);
                  });
                  if (visibleTools.length === 0) return null;
                  return (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {visibleTools.map((part, i) => {
                        const p = part as Record<string, unknown>;
                        const name = toolNameFromPart(p);
                        const state = p.state as string | undefined;
                        const isDone = state === "output-available" || state === "error";
                        const labels = TOOL_LABELS[name];

                        return (
                          <div
                            key={i}
                            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-all ${
                              isDone
                                ? "border-border/30 text-muted-foreground/50"
                                : "border-foreground/10 text-foreground animate-pulse"
                            }`}
                          >
                            {isDone ? (
                              <CheckCircle2 className="h-3 w-3 text-green-500/70" />
                            ) : (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            )}
                            <span>
                              {isDone
                                ? labels?.done ?? name
                                : labels?.active ?? "Elaboro..."}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            );
          })}

          {/* AI thinking / streaming indicator */}
          {isLoading && <WaitingStatus />}

          {/* Errore */}
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Errore</p>
                <p className="text-xs mt-0.5 opacity-80">
                  {error.message?.includes("fetch")
                    ? "Connessione persa. Controlla la rete e riprova."
                    : error.message?.includes("401")
                      ? "Sessione scaduta. Ricarica la pagina."
                      : error.message?.includes("429")
                        ? "Troppe richieste. Attendi qualche secondo."
                        : "Errore imprevisto. Riprova."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Nudge quando utente inattivo */}
      {isUserTurn && <IdleNudge />}

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

      {/* Input area */}
      <div className="border-t border-border px-6 py-4">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-2xl items-end gap-3"
        >
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              onKeyDown={onKeyDown}
              placeholder={
                isLoading
                  ? "Attendi la risposta..."
                  : "Scrivi la tua risposta..."
              }
              className="w-full resize-none rounded-xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[48px] max-h-[200px] disabled:opacity-30 disabled:cursor-not-allowed"
              rows={1}
              disabled={isLoading}
            />
            {isLoading && (
              <div className="absolute inset-0 rounded-xl bg-card/60 flex items-center justify-center cursor-not-allowed">
                <span className="text-xs text-muted-foreground/60">
                  Attendi la risposta...
                </span>
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-10 disabled:cursor-not-allowed"
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
