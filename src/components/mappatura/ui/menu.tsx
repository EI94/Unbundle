"use client";

/**
 * «Mappatura board»: il «⋯» della testata della board (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7): le azioni che non
 * servono a ogni visita («Copia la mappa come testo», «Usa le categorie proposte») in un menu solo, accanto alla pillola.
 *
 * Un menu vero (Base UI): frecce, Invio, Escape, il fuoco che torna al «⋯». Si disegna dentro la radice della board
 * (`Portal` con `container`, come il drawer), così prende i suoi token e i suoi colori. Voci alte 44 px al telefono.
 */
import { Menu } from "@base-ui/react/menu";
import { useSyncExternalStore, type JSX } from "react";
import { BOARD_ROOT_SELECTOR } from "./drawer.tsx";

export interface BoardMenuItem {
  key: string;
  label: string;
  onSelect(): void;
}

const noSubscription = () => () => {};
const findBoardRoot = () => document.querySelector<HTMLElement>(BOARD_ROOT_SELECTOR);
const noBoardRoot = () => null;

function DotsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

/** Il «⋯» con le sue voci; senza voci non c'è. `hidePhone`: quello della testata, che al telefono sta nella riga delle schede. */
export function BoardMenu(p: { label: string; items: readonly BoardMenuItem[]; hidePhone?: boolean }): JSX.Element | null {
  const root = useSyncExternalStore(noSubscription, findBoardRoot, noBoardRoot);
  if (p.items.length === 0) return null;
  return (
    <Menu.Root>
      <Menu.Trigger className={p.hidePhone ? "b-iconbtn b-menu-btn b-hide-phone" : "b-iconbtn b-menu-btn"} aria-label={p.label} title={p.label} data-b="board-menu">
        <DotsIcon />
      </Menu.Trigger>
      <Menu.Portal container={root ?? undefined}>
        <Menu.Positioner className="b-menu-pos" align="end" sideOffset={6}>
          <Menu.Popup className="b-menu" data-b="board-menu-popup">
            {p.items.map((item) => (
              <Menu.Item key={item.key} className="b-menu-item" onClick={() => item.onSelect()} data-slot="dropdown-menu-item" data-b="board-menu-item">
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Il «⋯» che non si usa ancora (la testata che carica): la stessa forma del vero, fermo. */
export function BoardMenuPlaceholder(p: { label: string; hidePhone?: boolean }): JSX.Element {
  return (
    <button type="button" className={p.hidePhone ? "b-iconbtn b-menu-btn b-hide-phone" : "b-iconbtn b-menu-btn"} aria-label={p.label} title={p.label} inert data-b="board-menu">
      <DotsIcon />
    </button>
  );
}
