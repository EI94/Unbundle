"use client";

import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { arrivalTargetIn } from "@/lib/use-cases/guided";
import { hashTargetOf } from "../list-focus";

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
 * Porta la pagina a un'ancora della scheda: apre la piega se l'ancora è un `<details>` e, dentro, gli
 * elenchi segnati `data-arrival-open` (rilascio 6: i requisiti di «Cosa serve»), la porta in cima e le
 * dà il fuoco senza scorrere di nuovo. Non cambia l'indirizzo.
 * Vero se l'ancora c'è.
 */
export function arriveAt(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  if (el instanceof HTMLDetailsElement && !el.open) el.open = true;
  // (Rilascio 6, B.1.5) L'elenco intero dietro un conteggio («Requisiti · 9») si apre con l'arrivo.
  for (const inner of el.querySelectorAll<HTMLDetailsElement>("details[data-arrival-open]")) inner.open = true;
  requestAnimationFrame(() => {
    el.scrollIntoView({ block: "start" });
    focusTargetOf(el)?.focus({ preventScroll: true });
  });
  return true;
}

/**
 * L'ancora della scheda a cui arriva un `#ancora` dell'indirizzo, o null: la stessa regola di
 * `?capitolo=` (`arrivalTargetIn`), così «#realizzazione» su una scheda pronta va al riquadro
 * «Prossimo passo», dove si avvia. Decodifica come `hashTargetOf`: un'ancora malformata («#%»,
 * «#100%», un link copiato a metà) resta com'è, non è nessuna delle nostre e non porta la scheda nel
 * confine d'errore, perché l'effetto di `Arrival` che la legge è dentro React.
 */
export function knownAnchorOf(hash: string, ids: readonly string[], startInBox = false): string | null {
  const id = hashTargetOf(hash);
  return id === null ? null : arrivalTargetIn(id, ids, startInBox);
}

/**
 * Una navigazione verso la scheda: il percorso e il `?capitolo=` della pagina resa (la prop `chapter`
 * di `Arrival`, dalla stessa resa del server di `initial`). La rilettura della pagina dopo un'azione
 * (`router.refresh`, `revalidatePath`) non la cambia, anche se intanto il passo è cambiato; un link a
 * un altro `?capitolo=` (campanella, email) sì, e così Indietro e Avanti del browser.
 */
export function navigationKey(pathname: string | null, chapter: string | null): string {
  return `${pathname ?? ""}?capitolo=${chapter ?? ""}`;
}

/** L'arrivo di una navigazione: la sua chiave (`navigationKey`) e l'ancora risolta quando è arrivata. */
export interface Landing {
  navigation: string;
  target: string | null;
}

/**
 * L'arrivo da tenere: quello di prima per la stessa navigazione (una rilettura dopo «Quando», un
 * requisito aggiunto, una decisione del riquadro: niente si apre, si chiude o si sposta da sé), un
 * arrivo nuovo con l'ancora risolta adesso per una navigazione nuova.
 */
export function landingFor(previous: Landing | null, navigation: string, target: string | null): Landing {
  return previous !== null && previous.navigation === navigation ? previous : { navigation, target };
}

/** L'ancora a cui è arrivata la navigazione di adesso: una piega nasce aperta se è lei. */
const LandingContext = createContext<string | null>(null);

/** L'ancora dell'arrivo (`Arrival`), null senza `?capitolo=` o fuori dalla scheda. */
export function useLanding(): string | null {
  return useContext(LandingContext);
}

export interface ArrivalProps {
  /** `?capitolo=` già risolto (`arrivalTarget`): l'ancora a cui arriva la pagina; null senza. */
  initial: string | null;
  /**
   * Il `?capitolo=` della pagina (`chapterFromParam`), dalla stessa resa di `initial`: con il percorso,
   * la chiave della navigazione. Non dall'indirizzo (`useSearchParams`): con Indietro e Avanti tra due
   * `?capitolo=` della stessa scheda Next rende prima la pagina di prima con l'indirizzo nuovo (il
   * `useDeferredValue` di layout-router), e una chiave dall'indirizzo si legava all'`initial` di prima
   * per tutta la navigazione: la piega dell'indirizzo di prima aperta, il fuoco su di lei.
   */
  chapter?: string | null;
  /** Le ancore della scheda di chi guarda (`detailTargetIds`). */
  ids: readonly string[];
  /** «Avvia la realizzazione» o «Segna come in realizzazione» stanno nel riquadro (`startsInBox`): per un `#ancora`. */
  startInBox?: boolean;
  /** La scheda: le pieghe leggono l'arrivo con `useLanding`. */
  children?: ReactNode;
}

/**
 * L'arrivo sulla scheda (rilascio 3, al posto delle schede-ancora): con `?capitolo=` (email,
 * campanella, pannello) la pagina va a quell'ancora; senza, a un `#ancora` dell'indirizzo che la
 * pagina conosce (link copiati prima). Anche a ogni `hashchange`. Una volta per navigazione
 * (`navigationKey`): la rilettura dopo un'azione sullo stesso indirizzo (che resta, per esempio,
 * `?capitolo=realizzazione` per tutta la visita) non riporta la pagina all'ancora, non apre né chiude
 * pieghe e non sposta il fuoco, anche quando il passo cambia e lo stesso `?capitolo=` oggi si
 * risolverebbe altrove (G9 ↔ G3 con «Quando»). L'ancora risolta e le ancore della scheda si leggono
 * dall'ultima resa (`latest`), senza far ripartire l'arrivo. La chiave e l'ancora risolta vengono
 * dalla stessa resa (`chapter`, `initial`), così Indietro e Avanti arrivano all'ancora dell'indirizzo
 * a cui si torna.
 */
export function Arrival({ initial, chapter = null, ids, startInBox = false, children }: ArrivalProps) {
  const navigation = navigationKey(usePathname(), chapter);
  const [stored, setStored] = useState<Landing>(() => landingFor(null, navigation, initial));
  const landing = landingFor(stored, navigation, initial);
  if (landing !== stored) setStored(landing);
  const latest = useRef({ target: landing.target, ids, startInBox });
  useEffect(() => {
    latest.current = { target: landing.target, ids, startInBox };
  });
  useEffect(() => {
    const { target, ids: known, startInBox: inBox } = latest.current;
    const to = target ?? knownAnchorOf(window.location.hash, known, inBox);
    if (to) arriveAt(to);
  }, [navigation]);
  useEffect(() => {
    const onHash = () => {
      const { ids: known, startInBox: inBox } = latest.current;
      const to = knownAnchorOf(window.location.hash, known, inBox);
      if (to) arriveAt(to);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return <LandingContext value={landing.target}>{children}</LandingContext>;
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
