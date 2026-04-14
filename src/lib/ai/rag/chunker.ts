import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";
import { db } from "@/lib/db";
import { documentChunks } from "@/lib/db/schema";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

export function chunkDocument(text: string): string[] {
  const chunks: string[] = [];
  if (!text || text.length === 0) return chunks;

  let start = 0;
  while (start < text.length) {
    let end = start + CHUNK_SIZE;

    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      const lastPeriod = text.lastIndexOf(". ", end);
      const breakPoint = Math.max(lastNewline, lastPeriod);
      if (breakPoint > start + CHUNK_SIZE / 2) {
        end = breakPoint + 1;
      }
    } else {
      end = text.length;
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) {
      chunks.push(chunk);
    }

    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
    if (start >= text.length) break;
  }

  return chunks;
}

export async function embedChunks(
  chunks: string[]
): Promise<number[][]> {
  if (chunks.length === 0) return [];

  const batchSize = 96;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const { embeddings } = await embedMany({
      model: openai.embedding("text-embedding-3-small"),
      values: batch,
    });
    allEmbeddings.push(...embeddings);
  }

  return allEmbeddings;
}

export async function indexDocument(
  documentId: string,
  workspaceId: string,
  text: string
): Promise<number> {
  const chunks = chunkDocument(text);
  if (chunks.length === 0) return 0;

  const embeddings = await embedChunks(chunks);

  const rows = chunks.map((content, i) => ({
    documentId,
    workspaceId,
    content,
    chunkIndex: i,
    embedding: embeddings[i],
    metadata: {
      charStart: 0,
      chunkLength: content.length,
    },
  }));

  const batchSize = 50;
  for (let i = 0; i < rows.length; i += batchSize) {
    await db.insert(documentChunks).values(rows.slice(i, i + batchSize));
  }

  return chunks.length;
}
