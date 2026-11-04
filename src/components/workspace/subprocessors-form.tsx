"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { declareSubprocessorsAction } from "@/lib/actions/uc-subprocessors";

/**
 * Testo, una casella obbligatoria e «Autorizza» (il cliente). (Rilascio 5.1) Con `oneClickLabel`
 * (Lateral Space per conto del cliente): il testo e un solo pulsante, non pieno, senza casella. I
 * controlli veri stanno sul server.
 */
export function SubprocessorsForm({
  workspaceId,
  listVersion,
  statement,
  powersText,
  oneClickLabel,
}: {
  workspaceId: string;
  listVersion: string;
  statement: string;
  powersText?: string;
  oneClickLabel?: string;
}) {
  const router = useRouter();
  const oneClick = Boolean(oneClickLabel);
  const [ticked, setConfirmed] = useState(false);
  const confirmed = oneClick || ticked;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!confirmed) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await declareSubprocessorsAction(workspaceId, listVersion, confirmed);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        toast.success(result.message ?? "Autorizzazione registrata.");
        router.refresh();
      } catch {
        setError("Autorizzazione non registrata. Riprova tra poco.");
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="max-w-3xl text-sm leading-relaxed">{statement}</p>
      {oneClick ? null : (
        <div className="flex min-h-11 items-start gap-3">
          <Checkbox
            id="subprocessors-powers"
            className="mt-0.5"
            checked={ticked}
            onCheckedChange={(checked) => setConfirmed(checked === true)}
            disabled={pending}
          />
          <Label htmlFor="subprocessors-powers" className="block leading-snug font-normal">
            {powersText}
          </Label>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" variant={oneClick ? "outline" : "default"} className="px-4" disabled={!confirmed || pending}>
        {pending ? "Salvataggio…" : (oneClickLabel ?? "Autorizza")}
      </Button>
    </form>
  );
}
