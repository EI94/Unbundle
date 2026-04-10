"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export function ClassifyButton({ workspaceId }: { workspaceId: string }) {
  const [loading, setLoading] = useState(false);

  const handleClassify = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json();
      if (data.classified > 0) {
        toast.success(
          `${data.classified} attivita' classificate su ${data.total} totali`
        );
        window.location.reload();
      } else {
        toast.info("Tutte le attivita' sono gia' classificate");
      }
    } catch {
      toast.error("Errore durante la classificazione");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleClassify} disabled={loading}>
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="mr-2 h-4 w-4" />
      )}
      {loading ? "Classificazione in corso..." : "Classifica attivita'"}
    </Button>
  );
}
