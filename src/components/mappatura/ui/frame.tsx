"use client";

/**
 * «Mappatura board»: la cornice della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.9, BOARD-SPEC §1.4.1–§1.4.3).
 *
 * La testata come sulla board di riferimento: la riga del marchio con la pillola a destra, il titolo in serif con una
 * parola in corsivo, le schede con il loro numero d'ordine. Poi la testa di ogni vista (occhiello, titolo, frase) e i
 * blocchi con il loro titolo. Solo markup: le classi sono quelle di `board.css`, i colori solo i suoi token, le
 * scritte quelle di `src/lib/mappatura/text.ts`. Ogni pezzo porta `data-b="<nome>"`, che i test e lo script delle
 * schermate usano per trovarlo.
 *
 * Client Component per le schede (frecce e fuoco); gli altri pezzi non hanno stato e vanno bene anche in una pagina
 * del server.
 */
import Link from "next/link";
import { useRef, type JSX, type KeyboardEvent, type ReactNode } from "react";
import { BOARD_TEXT, pillText } from "../../../lib/mappatura/text.ts";
import type { PillState } from "../store/board-client.ts";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

// ─── Testata ─────────────────────────────────────────────────────────

/**
 * La testata della board, ferma in alto sotto la barra del workspace (P1, P2): la riga del marchio con `aside` a destra
 * (la pillola, «Salva ora», il bottone dell'assistente), il titolo, le schede. Sul telefono scorre con la pagina e resta
 * ferma la sola riga delle schede (board.css). Senza schede (l'elenco delle unità) sotto il titolo resta lo spazio che
 * darebbe la loro riga (`b-notabs`): il serif non tocca la riga della testata.
 */
export function BoardHeader(p: { brand: ReactNode; title: ReactNode; aside?: ReactNode; tabs?: ReactNode }): JSX.Element {
  return (
    <header className={cx("b-top", !p.tabs && "b-notabs")} data-b="header">
      <div className="b-wrap">
        <div className="b-shell">
          <div className="b-top-in">
            {p.brand}
            <div className="b-spacer" />
            {p.aside ? <div className="b-top-aside">{p.aside}</div> : null}
          </div>
          <h1 className="b-title" style={{ marginTop: 8 }}>
            {p.title}
          </h1>
          {p.tabs}
        </div>
      </div>
    </header>
  );
}

/** Il segno della board di riferimento: due barre sfalsate. */
function BrandMark(): JSX.Element {
  return (
    <svg width="22" height="12" viewBox="0 0 24 12" aria-hidden="true" focusable="false">
      <rect x="1" y="1.5" width="14" height="2.4" fill="currentColor" />
      <rect x="9" y="7.1" width="14" height="2.4" fill="currentColor" />
    </svg>
  );
}

/**
 * La riga del marchio: il segno, «lateral space», `×`, il nome del workspace, `·` e l'etichetta in mono «Activity
 * mapping», che porta all'elenco delle unità (l'artifact ha una pagina sola; l'app ha bisogno della strada indietro).
 * Il nome del link è la sua etichetta, che è anche il titolo della pagina dove porta. Senza nome del workspace (la
 * cornice di caricamento) la riga lo salta.
 */
export function BoardBrand(p: { workspaceName: string; areaHref: string }): JSX.Element {
  const [first, ...rest] = BOARD_TEXT.brand.company.split(" ");
  const name = p.workspaceName.trim();
  return (
    <div className="b-brand" data-b="brand">
      <BrandMark />
      <b>
        {first} <span className="b-mute">{rest.join(" ")}</span>
      </b>
      {name ? (
        <>
          <span className="b-x" aria-hidden="true">
            {BOARD_TEXT.brand.times}
          </span>
          <span>{name}</span>
        </>
      ) : null}
      <span className="b-x" aria-hidden="true">
        {BOARD_TEXT.brand.dot}
      </span>
      <Link href={p.areaHref}>{BOARD_TEXT.brand.area}</Link>
    </div>
  );
}

/** Il testo di un titolo con la sua parte in corsivo, nel colore dell'accento (P7): «Activity *mapping*». */
export function BoardTitle(p: { plain: string; accent: string; accentFirst?: boolean }): JSX.Element {
  return (
    <span data-b="title">
      {p.accentFirst ? (
        <>
          <i>{p.accent}</i> {p.plain}
        </>
      ) : (
        <>
          {p.plain} <i>{p.accent}</i>
        </>
      )}
    </span>
  );
}

// ─── Schede ──────────────────────────────────────────────────────────

/** L'id di una scheda e quello del pannello che apre: la vista lo mette sul suo `role="tabpanel"` (P6). */
export const boardTabId = (id: string) => `b-tab-${id}`;
export const boardPanelId = (id: string) => `b-panel-${id}`;

/** Il numero d'ordine di una scheda, su due cifre (P3): «01». */
export const tabOrdinal = (index: number) => String(index + 1).padStart(2, "0");

/**
 * La scheda che un tasto sceglie, partendo da quella con il fuoco (P6): frecce a destra e a sinistra con il giro in
 * fondo, Home e End. null per ogni altro tasto.
 */
export function tabAfterKey<T extends string>(ids: readonly T[], current: T, key: string): T | null {
  const at = ids.indexOf(current);
  if (at === -1 || ids.length === 0) return null;
  switch (key) {
    case "ArrowRight":
      return ids[(at + 1) % ids.length];
    case "ArrowLeft":
      return ids[(at - 1 + ids.length) % ids.length];
    case "Home":
      return ids[0];
    case "End":
      return ids[ids.length - 1];
    default:
      return null;
  }
}

/**
 * Le schede (P3, P6): un `tablist` con il numero d'ordine in mono, la scheda scelta con il testo in inchiostro e la
 * riga dell'accento, nessun conteggio. Le frecce scelgono e mettono il fuoco sulla vicina, con il giro; solo la scheda
 * scelta entra nel giro del Tab. `aside`: a destra della riga, solo sul telefono (la pillola a punto e il bottone
 * dell'assistente). `inert`: la riga c'è ma non si usa ancora (la board che si apre).
 */
export function BoardTabs<T extends string>(p: {
  label: string;
  tabs: ReadonlyArray<{ id: T; label: string }>;
  selected: T;
  onSelect(id: T): void;
  aside?: ReactNode;
  inert?: boolean;
}): JSX.Element {
  const list = useRef<HTMLDivElement>(null);
  const ids = p.tabs.map((tab) => tab.id);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: T) => {
    const next = tabAfterKey(ids, id, event.key);
    if (next === null) return;
    event.preventDefault();
    p.onSelect(next);
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  };
  return (
    <div className="b-tabbar" inert={p.inert || undefined} data-b="tabs">
      <div className="b-tabs" role="tablist" aria-label={p.label} ref={list}>
        {p.tabs.map((tab, index) => {
          const selected = tab.id === p.selected;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={boardTabId(tab.id)}
              className="b-tab"
              data-tab={tab.id}
              aria-selected={selected}
              aria-controls={boardPanelId(tab.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => p.onSelect(tab.id)}
              onKeyDown={(event) => onKeyDown(event, tab.id)}
            >
              <span className="b-n" aria-hidden="true">
                {tabOrdinal(index)}
              </span>
              {tab.label}
            </button>
          );
        })}
      </div>
      {p.aside ? <div className="b-tabs-aside">{p.aside}</div> : null}
    </div>
  );
}

// ─── Pillola ─────────────────────────────────────────────────────────

/**
 * La pillola dello stato (P70–P75, BOARD-SPEC §3.4): il punto (verde salvato, ambra da salvare o in salvataggio, grigio
 * altrimenti) e la scritta; «Salva ora» accanto solo con modifiche da salvare. È una regione viva educata (P85).
 * `compact`: solo il punto, con la scritta per gli screen reader (la riga delle schede sul telefono).
 */
export function StatusPill(p: { state: PillState | "loading"; savedAt: string | null; compact?: boolean; onSaveNow?: () => void }): JSX.Element {
  const text = pillText(p.state, p.savedAt);
  return (
    <>
      <span className={cx("b-status", p.compact && "b-compact")} data-s={p.state} role="status" aria-live="polite" data-b="pill">
        <span className="b-dot" aria-hidden="true" />
        <span className={p.compact ? "b-sr" : undefined}>{text}</span>
      </span>
      {p.onSaveNow && p.state === "dirty" && !p.compact ? (
        <button type="button" className="b-btn b-small" data-b="save-now" onClick={p.onSaveNow}>
          {BOARD_TEXT.buttons.saveNow}
        </button>
      ) : null}
    </>
  );
}

// ─── Area della board, testa della vista, blocchi ────────────────────

/**
 * L'area della board sotto la testata: il container delle soglie (`.b-main`), con il margine laterale e la larghezza
 * massima del riferimento. Drawer, velo e toast le stanno accanto, mai dentro (un container terrebbe fermi i `fixed`).
 */
export function BoardMain(p: { children: ReactNode }): JSX.Element {
  return (
    <div className="b-main" data-b="main">
      <div className="b-wrap">
        <div className="b-shell">{p.children}</div>
      </div>
    </div>
  );
}

/** La testa di ogni vista (P7): l'occhiello in mono, il titolo in serif, la frase; a destra l'unico bottone pieno. */
export function ViewHead(p: { eyebrow: string; title: ReactNode; lede?: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <div className="b-head" data-b="view-head">
      <div>
        <p className="b-eyebrow">{p.eyebrow}</p>
        <h2 className="b-h">{p.title}</h2>
        {p.lede ? <p className="b-lede">{p.lede}</p> : null}
      </div>
      {p.action ? <div className="b-head-action">{p.action}</div> : null}
    </div>
  );
}

/** Un blocco della vista con il suo titolo e, accanto, un conteggio o il suggerimento del gesto che segue. */
export function Block(p: { title?: string; hint?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="b-block" data-b="block">
      {p.title ? (
        <h3 className="b-sh">
          {p.title}
          {p.hint ? <small>{p.hint}</small> : null}
        </h3>
      ) : null}
      {p.children}
    </div>
  );
}
