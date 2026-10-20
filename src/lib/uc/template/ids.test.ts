import test from "node:test";
import assert from "node:assert/strict";
import { ITEM_KINDS, type ItemKind } from "../vocab.ts";
import { checkItemKey, fieldEntityKey, ID_PATTERNS, KIND_PREFIX, kindForKey, looksLikeItemKey, MAX_ITEM_KEY_LENGTH, RESERVED_PREFIXES } from "./ids.ts";

const entities = new Set(["ent.richiesta", "ent.cliente"]);
const check = (key: string, kind: ItemKind, parent?: string) => checkItemKey({ key, kind, parent }, entities);

test("every kind has a pattern and prefixes map one-to-one to kinds", () => {
  assert.deepEqual(Object.keys(ID_PATTERNS).sort(), [...ITEM_KINDS].sort());
  const prefixes = Object.values(KIND_PREFIX);
  assert.equal(new Set(prefixes).size, prefixes.length, "a prefix is shared by two kinds");
  assert.equal(prefixes.length, ITEM_KINDS.length - 1, "every kind but campo has a prefix");
  for (const [kind, prefix] of Object.entries(KIND_PREFIX)) assert.equal(kindForKey(`${prefix}.x`), kind);
  assert.equal(kindForKey("richiesta.canale"), "campo");
  assert.deepEqual([...RESERVED_PREFIXES].sort(), [...prefixes].sort());
});

test("valid keys for each kind", () => {
  const valid: [string, ItemKind, string?][] = [
    ["ent.richiesta", "entita"],
    ["richiesta.canale", "campo", "ent.richiesta"],
    ["richiesta.2fa", "campo", "ent.richiesta"],
    ["kpi.servizio.tempo_risposta", "kpi"],
    ["rule.servizio.urgenti_prima", "regola"],
    ["src.crm.richieste", "fonte"],
    ["src.3cx.chiamate", "fonte"],
    ["q.servizio.01", "domanda"],
    ["q.servizio.136", "domanda"],
    ["dv.team", "decisione"],
    ["par.soglia", "parametro"],
    ["hc.orario", "vincolo_rigido"],
    ["sc.canale", "vincolo_morbido"],
    ["obj.tempo", "obiettivo"],
    ["unc.picchi", "incertezza"],
    ["out.proposta", "uscita"],
    ["f.media", "formula"],
    ["dq.data_presente", "controllo_qualita"],
    ["doc.procedura", "documento"],
  ];
  for (const [key, kind, parent] of valid) assert.equal(check(key, kind, parent), null, `${kind} ${key}`);
});

test("pattern violations are rejected with a stable code", () => {
  assert.equal(check("kpi.tempo", "kpi")?.code, "id_schema", "kpi needs an area");
  assert.equal(check("rule.urgenti", "regola")?.code, "id_schema", "rule needs an area");
  assert.equal(check("src.crm", "fonte")?.code, "id_schema", "src needs a system");
  assert.equal(check("q.servizio.1", "domanda")?.code, "id_schema", "questions need at least 2 digits");
  assert.equal(check("q.servizio.a1", "domanda")?.code, "id_schema");
  assert.equal(check("ent.Richiesta", "entita")?.code, "id_schema", "uppercase");
  assert.equal(check("ent.1richiesta", "entita")?.code, "id_schema");
  assert.equal(check("dv.team-a", "decisione")?.code, "id_schema");
  assert.equal(check("richiesta", "campo")?.code, "id_schema", "a field has two segments");
  assert.equal(check("richiesta.canale.extra", "campo")?.code, "id_schema");
});

test("kind and prefix must agree", () => {
  assert.equal(check("par.soglia", "decisione")?.code, "id_schema");
  assert.equal(check("dq.x", "campo")?.code, "id_tipo_prefisso", "a field cannot use a reserved prefix as entity");
  assert.equal(check("kpi.x", "campo")?.code, "id_tipo_prefisso");
});

test("fields need an existing entity and the matching parent; entity names cannot be reserved", () => {
  assert.equal(check("ordine.totale", "campo", "ent.ordine")?.code, "id_campo_entita");
  assert.equal(check("richiesta.canale", "campo")?.code, "id_campo_parent");
  assert.equal(check("richiesta.canale", "campo", "ent.cliente")?.code, "id_campo_parent");
  assert.equal(check("ent.kpi", "entita")?.code, "id_entita_riservata");
  assert.equal(check("ent.doc", "entita")?.code, "id_entita_riservata");
  assert.equal(fieldEntityKey("richiesta.canale"), "ent.richiesta");
});

test("keys longer than 160 characters are rejected", () => {
  const long = `dv.${"a".repeat(MAX_ITEM_KEY_LENGTH)}`;
  assert.equal(check(long, "decisione")?.code, "id_lunghezza");
  assert.equal(check("", "decisione")?.code, "id_lunghezza");
  assert.equal(looksLikeItemKey(long), false);
});

test("looksLikeItemKey recognises keys of any kind", () => {
  for (const key of ["ent.richiesta", "richiesta.canale", "kpi.a.b", "q.a.01", "hc.x", "doc.y"]) assert.equal(looksLikeItemKey(key), true, key);
  for (const key of ["richiesta", "q.a.1", "Kpi.a.b", "kpi.a", "1.2"]) assert.equal(looksLikeItemKey(key), false, key);
});
