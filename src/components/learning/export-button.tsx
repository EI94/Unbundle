"use client";
import { useRef, useState } from "react";
import { CircleCheck, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportLearningCsv } from "@/lib/learning/client";
import { cn } from "@/lib/utils";

/** Scarica i risultati individuali in CSV. Ogni download viene registrato dal server. */
export function LearningExportButton({ workspaceId, programId, label = "Scarica i risultati (CSV)", testId = "results-export-button", className }: {
  workspaceId: string; programId: string; label?: string; testId?: string; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const inFlight = useRef(false);
  const download = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setNotice(null);
    try {
      const result = await exportLearningCsv({ workspaceId, programId });
      if (!result.ok) { setNotice({ ok: false, text: result.message }); return; }
      const url = URL.createObjectURL(new Blob([result.data.csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = result.data.filename;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      // Qualche browser legge il file dopo il clic: si libera la memoria poco dopo.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({ ok: true, text: "File scaricato. Il download è registrato." });
    } catch { setNotice({ ok: false, text: "Download non riuscito. Nessun file creato: riprova tra poco." }); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <div className="space-y-3">
    <Button type="button" disabled={busy} aria-busy={busy} onClick={download} data-testid={testId}
      className={cn("h-auto min-h-11 max-w-full gap-2 whitespace-normal bg-emerald-600 px-5 py-2 text-base text-white hover:bg-emerald-500", className)}>
      <Download aria-hidden className="size-5" /> {busy ? "Preparazione del file…" : label}
    </Button>
    <div aria-live="polite" aria-atomic="true">
      {notice && <p role={notice.ok ? "status" : "alert"} className={cn("flex items-start gap-2 text-sm", notice.ok ? "text-emerald-300" : "text-destructive")}>
        {notice.ok && <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />}{notice.text}
      </p>}
    </div>
  </div>;
}
