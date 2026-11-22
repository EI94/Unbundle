"use client";

import { useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { uploadDocument } from "./read-client";
import { ACCEPTED_DOCUMENTS, afterUpload, uploadableDocument } from "./view-model";

const T = CONTEXT_TEXT;

/**
 * Il caricamento di un documento del cliente (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.5, §10.2): PDF,
 * Word, Excel, PowerPoint, CSV o testo, fino a 4 MB, sulla rotta di caricamento con `origine=chat`. Il documento nasce
 * «Per tutti». Senza l'ok ai fornitori si salva lo stesso, e il messaggio porta a Impostazioni.
 *
 * (Rilascio 10, §3.7) Lo usa «Aggiungi» della testata comune di «Contesto»: per chi aggiunge solo file, «Aggiungi un
 * file» apre subito la scelta del file. `input` è il campo nascosto da mettere nella pagina; `pick()` lo apre, dentro il
 * tocco della persona (Safari apre la scelta dei file solo così).
 */
export function useDocumentUpload(workspaceId: string): { input: ReactElement; pick: () => void; pending: boolean } {
  const router = useRouter();
  const field = useRef<HTMLInputElement | null>(null);
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

  const input = (
    <input
      ref={field}
      type="file"
      accept={ACCEPTED_DOCUMENTS}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      data-slot="upload-document"
      onChange={(event) => {
        void upload(event.target.files?.[0]);
        event.target.value = "";
      }}
    />
  );
  return { input, pick: () => field.current?.click(), pending };
}
