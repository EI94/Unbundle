"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  preGenerateActivitiesFromDocuments,
  confirmPreGeneratedActivities,
  type PreGeneratedActivity,
} from "@/lib/actions/pre-generate-activities";
import { Loader2, Sparkles, Check, X, Clock, Wrench } from "lucide-react";
import { toast } from "sonner";

interface ActivityPreGeneratorProps {
  workspaceId: string;
  departmentId: string;
  hasDocuments: boolean;
}

const workTypeLabels: Record<string, string> = {
  enrichment: "Enrichment",
  detection: "Detection",
  interpretation: "Interpretation",
  delivery: "Delivery",
};

export function ActivityPreGenerator({
  workspaceId,
  departmentId,
  hasDocuments,
}: ActivityPreGeneratorProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [proposals, setProposals] = useState<PreGeneratedActivity[] | null>(
    null
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());

  if (!hasDocuments) return null;

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await preGenerateActivitiesFromDocuments(
        workspaceId,
        departmentId
      );
      if (result.activities.length === 0) {
        toast.info(
          "Non ho trovato attività specifiche nei documenti. Procedi con la chat."
        );
        setProposals(null);
      } else {
        setProposals(result.activities);
        setSelected(new Set(result.activities.map((_, i) => i)));
      }
    } catch {
      toast.error("Errore nell'analisi dei documenti");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!proposals) return;
    const confirmed = proposals.filter((_, i) => selected.has(i));
    if (confirmed.length === 0) {
      toast.info("Nessuna attività selezionata");
      return;
    }

    setConfirming(true);
    try {
      const result = await confirmPreGeneratedActivities(
        workspaceId,
        departmentId,
        confirmed
      );
      toast.success(`${result.saved} attività salvate dai documenti`);
      setProposals(null);
      router.refresh();
    } catch {
      toast.error("Errore nel salvataggio");
    } finally {
      setConfirming(false);
    }
  };

  const toggleActivity = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  if (!proposals) {
    return (
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Sparkles className="h-3 w-3" />
        )}
        {loading ? "Analizzo documenti..." : "Pre-genera da documenti"}
      </button>
    );
  }

  return (
    <div className="border-b border-border">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium">
              Attività identificate dai documenti
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {selected.size}/{proposals.length} selezionate — conferma quelle
              corrette, la chat partirà da qui
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setProposals(null)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Annulla
            </button>
            <button
              onClick={handleConfirm}
              disabled={confirming || selected.size === 0}
              className="flex items-center gap-1.5 rounded-lg bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-30"
            >
              {confirming ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Conferma {selected.size}
            </button>
          </div>
        </div>

        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
          {proposals.map((act, i) => {
            const isSelected = selected.has(i);
            return (
              <button
                key={i}
                onClick={() => toggleActivity(i)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  isSelected
                    ? "border-foreground/20 bg-accent/50"
                    : "border-border/50 opacity-50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium leading-snug">
                      {act.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {act.description}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      {act.workType && (
                        <span>{workTypeLabels[act.workType]}</span>
                      )}
                      {act.estimatedHoursWeek && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          {act.estimatedHoursWeek}h/sett
                        </span>
                      )}
                      {act.toolsUsed && act.toolsUsed.length > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Wrench className="h-2.5 w-2.5" />
                          {act.toolsUsed.join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 mt-0.5">
                    {isSelected ? (
                      <div className="h-4 w-4 rounded-full bg-foreground flex items-center justify-center">
                        <Check className="h-2.5 w-2.5 text-background" />
                      </div>
                    ) : (
                      <div className="h-4 w-4 rounded-full border border-border" />
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
