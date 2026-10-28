"use client";

import { ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prepareReferentQuestionsAction } from "@/lib/actions/use-case-referents";
import { REFERENT_UI_TEXT } from "@/lib/use-cases/referent/labels";
import { useReferentRunner } from "./referent-actions";

/**
 * «Prepara le domande» (SPEC §5.2, §6) nel capitolo, accanto a «Chiedi al referente» spento: aggiunge
 * a «Cosa serve» le domande standard che mancano su questa scheda, senza mandare niente. C'è solo
 * quando qualcosa si può preparare ma un altro motivo tiene chiusa la finestra (`askEntry().showPrepare`):
 * negli altri casi «Prepara le domande» sta nella finestra di «Chiedi al referente». Dopo, il toast e la
 * rilettura della pagina: le domande preparate non mancano più e il pulsante sparisce.
 */
export function PrepareButton({ workspaceId, useCaseId, describedBy }: { workspaceId: string; useCaseId: string; describedBy?: string }) {
  const { pending, run } = useReferentRunner();
  return (
    <Button
      type="button"
      variant="ghost"
      className="min-h-11 sm:min-h-8"
      aria-busy={pending || undefined}
      aria-describedby={describedBy}
      onClick={() => {
        if (pending) return;
        void run(() => prepareReferentQuestionsAction(workspaceId, useCaseId), { inDialog: false });
      }}
    >
      <ListPlus aria-hidden />
      {REFERENT_UI_TEXT.prepare}
    </Button>
  );
}
