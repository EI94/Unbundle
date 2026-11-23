"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
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
 * chiaro non si salva mai: «Crea» emette il link (con le domande scelte, o tutte), «Copia» un token in più per lo stesso
 * link (`copyAiReadinessOpenLinkAction`). Nella stessa pagina la copia successiva riusa l'ultimo link emesso. Il link si
 * vede in una finestra con «Copia il link»: lo si copia anche da sé, quando il browser lo permette subito.
 */
export function useOpenLink({ workspaceId, assessmentId }: { workspaceId: string; assessmentId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const issued = useRef<string | null>(null);

  function show(next: string) {
    issued.current = next;
    setUrl(next);
    setError(null);
    setOpen(true);
  }

  function create(formData?: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await generateAiReadinessOpenLinkAction(workspaceId, assessmentId, { ok: true }, formData ?? new FormData());
      if (result.ok && result.data?.openUrl) show(result.data.openUrl);
      else setError(result.message ?? T.step.failed);
    });
  }

  function copy() {
    if (issued.current) {
      show(issued.current);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await copyAiReadinessOpenLinkAction(workspaceId, assessmentId);
      if (result.ok && result.data?.openUrl) show(result.data.openUrl);
      else setError(result.message ?? T.step.failed);
    });
  }

  const dialog = <OpenLinkDialog open={open} url={url} onOpenChange={setOpen} />;
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
