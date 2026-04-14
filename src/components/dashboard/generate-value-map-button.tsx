"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { generateValueMapAction } from "@/lib/actions/value-map";

interface GenerateValueMapButtonProps {
  workspaceId: string;
  hasNodes: boolean;
}

export function GenerateValueMapButton({
  workspaceId,
  hasNodes,
}: GenerateValueMapButtonProps) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await generateValueMapAction(workspaceId);
      toast.success(`${result.positioned} attività posizionate sulla mappa`);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Errore nella generazione"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleGenerate}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent transition-colors disabled:opacity-50"
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <MapPin className="h-3 w-3" />
      )}
      {hasNodes ? "Rigenera mappa" : "Genera mappa"}
    </button>
  );
}
