"use client";

import { useId } from "react";
import { ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prepareReferentQuestionsAction } from "@/lib/actions/use-case-referents";
import type { PreparedQuestionKey } from "@/lib/use-cases/referent/contract";
import { REFERENT_UI_TEXT } from "@/lib/use-cases/referent/labels";
import { useReferentRunner } from "./referent-actions";

/**
 * «Prepara le domande» (SPEC §5.2, §6): aggiunge a «Cosa serve» le domande standard che mancano su
 * questa scheda. Spento quando non c'è niente da aggiungere, con il motivo scritto accanto (visibile
 * anche al telefono e letto dai lettori di schermo con `aria-describedby`): «Non manca niente da
 * chiedere» quando alla scheda non mancano dati, altrimenti «Le domande standard ci sono già o sono
 * state archiviate».
 */
export function PrepareButton({
  workspaceId,
  useCaseId,
  preparable,
  gaps = false,
}: {
  workspaceId: string;
  useCaseId: string;
  preparable: readonly PreparedQuestionKey[];
  /** `panel.prepareGaps`: alla scheda mancano dati, anche se le domande ci sono già. */
  gaps?: boolean;
}) {
  const { pending, run } = useReferentRunner();
  const reasonId = useId();
  const disabled = preparable.length === 0;
  const reason = disabled ? (gaps ? REFERENT_UI_TEXT.prepareDisabledPresent : REFERENT_UI_TEXT.prepareDisabledTitle) : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button
        type="button"
        variant="ghost"
        aria-disabled={disabled || undefined}
        aria-describedby={reason ? reasonId : undefined}
        aria-busy={pending || undefined}
        onClick={() => {
          if (pending || disabled) return;
          void run(() => prepareReferentQuestionsAction(workspaceId, useCaseId), { inDialog: false });
        }}
        className={disabled ? "min-h-11 cursor-not-allowed opacity-50 sm:min-h-8" : "min-h-11 sm:min-h-8"}
      >
        <ListPlus aria-hidden />
        {REFERENT_UI_TEXT.prepare}
      </Button>
      {reason ? (
        <span id={reasonId} data-slot="prepare-reason" className="text-xs break-words text-muted-foreground">
          {reason}
        </span>
      ) : null}
    </span>
  );
}
