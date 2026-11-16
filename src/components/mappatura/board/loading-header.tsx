"use client";

/**
 * «Mappatura board»: la testata della board che si apre (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.6).
 *
 * Il riferimento non ha scheletri: mentre carica tiene la testata intera (marchio, titolo, schede) e cambia solo la
 * scritta della pillola. Qui la stessa forma della testata di `UnitBoard`: la riga del marchio con la pillola
 * «Caricamento» e il bottone dell'assistente, il titolo (uno spazio che tiene la sua riga), la riga delle schede con la
 * scheda che si aprirà; schede e bottoni ci sono ma non si usano ancora (`inert`). Così la pagina non salta quando
 * arriva la board. Il nome del workspace non si sa ancora: la riga del marchio lo salta, e resta alta uguale.
 */
import { useSyncExternalStore, type JSX } from "react";
import { BOARD_TABS, BOARD_TEXT, type BoardTab } from "../../../lib/mappatura/text.ts";
import { BoardBrand, BoardHeader, BoardTabs, StatusPill } from "../ui/frame.tsx";
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

export function BoardLoadingHeader(p: { workspaceId: string; departmentId: string }): JSX.Element {
  // La scheda che si aprirà: l'ancora, poi quella ricordata; sul server e al primo disegno, la prima (come `UnitBoard`).
  const prefs = boardPrefs();
  const fallback: BoardTab = BOARD_TABS[0];
  const tab = useSyncExternalStore(prefs.subscribe, () => prefs.tab(p.departmentId, fallback), () => fallback);
  const tabs = BOARD_TABS.map((id) => ({ id, label: BOARD_TEXT.tabs[id] }));
  return (
    <BoardHeader
      brand={<BoardBrand workspaceName="" areaHref={`/dashboard/${p.workspaceId}/mapping`} />}
      title={" "}
      aside={
        <>
          <StatusPill state="loading" savedAt={null} />
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
              <span className="b-tabs-pill" aria-hidden="true">
                <StatusPill state="loading" savedAt={null} compact />
              </span>
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
