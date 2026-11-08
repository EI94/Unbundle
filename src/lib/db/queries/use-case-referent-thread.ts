import "server-only";
import { getAppUcExecutor, type UcExecutor, type UcRow } from "@/lib/db/uc-executor";
import {
  guardedReferent,
  isUuid,
  readCard,
  readReferentPerson,
  referentBatch,
  referentWriter,
  rfail,
  rfailVars,
  type Env,
  type ReferentFailure,
  type ReferentLink,
} from "@/lib/db/queries/use-case-referent-base";
import { loadSubprocessorAck } from "@/lib/db/queries/uc-subprocessors";
import { readinessSyncFor } from "@/lib/db/queries/use-case-alerts";
import { latestSuggestionSql, suggestionQueueSql } from "@/lib/db/queries/use-case-referent-ai";
import type { Issue } from "@/lib/uc/answers/issues";
import { romeDate } from "@/lib/uc/calendar";
import { ucEmailConfig } from "@/lib/uc/notify/dispatch";
import { publicFail, type PublicOutcome } from "@/lib/uc/public-view";
import { rowBool, rowDate, rowNumber, rowString } from "@/lib/uc/sql/readiness";
import { cast, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "@/lib/uc/sql/statement";
import { cardSyncStatements } from "@/lib/use-cases/case-alerts/sql";
import type { ReferentThreadAnchor } from "@/lib/db/use-case-hub-referent-thread-ddl";
import { alertSchedule } from "@/lib/use-cases/referent/alerts";
import { referentPublicWritesAvailable } from "@/lib/use-cases/referent/availability";
import type { ClarifyTarget, ThreadMessageView, ThreadSuggestionView } from "@/lib/use-cases/referent/contract";
import { REFERENT_ERROR_MESSAGES, REFERENT_THREAD_TEXT, REFERENT_UI_TEXT, companyLabel, fillText } from "@/lib/use-cases/referent/labels";
import {
  activeRequestSql,
  casTail,
  lockRequestSql,
  needTransitionSql,
  notifyReviewersSql,
  openItemsCountSql,
  queueRequesterAlertSql,
  queueThreadEmailItemSql,
  referentEventSql,
  referentEventsForRequestsSql,
  renewLinkStatements,
  reopenRequestStatements,
  cancelQueuedForRequestsStatements,
  validLinkSql,
  type ReferentActor,
} from "@/lib/use-cases/referent/sql";
import { privacyAccepted } from "@/lib/use-cases/referent/state";
import { checkReferentThreadText, checkThreadLine } from "@/lib/use-cases/referent/text";
import {
  CLARIFY_FROM_STATUSES,
  REFERENT_THREAD_RULES,
  REPLY_TO_VERIFY_FROM_STATUSES,
  anchorKeyOf,
  newsForTeam,
  referentCanEdit,
  threadEmailAt,
  threadFactsOf,
  waitsForReferent,
  waitsForTeam,
  type ThreadFacts,
  type ThreadMessageFact,
} from "@/lib/use-cases/referent/thread";
import { referentDateLabel } from "@/lib/use-cases/referent/view";
import type { NeedStatus } from "@/lib/use-cases/needs";
import type { ServiceResult, WriteContext } from "@/lib/use-cases/service";

/**
 * (Rilascio 6) «Il filo con il referente»: le letture per la scheda e le scritture, del team e del referente.
 *
 * - **Il team** (revisori con `canEditNeeds`, riletti a ogni chiamata): «Chiedi un chiarimento» su una
 *   risposta del referente (una domanda, una voce di «Benefici e costi», la conferma), «Rispondi» a un suo
 *   dubbio, «Fatto» su una sua risposta a un chiarimento. Ogni novità per il referente va sulla stessa
 *   richiesta e sullo stesso link, che si rinnova per 30 giorni; un chiarimento riapre una richiesta
 *   completata e riporta l'informazione «In attesa».
 * - **Il referente** (dal link, `ReferentLink`; la pagina e le rotte le aggiunge la parte del referente):
 *   «Ho un dubbio», la risposta a un chiarimento, «Aggiungi qualcosa», la modifica di una risposta finché
 *   il team non la segna «A posto» (decisione 3 del titolare), «visto».
 * - **Una transazione**: ogni scrittura è un batch con la sua Storia, gli stati delle esigenze, la
 *   campanella, l'avviso a chi ha chiesto e la coda delle email; le email partono dopo (`after()` di chi
 *   chiama) o al giro del cron.
 * - **Art. 15.4**: nessun conteggio o ordinamento per persona; i fili sono per richiesta, in ordine di tempo.
 *   Il testo dei messaggi non va mai nella Storia, nella campanella o nelle email.
 */

const T = REFERENT_THREAD_TEXT;
const RULES = REFERENT_THREAD_RULES;
const MSG = REFERENT_ERROR_MESSAGES;
const ok = <V>(value: V): { ok: true; value: V } => ({ ok: true, value });
const persona = (userId: string): ReferentActor => ({ kind: "persona", userId });
const REFERENT_ACTOR: ReferentActor = { kind: "referente" };
const ANCHORS: readonly ReferentThreadAnchor[] = ["domanda", "beneficio", "generale"];
const KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

// ─── L'ancora di un messaggio ────────────────────────────────────────

export interface ThreadAnchorInput {
  anchor: ReferentThreadAnchor;
  needId: string | null;
  componentKey: string | null;
}

/** L'ancora dal corpo di una chiamata: una domanda con la sua esigenza, una voce con la sua chiave, «Generale». */
export function anchorOf(body: Record<string, unknown>): ThreadAnchorInput | null {
  const anchor = body.anchor;
  if (typeof anchor !== "string" || !ANCHORS.includes(anchor as ReferentThreadAnchor)) return null;
  if (anchor === "domanda") return isUuid(body.needId) ? { anchor, needId: String(body.needId).toLowerCase(), componentKey: null } : null;
  if (anchor === "beneficio") return typeof body.componentKey === "string" && KEY.test(body.componentKey) ? { anchor, needId: null, componentKey: body.componentKey } : null;
  return { anchor: "generale", needId: null, componentKey: null };
}

/** `m.anchor = … AND m.need_id … AND m.component_key …` per l'alias `m`. */
function anchorFilter(alias: string, a: ThreadAnchorInput): SqlFragment {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error("Alias non valido");
  const m = raw(alias);
  if (a.anchor === "domanda") return ucSql`${m}.anchor = 'domanda' AND ${m}.need_id = ${cast(a.needId, "uuid")}`;
  if (a.anchor === "beneficio") return ucSql`${m}.anchor = 'beneficio' AND ${m}.component_key = ${cast(a.componentKey, "text")}`;
  return ucSql`${m}.anchor = 'generale'`;
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

// ─── Le porte del team ───────────────────────────────────────────────

/**
 * Le stesse porte dell'invio di «Chiedi al referente» (§3.1): l'ok sui sub-responsabili, le email, le
 * scritture della pagina pubblica. Senza, il referente non saprebbe niente della novità o non potrebbe rispondere.
 */
async function deliveryGates(executor: UcExecutor, workspaceId: string, company: string, env: Env): Promise<ReferentFailure | null> {
  if (!(await loadSubprocessorAck(executor, workspaceId))) return rfailVars("sub_responsabili_mancanti", { Azienda: companyLabel(company) });
  if (!ucEmailConfig(env).ok) return rfail("email_non_configurata");
  if (!referentPublicWritesAvailable(env)) return rfail("risposte_non_attive");
  return null;
}

/** I giorni di Roma in cui la persona ha già un promemoria partito o in coda (la regola di «un'email al giorno»). */
async function remindedOnOf(executor: UcExecutor, workspaceId: string, contactId: string): Promise<Set<string>> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT e.status, e.sent_at, e.scheduled_at FROM use_case_referent_emails e
WHERE e.workspace_id = ${cast(workspaceId, "uuid")} AND e.contact_id = ${cast(contactId, "uuid")} AND e.template = 'promemoria'
  AND ((e.status = 'inviata' AND e.sent_at > now() - interval '10 days') OR e.status = 'in_coda' OR (e.status = 'errore' AND e.attempts < 3))`),
  ]);
  const out = new Set<string>();
  for (const r of rows) {
    const at = rowString(r.status) === "inviata" ? rowDate(r.sent_at) : rowDate(r.scheduled_at);
    if (at) out.add(romeDate(at));
  }
  return out;
}

// ─── La richiesta di un messaggio ────────────────────────────────────

interface ThreadRequest {
  id: string;
  contactId: string;
  contactName: string;
  status: "inviata" | "completata" | "scaduta" | "revocata";
  active: boolean;
  expiresAt: Date;
  revokedAt: Date | null;
  sentAt: Date | null;
  lastEmailAt: Date | null;
  hasValidToken: boolean;
  messages: number;
  hasCheck: boolean;
  checkSubmitted: boolean;
}

async function readThreadRequest(executor: UcExecutor, workspaceId: string, useCaseId: string, requestId: string): Promise<ThreadRequest | null> {
  if (!isUuid(requestId)) return null;
  const [[r]] = await executor.batch([
    toStatement(ucSql`SELECT r.id, r.contact_id, r.status, r.expires_at, r.revoked_at, r.sent_at, r.last_email_at, ${activeRequestSql("r")} AS active,
  ${validLinkSql("r")} AS has_valid_token, coalesce(c.display_name, '') AS contact_name,
  (SELECT count(*)::int FROM use_case_referent_messages m WHERE m.request_id = r.id) AS messages,
  k.request_id IS NOT NULL AS has_check, k.submitted_at IS NOT NULL AS check_submitted
FROM use_case_referent_requests r
LEFT JOIN uc_contacts c ON c.id = r.contact_id AND c.workspace_id = r.workspace_id
LEFT JOIN use_case_referent_checks k ON k.request_id = r.id
WHERE r.id = ${cast(requestId, "uuid")} AND r.workspace_id = ${cast(workspaceId, "uuid")} AND r.use_case_id = ${cast(useCaseId, "uuid")}`),
  ]);
  if (!r) return null;
  const expiresAt = rowDate(r.expires_at);
  if (!expiresAt) return null;
  return {
    id: String(r.id).toLowerCase(),
    contactId: String(r.contact_id).toLowerCase(),
    contactName: rowString(r.contact_name) || REFERENT_UI_TEXT.referentAuthorFallback,
    status: (rowString(r.status) ?? "inviata") as ThreadRequest["status"],
    active: rowBool(r.active),
    expiresAt,
    revokedAt: rowDate(r.revoked_at),
    sentAt: rowDate(r.sent_at),
    lastEmailAt: rowDate(r.last_email_at),
    hasValidToken: rowBool(r.has_valid_token),
    messages: rowNumber(r.messages) ?? 0,
    hasCheck: rowBool(r.has_check),
    checkSubmitted: rowBool(r.check_submitted),
  };
}

/**
 * L'email di una novità del team per il referente (`threadEmailAt`: al massimo una al giorno, in orario
 * d'ufficio), con la scadenza già rinnovata. null: nessuna email (la prima non è ancora partita, il link
 * è chiuso); la novità la porta l'email della richiesta o il prossimo promemoria.
 */
async function threadEmailStatement(
  executor: UcExecutor,
  workspaceId: string,
  request: ThreadRequest,
  counts: { clarifications?: number; replies?: number },
  now: Date,
): Promise<{ statement: UcStatement; at: Date } | null> {
  const renewed = new Date(Math.max(request.expiresAt.getTime(), now.getTime() + 30 * 86_400_000));
  const remindedOn = await remindedOnOf(executor, workspaceId, request.contactId);
  const at = threadEmailAt(
    { status: request.status, revokedAt: request.revokedAt, expiresAt: renewed, sentAt: request.sentAt, lastEmailAt: request.lastEmailAt, addressChanged: request.sentAt !== null && !request.hasValidToken },
    now,
    remindedOn,
  );
  if (!at) return null;
  return {
    at,
    statement: queueThreadEmailItemSql({ workspaceId, contactId: request.contactId, requestId: request.id, ...counts, dedupeKey: `pm:${request.id}:${romeDate(at)}`, at }),
  };
}

// ─── Lettura per la scheda ───────────────────────────────────────────

/** I messaggi delle richieste di uno use case (tranne le revocate), in ordine di tempo; mai per persona. */
export function threadMessagesSql(workspaceId: string, useCaseId: string): UcStatement {
  return toStatement(ucSql`SELECT m.id, m.request_id, m.anchor, m.need_id, m.component_key, m.side, m.kind, m.reply_to_id, m.body, m.created_at, m.seen_at, m.handled_at, m.removed_at,
  coalesce(nullif(btrim(u.name), ''), '') AS author_name, coalesce(c.display_name, '') AS contact_name, ${activeRequestSql("r")} AS request_active,
  (SELECT i.question FROM use_case_referent_request_items i WHERE i.request_id = m.request_id AND i.need_id = m.need_id) AS question,
  (SELECT b.label FROM use_case_referent_check_benefits b WHERE b.request_id = m.request_id AND b.component_key = m.component_key) AS benefit_label
FROM use_case_referent_messages m
JOIN use_case_referent_requests r ON r.id = m.request_id AND r.workspace_id = m.workspace_id
LEFT JOIN uc_contacts c ON c.id = r.contact_id AND c.workspace_id = r.workspace_id
LEFT JOIN users u ON u.id = m.author_user_id
WHERE m.workspace_id = ${cast(workspaceId, "uuid")} AND m.use_case_id = ${cast(useCaseId, "uuid")} AND r.status <> 'revocata'
ORDER BY m.created_at, m.id
LIMIT 400`);
}

/** Le proposte dell'AI ancora da decidere di uno use case (solo per i revisori che modificano «Cosa serve»). */
export function threadSuggestionsSql(workspaceId: string, useCaseId: string): UcStatement {
  return toStatement(ucSql`SELECT s.id, s.request_id, s.anchor, s.need_id, s.component_key, s.body, s.source_at
FROM use_case_referent_suggestions s
JOIN use_case_referent_requests r ON r.id = s.request_id AND r.workspace_id = s.workspace_id
WHERE s.workspace_id = ${cast(workspaceId, "uuid")} AND s.use_case_id = ${cast(useCaseId, "uuid")} AND s.status = 'proposta' AND ${activeRequestSql("r")}
  AND ${raw(latestSuggestionSql("s"))}
ORDER BY s.created_at, s.id
LIMIT 100`);
}

export interface ThreadRow extends ThreadMessageFact {
  authorName: string;
  contactName: string;
  requestActive: boolean;
  question: string | null;
  benefitLabel: string | null;
}

export function threadRowOf(r: UcRow): ThreadRow | null {
  const createdAt = rowDate(r.created_at);
  const anchor = rowString(r.anchor) as ReferentThreadAnchor | null;
  if (!createdAt || !anchor) return null;
  return {
    id: String(r.id).toLowerCase(),
    requestId: String(r.request_id).toLowerCase(),
    anchor,
    needId: rowString(r.need_id)?.toLowerCase() ?? null,
    componentKey: rowString(r.component_key),
    side: rowString(r.side) === "team" ? "team" : "referente",
    kind: (rowString(r.kind) ?? "risposta") as ThreadMessageFact["kind"],
    replyToId: rowString(r.reply_to_id)?.toLowerCase() ?? null,
    body: rowString(r.body),
    createdAt,
    seenAt: rowDate(r.seen_at),
    handledAt: rowDate(r.handled_at),
    removedAt: rowDate(r.removed_at),
    authorName: rowString(r.author_name) ?? "",
    contactName: rowString(r.contact_name) ?? "",
    requestActive: rowBool(r.request_active),
    question: rowString(r.question),
    benefitLabel: rowString(r.benefit_label),
  };
}

/** I fatti del filo di ogni richiesta (per gli stati e il turno). */
export function threadFactsByRequest(rows: readonly ThreadRow[]): Map<string, ThreadFacts> {
  const by = new Map<string, ThreadRow[]>();
  for (const r of rows) by.set(r.requestId, [...(by.get(r.requestId) ?? []), r]);
  return new Map([...by].map(([id, list]) => [id, threadFactsOf(list)]));
}

/** «Su «Volumi mensili»», «Su «Meno errori»», «In generale». */
function anchorLabelOf(r: ThreadRow): string {
  const short = (text: string) => (text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text);
  if (r.anchor === "domanda" && r.question) return fillText(T.onQuestion, { testo: short(r.question) });
  if (r.anchor === "beneficio" && r.benefitLabel) return fillText(T.onBenefit, { testo: short(r.benefitLabel) });
  return T.general;
}

/** Le righe del filo per la scheda. Solo per chi vede «Cosa serve»; i pulsanti solo per chi lo modifica. */
export function threadMessageViewsOf(rows: readonly ThreadRow[], o: { today: string; canAct: boolean }): ThreadMessageView[] {
  return rows.map((r) => {
    const author =
      r.side === "team"
        ? r.authorName
          ? fillText(REFERENT_UI_TEXT.teamAuthor, { Nome: r.authorName })
          : REFERENT_UI_TEXT.teamAuthorFallback
        : r.contactName || REFERENT_UI_TEXT.referentAuthorFallback;
    return {
      id: r.id,
      requestId: r.requestId,
      anchor: r.anchor,
      needId: r.needId,
      componentKey: r.componentKey,
      anchorKey: anchorKeyOf(r),
      anchorLabel: anchorLabelOf(r),
      side: r.side,
      kind: r.kind,
      header: fillText(T.header, { autore: author, data: referentDateLabel(r.createdAt, o.today) }),
      text: r.removedAt ? null : r.body,
      waiting: waitsForReferent(r) || waitsForTeam(r) || newsForTeam(r),
      canReply: o.canAct && r.requestActive && waitsForTeam(r),
      canDone: o.canAct && newsForTeam(r),
    };
  });
}

export function threadSuggestionViewsOf(rows: readonly UcRow[]): ThreadSuggestionView[] {
  return rows.flatMap((r) => {
    const anchor = rowString(r.anchor) as ReferentThreadAnchor | null;
    const text = rowString(r.body);
    if (!anchor || !text) return [];
    const needId = rowString(r.need_id)?.toLowerCase() ?? null;
    const componentKey = rowString(r.component_key);
    return [{ id: String(r.id).toLowerCase(), requestId: String(r.request_id).toLowerCase(), anchorKey: anchorKeyOf({ anchor, needId, componentKey }), text }];
  });
}

/**
 * Dove si può chiedere un chiarimento su una risposta del referente: la sua richiesta è attiva (non revocata,
 * non scaduta), e non c'è già un chiarimento in attesa sull'ancora (`pending` lo dice, con il testo).
 */
export function clarifyTargetOf(
  rows: readonly ThreadRow[],
  i: { requestId: string; requestActive: boolean; contactName: string; anchor: ThreadAnchorInput; quote: string; canAct: boolean },
): ClarifyTarget | null {
  if (!i.canAct || !i.requestActive) return null;
  const key = anchorKeyOf(i.anchor);
  const open = rows.find((r) => r.requestId === i.requestId && anchorKeyOf(r) === key && waitsForReferent(r));
  return {
    requestId: i.requestId,
    anchor: i.anchor.anchor,
    needId: i.anchor.needId,
    componentKey: i.anchor.componentKey,
    contactName: i.contactName,
    quote: i.quote.length > 140 ? `${i.quote.slice(0, 139).trimEnd()}…` : i.quote,
    pending: open ? (open.removedAt ? T.removed : (open.body ?? "")) : null,
  };
}

// ─── Il team: «Chiedi un chiarimento» ────────────────────────────────

/** Il corpo di «Chiedi un chiarimento»: la richiesta della risposta, l'ancora, la riga, la proposta dell'AI usata. */
export interface ClarifyInput {
  requestId: string;
  anchor: ReferentThreadAnchor;
  needId?: string | null;
  componentKey?: string | null;
  text: string;
  suggestionId?: string | null;
}

/**
 * C'è una risposta del referente su questa ancora della richiesta: una risposta inviata (o «Non ce l'ho»)
 * alla domanda, una sua risposta sulla voce, la conferma inviata («Generale»), oppure un suo messaggio lì.
 */
function answeredAnchorSql(workspaceId: string, requestId: string, a: ThreadAnchorInput): UcStatement {
  const req = cast(requestId, "uuid");
  const ws = cast(workspaceId, "uuid");
  const own = ucSql`EXISTS (SELECT 1 FROM use_case_referent_messages om WHERE om.request_id = ${req} AND om.side = 'referente' AND om.removed_at IS NULL AND ${anchorFilter("om", a)})`;
  const answer =
    a.anchor === "domanda"
      ? ucSql`EXISTS (SELECT 1 FROM use_case_need_answers na JOIN use_case_needs nn ON nn.id = na.need_id AND nn.workspace_id = na.workspace_id
           WHERE na.request_id = ${req} AND na.workspace_id = ${ws} AND na.need_id = ${cast(a.needId, "uuid")} AND na.source = 'referente' AND na.status = 'inviata'
             AND na.removed_at IS NULL AND nn.archived_at IS NULL AND nn.type = 'requisito')`
      : a.anchor === "beneficio"
        ? ucSql`EXISTS (SELECT 1 FROM use_case_referent_check_benefits nb JOIN use_case_referent_checks nk ON nk.request_id = nb.request_id
           WHERE nb.request_id = ${req} AND nb.workspace_id = ${ws} AND nb.component_key = ${cast(a.componentKey, "text")} AND nk.submitted_at IS NOT NULL)`
        : ucSql`EXISTS (SELECT 1 FROM use_case_referent_checks nk WHERE nk.request_id = ${req} AND nk.workspace_id = ${ws} AND nk.submitted_at IS NOT NULL)`;
  return toStatement(ucSql`SELECT (${answer} OR ${own}) AS answered,
  EXISTS (SELECT 1 FROM use_case_referent_messages pm WHERE pm.request_id = ${req} AND pm.side = 'team' AND pm.kind = 'chiarimento'
    AND pm.handled_at IS NULL AND pm.removed_at IS NULL AND ${anchorFilter("pm", a)}) AS pending`);
}

export const askReferentClarification = guardedReferent(
  "chiarimento",
  async function askReferentClarification(
    ctx: WriteContext,
    useCaseId: string,
    input: unknown,
    deps: { env: Env; now?: Date },
  ): Promise<ServiceResult<{ messageId: string; requestId: string; contactName: string; emailQueued: boolean }> | ReferentFailure> {
    const now = deps.now ?? new Date();
    const writer = await referentWriter(ctx, deps.env);
    if (!writer.ok) return writer;
    const body = record(input);
    const anchor = anchorOf(body);
    if (!isUuid(useCaseId) || !isUuid(body.requestId) || !anchor) return rfail("non_trovato");
    const line = checkThreadLine(body.text, RULES.teamLineMax);
    if (!line.ok) return rfail(line.code, line.message, { text: line.message });
    const suggestionId = body.suggestionId === undefined || body.suggestionId === null ? null : isUuid(body.suggestionId) ? String(body.suggestionId).toLowerCase() : "x";
    if (suggestionId === "x") return rfail("suggerimento_non_trovato");
    const executor = await getAppUcExecutor();
    const card = await readCard(executor, ctx.workspaceId, useCaseId);
    if (!card) return rfail("non_trovato");
    const gate = await deliveryGates(executor, ctx.workspaceId, card.company, deps.env);
    if (gate) return gate;
    const request = await readThreadRequest(executor, ctx.workspaceId, card.id, String(body.requestId));
    if (!request) return rfail("non_trovato");
    if (!request.active) return rfail("filo_non_disponibile");
    if (request.messages >= RULES.messagesPerRequest) return rfail("filo_pieno");
    const [[facts]] = await executor.batch([answeredAnchorSql(ctx.workspaceId, request.id, anchor)]);
    if (!rowBool(facts?.answered)) return rfail("filo_non_disponibile");
    if (rowBool(facts?.pending)) return rfail("chiarimento_aperto");
    if (suggestionId) {
      const [[s]] = await executor.batch([
        toStatement(ucSql`SELECT 1 AS ok FROM use_case_referent_suggestions s
WHERE s.id = ${cast(suggestionId, "uuid")} AND s.request_id = ${cast(request.id, "uuid")} AND s.status = 'proposta' AND ${anchorFilter("s", anchor)}`),
      ]);
      if (!s) return rfail("suggerimento_non_trovato");
    }
    const ws = cast(ctx.workspaceId, "uuid");
    const req = cast(request.id, "uuid");
    const actor = persona(writer.userId);
    const email = await threadEmailStatement(executor, ctx.workspaceId, { ...request, status: "inviata" }, { clarifications: 1 }, now);
    const statements: UcStatement[] = [
      lockRequestSql(ctx.workspaceId, request.id),
      ...reopenRequestStatements({ workspaceId: ctx.workspaceId, requestId: request.id }),
      ...renewLinkStatements({ workspaceId: ctx.workspaceId, requestId: request.id }),
    ];
    const inserted = statements.length;
    statements.push(
      toStatement(ucSql`WITH ins AS (
  INSERT INTO use_case_referent_messages (request_id, workspace_id, use_case_id, anchor, need_id, component_key, side, kind, author_user_id, body)
  SELECT r.id, r.workspace_id, r.use_case_id, ${cast(anchor.anchor, "text")}, ${cast(anchor.needId, "uuid")}, ${cast(anchor.componentKey, "text")}, 'team', 'chiarimento', ${cast(writer.userId, "uuid")}, ${cast(line.value, "text")}
  FROM use_case_referent_requests r WHERE r.id = ${req} AND r.workspace_id = ${ws} AND r.use_case_id = ${cast(card.id, "uuid")} AND r.status = 'inviata' AND ${activeRequestSql("r")}
  RETURNING id
)
SELECT (SELECT id FROM ins) AS id, uc_require((SELECT count(*) FROM ins) = 1, 'filo_non_disponibile') AS ok`),
      // Le risposte del referente sulla stessa ancora: il chiarimento nuovo le ha guardate.
      toStatement(ucSql`UPDATE use_case_referent_messages m SET handled_at = now(), handled_by_user_id = ${cast(writer.userId, "uuid")}
WHERE m.request_id = ${req} AND m.side = 'referente' AND m.kind IN ('risposta', 'aggiunta') AND m.handled_at IS NULL AND ${anchorFilter("m", anchor)}`),
    );
    // L'informazione torna «In attesa»: la risposta a cui si chiede di più non basta ancora.
    if (anchor.anchor === "domanda") {
      statements.push(needTransitionSql({ workspaceId: ctx.workspaceId, needIds: [anchor.needId!], from: CLARIFY_FROM_STATUSES, to: "chiesta", actor }));
    }
    if (suggestionId) {
      statements.push(
        toStatement(ucSql`UPDATE use_case_referent_suggestions SET status = 'usata', decided_at = now(), decided_by_user_id = ${cast(writer.userId, "uuid")}, updated_at = now()
WHERE id = ${cast(suggestionId, "uuid")} AND request_id = ${req} AND status = 'proposta'`),
      );
    }
    statements.push(referentEventSql({ workspaceId: ctx.workspaceId, useCaseId: card.id, code: "chiarimento", actor }));
    if (email) statements.push(email.statement);
    statements.push(...cardSyncStatements({ workspaceId: ctx.workspaceId, useCaseIds: [card.id], actorUserId: writer.userId, readiness: await readinessSyncFor(ctx.workspaceId, deps.env, now) }));
    const run = await referentBatch(executor, statements);
    if (!run.ok) return run;
    const messageId = rowString(run.rows[inserted]?.[0]?.id)?.toLowerCase() ?? "";
    return ok({ messageId, requestId: request.id, contactName: request.contactName, emailQueued: email !== null && email.at.getTime() <= now.getTime() });
  },
);

// ─── Il team: «Rispondi» a un dubbio, «Fatto», «Lascia stare» ───────

interface MessageFacts {
  id: string;
  requestId: string;
  side: "team" | "referente";
  kind: string;
  anchor: ThreadAnchorInput;
  handled: boolean;
  removed: boolean;
}

async function readMessage(executor: UcExecutor, workspaceId: string, useCaseId: string, messageId: string): Promise<MessageFacts | null> {
  if (!isUuid(messageId)) return null;
  const [[m]] = await executor.batch([
    toStatement(ucSql`SELECT m.id, m.request_id, m.side, m.kind, m.anchor, m.need_id, m.component_key, m.handled_at IS NOT NULL AS handled, m.removed_at IS NOT NULL AS removed
FROM use_case_referent_messages m JOIN use_case_referent_requests r ON r.id = m.request_id AND r.workspace_id = m.workspace_id
WHERE m.id = ${cast(messageId, "uuid")} AND m.workspace_id = ${cast(workspaceId, "uuid")} AND m.use_case_id = ${cast(useCaseId, "uuid")} AND r.status <> 'revocata'`),
  ]);
  if (!m) return null;
  const anchor = anchorOf({ anchor: rowString(m.anchor), needId: rowString(m.need_id), componentKey: rowString(m.component_key) });
  if (!anchor) return null;
  return {
    id: String(m.id).toLowerCase(),
    requestId: String(m.request_id).toLowerCase(),
    side: rowString(m.side) === "team" ? "team" : "referente",
    kind: rowString(m.kind) ?? "",
    anchor,
    handled: rowBool(m.handled),
    removed: rowBool(m.removed),
  };
}

export const answerReferentDoubt = guardedReferent(
  "risposta_dubbio",
  async function answerReferentDoubt(
    ctx: WriteContext,
    useCaseId: string,
    input: unknown,
    deps: { env: Env; now?: Date },
  ): Promise<ServiceResult<{ messageId: string; requestId: string; contactName: string; emailQueued: boolean }> | ReferentFailure> {
    const now = deps.now ?? new Date();
    const writer = await referentWriter(ctx, deps.env);
    if (!writer.ok) return writer;
    const body = record(input);
    if (!isUuid(useCaseId) || !isUuid(body.messageId)) return rfail("non_trovato");
    const line = checkThreadLine(body.text, RULES.teamLineMax);
    if (!line.ok) return rfail(line.code, line.message, { text: line.message });
    const executor = await getAppUcExecutor();
    const card = await readCard(executor, ctx.workspaceId, useCaseId);
    if (!card) return rfail("non_trovato");
    const gate = await deliveryGates(executor, ctx.workspaceId, card.company, deps.env);
    if (gate) return gate;
    const doubt = await readMessage(executor, ctx.workspaceId, card.id, String(body.messageId));
    if (!doubt || doubt.side !== "referente" || doubt.kind !== "dubbio" || doubt.removed) return rfail("messaggio_non_trovato");
    if (doubt.handled) return rfail("messaggio_gestito");
    const request = await readThreadRequest(executor, ctx.workspaceId, card.id, doubt.requestId);
    if (!request || !request.active) return rfail("filo_non_disponibile");
    if (request.messages >= RULES.messagesPerRequest) return rfail("filo_pieno");
    const req = cast(request.id, "uuid");
    const email = await threadEmailStatement(executor, ctx.workspaceId, request, { replies: 1 }, now);
    const statements: UcStatement[] = [
      lockRequestSql(ctx.workspaceId, request.id),
      toStatement(ucSql`WITH upd AS (
  UPDATE use_case_referent_messages SET handled_at = now(), handled_by_user_id = ${cast(writer.userId, "uuid")}
  WHERE id = ${cast(doubt.id, "uuid")} AND request_id = ${req} AND handled_at IS NULL AND removed_at IS NULL
  RETURNING id
)
${casTail("upd", 1, "messaggio_gestito")}`),
      ...renewLinkStatements({ workspaceId: ctx.workspaceId, requestId: request.id }),
      toStatement(ucSql`INSERT INTO use_case_referent_messages (request_id, workspace_id, use_case_id, anchor, need_id, component_key, side, kind, author_user_id, reply_to_id, body)
SELECT r.id, r.workspace_id, r.use_case_id, ${cast(doubt.anchor.anchor, "text")}, ${cast(doubt.anchor.needId, "uuid")}, ${cast(doubt.anchor.componentKey, "text")}, 'team', 'risposta',
  ${cast(writer.userId, "uuid")}, ${cast(doubt.id, "uuid")}, ${cast(line.value, "text")}
FROM use_case_referent_requests r WHERE r.id = ${req} AND ${activeRequestSql("r")}
RETURNING id`),
      referentEventSql({ workspaceId: ctx.workspaceId, useCaseId: card.id, code: "dubbio_risposto", actor: persona(writer.userId) }),
    ];
    if (email) statements.push(email.statement);
    const run = await referentBatch(executor, statements);
    if (!run.ok) return run;
    const messageId = rowString(run.rows[4]?.[0]?.id)?.toLowerCase() ?? "";
    if (!messageId) return rfail("filo_non_disponibile");
    return ok({ messageId, requestId: request.id, contactName: request.contactName, emailQueued: email !== null && email.at.getTime() <= now.getTime() });
  },
);

/** «Fatto» su una risposta o un'aggiunta del referente a una voce o a «Generale»: il team l'ha guardata. */
export const markReferentMessageDone = guardedReferent(
  "filo_fatto",
  async function markReferentMessageDone(ctx: WriteContext, useCaseId: string, messageId: string, deps: { env: Env }): Promise<ServiceResult<{ done: true }> | ReferentFailure> {
    const writer = await referentWriter(ctx, deps.env);
    if (!writer.ok) return writer;
    if (!isUuid(useCaseId) || !isUuid(messageId)) return rfail("non_trovato");
    const executor = await getAppUcExecutor();
    const m = await readMessage(executor, ctx.workspaceId, useCaseId, messageId);
    if (!m || m.side !== "referente" || (m.kind !== "risposta" && m.kind !== "aggiunta") || m.anchor.anchor === "domanda") return rfail("messaggio_non_trovato");
    if (m.handled) return ok({ done: true });
    const run = await referentBatch(executor, [
      toStatement(ucSql`UPDATE use_case_referent_messages SET handled_at = now(), handled_by_user_id = ${cast(writer.userId, "uuid")}
WHERE id = ${cast(m.id, "uuid")} AND workspace_id = ${cast(ctx.workspaceId, "uuid")} AND handled_at IS NULL`),
    ]);
    if (!run.ok) return run;
    return ok({ done: true });
  },
);

/** «Lascia stare» su una proposta dell'AI: non si mostra più; niente parte. */
export const dismissReferentSuggestion = guardedReferent(
  "suggerimento_scartato",
  async function dismissReferentSuggestion(ctx: WriteContext, useCaseId: string, suggestionId: string, deps: { env: Env }): Promise<ServiceResult<{ dismissed: true }> | ReferentFailure> {
    const writer = await referentWriter(ctx, deps.env);
    if (!writer.ok) return writer;
    if (!isUuid(useCaseId) || !isUuid(suggestionId)) return rfail("non_trovato");
    const executor = await getAppUcExecutor();
    const run = await referentBatch(executor, [
      toStatement(ucSql`UPDATE use_case_referent_suggestions SET status = 'scartata', decided_at = now(), decided_by_user_id = ${cast(writer.userId, "uuid")}, updated_at = now()
WHERE id = ${cast(suggestionId, "uuid")} AND workspace_id = ${cast(ctx.workspaceId, "uuid")} AND use_case_id = ${cast(useCaseId, "uuid")} AND status = 'proposta'
RETURNING id`),
    ]);
    if (!run.ok) return run;
    if (!run.rows[0]?.length) return rfail("suggerimento_non_trovato");
    return ok({ dismissed: true });
  },
);

// ─── Il referente (dal link) ─────────────────────────────────────────

const pfail = <V>(code: string, message?: string, issues?: Issue[]): PublicOutcome<V> => publicFail<V>(code, message ?? MSG[code] ?? MSG.riprova, issues);
const notAvailable = <V>() => pfail<V>("domanda_non_disponibile", MSG.domanda_non_disponibile_pubblica);

/** Il filo si scrive dal link finché la richiesta è attiva: «inviata» o «completata», non scaduta. */
function threadWritable(link: ReferentLink, now: Date): boolean {
  return (link.status === "inviata" || link.status === "completata") && link.expiresAt.getTime() > now.getTime() && link.privacyAccepted;
}

/** La richiesta del link, riletta adesso: attiva, con l'informativa letta di questa versione e (per un messaggio nuovo) non piena. */
async function linkRequestOk(executor: UcExecutor, link: ReferentLink, o: { newMessage: boolean } = { newMessage: true }): Promise<boolean> {
  const [[r]] = await executor.batch([
    toStatement(ucSql`SELECT r.privacy_accepted_at, r.privacy_notice_version, ${activeRequestSql("r")} AS active, (SELECT count(*)::int FROM use_case_referent_messages m WHERE m.request_id = r.id) AS messages
FROM use_case_referent_requests r WHERE r.id = ${cast(link.requestId, "uuid")} AND r.workspace_id = ${cast(link.workspaceId, "uuid")}`),
  ]);
  return Boolean(r) && rowBool(r.active) && privacyAccepted({ privacyAcceptedAt: rowDate(r.privacy_accepted_at), privacyNoticeVersion: rowString(r.privacy_notice_version) }) && (!o.newMessage || (rowNumber(r.messages) ?? 0) < RULES.messagesPerRequest);
}

/** L'ancora appartiene alla richiesta del link: una sua domanda, una sua voce, «Generale». */
function anchorOfRequestSql(link: ReferentLink, a: ThreadAnchorInput): UcStatement {
  const req = cast(link.requestId, "uuid");
  if (a.anchor === "domanda") {
    return toStatement(ucSql`SELECT n.status, n.archived_at IS NOT NULL AS archived FROM use_case_referent_request_items i
JOIN use_case_needs n ON n.id = i.need_id AND n.workspace_id = i.workspace_id
JOIN use_case_need_links l ON l.need_id = n.id AND l.use_case_id = ${cast(link.useCaseId, "uuid")}
WHERE i.request_id = ${req} AND i.need_id = ${cast(a.needId, "uuid")} AND n.type = 'requisito'`);
  }
  if (a.anchor === "beneficio") {
    return toStatement(ucSql`SELECT NULL::text AS status, false AS archived FROM use_case_referent_check_benefits b WHERE b.request_id = ${req} AND b.component_key = ${cast(a.componentKey, "text")}`);
  }
  return toStatement(ucSql`SELECT NULL::text AS status, false AS archived`);
}

/** La campanella dei revisori, l'avviso a chi ha chiesto e la Storia per una novità del referente. */
function referentNewsStatements(link: ReferentLink, actorUserId: string | null, i: { answers: number; questions: number; code: "dubbio" | "chiarimento_risposto" | "aggiunta" | "risposta_cambiata"; now: Date }): UcStatement[] {
  return [
    referentEventSql({ workspaceId: link.workspaceId, useCaseId: link.useCaseId, code: i.code, actor: REFERENT_ACTOR }),
    notifyReviewersSql({ workspaceId: link.workspaceId, useCaseId: link.useCaseId, kind: i.questions > 0 ? "domanda" : "risposte", answers: i.answers, actorUserId }),
    queueRequesterAlertSql({
      workspaceId: link.workspaceId,
      target: { requestId: link.requestId },
      answers: i.answers,
      unknowns: 0,
      documents: 0,
      questions: i.questions,
      followUp: null,
      actorUserId,
      immediate: true,
      schedule: alertSchedule(i.now),
      now: i.now,
    }),
  ];
}

/** L'informazione di una domanda torna «Da verificare» dopo una risposta del referente nel filo. */
function needToVerifySql(link: ReferentLink, needId: string): UcStatement {
  return needTransitionSql({ workspaceId: link.workspaceId, needIds: [needId], from: REPLY_TO_VERIFY_FROM_STATUSES, to: "in_verifica", actor: REFERENT_ACTOR });
}

function insertReferentMessageSql(link: ReferentLink, a: ThreadAnchorInput, kind: "dubbio" | "risposta" | "aggiunta", text: string, replyToId: string | null): UcStatement {
  const req = cast(link.requestId, "uuid");
  return toStatement(ucSql`WITH ins AS (
  INSERT INTO use_case_referent_messages (request_id, workspace_id, use_case_id, anchor, need_id, component_key, side, kind, reply_to_id, body)
  SELECT r.id, r.workspace_id, r.use_case_id, ${cast(a.anchor, "text")}, ${cast(a.needId, "uuid")}, ${cast(a.componentKey, "text")}, 'referente', ${cast(kind, "text")}, ${cast(replyToId, "uuid")}, ${cast(text, "text")}
  FROM use_case_referent_requests r WHERE r.id = ${req} AND r.workspace_id = ${cast(link.workspaceId, "uuid")} AND ${activeRequestSql("r")}
  RETURNING id
)
SELECT (SELECT id FROM ins) AS id, uc_require((SELECT count(*) FROM ins) = 1, 'domanda_non_disponibile') AS ok`);
}

/**
 * Dopo una risposta del referente a un chiarimento: se non resta niente di aperto per lui (domande,
 * conferma, chiarimenti), la richiesta torna «completata», con la coda annullata e la riga nella Storia.
 */
function completeIfDoneStatements(link: ReferentLink): UcStatement[] {
  const ws = cast(link.workspaceId, "uuid");
  const req = cast(link.requestId, "uuid");
  const filter = ucSql`r.id = ${req} AND r.workspace_id = ${ws} AND r.status = 'completata' AND r.completed_at = now()`;
  return [
    toStatement(ucSql`UPDATE use_case_referent_requests r SET status = 'completata', completed_at = now(), version = version + 1
WHERE r.id = ${req} AND r.workspace_id = ${ws} AND r.status = 'inviata' AND ${openItemsCountSql("r")} = 0`),
    ...cancelQueuedForRequestsStatements({ workspaceId: link.workspaceId, filter, reason: "completata" }),
    referentEventsForRequestsSql({ filter, code: "completata", actor: REFERENT_ACTOR }),
  ];
}

export interface ReferentThreadResult {
  messageId: string;
}

/** «Ho un dubbio»: una domanda del referente al team, su una domanda, una voce o in generale. */
export async function postReferentDoubt(link: ReferentLink, body: unknown, now: Date): Promise<PublicOutcome<ReferentThreadResult>> {
  if (!link.privacyAccepted) return pfail("informativa_da_leggere");
  if (!threadWritable(link, now)) return notAvailable();
  const b = record(body);
  const anchor = anchorOf(b);
  if (!anchor) return pfail("dati_non_validi", "Dati non validi.");
  const text = checkReferentThreadText(b.text, RULES.referentTextMax);
  if (!text.ok) return pfail(text.issues[0]?.code ?? "risposte_da_correggere", text.issues[0]?.message, text.issues);
  const executor = await getAppUcExecutor();
  if (!(await linkRequestOk(executor, link))) return notAvailable();
  const [[own]] = await executor.batch([anchorOfRequestSql(link, anchor)]);
  if (!own) return notAvailable();
  const actorUserId = (await readReferentPerson(executor, link.workspaceId, link.contactId)).userId;
  const run = await referentBatch(executor, [
    lockRequestSql(link.workspaceId, link.requestId),
    insertReferentMessageSql(link, anchor, "dubbio", text.value, null),
    ...referentNewsStatements(link, actorUserId, { answers: 0, questions: 1, code: "dubbio", now }),
  ]);
  if (!run.ok) return run.error === "domanda_non_disponibile" ? notAvailable() : pfail(run.error, run.message);
  return { ok: true, value: { messageId: rowString(run.rows[1]?.[0]?.id)?.toLowerCase() ?? "" } };
}

/** La risposta del referente a un chiarimento del team. */
export async function replyToReferentClarification(link: ReferentLink, body: unknown, now: Date): Promise<PublicOutcome<ReferentThreadResult>> {
  if (!link.privacyAccepted) return pfail("informativa_da_leggere");
  if (!threadWritable(link, now)) return notAvailable();
  const b = record(body);
  if (!isUuid(b.messageId)) return pfail("dati_non_validi", "Dati non validi.");
  const text = checkReferentThreadText(b.text, RULES.referentTextMax);
  if (!text.ok) return pfail(text.issues[0]?.code ?? "risposte_da_correggere", text.issues[0]?.message, text.issues);
  const executor = await getAppUcExecutor();
  if (!(await linkRequestOk(executor, link))) return notAvailable();
  const [[m]] = await executor.batch([
    toStatement(ucSql`SELECT m.id, m.anchor, m.need_id, m.component_key FROM use_case_referent_messages m
WHERE m.id = ${cast(String(b.messageId), "uuid")} AND m.request_id = ${cast(link.requestId, "uuid")} AND m.side = 'team' AND m.kind = 'chiarimento'
  AND m.handled_at IS NULL AND m.removed_at IS NULL`),
  ]);
  const anchor = m ? anchorOf({ anchor: rowString(m.anchor), needId: rowString(m.need_id), componentKey: rowString(m.component_key) }) : null;
  if (!m || !anchor) return notAvailable();
  const actorUserId = (await readReferentPerson(executor, link.workspaceId, link.contactId)).userId;
  const statements: UcStatement[] = [
    lockRequestSql(link.workspaceId, link.requestId),
    toStatement(ucSql`WITH upd AS (
  UPDATE use_case_referent_messages SET handled_at = now() WHERE id = ${cast(String(m.id), "uuid")} AND handled_at IS NULL AND removed_at IS NULL RETURNING id
)
${casTail("upd", 1, "domanda_non_disponibile")}`),
    insertReferentMessageSql(link, anchor, "risposta", text.value, String(m.id)),
  ];
  if (anchor.anchor === "domanda") statements.push(needToVerifySql(link, anchor.needId!));
  // (Decisione 2) L'aiuto dell'AI guarda la risposta, dopo: mai qui dentro.
  const suggest = suggestionQueueSql({ workspaceId: link.workspaceId, requestId: link.requestId, anchors: [anchor], env: process.env });
  if (suggest) statements.push(suggest);
  statements.push(
    ...completeIfDoneStatements(link),
    ...referentNewsStatements(link, actorUserId, { answers: 1, questions: 0, code: "chiarimento_risposto", now }),
    ...cardSyncStatements({ workspaceId: link.workspaceId, useCaseIds: [link.useCaseId], actorUserId, readiness: null }),
  );
  const run = await referentBatch(executor, statements);
  if (!run.ok) return run.error === "domanda_non_disponibile" ? notAvailable() : pfail(run.error, run.message);
  return { ok: true, value: { messageId: rowString(run.rows[2]?.[0]?.id)?.toLowerCase() ?? "" } };
}

/** «Aggiungi qualcosa» a una risposta già inviata: il team la vede di nuovo da verificare. */
export async function addToReferentAnswer(link: ReferentLink, body: unknown, now: Date): Promise<PublicOutcome<ReferentThreadResult>> {
  if (!link.privacyAccepted) return pfail("informativa_da_leggere");
  if (!threadWritable(link, now)) return notAvailable();
  const b = record(body);
  const anchor = anchorOf(b);
  if (!anchor) return pfail("dati_non_validi", "Dati non validi.");
  const text = checkReferentThreadText(b.text, RULES.referentTextMax);
  if (!text.ok) return pfail(text.issues[0]?.code ?? "risposte_da_correggere", text.issues[0]?.message, text.issues);
  const executor = await getAppUcExecutor();
  if (!(await linkRequestOk(executor, link))) return notAvailable();
  const [[answered]] = await executor.batch([answeredAnchorSql(link.workspaceId, link.requestId, anchor)]);
  if (!rowBool(answered?.answered)) return notAvailable();
  const actorUserId = (await readReferentPerson(executor, link.workspaceId, link.contactId)).userId;
  const statements: UcStatement[] = [lockRequestSql(link.workspaceId, link.requestId), insertReferentMessageSql(link, anchor, "aggiunta", text.value, null)];
  if (anchor.anchor === "domanda") statements.push(needToVerifySql(link, anchor.needId!));
  const suggest = suggestionQueueSql({ workspaceId: link.workspaceId, requestId: link.requestId, anchors: [anchor], env: process.env });
  if (suggest) statements.push(suggest);
  statements.push(
    ...referentNewsStatements(link, actorUserId, { answers: 1, questions: 0, code: "aggiunta", now }),
    ...cardSyncStatements({ workspaceId: link.workspaceId, useCaseIds: [link.useCaseId], actorUserId, readiness: null }),
  );
  const run = await referentBatch(executor, statements);
  if (!run.ok) return run.error === "domanda_non_disponibile" ? notAvailable() : pfail(run.error, run.message);
  return { ok: true, value: { messageId: rowString(run.rows[1]?.[0]?.id)?.toLowerCase() ?? "" } };
}

/**
 * La modifica di una risposta già inviata (decisione 3 del titolare): solo finché il team non ha segnato
 * l'informazione «A posto» (o «Non si applica»); dopo, `risposta_chiusa` e resta «Aggiungi qualcosa».
 * Il testo nuovo prende il posto di quello di prima («Aggiornata»), l'informazione torna «Da verificare».
 */
export async function editReferentAnswer(link: ReferentLink, body: unknown, now: Date): Promise<PublicOutcome<{ editedAt: string }>> {
  if (!link.privacyAccepted) return pfail("informativa_da_leggere");
  if (!threadWritable(link, now)) return notAvailable();
  const b = record(body);
  if (!isUuid(b.needId)) return pfail("dati_non_validi", "Dati non validi.");
  const needId = String(b.needId).toLowerCase();
  const text = checkReferentThreadText(b.text, 4000, needId);
  if (!text.ok) return pfail(text.issues[0]?.code ?? "risposte_da_correggere", text.issues[0]?.message, text.issues);
  const executor = await getAppUcExecutor();
  if (!(await linkRequestOk(executor, link, { newMessage: false }))) return notAvailable();
  const [[need]] = await executor.batch([anchorOfRequestSql(link, { anchor: "domanda", needId, componentKey: null })]);
  if (!need) return notAvailable();
  if (!referentCanEdit((rowString(need.status) ?? "da_chiedere") as NeedStatus, rowBool(need.archived))) return pfail("risposta_chiusa");
  const actorUserId = (await readReferentPerson(executor, link.workspaceId, link.contactId)).userId;
  const req = cast(link.requestId, "uuid");
  const ws = cast(link.workspaceId, "uuid");
  const run = await referentBatch(executor, [
    lockRequestSql(link.workspaceId, link.requestId),
    toStatement(ucSql`WITH upd AS (
  UPDATE use_case_need_answers a SET body = ${cast(text.value, "text")}, dont_know = false, already_attached = false, edited_at = now(), updated_at = now()
  FROM use_case_needs n
  WHERE a.request_id = ${req} AND a.workspace_id = ${ws} AND a.need_id = ${cast(needId, "uuid")} AND a.source = 'referente' AND a.status = 'inviata' AND a.removed_at IS NULL
    AND n.id = a.need_id AND n.workspace_id = a.workspace_id AND n.archived_at IS NULL AND n.status <> ALL(${cast(["validata", "non_applicabile"], "text[]")})
  RETURNING a.edited_at
)
SELECT (SELECT edited_at FROM upd) AS edited_at, uc_require((SELECT count(*) FROM upd) = 1, 'risposta_chiusa') AS ok`),
    // Una domanda chiusa con «Non ce l'ho» che adesso ha una risposta.
    toStatement(ucSql`UPDATE use_case_referent_request_items SET state = 'risposta' WHERE request_id = ${req} AND need_id = ${cast(needId, "uuid")} AND state = 'non_so'`),
    needToVerifySql(link, needId),
    ...[suggestionQueueSql({ workspaceId: link.workspaceId, requestId: link.requestId, anchors: [{ anchor: "domanda", needId, componentKey: null }], env: process.env })].filter((x): x is UcStatement => x !== null),
    ...referentNewsStatements(link, actorUserId, { answers: 1, questions: 0, code: "risposta_cambiata", now }),
    ...cardSyncStatements({ workspaceId: link.workspaceId, useCaseIds: [link.useCaseId], actorUserId, readiness: null }),
  ]);
  if (!run.ok) return run.error === "risposta_chiusa" ? pfail("risposta_chiusa") : pfail(run.error, run.message);
  const at = rowDate(run.rows[1]?.[0]?.edited_at) ?? now;
  return { ok: true, value: { editedAt: at.toISOString() } };
}

/** La pagina del referente ha mostrato i messaggi del team: «visto». Nessuna riga nella Storia. */
export async function markTeamMessagesSeen(link: ReferentLink): Promise<void> {
  const executor = await getAppUcExecutor();
  await executor.batch([
    toStatement(ucSql`UPDATE use_case_referent_messages SET seen_at = now()
WHERE request_id = ${cast(link.requestId, "uuid")} AND workspace_id = ${cast(link.workspaceId, "uuid")} AND side = 'team' AND seen_at IS NULL AND removed_at IS NULL`),
  ]);
}

/** Il filo della richiesta del link, per la pagina del referente: i messaggi suoi e del team, mai l'autore del team né le proposte dell'AI. */
export async function readReferentThread(link: ReferentLink): Promise<ThreadMessageFact[]> {
  const executor = await getAppUcExecutor();
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT m.id, m.request_id, m.anchor, m.need_id, m.component_key, m.side, m.kind, m.reply_to_id, m.body, m.created_at, m.seen_at, m.handled_at, m.removed_at
FROM use_case_referent_messages m WHERE m.request_id = ${cast(link.requestId, "uuid")} AND m.workspace_id = ${cast(link.workspaceId, "uuid")} AND m.removed_at IS NULL
ORDER BY m.created_at, m.id`),
  ]);
  return rows
    .map(threadRowOf)
    .filter((r): r is ThreadRow => r !== null)
    .map((r) => ({
      id: r.id,
      requestId: r.requestId,
      anchor: r.anchor,
      needId: r.needId,
      componentKey: r.componentKey,
      side: r.side,
      kind: r.kind,
      replyToId: r.replyToId,
      body: r.body,
      createdAt: r.createdAt,
      seenAt: r.seenAt,
      handledAt: r.handledAt,
      removedAt: r.removedAt,
    }));
}
