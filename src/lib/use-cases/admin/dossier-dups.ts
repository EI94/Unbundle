/**
 * `use-case-admin dossier-dups` (docs/use-case/DESIGN.md §10.4 punto 1, casi-duso P0-16 a):
 * più dossier sulla stessa scheda, prima della 0020. Legge e scrive solo `uc_cases`, quindi
 * gira su uno schema senza la 0020.
 *
 * - **Una sola condizione per i doppioni**, la stessa della 0020 e di `doctor`: ogni riga di
 *   `uc_cases` con `portfolio_use_case_id`, completa o no. Una riga incompleta (creazione
 *   fallita) è un doppione.
 * - A secco: ogni gruppo, con codice del dossier, «completo» o «incompleto», data e azione.
 * - `--apply`: cancella le righe incomplete dei gruppi ferme da oltre 10 minuti, con la stessa
 *   regola di `deleteStaleIncompleteCaseSql` (`src/lib/uc/sql/case-create.ts`).
 * - `--detach <caseId>`: per i doppioni completi Pierpaolo sceglie quale staccare
 *   (`portfolio_use_case_id = NULL`). Il dossier staccato riceve poi la sua scheda madre con
 *   `dossier-links` (§10.9). Almeno un dossier **completo** del gruppo resta collegato: una
 *   riga incompleta non è un dossier (§10.4 punto 5) e spesso è una creazione fallita che poi
 *   si cancella, quindi non conta.
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import { STALE_INCOMPLETE_CASE_MINUTES } from "../../uc/sql/case-create.ts";
import { isUuid } from "./cli.ts";

/** Le schede con più di un dossier: la condizione della 0020 (`USE_CASE_HUB_UC_INDEX_SQL`). */
export const DUPLICATE_CARDS_SQL = `SELECT portfolio_use_case_id FROM uc_cases
       WHERE portfolio_use_case_id IS NOT NULL
       GROUP BY portfolio_use_case_id
      HAVING count(*) > 1`;

/** Una riga incompleta è «ferma» dopo questo intervallo (`deleteStaleIncompleteCaseSql`). */
export const STALE_INCOMPLETE_INTERVAL_SQL = `interval '${STALE_INCOMPLETE_CASE_MINUTES} minutes'`;

/** Le righe dei gruppi di doppioni. Parametro facoltativo `$1`: il workspace. */
export function duplicateRowsSql(withWorkspace: boolean): string {
  return `SELECT c.id AS case_id, c.workspace_id, c.portfolio_use_case_id AS use_case_id, c.code,
       c.setup_completed_at IS NOT NULL AS complete,
       (c.setup_completed_at IS NULL AND c.created_at < now() - ${STALE_INCOMPLETE_INTERVAL_SQL}) AS stale,
       to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS created_at
  FROM uc_cases c
 WHERE c.portfolio_use_case_id IN (${DUPLICATE_CARDS_SQL})${withWorkspace ? "\n   AND c.workspace_id = $1::uuid" : ""}
 ORDER BY c.portfolio_use_case_id, c.created_at, c.id`;
}

/** Cancella le righe incomplete ferme: stessa regola dell'app, ricontrollata nello statement. */
export const DELETE_STALE_INCOMPLETE_SQL = `DELETE FROM uc_cases
 WHERE id = ANY($1::uuid[])
   AND portfolio_use_case_id IS NOT NULL
   AND setup_completed_at IS NULL
   AND created_at < now() - ${STALE_INCOMPLETE_INTERVAL_SQL}
RETURNING id`;

/**
 * Stacca i dossier completi scelti, solo se la loro scheda tiene un altro dossier completo che
 * non si stacca (ricontrollato nello statement, sulla fotografia di prima dell'aggiornamento).
 */
export const DETACH_COMPLETE_SQL = `UPDATE uc_cases c
   SET portfolio_use_case_id = NULL, updated_at = now()
 WHERE c.id = ANY($1::uuid[])
   AND c.setup_completed_at IS NOT NULL
   AND c.portfolio_use_case_id IN (${DUPLICATE_CARDS_SQL})
   AND EXISTS (SELECT 1 FROM uc_cases k
                WHERE k.portfolio_use_case_id = c.portfolio_use_case_id
                  AND k.setup_completed_at IS NOT NULL
                  AND NOT (k.id = ANY($1::uuid[])))
RETURNING c.id`;

export interface DossierRow {
  caseId: string;
  workspaceId: string;
  useCaseId: string;
  /** Codice del dossier. */
  code: string;
  complete: boolean;
  /** Incompleta e ferma da oltre 10 minuti. */
  stale: boolean;
  /** `AAAA-MM-GG HH:MM` in UTC. */
  createdAt: string;
}

export type DossierAction = "cancella" | "stacca" | "resta" | "attende";

export interface DuplicateGroup {
  useCaseId: string;
  workspaceId: string;
  rows: DossierRow[];
}

export interface PlannedGroup extends DuplicateGroup {
  actions: Record<string, DossierAction>;
  /** Dopo il piano resta al massimo un dossier collegato. */
  resolved: boolean;
}

export interface DossierDupsPlan {
  groups: PlannedGroup[];
  deletions: string[];
  detaches: string[];
  /** Gruppi che dopo il piano hanno ancora più di un dossier collegato. */
  unresolved: number;
}

export function dossierRowFrom(row: Record<string, unknown>): DossierRow {
  return {
    caseId: String(row.case_id),
    workspaceId: String(row.workspace_id),
    useCaseId: String(row.use_case_id),
    code: String(row.code),
    complete: row.complete === true,
    stale: row.stale === true,
    createdAt: String(row.created_at),
  };
}

/** I gruppi di righe sulla stessa scheda, con almeno due righe. */
export function groupDuplicates(rows: readonly DossierRow[]): DuplicateGroup[] {
  const byCard = new Map<string, DossierRow[]>();
  for (const row of rows) {
    const list = byCard.get(row.useCaseId) ?? [];
    list.push(row);
    byCard.set(row.useCaseId, list);
  }
  return [...byCard.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([useCaseId, list]) => ({
      useCaseId,
      workspaceId: list[0].workspaceId,
      rows: [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.caseId.localeCompare(b.caseId)),
    }))
    .sort((a, b) => a.rows[0].createdAt.localeCompare(b.rows[0].createdAt) || a.useCaseId.localeCompare(b.useCaseId));
}

/** `--detach a,b`: gli id dei dossier da staccare, in minuscolo. */
export function parseDetachList(value: string | null): { ok: true; ids: string[] } | { ok: false; message: string } {
  if (value === null) return { ok: true, ids: [] };
  const ids = value.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (ids.length === 0 || ids.some((id) => !isUuid(id))) return { ok: false, message: "--detach vuole uno o più id di dossier (uuid), separati da virgole." };
  return { ok: true, ids: [...new Set(ids)] };
}

/**
 * Il piano: le righe incomplete ferme si cancellano, quelle recenti attendono (creazione forse
 * in corso), le complete scelte con `--detach` si staccano, le altre restano. Rifiuta un
 * `--detach` fuori dai gruppi, su una riga incompleta, o che lascerebbe la scheda senza un
 * dossier completo collegato (un'incompleta che attende non basta).
 */
export function planDossierDups(
  groups: readonly DuplicateGroup[],
  detachIds: readonly string[] = [],
): { ok: true; plan: DossierDupsPlan } | { ok: false; message: string } {
  const wanted = new Set(detachIds.map((id) => id.toLowerCase()));
  const rowsById = new Map(groups.flatMap((group) => group.rows.map((row) => [row.caseId.toLowerCase(), row] as const)));
  for (const id of wanted) {
    const row = rowsById.get(id);
    if (!row) return { ok: false, message: `--detach ${id}: non è un dossier in un gruppo di doppioni.` };
    if (!row.complete) return { ok: false, message: `--detach ${id}: è incompleto; si cancella con --apply quando è fermo da oltre ${STALE_INCOMPLETE_CASE_MINUTES} minuti.` };
  }
  const planned: PlannedGroup[] = [];
  const deletions: string[] = [];
  const detaches: string[] = [];
  let unresolved = 0;
  for (const group of groups) {
    const actions: Record<string, DossierAction> = {};
    for (const row of group.rows) {
      const action: DossierAction = !row.complete
        ? row.stale
          ? "cancella"
          : "attende"
        : wanted.has(row.caseId.toLowerCase())
          ? "stacca"
          : "resta";
      actions[row.caseId] = action;
      if (action === "cancella") deletions.push(row.caseId);
      if (action === "stacca") detaches.push(row.caseId);
    }
    const kept = group.rows.filter((row) => actions[row.caseId] === "resta").length;
    if (kept === 0 && group.rows.some((row) => actions[row.caseId] === "stacca")) {
      return { ok: false, message: `--detach: la scheda ${group.useCaseId} resterebbe senza un dossier completo collegato; staccane uno in meno.` };
    }
    // Per l'indice unico conta anche l'incompleta che attende.
    const linked = kept + group.rows.filter((row) => actions[row.caseId] === "attende").length;
    const resolved = linked <= 1;
    if (!resolved) unresolved++;
    planned.push({ ...group, actions, resolved });
  }
  return { ok: true, plan: { groups: planned, deletions, detaches, unresolved } };
}

/** I gruppi per l'uscita: codice, «completo» o «incompleto», data e azione di ogni dossier. */
export function describeGroups(plan: DossierDupsPlan) {
  return plan.groups.map((group) => ({
    scheda: group.useCaseId,
    workspace: group.workspaceId,
    risolto: group.resolved,
    dossier: group.rows.map((row) => ({
      id: row.caseId,
      codice: row.code,
      stato: row.complete ? "completo" : "incompleto",
      creato: row.createdAt,
      azione: group.actions[row.caseId],
    })),
  }));
}
