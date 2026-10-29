"use client";

import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * «‹ Torna alla Panoramica» sta sopra un grafico del menu «⋯» (`ChartHeader` di chart-view.tsx):
 * tornando alla Panoramica il pulsante sparisce con il grafico, e con `scroll={false}` Next non
 * sposta il fuoco, che cadrebbe sul `<body>` (per un lettore di schermo la pagina non arriva). Il
 * clic lascia un segno; la Panoramica, appena c'è, porta il fuoco sul suo titolo per i lettori di
 * schermo (`ListFocusTarget`, in hub.tsx). Senza il segno (un caricamento qualsiasi della pagina)
 * il fuoco resta dov'è. Lo stesso per i link della Panoramica che aprono un'altra vista
 * (`ViewFocusLink`): «Vedi cosa serve», «Vedi le proposte» e «Da decidere» delle fasi spariscono
 * con la Panoramica, e il fuoco va al titolo di «Cosa serve» o di «Da decidere».
 */
let focusListOnMount = false;

/** Solo il clic semplice (o Invio) resta in questa pagina; una nuova scheda o finestra no. */
export function staysInPage(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** Il segno lasciato da «‹ Torna alla Panoramica» e da un `ViewFocusLink`. */
export function markListFocus(): void {
  focusListOnMount = true;
}

/** La vista appena montata legge il segno e lo toglie: il fuoco si sposta una volta sola. */
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

/**
 * Un link della Panoramica verso un'altra vista della pagina («Vedi cosa serve», «Da decidere» delle
 * fasi), con `scroll={false}` come gli altri: il clic lascia il segno, e la vista nuova porta il
 * fuoco sul suo titolo. Va anche come `render` di un `Button`.
 */
export function ViewFocusLink({ onClick, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      scroll={false}
      onClick={(event) => {
        onClick?.(event);
        if (staysInPage(event)) markListFocus();
      }}
    />
  );
}

/**
 * I link con un'ancora che porta in un'altra vista dell'hub: una card di «Per agente»
 * (`?agente=LIBRA#panoramica-approvati`), «‹ Tutti gli agenti» (`#agente-LIBRA`) e «Vai alla
 * Panoramica» di «Cosa serve» (`#panoramica-in-realizzazione`). Next scorre fino all'ancora, ma da
 * Next 16.3 non le dà più il fuoco (il nuovo gestore dello scorrimento, `ScrollHandler` in 16.4, non
 * chiama `focus()`, e da 16.4 l'opzione per il comportamento di prima non c'è più): il fuoco restava
 * sul link cliccato, che sparisce con il clic, e cadeva sul `<body>`; un lettore di schermo ripartiva
 * dalla cima della pagina. Il clic lascia l'ancora come segno; `HashFocusOnCommit`, nell'hub, a
 * navigazione confermata (dopo lo scorrimento di Next) porta il fuoco sull'ancora, senza scorrere
 * ancora, se l'indirizzo arrivato ha quell'ancora.
 * L'ancora deve poter prendere il fuoco: un link, o `tabIndex={-1}`.
 */
let pendingHashFocus: string | null = null;

/** L'ancora di un indirizzo, decodificata come fa Next (`#agente-LIBRA` → `agente-LIBRA`); null senza. */
export function hashTargetOf(href: string): string | null {
  const at = href.indexOf("#");
  const raw = at < 0 ? "" : href.slice(at + 1);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Il segno di un `HashFocusLink`: l'ancora che prende il fuoco a navigazione confermata. */
export function markHashFocus(id: string): void {
  pendingHashFocus = id;
}

/**
 * La navigazione confermata legge il segno e lo toglie: vale una volta sola, e solo se l'indirizzo
 * arrivato (`location.hash`) ha l'ancora del clic. Un segno rimasto da un clic che non ha navigato
 * non sposta il fuoco alla navigazione dopo.
 */
export function takeHashFocus(hash: string): string | null {
  const id = pendingHashFocus;
  pendingHashFocus = null;
  return id !== null && hashTargetOf(hash) === id ? id : null;
}

function focusHashTarget(id: string): void {
  document.getElementById(id)?.focus({ preventScroll: true });
}

/**
 * Un link con un'ancora (vedi sopra), senza `scroll={false}`: Next scorre all'ancora, il clic lascia
 * il segno e l'ancora prende il fuoco. Se cambia solo l'ancora (stesso indirizzo), la pagina resta e
 * il bersaglio c'è già: prende il fuoco subito. Va anche come `render` di un `Button`.
 */
export function HashFocusLink({ onClick, ...props }: ComponentProps<typeof Link> & { href: string }) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        onClick?.(event);
        const id = hashTargetOf(props.href);
        if (!id || event.defaultPrevented || !staysInPage(event)) return;
        const to = new URL(props.href, window.location.href);
        if (to.pathname === window.location.pathname && to.search === window.location.search) focusHashTarget(id);
        else markHashFocus(id);
      }}
    />
  );
}

/**
 * Montato una volta nell'hub: a ogni navigazione confermata (cambia il percorso o un parametro)
 * prende il segno di un `HashFocusLink` e porta il fuoco sull'ancora. L'effetto viene dopo lo
 * scorrimento di Next, che avviene mentre React conferma la navigazione.
 */
export function HashFocusOnCommit() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  useEffect(() => {
    const id = takeHashFocus(window.location.hash);
    if (id) focusHashTarget(id);
  }, [pathname, search]);
  return null;
}

/**
 * Dentro un elenco chiuso che un vecchio link apre («?vista=priorita&stima=mancante» apre «4 da
 * stimare» sotto la matrice): appena la pagina c'è, l'elenco viene in vista e il suo titolo prende il
 * fuoco. Senza, l'elenco stava sotto la piega e si vedeva solo una matrice quasi vuota.
 */
export function RevealOnMount() {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const details = ref.current?.closest("details");
    details?.scrollIntoView({ block: "center" });
    details?.querySelector("summary")?.focus({ preventScroll: true });
  }, []);
  return <span ref={ref} hidden data-slot="reveal-on-mount" />;
}

/** Il titolo di una vista, solo per i lettori di schermo (sr-only): prende il fuoco dopo «‹ Torna alla Panoramica» o un `ViewFocusLink`. */
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
