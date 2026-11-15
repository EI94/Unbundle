"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export function ClassifyButton({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
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
      // Le attività che il modello non ha classificato (un rifiuto o un errore) restano da fare: si dice quante.
      // refresh() e non reload(): l'avviso resta a schermo.
      if (data.skipped > 0) {
        if (data.classified > 0) {
          toast.warning(`${data.classified} attività classificate su ${data.total} totali. ${data.skippedText} Riprova più tardi.`);
          router.refresh();
        } else {
          toast.error(`${data.skippedText} Riprova più tardi.`);
        }
      } else if (data.classified > 0) {
        toast.success(
          `${data.classified} attivita' classificate su ${data.total} totali`
        );
        router.refresh();
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
