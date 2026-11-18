import "server-only";
/**
 * Il contesto nel lavoro (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §4.3): le letture che gli altri moduli
 * chiamano per portare la memoria del cliente dove si lavora.
 *
 * - `loadUseCaseContext`: la piega «Contesto» della scheda dello use case e la sezione del dossier, **per chi guarda**:
 *   Lateral Space tutto, il cliente solo «Per tutti». Mai una citazione.
 * - `loadAgentContext`: `CONTESTO.md`, lo strato `contesto` della CLI e dell'MCP del caso, la riga del brief e quella del
 *   dossier (le loro novità sono le righe di `CONTESTO.md` che cambierebbero: `packageContextDelta` di
 *   `factory/package.ts`). **Sempre e solo «Per tutti»** (D1), qualunque sia chi chiede: i coding agent scrivono in
 *   repository e PR che leggono anche chi costruisce da fuori e il cliente.
 * - `loadPromptContext`: il blocco «Contesto» per la chat della Discovery e per i generatori (§2.12), solo «Per tutti» e
 *   solo con l'ok ai sub-responsabili.
 *
 * Nessuna di queste funzioni lancia: un errore del database va nel log (solo id e codici) e la lettura risponde vuoto.
 * Ogni query porta `workspace_id`: uno use case di un altro workspace è «non trovato» (null).
 */
import { sql, type SQL } from "drizzle-orm";
import { factSourceLabel } from "@/lib/context/labels";
import { contextTsQuery } from "@/lib/context/search";
import { contextAbilities, type ContextActor } from "@/lib/context/visibility";
import { CONTEXT_LIMITS, CONTEXT_SECTIONS, type CommitmentParty, type ContextSection, type ContextVisibility, type FactOrigin, type SourceKind, type SourceOrigin } from "@/lib/context/vocab";
import type { AgentContext, AgentFact } from "@/lib/context/work/agent-text";
import { PROMPT_PROFILES, contextPromptBlock, promptBlockNonce, type PromptProfile } from "@/lib/context/work/prompt-block";
import { db } from "@/lib/db";
import { logSafeError } from "@/lib/log/safe-error";
import { romeDate } from "@/lib/uc/calendar";
import { contextAiConsent, contextAiConsentNow } from "./context-consent";
import { FACT_COLUMNS, commitmentViewOf, disputedFacts, factViewOf, questionViewOf, type CommitmentView, type FactRow, type FactView, type QuestionView } from "./context-memory";
import { isUuid, romeToday, rowsOf, toDate, toIsoDate } from "./context-shared";
import { contextStoreReady } from "./context-store";

export type { AgentContext, AgentFact } from "@/lib/context/work/agent-text";
export type { PromptProfile } from "@/lib/context/work/prompt-block";

const LOG_SCOPE = "context/work";
const DAY_MS = 86_400_000;

/** Le sezioni come array di Postgres, per ordinare i fatti nell'ordine fisso della Memoria (`array_position`). */
const SECTION_ORDER = sql`${`{${CONTEXT_SECTIONS.join(",")}}`}::text[]`;

/** Il fatto `f` è legato allo use case (`context_fact_links`), nello stesso workspace. */
function linkedTo(workspaceId: string, useCaseId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM context_fact_links l WHERE l.fact_id = f.id AND l.workspace_id = ${workspaceId}::uuid AND l.use_case_id = ${useCaseId}::uuid)`;
}

/** Lo use case è di questo workspace? Altrimenti per chi chiama non esiste. */
async function workspaceHasUseCase(workspaceId: string, useCaseId: string): Promise<boolean> {
  const rows = rowsOf(await db.execute(sql`SELECT 1 AS ok FROM use_cases WHERE id = ${useCaseId}::uuid AND workspace_id = ${workspaceId}::uuid`));
  return rows.length === 1;
}

/** Le righe di «In breve» del workspace (fatte dei soli fatti «Per tutti» e dei dati della Discovery per tutti). */
async function briefLines(workspaceId: string): Promise<string[]> {
  const [row] = rowsOf<{ lines: unknown }>(await db.execute(sql`SELECT lines FROM context_briefs WHERE workspace_id = ${workspaceId}::uuid`));
  const lines = Array.isArray(row?.lines) ? row.lines : [];
  return lines.filter((line): line is string => typeof line === "string" && line.trim() !== "").slice(0, CONTEXT_LIMITS.briefLines);
}

// ─── La scheda e il dossier (per chi guarda) ─────────────────────────

/** Un fatto della piega «Contesto». `tag`: nato negli ultimi 14 giorni, nuovo o versione nuova di un fatto di prima. */
export interface UseCaseFact extends FactView {
  tag: "nuovo" | "cambiato" | null;
}

/** La piega «Contesto» della scheda e la sezione del dossier. */
export interface UseCaseContext {
  /** Al massimo 40, per sezione e dal più recente; le novità ci sono sempre, fino a 40. */
  facts: UseCaseFact[];
  /** Quanti fatti legati allo use case restano fuori («e altri 12 nel contesto»). */
  more: number;
  /** Quanti fatti legati allo use case sono nati negli ultimi 14 giorni (anche fuori dai 40). */
  novelties: number;
  /** Aperti, con lo use case in `use_case_ids`, per scadenza. */
  commitments: CommitmentView[];
  /** Aperte, con lo use case in `use_case_ids`. */
  questions: QuestionView[];
}

/**
 * Il contesto di uno use case per chi guarda (scheda, dossier): i fatti attivi legati allo use case, gli impegni e le
 * domande aperte che lo nominano. Lateral Space vede anche quelli «Solo Lateral Space» (la pagina mette il lucchetto); il
 * cliente solo «Per tutti». Mai citazioni, mai chi ha confermato. null: archivio non pronto, chi guarda non apre
 * «Contesto», o lo use case non è di questo workspace. Un fatto è «Nuovo» o «Cambiato» se è nato negli ultimi 14 giorni
 * (`created_at`: una riconferma non è una novità).
 */
export async function loadUseCaseContext(actor: ContextActor, useCaseId: string, opts: { now?: Date } = {}): Promise<UseCaseContext | null> {
  const abilities = contextAbilities(actor);
  if (!abilities.canOpen || !isUuid(actor.workspaceId) || !isUuid(useCaseId) || !(await contextStoreReady())) return null;
  const ws = actor.workspaceId;
  const now = opts.now ?? new Date();
  const today = romeToday(now);
  const lateralSpace = abilities.seesLateralSpace;
  try {
    if (!(await workspaceHasUseCase(ws, useCaseId))) return null;
    const fresh = sql`f.created_at >= ${new Date(now.getTime() - CONTEXT_LIMITS.noveltyDays * DAY_MS).toISOString()}::timestamptz`;
    const visible = sql`(${lateralSpace} OR visibility = 'tutti')`;
    const [factRows, commitmentRows, questionRows, disputed] = await Promise.all([
      // Prima le novità (così ci sono sempre), poi per sezione e dal più recente; in pagina si riordina per sezione.
      db.execute(sql`
        SELECT ${FACT_COLUMNS}, (${fresh}) AS fresh, count(*) OVER ()::int AS total, (count(*) FILTER (WHERE ${fresh}) OVER ())::int AS fresh_total
        FROM context_facts f LEFT JOIN context_sources s ON s.id = f.source_id
        WHERE f.workspace_id = ${ws}::uuid AND f.status = 'attivo' AND (${lateralSpace} OR f.visibility = 'tutti') AND ${linkedTo(ws, useCaseId)}
        ORDER BY (${fresh}) DESC, array_position(${SECTION_ORDER}, f.section::text), f.last_confirmed_at DESC, f.id
        LIMIT ${CONTEXT_LIMITS.caseFactsMax}`),
      db.execute(sql`
        SELECT id, version, statement, party, role_label, due_on, visibility FROM context_commitments
        WHERE workspace_id = ${ws}::uuid AND status = 'aperto' AND ${visible} AND ${useCaseId}::uuid = ANY (use_case_ids)
        ORDER BY due_on NULLS LAST, created_at, id LIMIT 50`),
      db.execute(sql`
        SELECT id, version, question, ask_whom, visibility FROM context_questions
        WHERE workspace_id = ${ws}::uuid AND status = 'aperta' AND ${visible} AND ${useCaseId}::uuid = ANY (use_case_ids)
        ORDER BY created_at, id LIMIT 50`),
      lateralSpace ? disputedFacts(ws) : Promise.resolve(new Set<string>()),
    ]);
    const rows = rowsOf<FactRow & { fresh: boolean; total: number; fresh_total: number }>(factRows);
    const order = (section: ContextSection) => CONTEXT_SECTIONS.indexOf(section);
    const facts = rows
      .map((row) => ({ row, view: { ...factViewOf(row, today, disputed), tag: row.fresh === true ? (row.supersedes_id ? "cambiato" : "nuovo") : null } as UseCaseFact }))
      .sort((a, b) => order(a.row.section) - order(b.row.section) || (toDate(b.row.last_confirmed_at)?.getTime() ?? 0) - (toDate(a.row.last_confirmed_at)?.getTime() ?? 0) || (a.row.id < b.row.id ? -1 : 1))
      .map(({ view }) => view);
    const total = Number(rows[0]?.total ?? 0);
    return {
      facts,
      more: Math.max(0, total - facts.length),
      novelties: Number(rows[0]?.fresh_total ?? 0),
      commitments: rowsOf<{ id: string; version: number; statement: string; party: CommitmentParty; role_label: string | null; due_on: unknown; visibility: ContextVisibility }>(commitmentRows).map((row) =>
        commitmentViewOf(row, today),
      ),
      questions: rowsOf<{ id: string; version: number; question: string; ask_whom: string | null; visibility: ContextVisibility }>(questionRows).map(questionViewOf),
    };
  } catch (error) {
    logSafeError(LOG_SCOPE, "contesto_use_case_non_letto", error, { workspaceId: ws, useCaseId });
    return null;
  }
}

// ─── Gli agenti e il pacchetto (solo «Per tutti») ───────────────────

interface AgentFactRow {
  section: ContextSection;
  statement: string;
  origin: FactOrigin;
  last_confirmed_at: unknown;
  source_kind: SourceKind | null;
  source_origin: SourceOrigin | null;
  source_external_id: string | null;
  source_day: unknown;
}

/** Un fatto per gli agenti: la frase, la sezione, il tipo della fonte e il suo giorno (o quello dell'ultima conferma). */
function agentFactOf(row: AgentFactRow, today: string): AgentFact {
  const sourceDay = row.source_day ? toIsoDate(row.source_day) : null;
  const label = factSourceLabel(
    { origin: row.origin, sourceKind: row.source_kind, sourceOrigin: row.source_origin, sourceExternalId: row.source_external_id, sourceOccurredOn: sourceDay },
    today,
  );
  const confirmed = toDate(row.last_confirmed_at);
  return { statement: row.statement, section: row.section, source: label.kind, on: label.day && sourceDay ? sourceDay : confirmed ? romeDate(confirmed) : "" };
}

/**
 * (9b) Il fatto `f` era nel perimetro di `CONTESTO.md` dello use case all'istante `since`: c'era già ed era attivo,
 * «Per tutti», e legato allo use case o nelle sezioni «Regole e vincoli» e «Parole del cliente». Le modifiche sul posto
 * («Modifica» senza un testo nuovo) si leggono nella storia: la prima `visibilita_cambiata` e la prima
 * `sezione_cambiata` dopo `since` dicono com'era il fatto (`da`), la prima `use_case_aggiunto` o `use_case_tolto` per
 * questo use case se era legato; senza storia, com'è adesso (un legame nato dopo `since` non c'era).
 */
function perimeterAt(workspaceId: string, useCaseId: string, since: string): SQL {
  const at = sql`${since}::timestamptz`;
  const firstChange = (action: "visibilita_cambiata" | "sezione_cambiata") => sql`(
    SELECT e.detail->>'da' FROM context_events e
    WHERE e.workspace_id = ${workspaceId}::uuid AND e.fact_id = f.id AND e.action = ${action} AND e.at >= ${at}
    ORDER BY e.at, e.id LIMIT 1)`;
  const linkChange = sql`(
    SELECT e.action FROM context_events e
    WHERE e.workspace_id = ${workspaceId}::uuid AND e.fact_id = f.id AND e.action IN ('use_case_aggiunto', 'use_case_tolto')
      AND e.detail->>'use_case' = ${useCaseId.toLowerCase()} AND e.at >= ${at}
    ORDER BY e.at, e.id LIMIT 1)`;
  const linkedThen = sql`CASE ${linkChange} WHEN 'use_case_tolto' THEN true WHEN 'use_case_aggiunto' THEN false
    ELSE EXISTS (SELECT 1 FROM context_fact_links l WHERE l.fact_id = f.id AND l.workspace_id = ${workspaceId}::uuid AND l.use_case_id = ${useCaseId}::uuid AND l.created_at < ${at}) END`;
  return sql`(f.created_at < ${at} AND (f.status = 'attivo' OR f.ended_at >= ${at})
    AND coalesce(${firstChange("visibilita_cambiata")}, f.visibility) = 'tutti'
    AND (coalesce(${firstChange("sezione_cambiata")}, f.section) IN ('regole', 'parole') OR ${linkedThen}))`;
}

/** Il fatto `f` è adesso nel perimetro di `CONTESTO.md` dello use case: attivo, «Per tutti», legato o tra regole e parole. */
function perimeterNow(workspaceId: string, useCaseId: string): SQL {
  return sql`(f.status = 'attivo' AND f.visibility = 'tutti' AND (f.section IN ('regole', 'parole') OR ${linkedTo(workspaceId, useCaseId)}))`;
}

/**
 * I fatti attivi «Per tutti» per gli agenti, con un filtro: per sezione, poi dal più recente per nascita (`created_at`,
 * che una riconferma non cambia), poi per id. Così `CONTESTO.md` resta uguale finché i fatti non cambiano: una riconferma
 * non fa una versione nuova del pacchetto. Con `since`, solo quelli nuovi o cambiati per chi legge il caso: nati da quella
 * data, o entrati nel perimetro sul posto (allargati a «Per tutti», legati allo use case, spostati tra le regole).
 */
async function agentFacts(workspaceId: string, useCaseId: string, where: SQL, since: string | null, limit: number, today: string): Promise<AgentFact[]> {
  const rows = rowsOf<AgentFactRow>(
    await db.execute(sql`
      SELECT f.section, f.statement, f.origin, f.last_confirmed_at, s.kind AS source_kind, s.origin AS source_origin, s.external_id AS source_external_id, s.occurred_on AS source_day
      FROM context_facts f LEFT JOIN context_sources s ON s.id = f.source_id
      WHERE f.workspace_id = ${workspaceId}::uuid AND f.status = 'attivo' AND f.visibility = 'tutti' AND ${where}
        ${since ? sql`AND (f.created_at >= ${since}::timestamptz OR NOT ${perimeterAt(workspaceId, useCaseId, since)})` : sql``}
      ORDER BY array_position(${SECTION_ORDER}, f.section::text), f.created_at DESC, f.id
      LIMIT ${limit}`),
  );
  return rows.map((row) => agentFactOf(row, today));
}

/**
 * Il perimetro di `CONTESTO.md` (§2.4) dopo `since`, per `--dal`: i fatti «Per tutti» legati allo use case, e quelli delle
 * sezioni «Regole e vincoli» e «Parole del cliente» del workspace. Nuovi: nati da quella data, o entrati nel perimetro
 * sul posto (allargati, legati, spostati tra le regole). Cambiati: le versioni nuove. Tolti: quelli che c'erano e non ci
 * sono più (ritirati, ristretti a «Solo Lateral Space», slegati, spostati fuori). Un fatto nato e tolto dopo `since` non
 * conta: chi legge il caso non l'ha mai visto.
 */
async function perimeterCounts(workspaceId: string, useCaseId: string, since: string): Promise<{ added: number; changed: number; retired: number }> {
  const after = sql`${since}::timestamptz`;
  const now = perimeterNow(workspaceId, useCaseId);
  const then = perimeterAt(workspaceId, useCaseId, since);
  const [row] = rowsOf<{ added: number; changed: number; retired: number }>(
    await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE ${now} AND CASE WHEN f.created_at >= ${after} THEN f.supersedes_id IS NULL ELSE NOT ${then} END)::int AS added,
        count(*) FILTER (WHERE ${now} AND f.created_at >= ${after} AND f.supersedes_id IS NOT NULL)::int AS changed,
        count(*) FILTER (WHERE f.status <> 'superato' AND ${then} AND NOT ${now})::int AS retired
      FROM context_facts f
      WHERE f.workspace_id = ${workspaceId}::uuid AND (f.status = 'attivo' OR f.ended_at >= ${after})`),
  );
  return { added: Number(row?.added ?? 0), changed: Number(row?.changed ?? 0), retired: Number(row?.retired ?? 0) };
}

/** Un istante valido come ISO, o null. */
const isoOf = (value: Date | null | undefined): string | null => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null);

/**
 * Il contesto di un caso per gli agenti e per il pacchetto: **sempre e solo «Per tutti»** (D1), qualunque sia chi chiede;
 * mai citazioni, mai nomi di chi ha confermato. Chi chiama ha già controllato chi legge il caso (la rotta della CLI,
 * l'MCP del caso, chi genera il pacchetto). Con `since`: nei fatti solo quelli nuovi o cambiati da quella data (anche
 * sul posto: allargati, legati), e i conti di nuovi, cambiati e tolti (anche ristretti e slegati). null senza archivio o
 * con uno use case di un altro workspace.
 */
export async function loadAgentContext(i: { workspaceId: string; useCaseId: string; since?: Date | null; now?: Date }): Promise<AgentContext | null> {
  if (!isUuid(i.workspaceId) || !isUuid(i.useCaseId) || !(await contextStoreReady())) return null;
  const ws = i.workspaceId;
  const today = romeToday(i.now ?? new Date());
  const since = isoOf(i.since);
  try {
    if (!(await workspaceHasUseCase(ws, i.useCaseId))) return null;
    const linked = linkedTo(ws, i.useCaseId);
    const [brief, caseFacts, rules, words, commitmentRows, questionRows, counts] = await Promise.all([
      briefLines(ws),
      agentFacts(ws, i.useCaseId, linked, since, CONTEXT_LIMITS.caseFactsMax, today),
      agentFacts(ws, i.useCaseId, sql`f.section = 'regole' AND NOT ${linked}`, since, CONTEXT_LIMITS.agentRulesMax, today),
      agentFacts(ws, i.useCaseId, sql`f.section = 'parole' AND NOT ${linked}`, since, CONTEXT_LIMITS.agentWordsMax, today),
      db.execute(sql`
        SELECT statement, party, role_label, due_on FROM context_commitments
        WHERE workspace_id = ${ws}::uuid AND status = 'aperto' AND visibility = 'tutti' AND ${i.useCaseId}::uuid = ANY (use_case_ids)
        ORDER BY due_on NULLS LAST, created_at, id LIMIT 50`),
      db.execute(sql`
        SELECT question, ask_whom FROM context_questions
        WHERE workspace_id = ${ws}::uuid AND status = 'aperta' AND visibility = 'tutti' AND ${i.useCaseId}::uuid = ANY (use_case_ids)
        ORDER BY created_at, id LIMIT 50`),
      since ? perimeterCounts(ws, i.useCaseId, since) : Promise.resolve(null),
    ]);
    return {
      brief,
      caseFacts,
      rules,
      words,
      commitments: rowsOf<{ statement: string; party: CommitmentParty; role_label: string | null; due_on: unknown }>(commitmentRows).map((row) => ({
        statement: row.statement,
        party: row.party,
        role: row.role_label,
        dueOn: row.due_on ? toIsoDate(row.due_on) : null,
      })),
      questions: rowsOf<{ question: string; ask_whom: string | null }>(questionRows).map((row) => ({ question: row.question, askWhom: row.ask_whom })),
      since: since && counts ? { from: romeDate(new Date(since)), added: counts.added, changed: counts.changed, retired: counts.retired } : null,
    };
  } catch (error) {
    logSafeError(LOG_SCOPE, "contesto_agenti_non_letto", error, { workspaceId: ws, useCaseId: i.useCaseId });
    return null;
  }
}

// ─── I prompt (solo «Per tutti», solo con l'ok) ──────────────────────

/**
 * Il blocco «Contesto» per un prompt (§2.12): le righe di «In breve» e i fatti «Per tutti» del profilo (per la chat, quelli
 * con le parole dell'ultimo messaggio, `query`). Pronto da accodare al contesto di un prompt: comincia e finisce con un a
 * capo. "" senza l'ok ai sub-responsabili (`consent: "request"` lo legge una volta per richiesta, `"now"` lo rilegge, per
 * i cron), senza archivio o senza niente da dire. Non lancia.
 */
export async function loadPromptContext(workspaceId: string, i: { profile: PromptProfile; query?: string; consent: "request" | "now" }): Promise<string> {
  const rule = PROMPT_PROFILES[i.profile];
  if (!rule || !isUuid(workspaceId)) return "";
  try {
    const consent = i.consent === "now" ? await contextAiConsentNow(workspaceId) : await contextAiConsent(workspaceId);
    if (!consent || !(await contextStoreReady())) return "";
    const ws = workspaceId;
    const sections = `{${rule.sections.join(",")}}`;
    let facts: Array<{ section: ContextSection; statement: string }> = [];
    if (rule.facts > 0 && rule.sections.length > 0) {
      if (rule.byQuery) {
        const query = contextTsQuery(i.query ?? "");
        if (query) {
          const q = sql`to_tsquery('italian', ${query})`;
          facts = rowsOf<{ section: ContextSection; statement: string }>(
            await db.execute(sql`
              SELECT section, statement FROM context_facts
              WHERE workspace_id = ${ws}::uuid AND status = 'attivo' AND visibility = 'tutti' AND section = ANY (${sections}::text[])
                AND to_tsvector('italian', statement) @@ ${q}
              ORDER BY ts_rank_cd(to_tsvector('italian', statement), ${q}) DESC, last_confirmed_at DESC, id
              LIMIT ${rule.facts}`),
          );
        }
      } else {
        // I più recenti tra le sezioni del profilo, poi nell'ordine delle sezioni del profilo.
        const rows = rowsOf<{ section: ContextSection; statement: string }>(
          await db.execute(sql`
            SELECT section, statement FROM context_facts
            WHERE workspace_id = ${ws}::uuid AND status = 'attivo' AND visibility = 'tutti' AND section = ANY (${sections}::text[])
            ORDER BY last_confirmed_at DESC, id
            LIMIT ${rule.facts}`),
        );
        facts = rows.map((row, index) => ({ row, index })).sort((a, b) => rule.sections.indexOf(a.row.section) - rule.sections.indexOf(b.row.section) || a.index - b.index).map(({ row }) => row);
      }
    }
    const brief = rule.brief ? await briefLines(ws) : [];
    const nonce = promptBlockNonce([...brief, ...facts.map((fact) => fact.statement)].join("\n"));
    const block = contextPromptBlock({ brief, facts, nonce, purpose: i.profile === "chat" ? "chat" : "generatore" });
    return block ? `\n${block}\n` : "";
  } catch (error) {
    logSafeError(LOG_SCOPE, "blocco_prompt_non_letto", error, { workspaceId, profilo: i.profile });
    return "";
  }
}
