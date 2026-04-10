"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Lightbulb } from "lucide-react";
import { toast } from "sonner";
import { generateUseCasesAction } from "@/lib/actions/use-cases";

export function GenerateUseCasesButton({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await generateUseCasesAction(workspaceId);
      toast.success(`${result.generated} use case generati con successo`);
      window.location.reload();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Errore nella generazione"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleGenerate} disabled={loading}>
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Lightbulb className="mr-2 h-4 w-4" />
      )}
      {loading ? "Generazione in corso..." : "Genera Use Cases"}
    </Button>
  );
}
