/**
 * Nome del team che valuta gli use case (docs/use-case/DESIGN.md §14.2, decisione D2).
 *
 * Il valore predefinito sta solo qui: testi, segnaposto e test usano la costante,
 * mai il valore scritto a mano. Ogni workspace può dare un nome suo da Impostazioni
 * (colonna `workspaces.ai_transformation_team_name`, che non si rinomina).
 * I testi mettono il nome da solo, senza articolo e senza «team» davanti.
 *
 * Modulo puro: nessun import.
 */

/** Nome predefinito del team che valuta gli use case. Scelto da Pierpaolo il 14/10/2026 (D2). */
export const DEFAULT_REVIEW_TEAM_NAME = "AI Builder";

/** Il nome scelto dal workspace, oppure quello predefinito se manca o è fatto solo di spazi. */
export function reviewTeamName(workspace: { aiTransformationTeamName?: string | null } | null | undefined): string {
  return workspace?.aiTransformationTeamName?.trim() || DEFAULT_REVIEW_TEAM_NAME;
}
