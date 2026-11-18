"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { refreshDossier } from "@/components/uc/shell/transition-retry";
import { cn } from "@/lib/utils";
import { ACCEPTED_FILE_TYPES, formatSize, uploadFile, type UploadedFile } from "./upload-transport";

/**
 * Caricamento di Lateral Space nel pannello dei documenti: scelta del file,
 * esito del controllo subito sotto (pronto, in revisione, rifiutato e
 * cancellato, già caricato). Dopo un caricamento la pagina si aggiorna, così il
 * file compare tra i file caricati. (Ondata 0, privacy calma del 04/11) Niente
 * casella da spuntare prima del file: il controllo automatico resta, e lo dice
 * una riga calma.
 */
export function UploadPanelClient({
  workspaceId,
  caseId,
  itemId,
  personal,
  clientMode,
}: {
  workspaceId: string;
  caseId: string;
  itemId: string | null;
  personal: boolean;
  /** Vercel Blob configurato: file fino a 20 MB (altrimenti 4 MB). */
  clientMode: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<UploadedFile[]>([]);

  async function onFile(file: File) {
    setError(null);
    setBusy(true);
    const r = await uploadFile({ kind: "interno", workspaceId, caseId, itemId }, file, { personal });
    setBusy(false);
    if (input.current) input.current.value = "";
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setDone((d) => [r.file, ...d.filter((x) => x.fileId !== r.file.fileId)].slice(0, 5));
    refreshDossier(router);
  }

  const limit = personal ? "4 MB, cifrato" : clientMode ? "20 MB" : "4 MB";

  return (
    <div className="min-w-0 space-y-3">
      <input
        ref={input}
        id={`${id}-file`}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        className="sr-only"
        aria-label="Scegli il file da caricare"
        disabled={busy}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) void onFile(file);
        }}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()} className="min-h-11 sm:min-h-9">
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
          {busy ? "Carico e controllo il file…" : "Scegli un file"}
        </Button>
        <span className="text-xs text-muted-foreground">PDF, Word, Excel, PowerPoint, CSV o testo, fino a {limit}.</span>
      </div>
      <p className="text-xs break-words text-muted-foreground">Ogni file passa da un controllo automatico.</p>

      {error ? (
        <p role="alert" className="rounded-lg bg-uc-rosso-bg px-3 py-2 text-sm break-words text-uc-rosso">
          {error}
        </p>
      ) : null}

      {done.length > 0 ? (
        <ul className="space-y-2" aria-label="File appena caricati">
          {done.map((f) => {
            const tone = f.status === "rifiutato" ? "rosso" : f.usable ? "verde" : "giallo";
            const label = f.status === "rifiutato" ? "Rifiutato e cancellato" : f.usable ? "Pronto" : "In revisione";
            return (
              <li key={f.fileId} className={cn("flex min-w-0 items-start gap-2 rounded-lg px-3 py-2 text-sm", f.status === "rifiutato" ? "bg-uc-rosso-bg" : "bg-muted/40")}>
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium break-all">{f.fileName}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusDot tone={tone} label={label} className="shrink-0" />
                    {formatSize(f.sizeBytes) ? <span className="text-xs text-muted-foreground">{formatSize(f.sizeBytes)}</span> : null}
                  </div>
                  {f.duplicate ? <p className="text-xs text-muted-foreground">Era già stato caricato: si usa quello.</p> : null}
                  {f.message && !f.duplicate ? <p className="text-xs break-words text-muted-foreground">{f.message}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
