"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { declareSubprocessorsAction } from "@/lib/actions/uc-subprocessors";

/** Testo, una casella obbligatoria e «Autorizza». I controlli veri stanno sul server. */
export function SubprocessorsForm({
  workspaceId,
  listVersion,
  statement,
  powersText,
}: {
  workspaceId: string;
  listVersion: string;
  statement: string;
  powersText: string;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
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
      <div className="flex min-h-11 items-start gap-3">
        <Checkbox
          id="subprocessors-powers"
          className="mt-0.5"
          checked={confirmed}
          onCheckedChange={(checked) => setConfirmed(checked === true)}
          disabled={pending}
        />
        <Label htmlFor="subprocessors-powers" className="block leading-snug font-normal">
          {powersText}
        </Label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="px-4" disabled={!confirmed || pending}>
        {pending ? "Salvataggio…" : "Autorizza"}
      </Button>
    </form>
  );
}
