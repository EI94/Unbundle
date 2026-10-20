/**
 * Prova sui file privati del primo caso (PIANO §8.2): solo conteggi, mai valori.
 *
 * I file non sono in git. Il test li legge da `UC_SEED_FILE` e `UC_TEMPLATE_FILE`,
 * oppure da `docs/casi-duso/` nella checkout (l'unico `seed-caso-*.json` e il
 * `template-*.json` con la chiave e la versione del seed); se mancano, si salta.
 * Nessun nome di file del cliente sta nel codice.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canConfirmDeclared } from "../answers/confirm.ts";
import { answerContext, prefillFromDeclared } from "../answers/normalize.ts";
import { RESPONSE_TYPES, isVocab, type ResponseType } from "../vocab.ts";
import { hasHardBlock, scanPayload, scanText } from "./scan.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.resolve(here, "../../../../docs/casi-duso");
const listDocs = (pattern: RegExp) => (existsSync(docs) ? readdirSync(docs).filter((f) => pattern.test(f)).map((f) => path.join(docs, f)) : []);

function findSeed(): string | null {
  if (process.env.UC_SEED_FILE) return process.env.UC_SEED_FILE;
  const seeds = listDocs(/^seed-caso-.+\.json$/);
  return seeds.length === 1 ? seeds[0] : null;
}

function findTemplate(seed: string | null): string | null {
  if (process.env.UC_TEMPLATE_FILE) return process.env.UC_TEMPLATE_FILE;
  if (!seed || !existsSync(seed)) return null;
  const wanted = (JSON.parse(readFileSync(seed, "utf8")) as { template?: { key?: string; version?: string } }).template;
  return (
    listDocs(/^template-.+\.json$/).find((f) => {
      const t = JSON.parse(readFileSync(f, "utf8")) as { key?: string; version?: string };
      return t.key === wanted?.key && t.version === wanted?.version;
    }) ?? null
  );
}

const seedPath = findSeed();
const templatePath = findTemplate(seedPath);
const skip = !seedPath || !templatePath || !existsSync(seedPath) || !existsSync(templatePath) ? "file privati assenti" : false;

interface SeedAnswer {
  item_key: string;
  initial_state: string;
  known_value: unknown;
}

interface TemplateItem {
  key: string;
  kind: string;
  title?: string;
  privacy_class?: unknown;
  response?: { type?: string; unit?: string | null; options?: unknown };
}

/** Nomi grezzi del template v1.0.0 → tipi canonici (come il normalizzatore, PIANO §4.2). */
const TYPE_RENAMES: Record<string, string> = { "conferma regola": "conferma_regola", "conferma formula": "conferma_formula", riferimento: "codice" };

function load() {
  const seed = JSON.parse(readFileSync(seedPath!, "utf8")) as Record<string, unknown> & { answers: SeedAnswer[] };
  const template = JSON.parse(readFileSync(templatePath!, "utf8")) as { items: TemplateItem[] };
  const items = new Map(template.items.map((i) => [i.key, i]));
  const declared = seed.answers.filter((a) => a.known_value !== null && a.known_value !== undefined && a.known_value !== "");
  return { seed, items, declared };
}

const GENERIC_TERMS = new Set(["nome e cognome", "titolo e cognome", "nome di persona", "nome proprio", "data di nascita", "codice fiscale", "email", "telefono"]);
const asText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
const isPersonal = (item: TemplateItem) => /personale/.test(String(item.privacy_class ?? ""));
const isHealthRuleQuestion = (item: TemplateItem) => item.kind === "domanda" && /escluso_sanitario/.test(String(item.privacy_class ?? ""));
const typeOf = (item: TemplateItem): ResponseType | null => {
  const raw = item.response?.type ?? "";
  const t = TYPE_RENAMES[raw] ?? raw;
  return isVocab(RESPONSE_TYPES, t) ? t : null;
};

test("seed: exactly one declared value is held back by the text scan (PIANO §8.2)", { skip }, () => {
  const { items, declared } = load();
  assert.equal(declared.length, 186);
  let hard = 0;
  let healthRuleQuestions = 0;
  for (const a of declared) {
    const item = items.get(a.item_key);
    assert.ok(item, "voce del seed assente nel template");
    const healthRule = isHealthRuleQuestion(item);
    if (healthRule) healthRuleQuestions++;
    const r = scanText(asText(a.known_value), {
      context: "seed",
      healthRuleQuestion: healthRule ? { questionText: item.title ?? "" } : undefined,
    });
    if (hasHardBlock(r.blocking)) hard++;
    // I risultati portano solo la categoria e un'etichetta, mai il dato personale.
    for (const f of [...r.blocking, ...r.warnings]) {
      assert.deepEqual(Object.keys(f).filter((k) => !["category", "term", "detail", "start", "end"].includes(k)), []);
      if (f.category !== "sanitario" && f.category !== "discriminatorio") assert.ok(GENERIC_TERMS.has(f.term), f.category);
    }
  }
  assert.equal(healthRuleQuestions, 1, "una sola delle due domande sulla regola sanitaria ha un valore dichiarato");
  assert.equal(hard, 1);
});

test("seed: six overlay passages mention health data (PIANO §8.1, 7-bis)", { skip }, () => {
  const { seed } = load();
  const overlay = { description: seed.description, map: seed.map, process: seed.process, roi: seed.roi, milestones: seed.milestones };
  const r = scanPayload(overlay, { context: "seed" });
  const healthPaths = new Set(r.blocking.filter((f) => f.category === "sanitario").map((f) => f.path));
  assert.equal(healthPaths.size, 6);
  // Il passaggio sulla regola d'età dell'equipaggio (normativa, spec privacy 3) non è una preferenza del cliente.
  const discriminatoryPaths = new Set(r.blocking.filter((f) => f.category === "discriminatorio").map((f) => f.path));
  assert.equal(discriminatoryPaths.size, 0);
});

test("seed: 42 of the 181 declared values must be retyped, most can be prefilled (PIANO §3.9, §8.2)", { skip }, () => {
  const { items, declared } = load();
  const ctx = answerContext(new Date("2026-10-07T10:00:00Z"), false);
  let total = 0;
  let prefilled = 0;
  const retypeByState: Record<string, number> = {};
  for (const a of declared) {
    const item = items.get(a.item_key)!;
    if (isPersonal(item)) continue;
    total++;
    const type = typeOf(item);
    assert.ok(type, `tipo sconosciuto: ${item.response?.type}`);
    if (canConfirmDeclared(type, { normalized: null })) continue;
    retypeByState[a.initial_state] = (retypeByState[a.initial_state] ?? 0) + 1;
    const config = { unit: item.response?.unit ?? undefined, options: Array.isArray(item.response?.options) ? (item.response?.options as string[]) : undefined };
    if (prefillFromDeclared(type, asText(a.known_value), config, ctx)) prefilled++;
  }
  assert.equal(total, 181);
  assert.deepEqual(retypeByState, { in_verifica: 37, da_chiedere: 5 });
  assert.ok(prefilled >= 30, `precompilati ${prefilled} su 42`);
});
