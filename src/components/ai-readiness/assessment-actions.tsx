"use client";

import { useActionState, useId, useRef, useState, useTransition } from "react";
import {
  deleteAiReadinessAssessmentAction,
  recomputeAiReadinessScoresAction,
  updateAiReadinessAssessmentStatusAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import { exportHref } from "@/lib/ai-readiness/dashboard-view";
import { CONFIRM_TEXT, DELETE_WORD, matchesDeleteWord } from "@/lib/confirm-text";
import { ActionMenu, type ActionMenuItem } from "@/components/uc/ui/action-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notifyDone } from "@/components/ui-10/toast";

const INITIAL: AiReadinessActionState = { ok: true };
const ASK = CONFIRM_TEXT.aiReadiness;
const M = READINESS_TEXT.menu;

/** Un file dell'export, scaricato con un link vero (mai un `<Link>`: il prefetch genererebbe il file a ogni visita). */
export function downloadFile(href: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = "";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Il «⋯» della rilevazione (rilascio 10, ondata 7b, §3.9; audit «Fuori» §8.4): Domande · Scarica il report (PDF) ·
 * Scarica i dati (Excel) · Chiudi o Riapri la raccolta · Ricalcola i punteggi · Elimina. Ogni voce solo a chi la può
 * usare, con i permessi delle azioni di oggi: le Domande, la raccolta, il ricalcolo e l'eliminazione a chi gestisce, i
 * file a chi valuta. «Chiudi» ed «Elimina» chiedono prima nella finestra dell'app; per eliminare si scrive ELIMINA, la
 * stessa parola che il server controlla.
 */
export function AssessmentActions({
  workspaceId,
  assessmentId,
  status,
  assessmentName,
  respondentCount = 0,
  completedCount = 0,
  manages,
  reviews,
  questionsHref,
}: {
  workspaceId: string;
  assessmentId: string;
  status: string;
  assessmentName?: string;
  respondentCount?: number;
  completedCount?: number;
  manages: boolean;
  reviews: boolean;
  questionsHref: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");
  const typedId = useId();
  const deleteForm = useRef<HTMLFormElement>(null);
  const deleteWordTyped = matchesDeleteWord(typed);
  const deleteAction = deleteAiReadinessAssessmentAction.bind(null, workspaceId, assessmentId);
  const [deleteState, deleteFormAction, deletePending] = useActionState(deleteAction, INITIAL);

  function run(task: () => Promise<AiReadinessActionState>) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (result.ok) notifyDone(result.message ?? READINESS_TEXT.done.recomputed);
      else setError(result.message ?? READINESS_TEXT.step.failed);
    });
  }

  const items: ActionMenuItem[] = [
    ...(manages ? [{ label: M.questions, href: questionsHref }] : []),
    ...(reviews
      ? [
          { label: M.report, onSelect: () => downloadFile(exportHref(assessmentId, "pdf")) },
          { label: M.data, onSelect: () => downloadFile(exportHref(assessmentId, "excel")) },
        ]
      : []),
    ...(manages && status === "open" ? [{ label: M.close, disabled: pending, onSelect: () => setClosing(true) }] : []),
    ...(manages && (status === "closed" || status === "archived")
      ? [{ label: M.reopen, disabled: pending, onSelect: () => run(() => updateAiReadinessAssessmentStatusAction(workspaceId, assessmentId, "open", INITIAL, new FormData())) }]
      : []),
    ...(manages ? [{ label: M.recompute, disabled: pending, onSelect: () => run(() => recomputeAiReadinessScoresAction(workspaceId, assessmentId, INITIAL, new FormData())) }] : []),
    ...(manages ? [{ label: M.remove, destructive: true, disabled: deletePending, onSelect: () => setDeleting(true) }] : []),
  ];
  const message = error ?? (deleteState.ok ? null : (deleteState.message ?? null));

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <ActionMenu items={items} label={M.label} />
      {message ? (
        <p role="alert" className="max-w-60 text-right text-xs text-destructive">
          {message}
        </p>
      ) : null}
      {/* L'eliminazione parte da questo modulo, dopo la finestra: la parola che il server controlla c'è solo se scritta. */}
      <form ref={deleteForm} action={deleteFormAction} hidden>
        <input type="hidden" name="confirmation" value={deleteWordTyped ? DELETE_WORD : ""} />
      </form>
      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        title={ASK.closeTitle}
        description={ASK.closeBody}
        confirmLabel={ASK.close}
        pending={pending}
        onConfirm={() => {
          setClosing(false);
          run(() => updateAiReadinessAssessmentStatusAction(workspaceId, assessmentId, "closed", INITIAL, new FormData()));
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={(open) => {
          setDeleting(open);
          if (!open) setTyped("");
        }}
        title={ASK.deleteTitle(assessmentName ?? "")}
        description={ASK.deleteBody(respondentCount, completedCount)}
        confirmLabel={ASK.delete}
        destructive
        pending={deletePending}
        confirmDisabled={!deleteWordTyped}
        onConfirm={() => {
          // Il modulo prende i dati adesso, con la parola scritta; poi la finestra si chiude e il campo si svuota.
          deleteForm.current?.requestSubmit();
          setDeleting(false);
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
