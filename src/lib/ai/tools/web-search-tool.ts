import { tool, generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

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
          const { text } = await generateText({
            model: anthropic("claude-sonnet-4-20250514"),
            tools: {
              web_search: anthropic.tools.webSearch_20250305({
                maxUses: 3,
              }),
            },
            stopWhen: stepCountIs(5),
            prompt: `Cerca su internet: "${query}". Motivo: ${reason}. Riporta un riassunto conciso dei risultati trovati (max 5-6 frasi). Includi fatti specifici, numeri e nomi quando disponibili.`,
          });

          return {
            success: true,
            reason,
            summary: text || "Nessun risultato rilevante trovato.",
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
