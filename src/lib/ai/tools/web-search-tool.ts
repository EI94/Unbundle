import { tool, generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { CLAUDE_MODEL, claudeCallSettings, logClaudeStop, WEB_SEARCH_TIMEOUT_MS } from "@/lib/ai/models";

export function getWebSearchTool() {
  return {
    webSearch: tool({
      description:
        "Cerca informazioni su internet riguardo un'azienda, un settore, una persona o un trend. " +
        "Usare quando l'utente menziona il nome della propria azienda, il settore in cui opera, " +
        "competitor, o quando vuoi arricchire la conversazione con dati reali e aggiornati.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("La query di ricerca da eseguire su internet"),
        reason: z
          .string()
          .describe("Perché stai cercando questa informazione"),
      }),
      execute: async ({ query, reason }) => {
        try {
          const result = await generateText({
            model: anthropic(CLAUDE_MODEL),
            ...claudeCallSettings("webSearch"),
            // Dentro i 120 secondi della chat: oltre, si prosegue senza ricerca (il catch qui sotto).
            abortSignal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
            tools: {
              web_search: anthropic.tools.webSearch_20250305({
                maxUses: 3,
              }),
            },
            stopWhen: stepCountIs(5),
            prompt: `Cerca su internet: "${query}". Motivo: ${reason}. Riporta un riassunto conciso dei risultati trovati (max 5-6 frasi). Includi fatti specifici, numeri e nomi quando disponibili.`,
          });

          // Un rifiuto dei classificatori del modello non è un risultato: si prosegue senza, come
          // quando la ricerca non è disponibile, e mai con un riassunto parziale.
          if (result.finishReason === "content-filter") {
            logClaudeStop("web-search-tool", "ricerca_rifiutata", result);
            return {
              success: false,
              reason,
              summary: "Ricerca non disponibile al momento. Prosegui senza.",
            };
          }

          return {
            success: true,
            reason,
            summary: result.text || "Nessun risultato rilevante trovato.",
          };
        } catch (error) {
          console.error("[web-search-tool] Error:", error);
          return {
            success: false,
            reason,
            summary: "Ricerca non disponibile al momento. Prosegui senza.",
          };
        }
      },
    }),
  };
}
