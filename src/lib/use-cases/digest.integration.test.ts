import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import * as nodeModule from "node:module";
import { romeToday } from "./quarter.ts";

/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

// Riepilogo settimanale in campanella (docs/use-case/DESIGN.md §14.3; PIANO-LAVORI H4d), sul
// database del pacchetto hub_<id> con scripts/use-case-test/run-db-tests.mjs:
// - solo i workspace con l'area accesa ricevono `use_case_digest` e `use_case_quarter`, con
//   i numeri della pagina (attesa dall'arrivo o dall'ultimo «Riapri», mai dall'ultimo cambio
//   di stato; «approvati non partiti» senza i dossier avviati);
// - i segnali non portano testi, codici o note delle schede, né una scheda collegata, e li
//   vedono solo i revisori;
// - il passo dell'hub non chiama il modello; nel cron gira prima del ciclo AI, quindi con il
//   modello che fallisce il riepilogo arriva lo stesso;
// - un workspace che si rompe non ferma gli altri; lo stesso giorno non si scrive due volte,
//   nemmeno con due giri sovrapposti; il riepilogo nuovo manda a letti quelli vecchi;
// - con la lettura dei dossier rotta il segnale del trimestre parte lo stesso, senza numero;
// - il cron rifiuta «Bearer undefined» quando CRON_SECRET manca.
// Il modello è finto: `ai` e `@ai-sdk/anthropic` diventano moduli di prova che contano le
// chiamate (e falliscono, se la prova lo chiede); nessuna rete. Dentro `npm run check` si
// salta. Dati sintetici, creati e cancellati qui.
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

type Step = typeof import("../db/queries/use-case-digest.ts");
type Signals = typeof import("../db/queries/signals.ts");
type Route = typeof import("../../app/api/cron/weekly-pulse/route.ts");
type Row = Record<string, unknown>;

/** Il modello finto: quante volte `generateObject` è stato chiamato e come risponde. */
interface FakeModel {
  calls: number;
  mode: "fail" | "ok";
}
const model: FakeModel = { calls: 0, mode: "fail" };
const MODEL_ERROR = "modello non raggiungibile (prova)";

let step: Step;
let signals: Signals;
let route: Route;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  /** Area accesa, in `mapping`: il ciclo AI di oggi lo visita. */
  wsOn: randomUUID(),
  /** Area accesa, sezione Casi d'uso accesa: un approvato ha il dossier avviato. */
  wsOn2: randomUUID(),
  /** Area spenta: niente riepilogo, anche con use case da decidere. */
  wsOff: randomUUID(),
  /** Nell'elenco dell'area, ma il workspace non c'è. */
  ghost: randomUUID(),
  reviewer: randomUUID(),
  template: randomUUID(),
  dossier: randomUUID(),
};
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "USE_CASE_HUB_EXCLUDE", "UC_ENABLED", "UC_WORKSPACE_IDS", "VERCEL_ENV", "CRON_SECRET", "ANTHROPIC_API_KEY"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const CRON_SECRET = randomBytes(24).toString("hex");
const HUB_ENV = `${ids.wsOn}, ${ids.wsOn2} ,${ids.ghost},non-un-uuid`;

/** Primo lunedì del T1 2027, 10:00 a Roma. */
const NOW = new Date("2027-01-04T09:00:00Z");
const TODAY = "2027-01-04";
const DAY = 86_400_000;
const daysBefore = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

/** Testi delle schede che nessun segnale deve portare. */
const marks = {
  title: `TITOLO-SCHEDA-${suffix}`,
  description: `PROBLEMA-SCHEDA-${suffix}`,
  publicNote: `NOTA-PUBBLICA-${suffix}`,
  email: `proponente.${suffix}@cliente.test`,
};
const codeBase = 10_000 + Math.floor(Math.random() * 80_000);
let codeSeq = 0;
const codes: string[] = [];

async function seedCard(workspaceId: string, s: {
  status?: string;
  review?: string;
  kind?: string;
  intake?: Record<string, unknown> | null;
  publicNote?: string | null;
  reviewedBy?: string | null;
  reviewBy?: string | null;
  targetQuarter?: string | null;
  createdDaysAgo?: number;
  submittedDaysAgo?: number | null;
}): Promise<string> {
  const id = randomUUID();
  const code = `XX-${codeBase + codeSeq++}`;
  codes.push(code);
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, intake,
       public_note, reviewed_by, review_by, target_quarter, proposed_by, source, created_at, submitted_at, status_changed_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5::use_case_status, $6::portfolio_review_status, $7, $8, $9::jsonb,
       $10, $11::uuid, $12::date, $13, $14, 'web_proposed', $15::timestamp, $16::timestamp, $17::timestamptz)`,
    [
      id,
      workspaceId,
      `${marks.title} ${code}`,
      marks.description,
      s.status ?? "proposed",
      s.review ?? "in_review",
      s.kind ?? "use_case_ai",
      code,
      s.intake ? JSON.stringify(s.intake) : null,
      s.publicNote ?? null,
      s.reviewedBy ?? null,
      s.reviewBy ?? null,
      s.targetQuarter ?? null,
      marks.email,
      daysBefore(s.createdDaysAgo ?? s.submittedDaysAgo ?? 1),
      s.submittedDaysAgo === null ? null : daysBefore(s.submittedDaysAgo ?? s.createdDaysAgo ?? 1),
      // Un cambio di stato di ieri su ogni scheda: l'attesa non deve guardarlo.
      daysBefore(1),
    ],
  );
  return id;
}

/** I segnali dei workspace della prova, dal più vecchio. */
async function signalRows(workspaceId?: string): Promise<Row[]> {
  return q(
    `SELECT workspace_id::text AS "workspaceId", signal_type AS "signalType", title, description,
            related_entity_type AS "relatedEntityType", related_entity_id AS "relatedEntityId", created_at AS "createdAt"
       FROM weekly_signals WHERE workspace_id = ANY($1::uuid[]) ORDER BY created_at, signal_type`,
    [workspaceId ? [workspaceId] : [ids.wsOn, ids.wsOn2, ids.wsOff]],
  );
}

async function resetSignals(): Promise<void> {
  await q(`DELETE FROM weekly_signals WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsOn, ids.wsOn2, ids.wsOff]]);
}

const brief = (rows: Row[]) => rows.map((row) => ({ signalType: row.signalType, title: row.title, description: row.description }));

/** Un segnale scritto a mano (un giro di una settimana fa, o un altro tipo), non letto. */
async function seedSignal(workspaceId: string, signalType: string, title: string, at: Date): Promise<string> {
  const [row] = await q(
    `INSERT INTO weekly_signals (workspace_id, signal_type, title, created_at) VALUES ($1::uuid, $2, $3, $4::timestamp) RETURNING id::text AS id`,
    [workspaceId, signalType, title, at.toISOString()],
  );
  return String(row.id);
}

/** `is_read` di ogni segnale, per id. */
async function readFlags(signalIds: string[]): Promise<Record<string, boolean>> {
  const rows = await q(`SELECT id::text AS id, is_read AS "isRead" FROM weekly_signals WHERE id = ANY($1::uuid[])`, [signalIds]);
  return Object.fromEntries(rows.map((row) => [String(row.id), row.isRead === true || row.isRead === "t" || row.isRead === "true"]));
}

/**
 * Fa fallire la lettura dei dossier (`readDossiers`, la sola query con `DISTINCT ON
 * (c.portfolio_use_case_id)`) come un errore del database; ogni altra query passa al
 * trasporto locale. Il trasporto si rimette com'era alla fine.
 */
async function withBrokenDossierRead<T>(run: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch")!;
  const inner = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body === "string" && init.body.includes("DISTINCT ON (c.portfolio_use_case_id)")) {
        return Response.json({ message: "lettura dei dossier rotta (prova)", code: "XX000" }, { status: 400 });
      }
      return inner(input, init);
    }) as typeof fetch,
  });
  try {
    return await run();
  } finally {
    Object.defineProperty(globalThis, "fetch", descriptor);
  }
}

before(async () => {
  if (!enabled) return;
  // Il modello finto, prima di caricare la rotta del cron.
  (globalThis as { __hubDigestModel?: FakeModel }).__hubDigestModel = model;
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  const stubs: Record<string, string> = {
    ai: stub(`export async function generateObject() {
      const fake = globalThis.__hubDigestModel;
      fake.calls += 1;
      if (fake.mode === "fail") throw new Error(${JSON.stringify(MODEL_ERROR)});
      return { object: { signals: [] } };
    }`),
    "@ai-sdk/anthropic": stub(`export function anthropic(modelId) { return { provider: "prova", modelId }; }`),
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  step = await import("../db/queries/use-case-digest.ts");
  signals = await import("../db/queries/signals.ts");
  route = await import("../../app/api/cron/weekly-pulse/route.ts");

  process.env.USE_CASE_HUB_WORKSPACES = HUB_ENV;
  process.env.UC_ENABLED = "true";
  process.env.UC_WORKSPACE_IDS = ids.wsOn2;
  delete process.env.VERCEL_ENV;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.CRON_SECRET = CRON_SECRET;

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H4d', $2)`, [ids.org, `hub-h4d-${ids.org}`]);
  await q(
    `INSERT INTO workspaces (id, organization_id, name, status) VALUES
       ($1::uuid, $4::uuid, 'Prova H4d accesa', 'mapping'),
       ($2::uuid, $4::uuid, 'Prova H4d accesa con dossier', 'setup'),
       ($3::uuid, $4::uuid, 'Prova H4d spenta', 'mapping')`,
    [ids.wsOn, ids.wsOn2, ids.wsOff, ids.org],
  );
  await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, 'Revisore di prova', now())`, [ids.reviewer, `revisore.${suffix}@ls.test`]);

  // Workspace acceso: 5 da decidere (1 da rivedere), il più vecchio da 12 giorni; 1 approvato fermo.
  await seedCard(ids.wsOn, { createdDaysAgo: 40, submittedDaysAgo: 12 }); // Nuova: conta l'invio, non la bozza
  await seedCard(ids.wsOn, { submittedDaysAgo: 2 }); // Nuova
  await seedCard(ids.wsOn, { intake: { possibleDuplicateOf: codes[0] }, submittedDaysAgo: 4 }); // Possibile doppione
  await seedCard(ids.wsOn, { review: "scored", reviewBy: "2027-01-01", submittedDaysAgo: 100 }); // Da rivedere: dal 1° gennaio
  const reopened = await seedCard(ids.wsOn, { submittedDaysAgo: 200 }); // Riaperta 5 giorni fa
  await q(
    `INSERT INTO use_case_events (workspace_id, use_case_id, actor_kind, channel, action, phase_before, phase_after, at)
     VALUES ($1::uuid, $2::uuid, 'sistema', 'script', 'decisione', 'chiuso.non_avviato', 'da_valutare.nuova', $3::timestamptz)`,
    [ids.wsOn, reopened, daysBefore(5)],
  );
  await seedCard(ids.wsOn, { review: "needs_inputs", reviewedBy: ids.reviewer, publicNote: marks.publicNote, submittedDaysAgo: 300 }); // Serve info
  await seedCard(ids.wsOn, { review: "scored", reviewBy: "2027-02-15", submittedDaysAgo: 30 }); // Rimandata
  await seedCard(ids.wsOn, { status: "accepted", targetQuarter: "2026-Q4", submittedDaysAgo: 90 }); // Scaduto
  await seedCard(ids.wsOn, { status: "accepted", targetQuarter: "2027-Q1", submittedDaysAgo: 20 }); // Questo trimestre
  await seedCard(ids.wsOn, { status: "accepted", targetQuarter: null, submittedDaysAgo: 20 }); // Più avanti
  await seedCard(ids.wsOn, { status: "rejected", submittedDaysAgo: 500 }); // Chiuso

  // Workspace acceso con la sezione Casi d'uso: un approvato scaduto ma avviato, due fermi, nessuno da decidere.
  const started = await seedCard(ids.wsOn2, { status: "accepted", targetQuarter: "2026-Q3", submittedDaysAgo: 150 });
  await seedCard(ids.wsOn2, { status: "accepted", targetQuarter: "2026-Q4", submittedDaysAgo: 120 });
  await seedCard(ids.wsOn2, { status: "accepted", targetQuarter: "2026-Q2", kind: "best_practice", submittedDaysAgo: 200 });
  await seedCard(ids.wsOn2, { review: "needs_inputs", reviewedBy: ids.reviewer, publicNote: marks.publicNote, submittedDaysAgo: 60 });
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova H4d', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.hub_h4d_${suffix}`, randomBytes(32).toString("hex"), ids.wsOn2],
  );
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title, status, setup_completed_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova', 'raccolta', now())`,
    [ids.dossier, ids.wsOn2, ids.org, started, ids.template, `HD-${suffix.toUpperCase()}`],
  );

  // Workspace spento: da decidere anche lui, ma niente riepilogo.
  await seedCard(ids.wsOff, { submittedDaysAgo: 30 });
  await seedCard(ids.wsOff, { submittedDaysAgo: 3 });
});

beforeEach(async () => {
  if (!enabled) return;
  model.calls = 0;
  model.mode = "fail";
  await resetSignals();
});

after(async () => {
  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete (globalThis as { __hubDigestModel?: FakeModel }).__hubDigestModel;
  if (!enabled) return;
  // I workspace portano via schede, Storia, segnali, dossier e il template ristretto a wsOn2.
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [[ids.wsOn, ids.wsOn2, ids.wsOff]]);
  await q(`DELETE FROM users WHERE id = $1::uuid`, [ids.reviewer]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
});

// ═══ Il passo dell'hub ═══════════════════════════════════════════════

test("solo i workspace accesi ed esistenti, con i numeri della pagina e il trimestre il primo lunedì", opts, async () => {
  assert.equal(romeToday(NOW), TODAY, "NOW è il primo lunedì del T1 2027 a Roma");
  const result = await step.runUseCaseDigestStep({ now: NOW, env: { USE_CASE_HUB_WORKSPACES: HUB_ENV } });
  // wsOn e wsOn2: il workspace che non c'è, «*» e il testo che non è un UUID si saltano.
  assert.deepEqual(result, { workspaces: 2, signals: 3, failed: 0 });

  assert.deepEqual(brief(await signalRows(ids.wsOn)), [
    { signalType: "use_case_digest", title: "5 use case da decidere", description: "1 è da rivedere. Il più vecchio aspetta da 12 giorni." },
    { signalType: "use_case_quarter", title: "Nuovo trimestre: rivedi la roadmap", description: "1 use case approvato non è partito." },
  ]);
  // Nessuno da decidere (solo «Serve info»): niente riepilogo. L'approvato col dossier avviato è partito.
  assert.deepEqual(brief(await signalRows(ids.wsOn2)), [
    { signalType: "use_case_quarter", title: "Nuovo trimestre: rivedi la roadmap", description: "2 use case approvati non sono partiti." },
  ]);
  assert.deepEqual(await signalRows(ids.wsOff), []);
});

test("un lunedì che non è il primo del trimestre: solo il riepilogo", opts, async () => {
  const later = new Date(NOW.getTime() + 7 * DAY);
  const result = await step.runUseCaseDigestStep({ now: later, env: { USE_CASE_HUB_WORKSPACES: HUB_ENV } });
  assert.deepEqual(result, { workspaces: 2, signals: 1, failed: 0 });
  const rows = await signalRows();
  assert.deepEqual(
    rows.map((row) => [row.workspaceId, row.signalType]),
    [[ids.wsOn, "use_case_digest"]],
  );
  // Una settimana dopo il più vecchio aspetta 7 giorni in più.
  assert.equal(rows[0].description, "1 è da rivedere. Il più vecchio aspetta da 19 giorni.");
});

test("«*»: il passo visita ogni workspace che esiste, tranne gli esclusi", opts, async () => {
  const visited: string[] = [];
  const digest = async (workspaceId: string) => {
    visited.push(workspaceId);
    return 0;
  };
  const all = await step.runUseCaseDigestStep({ now: NOW, env: { USE_CASE_HUB_WORKSPACES: "*" }, digest });
  for (const id of [ids.wsOn, ids.wsOn2, ids.wsOff]) assert.ok(visited.includes(id), "ogni workspace della prova");
  assert.ok(!visited.includes(ids.ghost), "mai un workspace che non c'è");
  assert.equal(all.workspaces, visited.length);
  assert.equal(new Set(visited).size, visited.length, "una volta sola");

  visited.length = 0;
  await step.runUseCaseDigestStep({ now: NOW, env: { USE_CASE_HUB_WORKSPACES: "*", USE_CASE_HUB_EXCLUDE: `${ids.wsOff.toUpperCase()}, non-un-uuid` }, digest });
  assert.ok(visited.includes(ids.wsOn) && visited.includes(ids.wsOn2));
  assert.ok(!visited.includes(ids.wsOff), "l'escluso si salta");
  // Con l'elenco esplicito l'esclusione vale lo stesso.
  visited.length = 0;
  await step.runUseCaseDigestStep({ now: NOW, env: { USE_CASE_HUB_WORKSPACES: HUB_ENV, USE_CASE_HUB_EXCLUDE: ids.wsOn2 }, digest });
  assert.deepEqual(visited, [ids.wsOn]);
  assert.deepEqual(await signalRows(), []);
});

test("un workspace acceso senza use case: nessun segnale, neanche il trimestre, e i vecchi passano a letti", opts, async () => {
  const empty = randomUUID();
  await q(`INSERT INTO workspaces (id, organization_id, name, status) VALUES ($1::uuid, $2::uuid, 'Prova H4d vuota', 'mapping')`, [empty, ids.org]);
  try {
    const oldQuarter = await seedSignal(empty, "use_case_quarter", "Nuovo trimestre: rivedi la roadmap", new Date("2026-10-05T08:00:00Z"));
    // Il primo lunedì del trimestre, come lo visita il passo con «*».
    assert.equal(await step.digestWorkspace(empty, NOW), 0);
    assert.deepEqual(
      (await signalRows(empty)).map((row) => row.signalType),
      ["use_case_quarter"],
      "solo il segnale del trimestre scorso, scritto a mano",
    );
    assert.deepEqual(await readFlags([oldQuarter]), { [oldQuarter]: true });
    // Con uno use case il trimestre arriva.
    await seedCard(empty, { status: "accepted", targetQuarter: "2026-Q3", submittedDaysAgo: 150 });
    assert.equal(await step.digestWorkspace(empty, NOW), 1);
  } finally {
    await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [empty]);
  }
});

test("area spenta ovunque: nessuna lettura e nessun segnale", opts, async () => {
  for (const value of [undefined, "", "all", "non-un-uuid", ids.wsOff.slice(0, -1)]) {
    const result = await step.runUseCaseDigestStep({ now: NOW, env: { USE_CASE_HUB_WORKSPACES: value } });
    assert.deepEqual(result, { workspaces: 0, signals: 0, failed: 0 }, String(value));
  }
  assert.deepEqual(await signalRows(), []);
});

test("i segnali portano solo numeri: nessun testo, codice, nota o proponente, nessuna scheda collegata", opts, async () => {
  await step.runUseCaseDigestStep({ now: NOW, env: { USE_CASE_HUB_WORKSPACES: HUB_ENV } });
  const rows = await signalRows();
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const text = `${row.title} ${row.description ?? ""}`;
    for (const mark of [marks.title, marks.description, marks.publicNote, marks.email, suffix, ...codes]) {
      assert.ok(!text.includes(mark), `«${mark}» in «${text}»`);
    }
    assert.equal(row.relatedEntityType, null);
    assert.equal(row.relatedEntityId, null);
  }
});

test("li vedono solo i revisori, in campanella e in Intelligence", opts, async () => {
  await step.runUseCaseDigestStep({ now: NOW, env: { USE_CASE_HUB_WORKSPACES: HUB_ENV } });
  const types = (rows: Array<{ signalType: string }>) => rows.map((row) => row.signalType).sort();
  for (const role of ["transformation_lead", "function_lead", "analyst", "exec_sponsor"]) {
    assert.deepEqual(types(await signals.getSignalsByWorkspace(ids.wsOn, 50, role)), ["use_case_digest", "use_case_quarter"], role);
  }
  for (const role of ["contributor", "learner", null]) {
    assert.deepEqual(await signals.getSignalsByWorkspace(ids.wsOn, 50, role), [], String(role));
    assert.deepEqual(await signals.getUnreadSignals(ids.wsOn, role), [], String(role));
  }
});

test("lo stesso giorno non si scrive due volte", opts, async () => {
  const env = { USE_CASE_HUB_WORKSPACES: HUB_ENV };
  assert.equal((await step.runUseCaseDigestStep({ now: NOW, env })).signals, 3);
  const again = await step.runUseCaseDigestStep({ now: new Date(NOW.getTime() + 3 * 3_600_000), env });
  assert.deepEqual(again, { workspaces: 2, signals: 0, failed: 0 });
  assert.equal((await signalRows()).length, 3);
});

test("due giri sovrapposti dello stesso giorno scrivono un segnale per tipo", opts, async () => {
  const env = { USE_CASE_HUB_WORKSPACES: HUB_ENV };
  for (let round = 0; round < 5; round++) {
    await resetSignals();
    const results = await Promise.all([step.runUseCaseDigestStep({ now: NOW, env }), step.runUseCaseDigestStep({ now: NOW, env })]);
    assert.equal(results[0].signals + results[1].signals, 3, `giro ${round}: ${JSON.stringify(results)}`);
    assert.ok(results.every((result) => result.failed === 0), `giro ${round}: ${JSON.stringify(results)}`);
    assert.deepEqual(
      (await signalRows()).map((row) => `${row.workspaceId === ids.wsOn ? "wsOn" : "wsOn2"}:${row.signalType}`).sort(),
      ["wsOn2:use_case_quarter", "wsOn:use_case_digest", "wsOn:use_case_quarter"],
      `giro ${round}`,
    );
  }
});

test("il riepilogo nuovo manda a letti quelli dei giorni prima, anche con zero da decidere", opts, async () => {
  const env = { USE_CASE_HUB_WORKSPACES: HUB_ENV };
  const lastWeek = new Date(NOW.getTime() - 7 * DAY);
  const lastQuarter = new Date("2026-10-05T08:00:00Z"); // primo lunedì del T4 2026
  const old = {
    // wsOn: il riepilogo e il trimestre di prima, e un segnale d'altro tipo che non si tocca.
    digestOn: await seedSignal(ids.wsOn, "use_case_digest", "8 use case da decidere", lastWeek),
    quarterOn: await seedSignal(ids.wsOn, "use_case_quarter", "Nuovo trimestre: rivedi la roadmap", lastQuarter),
    riskOn: await seedSignal(ids.wsOn, "risk_alert", "Segnale di prova", lastWeek),
    // wsOn2: la settimana scorsa 3 da decidere, oggi nessuno: il riepilogo nuovo non c'è.
    digestOn2: await seedSignal(ids.wsOn2, "use_case_digest", "3 use case da decidere", lastWeek),
    // wsOff: area spenta, nessuna lettura e nessuna scrittura.
    digestOff: await seedSignal(ids.wsOff, "use_case_digest", "2 use case da decidere", lastWeek),
  };

  assert.deepEqual(await step.runUseCaseDigestStep({ now: NOW, env }), { workspaces: 2, signals: 3, failed: 0 });
  assert.deepEqual(await readFlags(Object.values(old)), {
    [old.digestOn]: true,
    [old.quarterOn]: true,
    [old.riskOn]: false,
    [old.digestOn2]: true,
    [old.digestOff]: false,
  });

  // Per un revisore resta da leggere solo l'ultimo numero; in wsOn2 nessun riepilogo.
  const unread = async (workspaceId: string) =>
    (await signals.getUnreadSignals(workspaceId, "transformation_lead")).map((row) => `${row.signalType}: ${row.title}`).sort();
  assert.deepEqual(await unread(ids.wsOn), ["risk_alert: Segnale di prova", "use_case_digest: 5 use case da decidere", "use_case_quarter: Nuovo trimestre: rivedi la roadmap"]);
  assert.deepEqual(await unread(ids.wsOn2), ["use_case_quarter: Nuovo trimestre: rivedi la roadmap"]);

  // Lo stesso giorno i segnali di oggi restano da leggere.
  assert.equal((await step.runUseCaseDigestStep({ now: new Date(NOW.getTime() + 3 * 3_600_000), env })).signals, 0);
  assert.equal((await signalRows(ids.wsOn)).length, 5);
  assert.equal((await unread(ids.wsOn)).length, 3);

  // Il lunedì dopo: il riepilogo di oggi passa a letto e arriva il nuovo; il trimestre non si rinnova e resta da leggere.
  assert.equal((await step.runUseCaseDigestStep({ now: new Date(NOW.getTime() + 7 * DAY), env })).signals, 1);
  assert.deepEqual(await unread(ids.wsOn), ["risk_alert: Segnale di prova", "use_case_digest: 5 use case da decidere", "use_case_quarter: Nuovo trimestre: rivedi la roadmap"]);
  const digests = (await signalRows(ids.wsOn)).filter((row) => row.signalType === "use_case_digest");
  assert.equal(digests.length, 3);
  assert.deepEqual(await unread(ids.wsOn2), ["use_case_quarter: Nuovo trimestre: rivedi la roadmap"]);
});

test("con la lettura dei dossier rotta il trimestre parte lo stesso, senza il numero", opts, async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const result = await withBrokenDossierRead(() => step.runUseCaseDigestStep({ now: NOW, env: { USE_CASE_HUB_WORKSPACES: HUB_ENV } }));
  assert.deepEqual(result, { workspaces: 2, signals: 3, failed: 0 });
  // wsOn2 ha la sezione Casi d'uso accesa: senza dossier il numero non si sa e non si scrive.
  assert.deepEqual(brief(await signalRows(ids.wsOn2)), [
    { signalType: "use_case_quarter", title: "Nuovo trimestre: rivedi la roadmap", description: null },
  ]);
  // wsOn non legge dossier (sezione spenta): numeri invariati.
  assert.deepEqual(brief(await signalRows(ids.wsOn)), [
    { signalType: "use_case_digest", title: "5 use case da decidere", description: "1 è da rivedere. Il più vecchio aspetta da 12 giorni." },
    { signalType: "use_case_quarter", title: "Nuovo trimestre: rivedi la roadmap", description: "1 use case approvato non è partito." },
  ]);
  // La lettura rotta lascia una riga di log con il solo nome dell'errore.
  const lines = logged.mock.calls.map((call) => call.arguments.map(String).join(" "));
  assert.equal(lines.length, 1, JSON.stringify(lines));
  assert.match(lines[0], /^\[use-case-hub\] lettura del dossier non riuscita /);
  for (const secret of [ids.wsOn2, "rotta"]) assert.ok(!lines[0].includes(secret), `«${secret}» nel log`);
});

test("un workspace che si rompe non ferma gli altri, e il log non ha id né testi", opts, async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const result = await step.runUseCaseDigestStep({
    now: NOW,
    env: { USE_CASE_HUB_WORKSPACES: HUB_ENV },
    digest: async (workspaceId, now) => {
      if (workspaceId === ids.wsOn) throw Object.assign(new Error(`guasto con ${marks.title} e ${ids.wsOn}`), { code: "XX000" });
      return step.digestWorkspace(workspaceId, now);
    },
  });
  assert.deepEqual(result, { workspaces: 2, signals: 1, failed: 1 });
  assert.deepEqual(
    (await signalRows()).map((row) => [row.workspaceId, row.signalType]),
    [[ids.wsOn2, "use_case_quarter"]],
  );
  assert.equal(logged.mock.callCount(), 1);
  const line = logged.mock.calls[0].arguments.map(String).join(" ");
  assert.match(line, /^\[use-case-hub\] digest_failed /);
  assert.match(line, /"code":"XX000"/);
  for (const secret of [ids.wsOn, ids.wsOn2, marks.title, "guasto"]) assert.ok(!line.includes(secret), `«${secret}» nel log`);
});

test("nessuna chiamata al modello né alla rete dal passo dell'hub", opts, async (t) => {
  const outside: string[] = [];
  // Il trasporto locale del database avvolge ogni fetch nuovo: qui arriva solo ciò che non è il database.
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    outside.push(String(input instanceof Request ? input.url : input));
    throw new Error("rete chiusa nella prova");
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = previous;
  });
  const result = await step.runUseCaseDigestStep({ now: NOW, env: { USE_CASE_HUB_WORKSPACES: HUB_ENV } });
  assert.deepEqual(result, { workspaces: 2, signals: 3, failed: 0 });
  assert.equal(model.calls, 0);
  assert.deepEqual(outside, []);
});

// ═══ Il cron weekly-pulse ════════════════════════════════════════════

function cronRequest(secret: string | null): Request {
  return new Request("http://127.0.0.1/api/cron/weekly-pulse", { headers: secret === null ? {} : { authorization: `Bearer ${secret}` } });
}

test("senza il segreto del cron: 401, nessun riepilogo e nessuna chiamata al modello", opts, async () => {
  for (const secret of [null, "sbagliato"]) {
    const response = await route.GET(cronRequest(secret));
    assert.equal(response.status, 401);
  }
  assert.deepEqual(await signalRows(), []);
  assert.equal(model.calls, 0);
});

test("con CRON_SECRET assente o vuoto: «Bearer undefined» riceve 401 e nessun segnale", opts, async (t) => {
  t.after(() => {
    process.env.CRON_SECRET = CRON_SECRET;
  });
  for (const secret of [undefined, "", "   "]) {
    if (secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secret;
    for (const header of ["undefined", "", secret ?? "undefined"]) {
      const response = await route.GET(cronRequest(header));
      assert.equal(response.status, 401, `segreto ${JSON.stringify(secret)}, intestazione ${JSON.stringify(header)}`);
    }
  }
  assert.deepEqual(await signalRows(), []);
  assert.equal(model.calls, 0);
});

test("con il modello che fallisce, i segnali use_case_digest arrivano lo stesso", opts, async () => {
  model.mode = "fail";
  await assert.rejects(route.GET(cronRequest(CRON_SECRET)), { message: MODEL_ERROR });
  // Il ciclo AI è partito (wsOn è in `mapping`) e si è fermato al primo errore, come oggi.
  assert.equal(model.calls, 1);
  const rows = await signalRows();
  assert.ok(
    rows.some((row) => row.workspaceId === ids.wsOn && row.signalType === "use_case_digest"),
    `riepilogo di wsOn assente: ${JSON.stringify(brief(rows))}`,
  );
  assert.ok(!rows.some((row) => row.workspaceId === ids.wsOff), "wsOff ha l'area spenta");
});

test("con il modello che risponde: 200, il riepilogo del passo nella risposta, una volta al giorno", opts, async () => {
  model.mode = "ok";
  const first = await route.GET(cronRequest(CRON_SECRET));
  assert.equal(first.status, 200);
  const body = (await first.json()) as { processed: number; useCaseHub: { workspaces: number; signals: number; failed: number } };
  assert.ok(body.processed >= 2, "il ciclo AI visita i workspace in mapping");
  assert.equal(body.useCaseHub.workspaces, 2);
  assert.equal(body.useCaseHub.failed, 0);
  assert.ok(body.useCaseHub.signals >= 1);
  assert.ok(model.calls >= 2);
  const written = (await signalRows()).length;
  assert.equal(written, body.useCaseHub.signals);

  const second = await route.GET(cronRequest(CRON_SECRET));
  assert.equal(second.status, 200);
  assert.equal(((await second.json()) as { useCaseHub: { signals: number } }).useCaseHub.signals, 0);
  assert.equal((await signalRows()).length, written);
});
