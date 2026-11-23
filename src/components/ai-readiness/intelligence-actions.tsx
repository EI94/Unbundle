"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { generateAiReadinessInsightsAction, type AiReadinessActionState } from "@/lib/actions/ai-readiness";
import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import { Button } from "@/components/ui/button";
import { notifyDone } from "@/components/ui-10/toast";

const INITIAL: AiReadinessActionState = { ok: true };
const I = READINESS_TEXT.insights;

/**
 * «Genera la sintesi» nella scheda Insight (rilascio 10, ondata 7b): bordato, perché quando è il prossimo passo il
 * pulsante pieno sta nella testata. L'azione è quella di oggi: la sintesi è fatta di regole, nessun modello.
 */
export function IntelligenceActions({ workspaceId, assessmentId }: { workspaceId: string; assessmentId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        className="min-h-11 sm:min-h-9"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await generateAiReadinessInsightsAction(workspaceId, assessmentId, INITIAL, new FormData());
            if (result.ok) notifyDone(result.message ?? READINESS_TEXT.done.synthesis(result.data?.generated ?? 0));
            else setError(result.message ?? READINESS_TEXT.step.failed);
          });
        }}
      >
        <Sparkles aria-hidden data-icon="inline-start" />
        {pending ? I.generating : I.generate}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
