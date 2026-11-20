"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addUnitAction } from "@/lib/actions/mappatura-units";
import { UNIT_NAME_MAX, UNIT_TEXT } from "@/lib/mappatura/text";

/**
 * «Aggiungi un'unità» (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7, F-160): una finestra con il solo nome. Il pulsante
 * pieno è della finestra («Aggiungi»), come in ogni finestra. Fatto, si va alla board dell'unità nuova, dove
 * l'assistente si apre da sé; un rifiuto (nome vuoto, uguale a un'altra unità) resta nella finestra, sotto il campo.
 */
export function AddUnitDialog({ workspaceId, open, onOpenChange }: { workspaceId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = (next: boolean) => {
    if (pending) return;
    onOpenChange(next);
    if (!next) {
      setName("");
      setError(null);
    }
  };

  const submit = () => {
    if (pending) return;
    if (!name.trim()) {
      setError(UNIT_TEXT.nameMissing);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addUnitAction(workspaceId, name).catch(() => null);
      if (!result) {
        setError(UNIT_TEXT.failed);
        return;
      }
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success(UNIT_TEXT.added);
      onOpenChange(false);
      setName("");
      router.push(`/dashboard/${workspaceId}/mapping/${result.value.departmentId}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">{UNIT_TEXT.title}</DialogTitle>
            <DialogDescription className="sr-only">{UNIT_TEXT.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="unita-nome" className="text-sm font-medium">
              {UNIT_TEXT.nameLabel}
            </label>
            <Input
              id="unita-nome"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={UNIT_TEXT.namePlaceholder}
              maxLength={UNIT_NAME_MAX + 10}
              autoComplete="off"
              autoFocus
              // Mentre aggiunge il campo resta raggiungibile (il fuoco non cade sulla pagina, F1): si legge e basta.
              readOnly={pending}
              aria-disabled={pending || undefined}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "unita-nome-errore" : undefined}
              className="min-h-11 sm:min-h-8"
            />
            {error ? (
              <p id="unita-nome-errore" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" aria-disabled={pending || undefined} onClick={() => close(false)}>
              {UNIT_TEXT.cancel}
            </Button>
            <Button type="submit" className="min-h-11 sm:min-h-8" aria-disabled={pending || undefined}>
              {pending ? UNIT_TEXT.saving : UNIT_TEXT.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
