"use client";

/**
 * «Mappatura board»: il drawer della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.9, P29–P33, F2; BOARD-SPEC
 * §1.4.13).
 *
 * Il pannello del riferimento, fermo al bordo destro sopra la pagina velata: largo 920 px (`wide`), 540 px nella forma
 * stretta, tutta la larghezza sul telefono. In testa la riga del contesto in mono, il titolo in serif e «Chiudi»; sotto
 * il corpo, che scorre da sé. Qui è un dialogo vero (Base UI): `role="dialog"`, il fuoco resta dentro e torna alla
 * card che l'ha aperto, la pagina sotto non scorre; Escape, «Chiudi» e un clic sul velo lo chiudono. Il dialogo sta
 * dentro la radice della board (`Portal` con `container`), così prende i suoi token; il suo toast sta dentro di lui
 * (un dialogo modale rende inerte il resto della pagina, e «Annulla» deve restare a portata).
 *
 * `DrawerStatic` è lo stesso pannello senza dialogo, aperto: per la vetrina statica dello script delle schermate e per
 * i test (il dialogo di Base UI non si disegna sul server).
 */
import { Dialog } from "@base-ui/react/dialog";
import { useId, useRef, useSyncExternalStore, type JSX, type ReactNode, type RefObject } from "react";
import { BOARD_TEXT } from "../../../lib/mappatura/text.ts";
import { useClaimToastHost } from "../store/use-board.tsx";
import { BoardToastView } from "./edit.tsx";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

/** Il selettore della radice della board (`mapping/layout.tsx`): il dialogo si disegna lì dentro. */
export const BOARD_ROOT_SELECTOR = "[data-board-root]";

const noSubscription = () => () => {};
const findBoardRoot = () => document.querySelector<HTMLElement>(BOARD_ROOT_SELECTOR);
const noBoardRoot = () => null;

/** Il primo elemento che prende il fuoco dentro `element` (il campo del titolo di un passo appena aggiunto). */
function firstFocusable(element: Pick<ParentNode, "querySelector"> | null): HTMLElement | null {
  return element?.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? null;
}

/** Dove va il fuoco del drawer appena aperto. */
export type DrawerFocus = "close" | "title" | "body";

/**
 * Il fuoco all'apertura (P30): «Chiudi»; con `title` il campo del titolo (un passo appena aggiunto, P53); con `body` il
 * primo campo del corpo (la mappa come testo, da scegliere e copiare a mano, P62). Senza quel campo, «Chiudi».
 */
export function drawerInitialFocus(
  kind: DrawerFocus | undefined,
  parts: { title: Pick<ParentNode, "querySelector"> | null; body: Pick<ParentNode, "querySelector"> | null; close: HTMLElement | null },
): HTMLElement | true {
  const wanted = kind === "title" ? firstFocusable(parts.title) : kind === "body" ? firstFocusable(parts.body) : null;
  return wanted ?? parts.close ?? true;
}

interface DrawerFrameProps {
  context: string;
  title: ReactNode;
  titleId: string;
  toastHost: string;
  onClose(): void;
  closeRef?: RefObject<HTMLButtonElement | null>;
  titleRef?: RefObject<HTMLHeadingElement | null>;
  bodyRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

/** La testa (contesto, titolo, «Chiudi»), il corpo e il posto del toast: lo stesso nel dialogo e nella vetrina. */
function DrawerFrame({ context, title, titleId, toastHost, onClose, closeRef, titleRef, bodyRef, children }: DrawerFrameProps): JSX.Element {
  return (
    <>
      <div className="b-dr-head">
        <div>
          <div className="b-dr-sub">{context}</div>
          <h2 className="b-dr-t" id={titleId} ref={titleRef}>
            {title}
          </h2>
        </div>
        <button type="button" className="b-btn b-x" ref={closeRef} onClick={() => onClose()} data-b="drawer-close">
          {BOARD_TEXT.buttons.close}
        </button>
      </div>
      <div className="b-dr-body" ref={bodyRef}>
        {children}
      </div>
      <BoardToastView host={toastHost} />
    </>
  );
}

type TransitionState = { open: boolean; transitionStatus?: "starting" | "ending" | "idle" | undefined };
/** Aperto e già entrato: il pannello scorre dentro da destra e il velo compare (0,26 s e 0,2 s, niente con il movimento ridotto). */
const shown = (state: TransitionState) => state.open && state.transitionStatus !== "starting";

/**
 * Il drawer (P29–P33): un dialogo modale con la testa del riferimento. `initialFocus`: «Chiudi» (default), il primo
 * campo del titolo per un passo appena aggiunto (P30, P53), o il primo campo del corpo (`drawerInitialFocus`).
 * Chiuderlo lascia la pagina dov'era; il fuoco torna a chi l'ha aperto.
 */
export function Drawer(p: { open: boolean; onClose(): void; wide?: boolean; context: string; title: ReactNode; initialFocus?: DrawerFocus; children: ReactNode }): JSX.Element {
  const root = useSyncExternalStore(noSubscription, findBoardRoot, noBoardRoot);
  const titleId = useId();
  const toastHost = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useClaimToastHost(toastHost, p.open);
  const initialFocus = () => drawerInitialFocus(p.initialFocus, { title: titleRef.current, body: bodyRef.current, close: closeRef.current });
  return (
    <Dialog.Root
      open={p.open}
      onOpenChange={(open) => {
        if (!open) p.onClose();
      }}
    >
      <Dialog.Portal container={root ?? undefined}>
        <Dialog.Backdrop className={(state) => cx("b-scrim", shown(state) && "b-on")} data-b="scrim" />
        <Dialog.Popup className={(state) => cx("b-drawer", p.wide && "b-wide", shown(state) && "b-on")} aria-labelledby={titleId} initialFocus={initialFocus} data-b="drawer">
          <DrawerFrame context={p.context} title={p.title} titleId={titleId} toastHost={toastHost} onClose={p.onClose} closeRef={closeRef} titleRef={titleRef} bodyRef={bodyRef}>
            {p.children}
          </DrawerFrame>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Il drawer aperto, senza dialogo: per la vetrina statica e per i test. Stessa testa, stesso corpo, stesse classi. */
export function DrawerStatic(p: { wide?: boolean; context: string; title: ReactNode; children: ReactNode }): JSX.Element {
  const titleId = useId();
  const toastHost = useId();
  return (
    <>
      <div className="b-scrim b-on" data-b="scrim" />
      <div className={cx("b-drawer", p.wide && "b-wide", "b-on")} role="dialog" aria-modal="true" aria-labelledby={titleId} data-b="drawer">
        <DrawerFrame context={p.context} title={p.title} titleId={titleId} toastHost={toastHost} onClose={() => {}}>
          {p.children}
        </DrawerFrame>
      </div>
    </>
  );
}

/** I blocchi del drawer in tante colonne da 320 px quante ne stanno (P20, P32). */
export function DrawerColumns(p: { children: ReactNode }): JSX.Element {
  return (
    <div className="b-dr-cols" data-b="drawer-cols">
      {p.children}
    </div>
  );
}

/** Un blocco del drawer: l'etichetta in mono e il suo contenuto. `never`: l'etichetta in rosso (quello che non succede). */
export function DrawerList(p: { label: string; never?: boolean; children: ReactNode }): JSX.Element {
  return (
    <div data-b="drawer-list">
      <p className={cx("b-k", p.never && "b-never")}>{p.label}</p>
      {p.children}
    </div>
  );
}

/**
 * «Prima» accanto a «dopo» (P27): la riga grigia di oggi, la riga dell'accento della classificazione. L'etichetta in mono
 * sta sopra la riga, come sul riferimento: la riga comincia sotto di lei.
 */
export function Compare(p: { was: ReactNode; now: ReactNode; wasLabel: string; nowLabel: string }): JSX.Element {
  return (
    <div className="b-compare" data-b="compare">
      <div>
        <p className="b-k">{p.wasLabel}</p>
        <div className="b-was">{p.was}</div>
      </div>
      <div>
        <p className="b-k">{p.nowLabel}</p>
        <div className="b-now">{p.now}</div>
      </div>
    </div>
  );
}

/** «Decide una persona» (P25, P27): la riga ambra, l'etichetta in mono, chi decide che cosa. */
export function Human(p: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="b-human" data-b="human">
      <b>{p.label}</b>
      {p.children}
    </div>
  );
}
