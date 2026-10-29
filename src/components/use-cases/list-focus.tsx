"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * «‹ Torna alla Panoramica» sta sopra un grafico del menu «⋯» (`ChartHeader` di chart-view.tsx):
 * tornando alla Panoramica il pulsante sparisce con il grafico, e con `scroll={false}` Next non
 * sposta il fuoco, che cadrebbe sul `<body>` (per un lettore di schermo la pagina non arriva). Il
 * clic lascia un segno; la Panoramica, appena c'è, porta il fuoco sul suo titolo per i lettori di
 * schermo (`ListFocusTarget`, in hub.tsx). Senza il segno (un caricamento qualsiasi della pagina)
 * il fuoco resta dov'è.
 */
let focusListOnMount = false;

/** Solo il clic semplice (o Invio) resta in questa pagina; una nuova scheda o finestra no. */
export function staysInPage(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** Il segno lasciato da «‹ Torna alla Panoramica». */
export function markListFocus(): void {
  focusListOnMount = true;
}

/** La Panoramica appena montata legge il segno e lo toglie: il fuoco si sposta una volta sola. */
export function takeListFocus(): boolean {
  const marked = focusListOnMount;
  focusListOnMount = false;
  return marked;
}

/** «‹ Torna alla Panoramica» sopra un grafico del menu «⋯»: bordato, mai il pulsante pieno della pagina. */
export function BackToListLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button
      variant="outline"
      className="min-h-11 sm:min-h-8"
      render={
        <Link
          href={href}
          scroll={false}
          onClick={(event) => {
            if (staysInPage(event)) markListFocus();
          }}
        />
      }
      nativeButton={false}
    >
      <ChevronLeft aria-hidden />
      {children}
    </Button>
  );
}

/** Il titolo della Panoramica, solo per i lettori di schermo (sr-only): prende il fuoco dopo «‹ Torna alla Panoramica». */
export function ListFocusTarget({ title }: { title: string }) {
  const ref = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (takeListFocus()) ref.current?.focus();
  }, []);
  return (
    <h2 ref={ref} tabIndex={-1} data-slot="list-focus" className="sr-only">
      {title}
    </h2>
  );
}
