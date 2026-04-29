import { Chat, type Thread } from "chat";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createPostgresState } from "@chat-adapter/state-pg";
import { handleUseCaseConversation } from "./use-case-agent";
import { getSlackInstallationByTeamId } from "@/lib/db/queries/slack";
import {
  chooseSlackContributionTeam,
  resolveSlackTenantContext,
} from "./use-case-agent-utils";
import type { SlackInstallation } from "@/lib/db/schema";

let _bot: Chat | null = null;

export function getBot(): Chat {
  if (_bot) return _bot;

  const dbUrl = process.env.DATABASE_URL?.trim();
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!dbUrl || !signingSecret) {
    throw new Error(
      "Slack bot non configurato: DATABASE_URL e SLACK_SIGNING_SECRET necessari."
    );
  }

  const slack = createSlackAdapter({
    clientId: process.env.SLACK_CLIENT_ID?.trim(),
    clientSecret: process.env.SLACK_CLIENT_SECRET?.trim(),
    signingSecret,
  });

  _bot = new Chat({
    userName: "unbundle",
    adapters: { slack },
    state: createPostgresState({ url: dbUrl }),
    onLockConflict: "force",
    streamingUpdateIntervalMs: 400,
    fallbackStreamingPlaceholderText: "Sto ragionando...",
  });

  registerHandlers(_bot);
  return _bot;
}

async function resolveSlackWorkspace(raw: Record<string, string | undefined>): Promise<
  | { ok: true; workspaceId: string; slackTeamId: string }
  | {
      ok: false;
      reason: "missing_team" | "sender_not_installed" | "authed_not_installed";
    }
> {
  const context = resolveSlackTenantContext(raw);
  const installations = new Map<string, SlackInstallation>();
  const teamIds = Array.from(
    new Set([context.senderTeamId, context.authedTeamId].filter(Boolean))
  );

  await Promise.all(
    teamIds.map(async (teamId) => {
      const installation = await getSlackInstallationByTeamId(teamId);
      if (installation) installations.set(teamId, installation);
    })
  );

  const choice = chooseSlackContributionTeam(context, (teamId) =>
    installations.has(teamId)
  );
  if (!choice.ok) return choice;

  const installation = installations.get(choice.slackTeamId);
  if (!installation) return { ok: false, reason: "authed_not_installed" };

  return {
    ok: true,
    workspaceId: installation.workspaceId,
    slackTeamId: installation.slackTeamId,
  };
}

async function postUnresolvedWorkspaceMessage(
  thread: Thread,
  reason: "missing_team" | "sender_not_installed" | "authed_not_installed"
) {
  if (reason === "missing_team") {
    await thread.post(
      "Non riesco a identificare il tuo workspace Slack. Assicurati che Unbundle sia installato correttamente."
    );
    return;
  }

  if (reason === "sender_not_installed") {
    await thread.post(
      "Questo canale sembra condiviso tra aziende. Per salvare il contributo nell'ambiente corretto, " +
        "Unbundle deve essere installato anche nel workspace Slack della persona che sta scrivendo. " +
        "Chiedi all'admin della tua azienda di collegare Slack a Unbundle, oppure usa la web app."
    );
    return;
  }

  await thread.post(
    "Questo workspace Slack non è collegato a un progetto Unbundle. " +
      "Chiedi all'admin di installare il bot dalla dashboard."
  );
}

function registerHandlers(bot: Chat) {
  bot.onNewMention(async (thread, message) => {
    await thread.subscribe();
    await thread.startTyping();

    const resolution = await resolveSlackWorkspace(
      message.raw as Record<string, string | undefined>
    );
    if (!resolution.ok) {
      await postUnresolvedWorkspaceMessage(thread, resolution.reason);
      return;
    }

    await handleUseCaseConversation(thread, message, resolution.workspaceId, {
      slackTeamId: resolution.slackTeamId,
    });
  });

  bot.onDirectMessage(async (thread, message) => {
    await thread.subscribe();
    await thread.startTyping();

    const resolution = await resolveSlackWorkspace(
      message.raw as Record<string, string | undefined>
    );
    if (!resolution.ok) {
      await postUnresolvedWorkspaceMessage(thread, resolution.reason);
      return;
    }

    await handleUseCaseConversation(thread, message, resolution.workspaceId, {
      slackTeamId: resolution.slackTeamId,
    });
  });

  bot.onSubscribedMessage(async (thread, message) => {
    await thread.startTyping();

    const resolution = await resolveSlackWorkspace(
      message.raw as Record<string, string | undefined>
    );
    if (!resolution.ok) {
      await postUnresolvedWorkspaceMessage(thread, resolution.reason);
      return;
    }

    await handleUseCaseConversation(thread, message, resolution.workspaceId, {
      slackTeamId: resolution.slackTeamId,
    });
  });
}

export function getSlackAdapter(): SlackAdapter {
  return getBot().getAdapter("slack") as SlackAdapter;
}
