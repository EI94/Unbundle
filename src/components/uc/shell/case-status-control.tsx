"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { transitionCaseAction } from "@/lib/actions/uc-cases";
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

/** Il pulsante di ogni cambio (DESIGN §3.13.3): «Metti in pausa…», «Riprendi», «Chiudi il caso…». */
export function statusActionLabel(from: CaseStatus, to: CaseStatus): string {
  if (to === "sospeso") return "Metti in pausa…";
  if (to === "chiuso") return "Chiudi il caso…";
  if (from === "sospeso") return "Riprendi";
  if (to === "in_sviluppo") return "Torna allo sviluppo…";
  return "Cambia stato…";
}

function dialogTitle(from: CaseStatus, to: CaseStatus): string {
  if (to === "sospeso") return "Mettere in pausa il caso?";
  if (to === "chiuso") return "Chiudere il caso?";
  if (from === "sospeso") return "Riprendere il caso?";
  if (to === "in_sviluppo") return "Tornare allo sviluppo?";
  return "Cambiare lo stato del caso?";
}

function confirmLabel(from: CaseStatus, to: CaseStatus): string {
  if (to === "sospeso") return "Metti in pausa";
  if (to === "chiuso") return "Chiudi il caso";
  if (from === "sospeso") return "Riprendi";
  if (to === "in_sviluppo") return "Torna allo sviluppo";
  return "Conferma";
}

/**
 * «Stato del caso» delle Impostazioni (DESIGN §3.13.3, ancora `#stato`): un
 * pulsante per ogni cambio ammesso adesso (calcolati sul server con le stesse
 * regole del comando, che li ricontrolla) e un dialogo con il motivo e il testo
 * di `transitionHint`. Pausa e chiusura chiedono il motivo. Il passo avanti non
 * sta qui: è il primario della testata. «Riprendi» è pieno: in pausa è
 * l'unica azione della pagina.
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
      success: `Il caso ora è «${chosen.label}».`,
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
              <DialogTitle>{dialogTitle(current, open.to)}</DialogTitle>
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
              <Label htmlFor="uc-status-reason">Motivo{open.needsReason ? "" : " (facoltativo)"}</Label>
              <Textarea
                id="uc-status-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Scrivilo in poche parole, senza nomi di persone."
                className="text-base sm:text-sm"
              />
            </form>
            <DialogFooter>
              <Button variant="outline" className="h-11 sm:h-8" onClick={() => setOpen(null)}>
                Annulla
              </Button>
              <Button type="submit" form="uc-status-form" variant={open.to === "chiuso" ? "destructive" : "default"} className="h-11 sm:h-8" disabled={!ready || pending}>
                {pending ? "Un momento…" : confirmLabel(current, open.to)}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
