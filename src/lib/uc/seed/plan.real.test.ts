/**
 * Prova del piano sul seed reale del primo caso (PIANO §8.2). I file sono
 * privati e fuori da git: il test li legge da disco e si salta se non ci sono.
 *
 * - `UC_SEED_FILE` e `UC_SEED_TEMPLATE_FILE`: percorsi espliciti;
 * - altrimenti l'unico `docs/casi-duso/seed-caso-*.json` della checkout e il
 *   `docs/casi-duso/template-*.json` con la stessa chiave e versione;
 * - `UC_SEED_NAMES_FILE` (facoltativo): il file privato dei nomi da oscurare.
 *
 * Il template si legge nel formato grezzo v1.0.0 e qui si riduce ai pochi campi
 * che servono al piano, con le regole del normalizzatore (§4.2): classe privacy
 * più restrittiva, domande sulla regola sanitaria → `riservato_azienda` con
 * `health_rule_question`, tipi di risposta canonici. La scansione e la
 * redazione sono doppi minimi del §3.10 (lessico sanitario); se `text/scan.ts`
 * c'è, il piano gira anche con la scansione vera e si controllano gli
 * invarianti. Il test non stampa né confronta mai testi del cliente: solo
 * conteggi e chiavi.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { planSeed, SEED_REASONS, type PlanSeedOptions, type SeedPlan, type SeedRedactor, type SeedScanner, type SeedTemplate, type SeedTemplateItem } from "./plan.ts";
import { parseRedactionNames, parseSeedText, type CaseSeed } from "./schema.ts";
import { PRIVACY_CLASSES, isVocab, type PrivacyClass, type ResponseType } from "../vocab.ts";

const DOCS = fileURLToPath(new URL("../../../../docs/casi-duso/", import.meta.url));

function findFiles(): { seedPath: string; templatePath: string } | { skip: string } {
  const envSeed = process.env.UC_SEED_FILE;
  const envTemplate = process.env.UC_SEED_TEMPLATE_FILE;
  if (envSeed || envTemplate) {
    if (!envSeed || !envTemplate || !existsSync(envSeed) || !existsSync(envTemplate)) return { skip: "UC_SEED_FILE o UC_SEED_TEMPLATE_FILE non leggibili" };
    return { seedPath: envSeed, templatePath: envTemplate };
  }
  if (!existsSync(DOCS)) return { skip: "cartella dei file privati assente" };
  const files = readdirSync(DOCS);
  const seeds = files.filter((f) => /^seed-caso-.+\.json$/.test(f));
  if (seeds.length !== 1) return { skip: seeds.length === 0 ? "seed privato assente" : "più seed privati: indica UC_SEED_FILE" };
  const seedPath = join(DOCS, seeds[0]);
  const wanted = (JSON.parse(readFileSync(seedPath, "utf8")) as { template?: { key?: string; version?: string } }).template;
  for (const f of files.filter((x) => /^template-.+\.json$/.test(x))) {
    const t = JSON.parse(readFileSync(join(DOCS, f), "utf8")) as { key?: string; version?: string };
    if (t.key === wanted?.key && t.version === wanted?.version) return { seedPath, templatePath: join(DOCS, f) };
  }
  return { skip: "template privato del seed assente" };
}

const FILES = findFiles();
const SKIP = "skip" in FILES ? `file privati assenti: ${FILES.skip}` : false;

// ── Doppio del normalizzatore (solo i campi che servono al piano) ──

const RESPONSE_TYPE_ALIASES: Readonly<Record<string, ResponseType>> = {
  "conferma regola": "conferma_regola",
  "conferma formula": "conferma_formula",
  riferimento: "codice",
};

function privacyOf(raw: unknown, kind: string): { cls: PrivacyClass; healthRule: boolean } {
  if (typeof raw !== "string") return { cls: "riservato_azienda", healthRule: false };
  const tokens = PRIVACY_CLASSES.filter((c) => new RegExp(`\\b${c}\\b`).test(raw));
  if (tokens.length === 0) return { cls: "riservato_azienda", healthRule: false };
  if (tokens.includes("escluso_sanitario")) {
    const personal = tokens.filter((c) => c === "personale" || c === "personale_equipaggio");
    if (personal.length > 0) return { cls: personal[0], healthRule: false };
    if (kind === "domanda") return { cls: "riservato_azienda", healthRule: true };
  }
  return { cls: tokens[0], healthRule: false };
}

interface RawTemplate {
  key: string;
  version: string;
  roles: { key: string }[];
  blockers: { key: string }[];
  map: { nodes: { id: string }[] };
  items: { key: string; kind: string; title: string; privacy_class?: unknown; modulo?: string | null; response?: { type?: string } | null; blocked_by?: string[] }[];
}

function toSeedTemplate(raw: RawTemplate): SeedTemplate {
  const items: SeedTemplateItem[] = raw.items.map((i) => {
    const p = privacyOf(i.privacy_class, i.kind);
    const type = i.response?.type ? (RESPONSE_TYPE_ALIASES[i.response.type] ?? i.response.type) : null;
    return {
      key: i.key,
      kind: i.kind,
      title: i.title,
      privacy_class: p.cls,
      request_module: i.kind === "domanda" ? (i.modulo ?? "modulo") : null,
      response: type ? { type: type as ResponseType } : null,
      blocked_by: i.blocked_by ?? [],
      spec: p.healthRule ? { health_rule_question: true } : {},
    };
  });
  return { key: raw.key, version: raw.version, items, roles: raw.roles, blockers: raw.blockers, map: { nodes: raw.map.nodes.map((n) => ({ id: n.id })) } };
}

// ── Doppi minimi di scansione e redazione (§3.10) ──

const HEALTH =
  /\b(visit[ae]\s+medic[ah]e?|certificat[oi]\s+medic[oi]|idoneit[aà]\s+medica|medic\w*|sanitar\w*|malatti\w*|diagnos\w*|patolog\w*|terapi\w*|farmac\w*|invalidit\w*|disabilit\w*|gravidanz\w*|allergi\w*|ricover\w*|sintom\w*|vaccin\w*|psicolog\w*|psichiatr\w*)/giu;

const healthScan: SeedScanner = (text, opts) => {
  const blocking: { category: string }[] = [];
  const warnings: { category: string }[] = [];
  const question = opts.healthRuleQuestion?.questionText.toLowerCase() ?? null;
  for (const m of text.matchAll(HEALTH)) {
    (question?.includes(m[0].toLowerCase()) ? warnings : blocking).push({ category: "sanitario" });
  }
  return { blocking, warnings };
};

const basicRedact: SeedRedactor = (text, names) => {
  let count = 0;
  const hit = () => {
    count++;
    return "[referente]";
  };
  let out = text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, hit).replace(/(?<![\w])\+?\d[\d ]{8,}\d\b/g, hit);
  for (const name of names) out = out.replace(new RegExp(`(?<![\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "giu"), hit);
  return { text: out, count };
};

function load(): { seed: CaseSeed; template: SeedTemplate; names: string[] } {
  if ("skip" in FILES) throw new Error("unreachable");
  const parsed = parseSeedText(readFileSync(FILES.seedPath, "utf8"));
  assert.ok(parsed.ok, parsed.ok ? "" : `seed non valido: ${JSON.stringify(parsed.issues)}`);
  const template = toSeedTemplate(JSON.parse(readFileSync(FILES.templatePath, "utf8")) as RawTemplate);
  const namesFile = process.env.UC_SEED_NAMES_FILE;
  let names: string[] = [];
  if (namesFile) {
    const r = parseRedactionNames(readFileSync(namesFile, "utf8"));
    assert.ok(r.ok);
    names = r.value;
  }
  return { seed: parsed.value, template, names };
}

const ROLE_ALIASES = { commerciale: "resp_commerciale", amministrazione: "controllo_gestione", sistemi: "referente_sistemi" };

function run(over: Partial<PlanSeedOptions> = {}): { plan: SeedPlan; seed: CaseSeed } {
  const { seed, template, names } = load();
  return { seed, plan: planSeed(seed, template, { scan: healthScan, redact: basicRedact, names, roleAliases: ROLE_ALIASES, ...over }) };
}

const states = (da_chiedere: number, in_verifica: number, bloccata: number, mancante: number) => ({ da_chiedere, in_verifica, bloccata, mancante });

test("real seed: 477 questions with the expected states, by area too (§8.2)", { skip: SKIP }, () => {
  const { plan } = run();
  assert.deepEqual(plan.errors, []);
  assert.ok(!plan.warnings.some((w) => ["ruolo_sconosciuto", "tipo_costo", "leva_sconosciuta", "kpi_assente", "domande_senza_stato"].includes(w.code)), JSON.stringify(plan.warnings.map((w) => w.code)));
  assert.equal(plan.counts.questions, 477);
  assert.deepEqual(plan.counts.by_state, states(295, 160, 19, 3));
  assert.deepEqual(plan.counts.by_area, {
    amministrazione: states(44, 42, 4, 0),
    commerciale: states(58, 52, 9, 1),
    direzione: states(68, 15, 0, 0),
    operativo: states(102, 40, 4, 2),
    sistemi: states(23, 11, 2, 0),
  });
  for (const item of plan.items.filter((i) => i.status === "mancante")) assert.equal(item.status_reason, SEED_REASONS.mancante_dichiarato);
});

test("real seed: 180 v1 answers without the approved report, 181 with it, 5 personal values never stored (§8.2)", { skip: SKIP }, () => {
  const { plan, seed } = run();
  assert.equal(plan.counts.known_values, 186);
  assert.equal(plan.scan.accepted, false);
  assert.deepEqual(plan.counts.answers, { total: 180, by_state: states(18, 159, 0, 3) });
  assert.deepEqual(plan.omitted.filter((o) => o.categoria === "sanitario").map((o) => o.item_key), ["q.commerciale.11"]);
  const held = plan.items.find((i) => i.key === "q.commerciale.11");
  assert.deepEqual(held, { key: "q.commerciale.11", status: "in_verifica", status_reason: SEED_REASONS.valore_omesso });
  const personal = plan.omitted.filter((o) => o.categoria === "personale").map((o) => o.item_key);
  assert.equal(personal.length, 5);
  for (const key of personal) assert.equal(plan.items.find((i) => i.key === key)?.status, "bloccata");
  assert.deepEqual(plan.personalAnswers, []);
  // §8.1: sei passaggi dei testi di sovrapposizione fermano l'apply finché il report non è approvato.
  assert.equal(plan.scan.textsHeld, 6);
  assert.equal(plan.scan.applyBlocked, true);

  // Il report e gli eventi non contengono nessun valore dichiarato.
  const report = JSON.stringify(plan.scan.report) + JSON.stringify(plan.events);
  for (const a of seed.answers) if (a.known_value && a.known_value.length > 12) assert.ok(!report.includes(a.known_value.slice(0, 12)), `report leaks ${a.item_key}`);
  // I valori personali non compaiono in nessuna risposta.
  const answers = JSON.stringify(plan.answers);
  for (const a of seed.answers) if (personal.includes(a.item_key) && a.known_value) assert.ok(!answers.includes(a.known_value.trim()), `personal value of ${a.item_key}`);

  const ok = run({ acceptScan: plan.scan.sha256 }).plan;
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.scan.accepted, true);
  assert.equal(ok.scan.applyBlocked, false);
  assert.deepEqual(ok.counts.answers, { total: 181, by_state: states(18, 160, 0, 3) });
  assert.deepEqual(ok.counts.retyping, { total: 42, by_state: states(5, 37, 0, 0) });
  assert.equal(ok.case.settings.seed.scan_report_sha256, plan.scan.sha256);
  assert.deepEqual(ok.events.find((e) => e.type === "seed.valore_omesso")?.payload, { count: 5, categoria: "personale" });
});

test("real seed: blockers, contract references, milestones, maps and ROI (§8.2)", { skip: SKIP }, () => {
  const { plan } = run();
  assert.deepEqual(plan.counts.blockers, { attivo: 5, permanente: 1 });
  assert.equal(plan.blockers.find((b) => b.key === "sanitario")?.status, "permanente");
  assert.equal(plan.counts.contract_refs, 2);
  assert.deepEqual(plan.counts.milestones, { total: 4, proposals: 3, to_confirm: 2 });
  assert.deepEqual(
    plan.milestones.map((m) => [m.key, m.is_proposal, m.to_confirm]),
    [
      ["fase_1", true, false],
      ["fase_2", true, true],
      ["fase_3", false, true],
      ["fase_4", true, false],
    ],
  );
  assert.deepEqual(plan.counts.maps, {
    soluzione: { nodes: 20, edges: 41 },
    processo_to_be: { nodes: 28, edges: 27 },
    processo_as_is: { nodes: 26, edges: 25 },
    esempio: { nodes: 22, edges: 21 },
  });
  assert.deepEqual(plan.counts.roi, { costs: 13, benefits: 8 });
  assert.ok(plan.roi.cost_lines.every((c) => c.kind !== null));
  assert.ok(plan.roi.benefit_lines.every((b) => b.lever !== null && b.unresolved_refs.length === 0));
  assert.equal(plan.case.status, "raccolta");
  assert.equal(plan.case.data_controller_label, null);
  assert.ok(plan.case.client_owner_role_label && !plan.case.client_owner_role_label.includes("("));
  assert.deepEqual(Object.keys(plan.case.settings.role_labels).sort(), ["controllo_gestione", "direzione", "operativo", "referente_sistemi", "resp_commerciale"]);
  // Nessuna voce bloccata dal template riceve uno stato aperto, e il piano è deterministico.
  assert.equal(run().plan.scan.sha256, plan.scan.sha256);
  assert.equal(run().plan.seedHash, plan.seedHash);
});

test("real seed with the real text scan, when present: invariants hold", { skip: SKIP }, async (t) => {
  const url = new URL("../text/scan.ts", import.meta.url);
  if (!existsSync(fileURLToPath(url))) {
    t.skip("text/scan.ts non ancora presente");
    return;
  }
  const mod = (await import(url.href)) as { scanText?: (text: string, opts: object) => { blocking: { category: string }[]; warnings: { category: string }[] } };
  if (typeof mod.scanText !== "function") {
    t.skip("scanText non esportata");
    return;
  }
  const scanText = mod.scanText;
  const scan: SeedScanner = (text, opts) => scanText(text, opts);
  const { plan } = run({ scan });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.counts.by_state, states(295, 160, 19, 3));
  const omitted = Object.values(plan.counts.omitted).reduce((a, b) => a + b, 0);
  assert.equal(plan.counts.answers.total + omitted, 186);
  assert.equal(plan.counts.omitted.personale, 5);
  const ok = run({ scan, acceptScan: plan.scan.sha256 }).plan;
  assert.equal(ok.counts.answers.total, 181);
  t.diagnostic(`scansione vera: ${plan.scan.valuesHeld} valori trattenuti, ${plan.scan.textsHeld} testi trattenuti`);
});

test("test doubles: privacy normalization and redaction behave as the plan expects", () => {
  assert.ok(isVocab(PRIVACY_CLASSES, privacyOf("personale (nota); prezzi riservato_azienda", "domanda").cls));
  assert.deepEqual(privacyOf("personale; personale_equipaggio per l'equipaggio", "fonte"), { cls: "personale_equipaggio", healthRule: false });
  assert.deepEqual(privacyOf("escluso_sanitario", "domanda"), { cls: "riservato_azienda", healthRule: true });
  assert.deepEqual(privacyOf("escluso_sanitario; personale", "fonte"), { cls: "personale", healthRule: false });
  assert.deepEqual(privacyOf(null, "campo"), { cls: "riservato_azienda", healthRule: false });
  assert.deepEqual(basicRedact("Scrivi a nome.cognome@esempio.test o al +39 333 1234567, chiedi a Anna Prova.", ["Anna Prova"]), {
    text: "Scrivi a [referente] o al [referente], chiedi a [referente].",
    count: 3,
  });
});
