"use client";

import { useRef, useState } from "react";
import { Upload, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

interface UploadedDoc {
  id: string;
  fileName: string;
  summary: string;
  extractedText: string;
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
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? "Errore upload");
          continue;
        }

        const data = await res.json();
        setUploaded((prev) => [...prev, data.fileName]);
        toast.success(`${data.fileName} caricato e analizzato`);
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
        accept=".pdf,.txt,.csv,.md,.docx,.xlsx,.pptx"
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
