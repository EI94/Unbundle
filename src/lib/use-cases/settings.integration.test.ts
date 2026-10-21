import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// Impostazioni › Valutazione (docs/use-case/PIANO-LAVORI.md H3d; docs/use-case/DESIGN.md
// §7.2 «Fasce del workspace», §7.6, §10.6, §14.2, §14.3): src/lib/use-cases/settings-data.ts,
// cioè le scritture dietro le server action di src/lib/actions/use-case-settings.ts.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del
//   pacchetto hub_<id> su 127.0.0.1) gira sul database di prova.
// - Dentro `npm run check` si salta: in testa solo moduli di Node; i moduli dell'app arrivano
//   con `await import()` dentro `before()`.
// Dati sintetici, creati e cancellati qui. Il nome predefinito del team si confronta con la
// costante, mai con il suo valore.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type Data = typeof import("./settings-data.ts");
type Bands = typeof import("./cost-bands.ts");
type Codes = typeof import("../db/queries/use-case-codes.ts");
type Settings = typeof import("./settings.ts");
type ReviewTeam = typeof import("../review-team.ts");

let data: Data;
let bands: Bands;
let codes: Codes;
let settings: Settings;
let reviewTeam: ReviewTeam;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  wsA: randomUUID(),
  wsB: randomUUID(),
  wsC: randomUUID(),
  /** Workspace con l'area spenta (fuori da `USE_CASE_HUB_WORKSPACES`). */
  wsOff: randomUUID(),
  manager: randomUUID(),
  lead: randomUUID(),
  builder: randomUUID(),
  analyst: randomUUID(),
  contributor: randomUUID(),
  learner: randomUUID(),
  outsider: randomUUID(),
};
type Person = "manager" | "lead" | "builder" | "analyst" | "contributor" | "learner" | "outsider";
const PEOPLE: readonly Person[] = ["manager", "lead", "builder", "analyst", "contributor", "learner", "outsider"];
const ROLES: Partial<Record<Person, string>> = {
  manager: "exec_sponsor",
  lead: "transformation_lead",
  builder: "function_lead",
  analyst: "analyst",
  contributor: "contributor",
  learner: "learner",
};

/** Fasce del workspace, inventate. */
const CUSTOM_BANDS = {
  limits: [15_000, 40_000, 100_000, 200_000],
  labels: ["Fino a 15.000 €", "Da 15.000 a 40.000 €", "Da 40.000 a 100.000 €", "Da 100.000 a 200.000 €", "200.000 € e oltre"],
  topReferenceEur: 300_000,
};

/** Il `config` di un workspace già passato alla v2, con chiavi che la normalizzazione di oggi non conosce. */
const V2_CONFIG = {
  dimensions: {
    impact: [{ id: "efficiency", label: "Efficienza", weight: 1, direction: "higher_better" }],
    feasibility: [{ id: "effort", label: "Sforzo", weight: 1, direction: "lower_better" }],
    esg: [],
  },
  overall: { impact: 0.6, feasibility: 0.4, esg: 0 },
  thresholds: { highImpact: 3.5, highFeasibility: 3.2, midImpact: 2.5, costLowMaxEur: 30_000 },
  scoringVersion: 2,
  costKpiId: "effort",
  costBands: CUSTOM_BANDS,
  chiaveFutura: { tenuta: true },
};
/** D18: 30.000 € della config di prima stanno nella seconda fascia di `CUSTOM_BANDS` (15.001-40.000). */
const LEGACY_BAND = 2;

/** Il modulo del modello come lo manda Impostazioni › Valutazione: KPI, pesi e solo «Valore medio da». */
const MODEL_FORM = { dimensions: V2_CONFIG.dimensions, overall: V2_CONFIG.overall, thresholds: { midImpact: 3 } };
const MODEL_FORM_TEXT = JSON.stringify(MODEL_FORM);

const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0];

/** L'interruttore dell'area (§12.1): acceso per A, B e C, spento per `wsOff`. */
const AREA_ENV = "USE_CASE_HUB_WORKSPACES";
const areaBefore = process.env[AREA_ENV];

async function configOf(workspaceId: string): Promise<Record<string, unknown>> {
  const row = await one(`SELECT config FROM workspace_scoring_models WHERE workspace_id = $1::uuid`, [workspaceId]);
  assert.ok(row, "il workspace ha il modello");
  return row.config as Record<string, unknown>;
}

async function setConfig(workspaceId: string, config: unknown) {
  await q(
    `INSERT INTO workspace_scoring_models (workspace_id, config) VALUES ($1::uuid, $2::jsonb)
     ON CONFLICT (workspace_id) DO UPDATE SET config = EXCLUDED.config`,
    [workspaceId, JSON.stringify(config)],
  );
}

async function prefixOf(workspaceId: string): Promise<Record<string, unknown> | undefined> {
  return one(`SELECT code_prefix, enabled, next_code_seq, slug FROM workspace_connector_configs WHERE workspace_id = $1::uuid`, [workspaceId]);
}

let codeSeq = 1;
/** Una scheda sintetica del workspace, scritta senza passare dal servizio. */
async function seedCard(
  workspaceId: string,
  extra: {
    code?: string | null;
    costEurOnce?: number | null;
    costBand?: number | null;
    customScores?: unknown;
    aiSuggestion?: unknown;
    portfolioKind?: string | null;
    overall?: { impact: number | null; feasibility: number | null; category: string | null };
  } = {},
) {
  const id = randomUUID();
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, cost_eur_once, cost_band, custom_scores,
                            ai_suggestion, overall_impact_score, overall_feasibility_score, category)
     VALUES ($1::uuid, $2::uuid, $3, 'Problema di prova', 'proposed', 'in_review', $4, $5, $6, $7, $8::jsonb,
             $9::jsonb, $10::real, $11::real, $12::use_case_category)`,
    [
      id,
      workspaceId,
      `Scheda di prova H3d ${codeSeq++}`,
      extra.portfolioKind === undefined ? "use_case_ai" : extra.portfolioKind,
      extra.code ?? null,
      extra.costEurOnce ?? null,
      extra.costBand ?? null,
      extra.customScores === undefined ? null : JSON.stringify(extra.customScores),
      extra.aiSuggestion === undefined ? null : JSON.stringify(extra.aiSuggestion),
      extra.overall?.impact ?? null,
      extra.overall?.feasibility ?? null,
      extra.overall?.category ?? null,
    ],
  );
  return id;
}

async function cardOf(id: string) {
  return one(
    `SELECT code, cost_eur_once, cost_band, version, category, overall_impact_score, overall_feasibility_score, overall_score, updated_at,
            (SELECT count(*)::int FROM use_case_events e WHERE e.use_case_id = u.id) AS events
       FROM use_cases u WHERE id = $1::uuid`,
    [id],
  );
}

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}

function refused(result: { ok: boolean; error?: string; fieldErrors?: Record<string, string> }, error: string, label: string) {
  assert.equal(result.ok, false, `${label}: atteso un rifiuto`);
  assert.equal(result.error, error, label);
}

/** Il testo SQL di una richiesta del trasporto HTTP di Neon (il `fetch` globale del preload). */
function queryTextOf(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") return "";
  try {
    const body = JSON.parse(init.body) as { query?: unknown; queries?: { query?: unknown }[] };
    return [body.query, ...(body.queries ?? []).map((item) => item.query)].filter((text) => typeof text === "string").join("\n");
  } catch {
    return "";
  }
}

/**
 * Trattiene la prima query che corrisponde a `pattern` finché non si chiama `release()`:
 * `held` si risolve quando è trattenuta (o fallisce dopo 10 secondi). Le altre query passano.
 * `restore()` rimette il `fetch` del preload com'era. Serve a far correre un salvataggio
 * dentro l'attesa di un altro, sempre nello stesso ordine.
 *
 * Il preload (`scripts/uc-test/local-neon.cjs`) tiene `fetch` dietro un getter e avvolge ogni
 * `fetch` assegnato nel suo trasporto, che risponde da sé alle query: qui si sostituisce la
 * proprietà intera, per tutta l'attesa, e poi si rimette il suo descrittore.
 */
function holdFirstQuery(pattern: RegExp) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const original = globalThis.fetch;
  let release!: () => void;
  let markHeld!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const caught = new Promise<void>((resolve) => (markHeld = resolve));
  let used = false;
  const heldFetch = async function heldFetch(input: RequestInfo | URL, init?: RequestInit) {
    if (!used && pattern.test(queryTextOf(init))) {
      used = true;
      markHeld();
      await gate;
    }
    return original(input, init);
  } as typeof fetch;
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: heldFetch });
  let timer: NodeJS.Timeout | undefined;
  const held = Promise.race([
    caught,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`nessuna query come ${pattern}`)), 10_000);
    }),
  ]).finally(() => clearTimeout(timer));
  return {
    held,
    release: () => release(),
    restore: () => {
      release();
      if (descriptor) Object.defineProperty(globalThis, "fetch", descriptor);
    },
  };
}

/** Il riallineamento di `category` dopo un cambio di «Valore alto da» (settings-data.ts). */
const CATEGORY_REFRESH = /^UPDATE use_cases\s+SET category =/;

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  data = await import("./settings-data.ts");
  bands = await import("./cost-bands.ts");
  codes = await import("../db/queries/use-case-codes.ts");
  settings = await import("./settings.ts");
  reviewTeam = await import("../review-team.ts");

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H3d', $2)`, [ids.org, `hub-h3d-${ids.org}`]);
  await q(
    `INSERT INTO workspaces (id, organization_id, name) VALUES
       ($1::uuid, $5::uuid, 'Prova H3d A'), ($2::uuid, $5::uuid, 'Pianeta Blu'), ($3::uuid, $5::uuid, 'Prova H3d C'), ($4::uuid, $5::uuid, 'Prova H3d spenta')`,
    [ids.wsA, ids.wsB, ids.wsC, ids.wsOff, ids.org],
  );
  process.env[AREA_ENV] = [ids.wsA, ids.wsB, ids.wsC].join(",");
  for (const person of PEOPLE) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [
      ids[person],
      `${person}.${suffix}@cliente.test`,
      `Persona di prova ${person}`,
    ]);
    const role = ROLES[person];
    if (!role) continue;
    for (const workspaceId of [ids.wsA, ids.wsB, ids.wsC, ids.wsOff]) {
      await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [workspaceId, ids[person], role]);
    }
  }
  // A: codici con il prefisso XX e due schede già codificate; B: nessuna riga di configurazione.
  await q(`INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix, next_code_seq) VALUES ($1::uuid, $2, 'XX', 2)`, [
    ids.wsA,
    `hub-h3d-${suffix}`,
  ]);
  await setConfig(ids.wsA, V2_CONFIG);
  await q(`INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix, next_code_seq) VALUES ($1::uuid, $2, 'SP', 0)`, [
    ids.wsOff,
    `hub-h3d-off-${suffix}`,
  ]);
  await setConfig(ids.wsOff, V2_CONFIG);
});

after(async () => {
  if (areaBefore === undefined) delete process.env[AREA_ENV];
  else process.env[AREA_ENV] = areaBefore;
  if (!enabled) return;
  // I workspace portano via schede, Storia, modello e configurazione dei codici.
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB, ids.wsC, ids.wsOff]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [PEOPLE.map((p) => ids[p])]);
});

// ─── Chi salva ───────────────────────────────────────────────────────

test("salva solo chi gestisce il workspace: revisori, contributori, corsisti ed estranei sono rifiutati e non cambia niente", opts, async () => {
  const before = {
    team: await one(`SELECT ai_transformation_team_name FROM workspaces WHERE id = $1::uuid`, [ids.wsA]),
    prefix: await prefixOf(ids.wsA),
    config: await configOf(ids.wsA),
  };
  for (const person of ["builder", "analyst", "contributor", "learner", "outsider"] as const) {
    const userId = ids[person];
    refused(await data.saveReviewTeamName(userId, ids.wsA, "CoE AI"), "permesso_mancante", `${person}: nome`);
    refused(await data.saveCodePrefix(userId, ids.wsA, "ZZ"), "permesso_mancante", `${person}: prefisso`);
    refused(await data.saveThresholds(userId, ids.wsA, { highImpact: "4", costLowBand: "3" }), "permesso_mancante", `${person}: soglie`);
    refused(await data.saveCostBands(userId, ids.wsA, { ...CUSTOM_BANDS, limits: [1, 2, 3, 4], topReferenceEur: 5 }), "permesso_mancante", `${person}: fasce`);
    refused(await data.prepareSettingsModelPayload(userId, ids.wsA, MODEL_FORM_TEXT), "permesso_mancante", `${person}: modello`);
  }
  assert.deepEqual(await one(`SELECT ai_transformation_team_name FROM workspaces WHERE id = $1::uuid`, [ids.wsA]), before.team);
  assert.deepEqual(await prefixOf(ids.wsA), before.prefix);
  assert.deepEqual(await configOf(ids.wsA), before.config);
  // Un id che non è un UUID non arriva al database.
  refused(await data.saveCodePrefix("non-un-id", ids.wsA, "ZZ"), "permesso_mancante", "id non valido");
  refused(await data.saveCodePrefix(ids.manager, "non-un-workspace", "ZZ"), "permesso_mancante", "workspace non valido");
  // Il ruolo si rilegge a ogni scrittura: un revisore promosso salva, declassato no.
  await q(`UPDATE workspace_memberships SET role = 'transformation_lead' WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.wsC, ids.builder]);
  ok(await data.saveReviewTeamName(ids.builder, ids.wsC, "Squadra C"), "promosso");
  await q(`UPDATE workspace_memberships SET role = 'function_lead' WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.wsC, ids.builder]);
  refused(await data.saveReviewTeamName(ids.builder, ids.wsC, "Squadra D"), "permesso_mancante", "declassato");
});

test("area spenta per il workspace: ogni salvataggio risponde area_spenta, anche a chi lo gestisce, e non cambia niente", opts, async () => {
  const before = {
    team: await one(`SELECT ai_transformation_team_name FROM workspaces WHERE id = $1::uuid`, [ids.wsOff]),
    prefix: await prefixOf(ids.wsOff),
    config: await configOf(ids.wsOff),
  };
  for (const person of ["manager", "lead", "contributor"] as const) {
    const userId = ids[person];
    refused(await data.saveReviewTeamName(userId, ids.wsOff, "CoE AI"), "area_spenta", `${person}: nome`);
    refused(await data.saveCodePrefix(userId, ids.wsOff, "ZZ"), "area_spenta", `${person}: prefisso`);
    refused(await data.saveThresholds(userId, ids.wsOff, { highImpact: "4", costLowBand: "3" }), "area_spenta", `${person}: soglie`);
    refused(await data.saveCostBands(userId, ids.wsOff, bands.DEFAULT_COST_BANDS_CONFIG), "area_spenta", `${person}: fasce`);
    refused(await data.prepareSettingsModelPayload(userId, ids.wsOff, MODEL_FORM_TEXT), "area_spenta", `${person}: modello`);
  }
  assert.deepEqual(await one(`SELECT ai_transformation_team_name FROM workspaces WHERE id = $1::uuid`, [ids.wsOff]), before.team);
  assert.deepEqual(await prefixOf(ids.wsOff), before.prefix);
  assert.deepEqual(await configOf(ids.wsOff), before.config);
  // Con l'interruttore vuoto l'area è spenta ovunque.
  const area = process.env[AREA_ENV];
  delete process.env[AREA_ENV];
  try {
    refused(await data.saveReviewTeamName(ids.manager, ids.wsA, "CoE AI"), "area_spenta", "interruttore vuoto");
  } finally {
    process.env[AREA_ENV] = area;
  }
});

// ─── Nome del team (D2) ──────────────────────────────────────────────

test("nome del team: si salva senza spazi; vuoto torna al nome predefinito; troppo lungo si rifiuta", opts, async () => {
  assert.deepEqual(ok(await data.saveReviewTeamName(ids.manager, ids.wsA, "  CoE   AI ")), { teamName: "CoE AI" });
  const saved = await one(`SELECT ai_transformation_team_name AS name FROM workspaces WHERE id = $1::uuid`, [ids.wsA]);
  assert.equal(saved.name, "CoE AI");
  assert.equal(reviewTeam.reviewTeamName({ aiTransformationTeamName: saved.name as string }), "CoE AI");
  assert.equal((await data.loadValuationSettings(ids.wsA))?.teamName, "CoE AI");

  const long = await data.saveReviewTeamName(ids.lead, ids.wsA, "x".repeat(settings.TEAM_NAME_MAX + 1));
  refused(long, "dati_non_validi", "troppo lungo");
  assert.deepEqual(!long.ok && long.fieldErrors, { teamName: settings.TEAM_NAME_ERROR });

  assert.deepEqual(ok(await data.saveReviewTeamName(ids.lead, ids.wsA, "   ")), { teamName: null });
  const cleared = await one(`SELECT ai_transformation_team_name AS name FROM workspaces WHERE id = $1::uuid`, [ids.wsA]);
  assert.equal(cleared.name, null);
  assert.equal(reviewTeam.reviewTeamName({ aiTransformationTeamName: cleared.name as null }), reviewTeam.DEFAULT_REVIEW_TEAM_NAME);
  assert.equal((await data.loadValuationSettings(ids.wsA))?.teamName, "");
});

// ─── Prefisso (D6, §10.6) ────────────────────────────────────────────

test("prefisso: 2-4 lettere; i codici esistenti non cambiano, i nuovi usano il prefisso nuovo", opts, async () => {
  const first = await seedCard(ids.wsA, { code: "XX-0001" });
  const second = await seedCard(ids.wsA, { code: "XX-0002" });
  for (const bad of ["A", "ABCDE", "A1", "ÀB", ""]) {
    const result = await data.saveCodePrefix(ids.manager, ids.wsA, bad);
    refused(result, "dati_non_validi", `«${bad}»`);
    assert.deepEqual(!result.ok && result.fieldErrors, { prefix: settings.CODE_PREFIX_ERROR });
  }
  assert.equal((await prefixOf(ids.wsA))?.code_prefix, "XX", "i rifiuti non scrivono");

  const saved = ok(await data.saveCodePrefix(ids.manager, ids.wsA, "ab"));
  assert.deepEqual(saved, { prefix: "AB", connectorEnabled: false, notes: [settings.VALUATION_SETTINGS_TEXT.codes.help] });
  const row = await prefixOf(ids.wsA);
  assert.equal(row?.code_prefix, "AB");
  assert.equal(row?.next_code_seq, 2, "il contatore continua");
  assert.equal(row?.slug, `hub-h3d-${suffix}`, "lo slug non cambia");
  assert.equal((await cardOf(first))?.code, "XX-0001");
  assert.equal((await cardOf(second))?.code, "XX-0002");
  const third = await seedCard(ids.wsA);
  assert.equal(await codes.assignUseCaseCode(ids.wsA, third), "AB-0003");
  ok(await data.saveCodePrefix(ids.lead, ids.wsA, "ABCD"), "quattro lettere");
  assert.equal((await prefixOf(ids.wsA))?.code_prefix, "ABCD");
});

test("prefisso: con il connettore acceso c'è l'avviso dei due prefissi, nel risultato e nella lettura", opts, async () => {
  assert.equal((await data.loadValuationSettings(ids.wsA))?.codes.connectorEnabled, false);
  await q(`UPDATE workspace_connector_configs SET enabled = true WHERE workspace_id = $1::uuid`, [ids.wsA]);
  try {
    const loaded = await data.loadValuationSettings(ids.wsA);
    assert.equal(loaded?.codes.connectorEnabled, true);
    assert.equal(loaded?.codes.saved, true);
    const saved = ok(await data.saveCodePrefix(ids.manager, ids.wsA, "AC"));
    assert.equal(saved.connectorEnabled, true);
    assert.deepEqual(saved.notes, [settings.VALUATION_SETTINGS_TEXT.codes.help, settings.VALUATION_SETTINGS_TEXT.codes.connector]);
    assert.equal((await prefixOf(ids.wsA))?.enabled, true, "il prefisso non spegne il connettore");
  } finally {
    await q(`UPDATE workspace_connector_configs SET enabled = false WHERE workspace_id = $1::uuid`, [ids.wsA]);
  }
});

test("prefisso: un workspace senza la riga di configurazione parte dal prefisso proposto e la riceve spenta", opts, async () => {
  assert.equal(await prefixOf(ids.wsB), undefined);
  const loaded = await data.loadValuationSettings(ids.wsB);
  assert.deepEqual(loaded?.codes, { prefix: "PB", saved: false, connectorEnabled: false }, "proposto dal nome «Pianeta Blu»");
  const saved = ok(await data.saveCodePrefix(ids.manager, ids.wsB, "PB"));
  assert.equal(saved.prefix, "PB");
  const row = await prefixOf(ids.wsB);
  assert.equal(row?.code_prefix, "PB");
  assert.equal(row?.enabled, false);
  assert.equal(row?.next_code_seq, 0);
  assert.match(String(row?.slug), /^[a-z0-9-]{3,40}$/);
  assert.ok(String(row?.slug).startsWith("pianeta-blu-"), "slug dal nome più l'id");
  assert.equal((await data.loadValuationSettings(ids.wsB))?.codes.saved, true);
});

// ─── Soglie e fasce: solo la loro chiave del `config` (§7.6) ─────────

test("soglie su un workspace v2: cambiano solo «Valore alto da» e «Costo basso fino alla fascia» (D18, al posto della soglia in euro); scoringVersion e le altre chiavi restano", opts, async () => {
  await setConfig(ids.wsA, V2_CONFIG);
  // Prima del salvataggio: la soglia in euro di prima si legge come la fascia che la contiene.
  assert.equal((await data.loadValuationSettings(ids.wsA))?.thresholds.costLowBand, LEGACY_BAND);
  const value = ok(await data.saveThresholds(ids.manager, ids.wsA, { highImpact: "3,8", costLowBand: "2" }));
  assert.deepEqual(value, { highImpact: 3.8, costLowBand: 2 });
  const config = await configOf(ids.wsA);
  assert.deepEqual(config, { ...V2_CONFIG, thresholds: { highImpact: 3.8, highFeasibility: 3.2, midImpact: 2.5, costLowBand: 2 } });
  assert.equal(config.scoringVersion, 2);
  const row = await one(`SELECT updated_by_user_id FROM workspace_scoring_models WHERE workspace_id = $1::uuid`, [ids.wsA]);
  assert.equal(row.updated_by_user_id, ids.manager);
  const loaded = await data.loadValuationSettings(ids.wsA);
  assert.deepEqual(loaded?.thresholds, { highImpact: 3.8, midImpact: 2.5, costLowBand: 2 });

  // Sotto il valore medio, o fuori scala: rifiutate, il config non cambia.
  for (const input of [{ highImpact: "2", costLowBand: "2" }, { highImpact: "7", costLowBand: "2" }, { highImpact: "3", costLowBand: "5" }]) {
    const result = await data.saveThresholds(ids.lead, ids.wsA, input);
    refused(result, "dati_non_validi", JSON.stringify(input));
    assert.ok(!result.ok && result.fieldErrors && Object.keys(result.fieldErrors).length === 1);
  }
  assert.deepEqual(await configOf(ids.wsA), config);
});

test("fasce su un workspace v2: cambia solo costBands; le non valide si rifiutano con l'errore del campo; le predefinite tolgono la chiave", opts, async () => {
  await setConfig(ids.wsA, V2_CONFIG);
  const next = { limits: ["20.000", "50.000", "120.000", "240.000"], labels: ["Piccolo", "Medio", "Grande", "Molto grande", "Enorme"], topReferenceEur: "350.000" };
  const saved = ok(await data.saveCostBands(ids.manager, ids.wsA, next));
  assert.equal(saved.custom, true);
  assert.deepEqual(saved.costBands.map((band) => [band.label, band.toEur, band.referenceEur]), [
    ["Piccolo", 20_000, 20_000],
    ["Medio", 50_000, 50_000],
    ["Grande", 120_000, 120_000],
    ["Molto grande", 240_000, 240_000],
    ["Enorme", null, 350_000],
  ]);
  const config = await configOf(ids.wsA);
  const stored = { limits: [20_000, 50_000, 120_000, 240_000], labels: next.labels, topReferenceEur: 350_000 };
  assert.deepEqual(config, { ...V2_CONFIG, costBands: stored });
  const loaded = await data.loadValuationSettings(ids.wsA);
  assert.deepEqual(loaded?.costBands, bands.resolveCostBands({ costBands: stored }));
  assert.equal(loaded?.customCostBands, true);

  // Non valide: stesso errore del campo dell'editor (validateCostBands), config invariato.
  const cases: Array<[unknown, string, string]> = [
    [{ ...next, limits: ["20.000", "15.000", "120.000", "240.000"] }, "limits.1", bands.COST_BANDS_LIMITS_ERROR],
    [{ ...next, topReferenceEur: "240.000" }, "topReferenceEur", bands.COST_BANDS_TOP_REFERENCE_ERROR],
    [{ ...next, labels: ["", ...next.labels.slice(1)] }, "labels.0", bands.COST_BANDS_LABEL_ERROR],
    [{ ...next, limits: [...next.limits, "300.000"] }, "limits", bands.COST_BANDS_SHAPE_ERROR],
  ];
  for (const [input, field, message] of cases) {
    const result = await data.saveCostBands(ids.lead, ids.wsA, input);
    refused(result, "dati_non_validi", field);
    assert.equal(!result.ok && result.fieldErrors?.[field], message, field);
  }
  assert.deepEqual(await configOf(ids.wsA), config);

  // Le predefinite: la chiave si toglie, il resto resta.
  const reset = ok(await data.saveCostBands(ids.manager, ids.wsA, bands.DEFAULT_COST_BANDS_CONFIG));
  assert.equal(reset.custom, false);
  assert.deepEqual(reset.costBands, bands.COST_BANDS);
  const withoutBands = { ...V2_CONFIG } as Record<string, unknown>;
  delete withoutBands.costBands;
  assert.deepEqual(await configOf(ids.wsA), withoutBands);
  assert.deepEqual((await data.loadValuationSettings(ids.wsA))?.costBands, bands.COST_BANDS);
});

test("un cambio di fasce non riscrive le schede: importo, fascia, version e Storia restano; l'importo trova la fascia nuova, la fascia si rilegge con l'etichetta nuova", opts, async () => {
  await setConfig(ids.wsA, V2_CONFIG);
  const amount = await seedCard(ids.wsA, { costEurOnce: 30_000 });
  const band = await seedCard(ids.wsA, { costBand: 2 });
  const before = [await cardOf(amount), await cardOf(band)];
  // Prima: le fasce del workspace (CUSTOM_BANDS), dove 30.000 € sta nella seconda (da 15.000 a 40.000).
  const old = bands.resolveCostBands(await configOf(ids.wsA));
  assert.equal(bands.bandForAmount(30_000, old), 2);
  // Confini tutti diversi (D15, §7.2): 30.000 € passa alla terza (da 20.000 a 40.000).
  const next = { limits: [10_000, 20_000, 40_000, 80_000], labels: ["Uno", "Due", "Tre", "Quattro", "Cinque"], topReferenceEur: 120_000 };
  ok(await data.saveCostBands(ids.manager, ids.wsA, next));
  assert.deepEqual((await configOf(ids.wsA)).costBands, next, "salvate le fasce nuove");
  // Le schede uguali in tutto: cost_eur_once, cost_band, version, updated_at, Storia.
  assert.deepEqual([await cardOf(amount), await cardOf(band)], before);
  const resolved = bands.resolveCostBands(await configOf(ids.wsA));
  assert.equal(bands.bandForAmount(30_000, resolved), 3, "l'importo trova la sua nuova fascia");
  assert.equal(bands.bandForAmount(30_000, bands.COST_BANDS), 2, "con le fasce predefinite sarebbe la seconda");
  assert.equal(bands.costBandInfo(2, resolved).label, "Due", "la fascia scelta resta la seconda, con l'etichetta nuova");
  assert.notEqual(bands.costBandInfo(2, old).label, "Due");
});

test("un cambio di «Valore alto da» ricalcola la categoria senza far salire version", opts, async () => {
  // Gli overall_* come li scrive il punteggio v1 (Valore 3, sforzo minimo: fattibilità 5).
  const card = await seedCard(ids.wsC, {
    customScores: { impact: { efficiency: 3, profitability: 3 }, feasibility: { effort: 1 }, esg: {} },
    overall: { impact: 3, feasibility: 5, category: "capability_builder" },
  });
  // Fuori dai contributi (portfolio_kind NULL): in v1 il riallineamento non la tocca, come il ricalcolo di oggi.
  const outside = await seedCard(ids.wsC, { portfolioKind: null, overall: { impact: 3, feasibility: 5, category: "not_yet" } });
  ok(await data.saveThresholds(ids.manager, ids.wsC, { highImpact: "3,5", costLowBand: "1" }), "modello creato con le predefinite");
  const before = await cardOf(card);
  const outsideBefore = await cardOf(outside);
  ok(await data.saveThresholds(ids.manager, ids.wsC, { highImpact: "3", costLowBand: "1" }));
  const after = await cardOf(card);
  assert.equal(after?.category, "quick_win", "Valore 3 ≥ 3 e sforzo minimo");
  assert.equal(after?.overall_impact_score, before?.overall_impact_score, "overall_* restano");
  assert.equal(after?.overall_feasibility_score, before?.overall_feasibility_score, "overall_* restano");
  assert.equal(after?.version, before?.version, "category non fa salire version");
  assert.equal(after?.events, before?.events, "nessuna riga di Storia");
  assert.deepEqual(await cardOf(outside), outsideBefore, "v1: fuori dai contributi niente cambia");
  const config = await configOf(ids.wsC);
  assert.equal((config.thresholds as Record<string, unknown>).highImpact, 3);
  assert.ok(Array.isArray((config.dimensions as Record<string, unknown>).impact), "il modello creato tiene le sue dimensioni");
  assert.equal(config.scoringVersion, undefined, "nessuna scrittura di scoringVersion");
});

test("«Valore alto da» su un workspace v2: overall_* restano (anche delle schede valutate solo dall'AI), category segue la soglia, version e Storia no", opts, async () => {
  await setConfig(ids.wsA, V2_CONFIG);
  // Punteggi come li scrive il ricalcolo v2: una scheda valutata solo dall'AI (KPI solo in
  // ai_suggestion), una fuori dai contributi (portfolio_kind NULL), una senza punteggio.
  const aiOnly = await seedCard(ids.wsA, {
    aiSuggestion: { scores: { impact: { efficiency: 4 }, feasibility: { effort: 2 } }, kind: "auto" },
    overall: { impact: 4, feasibility: 4, category: "quick_win" },
  });
  const outside = await seedCard(ids.wsA, { portfolioKind: null, overall: { impact: 3.6, feasibility: 1, category: "strategic_bet" } });
  const unscored = await seedCard(ids.wsA, { overall: { impact: null, feasibility: null, category: "not_yet" } });
  const before = await Promise.all([aiOnly, outside, unscored].map(cardOf));

  ok(await data.saveThresholds(ids.manager, ids.wsA, { highImpact: "4,5", costLowBand: "2" }));
  let after = await Promise.all([aiOnly, outside, unscored].map(cardOf));
  for (const [i, card] of after.entries()) {
    assert.equal(card?.overall_impact_score, before[i]?.overall_impact_score, `scheda ${i}: overall_impact_score resta`);
    assert.equal(card?.overall_feasibility_score, before[i]?.overall_feasibility_score, `scheda ${i}: overall_feasibility_score resta`);
    assert.equal(card?.overall_score, before[i]?.overall_score, `scheda ${i}: overall_score resta`);
    assert.equal(card?.version, before[i]?.version, `scheda ${i}: version resta`);
    assert.equal(card?.events, before[i]?.events, `scheda ${i}: nessuna riga di Storia`);
  }
  assert.deepEqual(
    after.map((card) => card?.category),
    ["capability_builder", "capability_builder", "not_yet"],
    "4 e 3,6 sotto 4,5 ma sopra il medio; senza punteggio sotto ogni soglia",
  );
  assert.equal(after[2]?.updated_at?.toString(), before[2]?.updated_at?.toString(), "una category che non cambia non si riscrive");

  ok(await data.saveThresholds(ids.lead, ids.wsA, { highImpact: "3,5", costLowBand: "2" }));
  after = await Promise.all([aiOnly, outside, unscored].map(cardOf));
  assert.deepEqual(
    after.map((card) => card?.category),
    ["quick_win", "strategic_bet", "not_yet"],
    "fattibilità 4 ≥ 3,2; 1 < 3,2",
  );
  assert.deepEqual(
    after.map((card) => [card?.overall_impact_score, card?.overall_feasibility_score]),
    before.map((card) => [card?.overall_impact_score, card?.overall_feasibility_score]),
  );
  assert.equal((await configOf(ids.wsA)).scoringVersion, 2);
});

test("due salvataggi delle soglie insieme: vince uno dei due, intero, e category segue la soglia salvata", opts, async () => {
  await setConfig(ids.wsA, V2_CONFIG);
  const card = await seedCard(ids.wsA, { overall: { impact: 4, feasibility: 4, category: "quick_win" } });
  for (let round = 0; round < 3; round++) {
    const results = await Promise.all([
      data.saveThresholds(ids.manager, ids.wsA, { highImpact: "3", costLowBand: "1" }),
      data.saveThresholds(ids.lead, ids.wsA, { highImpact: "4,5", costLowBand: "3" }),
    ]);
    for (const result of results) ok(result, `giro ${round}`);
    const thresholds = (await configOf(ids.wsA)).thresholds as Record<string, unknown>;
    const pair = [thresholds.highImpact, thresholds.costLowBand];
    assert.ok(JSON.stringify(pair) === "[3,1]" || JSON.stringify(pair) === "[4.5,3]", `giro ${round}: ${JSON.stringify(pair)}`);
    assert.equal((await cardOf(card))?.category, thresholds.highImpact === 3 ? "quick_win" : "capability_builder", `giro ${round}`);
    // Di nuovo come all'inizio, per il giro dopo.
    ok(await data.saveThresholds(ids.manager, ids.wsA, { highImpact: "3,5", costLowBand: "2" }));
  }
});

test("due salvataggi con lo stesso «Valore alto da» e un «Costo basso fino alla fascia» diverso: il riallineamento del primo, in ritardo, scrive category", opts, async () => {
  await setConfig(ids.wsA, V2_CONFIG);
  // Valore 3,2 e fattibilità 4: sotto 3,5 è capability_builder, da 3 in su quick_win (4 ≥ 3,2).
  const card = await seedCard(ids.wsA, { overall: { impact: 3.2, feasibility: 4, category: "capability_builder" } });
  const hold = holdFirstQuery(CATEGORY_REFRESH);
  try {
    const first = data.saveThresholds(ids.manager, ids.wsA, { highImpact: "3", costLowBand: "1" });
    await hold.held;
    // Il secondo trova già 3: non si riallinea, e cambia solo «Costo basso fino alla fascia».
    ok(await data.saveThresholds(ids.lead, ids.wsA, { highImpact: "3", costLowBand: "2" }), "secondo");
    hold.release();
    ok(await first, "primo");
  } finally {
    hold.restore();
  }
  const thresholds = (await configOf(ids.wsA)).thresholds as Record<string, unknown>;
  assert.deepEqual(thresholds, { highImpact: 3, highFeasibility: 3.2, midImpact: 2.5, costLowBand: 2 });
  assert.equal((await cardOf(card))?.category, "quick_win", "category segue «Valore alto da» salvato");
});

test("v1: una valutazione salvata mentre il riallineamento aspetta resta intera, con la category dei suoi punteggi", opts, async () => {
  // Lo stesso modello in v1: senza `scoringVersion` (JSON.stringify toglie la chiave).
  await setConfig(ids.wsC, { ...V2_CONFIG, scoringVersion: undefined });
  const card = await seedCard(ids.wsC, {
    customScores: { impact: { efficiency: 2 }, feasibility: { effort: 1 }, esg: {} },
    overall: { impact: 2, feasibility: 5, category: "not_yet" },
  });
  const hold = holdFirstQuery(CATEGORY_REFRESH);
  try {
    const save = data.saveThresholds(ids.manager, ids.wsC, { highImpact: "3", costLowBand: "1" });
    await hold.held;
    // Un revisore salva la valutazione nel frattempo, con la category calcolata sulla soglia di prima (3,5).
    await q(
      `UPDATE use_cases SET custom_scores = $2::jsonb, overall_impact_score = 3, overall_feasibility_score = 5, category = 'capability_builder', updated_at = now()
        WHERE id = $1::uuid`,
      [card, JSON.stringify({ impact: { efficiency: 3 }, feasibility: { effort: 1 }, esg: {} })],
    );
    hold.release();
    ok(await save);
  } finally {
    hold.restore();
  }
  const after = await one(`SELECT custom_scores, overall_impact_score, overall_feasibility_score, category FROM use_cases WHERE id = $1::uuid`, [card]);
  assert.deepEqual(after.custom_scores, { impact: { efficiency: 3 }, feasibility: { effort: 1 }, esg: {} }, "la valutazione resta");
  assert.equal(after.overall_impact_score, 3, "overall_* della valutazione, non quelli di prima");
  assert.equal(after.overall_feasibility_score, 5);
  assert.equal(after.category, "quick_win", "dai punteggi della valutazione e dalla soglia nuova: 3 ≥ 3, 5 ≥ 3,2");
});

// ─── Il modulo del modello in Impostazioni ───────────────────────────

test("modulo del modello: «Valore alto da» e «Fattibilità alta da» partono da quelli salvati ora, non dalla pagina; «Valore medio da» non li supera", opts, async () => {
  await setConfig(ids.wsA, V2_CONFIG);
  // La pagina si è aperta con «Valore alto da» 3,5; nel frattempo le «Soglie» salvano 4 (un'altra scheda, un altro manager).
  ok(await data.saveThresholds(ids.lead, ids.wsA, { highImpact: "4", costLowBand: "2" }));
  const config = await configOf(ids.wsA);

  const sent = JSON.parse(ok(await data.prepareSettingsModelPayload(ids.manager, ids.wsA, MODEL_FORM_TEXT)).payload);
  assert.deepEqual(sent, { ...MODEL_FORM, thresholds: { midImpact: 3, highImpact: 4, highFeasibility: 3.2 } });
  // Una POST diretta con le soglie della pagina vecchia: valgono comunque quelle salvate.
  const stale = { ...MODEL_FORM, thresholds: { midImpact: 3, highImpact: 3.5, highFeasibility: 1 } };
  const fromStale = JSON.parse(ok(await data.prepareSettingsModelPayload(ids.manager, ids.wsA, JSON.stringify(stale))).payload);
  assert.deepEqual(fromStale.thresholds, { midImpact: 3, highImpact: 4, highFeasibility: 3.2 });

  // «Valore medio da» sopra «Valore alto da» salvato: l'errore in italiano sotto il campo.
  const above = await data.prepareSettingsModelPayload(ids.manager, ids.wsA, JSON.stringify({ ...MODEL_FORM, thresholds: { midImpact: 4.5 } }));
  refused(above, "dati_non_validi", "sopra il valore alto");
  assert.deepEqual(!above.ok && above.fieldErrors, { "thresholds.midImpact": settings.midImpactAboveHighError(4) });
  assert.ok(ok(await data.prepareSettingsModelPayload(ids.manager, ids.wsA, JSON.stringify({ ...MODEL_FORM, thresholds: { midImpact: 4 } }))), "uguale va bene");
  for (const midImpact of [-1, 7, "3", null]) {
    const result = await data.prepareSettingsModelPayload(ids.manager, ids.wsA, JSON.stringify({ ...MODEL_FORM, thresholds: { midImpact } }));
    refused(result, "dati_non_validi", String(midImpact));
    assert.deepEqual(!result.ok && result.fieldErrors, { "thresholds.midImpact": settings.HIGH_IMPACT_ERROR });
  }
  for (const raw of ["non json", "[]", null]) refused(await data.prepareSettingsModelPayload(ids.manager, ids.wsA, raw), "dati_non_validi", String(raw));
  assert.deepEqual(await configOf(ids.wsA), config, "preparare il modulo non scrive niente");
});

test("lettura: un workspace che non esiste o un id non valido non dà niente", opts, async () => {
  assert.equal(await data.loadValuationSettings(randomUUID()), null);
  assert.equal(await data.loadValuationSettings("non-un-id"), null);
});
