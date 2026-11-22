"use client";

/**
 * «Intervista iniziale»: «Carica documenti» sopra la conversazione (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7), nella
 * forma dei bottoni dell'assistente della board.
 *
 * Come nella Discovery: più file insieme, gli stessi tipi, uno alla volta sulla rotta di sempre (/api/documents/upload)
 * con il solo workspace; il documento nasce «Per tutti» e la chat lo legge. Per ogni file un avviso: caricato, o il
 * motivo del rifiuto che la rotta scrive in italiano (mai un codice). Senza l'ok ai sub-responsabili il documento si salva
 * ma non si legge con l'AI: l'avviso lo dice, con «Apri» verso Impostazioni (`uploadedNotice`, lo stesso di prima).
 */
import { useRef, useState, type JSX } from "react";
import { toast } from "sonner";
import { uploadedNotice } from "../../dashboard/document-upload.tsx";
import { TOAST_MS, notifyDone } from "../../ui-10/toast.ts";
import { BoardButton } from "../ui/atoms.tsx";
import { INTERVIEW_TEXT } from "./text.ts";

/** I tipi di file della Discovery, gli stessi di prima. */
export const INTERVIEW_ACCEPT = ".pdf,.docx,.xlsx,.pptx,.csv,.tsv,.txt,.md";

type UploadedDoc = { fileName: string; ai: "ok" | "ok_mancante" | "non_serve" };
export type UploadOutcome = { fileName: string; ok: true; doc: UploadedDoc } | { fileName: string; ok: false; message: string };

/** Un file sulla rotta: l'esito, con il messaggio della rotta se c'è (mai il suo codice). */
export async function uploadInterviewDocument(file: File, deps: { workspaceId: string; fetch: typeof fetch }): Promise<UploadOutcome> {
  const failed = { fileName: file.name, ok: false as const, message: INTERVIEW_TEXT.documents.failed(file.name) };
  try {
    const form = new FormData();
    form.append("file", file);
    form.append("workspaceId", deps.workspaceId);
    const response = await deps.fetch("/api/documents/upload", { method: "POST", body: form });
    const body: unknown = await response.json().catch(() => null);
    const data = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    if (!response.ok) return typeof data.message === "string" && data.message.trim() ? { ...failed, message: data.message.trim() } : failed;
    const ai = data.ai === "ok_mancante" || data.ai === "non_serve" ? data.ai : "ok";
    return { fileName: file.name, ok: true, doc: { fileName: typeof data.fileName === "string" && data.fileName ? data.fileName : file.name, ai } };
  } catch {
    return failed;
  }
}

export function InterviewDocuments(p: { workspaceId: string }): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const T = INTERVIEW_TEXT.documents;
  const onFiles = async (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (input.current) input.current.value = "";
    if (files.length === 0) return;
    setUploading(true);
    for (const file of files) {
      const outcome = await uploadInterviewDocument(file, { workspaceId: p.workspaceId, fetch: (url, init) => fetch(url, init) });
      if (!outcome.ok) {
        toast.error(outcome.message, { duration: TOAST_MS });
        continue;
      }
      const notice = uploadedNotice(outcome.doc, p.workspaceId);
      const action = notice.action;
      if (action) toast(notice.text, { duration: TOAST_MS, action: { label: action.label, onClick: () => window.location.assign(action.href) } });
      else notifyDone(notice.text);
    }
    setUploading(false);
  };
  return (
    <>
      <input ref={input} type="file" accept={INTERVIEW_ACCEPT} multiple hidden tabIndex={-1} aria-hidden="true" onChange={(event) => void onFiles(event.currentTarget.files)} data-b="interview-files" />
      {/* Mentre carica il bottone resta raggiungibile (aria-disabled): spento, il fuoco cadrebbe sulla pagina (F1). */}
      <BoardButton
        small
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
