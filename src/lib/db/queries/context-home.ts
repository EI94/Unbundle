import "server-only";
/**
 * Quello che la Home (rilascio 10, «Per partire», docs/ui-10/PROPOSTA-10.md §3.3) chiede a «Contesto»: c'è già un
 * appunto o una trascrizione delle prime call? Un sì o un no sul workspace, mai il contenuto, il titolo o chi l'ha
 * aggiunto: la riga «Aggiungi gli appunti delle prime call» si spunta per tutti i revisori anche se gli appunti li vede
 * solo Lateral Space.
 *
 * Si chiude, non si apre: senza la 0038, o se la lettura non riesce, la risposta è «no» e la riga resta da fare.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { contextSources } from "@/lib/db/schema";
import type { SourceKind } from "@/lib/context/vocab";
import { logSafeError } from "@/lib/log/safe-error";
import { contextStoreReady } from "./context-store";
import { isUuid } from "./context-shared";

/** Gli appunti delle call: scritti a mano o arrivati da Granola. */
const CALL_NOTE_KINDS: readonly SourceKind[] = ["appunti", "trascrizione"];

/** Vero se il workspace ha almeno un appunto o una trascrizione nel Contesto. */
export async function contextHasCallNotes(workspaceId: string): Promise<boolean> {
  if (!isUuid(workspaceId)) return false;
  try {
    if (!(await contextStoreReady())) return false;
    const [row] = await db
      .select({ id: contextSources.id })
      .from(contextSources)
      .where(and(eq(contextSources.workspaceId, workspaceId), inArray(contextSources.kind, [...CALL_NOTE_KINDS])))
      .limit(1);
    return Boolean(row);
  } catch (error) {
    logSafeError("context/home", "lettura_non_riuscita", error, { workspaceId });
    return false;
  }
}
