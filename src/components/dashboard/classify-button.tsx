"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { CLASSIFY_BUTTON_LABEL, CLASSIFY_FAILED, classifyOutcome } from "./classify-outcome";

export function ClassifyButton({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleClassify = async () => {
    setLoading(true);
    // L'avviso e l'aggiornamento della pagina li decide classify-outcome.ts.
    let outcome = CLASSIFY_FAILED;
    try {
      const res = await fetch("/api/ai/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      outcome = classifyOutcome(res.ok ? await res.json() : null);
    } catch {
      // Rete o risposta illeggibile: CLASSIFY_FAILED.
    } finally {
      setLoading(false);
    }
    toast[outcome.level](outcome.text);
    if (outcome.refresh) router.refresh();
  };

  return (
    <Button onClick={handleClassify} disabled={loading}>
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="mr-2 h-4 w-4" />
      )}
      {loading ? CLASSIFY_BUTTON_LABEL.busy : CLASSIFY_BUTTON_LABEL.idle}
    </Button>
  );
}
