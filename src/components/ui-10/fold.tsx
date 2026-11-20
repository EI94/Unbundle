"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** L'ancora dell'indirizzo, senza «#» e decodificata come fa Next; "" senza. */
export function hashTarget(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * Aperta o chiusa: chi guarda decide, finché un link non chiede la piega di nuovo.
 * - nessun tocco: aperta se la pagina l'ha chiesta (`defaultOpen`) o se l'ancora è la sua;
 * - dopo un tocco: come l'ha lasciata chi guarda, tranne quando un link nuovo (un'ancora diversa da quella del tocco)
 *   porta alla piega, che allora si apre.
 */
export function foldOpen(i: { id: string; defaultOpen: boolean; hash: string; toggle: { open: boolean; hash: string } | null }): boolean {
  const arrived = hashTarget(i.hash) === i.id;
  if (i.toggle === null) return i.defaultOpen || arrived;
  return arrived && i.hash !== i.toggle.hash ? true : i.toggle.open;
}

export interface FoldProps {
  /** L'ancora della piega: un link a `#<id>` la apre, anche da un'altra pagina. */
  id: string;
  /** Il titolo: resta un vero H2, con il pulsante dentro. */
  title: string;
  /** La riga grigia di riepilogo accanto al titolo. */
  summary?: string | null;
  /** Un segno dopo il titolo, dentro il pulsante (il lucchetto di ciò che vede solo Lateral Space). Facoltativo. */
  marker?: ReactNode;
  /** Aperta quando la pagina arriva da un link che la chiede (per esempio `?capitolo=`): lo decide il server. */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * `Fold` (rilascio 10, docs/ui-10/PROPOSTA-10.md §5.4, regola 4 di §1): una piega accessibile. Il titolo è un H2 con
 * dentro un pulsante `aria-expanded` e `aria-controls`, la riga grigia di riepilogo e la freccia; il contenuto sta in
 * una regione nascosta finché è chiusa (`hidden`: la pagina resa dal server lo porta già, senza mostrarlo). Chiusa per
 * default; aperta solo all'arrivo da un link, con `defaultOpen` o con l'ancora `#<id>` (anche dopo, quando un link
 * della stessa pagina la chiede). Poi la apre e la chiude chi guarda (`foldOpen`). Sostituisce il `<details>` di
 * `use-cases/detail/fold.tsx`, dove il titolo stava dentro il `<summary>`.
 */
export function Fold({ id, title, summary, marker, defaultOpen = false, children, className }: FoldProps) {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const [toggle, setToggle] = useState<{ open: boolean; hash: string } | null>(null);
  const open = foldOpen({ id, defaultOpen, hash, toggle });
  const contentId = `${id}-contenuto`;
  return (
    <section id={id} data-slot="fold" data-open={open ? "" : undefined} className={cn("scroll-mt-20 border-t last:border-b", className)}>
      <h2 className="text-base font-semibold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setToggle({ open: !open, hash: window.location.hash })}
          className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-12"
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="min-w-0 break-words">{title}</span>
            {marker ? <span className="inline-flex shrink-0 items-center self-center">{marker}</span> : null}
            {summary ? <span className="min-w-0 text-sm font-normal text-muted-foreground">{summary}</span> : null}
          </span>
          <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} />
        </button>
      </h2>
      <div id={contentId} data-slot="fold-content" hidden={!open} className="space-y-4 pb-5">
        {children}
      </div>
    </section>
  );
}
