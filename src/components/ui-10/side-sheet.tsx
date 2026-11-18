"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { UI10_TEXT } from "./text";

/** Il parametro dell'indirizzo dei pannelli: uno solo per tutte le pagine (§8.2, regola 6). */
export const SHEET_PARAM = "apri";

/**
 * L'indirizzo `href` (assoluto) con il pannello `value` aperto, o chiuso con null: gli altri parametri e l'ancora
 * restano. Restituisce percorso, query e ancora.
 */
export function sheetHref(href: string, value: string | null, param: string = SHEET_PARAM): string {
  const url = new URL(href);
  if (value) url.searchParams.set(param, value);
  else url.searchParams.delete(param);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Il pannello aperto, sempre nell'indirizzo (`?apri=<pannello>`), senza ricaricare la pagina:
 * - `initial`: il valore di `?apri=` che la pagina ha letto sul server (un link condiviso apre il pannello);
 * - `accept`: i valori validi (un vecchio nome può tornare quello nuovo); un valore sconosciuto vale chiuso. Una
 *   funzione del modulo, sempre la stessa;
 * - aprire da chiuso aggiunge un passo alla cronologia, così «Indietro» (anche il gesto del telefono) lo chiude;
 *   passare da un pannello all'altro sostituisce il passo; chiudere dopo un'apertura torna indietro di quel passo.
 */
export function useSheetParam<T extends string>(o: { initial: string | null; accept: (raw: string | null) => T | null; param?: string }) {
  const param = o.param ?? SHEET_PARAM;
  const accept = o.accept;
  const pushed = useRef(false);
  const [open, setOpen] = useState<T | null>(() => accept(o.initial));
  const show = useCallback(
    (next: T | null) => {
      setOpen(next);
      const target = sheetHref(window.location.href, next, param);
      const wasOpen = new URL(window.location.href).searchParams.has(param);
      if (next && !wasOpen) {
        window.history.pushState(window.history.state, "", target);
        pushed.current = true;
      } else if (!next && pushed.current) {
        // L'apertura aveva aggiunto un passo: chiudere è tornare indietro (il «popstate» lo conferma).
        pushed.current = false;
        window.history.back();
      } else {
        window.history.replaceState(window.history.state, "", target);
      }
    },
    [param],
  );
  useEffect(() => {
    const onPop = () => {
      const value = accept(new URL(window.location.href).searchParams.get(param));
      if (!value) pushed.current = false;
      setOpen(value);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [param, accept]);
  return [open, show] as const;
}

export interface SideSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Una frase sotto il titolo, facoltativa. */
  description?: ReactNode;
  /** Il piede: il pulsante pieno del pannello, se ne ha uno. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * `SideSheet` (rilascio 10, docs/ui-10/PROPOSTA-10.md §5.4): il pannello laterale. Da 640 px sta a destra, largo al
 * massimo 32 rem; al telefono è a tutto schermo. La testata ha il titolo e ✕ («Chiudi», 44 px al telefono); il
 * contenuto scorre; il piede porta il suo pulsante pieno (pannelli e finestre ne hanno uno loro). Sempre con un
 * indirizzo: si apre e si chiude con `useSheetParam`, e «Indietro» lo chiude. Esc e un tocco fuori chiudono.
 */
export function SideSheet({ open, onClose, title, description, footer, children, className }: SideSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        data-slot="side-sheet"
        className={cn("gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-lg", className)}
      >
        <SheetHeader className="flex-row items-start gap-3 border-b px-4 py-2 sm:px-6">
          <SheetTitle className="min-w-0 flex-1 py-2.5 text-base font-semibold break-words">{title}</SheetTitle>
          <SheetClose render={<Button variant="ghost" size="icon" className="-mr-2 size-11 shrink-0 sm:size-9" />}>
            <XIcon aria-hidden />
            <span className="sr-only">{UI10_TEXT.sheet.close}</span>
          </SheetClose>
        </SheetHeader>
        {description ? <SheetDescription className="px-4 pt-3 break-words sm:px-6">{description}</SheetDescription> : null}
        <div data-slot="side-sheet-body" className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {children}
        </div>
        {footer ? <SheetFooter className="mt-0 border-t px-4 py-3 sm:px-6">{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}
