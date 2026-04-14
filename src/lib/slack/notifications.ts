import type { UseCase } from "@/lib/db/schema";
import { getSlackInstallationByTeamId } from "@/lib/db/queries/slack";
import { db } from "@/lib/db";
import { weeklySignals } from "@/lib/db/schema";

export async function notifyNewUseCase(
  useCase: UseCase,
  slackTeamId: string,
  workspaceId: string
) {
  await createSignal(useCase, workspaceId);

  const installation = await getSlackInstallationByTeamId(slackTeamId);
  if (!installation?.notifyChannelId || !installation?.botToken) return;

  try {
    const { getSlackAdapter } = await import("./bot");
    const adapter = getSlackAdapter();
    const channelId = `slack:${installation.notifyChannelId}`;

    const text =
      `*Nuovo use case proposto* :sparkles:\n\n` +
      `*${useCase.title}*\n` +
      `${useCase.description ? useCase.description.slice(0, 200) : "Nessuna descrizione"}` +
      `${useCase.description && useCase.description.length > 200 ? "..." : ""}\n\n` +
      `Proposto da: <@${useCase.proposedBy ?? "utente"}>\n` +
      `Status: \`${useCase.status}\``;

    await adapter.withBotToken(installation.botToken, async () => {
      await adapter.postChannelMessage(channelId, text);
    });
  } catch (error) {
    console.error("[slack/notifications] Failed to post to Slack channel:", error);
  }
}

async function createSignal(useCase: UseCase, workspaceId: string) {
  try {
    await db.insert(weeklySignals).values({
      workspaceId,
      signalType: "new_use_case_proposed",
      title: `Nuovo use case proposto: ${useCase.title}`,
      description: `Un use case è stato proposto via Slack: "${useCase.title}". ${
        useCase.description?.slice(0, 150) ?? ""
      }`,
      relatedEntityType: "use_case",
      relatedEntityId: useCase.id,
    });
  } catch (error) {
    console.error("[slack/notifications] Failed to create signal:", error);
  }
}
