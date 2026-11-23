"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  promoteAiReadinessUseCaseToPortfolioAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import { Button } from "@/components/ui/button";

const INITIAL: AiReadinessActionState<{ useCaseId: string }> = { ok: true };
const C = READINESS_TEXT.collection;

/**
 * Uno use case proposto dal questionario (rilascio 10, ondata 7b; audit «Fuori» AD-11, §8.4): «Aggiungi agli use case»
 * (bordato: il pieno è il prossimo passo della pagina) oppure, già aggiunto, «Apri lo use case». L'azione è quella di
 * oggi («Porta nel Portfolio»); il link apre la scheda dello use case (`useCaseBase` più l'id).
 */
export function UseCasePromoteButton({
  workspaceId,
  assessmentId,
  submissionId,
  linkedUseCaseId,
  useCaseBase,
}: {
  workspaceId: string;
  assessmentId: string;
  submissionId: string;
  linkedUseCaseId: string | null;
  /** Dove si apre uno use case di questo workspace, senza l'id finale («/dashboard/<ws>/use-cases/»). */
  useCaseBase: string;
}) {
  const action = promoteAiReadinessUseCaseToPortfolioAction.bind(null, workspaceId, assessmentId, submissionId);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const useCaseId = linkedUseCaseId ?? state.data?.useCaseId ?? null;
  const size = "min-h-11 sm:min-h-8";

  if (useCaseId) {
    return (
      <Button variant="ghost" className={size} render={<Link href={`${useCaseBase}${encodeURIComponent(useCaseId)}`} />} nativeButton={false}>
        {C.openUseCase}
      </Button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="outline" className={size} disabled={pending}>
        {pending ? C.promoting : C.promote}
      </Button>
      {state.message && !state.ok ? <p className="text-xs text-destructive">{state.message}</p> : null}
    </form>
  );
}
