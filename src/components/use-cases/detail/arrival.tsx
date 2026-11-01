"use client";

import { useEffect, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { hashTargetOf } from "../list-focus";

/** Le ancore che un `#ancora` dell'indirizzo può raggiungere (`detailTargetIds`), dell'ultimo `Arrival` montato. */
let knownIds: readonly string[] = [];

/**
 * Il punto dentro un'ancora che prende il fuoco: quello segnato (`data-arrival-focus`), il
 * `<summary>` di una piega, il suo titolo con `tabIndex={-1}`, oppure l'ancora stessa se si può
 * mettere a fuoco.
 */
function focusTargetOf(el: HTMLElement): HTMLElement | null {
  const marked = el.querySelector<HTMLElement>("[data-arrival-focus]");
  if (marked) return marked;
  if (el instanceof HTMLDetailsElement) {
    const summary = el.querySelector<HTMLElement>(":scope > summary");
    if (summary) return summary;
  }
  const heading = el.querySelector<HTMLElement>(":is(h2, h3)[tabindex='-1']");
  if (heading) return heading;
  return el.getAttribute("tabindex") === "-1" ? el : null;
}

/**
 * Porta la pagina a un'ancora della scheda: apre la piega se l'ancora è un `<details>` (nient'altro
 * si apre), la porta in cima e le dà il fuoco senza scorrere di nuovo. Non cambia l'indirizzo.
 * Vero se l'ancora c'è.
 */
export function arriveAt(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  if (el instanceof HTMLDetailsElement && !el.open) el.open = true;
  requestAnimationFrame(() => {
    el.scrollIntoView({ block: "start" });
    focusTargetOf(el)?.focus({ preventScroll: true });
  });
  return true;
}

/**
 * L'ancora della scheda che un `#ancora` dell'indirizzo raggiunge, o null. Decodifica come
 * `hashTargetOf`: un'ancora malformata («#%», «#100%», un link copiato a metà) resta com'è, non è
 * nessuna delle nostre e non porta la scheda nel confine d'errore, perché l'effetto di `Arrival`
 * che la legge è dentro React.
 */
export function knownAnchorOf(hash: string, ids: readonly string[]): string | null {
  const id = hashTargetOf(hash);
  return id !== null && ids.includes(id) ? id : null;
}

export interface ArrivalProps {
  /** `?capitolo=` già risolto (`arrivalTarget`): l'ancora a cui arriva la pagina; null senza. */
  initial: string | null;
  /** Le ancore della scheda di chi guarda (`detailTargetIds`). */
  ids: readonly string[];
}

/**
 * L'arrivo sulla scheda (rilascio 3, al posto delle schede-ancora): con `?capitolo=` (email,
 * campanella, pannello) la pagina va a quell'ancora; senza, a un `#ancora` dell'indirizzo che la
 * pagina conosce (link copiati prima). Anche a ogni `hashchange`. Non disegna niente.
 */
export function Arrival({ initial, ids }: ArrivalProps) {
  const key = ids.join(" ");
  useEffect(() => {
    knownIds = key ? key.split(" ") : [];
    const fromHash = () => knownAnchorOf(window.location.hash, knownIds);
    const target = initial ?? fromHash();
    if (target) arriveAt(target);
    const onHash = () => {
      const next = fromHash();
      if (next) arriveAt(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [initial, key]);
  return null;
}

/** Il link tranquillo nel testo del riquadro, sottolineato. */
const QUIET_LINK =
  "inline-flex min-h-11 items-center self-start rounded-md text-sm text-foreground underline underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8";

/**
 * Un link a un'ancora della stessa scheda («Vedi le risposte», «Leggi la risposta», «Vai a
 * «Quando»»): un `<a href="#…">` che arriva da sé con `arriveAt`, perché una navigazione di Next
 * allo stesso indirizzo con un'ancora non manda `hashchange`, e la stessa ancora due volte nemmeno.
 * Senza `className` è il link tranquillo del testo; come `render` di `Button` prende le sue classi.
 */
export function InPageLink({ id, onClick, className, children, ...rest }: { id: string; children?: ReactNode } & Omit<ComponentProps<"a">, "href" | "id">) {
  function go(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!document.getElementById(id)) return;
    event.preventDefault();
    arriveAt(id);
  }
  return (
    <a {...rest} href={`#${id}`} onClick={go} className={className ?? QUIET_LINK}>
      {children}
    </a>
  );
}
