import test from "node:test";
import assert from "node:assert/strict";
import { toStatement, ucSql } from "./statement.ts";
import { TEMPLATE_PARTS_MAX, forgetTemplateParts, parseTemplateParts, rememberedTemplateHashes, templateKeyListSql, templatePartsColumns, templatePartsReader } from "./template-parts.ts";

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const MODULE = { key: "servizio", title: "Il servizio", role_key: "resp_servizio", why: "Per capire il volume.", instructions: "Rispondi con i dati del 2025.", estimated_label: "10 minuti", estimated_minutes: 10 };
const PARTS = {
  roles: [{ key: "resp_servizio", label: "Responsabile del servizio" }, { label: "Senza chiave" }, { key: "controllo_gestione", label: "Controllo di gestione" }],
  modules: [MODULE, { ...MODULE, key: "costi", title: null, role_key: null, why: null, instructions: null, estimated_label: null, estimated_minutes: null }],
  gates: [{ key: "G1", label: "Via allo sviluppo", approvers: ["ls_lead", "owner_cliente"] }],
  roi: { cost_lines: [{ key: "sviluppo", value: null }] },
};

test("the parts are asked only for hashes the process does not know, and the definition is never selected whole", () => {
  const s = toStatement(ucSql`SELECT ${templatePartsColumns([H1, H1, "non un hash", ` ${H2} `])} FROM uc_templates t`);
  assert.match(s.text, /^SELECT t\.definition_hash AS template_hash,/);
  assert.match(s.text, /CASE WHEN t\.definition_hash = ANY\(\$1::text\[\]\) THEN NULL ELSE jsonb_build_object\(/);
  assert.match(s.text, /'roles', CASE WHEN jsonb_typeof\(t\.definition -> 'roles'\) = 'array'/);
  assert.match(s.text, /'modules', \(SELECT coalesce\(jsonb_agg\(jsonb_build_object\('key', m\.elem ->> 'key', 'title', m\.elem ->> 'title', 'role_key', m\.elem ->> 'role_key',/);
  assert.match(s.text, /'why', m\.elem ->> 'why', 'instructions', m\.elem ->> 'instructions', 'estimated_label', m\.elem ->> 'estimated_label',/);
  assert.match(s.text, /'estimated_minutes', CASE WHEN jsonb_typeof\(m\.elem -> 'estimated_minutes'\) = 'number' THEN m\.elem -> 'estimated_minutes' END/);
  assert.match(s.text, /'gates', CASE WHEN jsonb_typeof\(t\.definition -> 'gates'\) = 'array'/);
  assert.match(s.text, /'roi', t\.definition -> 'roi'/);
  assert.match(s.text, /END AS template_parts FROM uc_templates t$/);
  assert.ok(!/t\.definition\s*(,|AS|\))/.test(s.text), "never the whole definition");
  assert.deepEqual(s.params, [[H1, H2]], "only valid hashes, once each");
});

test("parts read from the database keep their shape; anything else is no parts", () => {
  assert.deepEqual(parseTemplateParts(JSON.stringify(PARTS)), PARTS);
  const bare = { key: "a", title: null, role_key: null, why: null, instructions: null, estimated_label: null, estimated_minutes: null };
  assert.deepEqual(parseTemplateParts({ roles: "x", modules: [{ key: 1 }, { key: "a", estimated_minutes: "10" }], gates: null }), { roles: [], modules: [bare], gates: [], roi: null });
  assert.deepEqual(parseTemplateParts({ modules: [{ key: "a", estimated_minutes: 12.5, why: 3 }], roi: null }), { roles: [], modules: [{ ...bare, estimated_minutes: 12.5 }], gates: [], roi: null });
  assert.equal(parseTemplateParts(null), null);
  assert.equal(parseTemplateParts("[1]"), null);
  assert.equal(parseTemplateParts("non json"), null);
});

test("a reader remembers fresh parts by hash; the next reader skips that hash and reads the parts from memory", () => {
  forgetTemplateParts();
  const first = templatePartsReader();
  assert.deepEqual(first.known, []);
  assert.deepEqual(first.read({ template_hash: H1, template_parts: PARTS }), PARTS);
  assert.deepEqual(rememberedTemplateHashes(), [H1]);

  const second = templatePartsReader();
  assert.deepEqual(second.known, [H1]);
  assert.deepEqual(toStatement(second.columns).params, [[H1]]);
  assert.deepEqual(second.read({ template_hash: H1, template_parts: null }), PARTS, "the database skipped it: the parts come from memory");
  assert.equal(second.read({ template_hash: H2, template_parts: null }), null, "an unknown hash without parts has no parts");
  assert.equal(second.read(undefined), null);
  assert.equal(second.read({ template_hash: "x", template_parts: null }), null);
  forgetTemplateParts();
});

test("a reader keeps the parts it was promised even if the memory is emptied meanwhile", () => {
  forgetTemplateParts();
  templatePartsReader().read({ template_hash: H1, template_parts: PARTS });
  const reader = templatePartsReader();
  forgetTemplateParts();
  assert.deepEqual(reader.read({ template_hash: H1, template_parts: null }), PARTS);
});

test("the memory is bounded: past the limit the oldest hash leaves first", () => {
  forgetTemplateParts();
  const hash = (n: number) => n.toString(16).padStart(64, "0");
  for (let n = 0; n <= TEMPLATE_PARTS_MAX; n++) templatePartsReader().read({ template_hash: hash(n), template_parts: PARTS });
  const kept = rememberedTemplateHashes();
  assert.equal(kept.length, TEMPLATE_PARTS_MAX);
  assert.ok(!kept.includes(hash(0)), "the oldest is gone");
  assert.ok(kept.includes(hash(TEMPLATE_PARTS_MAX)));
  forgetTemplateParts();
});

test("the key list for ordering comes from memory for a known hash, from the definition otherwise", () => {
  forgetTemplateParts();
  const cold = toStatement(ucSql`SELECT ${templateKeyListSql("request_modules")} FROM uc_templates t`);
  assert.equal(
    cold.text,
    "SELECT coalesce($1::jsonb -> t.definition_hash::text, CASE WHEN jsonb_typeof(t.definition -> 'request_modules') = 'array' THEN t.definition -> 'request_modules' ELSE '[]'::jsonb END) FROM uc_templates t",
  );
  assert.deepEqual(cold.params, ["{}"], "nothing known: always the definition");
  templatePartsReader().read({ template_hash: H1, template_parts: PARTS });
  const modules = toStatement(ucSql`SELECT ${templateKeyListSql("request_modules")} FROM uc_templates t`);
  assert.deepEqual(JSON.parse(String(modules.params[0])), { [H1]: [{ key: "servizio" }, { key: "costi" }] });
  const roles = toStatement(ucSql`SELECT ${templateKeyListSql("roles")} FROM uc_templates t`);
  assert.match(roles.text, /t\.definition -> 'roles'/);
  assert.deepEqual(JSON.parse(String(roles.params[0])), { [H1]: [{ key: "resp_servizio" }, { key: "controllo_gestione" }] }, "roles without a key never match an item: the order of the others stays");
  forgetTemplateParts();
});
