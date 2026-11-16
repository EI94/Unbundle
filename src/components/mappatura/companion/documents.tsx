"use client";

/**
 * «Mappatura board»: «Carica documenti» nel pannello dell'assistente (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.5,
 * §5.5).
 *
 * Il bottone piccolo contornato apre la scelta dei file; ognuno va a /api/documents/upload con il workspace e l'unità,
 * come prima (la rotta rifiuta un'unità di un altro workspace). Mentre carica dice «Carico…»; alla fine un toast della
 * board, e dopo un documento caricato compare subito «Proponi passi dai documenti» (prima serviva ricaricare).
 */
import { useRef, useState, type JSX } from "react";
import { useBoardClient } from "../store/use-board.tsx";
import { BoardButton } from "../ui/atoms.tsx";
import { COMPANION_TEXT } from "./text.ts";

/** I tipi di file che la rotta legge. */
export const DOCUMENT_ACCEPT = ".pdf,.txt,.csv,.md,.docx,.xlsx,.pptx";

/** Carica i file uno alla volta; dice quanti sono andati e quanti no. Mai il messaggio di un errore. */
export async function uploadDocuments(
  files: readonly File[],
  deps: { workspaceId: string; departmentId: string; fetch: typeof fetch },
): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    form.append("workspaceId", deps.workspaceId);
    form.append("departmentId", deps.departmentId);
    try {
      const response = await deps.fetch("/api/documents/upload", { method: "POST", body: form });
      if (response.ok) uploaded += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { uploaded, failed };
}

/** Il toast dopo un caricamento: riuscito se tutti i file sono andati. */
export const uploadToast = (result: { uploaded: number; failed: number }) => (result.failed > 0 || result.uploaded === 0 ? COMPANION_TEXT.documents.failed : COMPANION_TEXT.documents.uploaded);

export function Documents(p: { workspaceId: string; departmentId: string; disabled?: boolean; onUploaded(): void }): JSX.Element {
  const client = useBoardClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const T = COMPANION_TEXT.documents;
  const onFiles = async (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (input.current) input.current.value = "";
    if (files.length === 0) return;
    setUploading(true);
    const result = await uploadDocuments(files, { workspaceId: p.workspaceId, departmentId: p.departmentId, fetch: (url, init) => fetch(url, init) });
    setUploading(false);
    if (result.uploaded > 0) p.onUploaded();
    client.notify(uploadToast(result));
  };
  return (
    <>
      <input ref={input} type="file" accept={DOCUMENT_ACCEPT} multiple hidden tabIndex={-1} aria-hidden="true" onChange={(event) => void onFiles(event.currentTarget.files)} data-b="companion-files" />
      {/* Mentre carica il bottone resta raggiungibile (aria-disabled): spento, il fuoco cadrebbe sulla pagina (F1). */}
      <BoardButton
        small
        disabled={p.disabled}
        aria-disabled={uploading || undefined}
        aria-busy={uploading || undefined}
        onClick={() => {
          if (!uploading) input.current?.click();
        }}
        data-action="upload"
      >
        {uploading ? T.uploading : T.upload}
      </BoardButton>
    </>
  );
}
