"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { updateCaseSettingsAction } from "@/lib/actions/uc-cases";
import { revokeAllLinksAction } from "@/lib/actions/uc-people";
import { SETTINGS_TEXT as T } from "@/lib/uc/views/case-settings";

const FIELD = "h-11 text-base sm:h-9 sm:text-sm";

/**
 * «La realizzazione» (rilascio 10, §3.5; DESIGN §3.13.3): nome, frase e perimetro, con un solo «Salva». Il codice non
 * si modifica qui: lo mostra la pagina in «Dettagli tecnici». Le leve si cambiano in Valore.
 */
export function CaseIdentityForm({
  workspaceId,
  caseId,
  title,
  oneLiner,
  perimeterLabel,
}: {
  workspaceId: string;
  caseId: string;
  title: string;
  oneLiner: string | null;
  perimeterLabel: string | null;
}) {
  const { pending, run } = useUcAction();
  const [name, setName] = useState(title);
  const [line, setLine] = useState(oneLiner ?? "");
  const [perimeter, setPerimeter] = useState(perimeterLabel ?? "");
  const dirty = name.trim() !== title || line.trim() !== (oneLiner ?? "") || perimeter.trim() !== (perimeterLabel ?? "");
  return (
    <form
      className="grid max-w-2xl gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateCaseSettingsAction(workspaceId, caseId, { title: name.trim(), oneLiner: line.trim() || null, perimeterLabel: perimeter.trim() || null }));
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="uc-settings-title">{T.name}</Label>
        <Input id="uc-settings-title" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} className={FIELD} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="uc-settings-line">{T.oneLiner}</Label>
        <Textarea id="uc-settings-line" value={line} maxLength={500} rows={2} onChange={(e) => setLine(e.target.value)} className="text-base sm:text-sm" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="uc-settings-perimeter">{T.perimeter}</Label>
        <Input id="uc-settings-perimeter" value={perimeter} maxLength={255} placeholder={T.perimeterPlaceholder} onChange={(e) => setPerimeter(e.target.value)} className={FIELD} />
      </div>
      <div>
        <Button type="submit" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending || !dirty || name.trim().length < 3}>
          {T.save}
        </Button>
      </div>
    </form>
  );
}

/**
 * «Revoca i link» (Zona pericolosa): in un colpo solo i link dei referenti, quelli di approvazione e gli accessi di
 * Claude alla realizzazione. Resta anche in pausa: serve quando un link è finito nelle mani sbagliate.
 */
export function RevokeAllLinks({ workspaceId, caseId }: { workspaceId: string; caseId: string }) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button variant="outline" className="min-h-11 text-destructive hover:text-destructive sm:min-h-8" onClick={() => setOpen(true)}>
        {T.revoke}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{T.revokeTitle}</DialogTitle>
            <DialogDescription>{T.revokeBody}</DialogDescription>
          </DialogHeader>
          <form
            id="uc-revoke-all"
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => revokeAllLinksAction(workspaceId, caseId, { reason: reason.trim() || null }), {
                onSuccess: () => {
                  setOpen(false);
                  setReason("");
                },
              });
            }}
          >
            <Label htmlFor="uc-revoke-all-reason">{T.reasonOptional}</Label>
            <Textarea id="uc-revoke-all-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={T.reasonPlaceholder} className="text-base sm:text-sm" />
          </form>
          <DialogFooter>
            <Button variant="outline" className="h-11 sm:h-8" onClick={() => setOpen(false)}>
              Annulla
            </Button>
            <Button type="submit" form="uc-revoke-all" variant="destructive" className="h-11 sm:h-8" disabled={pending}>
              {T.revokeConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
