import { tool } from "ai";
import { z } from "zod";

export function getWebSearchTool() {
  return {
    webSearch: tool({
      description:
        "Cerca informazioni su internet riguardo un'azienda, un settore, una persona o un trend. " +
        "Usare quando l'utente menziona il nome della propria azienda, il settore in cui opera, " +
        "competitor, o quando vuoi arricchire la conversazione con dati reali e aggiornati. " +
        "Esempio: l'utente dice 'Siamo Acme Corp nel settore energy' → cerca 'Acme Corp energy company'.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("La query di ricerca da eseguire su internet"),
        reason: z
          .string()
          .describe(
            "Perché stai cercando questa informazione (verrà mostrato all'utente)"
          ),
      }),
      execute: async ({ query, reason }) => {
        try {
          const response = await fetch(
            `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
            {
              headers: {
                Accept: "application/json",
                "Accept-Encoding": "gzip",
                "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY ?? "",
              },
            }
          );

          if (!response.ok) {
            return {
              success: false,
              message: "Ricerca non disponibile al momento.",
              results: [],
            };
          }

          const data = await response.json();
          const results = (
            data.web?.results ?? []
          ).slice(0, 5).map(
            (r: { title: string; url: string; description: string }) => ({
              title: r.title,
              url: r.url,
              snippet: r.description,
            })
          );

          return {
            success: true,
            reason,
            results,
            message: `Ho trovato ${results.length} risultati per "${query}".`,
          };
        } catch {
          return {
            success: false,
            message: "Ricerca non disponibile al momento.",
            results: [],
          };
        }
      },
    }),
  };
}
