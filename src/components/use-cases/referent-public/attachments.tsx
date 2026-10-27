"use client";

import { useId, useRef, useState } from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckRow } from "@/components/uc/referente/inputs/fields";
import { cn } from "@/lib/utils";
import { REFERENT_LIMITS } from "@/lib/use-cases/referent/contract";
import { REFERENT_ERROR_MESSAGES, REFERENT_PUBLIC_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { uploadReferentFile } from "@/lib/use-cases/referent/upload-transport";
import { confirmFile, removeFile } from "./api";
import { attachHelp, fileFromUpload, fileRow, type FileRow, type PublicFile } from "./public-view-render";

/**
 * I file di una domanda (SPEC §4.4 punto 4): la casella obbligatoria prima di scegliere il file, «Allega
 * un file», l'elenco con lo stato di ogni file e «Togli» per quelli non ancora inviati. Un file in cui
 * troviamo nomi, email o telefoni chiede «Servono, lo lascio» prima di poter partire; un PDF con poco
 * testo lo controlla Lateral Space e si può inviare lo stesso. Un file rifiutato è già cancellato: la riga
 * resta finché il referente non la chiude.
 *
 * Stesso caricamento dei file del dossier (tipi, limiti, controlli, Blob privato), dalle API di questo
 * link. Aree di tocco di almeno 44 px, nomi lunghi che vanno a capo.
 */

const T = REFERENT_PUBLIC_TEXT;

const TONE_DOT: Record<FileRow["tone"], string> = {
  info: "bg-uc-blu",
  ok: "bg-uc-verde",
  attenzione: "bg-uc-giallo",
  errore: "bg-uc-rosso",
};

export function Attachments({
  token,
  needId,
  files,
  onFiles,
  clientMode,
  declared,
  onDeclared,
  allowUpload,
  disabled,
}: {
  token: string;
  needId: string;
  files: PublicFile[];
  onFiles: (update: (current: PublicFile[]) => PublicFile[]) => void;
  clientMode: boolean;
  /** La dichiarazione sui file vale per tutta la visita. */
  declared: boolean;
  onDeclared: (v: boolean) => void;
  /** false con «Non lo so»: si possono solo togliere i file già caricati. */
  allowUpload: boolean;
  disabled: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = files.filter((f) => f.status !== "rifiutato");
  const blocked = disabled || uploading !== null;

  async function onFile(file: File) {
    setError(null);
    if (input.current) input.current.value = "";
    if (live.length >= REFERENT_LIMITS.filesPerQuestion) {
      setError(REFERENT_ERROR_MESSAGES.troppi_file);
      return;
    }
    setUploading(file.name);
    const result = await uploadReferentFile({ kind: "referente", token, needId }, file, { declaration: declared, clientMode });
    setUploading(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const uploaded = fileFromUpload(result.file);
    onFiles((current) => [...current.filter((f) => f.id !== uploaded.id), uploaded]);
  }

  async function onRemove(row: FileRow) {
    setError(null);
    setBusyFile(row.id);
    const r = await removeFile(token, row.id);
    setBusyFile(null);
    if (r.ok || r.code === "file_non_trovato") {
      onFiles((current) => current.filter((f) => f.id !== row.id));
      return;
    }
    setError(r.message);
  }

  async function onKeep(row: FileRow) {
    setError(null);
    setBusyFile(row.id);
    const r = await confirmFile(token, row.id);
    setBusyFile(null);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onFiles((current) => current.map((f) => (f.id === row.id ? { ...f, needsConfirmation: false } : f)));
  }

  const rows = files.map(fileRow);

  return (
    <div className="min-w-0 space-y-3">
      {rows.length > 0 || uploading ? (
        <ul className="space-y-2" aria-label={T.aria.files}>
          {rows.map((row) => (
            <li key={row.id} className="min-w-0 rounded-lg bg-muted/40 px-3 py-2">
              <div className="flex min-w-0 items-start gap-2">
                <FileText className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-base font-medium break-all">{row.name}</p>
                  <p className="flex min-w-0 items-start gap-2 text-sm break-words">
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_DOT[row.tone])} aria-hidden />
                    <span className={cn("min-w-0", row.tone === "errore" && "text-uc-rosso")}>{row.state}</span>
                  </p>
                </div>
                {row.removable && !row.confirm ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11 shrink-0 px-3 text-base"
                    disabled={disabled || busyFile !== null}
                    aria-label={fillText(T.aria.removeFile, { file: row.name })}
                    onClick={() => void onRemove(row)}
                  >
                    {T.removeFile}
                  </Button>
                ) : null}
                {!row.removable && row.tone === "errore" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={fillText(T.aria.dismissRejected, { file: row.name })}
                    onClick={() => onFiles((current) => current.filter((f) => f.id !== row.id))}
                  >
                    <X aria-hidden />
                  </Button>
                ) : null}
              </div>
              {row.confirm ? (
                <div className="mt-2 space-y-2 rounded-lg bg-uc-giallo-bg px-3 py-2" role="status">
                  <p className="text-sm break-words">{row.confirm.warning}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 text-base"
                      disabled={disabled || busyFile !== null}
                      aria-label={fillText(T.aria.removeFile, { file: row.name })}
                      onClick={() => void onRemove(row)}
                    >
                      {T.removeFile}
                    </Button>
                    <Button type="button" variant="outline" className="min-h-11 text-base" disabled={disabled || busyFile !== null} onClick={() => void onKeep(row)}>
                      {row.confirm.keep}
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
          {uploading ? (
            <li className="flex min-w-0 items-start gap-2 rounded-lg bg-muted/40 px-3 py-2" role="status">
              <Loader2 className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-base font-medium break-all">{uploading}</p>
                <p className="text-sm text-muted-foreground">{T.fileStates.in_quarantena}</p>
              </div>
            </li>
          ) : null}
        </ul>
      ) : null}

      {allowUpload ? (
        <div className="min-w-0 space-y-2 rounded-lg border border-dashed border-border px-3 py-3">
          <CheckRow id={`${id}-declaration`} checked={declared} onChange={onDeclared} disabled={blocked}>
            {T.declaration}
          </CheckRow>
          <input
            ref={input}
            id={`${id}-file`}
            type="file"
            accept={REFERENT_LIMITS.accept}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            disabled={blocked || !declared}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <Button type="button" variant="outline" className="min-h-11 text-base" disabled={blocked || !declared} onClick={() => input.current?.click()}>
            {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <Paperclip aria-hidden />}
            {uploading ? T.uploading : T.attach}
          </Button>
          <p className="text-sm break-words text-muted-foreground">{attachHelp(clientMode)}</p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg bg-uc-rosso-bg px-3 py-2 text-sm break-words text-uc-rosso">
          {error}
        </p>
      ) : null}
    </div>
  );
}
