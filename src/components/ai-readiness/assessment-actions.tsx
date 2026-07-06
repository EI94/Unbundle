"use client";

import { useActionState } from "react";
import {
  recomputeAiReadinessScoresAction,
  updateAiReadinessAssessmentStatusAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import { Button } from "@/components/ui/button";

const INITIAL: AiReadinessActionState = { ok: true };

export function AssessmentActions({
  workspaceId,
  assessmentId,
  status,
}: {
  workspaceId: string;
  assessmentId: string;
  status: string;
}) {
  const openAction = updateAiReadinessAssessmentStatusAction.bind(
    null,
    workspaceId,
    assessmentId,
    "open"
  );
  const closeAction = updateAiReadinessAssessmentStatusAction.bind(
    null,
    workspaceId,
    assessmentId,
    "closed"
  );
  const recomputeAction = recomputeAiReadinessScoresAction.bind(
    null,
    workspaceId,
    assessmentId
  );
  const [openState, openFormAction, openPending] = useActionState(openAction, INITIAL);
  const [closeState, closeFormAction, closePending] = useActionState(closeAction, INITIAL);
  const [scoreState, scoreFormAction, scorePending] = useActionState(
    recomputeAction,
    INITIAL
  );
  const latestMessage =
    openState.message ?? closeState.message ?? scoreState.message ?? null;
  const latestOk = openState.message
    ? openState.ok
    : closeState.message
      ? closeState.ok
      : scoreState.ok;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "open" && (
        <form action={openFormAction}>
          <Button type="submit" disabled={openPending}>
            {openPending ? "Apro..." : "Apri survey"}
          </Button>
        </form>
      )}
      {status === "open" && (
        <form action={closeFormAction}>
          <Button type="submit" variant="outline" disabled={closePending}>
            {closePending ? "Chiudo..." : "Chiudi survey"}
          </Button>
        </form>
      )}
      <form action={scoreFormAction}>
        <Button type="submit" variant="outline" disabled={scorePending}>
          {scorePending ? "Ricalcolo..." : "Ricalcola score"}
        </Button>
      </form>
      {latestMessage && (
        <span className={`text-sm ${latestOk ? "text-emerald-600" : "text-destructive"}`}>
          {latestMessage}
        </span>
      )}
    </div>
  );
}
