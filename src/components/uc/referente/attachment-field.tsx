"use client";

import { useId, useRef, useState } from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { ACCEPTED_FILE_TYPES, formatSize, uploadFile } from "@/components/uc/documents/upload-transport";
import { cn } from "@/lib/utils";

/**
 * Allegati di una risposta nella pagina del referente (`/r/[token]`, PIANO
 * §5.4, §6.2–6.3): scelta del file, caricamento in quarantena e controllo
 * subito (tipo dal contenuto, intestazioni, testo sanitario). Un file non
 * accettato viene cancellato e qui lo diciamo in chiaro; un PDF poco leggibile
 * aspetta il controllo di Lateral Space. Solo i file «pronti» partono con la
 * risposta.
 *
 * (Ondata 0, privacy calma del 04/11) Niente casella da spuntare prima del
 * file, come su `/rispondi` dal rilascio 5.1: il controllo automatico resta e
 * l'informativa lo dice una volta (`REFERENT_PRIVACY_NOTICE`).
 *
 * Nessun componente con portale (la pagina è in `.survey-light`), aree di
 * tocco di almeno 44 px, nomi lunghi che vanno a capo. Il token serve solo per
 * l'indirizzo delle chiamate: mai salvato. Le voci personali passano sempre dal
 * server (cifratura prima della scrittura) e niente resta sul dispositivo.
 */
export interface AttachmentRef {
  fileId: string;
  fileName: string;
  sizeBytes: number | null;
  status: "in_quarantena" | "pulito" | "rifiutato";
}

export interface AttachmentFieldProps {
  /** Token della richiesta, usato solo per le chiamate a `/api/r/[token]/upload*`. Mai salvato. */
  token: string;
  itemId: string;
  value: AttachmentRef[];
  onChange?: (next: AttachmentRef[]) => void;
  /** Suggerimento del template («allegato»). */
  hint?: string | null;
  /** Voce con dati personali: caricamento solo lato server, niente copie sul dispositivo. */
  personal?: boolean;
  disabled?: boolean;
}

const STATUS: Record<AttachmentRef["status"], { tone: "verde" | "giallo" | "rosso"; label: string }> = {
  pulito: { tone: "verde", label: "Pronto" },
  in_quarantena: { tone: "giallo", label: "In controllo" },
  rifiutato: { tone: "rosso", label: "Rifiutato" },
};

interface Notice {
  tone: "ok" | "info" | "errore";
  text: string;
}

export function AttachmentField({ token, itemId, value, onChange, hint, personal = false, disabled = false }: AttachmentFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const blocked = disabled || busy !== null;

  async function onFile(file: File) {
    setNotice(null);
    setBusy(file.name);
    const r = await uploadFile({ kind: "referente", token, itemId }, file, { personal });
    setBusy(null);
    if (input.current) input.current.value = "";
    if (!r.ok) {
      setNotice({ tone: "errore", text: r.message });
      return;
    }
    const f = r.file;
    if (f.status === "rifiutato") {
      setNotice({ tone: "errore", text: f.message ?? "Il file non è stato accettato: l'abbiamo cancellato." });
      return;
    }
    const ref: AttachmentRef = { fileId: f.fileId, fileName: f.fileName, sizeBytes: f.sizeBytes, status: f.usable ? "pulito" : "in_quarantena" };
    if (!value.some((v) => v.fileId === ref.fileId)) onChange?.([...value, ref]);
    if (f.duplicate) setNotice({ tone: "info", text: "Questo file l'avevi già caricato: usiamo quello." });
    else if (f.status === "in_quarantena") setNotice({ tone: "info", text: f.message ?? "Prima di usarlo lo controlla una persona di Lateral Space." });
    else setNotice({ tone: "ok", text: "File caricato e controllato. Parte con la risposta quando premi «Invia»." });
  }

  const shown = value.filter((v) => v.status !== "rifiutato");

  return (
    <div className="min-w-0 space-y-3 rounded-lg border border-dashed border-border px-3 py-3 text-sm">
      {hint ? <p className="break-words text-muted-foreground">Cosa allegare: {hint}</p> : null}

      {shown.length > 0 ? (
        <ul className="space-y-2" aria-label="File allegati">
          {shown.map((f) => {
            const s = STATUS[f.status];
            return (
              <li key={f.fileId} className="flex min-w-0 items-start gap-2 rounded-lg bg-muted/40 px-3 py-2">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium break-all">{f.fileName}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusDot tone={s.tone} label={s.label} className="shrink-0" />
                    {formatSize(f.sizeBytes) ? <span className="text-sm text-muted-foreground">{formatSize(f.sizeBytes)}</span> : null}
                  </div>
                  {f.status === "in_quarantena" ? <p className="text-sm break-words text-muted-foreground">Lo controlla Lateral Space prima di usarlo.</p> : null}
                </div>
                {onChange ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    disabled={blocked}
                    aria-label={`Togli ${f.fileName} dalla risposta`}
                    onClick={() => onChange(value.filter((v) => v.fileId !== f.fileId))}
                  >
                    <X aria-hidden />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {disabled ? (
        shown.length === 0 ? (
          <p className="flex items-start gap-2 text-muted-foreground">
            <Paperclip className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0">Nessun file allegato.</span>
          </p>
        ) : null
      ) : (
        <>
          <input
            ref={input}
            id={`${id}-file`}
            type="file"
            accept={ACCEPTED_FILE_TYPES}
            className="sr-only"
            disabled={blocked}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Button type="button" variant="outline" className="min-h-11" disabled={blocked} onClick={() => input.current?.click()}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Paperclip aria-hidden />}
              {busy ? "Carico e controllo il file…" : "Scegli un file"}
            </Button>
          </div>
          <p className="text-sm break-words text-muted-foreground">
            {personal ? "PDF, Word, Excel, PowerPoint, CSV o testo, fino a 4 MB. Il file viene cifrato." : "PDF, Word, Excel, PowerPoint, CSV o testo, fino a 20 MB."}
          </p>
        </>
      )}

      {notice ? (
        <p
          role={notice.tone === "errore" ? "alert" : "status"}
          className={cn(
            "rounded-lg px-3 py-2 break-words",
            notice.tone === "ok" && "bg-uc-verde-bg",
            notice.tone === "info" && "bg-uc-blu-bg",
            notice.tone === "errore" && "bg-uc-rosso-bg text-uc-rosso",
          )}
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
