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
import { AGENT_QUESTION_CHANNELS, CLI_LIMITS, type AgentQuestionChannel } from "@/lib/db/use-case-hub-cli-ddl";
import type { BuildSessionInput, CaseRepoInput } from "@/lib/use-cases/cli/inputs";
import { cast, jsonb, raw, toStatement, ucSql, type UcStatement } from "@/lib/uc/sql/statement";
import { fail, ok, type Result } from "@/lib/uc/types";
import type { CaseRole } from "@/lib/uc/vocab";
import { packageContent, packageFiles, packageFilesHash, packageHash, type PackageSource } from "@/lib/use-cases/factory/package";
import { withSupersession } from "@/lib/use-cases/factory/decisions";
import {
  aiBoardOkRule,
  AI_BOARD_NOTE_MIN,
  canApproveProject,
  canReadFactory,
  canReopenProject,
  canRequestProjectChange,
  canWriteFactory,
  FACTORY_RECIPIENTS,
} from "@/lib/use-cases/factory/permissions";
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
  /** Cresce a ogni modifica: le azioni la rimandano, così si approva solo quello che si è visto. */
  revision: number;
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
  /** La modifica che l'AI Board ha chiesto invece dell'ok; resta finché il progetto non torna da approvare. */
  changeRequest: string | null;
  changeRequestedAt: string | null;
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
  /** Il giorno della decisione successiva sullo stesso argomento, che la sostituisce; null se vale ancora. */
  supersededOn: string | null;
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
    revision: Number(row.revision ?? 1),
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
    changeRequest: text(row.change_request),
    changeRequestedAt: iso(row.change_requested_at),
    updatedAt: iso(row.updated_at) ?? "",
  };
}

const PROJECT_COLUMNS = raw(
  "id, version, status, revision, topics, framework, new_tools, estimate_hours, monthly_cost_eur, standard_version, catalog_version, package_version, submitted_at, approved_at, ai_board_ok_at, ai_board_note, change_request, change_requested_at, updated_at",
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
    toStatement(ucSql`SELECT id, decided_on::text AS decided_on, topic_key, topic, choice, reason, rejected, source, project_version, author_role, created_at
FROM use_case_decisions WHERE workspace_id = ${ws} AND use_case_id = ${uc} ORDER BY decided_on DESC, created_at DESC LIMIT 200`),
  ]);
  const views = projects.map(projectFrom);
  const last = latest[0];
  return ok({
    packages: packages.map((r) => ({ version: Number(r.version), source: String(r.source) as PackageOrigin, createdAt: iso(r.created_at) ?? "", contentHash: String(r.content_hash) })),
    latestPackage: last ? { version: Number(last.version), files: last.files as Record<PackageFile, string>, createdAt: iso(last.created_at) ?? "", source: String(last.source) as PackageOrigin } : null,
    open: views.find((p) => p.status === "in_corso" || p.status === "da_approvare") ?? null,
    approved: views.find((p) => p.status === "approvato") ?? null,
    decisions: withSupersession(
      decisions.map((r) => ({
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
    ),
  });
}

// ─── Notifiche ───────────────────────────────────────────────────────

type FactoryNoticeKind = keyof typeof FACTORY_RECIPIENTS;

type Fragment = ReturnType<typeof ucSql>;
const ALWAYS = raw("true");

/**
 * Una riga nella campanella per ogni persona del team con uno dei ruoli del tipo, mai a chi ha agito. `when` è la
 * condizione nella stessa transazione (per esempio: l'invio in approvazione è avvenuto adesso).
 */
function noticeSql(target: FactoryTarget, kind: FactoryNoticeKind, actor: FactoryActor, now: Date, when: Fragment = ALWAYS): UcStatement {
  return toStatement(ucSql`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day)
SELECT DISTINCT c.workspace_id, c.portfolio_use_case_id, m.user_id, ${cast(kind, "text")}, ${cast(romeToday(now), "date")}
FROM uc_cases c JOIN uc_case_members m ON m.case_id = c.id
WHERE c.workspace_id = ${cast(target.workspaceId, "uuid")} AND c.portfolio_use_case_id = ${cast(target.useCaseId, "uuid")}
  AND m.role = ANY (${cast([...FACTORY_RECIPIENTS[kind]], "text[]")})
  AND m.user_id IS DISTINCT FROM ${cast(userOf(actor), "uuid")}
  AND ${when}
ON CONFLICT (recipient_user_id, use_case_id, kind, rome_day) DO UPDATE SET last_event_at = now(), read_at = NULL`);
}

/**
 * L'email della coda dei dossier: interna di Lateral Space. «Progetto da approvare» dice anche quanti strumenti
 * nuovi ci sono (una sola email al responsabile); «Modifica chiesta» va al responsabile, che riapre il progetto;
 * «Strumento nuovo» è per l'AI Board del cliente e arriva con la 8.0c.
 */
type FactoryEmailKind = "progetto_appr" | "pacchetto_nuovo" | "modifica_chiesta" | "domanda_agente";
const FACTORY_EMAIL: Readonly<Record<FactoryEmailKind, { template: string; roles: readonly CaseRole[] }>> = Object.freeze({
  progetto_appr: { template: "progetto_da_approvare", roles: ["ls_lead"] },
  pacchetto_nuovo: { template: "pacchetto_aggiornato", roles: ["ls_lead", "ls_analista", "ls_sviluppatore"] },
  modifica_chiesta: { template: "modifica_richiesta", roles: ["ls_lead"] },
  // (8.0b) Una domanda proposta da un coding agent: al responsabile, che la decide (al massimo una e-mail al giorno).
  domanda_agente: { template: "domanda_proposta", roles: ["ls_lead"] },
});

/**
 * Un'email in coda (`uc_notifications`, canale email) per ogni persona di Lateral Space del team con il ruolo del
 * tipo, mai a chi ha agito; al massimo una al giorno per persona, caso e tipo (la chiave di deduplica). La manda il
 * motore dei dossier dopo il comando (`finishUcCommand`) o il cron, che controlla anche che sia di Lateral Space.
 */
function emailSql(target: FactoryTarget, kind: FactoryEmailKind, actor: FactoryActor, now: Date, version: number, when: Fragment = ALWAYS, count = 0): UcStatement {
  const e = FACTORY_EMAIL[kind];
  return toStatement(ucSql`INSERT INTO uc_notifications (workspace_id, case_id, recipient_user_id, channel, template_key, payload, status, dedupe_key, scheduled_at)
SELECT DISTINCT ON (m.user_id) c.workspace_id, c.id, m.user_id, 'email', ${cast(e.template, "text")}, ${jsonb({ version, count, useCase: target.useCaseId })}, 'in_coda',
       ${cast(e.template, "text")} || ':' || c.id::text || ':' || m.user_id::text || ':' || ${cast(romeToday(now), "text")}, now()
FROM uc_cases c JOIN uc_case_members m ON m.case_id = c.id
WHERE c.workspace_id = ${cast(target.workspaceId, "uuid")} AND c.portfolio_use_case_id = ${cast(target.useCaseId, "uuid")}
  AND m.role = ANY (${cast([...e.roles], "text[]")})
  AND m.user_id IS DISTINCT FROM ${cast(userOf(actor), "uuid")}
  AND ${when}
ON CONFLICT (dedupe_key) DO NOTHING`);
}

// ─── Il pacchetto ────────────────────────────────────────────────────

/** Un batch; due clic insieme che urtano un indice unico diventano «conflitto», non un errore della pagina. */
async function batchOrConflict(executor: UcExecutor, statements: readonly UcStatement[]): Promise<Result<UcRow[][]>> {
  try {
    return ok(await executor.batch(statements));
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "23505") return fail("conflitto", "Qualcun altro l'ha appena fatto: ricarica la pagina.");
    throw error;
  }
}

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
  // Solo l'ultima versione conta: una scheda che torna com'era prima fa una versione nuova, uguale a una vecchia.
  if (last[0] && String(last[0].content_hash) === hash) return ok({ version: lastVersion, created: false });
  if (Buffer.byteLength(JSON.stringify(files), "utf8") > FACTORY_LIMITS.packageBytesMax) return fail("pacchetto_troppo_grande", "Il pacchetto supera i 200 KB: accorcia i testi della scheda.");
  const inserted = ucSql`EXISTS (SELECT 1 FROM use_case_packages WHERE use_case_id = ${uc} AND version = ${cast(version, "int")} AND created_at = now())`;
  const rows = await batchOrConflict(executor, [
    toStatement(ucSql`INSERT INTO use_case_packages (use_case_id, workspace_id, version, content_hash, files, source, created_by_user_id)
SELECT ${uc}, ${ws}, ${cast(version, "int")}, ${cast(hash, "text")}, ${jsonb(files)}, ${cast(source, "text")}, ${cast(userOf(actor), "uuid")}
WHERE EXISTS (SELECT 1 FROM use_cases WHERE id = ${uc} AND workspace_id = ${ws})
RETURNING version`),
    noticeSql(target, "pacchetto_nuovo", actor, now, inserted),
    emailSql(target, "pacchetto_nuovo", actor, now, version, inserted),
  ]);
  if (!rows.ok) return rows;
  if (!rows.value[0][0]) return fail("non_trovato", "Use case non trovato.");
  return ok({ version, created: true });
}

/**
 * I nomi da coprire nei testi che escono verso i coding agent (pacchetto, contesto della CLI): persone del workspace
 * e della sua organizzazione, contatti, chi ha chiesto le informazioni al referente, chi ha proposto da Slack o dal
 * connettore.
 */
function namesToHideSql(target: FactoryTarget): UcStatement {
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  return toStatement(ucSql`SELECT DISTINCT x.name FROM (
  SELECT u.name FROM users u JOIN workspace_memberships wm ON wm.user_id = u.id WHERE wm.workspace_id = ${ws}
  UNION SELECT u.name FROM users u JOIN memberships m ON m.user_id = u.id JOIN workspaces w ON w.organization_id = m.organization_id WHERE w.id = ${ws}
  UNION SELECT c.display_name FROM uc_contacts c WHERE c.workspace_id = ${ws}
  UNION SELECT r.requester_name FROM use_case_referent_requests r WHERE r.workspace_id = ${ws} AND r.use_case_id = ${uc}
  UNION SELECT ci.display_name FROM connector_identities ci WHERE ci.workspace_id = ${ws}
) x WHERE x.name IS NOT NULL`);
}

/** I nomi da coprire per uno use case (vedi `namesToHideSql`). */
export async function namesToHide(executor: UcExecutor, target: FactoryTarget): Promise<string[]> {
  const [rows] = await executor.batch([namesToHideSql(target)]);
  return rows.map((r) => String(r.name));
}

/** Quello che il pacchetto prende dalla scheda: lo legge chi chiama, con i permessi di chi guarda. */
export type PackageCard = Omit<PackageSource, "answers" | "openNeeds" | "namesToHide">;

/**
 * Il resto del pacchetto, dal database: le risposte inviate del referente (la domanda è il titolo dell'esigenza),
 * le esigenze ancora aperte di «Cosa serve», e i nomi da coprire (persone del workspace e della sua
 * organizzazione, contatti, chi ha chiesto le informazioni al referente, chi ha proposto da Slack o dal connettore).
 *
 * Risposte ed esigenze solo con `canSeeNeeds` di chi genera il pacchetto (chi vede «Cosa serve» sulla scheda,
 * `abilitiesForUseCase`): senza, il pacchetto dice che le porta chi le può leggere, come la scheda.
 */
export async function packageSourceFor(executor: UcExecutor, target: FactoryTarget, card: PackageCard, opts: { canSeeNeeds: boolean }): Promise<PackageSource> {
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  // Senza «Cosa serve» le due letture non si fanno: al loro posto due righe vuote, così l'ordine resta.
  const nothing = toStatement(ucSql`SELECT NULL AS none WHERE false`);
  const answersSql = toStatement(ucSql`SELECT n.title, a.body, a.submitted_at, n.type, n.status
FROM use_case_need_answers a JOIN use_case_needs n ON n.id = a.need_id AND n.workspace_id = a.workspace_id
WHERE a.workspace_id = ${ws} AND a.use_case_id = ${uc} AND a.status = 'inviata' AND a.removed_at IS NULL AND a.body IS NOT NULL AND NOT a.dont_know
ORDER BY a.submitted_at NULLS LAST, a.id LIMIT 30`);
  const needsSql = toStatement(ucSql`SELECT n.title, n.type, n.status FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id
WHERE l.use_case_id = ${uc} AND n.workspace_id = ${ws} AND n.archived_at IS NULL
ORDER BY n.type, n.sort_order, n.created_at, n.id LIMIT 80`);
  const [answers, needs, names] = await executor.batch(opts.canSeeNeeds ? [answersSql, needsSql, namesToHideSql(target)] : [nothing, nothing, namesToHideSql(target)]);
  const label = (type: unknown, status: unknown) => needStatusView(String(type) as NeedType, String(status) as NeedStatus).label.toLowerCase();
  return {
    ...card,
    answers: answers.map((r) => ({ question: String(r.title), answer: String(r.body), on: r.submitted_at ? new Date(String(r.submitted_at)).toISOString().slice(0, 10) : null, status: label(r.type, r.status) })),
    openNeeds: needs
      .filter((r) => !isNeedDone(String(r.type) as NeedType, String(r.status) as NeedStatus))
      .slice(0, 40)
      .map((r) => ({ title: String(r.title), status: label(r.type, r.status) })),
    namesToHide: names.map((r) => String(r.name)),
    needsHidden: !opts.canSeeNeeds,
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
  const done = await batchOrConflict(executor, [
    toStatement(ucSql`INSERT INTO use_case_projects (use_case_id, workspace_id, version, topics, framework, new_tools, estimate_hours, monthly_cost_eur, standard_version, catalog_version, updated_by_user_id)
SELECT u.id, u.workspace_id, coalesce(p.version, 0) + 1, coalesce(p.topics, '{}'::jsonb), p.framework, coalesce(p.new_tools, '[]'::jsonb), p.estimate_hours, p.monthly_cost_eur,
       p.standard_version, p.catalog_version, ${cast(userOf(actor), "uuid")}
FROM use_cases u
LEFT JOIN LATERAL (SELECT * FROM use_case_projects x WHERE x.use_case_id = u.id ORDER BY x.version DESC LIMIT 1) p ON true
WHERE u.id = ${uc} AND u.workspace_id = ${ws}
RETURNING version`),
  ]);
  if (!done.ok) return done;
  const rows = done.value[0];
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
  revision = revision + 1, updated_at = now(), updated_by_user_id = ${cast(userOf(actor), "uuid")}
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
    toStatement(ucSql`UPDATE use_case_projects SET ${assignments}, revision = revision + 1, updated_at = now(), updated_by_user_id = ${cast(userOf(actor), "uuid")}
WHERE workspace_id = ${cast(target.workspaceId, "uuid")} AND use_case_id = ${cast(target.useCaseId, "uuid")} AND status = 'in_corso'
RETURNING version`),
  ]);
  if (!rows[0]) return fail("progetto_non_aperto", "Il progetto non è in corso: apri una versione nuova per cambiarlo.");
  return ok({ version: Number(rows[0].version) });
}

/** La revisione che la pagina ha mostrato: si scrive solo su quella, mai su una cambiata nel frattempo. */
function revisionOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

const CHANGED = "Il progetto è cambiato nel frattempo: ricarica la pagina e guardalo di nuovo.";

/**
 * Il progetto in corso va «da approvare»: notifica il responsabile (con il numero di strumenti nuovi) e, con
 * strumenti nuovi, l'AI Board. Le notifiche partono solo se l'invio è avvenuto in questa transazione.
 */
export async function submitProject(
  executor: UcExecutor,
  actor: FactoryActor,
  target: FactoryTarget,
  input: { revision?: unknown } = {},
  now = new Date(),
): Promise<Result<{ version: number; newTools: number }>> {
  if (!mayWrite(actor)) return fail("permesso_negato", DENIED);
  const revision = revisionOf(input.revision);
  if (revision === null) return fail("dati_non_validi", CHANGED);
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const [check] = await executor.batch([
    toStatement(ucSql`SELECT version, revision, topics, jsonb_array_length(new_tools) AS tools FROM use_case_projects WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'in_corso'`),
  ]);
  const open = check[0];
  if (!open) return fail("progetto_non_aperto", "Non c'è un progetto in corso da mandare in approvazione.");
  if (Number(open.revision) !== revision) return fail("conflitto", CHANGED);
  const missing = SETUP_TOPICS.filter((t) => !(open.topics as ProjectTopics)?.[t]?.scelta);
  if (missing.length) return fail("argomenti_mancanti", `${missing.length === 1 ? "Manca un argomento" : `Mancano ${missing.length} argomenti`}: ${missing.map((t) => TOPIC_LABELS[t]).join(", ")}.`);
  const tools = Number(open.tools ?? 0);
  const version = Number(open.version);
  // L'UPDATE scrive submitted_at = now(): le notifiche guardano la stessa ora della transazione.
  const sent = ucSql`EXISTS (SELECT 1 FROM use_case_projects WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'da_approvare' AND version = ${cast(version, "int")} AND submitted_at = now())`;
  const statements = [
    toStatement(ucSql`UPDATE use_case_projects SET status = 'da_approvare', submitted_at = now(), requested_by_user_id = ${cast(userOf(actor), "uuid")},
  change_request = NULL, change_requested_at = NULL, revision = revision + 1, updated_at = now()
WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'in_corso' AND version = ${cast(version, "int")} AND revision = ${cast(revision, "int")}
RETURNING version`),
    noticeSql(target, "progetto_appr", actor, now, sent),
    emailSql(target, "progetto_appr", actor, now, version, sent, tools),
  ];
  if (tools > 0) statements.push(noticeSql(target, "strumento_nuovo", actor, now, sent));
  const [rows] = await executor.batch(statements);
  if (!rows[0]) return fail("conflitto", CHANGED);
  return ok({ version, newTools: tools });
}

/**
 * Riporta in corso un progetto da approvare, per cambiarlo prima dell'approvazione. Lo fa solo il responsabile
 * (`canReopenProject`): l'ok dell'AI Board decade e, se c'era, l'AI Board lo sa dalla campanella («ok da rifare»).
 * La modifica chiesta dall'AI Board resta, finché il progetto non torna da approvare.
 */
export async function reopenProject(
  executor: UcExecutor,
  actor: FactoryActor,
  target: FactoryTarget,
  input: { revision?: unknown } = {},
  now = new Date(),
): Promise<Result<{ version: number; boardOkDropped: boolean }>> {
  if (actor.kind === "persona" && !canReopenProject(actor.roles)) return fail("permesso_negato", "Il progetto da approvare lo riapre il responsabile del caso.");
  const revision = revisionOf(input.revision);
  if (revision === null) return fail("dati_non_validi", CHANGED);
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const [check] = await executor.batch([toStatement(ucSql`SELECT version, revision, ai_board_ok_at FROM use_case_projects WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'da_approvare'`)]);
  const open = check[0];
  if (!open) return fail("progetto_non_aperto", "Non c'è un progetto da approvare da riaprire.");
  if (Number(open.revision) !== revision) return fail("conflitto", CHANGED);
  const boardOkDropped = open.ai_board_ok_at !== null && open.ai_board_ok_at !== undefined;
  const version = cast(Number(open.version), "int");
  // L'UPDATE scrive updated_at = now(): la notifica parte solo se la riapertura è avvenuta in questa transazione.
  const reopened = ucSql`EXISTS (SELECT 1 FROM use_case_projects WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'in_corso' AND version = ${version} AND updated_at = now())`;
  const statements = [
    toStatement(ucSql`UPDATE use_case_projects SET status = 'in_corso', submitted_at = NULL, requested_by_user_id = NULL, ai_board_ok_at = NULL, ai_board_ok_by_user_id = NULL,
  ai_board_note = NULL, revision = revision + 1, updated_at = now(), updated_by_user_id = ${cast(userOf(actor), "uuid")}
WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'da_approvare' AND version = ${version} AND revision = ${cast(revision, "int")}
RETURNING version`),
  ];
  if (boardOkDropped) statements.push(noticeSql(target, "ok_decaduto", actor, now, reopened));
  const [rows] = await executor.batch(statements);
  if (!rows[0]) return fail("conflitto", CHANGED);
  return ok({ version: Number(rows[0].version), boardOkDropped });
}

/** L'ok dell'AI Board agli strumenti nuovi della revisione da approvare che si è vista (scelta 2 del piano). */
export async function recordAiBoardOk(executor: UcExecutor, actor: FactoryActor, target: FactoryTarget, input: { note?: unknown; revision?: unknown }): Promise<Result<{ version: number }>> {
  const rule = actor.kind === "script" ? { allowed: true, noteRequired: true } : aiBoardOkRule(actor.roles);
  if (!rule.allowed) return fail("permesso_negato", "L'ok agli strumenti nuovi lo dà l'AI Board del cliente, o il responsabile del caso per suo conto.");
  const revision = revisionOf(input.revision);
  if (revision === null) return fail("dati_non_validi", CHANGED);
  const note = teamText(input.note, FACTORY_LIMITS.aiBoardNote, "La nota");
  if (!note.ok) return note;
  if (rule.noteRequired && (!note.value || note.value.length < AI_BOARD_NOTE_MIN)) {
    return fail("nota_mancante", "Scrivi chi dell'AI Board ha dato l'ok e quando: la registri per suo conto.");
  }
  const [rows] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_projects SET ai_board_ok_at = now(), ai_board_ok_by_user_id = ${cast(userOf(actor), "uuid")}, ai_board_note = ${cast(note.value, "text")},
  change_request = NULL, change_requested_at = NULL, revision = revision + 1, updated_at = now()
WHERE workspace_id = ${cast(target.workspaceId, "uuid")} AND use_case_id = ${cast(target.useCaseId, "uuid")} AND status = 'da_approvare' AND jsonb_array_length(new_tools) > 0
  AND revision = ${cast(revision, "int")}
RETURNING version`),
  ]);
  if (!rows[0]) return fail("conflitto", CHANGED);
  return ok({ version: Number(rows[0].version) });
}

/**
 * Invece dell'ok, l'AI Board chiede una modifica agli strumenti nuovi, con una nota (scelta 2 del piano). Il
 * progetto resta da approvare e senza ok: il responsabile lo riapre e il team lo cambia. Notifica chi costruisce
 * (campanella) e il responsabile (email). Una richiesta nuova prende il posto di quella di prima.
 */
export async function requestProjectChange(
  executor: UcExecutor,
  actor: FactoryActor,
  target: FactoryTarget,
  input: { note?: unknown; revision?: unknown },
  now = new Date(),
): Promise<Result<{ version: number }>> {
  if (actor.kind !== "persona" || !canRequestProjectChange(actor.roles)) return fail("permesso_negato", "La modifica agli strumenti nuovi la chiede l'AI Board del cliente.");
  const revision = revisionOf(input.revision);
  if (revision === null) return fail("dati_non_validi", CHANGED);
  const note = teamText(input.note, FACTORY_LIMITS.aiBoardNote, "La modifica");
  if (!note.ok) return note;
  if (!note.value || note.value.length < AI_BOARD_NOTE_MIN) return fail("nota_mancante", "Scrivi che cosa va cambiato, in almeno 10 caratteri.");
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const [check] = await executor.batch([toStatement(ucSql`SELECT version FROM use_case_projects WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'da_approvare'`)]);
  if (!check[0]) return fail("progetto_non_aperto", "Non c'è un progetto da approvare.");
  const version = Number(check[0].version);
  const asked = ucSql`EXISTS (SELECT 1 FROM use_case_projects WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'da_approvare' AND version = ${cast(version, "int")} AND change_requested_at = now())`;
  const [rows] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_projects SET change_request = ${cast(note.value, "text")}, change_requested_at = now(), revision = revision + 1, updated_at = now()
WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'da_approvare' AND version = ${cast(version, "int")} AND jsonb_array_length(new_tools) > 0
  AND ai_board_ok_at IS NULL AND revision = ${cast(revision, "int")}
RETURNING version`),
    noticeSql(target, "modifica_chiesta", actor, now, asked),
    emailSql(target, "modifica_chiesta", actor, now, version, asked),
  ]);
  if (!rows[0]) return fail("conflitto", CHANGED);
  return ok({ version });
}

/**
 * Approva la revisione da approvare che il responsabile ha visto: la versione approvata prima diventa
 * «superata», nella stessa transazione. Con strumenti nuovi serve l'ok dell'AI Board (lo controlla anche il
 * database). Lo stato del dossier lo cambia chi chiama (`transitionCase`), solo se il caso è «pronto per lo
 * sviluppo».
 */
export async function approveProject(executor: UcExecutor, actor: FactoryActor, target: FactoryTarget, input: { revision?: unknown } = {}, at?: Date, now = new Date()): Promise<Result<{ version: number }>> {
  if (actor.kind === "persona" && !canApproveProject(actor.roles)) return fail("permesso_negato", "Il progetto lo approva il responsabile del caso.");
  const revision = revisionOf(input.revision);
  if (revision === null) return fail("dati_non_validi", CHANGED);
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const [check] = await executor.batch([
    toStatement(ucSql`SELECT version, revision, jsonb_array_length(new_tools) AS tools, ai_board_ok_at FROM use_case_projects WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'da_approvare'`),
  ]);
  const open = check[0];
  if (!open) return fail("progetto_non_aperto", "Non c'è un progetto da approvare.");
  if (Number(open.revision) !== revision) return fail("conflitto", CHANGED);
  if (Number(open.tools) > 0 && !open.ai_board_ok_at) return fail("manca_ai_board", "Il progetto usa strumenti nuovi: prima serve l'ok dell'AI Board.");
  const version = cast(Number(open.version), "int");
  const rev = cast(revision, "int");
  const when = cast((at ?? new Date()).toISOString(), "timestamptz");
  const target0 = ucSql`EXISTS (SELECT 1 FROM use_case_projects WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'da_approvare' AND version = ${version} AND revision = ${rev})`;
  // L'UPDATE scrive updated_at = now(): «Progetto approvato» parte solo se l'approvazione è di questa transazione.
  const approvedNow = ucSql`EXISTS (SELECT 1 FROM use_case_projects WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'approvato' AND version = ${version} AND updated_at = now())`;
  const [, rows] = await executor.batch([
    toStatement(ucSql`UPDATE use_case_projects SET status = 'superato', revision = revision + 1, updated_at = now() WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'approvato' AND ${target0} RETURNING version`),
    toStatement(ucSql`UPDATE use_case_projects SET status = 'approvato', approved_at = ${when}, approved_by_user_id = ${cast(userOf(actor), "uuid")}, revision = revision + 1, updated_at = now()
WHERE workspace_id = ${ws} AND use_case_id = ${uc} AND status = 'da_approvare' AND version = ${version} AND revision = ${rev}
RETURNING version`),
    noticeSql(target, "progetto_ok", actor, now, approvedNow),
  ]);
  if (!rows[0]) return fail("conflitto", CHANGED);
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

// ─── La CLI e l'MCP del caso (rilascio 8.0b) ─────────────────────────

/** Le domande proposte ancora da decidere che uno use case può avere insieme. */
export const AGENT_QUESTIONS_OPEN_MAX = 30;

/**
 * Una domanda per il referente proposta da un coding agent (`unbundle ask`, `propose_question`). Non parte mai:
 * la vede in «Cosa serve» chi prepara le domande, che la aggiunge o la lascia stare. Notifica, nella stessa
 * transazione, il responsabile e gli analisti del caso (mai chi l'ha proposta).
 */
export async function proposeAgentQuestion(
  executor: UcExecutor,
  actor: FactoryActor,
  target: FactoryTarget,
  input: { question: unknown; reason?: unknown; channel: AgentQuestionChannel },
  now = new Date(),
): Promise<Result<{ id: string }>> {
  if (!mayWrite(actor)) return fail("permesso_negato", DENIED);
  const question = teamText(input.question, CLI_LIMITS.question, "La domanda");
  if (!question.ok) return question;
  if (!question.value) return fail("dati_non_validi", "Scrivi la domanda.");
  const reason = teamText(input.reason, CLI_LIMITS.questionReason, "Il perché");
  if (!reason.ok) return reason;
  if (!AGENT_QUESTION_CHANNELS.includes(input.channel)) return fail("dati_non_validi", "Canale non valido.");
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const [open] = await executor.batch([toStatement(ucSql`SELECT count(*)::int AS n FROM use_case_agent_questions WHERE use_case_id = ${uc} AND workspace_id = ${ws} AND status = 'proposta'`)]);
  if (Number(open[0]?.n ?? 0) >= AGENT_QUESTIONS_OPEN_MAX) {
    return fail("troppe_proposte", `Ci sono già ${AGENT_QUESTIONS_OPEN_MAX} domande proposte da decidere: aspetta che il team le guardi.`);
  }
  const inserted = ucSql`EXISTS (SELECT 1 FROM use_case_agent_questions WHERE use_case_id = ${uc} AND created_at = now())`;
  const [rows] = await executor.batch([
    toStatement(ucSql`INSERT INTO use_case_agent_questions (use_case_id, workspace_id, question, reason, channel, author_user_id)
SELECT u.id, u.workspace_id, ${cast(question.value, "text")}, ${cast(reason.value, "text")}, ${cast(input.channel, "text")}, ${cast(userOf(actor), "uuid")}
FROM use_cases u WHERE u.id = ${uc} AND u.workspace_id = ${ws}
RETURNING id`),
    noticeSql(target, "domanda_agente", actor, now, inserted),
    emailSql(target, "domanda_agente", actor, now, 0, inserted),
  ]);
  if (!rows[0]) return fail("non_trovato", "Use case non trovato.");
  return ok({ id: String(rows[0].id) });
}

/** `unbundle repo create`: registra (o aggiorna) il repository e la cartella dello use case. */
export async function registerCaseRepo(executor: UcExecutor, actor: FactoryActor, target: FactoryTarget, input: CaseRepoInput): Promise<Result<{ id: string; created: boolean }>> {
  if (!mayWrite(actor)) return fail("permesso_negato", DENIED);
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const [rows] = await executor.batch([
    toStatement(ucSql`INSERT INTO use_case_repos (use_case_id, workspace_id, repo, folder, profile, vercel_project, created_by_user_id)
SELECT u.id, u.workspace_id, ${cast(input.repo, "text")}, ${cast(input.folder, "text")}, ${cast(input.profile, "text")}, ${cast(input.vercelProject, "text")}, ${cast(userOf(actor), "uuid")}
FROM use_cases u WHERE u.id = ${uc} AND u.workspace_id = ${ws}
ON CONFLICT (use_case_id, repo, folder) DO UPDATE SET profile = coalesce(EXCLUDED.profile, use_case_repos.profile),
  vercel_project = coalesce(EXCLUDED.vercel_project, use_case_repos.vercel_project), updated_at = now()
RETURNING id, (xmax = 0) AS created`),
  ]);
  if (!rows[0]) return fail("non_trovato", "Use case non trovato.");
  return ok({ id: String(rows[0].id), created: rows[0].created === true });
}

/**
 * La sintesi di una sessione di un coding agent (`unbundle session end`, `report_session`). Una volta sola per
 * sessione: la stessa chiave non scrive di nuovo. I permessi li controlla chi chiama.
 */
export async function recordBuildSession(executor: UcExecutor, target: FactoryTarget, input: BuildSessionInput): Promise<Result<{ created: boolean }>> {
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const [rows, exists] = await executor.batch([
    toStatement(ucSql`INSERT INTO use_case_build_sessions (use_case_id, workspace_id, session_key, task_ref, harness, model, input_tokens, output_tokens, cache_tokens,
  cost_usd, duration_seconds, outcome, pr_url, branch, ended_at)
SELECT u.id, u.workspace_id, ${cast(input.sessionKey, "text")}, ${cast(input.taskRef, "text")}, ${cast(input.harness, "text")}, ${cast(input.model, "text")},
  ${cast(input.inputTokens, "bigint")}, ${cast(input.outputTokens, "bigint")}, ${cast(input.cacheTokens, "bigint")}, ${cast(input.costUsd, "numeric")},
  ${cast(input.durationSeconds, "int")}, ${cast(input.outcome, "text")}, ${cast(input.prUrl, "text")}, ${cast(input.branch, "text")}, ${cast(input.endedAt, "timestamptz")}
FROM use_cases u WHERE u.id = ${uc} AND u.workspace_id = ${ws}
ON CONFLICT (use_case_id, session_key) DO NOTHING
RETURNING id`),
    toStatement(ucSql`SELECT 1 AS ok FROM use_cases WHERE id = ${uc} AND workspace_id = ${ws}`),
  ]);
  if (!exists[0]) return fail("non_trovato", "Use case non trovato.");
  return ok({ created: Boolean(rows[0]) });
}

export interface CliCaseExtras {
  /** Le esigenze di «Cosa serve» ancora aperte, con lo stato; null se chi chiede non le vede. */
  openNeeds: { title: string; status: string }[] | null;
  proposals: { id: string; question: string; reason: string | null; createdAt: string }[];
  repos: { repo: string; folder: string; profile: string | null; vercelProject: string | null }[];
}

/** Quello che il contesto della CLI aggiunge al progetto: esigenze aperte, domande proposte, repository. */
export async function cliCaseExtras(executor: UcExecutor, target: FactoryTarget, opts: { canSeeNeeds: boolean }): Promise<CliCaseExtras> {
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const [needs, proposals, repos] = await executor.batch([
    opts.canSeeNeeds
      ? toStatement(ucSql`SELECT n.title, n.type, n.status FROM use_case_needs n JOIN use_case_need_links l ON l.need_id = n.id
WHERE l.use_case_id = ${uc} AND n.workspace_id = ${ws} AND n.archived_at IS NULL ORDER BY n.type, n.sort_order, n.created_at, n.id LIMIT 80`)
      : toStatement(ucSql`SELECT NULL AS none WHERE false`),
    toStatement(ucSql`SELECT id, question, reason, created_at FROM use_case_agent_questions WHERE use_case_id = ${uc} AND workspace_id = ${ws} AND status = 'proposta'
ORDER BY created_at DESC LIMIT ${cast(AGENT_QUESTIONS_OPEN_MAX, "int")}`),
    toStatement(ucSql`SELECT repo, folder, profile, vercel_project FROM use_case_repos WHERE use_case_id = ${uc} AND workspace_id = ${ws} ORDER BY created_at`),
  ]);
  const label = (type: unknown, status: unknown) => needStatusView(String(type) as NeedType, String(status) as NeedStatus).label.toLowerCase();
  return {
    openNeeds: opts.canSeeNeeds
      ? needs.filter((r) => !isNeedDone(String(r.type) as NeedType, String(r.status) as NeedStatus)).map((r) => ({ title: String(r.title), status: label(r.type, r.status) }))
      : null,
    proposals: proposals.map((r) => ({ id: String(r.id), question: String(r.question), reason: text(r.reason), createdAt: iso(r.created_at) ?? "" })),
    repos: repos.map((r) => ({ repo: String(r.repo), folder: String(r.folder), profile: text(r.profile), vercelProject: text(r.vercel_project) })),
  };
}

/**
 * Le scelte approvate degli altri casi della stessa famiglia (stesso repository), per l'impostazione guidata: solo
 * il codice e la scelta di ogni argomento, mai il perché. Senza repository registrato, nessuna.
 */
export async function familyChoices(executor: UcExecutor, target: FactoryTarget): Promise<{ code: string; topics: ProjectTopics }[]> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT DISTINCT ON (u.id) u.code, p.topics FROM use_case_repos r
JOIN use_case_repos r2 ON r2.repo = r.repo AND r2.workspace_id = r.workspace_id AND r2.use_case_id <> r.use_case_id
JOIN use_cases u ON u.id = r2.use_case_id AND u.workspace_id = r2.workspace_id
JOIN use_case_projects p ON p.use_case_id = u.id AND p.status = 'approvato'
WHERE r.use_case_id = ${cast(target.useCaseId, "uuid")} AND r.workspace_id = ${cast(target.workspaceId, "uuid")}
ORDER BY u.id LIMIT 20`),
  ]);
  return rows.map((r) => ({ code: String(r.code ?? ""), topics: (r.topics ?? {}) as ProjectTopics }));
}
