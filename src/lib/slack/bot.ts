import { Chat } from "chat";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createPostgresState } from "@chat-adapter/state-pg";
import { handleUseCaseConversation } from "./use-case-agent";
import { getSlackInstallationByTeamId } from "@/lib/db/queries/slack";

let _bot: Chat | null = null;

export function getBot(): Chat {
  if (_bot) return _bot;

  const dbUrl = process.env.DATABASE_URL?.trim();
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!dbUrl || !signingSecret) {
    throw new Error(
      "Slack bot non configurato: DATABASE_URL e SLACK_SIGNING_SECRET necessari."
    );
  }

  const slack = createSlackAdapter({
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
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

async function resolveWorkspaceId(teamId: string): Promise<string | null> {
  const installation = await getSlackInstallationByTeamId(teamId);
  return installation?.workspaceId ?? null;
}

function registerHandlers(bot: Chat) {
  bot.onNewMention(async (thread, message) => {
    await thread.subscribe();
    await thread.startTyping();

    const teamId = (message.raw as Record<string, string>)?.team;
    if (!teamId) {
      await thread.post(
        "Non riesco a identificare il tuo workspace. Assicurati che Unbundle sia installato correttamente."
      );
      return;
    }

    const workspaceId = await resolveWorkspaceId(teamId);
    if (!workspaceId) {
      await thread.post(
        "Questo workspace Slack non è collegato a un progetto Unbundle. " +
          "Chiedi all'admin di installare il bot dalla dashboard."
      );
      return;
    }

    await handleUseCaseConversation(thread, message, workspaceId);
  });

  bot.onDirectMessage(async (thread, message) => {
    await thread.subscribe();
    await thread.startTyping();

    const teamId = (message.raw as Record<string, string>)?.team;
    if (!teamId) {
      await thread.post("Non riesco a identificare il workspace.");
      return;
    }

    const workspaceId = await resolveWorkspaceId(teamId);
    if (!workspaceId) {
      await thread.post(
        "Questo workspace Slack non è collegato a Unbundle. " +
          "Chiedi all'admin di completare l'installazione."
      );
      return;
    }

    await handleUseCaseConversation(thread, message, workspaceId);
  });

  bot.onSubscribedMessage(async (thread, message) => {
    await thread.startTyping();

    const teamId = (message.raw as Record<string, string>)?.team;
    const workspaceId = teamId ? await resolveWorkspaceId(teamId) : null;

    if (!workspaceId) {
      await thread.post("Non riesco a trovare il progetto Unbundle collegato.");
      return;
    }

    await handleUseCaseConversation(thread, message, workspaceId);
  });
}

export function getSlackAdapter(): SlackAdapter {
  return getBot().getAdapter("slack") as SlackAdapter;
}
