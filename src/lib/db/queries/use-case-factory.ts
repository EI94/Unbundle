import "server-only";
/**
 * L'Agent Factory in Unbundle (rilascio 8.0a, docs/rilascio-8/RILASCIO-8.0-PIANO.md §2): letture e scritture di
 * pacchetto, progetto e decisioni di uno use case (drizzle/0030).
 *
 * - Ogni funzione prende l'esecutore (`UcExecutor`: lo stesso database, una transazione per batch) e chi agisce,
 *   con i suoi ruoli di caso già riletti da `openUcCase`. I permessi sono in `use-cases/factory/permissions.ts`.
 * - Nessuna scrittura cambia una riga di un altro use case o di un altro workspace: ogni WHERE porta tutti e due.
 * - I testi scritti dal team (scelte, decisioni, note) passano da `checkLsText`, come gli altri testi di Lateral
 *   Space: niente dati sanitari, discriminatori o personali.
 * - Le notifiche vanno nella campanella dello use case (`use_case_notifications`), una riga per persona, use case,
 *   tipo e giorno, come le altre; mai a chi ha fatto l'azione.
 */
import type { UcExecutor, UcRow } from "@/lib/db/uc-executor";
import {
  FACTORY_FRAMEWORKS,
  FACTORY_LIMITS,
  FACTORY_PROBE_SQL,
  SETUP_TOPICS,
  SETUP_TOPIC_LABELS,
  type FactoryFramework,
  type PackageFile,
  type PackageSource as PackageOrigin,
  type ProjectNewTool,
  type ProjectStatus,
  type ProjectTopics,
  type SetupTopic,
} from "@/lib/db/use-case-hub-factory-ddl";
import { checkLsText } from "@/lib/db/queries/uc-cases";
import { cast, jsonb, raw, toStatement, ucSql, type UcStatement } from "@/lib/uc/sql/statement";
import { fail, ok, type Result } from "@/lib/uc/types";
import type { CaseRole } from "@/lib/uc/vocab";
import { packageContent, packageFiles, packageFilesHash, packageHash, type PackageSource } from "@/lib/use-cases/factory/package";
import { aiBoardOkRule, AI_BOARD_NOTE_MIN, canApproveProject, canReadFactory, canWriteFactory, FACTORY_RECIPIENTS } from "@/lib/use-cases/factory/permissions";
import { isNeedDone, needStatusView, type NeedStatus, type NeedType } from "@/lib/use-cases/needs";
import { romeToday } from "@/lib/use-cases/quarter";

// ─── Chi agisce ──────────────────────────────────────────────────────

/** Una persona con i suoi ruoli di caso, oppure uno script di Lateral Space (l'import), con il suo ruolo a parole. */
export type FactoryActor = { kind: "persona"; userId: string; roles: readonly CaseRole[] } | { kind: "script"; authorRole: string };

/** Lo use case e il workspace su cui si lavora. */
export interface FactoryTarget {
  workspaceId: string;
  useCaseId: string;
}

const DENIED = "Non hai i permessi per questa azione nell'impostazione del caso.";

function userOf(actor: FactoryActor): string | null {
  return actor.kind === "persona" ? actor.userId : null;
}

function mayWrite(actor: FactoryActor): boolean {
  return actor.kind === "script" || canWriteFactory(actor.roles);
}

// ─── Sonda ───────────────────────────────────────────────────────────

/** Vero se la 0030 è applicata (la stessa sonda di `ensureDbSchema`). */
export async function factoryStoreReady(executor: UcExecutor): Promise<boolean> {
  try {
    const [rows] = await executor.batch([toStatement(ucSql`SELECT ${raw(FACTORY_PROBE_SQL)} AS ready`)]);
    return rows[0]?.ready === true;
  } catch {
    return false;
  }
}

/** Lo use case di un dossier del workspace, o null. */
export async function findUseCaseOfCase(executor: UcExecutor, workspaceId: string, caseId: string): Promise<{ useCaseId: string; code: string | null; title: string } | null> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT u.id, u.code, u.title FROM uc_cases c JOIN use_cases u ON u.id = c.portfolio_use_case_id AND u.workspace_id = c.workspace_id
WHERE c.id = ${cast(caseId, "uuid")} AND c.workspace_id = ${cast(workspaceId, "uuid")}`),
  ]);
  const row = rows[0];
  return row ? { useCaseId: String(row.id), code: row.code === null ? null : String(row.code), title: String(row.title ?? "") } : null;
}

// ─── Letture ─────────────────────────────────────────────────────────

export interface PackageSummary {
  version: number;
  source: PackageOrigin;
  createdAt: string;
  contentHash: string;
}

export interface ProjectView {
  id: string;
  version: number;
  status: ProjectStatus;
  topics: ProjectTopics;
  framework: FactoryFramework | null;
  newTools: ProjectNewTool[];
  estimateHours: number | null;
  monthlyCostEur: number | null;
  standardVersion: string | null;
  catalogVersion: string | null;
  packageVersion: number | null;
  submittedAt: string | null;
  approvedAt: string | null;
  aiBoardOkAt: string | null;
  aiBoardNote: string | null;
  updatedAt: string;
}

export interface DecisionView {
  id: string;
  decidedOn: string;
  topicKey: SetupTopic | null;
  topic: string;
  choice: string;
  reason: string | null;
  rejected: string | null;
  source: "impostazione" | "team" | "importata";
  projectVersion: number | null;
  /** Il ruolo a parole («responsabile del caso») quando la decisione viene da un import; null per una persona. */
  authorRole: string | null;
  createdAt: string;
}

export interface FactoryView {
  packages: PackageSummary[];
  latestPackage: { version: number; files: Record<PackageFile, string>; createdAt: string; source: PackageOrigin } | null;
  /** La versione in corso o da approvare, se c'è. */
  open: ProjectView | null;
  /** L'ultima approvata, se c'è. */
  approved: ProjectView | null;
  decisions: DecisionView[];
}

const iso = (value: unknown): string | null => (value === null || value === undefined ? null : new Date(String(value)).toISOString());
const num = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

function projectFrom(row: UcRow): ProjectView {
  return {
    id: String(row.id),
    version: Number(row.version),
    status: String(row.status) as ProjectStatus,
    topics: (row.topics ?? {}) as ProjectTopics,
    framework: (text(row.framework) as FactoryFramework | null) ?? null,
    newTools: Array.isArray(row.new_tools) ? (row.new_tools as ProjectNewTool[]) : [],
    estimateHours: num(row.estimate_hours),
    monthlyCostEur: num(row.monthly_cost_eur),
    standardVersion: text(row.standard_version),
    catalogVersion: text(row.catalog_version),
    packageVersion: num(row.package_version),
    submittedAt: iso(row.submitted_at),
    approvedAt: iso(row.approved_at),
    aiBoardOkAt: iso(row.ai_board_ok_at),
    aiBoardNote: text(row.ai_board_note),
    updatedAt: iso(row.updated_at) ?? "",
  };
}

const PROJECT_COLUMNS = raw(
  "id, version, status, topics, framework, new_tools, estimate_hours, monthly_cost_eur, standard_version, catalog_version, package_version, submitted_at, approved_at, ai_board_ok_at, ai_board_note, updated_at",
);

/** Tutto quello che la scheda «Impostazione» e `unbundle context` mostrano di uno use case. */
export async function readFactory(executor: UcExecutor, target: FactoryTarget, actor: FactoryActor): Promise<Result<FactoryView>> {
  if (actor.kind === "persona" && !canReadFactory(actor.roles)) return fail("permesso_negato", DENIED);
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const [packages, latest, projects, decisions] = await executor.batch([
    toStatement(ucSql`SELECT version, source, created_at, content_hash FROM use_case_packages WHERE workspace_id = ${ws} AND use_case_id = ${uc} ORDER BY version DESC LIMIT 50`),
    toStatement(ucSql`SELECT version, files, created_at, source FROM use_case_packages WHERE workspace_id = ${ws} AND use_case_id = ${uc} ORDER BY version DESC LIMIT 1`),
    toStatement(ucSql`SELECT ${PROJECT_COLUMNS} FROM use_case_projects WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status IN ('in_corso', 'da_approvare', 'approvato') ORDER BY version DESC`),
    toStatement(ucSql`SELECT id, decided_on, topic_key, topic, choice, reason, rejected, source, project_version, author_role, created_at
FROM use_case_decisions WHERE workspace_id = ${ws} AND use_case_id = ${uc} ORDER BY decided_on DESC, created_at DESC LIMIT 200`),
  ]);
  const views = projects.map(projectFrom);
  const last = latest[0];
  return ok({
    packages: packages.map((r) => ({ version: Number(r.version), source: String(r.source) as PackageOrigin, createdAt: iso(r.created_at) ?? "", contentHash: String(r.content_hash) })),
    latestPackage: last ? { version: Number(last.version), files: last.files as Record<PackageFile, string>, createdAt: iso(last.created_at) ?? "", source: String(last.source) as PackageOrigin } : null,
    open: views.find((p) => p.status === "in_corso" || p.status === "da_approvare") ?? null,
    approved: views.find((p) => p.status === "approvato") ?? null,
    decisions: decisions.map((r) => ({
      id: String(r.id),
      decidedOn: String(r.decided_on).slice(0, 10),
      topicKey: (text(r.topic_key) as SetupTopic | null) ?? null,
      topic: String(r.topic),
      choice: String(r.choice),
      reason: text(r.reason),
      rejected: text(r.rejected),
      source: String(r.source) as DecisionView["source"],
      projectVersion: num(r.project_version),
      authorRole: text(r.author_role),
      createdAt: iso(r.created_at) ?? "",
    })),
  });
}

// ─── Notifiche ───────────────────────────────────────────────────────

type FactoryNoticeKind = keyof typeof FACTORY_RECIPIENTS;

/** Una riga nella campanella per ogni persona del team con uno dei ruoli del tipo, mai a chi ha agito. */
function noticeSql(target: FactoryTarget, kind: FactoryNoticeKind, actor: FactoryActor, now: Date): UcStatement {
  return toStatement(ucSql`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day)
SELECT DISTINCT c.workspace_id, c.portfolio_use_case_id, m.user_id, ${cast(kind, "text")}, ${cast(romeToday(now), "date")}
FROM uc_cases c JOIN uc_case_members m ON m.case_id = c.id
WHERE c.workspace_id = ${cast(target.workspaceId, "uuid")} AND c.portfolio_use_case_id = ${cast(target.useCaseId, "uuid")}
  AND m.role = ANY (${cast([...FACTORY_RECIPIENTS[kind]], "text[]")})
  AND m.user_id IS DISTINCT FROM ${cast(userOf(actor), "uuid")}
ON CONFLICT (recipient_user_id, use_case_id, kind, rome_day) DO UPDATE SET last_event_at = now(), read_at = NULL`);
}

/** L'email della coda dei dossier per ogni tipo: interna di Lateral Space (all'AI Board del cliente dalla 8.0c). */
const FACTORY_EMAIL: Readonly<Record<FactoryNoticeKind, { template: string; roles: readonly CaseRole[] }>> = Object.freeze({
  progetto_appr: { template: "progetto_da_approvare", roles: ["ls_lead"] },
  strumento_nuovo: { template: "strumento_da_approvare", roles: ["ls_lead"] },
  pacchetto_nuovo: { template: "pacchetto_aggiornato", roles: ["ls_lead", "ls_analista", "ls_sviluppatore"] },
});

/**
 * Un'email in coda (`uc_notifications`, canale email) per ogni persona di Lateral Space del team con il ruolo del
 * tipo, mai a chi ha agito; al massimo una al giorno per persona, caso e tipo (la chiave di deduplica). La manda il
 * motore dei dossier dopo il comando (`finishUcCommand`) o il cron, che controlla anche che sia di Lateral Space.
 */
function emailSql(target: FactoryTarget, kind: FactoryNoticeKind, actor: FactoryActor, now: Date, version: number): UcStatement {
  const e = FACTORY_EMAIL[kind];
  return toStatement(ucSql`INSERT INTO uc_notifications (workspace_id, case_id, recipient_user_id, channel, template_key, payload, status, dedupe_key, scheduled_at)
SELECT DISTINCT ON (m.user_id) c.workspace_id, c.id, m.user_id, 'email', ${cast(e.template, "text")}, ${jsonb({ version })}, 'in_coda',
       ${cast(e.template, "text")} || ':' || c.id::text || ':' || m.user_id::text || ':' || ${cast(romeToday(now), "text")}, now()
FROM uc_cases c JOIN uc_case_members m ON m.case_id = c.id
WHERE c.workspace_id = ${cast(target.workspaceId, "uuid")} AND c.portfolio_use_case_id = ${cast(target.useCaseId, "uuid")}
  AND m.role = ANY (${cast([...e.roles], "text[]")})
  AND m.user_id IS DISTINCT FROM ${cast(userOf(actor), "uuid")}
ON CONFLICT (dedupe_key) DO NOTHING`);
}

// ─── Il pacchetto ────────────────────────────────────────────────────

/** L'impronta di un pacchetto importato: la stessa di `packageFilesHash`. */
export const importedPackageHash = packageFilesHash;

/**
 * Salva una versione del pacchetto se il contenuto è cambiato. Con lo stesso contenuto dell'ultima versione non
 * scrive niente e risponde con quella (`created: false`). Notifica chi costruisce.
 */
export async function savePackageVersion(
  executor: UcExecutor,
  actor: FactoryActor,
  target: FactoryTarget,
  input: { generated: PackageSource } | { imported: Record<PackageFile, string> },
  now = new Date(),
): Promise<Result<{ version: number; created: boolean }>> {
  if (!mayWrite(actor)) return fail("permesso_negato", DENIED);
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const [last] = await executor.batch([toStatement(ucSql`SELECT version, content_hash FROM use_case_packages WHERE workspace_id = ${ws} AND use_case_id = ${uc} ORDER BY version DESC LIMIT 1`)]);
  const lastVersion = last[0] ? Number(last[0].version) : 0;
  const version = lastVersion + 1;
  let files: Record<PackageFile, string>;
  let hash: string;
  let source: PackageOrigin;
  if ("generated" in input) {
    const content = packageContent(input.generated);
    hash = packageHash(content);
    files = packageFiles(input.generated, { version, day: romeToday(now) }, content);
    source = "generato";
  } else {
    files = input.imported;
    hash = importedPackageHash(files);
    source = "importato";
  }
  const [same] = await executor.batch([toStatement(ucSql`SELECT version FROM use_case_packages WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND content_hash = ${cast(hash, "text")}`)]);
  if (same[0]) return ok({ version: Number(same[0].version), created: false });
  if (Buffer.byteLength(JSON.stringify(files), "utf8") > FACTORY_LIMITS.packageBytesMax) return fail("pacchetto_troppo_grande", "Il pacchetto supera i 200 KB: accorcia i testi della scheda.");
  const rows = await executor.batch([
    toStatement(ucSql`INSERT INTO use_case_packages (use_case_id, workspace_id, version, content_hash, files, source, created_by_user_id)
SELECT ${uc}, ${ws}, ${cast(version, "int")}, ${cast(hash, "text")}, ${jsonb(files)}, ${cast(source, "text")}, ${cast(userOf(actor), "uuid")}
WHERE EXISTS (SELECT 1 FROM use_cases WHERE id = ${uc} AND workspace_id = ${ws})
RETURNING version`),
    noticeSql(target, "pacchetto_nuovo", actor, now),
    emailSql(target, "pacchetto_nuovo", actor, now, version),
  ]);
  if (!rows[0][0]) return fail("non_trovato", "Use case non trovato.");
  return ok({ version, created: true });
}

/** Quello che il pacchetto prende dalla scheda: lo legge chi chiama, con i permessi di chi guarda. */
export type PackageCard = Omit<PackageSource, "answers" | "openNeeds" | "namesToHide">;

/**
 * Il resto del pacchetto, dal database: le risposte inviate del referente (la domanda è il titolo dell'esigenza),
 * le esigenze ancora aperte di «Cosa serve», e i nomi da coprire (persone del workspace e della sua
 * organizzazione, contatti, chi ha chiesto le informazioni al referente).
 */
export async function packageSourceFor(executor: UcExecutor, target: FactoryTarget, card: PackageCard): Promise<PackageSource> {
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const [answers, needs, names] = await executor.batch([
    toStatement(ucSql`SELECT n.title, a.body, a.submitted_at, n.type, n.status
FROM use_case_need_answers a JOIN use_case_needs n ON n.id = a.need_id AND n.workspace_id = a.workspace_id
WHERE a.workspace_id = ${ws} AND a.use_case_id = ${uc} AND a.status = 'inviata' AND a.removed_at IS NULL AND a.body IS NOT NULL AND NOT a.dont_know
ORDER BY a.submitted_at NULLS LAST, a.id LIMIT 30`),
    toStatement(ucSql`SELECT n.title, n.type, n.status FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id
WHERE l.use_case_id = ${uc} AND n.workspace_id = ${ws} AND n.archived_at IS NULL
ORDER BY n.type, n.sort_order, n.created_at, n.id LIMIT 80`),
    toStatement(ucSql`SELECT DISTINCT x.name FROM (
  SELECT u.name FROM users u JOIN workspace_memberships wm ON wm.user_id = u.id WHERE wm.workspace_id = ${ws}
  UNION SELECT u.name FROM users u JOIN memberships m ON m.user_id = u.id JOIN workspaces w ON w.organization_id = m.organization_id WHERE w.id = ${ws}
  UNION SELECT c.display_name FROM uc_contacts c WHERE c.workspace_id = ${ws}
  UNION SELECT r.requester_name FROM use_case_referent_requests r WHERE r.workspace_id = ${ws} AND r.use_case_id = ${uc}
) x WHERE x.name IS NOT NULL`),
  ]);
  const label = (type: unknown, status: unknown) => needStatusView(String(type) as NeedType, String(status) as NeedStatus).label.toLowerCase();
  return {
    ...card,
    answers: answers.map((r) => ({ question: String(r.title), answer: String(r.body), on: r.submitted_at ? new Date(String(r.submitted_at)).toISOString().slice(0, 10) : null, status: label(r.type, r.status) })),
    openNeeds: needs
      .filter((r) => !isNeedDone(String(r.type) as NeedType, String(r.status) as NeedStatus))
      .slice(0, 40)
      .map((r) => ({ title: String(r.title), status: label(r.type, r.status) })),
    namesToHide: names.map((r) => String(r.name)),
  };
}

// ─── Il progetto ─────────────────────────────────────────────────────

const OPEN = raw("status IN ('in_corso', 'da_approvare')");

/** Apre una versione nuova del progetto, con le scelte dell'ultima (approvata o superata). Una sola aperta. */
export async function startProject(executor: UcExecutor, actor: FactoryActor, target: FactoryTarget): Promise<Result<{ version: number; created: boolean }>> {
  if (!mayWrite(actor)) return fail("permesso_negato", DENIED);
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const [open] = await executor.batch([toStatement(ucSql`SELECT version FROM use_case_projects WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND ${OPEN}`)]);
  if (open[0]) return ok({ version: Number(open[0].version), created: false });
  const [rows] = await executor.batch([
    toStatement(ucSql`INSERT INTO use_case_projects (use_case_id, workspace_id, version, topics, framework, new_tools, estimate_hours, monthly_cost_eur, standard_version, catalog_version, updated_by_user_id)
SELECT u.id, u.workspace_id, coalesce(p.version, 0) + 1, coalesce(p.topics, '{}'::jsonb), p.framework, coalesce(p.new_tools, '[]'::jsonb), p.estimate_hours, p.monthly_cost_eur,
       p.standard_version, p.catalog_version, ${cast(userOf(actor), "uuid")}
FROM use_cases u
LEFT JOIN LATERAL (SELECT * FROM use_case_projects x WHERE x.use_case_id = u.id ORDER BY x.version DESC LIMIT 1) p ON true
WHERE u.id = ${uc} AND u.workspace_id = ${ws}
RETURNING version`),
  ]);
  if (!rows[0]) return fail("non_trovato", "Use case non trovato.");
  return ok({ version: Number(rows[0].version), created: true });
}

/** Un testo del team: pulito, entro il limite, senza dati che non devono stare qui. null se vuoto. */
function teamText(value: unknown, max: number, label: string): Result<string | null> {
  if (value === null || value === undefined) return ok(null);
  if (typeof value !== "string") return fail("dati_non_validi", `${label}: serve un testo.`);
  const t = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!t) return ok(null);
  if (t.length > max) return fail("testo_troppo_lungo", `${label}: al massimo ${max} caratteri.`);
  const scan = checkLsText({ text: t });
  if (!scan.ok) return scan;
  return ok(t);
}

const TOPIC_LABELS = SETUP_TOPIC_LABELS;

export function topicLabel(topic: SetupTopic): string {
  return TOPIC_LABELS[topic];
}

/**
 * Salva la scelta di un argomento nella versione aperta e la registra come decisione dell'impostazione, nella
 * stessa transazione. Senza una versione aperta, o con la versione già da approvare, non scrive.
 */
export async function saveProjectTopic(
  executor: UcExecutor,
  actor: FactoryActor,
  target: FactoryTarget,
  input: { topic: unknown; scelta: unknown; perche?: unknown; alternativa?: unknown },
  now = new Date(),
): Promise<Result<{ version: number }>> {
  if (!mayWrite(actor)) return fail("permesso_negato", DENIED);
  const topic = SETUP_TOPICS.find((t) => t === input.topic);
  if (!topic) return fail("dati_non_validi", "Scegli uno dei 10 argomenti dell'impostazione.");
  const L = FACTORY_LIMITS;
  const scelta = teamText(input.scelta, L.choice, "La scelta");
  if (!scelta.ok) return scelta;
  if (!scelta.value) return fail("dati_non_validi", "Scrivi la scelta.");
  const perche = teamText(input.perche, L.reason, "Il perché");
  if (!perche.ok) return perche;
  const alternativa = teamText(input.alternativa, L.rejected, "L'alternativa scartata");
  if (!alternativa.ok) return alternativa;
  const choice = { scelta: scelta.value, perche: perche.value, alternativa: alternativa.value };
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const framework = topic === "framework" ? FACTORY_FRAMEWORKS.find((f) => scelta.value!.toLowerCase().startsWith(f.replace("_", " ")) || scelta.value!.toLowerCase() === f) ?? null : null;
  const [updated, inserted] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_projects SET topics = jsonb_set(topics, ${cast([topic], "text[]")}, ${jsonb(choice)}, true),
  framework = CASE WHEN ${cast(framework, "text")} IS NULL THEN framework ELSE ${cast(framework, "text")} END,
  updated_at = now(), updated_by_user_id = ${cast(userOf(actor), "uuid")}
WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'in_corso'
RETURNING version`),
    toStatement(ucSql`INSERT INTO use_case_decisions (use_case_id, workspace_id, decided_on, topic_key, topic, choice, reason, rejected, source, project_version, author_user_id, author_role)
SELECT p.use_case_id, p.workspace_id, ${cast(romeToday(now), "date")}, ${cast(topic, "text")}, ${cast(TOPIC_LABELS[topic], "text")}, ${cast(scelta.value, "text")},
       ${cast(perche.value, "text")}, ${cast(alternativa.value, "text")}, ${cast(actor.kind === "script" ? "importata" : "impostazione", "text")}, p.version,
       ${cast(userOf(actor), "uuid")}, ${cast(actor.kind === "script" ? actor.authorRole : null, "text")}
FROM use_case_projects p WHERE p.workspace_id = ${ws} AND p.use_case_id = ${uc} AND p.status = 'in_corso'
RETURNING id`),
  ]);
  if (!updated[0] || !inserted[0]) return fail("progetto_non_aperto", "Il progetto non è in corso: apri una versione nuova per cambiarlo.");
  return ok({ version: Number(updated[0].version) });
}

/** Framework, strumenti nuovi e stima della versione aperta. Quello che non arriva resta com'è. */
export async function saveProjectDetails(
  executor: UcExecutor,
  actor: FactoryActor,
  target: FactoryTarget,
  input: { framework?: unknown; newTools?: unknown; estimateHours?: unknown; monthlyCostEur?: unknown; standardVersion?: unknown; catalogVersion?: unknown; packageVersion?: unknown },
): Promise<Result<{ version: number }>> {
  if (!mayWrite(actor)) return fail("permesso_negato", DENIED);
  const L = FACTORY_LIMITS;
  const sets: ReturnType<typeof ucSql>[] = [];
  if (input.framework !== undefined) {
    const f = input.framework === null ? null : FACTORY_FRAMEWORKS.find((x) => x === input.framework);
    if (input.framework !== null && !f) return fail("dati_non_validi", "Il framework non è nel catalogo.");
    sets.push(ucSql`framework = ${cast(f ?? null, "text")}`);
  }
  if (input.newTools !== undefined) {
    if (!Array.isArray(input.newTools) || input.newTools.length > L.newToolsMax) return fail("dati_non_validi", `Al massimo ${L.newToolsMax} strumenti nuovi.`);
    const tools: ProjectNewTool[] = [];
    for (const raw0 of input.newTools) {
      const r = raw0 !== null && typeof raw0 === "object" ? (raw0 as Record<string, unknown>) : {};
      const nome = teamText(r.nome, 80, "Il nome dello strumento");
      if (!nome.ok) return nome;
      if (!nome.value) return fail("dati_non_validi", "Ogni strumento nuovo ha un nome.");
      const perche = teamText(r.perche, 300, "Il perché dello strumento");
      if (!perche.ok) return perche;
      tools.push({ nome: nome.value, perche: perche.value });
    }
    sets.push(ucSql`new_tools = ${jsonb(tools)}`);
  }
  const numberField = (value: unknown, max: number, column: string, label: string): Result<ReturnType<typeof ucSql> | null> => {
    if (value === undefined) return ok(null);
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max)) return fail("dati_non_validi", `${label}: un numero da 0 a ${max}.`);
    return ok(ucSql`${raw(column)} = ${cast(value, "numeric")}`);
  };
  for (const [value, max, column, label] of [
    [input.estimateHours, L.hoursMax, "estimate_hours", "Le ore"],
    [input.monthlyCostEur, L.monthlyCostEurMax, "monthly_cost_eur", "Il costo al mese"],
  ] as const) {
    const r = numberField(value, max, column, label);
    if (!r.ok) return r;
    if (r.value) sets.push(r.value);
  }
  for (const [value, column] of [
    [input.standardVersion, "standard_version"],
    [input.catalogVersion, "catalog_version"],
  ] as const) {
    if (value === undefined) continue;
    if (value !== null && (typeof value !== "string" || !/^[0-9][0-9a-z.]{0,9}$/.test(value))) return fail("dati_non_validi", "Versione non valida.");
    sets.push(ucSql`${raw(column)} = ${cast(value, "text")}`);
  }
  if (input.packageVersion !== undefined) {
    if (input.packageVersion !== null && (typeof input.packageVersion !== "number" || !Number.isInteger(input.packageVersion) || input.packageVersion < 1)) return fail("dati_non_validi", "Versione del pacchetto non valida.");
    sets.push(ucSql`package_version = ${cast(input.packageVersion, "int")}`);
  }
  if (!sets.length) return fail("dati_non_validi", "Niente da salvare.");
  const assignments = sets.reduce((acc, part, i) => (i === 0 ? part : ucSql`${acc}, ${part}`));
  const [rows] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_projects SET ${assignments}, updated_at = now(), updated_by_user_id = ${cast(userOf(actor), "uuid")}
WHERE workspace_id = ${cast(target.workspaceId, "uuid")} AND use_case_id = ${cast(target.useCaseId, "uuid")} AND status = 'in_corso'
RETURNING version`),
  ]);
  if (!rows[0]) return fail("progetto_non_aperto", "Il progetto non è in corso: apri una versione nuova per cambiarlo.");
  return ok({ version: Number(rows[0].version) });
}

/** Il progetto in corso va «da approvare»: notifica il responsabile e, con strumenti nuovi, l'AI Board. */
export async function submitProject(executor: UcExecutor, actor: FactoryActor, target: FactoryTarget, now = new Date()): Promise<Result<{ version: number; newTools: number }>> {
  if (!mayWrite(actor)) return fail("permesso_negato", DENIED);
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const [check] = await executor.batch([toStatement(ucSql`SELECT version, topics, jsonb_array_length(new_tools) AS tools FROM use_case_projects WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'in_corso'`)]);
  const open = check[0];
  if (!open) return fail("progetto_non_aperto", "Non c'è un progetto in corso da mandare in approvazione.");
  const missing = SETUP_TOPICS.filter((t) => !(open.topics as ProjectTopics)?.[t]?.scelta);
  if (missing.length) return fail("argomenti_mancanti", `Mancano ${missing.length === 1 ? "un argomento" : `${missing.length} argomenti`}: ${missing.map((t) => TOPIC_LABELS[t]).join(", ")}.`);
  const tools = Number(open.tools ?? 0);
  const statements = [
    toStatement(ucSql`UPDATE use_case_projects SET status = 'da_approvare', submitted_at = now(), requested_by_user_id = ${cast(userOf(actor), "uuid")}, updated_at = now()
WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'in_corso' AND version = ${cast(Number(open.version), "int")}
RETURNING version`),
    noticeSql(target, "progetto_appr", actor, now),
    emailSql(target, "progetto_appr", actor, now, Number(open.version)),
  ];
  if (tools > 0) statements.push(noticeSql(target, "strumento_nuovo", actor, now), emailSql(target, "strumento_nuovo", actor, now, Number(open.version)));
  const [rows] = await executor.batch(statements);
  if (!rows[0]) return fail("conflitto", "Il progetto è cambiato nel frattempo: ricarica la pagina.");
  return ok({ version: Number(rows[0].version), newTools: tools });
}

/** Riporta in corso un progetto da approvare (per cambiarlo prima dell'approvazione). */
export async function reopenProject(executor: UcExecutor, actor: FactoryActor, target: FactoryTarget): Promise<Result<{ version: number }>> {
  if (!mayWrite(actor)) return fail("permesso_negato", DENIED);
  const [rows] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_projects SET status = 'in_corso', submitted_at = NULL, requested_by_user_id = NULL, ai_board_ok_at = NULL, ai_board_ok_by_user_id = NULL,
  ai_board_note = NULL, updated_at = now(), updated_by_user_id = ${cast(userOf(actor), "uuid")}
WHERE workspace_id = ${cast(target.workspaceId, "uuid")} AND use_case_id = ${cast(target.useCaseId, "uuid")} AND status = 'da_approvare'
RETURNING version`),
  ]);
  if (!rows[0]) return fail("progetto_non_aperto", "Non c'è un progetto da approvare.");
  return ok({ version: Number(rows[0].version) });
}

/** L'ok dell'AI Board agli strumenti nuovi della versione da approvare (scelta 2 del piano). */
export async function recordAiBoardOk(executor: UcExecutor, actor: FactoryActor, target: FactoryTarget, input: { note?: unknown }): Promise<Result<{ version: number }>> {
  const rule = actor.kind === "script" ? { allowed: true, noteRequired: true } : aiBoardOkRule(actor.roles);
  if (!rule.allowed) return fail("permesso_negato", "L'ok agli strumenti nuovi lo dà l'AI Board del cliente, o il responsabile del caso per suo conto.");
  const note = teamText(input.note, FACTORY_LIMITS.aiBoardNote, "La nota");
  if (!note.ok) return note;
  if (rule.noteRequired && (!note.value || note.value.length < AI_BOARD_NOTE_MIN)) {
    return fail("nota_mancante", "Scrivi chi dell'AI Board ha dato l'ok e quando: la registri per suo conto.");
  }
  const [rows] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_projects SET ai_board_ok_at = now(), ai_board_ok_by_user_id = ${cast(userOf(actor), "uuid")}, ai_board_note = ${cast(note.value, "text")}, updated_at = now()
WHERE workspace_id = ${cast(target.workspaceId, "uuid")} AND use_case_id = ${cast(target.useCaseId, "uuid")} AND status = 'da_approvare' AND jsonb_array_length(new_tools) > 0
RETURNING version`),
  ]);
  if (!rows[0]) return fail("progetto_non_aperto", "Non c'è un progetto da approvare con strumenti nuovi.");
  return ok({ version: Number(rows[0].version) });
}

/**
 * Approva la versione da approvare: la versione approvata prima diventa «superata», nella stessa transazione.
 * Con strumenti nuovi serve l'ok dell'AI Board (lo controlla anche il database). Lo stato del dossier lo cambia
 * chi chiama (`transitionCase`), solo se il caso è «pronto per lo sviluppo».
 */
export async function approveProject(executor: UcExecutor, actor: FactoryActor, target: FactoryTarget, at?: Date): Promise<Result<{ version: number }>> {
  if (actor.kind === "persona" && !canApproveProject(actor.roles)) return fail("permesso_negato", "Il progetto lo approva il responsabile del caso.");
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const [check] = await executor.batch([
    toStatement(ucSql`SELECT version, jsonb_array_length(new_tools) AS tools, ai_board_ok_at FROM use_case_projects WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'da_approvare'`),
  ]);
  const open = check[0];
  if (!open) return fail("progetto_non_aperto", "Non c'è un progetto da approvare.");
  if (Number(open.tools) > 0 && !open.ai_board_ok_at) return fail("manca_ai_board", "Il progetto usa strumenti nuovi: prima serve l'ok dell'AI Board.");
  const version = cast(Number(open.version), "int");
  const when = cast((at ?? new Date()).toISOString(), "timestamptz");
  const target0 = ucSql`EXISTS (SELECT 1 FROM use_case_projects WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'da_approvare' AND version = ${version})`;
  const [, rows] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_projects SET status = 'superato', updated_at = now() WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'approvato' AND ${target0} RETURNING version`),
    toStatement(ucSql`UPDATE use_case_projects SET status = 'approvato', approved_at = ${when}, approved_by_user_id = ${cast(userOf(actor), "uuid")}, updated_at = now()
WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'da_approvare' AND version = ${version}
RETURNING version`),
  ]);
  if (!rows[0]) return fail("conflitto", "Il progetto è cambiato nel frattempo: ricarica la pagina.");
  return ok({ version: Number(rows[0].version) });
}

// ─── Le decisioni del team ───────────────────────────────────────────

/** Una decisione del team (`unbundle decide`, o dalla scheda). Si aggiunge, non si riscrive. */
export async function addTeamDecision(
  executor: UcExecutor,
  actor: FactoryActor,
  target: FactoryTarget,
  input: { topic: unknown; choice: unknown; reason?: unknown; rejected?: unknown; topicKey?: unknown; decidedOn?: unknown },
  now = new Date(),
): Promise<Result<{ id: string }>> {
  if (!mayWrite(actor)) return fail("permesso_negato", DENIED);
  const L = FACTORY_LIMITS;
  const topic = teamText(input.topic, L.topic, "L'argomento");
  if (!topic.ok) return topic;
  if (!topic.value) return fail("dati_non_validi", "Scrivi l'argomento della decisione.");
  const choice = teamText(input.choice, L.choice, "La decisione");
  if (!choice.ok) return choice;
  if (!choice.value) return fail("dati_non_validi", "Scrivi la decisione.");
  const reason = teamText(input.reason, L.reason, "Il perché");
  if (!reason.ok) return reason;
  const rejected = teamText(input.rejected, L.rejected, "L'alternativa scartata");
  if (!rejected.ok) return rejected;
  const topicKey = input.topicKey === undefined || input.topicKey === null ? null : SETUP_TOPICS.find((t) => t === input.topicKey);
  if (topicKey === undefined) return fail("dati_non_validi", "Argomento dell'impostazione non valido.");
  const day = typeof input.decidedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.decidedOn) && input.decidedOn <= romeToday(now) ? input.decidedOn : romeToday(now);
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const [rows] = await executor.batch([
    toStatement(ucSql`INSERT INTO use_case_decisions (use_case_id, workspace_id, decided_on, topic_key, topic, choice, reason, rejected, source, project_version, author_user_id, author_role)
SELECT u.id, u.workspace_id, ${cast(day, "date")}, ${cast(topicKey, "text")}, ${cast(topic.value, "text")}, ${cast(choice.value, "text")}, ${cast(reason.value, "text")},
       ${cast(rejected.value, "text")}, ${cast(actor.kind === "script" ? "importata" : "team", "text")},
       (SELECT max(version) FROM use_case_projects p WHERE p.use_case_id = u.id), ${cast(userOf(actor), "uuid")}, ${cast(actor.kind === "script" ? actor.authorRole : null, "text")}
FROM use_cases u WHERE u.id = ${uc} AND u.workspace_id = ${ws}
RETURNING id`),
  ]);
  if (!rows[0]) return fail("non_trovato", "Use case non trovato.");
  return ok({ id: String(rows[0].id) });
}
