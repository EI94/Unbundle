/**
 * Controlli sui file privati del primo caso reale (template v1.0.0 grezzo e
 * seed), solo conteggi strutturali (PIANO §4.6, §8.2). I file non sono in git:
 * il test si salta quando mancano. Percorsi da `UC_PRIVATE_TEMPLATE_PATH` e
 * `UC_PRIVATE_SEED_PATH`, oppure il primo `template-*.json` e `seed-caso-*.json`
 * nella cartella `UC_PRIVATE_DOCS_DIR` (default: `docs/casi-duso/` della
 * checkout). I file si leggono con `fs`, mai importati; nessun valore del
 * cliente compare qui.
 *
 * L'adattatore qui sotto riproduce solo le regole del normalizzatore che
 * servono ai blocchi e al gate (§4.2): token di classe più restrittivo,
 * disponibilità come insieme di token, primo token del perimetro, eccezioni
 * sanitarie. Tutti i vocabolari si leggono dal file stesso.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { blockerLinksForItem, initialBlockerStatus, parseBlockerScope, type BlockerDef, type ItemBlockerFacts } from "./blockers.ts";
import { DEFAULT_GATE_POLICY, gateScopeForItem, requiredItems, type CoverageLink, type GateItem } from "./gates.ts";
import { computeReadiness, gateLineText } from "./semaforo.ts";
import {
  ITEM_STATUSES,
  LINK_RELATIONS,
  PERIMETERS,
  PHASES,
  PRIORITIES,
  PRIVACY_CLASSES,
  isVocab,
  type GatePolicyScope,
  type ItemKind,
  type ItemStatus,
  type Perimeter,
  type PrivacyClass,
} from "./vocab.ts";

const DIR = process.env.UC_PRIVATE_DOCS_DIR || fileURLToPath(new URL("../../../docs/casi-duso/", import.meta.url));

function privateFile(envName: string, pattern: RegExp): string | null {
  const explicit = process.env[envName];
  if (explicit) return existsSync(explicit) ? explicit : null;
  if (!existsSync(DIR)) return null;
  const name = readdirSync(DIR).filter((f) => pattern.test(f)).sort()[0];
  return name ? join(DIR, name) : null;
}

const TEMPLATE_PATH = privateFile("UC_PRIVATE_TEMPLATE_PATH", /^template-.+\.json$/);
const SEED_PATH = privateFile("UC_PRIVATE_SEED_PATH", /^seed-caso-.+\.json$/);
const SKIP = TEMPLATE_PATH ? false : "file privato del template assente";
const SKIP_SEED = TEMPLATE_PATH && SEED_PATH ? false : "file privati assenti";

type Raw = Record<string, unknown>;

interface Loaded {
  vocab: { availability: string[]; perimeterIn: string; perimeterOut: string };
  items: (ItemBlockerFacts & { key: string; requestModuleKey: string | null; raw: Raw })[];
  defs: BlockerDef[];
}

let cache: Loaded | null = null;

function tokensIn(text: unknown, vocab: readonly string[]): string[] {
  if (typeof text !== "string") return [];
  return vocab.filter((t) => new RegExp(`(?<![a-z0-9_])${t}(?![a-z0-9_])`).test(text));
}

function privacyOf(raw: Raw, kind: ItemKind): PrivacyClass {
  const found = tokensIn(raw.privacy_class, PRIVACY_CLASSES) as PrivacyClass[];
  if (found.length === 0) return "riservato_azienda";
  const sorted = [...found].sort((a, b) => PRIVACY_CLASSES.indexOf(a) - PRIVACY_CLASSES.indexOf(b));
  if (sorted[0] === "escluso_sanitario") {
    // Domande sulla regola di esclusione (non sul dato): riservate, con health_rule_question.
    if (kind === "domanda") return "riservato_azienda";
    const personal = sorted.find((c) => c === "personale_equipaggio" || c === "personale");
    if (personal) return personal;
  }
  return sorted[0];
}

function load(): Loaded {
  if (cache) return cache;
  const t = JSON.parse(readFileSync(TEMPLATE_PATH!, "utf8")) as Raw;
  const v = t.vocabularies as { availability: string[]; perimeter: { in: string; out: string } };
  const perimeterOf = (text: unknown): Perimeter | null => {
    if (typeof text !== "string") return null;
    const first = /^[a-z_]+/.exec(text)?.[0];
    return first === v.perimeter.in ? "in_contratto" : first === v.perimeter.out ? "evoluzione" : null;
  };
  const moduleOf = new Map<string, string>();
  for (const m of t.request_modules as Raw[]) {
    const keys = Array.isArray(m.items) ? (m.items as string[]) : (JSON.parse(String(m.items)) as string[]);
    for (const k of keys) moduleOf.set(k, String(m.key));
  }
  const defs: BlockerDef[] = (t.blockers as Raw[]).map((b) => ({
    key: String(b.key),
    scope: parseBlockerScope({
      privacy_classes: b.blocks_privacy_class,
      availability: b.blocks_availability,
      perimeters: ((b.blocks_perimeter as string[] | undefined) ?? []).map((p) => (p === v.perimeter.out ? "evoluzione" : p === v.perimeter.in ? "in_contratto" : p)),
      real_data: b.blocks_real_data === true,
    }),
    permanent: b.permanent === true,
  }));
  const items = (t.items as Raw[]).map((raw) => {
    const kind = raw.kind as ItemKind;
    return {
      key: String(raw.key),
      kind,
      privacyClass: privacyOf(raw, kind),
      availability: tokensIn(raw.availability, v.availability),
      perimeter: perimeterOf(raw.perimeter),
      explicitBlockedBy: Array.isArray(raw.blocked_by) ? (raw.blocked_by as string[]) : [],
      requestModuleKey: moduleOf.get(String(raw.key)) ?? null,
      raw,
    };
  });
  cache = { vocab: { availability: v.availability, perimeterIn: v.perimeter.in, perimeterOut: v.perimeter.out }, items, defs };
  return cache;
}

test("real template: privacy classes after normalization", { skip: SKIP }, () => {
  const { items } = load();
  const counts = Object.fromEntries(PRIVACY_CLASSES.map((c) => [c, items.filter((i) => i.privacyClass === c).length]));
  assert.deepEqual(counts, { escluso_sanitario: 0, personale_equipaggio: 114, personale: 133, riservato_azienda: 1215, nessuna: 1350 });
  assert.ok(items.every((i) => i.perimeter === null || isVocab(PERIMETERS, i.perimeter)));
});

test("real template: blocker links at case creation (508 + 19, 38 items with two locks)", { skip: SKIP }, () => {
  const { items, defs } = load();
  assert.deepEqual(defs.map((d) => [d.key, initialBlockerStatus(d)]).sort(), [
    ["a8", "attivo"], ["accesso_sistema", "attivo"], ["costi_art_8_4", "attivo"], ["decisione_board", "attivo"], ["fuori_foundation", "attivo"], ["sanitario", "permanente"],
  ]);
  const perKey = new Map<string, number>();
  let otherLinks = 0;
  let twoLocks = 0;
  let threeLocks = 0;
  let questionLinks = 0;
  let questionsBlocked = 0;
  let othersBlocked = 0;
  for (const item of items) {
    const links = blockerLinksForItem(item, defs);
    if (item.kind === "domanda") {
      questionLinks += links.length;
      if (links.length > 0) {
        questionsBlocked++;
        assert.deepEqual(links.map((l) => l.key), ["a8"], item.key);
      }
      continue;
    }
    otherLinks += links.length;
    if (links.length > 0) othersBlocked++;
    if (links.length === 2) twoLocks++;
    if (links.length >= 3) threeLocks++;
    for (const l of links) perKey.set(l.key, (perKey.get(l.key) ?? 0) + 1);
  }
  assert.equal(otherLinks, 508);
  assert.deepEqual(Object.fromEntries([...perKey].sort()), { a8: 307, accesso_sistema: 120, decisione_board: 57, fuori_foundation: 24 });
  assert.equal(twoLocks, 38);
  assert.equal(threeLocks, 0);
  assert.equal(questionLinks, 19);
  // Initial states: questions 458 + 19 blocked, other items 1,865 + 470 blocked.
  const questions = items.filter((i) => i.kind === "domanda").length;
  assert.equal(questions - questionsBlocked, 458);
  assert.equal(questionsBlocked, 19);
  assert.equal(items.length - questions - othersBlocked, 1865);
  assert.equal(othersBlocked, 470);
});

test("real seed: the 19 blocked questions are exactly the a8 ones", { skip: SKIP_SEED }, () => {
  const { items, defs } = load();
  const seed = JSON.parse(readFileSync(SEED_PATH!, "utf8")) as { answers: { item_key: string; initial_state: string }[] };
  const byKey = new Map(items.map((i) => [i.key, i]));
  const blocked = seed.answers.filter((a) => a.initial_state === "bloccata").map((a) => a.item_key).sort();
  const locked = seed.answers.filter((a) => blockerLinksForItem(byKey.get(a.item_key)!, defs).length > 0).map((a) => a.item_key).sort();
  assert.equal(blocked.length, 19);
  assert.deepEqual(locked, blocked);
});


/** Voci per il gate come le crea il caso con la regola indicata; stato dal seed per le domande, se c'è. */
function gateItems(scope: GatePolicyScope, statusOf: (key: string) => ItemStatus | null = () => null): { items: GateItem[]; links: CoverageLink[] } {
  const { items, defs } = load();
  const out: GateItem[] = [];
  const links: CoverageLink[] = [];
  for (const item of items) {
    const raw = item.raw;
    const g = gateScopeForItem(
      {
        requestModuleKey: item.requestModuleKey,
        servesFor: Array.isArray(raw.serves_for) ? (raw.serves_for as unknown[]).filter((p): p is (typeof PHASES)[number] => isVocab(PHASES, p)) : [],
        perimeter: item.perimeter,
      },
      { ...DEFAULT_GATE_POLICY, scope },
    );
    const blockers = blockerLinksForItem(item, defs).map((l) => l.key);
    out.push({
      id: item.key,
      key: item.key,
      kind: item.kind,
      status: statusOf(item.key) ?? (blockers.length > 0 ? "bloccata" : "da_chiedere"),
      priority: isVocab(PRIORITIES, raw.priority) ? raw.priority : null,
      perimeter: g.perimeter,
      servesFor: g.servesFor,
      inGateScope: g.inGateScope,
      defaultsApplied: g.defaultsApplied,
      privacyClass: item.privacyClass,
      responseType: null,
      requestModuleKey: item.requestModuleKey,
      ownerRoleKey: null,
      responderRoleKey: null,
      confirmedByRoleKey: null,
      answerTextHash: null,
      answerVersion: null,
      staleAt: null,
      naApprovedAt: null,
      waiver: null,
      waiverApprovedAt: null,
      fallback: null,
      fallbackApprovedAt: null,
      activeBlockerKeys: blockers,
      openClarification: false,
    });
    for (const l of (raw.links as Raw[] | undefined) ?? []) {
      if (isVocab(LINK_RELATIONS, l.rel) && typeof l.to === "string") links.push({ fromItemId: item.key, toItemId: l.to, relation: l.rel });
    }
  }
  return { items: out, links };
}

test("real template: R(G1) is 245 with request_modules (default), 484 literal, 729 union", { skip: SKIP }, () => {
  assert.equal(DEFAULT_GATE_POLICY.scope, "request_modules");
  assert.equal(requiredItems(gateItems("request_modules").items, "G1").length, 245);
  assert.equal(requiredItems(gateItems("letterale").items, "G1").length, 484);
  assert.equal(requiredItems(gateItems("unione").items, "G1").length, 729);
  assert.ok(requiredItems(gateItems("request_modules").items, "G1").every((i) => i.kind === "domanda"));
  assert.ok(requiredItems(gateItems("letterale").items, "G1").every((i) => i.kind === "campo" || i.kind === "kpi"));
});

test("real seed: header 477 = 295/160/19/3, G1 closed with 245 must items missing, coverage 181 of 484", { skip: SKIP_SEED }, () => {
  const seed = JSON.parse(readFileSync(SEED_PATH!, "utf8")) as { answers: { item_key: string; initial_state: string }[] };
  const initial = new Map(seed.answers.map((a) => [a.item_key, a.initial_state]));
  const { items, links } = gateItems("request_modules", (key) => {
    const s = initial.get(key);
    return isVocab(ITEM_STATUSES, s) ? s : null;
  });
  const { readiness, g1, coverage } = computeReadiness({
    items,
    links,
    datasets: [],
    blockers: [],
    now: new Date("2026-10-07T10:00:00Z"),
    catalogRevision: 0,
    caseCode: "CASO-1",
    caseStatus: "raccolta",
    statusBeforeSuspension: null,
    policy: { scope: "request_modules" },
  });
  assert.equal(readiness.scope_total, 477);
  assert.deepEqual(
    Object.fromEntries(Object.entries(readiness.per_stato).filter(([, n]) => n > 0)),
    { da_chiedere: 295, mancante: 3, in_verifica: 160, bloccata: 19 },
  );
  assert.equal(readiness.green_pct, 0);
  assert.deepEqual(readiness.G1, { required: 245, ok: 0, ready: false, should: g1.should, waivers: { used: 0, cap: 24 } });
  assert.equal(g1.missing.length, 245);
  assert.deepEqual(
    Object.fromEntries(Object.entries(g1.byStatus).filter(([, n]) => n > 0)),
    { da_chiedere: 137, mancante: 3, in_verifica: 95, bloccata: 10 },
  );
  assert.deepEqual(readiness.coverage_model, { literal_required: 484, covered_by_questions: 181, ok: 0 });
  assert.equal(coverage.uncovered.length, 484 - 181);
  assert.equal(gateLineText(g1), "Per avviare lo sviluppo servono verdi le 245 voci obbligatorie: ora 0.");
});
