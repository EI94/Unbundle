"use client";

import { useState, useTransition, type ReactNode } from "react";
import { FileText, Globe, MessageSquareReply, NotebookPen, Sparkles, SquareTerminal, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui-10/empty-state";
import { useSheetParam } from "@/components/ui-10/side-sheet";
import { Button } from "@/components/ui/button";
import { removeSourceAction } from "@/lib/actions/context";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { SourceOrigin } from "@/lib/context/vocab";
import type { SourceListItem } from "@/lib/db/queries/context-sources";
import { LsLock } from "./fact-row";
import { PeopleSearch } from "./people-search";
import { SourceSheet } from "./source-sheet";
import { sheetIdParam, sourceMeta, sourceOriginLabel, sourceRowMeta } from "./view-model";

const T = CONTEXT_TEXT;

/** Il pannello di una fonte, nell'indirizzo come oggi: `?fonte=<id>` (i link della CLI). Una funzione del modulo. */
const acceptSource = (raw: string | null) => sheetIdParam(raw);

/** L'icona dell'origine di una fonte (rilascio 10, §3.7): un documento è sempre un foglio. */
const ORIGIN_ICON: Readonly<Record<SourceOrigin, LucideIcon>> = { granola: NotebookPen, web: Globe, claude: Sparkles, cli: SquareTerminal, rispondi: MessageSquareReply };
const originIcon = (item: Pick<SourceListItem, "kind" | "origin">): LucideIcon => (item.kind === "documento" ? FileText : (ORIGIN_ICON[item.origin] ?? NotebookPen));

/**
 * La vista «Fonti» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.5; rilascio 10, §3.7: «Appunti» per Lateral
 * Space e «Documenti» per il cliente diventano «Fonti» per tutti).
 *
 * - Lateral Space: in alto Granola (lo stato, «Aggiorna da Granola», «Da smistare» e, chiuse, le regole delle call di
 *   questo cliente); poi l'elenco dal più recente: l'icona dell'origine, il titolo, la data e a che punto è la lettura,
 *   il lucchetto solo per «Solo Lateral Space». Un tocco apre il pannello della fonte, con il suo indirizzo
 *   (`?fonte=<id>`): «Indietro» lo chiude. (9b) In fondo «Cerca una persona» (RILASCIO-9b-COSTRUZIONE.md §2.13).
 * - Il cliente: i documenti «Per tutti» (nome, data, dimensione) e «Togli» a chi può; si aggiungono da «Aggiungi un
 *   file», nella testata.
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
  const [openSource, showSource] = useSheetParam({ initial: lateralSpace ? initialSourceId : null, accept: acceptSource, param: "fonte" });

  if (!lateralSpace) {
    return sources.length === 0 ? (
      <EmptyState text={T.documents.empty} />
    ) : (
      <ul className="divide-y rounded-xl border">
        {sources.map((source) => (
          <ClientDocumentRow key={source.id} workspaceId={workspaceId} today={today} source={source} />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-4">
      {granola ?? null}
      {sources.length === 0 ? (
        <EmptyState text={T.notes.empty} />
      ) : (
        <ul className="divide-y rounded-xl border">
          {sources.map((source) => {
            const Icon = originIcon(source);
            return (
              <li key={source.id}>
                <button
                  type="button"
                  onClick={() => showSource(source.id)}
                  aria-haspopup="dialog"
                  className="flex min-h-11 w-full items-start gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block text-sm break-words">
                      <span className="sr-only">{sourceOriginLabel(source)}: </span>
                      {source.title}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {sourceRowMeta(source, today).map((part, index) => (
                        <span key={`${part}-${index}`}>{part}</span>
                      ))}
                      {source.visibility === "ls" ? <LsLock /> : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex justify-end">
        <PeopleSearch workspaceId={workspaceId} today={today} onOpenSource={(id) => showSource(id)} />
      </div>
      <SourceSheet workspaceId={workspaceId} sourceId={openSource} today={today} onClose={() => showSource(null)} />
    </div>
  );
}

/** Un documento nell'elenco del cliente: nome, data, dimensione; «Togli» a chi può (con il nome per i lettori di schermo), con la conferma. */
function ClientDocumentRow({ workspaceId, today, source }: { workspaceId: string; today: string; source: SourceListItem }) {
  const [asking, setAsking] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [pending, startTransition] = useTransition();
  const name = source.document?.fileName || source.title;
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
            <p className="text-sm break-words">{name}</p>
            <p className="text-xs text-muted-foreground">{sourceMeta(source, today, false).join(" · ")}</p>
          </div>
        </div>
        {source.canRemove && !asking ? (
          <Button type="button" variant="ghost" className="min-h-11 shrink-0 sm:min-h-8" disabled={pending} onClick={() => setAsking(true)}>
            {T.documents.remove}
            <span className="sr-only"> {name}</span>
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
