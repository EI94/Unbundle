/**
 * `use-case-admin team-name` (docs/use-case/DESIGN.md §10.5 e §14.2, D2): i workspace che
 * hanno scritto proprio «AI Transformation» come nome del team che valuta. Collidono con
 * l'etichetta d'origine «AI Transformation · dall'alto»: Pierpaolo decide se cambiarli da
 * Impostazioni. Il comando non scrive mai.
 *
 * Modulo puro: niente import.
 */

/** Il nome di oggi che collide con l'etichetta d'origine. */
export const LEGACY_TEAM_NAME = "AI Transformation";

/** Vero per «AI Transformation», senza distinguere maiuscole e spazi ai bordi o ripetuti. */
export function isLegacyTeamName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  return name.replace(/\s+/g, " ").trim().toLowerCase() === LEGACY_TEAM_NAME.toLowerCase();
}

/** I workspace dell'ambito con un nome del team scritto. Parametro facoltativo `$1`: il workspace. */
export function teamNamesSql(withWorkspace: boolean): string {
  return `SELECT w.id, w.name, w.ai_transformation_team_name AS team_name
  FROM workspaces w
 WHERE w.ai_transformation_team_name IS NOT NULL${withWorkspace ? " AND w.id = $1::uuid" : ""}
 ORDER BY w.created_at, w.id`;
}
