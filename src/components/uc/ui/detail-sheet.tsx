"use client";

import { useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { SemaforoColor } from "@/lib/uc/vocab";
import { StatusDot } from "./status-dot";

const SM_UP = "(min-width: 640px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(SM_UP);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Da `sm` in su il pannello sta a destra, sotto `sm` sale dal basso (85% dello schermo). */
function useSheetSide(): "right" | "bottom" {
  const wide = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(SM_UP).matches,
    () => true,
  );
  return wide ? "right" : "bottom";
}

export interface DetailSheetFrameProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  status?: { tone: SemaforoColor; label: string };
  description?: React.ReactNode;
  /** Riga sotto il titolo (etichette, segni). */
  chips?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "lg" | "xl" | "2xl";
}

const WIDTH = { lg: "data-[side=right]:sm:max-w-lg", xl: "data-[side=right]:sm:max-w-xl", "2xl": "data-[side=right]:sm:max-w-2xl" } as const;

/**
 * La cornice dei pannelli laterali: titolo, stato, contenuto che scorre,
 * piede facoltativo, «Chiudi» in italiano. Lato destro da `sm`, dal basso sotto.
 * La usano `DetailSheet` (aperto dall'URL) e i pannelli a stato locale.
 */
export function DetailSheetFrame({ open, onOpenChange, title, status, description, chips, children, footer, size = "lg" }: DetailSheetFrameProps) {
  const side = useSheetSide();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        showCloseButton={false}
        className={cn(
          "gap-0 overflow-hidden",
          side === "right" ? cn("data-[side=right]:w-full", WIDTH[size]) : "h-[85dvh] rounded-t-xl data-[side=bottom]:h-[85dvh]",
        )}
      >
        <SheetHeader className="border-b pr-14">
          <SheetTitle className="text-base font-semibold break-words">{title}</SheetTitle>
          {status && (
            <div className="mt-1">
              <StatusDot tone={status.tone} label={status.label} />
            </div>
          )}
          {description && <SheetDescription className="break-words">{description}</SheetDescription>}
          {chips && <div className="mt-2 flex flex-wrap gap-1.5">{chips}</div>}
          <SheetClose render={<Button variant="ghost" size="icon" className="absolute top-3 right-3 size-11 sm:size-8" />}>
            <XIcon aria-hidden />
            <span className="sr-only">Chiudi</span>
          </SheetClose>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">{children}</div>
        {footer && <SheetFooter className="mt-0 border-t">{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  );
}

export interface DetailSheetProps {
  title: string;
  status?: { tone: SemaforoColor; label: string };
  description?: React.ReactNode;
  chips?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Parametro dell'URL che apre il pannello: uno solo per tutte le pagine (DESIGN §1.1). */
  param?: string;
  /** Dove tornare alla chiusura; di solito lo stesso indirizzo senza il parametro. */
  closeHref?: string;
  size?: "lg" | "xl" | "2xl";
}

/**
 * Pannello di dettaglio aperto da `?apri=<id>` (DESIGN §5.1): il server lo
 * rende solo con il parametro presente, già con il contenuto; chiudendolo si
 * torna allo stesso indirizzo senza il parametro, senza scorrere la pagina.
 * Sostituisce `ItemSheet`, `UrlSheet` e i pannelli di KPI, entità e regole.
 */
export function DetailSheet({ param = "apri", closeHref, ...frame }: DetailSheetProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const close = () => {
    if (closeHref) return router.push(closeHref, { scroll: false });
    const next = new URLSearchParams(searchParams.toString());
    next.delete(param);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  return (
    <DetailSheetFrame
      {...frame}
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    />
  );
}
