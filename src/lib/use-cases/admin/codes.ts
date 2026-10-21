/**
 * `use-case-admin codes` (docs/use-case/DESIGN.md §10.8): un codice a ogni scheda che non ce
 * l'ha, workspace per workspace, in ordine di `coalesce(submitted_at, created_at), id`.
 *
 * - Ogni codice con `ASSIGN_USE_CASE_CODE_SQL`, lo stesso statement dell'app: incrementa il
 *   contatore del workspace e scrive il codice insieme. Una riga per volta, ciascuna nella sua
 *   transazione: un'interruzione lascia codici consecutivi, e il giro dopo riprende dalle
 *   schede ancora senza codice.
 * - Un workspace senza riga di `workspace_connector_configs` si salta (prima `configs`).
 * - **Prima `origin`** (§10.7: così nessuna scheda dall'alto diventa cercabile dal
 *   connettore, che cerca le schede con un codice e non nascoste). Con la 0020, un workspace
 *   con schede senza codice e con l'origine ancora da decidere (le stesse di `doctor`: Activity
 *   mapping da nascondere e proposte dal web che aspettano la conferma) si salta, e il comando
 *   lo dice. Saltare solo quelle schede romperebbe l'ordine dei codici.
 * - Oltre 99.999 per workspace il comando si ferma e lo dice.
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import { USE_CASE_CODE_MAX_SEQ, formatUseCaseCode } from "../../portfolio/use-case-code.ts";

export interface CodesWorkspace {
  workspaceId: string;
  name: string;
  /** `null` senza riga di config. */
  prefix: string | null;
  nextSeq: number;
}

export interface CodesRow {
  id: string;
  workspaceId: string;
}

export interface CodesWorkspacePlan {
  workspaceId: string;
  name: string;
  prefix: string | null;
  /** Schede senza codice. */
  missing: number;
  /** I codici che riceverebbero, nell'ordine (a secco: il contatore può muoversi nel frattempo). */
  proposed: Array<{ id: string; code: string }>;
  /** Schede senza codice con l'origine ancora da decidere: finché ce ne sono, il workspace si salta. */
  originPending: number;
  /** Perché il workspace si salta o si ferma prima della fine. */
  stop: CodesStop | null;
}

export type CodesStop = "senza_config" | "origine_da_decidere" | "oltre_99999";

/** Il motivo di ogni fermo, per l'operatore: con il comando da eseguire prima. */
export const CODES_STOP_REASON: Readonly<Record<CodesStop, string>> = {
  senza_config: "manca la riga di config: esegui prima configs",
  origine_da_decidere: "origine da decidere: esegui prima origin",
  oltre_99999: "oltre 99.999 codici: il comando si ferma per questo workspace",
};

/** I workspace dell'ambito con la loro riga di config. Parametro facoltativo `$1`: il workspace. */
export function codesWorkspacesSql(withWorkspace: boolean): string {
  return `SELECT w.id AS workspace_id, w.name, c.code_prefix, coalesce(c.next_code_seq, 0) AS next_code_seq
  FROM workspaces w
  LEFT JOIN workspace_connector_configs c ON c.workspace_id = w.id${withWorkspace ? "\n WHERE w.id = $1::uuid" : ""}
 ORDER BY w.created_at, w.id`;
}

/** Le schede senza codice, nell'ordine dei codici. Parametro facoltativo `$1`: il workspace. */
export function missingCodesSql(withWorkspace: boolean): string {
  return `SELECT u.id, u.workspace_id
  FROM use_cases u
 WHERE u.code IS NULL${withWorkspace ? " AND u.workspace_id = $1::uuid" : ""}
 ORDER BY u.workspace_id, coalesce(u.submitted_at, u.created_at), u.id`;
}

/**
 * Il piano di ogni workspace con schede senza codice. `originPending`: per workspace, le schede
 * senza codice con l'origine da decidere (vuota senza la 0020).
 */
export function planCodes(
  workspaces: readonly CodesWorkspace[],
  rows: readonly CodesRow[],
  originPending: ReadonlyMap<string, number> = new Map(),
): CodesWorkspacePlan[] {
  const byWorkspace = new Map<string, CodesRow[]>();
  for (const row of rows) {
    const list = byWorkspace.get(row.workspaceId) ?? [];
    list.push(row);
    byWorkspace.set(row.workspaceId, list);
  }
  const plans: CodesWorkspacePlan[] = [];
  for (const ws of workspaces) {
    const list = byWorkspace.get(ws.workspaceId) ?? [];
    if (list.length === 0) continue;
    const pending = originPending.get(ws.workspaceId) ?? 0;
    if (ws.prefix === null) {
      plans.push({ workspaceId: ws.workspaceId, name: ws.name, prefix: null, missing: list.length, proposed: [], originPending: pending, stop: "senza_config" });
      continue;
    }
    const room = Math.max(0, USE_CASE_CODE_MAX_SEQ - ws.nextSeq);
    // A secco i codici si mostrano lo stesso: dicono cosa succede dopo `origin`.
    const proposed = list.slice(0, room).map((row, i) => ({ id: row.id, code: formatUseCaseCode(ws.prefix as string, ws.nextSeq + i + 1) }));
    plans.push({
      workspaceId: ws.workspaceId,
      name: ws.name,
      prefix: ws.prefix,
      missing: list.length,
      proposed,
      originPending: pending,
      stop: pending > 0 ? "origine_da_decidere" : list.length > room ? "oltre_99999" : null,
    });
  }
  return plans;
}

/** `--limit <n>`: al massimo n codici in questo giro (intero da 1 a 100.000). */
export function parseCodesLimit(value: string | null): { ok: true; limit: number | null } | { ok: false; message: string } {
  if (value === null) return { ok: true, limit: null };
  if (!/^[0-9]{1,6}$/.test(value)) return { ok: false, message: "--limit vuole un numero intero da 1 a 100000." };
  const limit = Number(value);
  if (limit < 1 || limit > 100_000) return { ok: false, message: "--limit vuole un numero intero da 1 a 100000." };
  return { ok: true, limit };
}

/** Il contatore del workspace dopo un'assegnazione non riuscita: dice se è oltre il massimo. */
export const CODE_COUNTER_SQL = `SELECT next_code_seq >= ${USE_CASE_CODE_MAX_SEQ} AS full FROM workspace_connector_configs WHERE workspace_id = $1::uuid`;
