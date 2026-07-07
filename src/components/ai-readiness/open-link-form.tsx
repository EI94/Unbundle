"use client";

import { useActionState, useState } from "react";
import {
  generateAiReadinessOpenLinkAction,
  type AiReadinessActionState,
} from "@/lib/actions/ai-readiness";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Link2 } from "lucide-react";

const INITIAL: AiReadinessActionState<{ openUrl: string }> = { ok: true };

export function OpenLinkForm({
  workspaceId,
  assessmentId,
  hasExisting,
}: {
  workspaceId: string;
  assessmentId: string;
  hasExisting: boolean;
}) {
  const action = generateAiReadinessOpenLinkAction.bind(null, workspaceId, assessmentId);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const [copied, setCopied] = useState(false);
  const url = state.ok ? state.data?.openUrl : undefined;

  return (
    <div className="rounded-2xl border bg-muted/20 p-4" data-testid="open-link-form">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Link2 className="size-4" /> Link condivisibile con tutti
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Un unico link da girare in chat, email o intranet: chi lo apre inserisce
        la propria area e riceve la sua survey personale con salvataggio automatico.
      </p>
      <form
        action={formAction}
        className="mt-3"
        onSubmit={(event) => {
          if (
            hasExisting &&
            !window.confirm(
              "Generare un nuovo link condivisibile? Quello precedente smetterà di funzionare per chi non ha ancora iniziato."
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Genero..." : hasExisting || url ? "Rigenera link" : "Genera link"}
        </Button>
      </form>
      {url && (
        <div className="mt-3 flex gap-2">
          <Input readOnly value={url} className="text-xs" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            }}
          >
            <Copy className="mr-1 size-3.5" /> {copied ? "Copiato" : "Copia"}
          </Button>
        </div>
      )}
      {state.message && (
        <p className={`mt-2 text-xs ${state.ok ? "text-emerald-600" : "text-destructive"}`} role="status">
          {state.message}
        </p>
      )}
      {hasExisting && !url && (
        <p className="mt-2 text-xs text-muted-foreground">
          Un link è già attivo: per motivi di sicurezza è visibile solo appena generato.
        </p>
      )}
    </div>
  );
}
