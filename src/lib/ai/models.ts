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
   * Il match O*NET delle attività di un reparto. L'uscita cresce con le attività, ma dalla chat gira
   * dentro i suoi 120 secondi, dove più di 16000 token non finirebbero: oltre, un errore che la chat
   * gestisce («Match O*NET non riuscito») invece della funzione interrotta.
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
 * Le impostazioni della chiamata (oltre a modello, prompt e schema), da stendere nelle opzioni di
 * generateObject, generateText o streamText: `model: anthropic(CLAUDE_MODEL), ...claudeCallSettings("report")`.
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
 * La ricerca web gira dentro i 120 secondi della chat: oltre questo tempo si interrompe e il tool
 * risponde come quando la ricerca non è disponibile, invece di far scadere tutto il turno.
 */
export const WEB_SEARCH_TIMEOUT_MS = 45_000;

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

/**
 * Subito dopo ogni generateObject, prima di scrivere qualcosa: `const { object } = throwIfRefused("scope", await generateObject(...))`.
 * generateObject restituisce l'oggetto anche da un rifiuto, se il suo JSON è completo: qui il rifiuto va nel log
 * (solo motivo e categoria) e diventa un ClaudeRefusalError, che ogni chiamata gestisce come gli altri errori del modello.
 */
export function throwIfRefused<T extends { finishReason?: unknown; providerMetadata?: unknown }>(scope: string, result: T): T {
  if (result.finishReason !== "content-filter") return result;
  logClaudeStop(scope, "risposta_rifiutata", result);
  throw new ClaudeRefusalError(scope, claudeStopSummary(result).category);
}
