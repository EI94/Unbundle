"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { answerReferentDoubtAction, askReferentClarificationAction } from "@/lib/actions/use-case-referents";
import type { ClarifyTarget } from "@/lib/use-cases/referent/contract";
import { REFERENT_ERROR_MESSAGES, REFERENT_THREAD_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { REFERENT_THREAD_RULES } from "@/lib/use-cases/referent/thread";
import { DecisionDialog } from "../../reopen-dialog";
import { Field, describedBy } from "./fields";
import { useReferentRunner } from "./referent-actions";

const T = REFERENT_THREAD_TEXT;
const MAX = REFERENT_THREAD_RULES.teamLineMax;

/**
 * (Rilascio 6) Una riga per il referente, sullo stesso link: «Chiedi un chiarimento» su una sua risposta
 * (anche con il testo del suggerimento dell'AI già scritto: l'invio resta un clic), oppure «Rispondi» a un
 * suo dubbio. Un campo, «Annulla» e «Invia a {Nome}»; il server rifà ogni controllo.
 */
export function ThreadLineDialog({
  workspaceId,
  useCaseId,
  mode,
  onClose,
}: {
  workspaceId: string;
  useCaseId: string;
  mode: { kind: "clarify"; target: ClarifyTarget; prefill?: string; suggestionId?: string } | { kind: "reply"; messageId: string; name: string; quote: string };
  onClose: () => void;
}) {
  const fieldId = useId();
  const { pending, run } = useReferentRunner();
  const [text, setText] = useState(mode.kind === "clarify" ? (mode.prefill ?? "") : "");
  const [error, setError] = useState<string | null>(null);
  const name = mode.kind === "clarify" ? mode.target.contactName : mode.name;

  async function confirm() {
    const value = text.replace(/\s+/g, " ").trim();
    if (value.length < 2) return setError(REFERENT_ERROR_MESSAGES.testo_vuoto);
    if (value.length > MAX) return setError(REFERENT_ERROR_MESSAGES.riga_troppo_lunga);
    const call =
      mode.kind === "clarify"
        ? () =>
            askReferentClarificationAction(workspaceId, useCaseId, {
              requestId: mode.target.requestId,
              anchor: mode.target.anchor,
              needId: mode.target.needId,
              componentKey: mode.target.componentKey,
              text: value,
              suggestionId: mode.suggestionId ?? null,
            })
        : () => answerReferentDoubtAction(workspaceId, useCaseId, { messageId: mode.messageId, text: value });
    const { result, outcome } = await run(call, { inDialog: true });
    if (outcome.close) onClose();
    else setError((!result.ok && result.fieldErrors?.text) || outcome.error);
  }

  return (
    <DecisionDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={mode.kind === "clarify" ? T.clarifyTitle : fillText(T.replyTitle, { Nome: name })}
      description={mode.kind === "clarify" ? fillText(T.clarifyLead, { Nome: name }) : null}
      confirmLabel={fillText(mode.kind === "clarify" ? T.clarifySend : T.replySend, { Nome: name })}
      pending={pending}
      error={error}
      onConfirm={() => void confirm()}
      className="sm:max-w-lg"
    >
      <div className="grid gap-3">
        <blockquote data-slot="thread-quote" className="rounded-lg bg-muted/50 px-3 py-2 text-sm break-words whitespace-pre-line">
          {mode.kind === "clarify" ? mode.target.quote : mode.quote}
        </blockquote>
        <Field id={fieldId} label={mode.kind === "clarify" ? T.clarifyLabel : T.replyLabel} hint={T.hint}>
          <Input
            id={fieldId}
            value={text}
            maxLength={MAX}
            autoComplete="off"
            placeholder={mode.kind === "clarify" ? T.clarifyPlaceholder : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(fieldId, T.hint)}
            className="min-h-11 sm:min-h-9"
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
          />
        </Field>
      </div>
    </DecisionDialog>
  );
}
