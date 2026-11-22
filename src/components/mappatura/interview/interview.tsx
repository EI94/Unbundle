"use client";

/**
 * «Intervista iniziale» (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7; prima «Discovery», allo stesso indirizzo
 * `/setup/leadership`): la stessa chat dell'assistente della board, nella grafica della board.
 *
 * - La testata della board: il percorso «Contesto › Intervista iniziale» e il titolo in serif.
 * - La chat (`CompanionChat`): la conversazione di sempre (`leadership_setup`, session.ts), «Carica documenti» sopra,
 *   tre risposte pronte, il promemoria dopo 45 secondi, l'avviso dell'ok ai sub-responsabili al posto del campo quando
 *   manca. «Invia» è il solo pulsante pieno: rispondere è il prossimo passo.
 * - Il riepilogo (summary.tsx): una colonna accanto alla chat da 1280 px di finestra, come il pannello dell'assistente
 *   della board; più stretto, e al telefono, un foglio che si apre da «Riepilogo» nella testata, con il suo indirizzo
 *   (`?apri=riepilogo`): «Indietro» lo chiude.
 * - La pagina è alta quanto lo schermo (sotto la barra in alto del telefono): la conversazione scorre da sé e il campo
 *   resta in fondo (board-views.css, `.b-iv`).
 */
import { useId, useState, useSyncExternalStore, type JSX } from "react";
import { useSheetParam } from "../../ui-10/side-sheet.tsx";
import { subscribeWide, wideNow, wideOnServer } from "../board/prefs.ts";
import { CompanionChat } from "../companion/companion.tsx";
import { BoardButton } from "../ui/atoms.tsx";
import { Drawer } from "../ui/drawer.tsx";
import { BoardHeader, BoardPath, BoardTitle } from "../ui/frame.tsx";
import { InterviewDocuments } from "./documents.tsx";
import { createInterviewChat, type SavedMessage } from "./session.ts";
import { InterviewSummary, useInterviewSummary } from "./summary.tsx";
import { INTERVIEW_TEXT, INTERVIEW_TOOL_LABELS } from "./text.ts";

/** Il valore di `?apri=` del foglio del riepilogo. */
export const SUMMARY_SHEET = "riepilogo";
/** I valori di `?apri=` che questa pagina conosce: il foglio del riepilogo, nient'altro. */
export const acceptSummarySheet = (raw: string | null): typeof SUMMARY_SHEET | null => (raw === SUMMARY_SHEET ? SUMMARY_SHEET : null);

export function Interview(p: { workspaceId: string; initialMessages: readonly SavedMessage[]; initialSheet?: string | null }): JSX.Element {
  const [chat] = useState(() => createInterviewChat({ workspaceId: p.workspaceId, initialMessages: p.initialMessages }));
  const summary = useInterviewSummary(p.workspaceId);
  // Da 1280 px il riepilogo è la colonna accanto: il foglio non serve (sul server sì, il foglio decide il primo disegno).
  const wide = useSyncExternalStore(subscribeWide, wideNow, wideOnServer);
  const [sheet, setSheet] = useSheetParam({ initial: p.initialSheet ?? null, accept: acceptSummarySheet });
  const sheetOpen = sheet === SUMMARY_SHEET && !wide;
  const sideTitle = useId();
  const T = INTERVIEW_TEXT;
  return (
    <div className="b-board b-iv" data-b="interview">
      <div className="b-board-col">
        <BoardHeader
          brand={<BoardPath workspaceId={p.workspaceId} unitName={T.title} processes={false} />}
          title={<BoardTitle plain={T.title} accent="" />}
          aside={
            <BoardButton small className="b-iv-open" aria-haspopup="dialog" aria-expanded={sheetOpen} onClick={() => setSheet(SUMMARY_SHEET)} data-action="summary">
              {T.summary.open}
            </BoardButton>
          }
        />
        <div className="b-iv-chat" data-b="interview-chat">
          <CompanionChat
            workspaceId={p.workspaceId}
            chat={chat}
            suggestions={T.suggestions}
            nudge={T.nudge}
            labels={INTERVIEW_TOOL_LABELS}
            sendPrimary
            tools={
              <div className="b-comp-tools">
                <InterviewDocuments workspaceId={p.workspaceId} />
              </div>
            }
          />
        </div>
      </div>
      <aside className="b-iv-side" aria-labelledby={sideTitle} data-b="interview-side">
        <h2 className="b-iv-side-t" id={sideTitle}>
          {T.summary.title}
        </h2>
        <InterviewSummary state={summary} />
      </aside>
      <Drawer open={sheetOpen} onClose={() => setSheet(null)} context={T.title} title={T.summary.title}>
        <InterviewSummary state={summary} />
      </Drawer>
    </div>
  );
}
