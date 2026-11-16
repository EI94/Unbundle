const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

/**
 * Divide il testo di un documento in pezzi da al massimo 1.000 caratteri, tagliati a un a capo o a un punto, con 200
 * caratteri in comune tra un pezzo e il successivo. Un pezzo di 50 caratteri o meno non si tiene.
 *
 * (Rilascio 9a) L'ultimo pezzo chiude il giro: prima, arrivati in fondo al testo, il giro ripartiva 200 caratteri
 * indietro e non finiva mai (ogni caricamento con del testo bloccava la funzione finché finiva la memoria).
 */
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

    // In fondo al testo si esce: non c'è un pezzo dopo l'ultimo.
    if (end >= text.length) break;
    // Il pezzo dopo riparte 200 caratteri prima della fine di questo, e sempre più avanti dell'inizio di questo.
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}

export async function indexDocument(
  documentId: string,
  workspaceId: string,
  text: string
): Promise<number> {
  const chunks = chunkDocument(text);
  if (chunks.length === 0) return 0;

  // Il database si carica solo qui: `chunkDocument` resta una funzione pura, che i test provano senza database.
  const [{ db }, { documentChunks }] = await Promise.all([import("@/lib/db"), import("@/lib/db/schema")]);

  const rows = chunks.map((content, i) => ({
    documentId,
    workspaceId,
    content,
    chunkIndex: i,
  }));

  const batchSize = 50;
  for (let i = 0; i < rows.length; i += batchSize) {
    await db.insert(documentChunks).values(rows.slice(i, i + batchSize));
  }

  return chunks.length;
}
