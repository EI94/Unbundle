import test from "node:test";
import assert from "node:assert/strict";
import { referentFilterOptions } from "./filter.ts";
import type { ReferentStateKey } from "./use-case-state.ts";

// Il filtro «Referente» (rilascio 5, §11.2, D26): per stato, mai per persona; i numeri solo ai revisori.

const items = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
const STATES: Record<string, ReferentStateKey | null> = { a: "manca", b: "manca", c: "in_attesa", d: null, e: "fatto" };
const of = (id: string) => STATES[id] ?? null;

test("revisori: gli stati presenti nell'ordine della vita di una richiesta, con il numero per stato", () => {
  const menu = referentFilterOptions(items, of, null, true);
  assert.deepEqual(menu.options.map((o) => [o.value, o.label]), [
    ["manca", "Manca il referente · 2"],
    ["in-attesa", "In attesa del referente · 1"],
    ["ha-risposto", "Il referente ha risposto · 1"],
  ]);
  assert.equal(menu.shown, true);
  assert.equal(menu.selected, null);
  // Quello scelto resta, anche con zero.
  const chosen = referentFilterOptions(items, of, "nessuna_risposta", true);
  assert.deepEqual(chosen.options.map((o) => o.label), ["Manca il referente · 2", "In attesa del referente · 1", "Nessuna risposta · 0", "Il referente ha risposto · 1"]);
  assert.equal(chosen.selected, "nessuna-risposta");
  // Sempre visibile per i revisori, anche con uno stato solo.
  assert.equal(referentFilterOptions([{ id: "a" }], of, null, true).shown, true);
});

test("contributori: solo le parole; nascosto con un solo stato e nessuna scelta", () => {
  const menu = referentFilterOptions(items, of, null, false);
  assert.deepEqual(menu.options.map((o) => o.label), ["Manca il referente", "In attesa del referente", "Il referente ha risposto"]);
  for (const option of menu.options) assert.doesNotMatch(option.label, /\d/);
  assert.equal(referentFilterOptions([{ id: "a" }, { id: "b" }], of, null, false).shown, false, "un solo stato: niente da filtrare");
  assert.equal(referentFilterOptions([{ id: "a" }], of, "manca", false).shown, true, "una scelta nell'indirizzo si può sempre togliere");
});
