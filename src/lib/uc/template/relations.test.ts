import test from "node:test";
import assert from "node:assert/strict";
import { ITEM_KINDS, LINK_RELATIONS, type ItemKind } from "../vocab.ts";
import { isLinkRelation, isRelationAllowed, RELATION_RULES } from "./relations.ts";

test("every relation of the vocabulary has a rule", () => {
  assert.deepEqual(Object.keys(RELATION_RULES).sort(), [...LINK_RELATIONS].sort());
  assert.equal(isLinkRelation("usa"), true);
  assert.equal(isLinkRelation("include"), false);
  assert.equal(isLinkRelation(3), false);
});

test("the PIANO table, row by row", () => {
  const allowed: [ItemKind, (typeof LINK_RELATIONS)[number], ItemKind][] = [
    ["kpi", "usa", "campo"],
    ["formula", "usa", "parametro"],
    ["entita", "usa", "entita"],
    ["regola", "usa", "parametro"],
    ["campo", "alimentato_da", "fonte"],
    ["kpi", "alimentato_da", "entita"],
    ["entita", "alimentato_da", "fonte"],
    ["domanda", "precisa", "campo"],
    ["domanda", "precisa", "documento"],
    ["vincolo_rigido", "dipende_da", "campo"],
    ["parametro", "dipende_da", "vincolo_rigido"],
    ["obiettivo", "dipende_da", "incertezza"],
    ["regola", "vincola", "regola"],
    ["regola", "vincola", "fonte"],
    ["controllo_qualita", "controlla", "fonte"],
    ["kpi", "deriva_da", "formula"],
    ["documento", "deriva_da", "regola"],
    ["parametro", "sostituisce", "parametro"],
    ["domanda", "sostituisce", "domanda"],
  ];
  for (const [from, rel, to] of allowed) assert.equal(isRelationAllowed(from, rel, to), true, `${from} ${rel} ${to}`);

  const refused: [ItemKind, (typeof LINK_RELATIONS)[number], ItemKind][] = [
    ["fonte", "alimentato_da", "entita"],
    ["campo", "usa", "campo"],
    ["kpi", "usa", "fonte"],
    ["domanda", "precisa", "domanda"],
    ["kpi", "precisa", "campo"],
    ["regola", "vincola", "domanda"],
    ["kpi", "vincola", "campo"],
    ["controllo_qualita", "controlla", "kpi"],
    ["kpi", "controlla", "campo"],
    ["domanda", "deriva_da", "campo"],
    ["campo", "deriva_da", "domanda"],
    ["parametro", "sostituisce", "decisione"],
    ["campo", "dipende_da", "campo"],
    ["decisione", "dipende_da", "fonte"],
  ];
  for (const [from, rel, to] of refused) assert.equal(isRelationAllowed(from, rel, to), false, `${from} ${rel} ${to}`);
});

test("precisa and vincola reach every kind except questions", () => {
  for (const kind of ITEM_KINDS) {
    assert.equal(isRelationAllowed("domanda", "precisa", kind), kind !== "domanda", kind);
    assert.equal(isRelationAllowed("regola", "vincola", kind), kind !== "domanda", kind);
  }
});

test("sostituisce only links two items of the same kind", () => {
  for (const a of ITEM_KINDS) for (const b of ITEM_KINDS) assert.equal(isRelationAllowed(a, "sostituisce", b), a === b, `${a} ${b}`);
});
