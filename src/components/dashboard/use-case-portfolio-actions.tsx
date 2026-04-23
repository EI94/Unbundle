"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  setUseCaseStatusAction,
  setUseCaseWaveCategoryAction,
} from "@/lib/actions/use-cases";
import type { UseCase } from "@/lib/db/schema";
import {
  USE_CASE_CATEGORIES,
  allowedNextStatuses,
} from "@/lib/use-case-lifecycle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const statusActionLabels: Record<string, string> = {
  accepted: "Accetta nel portfolio",
  rejected: "Rifiuta",
  in_progress: "Segna in corso",
  implemented: "Segna implementato",
};

const categoryLabels: Record<string, string> = {
  quick_win: "Quick Win",
  strategic_bet: "Strategic Bet",
  capability_builder: "Capability Builder",
  not_yet: "Not Yet",
};

export function UseCasePortfolioActions({
  workspaceId,
  useCaseId,
  initialStatus,
  initialCategory,
}: {
  workspaceId: string;
  useCaseId: string;
  initialStatus: UseCase["status"];
  initialCategory: UseCase["category"] | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState<string>(
    initialCategory ?? "not_yet"
  );

  useEffect(() => {
    setCategory(initialCategory ?? "not_yet");
  }, [initialCategory]);

  const nextOptions = [...allowedNextStatuses(initialStatus)];

  const runStatus = (status: UseCase["status"]) => {
    startTransition(async () => {
      try {
        await setUseCaseStatusAction(workspaceId, useCaseId, status);
        toast.success("Stato aggiornato");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Errore");
      }
    });
  };

  const runWave = () => {
    startTransition(async () => {
      try {
        await setUseCaseWaveCategoryAction(
          workspaceId,
          useCaseId,
          category as (typeof USE_CASE_CATEGORIES)[number]
        );
        toast.success("Quadrante aggiornato");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Errore");
      }
    });
  };

  const terminal = initialStatus === "implemented" || initialStatus === "rejected";

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Azioni portfolio</CardTitle>
        <p className="text-sm text-muted-foreground font-normal">
          Gestisci il ciclo di vita e, se serve, il quadrante della matrice
          (priorità manuale). Un aggiornamento degli score via API ricalcola la
          categoria automaticamente.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {!terminal && nextOptions.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-2">Stato</p>
            <div className="flex flex-wrap gap-2">
              {nextOptions.map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={s === "rejected" ? "outline" : "default"}
                  disabled={pending}
                  className={cn(
                    s === "rejected" && "text-destructive border-destructive/40"
                  )}
                  onClick={() => runStatus(s)}
                >
                  {statusActionLabels[s] ?? s}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-sm font-medium mb-2">Quadrante (wave)</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              className="flex h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              value={category}
              disabled={pending}
              onChange={(e) => setCategory(e.target.value)}
            >
              {USE_CASE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabels[c] ?? c}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={runWave}
            >
              Salva quadrante
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
