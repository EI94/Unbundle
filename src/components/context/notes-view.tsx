"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removeSourceAction } from "@/lib/actions/context";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { SourceListItem } from "@/lib/db/queries/context-sources";
import { PeopleSearch } from "./people-search";
import { SourceSheet } from "./source-sheet";
import { UploadDocumentButton } from "./upload-document";
import { sourceMeta } from "./view-model";

const T = CONTEXT_TEXT;

/**
 * La vista «Appunti» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.5), per il cliente «Documenti».
 *
 * - Lateral Space: in alto Granola (lo stato, «Aggiorna da Granola», «Da smistare»); poi l'elenco dal più recente:
 *   titolo, data, da dove viene, a che punto è la lettura e, per un documento, chi lo vede. Un tocco apre il pannello.
 *   (9b) In fondo il link «Cerca una persona» (RILASCIO-9b-COSTRUZIONE.md §2.13): un documento trovato apre qui il suo
 *   pannello, dove c'è «Togli».
 * - Il cliente: i documenti «Per tutti» (nome, data, dimensione), «Togli» a chi può, e «Carica documento».
 */
export function NotesView({
  workspaceId,
  today,
  lateralSpace,
  sources,
  granola,
  initialSourceId,
}: {
  workspaceId: string;
  today: string;
  lateralSpace: boolean;
  sources: readonly SourceListItem[];
  /** `<GranolaInbox />` intero, già reso sul server (solo Lateral Space). */
  granola?: ReactNode;
  /** `?fonte=<id>`: il pannello di quella fonte, aperto. */
  initialSourceId: string | null;
}) {
  const router = useRouter();
  const [openSource, setOpenSource] = useState<string | null>(lateralSpace ? initialSourceId : null);
  const closeSource = () => {
    setOpenSource(null);
    // Aperto da un link (`?fonte=`): chiuso, l'indirizzo torna quello della vista.
    if (initialSourceId) router.replace(`/dashboard/${workspaceId}/contesto?vista=appunti`, { scroll: false });
  };

  if (!lateralSpace) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <UploadDocumentButton workspaceId={workspaceId} className="min-h-11 w-full px-4 sm:w-auto" />
        </div>
        {sources.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{T.documents.empty}</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {sources.map((source) => (
              <ClientDocumentRow key={source.id} workspaceId={workspaceId} today={today} source={source} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {granola ?? null}
      {sources.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{T.notes.empty}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {sources.map((source) => (
            <li key={source.id}>
              <button
                type="button"
                onClick={() => setOpenSource(source.id)}
                className="flex min-h-11 w-full items-start gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {source.kind === "documento" ? <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : null}
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-sm break-words">{source.title}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {sourceMeta(source, today, true).map((part, index) => (
                      <span key={`${part}-${index}`}>{part}</span>
                    ))}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <PeopleSearch workspaceId={workspaceId} today={today} onOpenSource={setOpenSource} />
      </div>
      <SourceSheet workspaceId={workspaceId} sourceId={openSource} today={today} onClose={closeSource} />
    </div>
  );
}

/** Un documento nell'elenco del cliente: nome, data, dimensione; «Togli» a chi può, con la conferma. */
function ClientDocumentRow({ workspaceId, today, source }: { workspaceId: string; today: string; source: SourceListItem }) {
  const [asking, setAsking] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [pending, startTransition] = useTransition();
  const remove = () =>
    startTransition(async () => {
      const result = await removeSourceAction(workspaceId, source.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setRemoved(true);
      toast.success(T.documents.removed);
    });
  if (removed) return null;
  return (
    <li className="space-y-2 px-3 py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm break-words">{source.document?.fileName || source.title}</p>
            <p className="text-xs text-muted-foreground">{sourceMeta(source, today, false).join(" · ")}</p>
          </div>
        </div>
        {source.canRemove && !asking ? (
          <Button type="button" variant="outline" className="min-h-11 shrink-0 sm:min-h-8" disabled={pending} onClick={() => setAsking(true)}>
            {T.documents.remove}
          </Button>
        ) : null}
      </div>
      {asking ? (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <p className="text-sm">{T.documents.removeConfirm}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => setAsking(false)}>
              {T.notes.cancel}
            </Button>
            <Button type="button" variant="destructive" className="min-h-11 sm:min-h-8" disabled={pending} onClick={remove}>
              {T.documents.remove}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
