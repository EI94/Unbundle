"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { exportLearningCsv } from "@/lib/learning/client";
export function LearningExportButton({ workspaceId, programId }: { workspaceId: string; programId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const download = async () => {
    setBusy(true);
    try {
      const result = await exportLearningCsv({ workspaceId, programId });
      if (!result.ok) { setMessage(result.message); return; }
      const url = URL.createObjectURL(new Blob([result.data.csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = result.data.filename; anchor.click(); URL.revokeObjectURL(url);
      setMessage("Export autorizzato generato. L’operazione è registrata nel registro accessi.");
    } catch { setMessage("Export non disponibile. Nessun file generato."); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2"><Button variant="outline" disabled={busy} onClick={download}>Esporta risultati nominativi CSV</Button><p role="status" className="text-sm">{message}</p></div>;
}
