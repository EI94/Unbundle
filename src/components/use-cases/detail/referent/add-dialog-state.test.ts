import test from "node:test";
import assert from "node:assert/strict";
import { REFERENT_LIMITS } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_ERROR_MESSAGES } from "../../../../lib/use-cases/referent/labels.ts";
import { addPayload, addRoom, addSelectionError, addableNeedIds, initialAddSelection } from "./add-dialog-state.ts";

// «Aggiungi domande» a una richiesta viva (SPEC §5.2, §9.3).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const panel = { askableNeedIds: [id(1), id(2), id(3), id(4)], limits: REFERENT_LIMITS };

test("si aggiungono le domande aperte della scheda che la richiesta non ha, nell'ordine della scheda", () => {
  assert.deepEqual(addableNeedIds(panel, { needIds: [id(2).toUpperCase(), id(9)] }), [id(1), id(3), id(4)]);
  assert.deepEqual(addableNeedIds(panel, { needIds: panel.askableNeedIds }), []);
});

test("al massimo 20 domande per richiesta: la scelta di partenza riempie solo lo spazio che resta", () => {
  const nineteen = Array.from({ length: 19 }, (_, i) => id(100 + i));
  assert.equal(addRoom(panel, { needIds: nineteen }), 1);
  assert.deepEqual(initialAddSelection(panel, { needIds: nineteen }), [id(1)]);
  const twenty = Array.from({ length: 20 }, (_, i) => id(100 + i));
  assert.equal(addRoom(panel, { needIds: twenty }), 0);
  assert.deepEqual(initialAddSelection(panel, { needIds: twenty }), []);
  assert.deepEqual(initialAddSelection(panel, { needIds: [] }), panel.askableNeedIds);
});

test("controlli: almeno una domanda, mai oltre lo spazio; il contenuto nell'ordine della scheda", () => {
  assert.equal(addSelectionError([], 3), REFERENT_ERROR_MESSAGES.nessuna_domanda);
  assert.equal(addSelectionError([id(1), id(3)], 1), REFERENT_ERROR_MESSAGES.troppe_domande);
  assert.equal(addSelectionError([id(1)], 1), null);
  assert.deepEqual(addPayload(panel, [id(4), id(1).toUpperCase()]), { needIds: [id(1), id(4)] });
});
