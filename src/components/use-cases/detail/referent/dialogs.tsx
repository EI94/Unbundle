"use client";

import { deleteNeedFileAction, removeNeedAnswerAction, reviewNeedFileAction, revokeReferentRequestAction } from "@/lib/actions/use-case-referents";
import type { ReferentRequestView, UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import { REFERENT_UI_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { AddDialog } from "./add-dialog";
import { AnswerDialog } from "./answer-dialog";
import { askAgainMode } from "./ask-dialog-state";
import { AskDialog } from "./ask-dialog";
import { ConfirmDialog, CorrectEmailDialog, EraseContactDialog } from "./contact-dialogs";
import { FileDialog } from "./file-dialog";

const T = REFERENT_UI_TEXT;

/** La finestra di «Chiedi al referente» aperta nel capitolo «Cosa serve». Una alla volta. */
export type ReferentDialog =
  | { kind: "ask" }
  | { kind: "again"; request: ReferentRequestView }
  | { kind: "add"; request: ReferentRequestView }
  | { kind: "revoke"; request: ReferentRequestView }
  | { kind: "correct"; contact: { id: string; name: string } }
  | { kind: "erase"; contact: { id: string; name: string } }
  | { kind: "answer"; need: { id: string; title: string } }
  | { kind: "file"; need: { id: string; title: string } }
  | { kind: "removeAnswer"; answerId: string }
  | { kind: "deleteFile"; fileId: string }
  | { kind: "rejectFile"; fileId: string };

/** Disegna la finestra aperta; `onClose` la chiude (dopo un invio riuscito, o con «Annulla»). */
export function ReferentDialogs({
  dialog,
  workspaceId,
  useCaseId,
  panel,
  needTitles,
  onClose,
}: {
  dialog: ReferentDialog | null;
  workspaceId: string;
  useCaseId: string;
  panel: UseCaseReferentPanel;
  needTitles: ReadonlyMap<string, string>;
  onClose: () => void;
}) {
  if (!dialog) return null;
  switch (dialog.kind) {
    case "ask":
      return <AskDialog workspaceId={workspaceId} useCaseId={useCaseId} panel={panel} needTitles={needTitles} onClose={onClose} />;
    case "again":
      return (
        <AskDialog
          key={dialog.request.id}
          workspaceId={workspaceId}
          useCaseId={useCaseId}
          panel={panel}
          mode={askAgainMode(dialog.request)}
          previous={dialog.request}
          needTitles={needTitles}
          onClose={onClose}
        />
      );
    case "add":
      return <AddDialog workspaceId={workspaceId} useCaseId={useCaseId} panel={panel} request={dialog.request} needTitles={needTitles} onClose={onClose} />;
    case "revoke":
      return (
        <ConfirmDialog
          title={T.revokeConfirmTitle}
          description={fillText(T.revokeConfirmText, { Nome: dialog.request.contact.name })}
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
