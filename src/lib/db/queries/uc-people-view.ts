/**
 * Letture e comandi delle pagine di WP6 (DESIGN §3.9, §3.13.2, §3.13.3):
 * Persone (la lista unica di chi risponde per il cliente, le righe «Senza
 * referente», i firmatari), il pannello «Invia le domande», Impostazioni ›
 * «Il caso» e «Perimetro e leve», e il codice da mostrare nel nome
 * dell'accesso di Claude.
 *
 * - La lista è una sola lettura in batch (un giro): caso, ruoli dello schema,
 *   referenti, richieste e domande senza referente per ruolo.
 * - Ai ruoli del cliente la lettura dei referenti non conta nulla per persona
 *   (art. 15.4): solo nome, ruolo e se la persona c'entra con il dossier.
 * - Il codice del dossier è quello dello use case, letto con
 *   `to_jsonb(u) ->> 'code'` (vale anche sui rami senza la colonna): il codice
 *   del dossier resta solo nei dettagli tecnici quando è diverso (§2.1).
 * - I comandi passano dai comandi esistenti (`assignItems`) o scrivono con un
 *   compare-and-swap più l'evento nello stesso batch.
 *
 * Modulo senza import dell'app (`@/…`, `server-only`), come `uc-requests.ts`.
 */
import { z } from "zod";
import { checkCaseTransition, MVP_AVAILABLE_GATES, nextCaseStatuses } from "../../uc/case-state.ts";
import { can } from "../../uc/permissions.ts";
import { caseCoreSql, parseCaseCore, rowBool, rowJson, rowNumber, rowString, rowVocab, type Row } from "../../uc/sql/readiness.ts";
import { assignmentItemsSql, caseRequestsListSql, SENDABLE_ITEM_STATUSES } from "../../uc/sql/request-commands.ts";
import { cast, jsonb, requireRows, toStatement, ucSql, type UcStatement } from "../../uc/sql/statement.ts";
import { fail, ok, type Result } from "../../uc/types.ts";
import type { PeopleAudience, PersonContactLike } from "../../uc/views/people.ts";
import { ASSIGNABLE_STATUSES, CATALOG_SELECTION_MAX, roleGroupItemsSql, roleGroupsSql } from "../../uc/views/sql.ts";
import { CASE_STATUSES, isVocab, LEVERS, type CaseStatus, type GateKey, type Lever } from "../../uc/vocab.ts";
import { eventActorFrom, eventInsertSql } from "./uc-events.ts";
import { actorRoles, checkLsText, isUuid, runCommand, type UcCommandContext } from "./uc-cases.ts";
import { assignItems, requestSummariesFromRows, type AssignmentResult, type RequestSummary } from "./uc-requests.ts";
import { caseViewContextReader } from "./uc-views.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { UUID } from "../../uc/ids.ts";

const Id = z.string().regex(UUID, "Identificativo non valido.");
const ROLE_KEY = /^[a-z0-9_]{1,80}$/;
/** Voci per chiamata di `assignItems` (il suo massimo). */
const ASSIGN_CHUNK = 2000;

// ── Persone ───────────────────────────────────────────────────────────

/** Referenti del workspace per Lateral Space: con i conteggi delle domande di questo dossier. */
export function peopleContactsLsSql(workspaceId: string, caseId: string): UcStatement {
  const c = cast(caseId, "uuid");
  return toStatement(ucSql`SELECT ct.id, ct.display_name, ct.role_label, ct.template_role_key, ct.email, ct.phone_e164, ct.preferred_channel, ct.is_active,
  ct.anonymized_at IS NOT NULL AS anonymized, ct.email IS NOT NULL AS has_email,
  n.assigned, n.open_items, n.unsent,
  (n.assigned > 0 OR EXISTS (SELECT 1 FROM uc_requests r WHERE r.case_id = ${c} AND r.contact_id = ct.id)) AS involved
FROM uc_contacts ct
CROSS JOIN LATERAL (
  SELECT count(*)::int AS assigned,
    count(*) FILTER (WHERE i.status NOT IN ('validata', 'non_applicabile'))::int AS open_items,
    count(*) FILTER (WHERE i.status = ANY(${cast([...SENDABLE_ITEM_STATUSES], "text[]")}) AND i.response_type IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id WHERE ib.item_id = i.id AND b.status IN ('attivo', 'permanente'))
      AND NOT EXISTS (SELECT 1 FROM uc_request_items ri WHERE ri.item_id = i.id AND ri.state IN ('da_fare', 'bozza', 'inviata')))::int AS unsent
  FROM uc_items i
  WHERE i.case_id = ${c} AND i.assignee_contact_id = ct.id AND i.deleted_at IS NULL
) n
WHERE ct.workspace_id = ${cast(workspaceId, "uuid")}
ORDER BY lower(ct.display_name), ct.id`);
}

/**
 * Referenti del workspace per i ruoli del cliente (art. 15.4): nessun
 * conteggio per persona, nessun recapito. Solo se la persona c'entra con il
 * dossier e se ha un'email (serve a designarla firmataria).
 */
export function peopleContactsClientSql(workspaceId: string, caseId: string): UcStatement {
  const c = cast(caseId, "uuid");
  return toStatement(ucSql`SELECT ct.id, ct.display_name, ct.role_label, ct.template_role_key, ct.is_active,
  ct.anonymized_at IS NOT NULL AS anonymized, ct.email IS NOT NULL AS has_email,
  (EXISTS (SELECT 1 FROM uc_items i WHERE i.case_id = ${c} AND i.assignee_contact_id = ct.id AND i.deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM uc_requests r WHERE r.case_id = ${c} AND r.contact_id = ct.id)) AS involved
FROM uc_contacts ct
WHERE ct.workspace_id = ${cast(workspaceId, "uuid")}
ORDER BY lower(ct.display_name), ct.id`);
}

/** Nome del cliente (il workspace), per l'anteprima del messaggio. */
function workspaceNameSql(workspaceId: string): UcStatement {
  return toStatement(ucSql`SELECT name FROM workspaces WHERE id = ${cast(workspaceId, "uuid")}`);
}

/** Una riga di `peopleContacts*Sql` per la lista. I conteggi solo se la lettura li ha. */
export function personContactFromRow(row: Row, audience: PeopleAudience): PersonContactLike {
  const ls = audience === "lateral_space";
  return {
    id: String(row.id),
    displayName: String(row.display_name ?? ""),
    roleLabel: rowString(row.role_label),
    templateRoleKey: rowString(row.template_role_key),
    email: ls ? rowString(row.email) : null,
    phone: ls ? rowString(row.phone_e164) : null,
    preferredChannel: ls ? rowString(row.preferred_channel) : null,
    hasEmail: rowBool(row.has_email),
    isActive: rowBool(row.is_active),
    anonymized: rowBool(row.anonymized),
    involved: rowBool(row.involved),
    counts: ls ? { assigned: rowNumber(row.assigned) ?? 0, open: rowNumber(row.open_items) ?? 0, unsent: rowNumber(row.unsent) ?? 0 } : null,
  };
}

export interface PeopleView {
  caseStatus: CaseStatus;
  caseTitle: string;
  /** Nome del workspace del cliente. */
  clientName: string;
  /** Etichette dei ruoli dello schema (con quelle del dossier). */
  roleLabels: Record<string, string>;
  /** Ruoli dello schema, nell'ordine dello schema: «Per quali domande». */
  templateRoles: { key: string; label: string }[];
  contacts: PersonContactLike[];
  /** Richieste del dossier, dalla più recente; per il cliente solo quelle partite, senza dettagli. */
  requests: RequestSummary[];
  /** Domande aperte per ruolo dello schema, con quante non hanno referente. */
  roleGroups: { roleKey: string; questions: number; unassigned: number }[];
  designated: { owner: string | null; privacy: string | null };
}

/**
 * La pagina Persone in un giro: caso e schema, referenti (con i conteggi solo
 * per Lateral Space), richieste e domande senza referente per ruolo. Null se
 * il dossier non c'è o non è del workspace.
 */
export async function loadPeopleView(executor: UcExecutor, i: { workspaceId: string; caseId: string; audience: PeopleAudience }): Promise<PeopleView | null> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId)) return null;
  const ls = i.audience === "lateral_space";
  const context = caseViewContextReader(i.workspaceId, i.caseId);
  const [coreRows, ctxRows, contactRows, requestRows, groupRows, wsRows] = await executor.batch([
    caseCoreSql(i.workspaceId, i.caseId),
    context.statement,
    ls ? peopleContactsLsSql(i.workspaceId, i.caseId) : peopleContactsClientSql(i.workspaceId, i.caseId),
    caseRequestsListSql(i),
    roleGroupsSql(i.caseId),
    workspaceNameSql(i.workspaceId),
  ]);
  const core = parseCaseCore(coreRows[0]);
  const ctx = context.parse(ctxRows);
  if (!core || !ctx) return null;
  return {
    caseStatus: core.status,
    caseTitle: core.title,
    clientName: rowString(wsRows[0]?.name) ?? "",
    roleLabels: ctx.roleLabels,
    templateRoles: Object.entries(ctx.roleLabels).map(([key, label]) => ({ key, label })),
    contacts: contactRows.map((r) => personContactFromRow(r, i.audience)),
    requests: requestSummariesFromRows(requestRows, { audience: i.audience, caseStatus: core.status }),
    roleGroups: groupRows.map((r) => ({ roleKey: String(r.role_key), questions: rowNumber(r.items) ?? 0, unassigned: rowNumber(r.unassigned) ?? 0 })),
    designated: core.designated,
  };
}

// ── Assegnazioni dalla pagina Persone ─────────────────────────────────

/**
 * Esito di un'assegnazione in blocco (per ruolo o «Affida…»): come
 * `assignItems`, più quello che non è andato. Le parti già fatte restano
 * scritte, quindi l'esito è un successo che dice dove si è fermato.
 */
export interface BulkAssignmentResult extends AssignmentResult {
  /** Si è fermata a metà: il motivo (le domande delle parti precedenti restano assegnate). */
  interrupted: string | null;
  /** Le domande erano più di `CATALOG_SELECTION_MAX`: le altre restano da assegnare. */
  truncated: boolean;
}

function mergeAssignments(parts: readonly AssignmentResult[], rest: { interrupted: string | null; truncated: boolean }): BulkAssignmentResult {
  const skipped = parts.flatMap((p) => p.skipped).slice(0, 200);
  return {
    assigned: parts.reduce((n, p) => n + p.assigned, 0),
    unchanged: parts.reduce((n, p) => n + p.unchanged, 0),
    skipped,
    skippedTotal: parts.reduce((n, p) => n + p.skippedTotal, 0),
    roleMismatch: parts.reduce((n, p) => n + p.roleMismatch, 0),
    ...rest,
  };
}

/**
 * Le voci a gruppi della misura di `assignItems` (`assignChunk`), poi i
 * risultati insieme. Al primo errore si ferma: senza parti fatte è l'errore;
 * dopo, l'esito delle parti fatte con il motivo in `interrupted`, così il toast
 * non tace le altre (e la pagina si aggiorna, perché l'esito è un successo).
 */
export async function assignInChunks(
  itemIds: readonly string[],
  assignChunk: (ids: string[]) => Promise<Result<AssignmentResult>>,
  o: { truncated?: boolean } = {},
): Promise<Result<BulkAssignmentResult>> {
  const parts: AssignmentResult[] = [];
  const truncated = o.truncated === true;
  for (let start = 0; start < itemIds.length; start += ASSIGN_CHUNK) {
    const r = await assignChunk(itemIds.slice(start, start + ASSIGN_CHUNK));
    if (!r.ok) return parts.length > 0 ? ok(mergeAssignments(parts, { interrupted: r.message, truncated })) : r;
    parts.push(r.value);
  }
  return ok(mergeAssignments(parts, { interrupted: null, truncated }));
}

/** Un gruppo di voci a un referente, con il comando di sempre (`assignItems`, modo «voci»). */
function assignTo(executor: UcExecutor, ctx: UcCommandContext, contactId: string): (ids: string[]) => Promise<Result<AssignmentResult>> {
  return (ids) => assignItems(executor, ctx, { mode: "voci", itemIds: ids, contactId });
}

const AssignRoleSchema = z.object({
  roleKey: z.string().trim().regex(ROLE_KEY, "Ruolo non valido."),
  contactId: Id,
  includeAssigned: z.boolean().optional(),
});

/**
 * «Senza referente › Assegna» e il passo 1 di «Invia le domande»: le domande
 * aperte di un ruolo dello schema (le stesse che conta la riga) vanno a un
 * referente. Di base solo quelle senza referente; «Riassegna anche quelle già
 * assegnate» solo per chi assegna in blocco (il responsabile Lateral Space).
 * Il responsabile del cliente assegna le domande senza referente
 * (`riassegnare`, permessi di oggi). Ogni voce la ricontrolla `assignItems`.
 */
export async function assignRoleQuestions(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<BulkAssignmentResult>> {
  const parsed = AssignRoleSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Scegli il ruolo e il referente.");
  const { roleKey, contactId } = parsed.data;
  const includeAssigned = parsed.data.includeAssigned === true;
  const roles = actorRoles(ctx);
  if (!can(roles, "riassegnare")) return fail("attore_non_ammesso", "Solo il responsabile Lateral Space o il responsabile del cliente assegnano le domande.");
  if (includeAssigned && !can(roles, "assegnare")) return fail("attore_non_ammesso", "Solo il responsabile Lateral Space riassegna le domande che hanno già un referente.");
  const [rows] = await executor.batch([roleGroupItemsSql(ctx.caseId, roleKey, includeAssigned)]);
  // La lettura chiede una riga in più del massimo: se c'è, le altre restano per un secondo giro.
  const truncated = rows.length > CATALOG_SELECTION_MAX;
  const itemIds = rows
    .slice(0, CATALOG_SELECTION_MAX)
    .filter((r) => isVocab(ASSIGNABLE_STATUSES, rowString(r.status)))
    .map((r) => String(r.id));
  if (itemIds.length === 0) return fail("nessuna_voce", "Nessuna domanda di questo ruolo da assegnare.");
  return assignInChunks(itemIds, assignTo(executor, ctx, contactId), { truncated });
}

const ReassignSchema = z.object({ fromContactId: Id, toContactId: Id });

/**
 * «Affida le sue domande a un altro collega» (responsabile del cliente, e
 * Lateral Space): le domande ancora aperte di un referente passano a un altro.
 * Quelle in un link ancora aperto restano dove sono: le salta `assignItems`,
 * con il motivo.
 */
export async function reassignContactQuestions(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<BulkAssignmentResult>> {
  const parsed = ReassignSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", "Scegli il collega.");
  const { fromContactId, toContactId } = parsed.data;
  if (fromContactId.toLowerCase() === toContactId.toLowerCase()) return fail("dati_non_validi", "Scegli un collega diverso.");
  if (!can(actorRoles(ctx), "riassegnare")) return fail("attore_non_ammesso", "Solo il responsabile Lateral Space o il responsabile del cliente affidano le domande a un collega.");
  const [rows] = await executor.batch([assignmentItemsSql({ caseId: ctx.caseId, contactIds: [fromContactId] })]);
  const itemIds = rows.filter((r) => isVocab(ASSIGNABLE_STATUSES, rowString(r.status))).map((r) => String(r.id));
  if (itemIds.length === 0) return fail("nessuna_voce", "Questa persona non ha domande aperte da affidare.");
  return assignInChunks(itemIds, assignTo(executor, ctx, toContactId));
}

// ── Impostazioni › Stato del caso ─────────────────────────────────────

function g1ApprovedSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT EXISTS (SELECT 1 FROM uc_gate_reviews g WHERE g.case_id = ${cast(caseId, "uuid")} AND g.gate_key = 'G1'
  AND g.decision IN ('approvato', 'approvato_con_riserva')) AS g1_approved`);
}

/**
 * Gli stati verso cui chi guarda può portare il dossier adesso, con le stesse
 * regole del comando (`checkCaseTransition`, che li ricontrolla), senza
 * calcolare la prontezza: un giro, due letture piccole.
 */
export async function loadStatusOptions(executor: UcExecutor, ctx: UcCommandContext): Promise<{ status: CaseStatus; statusBeforeSuspension: CaseStatus | null; allowed: CaseStatus[] } | null> {
  if (!isUuid(ctx.workspaceId) || !isUuid(ctx.caseId)) return null;
  const [coreRows, gateRows] = await executor.batch([caseCoreSql(ctx.workspaceId, ctx.caseId), g1ApprovedSql(ctx.caseId)]);
  const core = parseCaseCore(coreRows[0]);
  if (!core) return null;
  const now = ctx.now ?? new Date();
  const approvedGates = new Set<GateKey>(rowBool(gateRows[0]?.g1_approved) ? ["G1"] : []);
  const allowed = nextCaseStatuses(core.status, core.statusBeforeSuspension).filter(
    (to) =>
      checkCaseTransition({
        from: core.status,
        to,
        actor: ctx.actor,
        user: ctx.user,
        reason: "motivo",
        approvedGates,
        enteredAt: core.statusChangedAt,
        now,
        availableGates: MVP_AVAILABLE_GATES,
        statusBeforeSuspension: core.statusBeforeSuspension,
      }).ok,
  );
  return { status: core.status, statusBeforeSuspension: core.statusBeforeSuspension, allowed };
}

// ── Impostazioni › Il caso, Perimetro e leve ──────────────────────────

export interface CaseSettingsView {
  title: string;
  oneLiner: string | null;
  perimeterLabel: string | null;
  levers: Lever[];
  status: CaseStatus;
  /** Codice del dossier (`uc_cases.code`): entra negli export, nel MCP e nel testo firmato del via. */
  code: string;
  useCaseId: string | null;
  /** Codice dello use case (null sui rami senza la colonna o senza scheda madre). */
  useCaseCode: string | null;
  /** Il codice che si mostra: quello dello use case, altrimenti quello del dossier. */
  displayCode: string;
  /** Il codice di prima, solo se il dossier è nato con un codice diverso da quello dello use case. */
  previousCode: string | null;
  templateName: string;
  templateVersion: string;
}

function caseSettingsSql(workspaceId: string, caseId: string): UcStatement {
  return toStatement(ucSql`SELECT c.title, c.one_liner, c.perimeter_label, c.levers, c.code, c.status, c.template_version, t.name AS template_name,
  u.id AS use_case_id, to_jsonb(u) ->> 'code' AS use_case_code
FROM uc_cases c
JOIN uc_templates t ON t.id = c.template_id
LEFT JOIN use_cases u ON u.id = c.portfolio_use_case_id AND u.workspace_id = c.workspace_id
WHERE c.id = ${cast(caseId, "uuid")} AND c.workspace_id = ${cast(workspaceId, "uuid")} AND c.setup_completed_at IS NOT NULL`);
}

/** Le leve salvate, solo quelle note e nell'ordine fisso. */
function leversFrom(value: unknown): Lever[] {
  const list = rowJson<unknown[]>(value) ?? [];
  const on = new Set(list.filter((x): x is string => typeof x === "string"));
  return LEVERS.filter((l) => on.has(l));
}

/** Il codice da mostrare e quello di prima, dalle due colonne (§2.1: il codice è quello dello use case). */
export function dossierCodes(code: string, useCaseCode: string | null): { displayCode: string; previousCode: string | null } {
  const uc = useCaseCode?.trim() || null;
  return { displayCode: uc ?? code, previousCode: uc && uc !== code ? code : null };
}

/** Impostazioni del dossier: nome, frase, perimetro, leve, codici e schema di partenza. Null se il dossier non c'è. */
export async function loadCaseSettings(executor: UcExecutor, i: { workspaceId: string; caseId: string }): Promise<CaseSettingsView | null> {
  if (!isUuid(i.workspaceId) || !isUuid(i.caseId)) return null;
  const [[row]] = await executor.batch([caseSettingsSql(i.workspaceId, i.caseId)]);
  const status = rowVocab(CASE_STATUSES, row?.status);
  if (!row || !status) return null;
  const code = String(row.code);
  const useCaseCode = rowString(row.use_case_code);
  return {
    title: String(row.title ?? ""),
    oneLiner: rowString(row.one_liner),
    perimeterLabel: rowString(row.perimeter_label),
    levers: leversFrom(row.levers),
    status,
    code,
    useCaseId: rowString(row.use_case_id),
    useCaseCode,
    ...dossierCodes(code, useCaseCode),
    templateName: String(row.template_name ?? ""),
    templateVersion: String(row.template_version ?? ""),
  };
}

const SettingsSchema = z
  .object({
    title: z.string().trim().min(3, "Il nome deve avere almeno 3 caratteri.").max(255, "Il nome può avere al massimo 255 caratteri.").optional(),
    oneLiner: z.string().trim().max(500, "La frase può avere al massimo 500 caratteri.").nullable().optional(),
    perimeterLabel: z.string().trim().max(255, "Il perimetro può avere al massimo 255 caratteri.").nullable().optional(),
    levers: z.array(z.enum(LEVERS)).max(LEVERS.length).optional(),
  })
  .strict();

/** Nomi dei campi nell'evento `caso.descrizione_modificata` (solo nomi, mai i testi). */
const FIELD_BLOCK = { title: "nome", oneLiner: "in_una_frase", perimeterLabel: "perimetro", levers: "leve" } as const;

const SETTINGS_MESSAGES: Readonly<Record<string, string>> = {
  conflitto: "Qualcuno ha appena cambiato queste impostazioni. Aggiorna la pagina e riprova.",
  caso_chiuso: "Il dossier è chiuso: non si modifica più.",
};

/**
 * Impostazioni › «Il caso» e «Perimetro e leve» (solo il responsabile Lateral
 * Space): nome, frase, perimetro e leve. Il codice non si cambia mai: è quello
 * dello use case ed entra nel testo firmato del via (§2.1). I testi passano
 * dalla scansione; si scrive solo se i campi sono ancora quelli letti, con
 * l'evento nello stesso batch.
 */
export async function updateCaseSettings(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ fields: string[] }>> {
  if (!can(actorRoles(ctx), "gestire_membri")) return fail("attore_non_ammesso", "Solo il responsabile Lateral Space cambia le impostazioni del dossier.");
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", parsed.error.issues[0]?.message ?? "Controlla i campi.");
  const current = await loadCaseSettings(executor, ctx);
  if (!current) return fail("non_trovato", "Dossier non trovato.");
  if (current.status === "chiuso") return fail("caso_chiuso", SETTINGS_MESSAGES.caso_chiuso);
  const v = parsed.data;
  const next = {
    title: v.title ?? current.title,
    oneLiner: v.oneLiner === undefined ? current.oneLiner : v.oneLiner || null,
    perimeterLabel: v.perimeterLabel === undefined ? current.perimeterLabel : v.perimeterLabel || null,
    levers: v.levers === undefined ? current.levers : LEVERS.filter((l) => v.levers!.includes(l)),
  };
  const changed = (Object.keys(FIELD_BLOCK) as (keyof typeof FIELD_BLOCK)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(current[k]));
  if (changed.length === 0) return ok({ fields: [] });
  const text = checkLsText({ title: next.title, one_liner: next.oneLiner ?? "", perimeter: next.perimeterLabel ?? "" });
  if (!text.ok) return text;
  const c = cast(ctx.caseId, "uuid");
  const statements: UcStatement[] = [
    toStatement(
      requireRows(
        ucSql`UPDATE uc_cases SET title = ${cast(next.title, "text")}, one_liner = ${cast(next.oneLiner, "text")},
  perimeter_label = ${cast(next.perimeterLabel, "text")}, levers = ${jsonb(next.levers)}, updated_at = now()
WHERE id = ${c} AND workspace_id = ${cast(ctx.workspaceId, "uuid")} AND setup_completed_at IS NOT NULL AND status <> 'chiuso'
  AND title = ${cast(current.title, "text")} AND one_liner IS NOT DISTINCT FROM ${cast(current.oneLiner, "text")}
  AND perimeter_label IS NOT DISTINCT FROM ${cast(current.perimeterLabel, "text")}
  AND (SELECT coalesce(jsonb_agg(l ORDER BY l), '[]'::jsonb) FROM jsonb_array_elements_text(levers) AS l) = (SELECT coalesce(jsonb_agg(l ORDER BY l), '[]'::jsonb) FROM jsonb_array_elements_text(${jsonb(current.levers)}) AS l)
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
        payload: { blocks: changed.map((k) => FIELD_BLOCK[k]) },
      }),
    ),
  ];
  const run = await runCommand(executor, statements, SETTINGS_MESSAGES);
  return run.ok ? ok({ fields: changed.map((k) => FIELD_BLOCK[k]) }) : run;
}

