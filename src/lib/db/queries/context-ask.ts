import "server-only";
/**
 * «Chiedi al contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.4.7, §4.4): una domanda in italiano,
 * una risposta breve con le fonti. Prima si cercano i brani per parole, solo tra quello che chi chiede può vedere;
 * poi, con l'ok ai sub-responsabili, il modello risponde usando solo quei brani. Se i brani non bastano lo dice
 * («Non lo sappiamo ancora»), e la domanda può entrare tra le domande aperte.
 *
 * Chi vede che cosa: i fatti per visibilità; i dati della Discovery (le cifre solo ai revisori); gli appunti solo
 * Lateral Space; i documenti per la loro visibilità; le risposte dei referenti e le decisioni ai revisori.
 */
import { sql } from "drizzle-orm";
import { CONTEXT_ASK_TIMEOUT_MS, ClaudeRefusalError, logClaudeTimeout, stoppedByDeadline } from "@/lib/ai/models";
import { consumeRateLimits, rateLimitBucket } from "@/lib/connector/rate-limit";
import { generateContextAsk } from "@/lib/context/ask/generate";
import { buildAskPrompt, cleanAskAnswer } from "@/lib/context/ask/prompt";
import { dayLabel, factSourceLabel } from "@/lib/context/labels";
import { cut, oneLine } from "@/lib/context/normalize";
import { scanNote } from "@/lib/context/scan";
import { contextTsQuery } from "@/lib/context/search";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities, type ContextActor } from "@/lib/context/visibility";
import { CONTEXT_LIMITS, type FactOrigin, type SourceKind, type SourceOrigin } from "@/lib/context/vocab";
import { db } from "@/lib/db";
import { logSafeError } from "@/lib/log/safe-error";
import { romeDate } from "@/lib/uc/calendar";
import type { ServiceResult } from "@/lib/use-cases/types";
import { contextAiConsent } from "./context-consent";
import { loadLiveDiscovery } from "./context-discovery";
import { CONTEXT_DAY_TIME_ZONE, contextRateLimitExec, gate, invalid, isUuid, ok, retry, romeToday, rowsOf, toDate, toIsoDate } from "./context-shared";
import { contextStoreReady } from "./context-store";
import { getWorkspaceById } from "./workspaces";

const LOG_SCOPE = "context/ask";

export type AskSourceKind = "fatto" | "discovery" | "appunti" | "documento" | "referente" | "decisione";
/** Un brano trovato. `label`: da dove viene («Call 14 nov», «Discovery», il titolo dell'appunto o del documento). `date`: AAAA-MM-GG, o null. */
export interface AskSource {
  n: number;
  kind: AskSourceKind;
  label: string;
  date: string | null;
  excerpt: string;
}
export type AskAnswer =
  | { status: "risposta"; answer: string; sources: AskSource[] } // solo le fonti citate
  | { status: "non_so"; sources: AskSource[] } // i brani trovati non bastano
  | { status: "solo_ricerca"; sources: AskSource[] } // manca l'ok: i brani, senza una risposta scritta
  | { status: "niente" } // nessun brano
  | { status: "limite"; retryAfterSeconds: number }; // troppe domande: la rotta risponde 429

/** Quanti brani per tipo, al massimo (§4.4). */
const PER_KIND: Readonly<Record<AskSourceKind, number>> = Object.freeze({ fatto: 12, discovery: 6, appunti: 4, documento: 4, referente: 3, decisione: 3 });

type Found = Omit<AskSource, "n">;
const excerptOf = (text: string | null | undefined): string => cut(oneLine(text ?? ""), CONTEXT_LIMITS.askSnippetChars);

/** Una ricerca che non riesce (una tabella che non c'è ancora) non ferma le altre: vale «niente trovato». */
async function safely(kind: AskSourceKind, workspaceId: string, run: () => Promise<Found[]>): Promise<Found[]> {
  try {
    return await run();
  } catch (error) {
    logSafeError(LOG_SCOPE, "ricerca_non_riuscita", error, { workspaceId, tipo: kind });
    return [];
  }
}

/** I brani che chi guarda può vedere (§5.2), per parole. Senza modello. */
export async function searchContext(actor: ContextActor, query: string, opts: { limit?: number } = {}): Promise<AskSource[]> {
  const abilities = contextAbilities(actor);
  if (!abilities.canAsk || !isUuid(actor.workspaceId) || !(await contextStoreReady())) return [];
  const ws = actor.workspaceId;
  const tsQuery = contextTsQuery(query);
  if (!tsQuery) return [];
  const lateralSpace = abilities.seesLateralSpace;
  const today = romeToday();
  const workspace = await getWorkspaceById(ws);
  if (!workspace) return [];
  const q = sql`to_tsquery('italian', ${tsQuery})`;

  const [facts, discovery, notes, documents, answers, decisions] = await Promise.all([
    safely("fatto", ws, async () => {
      const rows = rowsOf<{
        statement: string;
        origin: FactOrigin;
        last_confirmed_at: unknown;
        source_kind: SourceKind | null;
        source_origin: SourceOrigin | null;
        source_external_id: string | null;
        source_day: unknown;
      }>(
        await db.execute(sql`
          SELECT f.statement, f.origin, f.last_confirmed_at, s.kind AS source_kind, s.origin AS source_origin, s.external_id AS source_external_id, s.occurred_on AS source_day
          FROM context_facts f LEFT JOIN context_sources s ON s.id = f.source_id
          WHERE f.workspace_id = ${ws}::uuid AND f.status = 'attivo' AND (${lateralSpace} OR f.visibility = 'tutti')
            AND to_tsvector('italian', f.statement) @@ ${q}
          ORDER BY ts_rank_cd(to_tsvector('italian', f.statement), ${q}) DESC, f.last_confirmed_at DESC
          LIMIT ${PER_KIND.fatto}`),
      );
      return rows.map((row): Found => {
        const confirmed = toDate(row.last_confirmed_at);
        return {
          kind: "fatto",
          label: factSourceLabel(
            { origin: row.origin, sourceKind: row.source_kind, sourceOrigin: row.source_origin, sourceExternalId: row.source_external_id, sourceOccurredOn: row.source_day ? toIsoDate(row.source_day) : null },
            today,
          ).label,
          date: confirmed ? romeDate(confirmed) : null,
          excerpt: excerptOf(row.statement),
        };
      });
    }),
    safely("discovery", ws, async () => {
      // I dati della Discovery si leggono dal vivo e si cercano con le stesse regole degli altri brani (stesse radici, niente parole vuote).
      const live = (await loadLiveDiscovery(workspace, actor)).map((row) => (row.tag ? `${row.tag}: ${row.text}` : row.text));
      if (live.length === 0) return [];
      const hits = rowsOf<{ position: number }>(
        await db.execute(sql`
          SELECT r.position::int AS position FROM jsonb_array_elements_text(${JSON.stringify(live)}::jsonb) WITH ORDINALITY AS r(line, position)
          WHERE to_tsvector('italian', r.line) @@ ${q}
          ORDER BY ts_rank_cd(to_tsvector('italian', r.line), ${q}) DESC, r.position
          LIMIT ${PER_KIND.discovery}`),
      );
      return hits.map((hit): Found => ({ kind: "discovery", label: CONTEXT_TEXT.fact.sourceDiscovery, date: null, excerpt: excerptOf(live[Number(hit.position) - 1]) }));
    }),
    // Gli appunti e le trascrizioni: solo Lateral Space.
    lateralSpace
      ? safely("appunti", ws, async () => {
          const vector = sql`to_tsvector('italian', coalesce(s.title, '') || ' ' || coalesce(s.body, ''))`;
          const rows = rowsOf<{ title: string; occurred_on: unknown; headline: string }>(
            await db.execute(sql`
              SELECT s.title, s.occurred_on,
                ts_headline('italian', coalesce(s.body, ''), ${q}, 'StartSel="", StopSel="", MaxWords=70, MinWords=25, MaxFragments=2, FragmentDelimiter=" … "') AS headline
              FROM context_sources s
              WHERE s.workspace_id = ${ws}::uuid AND s.kind <> 'documento' AND s.body IS NOT NULL AND ${vector} @@ ${q}
              ORDER BY ts_rank_cd(${vector}, ${q}) DESC, s.occurred_on DESC
              LIMIT ${PER_KIND.appunti}`),
          );
          return rows.map((row): Found => ({ kind: "appunti", label: oneLine(row.title), date: toIsoDate(row.occurred_on) || null, excerpt: excerptOf(row.headline) }));
        })
      : Promise.resolve([] as Found[]),
    // I documenti: per la visibilità del documento. Un documento di prima della 9a non ha una fonte: lo vede chi è nel workspace.
    safely("documento", ws, async () => {
      const rows = rowsOf<{ content: string; title: string | null; file_name: string; occurred_on: unknown }>(
        await db.execute(sql`
          SELECT c.content, s.title, d.file_name, s.occurred_on
          FROM document_chunks c JOIN uploaded_documents d ON d.id = c.document_id LEFT JOIN context_sources s ON s.document_id = d.id
          WHERE c.workspace_id = ${ws}::uuid AND (s.id IS NULL OR ${lateralSpace} OR s.visibility = 'tutti')
            AND to_tsvector('italian', c.content) @@ ${q}
          ORDER BY ts_rank_cd(to_tsvector('italian', c.content), ${q}) DESC, c.chunk_index
          LIMIT ${PER_KIND.documento}`),
      );
      return rows.map((row): Found => ({ kind: "documento", label: oneLine(row.title ?? row.file_name), date: row.occurred_on ? toIsoDate(row.occurred_on) : null, excerpt: excerptOf(row.content) }));
    }),
    // Le risposte dei referenti (inviate e non tolte) e le decisioni: per i revisori.
    abilities.canSeeReviewerSources
      ? safely("referente", ws, async () => {
          const rows = rowsOf<{ body: string; title: string; code: string | null; submitted_at: unknown }>(
            await db.execute(sql`
              SELECT a.body, n.title, u.code, a.submitted_at
              FROM use_case_need_answers a JOIN use_case_needs n ON n.id = a.need_id JOIN use_cases u ON u.id = a.use_case_id
              WHERE a.workspace_id = ${ws}::uuid AND a.status = 'inviata' AND a.removed_at IS NULL AND a.body IS NOT NULL
                AND to_tsvector('italian', a.body) @@ ${q}
              ORDER BY ts_rank_cd(to_tsvector('italian', a.body), ${q}) DESC, a.submitted_at DESC NULLS LAST
              LIMIT ${PER_KIND.referente}`),
          );
          return rows.map((row): Found => {
            const at = toDate(row.submitted_at);
            return { kind: "referente", label: oneLine(row.code ? `${row.code} · ${row.title}` : row.title), date: at ? romeDate(at) : null, excerpt: excerptOf(row.body) };
          });
        })
      : Promise.resolve([] as Found[]),
    abilities.canSeeReviewerSources
      ? safely("decisione", ws, async () => {
          const text = sql`coalesce(d.topic, '') || ' ' || coalesce(d.choice, '') || ' ' || coalesce(d.reason, '')`;
          const rows = rowsOf<{ topic: string; choice: string; reason: string | null; code: string | null; decided_on: unknown }>(
            await db.execute(sql`
              SELECT d.topic, d.choice, d.reason, u.code, d.decided_on
              FROM use_case_decisions d JOIN use_cases u ON u.id = d.use_case_id
              WHERE d.workspace_id = ${ws}::uuid AND to_tsvector('italian', ${text}) @@ ${q}
              ORDER BY ts_rank_cd(to_tsvector('italian', ${text}), ${q}) DESC, d.decided_on DESC
              LIMIT ${PER_KIND.decisione}`),
          );
          return rows.map((row): Found => ({
            kind: "decisione",
            label: oneLine(row.code ? `${row.code} · ${row.topic}` : row.topic),
            date: row.decided_on ? toIsoDate(row.decided_on) : null,
            excerpt: excerptOf(row.reason ? `${row.choice} (${row.reason})` : row.choice),
          }));
        })
      : Promise.resolve([] as Found[]),
  ]);

  const limit = Math.max(1, Math.min(Math.trunc(opts.limit ?? CONTEXT_LIMITS.askSnippets), CONTEXT_LIMITS.askSnippets));
  return [...facts, ...discovery, ...notes, ...documents, ...answers, ...decisions]
    .filter((found) => found.excerpt)
    .slice(0, limit)
    .map((found, index) => ({ n: index + 1, ...found }));
}

/** Da dove viene un brano, per il modello: l'etichetta e, se non la porta già, la data. */
function promptLabel(source: AskSource, today: string): string {
  if (source.kind === "fatto" || source.kind === "discovery" || !source.date) return source.label;
  const day = dayLabel(source.date, today);
  return source.kind === "appunti" ? `${CONTEXT_TEXT.fact.sourceCallWord} ${day} «${source.label}»` : `${source.label}, ${day}`;
}

/**
 * Nell'ordine: validazione (3-300 caratteri) e `scanNote` sulla domanda (`dati_non_validi`); limiti (30 all'ora per
 * persona, 300 al giorno per workspace, secchi `ctx:u:<userId>:ask` e `ctx:ws:<workspaceId>:ask:day`): `limite`;
 * `searchContext`; senza brani `niente`; senza l'ok `solo_ricerca`; chiamata `contextAsk` (§4.4). Un rifiuto, il
 * tempo scaduto o un errore del modello: `riprova`.
 */
export async function askContext(actor: ContextActor, question: string, opts: { timeoutMs?: number } = {}): Promise<ServiceResult<AskAnswer>> {
  const allowed = await gate(actor, "canAsk");
  if (!allowed.ok) return allowed;
  const T = CONTEXT_TEXT;
  const asked = oneLine(typeof question === "string" ? question : "");
  if (asked.length < CONTEXT_LIMITS.askMin) return invalid({ question: T.ask.tooShort });
  if (asked.length > CONTEXT_LIMITS.askMax) return invalid({ question: T.errors.tooLong(CONTEXT_LIMITS.askMax) });
  // Una domanda con dati sanitari non parte: né per la ricerca, né verso il modello.
  const scan = scanNote(asked);
  if (!scan.ok) return invalid({ question: scan.message });
  const ws = actor.workspaceId;
  try {
    const limit = await consumeRateLimits(contextRateLimitExec, [
      { bucket: rateLimitBucket("ctx", "u", actor.userId, "ask"), window: "hour", limit: CONTEXT_LIMITS.asksPerHourUser },
      { bucket: rateLimitBucket("ctx", "ws", ws, "ask", "day"), window: "day", limit: CONTEXT_LIMITS.asksPerDayWorkspace, timeZone: CONTEXT_DAY_TIME_ZONE },
    ]);
    if (!limit.ok) return ok({ status: "limite", retryAfterSeconds: limit.retryAfterSeconds });

    const sources = await searchContext(actor, asked);
    if (sources.length === 0) return ok({ status: "niente" });
    // L'ok ai sub-responsabili, subito prima del modello. Senza: i brani trovati, senza una risposta scritta.
    if (!(await contextAiConsent(ws))) return ok({ status: "solo_ricerca", sources });

    const workspace = await getWorkspaceById(ws);
    const today = romeToday();
    const { system, prompt } = buildAskPrompt({
      clientName: workspace?.name ?? "",
      question: asked,
      snippets: sources.map((source) => ({ n: source.n, kindLabel: T.ask.kind[source.kind], label: promptLabel(source, today), excerpt: source.excerpt })),
    });
    const timeoutMs = opts.timeoutMs ?? CONTEXT_ASK_TIMEOUT_MS;
    const abortSignal = AbortSignal.timeout(timeoutMs);
    let output;
    try {
      output = await generateContextAsk({ system, prompt, abortSignal, workspaceId: ws });
    } catch (error) {
      // Un rifiuto è già nel log (throwIfRefused).
      if (stoppedByDeadline(error, abortSignal)) logClaudeTimeout(LOG_SCOPE, { timeoutMs });
      else if (!(error instanceof ClaudeRefusalError)) logSafeError(LOG_SCOPE, "risposta_non_riuscita", error, { workspaceId: ws });
      return retry();
    }
    const clean = cleanAskAnswer(output, sources.map((source) => source.n));
    // Una risposta con dati sanitari non si mostra: vale «non lo sappiamo».
    if (!clean.known || !scanNote(clean.answer).ok) return ok({ status: "non_so", sources });
    const cited = new Set(clean.sources);
    return ok({ status: "risposta", answer: clean.answer, sources: sources.filter((source) => cited.has(source.n)) });
  } catch (error) {
    logSafeError(LOG_SCOPE, "domanda_non_riuscita", error, { workspaceId: ws });
    return retry();
  }
}
