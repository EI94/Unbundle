import test from "node:test";
import assert from "node:assert/strict";
import {
  WAITING_GROUP,
  emptySelection,
  groupNeedsRead,
  groupPicked,
  rowPicked,
  selectAll,
  selectionFor,
  selectionOf,
  toggleGroup,
  toggleRow,
  type SelectionPart,
  type SelectionState,
} from "./question-selection.ts";

// (Rilascio 10, §3.5) La selezione di Domande come stato puro: righe, argomenti interi, «In attesa» e «Seleziona tutte
// (N)». Le letture del server sono finte; id inventati.

const part = (ids: string[], status: "chiesta" | "bloccata" | "in_verifica" = "chiesta"): SelectionPart => ({ byStatus: { [status]: ids }, count: ids.length, truncated: false });
const VIEW = "?vista=da-fare";
const ids = (state: SelectionState) => Object.values(selectionOf(state).byStatus).flat().sort();

test("two topics ticked quickly stay ticked, whatever order their reads come back in", async () => {
  let state = emptySelection(VIEW);
  // Il comportamento del componente: ogni lettura, quando torna, si applica allo stato di quel momento.
  const apply = (fn: (s: SelectionState) => SelectionState) => (state = fn(selectionFor(state, VIEW)));
  const read = (value: SelectionPart, ms: number) => new Promise<SelectionPart>((done) => setTimeout(() => done(value), ms));
  const tick = async (key: string, value: SelectionPart, ms: number) => {
    assert.equal(groupNeedsRead(state, key, true), true);
    const got = await read(value, ms);
    apply((s) => toggleGroup(s, key, true, got));
  };
  await Promise.all([tick("m.volumi", part(["a1", "a2"]), 20), tick("m.sistemi", part(["b1"]), 1)]);
  assert.equal(groupPicked(state, "m.volumi"), true);
  assert.equal(groupPicked(state, "m.sistemi"), true);
  assert.deepEqual(ids(state), ["a1", "a2", "b1"]);
  assert.equal(selectionOf(state).count, 3);
  assert.equal(selectionOf(state).scope, "risultati");
  // Togliere un argomento non chiede niente al server.
  assert.equal(groupNeedsRead(state, "m.volumi", false), false);
  state = toggleGroup(state, "m.volumi", false, null);
  assert.deepEqual(ids(state), ["b1"]);
  // Una lettura fallita non cambia niente.
  assert.equal(toggleGroup(state, "m.eccezioni", true, null), state);
});

test("«Seleziona tutte (N)» covers the view, not «In attesa»: the waiting group is chosen on its own and stays with «tutte»", () => {
  let state = selectAll(emptySelection(VIEW), part(["a1", "a2", "b1"]));
  assert.equal(groupPicked(state, "m.volumi"), true, "every topic of the view counts as chosen");
  assert.equal(groupPicked(state, WAITING_GROUP), false, "«Da fare» does not hold the blocked questions");
  assert.equal(groupNeedsRead(state, WAITING_GROUP, true), true);
  state = toggleGroup(state, WAITING_GROUP, true, part(["w1"], "bloccata"));
  assert.equal(groupPicked(state, WAITING_GROUP), true);
  assert.equal(state.all?.count, 3, "«tutte» stays");
  assert.deepEqual(ids(state), ["a1", "a2", "b1", "w1"]);
  assert.equal(selectionOf(state).count, 4);
  // «Seleziona tutte» di nuovo tiene «In attesa».
  state = selectAll(state, part(["a1", "a2", "b1"]));
  assert.equal(groupPicked(state, WAITING_GROUP), true);
  state = toggleGroup(state, WAITING_GROUP, false, null);
  assert.deepEqual(ids(state), ["a1", "a2", "b1"]);
});

test("with «tutte», a topic taken out is subtracted with its questions and comes back without a new read", () => {
  let state = selectAll(emptySelection(VIEW), part(["a1", "a2", "b1"]));
  assert.equal(groupNeedsRead(state, "m.volumi", false), true, "its questions are needed to subtract them");
  state = toggleGroup(state, "m.volumi", false, part(["a1", "a2"]));
  assert.equal(groupPicked(state, "m.volumi"), false);
  assert.equal(groupPicked(state, "m.sistemi"), true);
  assert.deepEqual(ids(state), ["b1"]);
  assert.equal(selectionOf(state).count, 1);
  assert.equal(groupNeedsRead(state, "m.volumi", true), false, "known already");
  state = toggleGroup(state, "m.volumi", true, null);
  assert.deepEqual(ids(state), ["a1", "a2", "b1"]);
  assert.equal(selectionOf(state).count, 3);
});

test("rows: one by one, or all of them; taking one out of «tutte» goes back to the page minus that one; another view starts empty", () => {
  const rows = [
    { id: "r1", status: "chiesta" as const },
    { id: "r2", status: "in_verifica" as const },
    { id: "r3", status: "chiesta" as const },
  ];
  let state = toggleRow(emptySelection(VIEW), rows[0], true, rows);
  state = toggleRow(state, rows[1], true, rows);
  assert.equal(rowPicked(state, "r1"), true);
  assert.equal(rowPicked(state, "r3"), false);
  assert.deepEqual(selectionOf(state), { scope: "pagina", byStatus: { chiesta: ["r1"], in_verifica: ["r2"] }, count: 2, truncated: false });
  state = selectAll(state, { byStatus: { chiesta: ["r1", "r3", "r9"], in_verifica: ["r2"] }, count: 4, truncated: false });
  assert.equal(rowPicked(state, "r3"), true);
  assert.equal(selectionOf(state).count, 4, "rows already in «tutte» are not counted twice");
  state = toggleRow(state, rows[2], false, rows);
  assert.equal(state.all, null);
  assert.deepEqual(selectionOf(state).byStatus, { chiesta: ["r1"], in_verifica: ["r2"] });
  assert.deepEqual(selectionFor(state, "?vista=tutte"), emptySelection("?vista=tutte"));
  assert.equal(selectionFor(state, VIEW), state);
});
