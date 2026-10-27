"use client";

import { ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prepareReferentQuestionsAction } from "@/lib/actions/use-case-referents";
import type { PreparedQuestionKey } from "@/lib/use-cases/referent/contract";
import { REFERENT_UI_TEXT } from "@/lib/use-cases/referent/labels";
import { useReferentRunner } from "./referent-actions";

/**
 * «Prepara le domande» (SPEC §5.2, §6): aggiunge a «Cosa serve» le domande standard che mancano su
 * questa scheda. Spento quando non manca niente da chiedere, con il motivo nel titolo.
 */
export function PrepareButton({ workspaceId, useCaseId, preparable }: { workspaceId: string; useCaseId: string; preparable: readonly PreparedQuestionKey[] }) {
  const { pending, run } = useReferentRunner();
  const disabled = preparable.length === 0;
  const button = (
    <Button
      type="button"
      variant="ghost"
      className="min-h-11 sm:min-h-8"
      disabled={disabled}
      aria-busy={pending || undefined}
      onClick={() => {
        if (pending) return;
        void run(() => prepareReferentQuestionsAction(workspaceId, useCaseId), { inDialog: false });
      }}
    >
      <ListPlus aria-hidden />
      {REFERENT_UI_TEXT.prepare}
    </Button>
  );
  // Un pulsante spento non riceve il puntatore: il motivo sta nel titolo di chi lo contiene.
  return disabled ? (
    <span title={REFERENT_UI_TEXT.prepareDisabledTitle} className="inline-flex">
      {button}
    </span>
  ) : (
    button
  );
}
