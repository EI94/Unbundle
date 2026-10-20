"use client";

import { useState, useSyncExternalStore } from "react";
import { Lock, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addCommentAction, resolveCommentAction } from "@/lib/actions/uc-catalog";
import { cn } from "@/lib/utils";
import type { ActivityEntry } from "@/lib/uc/views/item-detail";
import { useUcAction } from "./use-uc-action";

type Visibility = "interno_ls" | "condiviso";

const VISIBILITY_LABEL: Readonly<Record<Visibility, string>> = { interno_ls: "Solo Lateral Space", condiviso: "Anche il cliente" };

/** La scelta di chi vede il commento resta da una domanda all'altra (solo in questo browser). */
const VISIBILITY_KEY = "uc.commento.visibilita";

function readVisibility(): Visibility | null {
  try {
    const v = window.localStorage.getItem(VISIBILITY_KEY);
    return v === "interno_ls" || v === "condiviso" ? v : null;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}
function writeVisibility(v: Visibility) {
  try {
    window.localStorage.setItem(VISIBILITY_KEY, v);
  } catch {
    // Senza memoria del browser la scelta vale solo per questo commento.
  }
  for (const l of listeners) l();
}

/** Quante voci dell'attività si vedono prima di «Mostra tutto» (§3.6.5: gli ultimi 3). */
const SHOWN = 3;

/**
 * «Attività» della domanda (DESIGN §3.6.5): commenti e storia in una sola
 * linea del tempo, gli ultimi 3, poi «Mostra tutto». Il compositore si apre con
 * «Scrivi un commento» e ricorda la scelta «Solo Lateral Space» / «Anche il
 * cliente». I commenti interni non arrivano mai ai ruoli del cliente (filtro
 * nella query); il testo passa dalla scansione lato server.
 */
export function QuestionActivity({
  workspaceId,
  caseId,
  itemId,
  entries,
  visibilities,
  canResolve,
  all = false,
}: {
  workspaceId: string;
  caseId: string;
  itemId: string;
  entries: ActivityEntry[];
  /** Visibilità che chi scrive può scegliere; vuoto = non scrive. */
  visibilities: Visibility[];
  canResolve: boolean;
  /** Pagina intera: tutta l'attività, senza «Mostra tutto». */
  all?: boolean;
}) {
  const { pending, run } = useUcAction();
  const [expanded, setExpanded] = useState(all);
  const [writing, setWriting] = useState(false);
  const [body, setBody] = useState("");
  const remembered = useSyncExternalStore(subscribe, readVisibility, () => null);
  const visibility: Visibility = remembered && visibilities.includes(remembered) ? remembered : (visibilities[0] ?? "condiviso");
  const shown = expanded ? entries : entries.slice(0, SHOWN);

  return (
    <div className="min-w-0 space-y-3">
      {shown.length > 0 && (
        <ol className="space-y-3">
          {shown.map((e) => (
            <li key={e.id} className="flex min-w-0 gap-3 text-sm">
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", e.kind === "commento" ? "bg-foreground" : "bg-muted-foreground")} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className={cn(e.kind === "commento" ? "font-medium" : "text-muted-foreground")}>{e.title}</span>
                  {e.clarification && e.open && <MessageCircleQuestion className="size-3.5 text-uc-giallo" aria-hidden />}
                  {e.internal && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="size-3" aria-hidden />
                      Solo Lateral Space
                    </span>
                  )}
                </p>
                {e.body && <p className="mt-0.5 break-words whitespace-pre-line">{e.body}</p>}
                {e.meta && <p className="mt-0.5 text-xs text-muted-foreground">{e.meta}</p>}
                {e.open && canResolve && e.commentId && (
                  <Button
                    className="mt-1 min-h-11 sm:min-h-7"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => run(() => resolveCommentAction(workspaceId, caseId, { commentId: e.commentId }), { success: "Chiarimento chiuso." })}
                  >
                    Chiudi il chiarimento
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!expanded && entries.length > SHOWN && (
          <Button variant="ghost" className="min-h-11 px-2 sm:min-h-8" onClick={() => setExpanded(true)}>
            Mostra tutto ({entries.length})
          </Button>
        )}
        {visibilities.length > 0 && !writing && (
          <Button variant="outline" className="min-h-11 sm:min-h-8" onClick={() => setWriting(true)}>
            Scrivi un commento
          </Button>
        )}
      </div>
      {visibilities.length > 0 && writing && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addCommentAction(workspaceId, caseId, { itemId, body: body.trim(), visibility }), {
              success: "Commento aggiunto.",
              onSuccess: () => {
                setBody("");
                setWriting(false);
              },
            });
          }}
        >
          <label className="block">
            <span className="sr-only">Commento</span>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} rows={3} placeholder="Niente nomi di persone né dati personali." autoFocus />
          </label>
          {visibilities.length > 1 && (
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <legend className="sr-only">Chi lo vede</legend>
              {visibilities.map((v) => (
                <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-8">
                  <input type="radio" name={`visibilita-${itemId}`} value={v} checked={visibility === v} onChange={() => writeVisibility(v)} className="accent-primary" />
                  {VISIBILITY_LABEL[v]}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="outline" className="min-h-11 sm:min-h-8" disabled={body.trim().length === 0 || pending}>
              Aggiungi il commento
            </Button>
            <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setWriting(false)}>
              Annulla
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
