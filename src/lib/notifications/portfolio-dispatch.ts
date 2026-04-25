import type { UseCase } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { weeklySignals } from "@/lib/db/schema";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getSlackInstallationByWorkspace } from "@/lib/db/queries/slack";
import { notifyNewUseCase } from "@/lib/slack/notifications";

function getAppBaseUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return null;
}

function kindLabel(kind: string | null | undefined) {
  if (kind === "best_practice") return "Nuova best practice";
  if (kind === "use_case_ai") return "Nuovo use case AI";
  return "Nuovo contributo portfolio";
}

/**
 * Invoca un webhook generico (es. relay WhatsApp su Zapier/Make/Twilio/custom)
 * inviando payload JSON. Tolleriamo errori di rete senza bloccare il flusso.
 */
async function postWhatsappWebhook(
  url: string,
  payload: { text: string; link: string | null; event: string; useCase: Pick<UseCase, "id" | "title" | "portfolioKind"> }
) {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      console.error("[notifications] whatsapp webhook non-2xx:", resp.status, txt.slice(0, 500));
    }
  } catch (e) {
    console.error("[notifications] whatsapp webhook failed:", e);
  }
}

/**
 * Notifica unificata per un nuovo contributo portfolio:
 *  - crea un `weeklySignal` (campanella web + digest)
 *  - pubblica su canale Slack admin (se Slack è installato)
 *  - inoltra al webhook WhatsApp se configurato sul workspace
 *
 * `source` indica da dove arriva il contributo: "slack" | "web".
 */
export async function dispatchNewPortfolioNotifications(params: {
  useCase: UseCase;
  workspaceId: string;
  source: "slack" | "web";
  /** slackTeamId obbligatorio solo se source === "slack" (serve per recuperare l'installazione). */
  slackTeamId?: string | null;
}) {
  const { useCase, workspaceId, source } = params;

  const workspace = await getWorkspaceById(workspaceId);
  const teamName =
    workspace?.aiTransformationTeamName?.trim() || "AI Transformation";

  // 1) Signal DB (alimenta la campanella in header)
  try {
    await db.insert(weeklySignals).values({
      workspaceId,
      signalType: "new_portfolio_item",
      title: `${kindLabel(useCase.portfolioKind)}: ${useCase.title}`,
      description:
        (useCase.description?.slice(0, 220) ?? "") +
        (useCase.description && useCase.description.length > 220 ? "…" : ""),
      relatedEntityType: "use_case",
      relatedEntityId: useCase.id,
    });
  } catch (e) {
    console.error("[notifications] insert weeklySignal failed:", e);
  }

  // 2) Slack admin channel (se Slack è installato per questo workspace)
  try {
    let teamIdToUse = params.slackTeamId ?? null;
    if (!teamIdToUse) {
      const install = await getSlackInstallationByWorkspace(workspaceId);
      teamIdToUse = install?.slackTeamId ?? null;
    }
    if (teamIdToUse) {
      await notifyNewUseCase(useCase, teamIdToUse, workspaceId);
    }
  } catch (e) {
    console.error("[notifications] slack dispatch failed:", e);
  }

  // 3) WhatsApp webhook (opzionale)
  if (workspace?.whatsappWebhookUrl) {
    const base = getAppBaseUrl();
    const link = base
      ? `${base}/dashboard/${workspaceId}/portfolio/review/${useCase.id}`
      : null;
    const text =
      `${kindLabel(useCase.portfolioKind)} in coda al team ${teamName}: ` +
      `"${useCase.title}" (origine: ${source})` +
      `${typeof useCase.overallScore === "number" && useCase.overallScore > 0 ? `, score iniziale ${useCase.overallScore.toFixed(2)}` : ""}. ` +
      `${link ? `Apri per valutare: ${link}` : ""}`;
    await postWhatsappWebhook(workspace.whatsappWebhookUrl, {
      text: text.trim(),
      link,
      event: "portfolio.new",
      useCase: {
        id: useCase.id,
        title: useCase.title,
        portfolioKind: useCase.portfolioKind,
      },
    });
  }
}
