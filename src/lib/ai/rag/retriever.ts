import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import { db } from "@/lib/db";
import { documentChunks, conversationEmbeddings } from "@/lib/db/schema";
import { eq, sql, and, desc } from "drizzle-orm";

export interface RetrievedChunk {
  content: string;
  similarity: number;
  source: "document" | "conversation";
  documentId?: string;
  conversationId?: string;
}

interface RetrieveOptions {
  topK?: number;
  includeConversations?: boolean;
  minSimilarity?: number;
  departmentId?: string;
}

export async function retrieveRelevantContext(
  query: string,
  workspaceId: string,
  options: RetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const {
    topK = 10,
    includeConversations = true,
    minSimilarity = 0.3,
  } = options;

  const { embedding: queryEmbedding } = await embed({
    model: openai.embedding("text-embedding-3-small"),
    value: query,
  });

  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const docResults = await db
    .select({
      content: documentChunks.content,
      similarity: sql<number>`1 - (${documentChunks.embedding} <=> ${embeddingStr}::vector)`.as(
        "similarity"
      ),
      documentId: documentChunks.documentId,
    })
    .from(documentChunks)
    .where(eq(documentChunks.workspaceId, workspaceId))
    .orderBy(
      sql`${documentChunks.embedding} <=> ${embeddingStr}::vector`
    )
    .limit(topK);

  const chunks: RetrievedChunk[] = docResults
    .filter((r) => r.similarity >= minSimilarity)
    .map((r) => ({
      content: r.content,
      similarity: r.similarity,
      source: "document" as const,
      documentId: r.documentId,
    }));

  if (includeConversations) {
    const convResults = await db
      .select({
        content: conversationEmbeddings.content,
        similarity:
          sql<number>`1 - (${conversationEmbeddings.embedding} <=> ${embeddingStr}::vector)`.as(
            "similarity"
          ),
        conversationId: conversationEmbeddings.conversationId,
      })
      .from(conversationEmbeddings)
      .where(eq(conversationEmbeddings.workspaceId, workspaceId))
      .orderBy(
        sql`${conversationEmbeddings.embedding} <=> ${embeddingStr}::vector`
      )
      .limit(Math.ceil(topK / 2));

    for (const r of convResults) {
      if (r.similarity >= minSimilarity) {
        chunks.push({
          content: r.content,
          similarity: r.similarity,
          source: "conversation",
          conversationId: r.conversationId,
        });
      }
    }
  }

  chunks.sort((a, b) => b.similarity - a.similarity);

  const seen = new Set<string>();
  const deduped: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    const key = chunk.content.slice(0, 200);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(chunk);
    }
  }

  return deduped.slice(0, topK);
}

export async function indexConversationMessage(
  conversationId: string,
  workspaceId: string,
  content: string,
  role: string
): Promise<void> {
  if (!content || content.length < 30) return;

  try {
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: content.slice(0, 8000),
    });

    await db.insert(conversationEmbeddings).values({
      conversationId,
      workspaceId,
      content: content.slice(0, 5000),
      role,
      embedding,
    });
  } catch {
    console.error("Failed to index conversation message");
  }
}
