"use client";

import { useActionState } from "react";
import { useRef } from "react";
import {
  deleteAiReadinessAssessmentAction,
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
  assessmentName,
  respondentCount = 0,
  completedCount = 0,
}: {
  workspaceId: string;
  assessmentId: string;
  status: string;
  assessmentName?: string;
  respondentCount?: number;
  completedCount?: number;
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
  const deleteAction = deleteAiReadinessAssessmentAction.bind(
    null,
    workspaceId,
    assessmentId
  );
  const [deleteState, deleteFormAction, deletePending] = useActionState(
    deleteAction,
    INITIAL
  );
  const confirmationRef = useRef<HTMLInputElement>(null);
  const latestMessage =
    deleteState.message ??
    openState.message ??
    closeState.message ??
    scoreState.message ??
    null;
  const latestOk = deleteState.message
    ? deleteState.ok
    : openState.message
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
        <form
          action={closeFormAction}
          onSubmit={(event) => {
            if (
              !window.confirm(
                "Chiudere la survey? I respondent non potranno più inviare risposte né riprendere le bozze finché non la riapri."
              )
            ) {
              event.preventDefault();
            }
          }}
        >
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
      <form
        action={deleteFormAction}
        onSubmit={(event) => {
          const summary = `Eliminare definitivamente l'assessment «${assessmentName ?? ""}»?\n\nVerranno cancellati per tutto il team:\n• ${respondentCount} inviti respondent (i link smetteranno di funzionare)\n• ${completedCount} risposte inviate\n• score, insight ed export\n\nL'operazione NON si può annullare.`;
          if (!window.confirm(summary)) {
            event.preventDefault();
            return;
          }
          const typed = window.prompt(
            "Per confermare, scrivi ELIMINA in maiuscolo:"
          );
          if ((typed ?? "").trim().toUpperCase() !== "ELIMINA") {
            event.preventDefault();
            return;
          }
          if (confirmationRef.current) confirmationRef.current.value = "ELIMINA";
        }}
      >
        <input type="hidden" name="confirmation" ref={confirmationRef} />
        <Button
          type="submit"
          variant="destructive"
          disabled={deletePending}
          data-testid="assessment-delete"
        >
          {deletePending ? "Elimino..." : "Elimina"}
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
