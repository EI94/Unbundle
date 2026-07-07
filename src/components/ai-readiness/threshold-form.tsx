"use client";

import { useActionState } from "react";
import {
  updateAiReadinessThresholdAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const INITIAL: AiReadinessActionState = { ok: true };

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
  const action = updateAiReadinessThresholdAction.bind(
    null,
    workspaceId,
    assessmentId
  );
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <form
      action={formAction}
      className="mt-2 flex items-center gap-2"
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Cambiare la soglia di aggregazione? Vale per tutto il team: score e insight verranno ricalcolati con la nuova soglia."
          )
        ) {
          event.preventDefault();
        }
      }}
      data-testid="threshold-form"
    >
      <Input
        name="aggregationThreshold"
        type="number"
        min={min}
        max={50}
        defaultValue={current}
        className="h-8 w-20"
        aria-label="Soglia aggregazione"
      />
      <Input
        name="expectedRespondents"
        type="number"
        min={1}
        defaultValue={expectedRespondents ?? undefined}
        placeholder="Attese"
        className="h-8 w-24"
        aria-label="Risposte attese"
        title="Numero di risposte attese (per l'incontro di setup e il PDF)"
      />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Salvo..." : "Aggiorna"}
      </Button>
      {state.message && (
        <span
          className={`text-xs ${state.ok ? "text-emerald-600" : "text-destructive"}`}
          role="status"
        >
          {state.message}
        </span>
      )}
    </form>
  );
}
