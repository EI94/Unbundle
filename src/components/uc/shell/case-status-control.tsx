"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { transitionCaseAction } from "@/lib/actions/uc-cases";
import { SETTINGS_TEXT, statusActionLabel, statusConfirmLabel, statusDialogTitle, statusDoneText } from "@/lib/uc/views/case-settings";
import type { CaseStatus } from "@/lib/uc/vocab";
import { cn } from "@/lib/utils";

export interface StatusOption {
  to: CaseStatus;
  /** Etichetta dello stato di arrivo («In pausa»). */
  label: string;
  /** Cosa succede, in una frase (`transitionHint`). */
  hint: string;
  needsReason: boolean;
}

/**
 * I cambi di stato delle Impostazioni della realizzazione (rilascio 10, §3.5): in «Pausa» (`#pausa`, anche dalla
 * vecchia ancora `#stato`) «Metti in pausa…», «Riprendi» e «Torna allo sviluppo…»; in «Zona pericolosa» «Chiudi la
 * realizzazione…». Un pulsante per ogni cambio ammesso adesso (calcolati sul server con le stesse regole del comando,
 * che li ricontrolla) e un dialogo con il motivo e la frase di `statusHint`. Pausa e chiusura chiedono il motivo. Il
 * passo avanti non sta qui: è il primario della testata. «Riprendi» è pieno: in pausa è l'unica azione della pagina.
 */
export function CaseStatusControl({
  workspaceId,
  caseId,
  current,
  transitions,
}: {
  workspaceId: string;
  caseId: string;
  current: CaseStatus;
  transitions: readonly StatusOption[];
}) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState<StatusOption | null>(null);
  const [reason, setReason] = useState("");
  const ready = open !== null && (!open.needsReason || reason.trim().length >= 3);

  function start(t: StatusOption) {
    setReason("");
    setOpen(t);
  }

  function submit() {
    if (!open) return;
    const chosen = open;
    run(() => transitionCaseAction(workspaceId, caseId, { to: chosen.to, reason: reason.trim() || null }), {
      success: statusDoneText(chosen.label),
      onSuccess: () => setOpen(null),
    });
  }

  if (transitions.length === 0) return null;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {transitions.map((t) => {
          const resume = current === "sospeso" && t.to !== "chiuso";
          return (
            <Button
              key={t.to}
              variant={resume ? "default" : "outline"}
              className={cn("min-h-11 sm:min-h-8", t.to === "chiuso" && "text-destructive hover:text-destructive")}
              onClick={() => start(t)}
            >
              {statusActionLabel(current, t.to)}
            </Button>
          );
        })}
      </div>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        {open && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{statusDialogTitle(current, open.to)}</DialogTitle>
              {open.hint && <DialogDescription>{open.hint}</DialogDescription>}
            </DialogHeader>
            <form
              id="uc-status-form"
              className="space-y-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (ready) submit();
              }}
            >
              <Label htmlFor="uc-status-reason">{open.needsReason ? SETTINGS_TEXT.reason : SETTINGS_TEXT.reasonOptional}</Label>
              <Textarea
                id="uc-status-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder={SETTINGS_TEXT.reasonPlaceholder}
                className="text-base sm:text-sm"
              />
            </form>
            <DialogFooter>
              <Button variant="outline" className="h-11 sm:h-8" onClick={() => setOpen(null)}>
                Annulla
              </Button>
              <Button type="submit" form="uc-status-form" variant={open.to === "chiuso" ? "destructive" : "default"} className="h-11 sm:h-8" disabled={!ready || pending}>
                {pending ? "Un momento…" : statusConfirmLabel(current, open.to)}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
