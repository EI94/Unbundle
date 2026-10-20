/**
 * Letture del dossier rimaste da WP8 (PIANO §5.1): membri e candidati di
 * Impostazioni, designazioni dei firmatari e file di prova di Persone, extra
 * dell'avanzamento della Panoramica, l'evento dell'export di Attività e gli use
 * case da cui si avvia un dossier. Più la modifica di un solo blocco della
 * descrizione sopra `updateCaseDescription`. Privacy e Attività leggono da
 * `uc-events.ts` (DESIGN §8.3 WP13: i vecchi caricatori di Privacy e Registro
 * non ci sono più).
 *
 * Solo letture filtrate per caso e per workspace; l'accesso al workspace e al
 * caso lo controlla la pagina (`requireWorkspacePage(` e `requireCaseRole`)
 * prima di chiamarle. Mai valori delle risposte, mai valori personali.
 *
 * Modulo senza import dell'app, come `uc-cases.ts`: l'esecutore arriva da fuori.
 */
import { z } from "zod";
import { userContextFrom } from "../../uc/lateral-space.ts";
import { rowBool, rowDate, rowJson, rowObject, rowString, rowVocab } from "../../uc/sql/readiness.ts";
import { cast, toStatement, ucSql } from "../../uc/sql/statement.ts";
import { templatePartsReader } from "../../uc/sql/template-parts.ts";
import { fail, ok, type Json, type Result } from "../../uc/types.ts";
import { changedBlocks, normalizeBlockInput, parseDescriptionHistory, stableJson, withBlock, type DescriptionHistoryEntry } from "../../uc/views/description.ts";
import type { MemberRowInput } from "../../uc/views/people.ts";
import { CASE_ROLES } from "../../uc/vocab.ts";
import { isUuid, updateCaseDescription, type UcCommandContext } from "./uc-cases.ts";
import { eventInsertSql } from "./uc-events.ts";
import type { UcExecutor } from "../uc-executor.ts";

const uuid = (v: string) => cast(v, "uuid");

/** Il caso esiste, è completo ed è del workspace (ogni lettura lo ripete). */
function caseOf(workspaceId: string, caseId: string) {
  return ucSql`(SELECT c.id FROM uc_cases c WHERE c.id = ${uuid(caseId)} AND c.workspace_id = ${uuid(workspaceId)} AND c.setup_completed_at IS NOT NULL)`;
}

// ── Persone ───────────────────────────────────────────────────────────

/** Membri del caso, una riga per ruolo, con «è Lateral Space» ricalcolato dal dominio dell'email verificata. */
export async function loadCaseMembers(executor: UcExecutor, i: { workspaceId: string; caseId: string; lsDomains: readonly string[] }): Promise<MemberRowInput[]> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId)) return [];
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT m.user_id, m.role, m.personal_zone_access, m.personal_zone_grant, u.name, u.email, u.email_verified
FROM uc_case_members m JOIN users u ON u.id = m.user_id
WHERE m.case_id = ${caseOf(i.workspaceId, i.caseId)}
ORDER BY lower(coalesce(u.name, u.email)), m.created_at`),
  ]);
  return rows.flatMap((r) => {
    const role = rowVocab(CASE_ROLES, r.role);
    if (!role) return [];
    const user = userContextFrom({ id: String(r.user_id), email: rowString(r.email), emailVerified: (r.email_verified as Date | string | null) ?? null }, i.lsDomains);
    return [
      {
        userId: String(r.user_id),
        role,
        name: rowString(r.name),
        email: rowString(r.email),
        isLateralSpace: user.isLateralSpace,
        personalZoneAccess: rowBool(r.personal_zone_access),
        personalZoneGrant: (rowJson(r.personal_zone_grant) as Json | null) ?? null,
      },
    ];
  });
}

export interface MemberCandidate {
  userId: string;
  name: string;
  email: string | null;
  isLateralSpace: boolean;
  workspaceRole: string;
}

/** Collaboratori del workspace (mai chi partecipa solo ai corsi): chi si può aggiungere al caso. */
export async function loadMemberCandidates(executor: UcExecutor, i: { workspaceId: string; lsDomains: readonly string[] }): Promise<MemberCandidate[]> {
  if (!isUuid(i.workspaceId)) return [];
  const ws = uuid(i.workspaceId);
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT DISTINCT ON (u.id) u.id, u.name, u.email, u.email_verified, x.role
FROM (
  SELECT m.user_id, m.role::text AS role, 1 AS pri FROM memberships m JOIN workspaces w ON w.organization_id = m.organization_id WHERE w.id = ${ws}
  UNION ALL
  SELECT wm.user_id, wm.role::text AS role, 2 AS pri FROM workspace_memberships wm WHERE wm.workspace_id = ${ws}
) x JOIN users u ON u.id = x.user_id
WHERE x.role <> 'learner'
ORDER BY u.id, x.pri`),
  ]);
  return rows
    .map((r) => {
      const user = userContextFrom({ id: String(r.id), email: rowString(r.email), emailVerified: (r.email_verified as Date | string | null) ?? null }, i.lsDomains);
      return { userId: String(r.id), name: rowString(r.name) ?? rowString(r.email) ?? "Persona senza nome", email: rowString(r.email), isLateralSpace: user.isLateralSpace, workspaceRole: String(r.role) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "it"));
}

export interface SignerDesignation {
  contactId: string;
  /** File di prova della designazione (l'email del cliente che indica la persona). */
  evidenceFileId: string | null;
  evidenceFileName: string | null;
  at: string | null;
}

/** Designazioni dei firmatari del cliente con il nome del file di prova: mai nomi o email. */
export async function loadSignerDesignations(executor: UcExecutor, i: { workspaceId: string; caseId: string }): Promise<Partial<Record<"owner" | "privacy", SignerDesignation>>> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId)) return {};
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT d.key AS designation, d.value ->> 'contact_id' AS contact_id, d.value ->> 'evidence_file_id' AS evidence_file_id, d.value ->> 'at' AS at, f.file_name
FROM uc_cases c
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(c.signers_designation) = 'object' THEN c.signers_designation ELSE '{}'::jsonb END) d
LEFT JOIN uc_files f ON f.case_id = c.id AND f.deleted_at IS NULL AND f.id::text = d.value ->> 'evidence_file_id'
WHERE c.id = ${caseOf(i.workspaceId, i.caseId)} AND d.key IN ('owner', 'privacy') AND jsonb_typeof(d.value) = 'object'`),
  ]);
  const out: Partial<Record<"owner" | "privacy", SignerDesignation>> = {};
  for (const r of rows) {
    const key = r.designation === "owner" || r.designation === "privacy" ? r.designation : null;
    const contactId = rowString(r.contact_id);
    if (!key || !contactId || !isUuid(contactId)) continue;
    out[key] = { contactId, evidenceFileId: rowString(r.evidence_file_id), evidenceFileName: rowString(r.file_name), at: rowString(r.at) };
  }
  return out;
}

export interface UsableCaseFile {
  id: string;
  name: string;
  createdAt: string | null;
}

/**
 * File del caso utilizzabili come prova scritta (puliti e scansionati o
 * revisionati, zona standard): designazione dei firmatari, scheda A.8, verbali.
 */
export async function loadUsableCaseFiles(executor: UcExecutor, i: { workspaceId: string; caseId: string }): Promise<UsableCaseFile[]> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId)) return [];
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT f.id, f.file_name, f.created_at FROM uc_files f
WHERE f.case_id = ${caseOf(i.workspaceId, i.caseId)} AND f.deleted_at IS NULL AND f.storage_zone = 'standard'
  AND f.scan_status = 'pulito' AND (f.content_scanned OR f.reviewed_at IS NOT NULL)
ORDER BY f.created_at DESC LIMIT 200`),
  ]);
  return rows.map((r) => ({ id: String(r.id), name: String(r.file_name), createdAt: rowDate(r.created_at)?.toISOString() ?? null }));
}

// ── Descrizione ───────────────────────────────────────────────────────

export interface DescriptionData {
  description: Record<string, Json>;
  history: DescriptionHistoryEntry[];
  /** Nomi degli autori delle versioni (id utente → nome). */
  authors: Map<string, string>;
}

export async function loadDescriptionData(executor: UcExecutor, i: { workspaceId: string; caseId: string }): Promise<DescriptionData | null> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId)) return null;
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT c.description, c.description_history,
  (SELECT coalesce(jsonb_object_agg(u.id::text, coalesce(u.name, u.email)), '{}'::jsonb) FROM users u
   WHERE u.id::text IN (SELECT h ->> 'by_user_id' FROM jsonb_array_elements(c.description_history) h)) AS authors
FROM uc_cases c WHERE c.id = ${caseOf(i.workspaceId, i.caseId)}`),
  ]);
  const row = rows[0];
  if (!row) return null;
  const authors = new Map<string, string>();
  for (const [k, v] of Object.entries(rowObject(row.authors))) if (typeof v === "string") authors.set(k, v);
  return { description: rowObject(row.description), history: parseDescriptionHistory(rowJson(row.description_history)), authors };
}

const BlockEditSchema = z.object({
  block: z.string().regex(/^[a-z0-9_]{1,60}$/),
  value: z.unknown(),
  /** Valore del blocco che l'editor ha visto (JSON stabile): se nel frattempo è cambiato, conflitto. */
  base: z.string().max(400_000),
});

/**
 * Modifica di un solo blocco della descrizione (Responsabile del caso): rilegge
 * la descrizione, controlla che il blocco sia ancora quello visto dall'editor,
 * sostituisce solo quel blocco e passa da `updateCaseDescription` (permessi,
 * scansione del testo, cronologia, evento e compare-and-swap).
 */
export async function updateDescriptionBlock(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ blocks: string[] }>> {
  const parsed = BlockEditSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Blocco della descrizione non valido.");
  const value = normalizeBlockInput(parsed.data.block, parsed.data.value);
  if (!value.ok) return value;
  const current = await loadDescriptionData(executor, { workspaceId: ctx.workspaceId, caseId: ctx.caseId });
  if (!current) return fail("non_trovato", "Caso non trovato.");
  if (stableJson(current.description[parsed.data.block] ?? null) !== parsed.data.base) {
    return fail("conflitto", "Qualcuno ha appena modificato questo blocco. Aggiorna la pagina e riprova.");
  }
  const next = withBlock(current.description, parsed.data.block, value.value);
  if (changedBlocks(current.description, next).length === 0) return ok({ blocks: [] });
  return updateCaseDescription(executor, ctx, { description: next });
}

// ── Avanzamento ───────────────────────────────────────────────────────

export interface MilestoneRow {
  key: string;
  title: string;
  plannedDate: string | null;
  plannedLabel: string | null;
  isProposal: boolean;
  toConfirm: boolean;
  ownerLabel: string | null;
  done: boolean;
  notes: string | null;
}

export interface ProgressExtras {
  milestones: MilestoneRow[];
  /** Regola del gate G1 dal template e chi lo approva (chiavi di ruolo). */
  gate: { label: string | null; rule: string | null; approvers: string[] };
  contactNames: Map<string, string>;
}

export async function loadProgressExtras(executor: UcExecutor, i: { workspaceId: string; caseId: string }): Promise<ProgressExtras | null> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId)) return null;
  const c = caseOf(i.workspaceId, i.caseId);
  // La regola del gate dalle parti del template, lette una volta per impronta (DESIGN §7.1 P0-5 b).
  const parts = templatePartsReader();
  const [milestones, template, contacts] = await executor.batch([
    toStatement(ucSql`SELECT key, title, planned_date::text AS planned_date, planned_label, is_proposal, to_confirm, owner_label, done_at, notes
FROM uc_milestones WHERE case_id = ${c} ORDER BY sort_order, planned_date NULLS LAST, key`),
    toStatement(ucSql`SELECT ${parts.columns} FROM uc_cases cs JOIN uc_templates t ON t.id = cs.template_id WHERE cs.id = ${c}`),
    toStatement(ucSql`SELECT ct.id, ct.display_name FROM uc_contacts ct WHERE ct.workspace_id = ${uuid(i.workspaceId)}`),
  ]);
  const g = rowObject((parts.read(template[0])?.gates ?? []).find((x) => rowObject(x).key === "G1") ?? null);
  return {
    milestones: milestones.map((r) => ({
      key: String(r.key),
      title: String(r.title),
      plannedDate: rowString(r.planned_date),
      plannedLabel: rowString(r.planned_label),
      isProposal: rowBool(r.is_proposal),
      toConfirm: rowBool(r.to_confirm),
      ownerLabel: rowString(r.owner_label),
      done: r.done_at !== null && r.done_at !== undefined,
      notes: rowString(r.notes),
    })),
    gate: {
      label: typeof g.label === "string" ? g.label : null,
      rule: typeof g.rule === "string" ? g.rule : null,
      approvers: Array.isArray(g.approvers) ? g.approvers.filter((a): a is string => typeof a === "string") : [],
    },
    contactNames: new Map(contacts.map((r) => [String(r.id), String(r.display_name)])),
  };
}

// ── Attività ──────────────────────────────────────────────────────────

/** Evento dell'export CSV di Attività (`registro.esportato`): formato e numero di righe, nient'altro. */
export async function recordAuditExport(executor: UcExecutor, i: { workspaceId: string; caseId: string; userId: string; rows: number }): Promise<void> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId) || !isUuid(i.userId)) return;
  // Il caso è di quel workspace, altrimenti il batch si annulla e l'evento non nasce.
  await executor.batch([
    toStatement(ucSql`SELECT uc_require(EXISTS ${caseOf(i.workspaceId, i.caseId)}, 'non_trovato') AS ok`),
    toStatement(
      eventInsertSql({
        type: "registro.esportato",
        workspaceId: i.workspaceId,
        caseId: i.caseId,
        actor: { type: "utente", userId: i.userId },
        targetType: "caso",
        targetId: i.caseId,
        payload: { format: "csv", count: i.rows },
      }),
    ),
  ]);
}

// ── Nuovo caso ────────────────────────────────────────────────────────

export interface StartablePortfolioCard {
  id: string;
  title: string;
}

/**
 * Use case approvati e «Da costruire» del workspace che non hanno ancora un
 * dossier (docs/use-case/DESIGN.md §6.5, §10.4 punto 5). «Da costruire» è
 * `portfolio_kind = 'use_case_ai'` oppure vuoto (le righe più vecchie di
 * Activity mapping): una best practice non si realizza. Un dossier conta solo
 * se completo (`setup_completed_at IS NOT NULL`), come per la Roadmap e il
 * connettore.
 */
export async function listStartablePortfolioCards(executor: UcExecutor, workspaceId: string): Promise<StartablePortfolioCard[]> {
  if (!isUuid(workspaceId)) return [];
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT u.id, u.title FROM use_cases u
WHERE u.workspace_id = ${uuid(workspaceId)} AND u.status::text = 'accepted'
  AND coalesce(u.portfolio_kind, 'use_case_ai') = 'use_case_ai'
  AND NOT EXISTS (SELECT 1 FROM uc_cases c WHERE c.portfolio_use_case_id = u.id AND c.workspace_id = u.workspace_id AND c.setup_completed_at IS NOT NULL)
ORDER BY lower(u.title) LIMIT 500`),
  ]);
  return rows.map((r) => ({ id: String(r.id), title: String(r.title) }));
}
