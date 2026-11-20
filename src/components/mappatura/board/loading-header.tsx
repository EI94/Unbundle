"use client";

/**
 * «Mappatura board»: la testata della board che si apre (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.6).
 *
 * Il riferimento non ha scheletri: mentre carica tiene la testata intera e cambia solo la scritta della pillola. Qui la
 * stessa testata di `UnitBoard` (rilascio 10, §3.7): il percorso «Contesto › Processi › {Unità}», la pillola
 * «Caricamento» e il bottone dell'assistente, il titolo vero (il nome dell'unità), la riga delle schede con la scheda che
 * si aprirà; schede e bottoni ci sono ma non si usano ancora (`inert`). Il nome lo legge il server prima della board
 * (`mapping/[deptId]/layout.tsx`, con `BoardLoadingNames`): un nome lungo va a capo come andrà nella board, e la pagina
 * non salta quando arriva. Senza nome (un'unità che non si trova) il percorso si ferma ai Processi e il titolo è uno
 * spazio che tiene la sua riga.
 */
import { createContext, useContext, useSyncExternalStore, type JSX, type ReactNode } from "react";
import { BOARD_TABS, BOARD_TEXT, type BoardTab } from "../../../lib/mappatura/text.ts";
import { BoardHeader, BoardPath, BoardTabs, BoardTitle, StatusPill } from "../ui/frame.tsx";
import { BoardMenuPlaceholder } from "../ui/menu.tsx";
import { boardPrefs } from "./prefs.ts";
import { VIEW_TEXT } from "./text.ts";

const noop = () => {};

/** L'icona del bottone dell'assistente nella riga delle schede, sul telefono: la stessa di `UnitBoard`. */
function AssistantIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

/** I nomi della board che si apre: l'unità (null se non si trova) e il workspace. */
export interface BoardLoadingNamesValue {
  unitName: string | null;
  workspaceName: string;
}

const LoadingNames = createContext<BoardLoadingNamesValue | null>(null);

/** Il layout dell'unità li mette qui, letti sul server; `loading.tsx` li legge con `useBoardLoadingNames`. */
export function BoardLoadingNames(p: BoardLoadingNamesValue & { children: ReactNode }): JSX.Element {
  return <LoadingNames.Provider value={{ unitName: p.unitName, workspaceName: p.workspaceName }}>{p.children}</LoadingNames.Provider>;
}

export function useBoardLoadingNames(): BoardLoadingNamesValue | null {
  return useContext(LoadingNames);
}

export function BoardLoadingHeader(p: { workspaceId: string; departmentId: string; unitName?: string | null; workspaceName?: string }): JSX.Element {
  // La scheda che si aprirà: l'ancora; sul server e al primo disegno, la prima (come `UnitBoard`).
  const prefs = boardPrefs();
  const fallback: BoardTab = BOARD_TABS[0];
  const tab = useSyncExternalStore(prefs.subscribe, () => prefs.tab(p.departmentId, fallback), () => fallback);
  const tabs = BOARD_TABS.map((id) => ({ id, label: BOARD_TEXT.tabs[id] }));
  return (
    <BoardHeader
      brand={<BoardPath workspaceId={p.workspaceId} unitName={p.unitName ?? ""} />}
      title={p.unitName ? <BoardTitle plain={p.unitName} accent={BOARD_TEXT.boardTitleAccent} /> : " "}
      aside={
        <>
          <span className="b-hide-phone b-top-pill">
            <StatusPill state="loading" savedAt={null} />
          </span>
          <BoardMenuPlaceholder label={BOARD_TEXT.menu} hidePhone />
          <button type="button" className="b-btn b-hide-phone b-assist-toggle" inert data-b="assistant-toggle">
            {VIEW_TEXT.header.assistant}
          </button>
        </>
      }
      tabs={
        <BoardTabs
          label={BOARD_TEXT.tabsLabel}
          tabs={tabs}
          selected={tab}
          onSelect={noop}
          inert
          aside={
            <>
              <span className="b-tabs-pill">
                <StatusPill state="loading" savedAt={null} compact />
              </span>
              <BoardMenuPlaceholder label={BOARD_TEXT.menu} />
              <button type="button" className="b-iconbtn" aria-label={VIEW_TEXT.header.assistant} title={VIEW_TEXT.header.assistant}>
                <AssistantIcon />
              </button>
            </>
          }
        />
      }
    />
  );
}
