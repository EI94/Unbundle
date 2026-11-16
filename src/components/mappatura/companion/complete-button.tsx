"use client";

/**
 * «Mappatura board»: «Completa la mappatura» e «Classifica {n} passi» (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3,
 * §1.4, §4.10, §7.3).
 *
 * L'unico bottone pieno della schermata, a destra della testa della vista: «Completa la mappatura» finché l'unità non è
 * completa e ha un passo; dopo, «Classifica {n} passi» se dei passi sono senza stream; altrimenti niente. Manda
 * `POST …/complete`, prende la board che torna e dice com'è andata con il toast della board (completion.ts). Mentre
 * lavora dice «Classificazione in corso…», in tutte e due le schede, e resta raggiungibile (`aria-disabled`). Su una board
 * in sola lettura è spento dal primo disegno.
 */
import { useSyncExternalStore, type JSX } from "react";
import type { CompleteButtonProps } from "../contracts.ts";
import { useBoard, useBoardClient } from "../store/use-board.tsx";
import { BoardButton } from "../ui/atoms.tsx";
import { focusKeeper } from "../ui/focus.ts";
import { completionLabel, completionMode, completionStore, openClassificationTab, runCompletion } from "./completion.ts";

export function CompleteButton(p: CompleteButtonProps): JSX.Element | null {
  const client = useBoardClient();
  const mode = useBoard((state) => completionMode(state.board));
  const canComplete = useBoard((state) => state.board.can.complete);
  const store = completionStore(client);
  const working = useSyncExternalStore(store.subscribe, store.working, store.working);
  if (!mode) return null;
  return (
    <BoardButton
      variant="primary"
      // Mentre lavora resta raggiungibile (aria-disabled): spento, il fuoco cadrebbe sulla pagina (F1). Un secondo clic
      // non parte (runCompletion). Alla fine il bottone può non esserci più: il fuoco torna alla vista.
      disabled={!canComplete}
      aria-disabled={working || undefined}
      aria-busy={working || undefined}
      onClick={(event) => {
        if (working) return;
        const keep = focusKeeper(event.currentTarget);
        void runCompletion({ workspaceId: p.workspaceId, departmentId: p.departmentId, client, fetch: (input, init) => fetch(input, init), openClassification: () => openClassificationTab() }).then(keep);
      }}
      data-action="complete"
    >
      {completionLabel(mode, working)}
    </BoardButton>
  );
}
