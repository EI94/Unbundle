import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// Nuovo use case e Activity mapping (docs/use-case/PIANO-LAVORI.md H3c; docs/use-case/DESIGN.md
// §5.2, §5.3, §5.5, §8, §8.5, §8.6, §9.1 passo 6): src/lib/use-cases/create-flow.ts e
// create-data.ts, il cuore delle action di src/lib/actions/use-case-create.ts e di
// `generateUseCasesAction`, sul servizio vero e con trasporti finti per valutazione dell'AI,
// notifiche e generatore (nessuna chiamata al modello, a Slack o a un webhook).
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del pacchetto
//   hub_<id> su 127.0.0.1) gira sul database di prova.
// - Dentro `npm run check` si salta: in testa solo moduli di Node; i moduli dell'app arrivano
//   con `await import()` dentro `before()`. Dati sintetici, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) {
    throw new Error("Run this suite only on a package database hub_<id>");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type Flow = typeof import("./create-flow.ts");
type Data = typeof import("./create-data.ts");
type Create = typeof import("./create.ts");
type Perms = typeof import("./permissions.ts");
type Hub = typeof import("../db/queries/use-case-hub.ts");
type UseCaseQueries = typeof import("../db/queries/use-cases.ts");
type CostBands = typeof import("./cost-bands.ts");
type ReviewTeam = typeof import("../review-team.ts");
type ConnectorSearch = typeof import("../connector/tool-queries.ts");
type Service = typeof import("./service.ts");
type Ctx = import("./service.ts").WriteContext;
type FollowUpDeps = import("./create-flow.ts").CreateFollowUpDeps;
type UseCase = import("../db/schema.ts").UseCase;

let flow: Flow;
let data: Data;
let create: Create;
let perms: Perms;
let hub: Hub;
let queries: UseCaseQueries;
let costBands: CostBands;
let reviewTeam: ReviewTeam;
let connector: ConnectorSearch;
let service: Service;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  wsA: randomUUID(),
  wsB: randomUUID(),
  department: randomUUID(),
  ls: randomUUID(),
  builder: randomUUID(),
  manager: randomUUID(),
  contributor: randomUUID(),
  learner: randomUUID(),
};
const emails = {
  ls: `ls.${suffix}@ls.test`,
  builder: `builder.${suffix}@cliente.test`,
  manager: `manager.${suffix}@cliente.test`,
  contributor: `contributor.${suffix}@cliente.test`,
  learner: `learner.${suffix}@cliente.test`,
};
const roles: Record<Person, string> = {
  ls: "transformation_lead",
  builder: "function_lead",
  manager: "exec_sponsor",
  contributor: "contributor",
  learner: "learner",
};
type Person = keyof typeof emails;

const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

/** Una persona che scrive dalla pagina. Ruolo e «Lateral Space» li rilegge il servizio. */
function as(person: Person, extra: Partial<Ctx> = {}): Ctx {
  return {
    ...flow.writeContextFor(ids.wsA, { userId: ids[person], role: roles[person], isLateralSpace: person === "ls" }),
    ...extra,
  };
}

function viewerOf(person: Person) {
  return { userId: ids[person], email: emails[person], emailVerified: true, role: roles[person], isLateralSpace: person === "ls" };
}

/** Trasporti finti: si registrano le chiamate; i lavori «dopo la risposta» partono solo con `runScheduled`. */
function fakeTransports(opts: { autoScoreFails?: boolean } = {}) {
  const scheduled: Array<() => Promise<void>> = [];
  const calls = {
    autoScore: [] as Array<Parameters<FollowUpDeps["autoScore"]>[0]>,
    notify: [] as Array<{ useCaseId: string; workspaceId: string; source: string }>,
    loaded: [] as string[],
  };
  const deps: FollowUpDeps = {
    schedule: (task) => {
      scheduled.push(task);
    },
    autoScore: async (params) => {
      calls.autoScore.push(params);
      if (opts.autoScoreFails) throw Object.assign(new Error("modello non raggiungibile"), { name: "FakeModelError" });
      const row = await queries.getUseCaseById(params.useCaseId);
      assert.ok(row, "la scheda c'è");
      return row;
    },
    notify: async ({ useCase, workspaceId, source }) => {
      calls.notify.push({ useCaseId: useCase.id, workspaceId, source });
    },
    loadUseCase: async (useCaseId) => {
      calls.loaded.push(useCaseId);
      return (await queries.getUseCaseById(useCaseId)) as UseCase | null;
    },
  };
  return {
    deps,
    scheduled,
    calls,
    runScheduled: async () => {
      for (const task of scheduled.splice(0)) await task();
    },
  };
}

async function row(id: string): Promise<Record<string, unknown>> {
  const [r] = await q(`SELECT * FROM use_cases WHERE id = $1::uuid`, [id]);
  assert.ok(r, "la scheda c'è");
  return r;
}

async function storia(id: string): Promise<Record<string, unknown>[]> {
  return q(`SELECT action, channel, actor_kind, actor_user_id FROM use_case_events WHERE use_case_id = $1::uuid ORDER BY at, id`, [id]);
}

async function countByTitle(title: string): Promise<number> {
  const [r] = await q(`SELECT count(*)::int AS n FROM use_cases WHERE workspace_id = ANY($1::uuid[]) AND title = $2`, [[ids.wsA, ids.wsB], title]);
  return Number(r.n);
}

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }, label = "esito"): T {
  if (!result.ok) assert.fail(`${label}: atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}

function err(result: { ok: boolean; error?: string }, error: string, label = "esito") {
  assert.equal(result.ok, false, `${label}: atteso un errore ${error}`);
  assert.equal(result.error, error, label);
}

/** Il modulo come lo legge FormData. */
function formData(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

const FORM = {
  kind: "da_costruire",
  title: `Smistamento richieste ${suffix}`,
  description: "Le richieste arrivano in ordine sparso",
  flowDescription: "Claude legge e smista",
  businessCase: "Meno attese",
  humanInTheLoop: "Un operatore controlla",
  dataRequirements: "Le richieste dell'ultimo anno",
};

async function insertActivity(title: string, classification: string | null, workspaceId = ids.wsA): Promise<string> {
  const id = randomUUID();
  await q(
    `INSERT INTO activities (id, department_id, workspace_id, title, classification) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::classification)`,
    [id, ids.department, workspaceId, title, classification],
  );
  return id;
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  flow = await import("./create-flow.ts");
  data = await import("./create-data.ts");
  create = await import("./create.ts");
  perms = await import("./permissions.ts");
  hub = await import("../db/queries/use-case-hub.ts");
  queries = await import("../db/queries/use-cases.ts");
  costBands = await import("./cost-bands.ts");
  reviewTeam = await import("../review-team.ts");
  connector = await import("../connector/tool-queries.ts");
  service = await import("./service.ts");

  process.env.USE_CASE_HUB_WORKSPACES = ids.wsA;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H3c', $2)`, [ids.org, `hub-h3c-${ids.org}`]);
  await q(
    `INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $3::uuid, 'Prova H3c A'), ($2::uuid, $3::uuid, 'Prova H3c B')`,
    [ids.wsA, ids.wsB, ids.org],
  );
  for (const person of Object.keys(emails) as Person[]) {
    await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, $3, now())`, [ids[person], emails[person], `Persona di prova ${person}`]);
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3::member_role)`, [ids.wsA, ids[person], roles[person]]);
  }
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'transformation_lead')`, [ids.wsB, ids.ls]);
  await q(`INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix) VALUES ($1::uuid, $2, 'XX')`, [ids.wsA, `hub-h3c-${suffix}`]);
  await q(`INSERT INTO departments (id, workspace_id, name) VALUES ($1::uuid, $2::uuid, 'Reparto di prova')`, [ids.department, ids.wsA]);
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.keys(emails).map((p) => ids[p as Person])]);
});

// ─── Pannello rapido (§5.2) ──────────────────────────────────────────

test("pannello rapido: source manual, nessun proponente, AI Transformation nascosta, codice subito, nessuna notifica", opts, async () => {
  const t = fakeTransports();
  const lab = `AI Lab Prova ${suffix} · 12 ott`;
  const first = ok(
    await flow.createQuickUseCase(as("ls"), { title: `Prova rapida uno ${suffix}`, problem: "Un problema in una riga", aiLab: lab }, t.deps, { isLateralSpace: true }),
  );
  assert.match(String(first.code), /^XX-\d{4}$/, "codice subito");
  const r = await row(first.id);
  assert.equal(r.code, first.code);
  assert.equal(r.source, "manual");
  assert.equal(r.proposed_by, null);
  assert.equal(r.origin, "transformation");
  assert.deepEqual(r.intake, { hiddenFromSearch: true });
  assert.equal(r.status, "proposed");
  assert.equal(r.portfolio_review_status, "needs_inputs");
  assert.equal(r.portfolio_kind, "use_case_ai");
  assert.equal(r.description, "Un problema in una riga");
  assert.equal(r.ai_lab, lab);
  assert.ok(r.submitted_at, "submitted_at");
  assert.equal(r.reviewed_by, null);
  assert.equal(r.custom_scores, null, "nessuna valutazione dell'AI");
  assert.deepEqual(await storia(first.id), [{ action: "creato", channel: "pagina", actor_kind: "proponente", actor_user_id: null }]);

  // «Salva e aggiungi un altro»: stesso AI Lab, codice nuovo; tipo e origine cambiati dai chip.
  const second = ok(
    await flow.createQuickUseCase(
      as("ls"),
      { title: `Prova rapida due ${suffix}`, problem: "Un altro problema", aiLab: lab, origin: "adoption", kind: "da_diffondere" },
      t.deps,
      { isLateralSpace: true },
    ),
  );
  assert.notEqual(second.code, first.code);
  const r2 = await row(second.id);
  assert.equal(r2.origin, "adoption");
  assert.equal(r2.intake, null, "dal basso non nasce nascosta");
  assert.equal(r2.portfolio_kind, "best_practice");
  assert.equal(r2.proposed_by, null);

  // Nessuna valutazione dell'AI e nessuna notifica (§1.2 punti 6 e 13): niente da fare dopo la risposta.
  assert.equal(t.scheduled.length, 0);
  assert.deepEqual(t.calls, { autoScore: [], notify: [], loaded: [] });
  const [signals] = await q(`SELECT count(*)::int AS n FROM weekly_signals WHERE related_entity_id = ANY($1::uuid[])`, [[first.id, second.id]]);
  assert.equal(Number(signals.n), 0, "nessun segnale in campanella");

  // «AI Lab»: i valori del workspace, dal più recente; il campo parte dall'ultimo usato.
  const later = `AI Lab Dopo ${suffix}`;
  ok(await flow.createQuickUseCase(as("ls"), { title: `Prova rapida tre ${suffix}`, problem: "Terzo problema", aiLab: later }, t.deps, { isLateralSpace: true }));
  const options = await data.quickCreateOptions(ids.wsA);
  assert.equal(options.lastAiLab, later);
  assert.deepEqual(options.aiLabs.slice(0, 2), [later, lab]);
  assert.deepEqual(await data.quickCreateOptions(ids.wsB), { aiLabs: [], lastAiLab: null });
});

test("pannello rapido: «AI Lab» non propone il segnaposto di «Oscura testo», nemmeno come ultimo usato", opts, async () => {
  const t = fakeTransports();
  const earlier = `AI Lab Prima ${suffix}`;
  const secret = `AI Lab Da oscurare ${suffix}`;
  ok(await flow.createQuickUseCase(as("ls"), { title: `Prova prima ${suffix}`, problem: "Un problema", aiLab: earlier }, t.deps, { isLateralSpace: true }));
  const newest = ok(
    await flow.createQuickUseCase(as("ls"), { title: `Prova da oscurare ${suffix}`, problem: "Un problema", aiLab: secret }, t.deps, { isLateralSpace: true }),
  );
  assert.equal((await data.quickCreateOptions(ids.wsA)).lastAiLab, secret);

  // «Oscura testo» sull'AI Lab della scheda più recente: `ai_lab` diventa il segnaposto, `created_at` resta.
  ok(await service.redactText(as("ls"), newest.id, Number((await row(newest.id)).version), ["ai_lab"]), "redactText");
  assert.equal((await row(newest.id)).ai_lab, service.REDACTED_TEXT);
  const options = await data.quickCreateOptions(ids.wsA);
  assert.equal(options.lastAiLab, earlier, "l'ultimo AI Lab vero, non il segnaposto");
  assert.ok(!options.aiLabs.includes(service.REDACTED_TEXT), "il segnaposto non è tra i valori");
  assert.ok(!options.aiLabs.includes(secret), "il valore oscurato non torna");
  assert.ok(options.aiLabs.includes(earlier));
});

test("pannello rapido: solo Lateral Space con ruolo da revisore, area accesa, campi validi; errori con i nomi del pannello", opts, async () => {
  const t = fakeTransports();
  const input = { title: `Prova vietata ${suffix}`, problem: "Problema" };
  err(await flow.createQuickUseCase(as("builder"), input, t.deps, { isLateralSpace: false }), "permesso_mancante", "AI Builder del cliente");
  err(await flow.createQuickUseCase(as("contributor"), input, t.deps, { isLateralSpace: false }), "permesso_mancante", "contributore");
  err(await flow.createQuickUseCase(as("learner"), input, t.deps, { isLateralSpace: false }), "permesso_mancante", "learner");
  err(await flow.createQuickUseCase(as("ls", { workspaceId: ids.wsB }), input, t.deps, { isLateralSpace: true }), "area_spenta", "area spenta");
  assert.equal(await countByTitle(input.title), 0);

  const invalid = await flow.createQuickUseCase(as("ls"), { title: "ab", problem: "x".repeat(301), aiLab: "" }, t.deps, { isLateralSpace: true });
  err(invalid, "dati_non_validi");
  assert.ok(!invalid.ok && invalid.fieldErrors.title && invalid.fieldErrors.problem);
  assert.equal(t.scheduled.length, 0);
});

// ─── Modulo completo (§5.3, §5.5) ────────────────────────────────────

test("modulo completo: un contributore propone (web_proposed), valutazione dell'AI e notifica dopo la risposta, ricevuta solo sua", opts, async () => {
  const t = fakeTransports();
  const parsed = create.parseUseCaseForm(
    (name) => formData({ ...FORM, timeline: "entro 3 mesi", origin: "transformation", cost: '{"eurOnce":40000}' }).get(name),
    { esgEnabled: false, isReviewer: false },
  );
  assert.ok(parsed.ok);
  const created = ok(
    await flow.createUseCaseWithFollowUps(as("contributor"), { ...parsed.item, proposedBy: emails.contributor }, t.deps, { isLateralSpace: false }),
  );
  const r = await row(created.id);
  assert.equal(r.source, "web_proposed");
  assert.equal(r.timeline, "entro 3 mesi", "«Urgenza» del modulo, come oggi (`timeline`)");
  assert.equal(r.origin, "adoption", "i campi dei revisori non arrivano dal contributore");
  assert.equal(r.intake, null);
  assert.equal(r.cost_eur_once, null);
  assert.equal(r.proposed_by, emails.contributor);
  assert.equal(r.status, "proposed");
  assert.equal(r.portfolio_review_status, "needs_inputs");
  assert.equal(r.title, FORM.title);
  assert.equal(r.business_case, "Meno attese");
  assert.match(String(r.code), /^XX-\d{4}$/);
  assert.deepEqual(await storia(created.id), [{ action: "creato", channel: "web", actor_kind: "proponente", actor_user_id: null }]);

  // Dopo la risposta: un lavoro solo, che parte dopo (non durante) la creazione.
  assert.equal(t.scheduled.length, 1);
  assert.deepEqual(t.calls.autoScore, []);
  await t.runScheduled();
  assert.deepEqual(t.calls.autoScore, [
    { workspaceId: ids.wsA, useCaseId: created.id, reviewedBy: null, noteLabel: "Auto-ranking AI", onlyIfUntouched: true },
  ]);
  assert.deepEqual(t.calls.notify, [{ useCaseId: created.id, workspaceId: ids.wsA, source: "web" }]);
  assert.deepEqual(t.calls.loaded, [], "la notifica usa la scheda dell'auto-ranking");

  // La ricevuta (§5.5): solo a chi l'ha appena proposta, riconosciuta per email.
  assert.equal(perms.isOwnReceipt(viewerOf("contributor"), { source: String(r.source), proposedBy: String(r.proposed_by) }), true);
  const mine = await hub.listHubItems(ids.wsA, viewerOf("contributor"), { createdId: created.id });
  assert.equal(mine?.receipt?.id, created.id);
  assert.equal(mine?.receipt?.code, created.code);
  const other = await hub.listHubItems(ids.wsA, viewerOf("builder"), { createdId: created.id });
  assert.equal(other?.receipt, null);
  // Con l'id utente al posto dell'email (email non verificata) la ricevuta resta sua.
  const byId = ok(
    await flow.createUseCaseWithFollowUps(as("contributor"), { ...parsed.item, title: `Per id ${suffix}`, proposedBy: ids.contributor }, t.deps, { isLateralSpace: false }),
  );
  const unverified = { ...viewerOf("contributor"), emailVerified: false };
  assert.equal((await hub.listHubItems(ids.wsA, unverified, { createdId: byId.id }))?.receipt?.id, byId.id);
});

test("modulo completo, revisori: origine, valore e costo (fascia o importo); nascosta se AI Transformation; notifica anche se l'AI fallisce", opts, async () => {
  const t = fakeTransports({ autoScoreFails: true });
  const parsed = create.parseUseCaseForm(
    (name) => formData({ ...FORM, title: `Prova del revisore ${suffix}`, origin: "transformation", valueEurYear: "60.000", cost: '{"band":2}' }).get(name),
    { esgEnabled: false, isReviewer: true },
  );
  assert.ok(parsed.ok);
  const created = ok(await flow.createUseCaseWithFollowUps(as("builder"), { ...parsed.item, proposedBy: emails.builder }, t.deps, { isLateralSpace: false }));
  const r = await row(created.id);
  assert.equal(r.origin, "transformation");
  assert.deepEqual(r.intake, { hiddenFromSearch: true }, "dall'alto nasce nascosta (§8.6)");
  assert.equal(r.value_eur_year, 60000);
  assert.equal(r.cost_band, 2);
  assert.equal(r.cost_eur_once, null, "mai importo e fascia insieme");

  // L'auto-ranking fallisce: la notifica parte lo stesso, con la scheda riletta.
  await t.runScheduled();
  assert.equal(t.calls.autoScore.length, 1);
  assert.deepEqual(t.calls.loaded, [created.id]);
  assert.deepEqual(t.calls.notify, [{ useCaseId: created.id, workspaceId: ids.wsA, source: "web" }]);

  const withAmount = create.parseUseCaseForm(
    (name) => formData({ ...FORM, title: `Prova con importo ${suffix}`, origin: "adoption", cost: '{"eurOnce":40000}' }).get(name),
    { esgEnabled: false, isReviewer: true },
  );
  assert.ok(withAmount.ok);
  const amount = ok(await flow.createUseCaseWithFollowUps(as("manager"), { ...withAmount.item, proposedBy: emails.manager }, t.deps, { isLateralSpace: false }));
  const a = await row(amount.id);
  assert.equal(a.cost_eur_once, 40000);
  assert.equal(a.cost_band, null);
  assert.equal(a.intake, null);
});

test("origine predefinita per ruolo: la regola del modulo (defaultOriginFor) è quella del servizio", opts, async () => {
  const t = fakeTransports();
  for (const person of ["ls", "builder", "manager", "contributor"] as const) {
    const abilities = perms.abilitiesForUseCase(viewerOf(person));
    const expected = create.defaultOriginFor(abilities.newUseCase ?? "modulo_completo", abilities);
    // Senza origine scelta: il servizio usa la sua predefinita per il canale.
    const source = abilities.newUseCase === "pannello_rapido" ? ("manual" as const) : ("web_proposed" as const);
    const created = ok(
      await flow.createUseCaseWithFollowUps(as(person), { source, kind: "da_costruire", title: `Origine di ${person} ${suffix}`, description: null }, t.deps, {
        isLateralSpace: person === "ls",
      }),
      person,
    );
    assert.equal((await row(created.id)).origin, expected, person);
    // E nel modulo completo, per Lateral Space, la stessa scelta.
    if (person === "ls") {
      const full = ok(
        await flow.createUseCaseWithFollowUps(as("ls"), { source: "web_proposed", kind: "da_costruire", title: `Modulo di LS ${suffix}`, description: null }, t.deps, {
          isLateralSpace: true,
        }),
      );
      assert.equal((await row(full.id)).origin, create.defaultOriginFor("modulo_completo", abilities));
      assert.equal(create.defaultOriginFor("modulo_completo", abilities), "transformation");
    }
  }
  assert.equal(create.defaultOriginFor("modulo_completo", perms.abilitiesForUseCase(viewerOf("builder"))), "adoption");
});

test("modulo completo: area spenta e chi non entra; nessun lavoro dopo la risposta", opts, async () => {
  const t = fakeTransports();
  const item = { source: "web_proposed" as const, kind: "da_costruire" as const, title: `Prova fuori area ${suffix}`, description: null };
  err(await flow.createUseCaseWithFollowUps(as("ls", { workspaceId: ids.wsB }), item, t.deps, { isLateralSpace: true }), "area_spenta");
  err(await flow.createUseCaseWithFollowUps(as("learner"), item, t.deps, { isLateralSpace: false }), "permesso_mancante");
  // Un contributore non sceglie l'origine né il costo, anche se li manda.
  err(await flow.createUseCaseWithFollowUps(as("contributor"), { ...item, origin: "transformation" }, t.deps, { isLateralSpace: false }), "permesso_mancante");
  err(await flow.createUseCaseWithFollowUps(as("contributor"), { ...item, cost: { band: 2 } }, t.deps, { isLateralSpace: false }), "permesso_mancante");
  // «Urgenza» oltre la colonna (varchar 255): il servizio la rifiuta con l'errore del campo.
  const longUrgency = await flow.createUseCaseWithFollowUps(as("contributor"), { ...item, timeline: "x".repeat(256) }, t.deps, { isLateralSpace: false });
  err(longUrgency, "dati_non_validi");
  assert.ok(!longUrgency.ok && longUrgency.fieldErrors?.timeline, "errore su timeline");
  assert.equal(await countByTitle(item.title), 0);
  assert.equal(t.scheduled.length, 0);
});

test("contesto del modulo: nome del team, ESG e fasce del costo del workspace (D15)", opts, async () => {
  const plain = await data.newUseCaseFormContext(ids.wsB);
  assert.equal(plain.teamName, reviewTeam.DEFAULT_REVIEW_TEAM_NAME);
  assert.equal(plain.esgEnabled, false);
  assert.deepEqual(plain.costBands, costBands.COST_BANDS);

  const labels = ["Fino a 10.000 €", "Da 10.000 a 40.000 €", "Da 40.000 a 100.000 €", "Da 100.000 a 200.000 €", "200.000 € e oltre"];
  await q(`UPDATE workspaces SET ai_transformation_team_name = 'CoE AI', esg_enabled = true WHERE id = $1::uuid`, [ids.wsB]);
  await q(`INSERT INTO workspace_scoring_models (workspace_id, config) VALUES ($1::uuid, $2::jsonb)`, [
    ids.wsB,
    JSON.stringify({ costBands: { limits: [10000, 40000, 100000, 200000], labels, topReferenceEur: 300000 } }),
  ]);
  const custom = await data.newUseCaseFormContext(ids.wsB);
  assert.equal(custom.teamName, "CoE AI");
  assert.equal(custom.esgEnabled, true);
  assert.deepEqual(custom.costBands.map((band) => band.label), labels);
  assert.equal(custom.costBands[1].toEur, 40000);

  // Fasce non valide: quelle predefinite.
  await q(`UPDATE workspace_scoring_models SET config = $2::jsonb WHERE workspace_id = $1::uuid`, [
    ids.wsB,
    JSON.stringify({ costBands: { limits: [40000, 10000, 100000, 200000], labels, topReferenceEur: 300000 } }),
  ]);
  assert.deepEqual((await data.newUseCaseFormContext(ids.wsB)).costBands, costBands.COST_BANDS);
});

/** I codici che la ricerca del connettore del cliente trova per una parola (`find_similar_contributions`). */
async function connectorSearchCodes(word: string): Promise<string[]> {
  const found = await connector.searchContributions(q, { workspaceId: ids.wsA, input: { query: word, limit: 25 } });
  return found.map((item) => item.code).sort();
}

test("§8.6: le schede dall'alto nascono nascoste alla ricerca del connettore, quelle dal basso no", opts, async () => {
  const t = fakeTransports();
  const word = `magazzino${suffix}`;
  const hiddenQuick = ok(await flow.createQuickUseCase(as("ls"), { title: `Inventario ${word}`, problem: "Conteggi a mano" }, t.deps, { isLateralSpace: true }));
  const visibleQuick = ok(
    await flow.createQuickUseCase(as("ls"), { title: `Inventario ${word} bis`, problem: "Conteggi a mano", origin: "adoption" }, t.deps, { isLateralSpace: true }),
  );
  const fromBelow = ok(
    await flow.createUseCaseWithFollowUps(as("contributor"), { source: "web_proposed", kind: "da_costruire", title: `Inventario ${word} ter`, description: "Conteggi", proposedBy: emails.contributor }, t.deps, {
      isLateralSpace: false,
    }),
  );
  const fromAbove = ok(
    await flow.createUseCaseWithFollowUps(
      as("builder"),
      { source: "web_proposed", kind: "da_costruire", origin: "transformation", title: `Inventario ${word} quater`, description: "Conteggi", proposedBy: emails.builder },
      t.deps,
      { isLateralSpace: false },
    ),
  );
  const codes = await connectorSearchCodes(word);
  assert.deepEqual(codes, [visibleQuick.code, fromBelow.code].sort());
  assert.ok(!codes.includes(String(hiddenQuick.code)) && !codes.includes(String(fromAbove.code)));
});

// ─── Activity mapping (§8.5) ─────────────────────────────────────────

const PROPOSALS = [
  {
    title: `Riconciliazione fatture ${suffix}`,
    description: "Le fatture si confrontano a mano",
    businessCase: "Meno errori",
    impactEconomic: 4,
    impactTime: 5,
    impactQuality: 3,
    impactCoordination: 2,
    impactSocial: 1,
    feasibilityData: 4,
    feasibilityWorkflow: 4,
    feasibilityRisk: 3,
    feasibilityTech: 3,
    feasibilityTeam: 2,
    requirements: ["Accesso al gestionale"],
    dataDependencies: ["Fatture"],
    relatedActivityIds: [],
    timeline: "3-6 mesi",
  },
  { title: `Bozze di risposta ${suffix}`, description: "Risposte ripetute", businessCase: "Tempo", impactTime: 4, feasibilityData: 3 },
  { title: "x" },
];

function fakeGenerator(result: readonly unknown[] | Error = PROPOSALS) {
  const calls: Array<{ activities: number; includeEsg: boolean; goals: number }> = [];
  return {
    calls,
    deps: {
      generate: async (activities: { id: string }[], context: { goals: unknown[] }, includeEsg: boolean) => {
        calls.push({ activities: activities.length, includeEsg, goals: context.goals.length });
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

test("Activity mapping: bozze AI Transformation nascoste, codice, punteggi del generatore, mai approvate, senza notifiche", opts, async () => {
  await insertActivity("Controllo fatture", "automate");
  await insertActivity("Risposte ai clienti", "augmentable");
  assert.equal(await data.activityMappingReadiness(ids.wsA), "pronto");
  assert.equal(await data.activityMappingReadiness(ids.wsB), "nessuna_attivita");

  const g = fakeGenerator();
  const result = await flow.proposeFromActivityMapping(as("builder", { channel: "activity_mapping" }), g.deps, { rule: "tutte_classificate" });
  assert.ok(result.ok, result.ok ? "" : result.message);
  assert.equal(result.created.length, 2, "la proposta senza titolo si scarta");
  assert.deepEqual(g.calls, [{ activities: 2, includeEsg: false, goals: 0 }]);
  assert.equal(create.proposedToast(result.created.length), "Proposti 2 use case: li trovi in «Da decidere».");

  const [first, second] = await Promise.all(result.created.map((c) => row(c.id)));
  for (const r of [first, second]) {
    assert.equal(r.source, "activity_mapping");
    assert.equal(r.status, "draft", "mai approvata");
    assert.equal(r.portfolio_review_status, "needs_inputs");
    assert.equal(r.origin, "transformation");
    assert.deepEqual(r.intake, { hiddenFromSearch: true });
    assert.equal(r.portfolio_kind, "use_case_ai");
    assert.equal(r.proposed_by, null);
    assert.equal(r.submitted_at, null);
    assert.match(String(r.code), /^XX-\d{4}$/);
    assert.deepEqual(await storia(String(r.id)), [{ action: "creato", channel: "activity_mapping", actor_kind: "sistema", actor_user_id: null }]);
  }
  assert.equal(first.title, PROPOSALS[0].title);
  assert.equal(first.impact_time, 5, "punteggi del generatore nelle colonne legacy (fonte «AI»)");
  assert.equal(first.sequence_order, 1);
  assert.equal(second.sequence_order, 2);
  assert.equal(first.timeline, "3-6 mesi");
  assert.ok(first.overall_impact_score !== null, "aggregati calcolati");
  const [signals] = await q(`SELECT count(*)::int AS n FROM weekly_signals WHERE related_entity_id = ANY($1::uuid[])`, [result.created.map((c) => c.id)]);
  assert.equal(Number(signals.n), 0, "nessuna notifica");

  // La ricerca del connettore non le trova (§8.6).
  assert.deepEqual(await connectorSearchCodes("riconciliazione"), []);
  // I contributori non le vedono: nascoste alla ricerca e non loro.
  const contributorList = await hub.listHubItems(ids.wsA, viewerOf("contributor"));
  assert.ok(contributorList);
  assert.ok(!contributorList.items.some((item) => result.created.some((c) => c.id === item.id)));
});

test("Activity mapping: con attività da classificare il modello non parte; solo revisori; errori del generatore; regola della pagina di oggi", opts, async () => {
  const unclassified = await insertActivity("Archivio contratti", null);
  assert.equal(await data.activityMappingReadiness(ids.wsA), "da_classificare");

  const g = fakeGenerator();
  const waiting = await flow.proposeFromActivityMapping(as("ls", { channel: "activity_mapping" }), g.deps, { rule: "tutte_classificate" });
  assert.deepEqual(waiting, { ok: false, error: "da_classificare", message: create.ACTIVITY_MAPPING_TEXT.classifyFirst });

  const denied = await flow.proposeFromActivityMapping(as("contributor", { channel: "activity_mapping" }), g.deps, { rule: "almeno_una" });
  err(denied, "permesso_mancante", "contributore");
  err(await flow.proposeFromActivityMapping(as("learner", { channel: "activity_mapping" }), g.deps, { rule: "almeno_una" }), "permesso_mancante", "learner");
  assert.deepEqual(g.calls, [], "il modello non parte");

  // Il pulsante della pagina di oggi: basta un'attività classificata, come prima.
  const legacy = await flow.proposeFromActivityMapping(as("ls", { channel: "activity_mapping" }), fakeGenerator([PROPOSALS[1]]).deps, { rule: "almeno_una" });
  assert.ok(legacy.ok);
  assert.equal(legacy.created.length, 1);
  assert.equal((await row(legacy.created[0].id)).status, "draft");
  // Anche dove l'area è spenta (canale activity_mapping): il workspace B senza attività classificate.
  const empty = await flow.proposeFromActivityMapping(as("ls", { channel: "activity_mapping", workspaceId: ids.wsB }), g.deps, { rule: "almeno_una" });
  assert.deepEqual(empty, { ok: false, error: "da_classificare", message: flow.NO_CLASSIFIED_ACTIVITIES_ERROR });
  // …e con un'attività classificata il pulsante di oggi propone anche lì: bozze dall'alto,
  // nascoste, mai approvate, senza notifiche, come nei workspace con l'area accesa.
  await insertActivity("Riconciliazione fornitori", "automate", ids.wsB);
  const off = await flow.proposeFromActivityMapping(
    as("ls", { channel: "activity_mapping", workspaceId: ids.wsB }),
    fakeGenerator([PROPOSALS[1]]).deps,
    { rule: "almeno_una" },
  );
  assert.ok(off.ok, off.ok ? "" : off.message);
  assert.equal(off.created.length, 1);
  const offRow = await row(off.created[0].id);
  assert.equal(offRow.workspace_id, ids.wsB);
  assert.equal(offRow.source, "activity_mapping");
  assert.equal(offRow.status, "draft", "mai approvata");
  assert.equal(offRow.origin, "transformation");
  assert.deepEqual(offRow.intake, { hiddenFromSearch: true });
  const [offSignals] = await q(`SELECT count(*)::int AS n FROM weekly_signals WHERE related_entity_id = $1::uuid`, [off.created[0].id]);
  assert.equal(Number(offSignals.n), 0, "nessuna notifica");

  // Il generatore fallisce: «Riprova», nessuna scheda.
  await q(`UPDATE activities SET classification = 'automate' WHERE id = $1::uuid`, [unclassified]);
  const before = await q(`SELECT count(*)::int AS n FROM use_cases WHERE workspace_id = $1::uuid`, [ids.wsA]);
  const failed = await flow.proposeFromActivityMapping(
    as("builder", { channel: "activity_mapping" }),
    fakeGenerator(Object.assign(new Error("modello non raggiungibile"), { name: "FakeModelError" })).deps,
    { rule: "tutte_classificate" },
  );
  assert.deepEqual(failed, { ok: false, error: "riprova", message: create.ACTIVITY_MAPPING_TEXT.error });
  const afterRows = await q(`SELECT count(*)::int AS n FROM use_cases WHERE workspace_id = $1::uuid`, [ids.wsA]);
  assert.equal(afterRows[0].n, before[0].n);

  // Nessuna proposta: va bene, nessuna scheda.
  const none = await flow.proposeFromActivityMapping(as("builder", { channel: "activity_mapping" }), fakeGenerator([]).deps, { rule: "tutte_classificate" });
  assert.deepEqual(none, { ok: true, created: [] });
  assert.equal(create.proposedToast(0), create.ACTIVITY_MAPPING_TEXT.nothingProposed);
});
