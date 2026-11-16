import "server-only";
/**
 * La tesi del valore per workspace (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §2.2, §10.1).
 *
 * Prima stava sull'organizzazione: i workspace della stessa organizzazione se la sovrascrivevano. Dalla 0038 sta su
 * `workspaces.company_value_thesis`. Quella dell'organizzazione resta come valore di partenza e non si scrive più.
 *
 * La colonna non è dichiarata nella tabella Drizzle `workspaces` (senza la 0038 ogni `select()` su `workspaces`
 * darebbe errore): la leggono e la scrivono solo queste due funzioni, con SQL scritto a mano. Ogni altra lettura della
 * tesi passa da `getWorkspaceValueThesis` (src/lib/context/source-rules.test.ts).
 */
import { sql } from "drizzle-orm";
import type { z } from "zod";
import type { companyValueThesisSchema } from "@/lib/ai/schemas";
import { db } from "@/lib/db";
import { contextStoreReady, contextStoreState } from "@/lib/db/queries/context-store";
import { logSafeError } from "@/lib/log/safe-error";
import { isUuid } from "@/lib/uc/ids";

export type CompanyValueThesis = z.infer<typeof companyValueThesisSchema>;

type Rows = { rows?: Array<Record<string, unknown>> };

/** Una tesi salvata è un oggetto: ogni altro valore conta come «nessuna tesi». */
function thesisOf(value: unknown): CompanyValueThesis | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as CompanyValueThesis) : null;
}

/**
 * La tesi del workspace. Con la 0038: `workspaces.company_value_thesis`; se è nulla e l'organizzazione ha un solo
 * workspace, quella dell'organizzazione. Senza la 0038: quella dell'organizzazione (il comportamento di prima). Se la
 * sonda della 0038 non risponde non si sa quale vale: quella dell'organizzazione solo se l'organizzazione ha un workspace
 * solo, altrimenti nessuna (la tesi di un'organizzazione con più workspace non è di tutti).
 */
export async function getWorkspaceValueThesis(workspaceId: string): Promise<CompanyValueThesis | null> {
  if (!isUuid(workspaceId)) return null;
  const store = await contextStoreState();
  if (store !== "pronto") {
    const result = (await db.execute(sql`
      SELECT o.company_value_thesis AS org_thesis,
        (SELECT count(*) FROM workspaces x WHERE x.organization_id = w.organization_id)::int AS workspaces
      FROM workspaces w JOIN organizations o ON o.id = w.organization_id
      WHERE w.id = ${workspaceId}::uuid`)) as unknown as Rows;
    const row = result.rows?.[0];
    if (!row) return null;
    if (store === "sconosciuto" && Number(row.workspaces) !== 1) return null;
    return thesisOf(row.org_thesis);
  }
  const result = (await db.execute(sql`
    SELECT w.company_value_thesis AS ws_thesis, o.company_value_thesis AS org_thesis,
      (SELECT count(*) FROM workspaces x WHERE x.organization_id = w.organization_id)::int AS workspaces
    FROM workspaces w JOIN organizations o ON o.id = w.organization_id
    WHERE w.id = ${workspaceId}::uuid`)) as unknown as Rows;
  const row = result.rows?.[0];
  if (!row) return null;
  return thesisOf(row.ws_thesis) ?? (Number(row.workspaces) === 1 ? thesisOf(row.org_thesis) : null);
}

/** Scrive sul workspace. Senza la 0038: sull'organizzazione, solo se ha un solo workspace; altrimenti false. */
export async function saveWorkspaceValueThesis(workspaceId: string, thesis: CompanyValueThesis): Promise<boolean> {
  if (!isUuid(workspaceId) || thesisOf(thesis) === null) return false;
  try {
    const value = JSON.stringify(thesis);
    if (await contextStoreReady()) {
      const result = (await db.execute(sql`
        UPDATE workspaces SET company_value_thesis = ${value}::jsonb, updated_at = now()
        WHERE id = ${workspaceId}::uuid
        RETURNING id`)) as unknown as Rows;
      return (result.rows?.length ?? 0) === 1;
    }
    const result = (await db.execute(sql`
      UPDATE organizations o SET company_value_thesis = ${value}::jsonb, updated_at = now()
      FROM workspaces w
      WHERE w.id = ${workspaceId}::uuid AND o.id = w.organization_id
        AND (SELECT count(*) FROM workspaces x WHERE x.organization_id = o.id) = 1
      RETURNING o.id`)) as unknown as Rows;
    return (result.rows?.length ?? 0) === 1;
  } catch (error) {
    logSafeError("context/value-thesis", "tesi_non_salvata", error, { workspaceId });
    return false;
  }
}
