"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { CONTEXT_TEXT } from "@/lib/context/text";

/** La risposta di `POST /api/documents/upload` (rilascio 9a): il testo estratto non torna più al browser. */
interface UploadedDoc {
  id: string;
  sourceId: string;
  fileName: string;
  summary: string;
  textRead: boolean;
  ai: "ok" | "ok_mancante" | "non_serve";
}

/**
 * Che cosa dice il caricamento riuscito (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §6.3): senza l'ok ai sub-responsabili
 * il documento è salvato ma non letto con l'AI, e «Apri» porta a Impostazioni, dove si dà l'ok.
 */
export function uploadedNotice(doc: Pick<UploadedDoc, "fileName" | "ai">, workspaceId: string): { text: string; action: { label: string; href: string } | null } {
  if (doc.ai === "ok_mancante") {
    return {
      text: CONTEXT_TEXT.documents.savedNoConsent,
      action: { label: CONTEXT_TEXT.documents.openSettings, href: `/dashboard/${encodeURIComponent(workspaceId)}/settings#sub-responsabili` },
    };
  }
  return { text: `${doc.fileName} caricato e analizzato`, action: null };
}

interface DocumentUploadProps {
  workspaceId: string;
  departmentId?: string;
  onUploaded?: (doc: UploadedDoc) => void;
}

export function DocumentUpload({
  workspaceId,
  departmentId,
  onUploaded,
}: DocumentUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<string[]>([]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);

    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("workspaceId", workspaceId);
        if (departmentId) {
          formData.append("departmentId", departmentId);
        }

        const res = await fetch("/api/documents/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
          toast.error(data.message ?? data.error ?? "Errore upload");
          continue;
        }

        const data = (await res.json()) as UploadedDoc;
        setUploaded((prev) => [...prev, data.fileName]);
        const notice = uploadedNotice(data, workspaceId);
        const action = notice.action;
        if (action) toast(notice.text, { action: { label: action.label, onClick: () => router.push(action.href) } });
        else toast.success(notice.text);
        onUploaded?.(data);
      } catch {
        toast.error(`Errore durante l'upload di ${file.name}`);
      }
    }

    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.xlsx,.pptx,.csv,.tsv,.txt,.md"
        multiple
        onChange={handleUpload}
        className="hidden"
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors disabled:opacity-50"
      >
        {uploading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : uploaded.length > 0 ? (
          <Check className="h-3 w-3" />
        ) : (
          <Upload className="h-3 w-3" />
        )}
        {uploading
          ? "Analisi..."
          : uploaded.length > 0
            ? `${uploaded.length} doc`
            : "Carica documenti"}
      </button>
    </>
  );
}
