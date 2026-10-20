import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { definitionHash } from "./hash.ts";
import { canonicalDefinition, checkTemplatePath, planSummary, planTemplateLoad, templateDefinitionHash } from "./load.ts";
import { TEMPLATE_LIMITS, validateTemplate } from "./schema.ts";

const exampleText = readFileSync(new URL("../../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8");
const example = (): Record<string, unknown> => JSON.parse(exampleText) as Record<string, unknown>;
const WS = "6f1c2b9e-3a4d-4e5f-8a7b-1c2d3e4f5a6b";

function planOf(value: unknown, options: Parameters<typeof planTemplateLoad>[1] = {}) {
  const r = planTemplateLoad(JSON.stringify(value), options);
  assert.ok(r.ok, r.ok ? "" : `${r.code}: ${r.message} ${JSON.stringify(r.errors.slice(0, 3))}`);
  return r.plan;
}

test("the example template plans cleanly, with a 64-hex definition hash and no status in the definition", () => {
  const r = planTemplateLoad(exampleText, { filePath: "templates/uc/esempio.minimo/1.0.0.json" });
  assert.ok(r.ok);
  const plan = r.plan;
  assert.equal(plan.key, "esempio.minimo");
  assert.equal(plan.version, "1.0.0");
  assert.equal(plan.language, "it");
  assert.equal(plan.confidential, false);
  assert.equal(plan.restrictedToWorkspaceId, null);
  assert.match(plan.hash, /^[0-9a-f]{64}$/);
  assert.equal("status" in plan.definition, false);
  assert.equal(plan.hash, definitionHash(plan.definition));
  assert.equal(plan.stats.items, 50);
  assert.deepEqual(plan.warnings, []);
});

test("the hash ignores key order, defaults written or omitted, and the status written in the file", () => {
  const base = planOf(example()).hash;
  const reordered = Object.fromEntries(Object.entries(example()).reverse());
  assert.equal(planOf(reordered).hash, base);
  const withoutDefaults = example();
  delete withoutDefaults.gate_policy;
  delete withoutDefaults.confidential;
  assert.equal(planOf(withoutDefaults).hash, base);
  const draft = example();
  draft.status = "bozza";
  assert.equal(planOf(draft).hash, base);
  const changed = example();
  changed.name = "Esempio · Un altro nome";
  assert.notEqual(planOf(changed).hash, base);
});

test("canonical definition and hash helpers agree", () => {
  const v = validateTemplate(example());
  assert.ok(v.ok);
  const canonical = canonicalDefinition(v.template);
  assert.equal("status" in canonical, false);
  assert.equal(templateDefinitionHash(v.template), templateDefinitionHash(canonical));
  assert.equal(templateDefinitionHash(canonical), planOf(example()).hash);
  // A definition read back from jsonb (keys reordered) gives the same hash.
  const reverseKeys = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reverseKeys)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]))
        : value;
  const roundTrip = JSON.parse(JSON.stringify(reverseKeys(canonical)));
  const again = validateTemplate(roundTrip);
  assert.ok(again.ok);
  assert.equal(templateDefinitionHash(again.template), templateDefinitionHash(canonical));
});

test("a confidential template is refused without a workspace restriction, even in a dry run", () => {
  const confidential = { ...example(), confidential: true };
  const refused = planTemplateLoad(JSON.stringify(confidential));
  assert.equal(refused.ok, false);
  assert.equal(refused.ok ? null : refused.code, "template_riservato");
  const restricted = planOf(confidential, { restrictToWorkspaceId: WS });
  assert.equal(restricted.restrictedToWorkspaceId, WS);
  assert.equal(restricted.confidential, true);
  assert.equal(planOf(confidential, { purpose: "inspect" }).confidential, true);
  const badId = planTemplateLoad(JSON.stringify(confidential), { restrictToWorkspaceId: "non-un-uuid" });
  assert.equal(badId.ok ? null : badId.code, "workspace_non_valido");
});

test("a raw, non normalised file is refused with the list of errors", () => {
  const raw = example();
  (raw.items as Record<string, unknown>[])[0].spiegazione = "campo grezzo";
  const r = planTemplateLoad(JSON.stringify(raw));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "template_non_valido");
  assert.ok(r.errors.length > 0);
  assert.equal(r.errors[0].code, "formato");
});

test("file-level checks: duplicate keys, invalid JSON, size, path under templates/uc", () => {
  const dup = planTemplateLoad('{"key":"a.b","key":"a.c"}');
  assert.equal(dup.ok ? null : dup.code, "json_chiavi_ripetute");
  const invalid = planTemplateLoad("{");
  assert.equal(invalid.ok ? null : invalid.code, "json_non_valido");
  const big = planTemplateLoad(`"${"x".repeat(TEMPLATE_LIMITS.maxBytes)}"`);
  assert.equal(big.ok ? null : big.code, "file_troppo_grande");
  const wrongPath = planTemplateLoad(exampleText, { filePath: "/x/templates/uc/esempio.minimo/2.0.0.json" });
  assert.equal(wrongPath.ok ? null : wrongPath.code, "percorso_non_valido");
  assert.equal(checkTemplatePath("/tmp/scratch/qualcosa.json", "esempio.minimo", "1.0.0"), null);
  assert.equal(checkTemplatePath("C:\\repo\\templates\\uc\\esempio.minimo\\1.0.0.json", "esempio.minimo", "1.0.0"), null);
  assert.notEqual(checkTemplatePath("templates/uc/altro/1.0.0.json", "esempio.minimo", "1.0.0"), null);
});

test("the dry-run summary has keys and counts only", () => {
  const summary = planSummary(planOf(example()));
  assert.equal(summary.items, 50);
  assert.equal(summary.questions, 16);
  assert.equal(summary.must_questions, 7);
  assert.equal(summary.modules, 3);
  assert.equal(summary.by_kind.documento, 1);
  assert.equal(summary.warnings, 0);
  const text = JSON.stringify(summary);
  assert.ok(!text.includes("Esempio inventato"));
  assert.ok(!text.includes("Richiesta di assistenza"));
});
