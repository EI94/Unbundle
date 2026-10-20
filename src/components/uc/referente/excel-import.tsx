"use client";

import { useId, useRef, useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SERVER_MAX_BYTES } from "@/components/uc/documents/upload-transport";
import type { ReferentItemView } from "@/lib/uc/public-view";
import { gridFromRows, type TableGrid } from "@/lib/uc/views/referente-form";
import { postTableFile } from "./api";
import { FileDeclarationRow, useFileDeclaration, type AttachmentRef } from "./attachment-field";
import { Notice } from "./screen";

/**
 * «Carica un Excel» (DESIGN §4.3 R2c) su una domanda tabella: il referente
 * sceglie un Excel o un CSV, il file si carica e si controlla come ogni
 * allegato e resta con la risposta; le sue righe riempiono la tabella, che il
 * referente controlla nell'editor prima di andare avanti. La dichiarazione sui
 * file è quella della visita.
 */
export interface ExcelImportResult {
  grid: TableGrid;
  fileName: string;
  /** Avviso della lettura (righe saltate, file tagliato), oppure null. */
  note: string | null;
}

const ACCEPT = ".xlsx,.csv,.tsv";
const TOO_BIG = "Il file supera i 4 MB: salvalo come CSV o dividilo, oppure compila qui, riga per riga.";
const EMPTY = "Il file non contiene righe di dati.";

export function ExcelImport({
  token,
  item,
  attachments,
  disabled,
  onAttachments,
  onImported,
}: {
  token: string;
  item: ReferentItemView;
  attachments: AttachmentRef[];
  disabled: boolean;
  onAttachments: (next: AttachmentRef[]) => void;
  onImported: (result: ExcelImportResult) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const declaration = useFileDeclaration();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "errore"; text: string } | null>(null);
  const blocked = disabled || busy;

  async function onFile(file: File) {
    setNotice(null);
    if (file.size > SERVER_MAX_BYTES) {
      setNotice({ tone: "errore", text: TOO_BIG });
      return;
    }
    setBusy(true);
    const r = await postTableFile(token, item.id, file, declaration.declared);
    setBusy(false);
    if (input.current) input.current.value = "";
    if (!r.ok) {
      setNotice({ tone: "errore", text: r.message });
      return;
    }
    const f = r.data.file;
    if (f.status === "rifiutato") {
      setNotice({ tone: "errore", text: f.message ?? "Il file non è stato accettato: l'abbiamo cancellato." });
      return;
    }
    const ref: AttachmentRef = { fileId: f.fileId, fileName: f.fileName, sizeBytes: f.sizeBytes, status: f.usable ? "pulito" : "in_quarantena" };
    if (!attachments.some((a) => a.fileId === ref.fileId)) onAttachments([...attachments, ref]);
    if (!f.usable) {
      setNotice({ tone: "info", text: `${f.message ?? "Prima di usarlo lo controlla una persona di Lateral Space."} Intanto puoi compilare qui, riga per riga.` });
      return;
    }
    if (!r.data.rows) {
      setNotice({ tone: "errore", text: r.data.rowsMessage ?? EMPTY });
      return;
    }
    const read = gridFromRows(r.data.rows, item.config);
    if (!read.grid) {
      const first = read.errors[0];
      setNotice({ tone: "errore", text: first?.code === "tabella_vuota" ? EMPTY : `${first?.message ?? EMPTY} Correggi il file e caricalo di nuovo, oppure compila qui, riga per riga.` });
      return;
    }
    onImported({ grid: read.grid, fileName: f.fileName, note: r.data.rowsMessage ?? read.warnings[0]?.message ?? null });
  }

  return (
    <div className="min-w-0 space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-base break-words text-muted-foreground">Usa il modello o un file con le stesse colonne: riempiamo noi la tabella, poi la controlli.</p>
      <div className="text-base">
        <FileDeclarationRow id={`${id}-declaration`} declaration={declaration} disabled={blocked} />
      </div>
      <input
        ref={input}
        id={`${id}-file`}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        disabled={blocked || !declaration.declared}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) void onFile(file);
        }}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="min-h-11 text-base" disabled={blocked || !declaration.declared} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <FileSpreadsheet aria-hidden />}
          {busy ? "Carico e leggo il file…" : "Scegli il file Excel"}
        </Button>
        {!declaration.declared ? <span className="text-sm text-muted-foreground">Prima spunta la casella qui sopra.</span> : null}
      </div>
      <p className="text-sm break-words text-muted-foreground">Excel (.xlsx) o CSV, fino a 4 MB. Il file resta allegato alla risposta.</p>
      {notice ? (
        <Notice tone={notice.tone} className="mt-0">
          {notice.text}
        </Notice>
      ) : null}
    </div>
  );
}
