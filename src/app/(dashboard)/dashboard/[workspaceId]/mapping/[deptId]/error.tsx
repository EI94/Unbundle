"use client";

import { useEffect } from "react";
import { BoardButton } from "@/components/mappatura/ui/atoms";
import { EmptyBlock } from "@/components/mappatura/ui/edit";
import { BoardMain } from "@/components/mappatura/ui/frame";
import { BOARD_TEXT } from "@/lib/mappatura/text";
import { digestOf } from "@/lib/uc/log";

/**
 * La board non si è aperta (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.6): «La board non si apre.» e «Riprova». Sta
 * dentro la radice della board (il layout della mappatura). Si registra solo il codice dell'errore (`digest`), mai il
 * messaggio. Next passa il valore lanciato così com'è: da un Client Component può non essere un `Error`, anche `null`.
 */
export default function UnitBoardError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = digestOf(error);
  useEffect(() => {
    console.error("[mappatura/board] pagina non aperta", digest ?? "senza codice");
  }, [digest]);
  return (
    <BoardMain>
      <div role="alert">
        <EmptyBlock title={BOARD_TEXT.errorPage.title} text={BOARD_TEXT.errorPage.text}>
          <BoardButton onClick={() => retry()}>{BOARD_TEXT.errorPage.retry}</BoardButton>
        </EmptyBlock>
      </div>
    </BoardMain>
  );
}
