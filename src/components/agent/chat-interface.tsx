"use client";

import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useState, useMemo } from "react";
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
  Compass,
  GitBranch,
} from "lucide-react";

interface ChatInterfaceProps {
  workspaceId: string;
  conversationType: string;
  departmentId?: string;
  initialMessages?: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
  }>;
}

const agentConfig: Record<
  string,
  { name: string; icon: typeof Compass; color: string; description: string }
> = {
  leadership_setup: {
    name: "Mara — Strategy Architect",
    icon: Compass,
    color: "bg-blue-600 text-white",
    description:
      "Intervista strategica per definire value thesis, confini del sistema e funzioni prioritarie",
  },
  activity_mapping: {
    name: "Leo — Process Analyst",
    icon: GitBranch,
    color: "bg-violet-600 text-white",
    description:
      "Scomposizione delle attività lavorative in unità analizzabili per classificazione AI",
  },
};

export function ChatInterface({
  workspaceId,
  conversationType,
  departmentId,
  initialMessages = [],
}: ChatInterfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasAutoStarted, setHasAutoStarted] = useState(false);

  const agent = agentConfig[conversationType] ?? {
    name: "Assistente AI",
    icon: Bot,
    color: "bg-primary text-primary-foreground",
    description: "Conversazione AI",
  };
  const AgentIcon = agent.icon;

  const seedMessages: UIMessage[] = initialMessages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: [{ type: "text" as const, text: m.content }],
  }));

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/ai/chat" }),
    []
  );

  const chat = useChat({
    transport,
    messages: seedMessages,
  });

  const { messages, status } = chat;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!hasAutoStarted && initialMessages.length === 0 && messages.length === 0) {
      setHasAutoStarted(true);
      chat.sendMessage(
        {
          role: "user",
          parts: [{ type: "text", text: "Ciao, iniziamo." }],
        },
        {
          body: { workspaceId, conversationType, departmentId },
        }
      );
    }
  }, [hasAutoStarted, initialMessages.length, messages.length, chat, workspaceId, conversationType, departmentId]);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isLoading = status === "streaming" || status === "submitted";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = inputRef.current?.value?.trim();
    if (!value || isLoading) return;

    if (inputRef.current) inputRef.current.value = "";

    chat.sendMessage(
      {
        role: "user",
        parts: [{ type: "text", text: value }],
      },
      {
        body: { workspaceId, conversationType, departmentId },
      }
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const getMessageText = (message: UIMessage): string => {
    return (
      message.parts
        ?.filter(
          (p): p is { type: "text"; text: string } => p.type === "text"
        )
        .map((p) => p.text)
        .join("") ?? ""
    );
  };

  const renderContent = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Welcome card — only if truly no messages at all */}
          {messages.length === 0 && !isLoading && !hasAutoStarted && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div
                className={`flex h-16 w-16 items-center justify-center rounded-2xl ${agent.color} mb-5 shadow-lg`}
              >
                <AgentIcon className="h-8 w-8" />
              </div>
              <h3 className="text-xl font-semibold">{agent.name}</h3>
              <p className="mt-2 max-w-md text-sm text-muted-foreground leading-relaxed">
                {agent.description}
              </p>
            </div>
          )}

          {/* Loading state while auto-starting */}
          {messages.length === 0 && (isLoading || hasAutoStarted) && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div
                className={`flex h-16 w-16 items-center justify-center rounded-2xl ${agent.color} mb-5 shadow-lg`}
              >
                <AgentIcon className="h-8 w-8" />
              </div>
              <h3 className="text-xl font-semibold">{agent.name}</h3>
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Sta preparando l&apos;intervista...
              </div>
            </div>
          )}

          {messages.map((message) => {
            if (
              message.role === "user" &&
              getMessageText(message) === "Ciao, iniziamo."
            ) {
              return null;
            }

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
                  <Avatar className="h-9 w-9 shrink-0 shadow-sm">
                    <AvatarFallback className={agent.color}>
                      <AgentIcon className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/80 border border-border/50"
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

                    const toolLabels: Record<string, string> = {
                      saveCompanyValueThesis: "Value Thesis salvata",
                      saveSystemBoundary: "Perimetro definito",
                      createDepartment: "Dipartimento creato",
                      saveStrategicGoal: "Obiettivo salvato",
                      saveActivity: "Attività salvata",
                      updateActivityClassification: "Classificazione aggiornata",
                      linkActivityDependency: "Dipendenza collegata",
                      markDepartmentMapped: "Mapping completato",
                    };

                    return (
                      <Card
                        key={i}
                        className="mt-3 border-none bg-background/70 p-3"
                      >
                        <div className="flex items-center gap-2 text-xs">
                          {state === "output" ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          )}
                          <Badge variant="secondary" className="text-xs font-medium">
                            {toolLabels[toolName] ?? toolName}
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
                  <Avatar className="h-9 w-9 shrink-0 shadow-sm">
                    <AvatarFallback className="bg-primary/10 text-primary">
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
                <Avatar className="h-9 w-9 shrink-0 shadow-sm">
                  <AvatarFallback className={agent.color}>
                    <AgentIcon className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="rounded-2xl bg-muted/80 border border-border/50 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-xs text-muted-foreground">
                      Sta analizzando...
                    </span>
                  </div>
                </div>
              </div>
            )}
        </div>
      </ScrollArea>

      <div className="border-t border-border bg-background/80 backdrop-blur-sm p-4">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-3xl items-end gap-2"
        >
          <Textarea
            ref={inputRef}
            onKeyDown={onKeyDown}
            placeholder="Scrivi la tua risposta..."
            className="min-h-[48px] max-h-[200px] resize-none rounded-xl"
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
