"use client";

import { Download } from "lucide-react";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { Button } from "@/components/ui/button";
import { removeTemplateFileAction, reviewTemplateFileAction } from "@/lib/actions/use-case-referents";
import { REFERENT_UI_TEXT } from "@/lib/use-cases/referent/labels";
import type { ReferentDialog } from "./dialogs";
import type { NeedTemplateRow } from "./need-referent-view";
import { useReferentRunner } from "./referent-actions";

const T = REFERENT_UI_TEXT;
const LINK_ACTION = "h-auto min-h-11 px-0 py-0 text-xs sm:min-h-0";

/** «Accetta il file» / «Rifiuta il file» di un PDF da compilare: il rifiuto chiede conferma (`rejectTemplate`). */
function TemplateReview({ workspaceId, useCaseId, fileId, onOpen }: { workspaceId: string; useCaseId: string; fileId: string; onOpen: (dialog: ReferentDialog) => void }) {
  const { pending, run } = useReferentRunner();
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 sm:min-h-7"
        aria-busy={pending || undefined}
        onClick={() => {
          if (!pending) void run(() => reviewTemplateFileAction(workspaceId, useCaseId, fileId, "accetta"), { inDialog: false });
        }}
      >
        {T.fileAccept}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="min-h-11 text-destructive sm:min-h-7" onClick={() => onOpen({ kind: "rejectTemplate", fileId })}>
        {T.fileReject}
      </Button>
    </span>
  );
}

/**
 * («File da compilare») Sotto un'esigenza, a vista: «Da compilare: {nome} · Sostituisci · Togli». Il nome scarica il
 * file; «Sostituisci» apre la finestra della versione nuova; «Togli» lo toglie da questa esigenza (dall'ultima, il file
 * si cancella). Un PDF da controllare ha «Accetta il file» e «Rifiuta il file» per chi non l'ha caricato, e la versione
 * nuova in controllo sta sotto, con «Nuova versione da controllare: PDF con poco testo». Non è una risposta: l'esigenza
 * non cambia.
 */
export function NeedTemplateLine({
  workspaceId,
  useCaseId,
  needId,
  row,
  onOpen,
}: {
  workspaceId: string;
  useCaseId: string;
  needId: string;
  row: NeedTemplateRow;
  onOpen: (dialog: ReferentDialog) => void;
}) {
  const { pending, run } = useReferentRunner();
  return (
    <div data-slot="need-template" data-status={row.reviewLabel ? "in_revisione" : "pulito"} className="space-y-1">
      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        <span>{row.label}</span>
        {row.href ? (
          <a href={row.href} download className="min-w-0 font-medium break-all text-foreground underline underline-offset-2 hover:no-underline">
            {row.name}
          </a>
        ) : (
          <span className="min-w-0 font-medium break-all text-foreground">{row.name}</span>
        )}
        {row.sizeLabel ? <span>{row.sizeLabel}</span> : null}
        {row.reviewLabel ? <StatusDot tone="giallo" label={row.reviewLabel} /> : null}
        {row.canReplace ? (
          <>
            <span aria-hidden>·</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className={LINK_ACTION}
              aria-label={`${T.templateReplace}: ${row.name}`}
              onClick={() => onOpen({ kind: "replaceTemplate", file: { id: row.id, name: row.name } })}
            >
              {T.templateReplace}
            </Button>
          </>
        ) : null}
        {row.canRemove ? (
          <>
            <span aria-hidden>·</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className={`${LINK_ACTION} text-muted-foreground`}
              aria-label={`${T.templateRemove}: ${row.name}`}
              aria-busy={pending || undefined}
              onClick={() => {
                if (!pending) void run(() => removeTemplateFileAction(workspaceId, useCaseId, row.id, needId), { inDialog: false });
              }}
            >
              {T.templateRemove}
            </Button>
          </>
        ) : null}
      </p>
      {row.canReview ? <TemplateReview workspaceId={workspaceId} useCaseId={useCaseId} fileId={row.id} onOpen={onOpen} /> : null}
      {row.pending ? (
        <div data-slot="need-template-pending" className="space-y-1 border-l pl-3">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <StatusDot tone="giallo" label={row.pending.label} />
            <span className="min-w-0 font-medium break-all text-foreground">{row.pending.name}</span>
            {row.pending.sizeLabel ? <span>{row.pending.sizeLabel}</span> : null}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {row.pending.href ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-7"
                aria-label={`${row.pending.downloadLabel}: ${row.pending.name}`}
                render={<a href={row.pending.href} download />}
                nativeButton={false}
              >
                <Download aria-hidden />
                {row.pending.downloadLabel}
              </Button>
            ) : null}
            {row.pending.canReview ? <TemplateReview workspaceId={workspaceId} useCaseId={useCaseId} fileId={row.pending.id} onOpen={onOpen} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
