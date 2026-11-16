import "server-only";
/**
 * Le letture che le pagine di «Contesto» fanno fuori dalle funzioni di `context-*.ts` (rilascio 9a,
 * docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7): gli use case del workspace, per collegarli a un fatto o a una proposta,
 * e il giorno di oggi a Roma. Nessuna tabella di «Contesto» qui.
 */
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { useCases } from "@/lib/db/schema";
import { logSafeError } from "@/lib/log/safe-error";
import { romeDate } from "@/lib/uc/calendar";
import type { UseCaseOption } from "./fields";

/** Quanti use case al massimo nella scelta: gli stessi che la lettura passa al modello. */
const USE_CASE_OPTIONS_MAX = 200;

/** Gli use case del workspace (id, codice, titolo), prima quelli con il codice. Se la lettura non riesce, nessuno. */
export async function loadUseCaseOptions(workspaceId: string): Promise<UseCaseOption[]> {
  try {
    return await db
      .select({ id: useCases.id, code: useCases.code, title: useCases.title })
      .from(useCases)
      .where(eq(useCases.workspaceId, workspaceId))
      .orderBy(sql`${useCases.code} IS NULL`, asc(useCases.code), asc(useCases.title))
      .limit(USE_CASE_OPTIONS_MAX);
  } catch (error) {
    logSafeError("context/page", "use_case_non_letti", error, { workspaceId });
    return [];
  }
}

/** Oggi a Roma, AAAA-MM-GG: le date a schermo («14 nov») e le scadenze si contano da qui. */
export function romeToday(now: Date = new Date()): string {
  return romeDate(now);
}
