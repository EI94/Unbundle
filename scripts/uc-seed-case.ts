#!/usr/bin/env node
/**
 * Carica un caso reale da un file di seed `unbundle.uc-case-seed/1` (PIANO §8).
 *
 *   node --no-warnings scripts/uc-seed-case.ts --file <seed.json> [--workspace <uuid>]
 *        [--template-file <template.json>] [--role-aliases <role-aliases.json>]
 *        [--redact-names-file <names.json> | --allow-unredacted]
 *        [--accept-scan <sha256>] [--contract-ref "art. …;All. …"] [--include-personal-values]
 *        [--apply --confirm-authorized --confirm-database host[:port]/db
 *         --environment local|preview|production [--production-approved] --actor <userId>]
 *   env: UC_ADMIN_DATABASE_URL (mai .env né DATABASE_URL), UC_LS_EMAIL_DOMAINS,
 *        UC_PERSONAL_ZONE_KEY solo con --include-personal-values
 *
 * - Dry run di default: legge il seed e il template (da --template-file, normalizzato
 *   in memoria), stampa il piano, i conteggi attesi e il report di scansione con il
 *   suo sha256. Nessun accesso al database.
 * - `--apply`: trova il workspace (esattamente uno, altrimenti si ferma e non crea
 *   nulla), usa il template caricato nel database e riservato a quel workspace, crea
 *   il caso dal template e applica descrizione, mappe, ROI, milestone, blocchi, stati
 *   delle domande e valori dichiarati nelle call. Idempotente sul codice del caso.
 * - Non crea contatti: i referenti veri si inseriscono dall'interfaccia.
 * - Il report di scansione contiene solo chiavi e categorie, mai il testo.
 * - Scheda madre (casi-duso P0-16 d; docs/use-case/DESIGN.md §10.9): con la 0020 il
 *   caso non resta orfano. Se non ha una scheda, il seed ne crea una come
 *   `use-case-admin dossier-links` (approvata, «AI Transformation · dall'alto»,
 *   nascosta alla ricerca, senza proponente), la collega e le assegna il codice
 *   (senza riga di config del workspace resta senza: `configs` e poi `codes`). Il
 *   caso tiene il suo codice. Vale anche per un caso già seedato.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTemplateForCase, createCaseFromTemplate } from "../src/lib/db/queries/uc-templates.ts";
import { refreshReadinessCache, loadUserContext } from "../src/lib/db/queries/uc-cases.ts";
import { eventInsertSql, type EventActor } from "../src/lib/db/queries/uc-events.ts";
import { ucExecutorForUrl, type UcExecutor } from "../src/lib/db/uc-executor.ts";
import { parseLsDomains } from "../src/lib/uc/lateral-space.ts";
import { deriveWorkspaceKek, envelopeAad, sealJson } from "../src/lib/uc/crypto.ts";
import { planSeed, type PlanSeedOptions, type SeedPlan, type SeedScanner } from "../src/lib/uc/seed/plan.ts";
import { parseRedactionNames, parseSeedText, SEED_MAX_BYTES } from "../src/lib/uc/seed/schema.ts";
import { describeCandidates, pickWorkspace, workspaceSearch, type WorkspaceCandidate, type WorkspaceSearch } from "../src/lib/uc/seed/workspace.ts";
import { cast, jsonb, requireRows, toStatement, ucSql, type UcStatement } from "../src/lib/uc/sql/statement.ts";
import { ASSIGN_USE_CASE_CODE_SQL } from "../src/lib/portfolio/use-case-code.ts";
import { MOTHER_CARD } from "../src/lib/use-cases/admin/dossier-links.ts";
import { SCHEMA_FACTS_SQL, schemaFactsFrom } from "../src/lib/use-cases/admin/schema.ts";
import { planTemplateLoad } from "../src/lib/uc/template/load.ts";
import { normalizeTemplate } from "../src/lib/uc/template/normalize.ts";
import { redactPersonalMentions } from "../src/lib/uc/text/redact.ts";
import { scanText } from "../src/lib/uc/text/scan.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Workspace segnaposto per validare un template riservato nel dry run (nessun accesso al database). */
const DRY_RUN_WORKSPACE = "00000000-0000-4000-8000-000000000000";

function fail(code: string, message: string, extra: Record<string, unknown> = {}): never {
  console.error(JSON.stringify({ status: "ERROR", code, message, ...extra }, null, 2));
  process.exit(1);
}

// ── Opzioni ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const values = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!key.startsWith("--") || values.has(key)) fail("opzioni", `Opzione non valida o ripetuta: ${key}`);
  values.set(key, args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true");
}
const KNOWN = new Set([
  "--file",
  "--workspace",
  "--template-file",
  "--role-aliases",
  "--redact-names-file",
  "--allow-unredacted",
  "--accept-scan",
  "--contract-ref",
  "--include-personal-values",
  "--apply",
  "--confirm-authorized",
  "--confirm-database",
  "--environment",
  "--production-approved",
  "--actor",
]);
for (const key of values.keys()) if (!KNOWN.has(key)) fail("opzioni", `Opzione sconosciuta: ${key}`);
const flag = (key: string) => values.get(`--${key}`) === "true";
const option = (key: string): string | null => {
  const v = values.get(`--${key}`);
  if (v === undefined) return null;
  if (v === "true") fail("opzioni", `Manca il valore di --${key}`);
  return v;
};

function readText(path: string, maxBytes: number, what: string): string {
  try {
    if (statSync(path).size > maxBytes) fail("file_troppo_grande", `${what}: il file è troppo grande.`);
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error) fail("file_non_leggibile", `${what}: non riesco a leggere il file (${String(error.code)}).`);
    throw error;
  }
}

const seedFile = option("file");
if (!seedFile) fail("opzioni", "Indica il seed con --file <seed.json>.");
const apply = flag("apply");
const workspaceOption = option("workspace");
if (workspaceOption !== null && !UUID.test(workspaceOption)) fail("opzioni", "--workspace deve essere l'id (uuid) di un workspace.");
const acceptScan = option("accept-scan");
if (acceptScan !== null && !SHA256.test(acceptScan)) fail("opzioni", "--accept-scan deve essere lo sha256 (64 caratteri esadecimali) del report di scansione.");
const extraContractRefs = (option("contract-ref") ?? "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);
const includePersonal = flag("include-personal-values");

// 1. Seed: lettura e validazione stretta.
const seedParsed = parseSeedText(readText(seedFile, SEED_MAX_BYTES, "Seed"));
if (!seedParsed.ok) fail(seedParsed.code, seedParsed.message, seedParsed.issues.length ? { issues: seedParsed.issues.slice(0, 30) } : {});
const seed = seedParsed.value;
const templateKey = seed.template.key;
const templateVersion = seed.template.version;

// 2. Nomi da redigere (obbligatorio con --apply, salvo locale con --allow-unredacted).
let names: string[] = [];
const namesFile = option("redact-names-file");
if (namesFile) {
  const parsed = parseRedactionNames(readText(namesFile, 1024 * 1024, "File dei nomi"));
  if (!parsed.ok) fail(parsed.code, parsed.message);
  names = parsed.value;
}

// 3. Ruoli del seed → chiavi del template (file privato accanto al template).
const aliasesPath = option("role-aliases") ?? join(REPO, "templates", "uc", templateKey, "role-aliases.json");
let roleAliases: Record<string, string> = {};
if (existsSync(aliasesPath)) {
  try {
    roleAliases = JSON.parse(readText(aliasesPath, 256 * 1024, "Alias dei ruoli")) as Record<string, string>;
  } catch {
    fail("alias_non_validi", "Il file degli alias dei ruoli non è un JSON valido.");
  }
}

const scan: SeedScanner = (text, o) => scanText(text, o);
const planOptions = (): PlanSeedOptions => ({
  scan,
  redact: redactPersonalMentions,
  names,
  acceptScan,
  includePersonalValues: includePersonal,
  extraContractRefs,
  roleAliases,
});

function planSummary(plan: SeedPlan) {
  return {
    case: { code: plan.case.code, title: plan.case.title, status: plan.case.status, contract_refs: plan.case.contract_refs.length },
    template: plan.template,
    seed_hash: plan.seedHash,
    counts: plan.counts,
    scan: {
      report_sha256: plan.scan.sha256,
      accepted: plan.scan.accepted,
      values_held: plan.scan.valuesHeld,
      texts_held: plan.scan.textsHeld,
      apply_blocked: plan.scan.applyBlocked,
      entries: plan.scan.report.entries,
    },
    redactions: plan.redactions,
    warnings: plan.warnings,
  };
}

// ── Dry run: nessun accesso al database ────────────────────────────────
if (!apply) {
  const templateFile = option("template-file");
  if (!templateFile) {
    fail("opzioni", "Nel dry run indica il template con --template-file (il file del template, anche non normalizzato).");
  }
  let rawTemplate: unknown;
  try {
    rawTemplate = JSON.parse(readText(templateFile, 16 * 1024 * 1024, "Template"));
  } catch {
    fail("template_non_valido", "Il template non è un JSON valido.");
  }
  const normalized = normalizeTemplate(rawTemplate, { roleAliases });
  if (!normalized.ok) fail(normalized.code, normalized.message);
  const loaded = planTemplateLoad(JSON.stringify(normalized.template), { restrictToWorkspaceId: workspaceOption ?? DRY_RUN_WORKSPACE });
  if (!loaded.ok) fail(loaded.code, loaded.message);
  const plan = planSeed(seed, loaded.plan.definition, planOptions());
  console.log(
    JSON.stringify(
      { status: plan.ok ? "DRY_RUN_NO_DATABASE_ACCESS" : "DRY_RUN_WITH_ERRORS", errors: plan.errors, ...planSummary(plan) },
      null,
      2,
    ),
  );
  process.exit(plan.ok ? 0 : 1);
}

// ── Apply ──────────────────────────────────────────────────────────────
if (!flag("confirm-authorized")) fail("conferma", "--apply richiede --confirm-authorized dell'operatore responsabile.");
const databaseUrl = process.env.UC_ADMIN_DATABASE_URL;
if (!databaseUrl) fail("database", "Imposta UC_ADMIN_DATABASE_URL a mano: lo script non legge .env né DATABASE_URL.");
let target: URL;
try {
  target = new URL(databaseUrl);
} catch {
  fail("database", "UC_ADMIN_DATABASE_URL non è un URL valido.");
}
const fingerprint = `${target.hostname}${target.port ? `:${target.port}` : ""}${target.pathname}`;
if (option("confirm-database") !== fingerprint) fail("database", "--confirm-database deve essere esattamente host[:porta]/database dell'URL.");
const environment = option("environment");
if (environment !== "local" && environment !== "preview" && environment !== "production") {
  fail("ambiente", "--environment deve essere local, preview o production.");
}
if (environment === "local" && !LOOPBACK.has(target.hostname)) fail("ambiente", "--environment local accetta solo un database su loopback.");
if (environment !== "local" && LOOPBACK.has(target.hostname)) fail("ambiente", "Un database su loopback si usa solo con --environment local.");
if (environment === "production" && !flag("production-approved")) fail("ambiente", "In produzione serve l'approvazione esplicita: --production-approved.");
if (!namesFile && !(environment === "local" && flag("allow-unredacted"))) {
  fail("redazione", "Con --apply serve --redact-names-file (solo in locale si può usare --allow-unredacted).");
}
const actor = option("actor");
if (!actor || !UUID.test(actor)) fail("opzioni", "--apply richiede --actor <id utente>.");
const lsDomains = parseLsDomains(process.env.UC_LS_EMAIL_DOMAINS);
if (lsDomains.length === 0) fail("lateral_space", "Imposta UC_LS_EMAIL_DOMAINS: serve per verificare che l'attore sia di Lateral Space.");

const executor: UcExecutor = ucExecutorForUrl(databaseUrl);
const one = async (stmt: UcStatement) => (await executor.batch([stmt]))[0];

// 4. Workspace: --workspace, oppure esattamente un risultato dal suggerimento del seed.
async function findWorkspace(search: WorkspaceSearch): Promise<string> {
  if (workspaceOption) {
    const rows = await one(toStatement(ucSql`SELECT id FROM workspaces WHERE id = ${cast(workspaceOption, "uuid")}`));
    if (!rows[0]) fail("nessun_workspace", "Il workspace indicato con --workspace non esiste.");
    return workspaceOption;
  }
  const rows = await one(
    toStatement(ucSql`SELECT w.id::text AS id, w.name, o.name AS organization_name
FROM workspaces w JOIN organizations o ON o.id = w.organization_id`),
  );
  const candidates: WorkspaceCandidate[] = rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    organizationName: r.organization_name === null || r.organization_name === undefined ? null : String(r.organization_name),
  }));
  const picked = pickWorkspace(candidates, search);
  if (!picked.ok) {
    const close = candidates.filter((c) =>
      search.tokens.some((t) => `${c.organizationName ?? ""} ${c.name}`.toLowerCase().includes(t)),
    );
    fail(picked.code, picked.message, { candidati: describeCandidates(close.slice(0, 20)) });
  }
  return picked.value.id;
}

// 5. Attore: membro del workspace e utente Lateral Space.
async function checkActor(workspaceId: string): Promise<void> {
  const rows = await one(
    toStatement(ucSql`SELECT 1 AS ok FROM workspaces w
WHERE w.id = ${cast(workspaceId, "uuid")}
  AND (EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = w.organization_id AND m.user_id = ${cast(actor, "uuid")})
    OR EXISTS (SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.user_id = ${cast(actor, "uuid")} AND wm.role <> 'learner'))`),
  );
  if (!rows[0]) fail("attore_non_membro", "L'attore non è membro del workspace (i partecipanti ai corsi non contano).");
  const user = await loadUserContext(executor, actor!, lsDomains);
  if (!user || !user.isLateralSpace) fail("attore_non_ls", "L'attore deve essere un utente Lateral Space con email verificata.");
}

// 6. Sovrapposizione del seed in un solo batch (una transazione).
function overlayStatements(plan: SeedPlan, workspaceId: string, caseId: string, personal: { id: string; itemKey: string; sealed: Buffer }[]): UcStatement[] {
  const c = cast(caseId, "uuid");
  const ev: EventActor = { type: "utente", userId: actor! };
  const stmts: UcStatement[] = [];

  // Il caso non deve avere già un seed applicato.
  stmts.push(
    toStatement(
      requireRows(
        ucSql`UPDATE uc_cases SET
  status = ${cast(plan.case.status, "text")},
  status_changed_at = now(),
  title = ${cast(plan.case.title, "text")},
  one_liner = ${cast(plan.case.one_liner, "text")},
  perimeter_label = ${cast(plan.case.perimeter_label, "text")},
  client_owner_role_label = ${cast(plan.case.client_owner_role_label, "text")},
  contract_refs = ${jsonb(plan.case.contract_refs)},
  data_controller_label = NULL,
  description = ${jsonb(plan.case.description)},
  settings = settings || ${jsonb({
    role_labels: plan.case.settings.role_labels,
    seed: { hash: plan.seedHash, scan_report_sha256: plan.case.settings.seed.scan_report_sha256, applied_at: new Date().toISOString() },
  })},
  updated_at = now()
WHERE id = ${c} AND workspace_id = ${cast(workspaceId, "uuid")} AND setup_completed_at IS NOT NULL AND NOT (settings ? 'seed')
RETURNING id`,
        1,
        "seed_gia_applicato",
      ),
    ),
  );

  // Stati delle domande, scritti come import.
  stmts.push(
    toStatement(ucSql`UPDATE uc_items i SET status = x.status, status_reason = x.status_reason, status_changed_at = now(), updated_at = now()
FROM jsonb_to_recordset(${jsonb(plan.items.map((it) => ({ key: it.key, status: it.status, status_reason: it.status_reason })))}) AS x(key text, status text, status_reason text)
WHERE i.case_id = ${c} AND i.key = x.key AND i.kind = 'domanda'
  AND (i.status IS DISTINCT FROM x.status OR i.status_reason IS DISTINCT FROM x.status_reason)`),
  );

  // Valori dichiarati nelle call: risposta v1, una sola per voce.
  if (plan.answers.length) {
    stmts.push(
      toStatement(ucSql`WITH x AS (
  SELECT * FROM jsonb_to_recordset(${jsonb(plan.answers.map((a) => ({ item_key: a.item_key, value: a.value, source_ref: a.source_ref })))}) AS x(item_key text, value jsonb, source_ref text)
), ins AS (
  INSERT INTO uc_answers (case_id, item_id, version, kind, value, value_normalized, confidence, source_kind, source_ref, responder_user_id)
  SELECT ${c}, i.id, 1, 'valore', x.value, NULL, 'da_verificare', 'dichiarato_in_call', x.source_ref, NULL
  FROM x JOIN uc_items i ON i.case_id = ${c} AND i.key = x.item_key
  WHERE NOT EXISTS (SELECT 1 FROM uc_answers a WHERE a.item_id = i.id AND a.source_kind = 'dichiarato_in_call')
  RETURNING id, item_id
)
UPDATE uc_items u SET current_answer_id = ins.id, updated_at = now() FROM ins WHERE u.id = ins.item_id AND u.case_id = ${c}`),
    );
  }

  // Valori personali: solo cifrati (A.8 sciolta e chiave presente, verificato prima).
  for (const p of personal) {
    stmts.push(
      toStatement(ucSql`WITH ins AS (
  INSERT INTO uc_answers (id, case_id, item_id, version, kind, value, value_encrypted, confidence, source_kind, source_ref)
  SELECT ${cast(p.id, "uuid")}, ${c}, i.id, 1, 'valore', NULL, decode(${cast(p.sealed.toString("base64"), "text")}, 'base64'), 'da_verificare', 'dichiarato_in_call', NULL
  FROM uc_items i WHERE i.case_id = ${c} AND i.key = ${cast(p.itemKey, "text")}
    AND NOT EXISTS (SELECT 1 FROM uc_answers a WHERE a.item_id = i.id AND a.source_kind = 'dichiarato_in_call')
  RETURNING id, item_id
)
UPDATE uc_items u SET current_answer_id = ins.id, updated_at = now() FROM ins WHERE u.id = ins.item_id`),
    );
  }

  // Mappe: nuova versione corrente per tipo.
  for (const m of plan.maps) {
    const kind = cast(m.kind, "text");
    stmts.push(toStatement(ucSql`UPDATE uc_maps SET is_current = false WHERE case_id = ${c} AND kind = ${kind} AND is_current`));
    stmts.push(
      toStatement(ucSql`INSERT INTO uc_maps (case_id, version, kind, title, graph, source, is_current, created_by_user_id)
SELECT ${c}, COALESCE(MAX(version), 0) + 1, ${kind}, ${cast(m.title, "text")}, ${jsonb(m.graph)}, ${cast(m.source, "text")}, true, ${cast(actor, "uuid")}
FROM uc_maps WHERE case_id = ${c} AND kind = ${kind}`),
    );
  }

  // ROI: modello di stima.
  const r = plan.roi;
  stmts.push(
    toStatement(ucSql`INSERT INTO uc_roi_models (case_id, version, status, scenario, currency, horizon_years, includes_human_review_time, cost_lines, benefit_lines, content)
SELECT ${c}, COALESCE(MAX(version), 0) + 1, ${cast(r.status, "text")}, ${cast(r.scenario, "text")}, ${cast(r.currency, "text")}, ${cast(r.horizon_years, "int")},
  ${cast(r.includes_human_review_time, "boolean")}, ${jsonb(r.cost_lines)}, ${jsonb(r.benefit_lines)}, ${jsonb(r.content)}
FROM uc_roi_models WHERE case_id = ${c} AND scenario = ${cast(r.scenario, "text")}`),
  );

  // Milestone.
  if (plan.milestones.length) {
    stmts.push(
      toStatement(ucSql`INSERT INTO uc_milestones (case_id, key, title, planned_label, is_proposal, to_confirm, notes, sort_order)
SELECT ${c}, x.key, x.title, x.planned_label, x.is_proposal, x.to_confirm, x.notes, x.sort_order
FROM jsonb_to_recordset(${jsonb(plan.milestones)}) AS x(key text, title text, planned_label text, is_proposal boolean, to_confirm boolean, notes text, sort_order int)
ON CONFLICT (case_id, key) DO NOTHING`),
    );
  }

  // Blocchi: aperto → attivo, sanitario → permanente (solo da attivo, mai riaprendo uno sciolto).
  stmts.push(
    toStatement(ucSql`UPDATE uc_blockers b SET status = x.status, updated_at = now()
FROM jsonb_to_recordset(${jsonb(plan.blockers)}) AS x(key text, status text)
WHERE b.case_id = ${c} AND b.key = x.key AND b.status = 'attivo' AND x.status <> b.status`),
  );

  // Eventi aggregati (solo conteggi, codici e impronte).
  for (const e of plan.events) {
    stmts.push(toStatement(eventInsertSql({ type: e.type, workspaceId, caseId, actor: ev, targetType: "caso", targetId: caseId, payload: e.payload })));
  }
  return stmts;
}

// 7. Conteggi nel database.
async function countsInDatabase(caseId: string) {
  const c = cast(caseId, "uuid");
  const [byStatus, answers, maps, roi, milestones, blockers, items] = await executor.batch([
    toStatement(ucSql`SELECT status, count(*)::int AS n FROM uc_items WHERE case_id = ${c} AND kind = 'domanda' AND deleted_at IS NULL GROUP BY status`),
    toStatement(ucSql`SELECT count(*)::int AS n, count(*) FILTER (WHERE value_encrypted IS NOT NULL)::int AS encrypted FROM uc_answers WHERE case_id = ${c} AND source_kind = 'dichiarato_in_call'`),
    toStatement(ucSql`SELECT kind, count(*)::int AS n FROM uc_maps WHERE case_id = ${c} AND is_current GROUP BY kind`),
    toStatement(ucSql`SELECT count(*)::int AS n FROM uc_roi_models WHERE case_id = ${c}`),
    toStatement(ucSql`SELECT count(*)::int AS n, count(*) FILTER (WHERE is_proposal)::int AS proposals, count(*) FILTER (WHERE to_confirm)::int AS to_confirm FROM uc_milestones WHERE case_id = ${c}`),
    toStatement(ucSql`SELECT status, count(*)::int AS n FROM uc_blockers WHERE case_id = ${c} GROUP BY status`),
    toStatement(ucSql`SELECT count(*)::int AS items, (SELECT count(*)::int FROM uc_item_links WHERE case_id = ${c}) AS links FROM uc_items WHERE case_id = ${c} AND deleted_at IS NULL`),
  ]);
  const tally = (rows: Record<string, unknown>[], key: string) => Object.fromEntries(rows.map((r) => [String(r[key]), Number(r.n)]));
  return {
    questions: tally(byStatus, "status"),
    answers: { total: Number(answers[0]?.n ?? 0), encrypted: Number(answers[0]?.encrypted ?? 0) },
    maps: tally(maps, "kind"),
    roi_models: Number(roi[0]?.n ?? 0),
    milestones: { total: Number(milestones[0]?.n ?? 0), proposals: Number(milestones[0]?.proposals ?? 0), to_confirm: Number(milestones[0]?.to_confirm ?? 0) },
    blockers: tally(blockers, "status"),
    items: Number(items[0]?.items ?? 0),
    links: Number(items[0]?.links ?? 0),
  };
}

function checkCounts(plan: SeedPlan, got: Awaited<ReturnType<typeof countsInDatabase>>): string[] {
  const problems: string[] = [];
  for (const [state, n] of Object.entries(plan.counts.by_state)) {
    if ((got.questions[state] ?? 0) !== n) problems.push(`domande ${state}: attese ${n}, trovate ${got.questions[state] ?? 0}`);
  }
  const expectedAnswers = plan.counts.answers.total + plan.personalAnswers.length;
  if (got.answers.total !== expectedAnswers) problems.push(`risposte dichiarate: attese ${expectedAnswers}, trovate ${got.answers.total}`);
  for (const m of plan.maps) if ((got.maps[m.kind] ?? 0) !== 1) problems.push(`mappa ${m.kind}: manca la versione corrente`);
  if (got.milestones.total !== plan.counts.milestones.total) problems.push(`milestone: attese ${plan.counts.milestones.total}, trovate ${got.milestones.total}`);
  if ((got.blockers.attivo ?? 0) !== plan.counts.blockers.attivo) problems.push(`blocchi attivi: attesi ${plan.counts.blockers.attivo}, trovati ${got.blockers.attivo ?? 0}`);
  if ((got.blockers.permanente ?? 0) !== plan.counts.blockers.permanente) problems.push(`blocchi permanenti: attesi ${plan.counts.blockers.permanente}, trovati ${got.blockers.permanente ?? 0}`);
  if (got.roi_models < 1) problems.push("ROI: manca il modello di stima");
  return problems;
}

/** La scheda madre del caso, come `use-case-admin dossier-links`. `$1` caso, `$2` nuova scheda. */
const CREATE_AND_LINK_MOTHER_SQL = `WITH c AS (
  SELECT id, workspace_id, coalesce(nullif(btrim(title), ''), code) AS title, nullif(btrim(one_liner), '') AS one_liner FROM uc_cases
   WHERE id = $1::uuid AND setup_completed_at IS NOT NULL AND portfolio_use_case_id IS NULL
   FOR UPDATE
), card AS (
  INSERT INTO use_cases (id, workspace_id, title, description, portfolio_kind, status, origin, source, intake, proposed_by)
  SELECT $2::uuid, c.workspace_id, c.title, c.one_liner, '${MOTHER_CARD.portfolioKind}', '${MOTHER_CARD.status}', '${MOTHER_CARD.origin}', '${MOTHER_CARD.source}',
         '${JSON.stringify(MOTHER_CARD.intake)}'::jsonb, NULL
    FROM c
  RETURNING id
)
UPDATE uc_cases u
   SET portfolio_use_case_id = card.id, updated_at = now()
  FROM card
 WHERE u.id = $1::uuid
RETURNING card.id::text AS use_case_id`;

/**
 * Collega il caso alla sua scheda madre (P0-16 d): la crea se manca, con il codice. null senza
 * la 0020 (la scheda usa `origin`); `{ created: false }` se il caso ha già una scheda.
 */
async function linkMotherCard(workspaceId: string, caseId: string): Promise<{ created: boolean; use_case_id: string; code: string | null } | null> {
  const facts = schemaFactsFrom((await one({ text: SCHEMA_FACTS_SQL, params: [] }))[0]);
  if (!facts.m0020) return null;
  const linkedSql = toStatement(ucSql`SELECT c.portfolio_use_case_id::text AS use_case_id, u.code
    FROM uc_cases c LEFT JOIN use_cases u ON u.id = c.portfolio_use_case_id
   WHERE c.id = ${cast(caseId, "uuid")}`);
  const linked = (await one(linkedSql))[0];
  if (linked?.use_case_id) return { created: false, use_case_id: String(linked.use_case_id), code: typeof linked.code === "string" ? linked.code : null };
  const useCaseId = randomUUID();
  const [link = [], code = []] = await executor.batch([
    { text: CREATE_AND_LINK_MOTHER_SQL, params: [caseId, useCaseId] },
    { text: ASSIGN_USE_CASE_CODE_SQL, params: [workspaceId, useCaseId] },
  ]);
  if (link.length === 0) fail("scheda_madre", "Il caso non è completo o ha già una scheda: rilancia lo script.");
  return { created: true, use_case_id: useCaseId, code: typeof code[0]?.code === "string" ? code[0].code : null };
}

async function main() {
  // Il template viene dal database (caricato prima con il loader), non dal file.
  const workspaceId = workspaceOption ?? (await findWorkspace(workspaceSearch(seed.workspace_hint)));
  await checkActor(workspaceId);

  const template = await getTemplateForCase(executor, workspaceId, { key: templateKey, version: templateVersion });
  if (!template.ok) fail(template.code, template.code === "template_non_trovato" ? "Carica prima il template con scripts/uc-load-template.ts." : template.message);
  if (!template.value.restricted) fail("template_non_riservato", "Il template del caso reale deve essere riservato a questo workspace.");

  const plan = planSeed(seed, template.value.definition, planOptions());
  if (!plan.ok) fail("seed_non_valido", "Il piano del seed ha errori.", { errors: plan.errors });
  if (plan.scan.applyBlocked) {
    fail("scansione_da_approvare", "La scansione ha trovato testi da approvare: rileggi il report e rilancia con --accept-scan <sha256>.", {
      report_sha256: plan.scan.sha256,
      entries: plan.scan.report.entries.filter((e) => e.trattiene),
    });
  }

  // Caso già presente?
  const existing = (
    await one(
      toStatement(ucSql`SELECT id::text AS id, setup_completed_at IS NOT NULL AS complete, settings -> 'seed' ->> 'hash' AS seed_hash,
  (SELECT count(*)::int FROM uc_requests r WHERE r.case_id = c.id) AS requests,
  (SELECT count(*)::int FROM uc_answers a WHERE a.case_id = c.id AND a.source_kind <> 'dichiarato_in_call') AS other_answers
FROM uc_cases c WHERE workspace_id = ${cast(workspaceId, "uuid")} AND code = ${cast(plan.case.code, "text")}`),
    )
  )[0];

  let caseId: string;
  if (existing && existing.seed_hash === plan.seedHash) {
    const got = await countsInDatabase(String(existing.id));
    const motherCard = await linkMotherCard(workspaceId, String(existing.id));
    console.log(JSON.stringify({ status: "ALREADY_SEEDED", case_id: existing.id, code: plan.case.code, counts_now: got, mother_card: motherCard }, null, 2));
    return;
  }
  if (existing && existing.seed_hash) fail("seed_diverso", "Il caso esiste già con un seed diverso: lo script non sovrascrive.");
  if (existing) {
    // Ripresa di una sovrapposizione interrotta: solo su un caso ancora intatto.
    if (!existing.complete || Number(existing.requests) > 0 || Number(existing.other_answers) > 0) {
      fail("caso_gia_usato", "Il caso esiste già e non è più nello stato iniziale (richieste o risposte presenti): lo script si ferma.");
    }
    caseId = String(existing.id);
  } else {
    const created = await createCaseFromTemplate(executor, {
      workspaceId,
      template: { templateId: template.value.id },
      actorUserId: actor!,
      code: plan.case.code,
      title: plan.case.title,
      oneLiner: plan.case.one_liner,
      perimeterLabel: plan.case.perimeter_label,
      description: plan.case.description,
    });
    if (!created.ok) fail(created.code, created.message);
    caseId = created.value.caseId;
  }

  // Valori personali: solo con A.8 sciolta e chiave presente.
  const personal: { id: string; itemKey: string; sealed: Buffer }[] = [];
  if (includePersonal && plan.personalAnswers.length) {
    const a8 = (await one(toStatement(ucSql`SELECT status FROM uc_blockers WHERE case_id = ${cast(caseId, "uuid")} AND key = 'a8'`)))[0];
    if (!a8 || a8.status !== "sciolto") fail("a8_aperta", "I valori personali si caricano solo dopo lo scioglimento della scheda A.8.");
    const kek = deriveWorkspaceKek(process.env.UC_PERSONAL_ZONE_KEY, workspaceId);
    if (!kek.ok) fail(kek.code, kek.message);
    for (const p of plan.personalAnswers) {
      const id = randomUUID();
      personal.push({ id, itemKey: p.item_key, sealed: sealJson(kek.value, p.value, envelopeAad({ workspaceId, caseId, objectId: id })) });
    }
  }

  await executor
    .batch(overlayStatements(plan, workspaceId, caseId, personal))
    .catch((error: unknown) => fail("sovrapposizione_fallita", error instanceof Error ? error.message.replace(/^uc:/, "") : "Errore del database."));
  await refreshReadinessCache(executor, workspaceId, caseId);
  const motherCard = await linkMotherCard(workspaceId, caseId);

  const got = await countsInDatabase(caseId);
  const problems = checkCounts(plan, got);
  console.log(
    JSON.stringify(
      {
        status: problems.length ? "SEEDED_WITH_MISMATCHES" : "SEEDED",
        environment,
        database: fingerprint,
        case_id: caseId,
        code: plan.case.code,
        expected: plan.counts,
        counts_now: got,
        problems,
        mother_card: motherCard,
        scan_report_sha256: plan.scan.sha256,
      },
      null,
      2,
    ),
  );
  if (problems.length) process.exit(1);
}

await main();
