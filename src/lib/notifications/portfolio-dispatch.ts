import type { UseCase } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { weeklySignals } from "@/lib/db/schema";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getSlackInstallationByWorkspace } from "@/lib/db/queries/slack";
import { notifyNewUseCase } from "@/lib/slack/notifications";
import { tryBuildPortfolioShareUrl } from "@/lib/portfolio/share-link";
import { logSafeError } from "@/lib/log/safe-error";
import { reviewTeamName } from "@/lib/review-team";
import { channelLabel } from "@/lib/use-cases/labels";
import { plainNotificationText } from "./sanitize";

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
      // Mai il corpo della risposta: un relay può rimandare indietro il testo inviato.
      console.error("[notifications] whatsapp webhook non-2xx:", resp.status);
    }
  } catch (e) {
    logSafeError("notifications", "whatsapp_webhook_failed", e);
  }
}

/**
 * Vero se il contributo è già stato annunciato: dispatchNewPortfolioNotifications
 * crea per prima cosa il segnale `new_portfolio_item` della campanella.
 */
export async function wasPortfolioItemAnnounced(params: { workspaceId: string; useCaseId: string }) {
  const [row] = await db
    .select({ id: weeklySignals.id })
    .from(weeklySignals)
    .where(
      and(
        eq(weeklySignals.workspaceId, params.workspaceId),
        eq(weeklySignals.signalType, "new_portfolio_item"),
        eq(weeklySignals.relatedEntityType, "use_case"),
        eq(weeklySignals.relatedEntityId, params.useCaseId)
      )
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Notifica unificata per un nuovo contributo portfolio:
 *  - crea un `weeklySignal` (campanella web + digest)
 *  - pubblica su canale Slack admin (se Slack è installato)
 *  - inoltra al webhook WhatsApp se configurato sul workspace
 *
 * `source` indica da dove arriva il contributo: "slack" | "web" | "claude". Il testo
 * WhatsApp nomina il canale dalla scheda (`use_cases.source`, etichette di DESIGN §4.7),
 * che distingue anche connettore e MCP v1.
 * I testi degli utenti restano dati: la campanella li mostra come testo (React),
 * Slack li riceve con escape mrkdwn (buildNewUseCaseSlackText), il webhook con le
 * menzioni neutralizzate (src/lib/notifications/sanitize.ts).
 */
export async function dispatchNewPortfolioNotifications(params: {
  useCase: UseCase;
  workspaceId: string;
  source: "slack" | "web" | "claude";
  /** slackTeamId obbligatorio solo se source === "slack" (serve per recuperare l'installazione). */
  slackTeamId?: string | null;
}) {
  const { useCase, workspaceId } = params;

  const workspace = await getWorkspaceById(workspaceId);
  const teamName = reviewTeamName(workspace);

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
    logSafeError("notifications", "weekly_signal_failed", e, { workspaceId });
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
    logSafeError("notifications", "slack_dispatch_failed", e, { workspaceId });
  }

  // 3) WhatsApp webhook (opzionale)
  if (workspace?.whatsappWebhookUrl) {
    const base = getAppBaseUrl();
    const link = base
      ? tryBuildPortfolioShareUrl(base, workspaceId, useCase.id, {
          epoch: workspace.portfolioShareEpoch,
        })
      : null;
    // Il nome del team da solo, senza articolo né «team» davanti (DESIGN §14.2). Il canale
    // con la sua etichetta (§4.7), mai la chiave interna; nessun punteggio: il webhook può
    // arrivare anche a chi non è revisore (D4).
    const text =
      `${kindLabel(useCase.portfolioKind)} in coda a ${plainNotificationText(teamName)}: ` +
      `"${plainNotificationText(useCase.title)}". Canale: ${channelLabel(useCase.source)}. ` +
      `${link ? `Apri in Unbundle: ${link}` : ""}`;
    await postWhatsappWebhook(workspace.whatsappWebhookUrl, {
      text: text.trim(),
      link,
      event: "portfolio.new",
      useCase: {
        id: useCase.id,
        title: plainNotificationText(useCase.title),
        portfolioKind: useCase.portfolioKind,
      },
    });
  }
}
