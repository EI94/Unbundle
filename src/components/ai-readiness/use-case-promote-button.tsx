"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  promoteAiReadinessUseCaseToPortfolioAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import { Button } from "@/components/ui/button";

const INITIAL: AiReadinessActionState<{ useCaseId: string }> = { ok: true };

export function UseCasePromoteButton({
  workspaceId,
  assessmentId,
  submissionId,
  linkedUseCaseId,
}: {
  workspaceId: string;
  assessmentId: string;
  submissionId: string;
  linkedUseCaseId: string | null;
}) {
  const action = promoteAiReadinessUseCaseToPortfolioAction.bind(
    null,
    workspaceId,
    assessmentId,
    submissionId
  );
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const useCaseId = linkedUseCaseId ?? state.data?.useCaseId ?? null;

  if (useCaseId) {
    return (
      <Button
        size="sm"
        variant="outline"
        render={<Link href={`/dashboard/${workspaceId}/portfolio/review/${useCaseId}`} />}
        nativeButton={false}
      >
        Apri nel Portfolio
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Collego..." : "Porta nel Portfolio"}
        </Button>
      </form>
      {state.message && (
        <p className={`text-xs ${state.ok ? "text-emerald-600" : "text-destructive"}`}>
          {state.message}
        </p>
      )}
    </div>
  );
}
