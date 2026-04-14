import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { auth } from "@/lib/auth";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getLeadershipTools } from "@/lib/ai/tools/leadership-tools";
import { getActivityMappingTools } from "@/lib/ai/tools/activity-mapping-tools";
import { getWebSearchTool } from "@/lib/ai/tools/web-search-tool";
import { DISCOVERY_SYSTEM_PROMPT } from "@/lib/ai/prompts/discovery";
import { ACTIVITY_MAPPING_SYSTEM_PROMPT } from "@/lib/ai/prompts/activity-mapping";
import {
  saveMessage,
  getActiveConversation,
  createConversation,
} from "@/lib/db/queries/conversations";
import { db } from "@/lib/db";
import { uploadedDocuments, organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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

  const docs = await db
    .select({ fileName: uploadedDocuments.fileName, summary: uploadedDocuments.summary })
    .from(uploadedDocuments)
    .where(eq(uploadedDocuments.workspaceId, workspaceId));

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, workspace.organizationId))
    .limit(1);

  let contextBlock = "";

  if (org?.companyValueThesis) {
    contextBlock += `\n\n--- CONTESTO: VALUE THESIS GIÀ RACCOLTA ---\n${JSON.stringify(org.companyValueThesis, null, 2)}\n`;
  }

  if (workspace.systemBoundary) {
    contextBlock += `\n--- CONTESTO: SYSTEM BOUNDARY ---\n${JSON.stringify(workspace.systemBoundary, null, 2)}\n`;
  }

  if (docs.length > 0) {
    contextBlock += `\n--- DOCUMENTI CARICATI DALL'UTENTE (${docs.length}) ---\n`;
    for (const doc of docs) {
      contextBlock += `\nDocumento: ${doc.fileName}\n`;
      if (doc.summary) contextBlock += `Sintesi: ${doc.summary}\n`;
    }
    contextBlock += `\nUsa queste informazioni per arricchire le tue domande e risposte. Fai riferimento ai documenti quando pertinente.\n`;
  }

  let systemPrompt: string;
  let tools: Record<string, unknown>;

  switch (conversationType) {
    case "leadership_setup":
      systemPrompt = DISCOVERY_SYSTEM_PROMPT + contextBlock;
      tools = {
        ...getLeadershipTools(workspaceId, workspace.organizationId),
        ...getWebSearchTool(),
      };
      break;
    case "activity_mapping":
      systemPrompt = ACTIVITY_MAPPING_SYSTEM_PROMPT + contextBlock;
      tools = {
        ...getActivityMappingTools(workspaceId, departmentId!),
        ...getWebSearchTool(),
      };
      break;
    default:
      systemPrompt = DISCOVERY_SYSTEM_PROMPT + contextBlock;
      tools = {
        ...getLeadershipTools(workspaceId, workspace.organizationId),
        ...getWebSearchTool(),
      };
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
          ? "Discovery"
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
