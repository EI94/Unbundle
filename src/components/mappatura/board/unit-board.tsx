"use client";

/**
 * «Mappatura board»: la board di un'unità, S2 (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3–§1.5; P1–P10,
 * P70–P79, P83–P85; rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7: la grafica resta, cambia il comportamento).
 *
 * La testata in tre righe: il percorso «Contesto › Processi › {Unità}» con a destra la pillola dello stato, il «⋯»
 * («Copia la mappa come testo», «Usa le categorie proposte») e «Assistente»; il titolo in serif, il nome dell'unità; le
 * schede «Oggi» e «Con l'AI», senza numeri. Su desktop, scorrendo, resta ferma la sola riga delle schede (la testata
 * sale fino a lei: `--b-sticky-offset`). «Salva ora» compare solo se il salvataggio non riesce o fuori linea. Una scheda
 * sostituisce la vista e porta la pagina in cima; vale l'ancora dell'indirizzo (`#oggi`, `#classificazione`), mai una
 * scheda ricordata sul dispositivo. Il passo aperto ha il suo indirizzo, `?apri=<passo>`: un link lo riapre.
 *
 * Il pannello dell'assistente (lo slot `assistant` del compagno) sta a destra della board: agganciato, in una colonna
 * di 380 px, da 1280 px di finestra (la board si stringe e la mappa scorre nel suo riquadro); più stretto, sopra la
 * pagina velata come il drawer stretto (540 px, tutta la larghezza sul telefono), con la pagina dietro inerte, Escape e
 * il velo che lo chiudono. Aperto o chiuso è ricordato sul dispositivo; si apre da solo con `?mode=chat` e finché
 * l'unità non ha un passo (`assistantDefaultOpen`). Chiuso resta montato: la conversazione continua e quello che
 * l'assistente salva arriva sulla board.
 *
 * Sul telefono il percorso, la pillola e il titolo scorrono con la pagina; resta ferma la sola riga delle schede, con
 * la pillola (punto e parola) e il bottone dell'assistente a destra (board.css, board-views.css).
 */
import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type JSX } from "react";
import { boardAsText, streamNumbers } from "../../../lib/mappatura/board-model.ts";
import { BOARD_TABS, BOARD_TEXT, type BoardTab } from "../../../lib/mappatura/text.ts";
import type { UnitBoardProps } from "../contracts.ts";
import { useBoard, useBoardClient, useClaimToastHost } from "../store/use-board.tsx";
import { BoardToastView, PanelToastHost } from "../ui/edit.tsx";
import { BoardHeader, BoardMain, BoardPath, BoardTabs, BoardTitle, StatusPill, boardPanelId, boardTabId } from "../ui/frame.tsx";
import { BoardMenu, type BoardMenuItem } from "../ui/menu.tsx";
import { resetStreams } from "../classification/classification-view.tsx";
import { CLASSIFICATION_TEXT } from "../classification/text.ts";
import { closesOnEscape, inertOthers, wrapFocus, type InertNode } from "./modal-panel.ts";
import { boardPrefs, subscribeWide, wideNow, wideOnServer } from "./prefs.ts";
import { VIEW_TEXT } from "./text.ts";
import { CopyDrawer, TodayView } from "./today-view.tsx";
import { ArrivalStep } from "./arrival.tsx";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

/** L'icona del bottone dell'assistente nella riga delle schede, sul telefono. */
function AssistantIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

/** Il campo dell'assistente: il compagno lo segna con `data-b="companion-input"`. */
export const ASSISTANT_FIELD_SELECTOR = '.b-assist-body [data-b="companion-input"]:not([disabled])';

/**
 * Dove va il cursore quando il pannello si apre: il campo dell'assistente; se non c'è (o aspetta la risposta), il primo
 * campo che si vede nel pannello, poi il suo primo bottone. Un `input` nascosto (la scelta dei file di «Carica
 * documenti», che sta prima del campo) non prende il fuoco e non conta.
 */
export function focusTarget(panel: Pick<ParentNode, "querySelector"> | null): HTMLElement | null {
  if (!panel) return null;
  return (
    panel.querySelector<HTMLElement>(ASSISTANT_FIELD_SELECTOR) ??
    panel.querySelector<HTMLElement>(".b-assist-body textarea:not([disabled]):not([hidden]), .b-assist-body input:not([type='hidden']):not([type='file']):not([hidden]):not([disabled])") ??
    panel.querySelector<HTMLElement>(".b-assist-body button:not([disabled])") ??
    panel.querySelector<HTMLElement>("button")
  );
}

/** Il fuoco non è da nessuna parte: sulla pagina, o dentro una parte nascosta (la vista che si è appena chiusa). */
export function focusIsLost(doc: Pick<Document, "activeElement" | "body">): boolean {
  const active = doc.activeElement;
  return !active || active === doc.body || active.closest("[hidden]") !== null;
}

/** Il primo dei bottoni che si vede (quello della testata, o quello della riga delle schede sul telefono). */
function visibleOf(...elements: Array<HTMLElement | null>): HTMLElement | null {
  return elements.find((element) => element && element.offsetParent !== null) ?? null;
}

export function UnitBoard(p: UnitBoardProps & { initialTab?: BoardTab }): JSX.Element {
  const board = useBoard((state) => state.board);
  const pill = useBoard((state) => state.pill);
  const savedAt = useBoard((state) => state.savedAt);
  const failed = useBoard((state) => state.failed);
  const client = useBoardClient();
  const departmentId = board.unit.id;
  const fallbackTab = p.initialTab ?? BOARD_TABS[0];

  // La scheda: l'ancora; sul server e al primo disegno, la prima.
  const prefs = boardPrefs();
  const tab = useSyncExternalStore(prefs.subscribe, () => prefs.tab(departmentId, fallbackTab), () => fallbackTab);
  // Il passo dell'indirizzo, all'arrivo: vale per la scheda di adesso, finché non se ne sceglie un'altra.
  const [arrival, setArrival] = useState<string | null>(p.initialStep ?? null);
  const select = (next: BoardTab) => {
    if (next !== tab) setArrival(null);
    prefs.selectTab(departmentId, next);
    window.scrollTo({ top: 0 });
  };

  // «Copia la mappa come testo» (nel «⋯»): negli appunti, o nel drawer da copiare a mano (P62).
  const [copyText, setCopyText] = useState<string | null>(null);
  const copyMap = () => {
    const text = boardAsText(board);
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard?.writeText) {
      setCopyText(text);
      return;
    }
    clipboard.writeText(text).then(
      () => client.notify(BOARD_TEXT.toast.copied),
      () => setCopyText(text),
    );
  };
  const complete = board.unit.status === "mapped" || board.unit.status === "validated";
  const canReset = complete && board.can.setStream && streamNumbers(board).differsFromProposal > 0;
  const menu: BoardMenuItem[] = [
    { key: "copia", label: VIEW_TEXT.map.copy, onSelect: copyMap },
    ...(canReset
      ? [
          {
            key: "categorie",
            label: CLASSIFICATION_TEXT.reset,
            onSelect: () => resetStreams(client),
          },
        ]
      : []),
  ];

  // Su desktop resta ferma la sola riga delle schede: la testata sale di quanto è alto quello che sta sopra le schede.
  const column = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const header = column.current?.querySelector<HTMLElement>('[data-b="header"]');
    const tabbar = header?.querySelector<HTMLElement>('[data-b="tabs"]');
    if (!header || !tabbar) return;
    const measure = () => header.style.setProperty("--b-sticky-offset", `${Math.max(0, Math.round(tabbar.offsetTop))}px`);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  // Chi cambia l'ancora (il toast «Apri» dopo il completamento) porta la pagina in cima, come una scheda scelta (P4).
  useEffect(() => {
    const top = () => {
      window.scrollTo({ top: 0 });
      setArrival(null);
    };
    window.addEventListener("hashchange", top);
    return () => window.removeEventListener("hashchange", top);
  }, []);
  // La vista cambia mentre il fuoco non è da nessuna parte (il toast «Apri», sparito con il suo bottone; o stava nella
  // vista che si nasconde): il fuoco va nella vista nuova, non sulla pagina (F1). Non alla prima apertura.
  const shownTab = useRef(tab);
  useEffect(() => {
    if (shownTab.current === tab) return;
    shownTab.current = tab;
    if (focusIsLost(document)) document.getElementById(boardPanelId(tab))?.focus({ preventScroll: true });
  }, [tab]);

  // Il pannello dell'assistente: la scelta di questa visita, poi il default della pagina, poi quella ricordata.
  const remembered = useSyncExternalStore(prefs.subscribe, () => prefs.assistant(), () => null);
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? (p.assistantDefaultOpen || remembered === true);
  const wide = useSyncExternalStore(subscribeWide, wideNow, wideOnServer);
  const overlay = open && !wide;

  const panelId = useId();
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const headToggle = useRef<HTMLButtonElement>(null);
  const tabToggle = useRef<HTMLButtonElement>(null);
  // Dopo l'apertura il cursore va nel campo dell'assistente; dopo la chiusura il fuoco torna al bottone che l'ha aperto.
  const pendingFocus = useRef<"field" | "toggle" | null>(null);
  useEffect(() => {
    const want = pendingFocus.current;
    pendingFocus.current = null;
    if (want === "field" && open) focusTarget(panel.current)?.focus();
    if (want === "toggle" && !open) visibleOf(headToggle.current, tabToggle.current)?.focus();
  }, [open]);

  const setOpen = (next: boolean, focus: "field" | "toggle" | null) => {
    setChoice(next);
    prefs.setAssistant(next);
    // Già nello stato chiesto (il pannello di un'unità vuota è aperto da sé): il fuoco va subito, nessun disegno da aspettare.
    if (next === open) {
      if (focus === "field") focusTarget(panel.current)?.focus();
      return;
    }
    pendingFocus.current = focus;
  };
  const toggle = () => setOpen(!open, open ? null : "field");
  const close = () => setOpen(false, "toggle");

  // Sopra la pagina il pannello è un dialogo modale (F2): il resto della pagina e dell'app è inerte (tranne il velo, che lo
  // chiude), il Tab gira dentro di lui (le guardie), Escape lo chiude dovunque sia il fuoco, il toast sta dentro di lui.
  const panelToastHost = useId();
  useClaimToastHost(panelToastHost, overlay);
  const closeOnEscape = useEffectEvent(() => close());
  useEffect(() => {
    const element = panel.current;
    if (!overlay || !element) return;
    const keep = (node: InertNode) => (node as unknown as Element).classList?.contains("b-assist-scrim") === true;
    const restore = inertOthers(element as unknown as InertNode, document.body as unknown as InertNode, keep);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!closesOnEscape(event, element)) return;
      event.preventDefault();
      closeOnEscape();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restore();
    };
  }, [overlay]);

  const assistantButtons = { "aria-expanded": open, "aria-controls": panelId };
  const brand = <BoardPath workspaceId={p.workspaceId} unitName={board.unit.name} />;
  const tabs = BOARD_TABS.map((id) => ({ id, label: BOARD_TEXT.tabs[id] }));

  return (
    <>
      <div className="b-board" data-assistant={open ? "open" : "closed"} data-b="board">
        <div className="b-board-col" ref={column} inert={overlay || undefined}>
          <BoardHeader
            brand={brand}
            title={<BoardTitle plain={board.unit.name} accent={BOARD_TEXT.boardTitleAccent} />}
            aside={
              <>
                <StatusPill state={pill} savedAt={savedAt} failed={failed} onSaveNow={() => void client.saveNow()} />
                <BoardMenu label={BOARD_TEXT.menu} items={menu} hidePhone />
                <button ref={headToggle} type="button" className="b-btn b-hide-phone b-assist-toggle" {...assistantButtons} onClick={toggle} data-b="assistant-toggle">
                  {VIEW_TEXT.header.assistant}
                </button>
              </>
            }
            tabs={
              <BoardTabs
                label={BOARD_TEXT.tabsLabel}
                tabs={tabs}
                selected={tab}
                onSelect={select}
                aside={
                  <>
                    <span className="b-tabs-pill" aria-hidden="true">
                      <StatusPill state={pill} savedAt={savedAt} compact />
                    </span>
                    <BoardMenu label={BOARD_TEXT.menu} items={menu} />
                    <button ref={tabToggle} type="button" className="b-iconbtn" aria-label={VIEW_TEXT.header.assistant} title={VIEW_TEXT.header.assistant} {...assistantButtons} onClick={toggle}>
                      <AssistantIcon />
                    </button>
                  </>
                }
              />
            }
          />
          <BoardMain>
            <ArrivalStep.Provider value={arrival}>
            {BOARD_TABS.map((id) => (
              // Il pannello prende il fuoco (senza entrare nel giro del Tab) quando la persona lascia un campo con Escape.
              <section key={id} className={cx("b-view", tab === id && "b-on")} role="tabpanel" id={boardPanelId(id)} aria-labelledby={boardTabId(id)} hidden={tab !== id} tabIndex={-1} data-b={`view-${id}`}>
                {tab !== id ? null : id === "oggi" ? <TodayView headAction={p.headAction} onStartAssistant={() => setOpen(true, "field")} /> : p.classification}
              </section>
            ))}
            </ArrivalStep.Provider>
          </BoardMain>
          {/* Il toast della pagina sta in fondo alla colonna della board: centrato sull'area della board, mai sopra il pannello
              agganciato dell'assistente. */}
          <BoardToastView />
        </div>
        <aside ref={panel} id={panelId} className="b-assist" hidden={!open} role={overlay ? "dialog" : "complementary"} aria-modal={overlay || undefined} aria-labelledby={titleId} data-b="assistant">
          {overlay ? <span tabIndex={0} data-focus-guard="" aria-hidden="true" onFocus={() => panel.current && wrapFocus(panel.current, "start")} /> : null}
          <div className="b-assist-head">
            <h2 className="b-assist-t" id={titleId}>
              {VIEW_TEXT.header.assistant}
            </h2>
            <button type="button" className="b-btn b-x" onClick={close} data-b="assistant-close">
              {BOARD_TEXT.buttons.close}
            </button>
          </div>
          {/* Sopra la pagina il toast sta nel pannello, sopra il campo dell'assistente (PanelToast): non lo copre mai. */}
          <div className="b-assist-body">
            <PanelToastHost value={overlay ? panelToastHost : null}>{p.assistant}</PanelToastHost>
          </div>
          {overlay ? <span tabIndex={0} data-focus-guard="" aria-hidden="true" onFocus={() => panel.current && wrapFocus(panel.current, "end")} /> : null}
        </aside>
      </div>
      <div className={cx("b-scrim", "b-assist-scrim", overlay && "b-on")} aria-hidden="true" onClick={close} data-b="assistant-scrim" />
      <CopyDrawer text={copyText} onClose={() => setCopyText(null)} />
    </>
  );
}
