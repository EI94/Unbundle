"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { suggestOKRsAction, type SuggestedOKR } from "@/lib/actions/strategy";

interface SuggestOKRsButtonProps {
  workspaceId: string;
}

export function SuggestOKRsButton({ workspaceId }: SuggestOKRsButtonProps) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedOKR[] | null>(null);

  const handleSuggest = async () => {
    setLoading(true);
    try {
      const result = await suggestOKRsAction(workspaceId);
      setSuggestions(result);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Errore nella generazione"
      );
    } finally {
      setLoading(false);
    }
  };

  if (suggestions) {
    return (
      <div className="mb-8 rounded-lg border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Suggerimenti AI</span>
          </div>
          <button
            onClick={() => setSuggestions(null)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Chiudi
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Basati sulla Value Thesis. Usa il form &ldquo;Aggiungi&rdquo; per salvarli.
        </p>
        <div className="space-y-3">
          {suggestions.map((s, i) => (
            <div
              key={i}
              className="rounded-lg bg-accent/50 px-3 py-2.5"
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs text-muted-foreground uppercase">
                  {s.type === "key_result" ? "KR" : s.type}
                </span>
                {s.timeframe && (
                  <span className="text-xs text-muted-foreground">
                    {s.timeframe}
                  </span>
                )}
              </div>
              <p className="text-sm font-medium">{s.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {s.description}
              </p>
              {s.kpiName && (
                <p className="text-xs text-muted-foreground mt-1">
                  KPI: {s.kpiName}
                  {s.direction && ` (${s.direction})`}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={handleSuggest}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent transition-colors disabled:opacity-50"
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Sparkles className="h-3 w-3" />
      )}
      Suggerisci OKR con AI
    </button>
  );
}
