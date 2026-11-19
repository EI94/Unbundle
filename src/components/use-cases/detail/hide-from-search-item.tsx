"use client";

import { useOptimistic } from "react";
import { setHiddenFromSearchAction } from "@/lib/actions/use-case-decisions";
import type { DecisionItem } from "@/lib/use-cases/decision-ui";
import { GUIDED_TEXT } from "@/lib/use-cases/guided";
import { useDecisionRunner } from "../decision-buttons";
import type { SchedaMenuItem } from "./scheda-menu";

export interface VisibilityToggleOptions {
  workspaceId: string;
  item: Pick<DecisionItem, "id" | "version" | "hiddenFromSearch">;
  /** `canSetHiddenFromSearch`: tutti i revisori. Senza, la voce non c'è. */
  canSet: boolean;
}

/**
 * (Rilascio 10, §3.4, §4) «Visibile in azienda», l'interruttore del gruppo «Scheda» del «⋯» della testata
 * (docs/use-case/DESIGN.md §6.1, §8.6): acceso quando la scheda è visibile. Cambia `intake.hiddenFromSearch` con la
 * `version` letta con la pagina (`setHiddenFromSearchAction`); l'interruttore cambia subito e torna com'era se la
 * scrittura non passa. Una scheda nascosta non la trovano la ricerca del connettore e i colleghi contributori; chi
 * l'ha proposta la vede comunque. null per chi non valuta: la voce non c'è, mai spenta.
 */
export function useVisibilityToggle({ workspaceId, item, canSet }: VisibilityToggleOptions): SchedaMenuItem | null {
  const { run } = useDecisionRunner();
  const [visible, setVisible] = useOptimistic(!item.hiddenFromSearch);
  if (!canSet) return null;
  return {
    kind: "interruttore",
    label: GUIDED_TEXT.scheda.visible,
    checked: visible,
    onCheckedChange: (next) => {
      if (next === visible) return;
      void run(
        item,
        (version) => setHiddenFromSearchAction(workspaceId, item.id, version, !next),
        () => setVisible(next),
      );
    },
  };
}
