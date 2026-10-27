"use client";

import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { addNeedAnswerAction } from "@/lib/actions/use-case-referents";
import { REFERENT_ERROR_MESSAGES, REFERENT_UI_TEXT } from "@/lib/use-cases/referent/labels";
import { DecisionDialog } from "../../reopen-dialog";
import { Field, describedBy } from "./fields";
import { useReferentRunner } from "./referent-actions";

const T = REFERENT_UI_TEXT.answerDialog;

/**
 * «Aggiungi una risposta» del team a un'esigenza (SPEC §5.2, §P2.10.7): la vedono solo i revisori.
 * L'informazione passa a «Da verificare», oppure ad «A posto» con «L'ho già verificata». Se una
 * richiesta aperta chiede la stessa cosa, il referente la vede come già fatta dal team (Parte 3).
 */
export function AnswerDialog({
  workspaceId,
  useCaseId,
  need,
  maxLength,
  onClose,
}: {
  workspaceId: string;
  useCaseId: string;
  need: { id: string; title: string };
  maxLength: number;
  onClose: () => void;
}) {
  const fieldId = useId();
  const { pending, run } = useReferentRunner();
  const [text, setText] = useState("");
  const [validate, setValidate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    const value = text.trim();
    if (!value) {
      setError(REFERENT_ERROR_MESSAGES.risposta_vuota);
      return;
    }
    if (value.length > maxLength) {
      setError(REFERENT_ERROR_MESSAGES.testo_troppo_lungo);
      return;
    }
    const { outcome } = await run(() => addNeedAnswerAction(workspaceId, useCaseId, need.id, { text: value, validate }), { inDialog: true });
    if (outcome.close) onClose();
    else setError(outcome.error);
  }

  return (
    <DecisionDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={T.title}
      description={need.title}
      confirmLabel={T.confirm}
      pending={pending}
      error={error}
      onConfirm={() => void confirm()}
      className="sm:max-w-lg"
    >
      <div className="grid gap-3">
        <Field id={fieldId} label={T.field} hint={T.hint}>
          <Textarea
            id={fieldId}
            value={text}
            rows={5}
            maxLength={maxLength}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(fieldId, T.hint)}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
          />
        </Field>
        <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm sm:min-h-8">
          <Checkbox className="mt-0.5" checked={validate} onCheckedChange={(next) => setValidate(next === true)} />
          <span>{T.validate}</span>
        </label>
      </div>
    </DecisionDialog>
  );
}
