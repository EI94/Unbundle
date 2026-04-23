import {
  abandonSlackDraftsInactiveSince,
  listSlackDraftsFor24hReminder,
  markSlackDraftReminderSent,
  getSlackInstallationByTeamId,
} from "@/lib/db/queries/slack";
import { slackChatPostMessage } from "./slack-chat-post";

/**
 * Cron fase 2: abbandono a 48h, promemoria tra 24h e 48h (una sola volta).
 */
export async function runSlackDraftNudgeCron(): Promise<{
  abandoned: number;
  reminded: number;
}> {
  const now = Date.now();
  const cutoff48 = new Date(now - 48 * 60 * 60 * 1000);
  const cutoff24 = new Date(now - 24 * 60 * 60 * 1000);

  const abandonedRows = await abandonSlackDraftsInactiveSince(cutoff48);

  for (const draft of abandonedRows) {
    if (!draft.slackChannelId || !draft.slackThreadTs) continue;
    const inst = await getSlackInstallationByTeamId(draft.slackTeamId);
    if (!inst?.botToken) continue;
    try {
      await slackChatPostMessage({
        botToken: inst.botToken,
        channel: draft.slackChannelId,
        threadTs: draft.slackThreadTs,
        text:
          "Ho archiviato questa bozza Unbundle dopo 48 ore senza aggiornamenti. " +
          "Se vuoi proporre un contributo, scrivimi di nuovo qui o menzionami in canale.",
      });
    } catch (e) {
      console.error("[slack/draft-nudge] abandon notify failed", draft.id, e);
    }
  }

  const remindCandidates = await listSlackDraftsFor24hReminder(
    cutoff24,
    cutoff48
  );
  let reminded = 0;

  for (const draft of remindCandidates) {
    const inst = await getSlackInstallationByTeamId(draft.slackTeamId);
    if (draft.slackChannelId && draft.slackThreadTs && inst?.botToken) {
      try {
        await slackChatPostMessage({
          botToken: inst.botToken,
          channel: draft.slackChannelId,
          threadTs: draft.slackThreadTs,
          text:
            `<@${draft.slackUserId}> Stavi compilando un contributo per Unbundle. ` +
            "Vuoi continuare? Rispondi qui nel thread quando hai un minuto.",
        });
        reminded += 1;
      } catch (e) {
        console.error("[slack/draft-nudge] reminder post failed", draft.id, e);
      }
    }

    try {
      await markSlackDraftReminderSent(draft.id);
    } catch (e) {
      console.error("[slack/draft-nudge] mark reminder sent failed", draft.id, e);
    }
  }

  return { abandoned: abandonedRows.length, reminded };
}
