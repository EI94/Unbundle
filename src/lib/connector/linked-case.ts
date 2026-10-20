/**
 * Dossier dei Casi d'uso avviati da una segnalazione, per `linkedCaseCode` di
 * `get_contribution_status` e per lo stato AVVIATA_COME_CASO (prompt WP6; regola di
 * `docs/use-case/DESIGN.md` §10.4 e PIANO-LAVORI §3.5, riga K6).
 *
 * Un dossier conta solo se:
 *  - la sezione Casi d'uso è accesa (`UC_ENABLED` uguale a `true`);
 *  - la tabella esiste (`to_regclass('public.uc_cases')`: la legge la stessa query
 *    della segnalazione, così senza la sezione non c'è un secondo giro);
 *  - è completo (`setup_completed_at IS NOT NULL`): una creazione rimasta a metà non
 *    è un caso avviato;
 *  - è dello stesso workspace della segnalazione.
 * Con più dossier completi sulla stessa segnalazione (prima dell'indice unico della
 * 0020) vale il più vecchio, come `uc-nav.ts`.
 *
 * Il connettore non importa nulla da `src/lib/uc/`: qui c'è solo SQL esplicito, così il
 * ramo resta indipendente dalla sezione. Un errore della lettura non rompe il tool:
 * una riga di log senza dati e nessun codice (la segnalazione mostra lo stato senza
 * il dossier). Esce solo un codice nel formato dei casi (`AB-UC-01`), mai testo libero,
 * e il giorno dell'avvio (`setup_completed_at` in ora italiana), che per una segnalazione
 * AVVIATA_COME_CASO è il giorno del cambio di stato.
 *
 * Modulo puro: il database arriva come `SqlExecutor`; gira con `node --test`.
 */
import { logSafeError } from "../log/safe-error.ts";
import type { SqlExecutor } from "./rate-limit.ts";

/** Interruttore della sezione Casi d'uso (lo stesso dell'app). */
export const UC_ENABLED_ENV = "UC_ENABLED";

/** Espressione SQL da aggiungere alla query della segnalazione: vero se `uc_cases` esiste. */
export const UC_CASES_PRESENT_SQL = `to_regclass('public.uc_cases') IS NOT NULL`;

/**
 * Codici dei dossier completi collegati alle segnalazioni date, uno per segnalazione, con
 * il giorno in cui il dossier è stato avviato (`setup_completed_at`, `timestamptz`, come
 * giorno `AAAA-MM-GG` in ora italiana): è il `statusChangedAt` di AVVIATA_COME_CASO
 * (decisione di Pierpaolo del 19/10/2026).
 */
export const LINKED_CASE_CODES_SQL = `SELECT DISTINCT ON (c.portfolio_use_case_id) c.portfolio_use_case_id::text AS use_case_id, c.code,
       to_char(c.setup_completed_at AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD') AS started_on
  FROM uc_cases c
 WHERE c.workspace_id = $1
   AND c.portfolio_use_case_id = ANY($2::uuid[])
   AND c.setup_completed_at IS NOT NULL
 ORDER BY c.portfolio_use_case_id, c.created_at, c.id`;

/** Esistenza della tabella, per chi non ha una query della segnalazione a cui aggiungerla. */
export const UC_CASES_PRESENT_QUERY = `SELECT ${UC_CASES_PRESENT_SQL} AS uc_present`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Codice di un caso d'uso (stessa forma della procedura «Nuovo caso»). */
const CASE_CODE = /^[A-Z0-9][A-Z0-9-]{1,39}$/;

/** Vero solo con `UC_ENABLED` uguale a `true`, come nel resto dell'app. */
export function ucCasesEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[UC_ENABLED_ENV] === "true";
}

export function isTrue(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

export interface LinkedCaseOptions {
  /** `UC_ENABLED` (letto a ogni chiamata dall'ambiente dell'app). */
  enabled: boolean;
  log?: Pick<Console, "error">;
}

/** Il dossier avviato da una segnalazione: codice del caso e giorno dell'avvio. */
export interface LinkedCase {
  code: string;
  /** Giorno di `setup_completed_at` in ora italiana (`AAAA-MM-GG`); null se non leggibile. */
  startedOn: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Il dossier di ogni segnalazione che ne ha uno, per id della segnalazione.
 * `ucPresent` è la colonna `UC_CASES_PRESENT_SQL` della query della segnalazione:
 * senza sezione accesa o senza tabella non si tocca il database.
 */
export async function linkedCases(
  exec: SqlExecutor,
  params: { workspaceId: string; useCaseIds: readonly string[]; ucPresent: boolean },
  opts: LinkedCaseOptions
): Promise<Map<string, LinkedCase>> {
  const out = new Map<string, LinkedCase>();
  const ids = [...new Set(params.useCaseIds.filter((id) => UUID.test(id)))];
  if (!opts.enabled || !params.ucPresent || !ids.length || !UUID.test(params.workspaceId)) return out;
  try {
    const rows = await exec(LINKED_CASE_CODES_SQL, [params.workspaceId, ids]);
    for (const row of rows) {
      const id = String(row.use_case_id ?? "");
      const code = typeof row.code === "string" ? row.code.trim() : "";
      const startedOn = typeof row.started_on === "string" && DAY.test(row.started_on) ? row.started_on : null;
      if (UUID.test(id) && CASE_CODE.test(code)) out.set(id.toLowerCase(), { code, startedOn });
    }
  } catch (error) {
    logSafeError("connector", "linked_case_failed", error, {}, opts.log);
    out.clear();
  }
  return out;
}

/** Solo il codice del dossier, per id della segnalazione (`linkedCases` senza il giorno). */
export async function linkedCaseCodes(
  exec: SqlExecutor,
  params: { workspaceId: string; useCaseIds: readonly string[]; ucPresent: boolean },
  opts: LinkedCaseOptions
): Promise<Map<string, string>> {
  const cases = await linkedCases(exec, params, opts);
  return new Map([...cases].map(([id, linked]) => [id, linked.code]));
}

/**
 * Il codice del dossier di una sola segnalazione (invio ritrovato), con la verifica
 * della tabella in una query a parte. Null senza sezione, senza tabella o con un errore.
 */
export async function linkedCaseCodeOf(
  exec: SqlExecutor,
  params: { workspaceId: string; useCaseId: string },
  opts: LinkedCaseOptions
): Promise<string | null> {
  if (!opts.enabled || !UUID.test(params.useCaseId)) return null;
  let ucPresent = false;
  try {
    const [row] = await exec(UC_CASES_PRESENT_QUERY, []);
    ucPresent = isTrue(row?.uc_present);
  } catch (error) {
    logSafeError("connector", "linked_case_failed", error, {}, opts.log);
    return null;
  }
  const codes = await linkedCaseCodes(exec, { workspaceId: params.workspaceId, useCaseIds: [params.useCaseId], ucPresent }, opts);
  return codes.get(params.useCaseId.toLowerCase()) ?? null;
}
