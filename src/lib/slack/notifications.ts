import type { UseCase } from "@/lib/db/schema";
import { getSlackInstallationByTeamId } from "@/lib/db/queries/slack";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { tryBuildPortfolioShareUrl } from "@/lib/portfolio/share-link";
import { buildNewUseCaseSlackText } from "./new-use-case-message";
import { logSafeError } from "@/lib/log/safe-error";
import { reviewTeamName } from "@/lib/review-team";

/** URL pubblico dell’app (link nel messaggio admin Slack). */
function getAppBaseUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return null;
}

/**
 * Avvisa il canale admin Slack quando un contributo è stato **creato** (stato proposto).
 * Chi ha compilato: mention Slack `<@U…>` solo per un ID utente Slack (Slack mostra il
 * nome visualizzato del membro); ogni altro testo è mostrato e mai interpretato.
 */
export async function notifyNewUseCase(
  useCase: UseCase,
  slackTeamId: string,
  workspaceId: string
) {
  const workspace = await getWorkspaceById(workspaceId);
  const teamName = reviewTeamName(workspace);

  const installation = await getSlackInstallationByTeamId(slackTeamId);
  if (!installation?.notifyChannelId || !installation?.botToken) return;

  try {
    const { getSlackAdapter } = await import("./bot");
    const adapter = getSlackAdapter();
    const channelId = `slack:${installation.notifyChannelId}`;

    const base = getAppBaseUrl();
    const detailUrl = base
      ? tryBuildPortfolioShareUrl(base, workspaceId, useCase.id, {
          epoch: workspace?.portfolioShareEpoch ?? 0,
        })
      : null;

    // Titolo, anteprima e nome sono testi degli utenti: escape mrkdwn e menzioni
    // neutralizzate (src/lib/notifications/sanitize.ts).
    const text = buildNewUseCaseSlackText({ useCase, teamName, detailUrl });

    await adapter.withBotToken(installation.botToken, async () => {
      await adapter.postChannelMessage(channelId, text);
    });
  } catch (error) {
    logSafeError("slack/notifications", "post_failed", error, { workspaceId });
  }
}
