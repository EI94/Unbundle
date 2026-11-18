import "server-only";
/**
 * La lettura di una fonte (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.4.4, §4.2): il modello legge una
 * parte di un appunto (o il testo di un documento) contro la memoria di oggi e propone che cosa cambia. Le proposte
 * passano dalle regole di `reconcile.ts` e si salvano in `context_proposals`: in memoria entra solo ciò che una persona
 * conferma (`confirmProposals`).
 *
 * Nell'ordine: archivio pronto; la fonte; senza testo niente modello; l'ok ai sub-responsabili (`contextAiConsent`);
 * presa in carico (una richiesta sola legge una fonte, per 180 secondi); limite del giorno (200 letture per workspace,
 * fuso di Roma, contato solo quando la chiamata parte); memoria di oggi; chiamata `contextRead`; regole; proposte e
 * stato in una transazione; evento `fonte_letta`.
 *
 * (9b, RILASCIO-9b-COSTRUZIONE.md §2.11) Una fonte `risposta` (le risposte di un referente) non ha un testo salvato: si
 * compone adesso dalle risposte inviate (`readAnswersSource`), il prompt parla di risposte, e ogni proposta si lega allo
 * use case della richiesta. È una fonte del cliente: il prompt non riceve i fatti «Solo Lateral Space» e le proposte non
 * sono mai preselezionate.
 * (9b, §2.2) Gli appunti e i documenti si leggono con le richieste aperte di «Cosa serve» (al massimo 50, le più recenti):
 * un fatto che ne chiude una nasce con un legame `proposta` (`context_need_links`), che la conferma apre o scarta. Solo
 * con la 0041; mai per le risposte di un referente, che passano già dalla loro strada.
 *
 * Non lancia: ogni esito è nel risultato. Nei log solo id, codici e numeri: mai un testo.
 */
import { sql } from "drizzle-orm";
import { ClaudeRefusalError, CONTEXT_NIGHTLY_READ_TIMEOUT_MS, CONTEXT_READ_TIMEOUT_MS, logClaudeTimeout, stoppedByDeadline } from "@/lib/ai/models";
import { consumeRateLimits, rateLimitBucket } from "@/lib/connector/rate-limit";
import { liveLines } from "@/lib/context/live";
import { generateContextRead } from "@/lib/context/read/generate";
import { buildReadPrompt, readNonce, untrustedPromptText } from "@/lib/context/read/prompt";
import { addSkipped, reconcile, type DraftProposal } from "@/lib/context/read/reconcile";
import { splitForReading } from "@/lib/context/read/split";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { OPEN_NEED_STATUSES } from "@/lib/context/work/need-links";
import { isClientSource, type ContextActor } from "@/lib/context/visibility";
import { CONTEXT_LIMITS, type ContextChannel, type ContextSection, type ContextVisibility, type ReadReason, type ReadStatus, type SkippedCounts, type SourceKind, type SourceOrigin } from "@/lib/context/vocab";
import { db } from "@/lib/db";
import { contextProposals } from "@/lib/db/schema";
import { CLIENT_SIDE_SQL } from "@/lib/db/use-case-hub-referents-ddl";
import { logSafeError } from "@/lib/log/safe-error";
import { isEmailVerifiedValue, isLateralSpaceEmail, parseLsDomains } from "@/lib/uc/lateral-space";
import type { ServiceResult } from "@/lib/use-cases/types";
import { contextAiConsent, contextAiConsentNow } from "./context-consent";
import { loadLiveDiscovery } from "./context-discovery";
import { readAnswersSource } from "./context-referent";
import { CONTEXT_DAY_TIME_ZONE, contextRateLimitExec, ctxErrorCode, eventStatement, gate, invalid, isUuid, notFound, ok, requireSql, retry, romeToday, rowsOf, toIsoDate, toUuidArray } from "./context-shared";
import { contextStoreReady, contextWorkReady } from "./context-store";
import { getWorkspaceById } from "./workspaces";

const LOG_SCOPE = "context/read";

export type ReadOutcome =
  | { status: "letto"; proposals: number; skipped: SkippedCounts }
  | { status: "in_corso"; partsRead: number; partsTotal: number } // restano parti: richiamare
  | { status: "ok_mancante" } // l'appunto resta `da_leggere` con `read_reason = 'ok_mancante'`
  | { status: "in_lettura" } // un'altra richiesta lo sta leggendo
  | { status: "rifiuto" } // `non_letto`: non si riprova da soli
  | { status: "tempo" } // torna `da_leggere`
  | { status: "errore" } // torna `da_leggere`; al terzo tentativo `non_letto`
  | { status: "limite" }; // 200 letture al giorno per workspace

/** Chi legge: una persona di Lateral Space, oppure il giro della notte (senza persona: gli eventi non hanno attore). */
interface Reader {
  workspaceId: string;
  channel: ContextChannel;
  actorUserId: string | null;
  /** Per i dati della Discovery nel prompt: il ruolo di chi legge. */
  viewer: Pick<ContextActor, "role" | "isLateralSpace">;
  /** Come si controlla l'ok: una lettura per richiesta, oppure riletto ogni volta (la notte). */
  consent: (workspaceId: string) => Promise<boolean>;
}

interface ReadOptions {
  timeoutMs?: number;
  again?: boolean;
  now?: Date;
}

interface SourceRow {
  id: string;
  kind: SourceKind;
  /** (9b) Da dove è entrata, e il suo id esterno: per una fonte `risposta`, l'id della richiesta del referente. */
  origin: SourceOrigin;
  external_id: string | null;
  visibility: ContextVisibility;
  /** L'e-mail di chi ha aggiunto la fonte, e se è verificata: per sapere se un documento l'ha caricato Lateral Space. */
  added_by_email: string | null;
  added_by_verified: unknown;
  title: string;
  occurred_on: unknown;
  body: string | null;
  document_text: string | null;
  read_status: ReadStatus;
  read_reason: ReadReason | null;
  read_attempts: number;
  lease_fresh: boolean;
  parts_read: number;
  skipped: unknown;
  purged: boolean;
}

const skippedOf = (value: unknown): SkippedCounts => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as SkippedCounts) : {});

async function loadSource(workspaceId: string, sourceId: string): Promise<SourceRow | null> {
  const rows = rowsOf<SourceRow>(
    await db.execute(sql`
      SELECT s.id, s.kind, s.origin, s.external_id, s.visibility, u.email AS added_by_email, u.email_verified AS added_by_verified, s.title, s.occurred_on, s.body,
        d.extracted_text AS document_text, s.read_status, s.read_reason, s.read_attempts,
        (s.read_started_at IS NOT NULL AND s.read_started_at > now() - make_interval(secs => ${CONTEXT_LIMITS.readLeaseSeconds})) AS lease_fresh,
        s.parts_read, s.skipped, (s.text_purged_at IS NOT NULL) AS purged
      FROM context_sources s LEFT JOIN uploaded_documents d ON d.id = s.document_id LEFT JOIN users u ON u.id = s.added_by_user_id
      WHERE s.id = ${sourceId}::uuid AND s.workspace_id = ${workspaceId}::uuid`),
  );
  return rows[0] ?? null;
}

/** La fonte l'ha scritta il cliente (`isClientSource`): un documento che non è un appunto caricato da Lateral Space. */
function fromClient(source: Pick<SourceRow, "kind" | "visibility" | "added_by_email" | "added_by_verified">): boolean {
  const addedByLateralSpace = isLateralSpaceEmail({ email: source.added_by_email, emailVerified: isEmailVerifiedValue(source.added_by_verified) }, parseLsDomains(process.env.UC_LS_EMAIL_DOMAINS));
  return isClientSource({ kind: source.kind, visibility: source.visibility, addedByLateralSpace });
}

async function openProposalCount(workspaceId: string, sourceId: string): Promise<number> {
  const rows = rowsOf<{ n: number }>(
    await db.execute(sql`SELECT count(*)::int AS n FROM context_proposals WHERE source_id = ${sourceId}::uuid AND workspace_id = ${workspaceId}::uuid AND status = 'aperta'`),
  );
  return Number(rows[0]?.n ?? 0);
}

/** Lo stato di una fonte non in lettura, come esito. */
async function settledOutcome(workspaceId: string, source: SourceRow): Promise<ReadOutcome> {
  if (source.read_status === "non_letto") {
    if (source.read_reason === "rifiuto") return { status: "rifiuto" };
    if (source.read_reason === "vuoto") return { status: "letto", proposals: 0, skipped: {} };
    return { status: source.read_reason === "tempo" ? "tempo" : "errore" };
  }
  return { status: "letto", proposals: await openProposalCount(workspaceId, source.id), skipped: skippedOf(source.skipped) };
}

/** La presa in carico: una richiesta sola legge una fonte, per 180 secondi. Restituisce il suo segno, o null. */
async function claim(workspaceId: string, sourceId: string): Promise<{ lease: string; attempt: number } | null> {
  const rows = rowsOf<{ lease: string; read_attempts: number }>(
    await db.execute(sql`
      UPDATE context_sources SET read_status = 'in_lettura', read_started_at = clock_timestamp(), read_attempts = read_attempts + 1, updated_at = now()
      WHERE id = ${sourceId}::uuid AND workspace_id = ${workspaceId}::uuid AND text_purged_at IS NULL
        AND (read_status = 'da_leggere' OR (read_status = 'in_lettura' AND read_started_at < now() - make_interval(secs => ${CONTEXT_LIMITS.readLeaseSeconds})))
      RETURNING read_started_at::text AS lease, read_attempts`),
  );
  return rows[0] ? { lease: rows[0].lease, attempt: Number(rows[0].read_attempts) } : null;
}

/** Lascia la presa in carico con uno stato e un motivo, solo se è ancora la sua. `uncount`: il tentativo non conta. */
async function release(workspaceId: string, sourceId: string, lease: string, status: ReadStatus, reason: ReadReason | null, uncount = false): Promise<void> {
  await db.execute(sql`
    UPDATE context_sources SET read_status = ${status}, read_reason = ${reason}, read_started_at = NULL, updated_at = now(),
      read_attempts = greatest(0, read_attempts - ${uncount ? 1 : 0})
    WHERE id = ${sourceId}::uuid AND workspace_id = ${workspaceId}::uuid AND read_status = 'in_lettura' AND read_started_at = ${lease}::timestamptz`);
}

interface ReadMemory {
  clientName: string;
  facts: Array<{ ref: string; id: string; section: ContextSection; visibility: ContextVisibility; statement: string }>;
  live: string[];
  useCases: Array<{ code: string; id: string; title: string }>;
  units: Array<{ ref: string; id: string; name: string }>;
  goals: Array<{ ref: string; id: string; title: string }>;
  questions: Array<{ ref: string; id: string; question: string }>;
  commitments: string[];
  already: string[];
  editedQuotes: string[];
  /** I fatti «Solo Lateral Space» attivi, anche quelli fuori dal prompt: per le regole, mai per il modello. */
  lsFacts: Array<{ id: string; statement: string }>;
  /** (9b) Le richieste aperte di «Cosa serve» (R1, R2…): `useCase` sono i codici dei suoi use case, per il prompt. */
  needs: Array<{ ref: string; id: string; useCaseIds: string[]; useCase: string; title: string }>;
  lastPosition: number;
}

/**
 * (9b) Le richieste aperte di «Cosa serve» a cui una call o un documento può rispondere: requisiti non archiviati, dal lato
 * del cliente («Chi» cliente, insieme o vuoto), in uno stato aperto, legati ad almeno uno use case. Al massimo 50, le più
 * recenti.
 */
function openNeedsQuery(workspaceId: string) {
  return db.execute(sql`
    SELECT n.id, n.title,
      array_agg(l.use_case_id::text ORDER BY u.code NULLS LAST, l.use_case_id) AS use_case_ids,
      string_agg(coalesce(u.code, u.title), ', ' ORDER BY u.code NULLS LAST, l.use_case_id) AS use_cases
    FROM use_case_needs n
    JOIN use_case_need_links l ON l.need_id = n.id
    JOIN use_cases u ON u.id = l.use_case_id AND u.workspace_id = n.workspace_id
    WHERE n.workspace_id = ${workspaceId}::uuid AND n.type = 'requisito' AND n.archived_at IS NULL AND ${sql.raw(CLIENT_SIDE_SQL("n"))}
      AND n.status = ANY(${`{${OPEN_NEED_STATUSES.join(",")}}`}::text[])
    GROUP BY n.id, n.title, n.created_at
    ORDER BY n.created_at DESC, n.id
    LIMIT ${CONTEXT_LIMITS.needsInPrompt}`);
}

/**
 * La memoria di oggi e gli elenchi per il prompt, con i loro riferimenti (F1, U1, O1, D1, R1). `clientSource`: la fonte
 * l'ha scritta il cliente, e il prompt non riceve i fatti, gli impegni e le domande «Solo Lateral Space». `withNeeds`: le
 * richieste aperte di «Cosa serve» (con la 0041, mai per le risposte di un referente).
 */
async function loadReadMemory(reader: Reader, sourceId: string, clientSource: boolean, withNeeds: boolean): Promise<ReadMemory | null> {
  const ws = reader.workspaceId;
  const workspace = await getWorkspaceById(ws);
  if (!workspace) return null;
  const L = CONTEXT_LIMITS;
  const shared = sql`(${!clientSource} OR visibility = 'tutti')`;
  const [facts, useCases, units, goals, questions, commitments, already, live, lsFacts, needs] = await Promise.all([
    db.execute(sql`
      SELECT id, section, visibility, statement, count(*) OVER ()::int AS total FROM context_facts
      WHERE workspace_id = ${ws}::uuid AND status = 'attivo' AND ${shared}
      ORDER BY last_confirmed_at DESC, id LIMIT ${L.memoryFactsInPrompt}`),
    db.execute(sql`
      SELECT id, code, title FROM use_cases
      WHERE workspace_id = ${ws}::uuid AND code IS NOT NULL
      ORDER BY created_at DESC, id LIMIT ${L.useCasesInPrompt}`),
    db.execute(sql`SELECT id, name FROM departments WHERE workspace_id = ${ws}::uuid ORDER BY name, id LIMIT 100`),
    db.execute(sql`SELECT id, title FROM strategic_goals WHERE workspace_id = ${ws}::uuid ORDER BY created_at, id LIMIT 100`),
    db.execute(sql`
      SELECT id, question FROM context_questions
      WHERE workspace_id = ${ws}::uuid AND status = 'aperta' AND ${shared} ORDER BY created_at DESC, id LIMIT ${L.openItemsInPrompt}`),
    db.execute(sql`
      SELECT statement FROM context_commitments
      WHERE workspace_id = ${ws}::uuid AND status = 'aperto' AND ${shared} ORDER BY created_at DESC, id LIMIT ${L.openItemsInPrompt}`),
    // Le proposte di questi appunti, prima quelle decise o ancora aperte; la posizione più alta tra tutte.
    db.execute(sql`
      SELECT statement, quote, edited, status, (max(position) OVER ())::int AS last_position FROM context_proposals
      WHERE source_id = ${sourceId}::uuid AND workspace_id = ${ws}::uuid ORDER BY (status = 'superata'), position LIMIT 500`),
    loadLiveDiscovery(workspace, reader.viewer),
    db.execute(sql`
      SELECT id, statement FROM context_facts
      WHERE workspace_id = ${ws}::uuid AND status = 'attivo' AND visibility = 'ls' ORDER BY last_confirmed_at DESC, id LIMIT 5000`),
    withNeeds ? openNeedsQuery(ws) : Promise.resolve({ rows: [] }),
  ]);
  const factRows = rowsOf<{ id: string; section: ContextSection; visibility: ContextVisibility; statement: string; total: number }>(facts);
  const total = Number(factRows[0]?.total ?? 0);
  if (total > L.memoryFactsInPrompt) console.warn(`[${LOG_SCOPE}] memoria_troncata`, JSON.stringify({ workspaceId: ws, fatti: total }));
  const alreadyRows = rowsOf<{ statement: string; quote: string | null; edited: boolean; status: string; last_position: number }>(already);
  const decidedOrOpen = alreadyRows.filter((a) => a.status !== "superata");
  return {
    clientName: workspace.name,
    facts: factRows.map((f, i) => ({ ref: `F${i + 1}`, id: f.id, section: f.section, visibility: f.visibility, statement: f.statement })),
    live: liveLines(live),
    useCases: rowsOf<{ id: string; code: string; title: string }>(useCases).map((u) => ({ id: u.id, code: u.code, title: u.title })),
    units: rowsOf<{ id: string; name: string }>(units).map((u, i) => ({ ref: `U${i + 1}`, id: u.id, name: u.name })),
    goals: rowsOf<{ id: string; title: string }>(goals).map((g, i) => ({ ref: `O${i + 1}`, id: g.id, title: g.title })),
    questions: rowsOf<{ id: string; question: string }>(questions).map((q, i) => ({ ref: `D${i + 1}`, id: q.id, question: q.question })),
    commitments: rowsOf<{ statement: string }>(commitments).map((c) => c.statement),
    // «Già proposto»: le frasi confermate, scartate o ancora aperte (anche quelle corrette e non ancora confermate, che
    // «Rileggi» e una call cambiata lasciano aperte). Le superate no: le ha tolte «Rileggi» o una call cambiata su
    // Granola, senza che nessuno le decidesse; se il testo le dice ancora, devono tornare.
    already: decidedOrOpen.map((a) => a.statement),
    // Di una proposta corretta dalla persona resta la citazione: il modello la ritroverebbe con la sua frase di prima.
    editedQuotes: decidedOrOpen.flatMap((a) => (a.edited === true && a.quote ? [a.quote] : [])),
    lsFacts: rowsOf<{ id: string; statement: string }>(lsFacts),
    needs: rowsOf<{ id: string; title: string; use_case_ids: unknown; use_cases: string | null }>(needs).map((n, i) => ({
      ref: `R${i + 1}`,
      id: n.id,
      useCaseIds: toUuidArray(n.use_case_ids),
      useCase: n.use_cases ?? "",
      title: n.title,
    })),
    lastPosition: Number(alreadyRows[0]?.last_position ?? 0),
  };
}

/**
 * «Rileggi»: l'appunto torna `da_leggere` dalla prima parte e le proposte aperte diventano `superata`, tranne quelle
 * che la persona ha corretto (restano aperte, e la lettura non ripropone il loro passaggio). Non tocca una lettura in
 * corso.
 */
async function resetForRereading(workspaceId: string, sourceId: string): Promise<void> {
  const reset = sql`EXISTS (SELECT 1 FROM context_sources x WHERE x.id = ${sourceId}::uuid AND x.read_status = 'da_leggere' AND x.updated_at = now())`;
  await db.batch([
    db.execute(sql`
      UPDATE context_sources SET read_status = 'da_leggere', read_reason = NULL, read_attempts = 0, read_started_at = NULL, read_at = NULL,
        parts_read = 0, skipped = '{}'::jsonb, updated_at = now()
      WHERE id = ${sourceId}::uuid AND workspace_id = ${workspaceId}::uuid AND text_purged_at IS NULL
        AND NOT (read_status = 'in_lettura' AND read_started_at > now() - make_interval(secs => ${CONTEXT_LIMITS.readLeaseSeconds}))`),
    db.execute(sql`
      UPDATE context_proposals SET status = 'superata', decided_at = now(), updated_at = now(), version = version + 1
      WHERE source_id = ${sourceId}::uuid AND workspace_id = ${workspaceId}::uuid AND status = 'aperta' AND NOT edited AND ${reset}`),
  ]);
}

/**
 * Le proposte di una parte e il nuovo stato della fonte, in una transazione, solo se la presa in carico è ancora la sua.
 * (9b) Con `needLinks`, un fatto che risponde a una richiesta di «Cosa serve» nasce con il suo legame `proposta`: gli id
 * delle proposte si generano qui, prima, e il legame vale solo per un'esigenza di questo workspace.
 */
async function saveReading(
  reader: Reader,
  sourceId: string,
  lease: string,
  drafts: readonly DraftProposal[],
  state: { lastPosition: number; partsRead: number; partsTotal: number; skipped: SkippedCounts; overCap: number; needLinks: boolean },
): Promise<void> {
  const ws = reader.workspaceId;
  const finished = state.partsRead >= state.partsTotal;
  const rows = drafts.map((draft, index) => ({
    id: crypto.randomUUID(),
    workspaceId: ws,
    sourceId,
    position: state.lastPosition + index + 1,
    kind: draft.kind,
    statement: draft.statement,
    quote: draft.quote,
    basis: draft.basis,
    section: draft.section,
    visibility: draft.visibility,
    targetFactId: draft.targetFactId,
    questionId: draft.questionId,
    useCaseIds: draft.useCaseIds,
    party: draft.party,
    roleLabel: draft.roleLabel,
    dueOn: draft.dueOn,
    entities: draft.entities,
    relations: draft.relations,
    issue: draft.issue,
  }));
  const links = state.needLinks ? drafts.flatMap((draft, index) => (draft.needId && isUuid(draft.needId) ? [{ need_id: draft.needId, proposal_id: rows[index].id }] : [])) : [];
  await db.batch([
    // Prima lo stato della fonte: l'UPDATE prende la riga e vale solo con la nostra presa. Se non la tocca, tutto si annulla.
    db.execute(sql`
      WITH done AS (
        UPDATE context_sources SET read_status = ${finished ? "letto" : "da_leggere"}, read_reason = NULL, read_attempts = 0, read_started_at = NULL,
          read_at = CASE WHEN ${finished} THEN now() ELSE read_at END, parts_read = ${state.partsRead}, parts_total = ${state.partsTotal},
          skipped = ${JSON.stringify(state.skipped)}::jsonb, updated_at = now()
        WHERE id = ${sourceId}::uuid AND workspace_id = ${ws}::uuid AND read_status = 'in_lettura' AND read_started_at = ${lease}::timestamptz
        RETURNING id
      )
      ${requireSql(sql`(SELECT count(*) FROM done) = 1`, "presa_persa")}`),
    ...(rows.length > 0 ? [db.insert(contextProposals).values(rows)] : []),
    ...(links.length > 0
      ? [
          db.execute(sql`
            INSERT INTO context_need_links (workspace_id, need_id, proposal_id, status)
            SELECT ${ws}::uuid, x.need_id, x.proposal_id, 'proposta'
            FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS x(need_id uuid, proposal_id uuid)
            JOIN use_case_needs n ON n.id = x.need_id AND n.workspace_id = ${ws}::uuid
            ON CONFLICT DO NOTHING`),
        ]
      : []),
    eventStatement({
      workspaceId: ws,
      action: "fonte_letta",
      channel: reader.channel,
      actorUserId: reader.actorUserId,
      sourceId,
      detail: { proposte: rows.length, parte: state.partsRead, parti: state.partsTotal, oltre_il_tetto: state.overCap, ...(links.length > 0 ? { richieste: links.length } : {}) },
    }),
  ]);
}

/** La lettura di una parte, per chi ha già il permesso (una persona di Lateral Space, o la notte). */
async function readSource(reader: Reader, sourceId: string, opts: ReadOptions): Promise<ServiceResult<ReadOutcome>> {
  const ws = reader.workspaceId;
  let held: { lease: string; attempt: number } | null = null;
  try {
    let source = await loadSource(ws, sourceId);
    if (!source) return notFound();
    // Dopo i 12 mesi il testo non c'è più: non si legge.
    if (source.purged) return invalid({}, CONTEXT_TEXT.notes.purged);
    if (opts.again) {
      if (source.read_status === "in_lettura" && source.lease_fresh) return ok({ status: "in_lettura" });
      await resetForRereading(ws, sourceId);
      source = (await loadSource(ws, sourceId)) ?? source;
    }
    if (source.read_status === "in_lettura" && source.lease_fresh) return ok({ status: "in_lettura" });
    if (source.read_status === "letto" || source.read_status === "non_letto") return ok(await settledOutcome(ws, source));

    // (9b) Le risposte di un referente: il testo si compone adesso dalle risposte inviate, e non si salva mai.
    const answers = source.kind === "risposta" ? await readAnswersSource(ws, source.external_id) : null;
    // Senza testo niente modello: la fonte resta com'è, segnata «non letta».
    const text = (source.kind === "documento" ? source.document_text : answers ? answers.text : source.body) ?? "";
    if (!text.trim()) {
      await db.execute(sql`
        UPDATE context_sources SET read_status = 'non_letto', read_reason = 'vuoto', read_started_at = NULL, updated_at = now()
        WHERE id = ${sourceId}::uuid AND workspace_id = ${ws}::uuid AND read_status IN ('da_leggere', 'in_lettura')`);
      return ok({ status: "letto", proposals: 0, skipped: {} });
    }

    // L'ok ai sub-responsabili, subito prima del modello. Senza: l'appunto resta salvato e cercabile, e il tentativo non conta.
    if (!(await reader.consent(ws))) {
      await db.execute(sql`
        UPDATE context_sources SET read_reason = 'ok_mancante', updated_at = now()
        WHERE id = ${sourceId}::uuid AND workspace_id = ${ws}::uuid AND read_status = 'da_leggere'`);
      return ok({ status: "ok_mancante" });
    }

    held = await claim(ws, sourceId);
    if (!held) {
      const now = await loadSource(ws, sourceId);
      if (!now) return notFound();
      if (now.read_status === "in_lettura" || now.read_status === "da_leggere") return ok({ status: "in_lettura" });
      return ok(await settledOutcome(ws, now));
    }
    const lease = held.lease;

    // Il limite del giorno si conta solo adesso, quando la chiamata sta per partire.
    const limit = await consumeRateLimits(
      contextRateLimitExec,
      [{ bucket: rateLimitBucket("ctx", "ws", ws, "read", "day"), window: "day", limit: CONTEXT_LIMITS.readsPerDayWorkspace, timeZone: CONTEXT_DAY_TIME_ZONE }],
      opts.now ? { at: opts.now } : {},
    );
    if (!limit.ok) {
      await release(ws, sourceId, lease, "da_leggere", "limite", true);
      return ok({ status: "limite" });
    }

    // (9b) Le richieste aperte di «Cosa serve»: solo con la 0041, mai per le risposte di un referente.
    const withNeeds = source.kind !== "risposta" && (await contextWorkReady());
    const memory = await loadReadMemory(reader, sourceId, fromClient(source), withNeeds);
    if (!memory) {
      await release(ws, sourceId, lease, "da_leggere", null, true);
      return notFound();
    }
    const parts = splitForReading(text);
    const index = Math.max(0, Math.min(Number(source.parts_read), parts.length - 1));
    const part = parts[index];
    const { system, prompt } = buildReadPrompt({
      sourceKind: source.kind === "risposta" ? "risposta" : source.kind === "documento" ? "documento" : "appunti",
      clientName: memory.clientName,
      today: romeToday(opts.now),
      occurredOn: toIsoDate(source.occurred_on),
      title: source.title,
      text: part,
      part: { index: index + 1, total: parts.length },
      facts: memory.facts,
      live: memory.live,
      useCases: memory.useCases,
      units: memory.units,
      goals: memory.goals,
      questions: memory.questions,
      commitments: memory.commitments,
      already: memory.already,
      needs: memory.needs.map((n) => ({ ref: n.ref, useCase: n.useCase, title: n.title })),
      nonce: readNonce(untrustedPromptText({ title: source.title, text: part, useCases: memory.useCases, questions: memory.questions, needs: memory.needs })),
    });

    const timeoutMs = opts.timeoutMs ?? CONTEXT_READ_TIMEOUT_MS;
    const abortSignal = AbortSignal.timeout(timeoutMs);
    let output;
    try {
      output = await generateContextRead({ system, prompt, abortSignal, workspaceId: ws });
    } catch (error) {
      // Un rifiuto è già nel log (throwIfRefused): non si riprova da soli.
      if (error instanceof ClaudeRefusalError) {
        await release(ws, sourceId, lease, "non_letto", "rifiuto");
        return ok({ status: "rifiuto" });
      }
      const timedOut = stoppedByDeadline(error, abortSignal);
      if (timedOut) logClaudeTimeout(LOG_SCOPE, { timeoutMs, tentativo: held.attempt });
      else logSafeError(LOG_SCOPE, "lettura_non_riuscita", error, { workspaceId: ws, sourceId, tentativo: held.attempt });
      // Al terzo tentativo la fonte resta «non letta»: la notte non la riprova all'infinito.
      const last = held.attempt >= CONTEXT_LIMITS.readAttemptsMax;
      await release(ws, sourceId, lease, last ? "non_letto" : "da_leggere", timedOut ? "tempo" : "errore");
      return ok({ status: timedOut ? "tempo" : "errore" });
    }

    const reconciled = reconcile({
      output,
      sourceText: text,
      facts: memory.facts,
      questions: memory.questions,
      useCases: memory.useCases,
      units: memory.units,
      goals: memory.goals,
      already: memory.already,
      editedQuotes: memory.editedQuotes,
      lsFacts: memory.lsFacts,
      // (9b) Le risposte di un referente toccano lo use case della sua richiesta: ogni proposta ci si lega.
      sourceUseCaseIds: answers?.useCaseId ? [answers.useCaseId] : [],
      needs: memory.needs,
      occurredOn: toIsoDate(source.occurred_on),
    });
    if (reconciled.overCap > 0) console.warn(`[${LOG_SCOPE}] proposte_oltre_il_tetto`, JSON.stringify({ workspaceId: ws, sourceId, oltre: reconciled.overCap }));
    const skipped = addSkipped(index === 0 ? {} : skippedOf(source.skipped), reconciled.skipped);
    const partsRead = index + 1;
    await saveReading(reader, sourceId, lease, reconciled.proposals, { lastPosition: memory.lastPosition, partsRead, partsTotal: parts.length, skipped, overCap: reconciled.overCap, needLinks: withNeeds });
    held = null;
    if (partsRead < parts.length) return ok({ status: "in_corso", partsRead, partsTotal: parts.length });
    return ok({ status: "letto", proposals: await openProposalCount(ws, sourceId), skipped });
  } catch (error) {
    // La presa è scaduta e un'altra richiesta ha preso la fonte: le sue proposte valgono, le nostre no.
    if (ctxErrorCode(error) === "presa_persa") return ok({ status: "in_lettura" });
    logSafeError(LOG_SCOPE, "lettura_non_riuscita", error, { workspaceId: ws, sourceId });
    if (held) await release(ws, sourceId, held.lease, "da_leggere", "errore").catch(() => undefined);
    return retry();
  }
}

/**
 * Legge una parte di un appunto e scrive le proposte. Solo Lateral Space (o il giro della notte).
 * `again: true` («Rileggi»): prima riporta l'appunto a `da_leggere` e mette `superata` le proposte aperte.
 * Finché restano parti risponde `in_corso` e chi chiama richiama: una chiamata al modello per richiesta.
 */
export async function readContextSource(actor: ContextActor, sourceId: string, opts: { timeoutMs?: number; again?: boolean; now?: Date } = {}): Promise<ServiceResult<ReadOutcome>> {
  const allowed = await gate(actor, "canAddNotes");
  if (!allowed.ok) return allowed;
  if (!isUuid(sourceId)) return notFound();
  return readSource(
    { workspaceId: actor.workspaceId, channel: actor.channel, actorUserId: actor.userId, viewer: { role: actor.role, isLateralSpace: actor.isLateralSpace }, consent: contextAiConsent },
    sourceId,
    opts,
  );
}

/** Il margine tra la fine di una lettura e la fine del tempo del giro. */
const NIGHTLY_MARGIN_MS = 5_000;

/**
 * Il giro della notte: gli appunti `da_leggere` dei workspace con l'ok, dal più vecchio, finché c'è tempo.
 * Stessa lettura, canale «cron», senza persona: gli eventi non hanno attore. Comincia una lettura solo se resta il
 * tempo di finirla; quello che resta lo legge la pagina alla prossima visita.
 */
export async function readPendingSources(o: { budgetMs: number; perCallTimeoutMs?: number; now?: Date }): Promise<{ read: number; failed: number; left: number }> {
  const counts = { read: 0, failed: 0, left: 0 };
  if (!(await contextStoreReady())) return counts;
  const started = Date.now();
  const perCall = o.perCallTimeoutMs ?? CONTEXT_NIGHTLY_READ_TIMEOUT_MS;
  const hasTime = () => o.budgetMs - (Date.now() - started) >= perCall + NIGHTLY_MARGIN_MS;
  let pending: Array<{ id: string; workspace_id: string }>;
  try {
    pending = rowsOf<{ id: string; workspace_id: string }>(
      await db.execute(sql`
        SELECT id, workspace_id FROM context_sources
        WHERE text_purged_at IS NULL
          AND (read_status = 'da_leggere' OR (read_status = 'in_lettura' AND read_started_at < now() - make_interval(secs => ${CONTEXT_LIMITS.readLeaseSeconds})))
        ORDER BY created_at, id LIMIT 500`),
    );
  } catch (error) {
    logSafeError(LOG_SCOPE, "giro_non_riuscito", error);
    return counts;
  }
  const consent = new Map<string, boolean>();
  const limited = new Set<string>();
  for (const source of pending) {
    const ws = source.workspace_id;
    if (!consent.has(ws)) consent.set(ws, await contextAiConsentNow(ws));
    // Senza l'ok la fonte aspetta: non è tra quelle che la notte poteva leggere.
    if (!consent.get(ws)) continue;
    if (limited.has(ws) || !hasTime()) {
      counts.left += 1;
      continue;
    }
    const reader: Reader = { workspaceId: ws, channel: "cron", actorUserId: null, viewer: { role: "transformation_lead", isLateralSpace: true }, consent: async () => true };
    // Un appunto lungo: una parte alla volta, finché c'è tempo.
    for (;;) {
      const result = await readSource(reader, source.id, { timeoutMs: perCall, now: o.now });
      if (!result.ok) {
        counts.failed += 1;
        break;
      }
      const status = result.value.status;
      if (status === "in_corso") {
        if (hasTime()) continue;
        counts.left += 1;
        break;
      }
      if (status === "letto") counts.read += 1;
      else if (status === "limite") {
        limited.add(ws);
        counts.left += 1;
      } else if (status === "in_lettura" || status === "ok_mancante") counts.left += 1;
      else counts.failed += 1;
      break;
    }
  }
  return counts;
}
