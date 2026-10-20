/**
 * Comandi e letture dei casi d'uso (PIANO §3.3, §3.4, §4.6, §5.1–§5.3, §5.8).
 *
 * Modulo senza import dell'app (`@/…`, `server-only`), come `uc-templates.ts`:
 * l'esecutore arriva da fuori (app: `await getAppUcExecutor()` dopo
 * `ensureUcAvailable()`; script e test: `ucExecutorForUrl(...)`). L'accesso al
 * workspace (`requireWorkspaceAccess`) e al caso (`assertCaseRole`) lo controlla
 * il chiamante; qui ogni comando ricalcola i permessi con le funzioni pure e
 * scrive con compare-and-swap più evento nello stesso batch.
 *
 * Qui stanno anche gli aiuti condivisi con `uc-items.ts` e `uc-gates.ts`
 * (contesto del comando, firmatari, lettura della prontezza).
 */
import { z } from "zod";
import { MVP_AVAILABLE_GATES, checkCaseTransition, nextCaseStatuses } from "../../uc/case-state.ts";
import { A8_BLOCKER_KEY } from "../../uc/blockers.ts";
import { gatePolicyToJson, gateScopeForItem, isItemOk, type GateComputation, type GateDefaultField, type LiteralCoverage } from "../../uc/gates.ts";
import { caseRoleAllowedFor, userContextFrom } from "../../uc/lateral-space.ts";
import {
  assertMemberRoles,
  can,
  checkCaseCreator,
  checkPersonalZoneProposal,
  checkPersonalZoneSignature,
  checkSignerDesignation,
  designationChanged,
  type PersonalZoneGrant,
  type SignatureContext,
  type Signer,
} from "../../uc/permissions.ts";
import { gateLineText, openCountsByAssignee, type Readiness } from "../../uc/semaforo.ts";
import {
  caseCoreSql,
  computeCaseReadiness,
  parseCaseCore,
  parseReadinessRows,
  readinessCacheSql,
  readinessReadStatements,
  rowBool,
  rowDate,
  rowJson,
  rowNumber,
  rowObject,
  rowString,
  rowStringArray,
  type CaseBlockerRow,
  type CaseCore,
  type ReadinessInput,
  type Row,
} from "../../uc/sql/readiness.ts";
import { cast, jsonb, raw, requireRows, toStatement, ucSql, type UcStatement } from "../../uc/sql/statement.ts";
import { templatePartsReader } from "../../uc/sql/template-parts.ts";
import {
  cancelCaseNotificationsSql,
  caseRevisionSql,
  caseTransitionSql,
  dropPendingApprovalsSql,
  holdCaseNotificationsSql,
  itemSnapshotsSql,
  planItemTransitions,
  portfolioStatusSql,
  releaseCaseNotificationsSql,
  releaseCaseRequestItemsSql,
  revokeApprovalLinksSql,
  revokeCaseMcpTokensSql,
  revokeCaseRequestsSql,
  revokeCaseTokensSql,
  rowToLoadedItem,
  transitionStatements,
} from "../../uc/sql/transitions.ts";
import { findingMessage, scanPayload } from "../../uc/text/scan.ts";
import { zoneApprovalHash } from "../../uc/views/approvals.ts";
import { fail, ok, type Actor, type Approval, type Json, type Result, type UserContext } from "../../uc/types.ts";
import {
  CASE_ROLES,
  GATE_POLICY_SCOPES,
  LEVERS,
  LS_CASE_ROLES,
  PERIMETERS,
  PHASES,
  isVocab,
  type CaseRole,
  type CaseStatus,
  type GatePolicyScope,
  type Lever,
  type Phase,
} from "../../uc/vocab.ts";
import { eventActorFrom, eventInsertFromSql, eventInsertSql, eventPayload, type EventActor } from "./uc-events.ts";
import { enqueueForLsMembersSql } from "./uc-notifications.ts";
import { bellPrefix } from "../../uc/notify/dedupe.ts";
import { createCaseFromTemplate, type TemplateRef } from "./uc-templates.ts";
import { UC_ERROR_MESSAGES, runUcBatch, type UcExecutor, type UcRow } from "../uc-executor.ts";

// ── Aiuti condivisi ───────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const LS_ROLES_SQL = LS_CASE_ROLES.map((r) => `'${r}'`).join(", ");

/**
 * Contesto di un comando su un caso. `actor` è chi agisce (per l'utente con i
 * ruoli che valgono adesso); `user` serve a ricalcolare «è Lateral Space» nelle
 * funzioni pure; `lsDomains` sono i domini di `UC_LS_EMAIL_DOMAINS`.
 */
export interface UcCommandContext {
  workspaceId: string;
  caseId: string;
  actor: Actor;
  user: UserContext | null;
  lsDomains: readonly string[];
  now?: Date;
}

/** Ruoli dell'attore utente, oppure nessuno. */
export function actorRoles(ctx: Pick<UcCommandContext, "actor">): CaseRole[] {
  return ctx.actor.type === "utente" ? [...ctx.actor.roles] : [];
}

export function actorUserId(ctx: Pick<UcCommandContext, "actor">): string | null {
  return ctx.actor.type === "utente" ? ctx.actor.userId : null;
}

/** Firmatario da account: l'utente del comando con i suoi ruoli. */
export function accountSigner(ctx: UcCommandContext): Result<Signer> {
  if (ctx.actor.type !== "utente" || !ctx.user || ctx.user.userId !== ctx.actor.userId) {
    return fail("attore_non_ammesso", "Per firmare serve un account.");
  }
  return ok({ kind: "account", user: ctx.user, roles: ctx.actor.roles });
}

const UNIQUE_VIOLATION = "23505";

function pgCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string") return (error as { code: string }).code;
  return null;
}

/**
 * Esegue un batch del comando. `uc:<codice>` diventa un esito; due scritture
 * concorrenti che si scontrano su un vincolo unico diventano `conflitto`.
 */
export async function runCommand(executor: UcExecutor, statements: readonly UcStatement[], messages: Readonly<Record<string, string>> = {}): Promise<Result<UcRow[][]>> {
  try {
    const r = await runUcBatch(executor, statements);
    if (!r.ok) return fail(r.code, messages[r.code] ?? r.message);
    return ok(r.rows);
  } catch (error) {
    if (pgCode(error) === UNIQUE_VIOLATION) return fail("conflitto", UC_ERROR_MESSAGES.conflitto);
    throw error;
  }
}

/** Testi scritti da Lateral Space (descrizione, ROI, commenti, voci): niente dati sanitari, discriminatori o personali. */
export function checkLsText(payload: unknown, context: "testo_ls" | "commento" = "testo_ls"): Result<void> {
  const scan = scanPayload(payload as Json, { context });
  if (scan.truncated) return fail("testo_troppo_lungo", "Il testo è troppo lungo o troppo annidato.");
  const first = scan.blocking[0];
  if (first) return fail(`testo_${first.category}`, findingMessage(first.category));
  return ok(undefined);
}

/** Contesto utente da `users` (email verificata, dominio Lateral Space). */
export async function loadUserContext(executor: UcExecutor, userId: string, lsDomains: readonly string[]): Promise<UserContext | null> {
  if (!isUuid(userId)) return null;
  const [[row]] = await executor.batch([toStatement(ucSql`SELECT id, email, email_verified FROM users WHERE id = ${cast(userId, "uuid")}`)]);
  if (!row) return null;
  return userContextFrom({ id: String(row.id), email: rowString(row.email), emailVerified: (row.email_verified as Date | string | null) ?? null }, lsDomains);
}

/** Ruoli salvati e ruoli che valgono adesso per l'utente nel caso. */
export async function loadCaseRoles(executor: UcExecutor, caseId: string, user: UserContext, lsDomains: readonly string[]): Promise<{ stored: CaseRole[]; effective: CaseRole[] }> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT role FROM uc_case_members WHERE case_id = ${cast(caseId, "uuid")} AND user_id = ${cast(user.userId, "uuid")}`),
  ]);
  const stored = rows.map((r) => r.role).filter((r): r is CaseRole => isVocab(CASE_ROLES, r));
  return { stored, effective: stored.filter((r) => caseRoleAllowedFor(user, r, lsDomains)) };
}

/** Contesto di un comando per gli script e i test: ruoli ricalcolati dal database. */
export async function commandContextFor(
  executor: UcExecutor,
  i: { workspaceId: string; caseId: string; userId: string; lsDomains: readonly string[]; now?: Date },
): Promise<Result<UcCommandContext>> {
  const user = await loadUserContext(executor, i.userId, i.lsDomains);
  if (!user) return fail("utente_non_trovato", "Utente non trovato.");
  const roles = await loadCaseRoles(executor, i.caseId, user, i.lsDomains);
  return ok({ workspaceId: i.workspaceId, caseId: i.caseId, actor: { type: "utente", userId: user.userId, roles: roles.effective }, user, lsDomains: i.lsDomains, now: i.now });
}

/** Email dei membri Lateral Space del caso e contatti designati: il contesto delle firme. */
export async function loadSignatureContext(executor: UcExecutor, core: CaseCore, lsDomains: readonly string[]): Promise<SignatureContext> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT DISTINCT u.email FROM uc_case_members m JOIN users u ON u.id = m.user_id
WHERE m.case_id = ${cast(core.id, "uuid")} AND m.role IN (${raw(LS_ROLES_SQL)}) AND u.email IS NOT NULL`),
  ]);
  return { lsDomains, lsMemberEmails: rows.map((r) => String(r.email)), designated: { ...core.designated } };
}

/** Riga del caso (completo, del workspace). */
export async function loadCaseCore(executor: UcExecutor, workspaceId: string, caseId: string): Promise<CaseCore | null> {
  if (!isUuid(workspaceId) || !isUuid(caseId)) return null;
  const [rows] = await executor.batch([caseCoreSql(workspaceId, caseId)]);
  return parseCaseCore(rows[0]);
}

const CASE_NOT_FOUND = "Caso non trovato.";

/** Il caso non è chiuso (guardia nei batch che non toccano il catalogo). */
function caseOpenSql(workspaceId: string, caseId: string): UcStatement {
  return toStatement(ucSql`SELECT uc_require(EXISTS (
  SELECT 1 FROM uc_cases WHERE id = ${cast(caseId, "uuid")} AND workspace_id = ${cast(workspaceId, "uuid")} AND setup_completed_at IS NOT NULL AND status <> 'chiuso'
), 'caso_chiuso') AS ok`);
}

const CASE_MESSAGES: Readonly<Record<string, string>> = {
  caso_chiuso: "Il caso è chiuso: non si modifica più.",
  gia_membro: "Questa persona ha già questo ruolo nel caso.",
  non_membro: "Questa persona non ha questo ruolo nel caso.",
  ultimo_ls_lead: "Indica prima un altro Responsabile del caso.",
  a8_non_sciolto: "La zona personale resta chiusa finché la scheda A.8 non è approvata.",
};

/** File di prova del caso utilizzabile (pulito e scansionato o revisionato). */
export async function usableCaseFile(executor: UcExecutor, caseId: string, fileId: string | null | undefined): Promise<boolean> {
  if (!isUuid(fileId)) return false;
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT id FROM uc_files WHERE id = ${cast(fileId, "uuid")} AND case_id = ${cast(caseId, "uuid")} AND deleted_at IS NULL
  AND scan_status = 'pulito' AND (content_scanned OR reviewed_at IS NOT NULL)`),
  ]);
  return Boolean(row);
}

// ── Prontezza ─────────────────────────────────────────────────────────

export interface LoadedReadiness {
  input: ReadinessInput;
  readiness: Readiness;
  g1: GateComputation;
  coverage: LiteralCoverage;
}

/** Prontezza dal vivo (revisione letta per prima, nella stessa transazione). */
export async function loadCaseReadiness(executor: UcExecutor, workspaceId: string, caseId: string, now = new Date()): Promise<LoadedReadiness | null> {
  if (!isUuid(workspaceId) || !isUuid(caseId)) return null;
  const rows = await executor.batch(readinessReadStatements(workspaceId, caseId));
  const input = parseReadinessRows(rows);
  if (!input) return null;
  return { input, ...computeCaseReadiness(input, now) };
}

/** Aggiorna la cache `uc_cases.readiness` (dopo ogni comando, in `after()`, e ogni notte). */
export async function refreshReadinessCache(executor: UcExecutor, workspaceId: string, caseId: string, now = new Date()): Promise<Readiness | null> {
  const live = await loadCaseReadiness(executor, workspaceId, caseId, now);
  if (!live) return null;
  await executor.batch([readinessCacheSql(caseId, live.readiness)]);
  return live.readiness;
}

// ── Creazione ─────────────────────────────────────────────────────────

export interface PortfolioCardForCase {
  id: string;
  title: string;
  description: string | null;
  status: string;
  /** `portfolio_kind`, «Da costruire» (`use_case_ai`) se vuoto, come per le righe di Activity mapping. */
  kind: string;
  existingCase: { id: string; code: string } | null;
}

/** Scheda di portafoglio per «Avvia caso d'uso» (precompila il nome; dice se un caso esiste già). */
export async function getPortfolioCardForCase(executor: UcExecutor, workspaceId: string, useCaseId: string): Promise<PortfolioCardForCase | null> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId)) return null;
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT u.id, u.title, u.description, u.status::text AS status, coalesce(u.portfolio_kind, 'use_case_ai') AS kind,
  (SELECT jsonb_build_object('id', c.id, 'code', c.code) FROM uc_cases c
   WHERE c.portfolio_use_case_id = u.id AND c.workspace_id = u.workspace_id AND c.setup_completed_at IS NOT NULL
   ORDER BY c.created_at LIMIT 1) AS existing_case
FROM use_cases u WHERE u.id = ${cast(useCaseId, "uuid")} AND u.workspace_id = ${cast(workspaceId, "uuid")}`),
  ]);
  if (!row) return null;
  const existing = rowObject(row.existing_case);
  return {
    id: String(row.id),
    title: String(row.title),
    description: rowString(row.description),
    status: String(row.status),
    kind: String(row.kind ?? "use_case_ai"),
    existingCase: typeof existing.id === "string" && typeof existing.code === "string" ? { id: existing.id, code: existing.code } : null,
  };
}

export const CreateCaseInputSchema = z.object({
  templateId: z.string().regex(UUID, "Scegli un template."),
  code: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/, "Il codice usa lettere maiuscole, cifre e trattini (2–40 caratteri).")),
  title: z.string().trim().min(3, "Scrivi il nome del caso.").max(255),
  oneLiner: z.string().trim().max(500).nullish(),
  perimeterLabel: z.string().trim().max(255).nullish(),
  levers: z.array(z.enum(LEVERS)).max(LEVERS.length).optional(),
  portfolioUseCaseId: z.string().regex(UUID).nullish(),
  gatePolicyScope: z.enum(GATE_POLICY_SCOPES).optional(),
});
export type CreateCaseInput = z.input<typeof CreateCaseInputSchema>;

/**
 * Crea un caso in bozza dal template (§4.6). Chi crea è un utente Lateral Space
 * con `canReviewWorkspacePortfolio` e diventa ls_lead. Da una scheda di
 * portafoglio si parte solo se è accettata, «Da costruire» e non ha già un caso
 * (docs/use-case/DESIGN.md §6.5, controllato anche qui come in
 * `startRealization`): una best practice non ha un dossier.
 */
export async function createCase(
  executor: UcExecutor,
  i: { workspaceId: string; user: UserContext; canReviewWorkspacePortfolio: boolean; input: unknown; now?: () => Date },
): Promise<Result<{ caseId: string; code: string }>> {
  const creator = checkCaseCreator({ user: i.user, canReviewWorkspacePortfolio: i.canReviewWorkspacePortfolio });
  if (!creator.ok) return creator;
  const parsed = CreateCaseInputSchema.safeParse(i.input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Controlla i dati del caso.");
  const v = parsed.data;
  const text = checkLsText({ title: v.title, one_liner: v.oneLiner ?? "", perimeter: v.perimeterLabel ?? "" });
  if (!text.ok) return text;
  if (v.portfolioUseCaseId) {
    const card = await getPortfolioCardForCase(executor, i.workspaceId, v.portfolioUseCaseId);
    if (!card) return fail("scheda_non_trovata", "La scheda di portafoglio non è di questo workspace.");
    if (card.kind === "best_practice") return fail("best_practice", "Una best practice non ha un dossier: si segna come diffusa.");
    if (card.status !== "accepted" || card.kind !== "use_case_ai") return fail("scheda_non_accettata", "La realizzazione parte solo da uno use case «Da costruire» approvato.");
    if (card.existingCase) return fail("caso_gia_avviato", `Questa scheda ha già il caso d'uso ${card.existingCase.code}.`);
  }
  const template: TemplateRef = { templateId: v.templateId };
  const created = await createCaseFromTemplate(executor, {
    workspaceId: i.workspaceId,
    template,
    actorUserId: i.user.userId,
    code: v.code,
    title: v.title,
    oneLiner: v.oneLiner ?? null,
    perimeterLabel: v.perimeterLabel ?? null,
    levers: (v.levers ?? []) as Lever[],
    portfolioUseCaseId: v.portfolioUseCaseId ?? null,
    gatePolicyScope: v.gatePolicyScope,
    now: i.now,
  });
  if (!created.ok) return created;
  return ok({ caseId: created.value.caseId, code: created.value.code });
}

// ── Elenco e testata ──────────────────────────────────────────────────

export interface CaseListEntry {
  id: string;
  code: string;
  title: string;
  status: CaseStatus;
  templateKey: string;
  templateName: string;
  templateVersion: string;
  /** Cache `uc_cases.readiness` (solo conteggi). */
  readiness: Readiness | null;
  nextMilestone: MilestoneSummary | null;
  roles: CaseRole[];
  /** Non membro: vede il caso in sola lettura perché gestisce il workspace. */
  implicitObserver: boolean;
  updatedAt: string | null;
}

export interface MilestoneSummary {
  key: string;
  title: string;
  plannedDate: string | null;
  plannedLabel: string | null;
  isProposal: boolean;
  toConfirm: boolean;
}

function milestoneFrom(raw: unknown): MilestoneSummary | null {
  const m = rowObject(raw);
  if (typeof m.key !== "string" || typeof m.title !== "string") return null;
  return {
    key: m.key,
    title: m.title,
    plannedDate: typeof m.planned_date === "string" ? m.planned_date : null,
    plannedLabel: typeof m.planned_label === "string" ? m.planned_label : null,
    isProposal: m.is_proposal === true,
    toConfirm: m.to_confirm === true,
  };
}

const NEXT_MILESTONE = raw(`(SELECT jsonb_build_object('key', ms.key, 'title', ms.title, 'planned_date', ms.planned_date::text, 'planned_label', ms.planned_label,
    'is_proposal', ms.is_proposal, 'to_confirm', ms.to_confirm)
   FROM uc_milestones ms WHERE ms.case_id = c.id AND ms.done_at IS NULL ORDER BY ms.sort_order, ms.planned_date NULLS LAST, ms.key LIMIT 1)`);

/**
 * Casi che l'utente vede: quelli di cui è membro; chi gestisce il workspace vede
 * anche gli altri, come osservatore. I casi in creazione non compaiono mai.
 */
export async function listCases(
  executor: UcExecutor,
  i: { workspaceId: string; user: UserContext; canManageWorkspaceSettings: boolean; lsDomains: readonly string[] },
): Promise<CaseListEntry[]> {
  if (!isUuid(i.workspaceId)) return [];
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT c.id, c.code, c.title, c.status, c.template_version, t.key AS template_key, t.name AS template_name, c.readiness, c.updated_at,
  ${NEXT_MILESTONE} AS next_milestone,
  coalesce((SELECT jsonb_agg(DISTINCT m.role) FROM uc_case_members m WHERE m.case_id = c.id AND m.user_id = ${cast(i.user.userId, "uuid")}), '[]'::jsonb) AS roles
FROM uc_cases c JOIN uc_templates t ON t.id = c.template_id
WHERE c.workspace_id = ${cast(i.workspaceId, "uuid")} AND c.setup_completed_at IS NOT NULL
  AND (${cast(i.canManageWorkspaceSettings, "boolean")} OR EXISTS (SELECT 1 FROM uc_case_members m WHERE m.case_id = c.id AND m.user_id = ${cast(i.user.userId, "uuid")}))
ORDER BY c.status = 'chiuso', c.updated_at DESC`),
  ]);
  return rows.map((r) => {
    const stored = rowStringArray(rowJson(r.roles)).filter((x): x is CaseRole => isVocab(CASE_ROLES, x));
    const effective = stored.filter((x) => caseRoleAllowedFor(i.user, x, i.lsDomains));
    const readiness = rowJson<Readiness>(r.readiness);
    return {
      id: String(r.id),
      code: String(r.code),
      title: String(r.title),
      status: String(r.status) as CaseStatus,
      templateKey: String(r.template_key),
      templateName: String(r.template_name),
      templateVersion: String(r.template_version),
      readiness: readiness && typeof readiness === "object" ? readiness : null,
      nextMilestone: milestoneFrom(r.next_milestone),
      roles: effective.length > 0 ? effective : ["osservatore"],
      implicitObserver: stored.length === 0,
      updatedAt: rowDate(r.updated_at)?.toISOString() ?? null,
    };
  });
}

export interface CaseOverview {
  case: {
    id: string;
    code: string;
    title: string;
    oneLiner: string | null;
    status: CaseStatus;
    statusBeforeSuspension: CaseStatus | null;
    statusChangedAt: string | null;
    perimeterLabel: string | null;
    levers: Lever[];
    templateKey: string;
    templateName: string;
    templateVersion: string;
    /** «Caso d'uso · <cliente>»: il nome del workspace. */
    clientLabel: string;
    organizationName: string | null;
    /** Contatto Owner, etichetta di ruolo o «Owner da indicare». */
    ownerLabel: string;
    ownerDesignated: boolean;
    privacyApproverDesignated: boolean;
    contractRefs: number;
    catalogVersion: number;
    catalogRevision: number;
    dataMode: string;
    aiEnvironmentApproved: boolean;
    gatePolicy: { scope: GatePolicyScope; confirmed: boolean };
    portfolioUseCaseId: string | null;
  };
  readiness: Readiness;
  g1: GateComputation;
  coverage: LiteralCoverage;
  gateLine: string;
  blockers: { id: string; key: string; label: string; status: CaseBlockerRow["status"]; items: number; waitingForClient: boolean }[];
  nextMilestone: MilestoneSummary | null;
  pendingGateReview: { id: string; gate: string; proposedAt: string | null; summaryTextHash: string; signatures: { ruolo: string; at: string; metodo: string }[]; writtenEvidence: boolean } | null;
  /** Voci dei moduli non ancora a posto, per ruolo titolare: solo conteggi, in ordine alfabetico. */
  openByRole: { label: string; open: number }[];
  /** Stati verso cui l'utente può portare il caso adesso (il motivo si chiede dopo). */
  allowedTransitions: CaseStatus[];
}

const OWNER_TO_INDICATE = "Owner da indicare";

function roleLabels(templateRoles: unknown, settings: Record<string, Json>): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rowJson<unknown[]>(templateRoles) ?? []) {
    if (r && typeof r === "object" && typeof (r as Record<string, unknown>).key === "string") {
      const role = r as Record<string, unknown>;
      out.set(String(role.key), typeof role.label === "string" ? role.label : String(role.key));
    }
  }
  const fromSeed = settings.role_labels;
  if (fromSeed && typeof fromSeed === "object" && !Array.isArray(fromSeed)) {
    for (const [k, v] of Object.entries(fromSeed)) if (typeof v === "string" && v.trim()) out.set(k, v);
  }
  return out;
}

/**
 * Testata del caso e Avanzamento: stato, perimetro, Owner, prontezza dal vivo
 * (barra e G1), blocchi, prossima milestone, proposta di gate aperta, voci aperte
 * per ruolo e cambi di stato ammessi per l'utente. Mai valori delle risposte.
 */
export async function getCaseOverview(executor: UcExecutor, ctx: UcCommandContext): Promise<CaseOverview | null> {
  if (!isUuid(ctx.workspaceId) || !isUuid(ctx.caseId)) return null;
  const now = ctx.now ?? new Date();
  const parts = templatePartsReader();
  const rows = await executor.batch([
    ...readinessReadStatements(ctx.workspaceId, ctx.caseId),
    toStatement(ucSql`SELECT c.one_liner, c.perimeter_label, c.levers, c.client_owner_role_label, c.data_mode, c.updated_at,
  t.key AS template_key, t.name AS template_name, ${parts.columns},
  w.name AS workspace_name, o.name AS organization_name, oc.display_name AS owner_name,
  ${NEXT_MILESTONE} AS next_milestone,
  (SELECT jsonb_build_object('id', g.id, 'gate', g.gate_key, 'proposed_at', g.proposed_at, 'summary_text_hash', g.summary_text_hash,
     'approvals', g.approvals, 'written_evidence', g.written_evidence_file_id IS NOT NULL)
   FROM uc_gate_reviews g WHERE g.case_id = c.id AND g.decision = 'proposto' ORDER BY g.created_at DESC LIMIT 1) AS pending_review,
  EXISTS (SELECT 1 FROM uc_gate_reviews g WHERE g.case_id = c.id AND g.gate_key = 'G1' AND g.decision IN ('approvato', 'approvato_con_riserva')) AS g1_approved
FROM uc_cases c
JOIN uc_templates t ON t.id = c.template_id
JOIN workspaces w ON w.id = c.workspace_id
LEFT JOIN organizations o ON o.id = c.organization_id
LEFT JOIN uc_contacts oc ON oc.id = c.client_owner_contact_id
WHERE c.id = ${cast(ctx.caseId, "uuid")} AND c.workspace_id = ${cast(ctx.workspaceId, "uuid")}`),
  ]);
  const input = parseReadinessRows(rows);
  const extra = rows[5]?.[0];
  if (!input || !extra) return null;
  const live = computeCaseReadiness(input, now);
  const core = input.core;
  const labels = roleLabels(parts.read(extra)?.roles ?? [], core.settings);
  const openByRole = openCountsByAssignee(
    input.items
      .filter((x) => x.requestModuleKey !== null)
      .map((x) => ({ assigneeLabel: x.ownerRoleKey ? (labels.get(x.ownerRoleKey) ?? x.ownerRoleKey) : null, ok: isItemOk(x, "G1", now).ok })),
  );
  const pending = rowObject(extra.pending_review);
  const signatures = (Array.isArray(pending.approvals) ? pending.approvals : [])
    .filter((a): a is Record<string, Json> => !!a && typeof a === "object" && !Array.isArray(a))
    .map((a) => ({ ruolo: String(a.ruolo ?? ""), at: String(a.at ?? ""), metodo: String(a.metodo ?? "") }));
  const ownerLabel = rowString(extra.owner_name) ?? rowString(extra.client_owner_role_label) ?? OWNER_TO_INDICATE;
  return {
    case: {
      id: core.id,
      code: core.code,
      title: core.title,
      oneLiner: rowString(extra.one_liner),
      status: core.status,
      statusBeforeSuspension: core.statusBeforeSuspension,
      statusChangedAt: core.statusChangedAt?.toISOString() ?? null,
      perimeterLabel: rowString(extra.perimeter_label),
      levers: rowStringArray(rowJson(extra.levers)).filter((l): l is Lever => isVocab(LEVERS, l)),
      templateKey: String(extra.template_key),
      templateName: String(extra.template_name),
      templateVersion: core.templateVersion,
      clientLabel: String(extra.workspace_name),
      organizationName: rowString(extra.organization_name),
      ownerLabel,
      ownerDesignated: core.designated.owner !== null,
      privacyApproverDesignated: core.designated.privacy !== null,
      contractRefs: core.contractRefs.length,
      catalogVersion: core.catalogVersion,
      catalogRevision: core.catalogRevision,
      dataMode: String(extra.data_mode),
      aiEnvironmentApproved: core.aiEnvironmentApproved,
      gatePolicy: { scope: core.policy.scope, confirmed: core.policy.confirmed !== null },
      portfolioUseCaseId: core.portfolioUseCaseId,
    },
    readiness: live.readiness,
    g1: live.g1,
    coverage: live.coverage,
    gateLine: gateLineText(live.g1),
    blockers: input.blockers.map((b) => ({
      id: b.id,
      key: b.key,
      label: b.label,
      status: b.status,
      items: b.items,
      waitingForClient: b.key === A8_BLOCKER_KEY && b.status === "attivo" && b.approvals.length > 0,
    })),
    nextMilestone: milestoneFrom(extra.next_milestone),
    pendingGateReview:
      typeof pending.id === "string"
        ? {
            id: pending.id,
            gate: String(pending.gate),
            proposedAt: typeof pending.proposed_at === "string" ? pending.proposed_at : null,
            summaryTextHash: String(pending.summary_text_hash),
            signatures,
            writtenEvidence: pending.written_evidence === true,
          }
        : null,
    openByRole,
    allowedTransitions: allowedCaseTransitions(core, ctx, rowBool(extra.g1_approved), now),
  };
}

function allowedCaseTransitions(core: CaseCore, ctx: UcCommandContext, g1Approved: boolean, now: Date): CaseStatus[] {
  return nextCaseStatuses(core.status, core.statusBeforeSuspension).filter(
    (to) =>
      checkCaseTransition({
        from: core.status,
        to,
        actor: ctx.actor,
        user: ctx.user,
        reason: "motivo",
        approvedGates: new Set(g1Approved ? ["G1"] : []),
        enteredAt: core.statusChangedAt,
        now,
        availableGates: MVP_AVAILABLE_GATES,
        statusBeforeSuspension: core.statusBeforeSuspension,
      }).ok,
  );
}

// ── Stato del caso ────────────────────────────────────────────────────

const TransitionCaseSchema = z.object({
  to: z.enum(["bozza", "raccolta", "pronto_sviluppo", "in_sviluppo", "backtest", "collaudo", "stabilizzazione", "in_esercizio", "misura_roi", "sospeso", "chiuso"]),
  reason: z.string().trim().max(2000).nullish(),
});

/**
 * Cambio di stato del caso (§3.4). La chiusura revoca nello stesso batch le
 * richieste vive (voci `chiesta` → `da_chiedere`, riga 31), i link, la coda e i
 * token MCP del caso; la sospensione ferma la coda, la ripresa la libera. Il
 * passaggio a pronto_sviluppo avviene solo con l'approvazione di G1 (`signGate`).
 */
export async function transitionCase(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ status: CaseStatus }>> {
  const parsed = TransitionCaseSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Scegli lo stato e, se serve, scrivi il motivo.");
  const now = ctx.now ?? new Date();
  const [caseRows, gateRows] = await executor.batch([
    caseCoreSql(ctx.workspaceId, ctx.caseId),
    toStatement(ucSql`SELECT DISTINCT gate_key FROM uc_gate_reviews WHERE case_id = ${cast(ctx.caseId, "uuid")} AND decision IN ('approvato', 'approvato_con_riserva')`),
  ]);
  const core = parseCaseCore(caseRows[0]);
  if (!core) return fail("non_trovato", CASE_NOT_FOUND);
  if (parsed.data.reason) {
    const text = checkLsText({ reason: parsed.data.reason });
    if (!text.ok) return text;
  }
  const checked = checkCaseTransition({
    from: core.status,
    to: parsed.data.to,
    actor: ctx.actor,
    user: ctx.user,
    reason: parsed.data.reason ?? null,
    approvedGates: new Set(gateRows.map((r) => String(r.gate_key)) as ("G1" | "G2" | "G3" | "G4")[]),
    enteredAt: core.statusChangedAt,
    now,
    availableGates: MVP_AVAILABLE_GATES,
    statusBeforeSuspension: core.statusBeforeSuspension,
  });
  if (!checked.ok) return checked;
  const eventActor = eventActorFrom(ctx.actor);
  const statements: UcStatement[] = [
    caseTransitionSql({
      workspaceId: ctx.workspaceId,
      caseId: ctx.caseId,
      from: core.status,
      statusBeforeSuspension: core.statusBeforeSuspension,
      patch: checked.value.patch,
      actor: eventActor,
    }),
  ];
  for (const effect of checked.value.sideEffects) {
    switch (effect) {
      case "revoca_richieste": {
        const [itemRows] = await executor.batch([itemSnapshotsSql(ctx.caseId, { statuses: ["chiesta"] })]);
        const items = new Map(itemRows.map((r) => rowToLoadedItem(r)).map((l) => [l.snapshot.id, l.snapshot]));
        if (items.size > 0) {
          const planned = planItemTransitions({
            items,
            requests: [...items.keys()].map((itemId) => ({ itemId, to: "da_chiedere" as const, trigger: "richiesta_revocata" as const, reason: "Caso chiuso" })),
            actor: ctx.actor,
            user: ctx.user,
            now,
            case: { status: core.status, statusBeforeSuspension: core.statusBeforeSuspension },
          });
          if (!planned.ok) return planned;
          statements.push(...transitionStatements({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor: ctx.actor, planned: planned.value }));
        }
        statements.push(
          releaseCaseRequestItemsSql(ctx.caseId),
          revokeCaseRequestsSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, actor: eventActor, reasonCode: "caso_chiuso" }),
          revokeCaseTokensSql(ctx.caseId),
        );
        break;
      }
      case "annulla_coda":
        statements.push(cancelCaseNotificationsSql(ctx.caseId));
        break;
      case "revoca_token_mcp":
        statements.push(revokeCaseMcpTokensSql(ctx.workspaceId, ctx.caseId));
        break;
      case "ferma_invii":
        statements.push(holdCaseNotificationsSql(ctx.caseId));
        break;
      case "riprendi_invii":
        statements.push(releaseCaseNotificationsSql(ctx.caseId));
        break;
      case "portafoglio_implementato":
        statements.push(portfolioStatusSql({ workspaceId: ctx.workspaceId, caseId: ctx.caseId, from: "in_progress", to: "implemented" }));
        break;
      default:
        // congela_catalogo, portafoglio_in_corso, notifica_team: solo dall'approvazione di G1.
        return fail("transizione_non_ammessa", "Questo cambio di stato avviene solo con l'approvazione del gate.");
    }
  }
  const run = await runCommand(executor, statements, CASE_MESSAGES);
  if (!run.ok) return run;
  return ok({ status: checked.value.patch.status });
}

// ── Membri ────────────────────────────────────────────────────────────

const MemberSchema = z.object({ userId: z.string().regex(UUID), role: z.enum(CASE_ROLES) });

/** Collaboratore del workspace (non solo partecipante ai corsi). */
function collaboratorSql(workspaceId: string, userId: string): UcStatement {
  return toStatement(ucSql`SELECT EXISTS (
  SELECT 1 FROM workspaces w WHERE w.id = ${cast(workspaceId, "uuid")} AND (
    EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = w.organization_id AND m.user_id = ${cast(userId, "uuid")} AND m.role::text <> 'learner')
    OR EXISTS (SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.user_id = ${cast(userId, "uuid")} AND wm.role::text <> 'learner'))
) AS ok`);
}

/**
 * Aggiunge un ruolo di caso a un collaboratore del workspace (solo ls_lead).
 * Ruoli `ls_*` solo a persone di Lateral Space, ruoli del cliente solo alle
 * altre, mai insieme sulla stessa persona (`assertMemberRoles`).
 */
export async function addCaseMember(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ userId: string; role: CaseRole }>> {
  if (!can(actorRoles(ctx), "gestire_membri")) return fail("attore_non_ammesso", "Solo il Responsabile del caso gestisce i membri.");
  const parsed = MemberSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Scegli la persona e il ruolo.");
  const { userId, role } = parsed.data;
  const [[collaborator]] = await executor.batch([collaboratorSql(ctx.workspaceId, userId)]);
  if (!rowBool(collaborator?.ok)) return fail("non_collaboratore", "La persona deve essere un collaboratore del workspace.");
  const target = await loadUserContext(executor, userId, ctx.lsDomains);
  if (!target) return fail("utente_non_trovato", "Utente non trovato.");
  const roles = await loadCaseRoles(executor, ctx.caseId, target, ctx.lsDomains);
  if (roles.stored.includes(role)) return fail("gia_membro", CASE_MESSAGES.gia_membro);
  const allowed = assertMemberRoles(target, [...roles.stored, role], ctx.lsDomains);
  if (!allowed.ok) return allowed;
  const c = cast(ctx.caseId, "uuid");
  const run = await runCommand(
    executor,
    [
      caseOpenSql(ctx.workspaceId, ctx.caseId),
      toStatement(
        requireRows(
          ucSql`INSERT INTO uc_case_members (case_id, user_id, role, added_by_user_id)
VALUES (${c}, ${cast(userId, "uuid")}, ${cast(role, "text")}, ${cast(actorUserId(ctx), "uuid")})
ON CONFLICT (case_id, user_id, role) DO NOTHING RETURNING id`,
          1,
          "gia_membro",
        ),
      ),
      ...(role === "ls_lead"
        ? [toStatement(ucSql`UPDATE uc_cases SET ls_lead_user_id = coalesce(ls_lead_user_id, ${cast(userId, "uuid")}), updated_at = now() WHERE id = ${c}`)]
        : []),
      toStatement(
        eventInsertSql({
          type: "membro.aggiunto",
          workspaceId: ctx.workspaceId,
          caseId: ctx.caseId,
          actor: eventActorFrom(ctx.actor),
          targetType: "membro",
          targetId: userId,
          payload: { role },
        }),
      ),
    ],
    CASE_MESSAGES,
  );
  return run.ok ? ok({ userId, role }) : run;
}

/**
 * Toglie un ruolo di caso (solo ls_lead; mai l'ultimo ls_lead). Se la persona
 * non ha più ruoli nel caso, i link che aveva copiato si revocano e le sue firme
 * in attesa si tolgono; senza ruoli Lateral Space perde la zona personale.
 */
export async function removeCaseMember(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ userId: string; role: CaseRole }>> {
  if (!can(actorRoles(ctx), "gestire_membri")) return fail("attore_non_ammesso", "Solo il Responsabile del caso gestisce i membri.");
  const parsed = MemberSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Scegli la persona e il ruolo.");
  const { userId, role } = parsed.data;
  const c = cast(ctx.caseId, "uuid");
  const u = cast(userId, "uuid");
  const [rows] = await executor.batch([toStatement(ucSql`SELECT role FROM uc_case_members WHERE case_id = ${c} AND user_id = ${u}`)]);
  const stored = rows.map((r) => String(r.role));
  if (!stored.includes(role)) return fail("non_membro", CASE_MESSAGES.non_membro);
  const remaining = stored.filter((r) => r !== role);
  const keepsLs = remaining.some((r) => (LS_CASE_ROLES as readonly string[]).includes(r));
  const statements: UcStatement[] = [caseOpenSql(ctx.workspaceId, ctx.caseId)];
  if (role === "ls_lead") {
    statements.push(
      toStatement(ucSql`SELECT uc_require((SELECT count(*) FROM uc_case_members WHERE case_id = ${c} AND role = 'ls_lead' AND user_id <> ${u}) >= 1, 'ultimo_ls_lead') AS ok`),
    );
  }
  statements.push(
    toStatement(requireRows(ucSql`DELETE FROM uc_case_members WHERE case_id = ${c} AND user_id = ${u} AND role = ${cast(role, "text")} RETURNING id`, 1, "non_membro")),
    toStatement(ucSql`UPDATE uc_cases SET ls_lead_user_id = (SELECT m.user_id FROM uc_case_members m WHERE m.case_id = ${c} AND m.role = 'ls_lead' ORDER BY m.created_at LIMIT 1), updated_at = now()
WHERE id = ${c} AND ls_lead_user_id = ${u}`),
  );
  if (!keepsLs) statements.push(toStatement(ucSql`UPDATE uc_case_members SET personal_zone_access = false, personal_zone_grant = NULL WHERE case_id = ${c} AND user_id = ${u}`));
  if (remaining.length === 0) {
    statements.push(
      toStatement(ucSql`UPDATE uc_request_tokens SET revoked_at = now() WHERE case_id = ${c} AND issued_by_user_id = ${u} AND revoked_at IS NULL`),
      ...dropPendingApprovalsSql({ scope: { caseId: ctx.caseId }, match: { userId } }),
    );
  }
  statements.push(
    toStatement(
      eventInsertSql({
        type: "membro.rimosso",
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        actor: eventActorFrom(ctx.actor),
        targetType: "membro",
        targetId: userId,
        payload: { role },
      }),
    ),
  );
  const run = await runCommand(executor, statements, CASE_MESSAGES);
  return run.ok ? ok({ userId, role }) : run;
}

const MEMBER_REMOVAL_TABLES = ["uc_cases", "uc_case_members", "uc_request_tokens", "uc_items", "uc_gate_reviews", "uc_blockers", "uc_notifications", "uc_events"];

/**
 * Le tabelle uc toccate dalla rimozione di un membro esistono? Il codice
 * esistente le tocca solo così (PIANO §5.2): il self-heal uc parte solo dalle
 * query uc, quindi qui le tabelle possono mancare.
 */
export async function ucMemberTablesPresent(executor: UcExecutor): Promise<boolean> {
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT count(*) = ${cast(MEMBER_REMOVAL_TABLES.length, "int")} AS ok FROM unnest(${cast(MEMBER_REMOVAL_TABLES, "text[]")}) AS t(name)
WHERE to_regclass('public.' || t.name) IS NOT NULL`),
  ]);
  return rowBool(row?.ok);
}

/**
 * Rimozione di una persona dal workspace (`removeWorkspaceMemberAction`): perde
 * ogni ruolo nei casi del workspace, i link dei referenti che aveva copiato si
 * revocano e le sue firme in attesa si tolgono. Restituisce i casi non chiusi
 * rimasti senza ls_lead («Caso <codice>: ls_lead da indicare»): per loro la
 * campanella avvisa gli altri membri Lateral Space.
 */
export async function removeUserFromWorkspaceCases(
  executor: UcExecutor,
  i: { workspaceId: string; userId: string; actorUserId: string; now?: Date },
): Promise<{ removedRoles: number; casesWithoutLead: { caseId: string; code: string }[] }> {
  if (!isUuid(i.workspaceId) || !isUuid(i.userId)) return { removedRoles: 0, casesWithoutLead: [] };
  const now = i.now ?? new Date();
  const ws = cast(i.workspaceId, "uuid");
  const u = cast(i.userId, "uuid");
  const [orphanRows] = await executor.batch([
    toStatement(ucSql`SELECT c.id, c.code FROM uc_cases c
WHERE c.workspace_id = ${ws} AND c.status <> 'chiuso' AND c.setup_completed_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM uc_case_members m WHERE m.case_id = c.id AND m.user_id = ${u} AND m.role = 'ls_lead')
  AND NOT EXISTS (SELECT 1 FROM uc_case_members m WHERE m.case_id = c.id AND m.user_id <> ${u} AND m.role = 'ls_lead')`),
  ]);
  const orphans = orphanRows.map((r) => ({ caseId: String(r.id), code: String(r.code) }));
  // Un evento per ogni ruolo tolto, ciascuno con il suo caso (le righe vengono da più casi).
  const removedEvent = ucSql`INSERT INTO uc_events (workspace_id, case_id, actor_type, actor_user_id, event_type, target_type, target_id, payload)
  SELECT ${ws}, del.case_id, 'utente', ${cast(i.actorUserId, "uuid")}, 'membro.rimosso', 'membro', del.user_id,
    ${jsonb(eventPayload("membro.rimosso", { reason: "rimosso_dal_workspace" }))} || jsonb_build_object('role', del.role)
  FROM del`;
  // Un solo batch: link copiati revocati, ruoli tolti, firme in attesa tolte, ls_lead ricalcolato.
  const [, removed] = await executor.batch([
    toStatement(ucSql`UPDATE uc_request_tokens t SET revoked_at = now() FROM uc_cases c
WHERE t.case_id = c.id AND c.workspace_id = ${ws} AND t.issued_by_user_id = ${u} AND t.revoked_at IS NULL`),
    toStatement(ucSql`WITH del AS (
  DELETE FROM uc_case_members m USING uc_cases c
  WHERE m.case_id = c.id AND c.workspace_id = ${ws} AND m.user_id = ${u}
  RETURNING m.case_id, m.user_id, m.role
), ev AS (${removedEvent})
SELECT count(*)::int AS removed FROM del`),
    ...dropPendingApprovalsSql({ scope: { workspaceId: i.workspaceId }, match: { userId: i.userId } }),
    toStatement(ucSql`UPDATE uc_cases c SET ls_lead_user_id = (SELECT m.user_id FROM uc_case_members m WHERE m.case_id = c.id AND m.role = 'ls_lead' ORDER BY m.created_at LIMIT 1), updated_at = now()
WHERE c.workspace_id = ${ws} AND c.ls_lead_user_id = ${u}`),
    ...orphans.map((o) =>
      toStatement(
        enqueueForLsMembersSql({
          workspaceId: i.workspaceId,
          caseId: o.caseId,
          templateKey: "ls_lead_da_indicare",
          payload: { case_code: o.code },
          dedupeKeyPrefix: bellPrefix.lsLeadDaIndicare(o.caseId, now),
        }),
      ),
    ),
  ]);
  return { removedRoles: rowNumber(removed?.[0]?.removed) ?? 0, casesWithoutLead: orphans };
}

// ── Zona personale ────────────────────────────────────────────────────

async function a8State(executor: UcExecutor, caseId: string): Promise<{ status: CaseBlockerRow["status"] | null; accessUserIds: string[] }> {
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT status, evidence FROM uc_blockers WHERE case_id = ${cast(caseId, "uuid")} AND key = ${cast(A8_BLOCKER_KEY, "text")}`),
  ]);
  if (!row) return { status: null, accessUserIds: [] };
  const evidence = rowObject(row.evidence);
  return {
    status: (row.status as CaseBlockerRow["status"]) ?? null,
    accessUserIds: rowStringArray(evidence.accesso_zona_personale),
  };
}

async function lsMemberRows(executor: UcExecutor, caseId: string, userId: string): Promise<{ roles: CaseRole[]; grant: PersonalZoneGrant | null; access: boolean }> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT role, personal_zone_access, personal_zone_grant FROM uc_case_members
WHERE case_id = ${cast(caseId, "uuid")} AND user_id = ${cast(userId, "uuid")} AND role IN (${raw(LS_ROLES_SQL)}) ORDER BY created_at`),
  ]);
  const grant = rows.map((r) => rowJson<PersonalZoneGrant>(r.personal_zone_grant)).find((g) => g && typeof g === "object") ?? null;
  return { roles: rows.map((r) => r.role as CaseRole), grant, access: rows.some((r) => rowBool(r.personal_zone_access)) };
}

/** Il blocco `a8` è sciolto, con un lucchetto sulla riga: una riattivazione concorrente fa fallire il batch. */
function a8ResolvedLockSql(caseId: string): UcStatement {
  return toStatement(
    requireRows(
      ucSql`UPDATE uc_blockers SET updated_at = updated_at WHERE case_id = ${cast(caseId, "uuid")} AND key = ${cast(A8_BLOCKER_KEY, "text")} AND status = 'sciolto' RETURNING id`,
      1,
      "a8_non_sciolto",
    ),
  );
}

const UserSchema = z.object({ userId: z.string().regex(UUID) });

/** Proposta di accesso alla zona personale (ls_lead, per un'altra persona Lateral Space indicata nella scheda A.8). */
export async function proposePersonalZoneAccess(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ userId: string }>> {
  const parsed = UserSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Scegli la persona.");
  if (!ctx.user || ctx.actor.type !== "utente") return fail("attore_non_ammesso", "Serve un account.");
  const target = await loadUserContext(executor, parsed.data.userId, ctx.lsDomains);
  if (!target) return fail("utente_non_trovato", "Utente non trovato.");
  const [members, a8] = await Promise.all([lsMemberRows(executor, ctx.caseId, target.userId), a8State(executor, ctx.caseId)]);
  if (members.access) return fail("zona_gia_attiva", "Questa persona ha già accesso alla zona personale.");
  const proposal = checkPersonalZoneProposal({
    proposer: { user: ctx.user, roles: ctx.actor.roles },
    beneficiary: { user: target, roles: members.roles },
    a8Status: a8.status,
    a8EvidenceUserIds: a8.accessUserIds,
    now: ctx.now ?? new Date(),
  });
  if (!proposal.ok) return proposal;
  const c = cast(ctx.caseId, "uuid");
  const run = await runCommand(
    executor,
    [
      caseOpenSql(ctx.workspaceId, ctx.caseId),
      a8ResolvedLockSql(ctx.caseId),
      toStatement(
        requireRows(
          ucSql`UPDATE uc_case_members SET personal_zone_grant = ${jsonb(proposal.value.grant)}
WHERE case_id = ${c} AND user_id = ${cast(target.userId, "uuid")} AND role IN (${raw(LS_ROLES_SQL)}) AND personal_zone_access = false
RETURNING id`,
          members.roles.length,
          "conflitto",
        ),
      ),
      toStatement(
        eventInsertSql({
          type: "membro.zona_personale",
          workspaceId: ctx.workspaceId,
          caseId: ctx.caseId,
          actor: eventActorFrom(ctx.actor),
          targetType: "membro",
          targetId: target.userId,
          payload: { action: "proposta", role: members.roles[0] },
        }),
      ),
    ],
    CASE_MESSAGES,
  );
  return run.ok ? ok({ userId: target.userId }) : run;
}

/**
 * Firma dell'approvatore privacy sulla concessione (account non Lateral Space o
 * link del firmatario privacy designato): l'accesso diventa attivo.
 *
 * `expectedTextHash` è l'impronta del testo che chi firma ha letto (`/firme`,
 * link di approvazione: `zoneApprovalHash`). Si confronta con la concessione
 * caricata qui, la stessa che l'UPDATE blocca con il suo compare-and-swap: se
 * Lateral Space ha riproposto l'accesso nel frattempo la firma non passa
 * («testo_cambiato») invece di andare sul testo nuovo.
 */
export async function signPersonalZoneAccess(
  executor: UcExecutor,
  ctx: UcCommandContext,
  input: unknown,
  signer?: Signer,
  opts: { expectedTextHash?: string } = {},
): Promise<Result<{ userId: string; active: boolean }>> {
  const parsed = UserSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Scegli la persona.");
  const core = await loadCaseCore(executor, ctx.workspaceId, ctx.caseId);
  if (!core) return fail("non_trovato", CASE_NOT_FOUND);
  const who = signer ? ok(signer) : accountSigner(ctx);
  if (!who.ok) return who;
  const [members, a8, sigCtx] = await Promise.all([
    lsMemberRows(executor, ctx.caseId, parsed.data.userId),
    a8State(executor, ctx.caseId),
    loadSignatureContext(executor, core, ctx.lsDomains),
  ]);
  if (!members.grant) return fail("concessione_assente", "Non c'è una proposta di accesso da confermare.");
  if (opts.expectedTextHash !== undefined && zoneApprovalHash(members.grant) !== opts.expectedTextHash) {
    return fail("testo_cambiato", "Il testo da approvare è cambiato: aggiorna la pagina e rileggilo.");
  }
  const signed = checkPersonalZoneSignature({ grant: members.grant, signer: who.value, ctx: sigCtx, a8Status: a8.status, now: ctx.now ?? new Date() });
  if (!signed.ok) return signed;
  const c = cast(ctx.caseId, "uuid");
  const run = await runCommand(
    executor,
    [
      caseOpenSql(ctx.workspaceId, ctx.caseId),
      a8ResolvedLockSql(ctx.caseId),
      toStatement(
        requireRows(
          ucSql`UPDATE uc_case_members SET personal_zone_access = ${cast(signed.value.active, "boolean")}, personal_zone_grant = ${jsonb(signed.value.grant)}
WHERE case_id = ${c} AND user_id = ${cast(parsed.data.userId, "uuid")} AND role IN (${raw(LS_ROLES_SQL)}) AND personal_zone_grant = ${jsonb(members.grant)}
RETURNING id`,
          members.roles.length,
          "conflitto",
        ),
      ),
      toStatement(
        eventInsertSql({
          type: "membro.zona_personale",
          workspaceId: ctx.workspaceId,
          caseId: ctx.caseId,
          actor: eventActorFrom(ctx.actor),
          targetType: "membro",
          targetId: parsed.data.userId,
          payload: { action: signed.value.active ? "attivata" : "firmata", role: signed.value.approval.ruolo },
        }),
      ),
    ],
    CASE_MESSAGES,
  );
  return run.ok ? ok({ userId: parsed.data.userId, active: signed.value.active }) : run;
}

/** Revoca immediata e senza firma (ls_lead, approvatore privacy o la persona stessa). */
export async function revokePersonalZoneAccess(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ userId: string; revoked: boolean }>> {
  const parsed = UserSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Scegli la persona.");
  const roles = actorRoles(ctx);
  const self = actorUserId(ctx) === parsed.data.userId;
  if (!self && !roles.includes("ls_lead") && !roles.includes("approvatore_privacy")) {
    return fail("attore_non_ammesso", "Solo il Responsabile del caso o l'approvatore privacy revocano l'accesso.");
  }
  const event = eventInsertFromSql({
    type: "membro.zona_personale",
    workspaceId: ctx.workspaceId,
    caseId: ctx.caseId,
    actor: eventActorFrom(ctx.actor),
    targetType: "membro",
    from: "one",
    targetIdColumn: "one.user_id",
    payload: { action: "revocata" },
  });
  // L'evento esiste solo se c'era davvero un accesso o una proposta da togliere.
  const run = await runCommand(executor, [
    toStatement(ucSql`WITH u AS (
  UPDATE uc_case_members SET personal_zone_access = false, personal_zone_grant = NULL
  WHERE case_id = ${cast(ctx.caseId, "uuid")} AND user_id = ${cast(parsed.data.userId, "uuid")} AND (personal_zone_access OR personal_zone_grant IS NOT NULL)
  RETURNING user_id
), one AS (SELECT DISTINCT user_id FROM u), ev AS (${event})
SELECT (SELECT count(*) FROM u)::int AS revoked`),
  ]);
  if (!run.ok) return run;
  return ok({ userId: parsed.data.userId, revoked: (rowNumber(run.value[0]?.[0]?.revoked) ?? 0) > 0 });
}

// ── Firmatari del cliente ─────────────────────────────────────────────

const SignerSchema = z.object({
  designation: z.enum(["owner", "privacy"]),
  contactId: z.string().regex(UUID).nullable(),
  evidenceFileId: z.string().regex(UUID).nullish(),
});

/**
 * Designazione dell'Owner o dell'approvatore privacy (`setOwnerContact`,
 * `setPrivacyApproverContact`): ls_lead o owner_cliente, con un file di prova
 * del caso. Cambiare persona toglie le firme dal link ancora in attesa del
 * contatto precedente e revoca i suoi link di approvazione. Togliere la
 * designazione (`contactId: null`) è solo di ls_lead.
 */
export async function setCaseSigner(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ designation: "owner" | "privacy"; contactId: string | null }>> {
  const parsed = SignerSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Scegli il contatto e la prova scritta.");
  const { designation, contactId } = parsed.data;
  if (!ctx.user || ctx.actor.type !== "utente") return fail("attore_non_ammesso", "Serve un account.");
  const core = await loadCaseCore(executor, ctx.workspaceId, ctx.caseId);
  if (!core) return fail("non_trovato", CASE_NOT_FOUND);
  const prevContact = core.designated[designation];
  let evidenceFileId: string | null = null;
  if (contactId) {
    const [[contact]] = await executor.batch([
      toStatement(ucSql`SELECT id, email, is_active, anonymized_at FROM uc_contacts WHERE id = ${cast(contactId, "uuid")} AND workspace_id = ${cast(ctx.workspaceId, "uuid")}`),
    ]);
    if (!contact) return fail("contatto_non_trovato", "Contatto non trovato in questo workspace.");
    if (!(await usableCaseFile(executor, ctx.caseId, parsed.data.evidenceFileId))) {
      return fail("prova_mancante", "Carica nel caso la prova scritta del cliente che indica la persona.");
    }
    const sigCtx = await loadSignatureContext(executor, core, ctx.lsDomains);
    const checked = checkSignerDesignation({
      actor: { user: ctx.user, roles: ctx.actor.roles },
      designation,
      contact: { id: contactId, email: rowString(contact.email), isActive: rowBool(contact.is_active), anonymized: contact.anonymized_at !== null && contact.anonymized_at !== undefined },
      evidenceFileId: parsed.data.evidenceFileId ?? null,
      ctx: sigCtx,
    });
    if (!checked.ok) return checked;
    evidenceFileId = checked.value.evidenceFileId;
  } else if (!actorRoles(ctx).includes("ls_lead")) {
    return fail("attore_non_ammesso", "Solo il Responsabile del caso toglie una designazione.");
  }
  const changed = designationChanged(prevContact ? { contactId: prevContact, email: null } : null, contactId ? { contactId, email: null } : null);
  const next: Record<string, Json> = { ...core.signersDesignation };
  if (contactId) {
    next[designation] = { contact_id: contactId, evidence_file_id: evidenceFileId, designated_by_user_id: ctx.user.userId, at: (ctx.now ?? new Date()).toISOString() };
  } else {
    delete next[designation];
  }
  const column = designation === "owner" ? raw("client_owner_contact_id") : raw("client_privacy_approver_contact_id");
  const statements: UcStatement[] = [
    caseOpenSql(ctx.workspaceId, ctx.caseId),
    toStatement(
      requireRows(
        ucSql`UPDATE uc_cases SET signers_designation = ${jsonb(next)}, ${column} = ${cast(contactId, "uuid")}, updated_at = now()
WHERE id = ${cast(ctx.caseId, "uuid")} AND workspace_id = ${cast(ctx.workspaceId, "uuid")} AND signers_designation = ${jsonb(core.signersDesignation)}
RETURNING id`,
        1,
        "conflitto",
      ),
    ),
  ];
  if (changed && prevContact) {
    statements.push(
      ...dropPendingApprovalsSql({ scope: { caseId: ctx.caseId }, match: { contactId: prevContact } }),
      ...revokeApprovalLinksSql({ caseId: ctx.caseId, contactId: prevContact, reasonCode: "designazione_cambiata" }),
    );
  }
  statements.push(
    toStatement(
      eventInsertSql({
        type: "firmatario.designato",
        workspaceId: ctx.workspaceId,
        caseId: ctx.caseId,
        actor: eventActorFrom(ctx.actor),
        targetType: "caso",
        targetId: ctx.caseId,
        payload: { designation, evidence_file_id: evidenceFileId ?? undefined },
      }),
    ),
  );
  const run = await runCommand(executor, statements, CASE_MESSAGES);
  return run.ok ? ok({ designation, contactId }) : run;
}

// ── Descrizione e ROI ─────────────────────────────────────────────────

const BLOCK_KEY = /^[a-z0-9_]{1,60}$/;
const MAX_DESCRIPTION_BYTES = 200_000;
const DescriptionSchema = z.object({
  description: z.record(z.string().regex(BLOCK_KEY), z.unknown()).refine((d) => Object.keys(d).length <= 60, "Troppi blocchi."),
});

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Descrizione a blocchi (solo ls_lead). La versione precedente va in
 * `description_history` (al massimo 50), i testi passano dalla scansione e
 * `settings.client_text` torna vero (§5.8).
 */
export async function updateCaseDescription(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ blocks: string[] }>> {
  if (!can(actorRoles(ctx), "modificare_catalogo")) return fail("attore_non_ammesso", "Solo il Responsabile del caso modifica la descrizione.");
  const parsed = DescriptionSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "La descrizione non è valida.");
  const description = parsed.data.description as Record<string, Json>;
  if (JSON.stringify(description).length > MAX_DESCRIPTION_BYTES) return fail("testo_troppo_lungo", "La descrizione è troppo lunga.");
  const text = checkLsText(description);
  if (!text.ok) return text;
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT description, jsonb_array_length(description_history) AS versions FROM uc_cases
WHERE id = ${cast(ctx.caseId, "uuid")} AND workspace_id = ${cast(ctx.workspaceId, "uuid")} AND setup_completed_at IS NOT NULL`),
  ]);
  if (!row) return fail("non_trovato", CASE_NOT_FOUND);
  const old = rowObject(row.description);
  const changed = [...new Set([...Object.keys(old), ...Object.keys(description)])].filter((k) => !jsonEqual(old[k], description[k])).sort();
  if (changed.length === 0) return ok({ blocks: [] });
  const c = cast(ctx.caseId, "uuid");
  const run = await runCommand(
    executor,
    [
      caseOpenSql(ctx.workspaceId, ctx.caseId),
      toStatement(
        requireRows(
          ucSql`UPDATE uc_cases SET
  description_history = (SELECT coalesce(jsonb_agg(e ORDER BY n), '[]'::jsonb) FROM jsonb_array_elements(
    jsonb_build_array(jsonb_build_object('at', now(), 'by_user_id', ${cast(actorUserId(ctx), "text")}, 'description', description)) || description_history
  ) WITH ORDINALITY AS h(e, n) WHERE n <= 50),
  description = ${jsonb(description)},
  settings = jsonb_set(settings, '{client_text}', 'true'::jsonb),
  updated_at = now()
WHERE id = ${c} AND description = ${jsonb(old)}
RETURNING id`,
          1,
          "conflitto",
        ),
      ),
      toStatement(
        eventInsertSql({
          type: "caso.descrizione_modificata",
          workspaceId: ctx.workspaceId,
          caseId: ctx.caseId,
          actor: eventActorFrom(ctx.actor),
          targetType: "caso",
          targetId: ctx.caseId,
          payload: { blocks: changed.filter((k) => BLOCK_KEY.test(k)).slice(0, 100), version: (rowNumber(row.versions) ?? 0) + 2 },
        }),
      ),
    ],
    CASE_MESSAGES,
  );
  return run.ok ? ok({ blocks: changed }) : run;
}

const RoiLineStatus = z.enum(["da_raccogliere", "stima", "confermato"]);
/**
 * Righe del ROI: oggetti stretti, così un campo che il comando non conosce si
 * rifiuta con un messaggio invece di sparire in silenzio. Tipo di costo e leva
 * possono restare da indicare (`null`): le righe del template non sempre li
 * hanno, e il calcolo resta «da calcolare» finché mancano.
 */
const RoiCostLine = z.strictObject({
  key: z.string().regex(BLOCK_KEY),
  label: z.string().trim().min(1).max(255),
  kind: z.enum(["una_tantum", "ricorrente", "escluso"]).nullable(),
  tipo_testo: z.string().max(255).nullish(),
  how_estimated: z.string().max(1000).nullish(),
  value: z.number().finite().min(0).nullable(),
  status: RoiLineStatus,
  source: z.string().max(500).nullish(),
  authorized_art_8_4: z.boolean().nullable(),
  item_key: z.string().max(160).nullish(),
});
const RoiBenefitLine = z.strictObject({
  key: z.string().regex(BLOCK_KEY),
  lever: z.enum(LEVERS).nullable(),
  /** Nome della leva come lo scrive il caso («Nuove capacità»), anche quando non corrisponde a una leva nota. */
  lever_label: z.string().trim().max(255).nullish(),
  formula: z.string().max(2000).nullish(),
  inputs: z.array(z.string().max(160)).max(50).default([]),
  value: z.number().finite().nullable(),
  status: RoiLineStatus,
  source: z.string().max(500).nullish(),
  how_to_euro: z.string().max(2000).nullish(),
  /** Dati necessari per stimare la riga. */
  data_needed: z.array(z.string().max(500)).max(50).optional(),
  /** Esempio illustrativo, con numeri inventati. */
  example: z.string().max(2000).nullish(),
  /** Riferimenti del template a voci che il caso non ha (non sono collegamenti). */
  unresolved_refs: z.array(z.string().max(160)).max(100).optional(),
});
const RoiSchema = z.object({
  costLines: z.array(RoiCostLine).max(100).optional(),
  benefitLines: z.array(RoiBenefitLine).max(100).optional(),
  content: z.record(z.string().regex(BLOCK_KEY), z.unknown()).optional(),
});

/** Messaggio in italiano per il primo problema delle righe del ROI. */
function roiIssueMessage(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return "Controlla le righe del ROI.";
  const [list, index, field] = issue.path;
  const where = list === "costLines" ? "Riga di costo" : list === "benefitLines" ? "Riga di beneficio" : null;
  const row = where && typeof index === "number" ? `${where} ${index + 1}` : "ROI";
  if (issue.code === "unrecognized_keys") return `${row}: campo non previsto (${issue.keys.slice(0, 3).join(", ")}).`;
  if (typeof field === "string") return `${row}: controlla il campo «${field}».`;
  return `Controlla le righe del ROI (${row}).`;
}

/**
 * Righe di costo e beneficio del ROI in stima (solo ls_lead), sul modello più
 * recente dello scenario base; lo crea alla prima modifica. Il tempo di verifica
 * umana resta sempre incluso (art. 9.2, vincolo del DDL).
 */
export async function updateCaseRoi(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ version: number }>> {
  if (!can(actorRoles(ctx), "modificare_catalogo")) return fail("attore_non_ammesso", "Solo il Responsabile del caso modifica il ROI.");
  const parsed = RoiSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", roiIssueMessage(parsed.error.issues[0]));
  const v = parsed.data;
  if (JSON.stringify(v).length > MAX_DESCRIPTION_BYTES) return fail("testo_troppo_lungo", "Il ROI è troppo lungo.");
  const text = checkLsText(v);
  if (!text.ok) return text;
  const c = cast(ctx.caseId, "uuid");
  const [[current]] = await executor.batch([
    toStatement(ucSql`SELECT id, version, cost_lines, benefit_lines, content, updated_at FROM uc_roi_models WHERE case_id = ${c} AND scenario = 'base' ORDER BY version DESC LIMIT 1`),
  ]);
  const event = toStatement(
    eventInsertSql({
      type: "caso.descrizione_modificata",
      workspaceId: ctx.workspaceId,
      caseId: ctx.caseId,
      actor: eventActorFrom(ctx.actor),
      targetType: "caso",
      targetId: ctx.caseId,
      payload: { blocks: ["roi"] },
    }),
  );
  if (!current) {
    const run = await runCommand(
      executor,
      [
        caseOpenSql(ctx.workspaceId, ctx.caseId),
        toStatement(ucSql`INSERT INTO uc_roi_models (case_id, version, status, scenario, cost_lines, benefit_lines, content)
VALUES (${c}, 1, 'stima', 'base', ${jsonb(v.costLines ?? [])}, ${jsonb(v.benefitLines ?? [])}, ${jsonb(v.content ?? {})})`),
        event,
      ],
      CASE_MESSAGES,
    );
    return run.ok ? ok({ version: 1 }) : run;
  }
  const run = await runCommand(
    executor,
    [
      caseOpenSql(ctx.workspaceId, ctx.caseId),
      toStatement(
        requireRows(
          ucSql`UPDATE uc_roi_models SET
  cost_lines = ${v.costLines ? jsonb(v.costLines) : raw("cost_lines")},
  benefit_lines = ${v.benefitLines ? jsonb(v.benefitLines) : raw("benefit_lines")},
  content = ${v.content ? jsonb(v.content) : raw("content")},
  updated_at = now()
WHERE id = ${cast(String(current.id), "uuid")} AND cost_lines = ${jsonb(rowJson(current.cost_lines) ?? [])} AND benefit_lines = ${jsonb(rowJson(current.benefit_lines) ?? [])}
RETURNING id`,
          1,
          "conflitto",
        ),
      ),
      event,
    ],
    CASE_MESSAGES,
  );
  return run.ok ? ok({ version: rowNumber(current.version) ?? 1 }) : run;
}

// ── Operatore (scripts/uc-case-admin.ts) ──────────────────────────────

/** Caso per id, con il suo workspace (lo script non conosce il workspace). */
export async function loadCaseCoreById(executor: UcExecutor, caseId: string): Promise<CaseCore | null> {
  if (!isUuid(caseId)) return null;
  const [[row]] = await executor.batch([toStatement(ucSql`SELECT workspace_id FROM uc_cases WHERE id = ${cast(caseId, "uuid")}`)]);
  return row ? loadCaseCore(executor, String(row.workspace_id), caseId) : null;
}

async function operatorExists(executor: UcExecutor, userId: string): Promise<boolean> {
  if (!isUuid(userId)) return false;
  const [[row]] = await executor.batch([toStatement(ucSql`SELECT id FROM users WHERE id = ${cast(userId, "uuid")}`)]);
  return Boolean(row);
}

/**
 * Conferma della regola del gate (§3.6, §12-a4): scrive
 * `settings.gate_policy.confirmed` e, se la regola cambia, ricalcola
 * `in_gate_scope` e i default di `serves_for`/`perimeter` di tutte le voci (senza
 * migrazione). Evento `caso.regola_gate_confermata`.
 */
export async function confirmGatePolicy(
  executor: UcExecutor,
  i: { caseId: string; actorUserId: string; scope: GatePolicyScope; note: string | null; now?: Date },
): Promise<Result<{ scope: GatePolicyScope; previousScope: GatePolicyScope; changedItems: number; requiredBefore: number; requiredAfter: number }>> {
  if (!isVocab(GATE_POLICY_SCOPES, i.scope)) return fail("dati_non_validi", "Regola del gate non valida.");
  if (!(await operatorExists(executor, i.actorUserId))) return fail("attore_non_trovato", "L'attore indicato non esiste.");
  const core = await loadCaseCoreById(executor, i.caseId);
  if (!core) return fail("non_trovato", CASE_NOT_FOUND);
  if (core.status === "chiuso") return fail("caso_chiuso", CASE_MESSAGES.caso_chiuso);
  const note = i.note?.trim().slice(0, 500) || null;
  if (note) {
    const text = checkLsText({ note });
    if (!text.ok) return text;
  }
  const now = i.now ?? new Date();
  const before = await loadCaseReadiness(executor, core.workspaceId, core.id, now);
  if (!before) return fail("non_trovato", CASE_NOT_FOUND);
  const [itemRows] = await executor.batch([
    toStatement(ucSql`SELECT id, request_module_key, serves_for, perimeter, in_gate_scope, spec -> 'defaults_applied' AS defaults_applied
FROM uc_items WHERE case_id = ${cast(core.id, "uuid")} AND deleted_at IS NULL`),
  ]);
  const policy = { ...core.policy, scope: i.scope };
  const changes: { id: string; in_gate_scope: boolean; serves_for: string[]; perimeter: string | null; defaults_applied: GateDefaultField[] }[] = [];
  for (const r of itemRows) {
    const prior = rowStringArray(rowJson(r.defaults_applied)).filter((f): f is GateDefaultField => f === "serves_for" || f === "perimeter");
    const servesFor = rowStringArray(rowJson(r.serves_for)).filter((p): p is Phase => isVocab(PHASES, p));
    const perimeter = rowString(r.perimeter);
    const next = gateScopeForItem(
      { requestModuleKey: rowString(r.request_module_key), servesFor, perimeter: isVocab(PERIMETERS, perimeter) ? perimeter : null, defaultsApplied: prior },
      policy,
    );
    const same =
      next.inGateScope === rowBool(r.in_gate_scope) &&
      jsonEqual(next.servesFor, servesFor) &&
      next.perimeter === rowString(r.perimeter) &&
      jsonEqual([...next.defaultsApplied].sort(), [...prior].sort());
    if (!same) changes.push({ id: String(r.id), in_gate_scope: next.inGateScope, serves_for: next.servesFor, perimeter: next.perimeter, defaults_applied: next.defaultsApplied });
  }
  const confirmed = gatePolicyToJson({ ...policy, confirmed: { byUserId: i.actorUserId, at: now.toISOString(), note } });
  const statements: UcStatement[] = [caseRevisionSql({ workspaceId: core.workspaceId, caseId: core.id, expectRevision: core.catalogRevision })];
  for (let k = 0; k < changes.length; k += 1000) {
    statements.push(
      toStatement(ucSql`UPDATE uc_items i SET in_gate_scope = r.in_gate_scope, serves_for = r.serves_for, perimeter = r.perimeter,
  spec = CASE WHEN jsonb_array_length(r.defaults_applied) = 0 THEN i.spec - 'defaults_applied' ELSE jsonb_set(i.spec, '{defaults_applied}', r.defaults_applied) END,
  updated_at = now()
FROM jsonb_to_recordset(${jsonb(changes.slice(k, k + 1000))}) AS r(id uuid, in_gate_scope boolean, serves_for jsonb, perimeter text, defaults_applied jsonb)
WHERE i.id = r.id AND i.case_id = ${cast(core.id, "uuid")}`),
    );
  }
  statements.push(
    toStatement(ucSql`UPDATE uc_cases SET settings = jsonb_set(settings, '{gate_policy}', ${jsonb(confirmed)}), updated_at = now() WHERE id = ${cast(core.id, "uuid")}`),
    toStatement(
      eventInsertSql({
        type: "caso.regola_gate_confermata",
        workspaceId: core.workspaceId,
        caseId: core.id,
        actor: { type: "utente", userId: i.actorUserId },
        targetType: "caso",
        targetId: core.id,
        payload: { scope: i.scope },
      }),
    ),
  );
  const run = await runCommand(executor, statements, CASE_MESSAGES);
  if (!run.ok) return run;
  const after = await refreshReadinessCache(executor, core.workspaceId, core.id, now);
  return ok({ scope: i.scope, previousScope: core.policy.scope, changedItems: changes.length, requiredBefore: before.g1.required, requiredAfter: after?.G1.required ?? 0 });
}

/**
 * Ambiente AI del caso (`ai_environment_approved`) o trattamento AI di un file
 * (`ai_processing_allowed`): solo da script, con una prova scritta caricata nel
 * caso (art. 10.3). Mai sui file della zona personale.
 */
export async function setAiFlag(
  executor: UcExecutor,
  i: { caseId: string; actorUserId: string; approved: boolean; evidenceFileId: string; fileId?: string | null },
): Promise<Result<{ target: "caso" | "file"; approved: boolean }>> {
  if (!(await operatorExists(executor, i.actorUserId))) return fail("attore_non_trovato", "L'attore indicato non esiste.");
  const core = await loadCaseCoreById(executor, i.caseId);
  if (!core) return fail("non_trovato", CASE_NOT_FOUND);
  if (!(await usableCaseFile(executor, core.id, i.evidenceFileId))) return fail("prova_mancante", "La prova scritta deve essere un file utilizzabile del caso.");
  const c = cast(core.id, "uuid");
  const target: "caso" | "file" = i.fileId ? "file" : "caso";
  const update = i.fileId
    ? requireRows(
        ucSql`UPDATE uc_files SET ai_processing_allowed = ${cast(i.approved, "boolean")}
WHERE id = ${cast(i.fileId, "uuid")} AND case_id = ${c} AND deleted_at IS NULL AND (storage_zone = 'standard' OR ${cast(i.approved, "boolean")} = false)
RETURNING id`,
        1,
        "file_non_ammesso",
      )
    : requireRows(ucSql`UPDATE uc_cases SET ai_environment_approved = ${cast(i.approved, "boolean")}, updated_at = now() WHERE id = ${c} RETURNING id`, 1, "conflitto");
  const run = await runCommand(
    executor,
    [
      toStatement(update),
      toStatement(
        eventInsertSql({
          type: "caso.ambiente_ai",
          workspaceId: core.workspaceId,
          caseId: core.id,
          actor: { type: "utente", userId: i.actorUserId },
          targetType: target,
          targetId: i.fileId ?? core.id,
          payload: { approved: i.approved, evidence_file_id: i.evidenceFileId },
        }),
      ),
    ],
    { file_non_ammesso: "File non trovato, cancellato o della zona personale (che non va mai all'AI)." },
  );
  return run.ok ? ok({ target, approved: i.approved }) : run;
}

// Tipi riesportati per i chiamanti.
export type { Approval, CaseRole, CaseStatus, EventActor, Row };
