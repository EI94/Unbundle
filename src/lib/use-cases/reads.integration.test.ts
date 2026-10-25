import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import * as nodeModule from "node:module";

/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult;
  }): void;
};

// Letture, viste e proiezioni dell'area «Use case» (docs/use-case/PIANO-LAVORI.md H2b e
// §5.4; docs/use-case/DESIGN.md §4.10, §6.9, §9.3, §11, §12.5):
// src/lib/db/queries/use-case-hub.ts, il riepilogo minimo di use-case-dossiers.ts, le GET
// REST e l'export.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del
//   pacchetto hub_<id> su 127.0.0.1) gira sul database di prova.
// - Dentro `npm run check` si salta: in testa solo moduli di Node; i moduli dell'app
//   arrivano con `await import()` dentro `before()`.
// - Le rotte REST e l'export si chiamano davvero: `@/lib/auth` diventa, solo in questo
//   processo di prova, un modulo che restituisce la sessione scelta dalla prova
//   (`globalThis.__hubReadsSession`). Ruolo e accesso si rileggono dal database come in
//   produzione.
// Alcune prove cambiano lo schema uc per un momento (tabella o colonna rinominata) e lo
// rimettono com'era in `finally`: per questo girano solo sul database del pacchetto.
// Dati sintetici, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) {
    throw new Error("This suite changes the uc schema for a moment: run it only on a package database hub_<id>");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type Hub = typeof import("../db/queries/use-case-hub.ts");
type Views = typeof import("./views.ts");
type Xlsx = typeof import("xlsx");
type RouteGet = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

let hub: Hub;
let views: Views;
let XLSX: Xlsx;
let listGet: RouteGet;
let itemGet: RouteGet;
let exportGet: RouteGet;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  wsA: randomUUID(),
  wsB: randomUUID(),
  template: randomUUID(),
  ls: randomUUID(),
  builder: randomUUID(),
  manager: randomUUID(),
  contributor: randomUUID(),
  learner: randomUUID(),
  outsider: randomUUID(),
};
const emails = {
  ls: `ls.${suffix}@ls.test`,
  builder: `builder.${suffix}@cliente.test`,
  manager: `manager.${suffix}@cliente.test`,
  contributor: `contributor.${suffix}@cliente.test`,
  learner: `learner.${suffix}@cliente.test`,
  outsider: `outsider.${suffix}@cliente.test`,
};
type Person = keyof typeof emails;
const names: Record<Person, string> = {
  ls: "Persona di prova LS",
  builder: "Persona di prova AI Builder",
  manager: "Persona di prova sponsor",
  contributor: "Persona di prova contributore",
  learner: "Persona di prova corsista",
  outsider: "Persona di prova esterna",
};
/** Chi ha proposto le schede «altrui»: un recapito che non deve mai uscire verso revisori e contributori. */
const OTHER_EMAIL = `altra.persona.${suffix}@cliente.test`;
const SUBMITTER_EMAIL = `segnalante.${suffix}@cliente.test`;
const INTERNAL_NOTE = `Nota interna di prova ${suffix}`;
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "VERCEL_ENV"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

/** Fasce del costo del workspace A, diverse dalle predefinite (D15). */
const BANDS_A = {
  limits: [15_000, 40_000, 90_000, 200_000],
  labels: ["Piccolo", "Medio", "Grande", "Molto grande", "Enorme"],
  topReferenceEur: 300_000,
};

/** Ogni grafia dei campi sul proponente (DESIGN §12.5 test 1). */
const PERSON_KEY = /proposed_?by|submitter_?email|submitted_?by_?user_?id/i;
const CONTRIBUTOR_KEYS = ["id", "title", "phase", "subState", "phaseLabel", "quando", "own"].sort();
const OWN_KEYS = [...CONTRIBUTOR_KEYS, "code", "publicNote"].sort();

let codeSeq = 6000;

interface Seed {
  workspaceId?: string;
  title?: string;
  status?: string;
  review?: string;
  kind?: string | null;
  origin?: string;
  intake?: Record<string, unknown> | null;
  publicNote?: string | null;
  reviewedBy?: string | null;
  targetQuarter?: string | null;
  reviewBy?: string | null;
  customScores?: Record<string, unknown> | null;
  source?: string | null;
  proposedBy?: string | null;
  valueEurYear?: number | null;
  costEurOnce?: number | null;
  costBand?: number | null;
  overallScore?: number | null;
  submittedAt?: string | null;
}

/** Una scheda sintetica, scritta senza passare dal servizio. */
async function seed(s: Seed = {}): Promise<{ id: string; code: string; title: string }> {
  const id = randomUUID();
  const code = `XX-${codeSeq++}`;
  const title = s.title ?? `Use case di prova ${code}`;
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, origin, code,
       intake, public_note, reviewed_by, target_quarter, review_by, custom_scores, source, proposed_by, value_eur_year,
       cost_eur_once, cost_band, overall_score, overall_impact_score, review_notes, submitted_at)
     VALUES ($1::uuid, $2::uuid, $3, 'Problema di prova', $4::use_case_status, $5::portfolio_review_status, $6, $7, $8,
       $9::jsonb, $10, $11::uuid, $12, $13::date, $14::jsonb, $15, $16, $17, $18, $19, $20, $20, $21, coalesce($22::timestamp, now()))`,
    [
      id,
      s.workspaceId ?? ids.wsA,
      title,
      s.status ?? "proposed",
      s.review ?? "in_review",
      s.kind === undefined ? "use_case_ai" : s.kind,
      s.origin ?? "adoption",
      code,
      s.intake === undefined ? null : JSON.stringify(s.intake),
      s.publicNote ?? null,
      s.reviewedBy ?? null,
      s.targetQuarter ?? null,
      s.reviewBy ?? null,
      s.customScores === undefined ? null : JSON.stringify(s.customScores),
      s.source === undefined ? "web_proposed" : s.source,
      s.proposedBy === undefined ? OTHER_EMAIL : s.proposedBy,
      s.valueEurYear ?? null,
      s.costEurOnce ?? null,
      s.costBand ?? null,
      s.overallScore ?? null,
      INTERNAL_NOTE,
      s.submittedAt ?? null,
    ],
  );
  return { id, code, title };
}

const HIGH = { impact: { efficiency: 4, profitability: 4 } };

/** Le schede del workspace A (area accesa) e B (area spenta), create in `before()`. */
const cards = {} as Record<
  | "othersVisible"
  | "othersHidden"
  | "ownByEmail"
  | "ownById"
  | "slack"
  | "withDossier"
  | "reopened"
  | "realized"
  | "duplicate"
  | "band"
  | "bVisible"
  | "bHidden"
  | "bOwn",
  { id: string; code: string; title: string }
>;
let dossierId: string;

function viewer(person: Person) {
  const role: Record<Person, string | null> = {
    ls: "transformation_lead",
    builder: "function_lead",
    manager: "exec_sponsor",
    contributor: "contributor",
    learner: "learner",
    outsider: null,
  };
  return hub.viewerFromSession({ id: ids[person], email: emails[person], emailVerified: true }, role[person]);
}

function signIn(person: Person | null): void {
  (globalThis as { __hubReadsSession?: unknown }).__hubReadsSession = person
    ? { user: { id: ids[person], email: emails[person], emailVerified: true, name: names[person], image: null } }
    : null;
}

function call(route: RouteGet, path: string, params: Record<string, string>): Promise<Response> {
  return route(new Request(`http://127.0.0.1${path}`), { params: Promise.resolve(params) });
}

/** Tutte le chiavi di un valore, a ogni profondità. */
function keysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) keysDeep(item, out);
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, inner] of Object.entries(value)) {
      out.push(key);
      keysDeep(inner, out);
    }
  }
  return out;
}

function personKeys(value: unknown): string[] {
  return keysDeep(value).filter((key) => PERSON_KEY.test(key));
}

/** Sezione Casi d'uso accesa per il workspace A (fuori produzione). */
function ucOn() {
  process.env.UC_ENABLED = "true";
  process.env.UC_WORKSPACE_IDS = ids.wsA;
  delete process.env.VERCEL_ENV;
}

function ucOff() {
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
}

before(async () => {
  if (!enabled) return;
  // `@/lib/auth` legge i cookie di Next: qui restituisce la sessione della prova.
  const authStub = `data:text/javascript,${encodeURIComponent("export async function auth() { return globalThis.__hubReadsSession ?? null; }")}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@/lib/auth") return { url: authStub, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  hub = await import("../db/queries/use-case-hub.ts");
  views = await import("./views.ts");
  XLSX = await import("xlsx");
  listGet = (await import("../../app/api/workspaces/[workspaceId]/use-cases/route.ts")).GET as unknown as RouteGet;
  itemGet = (await import("../../app/api/workspaces/[workspaceId]/use-cases/[useCaseId]/route.ts")).GET as unknown as RouteGet;
  exportGet = (await import("../../app/(dashboard)/dashboard/[workspaceId]/portfolio/export/route.ts")).GET as unknown as RouteGet;

  process.env.USE_CASE_HUB_WORKSPACES = ids.wsA;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  ucOff();

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H2b', $2)`, [ids.org, `hub-h2b-${ids.org}`]);
  await q(
    `INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova H2b A'), ($2::uuid, $3::uuid, 'Prova H2b B')`,
    [ids.wsA, ids.wsB, ids.org],
  );
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], names[person]]);
  }
  const memberships: Array<[string, Person, string]> = [
    [ids.wsA, "ls", "transformation_lead"],
    [ids.wsA, "builder", "function_lead"],
    [ids.wsA, "manager", "exec_sponsor"],
    [ids.wsA, "contributor", "contributor"],
    [ids.wsA, "learner", "learner"],
    [ids.wsB, "builder", "function_lead"],
    [ids.wsB, "manager", "exec_sponsor"],
    [ids.wsB, "contributor", "contributor"],
  ];
  for (const [workspaceId, person, role] of memberships) {
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [workspaceId, ids[person], role]);
  }
  await q(`INSERT INTO workspace_scoring_models (workspace_id, impact_flag_enabled, config) VALUES ($1::uuid, false, $2::jsonb)`, [
    ids.wsA,
    JSON.stringify({ costBands: BANDS_A }),
  ]);
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova H2b', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.hub_h2b_${suffix}`, randomBytes(32).toString("hex"), ids.wsA],
  );

  cards.othersVisible = await seed({
    title: "Proposta altrui visibile",
    status: "accepted",
    targetQuarter: "2027-Q1",
    publicNote: "Nota pubblica altrui",
    customScores: HIGH,
    costEurOnce: 40_000,
    valueEurYear: 60_000,
    overallScore: 4.5,
    source: "claude_connector",
    intake: { submitterEmail: SUBMITTER_EMAIL, area: "Finanza", frequency: "giornaliera", beneficiaries: 3, timeSavedMinutesPerRun: 15 },
  });
  cards.othersHidden = await seed({ title: "Proposta altrui nascosta", origin: "transformation", source: "manual", intake: { hiddenFromSearch: true }, proposedBy: ids.builder });
  cards.ownByEmail = await seed({
    title: "Mia proposta per email",
    review: "needs_inputs",
    reviewedBy: ids.ls,
    publicNote: "Quante richieste arrivano a settimana?",
    proposedBy: emails.contributor.toUpperCase(),
  });
  cards.ownById = await seed({
    title: "Mia proposta per id, nascosta",
    origin: "transformation",
    source: "learning",
    intake: { hiddenFromSearch: true },
    publicNote: "Nota sulla mia proposta",
    proposedBy: ids.contributor,
  });
  cards.slack = await seed({ title: "Proposta da Slack", source: "slack_proposed", proposedBy: "U0SLACK123" });
  cards.withDossier = await seed({ title: "Approvata con dossier", status: "accepted", targetQuarter: "2026-Q4", customScores: HIGH, costEurOnce: 20_000 });
  cards.reopened = await seed({ title: "Riaperta", submittedAt: "2026-08-01 10:00:00" });
  cards.realized = await seed({ title: "Realizzata", status: "implemented", valueEurYear: 30_000 });
  cards.duplicate = await seed({ title: "Doppione", review: "archived", intake: { archiveReason: "duplicato", duplicateOfCode: "XX-0007" } });
  cards.band = await seed({ title: "Con fascia", review: "scored", customScores: HIGH, costBand: 2 });
  cards.bVisible = await seed({ workspaceId: ids.wsB, title: "Workspace spento, visibile", review: "scored", customScores: HIGH, costEurOnce: 30_000, overallScore: 4, publicNote: "Nota B" });
  cards.bHidden = await seed({ workspaceId: ids.wsB, title: "Workspace spento, nascosta", origin: "transformation", intake: { hiddenFromSearch: true } });
  cards.bOwn = await seed({ workspaceId: ids.wsB, title: "Workspace spento, mia", proposedBy: ids.contributor, publicNote: "Nota mia B" });

  dossierId = randomUUID();
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at, readiness)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova H2b', 'raccolta', now(), $7::jsonb)`,
    [dossierId, ids.wsA, ids.org, cards.withDossier.id, ids.template, cards.withDossier.code, JSON.stringify({ G1: { required: 245, ok: 12, ready: false } })],
  );
  // Storia: un «Riapri» e un «Segna come realizzato» (righe della Storia, senza testi).
  await q(
    `INSERT INTO use_case_events (workspace_id, use_case_id, at, actor_user_id, actor_kind, channel, action, fields, phase_before, phase_after)
     VALUES ($1::uuid, $2::uuid, '2026-10-09 23:30:00+00', $4::uuid, 'persona', 'pagina', 'decisione', '{}', 'chiuso.non_avviato', 'da_valutare.nuova'),
            ($1::uuid, $3::uuid, '2026-09-20 10:00:00+00', $4::uuid, 'persona', 'pagina', 'decisione', '{}', 'in_realizzazione.senza_dossier', 'realizzato.realizzato')`,
    [ids.wsA, cards.reopened.id, cards.realized.id, ids.ls],
  );
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  (globalThis as { __hubReadsSession?: unknown }).__hubReadsSession = undefined;
  if (!enabled) return;
  // I workspace portano via schede, Storia, dossier, template ristretto e modello di valutazione.
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

// ─── listHubItems: i quattro ruoli ───────────────────────────────────

test("listHubItems, contributore: proposte altrui esatte, proprie con codice e nota, nessuna nascosta altrui", opts, async () => {
  const list = await hub.listHubItems(ids.wsA, viewer("contributor"));
  assert.ok(list && list.projection === "contributore");
  assert.deepEqual(Object.keys(list).sort(), ["dossierRead", "items", "projection", "receipt", "today"]);
  const byId = new Map(list.items.map((item) => [item.id, item]));
  assert.equal(byId.has(cards.othersHidden.id), false, "nascosta e non sua");
  assert.equal(byId.has(cards.bVisible.id), false, "solo il workspace chiesto");
  for (const item of list.items) {
    assert.deepEqual(Object.keys(item).sort(), item.own ? OWN_KEYS : CONTRIBUTOR_KEYS, item.title);
  }
  const visible = byId.get(cards.othersVisible.id);
  assert.deepEqual(visible, {
    id: cards.othersVisible.id,
    title: cards.othersVisible.title,
    phase: "approvato",
    subState: "trimestre",
    phaseLabel: "Approvato · T1 2027",
    quando: "T1 2027",
    own: false,
  });
  const byEmail = byId.get(cards.ownByEmail.id);
  assert.ok(byEmail?.own === true);
  assert.equal(byEmail.code, cards.ownByEmail.code);
  assert.equal(byEmail.publicNote, "Quante richieste arrivano a settimana?");
  const ownHidden = byId.get(cards.ownById.id);
  assert.ok(ownHidden?.own === true, "una propria proposta resta visibile anche se nascosta alla ricerca");
  assert.equal(ownHidden.code, cards.ownById.code);
  assert.equal(byId.get(cards.duplicate.id)?.phaseLabel, "Chiuso · Doppione", "mai il codice dell'altra scheda");
  const text = JSON.stringify(list);
  for (const secret of [OTHER_EMAIL, SUBMITTER_EMAIL, INTERNAL_NOTE, "Nota pubblica altrui", cards.othersVisible.code, "€"]) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test("listHubItems, revisori e chi gestisce: tutto tranne il proponente, con le fasce del workspace", opts, async () => {
  for (const person of ["builder", "ls", "manager"] as const) {
    const list = await hub.listHubItems(ids.wsA, viewer(person));
    assert.ok(list && list.projection !== "contributore", person);
    assert.equal(list.projection, person === "builder" ? "revisore" : "gestore", person);
    assert.deepEqual(personKeys(list.items), [], person);
    const text = JSON.stringify(list.items);
    assert.equal(text.includes(OTHER_EMAIL), false, person);
    assert.equal(text.includes(SUBMITTER_EMAIL), false, person);
    const all = new Set(list.items.map((item) => item.id));
    for (const card of [cards.othersHidden, cards.ownById, cards.othersVisible]) assert.ok(all.has(card.id), `${person}: ${card.title}`);
    assert.equal(all.has(cards.bVisible.id), false);
    assert.deepEqual(list.costBands.map((band) => band.label), BANDS_A.labels, "fasce del workspace (D15)");
    const band = list.items.find((item) => item.id === cards.band.id)!;
    assert.equal(band.cost?.bandLabel, "Medio");
    assert.equal(band.cost?.referenceEur, 40_000);
    const visible = list.items.find((item) => item.id === cards.othersVisible.id)!;
    assert.equal(visible.code, cards.othersVisible.code);
    assert.equal(visible.publicNote, "Nota pubblica altrui");
    assert.equal(visible.claudeHoursPerYear, 180);
    assert.equal(visible.value.word, "alto");
  }
});

test("listHubItems: chi non entra nell'area non riceve nulla; la ricevuta solo a chi ha proposto", opts, async () => {
  assert.equal(await hub.listHubItems(ids.wsA, viewer("learner")), null);
  assert.equal(await hub.listHubItems(ids.wsA, viewer("outsider")), null);
  const mine = await hub.listHubItems(ids.wsA, viewer("contributor"), { createdId: cards.ownById.id });
  assert.deepEqual(mine?.receipt, { id: cards.ownById.id, title: cards.ownById.title, code: cards.ownById.code });
  // Modulo web, ma proposta di un altro: niente ricevuta.
  assert.equal((await hub.listHubItems(ids.wsA, viewer("contributor"), { createdId: cards.reopened.id }))?.receipt, null);
  assert.equal((await hub.listHubItems(ids.wsA, viewer("builder"), { createdId: cards.ownById.id }))?.receipt, null);
});

test("listHubItems: una query sola sulle schede per la lista", opts, async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch")!;
  const original = globalThis.fetch;
  const statements: string[] = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body === "string") {
        const body = JSON.parse(init.body) as { query?: string; queries?: Array<{ query: string }> };
        for (const item of body.queries ?? [body]) if (typeof item.query === "string") statements.push(item.query);
      }
      return original(input, init);
    },
  });
  try {
    const list = await hub.listHubItems(ids.wsA, viewer("builder"));
    assert.ok(list);
  } finally {
    Object.defineProperty(globalThis, "fetch", descriptor);
  }
  const onCards = statements.filter((text) => /\bfrom\s+"?use_cases"?(\s|$)/i.test(text) && /^\s*select/i.test(text));
  assert.equal(onCards.length, 1, `query sulle schede: ${onCards.length}`);
});

// ─── getUseCaseDetail ────────────────────────────────────────────────

test("getUseCaseDetail: contributore come §6.9, revisori senza proponente, chi gestisce con «Proposto da»", opts, async () => {
  assert.equal(await hub.getUseCaseDetail(ids.wsA, cards.othersHidden.id, viewer("contributor")), null, "nascosta e non sua");
  assert.equal(await hub.getUseCaseDetail(ids.wsB, cards.othersVisible.id, viewer("contributor")), null, "di un altro workspace");
  assert.equal(await hub.getUseCaseDetail(ids.wsA, "non-un-uuid", viewer("builder")), null);
  const own = await hub.getUseCaseDetail(ids.wsA, cards.ownById.id, viewer("contributor"));
  assert.ok(own?.projection === "contributore");
  assert.deepEqual(Object.keys(own.useCase).sort(), OWN_KEYS);
  const other = await hub.getUseCaseDetail(ids.wsA, cards.othersVisible.id, viewer("contributor"));
  assert.ok(other?.projection === "contributore");
  assert.deepEqual(Object.keys(other.useCase).sort(), CONTRIBUTOR_KEYS);
  // H7: in più solo `answer`, la propria risposta a «Serve info» ancora da decidere; di una proposta altrui sempre null.
  assert.deepEqual(Object.keys(other).sort(), ["answer", "dossierRead", "projection", "today", "useCase"]);
  assert.equal(other.answer, null);

  const reviewer = await hub.getUseCaseDetail(ids.wsA, cards.othersVisible.id, viewer("builder"));
  assert.ok(reviewer?.projection === "revisore");
  assert.deepEqual(personKeys(reviewer), []);
  assert.equal(JSON.stringify(reviewer).includes(SUBMITTER_EMAIL), false);
  assert.equal(reviewer.useCase.reviewNotes, INTERNAL_NOTE, "le note interne sono dei revisori");
  assert.equal(reviewer.useCase.intake?.area, "Finanza");

  const manager = await hub.getUseCaseDetail(ids.wsA, cards.othersVisible.id, viewer("manager"));
  assert.ok(manager?.projection === "gestore");
  assert.deepEqual(manager.useCase.proposer, { label: OTHER_EMAIL, email: SUBMITTER_EMAIL });
  const byUser = await hub.getUseCaseDetail(ids.wsA, cards.othersHidden.id, viewer("ls"));
  assert.ok(byUser?.projection === "gestore");
  assert.deepEqual(byUser.useCase.proposer, { label: names.builder, email: null }, "un id utente si legge col nome");
  const slack = await hub.getUseCaseDetail(ids.wsA, cards.slack.id, viewer("manager"));
  assert.ok(slack?.projection === "gestore");
  assert.equal(slack.useCase.proposer.label, "persona su Slack");

  // Un id utente senza più l'account: mai l'id, che è una chiave interna.
  const goneId = randomUUID();
  const gone = await seed({ title: "Proposta di un account che non c'è più", proposedBy: goneId });
  try {
    const formerUser = await hub.getUseCaseDetail(ids.wsA, gone.id, viewer("manager"));
    assert.ok(formerUser?.projection === "gestore");
    assert.deepEqual(formerUser.useCase.proposer, { label: "persona non più su Unbundle", email: null });
    assert.equal(JSON.stringify(formerUser.useCase.proposer).includes(goneId), false);
  } finally {
    await q(`DELETE FROM use_cases WHERE id = $1::uuid`, [gone.id]);
  }
});

// ─── Dossier e Storia ────────────────────────────────────────────────

test("dossier: con la sezione accesa la fase e il riepilogo minimo; spenta, assente o in errore l'area si apre senza", opts, async (t) => {
  const log = t.mock.method(console, "error", () => {});
  try {
    ucOn();
    const on = await hub.listHubItems(ids.wsA, viewer("builder"));
    assert.ok(on && on.projection !== "contributore");
    assert.equal(on.dossierRead, "ok");
    const started = on.items.find((item) => item.id === cards.withDossier.id)!;
    assert.equal(started.phase, "in_realizzazione");
    assert.equal(started.phaseLabel, "In realizzazione · In preparazione");
    assert.deepEqual(started.dossier, { caseId: dossierId, code: cards.withDossier.code, status: "raccolta", readiness: { required: 245, ok: 12 } });
    const contributor = await hub.listHubItems(ids.wsA, viewer("contributor"));
    assert.equal(contributor?.items.find((item) => item.id === cards.withDossier.id)?.phaseLabel, "In realizzazione · In preparazione");
    assert.equal(log.mock.callCount(), 0);

    ucOff();
    const off = await hub.listHubItems(ids.wsA, viewer("builder"));
    assert.ok(off && off.projection !== "contributore");
    assert.equal(off.dossierRead, "spenta");
    assert.equal(off.items.find((item) => item.id === cards.withDossier.id)?.phase, "approvato");
    assert.equal(log.mock.callCount(), 0, "spenta: nessun log");

    ucOn();
    await q(`ALTER TABLE uc_cases RENAME TO uc_cases_h2b_assente`);
    try {
      const absent = await hub.listHubItems(ids.wsA, viewer("builder"));
      assert.equal(absent?.dossierRead, "spenta");
    } finally {
      await q(`ALTER TABLE uc_cases_h2b_assente RENAME TO uc_cases`);
    }
    assert.equal(log.mock.callCount(), 0, "tabelle assenti: nessun log");

    await q(`ALTER TABLE uc_cases RENAME COLUMN setup_completed_at TO setup_completed_at_h2b`);
    try {
      const broken = await hub.listHubItems(ids.wsA, viewer("builder"));
      assert.ok(broken && broken.projection !== "contributore");
      assert.equal(broken.dossierRead, "errore");
      assert.ok(broken.items.length >= 10, "l'area si apre senza la parte del dossier");
      const detail = await hub.getUseCaseDetail(ids.wsA, cards.withDossier.id, viewer("contributor"));
      assert.equal(detail?.dossierRead, "errore");
      assert.equal(detail?.useCase.phase, "approvato");
    } finally {
      await q(`ALTER TABLE uc_cases RENAME COLUMN setup_completed_at_h2b TO setup_completed_at`);
    }
    assert.equal(log.mock.callCount(), 2, "una riga di log per lettura");
    for (const call of log.mock.calls) {
      const payload = JSON.parse(String(call.arguments[1])) as Record<string, unknown>;
      assert.equal(payload.op, "dossier_summaries");
      assert.deepEqual(Object.keys(payload).filter((key) => !["op", "error", "cause"].includes(key)), []);
      assert.equal(JSON.stringify(call.arguments).includes("setup_completed_at"), false, "mai la query nel log");
    }
  } finally {
    ucOff();
  }
});

test("Storia: attesa dall'ultimo «Riapri» e mese di «Fatti», al giorno di Roma", opts, async () => {
  const list = await hub.listHubItems(ids.wsA, viewer("builder"));
  assert.ok(list && list.projection !== "contributore");
  const reopened = list.items.find((item) => item.id === cards.reopened.id)!;
  assert.equal(reopened.arrivedOn, "2026-08-01");
  assert.equal(reopened.waitingSince, "2026-10-10", "le 23:30 UTC del 9 ottobre sono il 10 a Roma");
  const realized = list.items.find((item) => item.id === cards.realized.id)!;
  assert.equal(realized.realizedOn, "2026-09-20");
});

// ─── GET REST (§9.3) ─────────────────────────────────────────────────

test("GET REST: senza sessione 401; chi non è del workspace e chi segue solo un corso 404", opts, async () => {
  signIn(null);
  assert.equal((await call(listGet, "/api", { workspaceId: ids.wsA })).status, 401);
  signIn("learner");
  assert.equal((await call(listGet, "/api", { workspaceId: ids.wsA })).status, 404);
  signIn("outsider");
  assert.equal((await call(listGet, "/api", { workspaceId: ids.wsA })).status, 404);
  signIn("builder");
  assert.equal((await call(itemGet, "/api", { workspaceId: ids.wsA, useCaseId: "non-un-uuid" })).status, 404);
  assert.equal((await call(itemGet, "/api", { workspaceId: ids.wsA, useCaseId: cards.bVisible.id })).status, 404, "di un altro workspace");
});

test("GET REST, contributore: 403 con l'area accesa e spenta (la REST risponde solo a chi valuta)", opts, async () => {
  signIn("contributor");
  for (const [workspaceId, hidden, own] of [
    [ids.wsA, cards.othersHidden, cards.ownById],
    [ids.wsB, cards.bHidden, cards.bOwn],
  ] as const) {
    const res = await call(listGet, "/api", { workspaceId });
    assert.equal(res.status, 403);
    const text = JSON.stringify(await res.json());
    for (const secret of [OTHER_EMAIL, SUBMITTER_EMAIL, INTERNAL_NOTE, own.code]) assert.equal(text.includes(secret), false, secret);
    assert.equal((await call(itemGet, "/api", { workspaceId, useCaseId: hidden.id })).status, 403);
    assert.equal((await call(itemGet, "/api", { workspaceId, useCaseId: own.id })).status, 403);
  }
});

test("GET REST, revisori e chi gestisce il workspace: righe senza proponente, revisore e intake", opts, async () => {
  for (const workspaceId of [ids.wsA, ids.wsB]) {
    for (const person of ["builder", "manager"] as const) {
      signIn(person);
      const list = (await (await call(listGet, "/api", { workspaceId })).json()) as { useCases: Array<Record<string, unknown>> };
      assert.ok(list.useCases.length >= 3, person);
      assert.deepEqual(personKeys(list.useCases), [], person);
      for (const row of list.useCases) {
        for (const key of ["proposedBy", "submittedByUserId", "reviewedBy", "intake"]) assert.equal(Object.prototype.hasOwnProperty.call(row, key), false, `${person}: ${key}`);
      }
      const text = JSON.stringify(list);
      assert.equal(text.includes(OTHER_EMAIL), false, person);
      assert.equal(text.includes(SUBMITTER_EMAIL), false, person);
      assert.ok(text.includes(INTERNAL_NOTE), `${person}: i revisori leggono le note`);
      const single = (await (await call(itemGet, "/api", { workspaceId, useCaseId: list.useCases[0].id as string })).json()) as { useCase: Record<string, unknown> };
      assert.deepEqual(personKeys(single), [], person);
      assert.equal(Object.prototype.hasOwnProperty.call(single.useCase, "intake"), false, person);
    }
  }
  signIn("manager");
  const visible = (await (await call(itemGet, "/api", { workspaceId: ids.wsA, useCaseId: cards.othersVisible.id })).json()) as { useCase: Record<string, unknown> };
  assert.equal(visible.useCase.id, cards.othersVisible.id);
  assert.equal(JSON.stringify(visible).includes(OTHER_EMAIL), false);
  assert.equal(JSON.stringify(visible).includes(SUBMITTER_EMAIL), false);
});

// ─── Export (§4.1, §9.3) ─────────────────────────────────────────────

async function workbookOf(res: Response) {
  return XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
}

test("export: 403 a chi non è revisore, in tutti i workspace", opts, async () => {
  signIn("contributor");
  for (const workspaceId of [ids.wsA, ids.wsB]) {
    const res = await call(exportGet, "/export", { workspaceId });
    assert.equal(res.status, 403, workspaceId);
  }
  signIn("learner");
  assert.equal((await call(exportGet, "/export", { workspaceId: ids.wsA })).status, 404);
});

test("export con l'area accesa: solo il foglio «Use case», colonne di §4.1, fasce del workspace, nessun proponente", opts, async () => {
  signIn("builder");
  const res = await call(exportGet, "/export", { workspaceId: ids.wsA });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /-use-case\.xlsx"$/);
  const workbook = await workbookOf(res);
  assert.deepEqual(workbook.SheetNames, [views.EXPORT_SHEET_NAME]);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[views.EXPORT_SHEET_NAME]);
  const header = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[views.EXPORT_SHEET_NAME], { header: 1 })[0];
  assert.deepEqual(header, [...views.EXPORT_COLUMNS]);
  const byCode = new Map(rows.map((row) => [row.Codice, row]));
  assert.ok(byCode.has(cards.othersHidden.code), "le schede nascoste sono dei revisori");
  assert.equal(byCode.has(cards.bVisible.code), false);
  assert.equal(byCode.get(cards.band.code)?.Fascia, "€€ · Medio");
  assert.equal(byCode.get(cards.othersVisible.code)?.Costo, 40_000);
  const text = JSON.stringify(rows);
  for (const secret of [OTHER_EMAIL, SUBMITTER_EMAIL, emails.contributor.toUpperCase(), ids.contributor, "U0SLACK123"]) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test("export con l'area spenta: il file di oggi, ai soli revisori", opts, async () => {
  signIn("builder");
  const res = await call(exportGet, "/export", { workspaceId: ids.wsB });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /-portfolio\.xlsx"$/);
  const workbook = await workbookOf(res);
  assert.deepEqual(workbook.SheetNames, ["Portfolio", "Waves", "Summary"]);
});

// ─── «Benefici e costi» nella REST e nell'export ─────────────────────

/** FIX_A della spec: 115,5 ore e 4.042,5 € all'anno, avvio 560 €, ricorrenti 600 € all'anno, facilità 4. */
const FIX_A_MODEL = {
  v: 1,
  primary: "tempo",
  components: [
    { key: "capacita", lever: "nuove_capacita", label: "Risposte anche fuori orario", kind: "qualitativo", confidence: "ipotesi" },
    { key: "tempo", lever: "tempo", label: "Smistamento delle richieste", kind: "ore", volumeYear: 6600, minutesPerUnit: 1.5, automatablePct: 70, confidence: "ipotesi" },
    { key: "qualita", lever: "qualita", label: "Meno errori di smistamento", kind: "qualitativo", confidence: "da_misurare" },
  ],
  ease: 4,
  costs: { devDays: 4, internalHours: 16, runCostEurYear: 600 },
  confirmBy: "Responsabile amministrazione",
};

test("«Benefici e costi»: la REST dei revisori porta il modello (null se non è valido), l'export le sue cifre; chi non è revisore non riceve nulla", opts, async () => {
  const card = await seed({ status: "accepted", review: "scored", targetQuarter: "2026-Q4" });
  const broken = await seed();
  await q(`UPDATE use_cases SET value_model = $2::jsonb WHERE id = $1::uuid`, [card.id, JSON.stringify(FIX_A_MODEL)]);
  await q(`UPDATE use_cases SET value_model = $2::jsonb WHERE id = $1::uuid`, [broken.id, JSON.stringify({ ...FIX_A_MODEL, v: 2 })]);
  for (const person of ["builder", "manager"] as const) {
    signIn(person);
    const list = (await (await call(listGet, "/api", { workspaceId: ids.wsA })).json()) as { useCases: Array<Record<string, unknown>> };
    assert.deepEqual(list.useCases.find((row) => row.id === card.id)?.valueModel, FIX_A_MODEL, person);
    assert.equal(list.useCases.find((row) => row.id === broken.id)?.valueModel, null, `${person}: un modello non valido esce come null`);
    assert.ok(list.useCases.every((row) => Object.prototype.hasOwnProperty.call(row, "valueModel")), "la colonna c'è in ogni riga");
    const single = (await (await call(itemGet, "/api", { workspaceId: ids.wsA, useCaseId: card.id })).json()) as { useCase: Record<string, unknown> };
    assert.deepEqual(single.useCase.valueModel, FIX_A_MODEL, person);
  }
  signIn("builder");
  const workbook = await workbookOf(await call(exportGet, "/export", { workspaceId: ids.wsA }));
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[views.EXPORT_SHEET_NAME]);
  const exported = rows.find((row) => row.Codice === card.code)!;
  assert.deepEqual(
    [exported.Valore, exported["Valore all'anno"], exported["Ritorno principale"], exported["Ore all'anno"], exported["Da misurare all'anno"], exported.Costo, exported["Fonte del costo"], exported["Ricorrenti all'anno"], exported.Facilità],
    ["Basso", 4042.5, "Risparmio di tempo", 115.5, 0, 560, "stima del team", 600, 4],
  );
  const plain = rows.find((row) => row.Codice === cards.othersVisible.code)!;
  assert.equal(plain["Ritorno principale"] ?? "", "", "senza modello le celle restano vuote");
  for (const column of ["Ore all'anno", "Da misurare all'anno", "Ricorrenti all'anno", "Facilità"]) assert.equal(plain[column], undefined, column);

  signIn("contributor");
  for (const res of [await call(listGet, "/api", { workspaceId: ids.wsA }), await call(itemGet, "/api", { workspaceId: ids.wsA, useCaseId: card.id }), await call(exportGet, "/export", { workspaceId: ids.wsA })]) {
    assert.equal(res.status, 403);
    const text = await res.text();
    for (const secret of ["Smistamento delle richieste", "Responsabile amministrazione", "valueModel"]) assert.equal(text.includes(secret), false, secret);
  }
});

// ─── Indici (art. 15.4) ──────────────────────────────────────────────

test("nessun indice su use_cases.proposed_by né su use_case_events.actor_user_id", opts, async () => {
  const rows = await q(
    `SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('use_cases', 'use_case_events')`,
  );
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.doesNotMatch(String(row.indexdef), /proposed_by|actor_user_id/i, String(row.indexdef));
  }
});
