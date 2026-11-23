"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { copyAiReadinessOpenLinkAction, generateAiReadinessOpenLinkAction } from "@/lib/actions/ai-readiness";
import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notifyDone } from "@/components/ui-10/toast";

const T = READINESS_TEXT;

/**
 * Il link per tutti (rilascio 10, ondata 7b, §3.9): «Crea il link per tutti» e «Copia il link per tutti». Il token in
 * chiaro non si salva mai: «Crea» emette il link (con le domande scelte, o tutte), «Copia» chiede ogni volta al server
 * un token in più per il link di adesso (`copyAiReadinessOpenLinkAction`, che ne salva solo l'hash). (Revisione 7b) Nel
 * browser il link sta solo nella finestra e negli appunti: nessuna memoria del browser, niente che resti dopo «Esci» su
 * un computer condiviso, e mai un link ritirato o di un altro manager. Chiudendo la finestra il link si dimentica. Lo
 * si copia anche da sé, quando il browser lo permette subito.
 */
export function useOpenLink({ workspaceId, assessmentId }: { workspaceId: string; assessmentId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create(formData?: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await generateAiReadinessOpenLinkAction(workspaceId, assessmentId, { ok: true }, formData ?? new FormData());
      if (result.ok && result.data?.openUrl) setUrl(result.data.openUrl);
      else setError(result.message ?? T.step.failed);
    });
  }

  function copy() {
    setError(null);
    startTransition(async () => {
      const result = await copyAiReadinessOpenLinkAction(workspaceId, assessmentId);
      if (result.ok && result.data?.openUrl) setUrl(result.data.openUrl);
      else setError(result.message ?? T.step.failed);
    });
  }

  // La finestra è aperta finché c'è un link da mostrare; chiuderla lo dimentica.
  const dialog = (
    <OpenLinkDialog
      open={url !== null}
      url={url}
      onOpenChange={(open) => {
        if (!open) setUrl(null);
      }}
    />
  );
  return { create, copy, pending, error, dialog };
}

/** La finestra del link per tutti: il link, «Copia il link» (il pulsante pieno della finestra) e «Chiudi». */
export function OpenLinkDialog({ open, url, onOpenChange }: { open: boolean; url: string | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && url ? (
        <DialogContent showCloseButton={false} data-slot="open-link-dialog" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          {/* Un link nuovo è una finestra nuova: «Copiato» riparte da capo. */}
          <OpenLinkBody key={url} url={url} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function OpenLinkBody({ url }: { url: string }) {
  const D = T.linkDialog;
  const fieldId = useId();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Dove il browser lo permette, il link è già copiato quando la finestra si apre.
    let alive = true;
    void navigator.clipboard?.writeText(url).then(
      () => alive && setCopied(true),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [url]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{D.title}</DialogTitle>
        <DialogDescription>{D.body}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor={fieldId}>{D.field}</Label>
        <Input id={fieldId} readOnly value={url} onFocus={(event) => event.currentTarget.select()} className="h-11 font-mono text-base sm:h-9 sm:text-xs" />
      </div>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" className="h-11 sm:h-8" />}>{D.close}</DialogClose>
        <Button
          type="button"
          className="h-11 sm:h-8"
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(
              () => {
                setCopied(true);
                notifyDone(T.done.copied);
              },
              () => setCopied(false),
            );
          }}
        >
          {copied ? <Check aria-hidden data-icon="inline-start" /> : <Copy aria-hidden data-icon="inline-start" />}
          <span aria-live="polite">{copied ? D.copied : D.copy}</span>
        </Button>
      </DialogFooter>
    </>
  );
}
