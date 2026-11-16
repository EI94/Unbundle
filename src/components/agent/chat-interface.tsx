"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { AiConsentNotice } from "@/components/context/ai-consent-notice";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { CONSENT_CHECKING, composerState, isConsentError, loadChatConsent, type ChatConsent } from "./chat-consent";
import {
  HIDDEN_TOOLS,
  assistantView,
  chatTransportBody,
  messageText,
  type ChatProgress,
  type ChatUIMessage,
} from "./chat-view";
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
  /** Lo stato di partenza dell'ok ai sub-responsabili (chat-consent.ts); poi lo chiede la chat al montaggio. */
  initialConsent?: ChatConsent;
}

/** Una riga di avanzamento sotto una risposta: una nota, o un tool con la sua etichetta (chat-view.ts). */
function ProgressRow({ item }: { item: ChatProgress }) {
  if (item.kind === "note") {
    return <p className="basis-full text-xs">{item.text}</p>;
  }
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-all ${
        item.done
          ? "border-border/30 text-muted-foreground/50 light:text-muted-foreground"
          : "border-foreground/10 text-foreground animate-pulse"
      }`}
    >
      {item.done ? (
        <CheckCircle2 className="h-3 w-3 text-green-500/70" />
      ) : (
        <Loader2 className="h-3 w-3 animate-spin" />
      )}
      <span>{item.label}</span>
    </div>
  );
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
  initialConsent = CONSENT_CHECKING,
}: ChatInterfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // L'ok ai sub-responsabili (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §6.3): senza, l'avviso al posto del campo per
  // scrivere; i messaggi di prima restano. Il controllo vero è della rotta (403 `ok_fornitori_mancante`).
  const [consent, setConsent] = useState<ChatConsent>(initialConsent);
  const checkConsent = useCallback(() => {
    let live = true;
    void loadChatConsent(workspaceId).then((next) => {
      if (live) setConsent(next);
    });
    return () => {
      live = false;
    };
  }, [workspaceId]);
  useEffect(() => checkConsent(), [checkConsent]);
  const composer = composerState(consent);

  const welcomeMessages: ChatUIMessage[] = [];
  if (initialMessages.length === 0 && welcomeMessage) {
    welcomeMessages.push({
      id: "welcome",
      role: "assistant",
      parts: [{ type: "text" as const, text: welcomeMessage }],
    });
  }

  const seedMessages: ChatUIMessage[] =
    initialMessages.length > 0
      ? initialMessages.map((m) => ({
          id: m.id,
          role: m.role,
          parts: [{ type: "text" as const, text: m.content }],
        }))
      : welcomeMessages;

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: "/api/ai/chat",
        body: { workspaceId, conversationType, departmentId },
        // Solo il testo di ogni turno, senza le risposte rifiutate e le loro domande (chat-view.ts).
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: chatTransportBody(messages, body, { workspaceId, conversationType, departmentId }),
        }),
      }),
    [workspaceId, conversationType, departmentId]
  );

  const chat = useChat({ transport, messages: seedMessages });
  const { messages, status, error } = chat;
  const isLoading = status === "streaming" || status === "submitted";
  // La rotta ha risposto che manca l'ok (per esempio tolto dopo l'apertura): si chiede di nuovo, e torna l'avviso.
  const refusedForConsent = isConsentError(error);
  useEffect(() => (refusedForConsent ? checkConsent() : undefined), [refusedForConsent, checkConsent]);

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
      if (!value || isLoading || composer !== "aperto") return;
      if (inputRef.current) inputRef.current.value = "";
      chat.sendMessage({
        role: "user",
        parts: [{ type: "text", text: value }],
      });
    },
    [isLoading, chat, composer]
  );

  const handleSuggestion = useCallback(
    (text: string) => {
      if (isLoading || composer !== "aperto") return;
      chat.sendMessage({
        role: "user",
        parts: [{ type: "text", text }],
      });
    },
    [isLoading, chat, composer]
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
    suggestions.length > 0 && messages.length <= 1 && !isLoading && composer === "aperto";

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6" ref={scrollRef}>
        <div className="mx-auto max-w-2xl space-y-6">
          {messages.map((message, index) => {
            if (message.role === "user") {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl bg-accent px-4 py-3 text-sm">
                    {messageText(message)}
                  </div>
                </div>
              );
            }

            // Che cosa mostrare della risposta lo decide chat-view.ts: l'avviso di un rifiuto o il testo, poi le
            // righe di avanzamento. Sta arrivando solo l'ultima risposta, mentre la chat aspetta lo stream.
            const view = assistantView(message, HIDDEN_TOOLS, {
              arriving: isLoading && index === messages.length - 1,
            });
            return (
              <div
                key={message.id}
                className="text-sm leading-relaxed text-muted-foreground"
              >
                {view.kind === "refused" ? (
                  <p className="text-xs">{view.notice}</p>
                ) : (
                  view.text && (
                    <div className="whitespace-pre-wrap">
                      {renderMarkdown(view.text)}
                    </div>
                  )
                )}
                {view.progress.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {view.progress.map((item, i) => (
                      <ProgressRow key={i} item={item} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* AI thinking / streaming indicator */}
          {isLoading && <WaitingStatus />}

          {/* Errore (manca l'ok: al suo posto l'avviso, sotto) */}
          {error && !refusedForConsent && (
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

      {/* Senza l'ok ai sub-responsabili: l'avviso calmo al posto del campo per scrivere */}
      {consent.state === "missing" ? (
        <div className="border-t border-border px-6 py-4">
          <div className="mx-auto max-w-2xl space-y-2">
            <AiConsentNotice
              notice={consent.notice}
              variant="card"
              onGranted={() => {
                setConsent(CONSENT_CHECKING);
                checkConsent();
              }}
            />
            <p className="text-xs text-muted-foreground">{CONTEXT_TEXT.consent.chatHint}</p>
          </div>
        </div>
      ) : (
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
              className="w-full resize-none rounded-xl border border-border light:border-input bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[48px] max-h-[200px] disabled:opacity-30 disabled:cursor-not-allowed"
              rows={1}
              disabled={isLoading || composer !== "aperto"}
            />
            {isLoading && (
              <div className="absolute inset-0 rounded-xl bg-card/60 flex items-center justify-center cursor-not-allowed">
                <span className="text-xs text-muted-foreground/60 light:text-muted-foreground">
                  Attendi la risposta...
                </span>
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={isLoading || composer !== "aperto"}
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
      )}
    </div>
  );
}
