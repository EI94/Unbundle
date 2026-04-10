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

function extractContent(msg: Record<string, unknown>): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.parts)) {
    return (msg.parts as Array<{ type?: string; text?: string }>)
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text!)
      .join("");
  }
  return "";
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const workspaceId = body.workspaceId as string;
  const conversationType = body.conversationType as string;
  const departmentId = body.departmentId as string | undefined;
  const rawMessages = body.messages as Array<Record<string, unknown>>;

  if (!workspaceId || !conversationType || !rawMessages) {
    return new Response("Missing required fields", { status: 400 });
  }

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    return new Response("Workspace not found", { status: 404 });
  }

  const messages = rawMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: extractContent(m),
  }));

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
    conversationType as
      | "leadership_setup"
      | "context_setup"
      | "activity_mapping"
      | "analysis"
      | "general",
    departmentId
  );

  if (!conversation) {
    conversation = await createConversation({
      workspaceId,
      userId: session.user.id,
      type: conversationType as
        | "leadership_setup"
        | "context_setup"
        | "activity_mapping"
        | "analysis"
        | "general",
      departmentId,
      title:
        conversationType === "leadership_setup"
          ? "Intervista Strategica"
          : conversationType === "activity_mapping"
            ? "Activity Mapping"
            : "Conversazione",
    });
  }

  const lastUserMessage = messages[messages.length - 1];
  if (lastUserMessage?.role === "user" && lastUserMessage.content) {
    await saveMessage({
      conversationId: conversation.id,
      role: "user",
      content: lastUserMessage.content,
    });
  }

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: systemPrompt,
    messages,
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
