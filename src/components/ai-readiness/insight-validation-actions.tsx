"use client";

import { useState, useTransition } from "react";
import { updateAiReadinessInsightStatusAction, type AiReadinessActionState } from "@/lib/actions/ai-readiness";
import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import { Button } from "@/components/ui/button";
import { notifyDone } from "@/components/ui-10/toast";

const INITIAL: AiReadinessActionState = { ok: true };
const I = READINESS_TEXT.insights;
type Verdict = "reviewed" | "approved" | "rejected";

/**
 * Le tre scelte su un insight (rilascio 10, ondata 7b; audit «Fuori» AD-8, §8.4): «Segna come visto», «Approva»,
 * «Scarta». Bordate o fantasma, mai piene: il pieno della pagina è il prossimo passo. Le azioni sono quelle di oggi.
 */
export function InsightValidationActions({
  workspaceId,
  assessmentId,
  insightId,
  status,
}: {
  workspaceId: string;
  assessmentId: string;
  insightId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(verdict: Verdict) {
    setError(null);
    startTransition(async () => {
      const result = await updateAiReadinessInsightStatusAction(workspaceId, assessmentId, insightId, verdict, INITIAL, new FormData());
      if (result.ok) notifyDone(result.message ?? I.approve);
      else setError(result.message ?? READINESS_TEXT.step.failed);
    });
  }

  const size = "min-h-11 sm:min-h-8";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "approved" ? (
        <Button type="button" variant="outline" className={size} disabled={pending} onClick={() => decide("approved")}>
          {I.approve}
        </Button>
      ) : null}
      {status !== "reviewed" && status !== "approved" ? (
        <Button type="button" variant="ghost" className={size} disabled={pending} onClick={() => decide("reviewed")}>
          {I.seen}
        </Button>
      ) : null}
      {status !== "rejected" ? (
        <Button type="button" variant="ghost" className={size} disabled={pending} onClick={() => decide("rejected")}>
          {I.discard}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
