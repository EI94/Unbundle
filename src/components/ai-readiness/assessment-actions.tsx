"use client";

import { useActionState, useId, useState } from "react";
import {
  deleteAiReadinessAssessmentAction,
  recomputeAiReadinessScoresAction,
  updateAiReadinessAssessmentStatusAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import { CONFIRM_TEXT, DELETE_WORD, matchesDeleteWord } from "@/lib/confirm-text";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, useSubmitConfirmation } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL: AiReadinessActionState = { ok: true };
const ASK = CONFIRM_TEXT.aiReadiness;

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
  // «Chiudi survey» ed «Elimina» chiedono prima, nella finestra dell'app. Per eliminare una sola finestra: il
  // riepilogo di quello che si cancella e il campo dove si scrive ELIMINA.
  const closing = useSubmitConfirmation();
  const deletion = useSubmitConfirmation();
  const [typed, setTyped] = useState("");
  const typedId = useId();
  const deleteWordTyped = matchesDeleteWord(typed);
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
            {openPending ? "Apro…" : "Apri la raccolta"}
          </Button>
        </form>
      )}
      {status === "open" && (
        <form
          action={closeFormAction}
          onSubmit={(event) => {
            closing.ask(event, true);
          }}
        >
          <Button type="submit" variant="outline" disabled={closePending}>
            {closePending ? "Chiudo…" : "Chiudi la raccolta"}
          </Button>
        </form>
      )}
      <form action={scoreFormAction}>
        <Button type="submit" variant="outline" disabled={scorePending}>
          {scorePending ? "Ricalcolo…" : "Ricalcola i punteggi"}
        </Button>
      </form>
      <form
        action={deleteFormAction}
        onSubmit={(event) => {
          deletion.ask(event, true);
        }}
      >
        {/* La parola che il server controlla: c'è solo dopo che chi elimina l'ha scritta nella finestra. */}
        <input type="hidden" name="confirmation" value={deleteWordTyped ? DELETE_WORD : ""} />
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
      <ConfirmDialog
        open={closing.open}
        onOpenChange={closing.onOpenChange}
        title={ASK.closeTitle}
        description={ASK.closeBody}
        confirmLabel={ASK.close}
        onConfirm={closing.confirm}
      />
      <ConfirmDialog
        open={deletion.open}
        onOpenChange={(open) => {
          deletion.onOpenChange(open);
          if (!open) setTyped("");
        }}
        title={ASK.deleteTitle(assessmentName ?? "")}
        description={ASK.deleteBody(respondentCount, completedCount)}
        confirmLabel={ASK.delete}
        destructive
        confirmDisabled={!deleteWordTyped}
        onConfirm={() => {
          deletion.confirm();
          setTyped("");
        }}
        className="sm:max-w-md"
      >
        <div className="grid gap-2">
          <Label htmlFor={typedId}>{ASK.deleteField}</Label>
          <Input
            id={typedId}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="h-11 text-base sm:h-8 sm:text-sm"
            data-testid="assessment-delete-word"
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
