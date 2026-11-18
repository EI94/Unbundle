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
 * fatto è stato ritirato o non c'è più, la proposta vale come `nuovo`. Una «conferma» letta prima che il fatto cambiasse
 * vale come conflitto tra la versione di adesso e la frase che gli appunti dicevano. Quando un fatto cambia (una
 * conferma lo sostituisce, una persona lo riscrive o lo ritira) le proposte aperte che lo toccano alzano la versione:
 * chi le ha davanti come erano prima riceve `versione_superata` (`bumpProposalsOnFactsStatement`).
 *
 * (9b) Dopo una conferma riuscita che scrive fatti (nuovi, versioni nuove, conflitti risolti con «Ora») parte «Il
 * contesto è cambiato» per chi costruisce gli use case toccati (`notifyContextChange`); una riconferma non è un cambio.
 *
 * (9b, RILASCIO-9b-COSTRUZIONE.md §2.2, §3.2) I legami con «Cosa serve»: una proposta che risponde a una richiesta ha un
 * legame `proposta` (la lettura). In «Da confermare» la riga lo dice («Risponde a «Cosa serve»: …»). Alla conferma il
 * legame diventa `aperta`, con il fatto, solo se il fatto è attivo e «Per tutti» e la richiesta è ancora aperta
 * (`needLinkAfterConfirm`): il testo di un fatto «Solo Lateral Space» non arriva al cliente; altrimenti `scartata`. Poi
 * «Una risposta per «Cosa serve»» ai revisori (`notifyNeedAnswered`). Scartare la proposta scarta il legame. Solo con la
 * 0041.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contextCommitments, contextEntities, contextEvents, contextFacts, contextProposals, contextQuestions, contextSources } from "@/lib/db/schema";
import { dayLabel, factSourceLabel } from "@/lib/context/labels";
import { entityKey, entityName, normalizeStatement, oneLine } from "@/lib/context/normalize";
import { isPreselected, realIsoDate } from "@/lib/context/read/reconcile";
import { isHardIssue, issueMessage, scanPersonalData, scanStatement } from "@/lib/context/scan";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities, isClientSource, isLearnedSource, stricterVisibility, type ContextActor } from "@/lib/context/visibility";
import { planNeedLinks } from "@/lib/context/read/confirm-links";
import { OPEN_NEED_STATUSES } from "@/lib/context/work/need-links";
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
  type SourceOrigin,
} from "@/lib/context/vocab";
import { CLIENT_SIDE_SQL } from "@/lib/db/use-case-hub-referents-ddl";
import { logSafeError } from "@/lib/log/safe-error";
import { isEmailVerifiedValue, isLateralSpaceEmail, parseLsDomains } from "@/lib/uc/lateral-space";
import type { ServiceResult } from "@/lib/use-cases/types";
import { bumpProposalsOnFactsStatement, ctxErrorCode, dropBriefStatement, factChainCte, gate, invalid, isUniqueViolation, isUuid, knownUseCases, notFound, ok, requireSql, retry, romeToday, rowsOf, stale, toIsoDate, uuidArray } from "./context-shared";
import { notifyContextChange, notifyNeedAnswered } from "./context-notices";
import { contextStoreReady, contextWorkReady } from "./context-store";

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
  /**
   * (9b) La richiesta aperta di «Cosa serve» a cui la proposta risponde: il titolo e i codici dei suoi use case
   * («Risponde a «Cosa serve»: …»). `listOpenProposals` lo dà sempre; nel tipo è facoltativo per le viste costruite a mano.
   */
  answersNeed?: { needId: string; title: string; code: string } | null;
}
export interface OpenProposals {
  /**
   * `kind`: «Call 14 nov» o «Documento 14 nov» nel «Ora: …» dei conflitti. `origin`: da dove è entrata la fonte.
   * (9b) `learned`: una cosa imparata costruendo un caso (`unbundle impara`): «Da chi costruisce XX-0012, 18 nov».
   * `listOpenProposals` lo dà sempre; nel tipo è facoltativo per le viste costruite a mano (assente vale falso).
   */
  sources: Array<{ id: string; kind: SourceKind; origin: SourceOrigin; title: string; occurredOn: string; skipped: SkippedCounts; learned?: boolean }>;
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
  /** (9b) Origine e id esterno della fonte: una cosa imparata costruendo si legge «Costruzione». */
  sourceOrigin: SourceOrigin | null;
  sourceExternalId: string | null;
  sourceDay: string | null;
}

/** Per ogni fatto, la versione in testa alla sua storia (quella attiva, o l'ultima se è stato ritirato). */
export async function resolveHeads(workspaceId: string, factIds: readonly string[]): Promise<Map<string, TargetFact>> {
  const out = new Map<string, TargetFact>();
  const ids = [...new Set(factIds.filter(isUuid))];
  if (ids.length === 0) return out;
  const rows = rowsOf<{
    start_id: string;
    id: string;
    kind: FactKind;
    section: ContextSection;
    statement: string;
    visibility: ContextVisibility;
    status: string;
    origin: FactOrigin;
    last_confirmed_at: unknown;
    source_kind: SourceKind | null;
    source_origin: SourceOrigin | null;
    source_external_id: string | null;
    source_day: unknown;
  }>(
    await db.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT f.id AS start_id, f.id, 0 AS depth FROM context_facts f WHERE f.workspace_id = ${workspaceId}::uuid AND f.id = ANY(${uuidArray(ids)})
        UNION ALL
        SELECT c.start_id, n.id, c.depth + 1 FROM chain c JOIN context_facts n ON n.supersedes_id = c.id AND n.workspace_id = ${workspaceId}::uuid WHERE c.depth < 500
      ), head AS (
        SELECT DISTINCT ON (start_id) start_id, id FROM chain ORDER BY start_id, depth DESC
      )
      SELECT h.start_id, f.id, f.kind, f.section, f.statement, f.visibility, f.status, f.origin, f.last_confirmed_at, s.kind AS source_kind, s.origin AS source_origin,
        s.external_id AS source_external_id, s.occurred_on AS source_day
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
      sourceOrigin: row.source_origin,
      sourceExternalId: row.source_external_id,
      sourceDay: row.source_day ? toIsoDate(row.source_day) : null,
    });
  }
  return out;
}

type ProposalRow = typeof contextProposals.$inferSelect;
const TARGET_KINDS: readonly ProposalKind[] = ["cambia", "conferma", "conflitto"];
const LOOSE_KINDS: readonly ProposalKind[] = ["impegno", "domanda"];

/**
 * Il tipo che vale adesso: un «cambia», una «conferma» o un «conflitto» senza un fatto attivo da toccare valgono come
 * `nuovo`. Una «conferma» il cui fatto è cambiato dopo la lettura vale come «conflitto»: gli appunti dicevano la frase di
 * prima (salvata nella proposta), non quella di adesso, e riconfermarla sarebbe dire che la nota la conferma.
 */
function effectiveKind(row: Pick<ProposalRow, "kind" | "targetFactId" | "statement">, heads: ReadonlyMap<string, TargetFact>): { kind: ProposalKind; target: TargetFact | null } {
  if (!TARGET_KINDS.includes(row.kind)) return { kind: row.kind, target: null };
  const head = row.targetFactId ? heads.get(row.targetFactId) : undefined;
  if (!head || head.status !== "attivo") return { kind: "nuovo", target: null };
  if (row.kind === "conferma" && head.id !== row.targetFactId && normalizeStatement(head.statement) !== normalizeStatement(row.statement)) return { kind: "conflitto", target: head };
  return { kind: row.kind, target: head };
}

interface ViewContext {
  heads: ReadonlyMap<string, TargetFact>;
  useCases: ReadonlyMap<string, { id: string; code: string | null; title: string }>;
  questions: ReadonlyMap<string, string>;
  /**
   * Le fonti scritte dal cliente (`isClientSource`, anche le risposte del referente) e (9b) le cose imparate costruendo
   * (`isLearnedSource`): le loro proposte non sono mai preselezionate.
   */
  clientSources: ReadonlySet<string>;
  /** Le frasi (normalizzate) dei fatti «Solo Lateral Space» attivi. */
  lsOnly: ReadonlySet<string>;
  /** (9b) Per proposta: la richiesta aperta di «Cosa serve» del suo legame `proposta`. */
  needs: ReadonlyMap<string, { needId: string; title: string; code: string }>;
  today: string;
}

function viewOf(row: ProposalRow, ctx: ViewContext): ProposalView {
  const { kind, target } = effectiveKind(row, ctx.heads);
  const matchesLsOnly = ctx.lsOnly.has(normalizeStatement(row.statement));
  // La visibilità che la conferma scriverà: con un fatto di adesso, la più stretta delle due (una conferma non allarga);
  // la frase di un fatto «Solo Lateral Space» resta «Solo Lateral Space».
  const visibility = matchesLsOnly ? "ls" : target ? stricterVisibility(row.visibility, target.visibility) : row.visibility;
  const question = row.questionId ? ctx.questions.get(row.questionId) : undefined;
  let before: ProposalView["before"] = null;
  if (target) {
    const source = factSourceLabel(
      { origin: target.origin, sourceKind: target.sourceKind, sourceOrigin: target.sourceOrigin, sourceExternalId: target.sourceExternalId, sourceOccurredOn: target.sourceDay },
      ctx.today,
    );
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
    visibility,
    preselected: isPreselected({ basis: row.basis, kind, issue: row.issue, fromClient: ctx.clientSources.has(row.sourceId), matchesLsOnly }),
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
    answersNeed: ctx.needs.get(row.id) ?? null,
  };
}

/** (9b) Gli stati aperti di una richiesta di «Cosa serve», come array di Postgres. */
const OPEN_NEEDS = sql`${`{${OPEN_NEED_STATUSES.join(",")}}`}::text[]`;

/**
 * (9b) Le richieste di «Cosa serve» dei legami `proposta` di queste proposte, ancora aperte (requisiti del cliente non
 * archiviati, in uno stato aperto), con i codici dei loro use case. Vuoto senza la 0041.
 */
async function proposedNeeds(workspaceId: string, proposalIds: readonly string[]): Promise<Map<string, { needId: string; title: string; code: string }>> {
  const out = new Map<string, { needId: string; title: string; code: string }>();
  if (proposalIds.length === 0 || !(await contextWorkReady())) return out;
  const rows = rowsOf<{ proposal_id: string; need_id: string; title: string; codes: string | null }>(
    await db.execute(sql`
      SELECT l.proposal_id, n.id AS need_id, n.title,
        (SELECT string_agg(coalesce(u.code, u.title), ', ' ORDER BY u.code NULLS LAST, u.id)
         FROM use_case_need_links nl JOIN use_cases u ON u.id = nl.use_case_id AND u.workspace_id = n.workspace_id
         WHERE nl.need_id = n.id) AS codes
      FROM context_need_links l
      JOIN use_case_needs n ON n.id = l.need_id AND n.workspace_id = l.workspace_id
      WHERE l.workspace_id = ${workspaceId}::uuid AND l.status = 'proposta' AND l.proposal_id = ANY(${uuidArray(proposalIds)})
        AND n.type = 'requisito' AND n.archived_at IS NULL AND ${sql.raw(CLIENT_SIDE_SQL("n"))} AND n.status = ANY(${OPEN_NEEDS})`),
  );
  for (const row of rows) if (row.codes) out.set(row.proposal_id, { needId: row.need_id, title: oneLine(row.title), code: row.codes });
  return out;
}

/** Le frasi (normalizzate) dei fatti «Solo Lateral Space» attivi del workspace. */
async function lsOnlyStatements(workspaceId: string): Promise<Set<string>> {
  const rows = rowsOf<{ statement: string }>(
    await db.execute(sql`SELECT statement FROM context_facts WHERE workspace_id = ${workspaceId}::uuid AND status = 'attivo' AND visibility = 'ls' LIMIT 5000`),
  );
  return new Set(rows.map((r) => normalizeStatement(r.statement)).filter(Boolean));
}

/** Use case, domande aperte, fatti citati, fonti del cliente e fatti «Solo Lateral Space» di queste proposte, per mostrarle. */
async function loadViewContext(workspaceId: string, rows: readonly ProposalRow[], now: Date = new Date()): Promise<ViewContext> {
  const useCaseIds = [...new Set(rows.flatMap((r) => r.useCaseIds))].filter(isUuid);
  const questionIds = [...new Set(rows.flatMap((r) => (r.questionId ? [r.questionId] : [])))];
  const factIds = rows.flatMap((r) => (r.targetFactId ? [r.targetFactId] : []));
  const sourceIds = [...new Set(rows.map((r) => r.sourceId))].filter(isUuid);
  const [heads, useCases, questions, sources, lsOnly, needs] = await Promise.all([
    resolveHeads(workspaceId, factIds),
    useCaseIds.length > 0
      ? db.execute(sql`SELECT id, code, title FROM use_cases WHERE workspace_id = ${workspaceId}::uuid AND id = ANY(${uuidArray(useCaseIds)})`)
      : Promise.resolve({ rows: [] }),
    questionIds.length > 0
      ? db.execute(sql`SELECT id, question FROM context_questions WHERE workspace_id = ${workspaceId}::uuid AND status = 'aperta' AND id = ANY(${uuidArray(questionIds)})`)
      : Promise.resolve({ rows: [] }),
    sourceIds.length > 0
      ? db.execute(sql`
          SELECT s.id, s.kind, s.origin, s.external_id, s.visibility, u.email, u.email_verified FROM context_sources s LEFT JOIN users u ON u.id = s.added_by_user_id
          WHERE s.workspace_id = ${workspaceId}::uuid AND s.id = ANY(${uuidArray(sourceIds)})`)
      : Promise.resolve({ rows: [] }),
    rows.length > 0 ? lsOnlyStatements(workspaceId) : Promise.resolve(new Set<string>()),
    proposedNeeds(workspaceId, rows.map((r) => r.id)),
  ]);
  const ls = parseLsDomains(process.env.UC_LS_EMAIL_DOMAINS);
  const clientSources = new Set(
    rowsOf<{ id: string; kind: SourceKind; origin: SourceOrigin; external_id: string | null; visibility: ContextVisibility; email: string | null; email_verified: unknown }>(sources)
      .filter(
        (src) =>
          isClientSource({ kind: src.kind, visibility: src.visibility, addedByLateralSpace: isLateralSpaceEmail({ email: src.email, emailVerified: isEmailVerifiedValue(src.email_verified) }, ls) }) ||
          isLearnedSource({ origin: src.origin, externalId: src.external_id }),
      )
      .map((src) => src.id),
  );
  return {
    heads,
    useCases: new Map(rowsOf<{ id: string; code: string | null; title: string }>(useCases).map((u) => [u.id, { id: u.id, code: u.code, title: u.title }])),
    questions: new Map(rowsOf<{ id: string; question: string }>(questions).map((x) => [x.id, x.question])),
    clientSources,
    lsOnly,
    needs,
    today: romeToday(now),
  };
}

/** null a chi non è di Lateral Space. */
export async function listOpenProposals(actor: ContextActor, opts: { sourceId?: string } = {}): Promise<OpenProposals | null> {
  if (!contextAbilities(actor).canConfirm || !isUuid(actor.workspaceId) || !(await contextStoreReady())) return null;
  if (opts.sourceId !== undefined && !isUuid(opts.sourceId)) return { sources: [], proposals: [], reconfirmed: [] };
  const ws = actor.workspaceId;
  const joined = await db
    .select({
      proposal: contextProposals,
      kind: contextSources.kind,
      origin: contextSources.origin,
      externalId: contextSources.externalId,
      title: contextSources.title,
      occurredOn: contextSources.occurredOn,
      skipped: contextSources.skipped,
    })
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
    if (!sources.has(j.proposal.sourceId)) {
      sources.set(j.proposal.sourceId, {
        id: j.proposal.sourceId,
        kind: j.kind,
        origin: j.origin,
        title: j.title,
        occurredOn: toIsoDate(j.occurredOn),
        skipped: j.skipped ?? {},
        learned: isLearnedSource({ origin: j.origin, externalId: j.externalId }),
      });
    }
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

/**
 * Scarta le proposte aperte indicate: non entrano in memoria e la lettura non le ripropone. (9b) I loro legami con «Cosa
 * serve» si scartano con loro.
 */
export async function discardProposals(actor: ContextActor, proposalIds: readonly string[]): Promise<ServiceResult<{ discarded: number }>> {
  const allowed = await gate(actor, "canConfirm");
  if (!allowed.ok) return allowed;
  const ids = [...new Set(Array.isArray(proposalIds) ? proposalIds : [])];
  if (ids.length === 0) return invalid({}, CONTEXT_TEXT.confirm.none);
  if (ids.length > 500 || ids.some((id) => !isUuid(id))) return invalid();
  const ws = actor.workspaceId;
  try {
    const linksReady = await contextWorkReady();
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
      // (9b) Una proposta scartata non risponde a niente: il suo legame con «Cosa serve» si scarta con lei.
      ...(linksReady
        ? [
            db.execute(sql`
              UPDATE context_need_links l SET status = 'scartata', decided_at = now(), decided_by_user_id = ${actor.userId}::uuid, version = l.version + 1, updated_at = now()
              FROM context_proposals p
              WHERE l.workspace_id = ${ws}::uuid AND l.status = 'proposta' AND l.proposal_id = p.id
                AND p.workspace_id = ${ws}::uuid AND p.id = ANY(${uuidArray(ids)}) AND p.status = 'scartata' AND p.decided_at = now()`),
          ]
        : []),
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
 * Una frase uguale a quella di un fatto attivo (o di un fatto nato da un'altra voce della stessa conferma) è una
 * riconferma di quel fatto: lo stesso fatto non si scrive due volte.
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

    // La stessa frase di un fatto in memoria, o di un fatto che questa conferma ha appena scritto, è lo stesso fatto: due
    // appunti della stessa call, letti prima che qualcuno confermasse, lo propongono due volte. Si riconferma, non si
    // scrive due volte. `sameFact`: la frase (normalizzata) → il fatto attivo, del database o nato qui.
    const sameFact = new Map<string, string>();
    // Le frasi dei fatti «Solo Lateral Space» attivi: un fatto nuovo con la stessa frase nasce «Solo Lateral Space».
    const lsOnly = new Set<string>();
    // (9b) Chi vede i fatti attivi che questa conferma può riconfermare: decide i legami con «Cosa serve».
    const activeVisibility = new Map<string, ContextVisibility>([...heads.values()].filter((head) => head.status === "attivo").map((head) => [head.id, head.visibility]));
    if (plan.some((p) => p.kind !== "impegno" && p.kind !== "domanda")) {
      const active = rowsOf<{ id: string; statement: string; visibility: ContextVisibility }>(
        await db.execute(sql`SELECT id, statement, visibility FROM context_facts WHERE workspace_id = ${ws}::uuid AND status = 'attivo' ORDER BY last_confirmed_at DESC, id LIMIT 5000`),
      );
      for (const fact of active) {
        const key = normalizeStatement(fact.statement);
        if (key && !sameFact.has(key)) sameFact.set(key, fact.id);
        if (key && fact.visibility === "ls") lsOnly.add(key);
        activeVisibility.set(fact.id, fact.visibility);
      }
    }
    /** Il fatto `factId` non è più attivo dopo questa conferma: la sua frase non indica più lui. */
    const forget = (factId: string, statement: string) => {
      const key = normalizeStatement(statement);
      if (sameFact.get(key) === factId) sameFact.delete(key);
    };
    const reconfirmLinks: Array<{ factId: string; useCaseId: string }> = [];

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
      const headStatement = head ? (newFacts.get(head)?.statement ?? target!.statement) : null;
      // Un fatto nuovo con la frase di un fatto attivo, o una versione nuova con la frase di quella in testa: lo stesso fatto.
      // Le riconferme e i conflitti risolti con «Prima» restano come sono, qui sotto.
      const writesFact = kind !== "conferma" && !(kind === "conflitto" && item.resolution === "prima");
      const same = !writesFact ? null : head ? (normalizeStatement(statement) === normalizeStatement(headStatement!) ? head : null) : (sameFact.get(normalizeStatement(statement)) ?? null);
      if (same) {
        const born = newFacts.get(same);
        if (born) {
          // Nato in questa conferma da un'altra voce: la visibilità si chiude, non si apre; use case, entità e collegamenti si sommano.
          if (row.visibility === "ls") born.visibility = "ls";
          for (const useCaseId of validUseCases(row.useCaseIds)) born.useCaseIds.add(useCaseId);
          born.entities = [...born.entities, ...(row.entities ?? [])];
          born.relations = [...born.relations, ...(row.relations ?? [])];
        } else {
          reconfirm.add(same);
          for (const useCaseId of validUseCases(row.useCaseIds)) reconfirmLinks.push({ factId: same, useCaseId });
        }
        event("fatto_riconfermato", { factId: same, sourceId: row.sourceId });
        if (row.questionId) closing.push({ questionId: row.questionId, factId: same });
        decided.push({ id: row.id, status: "confermata", resultId: same });
        counts.reconfirmed += 1;
        continue;
      }
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
        // Una «conferma» diventata conflitto, risolta con «Ora», resta nella sezione del fatto.
        section: row.kind === "conferma" && target ? target.section : row.section!,
        statement,
        basis: row.basis,
        // Una versione nuova tiene la visibilità più stretta tra la proposta e il fatto di adesso: un «cambia» letto
        // prima che Lateral Space rendesse il fatto «Solo Lateral Space» non lo rende di nuovo pubblico. La frase di un
        // fatto «Solo Lateral Space» resta «Solo Lateral Space».
        visibility: lsOnly.has(normalizeStatement(statement)) ? "ls" : head ? stricterVisibility(row.visibility, before ? before.visibility : target!.visibility) : row.visibility,
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
        forget(head, headStatement!);
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
      const key = normalizeStatement(statement);
      if (key && !sameFact.has(key)) sameFact.set(key, id);
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
    const useCaseLinks = [
      ...[...newFacts.values()].flatMap((fact) => [...fact.useCaseIds].map((useCaseId) => ({ workspaceId: ws, factId: fact.id, useCaseId }))),
      // Un fatto riconfermato perché due appunti lo dicono: prende anche gli use case della voce.
      ...reconfirmLinks.map((link) => ({ workspaceId: ws, ...link })),
    ];
    // (9b) I legami con «Cosa serve» delle proposte confermate: `aperta` con il fatto, se il fatto resta attivo e «Per
    // tutti» e la richiesta è ancora aperta; altrimenti `scartata`. Una richiesta e un fatto si legano una volta sola.
    const linksReady = await contextWorkReady();
    const proposedLinks = linksReady
      ? rowsOf<{ id: string; proposal_id: string; need_id: string; need_open: boolean }>(
          await db.execute(sql`
            SELECT l.id, l.proposal_id, l.need_id,
              (n.type = 'requisito' AND n.archived_at IS NULL AND ${sql.raw(CLIENT_SIDE_SQL("n"))} AND n.status = ANY(${OPEN_NEEDS})) AS need_open
            FROM context_need_links l JOIN use_case_needs n ON n.id = l.need_id AND n.workspace_id = l.workspace_id
            WHERE l.workspace_id = ${ws}::uuid AND l.status = 'proposta' AND l.proposal_id = ANY(${uuidArray(ids)})
            ORDER BY l.created_at, l.id`),
        )
      : [];
    const decidedById = new Map(decided.map((d) => [d.id, d]));
    const linkPlan = planNeedLinks(
      proposedLinks.map((link) => ({ id: link.id, proposalId: link.proposal_id, needId: link.need_id, needOpen: link.need_open === true })),
      (proposalId) => {
        const result = decidedById.get(proposalId);
        const factId = result && result.status === "confermata" ? result.resultId : null;
        if (!factId) return null;
        // Un fatto nato qui (con la visibilità finale, dopo le altre voci), o uno attivo che questa conferma riconferma.
        const born = newFacts.get(factId);
        if (born) return { factId, visibility: born.visibility, active: !born.superseded };
        const visibility = activeVisibility.get(factId);
        return visibility ? { factId, visibility, active: !supersede.has(factId) } : null;
      },
    );

    const count = (n: number) => sql`${n}`;
    // I fatti che questa conferma riconferma o sostituisce: si prendono tutti insieme, in ordine di id, prima di toccarli.
    const touchedFacts = [...new Set([...reconfirm, ...supersede])];
    // Un fatto «Per tutti» sostituito da una versione nuova esce da «In breve»: la riga si cancella e si riscrive dopo.
    const publicHeads = new Set([...heads.values()].filter((head) => head.visibility === "tutti").map((head) => head.id));
    const briefLosesFact = [...supersede].some((id) => publicHeads.has(id));

    const statements = [
      // Le proposte, ferme e ancora come le ha viste la persona: se una è cambiata, tutto si annulla. Si prendono in
      // ordine di id, insieme alle altre proposte aperte sui fatti che questa conferma sostituisce (la loro versione si
      // alza qui sotto): due conferme sugli stessi fatti si mettono in fila invece di bloccarsi a vicenda.
      db.execute(sql`
        WITH RECURSIVE ${factChainCte(ws, [...supersede])},
        locked AS MATERIALIZED (
          SELECT p.id, p.version FROM context_proposals p
          WHERE p.workspace_id = ${ws}::uuid AND p.status = 'aperta'
            AND (p.id = ANY(${uuidArray(ids)}) OR p.target_fact_id IN (SELECT id FROM chain))
          ORDER BY p.id
          FOR UPDATE OF p
        ),
        held AS (
          SELECT l.id FROM locked l
          JOIN jsonb_to_recordset(${JSON.stringify(list.map((item) => ({ id: item.id, version: item.version })))}::jsonb) AS x(id uuid, version integer) ON x.id = l.id AND x.version = l.version
        )
        ${requireSql(sql`(SELECT count(*) FROM locked) >= 0 AND (SELECT count(*) FROM held) = ${count(list.length)}`, "versione_superata")}`),
      // I fatti da riconfermare e da sostituire, presi in una volta sola in ordine di id, prima di ogni UPDATE: chi li prende
      // nello stesso ordine (la riscrittura di «In breve», un'altra conferma) aspetta, invece di bloccarsi a vicenda.
      ...(touchedFacts.length > 0
        ? [
            db.execute(sql`
              SELECT f.id FROM context_facts f
              WHERE f.workspace_id = ${ws}::uuid AND f.id = ANY(${uuidArray(touchedFacts)})
              ORDER BY f.id
              FOR UPDATE OF f`),
          ]
        : []),
      // Le altre proposte aperte su un fatto che cambia: il loro «Prima» non è più quello che si vede (`versione_superata`).
      ...(supersede.size > 0 ? [bumpProposalsOnFactsStatement(ws, [...supersede], ids)] : []),
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
      ...(briefLosesFact ? [dropBriefStatement(ws)] : []),
      db.execute(sql`
        UPDATE context_proposals p SET status = x.status, result_id = x.result_id, decided_at = now(), decided_by_user_id = ${actor.userId}::uuid, updated_at = now(), version = p.version + 1
        FROM jsonb_to_recordset(${JSON.stringify(decided.map((d) => ({ id: d.id, status: d.status, result_id: d.resultId })))}::jsonb) AS x(id uuid, status text, result_id uuid)
        WHERE p.id = x.id AND p.workspace_id = ${ws}::uuid AND p.status = 'aperta'`),
    ];
    // (9b) I legami, dopo i fatti: un legame che apre una richiesta già legata allo stesso fatto si scarta. Restituisce le
    // richieste che ora hanno una risposta, per la campanella.
    const linkStatement = linkPlan.length > 0 ? statements.length : -1;
    if (linkPlan.length > 0) {
      statements.push(
        db.execute(sql`
          WITH x AS (
            SELECT * FROM jsonb_to_recordset(${JSON.stringify(linkPlan)}::jsonb) AS x(id uuid, status text, fact_id uuid)
          ), y AS (
            SELECT x.id, x.fact_id,
              CASE WHEN x.status = 'aperta' AND NOT EXISTS (
                SELECT 1 FROM context_need_links o WHERE o.need_id = l.need_id AND o.fact_id = x.fact_id AND o.id <> l.id
              ) THEN 'aperta' ELSE 'scartata' END AS status
            FROM x JOIN context_need_links l ON l.id = x.id AND l.workspace_id = ${ws}::uuid AND l.status = 'proposta'
          ), upd AS (
            UPDATE context_need_links l SET status = y.status, fact_id = CASE WHEN y.status = 'aperta' THEN y.fact_id END,
              decided_at = CASE WHEN y.status = 'scartata' THEN now() END, decided_by_user_id = CASE WHEN y.status = 'scartata' THEN ${actor.userId}::uuid END,
              version = l.version + 1, updated_at = now()
            FROM y WHERE l.id = y.id AND l.workspace_id = ${ws}::uuid AND l.status = 'proposta'
            RETURNING l.need_id, l.fact_id, l.status
          ), logged AS (
            INSERT INTO context_events (workspace_id, action, channel, fact_id, detail)
            SELECT ${ws}::uuid, 'richiesta_dalla_call', ${actor.channel}, upd.fact_id, jsonb_build_object('esigenza', upd.need_id)
            FROM upd WHERE upd.status = 'aperta'
            RETURNING id
          )
          SELECT DISTINCT need_id FROM upd WHERE status = 'aperta'`),
      );
    }
    let results: unknown[];
    try {
      results = await db.batch(statements as [(typeof statements)[number], ...Array<(typeof statements)[number]>]);
    } catch (error) {
      // Un'altra conferma è arrivata prima: su una proposta, o sul fatto che questa cambiava (l'indice unico della storia),
      // o (9b) ha appena legato lo stesso fatto alla stessa richiesta.
      if (ctxErrorCode(error) === "versione_superata" || isUniqueViolation(error, "context_facts_supersedes_unique") || isUniqueViolation(error, "context_need_links_fact_unique")) {
        return stale();
      }
      throw error;
    }
    // (9b) Dopo il batch, senza far fallire la conferma: «Il contesto è cambiato» per gli use case dei fatti scritti.
    if (newFacts.size > 0) await notifyContextChange({ workspaceId: ws, actorUserId: actor.userId, factIds: [...newFacts.keys()] });
    // (9b) «Una risposta per «Cosa serve»» ai revisori, per le richieste che questa conferma ha legato a un fatto.
    const answeredNeeds = linkStatement >= 0 ? rowsOf<{ need_id: string }>(results[linkStatement]).map((row) => row.need_id) : [];
    if (answeredNeeds.length > 0) await notifyNeedAnswered({ workspaceId: ws, actorUserId: actor.userId, needIds: answeredNeeds });
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
