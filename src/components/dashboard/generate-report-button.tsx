"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import { generateReportAction } from "@/lib/actions/reports";

export function GenerateReportButton({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      await generateReportAction(workspaceId);
      toast.success("Report generato con successo");
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
        <FileText className="mr-2 h-4 w-4" />
      )}
      {loading ? "Generazione in corso..." : "Genera Report"}
    </Button>
  );
}
