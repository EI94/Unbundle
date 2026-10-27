"use client";

import { Download, Trash2 } from "lucide-react";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { Button } from "@/components/ui/button";
import type { NeedReferentView } from "@/lib/use-cases/referent/contract";
import { REFERENT_UI_TEXT } from "@/lib/use-cases/referent/labels";
import { Disclosure } from "../../disclosure";
import type { ReferentDialog } from "./dialogs";
import { FileReview } from "./file-review";
import { needReferentRows } from "./need-referent-view";

/**
 * Sotto un'esigenza di «Cosa serve» (SPEC §5.2, §P2.10.7): la riga della richiesta («Chiesta a
 * Mario Rossi il 27/10 · Promemoria inviato il 30/10»), il segnale «Senza risposta» quando la riga
 * non lo dice già, e le risposte e i file arrivati, chiusi sotto «Risposte e file · n». I file si
 * scaricano da una rotta che controlla chi guarda. Niente di tutto questo arriva ai contributori.
 */
export function NeedReferentBlock({
  workspaceId,
  useCaseId,
  view,
  canEdit,
  canReviewFiles,
  onOpen,
}: {
  workspaceId: string;
  useCaseId: string;
  view: NeedReferentView | null | undefined;
  canEdit: boolean;
  canReviewFiles: boolean;
  onOpen: (dialog: ReferentDialog) => void;
}) {
  const rows = needReferentRows(view, { canEdit, canReviewFiles });
  if (!rows.line && !rows.silentTag && !rows.summary) return null;
  return (
    <div data-slot="need-referent" className="space-y-1">
      {rows.line || rows.silentTag ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs break-words text-muted-foreground">
          {rows.line ? <span data-slot="need-referent-line">{rows.line}</span> : null}
          {rows.silentTag ? <StatusDot tone="rosso" label={rows.silentTag} /> : null}
        </p>
      ) : null}
      {rows.summary ? (
        <Disclosure summary={rows.summary} slot="need-referent-entries">
          <ul className="space-y-2 border-l pl-3">
            {rows.answers.map((answer) => (
              <li key={answer.id} data-slot="need-answer" className="space-y-0.5">
                <p className="text-xs text-muted-foreground">{answer.header}</p>
                <p className={answer.dontKnow ? "text-sm text-muted-foreground italic" : "text-sm break-words whitespace-pre-wrap"}>{answer.body}</p>
                {answer.canRemove ? (
                  <Button type="button" variant="ghost" size="sm" className="-ml-2 min-h-11 text-muted-foreground sm:min-h-7"
                    aria-label={`${REFERENT_UI_TEXT.removeAnswer}: ${answer.header}`}
                    onClick={() => onOpen({ kind: "removeAnswer", answerId: answer.id })}
                  >
                    {REFERENT_UI_TEXT.removeAnswer}
                  </Button>
                ) : null}
              </li>
            ))}
            {rows.files.map((file) => (
              <li key={file.id} data-slot="need-file" data-status={file.inReview ? "in_revisione" : "pulito"} className="space-y-1">
                <p className="text-xs text-muted-foreground">{file.header}</p>
                <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="min-w-0 font-medium break-all">{file.name}</span>
                  {file.sizeLabel ? <span className="text-xs text-muted-foreground">{file.sizeLabel}</span> : null}
                  {file.reviewLabel ? <StatusDot tone="giallo" label={file.reviewLabel} /> : null}
                  {file.personalWarning ? <StatusDot tone="giallo" label={file.personalWarning} /> : null}
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  {file.href ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 sm:min-h-7"
                      aria-label={`${file.downloadLabel}: ${file.name}`}
                      render={<a href={file.href} download />}
                      nativeButton={false}
                    >
                      <Download aria-hidden />
                      {file.downloadLabel}
                    </Button>
                  ) : null}
                  {file.canReview ? <FileReview workspaceId={workspaceId} useCaseId={useCaseId} fileId={file.id} onReject={() => onOpen({ kind: "rejectFile", fileId: file.id })} /> : null}
                  {file.canDelete ? (
                    <Button type="button" variant="ghost" size="sm" className="min-h-11 text-muted-foreground sm:min-h-7"
                      aria-label={`${REFERENT_UI_TEXT.fileDelete}: ${file.name}`}
                      onClick={() => onOpen({ kind: "deleteFile", fileId: file.id })}
                    >
                      <Trash2 aria-hidden />
                      {REFERENT_UI_TEXT.fileDelete}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}
