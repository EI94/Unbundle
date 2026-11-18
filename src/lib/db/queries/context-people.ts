import "server-only";
/**
 * «Cerca una persona» (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.13, §5.9): dove compare un nome o
 * un'e-mail nel contesto di un workspace, e «Togli «…» da tutto», quando una persona chiede di vedere, correggere o
 * cancellare i suoi dati. Solo Lateral Space (`canEditMemory`); nessun modello.
 *
 * - **La ricerca** guarda gli appunti (testo, titolo, «Con chi»), i fatti (anche le versioni della storia), le
 *   citazioni, le proposte (aperte e chiuse), gli impegni e le domande, i documenti (nome del file, titolo, «Con chi»,
 *   testo e riassunto, anche quelli di prima della 9a senza fonte), gli indirizzi delle regole di Granola e la memoria
 *   della chat (`conversation_memory`, l'indice dei messaggi). Agli appunti e ai fatti il pezzo di testo con il nome.
 * - **«Togli … da tutto»** fa in una transazione, solo nel workspace, la lista del §2.13: gli appunti trovati perdono
 *   testo e «Con chi», prendono un titolo generico e `text_purged_at`, e le loro proposte aperte diventano «superate»;
 *   nei fatti (anche nella storia), nelle proposte di ogni stato (di quelle chiuse solo i testi: stato e `decided_at`
 *   restano), negli impegni e nelle domande il nome diventa «una persona» e le citazioni che lo contengono diventano
 *   nulle; «In breve» che lo contiene si cancella (lo riscrive la notte); le regole di Granola perdono l'indirizzo; le
 *   righe della memoria della chat che lo citano si cancellano. I documenti restano: si tolgono uno per uno dal loro
 *   pannello. Un evento `persona_tolta`, con i soli numeri.
 * - **Le guardie**: un termine di sole parole comuni («del») non si cerca né si toglie; «Togli» rifiuta anche una parola
 *   sola che è nel nome del cliente («Alfa» per «Alfa Ricambi»), che la ricerca mostra lo stesso (`inClientName`).
 * - Prima di scrivere, la stessa transazione prende in ordine gli appunti, le proposte e i fatti che cambiano (come la
 *   lettura e la conferma): una lettura o una conferma in corso finisce prima, e la scrittura vede le sue righe; una
 *   che arriva dopo trova le righe cambiate (`versione_superata`, o la presa della lettura persa).
 * - L'espressione del nome (`personPattern`) passa sempre come parametro: mai SQL composto con il testo. Nei log e
 *   nella storia solo id, codici e numeri: mai il nome cercato.
 * Le tabelle `context_*` e `conversation_memory` si toccano qui, sempre con il workspace (src/lib/context/source-rules.test.ts).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { ERASED_NOTE_TITLE, PERSON_PLACEHOLDER, personPattern, personSnippet, personTerm, termInClientName, type PersonSnippet } from "@/lib/context/people";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { ContextActor } from "@/lib/context/visibility";
import { logSafeError } from "@/lib/log/safe-error";
import type { ServiceResult } from "@/lib/use-cases/types";
import { gate, invalid, ok, retry, rowsOf, toIsoDate } from "./context-shared";

const LOG_SCOPE = "context/people";

/** Quante righe di appunti e di fatti si mostrano; quanti documenti si elencano. */
const NOTE_ROWS = 5;
const FACT_ROWS = 5;
const DOCUMENT_ROWS = 20;
/** Quanti caratteri intorno al nome: negli appunti un pezzo, nei fatti (al massimo 200 caratteri) la frase intera. */
const NOTE_AROUND = { before: 60, after: 100 } as const;
const FACT_AROUND = { before: 200, after: 200 } as const;
/** Le lunghezze delle colonne che cambiano: dopo la sostituzione il testo resta dentro. */
const MAX = { statement: 200, proposal: 400, role: 80 } as const;

export interface PersonNoteHit {
  id: string;
  title: string;
  /** AAAA-MM-GG */
  occurredOn: string;
  snippet: PersonSnippet | null;
}
export interface PersonFactHit {
  id: string;
  /** Una versione di prima o un fatto ritirato: sta nella storia. */
  history: boolean;
  statement: string;
  snippet: PersonSnippet | null;
}
export interface PersonDocumentHit {
  /** Il pannello della fonte, dove c'è «Togli»; null per un documento di prima della 9a, che non ha una fonte. */
  sourceId: string | null;
  fileName: string;
}
/** Dove compare il nome, a gruppi, con il numero. */
export interface PersonHits {
  /** Il termine cercato, pulito: quello che «Togli … da tutto» toglie. */
  term: string;
  isEmail: boolean;
  notes: { total: number; rows: PersonNoteHit[] };
  facts: { total: number; rows: PersonFactHit[] };
  /** Citazioni dei fatti, proposte di ogni stato, impegni e domande. */
  items: { total: number };
  documents: { total: number; rows: PersonDocumentHit[] };
  granola: { total: number };
  chat: { total: number };
  /** «Togli» non si può: una parola sola che è anche nel nome del cliente (`termInClientName`). La ricerca la mostra lo stesso. */
  inClientName: boolean;
}
/** Che cosa ha tolto «Togli … da tutto»: appunti cancellati, testi corretti, indirizzi di Granola, righe della memoria della chat. */
export interface PersonErased {
  notes: number;
  texts: number;
  rules: number;
  chatMemory: number;
}

/** Il termine valido e la sua espressione, oppure l'errore da mostrare («Scrivi almeno 3 lettere.»). */
function patternOf(raw: string): { ok: true; term: string; isEmail: boolean; pattern: string } | { ok: false; message: string } {
  const checked = personTerm(raw);
  if (!checked.ok) return checked;
  return { ...checked, pattern: personPattern(checked.term) };
}

/** Un appunto che contiene il nome (testo, titolo o «Con chi»), con l'alias della tabella. Mai un documento, mai le risposte del referente. */
function noteMatches(alias: "s" | "n", ws: string, p: string): SQL {
  const a = sql.raw(alias);
  return sql`${a}.workspace_id = ${ws}::uuid AND ${a}.kind IN ('appunti', 'trascrizione') AND (${a}.body ~ ${p} OR ${a}.title ~ ${p} OR ${a}.participants ~ ${p})`;
}

/** I nomi del cliente: del workspace e della sua organizzazione. */
function clientNamesSql(ws: string): SQL {
  return sql`SELECT w.name AS workspace, o.name AS organization FROM workspaces w LEFT JOIN organizations o ON o.id = w.organization_id WHERE w.id = ${ws}::uuid`;
}
const clientNamesOf = (result: unknown) => {
  const [row] = rowsOf<{ workspace: string | null; organization: string | null }>(result);
  return [row?.workspace, row?.organization];
};

/** Una proposta (alias `x`), di qualunque stato, con il nome nella frase, nella citazione o nel ruolo. */
function proposalNames(p: string): SQL {
  return sql`(x.statement ~ ${p} OR x.quote ~ ${p} OR x.role_label ~ ${p})`;
}

/**
 * Il pezzo di `text` intorno al primo nome, come lo vuole `personSnippet`: la finestra, dove comincia il nome e quanto
 * è lungo (in caratteri, come conta Postgres), e se il testo continua prima e dopo. null se il nome non c'è.
 */
function snippetSql(text: SQL, p: string, around: { before: number; after: number }): SQL {
  return sql`(
    SELECT json_build_object(
      'window', substring(w.t from greatest(1, w.pos - ${around.before}::int) for w.pos - greatest(1, w.pos - ${around.before}::int) + w.len + ${around.after}::int),
      'at', w.pos - greatest(1, w.pos - ${around.before}::int),
      'length', w.len,
      'head', w.pos - ${around.before}::int > 1,
      'tail', w.pos + w.len + ${around.after}::int <= char_length(w.t))
    FROM (
      SELECT v.t, v.pos, regexp_instr(v.t, ${p}, 1, 1, 1) - v.pos AS len
      FROM (SELECT u.t, regexp_instr(u.t, ${p}) AS pos FROM (SELECT ${text} AS t) u) v
      WHERE v.pos > 0
    ) w
  )`;
}

type SnippetJson = { window: string | null; at: number; length: number; head: boolean; tail: boolean };

/** Il pezzo come arriva dal database: un oggetto JSON (o il suo testo). */
function snippetOf(value: unknown): PersonSnippet | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return parsed !== null && typeof parsed === "object" ? personSnippet(parsed as SnippetJson) : null;
}

const count = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

/**
 * Dove compare un nome o un'e-mail nel contesto del workspace (§2.13). Solo Lateral Space: agli altri
 * `permesso_mancante`. Un termine non valido: `dati_non_validi` con il messaggio. Non chiama il modello e non scrive.
 */
export async function searchPerson(actor: ContextActor, raw: string): Promise<ServiceResult<PersonHits>> {
  const allowed = await gate(actor, "canEditMemory");
  if (!allowed.ok) return allowed;
  const term = patternOf(raw);
  if (!term.ok) return invalid({ term: term.message }, term.message);
  const ws = actor.workspaceId;
  const p = term.pattern;
  try {
    const [notes, facts, items, documents, granola, chat, names] = await db.batch([
      db.execute(sql`
        SELECT h.total, s.id, s.title, s.occurred_on,
          ${snippetSql(sql`(CASE WHEN s.body ~ ${p} THEN s.body WHEN s.title ~ ${p} THEN s.title ELSE s.participants END)`, p, NOTE_AROUND)} AS snippet
        FROM (
          SELECT n.id, n.occurred_on, n.created_at, count(*) OVER () AS total FROM context_sources n
          WHERE ${noteMatches("n", ws, p)}
          ORDER BY n.occurred_on DESC, n.created_at DESC, n.id
          LIMIT ${NOTE_ROWS}
        ) h
        JOIN context_sources s ON s.id = h.id AND s.workspace_id = ${ws}::uuid
        ORDER BY h.occurred_on DESC, h.created_at DESC, h.id`),
      db.execute(sql`
        SELECT h.total, f.id, f.status, f.statement, ${snippetSql(sql`f.statement`, p, FACT_AROUND)} AS snippet
        FROM (
          SELECT x.id, x.status, x.last_confirmed_at, count(*) OVER () AS total FROM context_facts x
          WHERE x.workspace_id = ${ws}::uuid AND x.statement ~ ${p}
          ORDER BY (x.status = 'attivo') DESC, x.last_confirmed_at DESC, x.id
          LIMIT ${FACT_ROWS}
        ) h
        JOIN context_facts f ON f.id = h.id AND f.workspace_id = ${ws}::uuid
        ORDER BY (h.status = 'attivo') DESC, h.last_confirmed_at DESC, h.id`),
      db.execute(sql`
        SELECT (
          (SELECT count(*) FROM context_facts f WHERE f.workspace_id = ${ws}::uuid AND f.quote ~ ${p})
          + (SELECT count(*) FROM context_proposals x WHERE x.workspace_id = ${ws}::uuid AND ${proposalNames(p)})
          + (SELECT count(*) FROM context_commitments c WHERE c.workspace_id = ${ws}::uuid AND (c.statement ~ ${p} OR c.quote ~ ${p} OR c.role_label ~ ${p}))
          + (SELECT count(*) FROM context_questions q WHERE q.workspace_id = ${ws}::uuid AND (q.question ~ ${p} OR q.quote ~ ${p} OR q.ask_whom ~ ${p}))
        )::int AS total`),
      // I documenti, anche quelli di prima della 9a che non hanno una fonte: il nome del file e, se c'è, il pannello.
      db.execute(sql`
        SELECT count(*) OVER () AS total, s.id AS source_id, d.file_name
        FROM uploaded_documents d
        LEFT JOIN context_sources s ON s.document_id = d.id AND s.workspace_id = d.workspace_id
        WHERE d.workspace_id = ${ws}::uuid
          AND (d.file_name ~ ${p} OR d.extracted_text ~ ${p} OR d.summary ~ ${p} OR s.title ~ ${p} OR s.participants ~ ${p})
        ORDER BY d.created_at DESC, d.id
        LIMIT ${DOCUMENT_ROWS}`),
      db.execute(sql`
        SELECT count(*)::int AS total FROM context_granola_rules r CROSS JOIN LATERAL unnest(r.emails) AS e(email)
        WHERE r.workspace_id = ${ws}::uuid AND e.email ~ ${p}`),
      db.execute(sql`SELECT count(*)::int AS total FROM conversation_memory m WHERE m.workspace_id = ${ws}::uuid AND m.content ~ ${p}`),
      db.execute(clientNamesSql(ws)),
    ]);
    const noteRows = rowsOf<{ total: unknown; id: string; title: string; occurred_on: unknown; snippet: unknown }>(notes);
    const factRows = rowsOf<{ total: unknown; id: string; status: string; statement: string; snippet: unknown }>(facts);
    const documentRows = rowsOf<{ total: unknown; source_id: string | null; file_name: string | null }>(documents);
    return ok({
      term: term.term,
      isEmail: term.isEmail,
      notes: {
        total: count(noteRows[0]?.total),
        rows: noteRows.map((row) => ({ id: row.id, title: row.title, occurredOn: toIsoDate(row.occurred_on), snippet: snippetOf(row.snippet) })),
      },
      facts: {
        total: count(factRows[0]?.total),
        rows: factRows.map((row) => ({ id: row.id, history: row.status !== "attivo", statement: row.statement, snippet: snippetOf(row.snippet) })),
      },
      items: { total: count(rowsOf<{ total: unknown }>(items)[0]?.total) },
      documents: {
        total: count(documentRows[0]?.total),
        rows: documentRows.map((row) => ({ sourceId: row.source_id, fileName: row.file_name ?? "" })),
      },
      granola: { total: count(rowsOf<{ total: unknown }>(granola)[0]?.total) },
      chat: { total: count(rowsOf<{ total: unknown }>(chat)[0]?.total) },
      inClientName: termInClientName(term.term, clientNamesOf(names)),
    });
  } catch (error) {
    logSafeError(LOG_SCOPE, "persona_non_cercata", error, { workspaceId: ws });
    return retry();
  }
}

/** `testo` con il nome sostituito da «una persona», dentro la lunghezza della colonna; com'è se non lo contiene. */
function replacedSql(column: SQL, p: string, max: number): SQL {
  return sql`CASE WHEN ${column} ~ ${p} THEN left(regexp_replace(${column}, ${p}, ${PERSON_PLACEHOLDER}, 'g'), ${max}::int) ELSE ${column} END`;
}

/**
 * «Togli «…» da tutto» (§2.13): in una transazione, solo nel workspace. Solo Lateral Space: agli altri
 * `permesso_mancante`. Risponde con i numeri del messaggio («{a} appunti cancellati, {t} testi corretti») e quelli di
 * Granola e della memoria della chat. Scrive `persona_tolta` con i soli numeri, se ha tolto qualcosa. Non si torna
 * indietro. Non chiama il modello: «In breve» lo riscrive la notte. Un termine di sole parole comuni (`personTerm`) o
 * una parola sola del nome del cliente (`termInClientName`): `dati_non_validi` con il messaggio, e niente cambia.
 */
export async function erasePerson(actor: ContextActor, raw: string): Promise<ServiceResult<PersonErased>> {
  const allowed = await gate(actor, "canEditMemory");
  if (!allowed.ok) return allowed;
  const term = patternOf(raw);
  if (!term.ok) return invalid({ term: term.message }, term.message);
  const ws = actor.workspaceId;
  const p = term.pattern;
  const factMatches = sql`f.workspace_id = ${ws}::uuid AND (f.statement ~ ${p} OR f.quote ~ ${p})`;
  try {
    // Una parola sola che è anche nel nome del cliente: «Togli» cancellerebbe il cliente ovunque. Nome e cognome, o l'e-mail.
    if (termInClientName(term.term, clientNamesOf(await db.execute(clientNamesSql(ws))))) {
      return invalid({ term: CONTEXT_TEXT.people.inClientName }, CONTEXT_TEXT.people.inClientName);
    }
    const results = await db.batch([
      // Le righe che cambiano, prese in ordine (appunti, proposte, fatti) prima di ogni scrittura: chi le sta già
      // scrivendo finisce prima, e la scrittura qui sotto vede le sue righe.
      db.execute(sql`SELECT s.id FROM context_sources s WHERE ${noteMatches("s", ws, p)} ORDER BY s.id FOR UPDATE OF s`),
      db.execute(sql`
        SELECT x.id FROM context_proposals x
        WHERE x.workspace_id = ${ws}::uuid
          AND (${proposalNames(p)}
            OR (x.status = 'aperta'
              AND (x.source_id IN (SELECT n.id FROM context_sources n WHERE ${noteMatches("n", ws, p)})
                OR x.target_fact_id IN (SELECT f.id FROM context_facts f WHERE ${factMatches}))))
        ORDER BY x.id
        FOR UPDATE OF x`),
      db.execute(sql`SELECT f.id FROM context_facts f WHERE ${factMatches} ORDER BY f.id FOR UPDATE OF f`),
      // Tutto il resto in un solo statement: le parti vedono la stessa istantanea, i numeri si contano su quella.
      db.execute(sql`
        WITH notes AS (
          UPDATE context_sources s
          SET body = NULL, body_hash = NULL, participants = NULL,
            title = replace(${ERASED_NOTE_TITLE}::text, '{data}', to_char(s.occurred_on, 'DD/MM/YYYY')),
            text_purged_at = coalesce(s.text_purged_at, now()),
            read_status = CASE WHEN s.read_status IN ('da_leggere', 'in_lettura') THEN 'non_letto' ELSE s.read_status END,
            read_reason = CASE WHEN s.read_status IN ('da_leggere', 'in_lettura') THEN 'vuoto' ELSE s.read_reason END,
            read_started_at = NULL, version = s.version + 1, updated_at = now()
          WHERE ${noteMatches("s", ws, p)}
          RETURNING s.id
        ), facts AS (
          UPDATE context_facts f
          SET statement = ${replacedSql(sql`f.statement`, p, MAX.statement)},
            quote = CASE WHEN f.quote ~ ${p} THEN NULL ELSE f.quote END,
            version = f.version + 1, updated_at = now()
          WHERE ${factMatches}
          RETURNING f.id
        ), proposals AS (
          -- Le proposte aperte: il nome diventa «una persona»; quelle degli appunti tolti diventano «superate»; quelle su
          -- un fatto che cambia hanno un «Prima» nuovo. In ogni caso la versione sale: chi le ha davanti le rilegge.
          UPDATE context_proposals x
          SET statement = ${replacedSql(sql`x.statement`, p, MAX.proposal)},
            quote = CASE WHEN x.quote ~ ${p} THEN NULL ELSE x.quote END,
            role_label = ${replacedSql(sql`x.role_label`, p, MAX.role)},
            status = CASE WHEN x.source_id IN (SELECT id FROM notes) THEN 'superata' ELSE x.status END,
            decided_at = CASE WHEN x.source_id IN (SELECT id FROM notes) THEN now() ELSE x.decided_at END,
            version = x.version + 1, updated_at = now()
          WHERE x.workspace_id = ${ws}::uuid AND x.status = 'aperta'
            AND (${proposalNames(p)} OR x.source_id IN (SELECT id FROM notes) OR x.target_fact_id IN (SELECT id FROM facts))
          RETURNING x.status
        ), decided AS (
          -- Le proposte chiuse (confermate, scartate, superate) tengono il testo letto: anche lì il nome diventa «una
          -- persona» e la citazione che lo contiene nulla. Stato e decided_at restano. Un insieme distinto da quello
          -- sopra (lo stato si legge sulla stessa istantanea): nessuna riga cambia due volte. Come ogni scrittura in un
          -- WITH, gira anche se nessuno la legge; il numero lo dà counts, sull'istantanea.
          UPDATE context_proposals x
          SET statement = ${replacedSql(sql`x.statement`, p, MAX.proposal)},
            quote = CASE WHEN x.quote ~ ${p} THEN NULL ELSE x.quote END,
            role_label = ${replacedSql(sql`x.role_label`, p, MAX.role)},
            version = x.version + 1, updated_at = now()
          WHERE x.workspace_id = ${ws}::uuid AND x.status <> 'aperta' AND ${proposalNames(p)}
        ), commitments AS (
          UPDATE context_commitments c
          SET statement = ${replacedSql(sql`c.statement`, p, MAX.statement)},
            role_label = ${replacedSql(sql`c.role_label`, p, MAX.role)},
            quote = CASE WHEN c.quote ~ ${p} THEN NULL ELSE c.quote END,
            version = c.version + 1, updated_at = now()
          WHERE c.workspace_id = ${ws}::uuid AND (c.statement ~ ${p} OR c.role_label ~ ${p} OR c.quote ~ ${p})
          RETURNING c.id
        ), questions AS (
          UPDATE context_questions q
          SET question = ${replacedSql(sql`q.question`, p, MAX.statement)},
            ask_whom = ${replacedSql(sql`q.ask_whom`, p, MAX.role)},
            quote = CASE WHEN q.quote ~ ${p} THEN NULL ELSE q.quote END,
            version = q.version + 1, updated_at = now()
          WHERE q.workspace_id = ${ws}::uuid AND (q.question ~ ${p} OR q.ask_whom ~ ${p} OR q.quote ~ ${p})
          RETURNING q.id
        ), brief AS (
          DELETE FROM context_briefs b
          WHERE b.workspace_id = ${ws}::uuid AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(b.lines) AS l(line) WHERE l.line ~ ${p})
          RETURNING b.workspace_id
        ), granola AS (
          UPDATE context_granola_rules r
          SET emails = ARRAY(SELECT e.email FROM unnest(r.emails) WITH ORDINALITY AS e(email, n) WHERE NOT (e.email ~ ${p}) ORDER BY e.n),
            updated_by_user_id = ${actor.userId}::uuid, updated_at = now()
          WHERE r.workspace_id = ${ws}::uuid AND EXISTS (SELECT 1 FROM unnest(r.emails) AS e(email) WHERE e.email ~ ${p})
          RETURNING r.workspace_id
        ), chat AS (
          DELETE FROM conversation_memory m WHERE m.workspace_id = ${ws}::uuid AND m.content ~ ${p}
          RETURNING m.id
        ), counts AS (
          SELECT
            (SELECT count(*) FROM notes)::int AS notes,
            (SELECT count(*) FROM context_facts f WHERE f.workspace_id = ${ws}::uuid AND f.statement ~ ${p})::int AS facts,
            (SELECT count(*) FROM context_facts f WHERE f.workspace_id = ${ws}::uuid AND f.quote ~ ${p})::int AS quotes,
            (SELECT count(*) FROM context_proposals x WHERE x.workspace_id = ${ws}::uuid AND ${proposalNames(p)})::int AS proposals,
            (SELECT count(*) FROM commitments)::int AS commitments,
            (SELECT count(*) FROM questions)::int AS questions,
            (SELECT count(*) FROM proposals WHERE status = 'superata')::int AS superseded,
            (SELECT count(*) FROM brief)::int AS brief,
            (SELECT count(*) FROM context_granola_rules r CROSS JOIN LATERAL unnest(r.emails) AS e(email) WHERE r.workspace_id = ${ws}::uuid AND e.email ~ ${p})::int AS rules,
            (SELECT count(*) FROM chat)::int AS chat
        ), logged AS (
          INSERT INTO context_events (workspace_id, action, channel, actor_user_id, detail)
          SELECT ${ws}::uuid, 'persona_tolta', ${actor.channel}, ${actor.userId}::uuid,
            jsonb_build_object('appunti', c.notes, 'fatti', c.facts, 'citazioni', c.quotes, 'proposte', c.proposals, 'impegni', c.commitments,
              'domande', c.questions, 'superate', c.superseded, 'in_breve', c.brief, 'regole', c.rules, 'chat', c.chat)
          FROM counts c
          WHERE c.notes + c.facts + c.quotes + c.proposals + c.commitments + c.questions + c.brief + c.rules + c.chat > 0
          RETURNING id
        )
        SELECT c.*, (SELECT count(*) FROM logged)::int AS logged FROM counts c`),
    ]);
    const [row] = rowsOf<Record<"notes" | "facts" | "quotes" | "proposals" | "commitments" | "questions" | "rules" | "chat", unknown>>(results[3]);
    if (!row) return retry();
    return ok({
      notes: count(row.notes),
      texts: count(row.facts) + count(row.quotes) + count(row.proposals) + count(row.commitments) + count(row.questions),
      rules: count(row.rules),
      chatMemory: count(row.chat),
    });
  } catch (error) {
    logSafeError(LOG_SCOPE, "persona_non_tolta", error, { workspaceId: ws });
    return retry();
  }
}
