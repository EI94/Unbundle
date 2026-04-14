import { streamText, stepCountIs } from "ai";
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
import { uploadedDocuments, organizations, activities } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { retrieveRelevantContext, indexConversationMessage } from "@/lib/ai/rag/retriever";

/** Vercel / Next: consenti più round LLM dopo i tool (webSearch, salvataggi DB, ecc.) */
export const maxDuration = 120;

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

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, workspace.organizationId))
    .limit(1);

  let contextBlock = "";

  const unitTerm = (workspace.unitTerminology as { singular: string; plural: string } | null);
  if (unitTerm?.singular) {
    contextBlock += `\n\n--- TERMINOLOGIA ORGANIZZATIVA ---\nL'utente chiama le proprie unità organizzative "${unitTerm.plural}" (singolare: "${unitTerm.singular}"). Usa SEMPRE questi termini, MAI "dipartimento" o "funzione" generici.\n`;
  }

  if (org?.companyValueThesis) {
    contextBlock += `\n--- CONTESTO: VALUE THESIS GIÀ RACCOLTA ---\n${JSON.stringify(org.companyValueThesis, null, 2)}\n`;
  }

  if (workspace.systemBoundary) {
    contextBlock += `\n--- CONTESTO: SYSTEM BOUNDARY ---\n${JSON.stringify(workspace.systemBoundary, null, 2)}\n`;
  }

  const lastUserContent = messages[messages.length - 1]?.content ?? "";
  let ragChunks: { content: string; source: string }[] = [];
  try {
    if (lastUserContent.length > 10) {
      ragChunks = await retrieveRelevantContext(lastUserContent, workspaceId, {
        topK: 8,
        includeConversations: true,
      });
    }
  } catch {
    // RAG fallback: se embedding non disponibile, carica doc summaries
  }

  if (ragChunks.length > 0) {
    const docChunks = ragChunks.filter((c) => c.source === "document");
    const convChunks = ragChunks.filter((c) => c.source === "conversation");

    if (docChunks.length > 0) {
      contextBlock += `\n--- CONTESTO RILEVANTE DAI DOCUMENTI (${docChunks.length} frammenti) ---\n`;
      for (const chunk of docChunks) {
        contextBlock += `\n${chunk.content}\n`;
      }
    }
    if (convChunks.length > 0) {
      contextBlock += `\n--- MEMORIA DA CONVERSAZIONI PRECEDENTI (${convChunks.length} frammenti) ---\n`;
      for (const chunk of convChunks) {
        contextBlock += `\n${chunk.content}\n`;
      }
    }
    contextBlock += `\nUsa queste informazioni per arricchire le tue risposte. Fai riferimento a contenuti specifici quando pertinente.\n`;
  } else {
    const docs = await db
      .select({ fileName: uploadedDocuments.fileName, summary: uploadedDocuments.summary })
      .from(uploadedDocuments)
      .where(eq(uploadedDocuments.workspaceId, workspaceId));

    if (docs.length > 0) {
      contextBlock += `\n--- DOCUMENTI CARICATI DALL'UTENTE (${docs.length}) ---\n`;
      for (const doc of docs) {
        contextBlock += `\nDocumento: ${doc.fileName}\n`;
        if (doc.summary) contextBlock += `Sintesi: ${doc.summary}\n`;
      }
      contextBlock += `\nUsa queste informazioni per arricchire le tue domande e risposte. Fai riferimento ai documenti quando pertinente.\n`;
    }
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
    case "activity_mapping": {
      let mappingContext = contextBlock;

      if (departmentId) {
        const existingActivities = await db
          .select({
            id: activities.id,
            title: activities.title,
            description: activities.description,
            workType: activities.workType,
            timeSpentHoursWeek: activities.timeSpentHoursWeek,
          })
          .from(activities)
          .where(
            and(
              eq(activities.workspaceId, workspaceId),
              eq(activities.departmentId, departmentId)
            )
          );

        if (existingActivities.length > 0) {
          mappingContext += `\n--- ATTIVITÀ GIÀ SALVATE PER QUESTO DIPARTIMENTO (${existingActivities.length}) ---\n`;
          for (const act of existingActivities) {
            mappingContext += `- [${act.id}] "${act.title}" (${act.workType ?? "non classificata"}): ${act.description ?? ""}\n`;
          }
          mappingContext += `\nQueste attività sono già nel database. NON ri-salvarle. Usale come base per il deep dive.\n`;
        }

        const deptDocs = await db
          .select({
            fileName: uploadedDocuments.fileName,
            summary: uploadedDocuments.summary,
          })
          .from(uploadedDocuments)
          .where(
            and(
              eq(uploadedDocuments.workspaceId, workspaceId),
              eq(uploadedDocuments.departmentId, departmentId)
            )
          );

        if (deptDocs.length > 0) {
          mappingContext += `\n--- DOCUMENTI SPECIFICI (${deptDocs.length}) ---\n`;
          for (const doc of deptDocs) {
            mappingContext += `\nDocumento: ${doc.fileName}\n`;
            if (doc.summary) mappingContext += `Sintesi: ${doc.summary}\n`;
          }
          mappingContext += `\nI contenuti dettagliati dei documenti sono già inclusi nel contesto RAG sopra, in base alla rilevanza con la domanda dell'utente.\n`;
        }
      }

      systemPrompt = ACTIVITY_MAPPING_SYSTEM_PROMPT + mappingContext;
      tools = {
        ...getActivityMappingTools(workspaceId, departmentId!),
        ...getWebSearchTool(),
      };
      break;
    }
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
    // Default SDK = stepCountIs(1): dopo un tool call lo stream si chiude SENZA secondo round
    // → UI bloccata su "Elaboro...". Serve un budget di step per testo post-tool.
    stopWhen: stepCountIs(20),
    onFinish: async ({ text }) => {
      if (text) {
        await saveMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: text,
        });

        indexConversationMessage(
          conversation.id,
          workspaceId,
          text,
          "assistant"
        ).catch(() => {});
      }

      if (lastUserMessage?.content) {
        indexConversationMessage(
          conversation.id,
          workspaceId,
          lastUserMessage.content,
          "user"
        ).catch(() => {});
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
