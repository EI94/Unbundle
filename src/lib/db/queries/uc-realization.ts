/**
 * Il dossier dalla pagina Use case (DESIGN §2.1 ingressi 1 e 2, §3.1, §3.2;
 * `docs/use-case/DESIGN.md` §6.5): letture del capitolo «Realizzazione» e della
 * colonna «In realizzazione», e il comando «Avvia la realizzazione».
 *
 * - Le letture non controllano interruttori né tabelle: lo fa `uc-nav.ts`
 *   (`UC_ENABLED`, `UC_WORKSPACE_IDS`, `to_regclass`), che le chiama dentro
 *   `try/catch`. Qui ricevono l'esecutore, così le prova il harness.
 * - Il codice della scheda madre si legge con `to_jsonb(u) ->> 'code'`: senza
 *   la colonna `use_cases.code` (prima della 0019) vale NULL e la query non si
 *   rompe. `(to_jsonb(u) -> 'code') IS NOT NULL` dice se la colonna c'è.
 * - Un dossier conta solo se completo (`setup_completed_at IS NOT NULL`); con
 *   più dossier sulla stessa scheda vale il più vecchio, come `uc-nav.ts` e il
 *   connettore. Per «c'è già un dossier» contano anche quelli in creazione.
 * - Nessuna lettura ordina, filtra o conta per proponente (art. 15.4): il
 *   proponente non si legge mai.
 * - Le card della colonna e della lista di ripiego si leggono in un solo giro,
 *   prossimo passo compreso: le istruzioni del prossimo passo sono copiate da
 *   `uc-next-step.ts` (congelato, regola 3 di §8.1) e scelgono i dossier con
 *   una sottoquery invece che con un elenco di id.
 *
 * Modulo senza import dell'app, come `uc-cases.ts`.
 */
import { z } from "zod";
import { UC_UNIQUE_DOSSIER_INDEX } from "../../uc/ddl.ts";
import { caseRoleAllowedFor, userContextFrom } from "../../uc/lateral-space.ts";
import { pgCodeOf } from "../../uc/log.ts";
import { GATE_PHASE } from "../../uc/gates.ts";
import { checkCaseCreator } from "../../uc/permissions.ts";
import { rowBool, rowDate, rowJson, rowString, rowVocab, type Row } from "../../uc/sql/readiness.ts";
import { STALE_INCOMPLETE_CASE_MINUTES } from "../../uc/sql/case-create.ts";
import { cast, jsonb, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import { fail, ok, type Result, type UserContext } from "../../uc/types.ts";
import type { NextStepInput } from "../../uc/views/next-step.ts";
import {
  REALIZATION_TEXT,
  dossierCardView,
  dossierCodeFor,
  generatedCodeStem,
  realizationDescription,
  realizationDossierView,
  roiTotals,
  sortDossierCards,
  type DossierCardView,
  type DossierFacts,
  type UseCaseRealization,
  type UseCaseTexts,
} from "../../uc/views/realization.ts";
import { CASE_ROLES, CASE_STATUSES, isVocab, type CaseRole } from "../../uc/vocab.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { checkLsText } from "./uc-cases.ts";
import { loadNextStepInput, parseNextStepRows } from "./uc-next-step.ts";
import { PENDING_SIGNATURE_STATEMENTS } from "./uc-signatures.ts";
import { createCaseFromTemplate } from "./uc-templates.ts";
import { UUID, isUuid } from "../../uc/ids.ts";

const lower = (id: string) => id.toLowerCase();

/** Chi guarda, con il suo ruolo nel workspace già tradotto in permessi. */
export interface RealizationViewer {
  userId: string;
  /** `canReviewWorkspacePortfolio`: i revisori vedono il capitolo e la colonna. */
  canReview: boolean;
  /** `canManageWorkspaceSettings`: apre ogni dossier, in sola lettura. */
  canManage: boolean;
}

// ── Ruoli di chi guarda ───────────────────────────────────────────────

function storedRoles(raw: unknown): CaseRole[] {
  const list = rowJson<unknown[]>(raw);
  return Array.isArray(list) ? list.filter((r): r is CaseRole => typeof r === "string" && isVocab(CASE_ROLES, r)) : [];
}

/**
 * Può aprire il dossier e con quali ruoli conta il prossimo passo: come
 * `resolveCaseAccess`, un membro i cui ruoli ora non valgono e chi gestisce il
 * workspace lo vedono come osservatori; gli altri revisori non lo aprono.
 */
function viewerOnCase(stored: readonly CaseRole[], user: UserContext | null, lsDomains: readonly string[], canManage: boolean): { canOpen: boolean; roles: CaseRole[] } {
  const effective = user ? stored.filter((r) => caseRoleAllowedFor(user, r, lsDomains)) : [];
  if (effective.length > 0) return { canOpen: true, roles: effective };
  if (stored.length > 0 || canManage) return { canOpen: true, roles: ["osservatore"] };
  return { canOpen: false, roles: [] };
}

function userSql(userId: string): UcStatement {
  return toStatement(ucSql`SELECT id, email, email_verified FROM users WHERE id = ${cast(userId, "uuid")}`);
}

function userFrom(row: Row | undefined, lsDomains: readonly string[]): UserContext | null {
  if (!row || !isUuid(row.id)) return null;
  return userContextFrom({ id: String(row.id), email: rowString(row.email), emailVerified: (row.email_verified as Date | string | null) ?? null }, lsDomains);
}

function memberRolesSql(userId: string) {
  return ucSql`coalesce((SELECT jsonb_agg(m.role ORDER BY m.role) FROM uc_case_members m WHERE m.case_id = c.id AND m.user_id = ${cast(userId, "uuid")}), '[]'::jsonb)`;
}

// ── Capitolo «Realizzazione» ──────────────────────────────────────────

/** Use case, il suo dossier (il più vecchio completo), i ruoli di chi guarda e il conto, in una sola istruzione. */
export function realizationSql(i: { workspaceId: string; useCaseId: string; userId: string }): UcStatement {
  return toStatement(ucSql`SELECT u.id, u.status::text AS status, coalesce(u.portfolio_kind, 'use_case_ai') AS kind,
  to_jsonb(u) ->> 'code' AS use_case_code, u.title AS use_case_title,
  d.id AS case_id, d.code AS case_code, d.title AS case_title, d.status AS case_status, d.updated_at AS case_updated_at, d.roles,
  r.implementation_cost, r.annual_benefit, r.break_even_months, r.cost_lines, r.benefit_lines, r.discount_rate, r.adoption_rate, r.horizon_years, r.content
FROM use_cases u
LEFT JOIN LATERAL (
  SELECT c.id, c.code, c.title, c.status, c.updated_at, ${memberRolesSql(i.userId)} AS roles
  FROM uc_cases c
  WHERE c.portfolio_use_case_id = u.id AND c.workspace_id = u.workspace_id AND c.setup_completed_at IS NOT NULL
  ORDER BY c.created_at, c.id
  LIMIT 1
) d ON true
LEFT JOIN LATERAL (
  SELECT m.implementation_cost, m.annual_benefit, m.break_even_months, m.cost_lines, m.benefit_lines, m.discount_rate, m.adoption_rate, m.horizon_years, m.content
  FROM uc_roi_models m
  WHERE m.case_id = d.id AND m.scenario = 'base'
  ORDER BY m.version DESC
  LIMIT 1
) r ON true
WHERE u.id = ${cast(i.useCaseId, "uuid")} AND u.workspace_id = ${cast(i.workspaceId, "uuid")}`);
}

/**
 * Il capitolo «Realizzazione» per un revisore (DESIGN §2.1 ingresso 1). Al
 * massimo 2 giri: use case, dossier e conto; poi il prossimo passo, solo se il
 * dossier c'è. Null se lo use case non è del workspace. I contributori non
 * arrivano qui (`nascosta`, in `uc-nav.ts`).
 */
export async function readRealization(
  executor: UcExecutor,
  i: { workspaceId: string; useCaseId: string; viewer: RealizationViewer; lsDomains: readonly string[]; now?: Date },
): Promise<UseCaseRealization | null> {
  if (!isUuid(i.workspaceId) || !isUuid(i.useCaseId) || !isUuid(i.viewer.userId)) return null;
  if (!i.viewer.canReview) return { state: "nascosta" };
  const workspaceId = lower(i.workspaceId);
  const [[row], [userRow]] = await executor.batch([realizationSql({ workspaceId, useCaseId: i.useCaseId, userId: i.viewer.userId }), userSql(i.viewer.userId)]);
  if (!row) return null;
  const user = userFrom(userRow, i.lsDomains);
  const caseId = rowString(row.case_id);
  const status = rowVocab(CASE_STATUSES, row.case_status);
  if (!caseId || !status) {
    if (row.kind === "best_practice") return { state: "best_practice" };
    const canStart = row.status === "accepted" && row.kind === "use_case_ai" && user !== null && checkCaseCreator({ user, canReviewWorkspacePortfolio: i.viewer.canReview }).ok;
    return { state: "da_avviare", canStart, startHref: canStart ? `/dashboard/${workspaceId}/casi-duso/nuovo?useCaseId=${lower(i.useCaseId)}` : null };
  }
  const viewer = viewerOnCase(storedRoles(row.roles), user, i.lsDomains, i.viewer.canManage);
  const nextStep = await loadNextStepInput(executor, { workspaceId, caseId, userId: i.viewer.userId, roles: viewer.roles, now: i.now });
  const facts: DossierFacts = {
    workspaceId,
    caseId,
    caseCode: String(row.case_code ?? ""),
    caseTitle: String(row.case_title ?? ""),
    status,
    updatedAt: rowDate(row.case_updated_at),
    useCase: { id: String(row.id), code: rowString(row.use_case_code), title: String(row.use_case_title ?? "") },
    canOpen: viewer.canOpen,
    roles: viewer.roles,
    nextStep,
  };
  return { state: "avviata", dossier: realizationDossierView({ ...facts, roi: roiTotals(row) }) };
}

// ── Colonna «In realizzazione» e lista di ripiego ─────────────────────

/**
 * I dossier completi del workspace, con la scheda madre e i ruoli di chi
 * guarda. Con `useCaseIds` quelli di questi use case (colonna della Roadmap:
 * tutti i revisori li vedono); senza, quelli che chi guarda apre (lista di
 * ripiego `/casi-duso`: membro, o chi gestisce il workspace).
 */
export function dossierCardsSql(i: { workspaceId: string; userId: string; useCaseIds: readonly string[] | null; canManage: boolean }): UcStatement {
  const filter =
    i.useCaseIds !== null
      ? ucSql`AND c.portfolio_use_case_id = ANY(${cast([...i.useCaseIds], "uuid[]")})`
      : i.canManage
        ? raw("")
        : ucSql`AND EXISTS (SELECT 1 FROM uc_case_members m WHERE m.case_id = c.id AND m.user_id = ${cast(i.userId, "uuid")})`;
  return toStatement(ucSql`SELECT c.id, c.code, c.title, c.status, c.updated_at, c.created_at, c.portfolio_use_case_id,
  u.id AS use_case_id, to_jsonb(u) ->> 'code' AS use_case_code, u.title AS use_case_title,
  ${memberRolesSql(i.userId)} AS roles
FROM uc_cases c
LEFT JOIN use_cases u ON u.id = c.portfolio_use_case_id AND u.workspace_id = c.workspace_id
WHERE c.workspace_id = ${cast(i.workspaceId, "uuid")} AND c.setup_completed_at IS NOT NULL ${filter}
ORDER BY c.created_at, c.id
LIMIT 500`);
}

/**
 * Gli id dei dossier delle card, come sottoquery: stessi filtri e stesso
 * limite di `dossierCardsSql`, così il prossimo passo si legge nello stesso
 * batch, senza conoscere prima gli id.
 */
export function dossierScopeSql(i: { workspaceId: string; userId: string; useCaseIds: readonly string[] | null; canManage: boolean }): SqlFragment {
  const filter =
    i.useCaseIds !== null
      ? ucSql`AND s.portfolio_use_case_id = ANY(${cast([...i.useCaseIds], "uuid[]")})`
      : i.canManage
        ? raw("")
        : ucSql`AND EXISTS (SELECT 1 FROM uc_case_members sm WHERE sm.case_id = s.id AND sm.user_id = ${cast(i.userId, "uuid")})`;
  return ucSql`SELECT s.id FROM uc_cases s
  WHERE s.workspace_id = ${cast(i.workspaceId, "uuid")} AND s.setup_completed_at IS NOT NULL ${filter}
  ORDER BY s.created_at, s.id LIMIT 500`;
}

// Le istruzioni qui sotto sono quelle di `nextStepStatements` (`uc-next-step.ts`), con
// `IN (sottoquery)` al posto di `= ANY(id)` e, per le firme, una riga per dossier con
// `case_id` (in `uc-signatures.ts` sono cinque istruzioni per ogni dossier). Le righe si
// leggono con lo stesso `parseNextStepRows`. Se cambiano là, vanno cambiate anche qui:
// il harness confronta le due letture (`realization.integration.test.ts`).

/** Voce richiesta dal via allo sviluppo (G1), alias `i`: come `requiredForVia` di `uc-next-step.ts`. */
function requiredForVia(): SqlFragment {
  return ucSql`(i.in_gate_scope AND i.priority = 'must' AND i.perimeter = 'in_contratto' AND i.serves_for @> ${jsonb([GATE_PHASE.G1])})`;
}

/** Quattro occhi, alias `i`: come `notMine` di `uc-next-step.ts`. */
function notMine(userId: string): SqlFragment {
  const me = cast(userId, "uuid");
  return ucSql`(NOT EXISTS (SELECT 1 FROM uc_answers x WHERE x.item_id = i.id AND x.responder_user_id = ${me})
    AND NOT EXISTS (SELECT 1 FROM uc_answers ca JOIN uc_request_tokens t ON t.request_id = ca.request_id
      WHERE ca.id = i.current_answer_id AND t.issued_by_user_id = ${me}))`;
}

function scopedCasesSql(scope: SqlFragment): UcStatement {
  return toStatement(ucSql`SELECT c.id, c.status, c.status_before_suspension, c.status_changed_at, c.readiness, c.catalog_revision, c.catalog_version, c.signers_designation,
  (SELECT cv.created_at FROM uc_catalog_versions cv WHERE cv.case_id = c.id AND cv.version = c.catalog_version) AS catalog_frozen_at,
  (SELECT jsonb_build_object('title', ms.title, 'date', ms.planned_date::text) FROM uc_milestones ms
    WHERE ms.case_id = c.id AND ms.done_at IS NULL ORDER BY ms.sort_order, ms.planned_date NULLS LAST, ms.key LIMIT 1) AS next_milestone,
  (SELECT g.approvals FROM uc_gate_reviews g WHERE g.case_id = c.id AND g.decision = 'proposto' ORDER BY g.created_at DESC LIMIT 1) AS pending_review,
  (SELECT count(*) FROM (
     SELECT i.assignee_contact_id AS contact_id FROM uc_items i WHERE i.case_id = c.id AND i.deleted_at IS NULL AND i.assignee_contact_id IS NOT NULL
     UNION SELECT r.contact_id FROM uc_requests r WHERE r.case_id = c.id AND r.purpose = 'raccolta') x)::int AS referents,
  EXISTS (SELECT 1 FROM uc_case_members m WHERE m.case_id = c.id AND m.role = 'approvatore_privacy') AS privacy_member,
  EXISTS (SELECT 1 FROM uc_blockers b WHERE b.case_id = c.id AND b.key = 'a8' AND b.status = 'attivo') AS a8_active
FROM uc_cases c
WHERE c.id IN (${scope})`);
}

function scopedItemCountsSql(scope: SqlFragment, userId: string): UcStatement {
  const req = requiredForVia();
  const mine = notMine(userId);
  return toStatement(ucSql`SELECT i.case_id,
  count(*) FILTER (WHERE ${req} AND i.status IN ('da_chiedere', 'chiesta', 'mancante', 'parziale'))::int AS g_da_fare,
  count(*) FILTER (WHERE ${req} AND i.status = 'in_verifica')::int AS g_da_verificare,
  count(*) FILTER (WHERE ${req} AND i.status = 'bloccata')::int AS g_bloccate,
  count(*) FILTER (WHERE ${req} AND i.status IN ('validata', 'non_applicabile'))::int AS g_a_posto,
  count(*) FILTER (WHERE ${req} AND i.status = 'da_chiedere' AND i.assignee_contact_id IS NULL)::int AS unassigned_must,
  count(*) FILTER (WHERE ${req} AND i.status = 'da_chiedere')::int AS unsent_must,
  count(*) FILTER (WHERE i.status = 'in_verifica')::int AS to_verify_total,
  count(*) FILTER (WHERE i.status = 'in_verifica' AND ${mine})::int AS to_verify_for_me,
  count(*) FILTER (WHERE ${req} AND i.status = 'in_verifica' AND ${mine})::int AS to_verify_must,
  min(a.created_at) FILTER (WHERE i.status = 'in_verifica' AND ${mine}) AS oldest_to_verify_at,
  count(*) FILTER (WHERE i.request_module_key IS NOT NULL AND i.status = 'chiesta')::int AS waiting_on_referents
FROM uc_items i
LEFT JOIN uc_answers a ON a.id = i.current_answer_id
WHERE i.case_id IN (${scope}) AND i.deleted_at IS NULL
GROUP BY i.case_id`);
}

function scopedBlockersSql(scope: SqlFragment): UcStatement {
  return toStatement(ucSql`SELECT b.case_id, b.key, count(DISTINCT i.id)::int AS must_items
FROM uc_blockers b
JOIN uc_item_blockers ib ON ib.blocker_id = b.id
JOIN uc_items i ON i.id = ib.item_id AND i.deleted_at IS NULL
WHERE b.case_id IN (${scope}) AND b.status = 'attivo' AND ${requiredForVia()}
GROUP BY b.case_id, b.key`);
}

/**
 * Le firme in attesa di tutti i dossier, nell'ordine di `pendingSignatureStatements`
 * (`uc-signatures.ts`), con `case_id` e le stesse colonne delle istruzioni per un caso:
 * `parsePendingSignatures` usa il costruttore della pagina `/firme`, che le legge tutte.
 */
function scopedPendingSignatureStatements(scope: SqlFragment): UcStatement[] {
  return [
    toStatement(ucSql`SELECT g.case_id, g.id, g.gate_key, g.computed, g.summary_text_hash, g.approvals, g.written_evidence_file_id IS NOT NULL AS has_evidence
FROM uc_gate_reviews g WHERE g.case_id IN (${scope}) AND g.decision = 'proposto'
ORDER BY g.case_id, g.created_at`),
    toStatement(ucSql`SELECT i.case_id, i.id, i.key, i.title, i.na_reason, i.na_proposed_at, i.na_proposed_by_contact_id IS NOT NULL AS by_referent,
  i.na_approved_by_user_id IS NOT NULL AS ls_signed, i.na_client_approved_by_user_id IS NOT NULL AS client_user_signed,
  i.na_approved_by_contact_id AS client_contact_id,
  coalesce(i.na_approved_by_contact_id::text = (c.signers_designation #>> '{owner,contact_id}'), false) AS client_link_signed
FROM uc_items i JOIN uc_cases c ON c.id = i.case_id
WHERE i.case_id IN (${scope}) AND i.deleted_at IS NULL AND i.na_proposed_at IS NOT NULL
  AND i.na_approved_at IS NULL AND i.na_reason IS NOT NULL
ORDER BY i.case_id, i.sort_order, i.key`),
    toStatement(ucSql`SELECT i.case_id, i.id, i.key, i.title,
  CASE WHEN i.waiver IS NOT NULL AND i.waiver_approved_at IS NULL THEN i.waiver END AS waiver,
  CASE WHEN i.fallback IS NOT NULL AND i.fallback_approved_at IS NULL THEN i.fallback END AS fallback
FROM uc_items i
WHERE i.case_id IN (${scope}) AND i.deleted_at IS NULL
  AND ((i.waiver IS NOT NULL AND i.waiver_approved_at IS NULL) OR (i.fallback IS NOT NULL AND i.fallback_approved_at IS NULL))
ORDER BY i.case_id, i.sort_order, i.key`),
    toStatement(ucSql`SELECT b.case_id, b.id, b.key, b.evidence, b.approvals,
  coalesce((SELECT jsonb_agg(coalesce(nullif(trim(u.name), ''), 'Persona di Lateral Space') ORDER BY u.name)
    FROM users u WHERE u.id::text IN (
      SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(b.evidence -> 'accesso_zona_personale') = 'array' THEN b.evidence -> 'accesso_zona_personale' ELSE '[]'::jsonb END))
  ), '[]'::jsonb) AS access_names
FROM uc_blockers b
WHERE b.case_id IN (${scope}) AND b.key = 'a8' AND b.status = 'attivo' AND b.evidence IS NOT NULL
ORDER BY b.case_id, b.id`),
    toStatement(ucSql`SELECT DISTINCT ON (m.case_id, m.user_id) m.case_id, m.user_id, m.personal_zone_grant, coalesce(nullif(trim(u.name), ''), 'Persona di Lateral Space') AS name
FROM uc_case_members m JOIN users u ON u.id = m.user_id
WHERE m.case_id IN (${scope}) AND m.personal_zone_grant IS NOT NULL AND NOT m.personal_zone_access
ORDER BY m.case_id, m.user_id`),
  ];
}

/** Il prossimo passo dei dossier di `scope` per chi guarda: 3 istruzioni più le 5 delle firme, da mettere in un batch. */
export function scopedNextStepStatements(scope: SqlFragment, userId: string): UcStatement[] {
  return [scopedCasesSql(scope), scopedItemCountsSql(scope, userId), scopedBlockersSql(scope), ...scopedPendingSignatureStatements(scope)];
}

/** Quante istruzioni usa `scopedNextStepStatements`. */
export const SCOPED_NEXT_STEP_STATEMENTS = 3 + PENDING_SIGNATURE_STATEMENTS;

/**
 * Dalle righe di `scopedNextStepStatements` all'input del motore, con le
 * regole di `parseNextStepRows`: le firme si dividono per dossier e prendono il
 * posto delle cinque istruzioni per dossier che quel parser si aspetta.
 */
export function parseScopedNextStepRows(
  rows: readonly (readonly Row[])[],
  i: { caseIds: readonly string[]; rolesByCase: ReadonlyMap<string, readonly CaseRole[]>; now: Date },
): Map<string, NextStepInput> {
  const [cases = [], counts = [], blockers = [], ...signatures] = rows;
  const caseIds = [...new Set(i.caseIds.filter(isUuid).map(lower))];
  const byCase = signatures.slice(0, PENDING_SIGNATURE_STATEMENTS).map((list) => {
    const grouped = new Map<string, Row[]>();
    for (const r of list) {
      const id = lower(String(r.case_id));
      const group = grouped.get(id);
      if (group) group.push(r);
      else grouped.set(id, [r]);
    }
    return grouped;
  });
  while (byCase.length < PENDING_SIGNATURE_STATEMENTS) byCase.push(new Map());
  const layout: (readonly Row[])[] = [cases, counts, blockers, ...caseIds.flatMap((id) => byCase.map((grouped) => grouped.get(id) ?? []))];
  const parsed = parseNextStepRows(layout, { caseIds, rolesByCase: i.rolesByCase, now: i.now });
  return new Map([...parsed].map(([id, r]) => [id, r.input]));
}

export interface DossierCards {
  /** In ordine: prima quelli in cui tocca a chi guarda, poi per ultima modifica. */
  cards: DossierCardView[];
  /** Card per use case (colonna della Roadmap): chiavi in minuscolo. */
  byUseCase: Map<string, DossierCardView>;
}

/**
 * Le card dei dossier (DESIGN §3.1, §2.1 ingresso 2): un solo giro per i
 * dossier, chi guarda e il prossimo passo di tutti (`scopedNextStepStatements`).
 */
export async function readDossierCards(
  executor: UcExecutor,
  i: { workspaceId: string; useCaseIds: readonly string[] | null; viewer: RealizationViewer; lsDomains: readonly string[]; now?: Date },
): Promise<DossierCards> {
  const empty: DossierCards = { cards: [], byUseCase: new Map() };
  if (!isUuid(i.workspaceId) || !isUuid(i.viewer.userId)) return empty;
  const ids = i.useCaseIds === null ? null : [...new Set(i.useCaseIds.filter(isUuid).map(lower))];
  if (ids !== null && (ids.length === 0 || !i.viewer.canReview)) return empty;
  const workspaceId = lower(i.workspaceId);
  const scope = { workspaceId, userId: i.viewer.userId, useCaseIds: ids, canManage: i.viewer.canManage };
  const [rows, [userRow], ...nextStepRows] = await executor.batch([
    dossierCardsSql(scope),
    userSql(i.viewer.userId),
    ...scopedNextStepStatements(dossierScopeSql(scope), i.viewer.userId),
  ]);
  const user = userFrom(userRow, i.lsDomains);
  const seenUseCase = new Set<string>();
  const facts: DossierFacts[] = [];
  for (const r of rows) {
    const status = rowVocab(CASE_STATUSES, r.status);
    if (!isUuid(r.id) || !status) continue;
    const useCaseId = rowString(r.use_case_id);
    // Nella colonna, più dossier sulla stessa scheda (prima dell'indice unico): vale il più vecchio.
    // La lista di ripiego li mostra tutti.
    if (useCaseId && ids !== null) {
      if (seenUseCase.has(lower(useCaseId))) continue;
      seenUseCase.add(lower(useCaseId));
    }
    const viewer = viewerOnCase(storedRoles(r.roles), user, i.lsDomains, i.viewer.canManage);
    if (ids === null && !viewer.canOpen) continue;
    facts.push({
      workspaceId,
      caseId: lower(String(r.id)),
      caseCode: String(r.code ?? ""),
      caseTitle: String(r.title ?? ""),
      status,
      updatedAt: rowDate(r.updated_at),
      useCase: useCaseId ? { id: lower(useCaseId), code: rowString(r.use_case_code), title: String(r.use_case_title ?? "") } : null,
      canOpen: viewer.canOpen,
      roles: viewer.roles,
      nextStep: null,
    });
  }
  if (facts.length === 0) return empty;
  const inputs = parseScopedNextStepRows(nextStepRows, {
    caseIds: facts.map((f) => f.caseId),
    rolesByCase: new Map(facts.map((f) => [f.caseId, f.roles])),
    now: i.now ?? new Date(),
  });
  const cards = sortDossierCards(facts.map((f) => dossierCardView({ ...f, nextStep: inputs.get(f.caseId) ?? null })));
  const byUseCase = new Map<string, DossierCardView>();
  for (const card of cards) if (card.useCaseId) byUseCase.set(card.useCaseId, card);
  return { cards, byUseCase };
}

// ── Avvia la realizzazione (§3.2) ─────────────────────────────────────

export interface StartContext {
  useCaseId: string;
  title: string;
  status: string;
  kind: string;
  /** La colonna `use_cases.code` c'è (0019). */
  hasCodeColumn: boolean;
  /** Il codice dello use case; null senza colonna o senza codice. */
  code: string | null;
  texts: UseCaseTexts;
  /** Il dossier completo già collegato. */
  existingCaseId: string | null;
  /** Chi guarda è membro di quel dossier (solo se la lettura ha ricevuto `userId`). */
  existingCaseMember: boolean;
  /** Un dossier di questo use case è in creazione (meno di 10 minuti). */
  inProgress: boolean;
}

export function startContextSql(workspaceId: string, useCaseId: string, userId?: string | null): UcStatement {
  const member = userId
    ? ucSql`(SELECT EXISTS (SELECT 1 FROM uc_case_members m WHERE m.case_id = x.id AND m.user_id = ${cast(userId, "uuid")})
    FROM (SELECT c.id FROM uc_cases c WHERE c.portfolio_use_case_id = u.id AND c.workspace_id = u.workspace_id AND c.setup_completed_at IS NOT NULL
      ORDER BY c.created_at, c.id LIMIT 1) x)`
    : raw("false");
  return toStatement(ucSql`SELECT u.id, u.title, u.description, u.flow_description, u.human_in_the_loop, u.guardrails, u.data_requirements,
  u.status::text AS status, coalesce(u.portfolio_kind, 'use_case_ai') AS kind,
  (to_jsonb(u) -> 'code') IS NOT NULL AS has_code_column, to_jsonb(u) ->> 'code' AS use_case_code,
  (SELECT c.id FROM uc_cases c WHERE c.portfolio_use_case_id = u.id AND c.workspace_id = u.workspace_id AND c.setup_completed_at IS NOT NULL
    ORDER BY c.created_at, c.id LIMIT 1) AS existing_case_id,
  ${member} AS existing_case_member,
  EXISTS (SELECT 1 FROM uc_cases c WHERE c.portfolio_use_case_id = u.id AND c.workspace_id = u.workspace_id AND c.setup_completed_at IS NULL
    AND c.created_at > now() - ${raw(`interval '${STALE_INCOMPLETE_CASE_MINUTES} minutes'`)}) AS in_progress
FROM use_cases u
WHERE u.id = ${cast(useCaseId, "uuid")} AND u.workspace_id = ${cast(workspaceId, "uuid")}`);
}

function parseStartContext(row: Row | undefined): StartContext | null {
  if (!row || !isUuid(row.id)) return null;
  const title = String(row.title ?? "");
  return {
    useCaseId: lower(String(row.id)),
    title,
    status: String(row.status ?? ""),
    kind: String(row.kind ?? "use_case_ai"),
    hasCodeColumn: rowBool(row.has_code_column),
    code: rowString(row.use_case_code)?.trim() || null,
    texts: {
      title,
      problem: rowString(row.description),
      flow: rowString(row.flow_description),
      humanInTheLoop: rowString(row.human_in_the_loop),
      guardrails: rowString(row.guardrails),
      dataRequirements: rowString(row.data_requirements),
    },
    existingCaseId: isUuid(row.existing_case_id) ? lower(String(row.existing_case_id)) : null,
    existingCaseMember: rowBool(row.existing_case_member),
    inProgress: rowBool(row.in_progress),
  };
}

/**
 * Lo use case da cui parte il dossier, se è del workspace. Un giro. Con
 * `userId` dice anche se chi guarda è membro del dossier già avviato: la pagina
 * lo manda al dossier solo se lo può aprire.
 */
export async function readStartContext(executor: UcExecutor, i: { workspaceId: string; useCaseId: string; userId?: string | null }): Promise<StartContext | null> {
  if (!isUuid(i.workspaceId) || !isUuid(i.useCaseId)) return null;
  const [[row]] = await executor.batch([startContextSql(i.workspaceId, i.useCaseId, isUuid(i.userId) ? i.userId : null)]);
  return parseStartContext(row);
}

/** Il modulo manda solo questo: il codice lo prende il server dallo use case (§3.2). */
export const StartRealizationInputSchema = z
  .object({
    useCaseId: z.string().regex(UUID, "Use case non valido."),
    templateId: z.string().regex(UUID, "Scegli lo schema di partenza."),
    title: z.string().trim().min(3, "Scrivi il nome del dossier.").max(255, "Nome troppo lungo: al massimo 255 caratteri."),
    oneLiner: z.string().trim().max(500, "Frase troppo lunga: al massimo 500 caratteri.").nullish(),
  })
  .strip();
export type StartRealizationInput = z.input<typeof StartRealizationInputSchema>;

/** Esiti del comando, in italiano semplice (§3.2). */
export const START_MESSAGES = {
  use_case_non_trovato: "Use case non trovato in questo workspace.",
  best_practice: "Una best practice non ha un dossier: si segna come diffusa.",
  non_approvato: "La realizzazione parte solo da uno use case «Da costruire» approvato.",
  dossier_esistente: REALIZATION_TEXT.alreadyStarted,
  creazione_in_corso: "Stiamo già preparando il dossier di questo use case: riprova tra qualche minuto.",
  codice_mancante: REALIZATION_TEXT.noPrefix,
  codice_in_uso: "Nel workspace c'è già un dossier con il codice di questo use case.",
  codice_appena_usato: "Codice appena usato da un altro dossier: riprova.",
  testo_dallo_use_case: "Il testo dello use case contiene dati da non copiare nel dossier: correggilo nella scheda.",
} as const;

/** Codici già usati nel workspace con lo stesso prefisso generato (anche dossier in creazione). */
function takenCodesSql(workspaceId: string, stem: string): UcStatement {
  return toStatement(ucSql`SELECT code FROM uc_cases WHERE workspace_id = ${cast(workspaceId, "uuid")} AND code LIKE ${cast(`${stem}-UC-%`, "text")}`);
}

/**
 * Esiti della creazione che vengono da un altro dossier: con lo stesso codice, o
 * (`scheda_occupata`, indice unico tra dossier e scheda) dello stesso use case.
 */
const CODE_CLASHES = new Set(["codice_in_uso", "creazione_in_corso", "codice_conflitto", "scheda_occupata"]);

/** Il vincolo violato di un errore Postgres (anche dentro `cause`), se c'è. */
function pgConstraintOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth++) {
    const constraint = (current as { constraint?: unknown }).constraint;
    if (typeof constraint === "string" && constraint) return constraint;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * «Avvia la realizzazione»: un dossier in bozza da uno use case «Da costruire»
 * approvato e senza dossier, con il codice e i testi dello use case. Chi avvia
 * è una persona di Lateral Space con il permesso di revisione e ne diventa
 * responsabile. Un secondo avvio sullo stesso use case è rifiutato: prima dal
 * controllo qui, poi dal codice unico nel workspace (e dall'indice unico di
 * P0-16, quando c'è). La riga di Storia «Realizzazione avviata» la aggiunge la
 * pagina Use case (H6a).
 *
 * Il codice è unico nel workspace, non per use case: senza `use_cases.code`
 * (prima della 0019) viene dalle iniziali del nome, e due use case diversi
 * possono volerlo nello stesso momento. Quando la creazione inciampa in un
 * altro dossier con lo stesso codice, si rilegge questo use case: «ha già un
 * dossier» o «in preparazione» solo se è davvero suo; altrimenti, con il codice
 * generato, si riprova una volta con un codice libero, e con il codice dello
 * use case si dice che il codice è appena stato usato. Se invece inciampa
 * nell'indice unico tra dossier e scheda, il codice non c'entra: «ha già un
 * dossier» o «in preparazione», mai «codice appena usato». Le righe incomplete
 * ferme sulla scheda le toglie la creazione stessa (`createCaseFromTemplate`).
 */
export async function startRealization(
  executor: UcExecutor,
  i: { workspaceId: string; user: UserContext; canReviewWorkspacePortfolio: boolean; input: unknown; now?: () => Date },
): Promise<Result<{ caseId: string; code: string; useCaseId: string }>> {
  const creator = checkCaseCreator({ user: i.user, canReviewWorkspacePortfolio: i.canReviewWorkspacePortfolio });
  if (!creator.ok) return fail(creator.code, "Solo Lateral Space avvia la realizzazione.");
  if (!isUuid(i.workspaceId)) return fail("use_case_non_trovato", START_MESSAGES.use_case_non_trovato);
  const parsed = StartRealizationInputSchema.safeParse(i.input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Controlla i dati del dossier.");
  const v = parsed.data;
  const text = checkLsText({ title: v.title, one_liner: v.oneLiner ?? "" });
  if (!text.ok) return text;

  const context = await readStartContext(executor, { workspaceId: i.workspaceId, useCaseId: v.useCaseId });
  if (!context) return fail("use_case_non_trovato", START_MESSAGES.use_case_non_trovato);
  if (context.existingCaseId) return fail("dossier_esistente", START_MESSAGES.dossier_esistente);
  if (context.inProgress) return fail("creazione_in_corso", START_MESSAGES.creazione_in_corso);
  if (context.kind === "best_practice") return fail("best_practice", START_MESSAGES.best_practice);
  if (context.status !== "accepted" || context.kind !== "use_case_ai") return fail("non_approvato", START_MESSAGES.non_approvato);

  /** Il codice del dossier; senza la colonna, il primo libero tra i codici generati dal nome. */
  const chooseCode = async () => {
    let taken = new Set<string>();
    if (!context.hasCodeColumn) {
      const [rows] = await executor.batch([takenCodesSql(i.workspaceId, generatedCodeStem(v.title))]);
      taken = new Set(rows.map((r) => String(r.code)));
    }
    return dossierCodeFor({ hasCodeColumn: context.hasCodeColumn, useCaseCode: context.code, title: v.title, taken });
  };

  let code = await chooseCode();
  if (!code.ok) return fail("codice_mancante", START_MESSAGES.codice_mancante);
  const overrides = realizationDescription(context.texts);
  const scan = checkLsText(overrides);
  if (!scan.ok) return fail(scan.code, START_MESSAGES.testo_dallo_use_case);

  /**
   * Una creazione. Un 23505 sull'indice unico tra dossier e scheda (P0-16) diventa
   * `scheda_occupata`, ogni altro 23505 (codice unico) `codice_conflitto`.
   */
  const create = async (caseCode: string) => {
    try {
      return await createCaseFromTemplate(executor, {
        workspaceId: i.workspaceId,
        template: { templateId: v.templateId },
        actorUserId: i.user.userId,
        code: caseCode,
        title: v.title,
        oneLiner: v.oneLiner || null,
        portfolioUseCaseId: context.useCaseId,
        descriptionOverrides: overrides,
        now: i.now,
      });
    } catch (error) {
      if (pgCodeOf(error) !== "23505") throw error;
      if (pgConstraintOf(error) === UC_UNIQUE_DOSSIER_INDEX) return fail("scheda_occupata", START_MESSAGES.creazione_in_corso);
      return fail("codice_conflitto", START_MESSAGES.codice_appena_usato);
    }
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      code = await chooseCode();
      if (!code.ok) return fail("codice_mancante", START_MESSAGES.codice_mancante);
    }
    const created = await create(code.code);
    if (created.ok) return ok({ caseId: created.value.caseId, code: created.value.code, useCaseId: context.useCaseId });
    if (created.code === "template_non_trovato") return fail("template_non_trovato", "Schema di partenza non trovato: scegline un altro.");
    if (!CODE_CLASHES.has(created.code)) return created;
    // Di chi è il dossier con quel codice? Solo se è di questo use case lo si dice.
    const fresh = await readStartContext(executor, { workspaceId: i.workspaceId, useCaseId: context.useCaseId });
    if (!fresh) return fail("use_case_non_trovato", START_MESSAGES.use_case_non_trovato);
    if (fresh.existingCaseId) return fail("dossier_esistente", START_MESSAGES.dossier_esistente);
    if (fresh.inProgress) return fail("creazione_in_corso", START_MESSAGES.creazione_in_corso);
    // L'altro dossier della scheda non c'è più (una creazione appena fallita): si riprova una
    // volta, poi «in preparazione». Il codice non c'entra: cambiarlo non servirebbe.
    if (created.code === "scheda_occupata") {
      if (attempt === 0) continue;
      return fail("creazione_in_corso", START_MESSAGES.creazione_in_corso);
    }
    // Il codice dello use case non cambia: un altro dossier lo usa già (o lo sta prendendo adesso).
    if (context.hasCodeColumn) {
      return created.code === "codice_in_uso" ? fail("codice_in_uso", START_MESSAGES.codice_in_uso) : fail("codice_appena_usato", START_MESSAGES.codice_appena_usato);
    }
  }
  return fail("codice_appena_usato", START_MESSAGES.codice_appena_usato);
}
