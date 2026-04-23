import type { UseCase } from "@/lib/db/schema";
import { getSlackInstallationByTeamId } from "@/lib/db/queries/slack";
import { db } from "@/lib/db";
import { weeklySignals } from "@/lib/db/schema";

/** URL pubblico dell’app (link nel messaggio admin Slack). */
function getAppBaseUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return null;
}

function portfolioHeadline(useCase: UseCase): string {
  if (useCase.portfolioKind === "best_practice") {
    return "*Nuova best practice proposta* :white_check_mark:";
  }
  if (useCase.portfolioKind === "use_case_ai") {
    return "*Nuovo use case AI proposto* :sparkles:";
  }
  return "*Nuovo contributo portfolio proposto* :sparkles:";
}

/**
 * Avvisa il canale admin Slack quando un contributo è stato **creato** (stato proposto).
 * Chi ha compilato: mention Slack `<@U…>` (Slack mostra il nome visualizzato del membro).
 */
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

    const base = getAppBaseUrl();
    const detailPath = `/dashboard/${workspaceId}/use-cases/${useCase.id}`;
    const detailUrl = base ? `${base}${detailPath}` : null;

    const proposer =
      useCase.proposedBy && useCase.proposedBy.startsWith("U")
        ? `<@${useCase.proposedBy}>`
        : useCase.proposedBy ?? "Contributore";

    const excerpt = useCase.description
      ? useCase.description.slice(0, 200) +
        (useCase.description.length > 200 ? "…" : "")
      : "Nessuna descrizione";

    const lines = [
      portfolioHeadline(useCase),
      "",
      `*${useCase.title}*`,
      excerpt ? `_Anteprima:_ ${excerpt}` : "_Anteprima:_ —",
      "",
      `*Compilato da:* ${proposer}`,
      `_Stato in Unbundle:_ \`${useCase.status}\` _(da triage in dashboard)._`,
    ];

    if (detailUrl) {
      lines.push("", `*Apri in Unbundle:* ${detailUrl}`);
    } else {
      lines.push(
        "",
        "_Per il link diretto alla scheda, configura `NEXT_PUBLIC_APP_URL` sul server (o usa il deploy Vercel con `VERCEL_URL`)._"
      );
    }

    const text = lines.join("\n");

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
