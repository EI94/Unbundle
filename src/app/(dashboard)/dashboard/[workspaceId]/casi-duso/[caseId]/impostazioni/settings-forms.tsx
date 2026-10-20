"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { LEVER_META } from "@/components/uc/common/lever-icons";
import { updateCaseSettingsAction } from "@/lib/actions/uc-cases";
import { revokeAllLinksAction } from "@/lib/actions/uc-people";
import { LEVERS, type Lever } from "@/lib/uc/vocab";

const FIELD = "h-11 text-base sm:h-9 sm:text-sm";

/**
 * «Il caso» (DESIGN §3.13.3): nome e frase della testata. Il codice non si
 * modifica qui: lo mostra la pagina, in sola lettura.
 */
export function CaseIdentityForm({ workspaceId, caseId, title, oneLiner }: { workspaceId: string; caseId: string; title: string; oneLiner: string | null }) {
  const { pending, run } = useUcAction();
  const [name, setName] = useState(title);
  const [line, setLine] = useState(oneLiner ?? "");
  const dirty = name.trim() !== title || line.trim() !== (oneLiner ?? "");
  return (
    <form
      className="grid max-w-2xl gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateCaseSettingsAction(workspaceId, caseId, { title: name.trim(), oneLiner: line.trim() || null }));
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="uc-settings-title">Nome</Label>
        <Input id="uc-settings-title" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} className={FIELD} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="uc-settings-line">In una frase</Label>
        <Textarea id="uc-settings-line" value={line} maxLength={500} rows={2} onChange={(e) => setLine(e.target.value)} className="text-base sm:text-sm" />
        <p className="text-xs text-muted-foreground">Si legge sotto il nome, in testata.</p>
      </div>
      <div>
        <Button type="submit" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending || !dirty || name.trim().length < 3}>
          Salva
        </Button>
      </div>
    </form>
  );
}

/**
 * «Perimetro e leve» (DESIGN §3.13.3, §9.1 punto 12): il testo del perimetro e
 * le 8 leve di valore come interruttori con il loro nome (mai icone sole).
 */
export function ScopeLeversForm({ workspaceId, caseId, perimeterLabel, levers }: { workspaceId: string; caseId: string; perimeterLabel: string | null; levers: readonly Lever[] }) {
  const { pending, run } = useUcAction();
  const [perimeter, setPerimeter] = useState(perimeterLabel ?? "");
  const [on, setOn] = useState<Set<Lever>>(new Set(levers));
  const dirty = perimeter.trim() !== (perimeterLabel ?? "") || LEVERS.some((l) => on.has(l) !== levers.includes(l));
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateCaseSettingsAction(workspaceId, caseId, { perimeterLabel: perimeter.trim() || null, levers: LEVERS.filter((l) => on.has(l)) }));
      }}
    >
      <div className="max-w-2xl space-y-1.5">
        <Label htmlFor="uc-settings-perimeter">Perimetro</Label>
        <Input id="uc-settings-perimeter" value={perimeter} maxLength={255} placeholder="Es. Richieste dei clienti business, da maggio" onChange={(e) => setPerimeter(e.target.value)} className={FIELD} />
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Leve di valore</legend>
        <div className="grid gap-x-6 gap-y-1 @md:grid-cols-2">
          {LEVERS.map((lever) => {
            const { label, icon: Icon } = LEVER_META[lever];
            const id = `uc-lever-${lever}`;
            return (
              <label key={lever} htmlFor={id} className="flex min-h-11 items-center justify-between gap-3 text-sm sm:min-h-9">
                <span className="inline-flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {label}
                </span>
                <Switch
                  id={id}
                  checked={on.has(lever)}
                  onCheckedChange={(checked) => {
                    const next = new Set(on);
                    if (checked) next.add(lever);
                    else next.delete(lever);
                    setOn(next);
                  }}
                />
              </label>
            );
          })}
        </div>
      </fieldset>
      <div>
        <Button type="submit" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending || !dirty}>
          Salva
        </Button>
      </div>
    </form>
  );
}

/**
 * «Revoca tutti i link dei referenti» (Zona pericolosa): in un colpo solo i
 * link dei referenti, quelli di approvazione e gli accessi di Claude al dossier.
 * Resta anche con il dossier in pausa: serve quando un link è finito nelle
 * mani sbagliate.
 */
export function RevokeAllLinks({ workspaceId, caseId }: { workspaceId: string; caseId: string }) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button variant="outline" className="min-h-11 text-destructive hover:text-destructive sm:min-h-8" onClick={() => setOpen(true)}>
        Revoca tutti i link dei referenti…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revocare tutti i link?</DialogTitle>
            <DialogDescription>Smettono di funzionare subito i link dei referenti, quelli per firmare e gli accessi di Claude al dossier. Le risposte arrivate restano.</DialogDescription>
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
            <Label htmlFor="uc-revoke-all-reason">Motivo (facoltativo)</Label>
            <Textarea id="uc-revoke-all-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Scrivilo in poche parole, senza nomi di persone." className="text-base sm:text-sm" />
          </form>
          <DialogFooter>
            <Button variant="outline" className="h-11 sm:h-8" onClick={() => setOpen(false)}>
              Annulla
            </Button>
            <Button type="submit" form="uc-revoke-all" variant="destructive" className="h-11 sm:h-8" disabled={pending}>
              Revoca tutti i link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
