import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";

/**
 * Il modello Claude delle funzioni AI dell'app (chat, documenti, generatori, cron) e le impostazioni
 * di ogni sua chiamata. Modulo puro: niente SDK a runtime, lo importano anche i test con Node.
 *
 * Perché: `claude-sonnet-4-20250514`, scritto finora in ogni chiamata, è stato ritirato il 15/06/2026
 * e l'API risponde 404. La guida di migrazione della skill `claude-api` (shared/model-migration.md,
 * «Retired Model Replacements») indica `claude-sonnet-5-5`, approvato dal titolare. Su questo modello
 * (stessa guida, «Migrating to Claude Sonnet 5.5»):
 * - senza `thinking` il ragionamento è adattivo e conta nel limite dei token: ogni chiamata dichiara
 *   il suo `maxOutputTokens` (senza, l'SDK manderebbe 128000);
 * - lo sforzo predefinito è `high`: qui è sempre esplicito;
 * - `thinking: disabled`, `tool_choice` forzato, `temperature`/`top_p`/`top_k` diversi dal predefinito
 *   e il prefill rispondono 400: non si mandano mai. Gli oggetti di generateObject passano da
 *   `output_config.format`, che @ai-sdk/anthropic sceglie da solo per questo modello;
 * - i classificatori di sicurezza possono rifiutare (finishReason «content-filter»): vedi `fallbacks`
 *   e `logClaudeStop`.
 */
export const CLAUDE_MODEL = "claude-sonnet-5-5";

type ClaudeTaskSettings = {
  /**
   * `output_config.effort`. `low` per generare, classificare, estrarre e cercare; `medium` per la chat,
   * che in un turno chiama più tool che salvano (i punti di partenza della guida).
   */
  readonly effort: NonNullable<AnthropicProviderOptions["effort"]>;
  /**
   * Il limite dei token in uscita, ragionamento compreso. 16000 per le risposte limitate; 32000 dove
   * l'uscita cresce con l'input (oltre, nei 300 secondi di una funzione non finirebbe comunque).
   */
  readonly maxOutputTokens: number;
  /**
   * `fallbacks: "default"`: se il modello rifiuta per `cyber` o `frontier_llm`, l'API riprova la stessa
   * richiesta su Claude Sonnet 5 (gli altri rifiuti restano rifiuti). Solo nelle chiamate di un passo:
   * nella chat a più passi l'SDK non rimanda il blocco `fallback` e il passo dopo un ripiego a metà
   * risposta potrebbe ricevere un 400.
   */
  readonly fallbacks: boolean;
  /**
   * `thinking: { type: "adaptive", display: "updates" }` (l'SDK aggiunge la beta `thinking-display-updates-2026-08-18`):
   * su questo modello le note tra un tool e l'altro più lunghe di una frase arrivano come blocchi di ragionamento,
   * vuoti per default; così arrivano con il loro testo, e la chat le mostra come righe di avanzamento. Il
   * ragionamento vero resta nascosto. Solo dove un'interfaccia le mostra: la chat.
   */
  readonly progressUpdates?: boolean;
};

/** Le impostazioni di ogni chiamata al modello, per nome. */
export const CLAUDE_TASKS = {
  /** Chat di discovery e activity mapping (streamText, tool che salvano, fino a 20 passi). */
  chat: { effort: "medium", maxOutputTokens: 16_000, fallbacks: false, progressUpdates: true },
  /** La ricerca web dentro la chat (generateText con il tool di ricerca dell'API). */
  webSearch: { effort: "low", maxOutputTokens: 16_000, fallbacks: true },
  /** Il testo di un PDF caricato. */
  pdfText: { effort: "low", maxOutputTokens: 32_000, fallbacks: true },
  /** La sintesi di un documento caricato. */
  documentSummary: { effort: "low", maxOutputTokens: 16_000, fallbacks: true },
  /** I segnali settimanali del cron weekly-pulse. */
  weeklySignals: { effort: "low", maxOutputTokens: 16_000, fallbacks: true },
  /** La classificazione di un'attività nei tre stream. */
  classifyActivity: { effort: "low", maxOutputTokens: 16_000, fallbacks: true },
  /**
   * Il match O*NET delle attività di un reparto. L'uscita cresce con le attività; 16000 token bastano per un reparto.
   * Il limite dei token non limita il tempo: dalla chat il match ha un abortSignal fino alla scadenza della richiesta
   * (chatDeadline, qui sotto), e oltre si interrompe e la chat risponde «Match O*NET non riuscito».
   */
  onetMatch: { effort: "low", maxOutputTokens: 16_000, fallbacks: true },
  /** La value map: una posizione per ogni attività classificata. */
  valueMap: { effort: "low", maxOutputTokens: 32_000, fallbacks: true },
  /** Le attività proposte dai documenti di un reparto (al massimo 15). */
  preGenerateActivities: { effort: "low", maxOutputTokens: 16_000, fallbacks: true },
  /** Il report esecutivo. */
  report: { effort: "low", maxOutputTokens: 16_000, fallbacks: true },
  /** Gli scenari della simulazione. */
  simulation: { effort: "low", maxOutputTokens: 16_000, fallbacks: true },
  /** Gli use case dalle attività classificate (al massimo 12, con i punteggi). */
  useCases: { effort: "low", maxOutputTokens: 32_000, fallbacks: true },
  /** Un blueprint per ogni quick win e strategic bet. */
  blueprints: { effort: "low", maxOutputTokens: 32_000, fallbacks: true },
  /** L'analisi competitiva di Intelligence. */
  competitiveAnalysis: { effort: "low", maxOutputTokens: 16_000, fallbacks: true },
  /** Gli OKR suggeriti dalla value thesis. */
  okrSuggestions: { effort: "low", maxOutputTokens: 16_000, fallbacks: true },
  /**
   * L'auto-ranking del portfolio: punteggi interi 1-5 con le rubriche del workspace e una rationale, in un passo.
   * `low`, il punto di partenza della guida per classificare: è un suggerimento (decide il revisore), come i
   * punteggi degli use case e la classificazione qui sopra. Il modello si cambia con PORTFOLIO_RANKING_MODEL: le
   * impostazioni le legge portfolioRankingCallSettings (src/lib/portfolio/ai-ranking-contract.ts), senza ripiego.
   */
  portfolioRanking: { effort: "low", maxOutputTokens: 16_000, fallbacks: false },
  /**
   * La domanda in più per il referente (il filo): basta la risposta? Se no, una domanda di una riga. `low`:
   * classificare e scrivere una riga, dentro i 30 secondi della chiamata (REFERENT_AI_LIMITS), dove `high`, il
   * predefinito, ragiona prima di ogni risposta. Modello di USE_CASE_REFERENT_AI_MODEL o dell'auto-ranking:
   * impostazioni lette da referentAiCallSettings (src/lib/use-cases/referent/ai-followup.ts), senza ripiego.
   */
  referentFollowUp: { effort: "low", maxOutputTokens: 16_000, fallbacks: false },
} as const satisfies Record<string, ClaudeTaskSettings>;

export type ClaudeTask = keyof typeof CLAUDE_TASKS;

/**
 * Le impostazioni della chiamata (oltre a modello, prompt e schema), da stendere per ultime nelle opzioni di
 * generateObject, generateText o streamText, così niente scritto nella chiamata le sostituisce:
 * `generateObject({ model: anthropic(CLAUDE_MODEL), schema, prompt, ...claudeCallSettings("report") })`.
 * Il ragionamento è sempre adattivo: `thinking` resta assente, o porta solo `display: "updates"` (`progressUpdates`).
 */
export function claudeCallSettings(task: ClaudeTask) {
  const settings: ClaudeTaskSettings = CLAUDE_TASKS[task];
  const anthropic = {
    effort: settings.effort,
    ...(settings.fallbacks ? { fallbacks: "default" as const } : {}),
    ...(settings.progressUpdates ? { thinking: { type: "adaptive" as const, display: "updates" as const } } : {}),
  } satisfies AnthropicProviderOptions;
  return { maxOutputTokens: settings.maxOutputTokens, providerOptions: { anthropic } };
}

/**
 * La descrizione del campo `motivazione` negli schemi che il modello riempie. Un campo che chiede al modello il suo
 * ragionamento (`reasoning`) invita i rifiuti `reasoning_extraction` di Claude Sonnet 5.5 (guida di migrazione,
 * «Safeguards and fallback»): il modello vede un nome neutro e scrive una breve spiegazione per chi legge; il codice
 * la rimette nel campo `reasoning` di sempre, così tipi, colonne e interfaccia non cambiano.
 */
export const MOTIVAZIONE_DESCRIPTION = "Breve motivazione per l'utente, una o due frasi.";

/**
 * Il tempo massimo della ricerca web della chat, che non va comunque oltre la scadenza della richiesta (chatDeadline):
 * oltre si interrompe e il tool risponde come quando la ricerca non è disponibile, invece di far scadere tutto il turno.
 */
export const WEB_SEARCH_TIMEOUT_MS = 45_000;

/**
 * Il tempo che una richiesta della chat lascia alla risposta finale. La rotta ha `maxDuration` 120 secondi
 * (src/app/api/ai/chat/route.ts): oltre, la funzione si interrompe a metà. I tool che chiamano il modello (la ricerca
 * web; in «Completo mapping» la classificazione e il match O*NET) hanno quindi una scadenza unica per richiesta,
 * chatDeadline: alla scadenza le loro chiamate si interrompono, il tool tiene quello che è riuscito e risponde come
 * quando non riesce, e il modello ha ancora il tempo di rispondere.
 */
export const CHAT_ANSWER_RESERVE_MS = 25_000;

/** Il tempo minimo di una chiamata al modello dentro la chat, anche con la scadenza vicina o passata. */
export const MIN_MODEL_CALL_MS = 5_000;

/** La scadenza dei tool di una richiesta della chat: l'inizio della richiesta più maxDuration, meno la riserva. */
export function chatDeadline(startedAt: number, maxDurationSeconds: number): number {
  return startedAt + maxDurationSeconds * 1000 - CHAT_ANSWER_RESERVE_MS;
}

/**
 * Il tempo da dare a una chiamata al modello (per `AbortSignal.timeout`): quello che resta fino alla scadenza, al più
 * `cap`, almeno MIN_MODEL_CALL_MS.
 */
export function timeUntil(deadline: number, cap = Number.POSITIVE_INFINITY, now = Date.now()): number {
  return Math.max(MIN_MODEL_CALL_MS, Math.min(cap, deadline - now));
}

/**
 * Vero se `error` è l'interruzione dovuta a `signal` (la scadenza), non un errore del modello o della rete. L'SDK
 * rilancia l'errore dell'interruzione così com'è (un TimeoutError per AbortSignal.timeout).
 */
export function stoppedByDeadline(error: unknown, signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false;
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return error === signal.reason || name === "TimeoutError" || name === "AbortError";
}

/** Una riga di log quando le chiamate al modello si fermano alla scadenza: `[scope] tempo_scaduto {...}`, solo numeri. */
export function logClaudeTimeout(scope: string, counts: Record<string, number> = {}, log: Pick<Console, "warn"> = console) {
  log.warn(`[${scope}] tempo_scaduto`, JSON.stringify(counts));
}

const LOG_TOKEN = /^[A-Za-z0-9_.:-]{1,40}$/;

/**
 * Perché Claude si è fermato, per i log: il finishReason dell'SDK e, per un rifiuto, la categoria di
 * `stop_details` (`cyber`, `bio`, `frontier_llm`, `reasoning_extraction`, `general_harms`). Solo token
 * brevi: mai il testo del modello o di chi scrive.
 */
export function claudeStopSummary(result: { finishReason?: unknown; providerMetadata?: unknown }) {
  const anthropic = (result.providerMetadata as { anthropic?: { stopDetails?: { category?: unknown } } } | undefined)
    ?.anthropic;
  const category = anthropic?.stopDetails?.category;
  return {
    finishReason:
      typeof result.finishReason === "string" && LOG_TOKEN.test(result.finishReason) ? result.finishReason : "other",
    category: typeof category === "string" && LOG_TOKEN.test(category) ? category : null,
  };
}

/** Una riga di log quando la risposta non è completa (un rifiuto, il limite dei token): `[scope] event {...}`. */
export function logClaudeStop(
  scope: string,
  event: string,
  result: { finishReason?: unknown; providerMetadata?: unknown },
  log: Pick<Console, "warn"> = console,
) {
  log.warn(`[${scope}] ${event}`, JSON.stringify(claudeStopSummary(result)));
}

/**
 * La condizione di stop per il giro dei tool della chat, accanto al limite dei passi: `stopWhen: [stepCountIs(20),
 * lastStepRefused]`. Un passo rifiutato (finishReason «content-filter») chiude il giro. L'SDK non esegue i tool di un
 * passo rifiutato, ma a una chiamata di tool non valida (schema non rispettato, JSON troncato dal rifiuto) dà subito un
 * errore, e con quell'errore il giro ripartirebbe: il passo dopo riceverebbe la risposta rifiutata, e la sua risposta
 * si mostrerebbe, si salverebbe e si indicizzerebbe come una risposta normale.
 */
export function lastStepRefused({ steps }: { steps: ReadonlyArray<{ finishReason?: unknown }> }): boolean {
  return steps.at(-1)?.finishReason === "content-filter";
}

/**
 * Un rifiuto dei classificatori di sicurezza (finishReason «content-filter»), come errore. Porta solo il riepilogo
 * dello stop: mai il testo del modello o di chi scrive.
 */
export class ClaudeRefusalError extends Error {
  readonly finishReason = "content-filter";
  readonly category: string | null;

  constructor(scope: string, category: string | null) {
    super(`Claude ha rifiutato la richiesta (${scope}).`);
    this.name = "ClaudeRefusalError";
    this.category = category;
  }
}

type ClaudeStop = { finishReason?: unknown; providerMetadata?: unknown };

/**
 * Ogni generateObject passa da qui, prima di usare o scrivere l'oggetto:
 * `const { object } = await throwIfRefused("scope", generateObject(...))`. Un rifiuto arriva in due forme. Con il JSON
 * completo generateObject restituisce l'oggetto, con finishReason «content-filter». Senza (il rifiuto prima di scrivere,
 * la forma più comune, o a metà oggetto) lancia NoObjectGeneratedError, con lo stesso finishReason. Tutte e due vanno nel
 * log (solo motivo e categoria) e diventano un ClaudeRefusalError, che ogni chiamata gestisce come gli altri errori del
 * modello; gli altri errori passano come sono.
 */
export async function throwIfRefused<T extends ClaudeStop>(scope: string, call: PromiseLike<T>): Promise<T> {
  let result: T;
  try {
    result = await call;
  } catch (error) {
    const refused = refusalInError(error);
    if (refused) refuse(scope, refused);
    throw error;
  }
  if (result.finishReason === "content-filter") refuse(scope, result);
  return result;
}

/**
 * Il rifiuto dentro un NoObjectGeneratedError di generateObject, o null. L'errore non ha i metadati del provider: la
 * categoria sta in `stop_details` del corpo della risposta dell'API, che porta con sé.
 */
function refusalInError(error: unknown): ClaudeStop | null {
  const failed = error as { name?: unknown; finishReason?: unknown; response?: { body?: unknown } } | null | undefined;
  if (failed?.name !== "AI_NoObjectGeneratedError" || failed.finishReason !== "content-filter") return null;
  const body = failed.response?.body as { stop_details?: { category?: unknown } | null } | null | undefined;
  return { finishReason: failed.finishReason, providerMetadata: { anthropic: { stopDetails: { category: body?.stop_details?.category } } } };
}

/** Il rifiuto nel log, con il solo riepilogo dello stop, e poi come ClaudeRefusalError. */
function refuse(scope: string, stop: ClaudeStop): never {
  logClaudeStop(scope, "risposta_rifiutata", stop);
  throw new ClaudeRefusalError(scope, claudeStopSummary(stop).category);
}
