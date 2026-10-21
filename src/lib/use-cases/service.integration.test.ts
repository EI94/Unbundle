import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// Servizio di scrittura dell'area «Use case» (docs/use-case/PIANO-LAVORI.md H2a;
// docs/use-case/DESIGN.md §3.7, §9.1, §9.2, §9.3, §10.1, §10.3):
// src/lib/use-cases/service.ts e src/lib/db/queries/use-case-events.ts.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del
//   pacchetto hub_<id> su 127.0.0.1) gira sul database di prova.
// - Dentro `npm run check` si salta, tranne la prova di unità in fondo: in testa solo moduli
//   di Node; i moduli dell'app arrivano con `await import()` dentro `before()`.
// Alcune prove cambiano lo schema per un momento (una colonna uc rinominata per forzare
// l'errore della lettura del dossier, un vincolo in più sulla Storia per provare che scheda
// e Storia vanno nello stesso statement) e lo rimettono com'era in `finally`: per questo
// girano solo sul database del pacchetto, mai sul modello. Dati sintetici, creati e
// cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) {
    throw new Error("This suite changes the schema for a moment: run it only on a package database hub_<id>");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type Service = typeof import("./service.ts");
type Events = typeof import("../db/queries/use-case-events.ts");
type Codes = typeof import("../db/queries/use-case-codes.ts");
type Quarter = typeof import("./quarter.ts");
type Ctx = import("./service.ts").WriteContext;

let svc: Service;
let events: Events;
let codes: Codes;
let quarter: Quarter;
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
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "VERCEL_ENV"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const PLACEHOLDER = "[testo rimosso]";
let codeSeq = 5000;

type Person = keyof typeof emails;

/** Contesto di una persona; il ruolo e «Lateral Space» passati qui sono volutamente falsi: il servizio li rilegge. */
function as(person: Person, extra: Partial<Ctx> = {}): Ctx {
  return {
    workspaceId: ids.wsA,
    actor: { userId: ids[person], role: "exec_sponsor", isLateralSpace: true, kind: "persona" },
    channel: "pagina",
    ...extra,
  };
}

function system(channel: Ctx["channel"], kind: "sistema" | "ai" = "sistema", workspaceId = ids.wsA): Ctx {
  return { workspaceId, actor: { userId: null, role: null, isLateralSpace: false, kind }, channel };
}

interface CardSeed {
  workspaceId?: string;
  title?: string;
  description?: string | null;
  status?: string;
  review?: string;
  kind?: string | null;
  code?: string | null;
  intake?: Record<string, unknown> | null;
  publicNote?: string | null;
  reviewedBy?: string | null;
  targetQuarter?: string | null;
  customScores?: Record<string, unknown> | null;
  aiSuggestion?: Record<string, unknown> | null;
  source?: string | null;
  valueEurYear?: number | null;
  reviewNotes?: string | null;
}

/** Una scheda sintetica in uno stato preciso, scritta senza passare dal servizio. */
async function seed(c: CardSeed = {}): Promise<string> {
  const id = randomUUID();
  const code = c.code === undefined ? `XX-${codeSeq++}` : c.code;
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code,
       intake, public_note, reviewed_by, target_quarter, custom_scores, ai_suggestion, source, value_eur_year, review_notes)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5::use_case_status, $6::portfolio_review_status, $7, $8,
       $9::jsonb, $10, $11::uuid, $12, $13::jsonb, $14::jsonb, $15, $16, $17)`,
    [
      id,
      c.workspaceId ?? ids.wsA,
      c.title ?? "Smistamento richieste di prova",
      c.description === undefined ? "Problema di prova" : c.description,
      c.status ?? "proposed",
      c.review ?? "in_review",
      c.kind === undefined ? "use_case_ai" : c.kind,
      code,
      c.intake === undefined ? null : JSON.stringify(c.intake),
      c.publicNote ?? null,
      c.reviewedBy ?? null,
      c.targetQuarter ?? null,
      c.customScores === undefined ? null : JSON.stringify(c.customScores),
      c.aiSuggestion === undefined ? null : JSON.stringify(c.aiSuggestion),
      c.source === undefined ? "web_proposed" : c.source,
      c.valueEurYear ?? null,
      c.reviewNotes ?? null,
    ],
  );
  return id;
}

async function row(id: string): Promise<Record<string, unknown>> {
  const [r] = await q(`SELECT *, review_by::text AS review_by_text FROM use_cases WHERE id = $1::uuid`, [id]);
  assert.ok(r, "la scheda c'è");
  return r;
}

async function versionOf(id: string): Promise<number> {
  return Number((await row(id)).version);
}

async function storia(id: string): Promise<Record<string, unknown>[]> {
  return q(
    `SELECT action, channel, actor_kind, actor_user_id, fields, phase_before, phase_after
       FROM use_case_events WHERE use_case_id = $1::uuid ORDER BY at, id`,
    [id],
  );
}

async function lastEvent(id: string): Promise<Record<string, unknown>> {
  const rows = await storia(id);
  assert.ok(rows.length > 0, "c'è almeno una riga di Storia");
  return rows[rows.length - 1];
}

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}

function err(result: { ok: boolean; error?: string }, error: string, label = "esito") {
  assert.equal(result.ok, false, `${label}: atteso un errore ${error}`);
  assert.equal(result.error, error, label);
}

function futureDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
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

async function insertDossier(useCaseId: string, status: string, complete = true): Promise<string> {
  const id = randomUUID();
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova H2a', $7, CASE WHEN $8 THEN now() END)`,
    [id, ids.wsA, ids.org, useCaseId, ids.template, `XXD-${suffix.toUpperCase()}-${codeSeq++}`, status, complete],
  );
  return id;
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  svc = await import("./service.ts");
  events = await import("../db/queries/use-case-events.ts");
  codes = await import("../db/queries/use-case-codes.ts");
  quarter = await import("./quarter.ts");

  process.env.USE_CASE_HUB_WORKSPACES = ids.wsA;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  ucOff();

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H2a', $2)`, [ids.org, `hub-h2a-${ids.org}`]);
  await q(
    `INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova H2a A'), ($2::uuid, $3::uuid, 'Prova H2a B')`,
    [ids.wsA, ids.wsB, ids.org],
  );
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [
      ids[person],
      emails[person],
      `Persona di prova ${person}`,
    ]);
  }
  const memberships: Array<[string, Person, string]> = [
    [ids.wsA, "ls", "transformation_lead"],
    [ids.wsA, "builder", "function_lead"],
    [ids.wsA, "manager", "exec_sponsor"],
    [ids.wsA, "contributor", "contributor"],
    [ids.wsA, "learner", "learner"],
    [ids.wsB, "ls", "transformation_lead"],
    [ids.wsB, "builder", "function_lead"],
  ];
  for (const [workspaceId, person, role] of memberships) {
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [
      workspaceId,
      ids[person],
      role,
    ]);
  }
  // Codici per il workspace A (prefisso XX); il workspace B non ha il connettore configurato.
  await q(`INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix) VALUES ($1::uuid, $2, 'XX')`, [
    ids.wsA,
    `hub-h2a-${suffix}`,
  ]);
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova H2a', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.hub_h2a_${suffix}`, randomBytes(32).toString("hex"), ids.wsA],
  );
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  // I workspace portano via schede, Storia, segnali, dossier, template ristretto e config.
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

// ─── createUseCases ──────────────────────────────────────────────────

test("createUseCases, pannello rapido di Lateral Space: AI Transformation, nascosta, codice subito, versione riletta", opts, async () => {
  const [created] = ok(
    await svc.createUseCases(as("ls"), [
      { source: "manual", kind: "da_costruire", title: "Prova del pannello rapido", description: "Un problema in una riga", aiLab: "AI Lab Prova", proposedBy: null },
    ]),
  );
  assert.match(String(created.code), /^XX-\d{4}$/);
  const r = await row(created.id);
  assert.equal(r.code, created.code, "il codice restituito è quello salvato");
  assert.equal(created.version, Number(r.version), "la version restituita è quella riletta dopo il codice");
  assert.equal(created.version, 1, "l'assegnazione del codice non fa salire version");
  assert.equal(r.origin, "transformation");
  assert.deepEqual(r.intake, { hiddenFromSearch: true });
  assert.equal(r.proposed_by, null);
  assert.equal(r.source, "manual");
  assert.equal(r.status, "proposed");
  assert.equal(r.portfolio_review_status, "needs_inputs");
  assert.equal(r.portfolio_kind, "use_case_ai");
  assert.equal(r.ai_lab, "AI Lab Prova");
  assert.ok(r.submitted_at, "submitted_at");
  // La riga «creato» la scrive il trigger, senza chi propone.
  assert.deepEqual(await storia(created.id), [
    { action: "creato", channel: "pagina", actor_kind: "proponente", actor_user_id: null, fields: [], phase_before: null, phase_after: null },
  ]);
});

test("createUseCases, modulo completo: un contributore propone dal basso, i revisori scelgono origine e costo", opts, async () => {
  const [mine] = ok(
    await svc.createUseCases(as("contributor"), [
      {
        source: "web_proposed",
        kind: "da_diffondere",
        title: "Prova del modulo completo",
        description: "Problema",
        flowDescription: "Come funziona",
        proposedBy: emails.contributor,
      },
    ]),
  );
  const r = await row(mine.id);
  assert.equal(r.origin, "adoption");
  assert.equal(r.intake, null, "non nascosta");
  assert.equal(r.proposed_by, emails.contributor);
  assert.equal(r.portfolio_kind, "best_practice");
  assert.match(String(r.code), /^XX-\d{4}$/);

  // Origine, visibilità e valutazione iniziale solo per chi valuta.
  for (const extra of [{ origin: "transformation" as const }, { cost: { eurOnce: 40000 } }, { valueEurYear: 1000 }, { hiddenFromSearch: true }]) {
    err(
      await svc.createUseCases(as("contributor"), [{ source: "web_proposed", kind: "da_costruire", title: "Prova vietata", description: null, ...extra }]),
      "permesso_mancante",
      JSON.stringify(extra),
    );
  }

  const [byBuilder] = ok(
    await svc.createUseCases(as("builder"), [
      { source: "web_proposed", kind: "da_costruire", title: "Prova di un revisore", description: "x y z", origin: "transformation", cost: { eurOnce: 40000 }, valueEurYear: 60000 },
    ]),
  );
  const b = await row(byBuilder.id);
  assert.equal(b.origin, "transformation");
  assert.deepEqual(b.intake, { hiddenFromSearch: true }, "dall'alto: nascosta");
  assert.equal(b.cost_eur_once, 40000);
  assert.equal(b.cost_band, null);
  assert.equal(b.value_eur_year, 60000);

  // Predefinito: AI Transformation per Lateral Space, AI Adoption per l'AI Builder del cliente.
  const [byLs] = ok(await svc.createUseCases(as("ls"), [{ source: "web_proposed", kind: "da_costruire", title: "Prova di Lateral Space", description: null }]));
  assert.equal((await row(byLs.id)).origin, "transformation");
  const [byBuilder2] = ok(await svc.createUseCases(as("builder"), [{ source: "team_mcp", kind: "da_costruire", title: "Prova dal MCP del team", description: null }], ));
  assert.equal((await row(byBuilder2.id)).origin, "adoption");
});

test("createUseCases, Activity mapping: bozza dall'alto, nascosta, punteggi del generatore, mai approvata", opts, async () => {
  const [created] = ok(
    await svc.createUseCases(as("builder", { channel: "activity_mapping", workspaceId: ids.wsA }), [
      {
        source: "activity_mapping",
        kind: "da_costruire",
        title: "Prova da Activity mapping",
        description: "Dal generatore",
        generatorScores: { impactTime: 4, impactQuality: 4, feasibilityData: 3, feasibilityWorkflow: 3, feasibilityTech: 3, feasibilityTeam: 3 },
        generatorDetails: { requirements: ["Dati del CRM"], relatedActivityIds: [randomUUID()], timeline: "Q1", sequenceOrder: 1 },
      },
    ]),
  );
  const r = await row(created.id);
  assert.equal(r.status, "draft");
  assert.equal(r.origin, "transformation");
  assert.deepEqual(r.intake, { hiddenFromSearch: true });
  assert.equal(r.impact_time, 4);
  assert.equal(r.submitted_at, null);
  assert.ok(Number(r.overall_impact_score) > 0, "aggregati calcolati dai punteggi del generatore");
  assert.deepEqual(r.requirements, ["Dati del CRM"]);
  const [creato] = await storia(created.id);
  assert.equal(creato.channel, "activity_mapping");
  assert.equal(creato.actor_kind, "sistema");

  // I punteggi del generatore valgono solo per Activity mapping.
  err(
    await svc.createUseCases(as("builder"), [{ source: "web_proposed", kind: "da_costruire", title: "Prova", description: null, generatorScores: { impactTime: 4 } }]),
    "dati_non_validi",
  );
});

test("createUseCases: id decisi prima, una ripresa ritrova le stesse schede e gli stessi codici", opts, async () => {
  const reserved = [randomUUID(), randomUUID()];
  const items = reserved.map((id, i) => ({ id, source: "team_mcp" as const, kind: "da_costruire" as const, title: `Prova ripresa ${i}`, description: null }));
  const first = ok(await svc.createUseCases(as("builder", { channel: "mcp_team" }), items));
  const again = ok(await svc.createUseCases(as("builder", { channel: "mcp_team" }), items));
  assert.deepEqual(again, first);
  assert.deepEqual(first.map((c) => c.id), reserved);
  assert.notEqual(first[0].code, first[1].code);
  for (const id of reserved) assert.equal((await storia(id)).length, 1, "una sola riga «creato»");
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM use_cases WHERE id = ANY($1::uuid[])`, [reserved]);
  assert.equal(n, 2);
});

test("createUseCases: permessi, dati e interruttore dell'area", opts, async () => {
  err(await svc.createUseCases(as("builder"), [{ source: "manual", kind: "da_costruire", title: "Prova", description: null }]), "permesso_mancante", "pannello rapido solo Lateral Space");
  err(await svc.createUseCases(as("learner"), [{ source: "web_proposed", kind: "da_costruire", title: "Prova", description: null }]), "permesso_mancante", "learner");
  err(await svc.createUseCases(as("outsider"), [{ source: "web_proposed", kind: "da_costruire", title: "Prova", description: null }]), "permesso_mancante", "non membro");
  err(await svc.createUseCases(as("contributor"), [{ source: "activity_mapping", kind: "da_costruire", title: "Prova", description: null }]), "permesso_mancante", "Activity mapping solo revisori");
  err(await svc.createUseCases(system("ai", "ai"), [{ source: "slack_proposed", kind: "da_costruire", title: "Prova", description: null }]), "permesso_mancante", "l'AI non crea");
  err(await svc.createUseCases(system("script"), [{ source: "manual", kind: "da_costruire", title: "Prova", description: null }]), "permesso_mancante", "un sistema non usa il pannello rapido");

  const invalid = await svc.createUseCases(as("builder"), [{ source: "web_proposed", kind: "da_costruire", title: "x", description: null }]);
  err(invalid, "dati_non_validi");
  assert.ok(!invalid.ok && invalid.fieldErrors?.title, "errore sul titolo");
  const many = await svc.createUseCases(as("builder"), [
    { source: "web_proposed", kind: "da_costruire", title: "Prova buona", description: null },
    { source: "web_proposed", kind: "boh" as "da_costruire", title: "Prova", description: null },
  ]);
  assert.ok(!many.ok && many.fieldErrors?.["items.1.kind"], "errori per indice nel lotto");
  err(await svc.createUseCases(as("builder"), []), "dati_non_validi", "lotto vuoto");

  // Pagina e MCP del team vogliono l'area accesa; gli altri canali no.
  err(
    await svc.createUseCases(as("builder", { workspaceId: ids.wsB }), [{ source: "web_proposed", kind: "da_costruire", title: "Prova", description: null }]),
    "area_spenta",
  );
  const [slack] = ok(
    await svc.createUseCases(system("slack", "sistema", ids.wsB), [{ source: "slack_proposed", kind: "da_costruire", title: "Prova da Slack", description: "Testo" }]),
  );
  const s = await row(slack.id);
  assert.equal(s.workspace_id, ids.wsB);
  // Senza riga di config la riga nasce (connettore spento) e la scheda ha il suo codice.
  const configB = (await q(`SELECT code_prefix, enabled FROM workspace_connector_configs WHERE workspace_id = $1::uuid`, [ids.wsB]))[0];
  assert.equal(configB?.enabled, false, "il connettore resta spento");
  assert.equal(slack.code, `${String(configB?.code_prefix)}-0001`, "anche senza riga di config prima");
  assert.equal(s.origin, "adoption");
});

test("createUseCases: una scheda AI Transformation nasce nascosta, qualunque cosa chieda chi scrive (§8.6)", opts, async () => {
  const refused = await svc.createUseCases(as("builder"), [
    { source: "web_proposed", kind: "da_costruire", title: "Prova dall'alto visibile", description: null, origin: "transformation", hiddenFromSearch: false },
  ]);
  err(refused, "dati_non_validi");
  assert.equal(!refused.ok && refused.fieldErrors?.hiddenFromSearch, svc.HIDDEN_TRANSFORMATION_ERROR);
  // Anche con l'origine predefinita (Lateral Space) e da un sistema (Activity mapping).
  err(
    await svc.createUseCases(as("ls", { channel: "mcp_team" }), [{ source: "team_mcp", kind: "da_costruire", title: "Prova dal MCP visibile", description: null, hiddenFromSearch: false }]),
    "dati_non_validi",
    "predefinita di Lateral Space",
  );
  err(
    await svc.createUseCases(system("activity_mapping"), [{ source: "activity_mapping", kind: "da_costruire", title: "Prova da Activity mapping visibile", description: null, hiddenFromSearch: false }]),
    "dati_non_validi",
    "Activity mapping",
  );
  const [top] = ok(
    await svc.createUseCases(as("builder"), [
      { source: "web_proposed", kind: "da_costruire", title: "Prova dall'alto nascosta", description: null, origin: "transformation", hiddenFromSearch: true },
    ]),
  );
  assert.deepEqual((await row(top.id)).intake, { hiddenFromSearch: true });
  // Dal basso: visibile, salvo che chi valuta chieda di nasconderla.
  const [visible, hidden] = ok(
    await svc.createUseCases(as("builder"), [
      { source: "web_proposed", kind: "da_costruire", title: "Prova dal basso visibile", description: null, hiddenFromSearch: false },
      { source: "web_proposed", kind: "da_costruire", title: "Prova dal basso nascosta", description: null, hiddenFromSearch: true },
    ]),
  );
  assert.equal((await row(visible.id)).origin, "adoption");
  assert.equal((await row(visible.id)).intake, null);
  assert.deepEqual((await row(hidden.id)).intake, { hiddenFromSearch: true });
});

test("area: con l'elenco della guida del connettore solo quelle aree, senza elenco testo libero (§6.2)", opts, async () => {
  const id = await seed({ intake: { area: "Area di prima" } });
  const guide = { areas: [{ id: "finanza", label: "Finanza" }, "risorse_umane"] };
  await q(`UPDATE workspace_connector_configs SET guide = $2::jsonb WHERE workspace_id = $1::uuid`, [ids.wsA, JSON.stringify(guide)]);
  try {
    const v = await versionOf(id);
    const outside = await svc.updateUseCase(as("builder"), id, v, { area: "Finanza" });
    err(outside, "dati_non_validi");
    assert.deepEqual(!outside.ok && outside.fieldErrors, { area: "Scegli un'area dell'elenco." });
    // L'area già salvata, anche se fuori elenco, si può rimandare insieme ad altro.
    const kept = ok(await svc.updateUseCase(as("builder"), id, v, { area: "Area di prima", title: "Titolo con l'area di prima" }));
    assert.equal(kept.intake?.area, "Area di prima");
    const inside = ok(await svc.updateUseCase(as("builder"), id, kept.version, { area: "finanza" }));
    assert.equal(inside.intake?.area, "finanza");
    ok(await svc.updateUseCase(as("builder"), id, inside.version, { area: "risorse_umane" }));

    const batch = await svc.createUseCases(as("builder"), [
      { source: "web_proposed", kind: "da_costruire", title: "Prova area dell'elenco", description: null, area: "finanza" },
      { source: "web_proposed", kind: "da_costruire", title: "Prova area fuori elenco", description: null, area: "Marketing" },
    ]);
    err(batch, "dati_non_validi");
    assert.deepEqual(!batch.ok && batch.fieldErrors, { "items.1.area": "Scegli un'area dell'elenco." });
    const [created] = ok(
      await svc.createUseCases(system("slack"), [{ source: "slack_proposed", kind: "da_costruire", title: "Prova area da Slack", description: null, area: "risorse_umane" }]),
    );
    assert.equal(((await row(created.id)).intake as Record<string, unknown>).area, "risorse_umane");
  } finally {
    await q(`UPDATE workspace_connector_configs SET guide = NULL WHERE workspace_id = $1::uuid`, [ids.wsA]);
  }
  // Senza elenco: testo libero (fino a 80 caratteri).
  const free = ok(await svc.updateUseCase(as("builder"), id, await versionOf(id), { area: "Marketing" }));
  assert.equal(free.intake?.area, "Marketing");
});

test("creationFollowUps e defaultOrigin seguono la tabella di §8", opts, () => {
  assert.deepEqual(svc.creationFollowUps("manual", { isLateralSpace: true }), { aiValuation: false, notifications: false });
  assert.deepEqual(svc.creationFollowUps("web_proposed", { isLateralSpace: false }), { aiValuation: true, notifications: true });
  assert.deepEqual(svc.creationFollowUps("activity_mapping", { isLateralSpace: false }), { aiValuation: false, notifications: false });
  assert.deepEqual(svc.creationFollowUps("ai_readiness_assessment", { isLateralSpace: false }), { aiValuation: false, notifications: false });
  assert.deepEqual(svc.creationFollowUps("learning", { isLateralSpace: false }), { aiValuation: false, notifications: false });
  assert.deepEqual(svc.creationFollowUps("team_mcp", { isLateralSpace: true }), { aiValuation: false, notifications: false });
  assert.deepEqual(svc.creationFollowUps("team_mcp", { isLateralSpace: false }), { aiValuation: false, notifications: true });
  assert.deepEqual(svc.creationFollowUps("slack_proposed", { isLateralSpace: false }), { aiValuation: true, notifications: true });
  assert.equal(svc.defaultOrigin("manual", { isLateralSpace: false, isReviewer: false }), "transformation");
  assert.equal(svc.defaultOrigin("team_mcp", { isLateralSpace: true, isReviewer: true }), "transformation");
  assert.equal(svc.defaultOrigin("team_mcp", { isLateralSpace: false, isReviewer: true }), "adoption");
  assert.equal(svc.defaultOrigin("web_proposed", { isLateralSpace: true, isReviewer: false }), "adoption");
  assert.equal(svc.defaultOrigin("claude_connector", { isLateralSpace: true, isReviewer: true }), "adoption");
});

// ─── updateUseCase, versioni, Storia ─────────────────────────────────

test("updateUseCase: testi, area, tipo e «Possibile doppione di»; nessuna modifica, nessuna scrittura", opts, async () => {
  const id = await seed({ intake: { hiddenFromSearch: true } });
  const v = await versionOf(id);
  const card = ok(
    await svc.updateUseCase(as("builder"), id, v, {
      title: "  Titolo nuovo di prova  ",
      area: "Finanza",
      kind: "da_diffondere",
      possibleDuplicateOf: "xx-0007",
      origin: "transformation",
    }),
  );
  assert.equal(card.version, v + 1);
  assert.equal(card.title, "Titolo nuovo di prova");
  assert.equal(card.portfolioKind, "best_practice");
  assert.equal(card.origin, "transformation");
  assert.deepEqual(card.intake, { hiddenFromSearch: true, area: "Finanza", possibleDuplicateOf: "XX-0007" });
  assert.equal(card.phase.code, "da_valutare.possibile_doppione");
  const ev = await lastEvent(id);
  assert.equal(ev.action, "modificato");
  assert.equal(ev.channel, "pagina");
  assert.equal(ev.actor_kind, "persona");
  assert.equal(ev.actor_user_id, ids.builder);
  assert.deepEqual([...(ev.fields as string[])].sort(), ["area", "origine", "possibile_doppione", "tipo", "titolo"]);
  assert.equal(ev.phase_before, "da_valutare.nuova");
  assert.equal(ev.phase_after, "da_valutare.possibile_doppione");

  // Stessi valori: la scheda e la Storia non cambiano.
  const before = (await storia(id)).length;
  const same = ok(await svc.updateUseCase(as("builder"), id, v + 1, { title: "Titolo nuovo di prova", area: "Finanza" }));
  assert.equal(same.version, v + 1);
  assert.equal((await storia(id)).length, before);

  // Svuotare l'area e il doppione toglie le chiavi; cambiare l'origine non cambia la visibilità.
  const cleared = ok(await svc.updateUseCase(as("builder"), id, v + 1, { area: null, possibleDuplicateOf: "", origin: "adoption" }));
  assert.deepEqual(cleared.intake, { hiddenFromSearch: true });
  assert.equal(cleared.hiddenFromSearch, true);

  err(await svc.updateUseCase(as("contributor"), id, cleared.version, { title: "Prova" }), "permesso_mancante");
  const bad = await svc.updateUseCase(as("builder"), id, cleared.version, { title: "x" });
  err(bad, "dati_non_validi");
  err(await svc.updateUseCase(as("builder"), id, cleared.version, { colore: "rosso" } as never), "dati_non_validi");
});

test("versione_superata con due scritture sulla stessa versione, anche insieme", opts, async () => {
  const id = await seed();
  const v = await versionOf(id);
  ok(await svc.updateUseCase(as("builder"), id, v, { title: "Prima modifica di prova" }));
  const stale = await svc.updateUseCase(as("ls"), id, v, { title: "Seconda modifica di prova" });
  err(stale, "versione_superata");
  assert.equal(!stale.ok && stale.message, "Qualcuno ha appena modificato questo use case. Ho ricaricato i dati: rifai la modifica.");
  assert.equal((await row(id)).title, "Prima modifica di prova");

  // Due scritture insieme sulla stessa versione: una passa, l'altra trova la versione superata.
  const v2 = await versionOf(id);
  const both = await Promise.all([
    svc.updateUseCase(as("builder"), id, v2, { description: "Uno" }),
    svc.updateUseCase(as("ls"), id, v2, { description: "Due" }),
  ]);
  assert.deepEqual(both.map((r) => (r.ok ? "ok" : r.error)).sort(), ["ok", "versione_superata"]);
  assert.equal(await versionOf(id), v2 + 1);
  const modified = (await storia(id)).filter((e) => e.action === "modificato");
  assert.equal(modified.length, 2, "una riga per scrittura riuscita");
});

test("non_trovato: scheda di un altro workspace, id inesistente o non valido", opts, async () => {
  const other = await seed({ workspaceId: ids.wsB });
  const v = await versionOf(other);
  err(await svc.updateUseCase(as("ls"), other, v, { title: "Prova altrui" }), "non_trovato");
  err(await svc.decideUseCase(as("ls"), other, v, { type: "approva", quando: "piu_avanti" }), "non_trovato");
  err(await svc.updateUseCase(as("ls"), randomUUID(), 1, { title: "Prova" }), "non_trovato");
  err(await svc.updateUseCase(as("ls"), "non-un-uuid", 1, { title: "Prova" }), "non_trovato");
  err(await svc.updateUseCase(as("ls", { workspaceId: "non-un-uuid" }), other, v, { title: "Prova" }), "non_trovato");
  assert.equal((await row(other)).title, "Smistamento richieste di prova");
  assert.equal((await storia(other)).length, 1, "solo «creato»");
});

test("una riga di Storia per scrittura, nello stesso statement della scheda; un errore del database è «riprova», senza testi nel log", opts, async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const id = await seed({ status: "accepted", review: "scored", targetQuarter: null });
  const v = await versionOf(id);
  const other = await seed();
  const secret = "Testo segreto del proponente H2a";
  // Una riga di Storia rifiutata dal database: la scheda non cambia, il servizio risponde «riprova».
  await q(`ALTER TABLE use_case_events ADD CONSTRAINT use_case_events_h2a_blocca CHECK (action NOT IN ('quando', 'modificato')) NOT VALID`);
  try {
    const failed = await svc.setWhen(as("builder"), id, v, "prossimo_trimestre");
    err(failed, "riprova");
    assert.equal(!failed.ok && failed.message, "Non riusciamo a salvare. Riprova.");
    err(await svc.updateUseCase(as("builder"), other, await versionOf(other), { description: secret }), "riprova", "testo nuovo");
  } finally {
    await q(`ALTER TABLE use_case_events DROP CONSTRAINT use_case_events_h2a_blocca`);
  }
  const unchanged = await row(id);
  assert.equal(unchanged.target_quarter, null);
  assert.equal(Number(unchanged.version), v);
  assert.equal((await storia(id)).length, 1);
  assert.equal((await row(other)).description, "Problema di prova");
  // Il log: solo l'operazione, il nome dell'errore, SQLSTATE e vincolo. Mai SQL, parametri o testi.
  const lines = log.mock.calls.map((call) => call.arguments.map(String).join(" "));
  assert.ok(lines.some((line) => line.startsWith("[use-case-service] set_when_failed")), lines.join("\n"));
  const update = lines.find((line) => line.startsWith("[use-case-service] update_use_case_failed"));
  assert.ok(update, lines.join("\n"));
  assert.match(update, /"code":"23514"/);
  assert.match(update, /"constraint":"use_case_events_h2a_blocca"/);
  for (const line of lines) {
    assert.ok(!line.includes(secret), "nessun testo della scheda nel log");
    assert.ok(!/Failed query|params:|update "use_cases"/i.test(line), "né l'SQL né i parametri");
  }

  // Ora passa: una riga, e una sola.
  const card = ok(await svc.setWhen(as("builder"), id, v, "prossimo_trimestre"));
  assert.equal(card.targetQuarter, quarter.nextQuarter(quarter.currentQuarter()));
  assert.equal((await storia(id)).length, 2);
  const ev = await lastEvent(id);
  assert.equal(ev.action, "quando");
  assert.deepEqual(ev.fields, ["quando"]);
  assert.equal(ev.phase_before, "approvato.piu_avanti");
  assert.equal(ev.phase_after, "approvato.trimestre");

  // Versione superata: nessuna riga.
  err(await svc.setWhen(as("builder"), id, v, "piu_avanti"), "versione_superata");
  assert.equal((await storia(id)).length, 2);
  // Lo stesso trimestre: niente da scrivere.
  ok(await svc.setWhen(as("builder"), id, card.version, "prossimo_trimestre"));
  assert.equal((await storia(id)).length, 2);
});

test("permessi riletti a ogni chiamata: ruolo cambiato tra due chiamate", opts, async () => {
  const id = await seed();
  const first = ok(await svc.decideUseCase(as("builder"), id, await versionOf(id), { type: "approva", quando: "piu_avanti" }));
  await q(`UPDATE workspace_memberships SET role = 'contributor' WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.wsA, ids.builder]);
  try {
    err(await svc.setWhen(as("builder"), id, first.version, "questo_trimestre"), "permesso_mancante", "declassato a contributore");
  } finally {
    await q(`UPDATE workspace_memberships SET role = 'function_lead' WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.wsA, ids.builder]);
  }
  ok(await svc.setWhen(as("builder"), id, first.version, "questo_trimestre"), "di nuovo revisore");

  // «Lateral Space» si rilegge anche lui: senza email verificata niente pannello rapido.
  await q(`UPDATE users SET email_verified = NULL WHERE id = $1::uuid`, [ids.ls]);
  try {
    err(await svc.createUseCases(as("ls"), [{ source: "manual", kind: "da_costruire", title: "Prova", description: null }]), "permesso_mancante");
  } finally {
    await q(`UPDATE users SET email_verified = now() WHERE id = $1::uuid`, [ids.ls]);
  }
  // Fuori dal workspace: nessun permesso, qualunque ruolo dica il contesto.
  await q(`DELETE FROM workspace_memberships WHERE workspace_id = $1::uuid AND user_id = $2::uuid`, [ids.wsA, ids.builder]);
  try {
    err(await svc.setWhen(as("builder"), id, (await versionOf(id)), "piu_avanti"), "permesso_mancante", "uscito dal workspace");
  } finally {
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'function_lead')`, [ids.wsA, ids.builder]);
  }
});

// ─── saveValuation, recordAiSuggestion ───────────────────────────────

test("saveValuation: KPI, valore, costo; valutata; aggregati ricalcolati; KPI vuoti tolti", opts, async () => {
  const id = await seed({ customScores: { impact: { profitability: 2 } } });
  const v = await versionOf(id);
  const card = ok(
    await svc.saveValuation(as("builder"), id, v, {
      kpis: { impact: { efficiency: 4, profitability: null }, feasibility: { effort: "2" } },
      valueEurYear: "60.000",
      cost: { band: 3 },
    }),
  );
  assert.equal(card.version, v + 1);
  assert.equal(card.portfolioReviewStatus, "scored");
  assert.deepEqual(card.customScores, { impact: { efficiency: 4 }, feasibility: { effort: 2 } });
  assert.equal(card.valueEurYear, 60000);
  assert.equal(card.costBand, 3);
  assert.equal(card.costEurOnce, null);
  assert.equal(card.reviewedBy, ids.builder);
  assert.ok(Number(card.overallImpactScore) > 0);
  assert.equal(card.phase.code, "da_valutare.valutata");
  const ev = await lastEvent(id);
  assert.equal(ev.action, "valutato");
  assert.deepEqual([...(ev.fields as string[])].sort(), ["costo", "kpi", "valore"]);

  // Un importo azzera la fascia; nessun cambiamento, nessuna scrittura.
  const amount = ok(await svc.saveValuation(as("builder"), id, card.version, { cost: { eurOnce: "40.000" } }));
  assert.equal(amount.costEurOnce, 40000);
  assert.equal(amount.costBand, null);
  const count = (await storia(id)).length;
  ok(await svc.saveValuation(as("builder"), id, amount.version, { cost: { eurOnce: 40000 } }));
  assert.equal((await storia(id)).length, count);

  err(await svc.saveValuation(as("builder"), id, amount.version, { kpis: { impact: { inventato: 3 } } }), "dati_non_validi", "KPI fuori modello");
  err(await svc.saveValuation(as("builder"), id, amount.version, { cost: { eurOnce: 1, band: 2 } }), "dati_non_validi", "importo e fascia");
  err(await svc.saveValuation(as("builder"), id, amount.version, { kpis: { esg: { environmental: 3 } } }), "dati_non_validi", "ESG spento");
  err(await svc.saveValuation(as("contributor"), id, amount.version, { valueEurYear: 1 }), "permesso_mancante");

  // Una scheda archiviata resta archiviata.
  const archived = await seed({ review: "archived", intake: { archiveReason: "superato" } });
  const a = ok(await svc.saveValuation(as("builder"), archived, await versionOf(archived), { valueEurYear: 1000 }));
  assert.equal(a.portfolioReviewStatus, "archived");
});

test("recordAiSuggestion e il codice non cambiano version: suggerimento, poi «Salva la valutazione» con la versione di prima", opts, async () => {
  const backup = { customScores: null, reviewNotes: "Note di prova", at: "2026-10-01T00:00:00.000Z" };
  const id = await seed({ code: null, review: "needs_inputs", aiSuggestion: { v1Backup: backup, rationale: "vecchia" } });
  const v = await versionOf(id);
  // Il codice assegnato dopo: version uguale.
  assert.match(String(await codes.assignUseCaseCodeSafely(ids.wsA, id)), /^XX-\d{4}$/);
  assert.equal(await versionOf(id), v);

  ok(
    await svc.recordAiSuggestion(system("ai", "ai"), id, {
      kind: "suggerimento",
      scores: { impact: { efficiency: 4, profitability: null }, feasibility: { effort: 2 } },
      rationale: "Motivazione di prova",
      model: "modello-finto",
    }),
  );
  const r = await row(id);
  assert.equal(Number(r.version), v, "ai_suggestion non fa salire version");
  const suggestion = r.ai_suggestion as Record<string, unknown>;
  assert.deepEqual(suggestion.scores, { impact: { efficiency: 4 }, feasibility: { effort: 2 } });
  assert.equal(suggestion.rationale, "Motivazione di prova");
  assert.equal(suggestion.kind, "suggerimento");
  assert.equal(suggestion.model, "modello-finto");
  assert.match(String(suggestion.at), /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(suggestion.v1Backup, backup, "la copia della v1 resta");
  // L'AI non tocca custom_scores, reviewed_by, reviewed_at, review_notes né lo stato.
  assert.equal(r.custom_scores, null);
  assert.equal(r.reviewed_by, null);
  assert.equal(r.reviewed_at, null);
  assert.equal(r.review_notes, null);
  assert.equal(r.portfolio_review_status, "needs_inputs");
  const ev = await lastEvent(id);
  assert.equal(ev.action, "suggerimento_ai");
  assert.equal(ev.actor_kind, "ai");
  assert.equal(ev.actor_user_id, null);
  assert.equal(ev.channel, "ai");

  // «Usa questi valori» e «Salva la valutazione» con la versione letta prima del suggerimento.
  ok(await svc.saveValuation(as("builder"), id, v, { kpis: { impact: { efficiency: 4 } } }));

  // Una persona che non valuta non chiede suggerimenti; i dati dell'AI si controllano.
  err(await svc.recordAiSuggestion(as("contributor"), id, { kind: "suggerimento", rationale: "x" }), "permesso_mancante");
  err(await svc.recordAiSuggestion(system("ai", "ai"), id, { kind: "boh" as "auto" }), "dati_non_validi");
  err(await svc.recordAiSuggestion(system("ai", "ai"), id, { kind: "auto", scores: { impact: { efficiency: 9 } } }), "dati_non_validi");
  err(await svc.recordAiSuggestion(system("ai", "ai"), randomUUID(), { kind: "auto" }), "non_trovato");
  // Da uno script: nella Storia è «sistema».
  ok(await svc.recordAiSuggestion(system("script"), id, { kind: "ricalibrazione", rationale: null }));
  assert.equal((await lastEvent(id)).actor_kind, "sistema");
});

test("recordAiSuggestion, regola 4 di §7.6: auto e ricalibrazione portano «in valutazione» solo una scheda ricevuta senza persona", opts, async () => {
  const fresh = await seed({ review: "needs_inputs" });
  const v = await versionOf(fresh);
  ok(await svc.recordAiSuggestion(system("ai", "ai"), fresh, { kind: "auto", rationale: "Motivazione di prova" }));
  const r = await row(fresh);
  assert.equal(r.portfolio_review_status, "in_review");
  assert.equal(r.reviewed_by, null, "l'AI non firma");
  assert.equal(Number(r.version), v + 1, "lo stato della revisione alza version");
  const ev = await lastEvent(fresh);
  assert.equal(ev.action, "suggerimento_ai");
  assert.equal(ev.actor_kind, "ai");
  assert.deepEqual(ev.fields, []);
  assert.equal(ev.phase_before, "da_valutare.nuova");
  assert.equal(ev.phase_after, "da_valutare.nuova");

  const recalibrated = await seed({ review: "needs_inputs" });
  ok(await svc.recordAiSuggestion(system("script"), recalibrated, { kind: "ricalibrazione" }));
  assert.equal((await row(recalibrated)).portfolio_review_status, "in_review");

  // «Chiedi un suggerimento»: lo stato e version restano.
  const asked = await seed({ review: "needs_inputs" });
  const va = await versionOf(asked);
  ok(await svc.recordAiSuggestion(as("builder"), asked, { kind: "suggerimento", rationale: "Motivazione di prova" }));
  const a = await row(asked);
  assert.equal(a.portfolio_review_status, "needs_inputs");
  assert.equal(Number(a.version), va);

  // Con una persona («Serve info»), in valutazione, valutata o archiviata: l'AI non cambia lo stato.
  const untouched: CardSeed[] = [
    { review: "needs_inputs", reviewedBy: ids.builder, publicNote: "Quante richieste a settimana?" },
    { review: "in_review" },
    { review: "scored" },
    { review: "archived", intake: { archiveReason: "superato" } },
  ];
  for (const c of untouched) {
    const id = await seed(c);
    const before = await versionOf(id);
    for (const kind of ["auto", "ricalibrazione", "suggerimento"] as const) {
      ok(await svc.recordAiSuggestion(system("ai", "ai"), id, { kind }), `${c.review} ${kind}`);
    }
    const after = await row(id);
    assert.equal(after.portfolio_review_status, c.review, `${c.review}: stato uguale`);
    assert.equal(after.reviewed_by, c.reviewedBy ?? null);
    assert.equal(Number(after.version), before, `${c.review}: version uguale`);
  }
});

/**
 * Ferma il primo statement di scrittura del servizio (`WITH upd AS`) che contiene `marker` e,
 * prima di mandarlo al database, fa `meanwhile`: una scrittura che arriva tra la lettura e il
 * commit. Restituisce il risultato di `run` e quanti statement con `marker` sono partiti.
 */
async function interleave<T>(marker: string, meanwhile: () => Promise<unknown>, run: () => Promise<T>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  assert.ok(descriptor?.get, "trasporto locale di scripts/uc-test/local-neon.cjs");
  const local = globalThis.fetch;
  let fired = false;
  let writes = 0;
  const intercept = async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    if (body.includes("WITH upd AS") && body.includes(marker)) {
      writes += 1;
      if (!fired) {
        fired = true;
        await meanwhile();
      }
    }
    return local(input, init);
  };
  Object.defineProperty(globalThis, "fetch", { configurable: true, get: () => intercept, set: descriptor.set });
  try {
    const result = await run();
    return { result, writes };
  } finally {
    Object.defineProperty(globalThis, "fetch", descriptor);
  }
}

test("aggregati dalle colonne salvate: una scrittura che non alza version tra lettura e commit fa rileggere", opts, async () => {
  // Scheda valutata: le colonne legacy cambiano senza alzare version.
  const id = await seed({ review: "scored" });
  await q(`UPDATE use_cases SET impact_time = 1, impact_quality = 1, feasibility_data = 3, feasibility_tech = 3 WHERE id = $1::uuid`, [id]);
  const v = await versionOf(id);
  let legacy: Awaited<ReturnType<Service["saveLegacyScores"]>> | null = null;
  const ai = await interleave(
    "suggerimento_ai",
    async () => {
      legacy = await svc.saveLegacyScores(rest("builder"), id, { impactTime: 5, impactQuality: 5 });
    },
    () => svc.recordAiSuggestion(system("ai", "ai"), id, { kind: "auto", rationale: "Motivazione di prova" }),
  );
  ok(ai.result);
  const legacyCard = ok(legacy!, "PATCH scores nel frattempo");
  assert.equal(ai.writes, 2, "il primo commit dell'AI trova la scheda cambiata e rilegge");
  const r = await row(id);
  assert.equal(Number(r.version), v, "nessuna delle due scritture alza version");
  assert.equal(r.impact_time, 5);
  assert.ok(Number(legacyCard.overallImpactScore) > 0);
  assert.equal(Number(r.overall_impact_score), Number(legacyCard.overallImpactScore), "aggregati dai punteggi salvati, non da quelli letti prima");
  assert.equal(r.category, legacyCard.category);

  // «Salva la valutazione» con un suggerimento dell'AI arrivato tra lettura e commit: si
  // ricalcola e passa, con la versione che la persona aveva.
  const saved = await interleave(
    "valutato",
    async () => ok(await svc.recordAiSuggestion(system("ai", "ai"), id, { kind: "suggerimento", scores: { impact: { efficiency: 2 } } })),
    () => svc.saveValuation(as("builder"), id, v, { valueEurYear: 1234 }),
  );
  const card = ok(saved.result);
  assert.equal(saved.writes, 2);
  assert.equal(card.valueEurYear, 1234);
  assert.equal(card.version, v + 1);
  assert.deepEqual((card.aiSuggestion as Record<string, unknown>).scores, { impact: { efficiency: 2 } });
});

// ─── decideUseCase ───────────────────────────────────────────────────

test("decideUseCase: Approva, Rimanda, Serve info, Non avviare, Riapri con la Storia", opts, async () => {
  const id = await seed({ intake: { hiddenFromSearch: true } });
  let card = ok(await svc.decideUseCase(as("builder"), id, await versionOf(id), { type: "approva", quando: "questo_trimestre", showToColleagues: true }));
  assert.equal(card.status, "accepted");
  assert.equal(card.targetQuarter, quarter.currentQuarter());
  assert.equal(card.hiddenFromSearch, false, "«Mostralo ai colleghi»");
  let ev = await lastEvent(id);
  assert.equal(ev.action, "decisione");
  assert.deepEqual([...(ev.fields as string[])].sort(), ["quando", "visibilita"]);
  assert.equal(ev.phase_before, "da_valutare.nuova");
  assert.equal(ev.phase_after, "approvato.trimestre");

  card = ok(await svc.decideUseCase(as("builder"), id, card.version, { type: "non_avviare", publicNote: "Non ora, grazie." }));
  assert.equal(card.status, "rejected");
  assert.equal(card.targetQuarter, null);
  assert.equal(card.publicNote, "Non ora, grazie.");
  assert.equal(card.phase.code, "chiuso.non_avviato");

  card = ok(await svc.decideUseCase(as("builder"), id, card.version, { type: "riapri" }));
  assert.equal(card.status, "proposed");
  assert.equal(card.portfolioReviewStatus, "in_review");
  assert.equal(card.phase.code, "da_valutare.nuova");

  const date = futureDate(30);
  card = ok(await svc.decideUseCase(as("builder"), id, card.version, { type: "rimanda", reviewBy: date as `${number}-${number}-${number}` }));
  assert.equal(card.reviewBy, date);
  assert.equal(card.phase.code, "da_valutare.rimandata");
  assert.deepEqual((await lastEvent(id)).fields, ["revisione"]);

  card = ok(await svc.decideUseCase(as("builder"), id, card.version, { type: "serve_info", publicNote: "Quante richieste a settimana?" }));
  assert.equal(card.portfolioReviewStatus, "needs_inputs");
  assert.equal(card.reviewedBy, ids.builder);
  assert.equal(card.reviewBy, null);
  assert.equal(card.phase.code, "da_valutare.serve_info");
  ev = await lastEvent(id);
  assert.deepEqual([...(ev.fields as string[])].sort(), ["nota_pubblica", "revisione"]);
  // La Storia non ha testi: nessuna riga contiene la nota.
  const [{ found }] = await q(
    `SELECT count(*)::int AS found FROM use_case_events e WHERE e.use_case_id = $1::uuid AND to_jsonb(e)::text LIKE '%richieste a settimana%'`,
    [id],
  );
  assert.equal(found, 0);

  // Il contributore non decide; i dati della decisione si controllano.
  err(await svc.decideUseCase(as("contributor"), id, card.version, { type: "approva", quando: "piu_avanti" }), "permesso_mancante");
  err(await svc.decideUseCase(as("builder"), id, card.version, { type: "non_avviare", publicNote: "" }), "dati_non_validi");
  err(await svc.decideUseCase(as("builder"), id, card.version, { type: "rimanda", reviewBy: "2020-01-01" }), "dati_non_validi");
  err(await svc.decideUseCase(as("builder"), id, card.version, { type: "riapri" }), "transizione_non_ammessa");
});

test("decideUseCase: Doppione di…, Archivia, Riapri da archiviata, Segna come diffusa, realizzato e in realizzazione", opts, async () => {
  const target = await seed({ code: "XX-0777" });
  const dup = await seed();
  err(await svc.decideUseCase(as("builder"), dup, await versionOf(dup), { type: "doppione", ofCode: "XX-0999" }), "dati_non_validi", "codice inesistente");
  err(await svc.decideUseCase(as("builder"), dup, await versionOf(dup), { type: "doppione", ofCode: (await row(dup)).code as string }), "dati_non_validi", "sé stesso");
  let card = ok(await svc.decideUseCase(as("builder"), dup, await versionOf(dup), { type: "doppione", ofCode: "xx-0777" }));
  assert.equal(card.portfolioReviewStatus, "archived");
  assert.equal(card.intake?.archiveReason, "duplicato");
  assert.equal(card.intake?.duplicateOfCode, "XX-0777");
  assert.equal(card.phase.label, "Chiuso · Doppione di XX-0777");
  assert.ok(target);

  card = ok(await svc.decideUseCase(as("builder"), dup, card.version, { type: "riapri" }));
  assert.equal(card.portfolioReviewStatus, "in_review");
  assert.equal(card.intake?.archiveReason, undefined);
  assert.equal(card.intake?.duplicateOfCode, undefined);

  card = ok(await svc.decideUseCase(as("builder"), dup, card.version, { type: "archivia", reason: "superato" }));
  assert.equal(card.phase.code, "chiuso.archiviato");
  err(await svc.decideUseCase(as("builder"), dup, card.version, { type: "archivia", reason: "superato" }), "transizione_non_ammessa");

  const bp = await seed({ kind: "best_practice", status: "accepted", review: "scored" });
  card = ok(await svc.decideUseCase(as("builder"), bp, await versionOf(bp), { type: "segna_diffusa" }));
  assert.equal(card.status, "implemented");
  assert.equal(card.phase.code, "realizzato.diffusa");

  const building = await seed({ status: "in_progress", review: "scored" });
  card = ok(await svc.decideUseCase(as("builder"), building, await versionOf(building), { type: "segna_realizzato" }));
  assert.equal(card.phase.code, "realizzato.realizzato");

  // «Segna come in realizzazione»: solo Lateral Space, con la sezione Casi d'uso spenta.
  const approved = await seed({ status: "accepted", review: "scored" });
  err(await svc.decideUseCase(as("builder"), approved, await versionOf(approved), { type: "segna_in_realizzazione" }), "permesso_mancante");
  card = ok(await svc.decideUseCase(as("ls"), approved, await versionOf(approved), { type: "segna_in_realizzazione" }));
  assert.equal(card.status, "in_progress");
  assert.equal(card.phase.code, "in_realizzazione.senza_dossier");
  ucOn();
  try {
    const another = await seed({ status: "accepted", review: "scored" });
    err(await svc.decideUseCase(as("ls"), another, await versionOf(another), { type: "segna_in_realizzazione" }), "transizione_non_ammessa", "dossier accesi");
  } finally {
    ucOff();
  }
});

test("setHiddenFromSearch: nascondi e mostra ai colleghi, con la Storia", opts, async () => {
  const id = await seed();
  let card = ok(await svc.setHiddenFromSearch(as("builder"), id, await versionOf(id), true));
  assert.equal(card.hiddenFromSearch, true);
  assert.deepEqual((await lastEvent(id)).fields, ["visibilita"]);
  assert.equal((await lastEvent(id)).action, "visibilita");
  const count = (await storia(id)).length;
  card = ok(await svc.setHiddenFromSearch(as("builder"), id, card.version, true));
  assert.equal((await storia(id)).length, count, "già nascosta: niente da scrivere");
  card = ok(await svc.setHiddenFromSearch(as("builder"), id, card.version, false));
  assert.equal(card.hiddenFromSearch, false);
  err(await svc.setHiddenFromSearch(as("contributor"), id, card.version, true), "permesso_mancante");
});

// ─── Dossier: errore forzato, sezione spenta, dossier attivo ─────────

test("errore uc forzato: le decisioni che dipendono dal dossier rispondono «riprova», le altre passano; sezione spenta passano tutte", opts, async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const make = async () => ({
    approved: await seed({ status: "accepted", review: "scored" }),
    building: await seed({ status: "in_progress", review: "scored" }),
    rejected: await seed({ status: "rejected", review: "scored" }),
    fresh: await seed(),
    fresh2: await seed(),
  });
  const dependent = async (c: Awaited<ReturnType<typeof make>>) => ({
    nonAvviare: await svc.decideUseCase(as("builder"), c.approved, await versionOf(c.approved), { type: "non_avviare", publicNote: "Nota di prova" }),
    doppione: await svc.decideUseCase(as("builder"), c.fresh2, await versionOf(c.fresh2), { type: "doppione", ofCode: (await row(c.fresh)).code as string }),
    archiviaApprovato: await svc.decideUseCase(as("builder"), c.approved, await versionOf(c.approved), { type: "archivia", reason: "superato" }),
    archiviaInRealizzazione: await svc.decideUseCase(as("builder"), c.building, await versionOf(c.building), { type: "archivia", reason: "altro" }),
    realizzato: await svc.decideUseCase(as("builder"), c.building, await versionOf(c.building), { type: "segna_realizzato" }),
    riapri: await svc.decideUseCase(as("builder"), c.rejected, await versionOf(c.rejected), { type: "riapri" }),
  });

  ucOn();
  const forced = await make();
  await q(`ALTER TABLE uc_cases RENAME COLUMN setup_completed_at TO setup_completed_at_h2a`);
  try {
    for (const [name, result] of Object.entries(await dependent(forced))) {
      err(result, "riprova", name);
      assert.equal(!result.ok && result.message, "Non riesco a leggere lo stato del dossier. Riprova tra poco.", name);
    }
    // Le altre scritture passano.
    const f = forced.fresh;
    ok(await svc.updateUseCase(as("builder"), f, await versionOf(f), { title: "Modifica con l'errore uc" }), "updateUseCase");
    ok(await svc.saveValuation(as("builder"), f, await versionOf(f), { valueEurYear: 5 }), "saveValuation");
    ok(await svc.setHiddenFromSearch(as("builder"), f, await versionOf(f), true), "setHiddenFromSearch");
    ok(await svc.recordAiSuggestion(system("ai", "ai"), f, { kind: "suggerimento", rationale: "x" }), "recordAiSuggestion");
    ok(await svc.decideUseCase(as("builder"), f, await versionOf(f), { type: "rimanda", reviewBy: futureDate(10) as `${number}-${number}-${number}` }), "rimanda");
    ok(await svc.decideUseCase(as("builder"), f, await versionOf(f), { type: "serve_info", publicNote: "Serve un dato." }), "serve_info");
    ok(await svc.decideUseCase(as("builder"), f, await versionOf(f), { type: "approva", quando: "piu_avanti" }), "approva");
    ok(await svc.setWhen(as("builder"), f, await versionOf(f), "questo_trimestre"), "setWhen");
    ok(await svc.redactText(as("ls"), f, await versionOf(f), ["problema"]), "redactText");
    const fresh3 = await seed();
    ok(await svc.decideUseCase(as("builder"), fresh3, await versionOf(fresh3), { type: "archivia", reason: "altro" }), "archivia da Da valutare");
  } finally {
    await q(`ALTER TABLE uc_cases RENAME COLUMN setup_completed_at_h2a TO setup_completed_at`);
    ucOff();
  }
  assert.ok(log.mock.callCount() > 0, "una riga di log per lettura fallita");

  // Sezione spenta: passano tutte.
  const off = await make();
  for (const [name, result] of Object.entries(await dependent(off))) {
    if (name === "archiviaApprovato" || name === "realizzato") continue; // la scheda è già cambiata nella prova prima
    ok(result as never, name);
  }
  const off2 = await make();
  ok(await svc.decideUseCase(as("builder"), off2.approved, await versionOf(off2.approved), { type: "archivia", reason: "superato" }), "archivia da Approvato");
  ok(await svc.decideUseCase(as("builder"), off2.building, await versionOf(off2.building), { type: "segna_realizzato" }), "segna_realizzato");
});

test("dossier attivo: niente Archivia o Non avviare, «Segna come realizzato» solo «In uso»; realizzazione avviata nella Storia", opts, async () => {
  ucOn();
  try {
    const id = await seed({ status: "accepted", review: "scored" });
    const caseId = await insertDossier(id, "raccolta");
    const v = await versionOf(id);
    const archive = await svc.decideUseCase(as("builder"), id, v, { type: "archivia", reason: "superato" });
    err(archive, "transizione_non_ammessa");
    assert.equal(!archive.ok && archive.message, "Per archiviarlo, chiudi prima il dossier.");
    err(await svc.decideUseCase(as("builder"), id, v, { type: "non_avviare", publicNote: "No." }), "transizione_non_ammessa");
    err(await svc.decideUseCase(as("builder"), id, v, { type: "segna_realizzato" }), "transizione_non_ammessa");

    // «Avvia la realizzazione»: la riga di Storia, una volta sola, solo Lateral Space.
    err(await svc.recordRealizationStarted(as("builder"), id, caseId), "permesso_mancante");
    err(await svc.recordRealizationStarted(as("ls"), id, randomUUID()), "transizione_non_ammessa");
    ok(await svc.recordRealizationStarted(as("ls"), id, caseId));
    ok(await svc.recordRealizationStarted(as("ls"), id, caseId));
    const started = (await storia(id)).filter((e) => e.action === "realizzazione_avviata");
    assert.equal(started.length, 1);
    assert.equal(started[0].phase_before, "approvato.piu_avanti");
    assert.equal(started[0].phase_after, "in_realizzazione.dossier");
    assert.equal(started[0].actor_user_id, ids.ls);
    assert.equal(await versionOf(id), v, "status resta accepted");

    await q(`UPDATE uc_cases SET status = 'in_esercizio' WHERE id = $1::uuid`, [caseId]);
    const done = ok(await svc.decideUseCase(as("builder"), id, v, { type: "segna_realizzato" }));
    assert.equal(done.status, "implemented");
    assert.equal(done.dossier?.caseId, caseId);

    // Sezione spenta: niente «realizzazione avviata».
    ucOff();
    err(await svc.recordRealizationStarted(as("ls"), id, caseId), "transizione_non_ammessa");
  } finally {
    ucOff();
  }
});

// ─── redactText ──────────────────────────────────────────────────────

test("redactText: «[testo rimosso]» nella scheda, in intake, in ai_suggestion e nel segnale della campanella, nessuna copia nella Storia", opts, async () => {
  const secrets = {
    title: "Titolo da oscurare H2a",
    description: "Problema da oscurare H2a",
    note: "Nota da oscurare H2a",
    prompt: "Prompt da oscurare H2a",
    reasoning: "Motivazione della stima da oscurare H2a",
    rationale: "Motivazione AI da oscurare H2a",
    backupRationale: "Motivazione v1 nella copia da oscurare H2a",
    notesRationale: "Motivazione v1 nelle note da oscurare H2a",
  };
  const backupAt = "2026-10-01T00:00:00.000Z";
  const id = await seed({
    title: secrets.title,
    description: secrets.description,
    publicNote: secrets.note,
    intake: {
      area: "finanza",
      toolsOther: "Strumento da oscurare H2a",
      promptSnippet: secrets.prompt,
      sourceConversation: "Conversazione da oscurare H2a",
      frequency: "settimanale",
      proposerEstimate: { efficiency: { score: 4, reasoning: secrets.reasoning }, effort: { score: 2, reasoning: secrets.reasoning } },
    },
    aiSuggestion: {
      rationale: secrets.rationale,
      scores: { impact: { efficiency: 4 } },
      kind: "auto",
      // La copia di `scoring-v2 --apply`: le note di prima, con i blocchi dell'AI.
      v1Backup: {
        customScores: null,
        reviewNotes: `Nota del revisore H2a\n\nAuto-ranking AI:\n${secrets.backupRationale}\n\nSeconda riga\n\nSuggerimento AI:\n${secrets.backupRationale}`,
        at: backupAt,
      },
    },
    // Le note della v1, con un blocco dell'AI.
    reviewNotes: `Nota interna H2a\n\nRicalibrazione AI:\n${secrets.notesRationale}`,
  });
  const other = await seed({ title: "Altra scheda H2a" });
  await q(
    `INSERT INTO weekly_signals (workspace_id, signal_type, title, description, related_entity_type, related_entity_id)
     VALUES ($1::uuid, 'new_portfolio_item', $2, $3, 'use_case', $4::uuid),
            ($1::uuid, 'new_portfolio_item', 'Use case AI: Altra scheda H2a', 'Altro problema', 'use_case', $5::uuid)`,
    [ids.wsA, `Use case AI: ${secrets.title}`, secrets.description.slice(0, 220), id, other],
  );
  const v = await versionOf(id);
  err(await svc.redactText(as("builder"), id, v, ["titolo"]), "permesso_mancante", "AI Builder del cliente senza gestione");
  err(await svc.redactText(as("ls"), id, v, ["colore" as "titolo"]), "dati_non_validi");
  err(await svc.redactText(as("ls"), id, v, []), "dati_non_validi");
  err(await svc.redactText(as("ls"), id, v, ["limiti"]), "dati_non_validi", "niente testo nei limiti");

  const card = ok(await svc.redactText(as("manager"), id, v, ["titolo", "problema", "intake", "motivazione_ai", "nota_pubblica"]));
  assert.equal(card.title, PLACEHOLDER);
  assert.equal(card.description, PLACEHOLDER);
  assert.equal(card.publicNote, PLACEHOLDER);
  assert.equal(card.version, v + 1);
  const r = await row(id);
  const intake = r.intake as Record<string, unknown>;
  assert.equal(intake.toolsOther, PLACEHOLDER);
  assert.equal(intake.promptSnippet, PLACEHOLDER);
  assert.equal(intake.sourceConversation, PLACEHOLDER);
  assert.deepEqual(intake.proposerEstimate, {
    efficiency: { score: 4, reasoning: PLACEHOLDER },
    effort: { score: 2, reasoning: PLACEHOLDER },
  });
  assert.equal(intake.area, "finanza", "l'area non era tra i campi scelti");
  assert.equal(intake.frequency, "settimanale");
  const suggestion = r.ai_suggestion as Record<string, unknown>;
  assert.equal(suggestion.rationale, PLACEHOLDER);
  assert.deepEqual(suggestion.scores, { impact: { efficiency: 4 } });
  // Ogni blocco dell'AI tiene la sua etichetta; le note del revisore restano.
  assert.deepEqual(suggestion.v1Backup, {
    customScores: null,
    reviewNotes: `Nota del revisore H2a\n\nAuto-ranking AI:\n${PLACEHOLDER}\n\nSuggerimento AI:\n${PLACEHOLDER}`,
    at: backupAt,
  });
  assert.equal(r.review_notes, `Nota interna H2a\n\nRicalibrazione AI:\n${PLACEHOLDER}`);

  const signals = await q(`SELECT related_entity_id, title, description FROM weekly_signals WHERE workspace_id = $1::uuid ORDER BY title`, [ids.wsA]);
  const mine = signals.find((s) => s.related_entity_id === id)!;
  assert.equal(mine.title, PLACEHOLDER);
  assert.equal(mine.description, PLACEHOLDER);
  const others = signals.find((s) => s.related_entity_id === other)!;
  assert.equal(others.title, "Use case AI: Altra scheda H2a", "il segnale di un'altra scheda non cambia");

  const ev = await lastEvent(id);
  assert.equal(ev.action, "oscurato");
  assert.deepEqual([...(ev.fields as string[])].sort(), ["intake", "nota_pubblica", "problema", "titolo"]);
  const [{ copies }] = await q(
    `SELECT count(*)::int AS copies FROM use_case_events e
      WHERE e.use_case_id = $1::uuid AND to_jsonb(e)::text LIKE ANY($2::text[])`,
    [id, Object.values(secrets).map((s) => `%${s}%`)],
  );
  assert.equal(copies, 0, "nessuna copia dei testi nella Storia");
  const [{ left }] = await q(
    `SELECT count(*)::int AS left FROM use_cases u WHERE u.id = $1::uuid AND to_jsonb(u)::text LIKE ANY($2::text[])`,
    [id, Object.values(secrets).map((s) => `%${s}%`)],
  );
  assert.equal(left, 0, "nessun testo scelto resta nella scheda");

  // Già oscurato: niente da oscurare.
  err(await svc.redactText(as("ls"), id, card.version, ["titolo"]), "dati_non_validi");
  err(await svc.redactText(as("ls"), id, card.version, ["motivazione_ai"]), "dati_non_validi", "motivazione già oscurata");
  // La motivazione dell'AI solo nella copia della v1: si oscura lo stesso, senza alzare version.
  const backupOnly = await seed({
    aiSuggestion: { v1Backup: { customScores: null, reviewNotes: `Ricalibrazione AI:\n${secrets.backupRationale}`, at: backupAt } },
  });
  const vb = await versionOf(backupOnly);
  ok(await svc.redactText(as("ls"), backupOnly, vb, ["motivazione_ai"]));
  assert.deepEqual((await row(backupOnly)).ai_suggestion, {
    v1Backup: { customScores: null, reviewNotes: `Ricalibrazione AI:\n${PLACEHOLDER}`, at: backupAt },
  });
  assert.equal(await versionOf(backupOnly), vb);
  assert.deepEqual((await lastEvent(backupOnly)).fields, []);
  // Note del revisore senza blocchi dell'AI: non sono la motivazione dell'AI.
  const notesOnly = await seed({ reviewNotes: "Solo note del revisore H2a" });
  err(await svc.redactText(as("ls"), notesOnly, await versionOf(notesOnly), ["motivazione_ai"]), "dati_non_validi");
  assert.equal((await row(notesOnly)).review_notes, "Solo note del revisore H2a");
  // L'area si oscura solo se scelta; la Storia la nomina.
  ok(await svc.redactText(as("ls"), id, card.version, ["area"]));
  assert.equal(((await row(id)).intake as Record<string, unknown>).area, PLACEHOLDER);
  assert.deepEqual((await lastEvent(id)).fields, ["area"]);
});

// ─── REST di oggi (§9.3) ─────────────────────────────────────────────

function rest(person: Person, workspaceId = ids.wsA): Ctx {
  return svc.restWriteContext({ id: ids[person], email: emails[person], emailVerified: true }, workspaceId, "contributor");
}

test("PATCH status con le forme di oggi: la mappa di oggi ovunque; area spenta come oggi, area accesa con le decisioni di §3.7", opts, async () => {
  assert.equal(rest("ls").actor.isLateralSpace, true);
  assert.equal(rest("builder").actor.isLateralSpace, false);
  assert.equal(rest("builder").channel, "rest");

  // Workspace B, area spenta: cambia solo lo stato, come oggi, con la riga di Storia.
  const id = await seed({ workspaceId: ids.wsB, status: "proposed", review: "in_review" });
  let card = ok(await svc.applyLegacyStatus(rest("builder", ids.wsB), id, "accepted"));
  assert.equal(card.status, "accepted");
  assert.equal(card.targetQuarter, null);
  assert.equal(card.phase.label, "Approvato · Più avanti");
  let ev = await lastEvent(id);
  assert.equal(ev.action, "decisione");
  assert.equal(ev.channel, "rest");
  assert.equal(ev.actor_user_id, ids.builder);
  assert.deepEqual(ev.fields, []);
  assert.equal(ev.phase_before, "da_valutare.nuova");
  assert.equal(ev.phase_after, "approvato.piu_avanti");

  // Lo stesso stato: niente da scrivere, come oggi.
  const count = (await storia(id)).length;
  ok(await svc.applyLegacyStatus(rest("builder", ids.wsB), id, "accepted"));
  assert.equal((await storia(id)).length, count);

  // Un AI Builder del cliente porta in sviluppo e chiude, come oggi; fuori mappa no.
  card = ok(await svc.applyLegacyStatus(rest("builder", ids.wsB), id, "in_progress"));
  assert.equal(card.status, "in_progress");
  card = ok(await svc.applyLegacyStatus(rest("builder", ids.wsB), id, "implemented"));
  assert.equal(card.status, "implemented");
  const closed = await svc.applyLegacyStatus(rest("builder", ids.wsB), id, "rejected");
  err(closed, "transizione_non_ammessa");
  assert.equal(!closed.ok && closed.message, 'Transizione non consentita: da "implemented" a "rejected".');
  assert.equal((await storia(id)).length, count + 2);

  // accepted → implemented per uno use case «Da costruire» e una scheda archiviata: come oggi.
  const direct = await seed({ workspaceId: ids.wsB, status: "accepted", review: "scored" });
  assert.equal(ok(await svc.applyLegacyStatus(rest("builder", ids.wsB), direct, "implemented")).status, "implemented");
  const archived = await seed({ workspaceId: ids.wsB, status: "proposed", review: "archived", intake: { archiveReason: "superato" } });
  card = ok(await svc.applyLegacyStatus(rest("builder", ids.wsB), archived, "rejected"));
  assert.equal(card.status, "rejected");
  assert.equal(card.portfolioReviewStatus, "archived");
  // Con la sezione Casi d'uso accesa, Lateral Space porta in sviluppo come oggi.
  ucOn();
  try {
    const approvedB = await seed({ workspaceId: ids.wsB, status: "accepted", review: "scored" });
    assert.equal(ok(await svc.applyLegacyStatus(rest("ls", ids.wsB), approvedB, "in_progress")).status, "in_progress");
  } finally {
    ucOff();
  }
  err(await svc.applyLegacyStatus(rest("contributor", ids.wsB), direct, "rejected"), "permesso_mancante", "non membro di B");

  // Workspace A, area accesa: prima la mappa, poi la decisione di §3.7.
  const fresh = await seed({ status: "proposed", review: "in_review" });
  card = ok(await svc.applyLegacyStatus(rest("builder"), fresh, "accepted"));
  assert.equal(card.phase.label, "Approvato · Più avanti");
  card = ok(await svc.applyLegacyStatus(rest("builder"), fresh, "rejected"));
  assert.equal(card.status, "rejected");
  assert.equal(card.publicNote, null, "nessuna nota obbligatoria (modo legacy)");
  ev = await lastEvent(fresh);
  assert.equal(ev.action, "decisione");
  assert.equal(ev.phase_after, "chiuso.non_avviato");
  const back = await svc.applyLegacyStatus(rest("builder"), fresh, "proposed");
  err(back, "transizione_non_ammessa");
  assert.equal(!back.ok && back.message, 'Transizione non consentita: da "rejected" a "proposed".');

  const bp = await seed({ kind: "best_practice", status: "accepted", review: "scored" });
  assert.equal(ok(await svc.applyLegacyStatus(rest("builder"), bp, "implemented")).phase.code, "realizzato.diffusa");
  const approved = await seed({ status: "accepted", review: "scored" });
  err(await svc.applyLegacyStatus(rest("builder"), approved, "in_progress"), "permesso_mancante", "«Segna come in realizzazione» solo Lateral Space");
  err(await svc.applyLegacyStatus(rest("builder"), approved, "implemented"), "transizione_non_ammessa", "«Segna come realizzato» solo da In realizzazione");
  assert.equal(ok(await svc.applyLegacyStatus(rest("ls"), approved, "in_progress")).status, "in_progress");
  assert.equal(ok(await svc.applyLegacyStatus(rest("builder"), approved, "implemented")).status, "implemented");
  err(await svc.applyLegacyStatus(rest("contributor"), approved, "rejected"), "permesso_mancante");
  err(await svc.applyLegacyStatus(rest("builder"), randomUUID(), "accepted"), "non_trovato");
});

test("PATCH scores e wave con le forme di oggi", opts, async () => {
  const id = await seed({ review: "in_review" });
  const v = await versionOf(id);
  const card = ok(await svc.saveLegacyScores(rest("builder"), id, { impactTime: 4, impactQuality: 5, feasibilityData: 2 }));
  assert.equal(card.impactTime, 4);
  assert.equal(card.portfolioReviewStatus, "scored");
  assert.ok(Number(card.overallImpactScore) > 0, "aggregati ricalcolati");
  assert.equal(card.version, v + 1, "sale per lo stato della revisione");
  const ev = await lastEvent(id);
  assert.equal(ev.action, "valutato");
  assert.deepEqual(ev.fields, ["kpi"]);
  assert.equal(ev.channel, "rest");
  err(await svc.saveLegacyScores(rest("builder"), id, { impactTime: 7 }), "dati_non_validi");
  err(await svc.saveLegacyScores(rest("builder"), id, {}), "dati_non_validi");
  err(await svc.saveLegacyScores(rest("contributor"), id, { impactTime: 3 }), "permesso_mancante");

  const count = (await storia(id)).length;
  const category = card.category === "capability_builder" ? "not_yet" : "capability_builder";
  const waved = ok(await svc.setLegacyCategory(rest("builder"), id, category));
  assert.equal(waved.category, category);
  assert.equal(waved.version, card.version, "la categoria non fa salire version");
  assert.equal((await storia(id)).length, count + 1, "una riga di Storia per scrittura");
  const wev = await lastEvent(id);
  assert.equal(wev.action, "modificato");
  assert.deepEqual(wev.fields, [], "la categoria non ha un nome nell'elenco chiuso");
  assert.equal(wev.channel, "rest");
  assert.equal(wev.actor_user_id, ids.builder);
  ok(await svc.setLegacyCategory(rest("builder"), id, category));
  assert.equal((await storia(id)).length, count + 1, "la stessa categoria non scrive");
  err(await svc.setLegacyCategory(rest("contributor"), id, "quick_win"), "permesso_mancante");

  // Risposte HTTP degli errori: `{ error, code }`, con gli stati di oggi. Un successo non passa
  // da `restResponse` (solo errori): la rotta risponde con `toUseCaseApiRow`.
  const expected: Record<string, number> = {
    permesso_mancante: 403,
    non_trovato: 404,
    versione_superata: 409,
    transizione_non_ammessa: 400,
    dati_non_validi: 400,
    area_spenta: 404,
    riprova: 503,
  };
  for (const [error, status] of Object.entries(expected)) {
    const response = svc.restResponse({ ok: false, error: error as never, message: "m" });
    assert.equal(response.status, status, error);
    assert.deepEqual(await response.json(), { error: "m", code: error });
  }
});

test("la scheda restituita non porta chi ha proposto, nemmeno in intake", opts, async () => {
  const id = await seed({ intake: { area: "finanza", submitterEmail: "persona@cliente.test" } });
  await q(`UPDATE use_cases SET proposed_by = 'persona@cliente.test' WHERE id = $1::uuid`, [id]);
  const card = ok(await svc.updateUseCase(as("manager"), id, await versionOf(id), { aiLab: "AI Lab di prova" }));
  assert.deepEqual(card.intake, { area: "finanza" });
  assert.ok(!JSON.stringify(card).includes("persona@cliente.test"));
});

// ─── Storia in lettura ───────────────────────────────────────────────

test("listUseCaseEvents: dalla più recente, persona solo per le azioni del team, «Mostra tutto» e prima data", opts, async () => {
  const id = await seed();
  let v = await versionOf(id);
  for (const title of ["Uno di prova", "Due di prova", "Tre di prova"]) {
    v = ok(await svc.updateUseCase(as("builder"), id, v, { title })).version;
  }
  ok(await svc.recordAiSuggestion(system("ai", "ai"), id, { kind: "auto", rationale: "r" }));
  const list = await events.listUseCaseEvents(ids.wsA, id, 3);
  assert.equal(list.events.length, 3);
  assert.equal(list.hasMore, true);
  assert.deepEqual(list.events.map((e) => e.action), ["suggerimento_ai", "modificato", "modificato"]);
  assert.equal(list.events[0].actorName, null, "l'AI non è una persona");
  assert.equal(list.events[1].actorName, "Persona di prova builder");
  assert.ok(list.startedAt instanceof Date);
  const all = await events.listUseCaseEvents(ids.wsA, id);
  assert.equal(all.hasMore, false);
  assert.equal(all.events.at(-1)?.action, "creato");
  assert.equal(all.events.at(-1)?.actorName, null, "la creazione non mostra mai una persona");
  assert.equal(all.startedAt?.getTime(), all.events.at(-1)?.at.getTime());
  assert.deepEqual(await events.listUseCaseEvents(ids.wsB, id), { events: [], hasMore: false, startedAt: null }, "altro workspace");
  assert.deepEqual(await events.listUseCaseEvents(ids.wsA, "non-un-uuid"), { events: [], hasMore: false, startedAt: null });
});

// ─── Unità (anche dentro npm run check) ──────────────────────────────

test("use-case-lifecycle.ts non cambia: allowedNextStatuses('rejected') resta vuoto", async () => {
  const lifecycle = await import("../use-case-lifecycle.ts");
  assert.deepEqual(lifecycle.allowedNextStatuses("rejected"), []);
  assert.equal(lifecycle.isAllowedStatusTransition("rejected", "proposed"), false);
  assert.equal(lifecycle.isAllowedStatusTransition("draft", "proposed"), false);
  assert.deepEqual(lifecycle.allowedNextStatuses("accepted"), ["in_progress", "implemented", "rejected"]);
});
