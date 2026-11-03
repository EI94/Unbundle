/**
 * (Rilascio 5, SPEC §11.2, D26) Le voci del filtro «Referente» della pagina «Use case». Modulo puro.
 */
import { formatInteger } from "../format.ts";
import { REFERENT_STATES, REFERENT_STATE_PARAM, REFERENT_STATE_TEXT, type ReferentStateKey } from "./use-case-state.ts";

/** Le voci di «Referente»: il valore dell'indirizzo, la voce del menu (con « · n» ai revisori) e la parola. */
export interface ReferentFilterMenu {
  options: Array<{ value: string; label: string; word: string }>;
  /** Il controllo c'è (ai contributori solo con più di uno stato, o uno scelto). */
  shown: boolean;
  /** Il valore scelto nell'indirizzo, o null. */
  selected: string | null;
}

/**
 * (Rilascio 5, §11.2, D26) Le voci del filtro «Referente»: «Tutti», poi gli stati che gli use case
 * mostrati hanno (con gli altri filtri) e quello scelto, nell'ordine della vita di una richiesta. Ai
 * revisori « · {n}» per stato (mai per persona); ai contributori solo le parole, e il filtro non c'è
 * quando i loro use case hanno un solo stato e nessuno è scelto (un controllo che non farebbe niente).
 */
export function referentFilterOptions(
  items: ReadonlyArray<{ id: string }>,
  referentOf: (id: string) => ReferentStateKey | null,
  selected: ReferentStateKey | null,
  withCounts: boolean,
): ReferentFilterMenu {
  const counts = new Map<ReferentStateKey, number>();
  for (const item of items) {
    const state = referentOf(item.id);
    if (state) counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const options = REFERENT_STATES.filter((state) => counts.has(state) || state === selected).map((state) => ({
    value: REFERENT_STATE_PARAM[state],
    label: withCounts ? `${REFERENT_STATE_TEXT[state]} · ${formatInteger(counts.get(state) ?? 0)}` : REFERENT_STATE_TEXT[state],
    word: REFERENT_STATE_TEXT[state],
  }));
  const shown = withCounts || options.length > 1 || selected !== null;
  return { options, shown, selected: selected ? REFERENT_STATE_PARAM[selected] : null };
}

