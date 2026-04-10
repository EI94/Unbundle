import { eq, and, desc } from "drizzle-orm";
import { db } from "..";
import { conversations, messages, type Conversation, type Message } from "../schema";

export async function createConversation(data: {
  workspaceId: string;
  userId: string;
  type: "leadership_setup" | "context_setup" | "activity_mapping" | "analysis" | "general";
  departmentId?: string;
  title?: string;
}) {
  const [conv] = await db
    .insert(conversations)
    .values(data)
    .returning();
  return conv;
}

export async function getConversation(id: string) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  return conv ?? null;
}

export async function getConversationsByWorkspace(
  workspaceId: string,
  type?: string
) {
  const query = db
    .select()
    .from(conversations)
    .where(
      type
        ? and(
            eq(conversations.workspaceId, workspaceId),
            eq(conversations.type, type as Conversation["type"])
          )
        : eq(conversations.workspaceId, workspaceId)
    )
    .orderBy(desc(conversations.updatedAt));
  return query;
}

export async function getActiveConversation(
  workspaceId: string,
  type: Conversation["type"],
  departmentId?: string
) {
  const conditions = [
    eq(conversations.workspaceId, workspaceId),
    eq(conversations.type, type),
    eq(conversations.status, "active"),
  ];
  if (departmentId) {
    conditions.push(eq(conversations.departmentId, departmentId));
  }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(...conditions))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  return conv ?? null;
}

export async function getMessages(conversationId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);
}

export async function saveMessage(data: {
  conversationId: string;
  role: string;
  content: string;
  toolInvocations?: unknown;
}) {
  const [msg] = await db.insert(messages).values(data).returning();

  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, data.conversationId));

  return msg;
}

export async function updateConversationStatus(
  id: string,
  status: "active" | "paused" | "completed"
) {
  const [conv] = await db
    .update(conversations)
    .set({ status, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning();
  return conv;
}
