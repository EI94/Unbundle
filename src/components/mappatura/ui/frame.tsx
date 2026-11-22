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
import { BOARD_TEXT, pillShortText, pillText } from "../../../lib/mappatura/text.ts";
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
 * (Rilascio 10, §3.7) La prima riga della testata di un'unità: il segno della board e il percorso «Contesto › Processi
 * › {Unità}», nella forma del marchio (l'etichetta in mono). Le prime due voci sono link; l'ultima è la pagina, con
 * `aria-current`. Il nome del workspace sta già nella barra laterale. `processes={false}`: una pagina di «Contesto» che
 * non sta nei Processi (l'Intervista iniziale, «Contesto › Intervista iniziale»).
 */
export function BoardPath(p: { workspaceId: string; unitName: string; processes?: boolean }): JSX.Element {
  const base = `/dashboard/${p.workspaceId}/contesto`;
  return (
    <nav className="b-brand b-path" aria-label={BOARD_TEXT.path.label} data-b="path">
      <BrandMark />
      <Link href={base}>{BOARD_TEXT.path.context}</Link>
      {p.processes === false ? null : (
        <>
          <span className="b-x" aria-hidden="true">
            {BOARD_TEXT.path.separator}
          </span>
          <Link href={`${base}?vista=processi`}>{BOARD_TEXT.path.processes}</Link>
        </>
      )}
      {p.unitName ? (
        <>
          <span className="b-x" aria-hidden="true">
            {BOARD_TEXT.path.separator}
          </span>
          <span className="b-path-here" aria-current="page">
            {p.unitName}
          </span>
        </>
      ) : null}
    </nav>
  );
}

/** Il testo di un titolo con la sua parte in corsivo, nel colore dell'accento (P7): «Activity *mapping*». */
export function BoardTitle(p: { plain: string; accent: string; accentFirst?: boolean }): JSX.Element {
  // (Rilascio 10, §3.7) Una parte può mancare (il titolo della board è solo il nome dell'unità): niente corsivo vuoto né spazio in più.
  if (!p.accent || !p.plain) return <span data-b="title">{p.accent ? <i>{p.accent}</i> : p.plain}</span>;
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
 * Le schede (P3, P6): un `tablist`, la scheda scelta con il testo in inchiostro e la riga dell'accento, nessun
 * conteggio e (rilascio 10, §3.7) nessun numero d'ordine: con due schede non serve. Le frecce scelgono e mettono il fuoco sulla vicina, con il giro; solo la scheda
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
        {p.tabs.map((tab) => {
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
 * altrimenti) e la scritta. È una regione viva educata (P85). `compact`: la riga delle schede sul telefono, con la parola
 * corta («Salvato», «Da salvare»): (rilascio 10, §3.7) lo stato non è mai solo un colore.
 * «Salva ora» (rilascio 10, §3.7) compare solo quando serve: un salvataggio non riuscito (`failed`) o fuori linea; il
 * salvataggio parte da solo. Sparisce appena il salvataggio parte: prima porta il fuoco sulla pillola (che lo prende
 * senza entrare nel giro del Tab), che dice «Salvataggio…» e poi «Salvato» (F1).
 */
export function StatusPill(p: { state: PillState | "loading"; savedAt: string | null; compact?: boolean; failed?: boolean; onSaveNow?: () => void }): JSX.Element {
  const text = pillText(p.state, p.savedAt);
  const pill = useRef<HTMLSpanElement>(null);
  // (Rilascio 10, §3.7) Anche la pillola corta del telefono, che lì è la sola, porta «Salva ora» quando serve.
  const saves = Boolean(p.onSaveNow);
  const stuck = (p.failed === true && p.state === "dirty") || p.state === "local";
  return (
    <>
      <span ref={pill} className={cx("b-status", p.compact && "b-compact b-word")} data-s={p.state} role="status" aria-live="polite" tabIndex={saves ? -1 : undefined} data-b="pill">
        <span className="b-dot" aria-hidden="true" />
        {p.compact ? (
          <>
            <span aria-hidden="true">{pillShortText(p.state, p.savedAt)}</span>
            <span className="b-sr">{text}</span>
          </>
        ) : (
          <span>{text}</span>
        )}
      </span>
      {saves && stuck ? (
        <button
          type="button"
          className="b-btn b-small"
          data-b="save-now"
          onClick={(event) => {
            if (event.currentTarget.ownerDocument.activeElement === event.currentTarget) pill.current?.focus({ preventScroll: true });
            p.onSaveNow?.();
          }}
        >
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

/**
 * La testa di ogni vista (P7): l'occhiello in mono, il titolo in serif, la frase; a destra l'unico bottone pieno.
 * (Rilascio 10, §3.7) Occhiello e titolo solo quando dicono qualcosa che la scheda non dice già.
 */
export function ViewHead(p: { eyebrow?: string; title?: ReactNode; lede?: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <div className="b-head" data-b="view-head">
      <div>
        {p.eyebrow ? <p className="b-eyebrow">{p.eyebrow}</p> : null}
        {p.title ? <h2 className="b-h">{p.title}</h2> : null}
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
