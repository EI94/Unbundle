import "server-only";
/**
 * La Memoria (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.4.6, §7.2): quello che sappiamo del cliente,
 * per chi guarda. Fatti brevi in sette sezioni, ognuno con la sua fonte; i dati della Discovery letti dal vivo; gli
 * impegni aperti («Prossimi passi»); le domande aperte; «In breve»; «Novità per te».
 *
 * Ogni lista è già filtrata per chi guarda, nella query: un fatto «Solo Lateral Space» non esce mai per il cliente, e
 * citazioni, storia e chi ha confermato le vede solo Lateral Space. Scrive solo Lateral Space (tranne una domanda da
 * «Chiedi al contesto», che può aggiungere chiunque apra la pagina).
 *
 * Un fatto non si riscrive: un testo nuovo è una versione nuova, e quella di prima resta nella storia («Prima: …»).
 * Cambiare sezione, visibilità o use case aggiorna la riga.
 *
 * (9b) Dopo una scrittura riuscita che cambia un fatto legato a uno use case con un dossier («Scrivi un fatto», «Non più
 * vero», e «Modifica» per gli use case la cui vista cambia: tutti con un testo nuovo o la visibilità cambiata, anche più
 * stretta, quelli aggiunti e quelli tolti) parte «Il contesto è cambiato» per chi costruisce (`notifyContextChange`,
 * `notifyUseCasesContextChange`): non fa mai fallire l'azione. Una riconferma non è un cambio, la sezione da sola nemmeno.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { factSourceLabel, type SourceLabelKind } from "@/lib/context/labels";
import type { LiveRow } from "@/lib/context/live";
import { oneLine } from "@/lib/context/normalize";
import { scanPersonalData, scanStatement } from "@/lib/context/scan";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities, questionVisibilityFor, type ContextActor } from "@/lib/context/visibility";
import { editNoticeTargets } from "@/lib/context/work/notice-targets";
import {
  CONTEXT_LIMITS,
  CONTEXT_SECTIONS,
  CONTEXT_VISIBILITIES,
  type Basis,
  type CommitmentParty,
  type ContextSection,
  type ContextVisibility,
  type FactKind,
  type FactOrigin,
  type SourceKind,
  type SourceOrigin,
} from "@/lib/context/vocab";
import { logSafeError } from "@/lib/log/safe-error";
import { romeDate } from "@/lib/uc/calendar";
import type { ServiceResult } from "@/lib/use-cases/types";
import { loadLiveDiscovery } from "./context-discovery";
import { resolveHeads } from "./context-proposals";
import { bumpProposalsOnFactsStatement, ctxErrorCode, dropBriefStatement, eventStatement, gate, invalid, isUniqueViolation, isUuid, knownUseCases, notFound, ok, requireSql, retry, romeToday, rowsOf, stale, toDate, toIsoDate, uuidArray } from "./context-shared";
import { notifyContextChange, notifyUseCasesContextChange } from "./context-notices";
import { contextStoreReady } from "./context-store";
import { getWorkspaceById } from "./workspaces";

export { loadLiveDiscovery } from "./context-discovery";
export type { LiveRow } from "@/lib/context/live";
export type { SourceLabelKind } from "@/lib/context/labels";

const LOG_SCOPE = "context/memory";

export interface FactView {
  id: string;
  version: number;
  kind: FactKind;
  section: ContextSection;
  statement: string;
  basis: Basis;
  visibility: ContextVisibility;
  /** `needs_check` oppure un conflitto aperto. */
  needsCheck: boolean;
  sourceKind: SourceLabelKind;
  /** «Call 14 nov», «Documento 14 nov», «Scritto a mano», «senza fonte». */
  sourceLabel: string;
  /** AAAA-MM-GG */
  lastConfirmedOn: string;
}
export interface MemorySection {
  section: ContextSection;
  live: LiveRow[];
  facts: FactView[];
}
export interface CommitmentView {
  id: string;
  version: number;
  statement: string;
  party: CommitmentParty;
  roleLabel: string | null;
  dueOn: string | null;
  overdue: boolean;
  visibility: ContextVisibility;
}
export interface QuestionView {
  id: string;
  version: number;
  question: string;
  askWhom: string | null;
  visibility: ContextVisibility;
}
export interface NoveltyItem {
  factId: string;
  statement: string;
  section: ContextSection;
  tag: "nuovo" | "cambiato";
}
export interface MemoryView {
  /** Le 7, nell'ordine di CONTEXT_SECTIONS; la pagina salta quelle vuote. */
  sections: MemorySection[];
  /** Solo aperti, per scadenza. */
  nextSteps: { nostri: CommitmentView[]; cliente: CommitmentView[] };
  /** Solo aperte. */
  questions: QuestionView[];
  brief: { lines: string[]; updatedOn: string } | null;
  /** null alla prima visita o senza novità. */
  novelties: { items: NoveltyItem[]; more: number } | null;
  /**
   * Gli ultimi tre a zero per chi non è di Lateral Space. (9b) `toCheck`: i fatti attivi segnati «da verificare» dalla
   * notte (`needs_check`), zero per chi non è di Lateral Space.
   */
  counts: { facts: number; openProposals: number; unreadSources: number; pendingSourceIds: string[]; toCheck: number };
}

const emptyMemory = (): MemoryView => ({
  sections: CONTEXT_SECTIONS.map((section) => ({ section, live: [], facts: [] })),
  nextSteps: { nostri: [], cliente: [] },
  questions: [],
  brief: null,
  novelties: null,
  counts: { facts: 0, openProposals: 0, unreadSources: 0, pendingSourceIds: [], toCheck: 0 },
});

// ─── Leggere ─────────────────────────────────────────────────────────

/** Una riga di `FACT_COLUMNS` (un fatto e la sua fonte). (9b) La leggono anche context-work.ts e context-freshness.ts. */
export interface FactRow {
  id: string;
  version: number;
  kind: FactKind;
  section: ContextSection;
  statement: string;
  basis: Basis;
  visibility: ContextVisibility;
  status: string;
  origin: FactOrigin;
  needs_check: boolean;
  last_confirmed_at: unknown;
  created_at: unknown;
  ended_at: unknown;
  supersedes_id: string | null;
  confirmed_by_user_id: string | null;
  quote: string | null;
  source_id: string | null;
  source_kind: SourceKind | null;
  /** (9b) Origine e id esterno della fonte: una cosa imparata costruendo si legge «Costruzione 14 nov». */
  source_origin: SourceOrigin | null;
  source_external_id: string | null;
  source_day: unknown;
  source_title: string | null;
  /** La versione nasce da «Modifica» su un fatto con una fonte: «Call 14 nov · corretto a mano». */
  corrected: boolean;
}

/** Una versione riscritta a mano da «Modifica» (`editFact`): la sua storia lo dice, con `detail.modo = 'a_mano'`. */
const CORRECTED_BY_HAND = (fact: SQL) => sql`EXISTS (
  SELECT 1 FROM context_events e WHERE e.fact_id = ${fact}.id AND e.workspace_id = ${fact}.workspace_id AND e.action = 'fatto_cambiato' AND e.detail->>'modo' = 'a_mano'
)`;

/** Le colonne di un fatto (`f`) e della sua fonte (`s`, LEFT JOIN): per `factViewOf`. */
export const FACT_COLUMNS = sql`f.id, f.version, f.kind, f.section, f.statement, f.basis, f.visibility, f.status, f.origin, f.needs_check, f.last_confirmed_at, f.created_at,
  f.ended_at, f.supersedes_id, f.confirmed_by_user_id, f.quote, f.source_id, s.kind AS source_kind, s.origin AS source_origin, s.external_id AS source_external_id,
  s.occurred_on AS source_day, s.title AS source_title, ${CORRECTED_BY_HAND(sql.raw("f"))} AS corrected`;

/** La fonte a parole: «Call 14 nov», e se il testo l'ha corretto una persona «Call 14 nov · corretto a mano». */
function sourceLabelOf(row: Pick<FactRow, "origin" | "source_kind" | "source_origin" | "source_external_id" | "source_day" | "corrected">, today: string) {
  const source = factSourceLabel(
    { origin: row.origin, sourceKind: row.source_kind, sourceOrigin: row.source_origin, sourceExternalId: row.source_external_id, sourceOccurredOn: row.source_day ? toIsoDate(row.source_day) : null },
    today,
  );
  return { ...source, label: row.corrected === true && source.kind !== "manuale" ? CONTEXT_TEXT.fact.correctedByHand(source.label) : source.label };
}

/** Un fatto per chi guarda: la fonte a parole, il segno «da verificare» (anche per un conflitto aperto). */
export function factViewOf(row: FactRow, today: string, disputed: ReadonlySet<string>): FactView {
  const source = sourceLabelOf(row, today);
  const confirmed = toDate(row.last_confirmed_at);
  return {
    id: row.id,
    version: Number(row.version),
    kind: row.kind,
    section: row.section,
    statement: row.statement,
    basis: row.basis,
    visibility: row.visibility,
    needsCheck: row.needs_check === true || disputed.has(row.id),
    sourceKind: source.kind,
    sourceLabel: source.label,
    lastConfirmedOn: confirmed ? romeDate(confirmed) : "",
  };
}

/** I fatti attivi con un conflitto aperto: «da verificare». I conflitti sono proposte, e le vede solo Lateral Space. */
export async function disputedFacts(workspaceId: string): Promise<Set<string>> {
  const targets = rowsOf<{ target_fact_id: string }>(
    await db.execute(sql`
      SELECT DISTINCT target_fact_id FROM context_proposals
      WHERE workspace_id = ${workspaceId}::uuid AND status = 'aperta' AND kind = 'conflitto' AND target_fact_id IS NOT NULL LIMIT 500`),
  );
  if (targets.length === 0) return new Set();
  const heads = await resolveHeads(workspaceId, targets.map((t) => t.target_fact_id));
  return new Set([...heads.values()].filter((h) => h.status === "attivo").map((h) => h.id));
}

/** Un impegno aperto per chi guarda (le colonne di `context_commitments` lette a mano). */
export function commitmentViewOf(
  row: { id: string; version: number; statement: string; party: CommitmentParty; role_label: string | null; due_on: unknown; visibility: ContextVisibility },
  today: string,
): CommitmentView {
  const dueOn = row.due_on ? toIsoDate(row.due_on) : null;
  return { id: row.id, version: Number(row.version), statement: row.statement, party: row.party, roleLabel: row.role_label, dueOn, overdue: dueOn !== null && dueOn < today, visibility: row.visibility };
}

/** Una domanda aperta per chi guarda (le colonne di `context_questions` lette a mano). */
export function questionViewOf(row: { id: string; version: number; question: string; ask_whom: string | null; visibility: ContextVisibility }): QuestionView {
  return { id: row.id, version: Number(row.version), question: row.question, askWhom: row.ask_whom, visibility: row.visibility };
}

/**
 * «Novità per te»: una visita dura 30 minuti. Se l'ultima apertura ha più di 30 minuti, `previous_seen_at`
 * prende `seen_at` e `seen_at` prende adesso. Restituisce `previous_seen_at` (null alla prima visita).
 */
export async function touchContextSeen(actor: ContextActor, now: Date = new Date()): Promise<Date | null> {
  if (!contextAbilities(actor).canOpen || !isUuid(actor.workspaceId) || !isUuid(actor.userId) || !(await contextStoreReady())) return null;
  const at = now.toISOString();
  const visit = sql`context_seen.seen_at < ${at}::timestamptz - make_interval(mins => ${CONTEXT_LIMITS.seenVisitMinutes})`;
  const rows = rowsOf<{ previous_seen_at: unknown }>(
    await db.execute(sql`
      INSERT INTO context_seen (workspace_id, user_id, seen_at, previous_seen_at)
      VALUES (${actor.workspaceId}::uuid, ${actor.userId}::uuid, ${at}::timestamptz, NULL)
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET
        previous_seen_at = CASE WHEN ${visit} THEN context_seen.seen_at ELSE context_seen.previous_seen_at END,
        seen_at = CASE WHEN ${visit} THEN ${at}::timestamptz ELSE context_seen.seen_at END
      RETURNING previous_seen_at`),
  );
  return toDate(rows[0]?.previous_seen_at);
}

/**
 * La Memoria per chi guarda: ogni lista è già filtrata per visibilità. Chiama `touchContextSeen`, tranne con
 * `touchSeen: false` (9b: l'MCP del team, perché leggere da Claude non è una visita): allora «Novità per te» è null.
 */
export async function loadContextMemory(actor: ContextActor, opts: { now?: Date; touchSeen?: boolean } = {}): Promise<MemoryView> {
  const abilities = contextAbilities(actor);
  if (!abilities.canOpen || !isUuid(actor.workspaceId) || !isUuid(actor.userId) || !(await contextStoreReady())) return emptyMemory();
  const ws = actor.workspaceId;
  const now = opts.now ?? new Date();
  const today = romeToday(now);
  const lateralSpace = abilities.seesLateralSpace;
  const workspace = await getWorkspaceById(ws);
  if (!workspace) return emptyMemory();
  const visible = sql`(${lateralSpace} OR visibility = 'tutti')`;
  const previous = opts.touchSeen === false ? null : await touchContextSeen(actor, now);

  const [factRows, commitmentRows, questionRows, briefRows, live, disputed, pending, openProposals, toCheck] = await Promise.all([
    db.execute(sql`
      SELECT ${FACT_COLUMNS} FROM context_facts f LEFT JOIN context_sources s ON s.id = f.source_id
      WHERE f.workspace_id = ${ws}::uuid AND f.status = 'attivo' AND (${lateralSpace} OR f.visibility = 'tutti')
      ORDER BY f.last_confirmed_at DESC, f.id LIMIT 1000`),
    db.execute(sql`
      SELECT id, version, statement, party, role_label, due_on, visibility FROM context_commitments
      WHERE workspace_id = ${ws}::uuid AND status = 'aperto' AND ${visible}
      ORDER BY due_on NULLS LAST, created_at, id LIMIT 200`),
    db.execute(sql`
      SELECT id, version, question, ask_whom, visibility FROM context_questions
      WHERE workspace_id = ${ws}::uuid AND status = 'aperta' AND ${visible}
      ORDER BY created_at, id LIMIT 200`),
    db.execute(sql`SELECT lines, generated_at FROM context_briefs WHERE workspace_id = ${ws}::uuid`),
    loadLiveDiscovery(workspace, actor),
    lateralSpace ? disputedFacts(ws) : Promise.resolve(new Set<string>()),
    lateralSpace
      ? db.execute(sql`
          SELECT id, count(*) OVER ()::int AS total FROM context_sources
          WHERE workspace_id = ${ws}::uuid AND text_purged_at IS NULL
            AND (read_status = 'da_leggere' OR (read_status = 'in_lettura' AND read_started_at < now() - make_interval(secs => ${CONTEXT_LIMITS.readLeaseSeconds})))
          ORDER BY created_at, id LIMIT 20`)
      : Promise.resolve({ rows: [] }),
    lateralSpace
      ? db.execute(sql`SELECT count(*)::int AS n FROM context_proposals WHERE workspace_id = ${ws}::uuid AND status = 'aperta'`)
      : Promise.resolve({ rows: [] }),
    // (9b) «3 fatti da verificare»: solo Lateral Space li riconferma.
    lateralSpace
      ? db.execute(sql`SELECT count(*)::int AS n FROM context_facts WHERE workspace_id = ${ws}::uuid AND status = 'attivo' AND needs_check`)
      : Promise.resolve({ rows: [] }),
  ]);

  const facts = rowsOf<FactRow>(factRows);
  const views = facts.map((row) => factViewOf(row, today, disputed));
  const sections: MemorySection[] = CONTEXT_SECTIONS.map((section) => ({
    section,
    live: live.filter((row) => row.section === section),
    facts: views.filter((fact) => fact.section === section),
  }));

  const commitments = rowsOf<{ id: string; version: number; statement: string; party: CommitmentParty; role_label: string | null; due_on: unknown; visibility: ContextVisibility }>(commitmentRows).map(
    (row) => commitmentViewOf(row, today),
  );
  const questions = rowsOf<{ id: string; version: number; question: string; ask_whom: string | null; visibility: ContextVisibility }>(questionRows).map(questionViewOf);

  const [briefRow] = rowsOf<{ lines: unknown; generated_at: unknown }>(briefRows);
  const briefLines = Array.isArray(briefRow?.lines) ? briefRow.lines.filter((line): line is string => typeof line === "string" && line.trim() !== "") : [];
  const generated = toDate(briefRow?.generated_at);
  const brief = briefLines.length > 0 && generated ? { lines: briefLines, updatedOn: romeDate(generated) } : null;

  // «Novità per te»: i fatti nati dopo la visita di prima (nuovi, o versioni nuove), non confermati da chi guarda.
  let novelties: MemoryView["novelties"] = null;
  if (previous) {
    const fresh = facts.filter((row) => {
      const created = toDate(row.created_at);
      return created !== null && created.getTime() > previous.getTime() && row.confirmed_by_user_id !== actor.userId;
    });
    fresh.sort((a, b) => (toDate(b.created_at)?.getTime() ?? 0) - (toDate(a.created_at)?.getTime() ?? 0));
    if (fresh.length > 0) {
      novelties = {
        items: fresh.slice(0, CONTEXT_LIMITS.noveltiesShown).map((row) => ({ factId: row.id, statement: row.statement, section: row.section, tag: row.supersedes_id ? "cambiato" : "nuovo" })),
        more: Math.max(0, fresh.length - CONTEXT_LIMITS.noveltiesShown),
      };
    }
  }

  const pendingRows = rowsOf<{ id: string; total: number }>(pending);
  return {
    sections,
    nextSteps: { nostri: commitments.filter((c) => c.party === "nostra"), cliente: commitments.filter((c) => c.party === "cliente") },
    questions,
    brief,
    novelties,
    counts: {
      facts: views.length,
      openProposals: Number(rowsOf<{ n: number }>(openProposals)[0]?.n ?? 0),
      unreadSources: Number(pendingRows[0]?.total ?? 0),
      pendingSourceIds: pendingRows.map((row) => row.id),
      toCheck: Number(rowsOf<{ n: number }>(toCheck)[0]?.n ?? 0),
    },
  };
}

export interface FactDetail extends FactView {
  useCases: Array<{ id: string; code: string | null; title: string }>;
  // Solo a Lateral Space; agli altri null e liste vuote:
  quote: string | null;
  source: { id: string; title: string; occurredOn: string } | null;
  /** Le versioni di prima, dalla più recente. */
  history: Array<{ statement: string; from: string; to: string | null; sourceLabel: string }>;
  confirmedBy: { name: string; on: string } | null;
}

/** Il pannello di un fatto: per tutti la fonte, l'ultima conferma e gli use case; per Lateral Space anche citazione, storia e chi ha confermato. */
export async function getFactDetail(actor: ContextActor, factId: string): Promise<FactDetail | null> {
  const abilities = contextAbilities(actor);
  if (!abilities.canOpen || !isUuid(actor.workspaceId) || !isUuid(factId) || !(await contextStoreReady())) return null;
  const ws = actor.workspaceId;
  const lateralSpace = abilities.seesLateralSpace;
  const today = romeToday();
  const [row] = rowsOf<FactRow>(
    await db.execute(sql`
      SELECT ${FACT_COLUMNS} FROM context_facts f LEFT JOIN context_sources s ON s.id = f.source_id
      WHERE f.id = ${factId}::uuid AND f.workspace_id = ${ws}::uuid AND (${lateralSpace} OR (f.visibility = 'tutti' AND f.status = 'attivo'))`),
  );
  if (!row) return null;
  const [useCases, disputed] = await Promise.all([
    db.execute(sql`
      SELECT u.id, u.code, u.title FROM context_fact_links l JOIN use_cases u ON u.id = l.use_case_id AND u.workspace_id = ${ws}::uuid
      WHERE l.fact_id = ${factId}::uuid AND l.workspace_id = ${ws}::uuid ORDER BY u.code NULLS LAST, u.title`),
    lateralSpace ? disputedFacts(ws) : Promise.resolve(new Set<string>()),
  ]);
  const view: FactDetail = {
    ...factViewOf(row, today, disputed),
    useCases: rowsOf<{ id: string; code: string | null; title: string }>(useCases).map((u) => ({ id: u.id, code: u.code, title: u.title })),
    quote: null,
    source: null,
    history: [],
    confirmedBy: null,
  };
  if (!lateralSpace) return view;
  const [history, confirmer] = await Promise.all([
    db.execute(sql`
      WITH RECURSIVE back AS (
        SELECT f.id, f.supersedes_id, 0 AS depth FROM context_facts f WHERE f.id = ${factId}::uuid AND f.workspace_id = ${ws}::uuid
        UNION ALL
        SELECT p.id, p.supersedes_id, b.depth + 1 FROM back b JOIN context_facts p ON p.id = b.supersedes_id AND p.workspace_id = ${ws}::uuid WHERE b.depth < 200
      )
      SELECT f.statement, f.created_at, f.ended_at, f.origin, s.kind AS source_kind, s.origin AS source_origin, s.external_id AS source_external_id, s.occurred_on AS source_day,
        ${CORRECTED_BY_HAND(sql.raw("f"))} AS corrected
      FROM back b JOIN context_facts f ON f.id = b.id LEFT JOIN context_sources s ON s.id = f.source_id
      WHERE b.depth > 0 ORDER BY b.depth`),
    row.confirmed_by_user_id
      ? db.execute(sql`SELECT coalesce(nullif(btrim(name), ''), email) AS name FROM users WHERE id = ${row.confirmed_by_user_id}::uuid`)
      : Promise.resolve({ rows: [] }),
  ]);
  view.quote = row.quote;
  view.source = row.source_id && row.source_title ? { id: row.source_id, title: row.source_title, occurredOn: toIsoDate(row.source_day) } : null;
  view.history = rowsOf<{
    statement: string;
    created_at: unknown;
    ended_at: unknown;
    origin: FactOrigin;
    source_kind: SourceKind | null;
    source_origin: SourceOrigin | null;
    source_external_id: string | null;
    source_day: unknown;
    corrected: boolean;
  }>(history).map((h) => {
    const from = toDate(h.created_at);
    const to = toDate(h.ended_at);
    return {
      statement: h.statement,
      from: from ? romeDate(from) : "",
      to: to ? romeDate(to) : null,
      sourceLabel: sourceLabelOf(h, today).label,
    };
  });
  const name = rowsOf<{ name: string | null }>(confirmer)[0]?.name;
  view.confirmedBy = name ? { name, on: view.lastConfirmedOn } : null;
  return view;
}

// ─── Scrivere un fatto ───────────────────────────────────────────────

interface CleanFact {
  statement: string;
  section: ContextSection;
  visibility: ContextVisibility;
  useCaseIds: string[] | null;
}

/** Validazione e controllo dei testi di un fatto scritto o modificato a mano. `current`: i valori di oggi, per i campi non toccati. */
async function checkFact(
  workspaceId: string,
  input: { statement?: unknown; section?: unknown; visibility?: unknown; useCaseIds?: unknown },
  current?: { statement: string; section: ContextSection; visibility: ContextVisibility },
): Promise<{ ok: true; fact: CleanFact } | { ok: false; fieldErrors: Record<string, string> }> {
  const T = CONTEXT_TEXT;
  const fieldErrors: Record<string, string> = {};
  const statement = input.statement === undefined && current ? current.statement : oneLine(typeof input.statement === "string" ? input.statement : "");
  if (statement.length < CONTEXT_LIMITS.statementMin) fieldErrors.statement = T.errors.statementTooShort;
  else if (statement.length > CONTEXT_LIMITS.statementMax) fieldErrors.statement = T.errors.statementTooLong;
  else {
    // Un nome, un contatto, un dato sanitario non entrano in memoria: le persone si indicano per ruolo.
    const scan = scanStatement(statement);
    if (!scan.ok) fieldErrors.statement = scan.message;
  }
  const section = input.section === undefined && current ? current.section : input.section;
  if (!(CONTEXT_SECTIONS as readonly unknown[]).includes(section)) fieldErrors.section = T.errors.sectionMissing;
  const visibility = input.visibility === undefined && current ? current.visibility : input.visibility;
  if (!(CONTEXT_VISIBILITIES as readonly unknown[]).includes(visibility)) fieldErrors.visibility = T.errors.visibilityMissing;
  let useCaseIds: string[] | null = null;
  if (input.useCaseIds !== undefined) {
    const ids = Array.isArray(input.useCaseIds) ? [...new Set(input.useCaseIds.filter((id): id is string => typeof id === "string"))] : [];
    const known = await knownUseCases(workspaceId, ids);
    if (!Array.isArray(input.useCaseIds) || ids.length > 20 || ids.length !== input.useCaseIds.length || ids.some((id) => !known.has(id))) fieldErrors.useCaseIds = T.errors.useCaseUnknown;
    else useCaseIds = ids;
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, fact: { statement, section: section as ContextSection, visibility: visibility as ContextVisibility, useCaseIds } };
}

/** I legami di un fatto con gli use case, da mettere in un batch. */
function linkUseCasesStatement(workspaceId: string, factId: string, useCaseIds: readonly string[]) {
  return db.execute(sql`
    INSERT INTO context_fact_links (workspace_id, fact_id, use_case_id)
    SELECT ${workspaceId}::uuid, ${factId}::uuid, u.id FROM use_cases u
    WHERE u.workspace_id = ${workspaceId}::uuid AND u.id = ANY(${uuidArray(useCaseIds)})
    ON CONFLICT DO NOTHING`);
}

/** «Scrivi un fatto»: `origin = 'manuale'`, base «detto». `scanStatement` ferma i nomi. Evento `fatto_scritto`. */
export async function writeFact(actor: ContextActor, input: { statement: string; section: ContextSection; visibility: ContextVisibility; useCaseIds?: string[] }): Promise<ServiceResult<{ factId: string }>> {
  const allowed = await gate(actor, "canEditMemory");
  if (!allowed.ok) return allowed;
  const ws = actor.workspaceId;
  try {
    const checked = await checkFact(ws, input ?? {});
    if (!checked.ok) return invalid(checked.fieldErrors);
    const fact = checked.fact;
    const factId = crypto.randomUUID();
    await db.batch([
      db.execute(sql`
        INSERT INTO context_facts (id, workspace_id, kind, section, statement, basis, visibility, origin, confirmed_by_user_id)
        VALUES (${factId}::uuid, ${ws}::uuid, 'fatto', ${fact.section}, ${fact.statement}, 'detto', ${fact.visibility}, 'manuale', ${actor.userId}::uuid)`),
      linkUseCasesStatement(ws, factId, fact.useCaseIds ?? []),
      eventStatement({ workspaceId: ws, action: "fatto_scritto", channel: actor.channel, actorUserId: actor.userId, factId }),
    ]);
    await notifyContextChange({ workspaceId: ws, actorUserId: actor.userId, factIds: [factId] });
    return ok({ factId });
  } catch (error) {
    logSafeError(LOG_SCOPE, "fatto_non_scritto", error, { workspaceId: ws });
    return retry();
  }
}

/** Gli use case legati a un fatto di questo workspace. */
async function linkedUseCases(workspaceId: string, factId: string): Promise<Set<string>> {
  const rows = rowsOf<{ use_case_id: string }>(
    await db.execute(sql`SELECT use_case_id FROM context_fact_links WHERE fact_id = ${factId}::uuid AND workspace_id = ${workspaceId}::uuid AND use_case_id IS NOT NULL`),
  );
  return new Set(rows.map((row) => row.use_case_id));
}

/** Un fatto attivo di questo workspace, con la sua versione e la sua fonte. */
async function loadActiveFact(workspaceId: string, factId: string) {
  const [row] = rowsOf<{
    id: string;
    version: number;
    kind: FactKind;
    section: ContextSection;
    statement: string;
    visibility: ContextVisibility;
    status: string;
    basis: Basis;
    origin: FactOrigin;
    source_id: string | null;
    quote: string | null;
  }>(
    await db.execute(sql`
      SELECT id, version, kind, section, statement, visibility, status, basis, origin, source_id, quote
      FROM context_facts WHERE id = ${factId}::uuid AND workspace_id = ${workspaceId}::uuid`),
  );
  return row ?? null;
}

/**
 * Un testo nuovo crea una versione (`fatto_cambiato`, `detail.modo = 'a_mano'`) che tiene la fonte, la citazione e la
 * base di quella di prima: un fatto venuto da una call resta di quella call, «Call 14 nov · corretto a mano»; uno
 * scritto a mano resta «Scritto a mano». Sezione, visibilità e use case aggiornano la riga. Risponde con l'id della
 * versione attiva.
 */
export async function editFact(
  actor: ContextActor,
  factId: string,
  expectedVersion: number,
  patch: { statement?: string; section?: ContextSection; visibility?: ContextVisibility; useCaseIds?: string[] },
): Promise<ServiceResult<{ factId: string }>> {
  const allowed = await gate(actor, "canEditMemory");
  if (!allowed.ok) return allowed;
  if (!isUuid(factId)) return notFound();
  const ws = actor.workspaceId;
  try {
    const current = await loadActiveFact(ws, factId);
    if (!current) return notFound();
    if (current.status !== "attivo" || Number(current.version) !== expectedVersion) return stale();
    const checked = await checkFact(ws, patch ?? {}, current);
    if (!checked.ok) return invalid(checked.fieldErrors);
    const next = checked.fact;
    const held = (code = "versione_superata") => sql`
      WITH old AS (
        UPDATE context_facts SET status = 'superato', ended_at = now(), updated_at = now(), version = version + 1
        WHERE id = ${factId}::uuid AND workspace_id = ${ws}::uuid AND status = 'attivo' AND version = ${expectedVersion}
        RETURNING id
      )
      ${requireSql(sql`(SELECT count(*) FROM old) = 1`, code)}`;

    // Un fatto «Per tutti» che cambia testo o diventa «Solo Lateral Space» esce da «In breve» (`dropBriefStatement`).
    const leavesBrief = current.visibility === "tutti" && (next.statement !== current.statement || next.visibility !== "tutti");
    // (9b) Gli use case di adesso: «Il contesto è cambiato» va a quelli la cui vista cambia, anche a quelli tolti.
    const linkedBefore = [...(await linkedUseCases(ws, factId))];
    const noticeTargets = (textChanged: boolean) =>
      editNoticeTargets({
        before: { visibility: current.visibility, useCaseIds: linkedBefore },
        after: { visibility: next.visibility, useCaseIds: next.useCaseIds ?? linkedBefore },
        textChanged,
      });
    if (next.statement !== current.statement) {
      // Un testo nuovo è una versione nuova, corretta a mano: tiene la fonte e la citazione; quella di prima resta nella storia.
      const newId = crypto.randomUUID();
      await db.batch([
        // Le proposte aperte su questo fatto hanno un «Prima» nuovo: chi le ha davanti come erano le rilegge.
        bumpProposalsOnFactsStatement(ws, [factId]),
        db.execute(held()),
        ...(leavesBrief ? [dropBriefStatement(ws)] : []),
        db.execute(sql`
          INSERT INTO context_facts (id, workspace_id, kind, section, statement, basis, visibility, origin, source_id, quote, supersedes_id, confirmed_by_user_id)
          VALUES (${newId}::uuid, ${ws}::uuid, ${current.kind}, ${next.section}, ${next.statement}, ${current.basis}, ${next.visibility}, ${current.origin},
            ${current.source_id}::uuid, ${current.quote}, ${factId}::uuid, ${actor.userId}::uuid)`),
        next.useCaseIds !== null
          ? linkUseCasesStatement(ws, newId, next.useCaseIds)
          : db.execute(sql`
              INSERT INTO context_fact_links (workspace_id, fact_id, use_case_id)
              SELECT workspace_id, ${newId}::uuid, use_case_id FROM context_fact_links WHERE fact_id = ${factId}::uuid AND workspace_id = ${ws}::uuid AND use_case_id IS NOT NULL`),
        eventStatement({ workspaceId: ws, action: "fatto_cambiato", channel: actor.channel, actorUserId: actor.userId, factId: newId, detail: { modo: "a_mano" } }),
      ]);
      await notifyUseCasesContextChange({ workspaceId: ws, actorUserId: actor.userId, targets: noticeTargets(true) });
      return ok({ factId: newId });
    }

    const sectionChanged = next.section !== current.section;
    const visibilityChanged = next.visibility !== current.visibility;
    if (!sectionChanged && !visibilityChanged && next.useCaseIds === null) return ok({ factId });
    await db.batch([
      db.execute(sql`
        WITH kept AS (
          UPDATE context_facts SET section = ${next.section}, visibility = ${next.visibility}, updated_at = now(), version = version + 1
          WHERE id = ${factId}::uuid AND workspace_id = ${ws}::uuid AND status = 'attivo' AND version = ${expectedVersion}
          RETURNING id
        )
        ${requireSql(sql`(SELECT count(*) FROM kept) = 1`, "versione_superata")}`),
      ...(leavesBrief ? [dropBriefStatement(ws)] : []),
      ...(next.useCaseIds !== null
        ? [
            db.execute(sql`DELETE FROM context_fact_links WHERE fact_id = ${factId}::uuid AND workspace_id = ${ws}::uuid AND use_case_id IS NOT NULL AND NOT (use_case_id = ANY(${uuidArray(next.useCaseIds)}))`),
            linkUseCasesStatement(ws, factId, next.useCaseIds),
          ]
        : []),
      ...(sectionChanged ? [eventStatement({ workspaceId: ws, action: "sezione_cambiata", channel: actor.channel, actorUserId: actor.userId, factId, detail: { da: current.section, a: next.section } })] : []),
      ...(visibilityChanged ? [eventStatement({ workspaceId: ws, action: "visibilita_cambiata", channel: actor.channel, actorUserId: actor.userId, factId, detail: { da: current.visibility, a: next.visibility } })] : []),
    ]);
    // (9b) Solo gli use case la cui vista cambia: tutti con la visibilità cambiata (anche più stretta: chi costruisce ha un
    // CONTESTO.md da aggiornare), quelli aggiunti e quelli tolti; la sezione da sola nessuno.
    await notifyUseCasesContextChange({ workspaceId: ws, actorUserId: actor.userId, targets: noticeTargets(false) });
    return ok({ factId });
  } catch (error) {
    // Un'altra modifica è arrivata prima: sulla riga, o sulla storia del fatto (l'indice unico).
    if (ctxErrorCode(error) === "versione_superata" || isUniqueViolation(error, "context_facts_supersedes_unique")) return stale();
    logSafeError(LOG_SCOPE, "fatto_non_modificato", error, { workspaceId: ws, factId });
    return retry();
  }
}

/** «Ancora vero». */
export async function reconfirmFact(actor: ContextActor, factId: string): Promise<ServiceResult<true>> {
  const allowed = await gate(actor, "canEditMemory");
  if (!allowed.ok) return allowed;
  if (!isUuid(factId)) return notFound();
  const ws = actor.workspaceId;
  try {
    const fresh = sql`EXISTS (SELECT 1 FROM context_facts x WHERE x.id = ${factId}::uuid AND x.workspace_id = ${ws}::uuid AND x.status = 'attivo' AND x.last_confirmed_at = now())`;
    const results = await db.batch([
      db.execute(sql`
        UPDATE context_facts SET last_confirmed_at = now(), needs_check = false, confirmed_by_user_id = ${actor.userId}::uuid, updated_at = now()
        WHERE id = ${factId}::uuid AND workspace_id = ${ws}::uuid AND status = 'attivo'
        RETURNING id`),
      eventStatement({ workspaceId: ws, action: "fatto_riconfermato", channel: actor.channel, actorUserId: actor.userId, factId }, fresh),
    ]);
    return rowsOf(results[0]).length === 1 ? ok(true) : notFound();
  } catch (error) {
    logSafeError(LOG_SCOPE, "fatto_non_riconfermato", error, { workspaceId: ws, factId });
    return retry();
  }
}

/** «Non più vero»: `ritirato` con `ended_at`. Resta nella storia. */
export async function retireFact(actor: ContextActor, factId: string, expectedVersion: number): Promise<ServiceResult<true>> {
  const allowed = await gate(actor, "canEditMemory");
  if (!allowed.ok) return allowed;
  if (!isUuid(factId)) return notFound();
  const ws = actor.workspaceId;
  try {
    const current = await loadActiveFact(ws, factId);
    if (!current) return notFound();
    if (current.status !== "attivo" || Number(current.version) !== expectedVersion) return stale();
    const retired = sql`EXISTS (SELECT 1 FROM context_facts x WHERE x.id = ${factId}::uuid AND x.status = 'ritirato' AND x.ended_at = now())`;
    await db.batch([
      // Le proposte aperte su questo fatto ora valgono come fatti nuovi: chi le ha davanti come erano le rilegge.
      bumpProposalsOnFactsStatement(ws, [factId]),
      db.execute(sql`
        WITH gone AS (
          UPDATE context_facts SET status = 'ritirato', ended_at = now(), updated_at = now(), version = version + 1
          WHERE id = ${factId}::uuid AND workspace_id = ${ws}::uuid AND status = 'attivo' AND version = ${expectedVersion}
          RETURNING id
        )
        ${requireSql(sql`(SELECT count(*) FROM gone) = 1`, "versione_superata")}`),
      eventStatement({ workspaceId: ws, action: "fatto_ritirato", channel: actor.channel, actorUserId: actor.userId, factId }, retired),
      // Un fatto «Per tutti» ritirato esce da «In breve».
      ...(current.visibility === "tutti" ? [dropBriefStatement(ws, retired)] : []),
    ]);
    await notifyContextChange({ workspaceId: ws, actorUserId: actor.userId, factIds: [factId] });
    return ok(true);
  } catch (error) {
    if (ctxErrorCode(error) === "versione_superata") return stale();
    logSafeError(LOG_SCOPE, "fatto_non_ritirato", error, { workspaceId: ws, factId });
    return retry();
  }
}

// ─── Impegni e domande ───────────────────────────────────────────────

type ItemChange = { table: "context_commitments"; from: "aperto"; to: "fatto"; action: "impegno_chiuso" } | { table: "context_commitments"; from: "fatto"; to: "aperto"; action: "impegno_riaperto" } | { table: "context_questions"; from: "aperta"; to: "chiusa"; action: "domanda_chiusa" };

/** Un impegno o una domanda cambia stato, solo se è ancora alla versione vista. Nella storia senza attore: non si misura per persona. */
async function changeItem(actor: ContextActor, id: string, expectedVersion: number, change: ItemChange): Promise<ServiceResult<true>> {
  const allowed = await gate(actor, "canEditMemory");
  if (!allowed.ok) return allowed;
  if (!isUuid(id) || !Number.isInteger(expectedVersion)) return notFound();
  const ws = actor.workspaceId;
  const table = sql.raw(change.table);
  const closes = change.to !== "aperto";
  try {
    const [row] = rowsOf<{ status: string; version: number }>(await db.execute(sql`SELECT status, version FROM ${table} WHERE id = ${id}::uuid AND workspace_id = ${ws}::uuid`));
    if (!row) return notFound();
    if (row.status !== change.from || Number(row.version) !== expectedVersion) return stale();
    const changed = sql`EXISTS (SELECT 1 FROM ${table} x WHERE x.id = ${id}::uuid AND x.status = ${change.to} AND x.updated_at = now())`;
    const results = await db.batch([
      db.execute(sql`
        UPDATE ${table} SET status = ${change.to}, closed_at = CASE WHEN ${closes} THEN now() ELSE NULL END, updated_at = now(), version = version + 1
        WHERE id = ${id}::uuid AND workspace_id = ${ws}::uuid AND status = ${change.from} AND version = ${expectedVersion}
        RETURNING id`),
      eventStatement(
        { workspaceId: ws, action: change.action, channel: actor.channel, actorUserId: null, ...(change.table === "context_commitments" ? { commitmentId: id } : { questionId: id }) },
        changed,
      ),
    ]);
    return rowsOf(results[0]).length === 1 ? ok(true) : stale();
  } catch (error) {
    logSafeError(LOG_SCOPE, "stato_non_cambiato", error, { workspaceId: ws });
    return retry();
  }
}

/** «Fatto» su un impegno. */
export async function closeCommitment(actor: ContextActor, id: string, expectedVersion: number): Promise<ServiceResult<true>> {
  return changeItem(actor, id, expectedVersion, { table: "context_commitments", from: "aperto", to: "fatto", action: "impegno_chiuso" });
}
/** «Riapri» su un impegno fatto. */
export async function reopenCommitment(actor: ContextActor, id: string, expectedVersion: number): Promise<ServiceResult<true>> {
  return changeItem(actor, id, expectedVersion, { table: "context_commitments", from: "fatto", to: "aperto", action: "impegno_riaperto" });
}
/** «Chiusa» su una domanda aperta. */
export async function closeQuestion(actor: ContextActor, id: string, expectedVersion: number): Promise<ServiceResult<true>> {
  return changeItem(actor, id, expectedVersion, { table: "context_questions", from: "aperta", to: "chiusa", action: "domanda_chiusa" });
}

/** Da «Chiedi al contesto»: chi può aprire la pagina. Visibilità `ls` se la aggiunge Lateral Space, `tutti` altrimenti. `origin = 'chiedi'`. */
export async function addQuestion(actor: ContextActor, input: { question: string; askWhom?: string | null }): Promise<ServiceResult<{ questionId: string }>> {
  const allowed = await gate(actor, "canAddQuestion");
  if (!allowed.ok) return allowed;
  const T = CONTEXT_TEXT;
  const fieldErrors: Record<string, string> = {};
  const question = oneLine(typeof input?.question === "string" ? input.question : "");
  if (question.length < CONTEXT_LIMITS.askMin) fieldErrors.question = T.ask.tooShort;
  else if (question.length > CONTEXT_LIMITS.questionMax) fieldErrors.question = T.errors.tooLong(CONTEXT_LIMITS.questionMax);
  else {
    const scan = scanStatement(question);
    if (!scan.ok) fieldErrors.question = scan.message;
  }
  const askWhom = oneLine(typeof input?.askWhom === "string" ? input.askWhom : "");
  if (askWhom.length > CONTEXT_LIMITS.roleLabelMax) fieldErrors.askWhom = T.errors.tooLong(CONTEXT_LIMITS.roleLabelMax);
  else if (askWhom) {
    const scan = scanPersonalData(askWhom);
    if (!scan.ok) fieldErrors.askWhom = scan.message;
  }
  if (Object.keys(fieldErrors).length > 0) return invalid(fieldErrors);
  const ws = actor.workspaceId;
  const visibility = questionVisibilityFor(actor);
  const questionId = crypto.randomUUID();
  try {
    // La stessa domanda già aperta (che chi chiede può vedere): torna quella.
    const same = sql`SELECT id FROM context_questions x WHERE x.workspace_id = ${ws}::uuid AND x.status = 'aperta' AND lower(x.question) = lower(${question}) AND (${actor.isLateralSpace} OR x.visibility = 'tutti')`;
    const results = await db.batch([
      db.execute(sql`
        INSERT INTO context_questions (id, workspace_id, question, ask_whom, visibility, origin)
        SELECT ${questionId}::uuid, ${ws}::uuid, ${question}, ${askWhom || null}, ${visibility}, 'chiedi'
        WHERE NOT EXISTS (${same})`),
      eventStatement(
        { workspaceId: ws, action: "domanda_aggiunta", channel: actor.channel, actorUserId: null, questionId },
        sql`EXISTS (SELECT 1 FROM context_questions x WHERE x.id = ${questionId}::uuid)`,
      ),
      db.execute(sql`${same} ORDER BY x.created_at, x.id LIMIT 1`),
    ]);
    const [row] = rowsOf<{ id: string }>(results[2]);
    return row ? ok({ questionId: row.id }) : retry();
  } catch (error) {
    logSafeError(LOG_SCOPE, "domanda_non_aggiunta", error, { workspaceId: ws });
    return retry();
  }
}
