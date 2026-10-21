/**
 * `use-case-admin slack-drafts` (docs/use-case/DESIGN.md §6.8 e §10.5): le bozze di Slack già
 * inviate tengono una copia dei testi della scheda, senza un collegamento alla scheda. «Oscura
 * testo» non le raggiungerebbe: il comando porta a `NULL` le loro colonne di testo. Dopo H3e lo
 * fa l'invio stesso; il comando serve per le bozze inviate prima.
 *
 * - Solo `status = 'submitted'`, inviate da oltre 10 minuti (un invio in corso torna a
 *   `drafting` se la scheda non si crea). Le bozze in corso e quelle abbandonate restano.
 * - Restano i campi che non sono testi delle persone: stato, tipo, date, id di Slack.
 *
 * Modulo puro: niente import.
 */

/** Le colonne di testo di `slack_use_case_drafts` (`schema.ts`, `slackUseCaseDrafts`). */
export const SLACK_DRAFT_TEXT_COLUMNS = Object.freeze([
  "title",
  "problem",
  "flow_description",
  "human_in_the_loop",
  "guardrails",
  "expected_impact",
  "data_requirements",
  "sustainability_impact",
  "urgency",
] as const);

const SENT_AND_SETTLED = `d.status = 'submitted'
   AND coalesce(d.submitted_at, d.updated_at) < now() - interval '10 minutes'
   AND (${SLACK_DRAFT_TEXT_COLUMNS.map((column) => `d.${column} IS NOT NULL`).join(" OR ")})`;

/** Le bozze inviate che hanno ancora testi. Parametro facoltativo `$1`: il workspace. */
export function sentDraftsSql(withWorkspace: boolean): string {
  return `SELECT d.id, d.workspace_id
  FROM slack_use_case_drafts d
 WHERE ${SENT_AND_SETTLED}${withWorkspace ? "\n   AND d.workspace_id = $1::uuid" : ""}
 ORDER BY d.workspace_id, d.id`;
}

/** Porta a `NULL` i testi delle bozze indicate, ricontrollando la condizione. `$1`: gli id. */
export const CLEAR_SENT_DRAFTS_SQL = `UPDATE slack_use_case_drafts d
   SET ${SLACK_DRAFT_TEXT_COLUMNS.map((column) => `${column} = NULL`).join(", ")}
 WHERE d.id = ANY($1::uuid[])
   AND ${SENT_AND_SETTLED}
RETURNING d.id`;

/** Quante bozze per workspace, per l'uscita (nessun testo). */
export function countByWorkspace(rows: readonly { workspaceId: string }[]): Array<{ workspace: string; bozze: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.workspaceId, (counts.get(row.workspaceId) ?? 0) + 1);
  return [...counts.entries()].map(([workspace, bozze]) => ({ workspace, bozze }));
}
