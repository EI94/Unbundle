import test from "node:test";
import assert from "node:assert/strict";
import { ASSIGN_DEFAULT_TICKS, defaultAssignTicks } from "./assign.ts";
import { orgWordsOf, type MatchQuestion } from "./match.ts";

// Rilascio 5 (§3.8): le domande spuntate di una richiesta al referente. Dati sintetici con la forma di
// RD-0002 (7 domande da chiedere) e delle due schede con 14.

const ORG = orgWordsOf(["Alfa Jet (prova)", "Alfa Jet e Belmonte"]);
const q = (id: string, ownerLabel: string | null = null): MatchQuestion => ({ id, ownerLabel });
const ids = (n: number, prefix = "n") => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const askableOf = (list: string[], owners: Record<string, string> = {}) => list.map((id) => q(id, owners[id] ?? null));
const aldo = { displayName: "Aldo Prova", roleLabel: "Contabilità" };

test("scegli: 5 di 7 su RD-0002, nell'ordine della scheda per chi il «Chi» non nomina", () => {
  assert.equal(ASSIGN_DEFAULT_TICKS, 5);
  const ticks = defaultAssignTicks({ mode: "scegli", askable: askableOf(ids(7)), person: aldo, orgWords: ORG });
  assert.deepEqual(ticks, ["n1", "n2", "n3", "n4", "n5"]);
  const fourteen = defaultAssignTicks({ mode: "scegli", askable: askableOf(ids(14)), person: aldo, orgWords: ORG });
  assert.equal(fourteen.length, 5);
});

test("scegli: prima quelle che nominano la persona e le generiche, poi le altre", () => {
  const owners = { n1: "Tesoreria", n2: "Tesoreria", n3: "Aldo", n4: "Tesoreria", n5: "Contabilità", n6: "Tesoreria", n7: "Tesoreria" };
  const ticks = defaultAssignTicks({ mode: "scegli", askable: askableOf(ids(7), owners), person: aldo, orgWords: ORG });
  assert.deepEqual(ticks, ["n3", "n5", "n1", "n2", "n4"]);
});

test("cambia: le domande portate per prime e sempre, anche oltre 5; le «Non ce l'ho» fuori; mai oltre 20", () => {
  const askable = askableOf(ids(9));
  assert.deepEqual(defaultAssignTicks({ mode: "cambia", askable, carried: ["n7", "n8", "n9"], person: aldo, orgWords: ORG }), ["n7", "n8", "n9", "n1", "n2"]);
  const many = defaultAssignTicks({ mode: "cambia", askable, carried: ["n1", "n2", "n3", "n4", "n5", "n6", "n7"], person: aldo, orgWords: ORG });
  assert.deepEqual(many, ["n1", "n2", "n3", "n4", "n5", "n6", "n7"]);
  assert.deepEqual(defaultAssignTicks({ mode: "scegli", askable, declined: ["n1", "n3"], person: aldo, orgWords: ORG }), ["n2", "n4", "n5", "n6", "n7"]);
  const big = askableOf(ids(25));
  assert.equal(defaultAssignTicks({ mode: "cambia", askable: big, carried: ids(25), person: aldo, orgWords: ORG }).length, 20);
  // Una domanda portata che non è più da chiedere non si spunta.
  assert.deepEqual(defaultAssignTicks({ mode: "cambia", askable: askableOf(ids(3)), carried: ["zz"], person: aldo, orgWords: ORG }), ["n1", "n2", "n3"]);
});

test("chiedi: fino a 5, mai le «Non ce l'ho» del referente, niente di portato", () => {
  const askable = askableOf(ids(8));
  assert.deepEqual(defaultAssignTicks({ mode: "chiedi", askable, declined: ["n2"], carried: ["n8"], person: aldo, orgWords: ORG }), ["n1", "n3", "n4", "n5", "n6"]);
  assert.deepEqual(defaultAssignTicks({ mode: "chiedi", askable: askableOf(["n1"]), declined: ["n1"], person: aldo, orgWords: ORG }), []);
});

test("di nuovo: le domande di prima ancora da chiedere (la regola del rilascio 4)", () => {
  const askable = askableOf(ids(8));
  assert.deepEqual(defaultAssignTicks({ mode: "di_nuovo", askable, previous: ["n2", "n7", "zz"], person: aldo, orgWords: ORG }), ["n2", "n7"]);
});
