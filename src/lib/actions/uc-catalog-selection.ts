"use server";

import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { loadQuestionSelection } from "@/lib/db/queries/uc-questions";
import { loadCatalogSelection, type CatalogSelection, type CatalogSelectionSpec } from "@/lib/db/queries/uc-views";
import { parseCatalogQuery } from "@/lib/uc/views/catalog-filter";
import type { CaseRole } from "@/lib/uc/vocab";
import { openUcCase, ucFailure, type UcActionResult } from "./uc-action-context";

/**
 * Selezione per le azioni in blocco del catalogo (PIANO §5.1, «Voci e
 * risposte»). Solo letture: restituisce id e stato delle voci, mai valori.
 *
 * - «Seleziona tutte le N» di Domande: le domande della vista (la query della
 *   pagina, con `vista` e `indispensabili` sempre scritti), su tutte le pagine.
 * - «Seleziona tutti i risultati» del vecchio catalogo (fino a WP13): le voci
 *   che corrispondono ai filtri della pagina, su tutte le pagine.
 * - «Assegna per ruolo»: le voci aperte di un ruolo titolare, chieste al
 *   momento di assegnare invece di viaggiare nella pagina.
 *
 * Solo chi ha almeno un'azione in blocco e non è in sola lettura; i comandi
 * che seguono ricontrollano ogni voce.
 */

const BULK_ROLES: readonly CaseRole[] = ["ls_lead", "ls_analista", "owner_cliente"];
const ROLE_ASSIGNERS: readonly CaseRole[] = ["ls_lead"];

const InputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("domande"), query: z.string().max(2000) }),
  z.object({ kind: z.literal("filtro"), query: z.string().max(2000) }),
  z.object({ kind: z.literal("ruolo"), roleKey: z.string().regex(/^[a-z0-9_]{1,80}$/), includeAssigned: z.boolean() }),
]);

/** Id e stato delle voci da selezionare (al massimo 5.000), raggruppati per stato. */
export async function selectCatalogItemsAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<CatalogSelection>> {
  const { session, access } = await requireWorkspaceAccess(workspaceId);
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return ucFailure("dati_non_validi", "Selezione non valida.");
  const allow = parsed.data.kind === "ruolo" ? ROLE_ASSIGNERS : BULK_ROLES;
  const opened = await openUcCase({ session, access, workspaceId, caseId, allow, write: true });
  if (!opened.ok) return opened.result;
  const { executor, caseAccess } = opened.value;
  const viewer = { workspaceId, caseId: caseAccess.caseId, roles: caseAccess.roles, user: caseAccess.user, readOnly: caseAccess.readOnly };
  // Domande (WP3): la query della pagina porta sempre `vista` e `indispensabili`.
  if (parsed.data.kind === "domande") return { ok: true, data: await loadQuestionSelection(executor, viewer, parsed.data.query) };
  const spec: CatalogSelectionSpec =
    parsed.data.kind === "filtro"
      ? { kind: "filtro", filter: { ...parseCatalogQuery(parsed.data.query), pagina: 1 } }
      : { kind: "ruolo", roleKey: parsed.data.roleKey, includeAssigned: parsed.data.includeAssigned };
  const selection = await loadCatalogSelection(executor, viewer, spec);
  return { ok: true, data: selection };
}
