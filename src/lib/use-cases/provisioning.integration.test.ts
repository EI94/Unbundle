import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// L'area «Use case» per ogni workspace, per costruzione (docs/use-case/DESIGN.md §12.1-12.2):
// `USE_CASE_HUB_WORKSPACES=*` e i prerequisiti scritti dall'app (src/lib/use-cases/provisioning.ts).
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database del pacchetto
//   hub_<id> su 127.0.0.1). Dentro `npm run check` si salta: in testa solo moduli di Node.
// - `use-case-admin` e `uc-doctor` girano in un processo figlio, come li lancia l'operatore, con il
//   trasporto locale (scripts/uc-test/local-neon.cjs) e un ambiente pulito.
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

type Row = Record<string, unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let workspacesModule: typeof import("../db/queries/workspaces.ts");
let provisioning: typeof import("../db/queries/use-case-provisioning.ts");
let scoringModels: typeof import("../db/queries/scoring-model.ts");
let svc: typeof import("./service.ts");
let scoring: typeof import("../db/use-case-scoring.ts");
let prefix: typeof import("./prefix.ts");
let fileDir = "";

const suffix = randomBytes(3).toString("hex");
const SUFFIX = suffix.toUpperCase();
const ids = { org: randomUUID(), ls: randomUUID() };
const LS_EMAIL = `ls.${suffix}@ls.test`;
const created: string[] = [];
const ENV_KEYS = ["USE_CASE_HUB_WORKSPACES", "USE_CASE_HUB_EXCLUDE", "UC_LS_EMAIL_DOMAINS", "UC_ENABLED", "UC_WORKSPACE_IDS", "VERCEL_ENV"] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

interface Run {
  status: number;
  last: Row;
  stdout: string;
}

/** Lo script dell'operatore, come lo lancia Pierpaolo: solo le variabili che servono. */
function runAdmin(args: string[], env: Record<string, string | undefined> = {}): Run {
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/private/tmp",
    UC_TEST_DATABASE_URL: url!,
    UC_TEST_PG_PORT: port,
    UC_TEST_PG_DB: packageDb,
    USE_CASE_ADMIN_DATABASE_URL: url!,
    UC_LS_EMAIL_DOMAINS: "ls.test",
    TMPDIR: fileDir,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  const result = spawnSync(process.execPath, ["--no-warnings", "--require", "./scripts/uc-test/local-neon.cjs", "scripts/use-case-admin.ts", ...args], {
    cwd: ROOT,
    env: childEnv as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 120_000,
  });
  const docs = result.stdout
    .split(/^\}$/m)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => JSON.parse(`${chunk}\n}`) as Row);
  return { status: result.status ?? -1, last: docs.at(-1) ?? {}, stdout: result.stdout };
}

const confirm = () => ["--apply", "--confirm-authorized", "--confirm-database", `127.0.0.1:${port}/${packageDb}`, "--environment", "local"];

const CONFIG_COLUMNS = `slug, code_prefix, enabled, next_code_seq, identity_mode, auth_mode, workspace_display_name, guide, guide_version,
  allowed_domains, allowed_origins, limits, updated_by`;

async function configOf(workspaceId: string): Promise<Row | null> {
  return (await q(`SELECT ${CONFIG_COLUMNS} FROM workspace_connector_configs WHERE workspace_id = $1::uuid`, [workspaceId]))[0] ?? null;
}

async function modelOf(workspaceId: string): Promise<Row | null> {
  return (await q(`SELECT impact_flag_enabled, config, updated_by_user_id FROM workspace_scoring_models WHERE workspace_id = $1::uuid`, [workspaceId]))[0] ?? null;
}

/** Un workspace scritto a mano, senza riga di config né modello (com'erano quelli di prima). */
async function bareWorkspace(name: string): Promise<string> {
  const id = randomUUID();
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1::uuid, $2::uuid, $3)`, [id, ids.org, name]);
  created.push(id);
  return id;
}

function ok<T>(result: { ok: true; value: T } | { ok: false; error: string; message: string }): T {
  if (!result.ok) assert.fail(`atteso ok, ricevuto ${result.error} (${result.message})`);
  return result.value;
}

const persona = (workspaceId: string) => ({
  workspaceId,
  actor: { userId: ids.ls, role: "transformation_lead", isLateralSpace: true, kind: "persona" as const },
  channel: "pagina" as const,
});

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  fileDir = mkdtempSync(join(tmpdir(), "hub-tutti-"));
  workspacesModule = await import("../db/queries/workspaces.ts");
  provisioning = await import("../db/queries/use-case-provisioning.ts");
  scoringModels = await import("../db/queries/scoring-model.ts");
  svc = await import("./service.ts");
  scoring = await import("../db/use-case-scoring.ts");
  prefix = await import("./prefix.ts");

  // L'area accesa per tutti, come in produzione dopo il passaggio a «*».
  process.env.USE_CASE_HUB_WORKSPACES = "*";
  delete process.env.USE_CASE_HUB_EXCLUDE;
  process.env.UC_LS_EMAIL_DOMAINS = "ls.test";
  delete process.env.UC_ENABLED;
  delete process.env.UC_WORKSPACE_IDS;
  delete process.env.VERCEL_ENV;

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Organizzazione di prova per tutti', $2)`, [ids.org, `hub-tutti-${ids.org}`]);
  await q(`INSERT INTO users (id, email, name, email_verified) VALUES ($1::uuid, $2, 'Lateral Space di prova', now())`, [ids.ls, LS_EMAIL]);
});

after(async () => {
  if (!enabled) return;
  for (const id of created) await q(`DELETE FROM workspaces WHERE id = $1::uuid`, [id]);
  await q(`DELETE FROM organizations WHERE id = $1::uuid`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1::uuid`, [ids.ls]);
  for (const key of ENV_KEYS) {
    if (envBefore[key] === undefined) delete process.env[key];
    else process.env[key] = envBefore[key];
  }
  if (fileDir) rmSync(fileDir, { recursive: true, force: true });
});

// ─── createWorkspace ─────────────────────────────────────────────────

test("createWorkspace: il workspace nuovo nasce pronto per l'area, e doctor è verde con «*»", opts, async () => {
  const name = `Cliente Nuovo Prova ${SUFFIX}`;
  const first = await workspacesModule.createWorkspace({ organizationId: ids.org, name });
  const second = await workspacesModule.createWorkspace({ organizationId: ids.org, name });
  created.push(first.id, second.id);
  assert.equal(first.name, name);

  // Prefisso dal nome come `configs`; slug dal nome più l'id (mai quello «pulito»), connettore spento.
  const a = await configOf(first.id);
  const b = await configOf(second.id);
  assert.equal(a?.slug, prefix.slugForNewWorkspace(name, first.id));
  assert.equal(b?.slug, prefix.slugForNewWorkspace(name, second.id), "lo stesso nome dà uno slug diverso");
  assert.ok(String(a?.slug).startsWith(`cliente-nuovo-prova-${suffix}-`) && a?.slug !== `cliente-nuovo-prova-${suffix}`);
  for (const row of [a, b]) {
    assert.equal(row?.code_prefix, "CNP");
    assert.equal(row?.enabled, false, "il connettore non si accende mai da qui");
    assert.equal(Number(row?.next_code_seq), 0);
  }

  // Il modello di `scoring-v2 --apply` su un workspace senza proposte.
  const model = await modelOf(first.id);
  assert.equal(model?.impact_flag_enabled, false);
  assert.deepEqual(model?.config, JSON.parse(JSON.stringify(scoring.scoringModelConfigFor(2))));
  assert.equal((await scoringModels.getWorkspaceScoringModel(first.id))?.resolvedConfig.scoringVersion, 2);

  // doctor con l'interruttore di produzione: verde, area accesa senza elencare il workspace.
  const doctor = runAdmin(["doctor", "--workspace", first.id], { USE_CASE_HUB_WORKSPACES: "*" });
  assert.equal(doctor.status, 0, doctor.stdout);
  assert.equal(doctor.last.status, "GREEN", doctor.stdout);
  const [report] = doctor.last.workspaces as Row[];
  assert.deepEqual(
    { rigaConfig: report.rigaConfig, senzaCodice: report.senzaCodice, origineDaDecidere: report.origineDaDecidere, scoringVersion: report.scoringVersion, areaAccesa: report.areaAccesa },
    { rigaConfig: true, senzaCodice: 0, origineDaDecidere: 0, scoringVersion: 2, areaAccesa: true },
  );
  assert.notEqual(report.dossierLinksReady, false);
  // Con l'esclusione l'area è spenta per lui, e i prerequisiti restano a posto.
  const excluded = runAdmin(["doctor", "--workspace", first.id], { USE_CASE_HUB_WORKSPACES: "*", USE_CASE_HUB_EXCLUDE: first.id.toUpperCase() });
  assert.equal(excluded.last.status, "GREEN", excluded.stdout);
  assert.equal((excluded.last.workspaces as Row[])[0].areaAccesa, false);

  // Gli script non hanno più niente da fare.
  assert.equal(runAdmin(["configs", "--workspace", first.id]).last.status, "NOTHING_TO_DO");
  assert.equal(runAdmin(["scoring-v2", "--workspace", first.id]).last.status, "NOTHING_TO_DO");
  assert.equal(runAdmin(["codes", "--workspace", first.id]).last.status, "NOTHING_TO_DO");
});

test("createWorkspace: nessuno prende lo slug «pulito» di un cliente, e configs lo dà ancora", opts, async () => {
  // Chiunque crea «Banca Squat»: lo slug non è `banca-squat-…` senza id, quindi resta libero.
  const name = `Banca Squat ${SUFFIX}`;
  const squatter = await workspacesModule.createWorkspace({ organizationId: ids.org, name });
  created.push(squatter.id);
  assert.notEqual((await configOf(squatter.id))?.slug, `banca-squat-${suffix}`);
  // Il workspace del cliente vero, di prima e senza riga: l'operatore gli dà lo slug pulito.
  const real = await bareWorkspace(name);
  const configs = runAdmin(["configs", "--workspace", real, ...confirm()]);
  assert.equal(configs.last.status, "APPLIED", configs.stdout);
  assert.equal((await configOf(real))?.slug, `banca-squat-${suffix}`);
});

test("createWorkspace: due workspace con lo stesso nome nello stesso momento, ognuno con la sua riga", opts, async () => {
  const name = `Contemporanei Prova ${SUFFIX}`;
  for (let round = 0; round < 3; round++) {
    const made = await Promise.all([0, 1, 2].map(() => workspacesModule.createWorkspace({ organizationId: ids.org, name })));
    created.push(...made.map((ws) => ws.id));
    const rows = await Promise.all(made.map((ws) => configOf(ws.id)));
    assert.deepEqual(
      rows.map((row) => row?.slug),
      made.map((ws) => prefix.slugForNewWorkspace(name, ws.id)),
      `giro ${round}`,
    );
    assert.equal(new Set(rows.map((row) => row?.slug)).size, 3, `giro ${round}: slug diversi`);
    for (const ws of made) assert.equal((await modelOf(ws.id) as { config: { scoringVersion?: number } } | null)?.config.scoringVersion, 2);
  }
});

test("lo stesso workspace preparato due volte insieme: una riga e un modello", opts, async () => {
  for (let round = 0; round < 3; round++) {
    const ws = await bareWorkspace(`Doppio giro ${round} ${SUFFIX}`);
    const outcomes = await Promise.all([provisioning.provisionUseCaseWorkspace(ws), provisioning.provisionUseCaseWorkspace(ws)]);
    for (const outcome of outcomes) {
      assert.equal(outcome.ok && outcome.workspace === "pronto" && outcome.config !== "non_creata", true, JSON.stringify(outcomes));
      assert.equal(outcome.ok && outcome.workspace === "pronto" && outcome.model !== "lasciato", true, JSON.stringify(outcomes));
    }
    assert.equal(Number((await q(`SELECT count(*)::int AS n FROM workspace_connector_configs WHERE workspace_id = $1::uuid`, [ws]))[0].n), 1);
    assert.equal(Number((await q(`SELECT count(*)::int AS n FROM workspace_scoring_models WHERE workspace_id = $1::uuid`, [ws]))[0].n), 1);
    assert.equal((await configOf(ws))?.slug, prefix.slugForNewWorkspace(`Doppio giro ${round} ${SUFFIX}`, ws));
  }
});

test("i prerequisiti sono quelli che lasciano configs --apply e scoring-v2 --apply, tranne lo slug", opts, async () => {
  const name = `Banca Esempio Nord ${SUFFIX}`;
  const ws = await bareWorkspace(name);

  const configs = runAdmin(["configs", "--workspace", ws, ...confirm()]);
  assert.equal(configs.last.status, "APPLIED", configs.stdout);
  const v2 = runAdmin(["scoring-v2", "--workspace", ws, ...confirm()]);
  assert.equal(v2.last.status, "APPLIED", v2.stdout);
  const byScripts = { config: await configOf(ws), model: await modelOf(ws) };

  await q(`DELETE FROM workspace_connector_configs WHERE workspace_id = $1::uuid`, [ws]);
  await q(`DELETE FROM workspace_scoring_models WHERE workspace_id = $1::uuid`, [ws]);
  const outcome = await provisioning.provisionUseCaseWorkspace(ws);
  assert.deepEqual(outcome, { ok: true, workspace: "pronto", config: "creata", model: "creato_v2" });
  const byApp = { config: { ...(await configOf(ws)), slug: byScripts.config?.slug }, model: await modelOf(ws) };
  assert.deepEqual(byApp, byScripts);
  assert.equal((await configOf(ws))?.slug, prefix.slugForNewWorkspace(name, ws), "lo slug dell'app ha l'id");
  assert.equal(byScripts.config?.slug, `banca-esempio-nord-${suffix}`, "quello pulito lo dà configs");
  assert.equal(byScripts.config?.code_prefix, "BEN");

  // Idempotente: la seconda volta non cambia niente.
  const before = { config: await configOf(ws), model: await modelOf(ws) };
  assert.deepEqual(await provisioning.provisionUseCaseWorkspace(ws), { ok: true, workspace: "pronto", config: "presente", model: "presente" });
  assert.deepEqual({ config: await configOf(ws), model: await modelOf(ws) }, before);
});

test("recupero: un workspace di prima si sistema; un modello che c'è, o gli use case, restano a scoring-v2", opts, async () => {
  // Senza modello e senza use case: riga e v2.
  const empty = await bareWorkspace(`Vuoto Prova ${SUFFIX}`);
  assert.deepEqual(await provisioning.provisionUseCaseWorkspace(empty), { ok: true, workspace: "pronto", config: "creata", model: "creato_v2" });

  // Con un modello v1 (creato prima della v2) e senza use case: la riga sì, il modello non si
  // tocca. Il passaggio è di scoring-v2, e doctor lo dice.
  const v1 = await bareWorkspace(`Modello vecchio ${SUFFIX}`);
  const custom = { ...scoring.DEFAULT_SCORING_MODEL_CONFIG, overall: { impact: 0.6, feasibility: 0.4, esg: 0 } };
  await q(`INSERT INTO workspace_scoring_models (workspace_id, impact_flag_enabled, config) VALUES ($1::uuid, true, $2::jsonb)`, [v1, JSON.stringify(custom)]);
  const beforeModel = await modelOf(v1);
  assert.deepEqual(await provisioning.provisionUseCaseWorkspace(v1), { ok: true, workspace: "pronto", config: "creata", model: "lasciato" });
  assert.deepEqual(await modelOf(v1), beforeModel, "il modello di prima resta com'era");
  const v1Doctor = runAdmin(["doctor", "--workspace", v1], { USE_CASE_HUB_WORKSPACES: "*" });
  assert.equal((v1Doctor.last.controlli as Array<{ controllo: string; ok: boolean }>).find((c) => c.controllo === "scoring_v2")?.ok, false, v1Doctor.stdout);
  assert.equal(runAdmin(["scoring-v2", "--workspace", v1, ...confirm()]).last.status, "APPLIED");
  const moved = await modelOf(v1);
  assert.deepEqual(moved?.config, { ...JSON.parse(JSON.stringify(custom)), scoringVersion: 2 });
  assert.equal(moved?.impact_flag_enabled, true);

  // Con use case e senza modello: la riga sì, il modello no (il prima/dopo è di scoring-v2).
  const legacy = await bareWorkspace(`Con schede ${SUFFIX}`);
  await q(`INSERT INTO use_cases (id, workspace_id, title, status) VALUES ($1::uuid, $2::uuid, 'Scheda di prima', 'proposed')`, [randomUUID(), legacy]);
  assert.deepEqual(await provisioning.provisionUseCaseWorkspace(legacy), { ok: true, workspace: "pronto", config: "creata", model: "lasciato" });
  assert.equal(await modelOf(legacy), null);
  // E il primo modello creato dall'app per lui resta quello di sempre, in v1.
  const first = await scoringModels.getOrCreateWorkspaceScoringModel(legacy);
  assert.equal(first.resolvedConfig.scoringVersion, 1);
  const legacyModel = await modelOf(legacy);
  assert.equal(Object.hasOwn(legacyModel?.config as object, "scoringVersion"), false, "il predefinito di sempre, senza scoringVersion");
  const doctor = runAdmin(["doctor", "--workspace", legacy], { USE_CASE_HUB_WORKSPACES: "*" });
  assert.equal(doctor.last.status, "RED", "doctor dice che manca scoring-v2");
  assert.equal((doctor.last.controlli as Array<{ controllo: string; ok: boolean }>).find((c) => c.controllo === "scoring_v2")?.ok, false);

  // Un ritorno alla v1 con scoring-v2 --revert su un workspace vuoto: l'app non lo disfa.
  const reverted = await workspacesModule.createWorkspace({ organizationId: ids.org, name: `Ritorno v1 ${SUFFIX}` });
  created.push(reverted.id);
  assert.equal((await modelOf(reverted.id) as { config: { scoringVersion?: number } } | null)?.config.scoringVersion, 2);
  const revert = runAdmin(["scoring-v2", "--revert", "--workspace", reverted.id, ...confirm()]);
  assert.equal(revert.last.status, "APPLIED", revert.stdout);
  provisioning.forgetProvisionedWorkspacesForTests();
  assert.deepEqual(await provisioning.provisionUseCaseWorkspaceSafely(reverted.id), { ok: true, workspace: "pronto", config: "presente", model: "lasciato" });
  assert.equal((await modelOf(reverted.id) as { config: { scoringVersion?: number } } | null)?.config.scoringVersion, 1, "resta in v1");
  assert.equal((await scoringModels.getOrCreateWorkspaceScoringModel(reverted.id)).resolvedConfig.scoringVersion, 1);

  // Un workspace che non c'è: niente.
  assert.deepEqual(await provisioning.provisionUseCaseWorkspace(randomUUID()), { ok: true, workspace: "assente" });
});

test("createWorkspace: il workspace nasce anche se i prerequisiti non riescono, e si recuperano dopo", opts, async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const name = `Senza tabella ${SUFFIX}`;
  await q(`ALTER TABLE workspace_connector_configs RENAME TO wcc_tutti_via`);
  let lonely: Awaited<ReturnType<typeof workspacesModule.createWorkspace>>;
  try {
    lonely = await workspacesModule.createWorkspace({ organizationId: ids.org, name });
  } finally {
    await q(`ALTER TABLE wcc_tutti_via RENAME TO workspace_connector_configs`);
  }
  created.push(lonely.id);
  assert.equal(Number((await q(`SELECT count(*)::int AS n FROM workspaces WHERE id = $1::uuid`, [lonely.id]))[0].n), 1);
  assert.equal(await configOf(lonely.id), null);
  const lines = log.mock.calls.map((call) => call.arguments.map(String).join(" "));
  assert.ok(lines.some((line) => line.includes("provision_failed")), JSON.stringify(lines));
  assert.ok(lines.every((line) => !line.includes(name) && !line.includes(lonely.id)), "il log non ha nome né id del workspace");
  // La prima visita del layout (o il primo codice) li recupera.
  assert.deepEqual(await provisioning.provisionUseCaseWorkspaceSafely(lonely.id), { ok: true, workspace: "pronto", config: "creata", model: "creato_v2" });
  assert.equal(await provisioning.provisionUseCaseWorkspaceSafely(lonely.id), null, "già a posto: nessuna rilettura");
});

// ─── Proposte ────────────────────────────────────────────────────────

test("una proposta dal servizio in un workspace mai elencato e senza riga: area accesa da «*», codice, modello v2", opts, async () => {
  const ws = await bareWorkspace(`Ottica Rossi Milano ${SUFFIX}`);
  await q(`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'transformation_lead'::member_role)`, [ws, ids.ls]);
  assert.equal(await configOf(ws), null);

  const [card] = ok(await svc.createUseCases(persona(ws), [{ source: "web_proposed", kind: "da_costruire", title: `Preventivi automatici ${suffix}`, description: "Oggi si fanno a mano." }]));
  assert.equal(card.code, "ORM-0001", "il codice c'è anche senza riga di config");
  const config = await configOf(ws);
  assert.equal(config?.slug, prefix.slugForNewWorkspace(`Ottica Rossi Milano ${SUFFIX}`, ws));
  assert.equal(config?.enabled, false);
  assert.equal(Number(config?.next_code_seq), 1);
  // La prima proposta di un workspace vuoto si valuta già in v2.
  assert.equal((await modelOf(ws) as { config: { scoringVersion?: number } } | null)?.config.scoringVersion, 2);

  const [next] = ok(await svc.createUseCases(persona(ws), [{ source: "web_proposed", kind: "da_costruire", title: `Seconda proposta ${suffix}`, description: null }]));
  assert.equal(next.code, "ORM-0002");

  // Con l'esclusione il cliente torna indietro: l'area è spenta per lui, anche con «*».
  process.env.USE_CASE_HUB_EXCLUDE = ws;
  try {
    const refused = await svc.createUseCases(persona(ws), [{ source: "web_proposed", kind: "da_costruire", title: `Vietata ${suffix}`, description: null }]);
    assert.equal(refused.ok, false);
    assert.equal(!refused.ok && refused.error, "area_spenta");
  } finally {
    delete process.env.USE_CASE_HUB_EXCLUDE;
  }
});

test("assignUseCaseCode: la riga mancante nasce solo per una scheda del workspace ancora senza codice", opts, async () => {
  const codes = await import("../db/queries/use-case-codes.ts");
  const ws = await bareWorkspace(`Codici Tardivi Prova ${SUFFIX}`);
  const other = await bareWorkspace(`Altro workspace ${SUFFIX}`);
  const card = randomUUID();
  await q(`INSERT INTO use_cases (id, workspace_id, title, status) VALUES ($1::uuid, $2::uuid, 'Scheda senza codice', 'proposed')`, [card, ws]);
  // Una scheda di un altro workspace non crea righe.
  assert.equal(await codes.assignUseCaseCode(other, card), null);
  assert.equal(await configOf(other), null);
  assert.equal(await codes.assignUseCaseCode(ws, card), "CTP-0001");
  assert.equal((await configOf(ws))?.enabled, false);
  // Già assegnato: nessun effetto.
  assert.equal(await codes.assignUseCaseCode(ws, card), null);
  assert.equal(Number((await configOf(ws))?.next_code_seq), 1);
});

// ─── uc-doctor ───────────────────────────────────────────────────────

test("uc-doctor accetta «*» in produzione, e segnala un workspace dei dossier escluso", opts, () => {
  const dossierWs = randomUUID();
  const base = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/private/tmp",
    UC_ENABLED: "true",
    UC_WORKSPACE_IDS: dossierWs,
    USE_CASE_HUB_WORKSPACES: "*",
    UC_LS_EMAIL_DOMAINS: "ls.test",
    UC_SECRET: "segreto-di-prova",
    CRON_SECRET: "cron-di-prova",
    UC_SCHEMA_SELF_HEAL: "off",
    NEXT_PUBLIC_APP_URL: "https://app.example.test",
    RESEND_API_KEY: "chiave-di-prova",
    UC_EMAIL_FROM: "Prova <avvisi@example.test>",
    BLOB_READ_WRITE_TOKEN: "store-di-prova",
  };
  const run = (env: Record<string, string>) => {
    const result = spawnSync(process.execPath, ["--no-warnings", "scripts/uc-doctor.ts", "--environment", "production", "--no-db", "--json"], {
      cwd: ROOT,
      env: env as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 60_000,
    });
    const report = JSON.parse(result.stdout) as { status: string; checks: Array<{ key: string; status: string }> };
    return { code: result.status, report, hub: report.checks.find((c) => c.key === "USE_CASE_HUB_WORKSPACES")?.status };
  };
  const star = run(base);
  assert.equal(star.code, 0, JSON.stringify(star.report));
  assert.equal(star.hub, "ok");
  const excluded = run({ ...base, USE_CASE_HUB_EXCLUDE: dossierWs });
  assert.equal(excluded.code, 1);
  assert.equal(excluded.hub, "errore");
});
