"use server";

import { db } from "@/lib/db";
import { weeklySignals, activities, workspaces, useCases } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { markSignalRead } from "@/lib/db/queries/signals";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { revalidatePath } from "next/cache";

export async function markSignalAsRead(signalId: string) {
  await markSignalRead(signalId);
}

export async function markAllSignalsRead(workspaceId: string) {
  await db
    .update(weeklySignals)
    .set({ isRead: true })
    .where(
      and(
        eq(weeklySignals.workspaceId, workspaceId),
        eq(weeklySignals.isRead, false)
      )
    );
  revalidatePath(`/dashboard/${workspaceId}/intelligence`);
}

const competitiveAnalysisSchema = z.object({
  marketTrends: z.array(
    z.object({
      trend: z.string(),
      relevance: z.enum(["high", "medium", "low"]),
      description: z.string(),
      suggestedAction: z.string(),
    })
  ),
  automationOpportunities: z.array(
    z.object({
      area: z.string(),
      currentState: z.string(),
      potentialGain: z.string(),
      timeframe: z.enum(["immediate", "short_term", "medium_term", "long_term"]),
    })
  ),
  riskFactors: z.array(
    z.object({
      risk: z.string(),
      probability: z.enum(["high", "medium", "low"]),
      impact: z.enum(["high", "medium", "low"]),
      mitigation: z.string(),
    })
  ),
  summary: z.string(),
});

export type CompetitiveAnalysis = z.infer<typeof competitiveAnalysisSchema>;

export async function generateCompetitiveAnalysis(
  workspaceId: string
): Promise<CompetitiveAnalysis> {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  const allActivities = await db
    .select()
    .from(activities)
    .where(eq(activities.workspaceId, workspaceId));

  const allUseCases = await db
    .select()
    .from(useCases)
    .where(eq(useCases.workspaceId, workspaceId));

  const recentSignals = await db
    .select()
    .from(weeklySignals)
    .where(eq(weeklySignals.workspaceId, workspaceId))
    .orderBy(desc(weeklySignals.createdAt))
    .limit(20);

  const automatable = allActivities.filter(
    (a) => a.classification === "automate" || a.classification === "automatable"
  );
  const differentiate = allActivities.filter(
    (a) => a.classification === "differentiate" || a.classification === "differentiating"
  );
  const innovate = allActivities.filter(
    (a) => a.classification === "innovate" || a.classification === "emerging_opportunity"
  );
  const quickWins = allUseCases.filter(
    (uc) => uc.category === "quick_win"
  );
  const strategicBets = allUseCases.filter(
    (uc) => uc.category === "strategic_bet"
  );

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema: competitiveAnalysisSchema,
    prompt: `Sei un analista di competitive intelligence specializzato in trasformazione AI delle organizzazioni.

Analizza i dati del workspace "${workspace?.name ?? "N/D"}" e genera un report di intelligence competitiva.

DATI DEL WORKSPACE:
- Attivita' totali mappate: ${allActivities.length}
- Stream AUTOMATE: ${automatable.length}
- Stream DIFFERENTIATE: ${differentiate.length}
- Stream INNOVATE: ${innovate.length}
- Use case totali: ${allUseCases.length}
- Quick Wins identificati: ${quickWins.length}
- Strategic Bets: ${strategicBets.length}
- Status workspace: ${workspace?.status ?? "N/D"}

SEGNALI RECENTI:
${recentSignals.map((s) => `- [${s.signalType}] ${s.title}: ${s.description}`).join("\n")}

ATTIVITA' AUTOMATIZZABILI (campione):
${automatable
  .slice(0, 10)
  .map((a) => `- ${a.title}: ${a.description ?? ""}`)
  .join("\n")}

USE CASE (campione):
${allUseCases
  .slice(0, 10)
  .map((uc) => `- ${uc.title} (${uc.category}): impatto=${uc.overallImpactScore}, fattibilita'=${uc.overallFeasibilityScore}`)
  .join("\n")}

Genera:
1. 3-5 trend di mercato rilevanti per questa organizzazione (basandoti sulle attivita' e il settore)
2. 3-5 opportunita' di automazione con stima del guadagno potenziale
3. 2-4 fattori di rischio con probabilita', impatto e mitigazione
4. Un sommario esecutivo in 3-4 frasi

Scrivi tutto in italiano. Sii specifico e concreto, non generico.`,
  });

  revalidatePath(`/dashboard/${workspaceId}/intelligence`);
  return object;
}
