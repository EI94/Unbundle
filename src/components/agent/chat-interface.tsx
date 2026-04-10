"use client";

import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Send,
  Bot,
  User,
  Loader2,
  CheckCircle2,
  AlertCircle,
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
                <strong key={pi} className="font-semibold">
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
    saveCompanyValueThesis: "Value Thesis salvata",
    saveSystemBoundary: "Perimetro definito",
    createDepartment: "Dipartimento creato",
    saveStrategicGoal: "Obiettivo salvato",
    saveActivity: "Attivit\u00e0 salvata",
    updateActivityClassification: "Classificazione aggiornata",
    linkActivityDependency: "Dipendenza collegata",
    markDepartmentMapped: "Mapping completato",
  };

  const showSuggestions =
    suggestions.length > 0 &&
    messages.length <= 1 &&
    !isLoading;

  return (
    <div className="flex h-full flex-col bg-background">
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="mx-auto max-w-3xl space-y-5 pb-4">
          {messages.map((message) => {
            const text = getMessageText(message);
            const toolParts =
              message.parts?.filter((p) =>
                p.type?.startsWith?.("tool-")
              ) ?? [];

            return (
              <div
                key={message.id}
                className={`flex gap-3 ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {message.role === "assistant" && (
                  <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                    <AvatarFallback className="bg-primary/10 text-primary">
                      <Bot className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/70"
                  }`}
                >
                  {text && (
                    <div className="whitespace-pre-wrap">
                      {renderContent(text)}
                    </div>
                  )}
                  {toolParts.map((part, i) => {
                    const p = part as Record<string, unknown>;
                    const toolName = (p.toolName as string) ?? "tool";
                    const state = p.state as string | undefined;
                    const output = p.output as
                      | { message?: string }
                      | undefined;
                    return (
                      <Card
                        key={i}
                        className="mt-3 border-none bg-background/60 p-2.5"
                      >
                        <div className="flex items-center gap-2 text-xs">
                          {state === "output" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                          ) : (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                          )}
                          <Badge
                            variant="secondary"
                            className="text-xs font-medium"
                          >
                            {toolLabels[toolName] ?? toolName}
                          </Badge>
                          {state === "output" && output?.message && (
                            <span className="text-muted-foreground truncate">
                              {output.message}
                            </span>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
                {message.role === "user" && (
                  <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                    <AvatarFallback className="bg-foreground/5">
                      <User className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
            );
          })}

          {isLoading &&
            messages.length > 0 &&
            messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex gap-3">
                <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                  <AvatarFallback className="bg-primary/10 text-primary">
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="rounded-2xl bg-muted/70 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-2 w-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-2 w-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              </div>
            )}

          {error && (
            <div className="flex gap-3 justify-center">
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Errore di connessione. Riprova a inviare il messaggio.</span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Suggestion chips */}
      {showSuggestions && (
        <div className="border-t border-border/50 px-4 py-3">
          <div className="mx-auto max-w-3xl flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleSuggestion(s)}
                className="rounded-full border border-border bg-background px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-border bg-background p-4">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-3xl items-end gap-2"
        >
          <Textarea
            ref={inputRef}
            onKeyDown={onKeyDown}
            placeholder="Scrivi la tua risposta..."
            className="min-h-[48px] max-h-[200px] resize-none rounded-xl border-border/60"
            rows={1}
            disabled={isLoading}
          />
          <Button
            type="submit"
            size="icon"
            disabled={isLoading}
            className="shrink-0 h-12 w-12 rounded-xl"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
