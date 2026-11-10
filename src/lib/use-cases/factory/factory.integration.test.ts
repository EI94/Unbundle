import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// L'Agent Factory sul database di prova dell'hub (rilascio 8.0a): pacchetto, progetto e decisioni di uno use case
// con il team del suo dossier. Una versione nuova del pacchetto solo se il contenuto cambia; i 10 argomenti
// diventano decisioni; senza l'AI Board un progetto con strumenti nuovi non si approva; il responsabile registra
// l'ok solo con la nota; la versione approvata prima diventa «superata»; le notifiche vanno a chi ha il ruolo,
// mai a chi ha agito.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1).
//   Dati sintetici, creati e cancellati qui.
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

type Row = Record<string, unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let factory: typeof import("../../db/queries/use-case-factory.ts");
let exec: import("../../db/uc-executor.ts").UcExecutor;

const suffix = randomBytes(3).toString("hex");
const ids = {
  org: randomUUID(),
  ws: randomUUID(),
  useCase: randomUUID(),
  template: randomUUID(),
  dossier: randomUUID(),
  lead: randomUUID(),
  analyst: randomUUID(),
  board: randomUUID(),
  watcher: randomUUID(),
};
const target = () => ({ workspaceId: ids.ws, useCaseId: ids.useCase });
const lead = () => ({ kind: "persona" as const, userId: ids.lead, roles: ["ls_lead" as const] });
const analyst = () => ({ kind: "persona" as const, userId: ids.analyst, roles: ["ls_analista" as const] });
const board = () => ({ kind: "persona" as const, userId: ids.board, roles: ["ai_board" as const] });
const watcher = () => ({ kind: "persona" as const, userId: ids.watcher, roles: ["osservatore" as const] });
const script = () => ({ kind: "script" as const, authorRole: "responsabile del caso" });

const TOPICS = ["funzionalita", "journey", "dati", "framework", "backend", "frontend", "integrazioni", "modelli", "osservabilita", "evals_autonomia"];

const source = (over: Record<string, unknown> = {}) => ({
  code: `TJ-${suffix.toUpperCase()}`,
  title: "Quotazioni automatiche di prova",
  kindLabel: "use case AI",
  origin: "adoption",
  targetQuarter: "T1 2027",
  texts: { oggi: "Oggi Persona Prova controlla a mano.", comeCambia: "L'agente prepara la quotazione.", persone: null, limiti: "Non conferma voli.", dati: null },
  benefits: [{ label: "Voli in più", lever: "ricavi", eurYear: 1000, confidence: "ipotesi" }],
  costText: null,
  answers: [],
  openNeeds: [{ title: "Accesso alla sandbox", status: "da chiedere" }],
  namesToHide: ["Persona Prova"],
  ...over,
});

async function notices(kind: string): Promise<string[]> {
  const rows = await q(`SELECT recipient_user_id FROM use_case_notifications WHERE use_case_id = $1 AND kind = $2 ORDER BY 1`, [ids.useCase, kind]);
  return rows.map((r) => String(r.recipient_user_id));
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  const ensure = await import("../../db/ensure-schema.ts");
  await ensure.ensureDbSchema();
  const executor = await import("../../db/uc-executor.ts");
  exec = executor.ucExecutorForUrl(url!);
  factory = await import("../../db/queries/use-case-factory.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova 8.0a', $2)`, [ids.org, `org-80a-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova 8.0a')`, [ids.ws, ids.org]);
  await q(`INSERT INTO use_cases (id, workspace_id, title) VALUES ($1, $2, 'Quotazioni automatiche di prova')`, [ids.useCase, ids.ws]);
  for (const [id, who] of [[ids.lead, "lead"], [ids.analyst, "analista"], [ids.board, "board"], [ids.watcher, "osservatore"]]) {
    await q(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3)`, [id, `prova-80a-${who}-${suffix}@example.test`, `Prova ${who}`]);
  }
  await q(
    `INSERT INTO uc_templates (id, key, version, name, archetype, definition, definition_hash, restricted_to_workspace_id)
     VALUES ($1::uuid, $2, '1.0.0', 'Template di prova 8.0a', 'prova', '{"confidential": false}'::jsonb, $3, $4::uuid)`,
    [ids.template, `prova.factory_${suffix}`, randomBytes(32).toString("hex"), ids.ws],
  );
  await q(
    `INSERT INTO uc_cases (id, workspace_id, organization_id, portfolio_use_case_id, template_id, template_version, code, title)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, '1.0.0', $6, 'Dossier di prova 8.0a')`,
    [ids.dossier, ids.ws, ids.org, ids.useCase, ids.template, `F80A-${suffix.toUpperCase()}`],
  );
  for (const [user, role] of [[ids.lead, "ls_lead"], [ids.analyst, "ls_analista"], [ids.board, "ai_board"], [ids.watcher, "osservatore"]]) {
    await q(`INSERT INTO uc_case_members (case_id, user_id, role) VALUES ($1, $2, $3)`, [ids.dossier, user, role]);
  }
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  await q(`DELETE FROM uc_templates WHERE id = $1`, [ids.template]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.lead, ids.analyst, ids.board, ids.watcher]]);
});

test("la sonda è vera; lo use case si trova dal dossier; chi non è nel team non legge", opts, async () => {
  assert.equal(await factory.factoryStoreReady(exec), true);
  const found = await factory.findUseCaseOfCase(exec, ids.ws, ids.dossier);
  assert.equal(found?.useCaseId, ids.useCase);
  assert.equal(await factory.findUseCaseOfCase(exec, randomUUID(), ids.dossier), null);
  const empty = await factory.readFactory(exec, target(), lead());
  assert.ok(empty.ok);
  assert.deepEqual([empty.value.packages.length, empty.value.open, empty.value.approved, empty.value.decisions.length], [0, null, null, 0]);
  const nobody = await factory.readFactory(exec, target(), { kind: "persona", userId: ids.watcher, roles: [] });
  assert.equal(nobody.ok, false);
});

test("il pacchetto: k1, lo stesso contenuto non crea versioni, un contenuto nuovo fa k2; niente nomi; notifica chi costruisce, non chi agisce", opts, async () => {
  assert.equal((await factory.savePackageVersion(exec, watcher(), target(), { generated: source() })).ok, false, "l'osservatore non scrive");
  const k1 = await factory.savePackageVersion(exec, lead(), target(), { generated: source() });
  assert.deepEqual(k1, { ok: true, value: { version: 1, created: true } });
  const again = await factory.savePackageVersion(exec, lead(), target(), { generated: source() }, new Date(Date.now() + 86_400_000));
  assert.deepEqual(again, { ok: true, value: { version: 1, created: false } }, "stesso contenuto, anche un altro giorno");
  const k2 = await factory.savePackageVersion(exec, analyst(), target(), { generated: source({ openNeeds: [] }) });
  assert.deepEqual(k2, { ok: true, value: { version: 2, created: true } });
  const read = await factory.readFactory(exec, target(), watcher());
  assert.ok(read.ok);
  assert.deepEqual(read.value.packages.map((p) => p.version), [2, 1]);
  assert.equal(read.value.latestPackage?.version, 2);
  assert.match(read.value.latestPackage!.files.VERSIONE, /^k2 · TJ-/);
  assert.ok(!JSON.stringify(read.value.latestPackage!.files).includes("Persona Prova"), "il nome noto è coperto");
  const recipients = await notices("pacchetto_nuovo");
  assert.ok(recipients.includes(ids.lead) && recipients.includes(ids.analyst), "chi costruisce");
  assert.ok(!recipients.includes(ids.board) && !recipients.includes(ids.watcher), "non l'AI Board né l'osservatore");
  const imported = await factory.savePackageVersion(exec, script(), target(), { imported: { "PACCHETTO.md": "# k3 a mano", "BRIEF.md": "brief", VERSIONE: "k3" } });
  assert.deepEqual(imported, { ok: true, value: { version: 3, created: true } });
});

test("il progetto: i 10 argomenti diventano decisioni; senza tutti non si manda; da approvare non si cambia", opts, async () => {
  assert.equal((await factory.startProject(exec, watcher(), target())).ok, false);
  assert.deepEqual(await factory.startProject(exec, analyst(), target()), { ok: true, value: { version: 1, created: true } });
  assert.deepEqual(await factory.startProject(exec, analyst(), target()), { ok: true, value: { version: 1, created: false } }, "una sola aperta");
  const bad = await factory.saveProjectTopic(exec, analyst(), target(), { topic: "prezzo", scelta: "x" });
  assert.equal(bad.ok, false);
  const empty = await factory.saveProjectTopic(exec, analyst(), target(), { topic: "dati", scelta: "   " });
  assert.equal(empty.ok, false);
  for (const topic of TOPICS.slice(0, 9)) {
    const saved = await factory.saveProjectTopic(exec, analyst(), target(), { topic, scelta: topic === "framework" ? "codice" : `Scelta per ${topic}`, perche: "Il consiglio della skill", alternativa: "Un'altra strada" });
    assert.ok(saved.ok, topic);
  }
  const early = await factory.submitProject(exec, analyst(), target());
  assert.equal(early.ok, false);
  assert.match(early.ok ? "" : early.message, /Evals e autonomia/);
  await factory.saveProjectTopic(exec, analyst(), target(), { topic: "evals_autonomia", scelta: "Regole al 100 %" });
  assert.ok((await factory.saveProjectDetails(exec, analyst(), target(), { newTools: [{ nome: "Neon", perche: "database del caso" }], estimateHours: 90, monthlyCostEur: 60 })).ok);
  const submitted = await factory.submitProject(exec, analyst(), target());
  assert.deepEqual(submitted, { ok: true, value: { version: 1, newTools: 1 } });
  assert.equal((await factory.saveProjectTopic(exec, analyst(), target(), { topic: "dati", scelta: "Altro" })).ok, false, "da approvare non si cambia");
  const read = await factory.readFactory(exec, target(), watcher());
  assert.ok(read.ok);
  assert.equal(read.value.open?.status, "da_approvare");
  assert.equal(read.value.open?.framework, "codice");
  assert.equal(read.value.open?.topics.evals_autonomia?.scelta, "Regole al 100 %");
  assert.equal(read.value.decisions.filter((d) => d.source === "impostazione").length, 10);
  assert.deepEqual(await notices("progetto_appr"), [ids.lead]);
  const tools = await notices("strumento_nuovo");
  assert.ok(tools.includes(ids.board) && tools.includes(ids.lead));
});

test("l'AI Board: senza il suo ok non si approva; il responsabile lo registra solo con la nota; l'analista non approva", opts, async () => {
  const blocked = await factory.approveProject(exec, lead(), target());
  assert.equal(blocked.ok ? "" : blocked.code, "manca_ai_board");
  assert.equal((await factory.recordAiBoardOk(exec, analyst(), target(), { note: "Ok dato a voce" })).ok, false);
  const noNote = await factory.recordAiBoardOk(exec, lead(), target(), {});
  assert.equal(noNote.ok ? "" : noNote.code, "nota_mancante");
  assert.ok((await factory.recordAiBoardOk(exec, lead(), target(), { note: "Ok dell'AI Board di TopJet del 10/11/2026, per e-mail al responsabile" })).ok);
  assert.equal((await factory.approveProject(exec, analyst(), target())).ok, false);
  assert.deepEqual(await factory.approveProject(exec, lead(), target()), { ok: true, value: { version: 1 } });
  const read = await factory.readFactory(exec, target(), board());
  assert.ok(read.ok);
  assert.equal(read.value.open, null);
  assert.equal(read.value.approved?.version, 1);
  assert.match(read.value.approved?.aiBoardNote ?? "", /AI Board di TopJet/);
});

test("una revisione: la versione 2 parte dalle scelte della 1; approvata, la 1 diventa «superata»; l'AI Board registra da sé senza nota", opts, async () => {
  assert.deepEqual(await factory.startProject(exec, analyst(), target()), { ok: true, value: { version: 2, created: true } });
  const read = await factory.readFactory(exec, target(), lead());
  assert.ok(read.ok);
  assert.equal(read.value.open?.topics.dati?.scelta, "Scelta per dati", "copiate dalla 1");
  await factory.saveProjectTopic(exec, analyst(), target(), { topic: "osservabilita", scelta: "Langfuse in UE" });
  assert.ok((await factory.submitProject(exec, analyst(), target())).ok);
  assert.ok((await factory.recordAiBoardOk(exec, board(), target(), {})).ok, "l'AI Board senza nota");
  assert.ok((await factory.approveProject(exec, lead(), target())).ok);
  const rows = await q(`SELECT version, status FROM use_case_projects WHERE use_case_id = $1 ORDER BY version`, [ids.useCase]);
  assert.deepEqual(rows.map((r) => [r.version, r.status]), [[1, "superato"], [2, "approvato"]]);
});

test("le decisioni del team e dell'import; i testi con dati da non scrivere si fermano", opts, async () => {
  const team = await factory.addTeamDecision(exec, analyst(), target(), { topic: "Strumenti nuovi", choice: "Neon e Langfuse approvati", reason: "Ok del responsabile" });
  assert.ok(team.ok);
  const imported = await factory.addTeamDecision(exec, script(), target(), { topic: "Integrazioni", choice: "Accesso FL3XX già disponibile", decidedOn: "2026-11-10" });
  assert.ok(imported.ok);
  const future = await factory.addTeamDecision(exec, analyst(), target(), { topic: "Prova", choice: "Data nel futuro", decidedOn: "2999-01-01" });
  assert.ok(future.ok, "la data futura diventa oggi");
  assert.equal((await factory.addTeamDecision(exec, watcher(), target(), { topic: "x", choice: "y" })).ok, false);
  const read = await factory.readFactory(exec, target(), watcher());
  assert.ok(read.ok);
  const byChoice = new Map(read.value.decisions.map((d) => [d.choice, d]));
  assert.equal(byChoice.get("Neon e Langfuse approvati")?.source, "team");
  assert.equal(byChoice.get("Accesso FL3XX già disponibile")?.source, "importata");
  assert.equal(byChoice.get("Accesso FL3XX già disponibile")?.authorRole, "responsabile del caso");
  assert.equal(byChoice.get("Accesso FL3XX già disponibile")?.decidedOn, "2026-11-10");
  assert.ok((byChoice.get("Data nel futuro")?.decidedOn ?? "9") < "2999");
});
