/**
 * Le risposte del referente come fonte di «Contesto» (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.11, §3.2,
 * D2). Una richiesta di «Chiedi al referente» diventa una fonte: `kind = 'risposta'`, `origin = 'rispondi'`, una per
 * richiesta (`external_id` = l'id della richiesta, l'indice unico `context_sources_external_unique`), «Solo Lateral
 * Space», senza testo. Il testo non si copia: la lettura lo compone dal vivo dalle risposte inviate (`readAnswersSource`,
 * `composeAnswersText`).
 *
 * - `referentSourceStatements`: nel batch dell'invio delle risposte, della modifica, di «Aggiungi qualcosa» e della
 *   risposta a un chiarimento. La fonte nasce, o torna `da_leggere` con le proposte aperte non corrette «superate» (come
 *   una call cambiata su Granola), solo con la 0041, solo se il referente ha accettato un'informativa che lo dice
 *   (`REFERENT_CONTEXT_NOTICE_VERSIONS`) e solo se dopo ha scritto qualcosa che si legge. Mai un errore in più per il
 *   referente: senza la 0041, o se la lettura di prima non riesce, nessuno statement.
 * - `referentSourcesEraseStatements`: nel batch della conservazione dei 12 mesi e della cancellazione dei dati del
 *   referente (`referent/erase.ts`). La fonte prende `text_purged_at`, le proposte aperte diventano «superate», le
 *   citazioni (`quote`) dei fatti, delle proposte, degli impegni e delle domande nati da lei diventano nulle. I fatti
 *   restano: non hanno nomi.
 *
 * Gli statement sono `UcStatement` (`ucSql`): li eseguono i batch del referente, con l'esecutore uc. Modulo senza import
 * dell'app in testa (`@/…`, `server-only`): `referent/erase.ts` lo carica anche dallo script dell'operatore, con Node; la
 * sonda della 0041 si carica solo quando serve. Nei log solo id e codici: mai un testo.
 */
import { cut, oneLine } from "../../context/normalize.ts";
import { composeAnswersText } from "../../context/read/answers.ts";
import { CONTEXT_TEXT } from "../../context/text.ts";
import { CONTEXT_LIMITS } from "../../context/vocab.ts";
import { logSafeError } from "../../log/safe-error.ts";
import { isUuid } from "../../uc/ids.ts";
import { cast, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
import { REFERENT_CONTEXT_NOTICE_VERSIONS, noticeAllowsContext } from "../../use-cases/referent/labels.ts";
import { getAppUcExecutor, type UcRow } from "../uc-executor.ts";

const LOG_SCOPE = "context/referent";

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const flag = (value: unknown): boolean => value === true || value === "t" || value === "true";

/** Il titolo della fonte: «Risposte del referente · XX-0012» (o il titolo dello use case, se non ha un codice). */
export function answersSourceTitle(code: string | null, useCaseTitle: string | null): string {
  const label = oneLine(code ?? "") || oneLine(useCaseTitle ?? "");
  return cut(CONTEXT_TEXT.notes.answersTitle(label), CONTEXT_LIMITS.titleMax).trim();
}

/**
 * Il referente ha scritto qualcosa che si legge dopo aver accettato l'informativa (alias `r` della richiesta): una
 * risposta inviata con un testo, o un commento che non sia di «Non ce l'ho»; una risposta a un chiarimento o un'aggiunta
 * su una domanda. Le stesse regole di `composeAnswersText`: una fonte nasce solo se avrà un testo.
 */
const WRITTEN_AFTER_NOTICE = raw(`(EXISTS (SELECT 1 FROM use_case_need_answers a
      WHERE a.request_id = r.id AND a.workspace_id = r.workspace_id AND a.source = 'referente' AND a.status = 'inviata' AND a.removed_at IS NULL
        AND coalesce(a.edited_at, a.submitted_at) >= r.privacy_accepted_at
        AND (btrim(coalesce(a.body, '')) <> '' OR (NOT a.dont_know AND btrim(coalesce(a.comment, '')) <> '')))
    OR EXISTS (SELECT 1 FROM use_case_referent_messages m
      WHERE m.request_id = r.id AND m.workspace_id = r.workspace_id AND m.side = 'referente' AND m.kind IN ('risposta', 'aggiunta')
        AND m.anchor = 'domanda' AND m.removed_at IS NULL AND m.created_at >= r.privacy_accepted_at))`);

/**
 * La fonte delle risposte di una richiesta: nasce `da_leggere`, oppure ci torna (con le proposte aperte non corrette
 * «superate»); una riga di storia con il canale `rispondi`, senza attore. Niente su una richiesta senza l'informativa che
 * lo permette, cancellata, senza niente da leggere, o con il testo già cancellato. Puro: lo usa `referentSourceStatements`.
 */
export function referentSourceSql(i: { workspaceId: string; requestId: string; title: string }): UcStatement {
  if (!isUuid(i.workspaceId) || !isUuid(i.requestId)) throw new Error("referentSourceSql: id non valido");
  const ws = cast(i.workspaceId, "uuid");
  return toStatement(ucSql`WITH up AS (
  INSERT INTO context_sources (workspace_id, kind, origin, title, occurred_on, body, body_chars, external_id, visibility, read_status, parts_total, parts_read)
  SELECT r.workspace_id, 'risposta', 'rispondi', ${cast(i.title, "text")}, (now() AT TIME ZONE 'Europe/Rome')::date, NULL, 0, r.id::text, 'ls', 'da_leggere', 1, 0
  FROM use_case_referent_requests r
  WHERE r.id = ${cast(i.requestId, "uuid")} AND r.workspace_id = ${ws} AND r.purged_at IS NULL
    AND r.privacy_accepted_at IS NOT NULL AND r.privacy_notice_version = ANY(${cast([...REFERENT_CONTEXT_NOTICE_VERSIONS], "text[]")})
    AND ${WRITTEN_AFTER_NOTICE}
  ON CONFLICT (workspace_id, origin, external_id) WHERE external_id IS NOT NULL
  DO UPDATE SET read_status = 'da_leggere', read_reason = NULL, read_attempts = 0, read_started_at = NULL, read_at = NULL,
    parts_read = 0, skipped = '{}'::jsonb, version = context_sources.version + 1, updated_at = now()
  WHERE context_sources.kind = 'risposta' AND context_sources.text_purged_at IS NULL
  RETURNING id, workspace_id, (created_at = now()) AS created
), superseded AS (
  UPDATE context_proposals p SET status = 'superata', decided_at = now(), updated_at = now(), version = p.version + 1
  FROM up WHERE NOT up.created AND p.source_id = up.id AND p.workspace_id = up.workspace_id AND p.status = 'aperta' AND NOT p.edited
  RETURNING p.id
)
INSERT INTO context_events (workspace_id, action, channel, source_id, detail)
SELECT up.workspace_id, CASE WHEN up.created THEN 'fonte_aggiunta' ELSE 'fonte_aggiornata' END, 'rispondi', up.id,
  jsonb_build_object('origine', 'rispondi', 'tipo', 'risposta', 'superate', (SELECT count(*) FROM superseded))
FROM up`);
}

/**
 * Gli statement della fonte delle risposte di una richiesta, da mettere nel batch del referente dopo le sue scritture
 * (vedono le risposte appena inviate). Vuoto senza la 0041, per una richiesta senza l'informativa che lo permette, o se la
 * lettura di prima non riesce (nel log): la risposta del referente non fallisce mai per «Contesto».
 */
export async function referentSourceStatements(i: { workspaceId: string; requestId: string }): Promise<UcStatement[]> {
  if (!isUuid(i?.workspaceId) || !isUuid(i?.requestId)) return [];
  try {
    const { contextWorkReady } = await import("./context-store");
    if (!(await contextWorkReady())) return [];
    const executor = await getAppUcExecutor();
    const [[row]] = await executor.batch([
      toStatement(ucSql`SELECT r.privacy_notice_version, u.code, u.title FROM use_case_referent_requests r
JOIN use_cases u ON u.id = r.use_case_id AND u.workspace_id = r.workspace_id
WHERE r.id = ${cast(i.requestId, "uuid")} AND r.workspace_id = ${cast(i.workspaceId, "uuid")}`),
    ]);
    if (!row || !noticeAllowsContext(text(row.privacy_notice_version))) return [];
    return [referentSourceSql({ workspaceId: i.workspaceId, requestId: i.requestId, title: answersSourceTitle(text(row.code), text(row.title)) })];
  } catch (error) {
    logSafeError(LOG_SCOPE, "fonte_risposte_non_preparata", error, { workspaceId: i.workspaceId, requestId: i.requestId });
    return [];
  }
}

/**
 * Il testo da leggere di una fonte di risposte (`external_id` = l'id della richiesta) e lo use case della richiesta, a
 * cui si legano le proposte. Testo vuoto per una richiesta che non c'è più, cancellata, o senza l'informativa che lo
 * permette. Lancia per un errore del database: lo gestisce la lettura.
 */
export async function readAnswersSource(workspaceId: string, requestId: string | null): Promise<{ text: string; useCaseId: string | null }> {
  if (!isUuid(workspaceId) || !isUuid(requestId)) return { text: "", useCaseId: null };
  const ws = () => cast(workspaceId, "uuid");
  const req = () => cast(requestId, "uuid");
  const executor = await getAppUcExecutor();
  const [[head], items, answers, messages] = await executor.batch([
    toStatement(ucSql`SELECT r.use_case_id::text AS use_case_id, r.privacy_notice_version, (r.purged_at IS NOT NULL) AS purged
FROM use_case_referent_requests r WHERE r.id = ${req()} AND r.workspace_id = ${ws()}`),
    toStatement(ucSql`SELECT i.need_id::text AS need_id, i.question, i.position FROM use_case_referent_request_items i
WHERE i.request_id = ${req()} AND i.workspace_id = ${ws()}`),
    toStatement(ucSql`SELECT a.need_id::text AS need_id, a.source, a.body, a.dont_know, a.comment,
  (r.privacy_accepted_at IS NOT NULL AND coalesce(a.edited_at, a.submitted_at) >= r.privacy_accepted_at) AS after_notice
FROM use_case_need_answers a JOIN use_case_referent_requests r ON r.id = a.request_id AND r.workspace_id = a.workspace_id
WHERE a.request_id = ${req()} AND a.workspace_id = ${ws()} AND a.status = 'inviata' AND a.removed_at IS NULL`),
    toStatement(ucSql`SELECT m.id::text AS id, m.anchor, m.need_id::text AS need_id, m.side, m.kind, m.reply_to_id::text AS reply_to_id, m.body,
  (r.privacy_accepted_at IS NOT NULL AND m.created_at >= r.privacy_accepted_at) AS after_notice
FROM use_case_referent_messages m JOIN use_case_referent_requests r ON r.id = m.request_id AND r.workspace_id = m.workspace_id
WHERE m.request_id = ${req()} AND m.workspace_id = ${ws()} AND m.removed_at IS NULL
ORDER BY m.created_at, m.id`),
  ]);
  if (!head) return { text: "", useCaseId: null };
  const useCaseId = text(head.use_case_id);
  if (flag(head.purged) || !noticeAllowsContext(text(head.privacy_notice_version))) return { text: "", useCaseId };
  const composed = composeAnswersText({
    questions: items.map((row: UcRow) => ({ needId: text(row.need_id) ?? "", question: text(row.question) ?? "", position: Number(row.position) })),
    answers: answers.map((row: UcRow) => ({
      needId: text(row.need_id) ?? "",
      source: text(row.source) ?? "",
      body: text(row.body),
      dontKnow: flag(row.dont_know),
      comment: text(row.comment),
      afterNotice: flag(row.after_notice),
    })),
    messages: messages.map((row: UcRow) => ({
      id: text(row.id) ?? "",
      anchor: text(row.anchor) ?? "",
      needId: text(row.need_id),
      side: text(row.side) ?? "",
      kind: text(row.kind) ?? "",
      replyToId: text(row.reply_to_id),
      body: text(row.body),
      afterNotice: flag(row.after_notice),
    })),
  });
  return { text: composed, useCaseId };
}

/**
 * Lo use case della richiesta di una fonte di risposte (`external_id`), per il link «Apri lo use case» nel pannello della
 * fonte. null per un'altra fonte, o una richiesta che non c'è più.
 */
export async function answerSourceUseCaseId(workspaceId: string, externalId: string | null): Promise<string | null> {
  if (!isUuid(workspaceId) || !isUuid(externalId)) return null;
  const executor = await getAppUcExecutor();
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT r.use_case_id::text AS use_case_id FROM use_case_referent_requests r
WHERE r.id = ${cast(externalId, "uuid")} AND r.workspace_id = ${cast(workspaceId, "uuid")}`),
  ]);
  return row ? text(row.use_case_id) : null;
}

/** Le tabelle di «Contesto» con le citazioni dei testi di una fonte. */
const QUOTED_TABLES = Object.freeze(["context_proposals", "context_facts", "context_commitments", "context_questions"] as const);

/**
 * La conservazione e la cancellazione toccano le fonti delle risposte: di una richiesta (`requestId`, la conservazione
 * dei 12 mesi) o di tutte le richieste di un referente nel workspace (`contactId`, «Cancella i dati di questa persona»).
 * Nell'ordine: la fonte prende `text_purged_at` (non si legge più: se aspettava la lettura resta «non letta») con una
 * riga di storia senza testo; le proposte aperte diventano «superate»; le citazioni delle proposte, dei fatti (anche
 * della storia), degli impegni e delle domande nati dalla fonte diventano nulle. Una seconda volta non cambia niente.
 * Solo tabelle della 0038: senza fonti di risposte (senza la 0041 non ce ne sono) nessuna riga cambia.
 */
export function referentSourcesEraseStatements(i: { workspaceId: string; requestId?: string; contactId?: string }): UcStatement[] {
  const byRequest = i.requestId !== undefined;
  if (!isUuid(i.workspaceId) || byRequest === (i.contactId !== undefined) || !isUuid(byRequest ? i.requestId : i.contactId)) {
    throw new Error("referentSourcesEraseStatements: id non valido");
  }
  const ws = () => cast(i.workspaceId.toLowerCase(), "uuid");
  const which: SqlFragment = byRequest ? ucSql`r.id = ${cast(i.requestId!.toLowerCase(), "uuid")}` : ucSql`r.contact_id = ${cast(i.contactId!.toLowerCase(), "uuid")}`;
  const sources = () => ucSql`SELECT cs.id FROM context_sources cs
  JOIN use_case_referent_requests r ON r.workspace_id = cs.workspace_id AND cs.external_id = r.id::text
  WHERE cs.workspace_id = ${ws()} AND cs.origin = 'rispondi' AND cs.kind = 'risposta' AND ${which}`;
  return [
    toStatement(ucSql`WITH purged AS (
  UPDATE context_sources s SET text_purged_at = now(), read_started_at = NULL, updated_at = now(), version = s.version + 1,
    read_status = CASE WHEN s.read_status IN ('da_leggere', 'in_lettura') THEN 'non_letto' ELSE s.read_status END,
    read_reason = CASE WHEN s.read_status IN ('da_leggere', 'in_lettura') THEN 'vuoto' ELSE s.read_reason END
  WHERE s.workspace_id = ${ws()} AND s.text_purged_at IS NULL AND s.id IN (${sources()})
  RETURNING s.id, s.workspace_id
)
INSERT INTO context_events (workspace_id, action, channel, source_id)
SELECT workspace_id, 'testo_cancellato', 'rispondi', id FROM purged`),
    toStatement(ucSql`UPDATE context_proposals p SET status = 'superata', decided_at = now(), quote = NULL, updated_at = now(), version = p.version + 1
WHERE p.workspace_id = ${ws()} AND p.status = 'aperta' AND p.source_id IN (${sources()})`),
    ...QUOTED_TABLES.map((table) =>
      toStatement(ucSql`UPDATE ${raw(table)} x SET quote = NULL WHERE x.workspace_id = ${ws()} AND x.quote IS NOT NULL AND x.source_id IN (${sources()})`),
    ),
  ];
}
