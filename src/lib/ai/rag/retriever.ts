import { db } from "@/lib/db";
import { documentChunks, conversationMemory } from "@/lib/db/schema";
import { sql, desc } from "drizzle-orm";
import { scanPersonalData } from "@/lib/context/scan";
import { contextStoreReady } from "@/lib/db/queries/context-store";

export interface RetrievedChunk {
  content: string;
  rank: number;
  source: "document" | "conversation";
  documentId?: string;
  conversationId?: string;
}

interface RetrieveOptions {
  topK?: number;
  includeConversations?: boolean;
  /**
   * (Rilascio 9a) Chi scrive nella chat. I frammenti dei documenti «Solo Lateral Space» tornano solo a Lateral Space:
   * per gli altri, e quando `viewer` manca, restano fuori (si chiude, non si apre).
   */
  viewer?: { isLateralSpace: boolean };
}

function buildTsQuery(input: string): string {
  const words = input
    .replace(/[^\w\sàèéìòùáéíóú]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 15);
  if (words.length === 0) return "";
  return words.map((w) => `${w}:*`).join(" | ");
}

export async function retrieveRelevantContext(
  query: string,
  workspaceId: string,
  options: RetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const { topK = 10, includeConversations = true } = options;

  const tsQuery = buildTsQuery(query);
  if (!tsQuery) return [];

  // I documenti «Solo Lateral Space» (un file caricato da «Aggiungi appunti») non arrivano al cliente dalla chat. La
  // visibilità sta sulla fonte del documento (0038): senza la 0038 nessun documento è «Solo Lateral Space».
  const lsOnly =
    options.viewer?.isLateralSpace !== true && (await contextStoreReady())
      ? sql` AND NOT EXISTS (SELECT 1 FROM context_sources s WHERE s.document_id = ${documentChunks.documentId} AND s.visibility = 'ls')`
      : sql``;

  const docResults = await db
    .select({
      content: documentChunks.content,
      rank: sql<number>`ts_rank_cd(to_tsvector('italian', ${documentChunks.content}), to_tsquery('italian', ${tsQuery}))`.as(
        "rank"
      ),
      documentId: documentChunks.documentId,
    })
    .from(documentChunks)
    .where(
      sql`${documentChunks.workspaceId} = ${workspaceId} AND to_tsvector('italian', ${documentChunks.content}) @@ to_tsquery('italian', ${tsQuery})${lsOnly}`
    )
    .orderBy(
      desc(
        sql`ts_rank_cd(to_tsvector('italian', ${documentChunks.content}), to_tsquery('italian', ${tsQuery}))`
      )
    )
    .limit(topK);

  const chunks: RetrievedChunk[] = docResults.map((r) => ({
    content: r.content,
    rank: r.rank,
    source: "document" as const,
    documentId: r.documentId,
  }));

  if (includeConversations) {
    const convResults = await db
      .select({
        content: conversationMemory.content,
        rank: sql<number>`ts_rank_cd(to_tsvector('italian', ${conversationMemory.content}), to_tsquery('italian', ${tsQuery}))`.as(
          "rank"
        ),
        conversationId: conversationMemory.conversationId,
      })
      .from(conversationMemory)
      .where(
        sql`${conversationMemory.workspaceId} = ${workspaceId} AND to_tsvector('italian', ${conversationMemory.content}) @@ to_tsquery('italian', ${tsQuery})`
      )
      .orderBy(
        desc(
          sql`ts_rank_cd(to_tsvector('italian', ${conversationMemory.content}), to_tsquery('italian', ${tsQuery}))`
        )
      )
      .limit(Math.ceil(topK / 2));

    for (const r of convResults) {
      chunks.push({
        content: r.content,
        rank: r.rank,
        source: "conversation",
        conversationId: r.conversationId,
      });
    }
  }

  chunks.sort((a, b) => b.rank - a.rank);

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

/**
 * Mette un messaggio nella memoria della chat (cercata per parole dai turni dopo).
 *
 * (Rilascio 9a) Un messaggio con dati sanitari o discriminatori, un nome e cognome, una data di nascita, un codice
 * fiscale, un'e-mail o un telefono non entra nella memoria. Il messaggio resta nella conversazione; nel log solo il
 * motivo, mai il testo.
 */
export async function indexConversationMessage(
  conversationId: string,
  workspaceId: string,
  content: string,
  role: string
): Promise<void> {
  if (!content || content.length < 30) return;
  const scan = scanPersonalData(content);
  if (!scan.ok) {
    console.warn("[chat/memoria] non_indicizzato", JSON.stringify({ motivo: scan.issue }));
    return;
  }

  try {
    await db.insert(conversationMemory).values({
      conversationId,
      workspaceId,
      content: content.slice(0, 5000),
      role,
    });
  } catch {
    console.error("Failed to index conversation message");
  }
}
