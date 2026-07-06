"use client";

import { useActionState } from "react";
import {
  updateAiReadinessInsightStatusAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import { Button } from "@/components/ui/button";

const INITIAL: AiReadinessActionState = { ok: true };

export function InsightValidationActions({
  workspaceId,
  assessmentId,
  insightId,
  status,
}: {
  workspaceId: string;
  assessmentId: string;
  insightId: string;
  status: string;
}) {
  const reviewedAction = updateAiReadinessInsightStatusAction.bind(
    null,
    workspaceId,
    assessmentId,
    insightId,
    "reviewed"
  );
  const approvedAction = updateAiReadinessInsightStatusAction.bind(
    null,
    workspaceId,
    assessmentId,
    insightId,
    "approved"
  );
  const rejectedAction = updateAiReadinessInsightStatusAction.bind(
    null,
    workspaceId,
    assessmentId,
    insightId,
    "rejected"
  );
  const [reviewedState, reviewedFormAction, reviewedPending] = useActionState(
    reviewedAction,
    INITIAL
  );
  const [approvedState, approvedFormAction, approvedPending] = useActionState(
    approvedAction,
    INITIAL
  );
  const [rejectedState, rejectedFormAction, rejectedPending] = useActionState(
    rejectedAction,
    INITIAL
  );
  const message =
    reviewedState.message ?? approvedState.message ?? rejectedState.message ?? null;
  const ok = reviewedState.message
    ? reviewedState.ok
    : approvedState.message
      ? approvedState.ok
      : rejectedState.ok;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "reviewed" && status !== "approved" && (
        <form action={reviewedFormAction}>
          <Button type="submit" variant="outline" size="sm" disabled={reviewedPending}>
            Reviewed
          </Button>
        </form>
      )}
      {status !== "approved" && (
        <form action={approvedFormAction}>
          <Button type="submit" size="sm" disabled={approvedPending}>
            Approva
          </Button>
        </form>
      )}
      {status !== "rejected" && (
        <form action={rejectedFormAction}>
          <Button type="submit" variant="ghost" size="sm" disabled={rejectedPending}>
            Rifiuta
          </Button>
        </form>
      )}
      {message && (
        <span className={`text-xs ${ok ? "text-emerald-600" : "text-destructive"}`}>
          {message}
        </span>
      )}
    </div>
  );
}
