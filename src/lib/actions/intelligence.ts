"use server";

import { db } from "@/lib/db";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { weeklySignals, activities, workspaces, useCases } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { markSignalsReadForUser } from "@/lib/db/queries/signals";
import { logSafeError } from "@/lib/log/safe-error";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { refresh, revalidatePath } from "next/cache";

/**
 * «Segna come letto» di un segnale, in Intelligence. Letto **per persona** (SPEC §P2.4): la riga va
 * in `weekly_signal_reads` per chi clicca, e solo per i segnali che il suo ruolo vede (chi non
 * valuta non vede i segnali delle schede, D4, docs/use-case/DESIGN.md §11: un id indovinato non
 * scrive niente). Il clic di un revisore non spegne il segnale ai colleghi. Dopo la scrittura
 * `refresh()` ridisegna tutta la pagina, barra in alto compresa: la campanella resta d'accordo.
 */
export type SignalReadResult = { ok: true } | { ok: false; code: "riprova"; message: string };

export async function markSignalAsRead(workspaceId: string, signalId: string): Promise<SignalReadResult> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  try {
    await markSignalsReadForUser({ workspaceId, userId: session.user?.id ?? "", role: access.role ?? null, signalIds: [signalId] });
  } catch (error) {
    logSafeError("intelligence", "segnale_letto", error, { workspaceId });
    return { ok: false, code: "riprova", message: "Non riesco a segnarlo come letto. Riprova." };
  }
  refresh();
  return { ok: true };
}

/**
 * «Segna tutti letti» in Intelligence: per chi chiama, solo i segnali che il suo ruolo vede, come la
 * campanella. Un contributore non segna letti i segnali delle schede, che arrivano solo ai revisori.
 */
export async function markAllSignalsRead(workspaceId: string): Promise<SignalReadResult> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  try {
    await markSignalsReadForUser({ workspaceId, userId: session.user?.id ?? "", role: access.role ?? null, signalIds: null });
  } catch (error) {
    logSafeError("intelligence", "segnali_letti", error, { workspaceId });
    return { ok: false, code: "riprova", message: "Non riesco a segnarli come letti. Riprova." };
  }
  refresh();
  return { ok: true };
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
  const { access } = await requireWorkspaceAccess(workspaceId);
  if (!canReviewWorkspacePortfolio(access.role)) {
    throw new Error("Il tuo ruolo non può generare l'analisi competitiva.");
  }

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
