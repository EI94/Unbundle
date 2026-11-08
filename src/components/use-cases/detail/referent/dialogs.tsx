"use client";

import { deleteNeedFileAction, removeNeedAnswerAction, reviewNeedFileAction, revokeReferentRequestAction } from "@/lib/actions/use-case-referents";
import type { ReferentRequestView, UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import { REFERENT_BLOCK_TEXT, REFERENT_UI_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { AssignDialog, type AssignContext } from "./assign-dialog";
import type { AssignMode } from "./assign-dialog-state";
import { AddDialog } from "./add-dialog";
import { AnswerDialog } from "./answer-dialog";
import { askAgainMode } from "./ask-dialog-state";
import { AskSteps, type AskStepsContext } from "./ask-steps";
import type { AskSession } from "./ask-steps-state";
import { ConfirmDialog, CorrectEmailDialog, EraseContactDialog } from "./contact-dialogs";
import { FileDialog } from "./file-dialog";
import { ThreadLineDialog } from "./thread-dialog";
import type { ClarifyTarget } from "@/lib/use-cases/referent/contract";

const T = REFERENT_UI_TEXT;

/** La finestra di «Chiedi al referente» aperta nel capitolo «Cosa serve». Una alla volta. */
export type ReferentDialog =
  | { kind: "ask" }
  | { kind: "again"; request: ReferentRequestView }
  | { kind: "add"; request: ReferentRequestView }
  | { kind: "revoke"; request: ReferentRequestView; referent?: boolean }
  /** (Rilascio 5) «Scegli il referente», «Cambia referente», «Chiedi di nuovo», «Chiedi al referente». */
  | { kind: "assign"; mode: AssignMode }
  /** (Rilascio 5) «Chiedi a un'altra persona»: la finestra in tre passi, per chi non è il referente. */
  | { kind: "other" }
  | { kind: "correct"; contact: { id: string; name: string } }
  | { kind: "erase"; contact: { id: string; name: string } }
  | { kind: "answer"; need: { id: string; title: string } }
  | { kind: "file"; need: { id: string; title: string } }
  | { kind: "removeAnswer"; answerId: string }
  | { kind: "deleteFile"; fileId: string }
  | { kind: "rejectFile"; fileId: string }
  /** (Rilascio 6) «Chiedi un chiarimento» su una risposta del referente; `prefill` dal suggerimento dell'AI («Chiedi questo»). */
  | { kind: "clarify"; target: ClarifyTarget; prefill?: string; suggestionId?: string }
  /** (Rilascio 6) «Rispondi» a un dubbio del referente. */
  | { kind: "replyDoubt"; messageId: string; name: string; quote: string };

/** «Chiedi al referente» in tre passi: quello che la finestra riceve dalla pagina, e dove lascia la bozza. */
export interface ReferentAskContext extends AskStepsContext {
  /** La bozza di «Chiedi al referente» chiuso senza inviare (null: niente da riprendere). */
  onKeep: (keep: AskSession | null) => void;
  /** (Rilascio 5) Quello che serve a «Scegli il referente»: la descrizione e la stima come le vede il referente. */
  assign: AssignContext;
}

/** Disegna la finestra aperta; `onClose` la chiude (dopo un invio riuscito, o con «Annulla»). */
export function ReferentDialogs({
  dialog,
  workspaceId,
  useCaseId,
  panel,
  needTitles,
  ask,
  onClose,
}: {
  dialog: ReferentDialog | null;
  workspaceId: string;
  useCaseId: string;
  panel: UseCaseReferentPanel;
  needTitles: ReadonlyMap<string, string>;
  ask: ReferentAskContext;
  onClose: () => void;
}) {
  if (!dialog) return null;
  const { onKeep, assign, ...context } = ask;
  switch (dialog.kind) {
    case "assign":
      return <AssignDialog key={dialog.mode} {...context} {...assign} workspaceId={workspaceId} useCaseId={useCaseId} panel={panel} mode={dialog.mode} onClose={onClose} />;
    case "other":
      return (
        <AskSteps
          {...context}
          saved={null}
          workspaceId={workspaceId}
          useCaseId={useCaseId}
          panel={panel}
          other
          onDismiss={onClose}
          onSent={onClose}
        />
      );
    case "ask":
      return (
        <AskSteps
          {...context}
          workspaceId={workspaceId}
          useCaseId={useCaseId}
          panel={panel}
          onDismiss={(keep) => {
            onKeep(keep);
            onClose();
          }}
          onSent={() => {
            onKeep(null);
            onClose();
          }}
        />
      );
    case "again":
      return (
        <AskSteps
          key={dialog.request.id}
          {...context}
          saved={null}
          workspaceId={workspaceId}
          useCaseId={useCaseId}
          panel={panel}
          mode={askAgainMode(dialog.request)}
          previous={dialog.request}
          onDismiss={onClose}
          onSent={onClose}
        />
      );
    case "add":
      return <AddDialog workspaceId={workspaceId} useCaseId={useCaseId} panel={panel} request={dialog.request} needTitles={needTitles} onClose={onClose} />;
    case "revoke":
      return (
        <ConfirmDialog
          title={T.revokeConfirmTitle}
          description={fillText(dialog.referent ? REFERENT_BLOCK_TEXT.revokeReferent : T.revokeConfirmText, { Nome: dialog.request.contact.name })}
          confirmLabel={T.revokeConfirm}
          action={() => revokeReferentRequestAction(workspaceId, useCaseId, dialog.request.id, dialog.request.version)}
          onClose={onClose}
        />
      );
    case "correct":
      return <CorrectEmailDialog workspaceId={workspaceId} useCaseId={useCaseId} contact={dialog.contact} onClose={onClose} />;
    case "erase":
      return <EraseContactDialog workspaceId={workspaceId} useCaseId={useCaseId} contact={dialog.contact} onClose={onClose} />;
    case "answer":
      return <AnswerDialog workspaceId={workspaceId} useCaseId={useCaseId} need={dialog.need} maxLength={panel.limits.answerMax} onClose={onClose} />;
    case "file":
      return <FileDialog workspaceId={workspaceId} useCaseId={useCaseId} need={dialog.need} clientMode={panel.upload.clientMode} accept={panel.limits.accept} onClose={onClose} />;
    case "removeAnswer":
      return (
        <ConfirmDialog
          title={T.removeAnswerConfirmTitle}
          description={T.removeAnswerConfirmText}
          confirmLabel={T.removeConfirm}
          action={() => removeNeedAnswerAction(workspaceId, useCaseId, dialog.answerId)}
          onClose={onClose}
        />
      );
    case "deleteFile":
      return (
        <ConfirmDialog
          title={T.fileDeleteConfirmTitle}
          description={T.fileDeleteConfirmText}
          confirmLabel={T.removeConfirm}
          action={() => deleteNeedFileAction(workspaceId, useCaseId, dialog.fileId)}
          onClose={onClose}
        />
      );
    case "clarify":
      return (
        <ThreadLineDialog
          workspaceId={workspaceId}
          useCaseId={useCaseId}
          mode={{ kind: "clarify", target: dialog.target, prefill: dialog.prefill, suggestionId: dialog.suggestionId }}
          onClose={onClose}
        />
      );
    case "replyDoubt":
      return <ThreadLineDialog workspaceId={workspaceId} useCaseId={useCaseId} mode={{ kind: "reply", messageId: dialog.messageId, name: dialog.name, quote: dialog.quote }} onClose={onClose} />;
    case "rejectFile":
      return (
        <ConfirmDialog
          title={T.fileRejectConfirmTitle}
          description={T.fileRejectConfirmText}
          confirmLabel={T.fileRejectConfirm}
          action={() => reviewNeedFileAction(workspaceId, useCaseId, dialog.fileId, "rifiuta")}
          onClose={onClose}
        />
      );
  }
}
