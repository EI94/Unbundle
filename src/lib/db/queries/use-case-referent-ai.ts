import "server-only";
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, jsonSchema } from "ai";
import { getAppUcExecutor, type UcExecutor } from "@/lib/db/uc-executor";
import { isUuid, type Env } from "@/lib/db/queries/use-case-referent-base";
import { loadSubprocessorAck } from "@/lib/db/queries/uc-subprocessors";
import { logSafeError } from "@/lib/log/safe-error";
import { portfolioRankingCallSettings } from "@/lib/portfolio/ai-ranking-contract";
import { rowBool, rowNumber, rowString } from "@/lib/uc/sql/readiness";
import { cast, raw, toStatement, ucSql, type UcStatement } from "@/lib/uc/sql/statement";
import type { ReferentThreadAnchor } from "@/lib/db/use-case-hub-referent-thread-ddl";
import {
  FOLLOW_UP_JSON_SCHEMA,
  REFERENT_AI_NOTICE_VERSIONS,
  followUpPrompt,
  noticeAllowsAi,
  parseFollowUp,
  referentAiProviderReady,
  referentAiSuggestionsOn,
  resolveReferentAiModel,
  type FollowUpInput,
} from "@/lib/use-cases/referent/ai-followup";
import { REFERENT_THREAD_LIMITS } from "@/lib/db/use-case-hub-referent-thread-ddl";

/**
 * (Rilascio 6) L'aiuto dell'AI nel filo con il referente, sul database (decisione 2 del titolare): la coda
 * delle proposte e il loro calcolo. Le righe «da_fare» nascono nel batch della risposta del referente (mai
 * un'altra scrittura, mai un errore in più per lui: se l'AI è spenta o l'informativa non lo dice, niente
 * righe); dopo la risposta (`after()`) e a ogni giro del cron si calcolano, con tre tentativi al massimo
 * entro due giorni. Una proposta resta una proposta: la manda una persona, con «Chiedi questo».
 *
 * Nei log solo il nome dell'errore e un codice (`logSafeError`): mai il testo del referente o del modello.
 */

/** Chi calcola la proposta: il modello vero, o (nei test e nel harness) uno finto. Restituisce l'oggetto del modello. */
export type FollowUpGenerator = (i: { prompt: string; model: string }) => Promise<unknown>;

/** Il modello dell'app, con le impostazioni dell'auto-ranking (output strutturato, limite dei token). */
export const providerFollowUpGenerator: FollowUpGenerator = async ({ prompt, model }) => {
  const settings = portfolioRankingCallSettings(model);
  const result = await generateObject({
    model: anthropic(model),
    schema: jsonSchema<Record<string, unknown>>(FOLLOW_UP_JSON_SCHEMA as never),
    prompt,
    providerOptions: settings.providerOptions,
    maxOutputTokens: 2000,
  });
  return result.object;
};

export interface SuggestionAnchor {
  anchor: ReferentThreadAnchor;
  needId: string | null;
  componentKey: string | null;
}

/**
 * Le proposte da calcolare per le risposte appena arrivate su una richiesta, nello stesso batch: solo con
 * l'aiuto acceso (`USE_CASE_REFERENT_AI`, letto da chi chiama) e solo se l'informativa letta dal referente
 * dice dell'AI (`REFERENT_AI_NOTICE_VERSIONS`, controllata qui in SQL). null: niente da mettere in coda.
 */
export function suggestionQueueSql(i: { workspaceId: string; requestId: string; anchors: readonly SuggestionAnchor[]; env: Env }): UcStatement | null {
  if (!referentAiSuggestionsOn(i.env) || i.anchors.length === 0 || !isUuid(i.workspaceId) || !isUuid(i.requestId)) return null;
  const anchors = i.anchors.filter((a) => (a.anchor === "domanda" ? isUuid(a.needId) : a.anchor === "beneficio" ? typeof a.componentKey === "string" && a.componentKey.length > 0 && a.componentKey.length <= 40 : true));
  if (!anchors.length) return null;
  return toStatement(ucSql`INSERT INTO use_case_referent_suggestions (request_id, workspace_id, use_case_id, anchor, need_id, component_key, source_at)
SELECT r.id, r.workspace_id, r.use_case_id, x.anchor, x.need_id, x.component_key, now()
FROM use_case_referent_requests r
CROSS JOIN unnest(${cast(anchors.map((a) => a.anchor), "text[]")}, ${cast(anchors.map((a) => (a.anchor === "domanda" ? a.needId!.toLowerCase() : null)), "uuid[]")}, ${cast(anchors.map((a) => (a.anchor === "beneficio" ? a.componentKey : null)), "text[]")}) AS x(anchor, need_id, component_key)
WHERE r.id = ${cast(i.requestId, "uuid")} AND r.workspace_id = ${cast(i.workspaceId, "uuid")} AND r.privacy_notice_version = ANY(${cast([...REFERENT_AI_NOTICE_VERSIONS], "text[]")})
ON CONFLICT DO NOTHING`);
}

const ANSWER_WORDS: Readonly<Record<string, string>> = Object.freeze({ si: "Sì", meno: "È di meno", piu: "È di più", no: "No", non_so: "Non so" });

interface Claimed {
  id: string;
  requestId: string;
  workspaceId: string;
  anchor: ReferentThreadAnchor;
  needId: string | null;
  componentKey: string | null;
  attempts: number;
}

/** Prende fino a `limit` proposte da calcolare (da fare, o un errore con meno di tre tentativi), con un lease di 2 minuti. */
async function claim(executor: UcExecutor, o: { requestId: string | null; limit: number }): Promise<Claimed[]> {
  const scope = o.requestId ? ucSql` AND s.request_id = ${cast(o.requestId, "uuid")}` : raw("");
  const [rows] = await executor.batch([
    toStatement(ucSql`WITH c AS (
  SELECT s.id FROM use_case_referent_suggestions s
  WHERE s.status IN ('da_fare', 'errore') AND s.attempts < ${cast(REFERENT_THREAD_LIMITS.attempts, "int")} AND s.created_at > now() - interval '2 days'
    AND (s.lease_until IS NULL OR s.lease_until <= now())${scope}
  ORDER BY s.created_at, s.id
  LIMIT ${cast(o.limit, "int")}
  FOR UPDATE SKIP LOCKED
)
UPDATE use_case_referent_suggestions s SET lease_until = now() + interval '2 minutes', attempts = s.attempts + 1, updated_at = now()
FROM c WHERE s.id = c.id
RETURNING s.id, s.request_id, s.workspace_id, s.anchor, s.need_id, s.component_key, s.attempts`),
  ]);
  return rows.flatMap((r): Claimed[] => {
    const anchor = rowString(r.anchor) as ReferentThreadAnchor | null;
    if (!anchor) return [];
    return [
      {
        id: String(r.id).toLowerCase(),
        requestId: String(r.request_id).toLowerCase(),
        workspaceId: String(r.workspace_id).toLowerCase(),
        anchor,
        needId: rowString(r.need_id)?.toLowerCase() ?? null,
        componentKey: rowString(r.component_key),
        attempts: rowNumber(r.attempts) ?? 1,
      },
    ];
  });
}

/** Che cosa ha risposto il referente su un'ancora, e le porte (informativa, richiesta attiva, nessun chiarimento in attesa). */
async function readContent(executor: UcExecutor, s: Claimed): Promise<{ input: FollowUpInput | null; allowed: boolean }> {
  const req = cast(s.requestId, "uuid");
  const anchor =
    s.anchor === "domanda"
      ? ucSql`m.anchor = 'domanda' AND m.need_id = ${cast(s.needId, "uuid")}`
      : s.anchor === "beneficio"
        ? ucSql`m.anchor = 'beneficio' AND m.component_key = ${cast(s.componentKey, "text")}`
        : raw(`m.anchor = 'generale'`);
  const [[head], [latest], [answer]] = await executor.batch([
    toStatement(ucSql`SELECT r.privacy_notice_version, (r.status IN ('inviata', 'completata') AND r.expires_at > now() AND r.purged_at IS NULL) AS active,
  EXISTS (SELECT 1 FROM use_case_referent_messages m WHERE m.request_id = r.id AND m.side = 'team' AND m.kind = 'chiarimento' AND m.handled_at IS NULL AND m.removed_at IS NULL AND ${anchor}) AS clarifying
FROM use_case_referent_requests r WHERE r.id = ${req} AND r.workspace_id = ${cast(s.workspaceId, "uuid")}`),
    toStatement(ucSql`SELECT m.body FROM use_case_referent_messages m
WHERE m.request_id = ${req} AND m.side = 'referente' AND m.kind IN ('risposta', 'aggiunta') AND m.removed_at IS NULL AND ${anchor}
ORDER BY m.created_at DESC, m.id DESC LIMIT 1`),
    s.anchor === "domanda"
      ? toStatement(ucSql`SELECT i.question AS question, a.body, a.dont_know, a.comment FROM use_case_referent_request_items i
LEFT JOIN use_case_need_answers a ON a.request_id = i.request_id AND a.need_id = i.need_id AND a.source = 'referente' AND a.status = 'inviata' AND a.removed_at IS NULL
WHERE i.request_id = ${req} AND i.need_id = ${cast(s.needId, "uuid")}`)
      : s.anchor === "beneficio"
        ? toStatement(ucSql`SELECT b.label AS question, b.answer, b.times_per_month, b.minutes_each, b.eur_year, b.comment FROM use_case_referent_check_benefits b
JOIN use_case_referent_checks k ON k.request_id = b.request_id AND k.submitted_at IS NOT NULL
WHERE b.request_id = ${req} AND b.component_key = ${cast(s.componentKey, "text")}`)
        : toStatement(ucSql`SELECT k.confirm, k.confirm_note AS comment FROM use_case_referent_checks k WHERE k.request_id = ${req} AND k.submitted_at IS NOT NULL`),
  ]);
  if (!head) return { input: null, allowed: false };
  const allowed = noticeAllowsAi(rowString(head.privacy_notice_version)) && rowBool(head.active) && !rowBool(head.clarifying);
  if (!answer && !latest) return { input: null, allowed };
  const reply = rowString(latest?.body);
  if (s.anchor === "domanda") {
    const said = rowString(answer?.body) ?? (answer?.dont_know === true ? "Non ce l'ho" : null);
    const text = reply ?? said;
    return { input: text ? { anchor: "domanda", question: rowString(answer?.question) ?? "", answer: text, comment: reply ? said : rowString(answer?.comment) } : null, allowed };
  }
  if (s.anchor === "beneficio") {
    const numbers = [rowNumber(answer?.times_per_month) !== null ? `${rowNumber(answer?.times_per_month)} volte al mese` : null, rowNumber(answer?.minutes_each) !== null ? `${rowNumber(answer?.minutes_each)} minuti` : null, rowNumber(answer?.eur_year) !== null ? `${rowNumber(answer?.eur_year)} € l'anno` : null]
      .filter(Boolean)
      .join(", ");
    const word = ANSWER_WORDS[rowString(answer?.answer) ?? ""] ?? null;
    const said = [word, numbers || null].filter(Boolean).join(". ") || null;
    const text = reply ?? said;
    return { input: text ? { anchor: "beneficio", question: rowString(answer?.question) ?? "", answer: text, comment: reply ? said : rowString(answer?.comment) } : null, allowed };
  }
  const said = rowString(answer?.confirm) === "si" ? "Sì, è così." : rowString(answer?.comment);
  const text = reply ?? said;
  return { input: text ? { anchor: "generale", question: "La descrizione del caso d'uso è giusta?", answer: text, comment: null } : null, allowed };
}

async function settle(executor: UcExecutor, id: string, status: "proposta" | "nessuna" | "errore", body: string | null, model: string | null): Promise<void> {
  await executor.batch([
    toStatement(ucSql`UPDATE use_case_referent_suggestions SET status = ${cast(status, "text")}, body = ${cast(body, "text")}, model = ${cast(model, "text")}, lease_until = NULL, updated_at = now()
WHERE id = ${cast(id, "uuid")} AND status IN ('da_fare', 'errore')`),
  ]);
}

export interface SuggestionRunSummary {
  proposed: number;
  none: number;
  failed: number;
}

/**
 * Calcola le proposte in coda (di una richiesta, o di tutte dal cron). Non lancia mai: un errore del modello
 * lascia la riga «errore» per il prossimo tentativo (al massimo tre), e il referente non se ne accorge.
 */
export async function processReferentSuggestions(o: { env?: Env; requestId?: string | null; limit?: number; generate?: FollowUpGenerator } = {}): Promise<SuggestionRunSummary> {
  const env = o.env ?? process.env;
  const summary: SuggestionRunSummary = { proposed: 0, none: 0, failed: 0 };
  if (!referentAiSuggestionsOn(env)) return summary;
  if (o.requestId && !isUuid(o.requestId)) return summary;
  try {
    const executor = await getAppUcExecutor();
    const claimed = await claim(executor, { requestId: o.requestId ?? null, limit: Math.max(1, Math.min(o.limit ?? 10, 50)) });
    const generate = o.generate ?? (referentAiProviderReady(env) ? providerFollowUpGenerator : null);
    const model = resolveReferentAiModel(env);
    const acks = new Map<string, boolean>();
    for (const s of claimed) {
      try {
        if (!acks.has(s.workspaceId)) acks.set(s.workspaceId, (await loadSubprocessorAck(executor, s.workspaceId)) !== null);
        const { input, allowed } = await readContent(executor, s);
        // Senza fornitore, senza l'ok sui sub-responsabili, con un'informativa che non lo dice, una richiesta
        // chiusa o un chiarimento già in attesa: nessuna proposta.
        if (!generate || !allowed || !acks.get(s.workspaceId) || !input) {
          await settle(executor, s.id, "nessuna", null, null);
          summary.none++;
          continue;
        }
        const question = parseFollowUp(await generate({ prompt: followUpPrompt(input), model }));
        await settle(executor, s.id, question ? "proposta" : "nessuna", question, question ? model : null);
        if (question) summary.proposed++;
        else summary.none++;
      } catch (error) {
        summary.failed++;
        logSafeError("use-case-referent-ai", "followup_failed", error, { attempt: s.attempts });
        await settle(executor, s.id, "errore", null, null).catch(() => undefined);
      }
    }
  } catch (error) {
    summary.failed++;
    logSafeError("use-case-referent-ai", "followup_batch_failed", error);
  }
  return summary;
}

/** Le proposte più vecchie di una risposta più nuova sulla stessa ancora non contano più (per chi legge). */
export function latestSuggestionSql(alias: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error("Alias non valido");
  return `NOT EXISTS (SELECT 1 FROM use_case_referent_suggestions ns WHERE ns.request_id = ${alias}.request_id AND ns.anchor = ${alias}.anchor
    AND ns.need_id IS NOT DISTINCT FROM ${alias}.need_id AND ns.component_key IS NOT DISTINCT FROM ${alias}.component_key AND ns.source_at > ${alias}.source_at)`;
}
