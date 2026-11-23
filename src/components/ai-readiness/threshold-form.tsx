"use client";

import { useActionState, useId } from "react";
import {
  updateAiReadinessThresholdAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import { CONFIRM_TEXT } from "@/lib/confirm-text";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, useSubmitConfirmation } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL: AiReadinessActionState = { ok: true };
const ASK = CONFIRM_TEXT.aiReadiness;
const S = READINESS_TEXT.settings;

/**
 * Soglia e risposte attese (rilascio 10, ondata 7b; audit «Fuori» AD-7): due campi con la loro etichetta, al posto
 * della riga con un solo «Aggiorna». «Salva» è bordato; cambiare la soglia chiede prima nella finestra dell'app, perché
 * vale per tutto il team. L'azione è quella di oggi.
 */
export function ThresholdForm({
  workspaceId,
  assessmentId,
  current,
  min,
  expectedRespondents,
}: {
  workspaceId: string;
  assessmentId: string;
  current: number;
  min: number;
  expectedRespondents?: number | null;
}) {
  const action = updateAiReadinessThresholdAction.bind(null, workspaceId, assessmentId);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const confirmation = useSubmitConfirmation();
  const thresholdId = useId();
  const expectedId = useId();

  return (
    <>
      <form
        action={formAction}
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          const raw = new FormData(event.currentTarget).get("aggregationThreshold");
          // Solo una soglia diversa chiede prima: le risposte attese si salvano subito.
          if (String(raw ?? "") !== String(current)) confirmation.ask(event, true);
        }}
        data-testid="threshold-form"
      >
        <div className="grid gap-1.5">
          <Label htmlFor={thresholdId}>{S.threshold}</Label>
          <Input
            id={thresholdId}
            name="aggregationThreshold"
            type="number"
            inputMode="numeric"
            min={min}
            max={50}
            defaultValue={current}
            aria-describedby={`${thresholdId}-aiuto`}
            aria-invalid={state.fieldErrors?.aggregationThreshold ? true : undefined}
            className="h-11 text-base sm:h-9 sm:text-sm"
          />
          <p id={`${thresholdId}-aiuto`} className="text-xs text-muted-foreground">
            {state.fieldErrors?.aggregationThreshold ?? S.thresholdHint(min)}
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={expectedId}>{S.expected}</Label>
          <Input
            id={expectedId}
            name="expectedRespondents"
            type="number"
            inputMode="numeric"
            min={1}
            defaultValue={expectedRespondents ?? undefined}
            aria-describedby={`${expectedId}-aiuto`}
            aria-invalid={state.fieldErrors?.expectedRespondents ? true : undefined}
            className="h-11 text-base sm:h-9 sm:text-sm"
          />
          <p id={`${expectedId}-aiuto`} className="text-xs text-muted-foreground">
            {state.fieldErrors?.expectedRespondents ?? S.expectedHint}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9" disabled={pending}>
            {pending ? S.saving : S.save}
          </Button>
          {state.message ? (
            <span className={`text-sm ${state.ok ? "text-muted-foreground" : "text-destructive"}`} role="status">
              {state.message}
            </span>
          ) : null}
        </div>
      </form>
      <ConfirmDialog
        open={confirmation.open}
        onOpenChange={confirmation.onOpenChange}
        title={ASK.thresholdTitle}
        description={ASK.thresholdBody}
        confirmLabel={ASK.threshold}
        onConfirm={confirmation.confirm}
      />
    </>
  );
}
