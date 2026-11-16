"use client";

/**
 * «Mappatura board»: «Carica documenti» nel pannello dell'assistente (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.5,
 * §5.5).
 *
 * Il bottone piccolo contornato apre la scelta dei file; ognuno va a /api/documents/upload con il workspace e l'unità,
 * come prima (la rotta rifiuta un'unità di un altro workspace). Mentre carica dice «Carico…»; alla fine un toast della
 * board, e dopo un documento caricato compare subito «Proponi passi dai documenti» (prima serviva ricaricare).
 *
 * (Rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §6.3) Senza l'ok ai sub-responsabili il documento si salva ma non si legge
 * con l'AI (la rotta risponde `ai: "ok_mancante"`): il toast lo dice, con «Apri» verso Impostazioni, dove si dà l'ok.
 */
import { useRef, useState, type JSX } from "react";
import { CONTEXT_TEXT } from "../../../lib/context/text.ts";
import { subprocessorsSettingsHref } from "../../../lib/use-cases/referent/contract.ts";
import { useBoardClient } from "../store/use-board.tsx";
import { BoardButton } from "../ui/atoms.tsx";
import { COMPANION_TEXT } from "./text.ts";

/** I tipi di file che la rotta legge. */
export const DOCUMENT_ACCEPT = ".pdf,.txt,.csv,.md,.docx,.xlsx,.pptx";

/**
 * Carica i file uno alla volta; dice quanti sono andati e quanti no, e quanti si sono salvati senza la lettura con l'AI
 * perché manca l'ok ai sub-responsabili (`consentMissing`). Mai il messaggio di un errore.
 */
export async function uploadDocuments(
  files: readonly File[],
  deps: { workspaceId: string; departmentId: string; fetch: typeof fetch },
): Promise<{ uploaded: number; failed: number; consentMissing: number }> {
  let uploaded = 0;
  let failed = 0;
  let consentMissing = 0;
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    form.append("workspaceId", deps.workspaceId);
    form.append("departmentId", deps.departmentId);
    try {
      const response = await deps.fetch("/api/documents/upload", { method: "POST", body: form });
      if (response.ok) {
        uploaded += 1;
        const body: unknown = await response.json().catch(() => null);
        if (body && typeof body === "object" && (body as { ai?: unknown }).ai === "ok_mancante") consentMissing += 1;
      } else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { uploaded, failed, consentMissing };
}

/**
 * Il toast dopo un caricamento: riuscito se tutti i file sono andati; se qualcuno si è salvato senza la lettura con
 * l'AI, la riga dell'ok (rilascio 9a).
 */
export const uploadToast = (result: { uploaded: number; failed: number; consentMissing?: number }) =>
  result.failed > 0 || result.uploaded === 0 ? COMPANION_TEXT.documents.failed : (result.consentMissing ?? 0) > 0 ? CONTEXT_TEXT.documents.savedNoConsent : COMPANION_TEXT.documents.uploaded;

/** «Apri», verso la scheda dei sub-responsabili in Impostazioni: solo con la riga dell'ok. */
export const uploadToastAction = (result: { uploaded: number; failed: number; consentMissing?: number }, workspaceId: string, open: (href: string) => void) =>
  uploadToast(result) === CONTEXT_TEXT.documents.savedNoConsent ? { label: CONTEXT_TEXT.documents.openSettings, run: () => open(subprocessorsSettingsHref(workspaceId)) } : undefined;

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
    client.notify(uploadToast(result), uploadToastAction(result, p.workspaceId, (href) => window.location.assign(href)));
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
