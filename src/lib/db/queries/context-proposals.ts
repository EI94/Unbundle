import "server-only";
/**
 * Le proposte e la conferma (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.4.5).
 *
 * Una proposta è una riga di `context_proposals`, fuori dalla memoria: la vede e la decide solo Lateral Space. In
 * memoria entra solo ciò che una persona conferma, tutto insieme o niente, in una transazione:
 * - `nuovo`, `decisione`: un fatto, con la fonte, la citazione e chi l'ha confermato;
 * - `cambia`, e un conflitto risolto con «Ora»: una versione nuova; quella di prima resta nella storia (`superato`);
 * - `conferma`, e un conflitto risolto con «Prima»: si rinfresca la data del fatto;
 * - `impegno`, `domanda`: una riga tra gli impegni o tra le domande aperte.
 * «Dedotto» e conflitti non sono mai preselezionati; una proposta da correggere (`issue`) non entra finché non è
 * corretta, e prima di scrivere il controllo dei testi si rifà su ogni frase.
 *
 * Il bersaglio di «cambia», «conferma» e «conflitto» è la versione attiva del fatto, seguendo la sua storia; se il
 * fatto è stato ritirato o non c'è più, la proposta vale come `nuovo`.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contextCommitments, contextEntities, contextEvents, contextFacts, contextProposals, contextQuestions, contextSources } from "@/lib/db/schema";
import { dayLabel, factSourceLabel } from "@/lib/context/labels";
import { entityKey, entityName, oneLine } from "@/lib/context/normalize";
import { isPreselected, realIsoDate } from "@/lib/context/read/reconcile";
import { isHardIssue, issueMessage, scanPersonalData, scanStatement } from "@/lib/context/scan";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities, type ContextActor } from "@/lib/context/visibility";
import {
  COMMITMENT_PARTIES,
  CONTEXT_LIMITS,
  CONTEXT_SECTIONS,
  CONTEXT_VISIBILITIES,
  type Basis,
  type CommitmentParty,
  type ContextEventAction,
  type ContextSection,
  type ContextVisibility,
  type EntityType,
  type FactKind,
  type FactOrigin,
  type ProposalEntity,
  type ProposalIssue,
  type ProposalKind,
  type ProposalRelation,
  type SkippedCounts,
  type SourceKind,
} from "@/lib/context/vocab";
import { logSafeError } from "@/lib/log/safe-error";
import type { ServiceResult } from "@/lib/use-cases/types";
import { ctxErrorCode, gate, invalid, isUniqueViolation, isUuid, knownUseCases, notFound, ok, requireSql, retry, romeToday, rowsOf, stale, toIsoDate, uuidArray } from "./context-shared";
import { contextStoreReady } from "./context-store";

const LOG_SCOPE = "context/proposals";

export interface ProposalView {
  id: string;
  version: number;
  sourceId: string;
  kind: ProposalKind;
  statement: string;
  quote: string | null;
  basis: Basis;
  section: ContextSection | null;
  visibility: ContextVisibility;
  /** Base «detto», tipo diverso da «conflitto», nessun `issue`. */
  preselected: boolean;
  issue: ProposalIssue | null;
  issueMessage: string | null;
  /** Il fatto in memoria che la proposta cambia, riconferma o contraddice: la sua versione attiva. `sourceLabel` senza data («Call»), `date` come a schermo («14 nov»). */
  before: { factId: string; statement: string; sourceLabel: string; date: string } | null;
  useCases: Array<{ id: string; code: string | null; title: string }>;
  party: CommitmentParty | null;
  roleLabel: string | null;
  dueOn: string | null;
  closesQuestion: { id: string; question: string } | null;
}
export interface OpenProposals {
  /** `kind`: «Call 14 nov» o «Documento 14 nov» nel «Ora: …» dei conflitti. */
  sources: Array<{ id: string; kind: SourceKind; title: string; occurredOn: string; skipped: SkippedCounts }>;
  /** Tutte tranne «conferma», nell'ordine: appunto più recente, poi `position`. */
  proposals: ProposalView[];
  /** Le «conferma». */
  reconfirmed: ProposalView[];
}

// ─── Leggere ─────────────────────────────────────────────────────────

interface TargetFact {
  id: string;
  kind: FactKind;
  section: ContextSection;
  statement: string;
  visibility: ContextVisibility;
  status: string;
  origin: FactOrigin;
  lastConfirmedAt: unknown;
  sourceKind: SourceKind | null;
  sourceDay: string | null;
}

/** Per ogni fatto, la versione in testa alla sua storia (quella attiva, o l'ultima se è stato ritirato). */
export async function resolveHeads(workspaceId: string, factIds: readonly string[]): Promise<Map<string, TargetFact>> {
  const out = new Map<string, TargetFact>();
  const ids = [...new Set(factIds.filter(isUuid))];
  if (ids.length === 0) return out;
  const rows = rowsOf<{ start_id: string; id: string; kind: FactKind; section: ContextSection; statement: string; visibility: ContextVisibility; status: string; origin: FactOrigin; last_confirmed_at: unknown; source_kind: SourceKind | null; source_day: unknown }>(
    await db.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT f.id AS start_id, f.id, 0 AS depth FROM context_facts f WHERE f.workspace_id = ${workspaceId}::uuid AND f.id = ANY(${uuidArray(ids)})
        UNION ALL
        SELECT c.start_id, n.id, c.depth + 1 FROM chain c JOIN context_facts n ON n.supersedes_id = c.id AND n.workspace_id = ${workspaceId}::uuid WHERE c.depth < 500
      ), head AS (
        SELECT DISTINCT ON (start_id) start_id, id FROM chain ORDER BY start_id, depth DESC
      )
      SELECT h.start_id, f.id, f.kind, f.section, f.statement, f.visibility, f.status, f.origin, f.last_confirmed_at, s.kind AS source_kind, s.occurred_on AS source_day
      FROM head h JOIN context_facts f ON f.id = h.id LEFT JOIN context_sources s ON s.id = f.source_id`),
  );
  for (const row of rows) {
    out.set(row.start_id, {
      id: row.id,
      kind: row.kind,
      section: row.section,
      statement: row.statement,
      visibility: row.visibility,
      status: row.status,
      origin: row.origin,
      lastConfirmedAt: row.last_confirmed_at,
      sourceKind: row.source_kind,
      sourceDay: row.source_day ? toIsoDate(row.source_day) : null,
    });
  }
  return out;
}

type ProposalRow = typeof contextProposals.$inferSelect;
const TARGET_KINDS: readonly ProposalKind[] = ["cambia", "conferma", "conflitto"];
const LOOSE_KINDS: readonly ProposalKind[] = ["impegno", "domanda"];

/** Il tipo che vale adesso: un «cambia», una «conferma» o un «conflitto» senza un fatto attivo da toccare valgono come `nuovo`. */
function effectiveKind(row: Pick<ProposalRow, "kind" | "targetFactId">, heads: ReadonlyMap<string, TargetFact>): { kind: ProposalKind; target: TargetFact | null } {
  if (!TARGET_KINDS.includes(row.kind)) return { kind: row.kind, target: null };
  const head = row.targetFactId ? heads.get(row.targetFactId) : undefined;
  return head && head.status === "attivo" ? { kind: row.kind, target: head } : { kind: "nuovo", target: null };
}

interface ViewContext {
  heads: ReadonlyMap<string, TargetFact>;
  useCases: ReadonlyMap<string, { id: string; code: string | null; title: string }>;
  questions: ReadonlyMap<string, string>;
  today: string;
}

function viewOf(row: ProposalRow, ctx: ViewContext): ProposalView {
  const { kind, target } = effectiveKind(row, ctx.heads);
  const question = row.questionId ? ctx.questions.get(row.questionId) : undefined;
  let before: ProposalView["before"] = null;
  if (target) {
    const source = factSourceLabel({ origin: target.origin, sourceKind: target.sourceKind, sourceOccurredOn: target.sourceDay }, ctx.today);
    before = { factId: target.id, statement: target.statement, sourceLabel: source.word, date: source.day ?? dayLabel(target.lastConfirmedAt as Date | string | null, ctx.today) };
  }
  return {
    id: row.id,
    version: row.version,
    sourceId: row.sourceId,
    kind,
    statement: row.statement,
    quote: row.quote,
    basis: row.basis,
    section: row.section,
    visibility: row.visibility,
    preselected: isPreselected({ basis: row.basis, kind, issue: row.issue }),
    issue: row.issue,
    issueMessage: row.issue ? issueMessage(row.issue) : null,
    before,
    useCases: row.useCaseIds.flatMap((id) => {
      const found = ctx.useCases.get(id);
      return found ? [found] : [];
    }),
    party: row.party,
    roleLabel: row.roleLabel,
    dueOn: row.dueOn,
    closesQuestion: row.questionId && question !== undefined ? { id: row.questionId, question } : null,
  };
}

/** Use case, domande aperte e fatti citati da queste proposte, per mostrarle. */
async function loadViewContext(workspaceId: string, rows: readonly ProposalRow[], now: Date = new Date()): Promise<ViewContext> {
  const useCaseIds = [...new Set(rows.flatMap((r) => r.useCaseIds))].filter(isUuid);
  const questionIds = [...new Set(rows.flatMap((r) => (r.questionId ? [r.questionId] : [])))];
  const factIds = rows.flatMap((r) => (r.targetFactId ? [r.targetFactId] : []));
  const [heads, useCases, questions] = await Promise.all([
    resolveHeads(workspaceId, factIds),
    useCaseIds.length > 0
      ? db.execute(sql`SELECT id, code, title FROM use_cases WHERE workspace_id = ${workspaceId}::uuid AND id = ANY(${uuidArray(useCaseIds)})`)
      : Promise.resolve({ rows: [] }),
    questionIds.length > 0
      ? db.execute(sql`SELECT id, question FROM context_questions WHERE workspace_id = ${workspaceId}::uuid AND status = 'aperta' AND id = ANY(${uuidArray(questionIds)})`)
      : Promise.resolve({ rows: [] }),
  ]);
  return {
    heads,
    useCases: new Map(rowsOf<{ id: string; code: string | null; title: string }>(useCases).map((u) => [u.id, { id: u.id, code: u.code, title: u.title }])),
    questions: new Map(rowsOf<{ id: string; question: string }>(questions).map((x) => [x.id, x.question])),
    today: romeToday(now),
  };
}

/** null a chi non è di Lateral Space. */
export async function listOpenProposals(actor: ContextActor, opts: { sourceId?: string } = {}): Promise<OpenProposals | null> {
  if (!contextAbilities(actor).canConfirm || !isUuid(actor.workspaceId) || !(await contextStoreReady())) return null;
  if (opts.sourceId !== undefined && !isUuid(opts.sourceId)) return { sources: [], proposals: [], reconfirmed: [] };
  const ws = actor.workspaceId;
  const joined = await db
    .select({ proposal: contextProposals, kind: contextSources.kind, title: contextSources.title, occurredOn: contextSources.occurredOn, skipped: contextSources.skipped })
    .from(contextProposals)
    .innerJoin(contextSources, eq(contextSources.id, contextProposals.sourceId))
    .where(
      and(
        eq(contextProposals.workspaceId, ws),
        eq(contextSources.workspaceId, ws),
        eq(contextProposals.status, "aperta"),
        ...(opts.sourceId ? [eq(contextProposals.sourceId, opts.sourceId)] : []),
      ),
    )
    .orderBy(desc(contextSources.occurredOn), desc(contextSources.createdAt), contextSources.id, contextProposals.position)
    .limit(500);
  const rows = joined.map((j) => j.proposal);
  const ctx = await loadViewContext(ws, rows);
  const sources = new Map<string, OpenProposals["sources"][number]>();
  for (const j of joined) {
    if (!sources.has(j.proposal.sourceId)) sources.set(j.proposal.sourceId, { id: j.proposal.sourceId, kind: j.kind, title: j.title, occurredOn: toIsoDate(j.occurredOn), skipped: j.skipped ?? {} });
  }
  const views = rows.map((row) => viewOf(row, ctx));
  return {
    sources: [...sources.values()],
    proposals: views.filter((v) => v.kind !== "conferma"),
    reconfirmed: views.filter((v) => v.kind === "conferma"),
  };
}

// ─── Correggere e scartare ───────────────────────────────────────────

export interface ProposalPatch {
  statement?: string;
  section?: ContextSection;
  visibility?: ContextVisibility;
  useCaseIds?: string[];
  party?: CommitmentParty;
  roleLabel?: string | null;
  dueOn?: string | null;
}

/** Corregge una proposta sul posto. Ricalcola `issue` con `scanStatement`; `edited = true`; `version + 1`. */
export async function editProposal(actor: ContextActor, proposalId: string, expectedVersion: number, patch: ProposalPatch): Promise<ServiceResult<ProposalView>> {
  const allowed = await gate(actor, "canConfirm");
  if (!allowed.ok) return allowed;
  if (!isUuid(proposalId)) return notFound();
  const ws = actor.workspaceId;
  const T = CONTEXT_TEXT;
  try {
    const [row] = await db.select().from(contextProposals).where(and(eq(contextProposals.id, proposalId), eq(contextProposals.workspaceId, ws))).limit(1);
    if (!row) return notFound();
    if (row.status !== "aperta" || row.version !== expectedVersion) return stale();
    const loose = LOOSE_KINDS.includes(row.kind);
    const fieldErrors: Record<string, string> = {};
    const next: Partial<ProposalRow> = {};

    let statement = row.statement;
    if (patch.statement !== undefined) {
      statement = oneLine(typeof patch.statement === "string" ? patch.statement : "");
      if (statement.length < CONTEXT_LIMITS.statementMin) fieldErrors.statement = T.errors.statementTooShort;
      else if (statement.length > CONTEXT_LIMITS.proposalStatementMax) fieldErrors.statement = T.errors.tooLong(CONTEXT_LIMITS.proposalStatementMax);
      next.statement = statement;
    }
    // Il controllo dei testi si rifà sempre: dati sanitari o discriminatori non si salvano nemmeno come proposta.
    const scan = scanStatement(statement);
    if (!scan.ok && isHardIssue(scan.issue)) fieldErrors.statement = scan.message;
    next.issue = scan.ok || isHardIssue(scan.issue) ? null : scan.issue;

    if (patch.section !== undefined) {
      if (loose || !(CONTEXT_SECTIONS as readonly string[]).includes(patch.section)) fieldErrors.section = T.errors.sectionMissing;
      else next.section = patch.section;
    }
    if (patch.visibility !== undefined) {
      if (!(CONTEXT_VISIBILITIES as readonly string[]).includes(patch.visibility)) fieldErrors.visibility = T.errors.visibilityMissing;
      else next.visibility = patch.visibility;
    }
    if (patch.useCaseIds !== undefined) {
      const ids = Array.isArray(patch.useCaseIds) ? [...new Set(patch.useCaseIds)] : [];
      const known = await knownUseCases(ws, ids);
      if (ids.length > 20 || ids.some((id) => !known.has(id))) fieldErrors.useCaseIds = T.errors.useCaseUnknown;
      else next.useCaseIds = ids;
    }
    if (patch.party !== undefined) {
      if (row.kind !== "impegno" || !(COMMITMENT_PARTIES as readonly string[]).includes(patch.party)) fieldErrors.party = T.errors.partyMissing;
      else next.party = patch.party;
    }
    if (patch.roleLabel !== undefined) {
      const role = oneLine(typeof patch.roleLabel === "string" ? patch.roleLabel : "");
      const check = role ? scanPersonalData(role) : ({ ok: true } as const);
      if (!loose) fieldErrors.roleLabel = T.errors.invalid;
      else if (role.length > CONTEXT_LIMITS.roleLabelMax) fieldErrors.roleLabel = T.errors.tooLong(CONTEXT_LIMITS.roleLabelMax);
      else if (!check.ok) fieldErrors.roleLabel = check.message;
      else next.roleLabel = role || null;
    }
    if (patch.dueOn !== undefined) {
      const due = patch.dueOn === null || patch.dueOn === "" ? null : realIsoDate(patch.dueOn);
      if (row.kind !== "impegno" || (patch.dueOn !== null && patch.dueOn !== "" && !due)) fieldErrors.dueOn = T.errors.dateInvalid;
      else next.dueOn = due;
    }
    if (Object.keys(fieldErrors).length > 0) return invalid(fieldErrors);

    const [updated] = await db
      .update(contextProposals)
      .set({ ...next, edited: true, version: sql`${contextProposals.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(contextProposals.id, proposalId), eq(contextProposals.workspaceId, ws), eq(contextProposals.status, "aperta"), eq(contextProposals.version, expectedVersion)))
      .returning();
    if (!updated) return stale();
    return ok(viewOf(updated, await loadViewContext(ws, [updated])));
  } catch (error) {
    logSafeError(LOG_SCOPE, "proposta_non_corretta", error, { workspaceId: ws });
    return retry();
  }
}

/** Scarta le proposte aperte indicate: non entrano in memoria e la lettura non le ripropone. */
export async function discardProposals(actor: ContextActor, proposalIds: readonly string[]): Promise<ServiceResult<{ discarded: number }>> {
  const allowed = await gate(actor, "canConfirm");
  if (!allowed.ok) return allowed;
  const ids = [...new Set(Array.isArray(proposalIds) ? proposalIds : [])];
  if (ids.length === 0) return invalid({}, CONTEXT_TEXT.confirm.none);
  if (ids.length > 500 || ids.some((id) => !isUuid(id))) return invalid();
  const ws = actor.workspaceId;
  try {
    const results = await db.batch([
      db.execute(sql`
        UPDATE context_proposals SET status = 'scartata', decided_at = now(), decided_by_user_id = ${actor.userId}::uuid, updated_at = now(), version = version + 1
        WHERE workspace_id = ${ws}::uuid AND status = 'aperta' AND id = ANY(${uuidArray(ids)})
        RETURNING id`),
      db.execute(sql`
        INSERT INTO context_events (workspace_id, action, channel, actor_user_id, detail)
        SELECT ${ws}::uuid, 'proposte_scartate', ${actor.channel}, ${actor.userId}::uuid, jsonb_build_object('n', count(*))
        FROM context_proposals WHERE workspace_id = ${ws}::uuid AND status = 'scartata' AND decided_at = now() AND id = ANY(${uuidArray(ids)})
        HAVING count(*) > 0`),
    ]);
    return ok({ discarded: rowsOf(results[0]).length });
  } catch (error) {
    logSafeError(LOG_SCOPE, "proposte_non_scartate", error, { workspaceId: ws });
    return retry();
  }
}

// ─── Confermare ──────────────────────────────────────────────────────

/** `resolution` solo per i conflitti. */
export interface ConfirmItem {
  id: string;
  version: number;
  resolution?: "prima" | "ora";
}
export interface ConfirmResult {
  confirmed: number;
  newFacts: number;
  changedFacts: number;
  reconfirmed: number;
  commitments: number;
  questions: number;
  remaining: number;
}

const LINKED_TYPES: readonly EntityType[] = ["unita", "obiettivo", "use_case"];

interface NewFact {
  id: string;
  kind: FactKind;
  section: ContextSection;
  statement: string;
  basis: Basis;
  visibility: ContextVisibility;
  sourceId: string;
  quote: string | null;
  supersedesId: string | null;
  /** Vero se un'altra voce della stessa conferma lo sostituisce subito: nasce già nella storia. */
  superseded: boolean;
  useCaseIds: Set<string>;
  entities: ProposalEntity[];
  relations: ProposalRelation[];
}

/** La chiave di un'entità in `context_entities`: l'id della riga di Unbundle per unità, obiettivi e use case; il nome normalizzato per le altre. */
function entityRef(entity: ProposalEntity): { type: EntityType; key: string } | null {
  if (LINKED_TYPES.includes(entity.type)) return entity.refId && isUuid(entity.refId) ? { type: entity.type, key: entity.refId.toLowerCase() } : null;
  const key = entityKey(entity.name);
  return key ? { type: entity.type, key } : null;
}

/**
 * Conferma le proposte scelte, tutte o nessuna, in una transazione (`db.batch`). Solo Lateral Space.
 * `versione_superata`: una proposta non è più aperta, ha un'altra `version`, o il suo fatto è appena stato sostituito
 * da un'altra conferma. `dati_non_validi` con `fieldErrors[<id della proposta>]`: una proposta con `issue`, un
 * conflitto senza `resolution`, più di 75 voci, nessuna voce. In tutti e due i casi non si scrive niente.
 * Dopo la risposta chi chiama programma `refreshContextBrief` con `after()` (la funzione non lo fa da sé).
 */
export async function confirmProposals(actor: ContextActor, items: readonly ConfirmItem[]): Promise<ServiceResult<ConfirmResult>> {
  const allowed = await gate(actor, "canConfirm");
  if (!allowed.ok) return allowed;
  const T = CONTEXT_TEXT;
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return invalid({}, T.confirm.none);
  if (list.length > CONTEXT_LIMITS.confirmMax) return invalid({}, T.confirm.tooMany(CONTEXT_LIMITS.confirmMax));
  if (list.some((item) => !item || !isUuid(item.id) || !Number.isInteger(item.version) || item.version < 1)) return invalid();
  if (new Set(list.map((item) => item.id)).size !== list.length) return invalid();
  const ws = actor.workspaceId;

  try {
    const ids = list.map((item) => item.id);
    const rows = await db.select().from(contextProposals).where(and(eq(contextProposals.workspaceId, ws), sql`${contextProposals.id} = ANY(${uuidArray(ids)})`));
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Una proposta che non c'è più, non è più aperta o è stata corretta nel frattempo: niente si scrive.
    for (const item of list) {
      const row = byId.get(item.id);
      if (!row || row.status !== "aperta" || row.version !== item.version) return stale();
    }
    const heads = await resolveHeads(ws, rows.flatMap((row) => (row.targetFactId ? [row.targetFactId] : [])));

    // Le regole per voce, prima di scrivere: il controllo dei testi si rifà su ogni frase.
    const fieldErrors: Record<string, string> = {};
    const plan = list.map((item) => {
      const row = byId.get(item.id)!;
      const { kind, target } = effectiveKind(row, heads);
      const statement = oneLine(row.statement);
      const scan = scanStatement(statement);
      // Il ruolo di un impegno, o «a chi chiedere»: un ruolo, mai un dato di una persona.
      const role = row.roleLabel ? scanPersonalData(row.roleLabel) : ({ ok: true } as const);
      if (statement.length < CONTEXT_LIMITS.statementMin) fieldErrors[row.id] = T.errors.statementTooShort;
      else if (!scan.ok) fieldErrors[row.id] = scan.message;
      else if (row.issue) fieldErrors[row.id] = issueMessage(row.issue);
      else if (kind === "conflitto" && item.resolution !== "prima" && item.resolution !== "ora") fieldErrors[row.id] = T.confirm.conflictChoice;
      else if (kind === "impegno" && !row.party) fieldErrors[row.id] = T.errors.partyMissing;
      else if (!LOOSE_KINDS.includes(kind) && !row.section) fieldErrors[row.id] = T.errors.sectionMissing;
      else if (!role.ok) fieldErrors[row.id] = role.message;
      return { item, row, kind, target, statement };
    });
    if (Object.keys(fieldErrors).length > 0) return invalid(fieldErrors);

    // Use case, unità e obiettivi citati: valgono solo quelli di questo workspace.
    const useCases = await knownUseCases(ws, [
      ...rows.flatMap((row) => row.useCaseIds),
      ...rows.flatMap((row) => (row.entities ?? []).flatMap((e) => (e.type === "use_case" && e.refId ? [e.refId] : []))),
    ]);
    const unitIds = [...new Set(rows.flatMap((row) => (row.entities ?? []).flatMap((e) => (e.type === "unita" && e.refId && isUuid(e.refId) ? [e.refId] : []))))];
    const goalIds = [...new Set(rows.flatMap((row) => (row.entities ?? []).flatMap((e) => (e.type === "obiettivo" && e.refId && isUuid(e.refId) ? [e.refId] : []))))];
    const [unitRows, goalRows, useCaseRows, inheritedLinks] = await Promise.all([
      unitIds.length > 0 ? db.execute(sql`SELECT id, name FROM departments WHERE workspace_id = ${ws}::uuid AND id = ANY(${uuidArray(unitIds)})`) : Promise.resolve({ rows: [] }),
      goalIds.length > 0 ? db.execute(sql`SELECT id, title AS name FROM strategic_goals WHERE workspace_id = ${ws}::uuid AND id = ANY(${uuidArray(goalIds)})`) : Promise.resolve({ rows: [] }),
      useCases.size > 0 ? db.execute(sql`SELECT id, title AS name FROM use_cases WHERE workspace_id = ${ws}::uuid AND id = ANY(${uuidArray([...useCases])})`) : Promise.resolve({ rows: [] }),
      // Una versione nuova tiene gli use case di quella di prima.
      heads.size > 0
        ? db.execute(sql`SELECT fact_id, use_case_id FROM context_fact_links WHERE workspace_id = ${ws}::uuid AND use_case_id IS NOT NULL AND fact_id = ANY(${uuidArray([...heads.values()].map((h) => h.id))})`)
        : Promise.resolve({ rows: [] }),
    ]);
    const linkedNames = new Map<string, string>();
    for (const [type, result] of [["unita", unitRows], ["obiettivo", goalRows], ["use_case", useCaseRows]] as const) {
      for (const r of rowsOf<{ id: string; name: string }>(result)) linkedNames.set(`${type}:${r.id.toLowerCase()}`, entityName(r.name));
    }
    const linksOf = new Map<string, Set<string>>();
    for (const link of rowsOf<{ fact_id: string; use_case_id: string }>(inheritedLinks)) {
      if (!linksOf.has(link.fact_id)) linksOf.set(link.fact_id, new Set());
      linksOf.get(link.fact_id)!.add(link.use_case_id);
    }

    // Il piano: che cosa nasce e che cosa cambia, nell'ordine delle voci. Due voci sullo stesso fatto si mettono in fila.
    const headOf = new Map<string, string>();
    const newFacts = new Map<string, NewFact>();
    const reconfirm = new Set<string>();
    const supersede = new Set<string>();
    const commitments: Array<typeof contextCommitments.$inferInsert> = [];
    const questions: Array<typeof contextQuestions.$inferInsert> = [];
    const closing: Array<{ questionId: string; factId: string }> = [];
    const events: Array<typeof contextEvents.$inferInsert> = [];
    const decided: Array<{ id: string; status: "confermata" | "scartata"; resultId: string | null }> = [];
    const counts = { newFacts: 0, changedFacts: 0, reconfirmed: 0, commitments: 0, questions: 0 };
    const event = (action: ContextEventAction, more: Partial<typeof contextEvents.$inferInsert> = {}) => events.push({ workspaceId: ws, action, channel: actor.channel, actorUserId: actor.userId, ...more });
    const validUseCases = (ids: readonly string[]) => [...new Set(ids.filter((id) => useCases.has(id)))];

    for (const { item, row, kind, target, statement } of plan) {
      if (kind === "impegno") {
        const id = crypto.randomUUID();
        commitments.push({ id, workspaceId: ws, statement, party: row.party!, roleLabel: row.roleLabel, dueOn: row.dueOn, visibility: row.visibility, origin: "fonte", sourceId: row.sourceId, quote: row.quote, useCaseIds: validUseCases(row.useCaseIds) });
        // Impegni e domande valgono per parte e per ruolo: nella storia non c'è chi li ha aggiunti.
        event("impegno_aggiunto", { actorUserId: null, commitmentId: id, sourceId: row.sourceId });
        decided.push({ id: row.id, status: "confermata", resultId: id });
        counts.commitments += 1;
        continue;
      }
      if (kind === "domanda") {
        const id = crypto.randomUUID();
        questions.push({ id, workspaceId: ws, question: statement, askWhom: row.roleLabel, visibility: row.visibility, origin: "fonte", sourceId: row.sourceId, quote: row.quote, useCaseIds: validUseCases(row.useCaseIds) });
        event("domanda_aggiunta", { actorUserId: null, questionId: id, sourceId: row.sourceId });
        decided.push({ id: row.id, status: "confermata", resultId: id });
        counts.questions += 1;
        continue;
      }
      // La versione in testa adesso: quella del database, o quella nata da una voce di prima.
      const head = target ? (headOf.get(target.id) ?? target.id) : null;
      const keepsBefore = kind === "conferma" || (kind === "conflitto" && item.resolution === "prima");
      if (head && keepsBefore) {
        if (!newFacts.has(head)) reconfirm.add(head);
        if (kind === "conflitto") {
          event("conflitto_risolto", { factId: head, sourceId: row.sourceId, detail: { scelta: "prima" } });
          decided.push({ id: row.id, status: "scartata", resultId: head });
        } else {
          event("fatto_riconfermato", { factId: head, sourceId: row.sourceId });
          decided.push({ id: row.id, status: "confermata", resultId: head });
        }
        counts.reconfirmed += 1;
        continue;
      }
      const id = crypto.randomUUID();
      const before = head ? newFacts.get(head) : undefined;
      const inherited = head ? (before ? before.useCaseIds : (linksOf.get(head) ?? new Set<string>())) : new Set<string>();
      newFacts.set(id, {
        id,
        kind: head ? (before?.kind ?? target!.kind) : row.kind === "decisione" ? "decisione" : "fatto",
        section: row.section!,
        statement,
        basis: row.basis,
        visibility: row.visibility,
        sourceId: row.sourceId,
        quote: row.quote,
        supersedesId: head,
        superseded: false,
        useCaseIds: new Set([...inherited, ...validUseCases(row.useCaseIds)]),
        entities: row.entities ?? [],
        relations: row.relations ?? [],
      });
      if (head && target) {
        if (before) before.superseded = true;
        else supersede.add(head);
        headOf.set(target.id, id);
        if (kind === "conflitto") event("conflitto_risolto", { factId: id, sourceId: row.sourceId, detail: { scelta: "ora" } });
        else event("fatto_cambiato", { factId: id, sourceId: row.sourceId });
        counts.changedFacts += 1;
      } else {
        event("fatto_confermato", { factId: id, sourceId: row.sourceId, detail: { tipo: row.kind === "decisione" ? "decisione" : "fatto", base: row.basis } });
        counts.newFacts += 1;
      }
      if (row.questionId) closing.push({ questionId: row.questionId, factId: id });
      decided.push({ id: row.id, status: "confermata", resultId: id });
    }
    const sourceIds = new Set(plan.map((p) => p.row.sourceId));
    event("proposte_confermate", { sourceId: sourceIds.size === 1 ? [...sourceIds][0] : null, detail: { n: list.length } });

    // Entità e collegamenti dei fatti nuovi.
    const entityRows = new Map<string, typeof contextEntities.$inferInsert>();
    const factEntities: Array<{ fact_id: string; type: string; name_key: string }> = [];
    const relations: Array<{ fact_id: string; from_type: string; from_key: string; verb: string; to_type: string; to_key: string }> = [];
    for (const fact of newFacts.values()) {
      const byName = new Map<string, { type: EntityType; key: string }>();
      for (const entity of fact.entities) {
        const ref = entityRef(entity);
        if (!ref) continue;
        const linkedName = LINKED_TYPES.includes(ref.type) ? linkedNames.get(`${ref.type}:${ref.key}`) : undefined;
        // Un'unità, un obiettivo o uno use case che non è (più) di questo workspace non entra nella Mappa.
        if (LINKED_TYPES.includes(ref.type) && linkedName === undefined) continue;
        const name = linkedName ?? entityName(entity.name);
        if (!name || (!LINKED_TYPES.includes(ref.type) && !scanPersonalData(name).ok)) continue;
        entityRows.set(`${ref.type}:${ref.key}`, {
          workspaceId: ws,
          type: ref.type,
          name,
          nameKey: ref.key,
          departmentId: ref.type === "unita" ? ref.key : null,
          goalId: ref.type === "obiettivo" ? ref.key : null,
          useCaseId: ref.type === "use_case" ? ref.key : null,
        });
        factEntities.push({ fact_id: fact.id, type: ref.type, name_key: ref.key });
        byName.set(entityKey(entity.name), ref);
      }
      for (const relation of fact.relations) {
        const from = byName.get(entityKey(relation.from));
        const to = byName.get(entityKey(relation.to));
        if (!from || !to || (from.type === to.type && from.key === to.key)) continue;
        relations.push({ fact_id: fact.id, from_type: from.type, from_key: from.key, verb: relation.verb, to_type: to.type, to_key: to.key });
      }
    }
    const useCaseLinks = [...newFacts.values()].flatMap((fact) => [...fact.useCaseIds].map((useCaseId) => ({ workspaceId: ws, factId: fact.id, useCaseId })));
    const count = (n: number) => sql`${n}`;

    const statements = [
      // Le proposte, ferme e ancora come le ha viste la persona: se una è cambiata, tutto si annulla.
      db.execute(sql`
        WITH held AS (
          SELECT p.id FROM context_proposals p
          JOIN jsonb_to_recordset(${JSON.stringify(list.map((item) => ({ id: item.id, version: item.version })))}::jsonb) AS x(id uuid, version integer) ON x.id = p.id AND x.version = p.version
          WHERE p.workspace_id = ${ws}::uuid AND p.status = 'aperta'
          FOR UPDATE OF p
        )
        ${requireSql(sql`(SELECT count(*) FROM held) = ${count(list.length)}`, "versione_superata")}`),
      // I fatti riconfermati: la data si rinfresca. Devono essere ancora attivi.
      ...(reconfirm.size > 0
        ? [
            db.execute(sql`
              WITH fresh AS (
                UPDATE context_facts SET last_confirmed_at = now(), needs_check = false, confirmed_by_user_id = ${actor.userId}::uuid, updated_at = now()
                WHERE workspace_id = ${ws}::uuid AND status = 'attivo' AND id = ANY(${uuidArray([...reconfirm])})
                RETURNING id
              )
              ${requireSql(sql`(SELECT count(*) FROM fresh) = ${count(reconfirm.size)}`, "versione_superata")}`),
          ]
        : []),
      // I fatti sostituiti passano alla storia. Devono essere ancora attivi: se un'altra conferma li ha già sostituiti, tutto si annulla.
      ...(supersede.size > 0
        ? [
            db.execute(sql`
              WITH old AS (
                UPDATE context_facts SET status = 'superato', ended_at = now(), updated_at = now(), version = version + 1
                WHERE workspace_id = ${ws}::uuid AND status = 'attivo' AND id = ANY(${uuidArray([...supersede])})
                RETURNING id
              )
              ${requireSql(sql`(SELECT count(*) FROM old) = ${count(supersede.size)}`, "versione_superata")}`),
          ]
        : []),
      ...(newFacts.size > 0
        ? [
            db.insert(contextFacts).values(
              [...newFacts.values()].map((fact) => ({
                id: fact.id,
                workspaceId: ws,
                kind: fact.kind,
                section: fact.section,
                statement: fact.statement,
                basis: fact.basis,
                visibility: fact.visibility,
                status: fact.superseded ? ("superato" as const) : ("attivo" as const),
                origin: "fonte" as const,
                sourceId: fact.sourceId,
                quote: fact.quote,
                supersedesId: fact.supersedesId,
                confirmedByUserId: actor.userId,
                endedAt: fact.superseded ? sql`now()` : null,
              })),
            ),
          ]
        : []),
      ...(useCaseLinks.length > 0 ? [db.execute(sql`
        INSERT INTO context_fact_links (workspace_id, fact_id, use_case_id)
        SELECT ${ws}::uuid, x.fact_id, x.use_case_id FROM jsonb_to_recordset(${JSON.stringify(useCaseLinks.map((l) => ({ fact_id: l.factId, use_case_id: l.useCaseId })))}::jsonb) AS x(fact_id uuid, use_case_id uuid)
        ON CONFLICT DO NOTHING`)] : []),
      ...(entityRows.size > 0
        ? [
            db
              .insert(contextEntities)
              .values([...entityRows.values()])
              .onConflictDoUpdate({ target: [contextEntities.workspaceId, contextEntities.type, contextEntities.nameKey], set: { updatedAt: sql`now()` } }),
          ]
        : []),
      ...(factEntities.length > 0 ? [db.execute(sql`
        INSERT INTO context_fact_links (workspace_id, fact_id, entity_id)
        SELECT ${ws}::uuid, x.fact_id, e.id FROM jsonb_to_recordset(${JSON.stringify(factEntities)}::jsonb) AS x(fact_id uuid, type text, name_key text)
        JOIN context_entities e ON e.workspace_id = ${ws}::uuid AND e.type = x.type AND e.name_key = x.name_key
        ON CONFLICT DO NOTHING`)] : []),
      ...(relations.length > 0 ? [db.execute(sql`
        INSERT INTO context_relations (workspace_id, from_entity_id, verb, to_entity_id, fact_id)
        SELECT ${ws}::uuid, a.id, x.verb, b.id, x.fact_id
        FROM jsonb_to_recordset(${JSON.stringify(relations)}::jsonb) AS x(fact_id uuid, from_type text, from_key text, verb text, to_type text, to_key text)
        JOIN context_entities a ON a.workspace_id = ${ws}::uuid AND a.type = x.from_type AND a.name_key = x.from_key
        JOIN context_entities b ON b.workspace_id = ${ws}::uuid AND b.type = x.to_type AND b.name_key = x.to_key
        WHERE a.id <> b.id
        ON CONFLICT DO NOTHING`)] : []),
      ...(commitments.length > 0 ? [db.insert(contextCommitments).values(commitments)] : []),
      ...(questions.length > 0 ? [db.insert(contextQuestions).values(questions)] : []),
      // Un fatto nuovo che risponde a una domanda aperta la chiude.
      ...(closing.length > 0 ? [db.execute(sql`
        WITH answered AS (
          UPDATE context_questions q SET status = 'chiusa', closed_by_fact_id = x.fact_id, closed_at = now(), updated_at = now(), version = q.version + 1
          FROM jsonb_to_recordset(${JSON.stringify(closing.map((c) => ({ question_id: c.questionId, fact_id: c.factId })))}::jsonb) AS x(question_id uuid, fact_id uuid)
          WHERE q.id = x.question_id AND q.workspace_id = ${ws}::uuid AND q.status = 'aperta'
          RETURNING q.id
        )
        INSERT INTO context_events (workspace_id, action, channel, question_id)
        SELECT ${ws}::uuid, 'domanda_chiusa', ${actor.channel}, id FROM answered`)] : []),
      db.insert(contextEvents).values(events),
      db.execute(sql`
        UPDATE context_proposals p SET status = x.status, result_id = x.result_id, decided_at = now(), decided_by_user_id = ${actor.userId}::uuid, updated_at = now(), version = p.version + 1
        FROM jsonb_to_recordset(${JSON.stringify(decided.map((d) => ({ id: d.id, status: d.status, result_id: d.resultId })))}::jsonb) AS x(id uuid, status text, result_id uuid)
        WHERE p.id = x.id AND p.workspace_id = ${ws}::uuid AND p.status = 'aperta'`),
    ];
    try {
      await db.batch(statements as [(typeof statements)[number], ...Array<(typeof statements)[number]>]);
    } catch (error) {
      // Un'altra conferma è arrivata prima: su una proposta, o sul fatto che questa cambiava (l'indice unico della storia).
      if (ctxErrorCode(error) === "versione_superata" || isUniqueViolation(error, "context_facts_supersedes_unique")) return stale();
      throw error;
    }
    const remaining = rowsOf<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM context_proposals WHERE workspace_id = ${ws}::uuid AND status = 'aperta'`));
    return ok({ confirmed: list.length, ...counts, remaining: Number(remaining[0]?.n ?? 0) });
  } catch (error) {
    logSafeError(LOG_SCOPE, "conferma_non_riuscita", error, { workspaceId: ws });
    return retry();
  }
}

/** Quante proposte aperte ha il workspace (per la riga «12 proposte da confermare»). Zero a chi non è di Lateral Space. */
export async function countOpenProposals(actor: ContextActor): Promise<number> {
  if (!contextAbilities(actor).canConfirm || !isUuid(actor.workspaceId) || !(await contextStoreReady())) return 0;
  const rows = rowsOf<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM context_proposals WHERE workspace_id = ${actor.workspaceId}::uuid AND status = 'aperta'`));
  return Number(rows[0]?.n ?? 0);
}
