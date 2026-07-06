"use client";

import { useActionState } from "react";
import {
  generateAiReadinessInsightsAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import { Button } from "@/components/ui/button";

const INITIAL: AiReadinessActionState<{ generated: number }> = { ok: true };

export function IntelligenceActions({
  workspaceId,
  assessmentId,
}: {
  workspaceId: string;
  assessmentId: string;
}) {
  const action = generateAiReadinessInsightsAction.bind(
    null,
    workspaceId,
    assessmentId
  );
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={pending}>
        {pending ? "Genero intelligence..." : "Genera intelligence"}
      </Button>
      {state.message && (
        <span className={`text-sm ${state.ok ? "text-emerald-600" : "text-destructive"}`}>
          {state.message}
        </span>
      )}
    </form>
  );
}
