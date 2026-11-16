"use client";

/**
 * «Mappatura board»: «Completa la mappatura» e «Classifica {n} passi» (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3,
 * §1.4, §4.10, §7.3).
 *
 * L'unico bottone pieno della schermata, a destra della testa della vista: «Completa la mappatura» finché l'unità non è
 * completa e ha un passo; dopo, «Classifica {n} passi» se dei passi sono senza stream; altrimenti niente. Manda
 * `POST …/complete`, prende la board che torna e dice com'è andata con il toast della board (completion.ts). Mentre
 * lavora dice «Classificazione in corso…», in tutte e due le schede. Su una board in sola lettura è spento dal primo
 * disegno.
 */
import { useSyncExternalStore, type JSX } from "react";
import type { CompleteButtonProps } from "../contracts.ts";
import { useBoard, useBoardClient } from "../store/use-board.tsx";
import { BoardButton } from "../ui/atoms.tsx";
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
      disabled={working || !canComplete}
      aria-busy={working || undefined}
      onClick={() =>
        void runCompletion({ workspaceId: p.workspaceId, departmentId: p.departmentId, client, fetch: (input, init) => fetch(input, init), openClassification: () => openClassificationTab() })
      }
      data-action="complete"
    >
      {completionLabel(mode, working)}
    </BoardButton>
  );
}
