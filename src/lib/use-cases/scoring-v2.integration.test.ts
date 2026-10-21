import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Punteggio v2 (docs/use-case/PIANO-LAVORI.md H3a; docs/use-case/DESIGN.md §7.6, §10.5):
// l'AI in v2 scrive solo `ai_suggestion`, il salvataggio del modello fa merge, e
// `use-case-admin scoring-v2` stampa il prima/dopo, applica e torna indietro.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del
//   pacchetto hub_<id> su 127.0.0.1) gira sul database di prova. Dentro `npm run check` si
//   salta, tranne le prove di unità in fondo: in testa solo moduli di Node; i moduli dell'app
//   arrivano con `await import()`.
// - L'AI è un modello finto: un server HTTP su 127.0.0.1 che risponde come l'API dei messaggi
//   (`ANTHROPIC_BASE_URL`), con una chiave finta. Nessuna chiamata al modello vero.
// - `scoring-v2` gira in un processo figlio, come lo lancia l'operatore, con il trasporto
//   locale (scripts/uc-test/local-neon.cjs) e un ambiente pulito, con `DATABASE_URL` trappola.
// Dati sintetici, indirizzi .test, creati e cancellati qui.
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

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const parsedUrl = enabled ? new URL(url!) : null;
const port = parsedUrl?.port ?? "";
const packageDb = parsedUrl?.pathname.slice(1) ?? "";
const dbUrl = (db: string) => `postgresql://uc_test@127.0.0.1:${port}/${db}`;
const TRAP_DB = "hub_trappola_h3a";

type Ranking = typeof import("../portfolio/ai-ranking.ts");
type Models = typeof import("../db/queries/scoring-model.ts");
type Service = typeof import("./service.ts");
type Scoring = typeof import("../db/use-case-scoring.ts");
type CostBands = typeof import("./cost-bands.ts");
type ScoringV2 = typeof import("../../../scripts/use-case-admin/scoring-v2.ts");

let ranking: Ranking;
let models: Models;
let svc: Service;
let scoring: Scoring;
let costBands: CostBands;
let scoringV2: ScoringV2;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  builder: randomUUID(),
  /** v2: AI all'invio e «Chiedi un suggerimento». */
  wsAi: randomUUID(),
  /** v2: ricalibrazione. */
  wsRecal: randomUUID(),
  /** v1: comportamento di oggi. */
  wsV1: randomUUID(),
  /** Salvataggio del modello. */
  wsModel: randomUUID(),
  wsModelBad: randomUUID(),
  wsModelNew: randomUUID(),
  /** `use-case-admin scoring-v2`. */
  wsScript: randomUUID(),
  /** v1 che passa alla v2 mentre il modello risponde. */
  wsSwitch: randomUUID(),
  /** v1 che passa alla v2 (scoring-v2 --apply) tra la rilettura del modello e l'UPDATE della v1. */
  wsRace: randomUUID(),
  /** La scrittura di `scoring-v2` con una scheda arrivata dopo la lettura. */
  wsGuard: randomUUID(),
};
const WORKSPACES = [ids.wsAi, ids.wsRecal, ids.wsV1, ids.wsModel, ids.wsModelBad, ids.wsModelNew, ids.wsScript, ids.wsSwitch, ids.wsRace, ids.wsGuard];
const BUILDER_EMAIL = `builder.h3a.${suffix}@cliente.test`;
const PROPOSER_EMAIL = `persona.h3a.${suffix}@cliente.test`;
const ENV_KEYS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "PORTFOLIO_RANKING_MODEL", "USE_CASE_HUB_WORKSPACES", "UC_LS_EMAIL_DOMAINS"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const RATIONALE = "Motivazione sintetica dell'AI di prova: tempo risparmiato, sforzo contenuto.";
const DEFAULT_MODEL_ID = "claude-sonnet-5-5";
let csvRoot = "";

// ─── Modello finto ───────────────────────────────────────────────────

/** Punteggi del modello finto per KPI; la profittabilità (KPI economico) torna null, come chiede il prompt. */
const AI_SCORES: Record<string, number | null> = { efficiency: 4, profitability: null, effort: 2, environmental: 3, social: 3 };
let fakeAi: Server;
let aiCalls = 0;
/** Fatto dal modello finto prima di rispondere: una scrittura che arriva mentre l'AI «pensa». */
let beforeAnswer: (() => Promise<void>) | null = null;
let beforeAnswerError: unknown = null;

function fakeAnswer(body: Record<string, unknown>): Record<string, unknown> {
  const schema = (body.output_config as { format?: { schema?: { properties?: Record<string, { properties?: Record<string, unknown> }> } } } | undefined)
    ?.format?.schema;
  const answer: Record<string, unknown> = { rationale: RATIONALE };
  for (const dimension of ["impact", "feasibility", "esg"]) {
    const kpis = schema?.properties?.[dimension]?.properties;
    if (!kpis) continue;
    answer[dimension] = Object.fromEntries(Object.keys(kpis).map((kpi) => [kpi, kpi in AI_SCORES ? AI_SCORES[kpi] : 3]));
  }
  return answer;
}

async function startFakeAi(): Promise<string> {
  fakeAi = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", async () => {
      aiCalls += 1;
      const body = JSON.parse(raw) as Record<string, unknown>;
      if (beforeAnswer) {
        try {
          await beforeAnswer();
        } catch (error) {
          beforeAnswerError = error;
        }
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: `msg_prova_${aiCalls}`,
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: JSON.stringify(fakeAnswer(body)) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => fakeAi.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(fakeAi.address() as AddressInfo).port}/v1`;
}

// ─── Schede ──────────────────────────────────────────────────────────

let codeSeq = 7000;

interface CardSeed {
  workspaceId: string;
  title?: string;
  review?: string;
  customScores?: Record<string, unknown> | null;
  aiSuggestion?: Record<string, unknown> | null;
  reviewNotes?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  proposedBy?: string | null;
  legacy?: Record<string, number>;
}

const LEGACY_COLUMNS: Record<string, string> = {
  impactTime: "impact_time",
  impactQuality: "impact_quality",
  feasibilityData: "feasibility_data",
};

async function seed(c: CardSeed): Promise<string> {
  const id = randomUUID();
  const legacy = c.legacy ?? {};
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, description, status, portfolio_review_status, portfolio_kind, code, source,
       custom_scores, ai_suggestion, review_notes, reviewed_by, reviewed_at, proposed_by, impact_time, impact_quality, feasibility_data)
     VALUES ($1::uuid, $2::uuid, $3, 'Problema di prova', 'proposed', $4::portfolio_review_status, 'use_case_ai', $5, 'web_proposed',
       $6::jsonb, $7::jsonb, $8, $9::uuid, $10::timestamptz, $11, $12, $13, $14)`,
    [
      id,
      c.workspaceId,
      c.title ?? "Smistamento richieste di prova",
      c.review ?? "needs_inputs",
      `XX-${codeSeq++}`,
      c.customScores == null ? null : JSON.stringify(c.customScores),
      c.aiSuggestion == null ? null : JSON.stringify(c.aiSuggestion),
      c.reviewNotes ?? null,
      c.reviewedBy ?? null,
      c.reviewedAt ?? null,
      c.proposedBy ?? null,
      legacy.impactTime ?? null,
      legacy.impactQuality ?? null,
      legacy.feasibilityData ?? null,
    ],
  );
  for (const key of Object.keys(legacy)) assert.ok(LEGACY_COLUMNS[key], key);
  return id;
}

async function row(id: string): Promise<Record<string, unknown>> {
  const [r] = await q(
    `SELECT u.*, u.portfolio_review_status::text AS review, u.category::text AS category_text FROM use_cases u WHERE id = $1::uuid`,
    [id],
  );
  assert.ok(r, "la scheda c'è");
  return r;
}

/** Tutta la scheda com'è nel database: per dire «non è cambiato niente». */
async function whole(id: string): Promise<string> {
  const [r] = await q(`SELECT to_jsonb(u)::text AS j FROM use_cases u WHERE id = $1::uuid`, [id]);
  return String(r.j);
}

async function modelConfig(workspaceId: string): Promise<Record<string, unknown>> {
  const [r] = await q(`SELECT config FROM workspace_scoring_models WHERE workspace_id = $1::uuid`, [workspaceId]);
  return r.config as Record<string, unknown>;
}

async function setModel(workspaceId: string, config: Record<string, unknown>) {
  await q(
    `INSERT INTO workspace_scoring_models (workspace_id, impact_flag_enabled, config, updated_at) VALUES ($1::uuid, false, $2::jsonb, now())
     ON CONFLICT (workspace_id) DO UPDATE SET config = EXCLUDED.config`,
    [workspaceId, JSON.stringify(config)],
  );
}

/** Le colonne che `--apply` e poi `--revert` devono riportare com'erano. */
async function scoreState(workspaceId: string): Promise<Record<string, unknown>[]> {
  return q(
    `SELECT id, overall_impact_score, overall_feasibility_score, overall_esg_score, overall_score, category::text AS category,
            custom_scores, review_notes
       FROM use_cases WHERE workspace_id = $1::uuid ORDER BY id`,
    [workspaceId],
  );
}

/** Contenuto delle schede e del modello di un workspace: uguale prima e dopo una prova a secco. */
async function workspaceDump(workspaceId: string): Promise<string> {
  const [r] = await q(
    `SELECT coalesce((SELECT string_agg(to_jsonb(u)::text, '|' ORDER BY u.id) FROM use_cases u WHERE u.workspace_id = $1::uuid), '')
            || '#' || coalesce((SELECT to_jsonb(m)::text FROM workspace_scoring_models m WHERE m.workspace_id = $1::uuid), '') AS dump`,
    [workspaceId],
  );
  return String(r.dump);
}

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

// ─── Processo figlio di use-case-admin ───────────────────────────────

interface AdminRun {
  status: number;
  docs: Array<Record<string, unknown>>;
  last: Record<string, unknown>;
  stdout: string;
  stderr: string;
}

function parseDocs(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split(/^\}$/m)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => JSON.parse(`${chunk}\n}`) as Record<string, unknown>);
}

function runAdmin(args: string[]): AdminRun {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/private/tmp",
    // Il CSV del prima/dopo va in una cartella temporanea: qui una cartella della prova.
    TMPDIR: csvRoot,
    UC_TEST_DATABASE_URL: dbUrl(packageDb),
    UC_TEST_PG_PORT: port,
    UC_TEST_PG_DB: packageDb,
    USE_CASE_ADMIN_DATABASE_URL: dbUrl(packageDb),
    // Trappole: un altro database. Il trasporto locale lo rifiuterebbe.
    DATABASE_URL: dbUrl(TRAP_DB),
    PGDATABASE: TRAP_DB,
  };
  const result = spawnSync(process.execPath, ["--no-warnings", "--require", "./scripts/uc-test/local-neon.cjs", "scripts/use-case-admin.ts", ...args], {
    cwd: ROOT,
    env: env as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 120_000,
  });
  const docs = parseDocs(result.stdout);
  return { status: result.status ?? -1, docs, last: docs.at(-1) ?? {}, stdout: result.stdout, stderr: result.stderr };
}

const confirm = () => ["--apply", "--confirm-authorized", "--confirm-database", `127.0.0.1:${port}/${packageDb}`, "--environment", "local"];

type Report = Record<string, unknown> & { schede: Array<Record<string, unknown>>; riepilogo: Record<string, unknown> };

function workspaceReport(run: AdminRun, workspaceId: string): Report {
  const report = (run.last.workspaces as Report[] | undefined)?.find((w) => w.workspace === workspaceId);
  assert.ok(report, `rapporto del workspace: ${run.stdout}${run.stderr}`);
  return report;
}

// ─── Preparazione ────────────────────────────────────────────────────

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;

  // Il modello finto prima di caricare l'SDK: il provider legge ANTHROPIC_BASE_URL quando nasce.
  process.env.ANTHROPIC_BASE_URL = await startFakeAi();
  process.env.ANTHROPIC_API_KEY = "chiave-finta-h3a";
  delete process.env.PORTFOLIO_RANKING_MODEL;
  process.env.USE_CASE_HUB_WORKSPACES = ids.wsScript;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";

  ranking = await import("../portfolio/ai-ranking.ts");
  models = await import("../db/queries/scoring-model.ts");
  svc = await import("./service.ts");
  scoring = await import("../db/use-case-scoring.ts");
  costBands = await import("./cost-bands.ts");
  scoringV2 = await import("../../../scripts/use-case-admin/scoring-v2.ts");
  csvRoot = mkdtempSync(join(tmpdir(), "hub-h3a-csv-"));

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova H3a', $2)`, [ids.org, `hub-h3a-${ids.org}`]);
  for (const [i, workspaceId] of WORKSPACES.entries()) {
    await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, $3)`, [workspaceId, ids.org, `Prova H3a ${i + 1}`]);
  }
  await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, 'Persona di prova builder', now())`, [ids.builder, BUILDER_EMAIL]);
  for (const workspaceId of WORKSPACES) {
    await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'function_lead')`, [workspaceId, ids.builder]);
  }
  const v2 = { ...scoring.DEFAULT_SCORING_MODEL_CONFIG, scoringVersion: 2 };
  await setModel(ids.wsAi, v2);
  await setModel(ids.wsRecal, v2);
  await setModel(ids.wsV1, { ...scoring.DEFAULT_SCORING_MODEL_CONFIG });
  await setModel(ids.wsScript, { ...scoring.DEFAULT_SCORING_MODEL_CONFIG });
  await setModel(ids.wsSwitch, { ...scoring.DEFAULT_SCORING_MODEL_CONFIG });
  await setModel(ids.wsRace, { ...scoring.DEFAULT_SCORING_MODEL_CONFIG });
  await setModel(ids.wsGuard, { ...scoring.DEFAULT_SCORING_MODEL_CONFIG });
});

after(async () => {
  for (const key of ENV_KEYS) {
    const value = envBefore[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (csvRoot) rmSync(csvRoot, { recursive: true, force: true });
  if (fakeAi) await new Promise((resolve) => fakeAi.close(resolve));
  if (!enabled) return;
  // I workspace portano via schede, Storia, modelli e iscrizioni.
  await q(`DELETE FROM workspaces WHERE id = ANY($1::uuid[])`, [WORKSPACES]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1::uuid`, [ids.builder]);
});

// ─── L'AI in v2 (§7.6 regole 3-5) ────────────────────────────────────

test("v2, invio: l'AI scrive solo ai_suggestion, porta in valutazione la scheda intatta e non firma reviewed_by", opts, async () => {
  const id = await seed({ workspaceId: ids.wsAi, reviewNotes: "Nota del revisore di prova." });
  const calls = aiCalls;
  // Come createPortfolioSubmissionAction: chi invia passa reviewedBy, che in v2 non conta.
  const card = await ranking.autoScorePortfolioUseCase({
    workspaceId: ids.wsAi,
    useCaseId: id,
    reviewedBy: ids.builder,
    noteLabel: "Auto-ranking AI",
    kind: "auto",
  });
  assert.equal(aiCalls, calls + 1, "una chiamata al modello finto");
  const r = await row(id);
  assert.equal(r.review, "in_review");
  assert.equal(r.custom_scores, null);
  assert.equal(r.reviewed_by, null);
  assert.equal(r.reviewed_at, null);
  assert.equal(r.review_notes, "Nota del revisore di prova.");
  const ai = r.ai_suggestion as Record<string, unknown>;
  assert.deepEqual(ai.scores, { impact: { efficiency: 4 }, feasibility: { effort: 2 } }, "la profittabilità (null) non entra");
  assert.equal(ai.rationale, RATIONALE);
  assert.equal(ai.model, DEFAULT_MODEL_ID);
  assert.equal(ai.kind, "auto");
  assert.match(String(ai.at), /^\d{4}-\d{2}-\d{2}T/);
  // v2: la profittabilità vuota esce dal denominatore; lo sforzo 2 vale 4.
  assert.equal(num(r.overall_impact_score), 4);
  assert.equal(num(r.overall_feasibility_score), 4);
  assert.equal(num(r.overall_score), 4);
  assert.equal(card.id, id);
  assert.equal(card.customScores, null);
});

test("v2, invio: una scheda già toccata da una persona non si scrive e il modello non si chiama", opts, async () => {
  const at = "2026-10-10T09:00:00Z";
  const touched = [
    await seed({ workspaceId: ids.wsAi, review: "in_review", reviewedAt: at, reviewedBy: ids.builder, customScores: { impact: { efficiency: 2 } } }),
    await seed({ workspaceId: ids.wsAi, review: "needs_inputs", reviewedAt: at, reviewedBy: ids.builder }),
    await seed({ workspaceId: ids.wsAi, review: "scored", reviewedAt: at, reviewedBy: ids.builder, customScores: { impact: { efficiency: 3 } } }),
    await seed({ workspaceId: ids.wsAi, review: "archived", reviewedAt: at, customScores: { impact: { efficiency: 3 } } }),
  ];
  for (const id of touched) {
    const before = await whole(id);
    const calls = aiCalls;
    const result = await ranking.scorePortfolioUseCaseWithAi({ workspaceId: ids.wsAi, useCaseId: id, reviewedBy: ids.builder, kind: "auto" });
    assert.equal(result.version, 2);
    assert.equal(result.written, false);
    assert.equal(aiCalls, calls, "nessuna chiamata al modello");
    assert.equal(await whole(id), before, "la scheda non cambia");
  }
});

test("v2, «Chiedi un suggerimento» su una scheda valutata: cambia solo ai_suggestion; punteggi, stato e note del team restano", opts, async () => {
  const reviewedAt = "2026-10-11T08:30:00Z";
  const id = await seed({
    workspaceId: ids.wsAi,
    review: "scored",
    customScores: { impact: { profitability: 4 } },
    reviewNotes: "Valutata dal team.",
    reviewedBy: ids.builder,
    reviewedAt,
  });
  const before = await row(id);
  const result = await ranking.scorePortfolioUseCaseWithAi({
    workspaceId: ids.wsAi,
    useCaseId: id,
    reviewedBy: ids.builder,
    noteLabel: "Suggerimento AI",
    kind: "suggerimento",
  });
  assert.equal(result.written, true);
  const r = await row(id);
  assert.equal(r.review, "scored");
  assert.deepEqual(r.custom_scores, { impact: { profitability: 4 } });
  assert.equal(r.review_notes, "Valutata dal team.");
  assert.equal(r.reviewed_by, ids.builder);
  assert.equal(String(r.reviewed_at), String(before.reviewed_at));
  assert.equal(r.version, before.version, "il suggerimento non alza la versione");
  assert.equal((r.ai_suggestion as Record<string, unknown>).kind, "suggerimento");
  // persona (profittabilità 4) ?? AI (efficienza 4): impatto 4.
  assert.equal(num(r.overall_impact_score), 4);
});

test("v2, ricalibrazione: scrive solo le schede da valutare e salta le valutate e le archiviate", opts, async () => {
  const at = "2026-10-09T10:00:00Z";
  const fresh = await seed({ workspaceId: ids.wsRecal });
  const reviewing = await seed({ workspaceId: ids.wsRecal, review: "in_review", reviewedAt: at, customScores: { impact: { efficiency: 2 } }, reviewNotes: "Da rivedere." });
  const scored = await seed({ workspaceId: ids.wsRecal, review: "scored", reviewedAt: at, reviewedBy: ids.builder, customScores: { impact: { efficiency: 5 } } });
  const archived = await seed({ workspaceId: ids.wsRecal, review: "archived", reviewedAt: at, customScores: { impact: { efficiency: 1 } } });
  const untouched = { scored: await whole(scored), archived: await whole(archived) };
  const reviewedAtBefore = (await row(reviewing)).reviewed_at;
  const calls = aiCalls;

  const result = await ranking.recalibrateWorkspacePortfolioWithAi({ workspaceId: ids.wsRecal, reviewedBy: ids.builder, noteLabel: "Ricalibrazione AI" });
  assert.equal(result.total, 2);
  assert.equal(result.skipped, 2);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.updated.map((u) => u.id).sort(), [fresh, reviewing].sort());
  assert.equal(aiCalls, calls + 2, "il modello si chiama solo per le schede da valutare");
  assert.equal(await whole(scored), untouched.scored, "la scheda valutata non cambia");
  assert.equal(await whole(archived), untouched.archived, "la scheda archiviata non cambia");

  const f = await row(fresh);
  assert.equal(f.review, "in_review");
  assert.equal((f.ai_suggestion as Record<string, unknown>).kind, "ricalibrazione");
  assert.equal(f.reviewed_by, null);
  const r = await row(reviewing);
  assert.equal(r.review, "in_review");
  assert.deepEqual(r.custom_scores, { impact: { efficiency: 2 } }, "i punteggi del team restano");
  assert.equal(r.review_notes, "Da rivedere.");
  assert.equal(String(r.reviewed_at), String(reviewedAtBefore));
});

/** Chi valuta, nel servizio: `rest` non chiede l'area accesa. */
function reviewer(workspaceId: string, channel: "rest" | "pagina" = "rest") {
  return { workspaceId, actor: { userId: ids.builder, role: "function_lead", isLateralSpace: false, kind: "persona" as const }, channel };
}

/** Il modello finto fa `meanwhile` prima di rispondere; gli errori di `meanwhile` tornano qui. */
async function whileModelAnswers<T>(meanwhile: () => Promise<void>, run: () => Promise<T>): Promise<T> {
  beforeAnswer = meanwhile;
  beforeAnswerError = null;
  try {
    const result = await run();
    if (beforeAnswerError) throw beforeAnswerError;
    return result;
  } finally {
    beforeAnswer = null;
  }
}

test("v2, regola 4 con scritture concorrenti: una persona valuta la scheda mentre il modello risponde, l'AI non la scrive", opts, async () => {
  const id = await seed({ workspaceId: ids.wsAi, reviewNotes: "Nota di prova." });
  let valued = "";
  const result = await whileModelAnswers(
    async () => {
      // «Salva la valutazione» solo per l'efficienza: la fattibilità resta «Nessun valore».
      const saved = await svc.saveValuation(reviewer(ids.wsAi), id, Number((await row(id)).version), { kpis: { impact: { efficiency: 2 } } });
      assert.ok(saved.ok, JSON.stringify(saved));
      valued = await whole(id);
    },
    () => ranking.scorePortfolioUseCaseWithAi({ workspaceId: ids.wsAi, useCaseId: id, kind: "auto" }),
  );
  assert.equal(result.written, false, "il suggerimento non si salva");
  assert.ok(valued, "la valutazione è arrivata mentre il modello rispondeva");
  assert.equal(await whole(id), valued, "la scheda valutata resta come l'ha salvata la persona");
  const r = await row(id);
  assert.equal(r.review, "scored");
  assert.equal(r.ai_suggestion, null);
  assert.deepEqual(r.custom_scores, { impact: { efficiency: 2 } });
  assert.equal(r.overall_feasibility_score, null, "la fattibilità non arriva dall'AI");

  // Ricalibrazione: la scheda letta «da valutare» e archiviata mentre il modello risponde.
  const other = await seed({ workspaceId: ids.wsAi, review: "in_review", reviewedAt: "2026-10-12T10:00:00Z" });
  let archived = "";
  const recal = await whileModelAnswers(
    async () => {
      await q(`UPDATE use_cases SET portfolio_review_status = 'archived', updated_at = now() WHERE id = $1::uuid`, [other]);
      archived = await whole(other);
    },
    () => ranking.scorePortfolioUseCaseWithAi({ workspaceId: ids.wsAi, useCaseId: other, kind: "ricalibrazione" }),
  );
  assert.equal(recal.written, false);
  assert.equal(await whole(other), archived, "la scheda archiviata non cambia");

  // «Chiedi un suggerimento» su una scheda che non cambia: si scrive come sempre.
  const asked = await whileModelAnswers(
    async () => {},
    () => ranking.scorePortfolioUseCaseWithAi({ workspaceId: ids.wsAi, useCaseId: id, kind: "suggerimento" }),
  );
  assert.equal(asked.written, true);
  assert.equal(((await row(id)).ai_suggestion as Record<string, unknown>).kind, "suggerimento");
});

// ─── L'AI in v1: il comportamento di oggi, più ai_suggestion ─────────

test("v1, invio: punteggi in custom_scores, in valutazione, motivazione nelle note, reviewed_by; e in più ai_suggestion", opts, async () => {
  const id = await seed({ workspaceId: ids.wsV1, reviewNotes: "Nota del revisore." });
  const result = await ranking.scorePortfolioUseCaseWithAi({
    workspaceId: ids.wsV1,
    useCaseId: id,
    reviewedBy: ids.builder,
    noteLabel: "Auto-ranking AI",
    onlyIfUntouched: true,
  });
  assert.equal(result.version, 1);
  assert.equal(result.written, true);
  const r = await row(id);
  assert.equal(r.review, "in_review");
  assert.deepEqual(r.custom_scores, { impact: { efficiency: 4 }, feasibility: { effort: 2 }, esg: {} });
  assert.equal(r.review_notes, `Nota del revisore.\n\nAuto-ranking AI:\n${RATIONALE}`);
  assert.equal(r.reviewed_by, ids.builder);
  assert.ok(r.reviewed_at);
  const ai = r.ai_suggestion as Record<string, unknown>;
  assert.deepEqual(ai.scores, { impact: { efficiency: 4 }, feasibility: { effort: 2 } });
  assert.equal(ai.kind, "auto");
  assert.equal(ai.rationale, RATIONALE);
  // v1: la profittabilità vuota vale 0 e resta nel denominatore.
  assert.equal(num(r.overall_impact_score), 2);
});

test("v1, ricalibrazione: come oggi, anche le valutate e le archiviate", opts, async () => {
  const workspaceId = ids.wsV1;
  await q(`DELETE FROM use_cases WHERE workspace_id = $1::uuid`, [workspaceId]);
  const scored = await seed({ workspaceId, review: "scored", reviewedAt: "2026-10-01T10:00:00Z", customScores: { impact: { efficiency: 1 } } });
  await seed({ workspaceId, review: "archived" });
  const result = await ranking.recalibrateWorkspacePortfolioWithAi({ workspaceId, reviewedBy: ids.builder });
  assert.deepEqual({ total: result.total, skipped: result.skipped, failed: result.failed }, { total: 2, skipped: 0, failed: 0 });
  const r = await row(scored);
  assert.equal(r.review, "in_review");
  assert.deepEqual(r.custom_scores, { impact: { efficiency: 4 }, feasibility: { effort: 2 }, esg: {} });
  assert.match(String(r.review_notes), /^Ricalibrazione AI:\n/);
});

test("v1 che passa alla v2 mentre il modello risponde (scoring-v2 --apply): l'AI scrive come la v2, solo ai_suggestion", opts, async () => {
  const id = await seed({ workspaceId: ids.wsSwitch, reviewNotes: "Nota del revisore." });
  const result = await whileModelAnswers(
    // `--apply` arriva dopo la lettura del modello (v1) e prima della risposta.
    () => setModel(ids.wsSwitch, { ...scoring.DEFAULT_SCORING_MODEL_CONFIG, scoringVersion: 2 }),
    () =>
      ranking.scorePortfolioUseCaseWithAi({
        workspaceId: ids.wsSwitch,
        useCaseId: id,
        reviewedBy: ids.builder,
        noteLabel: "Auto-ranking AI",
        onlyIfUntouched: true,
      }),
  );
  assert.deepEqual([result.version, result.written], [2, true]);
  const r = await row(id);
  assert.equal(r.custom_scores, null, "niente punteggi dell'AI in custom_scores");
  assert.equal(r.review_notes, "Nota del revisore.", "niente motivazione nelle note");
  assert.deepEqual([r.reviewed_by, r.reviewed_at], [null, null], "niente reviewed_by di chi ha inviato");
  assert.equal(r.review, "in_review", "la scheda ricevuta passa in valutazione");
  const ai = r.ai_suggestion as Record<string, unknown>;
  assert.deepEqual([ai.kind, ai.rationale], ["auto", RATIONALE]);
  assert.deepEqual(ai.scores, { impact: { efficiency: 4 }, feasibility: { effort: 2 } });
  assert.equal(num(r.overall_impact_score), 4, "aggregati della v2: la profittabilità vuota non conta");
});

test("v1 che passa alla v2 tra la rilettura del modello e l'UPDATE della v1: la v1 non scrive, l'AI scrive come la v2", opts, async () => {
  const id = await seed({ workspaceId: ids.wsRace, reviewNotes: "Nota del revisore." });
  const admin: { run?: AdminRun } = {};
  // Lo statement della v1 parte dopo la rilettura del modello (ancora v1): prima di mandarlo,
  // `scoring-v2 --apply` vero sul workspace, con la copia su ogni scheda.
  const raced = await interleave(
    ["m.config -> 'scoringVersion'", "custom_scores"],
    async () => {
      admin.run = runAdmin(["scoring-v2", "--workspace", ids.wsRace, ...confirm()]);
    },
    () =>
      ranking.scorePortfolioUseCaseWithAi({
        workspaceId: ids.wsRace,
        useCaseId: id,
        reviewedBy: ids.builder,
        noteLabel: "Auto-ranking AI",
        onlyIfUntouched: true,
      }),
  );
  assert.equal(admin.run?.last.status, "APPLIED", `${admin.run?.stdout}${admin.run?.stderr}`);
  assert.equal(raced.writes, 1, "un solo UPDATE della v1, che non scrive");
  assert.deepEqual([raced.result.version, raced.result.written], [2, true]);
  const r = await row(id);
  assert.equal(r.custom_scores, null, "niente punteggi dell'AI in custom_scores");
  assert.equal(r.review_notes, "Nota del revisore.", "niente motivazione nelle note");
  assert.deepEqual([r.reviewed_by, r.reviewed_at], [null, null], "niente reviewed_by di chi ha inviato");
  assert.equal(r.review, "in_review");
  const ai = r.ai_suggestion as Record<string, unknown>;
  assert.deepEqual([ai.kind, ai.rationale], ["auto", RATIONALE]);
  assert.deepEqual(ai.scores, { impact: { efficiency: 4 }, feasibility: { effort: 2 } });
  assert.ok(ai.v1Backup, "la copia di --apply resta");
  assert.equal(num(r.overall_impact_score), 4, "aggregati della v2");

  // La copia basta da sola: è quello che Postgres vede quando l'UPDATE della v1, fermo sulla riga
  // durante la transazione di --apply, ricontrolla le condizioni dopo il commit (il modello lo
  // leggerebbe ancora in v1). Qui il modello resta v1 e la copia arriva prima dello statement:
  // la ricalibrazione della v1 non scrive niente.
  const other = await seed({ workspaceId: ids.wsV1, review: "in_review", customScores: { impact: { efficiency: 1 } }, reviewNotes: "Da rivedere." });
  let copied = "";
  const blocked = await interleave(
    ["m.config -> 'scoringVersion'", "custom_scores"],
    async () => {
      await q(`UPDATE use_cases SET ai_suggestion = $2::jsonb WHERE id = $1::uuid`, [
        other,
        JSON.stringify({ v1Backup: { customScores: { impact: { efficiency: 1 } }, reviewNotes: "Da rivedere.", at: new Date().toISOString(), reviewedAt: null, aiAt: null } }),
      ]);
      copied = await whole(other);
    },
    () => ranking.scorePortfolioUseCaseWithAi({ workspaceId: ids.wsV1, useCaseId: other, reviewedBy: ids.builder, kind: "ricalibrazione" }),
  );
  assert.deepEqual([blocked.writes, blocked.result.version, blocked.result.written], [1, 1, false]);
  assert.ok(copied);
  assert.equal(await whole(other), copied, "la scheda resta com'era");
});

// ─── Il salvataggio del modello fa merge ─────────────────────────────

const CUSTOM_BANDS = {
  limits: [15_000, 40_000, 100_000, 200_000],
  labels: ["Piccolo", "Medio", "Grande", "Molto grande", "Enorme"],
  topReferenceEur: 300_000,
};

test("su un workspace v2 il salvataggio del modulo del modello lascia scoringVersion = 2, la soglia del costo basso, costBands e le chiavi sconosciute", opts, async () => {
  const saved = {
    ...scoring.DEFAULT_SCORING_MODEL_CONFIG,
    thresholds: { highImpact: 3.5, highFeasibility: 3.5, midImpact: 2.5, costLowMaxEur: 30_000 },
    scoringVersion: 2,
    costKpiId: "effort",
    costBands: CUSTOM_BANDS,
    futura: { chiave: "di un pacchetto dopo" },
  };
  await setModel(ids.wsModel, saved);
  // La forma di updateScoringModelAction: dimensioni, pesi complessivi e le tre soglie del modulo.
  const form = {
    dimensions: {
      impact: [{ id: "efficiency", label: "Efficienza", weight: 2, direction: "higher_better" as const }],
      feasibility: [{ id: "effort", label: "Effort", weight: 1, direction: "lower_better" as const }],
      esg: scoring.DEFAULT_SCORING_MODEL_CONFIG.dimensions.esg,
    },
    overall: { impact: 0.6, feasibility: 0.4, esg: 0 },
    thresholds: { highImpact: 4, highFeasibility: 3, midImpact: 2 },
  };
  const saved1 = await models.upsertWorkspaceScoringModel({ workspaceId: ids.wsModel, impactFlagEnabled: false, config: form, updatedByUserId: ids.builder });
  assert.equal(saved1.resolvedConfig.scoringVersion, 2);
  // Un secondo salvataggio, come un altro clic su «Salva».
  await models.upsertWorkspaceScoringModel({ workspaceId: ids.wsModel, impactFlagEnabled: false, config: { ...form, overall: { impact: 0.5, feasibility: 0.5, esg: 0 } } });

  const config = await modelConfig(ids.wsModel);
  assert.equal(config.scoringVersion, 2);
  assert.equal(config.costKpiId, "effort");
  assert.deepEqual(config.costBands, CUSTOM_BANDS);
  assert.deepEqual(config.futura, { chiave: "di un pacchetto dopo" });
  assert.deepEqual(config.thresholds, { highImpact: 4, highFeasibility: 3, midImpact: 2, costLowMaxEur: 30_000 });
  assert.deepEqual(config.overall, { impact: 0.5, feasibility: 0.5, esg: 0 });
  assert.deepEqual(config.dimensions, form.dimensions);

  const read = await models.getOrCreateWorkspaceScoringModel(ids.wsModel);
  assert.equal(read.resolvedConfig.scoringVersion, 2);
  assert.equal(read.resolvedConfig.thresholds.costLowMaxEur, 30_000);
  // D18: la soglia in euro di prima si legge come la fascia che la contiene (15.001-40.000: la seconda).
  assert.equal(costBands.costLowBandFrom(read.config ? (read.config as { thresholds?: unknown }).thresholds : null, read.resolvedConfig.costBands), 2);
  assert.deepEqual(read.resolvedConfig.costBands, costBands.resolveCostBands({ costBands: CUSTOM_BANDS }));
  assert.equal(read.updatedByUserId, null, "il secondo salvataggio non ha passato chi salva");
});

test("normalizeScoringConfig dal database: fasce valide passano, fasce non valide lasciano le predefinite; un modello nuovo resta v1", opts, async () => {
  await setModel(ids.wsModelBad, { ...scoring.DEFAULT_SCORING_MODEL_CONFIG, costBands: { ...CUSTOM_BANDS, limits: [40_000, 15_000, 100_000, 200_000] }, scoringVersion: "2" });
  const bad = await models.getOrCreateWorkspaceScoringModel(ids.wsModelBad);
  assert.deepEqual(bad.resolvedConfig.costBands, costBands.COST_BANDS);
  assert.equal(bad.resolvedConfig.scoringVersion, 1, "«2» come testo non accende la v2");

  // Nessuna riga: il primo salvataggio crea il modello senza scoringVersion (v1).
  const created = await models.upsertWorkspaceScoringModel({
    workspaceId: ids.wsModelNew,
    impactFlagEnabled: false,
    config: { thresholds: { highImpact: 3, highFeasibility: 3, midImpact: 2 }, costBands: CUSTOM_BANDS },
  });
  const config = await modelConfig(ids.wsModelNew);
  assert.equal("scoringVersion" in config, false);
  assert.equal(created.resolvedConfig.scoringVersion, 1);
  assert.deepEqual(created.resolvedConfig.costBands.map((b) => b.label), CUSTOM_BANDS.labels);
  await assert.rejects(
    models.upsertWorkspaceScoringModel({ workspaceId: ids.wsModelNew, impactFlagEnabled: false, config: { costBands: { ...CUSTOM_BANDS, topReferenceEur: 10 } } }),
    /Fasce del costo non valide/,
  );
  assert.deepEqual((await modelConfig(ids.wsModelNew)).costBands, CUSTOM_BANDS, "le fasce non valide non si salvano");
});

test("recomputeWorkspaceScores: in v2 con i KPI dell'AI di ai_suggestion, in v1 come oggi", opts, async () => {
  const v2Card = await seed({ workspaceId: ids.wsRecal, review: "in_review", aiSuggestion: { scores: { impact: { efficiency: 5 }, feasibility: { effort: 1 } } } });
  await q(`UPDATE use_cases SET overall_impact_score = 0, overall_score = 0 WHERE id = $1::uuid`, [v2Card]);
  const count = await models.recomputeWorkspaceScores(ids.wsRecal);
  assert.ok(count >= 1);
  const r = await row(v2Card);
  assert.equal(num(r.overall_impact_score), 5);
  assert.equal(num(r.overall_feasibility_score), 5);

  const v1Card = await seed({ workspaceId: ids.wsV1, aiSuggestion: { scores: { impact: { efficiency: 5 } } }, customScores: { impact: { efficiency: 3 } } });
  await models.recomputeWorkspaceScores(ids.wsV1);
  assert.equal(num((await row(v1Card)).overall_impact_score), 1.5, "in v1 l'AI non conta e la profittabilità vuota vale 0");
});

/**
 * Ferma il primo statement che contiene tutti i `markers` e, prima di mandarlo al database, fa
 * `meanwhile`: una scrittura tra la lettura e il commit. Restituisce il risultato di `run` e
 * quanti statement con i `markers` sono partiti.
 */
async function interleave<T>(markers: string[], meanwhile: () => Promise<unknown>, run: () => Promise<T>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  assert.ok(descriptor?.get, "trasporto locale di scripts/uc-test/local-neon.cjs");
  const local = globalThis.fetch;
  let fired = false;
  let writes = 0;
  const intercept = async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    if (markers.every((marker) => body.includes(marker))) {
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
    return { result: await run(), writes };
  } finally {
    Object.defineProperty(globalThis, "fetch", descriptor);
  }
}

test("recomputeWorkspaceScores non copre un suggerimento dell'AI salvato tra la lettura e la scrittura", opts, async () => {
  const id = await seed({ workspaceId: ids.wsRecal, review: "in_review", aiSuggestion: { scores: { impact: { efficiency: 5 }, feasibility: { effort: 1 } } } });
  const ai = { workspaceId: ids.wsRecal, actor: { userId: null, role: null, isLateralSpace: false, kind: "ai" as const }, channel: "ai" as const };
  const run = await interleave(
    ["jsonb_to_recordset", "overall_feasibility_score = d.feasibility"],
    async () => {
      const written = await svc.recordAiSuggestion(ai, id, { kind: "suggerimento", scores: { impact: { efficiency: 1 }, feasibility: { effort: 5 } } });
      assert.ok(written.ok, JSON.stringify(written));
    },
    () => models.recomputeWorkspaceScores(ids.wsRecal),
  );
  assert.equal(run.writes, 2, "un solo UPDATE per tutte le schede, poi un secondo per quella cambiata");
  const r = await row(id);
  // I KPI salvati nel frattempo (efficienza 1, sforzo 5), non quelli letti prima (5 e 1).
  assert.equal(num(r.overall_impact_score), 1);
  assert.equal(num(r.overall_feasibility_score), 1);
  const cards = await q(`SELECT count(*)::int AS n FROM use_cases WHERE workspace_id = $1::uuid`, [ids.wsRecal]);
  assert.equal(run.result, Number(cards[0].n), "ogni scheda del workspace v2 ricalcolata una volta");
});

// ─── use-case-admin scoring-v2 ───────────────────────────────────────

const LONG_TITLE = "Classificazione automatica delle richieste di assistenza in arrivo dai clienti di prova";
const script: Record<"s1" | "s2" | "s3" | "s4" | "s5" | "s6" | "s7" | "s8" | "s9", string> = {
  s1: "", s2: "", s3: "", s4: "", s5: "", s6: "", s7: "", s8: "", s9: "",
};
/** Gli `overall_*` di s9, salvati prima di un cambio del modello: la v1 di oggi non li ricalcola uguali. */
const STALE = { impact: 3, feasibility: 3, esg: 2, overall: 2.9, category: "strategic_bet" };
/** Testo scritto da una persona sotto la motivazione dell'AI, nello stesso blocco delle note. */
const REVIEWER_ADDITION = "Aggiunta del revisore di prova dopo la call: serve il dato del CRM.";

async function seedScriptCards() {
  const at = "2026-10-05T12:00:00Z";
  // s1: valutata dall'AI in v1 (punteggi in custom_scores, motivazione nelle note), con chi ha proposto.
  script.s1 = await seed({
    workspaceId: ids.wsScript,
    review: "in_review",
    reviewedAt: at,
    customScores: { impact: { efficiency: 4 }, feasibility: { effort: 2 } },
    reviewNotes: "Nota del team.\n\nAuto-ranking AI:\nMotivo sintetico uno.",
    proposedBy: PROPOSER_EMAIL,
  });
  // s2: valutata da una persona; la motivazione dell'AI è nelle note.
  script.s2 = await seed({
    workspaceId: ids.wsScript,
    review: "scored",
    reviewedAt: at,
    reviewedBy: ids.builder,
    customScores: { impact: { efficiency: 3, profitability: 4 }, feasibility: { effort: 3 } },
    reviewNotes: "Valutata dal team.\n\nSuggerimento AI:\nMotivo sintetico due.",
  });
  // s3: solo colonne storiche (Activity mapping), titolo lungo.
  script.s3 = await seed({ workspaceId: ids.wsScript, title: LONG_TITLE, legacy: { impactTime: 4, impactQuality: 4, feasibilityData: 3 } });
  // s4: niente punteggi: in v2 «da stimare».
  script.s4 = await seed({ workspaceId: ids.wsScript });
  // s5: archiviata, con punteggi e motivazione della ricalibrazione.
  script.s5 = await seed({
    workspaceId: ids.wsScript,
    review: "archived",
    reviewedAt: at,
    customScores: { impact: { efficiency: 2 } },
    reviewNotes: "Ricalibrazione AI:\nMotivo sintetico cinque.",
  });
  // s6: la v1 ha già scritto ai_suggestion (la motivazione è quella del blocco); sotto, nello
  // stesso blocco, una persona ha aggiunto una riga dal modulo di oggi.
  script.s6 = await seed({
    workspaceId: ids.wsScript,
    review: "in_review",
    reviewedAt: at,
    customScores: { impact: { efficiency: 5 }, feasibility: { effort: 1 } },
    aiSuggestion: { scores: { impact: { efficiency: 5 }, feasibility: { effort: 1 } }, rationale: "Motivo sintetico sei.", kind: "auto", at },
    reviewNotes: `Auto-ranking AI:\nMotivo sintetico sei.\n\n${REVIEWER_ADDITION}`,
  });
  // s7: un blocco dell'AI di più paragrafi, senza motivazione salvata: non si sa dove finisce il
  // testo dell'AI, quindi le note restano com'erano e la prova a secco lo dice.
  script.s7 = await seed({
    workspaceId: ids.wsScript,
    reviewNotes: "Nota iniziale di prova.\n\nSuggerimento AI:\nMotivo sintetico sette.\n\nSecondo paragrafo di chi?",
  });
  // s8: valutata da una persona che ha lasciato vuoto lo sforzo; l'AI della v1 l'ha stimato
  // (`ai_suggestion`); note senza blocchi dell'AI. --apply non sposta niente, ma in v2 lo
  // sforzo dell'AI conta: --revert la deve rimettere com'era, senza KPI dell'AI in custom_scores.
  script.s8 = await seed({
    workspaceId: ids.wsScript,
    review: "scored",
    reviewedAt: at,
    reviewedBy: ids.builder,
    customScores: { impact: { efficiency: 3 } },
    aiSuggestion: { scores: { impact: { efficiency: 4 }, feasibility: { effort: 2 } }, rationale: "Motivo sintetico otto.", kind: "auto", at },
    reviewNotes: "Valutata dal team: lo sforzo è da capire.",
  });
  // s9: da valutare, con punteggi; gli overall_* salvati non sono quelli della v1 di oggi (sotto).
  script.s9 = await seed({ workspaceId: ids.wsScript, review: "in_review", reviewedAt: at, customScores: { impact: { efficiency: 2 }, feasibility: { effort: 3 } } });
  // Gli overall_* salvati oggi: quelli della v1.
  await models.recomputeWorkspaceScores(ids.wsScript);
  // s9 tiene quelli di prima di un cambio del modello (o dell'ESG, che non ricalcola le schede).
  await q(
    `UPDATE use_cases SET overall_impact_score = $2, overall_feasibility_score = $3, overall_esg_score = $4, overall_score = $5,
            category = $6::use_case_category WHERE id = $1::uuid`,
    [script.s9, STALE.impact, STALE.feasibility, STALE.esg, STALE.overall, STALE.category],
  );
}

test("scoring-v2 a secco: prima/dopo per scheda e riepilogo, CSV fuori da git senza proponente, niente scritto", opts, async () => {
  await seedScriptCards();
  const before = await workspaceDump(ids.wsScript);
  const run = runAdmin(["scoring-v2", "--workspace", ids.wsScript]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.docs.length, 1);
  assert.equal(run.last.status, "DRY_RUN");
  assert.equal(await workspaceDump(ids.wsScript), before, "a secco non scrive");

  const report = workspaceReport(run, ids.wsScript);
  assert.equal(report.versione, 1);
  assert.equal(report.modelloPersonalizzato, false);
  assert.deepEqual(report.riepilogo, {
    schede: 9,
    // Le due di prima (tra cui s1) e s8: in v2 lo sforzo dell'AI dà un costo.
    cambianoZona: 3,
    // s4 e s7: oggi 0 di impatto, in v2 «da stimare».
    diventanoDaStimare: 2,
    zonaDaStimare: 0,
    fonteDaTeamAdAi: 4,
    // s6 sposta la motivazione e tiene nelle note la riga del revisore; s7 e s8 non spostano
    // niente. La copia va su ogni scheda.
    spostamenti: { punteggi: 4, note: 4, copie: 9 },
    noteDaControllare: 1,
    // s9.
    nonAllineate: 1,
  });
  assert.deepEqual(report.noteDaControllare, [{ id: script.s7, codice: (await row(script.s7)).code, titolo: "Smistamento richieste di prova" }]);
  const item = (id: string) => report.schede.find((s) => s.id === id)!;
  assert.deepEqual(item(script.s1), {
    id: script.s1,
    codice: (await row(script.s1)).code,
    titolo: "Smistamento richieste di prova",
    revisione: "in_review",
    impatto: { prima: 2, dopo: 4 },
    punteggio: { prima: 2.75, dopo: 4 },
    quadranteOggi: "not_yet",
    zona: { prima: "Se avanza tempo", dopo: "Subito" },
    fonteValore: { prima: "team", dopo: "AI" },
    sposta: { punteggi: true, note: true },
    noteDaControllare: false,
    allineata: true,
  });
  assert.deepEqual(item(script.s2).sposta, { punteggi: false, note: true }, "la valutata tiene i punteggi del team");
  assert.deepEqual(item(script.s2).zona, { prima: "Da pianificare", dopo: "Da pianificare" });
  assert.deepEqual(item(script.s4).impatto, { prima: 0, dopo: null });
  assert.deepEqual(item(script.s4).zona, { prima: "da stimare", dopo: "da stimare" });
  assert.equal(item(script.s3).titolo, scoringV2Title(LONG_TITLE));
  assert.ok(String(item(script.s3).titolo).length <= 60);
  assert.deepEqual(item(script.s3).fonteValore, { prima: "AI", dopo: "AI" });
  assert.deepEqual([item(script.s6).sposta, item(script.s6).noteDaControllare], [{ punteggi: true, note: true }, false]);
  assert.deepEqual([item(script.s7).sposta, item(script.s7).noteDaControllare], [{ punteggi: false, note: false }, true]);
  assert.deepEqual([item(script.s8).sposta, item(script.s8).zona, item(script.s8).allineata], [{ punteggi: false, note: false }, { prima: "da stimare", dopo: "Se avanza tempo" }, true]);
  assert.deepEqual([item(script.s9).impatto, item(script.s9).fonteValore, item(script.s9).allineata], [{ prima: STALE.impact, dopo: 2 }, { prima: "team", dopo: "AI" }, false]);

  // Niente proponente, niente note, niente motivazioni: né nell'uscita né nel CSV.
  const csvPath = String(run.last.csv);
  assert.ok(existsSync(csvPath), "il CSV c'è");
  assert.ok(relative(ROOT, csvPath).startsWith(".."), "il CSV è fuori dal repository");
  const csv = readFileSync(csvPath, "utf8");
  for (const text of [run.stdout, csv]) {
    for (const forbidden of [PROPOSER_EMAIL, BUILDER_EMAIL, "Nota del team", "Nota iniziale", "Motivo sintetico", "Aggiunta del revisore", "Secondo paragrafo", "proposed_by", "proponente"]) {
      assert.ok(!text.includes(forbidden), `nessun «${forbidden}»`);
    }
  }
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines[0], scoringV2.APPLY_CSV_HEADER.join(","));
  assert.equal(lines.length, 10);
  assert.ok(lines.some((line) => line.startsWith(`${ids.wsScript},${script.s1},`)));
});

function scoringV2Title(title: string): string {
  return `${title.slice(0, 59).trimEnd()}…`;
}

test("scoring-v2 --apply vale per un workspace alla volta: con --all si ferma senza scrivere", opts, async () => {
  const before = await workspaceDump(ids.wsScript);
  const run = runAdmin(["scoring-v2", "--all", ...confirm()]);
  assert.equal(run.status, 1);
  assert.equal(run.last.status, "ERROR");
  assert.equal(run.last.code, "ambito");
  assert.equal(await workspaceDump(ids.wsScript), before);
});

let preApply: Record<string, unknown>[] = [];

test("scoring-v2 --apply: copia v1Backup, motivazioni in ai_suggestion.rationale, punteggi non confermati all'AI, v2 e overall_* ricalcolati", opts, async () => {
  preApply = await scoreState(ids.wsScript);
  const originals = Object.fromEntries(await Promise.all(Object.entries(script).map(async ([key, id]) => [key, await row(id)])));
  const run = runAdmin(["scoring-v2", "--workspace", ids.wsScript, ...confirm()]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(run.docs.map((d) => d.status), ["PLAN", "APPLIED"]);
  assert.equal(run.last.versione, 2);

  const config = await modelConfig(ids.wsScript);
  assert.equal(config.scoringVersion, 2);
  assert.deepEqual(config.dimensions, JSON.parse(JSON.stringify(scoring.DEFAULT_SCORING_MODEL_CONFIG.dimensions)), "il resto del modello resta");

  const s1 = await row(script.s1);
  assert.equal(s1.custom_scores, null);
  assert.equal(s1.review_notes, "Nota del team.");
  assert.equal(s1.review, "in_review");
  const ai1 = s1.ai_suggestion as Record<string, unknown>;
  assert.deepEqual(ai1.scores, { impact: { efficiency: 4 }, feasibility: { effort: 2 } });
  assert.equal(ai1.rationale, "Motivo sintetico uno.");
  const backup1 = ai1.v1Backup as Record<string, unknown>;
  assert.deepEqual(backup1.customScores, originals.s1.custom_scores);
  assert.equal(backup1.reviewNotes, originals.s1.review_notes);
  assert.match(String(backup1.at), /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.equal(num(s1.overall_impact_score), 4);
  assert.equal(num(s1.overall_score), 4);

  const s2 = await row(script.s2);
  assert.deepEqual(s2.custom_scores, originals.s2.custom_scores, "la valutata tiene i punteggi del team");
  assert.equal(s2.review_notes, "Valutata dal team.");
  assert.equal((s2.ai_suggestion as Record<string, unknown>).rationale, "Motivo sintetico due.");
  assert.equal(num(s2.overall_impact_score), 3.5);
  assert.equal(num(s2.overall_score), 3.3125);

  const at = backup1.at;
  const s3 = await row(script.s3);
  assert.deepEqual(s3.ai_suggestion, { v1Backup: { customScores: null, reviewNotes: null, at, reviewedAt: null, aiAt: null } }, "la copia anche dove non si sposta niente");
  assert.equal(String(s3.updated_at), String(originals.s3.updated_at), "updated_at resta: né punteggi né note cambiano");
  assert.equal(num(s3.overall_impact_score), 4, "v2: l'efficienza dalle colonne storiche, la profittabilità fuori");

  const s4 = await row(script.s4);
  assert.deepEqual([s4.overall_impact_score, s4.overall_feasibility_score, s4.overall_score], [null, null, null], "da stimare");

  const s5 = await row(script.s5);
  assert.equal(s5.review, "archived");
  assert.equal(s5.custom_scores, null);
  assert.equal(s5.review_notes, null);
  assert.equal((s5.ai_suggestion as Record<string, unknown>).rationale, "Motivo sintetico cinque.");

  const s6 = await row(script.s6);
  assert.equal((s6.ai_suggestion as Record<string, unknown>).rationale, "Motivo sintetico sei.", "si sposta solo la motivazione dell'AI");
  assert.equal(s6.review_notes, REVIEWER_ADDITION, "la riga del revisore sotto la motivazione resta nelle note");
  assert.equal(((s6.ai_suggestion as Record<string, unknown>).v1Backup as Record<string, unknown>).reviewNotes, originals.s6.review_notes);

  const s7 = await row(script.s7);
  assert.equal(s7.review_notes, originals.s7.review_notes, "le note da controllare restano com'erano");
  assert.deepEqual(s7.ai_suggestion, { v1Backup: { customScores: null, reviewNotes: originals.s7.review_notes, at, reviewedAt: null, aiAt: null } });

  // s8: niente si sposta; la copia tiene i valori del team; in v2 lo sforzo dell'AI conta.
  const s8 = await row(script.s8);
  assert.deepEqual(s8.custom_scores, originals.s8.custom_scores);
  assert.equal(s8.review_notes, originals.s8.review_notes);
  const ai8 = s8.ai_suggestion as Record<string, unknown>;
  assert.deepEqual(ai8.scores, (originals.s8.ai_suggestion as Record<string, unknown>).scores);
  const backup8 = ai8.v1Backup as Record<string, unknown>;
  assert.deepEqual([backup8.customScores, backup8.reviewNotes, "aggregates" in backup8], [originals.s8.custom_scores, originals.s8.review_notes, false]);
  assert.equal(backup8.aiAt, (originals.s8.ai_suggestion as Record<string, unknown>).at, "l'istante della stima dell'AI di prima della copia");
  assert.equal(num(s8.overall_feasibility_score), 4);
  assert.equal(String(s8.updated_at), String(originals.s8.updated_at));

  // s9: gli overall_* salvati, diversi dal ricalcolo v1, vanno nella copia.
  const s9 = await row(script.s9);
  assert.equal(s9.custom_scores, null);
  assert.deepEqual(((s9.ai_suggestion as Record<string, unknown>).v1Backup as Record<string, unknown>).aggregates, STALE);
  assert.notEqual(String(s9.updated_at), String(originals.s9.updated_at), "i punteggi si spostano: updated_at cambia");

  // Gli overall_* salvati sono quelli dell'aggregatore v2 dell'app.
  const model = scoring.normalizeScoringConfig(config);
  for (const id of Object.values(script)) {
    const r = await row(id);
    const derived = scoring.deriveUseCasePortfolioMetrics(
      { impactTime: num(r.impact_time), impactQuality: num(r.impact_quality), feasibilityData: num(r.feasibility_data), customScores: r.custom_scores as never, aiSuggestion: r.ai_suggestion as never },
      { model: { impactFlagEnabled: false, config: model } },
    );
    for (const [column, value] of [
      ["overall_impact_score", derived.overallImpactScore],
      ["overall_feasibility_score", derived.overallFeasibilityScore],
      ["overall_score", derived.overallScore],
    ] as const) {
      const stored = num(r[column]);
      if (value === null) assert.equal(stored, null, `${id} ${column}`);
      else assert.ok(stored !== null && Math.abs(stored - value) < 1e-5, `${id} ${column}: ${stored} ≠ ${value}`);
    }
    assert.equal(r.category_text, derived.category);
  }

  // Di nuovo: già in v2, niente da applicare.
  const again = runAdmin(["scoring-v2", "--workspace", ids.wsScript, ...confirm()]);
  assert.equal(again.last.status, "NOTHING_TO_DO");
});

test("scoring-v2 --apply e poi --revert: stessi overall_*, custom_scores e review_notes di prima", opts, async () => {
  const dry = runAdmin(["scoring-v2", "--revert", "--workspace", ids.wsScript]);
  assert.equal(dry.last.status, "DRY_RUN");
  const report = workspaceReport(dry, ids.wsScript);
  // Ogni scheda ha la copia e torna da lì; s9 anche con gli overall_* salvati.
  assert.deepEqual(report.riepilogo, { schede: 9, ripristinate: 9, aggregatiDallaCopia: 1, senzaCopia: 0, valutazioniTenute: 0, ricostruite: 0, cambianoZona: 3 });
  assert.deepEqual(report.valutazioniDopoApply, []);
  assert.deepEqual(report.ricostruite, []);

  const run = runAdmin(["scoring-v2", "--revert", "--workspace", ids.wsScript, ...confirm()]);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.last.status, "APPLIED");
  assert.equal((await modelConfig(ids.wsScript)).scoringVersion, 1);
  assert.deepEqual(await scoreState(ids.wsScript), preApply);
  for (const id of Object.values(script)) {
    const ai = (await row(id)).ai_suggestion as Record<string, unknown> | null;
    assert.ok(!ai || !("v1Backup" in ai), "la copia si toglie");
  }
});

test("scoring-v2 --revert tiene la valutazione salvata da una persona dopo --apply, e i KPI dell'AI non si perdono", opts, async () => {
  const apply = runAdmin(["scoring-v2", "--workspace", ids.wsScript, ...confirm()]);
  assert.equal(apply.last.status, "APPLIED", apply.stdout + apply.stderr);

  // «Salva la valutazione» di una persona sulla scheda s1, in v2 (area accesa per il workspace):
  // solo l'efficienza; lo sforzo (2, dell'AI) resta «Nessun valore» per la persona.
  const saved = await svc.saveValuation(reviewer(ids.wsScript, "pagina"), script.s1, Number((await row(script.s1)).version), { kpis: { impact: { efficiency: 2 } } });
  assert.ok(saved.ok, JSON.stringify(saved));
  const valued = await row(script.s1);
  assert.equal(valued.review, "scored");
  assert.deepEqual(valued.custom_scores, { impact: { efficiency: 2 } });
  assert.equal(num(valued.overall_feasibility_score), 4, "in v2 lo sforzo dell'AI conta");

  // Una scheda arrivata in v2 e valutata solo dall'AI: niente copia, KPI solo in ai_suggestion.
  const fresh = await seed({ workspaceId: ids.wsScript, title: "Arrivata in v2" });
  const scored = await ranking.scorePortfolioUseCaseWithAi({ workspaceId: ids.wsScript, useCaseId: fresh, kind: "auto" });
  assert.equal(scored.written, true);
  const inV2 = await row(fresh);
  assert.equal(inV2.custom_scores, null);
  assert.deepEqual([num(inV2.overall_impact_score), num(inV2.overall_feasibility_score)], [4, 4]);

  // s4 c'era già a --apply, intatta (niente punteggi, note o AI: ha solo la copia), e l'AI della
  // v2 la valuta con la ricalibrazione: KPI solo in ai_suggestion, e passa in valutazione.
  const recalibrated = await ranking.scorePortfolioUseCaseWithAi({ workspaceId: ids.wsScript, useCaseId: script.s4, kind: "ricalibrazione" });
  assert.equal(recalibrated.written, true);
  const s4InV2 = await row(script.s4);
  assert.deepEqual([s4InV2.review, s4InV2.custom_scores, s4InV2.reviewed_at], ["in_review", null, null]);
  assert.ok((s4InV2.ai_suggestion as Record<string, unknown>).v1Backup, "la copia resta");
  assert.deepEqual([num(s4InV2.overall_impact_score), num(s4InV2.overall_feasibility_score)], [4, 4]);

  const dry = runAdmin(["scoring-v2", "--revert", "--workspace", ids.wsScript]);
  const report = workspaceReport(dry, ids.wsScript);
  assert.deepEqual(report.valutazioniDopoApply, [{ id: script.s1, codice: valued.code, titolo: "Smistamento richieste di prova" }]);
  const riepilogo = report.riepilogo as Record<string, unknown>;
  // Senza copia c'è solo la scheda arrivata dopo --apply; s4 torna dalla copia, con i KPI dell'AI.
  assert.deepEqual([riepilogo.valutazioniTenute, riepilogo.senzaCopia, riepilogo.ricostruite], [1, 1, 3]);
  assert.deepEqual(
    (report.ricostruite as Array<Record<string, unknown>>).map((r) => r.id).sort(),
    [script.s1, fresh, script.s4].sort(),
  );
  const freshItem = report.schede.find((s) => s.id === fresh)!;
  assert.deepEqual([freshItem.ripristina, freshItem.ricostruita], [false, true]);
  const s4Item = report.schede.find((s) => s.id === script.s4)!;
  assert.deepEqual([s4Item.ripristina, s4Item.ricostruita, s4Item.impatto], [true, true, { prima: 4, dopo: 2 }]);

  const run = runAdmin(["scoring-v2", "--revert", "--workspace", ids.wsScript, ...confirm()]);
  assert.equal(run.last.status, "APPLIED", run.stdout + run.stderr);
  const s1 = await row(script.s1);
  assert.deepEqual(s1.custom_scores, { impact: { efficiency: 2 }, feasibility: { effort: 2 } }, "la persona vince; dove non ha un valore, l'AI");
  assert.equal(s1.review_notes, "Nota del team.");
  assert.equal(s1.review, "scored");
  assert.ok(!("v1Backup" in (s1.ai_suggestion as Record<string, unknown>)));
  // v1: efficienza 2 della persona e profittabilità 0; lo sforzo 2 dell'AI vale ancora 4.
  assert.equal(num(s1.overall_impact_score), 1);
  assert.equal(num(s1.overall_feasibility_score), 4);

  // La scheda valutata solo dall'AI in v2 ha i numeri che l'auto-ranking della v1 avrebbe scritto.
  const back = await row(fresh);
  assert.deepEqual(back.custom_scores, { impact: { efficiency: 4 }, feasibility: { effort: 2 } });
  assert.deepEqual([num(back.overall_impact_score), num(back.overall_feasibility_score)], [2, 4]);
  const model = scoring.normalizeScoringConfig(await modelConfig(ids.wsScript));
  const v1 = scoring.deriveUseCasePortfolioMetrics({ customScores: back.custom_scores as never }, { model: { impactFlagEnabled: false, config: model } });
  assert.equal(model.scoringVersion, 1);
  assert.ok(v1.overallScore !== null && Math.abs(Number(back.overall_score) - v1.overallScore) < 1e-9);
  assert.equal(back.category_text, v1.category);

  // s4: le note della copia, e i KPI che l'AI ha stimato dopo la copia, come la scheda nuova.
  const s4 = await row(script.s4);
  assert.deepEqual(s4.custom_scores, { impact: { efficiency: 4 }, feasibility: { effort: 2 } }, "i KPI dell'AI non si perdono");
  assert.deepEqual([s4.review_notes, s4.review], [null, "in_review"]);
  assert.deepEqual([num(s4.overall_impact_score), num(s4.overall_feasibility_score), num(s4.overall_score)], [num(back.overall_impact_score), 4, num(back.overall_score)]);
  assert.equal(s4.category_text, v1.category);
  const ai4 = s4.ai_suggestion as Record<string, unknown>;
  assert.deepEqual([ai4.kind, "v1Backup" in ai4], ["ricalibrazione", false]);

  // Le altre schede tornano com'erano prima di --apply.
  const changed = new Set([script.s1, script.s4, fresh]);
  const others = (await scoreState(ids.wsScript)).filter((r) => !changed.has(String(r.id)));
  assert.deepEqual(others, preApply.filter((r) => !changed.has(String(r.id))));
});

test("scoring-v2 con --workspace di un workspace che non c'è si ferma: a secco, con --apply e con --revert", opts, async () => {
  const missing = randomUUID();
  const before = await workspaceDump(ids.wsScript);
  for (const args of [[], confirm(), ["--revert"], ["--revert", ...confirm()]]) {
    const run = runAdmin(["scoring-v2", "--workspace", missing, ...args]);
    assert.equal(run.status, 1, args.join(" "));
    assert.equal(run.last.status, "ERROR");
    assert.equal(run.last.code, "workspace");
    assert.equal(run.last.message, "Workspace non trovato.");
    assert.equal(run.docs.length, 1, "nessun piano");
  }
  assert.equal(await workspaceDump(ids.wsScript), before);
});

test("scoring-v2: una scheda arrivata nel workspace dopo la lettura ferma la scrittura, e non si scrive niente", opts, async () => {
  const first = await seed({ workspaceId: ids.wsGuard, review: "in_review", customScores: { impact: { efficiency: 3 } } });
  const plan = async () => {
    const [workspaceRow] = await q(scoringV2.workspacesSql(true), [ids.wsGuard]);
    const workspace = scoringV2.workspaceFromRow(workspaceRow);
    const cards = (await q(scoringV2.CARDS_SQL, [[ids.wsGuard]])).map(scoringV2.cardFromRow);
    return cards.map((card) => scoringV2.planApplyCard(card, scoringV2.modelOf(workspace), workspace.esgEnabled, new Date().toISOString()));
  };
  const plans = await plan();
  assert.equal(plans.length, 1);
  const before = await whole(first);
  // Arriva mentre l'operatore guarda il piano: resterebbe con gli aggregati della v1.
  const late = await seed({ workspaceId: ids.wsGuard, title: "Arrivata dopo la lettura" });
  await assert.rejects(q(scoringV2.WRITE_CARDS_SQL, [ids.wsGuard, scoringV2.cardsPayload(plans), plans.length]), /scoring-v2-schede-cambiate/);
  assert.equal(await whole(first), before, "niente scritto");
  assert.equal((await row(late)).ai_suggestion, null);

  // Riletto, con la scheda nuova nel piano: si scrive.
  const again = await plan();
  const [written] = await q(scoringV2.WRITE_CARDS_SQL, [ids.wsGuard, scoringV2.cardsPayload(again), again.length]);
  assert.equal(Number(written.schede), 2);
  assert.ok(((await row(late)).ai_suggestion as Record<string, unknown>).v1Backup, "la copia anche sulla scheda nuova");
});

// ─── Unità (anche dentro npm run check) ──────────────────────────────

test("scoring-v2, piano di una scheda: sposta punteggi e note solo dove serve, con la copia", async () => {
  const v2 = await import("../../../scripts/use-case-admin/scoring-v2.ts");
  const { normalizeScoringConfig } = await import("../db/use-case-scoring.ts");
  const model = normalizeScoringConfig(null);
  const card = (extra: Partial<import("../../../scripts/use-case-admin/scoring-v2.ts").ScoringCard>) => ({
    id: "c",
    workspaceId: "w",
    code: "XX-0001",
    title: "Titolo",
    review: "in_review",
    version: 3,
    stamp: "2026-10-01 10:00:00+00",
    reviewedAt: "2026-10-01 10:00:00+00",
    customScores: null,
    aiSuggestion: null,
    reviewNotes: null,
    stored: { impact: 0, feasibility: 0, esg: null, overall: 0, category: "not_yet" },
    costEurOnce: null,
    costBand: null,
    legacy: {},
    valuedAfterApply: false,
    ...extra,
  });
  /** La scheda con gli `overall_*` salvati che la v1 calcola oggi (`allineata`). */
  const alignedCard = (extra: Parameters<typeof card>[0]) => {
    const c = card(extra);
    const v1 = v2.sideOf(c, model, false, 1).derived;
    return { ...c, stored: { impact: v1.overallImpactScore, feasibility: v1.overallFeasibilityScore, esg: v1.overallEsgScore, overall: v1.overallScore, category: v1.category } };
  };
  const at = "2026-10-18T09:00:00.000Z";
  const plan = v2.planApplyCard(
    alignedCard({ customScores: { impact: { efficiency: 4, x: "no" } }, aiSuggestion: { scores: { impact: { profitability: 3, efficiency: 1 } } }, reviewNotes: "Nota.\n\nAuto-ranking AI:\nMotivo." }),
    model,
    false,
    at,
  );
  assert.equal(plan.aligned, true);
  assert.equal(plan.movesScores, true);
  assert.equal(plan.movesNotes, true);
  assert.equal(plan.write.customScores, null);
  assert.equal(plan.write.reviewNotes, "Nota.");
  assert.deepEqual(plan.write.aiSuggestion, {
    scores: { impact: { profitability: 3, efficiency: 4 } },
    rationale: "Motivo.",
    v1Backup: { customScores: { impact: { efficiency: 4, x: "no" } }, reviewNotes: "Nota.\n\nAuto-ranking AI:\nMotivo.", at, reviewedAt: "2026-10-01 10:00:00+00", aiAt: null },
  });
  assert.equal(plan.before.derived.overallImpactScore, 2);
  assert.equal(plan.after.derived.overallImpactScore, 3.5);

  // Una valutata senza blocchi dell'AI: non si sposta niente, ma la copia c'è comunque.
  const scored = v2.planApplyCard(card({ review: "scored", customScores: { impact: { efficiency: 4 } } }), model, false, at);
  assert.deepEqual([scored.movesScores, scored.movesNotes, scored.write.moves], [false, false, true]);
  assert.deepEqual(scored.write.customScores, { impact: { efficiency: 4 } });
  assert.deepEqual(scored.write.aiSuggestion, {
    v1Backup: { customScores: { impact: { efficiency: 4 } }, reviewNotes: null, at, reviewedAt: "2026-10-01 10:00:00+00", aiAt: null, aggregates: { impact: 0, feasibility: 0, esg: null, overall: 0, category: "not_yet" } },
  }, "gli overall_* salvati (0) non sono quelli della v1 (2): la copia li tiene");

  const back = v2.planRevertCard(card({ aiSuggestion: plan.write.aiSuggestion, customScores: plan.write.customScores, reviewNotes: plan.write.reviewNotes }), model, false);
  assert.equal(back.restores, true);
  assert.deepEqual(back.write.customScores, { impact: { efficiency: 4, x: "no" } });
  assert.equal(back.write.reviewNotes, "Nota.\n\nAuto-ranking AI:\nMotivo.");
  assert.deepEqual(back.write.aiSuggestion, { scores: { impact: { profitability: 3, efficiency: 4 } }, rationale: "Motivo." });

  // Valutata da una persona dopo --apply: la sua valutazione e le sue note restano; dove non ha
  // un valore, il KPI dell'AI (la v1 non legge ai_suggestion).
  const kept = v2.planRevertCard(card({ aiSuggestion: plan.write.aiSuggestion, customScores: { impact: { efficiency: 2 } }, reviewNotes: "Mia.", valuedAfterApply: true }), model, false);
  assert.deepEqual([kept.restores, kept.keepsPerson, kept.rebuilt], [false, true, true]);
  assert.deepEqual(kept.write.customScores, { impact: { efficiency: 2, profitability: 3 } });
  assert.equal(kept.write.reviewNotes, "Mia.");
  assert.deepEqual(kept.write.aiSuggestion, { scores: { impact: { profitability: 3, efficiency: 4 } }, rationale: "Motivo." });

  const none = v2.planRevertCard(card({ customScores: { impact: { efficiency: 2 } } }), model, false);
  assert.deepEqual([none.hasBackup, none.write.moves, none.rebuilt], [false, false, false]);

  // Una scheda v1 che --apply non sposta (valutata, note senza blocchi dell'AI) ma con un KPI
  // dell'AI (`ai_suggestion` della v1) che la persona ha lasciato vuoto: in v2 conta, e --revert
  // la rimette com'era, senza i KPI dell'AI in custom_scores.
  const v1Ai = { scores: { impact: { efficiency: 4 }, feasibility: { effort: 2 } }, rationale: "Motivo.", kind: "auto", at: "2026-09-01T00:00:00Z" };
  const untouched = card({
    review: "scored",
    customScores: { impact: { efficiency: 3 } },
    aiSuggestion: v1Ai,
    reviewNotes: "Mia nota.",
    stored: { impact: 1.5, feasibility: 0, esg: null, overall: 0.9375, category: "not_yet" },
  });
  const applied = v2.planApplyCard(untouched, model, false, at);
  assert.deepEqual([applied.movesScores, applied.movesNotes, applied.write.moves, applied.aligned], [false, false, true, true]);
  assert.deepEqual(applied.write.aiSuggestion, { ...v1Ai, v1Backup: { customScores: { impact: { efficiency: 3 } }, reviewNotes: "Mia nota.", at, reviewedAt: "2026-10-01 10:00:00+00", aiAt: v1Ai.at } });
  assert.equal(applied.write.derived.overallFeasibilityScore, 4, "in v2 lo sforzo dell'AI conta");
  const reverted = v2.planRevertCard(
    card({ ...untouched, customScores: applied.write.customScores, aiSuggestion: applied.write.aiSuggestion, reviewNotes: applied.write.reviewNotes }),
    model,
    false,
  );
  assert.deepEqual([reverted.restores, reverted.rebuilt, reverted.restoresAggregates], [true, false, false]);
  assert.deepEqual(reverted.write.customScores, { impact: { efficiency: 3 } });
  assert.equal(reverted.write.reviewNotes, "Mia nota.");
  assert.deepEqual(reverted.write.aiSuggestion, v1Ai);
  assert.deepEqual(reverted.write.derived, applied.before.derived, "gli overall_* della v1 di prima");

  // La stessa scheda, ma dopo la copia chi valuta chiede un nuovo suggerimento in v2: lo sforzo
  // dell'AI, vuoto nella copia, entra in custom_scores; l'efficienza della copia vince.
  const asked = { scores: { impact: { efficiency: 5 }, feasibility: { effort: 4 } }, rationale: "Nuovo motivo.", model: "m", at: "2026-10-18T10:00:00.000Z", kind: "suggerimento" };
  const askedBack = v2.planRevertCard(
    card({ ...untouched, customScores: applied.write.customScores, reviewNotes: applied.write.reviewNotes, aiSuggestion: { ...asked, v1Backup: applied.write.aiSuggestion?.v1Backup } }),
    model,
    false,
  );
  assert.deepEqual([askedBack.restores, askedBack.rebuilt, askedBack.restoresAggregates, askedBack.keepsPerson], [true, true, false, false]);
  assert.deepEqual(askedBack.write.customScores, { impact: { efficiency: 3 }, feasibility: { effort: 4 } });
  assert.equal(askedBack.write.reviewNotes, "Mia nota.");
  assert.deepEqual(askedBack.write.aiSuggestion, asked, "la copia si toglie, il suggerimento resta");
  assert.equal(askedBack.write.derived, askedBack.after.derived, "si ricalcola in v1");

  // Intatta a --apply (niente punteggi, note o AI), poi valutata dall'AI in v2 (ricalibrazione,
  // che la porta in valutazione): --revert la rimette dalla copia con i KPI dell'AI, non a 0.
  const bare = alignedCard({ review: "needs_inputs", reviewedAt: null });
  const bareApplied = v2.planApplyCard(bare, model, false, at);
  assert.deepEqual(bareApplied.write.aiSuggestion, { v1Backup: { customScores: null, reviewNotes: null, at, reviewedAt: null, aiAt: null } });
  const recal = { scores: { impact: { efficiency: 4, profitability: 4 }, feasibility: { effort: 2 } }, rationale: "Ricalibrata.", model: "m", at: "2026-10-18T09:30:00.000Z", kind: "ricalibrazione" };
  const bareBack = v2.planRevertCard(card({ ...bare, review: "in_review", aiSuggestion: { ...recal, v1Backup: bareApplied.write.aiSuggestion?.v1Backup } }), model, false);
  assert.deepEqual([bareBack.hasBackup, bareBack.restores, bareBack.rebuilt, bareBack.restoresAggregates], [true, true, true, false]);
  assert.deepEqual(bareBack.write.customScores, recal.scores);
  assert.equal(bareBack.write.reviewNotes, null);
  assert.deepEqual(bareBack.write.aiSuggestion, recal);
  assert.deepEqual([bareBack.write.derived.overallImpactScore, bareBack.write.derived.overallFeasibilityScore], [4, 4]);
  assert.deepEqual([v2.revertItem(bareBack).ripristina, v2.revertItem(bareBack).ricostruita, v2.revertItem(bareBack).impatto.dopo], [true, true, 4]);
  assert.equal(v2.summarizeRevert([bareBack, reverted]).ricostruite, 1);

  // L'AI ha scritto dopo la copia se `at` non è più quello della copia (`aiAt`), anche con un
  // orologio indietro; una copia senza `aiAt` (scritta prima del campo) usa l'ordine degli istanti.
  assert.equal(v2.aiWroteAfterCopy({ at: "2026-10-18T08:00:00.000Z" }, { at, aiAt: null }), true);
  assert.equal(v2.aiWroteAfterCopy({ at: "2026-09-01T00:00:00Z" }, { at, aiAt: "2026-09-01T00:00:00Z" }), false);
  assert.equal(v2.aiWroteAfterCopy({ rationale: "x" }, { at, aiAt: null }), false);
  assert.equal(v2.aiWroteAfterCopy({ at: "2026-10-18T09:30:00.000Z" }, { at }), true);
  assert.equal(v2.aiWroteAfterCopy({ at: "2026-10-05T12:00:00Z" }, { at }), false);
  assert.equal(v2.aiWroteAfterCopy({ at: "domani" }, { at }), false);
  assert.equal(v2.aiWroteAfterCopy({ at: "2026-10-18T09:30:00.000Z" }, null), false);

  // overall_* salvati diversi dal ricalcolo v1 (per esempio dopo un cambio dell'ESG): tornano quelli.
  const stale = { impact: 3, feasibility: 3, esg: 2, overall: 2.9, category: "strategic_bet" };
  const misaligned = card({ customScores: { impact: { efficiency: 2 } }, stored: stale });
  const misApplied = v2.planApplyCard(misaligned, model, false, at);
  assert.equal(misApplied.aligned, false);
  assert.deepEqual((misApplied.write.aiSuggestion?.v1Backup as Record<string, unknown>).aggregates, stale);
  const misBack = v2.planRevertCard(
    card({ ...misaligned, customScores: misApplied.write.customScores, aiSuggestion: misApplied.write.aiSuggestion }),
    model,
    false,
  );
  assert.deepEqual([misBack.restores, misBack.restoresAggregates], [true, true]);
  assert.deepEqual(misBack.write.derived, { overallImpactScore: 3, overallFeasibilityScore: 3, overallEsgScore: 2, overallScore: 2.9, category: "strategic_bet" });
  assert.deepEqual(v2.revertItem(misBack).impatto, { prima: 3, dopo: 3 });
  assert.equal(v2.summarizeRevert([misBack, reverted]).aggregatiDallaCopia, 1);
  // Valutata da una persona dopo --apply: niente aggregati dalla copia, si ricalcola.
  const misKept = v2.planRevertCard(card({ ...misaligned, aiSuggestion: misApplied.write.aiSuggestion, valuedAfterApply: true }), model, false);
  assert.deepEqual([misKept.restores, misKept.restoresAggregates], [false, false]);
  assert.equal(misKept.write.derived, misKept.after.derived);
  // Una copia con aggregati senza la forma giusta: si ricalcola.
  assert.equal(v2.backupAggregates({ aggregates: { ...stale, overall: "2.9" } }), null);
  assert.equal(v2.backupAggregates({ aggregates: { ...stale, category: "altro" } }), null);
  assert.deepEqual(v2.backupAggregates({ aggregates: { impact: null, feasibility: null, esg: null, overall: null, category: null } }), {
    overallImpactScore: null, overallFeasibilityScore: null, overallEsgScore: null, overallScore: null, category: null,
  });
  assert.equal(v2.backupAggregates({}), null);

  // Arrivata in v2 e valutata solo dall'AI: senza copia, i KPI dell'AI vanno in custom_scores.
  const aiOnly = { scores: { impact: { efficiency: 4 }, feasibility: { effort: 2 } }, rationale: "Motivo.", kind: "auto" };
  const fresh = v2.planRevertCard(card({ aiSuggestion: aiOnly, stored: { impact: 4, feasibility: 4, esg: null, overall: 4, category: "quick_win" } }), model, false);
  assert.deepEqual([fresh.hasBackup, fresh.rebuilt, fresh.write.moves], [false, true, true]);
  assert.deepEqual(fresh.write.customScores, { impact: { efficiency: 4 }, feasibility: { effort: 2 } });
  assert.deepEqual(fresh.write.aiSuggestion, aiOnly, "ai_suggestion resta");
  assert.deepEqual([fresh.before.derived.overallImpactScore, fresh.before.derived.overallFeasibilityScore], [4, 4]);
  assert.deepEqual([fresh.after.derived.overallImpactScore, fresh.after.derived.overallFeasibilityScore], [2, 4]);
  assert.equal(v2.revertItem(fresh).ricostruita, true);
  assert.equal(v2.summarizeRevert([fresh, none, kept]).ricostruite, 2);

  // I numeri della persona vincono anche dove l'AI ne ha uno; le voci che non sono numeri restano.
  assert.deepEqual(
    v2.v1ScoresFrom({ impact: { efficiency: 1, note: "x" }, esg: {} }, { impact: { efficiency: 5, profitability: 2 } }),
    { scores: { impact: { efficiency: 1, note: "x", profitability: 2 }, esg: {} }, added: true },
  );
  assert.deepEqual(v2.v1ScoresFrom({ impact: { efficiency: 1 } }, { impact: { efficiency: 5 } }), { scores: { impact: { efficiency: 1 } }, added: false });
  assert.deepEqual(v2.v1ScoresFrom(null, null), { scores: null, added: false });
});

test("scoring-v2, note: si sposta solo il testo dell'AI; quello di una persona sotto l'etichetta resta nelle note", async () => {
  const v2 = await import("../../../scripts/use-case-admin/scoring-v2.ts");
  const { normalizeScoringConfig } = await import("../db/use-case-scoring.ts");
  const model = normalizeScoringConfig(null);
  const notes = "Nota iniziale.\n\nAuto-ranking AI:\nMotivo dell'AI.\n\nAggiunta del revisore dopo la call: serve il dato del CRM.";
  const base = {
    id: "c", workspaceId: "w", code: "XX-0002", title: "Titolo", review: "in_review", version: 2, stamp: "s", reviewedAt: null,
    customScores: null, stored: { impact: 0, feasibility: 0, esg: null, overall: 0, category: "not_yet" }, costEurOnce: null, costBand: null,
    legacy: {}, valuedAfterApply: false,
  };
  const at = "2026-10-18T09:00:00.000Z";

  // Con la motivazione salvata in ai_suggestion: esce solo quella, la riga del revisore resta.
  const withStored = v2.planApplyCard({ ...base, reviewNotes: notes, aiSuggestion: { rationale: "Motivo dell'AI.", kind: "auto" } }, model, false, at);
  assert.deepEqual([withStored.movesNotes, withStored.notesToCheck], [true, false]);
  assert.equal(withStored.write.reviewNotes, "Nota iniziale.\n\nAggiunta del revisore dopo la call: serve il dato del CRM.");
  assert.equal(withStored.write.aiSuggestion?.rationale, "Motivo dell'AI.");
  assert.equal((withStored.write.aiSuggestion?.v1Backup as Record<string, unknown>).reviewNotes, notes);

  // Senza motivazione salvata e con più paragrafi: non si sa dove finisce l'AI, le note restano.
  const unknown = v2.planApplyCard({ ...base, reviewNotes: notes, aiSuggestion: null }, model, false, at);
  assert.deepEqual([unknown.movesNotes, unknown.notesToCheck], [false, true]);
  assert.equal(unknown.write.reviewNotes, notes);
  assert.equal((unknown.write.aiSuggestion?.v1Backup as Record<string, unknown>).reviewNotes, notes, "la copia c'è anche qui");
  assert.equal(v2.applyItem(unknown).noteDaControllare, true);
  assert.equal(v2.summarizeApply([unknown, withStored]).noteDaControllare, 1);

  // Una motivazione salvata diversa dal blocco: le note restano, anche se i punteggi si spostano.
  const other = v2.planApplyCard(
    { ...base, reviewNotes: "Auto-ranking AI:\nMotivo cambiato a mano.", customScores: { impact: { efficiency: 3 } }, aiSuggestion: { rationale: "Motivo dell'AI.", kind: "auto" } },
    model,
    false,
    at,
  );
  assert.deepEqual([other.movesScores, other.movesNotes, other.notesToCheck], [true, false, true]);
  assert.equal(other.write.reviewNotes, "Auto-ranking AI:\nMotivo cambiato a mano.");
  assert.equal(other.write.aiSuggestion?.rationale, "Motivo dell'AI.");

  // Il testo dell'AI all'inizio del blocco.
  assert.deepEqual(v2.aiPartOf("Motivo.", "Motivo."), { ai: "Motivo.", rest: "" });
  assert.deepEqual(v2.aiPartOf("Motivo.\nRiga mia.", "Motivo."), { ai: "Motivo.", rest: "Riga mia." });
  assert.equal(v2.aiPartOf("Motivone.", "Motivo"), null, "solo a fine parola");
  assert.deepEqual(v2.aiPartOf("Un solo paragrafo\nsu due righe.", null), { ai: "Un solo paragrafo\nsu due righe.", rest: "" });
  assert.equal(v2.aiPartOf("Primo.\n\nSecondo.", null), null);

  // Due blocchi: la motivazione da salvare è quella dell'ultimo.
  assert.deepEqual(v2.planNotes("Suggerimento AI:\nUno.\n\nRicalibrazione AI:\nDue.", null), { moves: true, notes: null, rationale: "Due.", toCheck: false });
  assert.deepEqual(v2.planNotes("Nota senza blocchi.", null), { moves: false, notes: "Nota senza blocchi.", rationale: null, toCheck: false });
});

test("scoring-v2, CSV: celle tra virgolette, niente formule, nessuna colonna sul proponente", async () => {
  const v2 = await import("../../../scripts/use-case-admin/scoring-v2.ts");
  assert.equal(v2.csvCell('Titolo, con "virgolette"'), '"Titolo, con ""virgolette"""');
  assert.equal(v2.csvCell("=SOMMA(A1)"), "'=SOMMA(A1)");
  assert.equal(v2.csvCell("-1"), "'-1");
  assert.equal(v2.csvCell(-1), "-1");
  assert.equal(v2.csvCell(null), "");
  assert.equal(v2.csvCell(true), "sì");
  assert.equal(v2.toCsv(["a", "b"], [[1, "x\ny"]]), 'a,b\n1,"x\ny"\n');
  for (const header of [v2.APPLY_CSV_HEADER, v2.REVERT_CSV_HEADER]) {
    for (const column of header) assert.doesNotMatch(column, /propo|email|autore|persona|utente|user/i, column);
  }
});
