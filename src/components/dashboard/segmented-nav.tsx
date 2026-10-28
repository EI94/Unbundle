"use client";

import { useEffect, useRef } from "react";
import Link, { useLinkStatus } from "next/link";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Controllo segmentato fatto di link (DESIGN §5.1), sul modello dei Risultati
 * della Formazione (`learning/results-nav.tsx`): Domande, Soluzione,
 * `/valore/kpi`, Mappa. Ogni segmento è un indirizzo (`scroll={false}`), quello
 * attivo ha `aria-current="page"`. Se non ci sta, scorre dentro la sua cornice
 * (mai la pagina) e tiene in vista il segmento attivo. Lo zero non si mostra:
 * un conteggio a 0 sparisce.
 *
 * Condiviso fra le sezioni del dashboard: non importa nulla dei Casi d'uso.
 */
export interface SegmentedNavItem {
  key: string;
  label: string;
  /** Etichetta corta sotto `sm`. */
  short?: string;
  count?: number;
  href: string;
  /** Lucchetto; con un testo, il motivo per i lettori di schermo e nel suggerimento. */
  locked?: boolean | string;
}

export interface SegmentedNavProps {
  items: readonly SegmentedNavItem[];
  active: string;
  ariaLabel: string;
  size?: "md" | "sm";
  /**
   * Sotto `sm` i segmenti in una griglia di due colonne, tutti in vista, invece di una riga che
   * scorre e taglia gli ultimi (le quattro viste degli use case non stanno in 360 px). Da `sm` la
   * riga di sempre.
   */
  gridOnPhone?: boolean;
  className?: string;
}

const COUNT = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });

/** Puntino che pulsa mentre il segmento si carica: sempre presente, cambia solo l'opacità. */
function PendingHint() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full bg-current transition-opacity", pending ? "animate-pulse opacity-70" : "opacity-0")} />;
}

export function SegmentedNav({ items, active, ariaLabel, size = "md", gridOnPhone = false, className }: SegmentedNavProps) {
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    // Solo in orizzontale, dentro la cornice: la pagina non si muove.
    const el = activeRef.current;
    const box = listRef.current;
    if (!el || !box || box.scrollWidth <= box.clientWidth) return;
    const a = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (a.left < b.left) box.scrollLeft -= b.left - a.left + 8;
    else if (a.right > b.right) box.scrollLeft += a.right - b.right + 8;
  }, [active]);
  if (items.length === 0) return null;
  return (
    <nav aria-label={ariaLabel} data-slot="segmented-nav" className={cn("max-w-full min-w-0", className)}>
      <ul
        ref={listRef}
        className={cn(
          "max-w-full gap-1 overflow-x-auto rounded-2xl border bg-muted/60 p-1 [scrollbar-width:none]",
          gridOnPhone ? "grid w-full grid-cols-2 sm:inline-flex sm:w-auto" : "inline-flex",
        )}
      >
        {items.map((item) => {
          const current = item.key === active;
          const lockedText = typeof item.locked === "string" ? item.locked : item.locked ? "non ancora disponibile" : null;
          return (
            <li key={item.key} className={gridOnPhone ? "min-w-0 sm:shrink-0" : "shrink-0"}>
              <Link
                ref={current ? activeRef : undefined}
                href={item.href}
                scroll={false}
                aria-current={current ? "page" : undefined}
                title={lockedText ?? undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl font-medium whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  size === "sm" ? "min-h-11 px-2.5 text-xs sm:min-h-8" : "min-h-11 px-3 text-sm sm:min-h-9",
                  gridOnPhone && "justify-center sm:justify-start",
                  current ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                )}
              >
                {item.short ? (
                  <>
                    <span className="sm:hidden">{item.short}</span>
                    <span className="hidden sm:inline">{item.label}</span>
                  </>
                ) : (
                  <span>{item.label}</span>
                )}
                {typeof item.count === "number" && item.count > 0 && <span className="text-xs text-muted-foreground tabular-nums">{COUNT.format(item.count)}</span>}
                {lockedText && (
                  <>
                    <Lock className="size-3 shrink-0 opacity-70" aria-hidden />
                    <span className="sr-only">({lockedText})</span>
                  </>
                )}
                <PendingHint />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
