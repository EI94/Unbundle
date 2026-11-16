"use client";

/**
 * «Mappatura board»: la board di un'unità, S2 (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3–§1.5, §4.10; P1–P10,
 * P70–P79, P83–P85).
 *
 * La testata del riferimento, ferma sotto la barra del workspace: la riga del marchio con la pillola dello stato,
 * «Salva ora» quando c'è da salvare e il bottone «Assistente»; il titolo in serif «{Unità} *board*»; le schede «01
 * Processi di oggi», «02 Classificazione». Una scheda sostituisce la vista e porta la pagina in cima; è ricordata per
 * unità sul dispositivo, e l'ancora dell'indirizzo (`#oggi`, `#classificazione`) vince (P4, P5): chi la cambia (il
 * toast «Apri» dopo il completamento) è seguito.
 *
 * Il pannello dell'assistente (lo slot `assistant` del compagno) sta a destra della board: agganciato, in una colonna
 * di 380 px, da 1280 px di finestra (la board si stringe e la mappa scorre nel suo riquadro); più stretto, sopra la
 * pagina velata come il drawer stretto (540 px, tutta la larghezza sul telefono), con la pagina dietro inerte, Escape e
 * il velo che lo chiudono. Aperto o chiuso è ricordato sul dispositivo; si apre da solo con `?mode=chat` e finché
 * l'unità non ha un passo (`assistantDefaultOpen`). Chiuso resta montato: la conversazione continua e quello che
 * l'assistente salva arriva sulla board.
 *
 * Sul telefono la riga del marchio, la pillola e il titolo scorrono con la pagina; resta ferma la sola riga delle
 * schede, con la pillola a punto e il bottone dell'assistente a destra (P79 adattato: board.css).
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type JSX } from "react";
import { BOARD_TABS, BOARD_TEXT, type BoardTab } from "../../../lib/mappatura/text.ts";
import type { UnitBoardProps } from "../contracts.ts";
import { useBoard, useBoardClient } from "../store/use-board.tsx";
import { BoardToastView } from "../ui/edit.tsx";
import { BoardBrand, BoardHeader, BoardMain, BoardTabs, BoardTitle, StatusPill, boardPanelId, boardTabId } from "../ui/frame.tsx";
import { boardPrefs, subscribeWide, wideNow, wideOnServer } from "./prefs.ts";
import { VIEW_TEXT } from "./text.ts";
import { TodayView } from "./today-view.tsx";

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

/** Il primo dei bottoni che si vede (quello della testata, o quello della riga delle schede sul telefono). */
function visibleOf(...elements: Array<HTMLElement | null>): HTMLElement | null {
  return elements.find((element) => element && element.offsetParent !== null) ?? null;
}

export function UnitBoard(p: UnitBoardProps & { initialTab?: BoardTab }): JSX.Element {
  const board = useBoard((state) => state.board);
  const pill = useBoard((state) => state.pill);
  const savedAt = useBoard((state) => state.savedAt);
  const client = useBoardClient();
  const departmentId = board.unit.id;
  const fallbackTab = p.initialTab ?? BOARD_TABS[0];

  // La scheda: l'ancora, poi quella ricordata per l'unità; sul server e al primo disegno, la prima.
  const prefs = boardPrefs();
  const tab = useSyncExternalStore(prefs.subscribe, () => prefs.tab(departmentId, fallbackTab), () => fallbackTab);
  const select = (next: BoardTab) => {
    prefs.selectTab(departmentId, next);
    window.scrollTo({ top: 0 });
  };
  // Chi cambia l'ancora (il toast «Apri» dopo il completamento) porta la pagina in cima, come una scheda scelta (P4).
  useEffect(() => {
    const top = () => window.scrollTo({ top: 0 });
    window.addEventListener("hashchange", top);
    return () => window.removeEventListener("hashchange", top);
  }, []);

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

  const assistantButtons = { "aria-expanded": open, "aria-controls": panelId };
  const brand = <BoardBrand workspaceName={p.workspaceName} areaHref={`/dashboard/${p.workspaceId}/mapping`} />;
  const tabs = BOARD_TABS.map((id) => ({ id, label: BOARD_TEXT.tabs[id] }));

  return (
    <>
      <div className="b-board" data-assistant={open ? "open" : "closed"} data-b="board">
        <div className="b-board-col" inert={overlay || undefined}>
          <BoardHeader
            brand={brand}
            title={<BoardTitle plain={board.unit.name} accent={BOARD_TEXT.boardTitleAccent} />}
            aside={
              <>
                <StatusPill state={pill} savedAt={savedAt} onSaveNow={() => void client.saveNow()} />
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
                    <button ref={tabToggle} type="button" className="b-iconbtn" aria-label={VIEW_TEXT.header.assistant} title={VIEW_TEXT.header.assistant} {...assistantButtons} onClick={toggle}>
                      <AssistantIcon />
                    </button>
                  </>
                }
              />
            }
          />
          <BoardMain>
            {BOARD_TABS.map((id) => (
              // Il pannello prende il fuoco (senza entrare nel giro del Tab) quando la persona lascia un campo con Escape.
              <section key={id} className={cx("b-view", tab === id && "b-on")} role="tabpanel" id={boardPanelId(id)} aria-labelledby={boardTabId(id)} hidden={tab !== id} tabIndex={-1} data-b={`view-${id}`}>
                {tab !== id ? null : id === "oggi" ? <TodayView headAction={p.headAction} onStartAssistant={() => setOpen(true, "field")} /> : p.classification}
              </section>
            ))}
          </BoardMain>
        </div>
        <aside
          ref={panel}
          id={panelId}
          className="b-assist"
          hidden={!open}
          role={overlay ? "dialog" : "complementary"}
          aria-modal={overlay || undefined}
          aria-labelledby={titleId}
          onKeyDown={(event) => {
            if (event.key === "Escape" && overlay && !event.defaultPrevented) {
              event.stopPropagation();
              close();
            }
          }}
          data-b="assistant"
        >
          <div className="b-assist-head">
            <h2 className="b-assist-t" id={titleId}>
              {VIEW_TEXT.header.assistant}
            </h2>
            <button type="button" className="b-btn b-x" onClick={close} data-b="assistant-close">
              {BOARD_TEXT.buttons.close}
            </button>
          </div>
          <div className="b-assist-body">{p.assistant}</div>
        </aside>
      </div>
      <div className={cx("b-scrim", "b-assist-scrim", overlay && "b-on")} aria-hidden="true" onClick={close} data-b="assistant-scrim" />
      <BoardToastView />
    </>
  );
}
