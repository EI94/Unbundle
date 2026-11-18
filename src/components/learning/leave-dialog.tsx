"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CONFIRM_TEXT } from "@/lib/confirm-text";
import type { LearningLeaveKind } from "@/lib/learning/leave-guard";
import { learningLeave } from "./use-unsaved-changes";

const T = CONFIRM_TEXT.learning;

const ASK: Readonly<Record<LearningLeaveKind, { title: string; confirm: string; cancel: string }>> = {
  leave: { title: T.leaveTitle, confirm: T.leave, cancel: T.stay },
  continue: { title: T.continueTitle, confirm: T.continue, cancel: T.stay },
  discard: { title: T.discardTitle, confirm: T.discard, cancel: CONFIRM_TEXT.cancel },
};

const noAsk = () => null;

/**
 * (Rilascio 10, ondata 1) La finestra delle modifiche non salvate della Formazione, al posto di `window.confirm` e
 * `window.alert`: una sola per pagina, montata da `LearningSessionBoundary` fuori dalla parte nascosta, così risponde
 * a ogni modulo registrato. Cambiando pagina una domanda rimasta aperta si chiude.
 */
export function LearningLeaveDialog() {
  const ask = useSyncExternalStore(learningLeave.subscribe, learningLeave.current, noAsk);
  const pathname = usePathname();
  useEffect(() => () => learningLeave.dismiss(), [pathname]);
  if (!ask) return null;
  const onOpenChange = (open: boolean) => {
    if (!open) learningLeave.dismiss();
  };
  if (ask.kind === "wait") {
    return (
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title={T.waitTitle}
        description={T.waitBody}
        confirmLabel={T.waitOk}
        cancelLabel={null}
        onConfirm={() => learningLeave.dismiss()}
      />
    );
  }
  const text = ASK[ask.kind];
  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={text.title}
      description={T.lostBody}
      confirmLabel={text.confirm}
      cancelLabel={text.cancel}
      destructive
      onConfirm={() => learningLeave.confirm()}
    />
  );
}
