"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { uploadDocument } from "./read-client";
import { ACCEPTED_DOCUMENTS, afterUpload, uploadableDocument } from "./view-model";

const T = CONTEXT_TEXT;

/**
 * «Carica documento» nella vista «Documenti» del cliente (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.5,
 * §10.2): PDF, Word, Excel, PowerPoint, CSV o testo, fino a 4 MB, sulla rotta di caricamento con `origine=chat`. Il
 * documento nasce «Per tutti». Senza l'ok ai fornitori si salva lo stesso, e il messaggio porta a Impostazioni.
 */
export function UploadDocumentButton({ workspaceId, className }: { workspaceId: string; className?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const check = uploadableDocument(file);
    if (!check.ok) {
      toast.error(check.message);
      return;
    }
    setPending(true);
    const result = await uploadDocument(fetch, { workspaceId, file, origine: "chat" }).catch(() => null);
    setPending(false);
    if (!result || !result.ok) {
      toast.error(result ? result.message : T.errors.retry);
      return;
    }
    const then = afterUpload(result.value);
    const settings = { label: T.documents.openSettings, onClick: () => router.push(`/dashboard/${workspaceId}/settings#sub-responsabili`) };
    if (then.text) toast(then.text, then.consent ? { action: settings } : undefined);
    else if (then.consent) toast(T.documents.savedNoConsent, { action: settings });
    else toast.success(T.documents.uploaded);
    router.refresh();
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_DOCUMENTS}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          void upload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <Button type="button" size="lg" className={className ?? "min-h-11 px-4"} disabled={pending} onClick={() => input.current?.click()}>
        {pending ? T.documents.uploading : T.documents.upload}
      </Button>
    </>
  );
}
