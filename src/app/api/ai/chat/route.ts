import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { auth } from "@/lib/auth";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getLeadershipTools } from "@/lib/ai/tools/leadership-tools";
import { getActivityMappingTools } from "@/lib/ai/tools/activity-mapping-tools";
import { LEADERSHIP_SETUP_SYSTEM_PROMPT } from "@/lib/ai/prompts/leadership-setup";
import { ACTIVITY_MAPPING_SYSTEM_PROMPT } from "@/lib/ai/prompts/activity-mapping";
import {
  saveMessage,
  getActiveConversation,
  createConversation,
} from "@/lib/db/queries/conversations";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const {
    messages,
    workspaceId,
    conversationType,
    departmentId,
  }: {
    messages: Array<{ role: string; content: string }>;
    workspaceId: string;
    conversationType: string;
    departmentId?: string;
  } = await req.json();

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    return new Response("Workspace not found", { status: 404 });
  }

  let systemPrompt: string;
  let tools: Record<string, unknown>;

  switch (conversationType) {
    case "leadership_setup":
      systemPrompt = LEADERSHIP_SETUP_SYSTEM_PROMPT;
      tools = getLeadershipTools(workspaceId, workspace.organizationId);
      break;
    case "activity_mapping":
      systemPrompt = ACTIVITY_MAPPING_SYSTEM_PROMPT;
      tools = getActivityMappingTools(workspaceId, departmentId!);
      break;
    default:
      systemPrompt = LEADERSHIP_SETUP_SYSTEM_PROMPT;
      tools = getLeadershipTools(workspaceId, workspace.organizationId);
  }

  let conversation = await getActiveConversation(
    workspaceId,
    conversationType as "leadership_setup" | "context_setup" | "activity_mapping" | "analysis" | "general",
    departmentId
  );

  if (!conversation) {
    conversation = await createConversation({
      workspaceId,
      userId: session.user.id,
      type: conversationType as "leadership_setup" | "context_setup" | "activity_mapping" | "analysis" | "general",
      departmentId,
      title:
        conversationType === "leadership_setup"
          ? "Setup Leadership"
          : conversationType === "activity_mapping"
            ? "Activity Mapping"
            : "Conversazione",
    });
  }

  const lastUserMessage = messages[messages.length - 1];
  if (lastUserMessage?.role === "user") {
    await saveMessage({
      conversationId: conversation.id,
      role: "user",
      content: lastUserMessage.content,
    });
  }

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: systemPrompt,
    messages: messages as Array<{ role: "user" | "assistant"; content: string }>,
    tools: tools as Parameters<typeof streamText>[0]["tools"],
    onFinish: async ({ text }) => {
      if (text) {
        await saveMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: text,
        });
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
