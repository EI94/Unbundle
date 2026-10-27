"use client";

import { Button } from "@/components/ui/button";
import { reviewNeedFileAction } from "@/lib/actions/use-case-referents";
import { REFERENT_UI_TEXT } from "@/lib/use-cases/referent/labels";
import { useReferentRunner } from "./referent-actions";

/**
 * «Accetta il file» / «Rifiuta il file» di un PDF con poco testo (SPEC §5.2, §3.9): solo una persona
 * di Lateral Space che non l'ha caricato. Il rifiuto chiede conferma (`onReject` apre la finestra).
 */
export function FileReview({ workspaceId, useCaseId, fileId, onReject }: { workspaceId: string; useCaseId: string; fileId: string; onReject: () => void }) {
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
          if (!pending) void run(() => reviewNeedFileAction(workspaceId, useCaseId, fileId, "accetta"), { inDialog: false });
        }}
      >
        {REFERENT_UI_TEXT.fileAccept}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="min-h-11 text-destructive sm:min-h-7" onClick={onReject}>
        {REFERENT_UI_TEXT.fileReject}
      </Button>
    </span>
  );
}
