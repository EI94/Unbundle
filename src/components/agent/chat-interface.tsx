"use client";

import { useChat, type UIMessage } from "@ai-sdk/react";
import { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Send, Bot, User, Loader2, CheckCircle2 } from "lucide-react";

interface ChatInterfaceProps {
  workspaceId: string;
  conversationType: string;
  departmentId?: string;
  initialMessages?: Array<{ id: string; role: "user" | "assistant"; content: string }>;
}

export function ChatInterface({
  workspaceId,
  conversationType,
  departmentId,
  initialMessages = [],
}: ChatInterfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const seedMessages: UIMessage[] = initialMessages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: [{ type: "text" as const, text: m.content }],
  }));

  const chat = useChat({
    messages: seedMessages,
  });

  const { messages, status } = chat;

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
    }, {
      body: { workspaceId, conversationType, departmentId },
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const getMessageText = (message: UIMessage): string => {
    return message.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("") ?? "";
  };

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
                <Bot className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold">
                {conversationType === "leadership_setup"
                  ? "Setup con la Leadership"
                  : conversationType === "activity_mapping"
                    ? "Mapping delle Attivita'"
                    : "Conversazione"}
              </h3>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {conversationType === "leadership_setup"
                  ? "Inizia l'intervista strategica per definire dove si concentra il valore della tua organizzazione."
                  : "Inizia a mappare le attivita' del dipartimento."}
              </p>
            </div>
          )}

          {messages.map((message) => {
            const text = getMessageText(message);
            const toolParts = message.parts?.filter(
              (p) => p.type?.startsWith?.("tool-")
            ) ?? [];

            return (
              <div
                key={message.id}
                className={`flex gap-3 ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {message.role === "assistant" && (
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                      <Bot className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {text && <div className="whitespace-pre-wrap">{text}</div>}

                  {toolParts.map((part, i) => {
                    const p = part as Record<string, unknown>;
                    const toolName = (p.toolName as string) ?? "tool";
                    const state = p.state as string | undefined;
                    const output = p.output as { message?: string } | undefined;

                    return (
                      <Card
                        key={i}
                        className="mt-2 border-none bg-background/50 p-2"
                      >
                        <div className="flex items-center gap-2 text-xs">
                          {state === "output" ? (
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                          ) : (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          )}
                          <Badge variant="secondary" className="text-xs">
                            {toolName}
                          </Badge>
                          {state === "output" && output?.message && (
                            <span className="text-muted-foreground">
                              {output.message}
                            </span>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
                {message.role === "user" && (
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-xs">
                      <User className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
            );
          })}

          {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex gap-3">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  <Bot className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
              <div className="rounded-2xl bg-muted px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-4">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-3xl items-end gap-2"
        >
          <Textarea
            ref={inputRef}
            onKeyDown={onKeyDown}
            placeholder="Scrivi un messaggio..."
            className="min-h-[44px] max-h-[200px] resize-none"
            rows={1}
            disabled={isLoading}
          />
          <Button
            type="submit"
            size="icon"
            disabled={isLoading}
            className="shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
