"use client";

import type { ActionMenuItem } from "@/components/uc/ui/action-menu";
import { setHiddenFromSearchAction } from "@/lib/actions/use-case-decisions";
import type { DecisionItem } from "@/lib/use-cases/decision-ui";
import { useDecisionRunner } from "../decision-buttons";

/** Le due voci del menu «⋯» della testata (§6.1, §8.6, §14.3). */
export const HIDE_FROM_SEARCH_TEXT = Object.freeze({
  hide: "Nascondi dalla ricerca",
  show: "Mostra ai colleghi",
});

/** La voce da mostrare: una scheda nascosta si mostra ai colleghi, una visibile si nasconde. */
export function hideFromSearchLabel(hiddenFromSearch: boolean): string {
  return hiddenFromSearch ? HIDE_FROM_SEARCH_TEXT.show : HIDE_FROM_SEARCH_TEXT.hide;
}

export interface HideFromSearchItemOptions {
  workspaceId: string;
  item: Pick<DecisionItem, "id" | "version" | "hiddenFromSearch">;
  /** `canSetHiddenFromSearch`: tutti i revisori. Senza, la voce non c'è. */
  canSet: boolean;
}

/**
 * «Nascondi dalla ricerca» oppure «Mostra ai colleghi» (docs/use-case/DESIGN.md §6.1, §8.6), come
 * voce del menu «⋯» della testata: cambia `intake.hiddenFromSearch` con la `version` letta con la
 * pagina (`setHiddenFromSearchAction`). Una scheda nascosta non la trovano la ricerca del
 * connettore e i colleghi contributori; chi l'ha proposta la vede comunque. null per chi non
 * valuta: la voce non c'è, mai spenta.
 */
export function useHideFromSearchItem({ workspaceId, item, canSet }: HideFromSearchItemOptions): ActionMenuItem | null {
  const { run } = useDecisionRunner();
  if (!canSet) return null;
  const hidden = !item.hiddenFromSearch;
  return {
    label: hideFromSearchLabel(item.hiddenFromSearch),
    onSelect: () => {
      void run(item, (version) => setHiddenFromSearchAction(workspaceId, item.id, version, hidden));
    },
  };
}
