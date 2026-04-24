import { Chat } from "chat";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createPostgresState } from "@chat-adapter/state-pg";
import { handleUseCaseConversation } from "./use-case-agent";
import { getSlackInstallationByTeamId } from "@/lib/db/queries/slack";

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

async function resolveWorkspaceId(teamId: string): Promise<string | null> {
  const installation = await getSlackInstallationByTeamId(teamId);
  return installation?.workspaceId ?? null;
}

function registerHandlers(bot: Chat) {
  bot.onNewMention(async (thread, message) => {
    await thread.subscribe();
    await thread.startTyping();

    const raw = message.raw as Record<string, string | undefined>;
    /**
     * IMPORTANT (Slack Connect / canali condivisi):
     * - `team_id` è l'"authed team" (tenant che riceve l'evento / installation owner)
     * - `team` può rappresentare il team del mittente in contesti cross-org
     * Per multi-tenant dobbiamo sempre risolvere il workspace da `team_id`.
     */
    const authedTeamId = raw.team_id ?? raw.team ?? "";
    const senderTeamId = raw.team ?? raw.user_team ?? "";
    const isExternal = !!(senderTeamId && authedTeamId && senderTeamId !== authedTeamId);

    if (!authedTeamId) {
      await thread.post(
        "Non riesco a identificare il tuo workspace. Assicurati che Unbundle sia installato correttamente."
      );
      return;
    }

    if (isExternal) {
      await thread.post(
        "Sembra un canale condiviso tra organizzazioni (Slack Connect). " +
          "Per evitare che i dati finiscano nell'istanza sbagliata, posso raccogliere use case solo per i membri del workspace che mi ha installato. " +
          "Scrivimi in un canale interno del tuo workspace, oppure usa la web app Unbundle della tua azienda."
      );
      return;
    }

    const workspaceId = await resolveWorkspaceId(authedTeamId);
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

    const raw = message.raw as Record<string, string | undefined>;
    const authedTeamId = raw.team_id ?? raw.team ?? "";
    const senderTeamId = raw.team ?? raw.user_team ?? "";
    const isExternal = !!(senderTeamId && authedTeamId && senderTeamId !== authedTeamId);

    if (!authedTeamId) {
      await thread.post("Non riesco a identificare il workspace.");
      return;
    }

    if (isExternal) {
      await thread.post(
        "Sembra un contesto cross-azienda. Per sicurezza posso rispondere solo per il workspace che mi ha installato."
      );
      return;
    }

    const workspaceId = await resolveWorkspaceId(authedTeamId);
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

    const raw = message.raw as Record<string, string | undefined>;
    const authedTeamId = raw.team_id ?? raw.team ?? "";
    const senderTeamId = raw.team ?? raw.user_team ?? "";
    const isExternal = !!(senderTeamId && authedTeamId && senderTeamId !== authedTeamId);

    if (isExternal) {
      await thread.post(
        "Questo thread sembra provenire da un canale condiviso tra organizzazioni. " +
          "Per evitare cross-tenant, usa un canale interno o la web app Unbundle del tuo team."
      );
      return;
    }

    const workspaceId = authedTeamId ? await resolveWorkspaceId(authedTeamId) : null;

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
