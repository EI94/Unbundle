"use client";

import { Check, MessageCircleReply, MessageSquarePlus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dismissReferentSuggestionAction, markReferentMessageDoneAction } from "@/lib/actions/use-case-referents";
import type { ClarifyTarget, ThreadSuggestionView } from "@/lib/use-cases/referent/contract";
import { REFERENT_THREAD_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { cn } from "@/lib/utils";
import type { ReferentDialog } from "./dialogs";
import { useReferentRunner } from "./referent-actions";
import { clarifyViewOf, type ThreadLine } from "./thread-view";

const T = REFERENT_THREAD_TEXT;
const ACTION = "min-h-11 sm:min-h-7";

/**
 * (Rilascio 6) Sotto una risposta del referente: «Chiedi un chiarimento» (un pulsante tranquillo, mai pieno)
 * o il chiarimento già in attesa; accanto il suggerimento dell'AI, solo ai revisori, con «Chiedi questo»
 * (apre la finestra con il testo già scritto: l'invio resta un clic) e «Lascia stare».
 */
export function ClarifyControl({
  workspaceId,
  useCaseId,
  target,
  suggestion,
  onOpen,
  className,
}: {
  workspaceId: string;
  useCaseId: string;
  target: ClarifyTarget | null | undefined;
  suggestion: ThreadSuggestionView | null;
  onOpen: (dialog: ReferentDialog) => void;
  className?: string;
}) {
  const { pending, run } = useReferentRunner();
  const view = clarifyViewOf(target);
  if (!view || !target) return null;
  if (view.kind === "pending") {
    return (
      <p data-slot="thread-pending" className={cn("text-xs break-words text-muted-foreground", className)}>
        {view.text}
      </p>
    );
  }
  return (
    <div data-slot="thread-clarify" className={cn("space-y-1", className)}>
      {suggestion ? (
        <div data-slot="thread-suggestion" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="flex min-w-0 items-start gap-1.5 break-words text-muted-foreground">
            <Sparkles aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {fillText(T.suggestion, { testo: suggestion.text })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={ACTION}
            data-action="thread-suggestion-ask"
            onClick={() => onOpen({ kind: "clarify", target, prefill: suggestion.text, suggestionId: suggestion.id })}
          >
            {T.suggestionAsk}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(ACTION, "text-muted-foreground")}
            aria-busy={pending || undefined}
            data-action="thread-suggestion-dismiss"
            onClick={() => {
              if (!pending) void run(() => dismissReferentSuggestionAction(workspaceId, useCaseId, suggestion.id), { inDialog: false, refreshOnSuccess: true, successToast: false });
            }}
          >
            {T.suggestionDismiss}
          </Button>
        </div>
      ) : null}
      <Button type="button" variant="ghost" size="sm" className={cn(ACTION, "-ml-2")} data-action="thread-clarify" onClick={() => onOpen({ kind: "clarify", target })}>
        <MessageSquarePlus aria-hidden />
        {view.label}
      </Button>
    </div>
  );
}

/**
 * (Rilascio 6) Il filo, in ordine di tempo: una riga per messaggio (chi e quando, su che cosa, il testo),
 * «Rispondi» sul dubbio del referente, «Fatto» su una sua risposta a una voce. Niente si mostra ai
 * contributori: il pannello non arriva a loro.
 */
export function ThreadList({
  workspaceId,
  useCaseId,
  lines,
  replyName,
  onOpen,
  heading,
  turn,
}: {
  workspaceId: string;
  useCaseId: string;
  lines: readonly ThreadLine[];
  replyName: string;
  onOpen: (dialog: ReferentDialog) => void;
  heading?: string | null;
  turn?: string | null;
}) {
  const { pending, run } = useReferentRunner();
  if (lines.length === 0) return null;
  return (
    <div data-slot="referent-thread" className="space-y-1.5 border-t pt-2">
      {heading || turn ? (
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
          {heading ? <span className="font-medium text-foreground">{heading}</span> : null}
          {turn ? <span data-slot="thread-turn" className="text-muted-foreground">{turn}</span> : null}
        </p>
      ) : null}
      <ol className="space-y-2">
        {lines.map((line) => (
          <li key={line.id} data-slot="thread-message" data-side={line.side} data-waiting={line.waiting || undefined} className="space-y-0.5">
            <p className="text-xs break-words text-muted-foreground">
              {line.header}
              {line.anchorLabel ? ` · ${line.anchorLabel}` : ""}
            </p>
            <p className={cn("text-sm break-words whitespace-pre-line", line.removed && "text-muted-foreground italic", line.side === "team" && "text-muted-foreground")}>{line.text}</p>
            {line.reply || line.done ? (
              <div className="flex flex-wrap items-center gap-2">
                {line.reply ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={ACTION}
                    data-action="thread-reply"
                    onClick={() => onOpen({ kind: "replyDoubt", messageId: line.id, name: replyName, quote: line.text })}
                  >
                    <MessageCircleReply aria-hidden />
                    {T.reply}
                  </Button>
                ) : null}
                {line.done ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={ACTION}
                    aria-busy={pending || undefined}
                    data-action="thread-done"
                    onClick={() => {
                      if (!pending) void run(() => markReferentMessageDoneAction(workspaceId, useCaseId, line.id), { inDialog: false, refreshOnSuccess: true, successToast: false });
                    }}
                  >
                    <Check aria-hidden />
                    {T.done}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
