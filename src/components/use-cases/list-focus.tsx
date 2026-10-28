"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * «‹ Torna alla lista» sopra un grafico del menu «⋯» di «Priorità»: tornando alla lista il pulsante
 * sparisce con il grafico, e con `scroll={false}` Next non sposta il fuoco, che cadrebbe sul `<body>`
 * (per un lettore di schermo la lista non arriva). Il clic lascia un segno; la lista, appena c'è,
 * porta il fuoco sul suo titolo (`ListFocusTarget`). Senza il segno (un caricamento qualsiasi della
 * lista) il fuoco resta dov'è.
 */
let focusListOnMount = false;

/** Solo il clic semplice (o Invio) resta in questa pagina; una nuova scheda o finestra no. */
export function staysInPage(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** Il segno lasciato da «‹ Torna alla lista». */
export function markListFocus(): void {
  focusListOnMount = true;
}

/** La lista appena montata legge il segno e lo toglie: il fuoco si sposta una volta sola. */
export function takeListFocus(): boolean {
  const marked = focusListOnMount;
  focusListOnMount = false;
  return marked;
}

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

/** Il titolo della lista, solo per i lettori di schermo: prende il fuoco dopo «‹ Torna alla lista». */
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
