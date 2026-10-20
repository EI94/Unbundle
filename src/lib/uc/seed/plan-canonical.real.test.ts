/**
 * Integration test on the real private files (PIANO §4.2, §8.2): the seed plan
 * runs on the template produced by the real normalizer (`template/normalize.ts`)
 * with the real text scan and redaction (`text/*`), the same pieces the seed
 * script uses. `plan.real.test.ts` covers the plan with minimal test doubles.
 *
 * The files are confidential and never in git: they are read from disk at run
 * time and the test is skipped when any of them is absent. Only counts are
 * asserted, never contents.
 *
 *   UC_SEED_FILE                  private seed (default: the only docs/casi-duso/seed-caso-*.json)
 *   UC_PRIVATE_TEMPLATE_FILE      raw template (default: docs/casi-duso/template-*.json with the seed's key and version)
 *   UC_PRIVATE_ROLE_ALIASES_FILE  area → role key (default: templates/uc/<key>/role-aliases.json)
 *   UC_SEED_NAMES_FILE            optional private names file for the redaction
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planTemplateLoad } from "../template/load.ts";
import { normalizeTemplate } from "../template/normalize.ts";
import { redactPersonalMentions } from "../text/redact.ts";
import { scanText } from "../text/scan.ts";
import { planSeed, type PlanSeedOptions, type SeedScanner } from "./plan.ts";
import { parseRedactionNames, parseSeedText } from "./schema.ts";

const repo = (relative: string) => fileURLToPath(new URL(`../../../../${relative}`, import.meta.url));
const DOCS = repo("docs/casi-duso/");

type Files = { seedPath: string; templatePath: string; aliasesPath: string };

function findFiles(): Files | { skip: string } {
  let seedPath = process.env.UC_SEED_FILE ?? null;
  if (!seedPath) {
    const seeds = existsSync(DOCS) ? readdirSync(DOCS).filter((f) => /^seed-caso-.+\.json$/.test(f)) : [];
    if (seeds.length !== 1) return { skip: seeds.length === 0 ? "private seed not available" : "several private seeds: set UC_SEED_FILE" };
    seedPath = join(DOCS, seeds[0]);
  }
  if (!existsSync(seedPath)) return { skip: "private seed not available" };
  const wanted = (JSON.parse(readFileSync(seedPath, "utf8")) as { template?: { key?: string; version?: string } }).template;
  if (!wanted?.key || !/^[a-z0-9_.]+$/.test(wanted.key)) return { skip: "seed without a template key" };
  let templatePath = process.env.UC_PRIVATE_TEMPLATE_FILE ?? null;
  if (!templatePath && existsSync(DOCS)) {
    for (const f of readdirSync(DOCS).filter((x) => /^template-.+\.json$/.test(x))) {
      const t = JSON.parse(readFileSync(join(DOCS, f), "utf8")) as { key?: string; version?: string };
      if (t.key === wanted.key && t.version === wanted.version) templatePath = join(DOCS, f);
    }
  }
  if (!templatePath || !existsSync(templatePath)) return { skip: "private template not available" };
  const aliasesPath = process.env.UC_PRIVATE_ROLE_ALIASES_FILE ?? repo(`templates/uc/${wanted.key}/role-aliases.json`);
  if (!existsSync(aliasesPath)) return { skip: "role aliases not available" };
  return { seedPath, templatePath, aliasesPath };
}

const FILES = findFiles();
const opts = { skip: "skip" in FILES ? FILES.skip : false };

// Any workspace id: the confidential template is only loadable with a restriction.
const WS = "6f1c2b9e-3a4d-4e5f-8a7b-1c2d3e4f5a6b";
const scan: SeedScanner = (text, o) => scanText(text, o);
const states = (da_chiedere: number, in_verifica: number, bloccata: number, mancante: number) => ({ da_chiedere, in_verifica, bloccata, mancante });

function run(over: Partial<PlanSeedOptions> = {}) {
  if ("skip" in FILES) throw new Error("unreachable");
  const roleAliases = JSON.parse(readFileSync(FILES.aliasesPath, "utf8")) as Record<string, string>;
  const normalized = normalizeTemplate(JSON.parse(readFileSync(FILES.templatePath, "utf8")), { roleAliases });
  assert.ok(normalized.ok);
  // Same path as the seed script: the canonical definition validated by the loader.
  const loaded = planTemplateLoad(JSON.stringify(normalized.template), { restrictToWorkspaceId: WS });
  assert.ok(loaded.ok);
  const seed = parseSeedText(readFileSync(FILES.seedPath, "utf8"));
  assert.ok(seed.ok);
  let names: string[] = [];
  if (process.env.UC_SEED_NAMES_FILE) {
    const r = parseRedactionNames(readFileSync(process.env.UC_SEED_NAMES_FILE, "utf8"));
    assert.ok(r.ok);
    names = r.value;
  }
  return planSeed(seed.value, loaded.plan.definition, { scan, redact: redactPersonalMentions, names, roleAliases, ...over });
}

test("seed plan on the normalized real template with the real scan: §8.2 counts", opts, (t) => {
  const plan = run();
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.counts.questions, 477);
  assert.deepEqual(plan.counts.by_state, states(295, 160, 19, 3));
  assert.deepEqual(plan.counts.by_area, {
    amministrazione: states(44, 42, 4, 0),
    commerciale: states(58, 52, 9, 1),
    direzione: states(68, 15, 0, 0),
    operativo: states(102, 40, 4, 2),
    sistemi: states(23, 11, 2, 0),
  });
  assert.equal(plan.counts.known_values, 186);
  assert.deepEqual(plan.counts.omitted, { sanitario: 1, personale: 5 });
  assert.deepEqual(plan.counts.answers, { total: 180, by_state: states(18, 159, 0, 3) });
  assert.deepEqual(plan.counts.blockers, { attivo: 5, permanente: 1 });
  assert.equal(plan.counts.contract_refs, 2);
  assert.deepEqual(plan.counts.milestones, { total: 4, proposals: 3, to_confirm: 2 });
  assert.deepEqual(plan.counts.maps.soluzione, { nodes: 20, edges: 41 });
  assert.deepEqual(plan.counts.roi, { costs: 13, benefits: 8 });
  assert.deepEqual(plan.personalAnswers, []);

  // The real scan holds 1 declared value and stops the apply on the 6 health
  // passages of PIANO §8.1. The crew age rule (regulation, spec privacy 3) is
  // not a client preference and is no longer held as discriminatory.
  assert.equal(plan.scan.valuesHeld, 1);
  assert.equal(plan.scan.applyBlocked, true);
  const held = plan.scan.report.entries.filter((e) => e.kind === "testo" && e.trattiene);
  const byCategory = (cat: string) => held.filter((e) => e.categoria === cat).length;
  assert.equal(byCategory("sanitario"), 6);
  assert.equal(byCategory("discriminatorio"), 0);
  assert.equal(plan.scan.textsHeld, 6);
  t.diagnostic(`held texts: ${byCategory("sanitario")} sanitario, ${byCategory("discriminatorio")} discriminatorio`);

  const accepted = run({ acceptScan: plan.scan.sha256 });
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.scan.applyBlocked, false);
  assert.deepEqual(accepted.counts.answers, { total: 181, by_state: states(18, 160, 0, 3) });
  assert.deepEqual(accepted.counts.retyping, { total: 42, by_state: states(5, 37, 0, 0) });
  assert.deepEqual(accepted.counts.by_state, states(295, 160, 19, 3));
});
