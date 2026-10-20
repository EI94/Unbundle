/**
 * Accensione dei Casi d'uso per workspace (DESIGN §7.1 P0-1).
 *
 * `UC_WORKSPACE_IDS` è un elenco di UUID separati da virgole, spazi o a capo.
 * - Vuota o assente: sezione spenta per ogni workspace.
 * - `*`: tutti i workspace, ma solo fuori produzione. In produzione `*` non
 *   vale e conta solo l'elenco esplicito.
 * - Le voci che non sono UUID si ignorano; il confronto non guarda le maiuscole.
 *
 * Produzione vuol dire `VERCEL_ENV=production`: le anteprime Vercel
 * (`preview`), lo sviluppo locale e il harness (`next start` compreso) non lo
 * sono. `UC_ENABLED` resta l'interruttore generale: questa funzione si chiama
 * solo dopo `isUcEnabled()`.
 *
 * Modulo puro: l'ambiente arriva come parametro, nessun import.
 */
import { UUID } from "./ids.ts";

export interface UcRolloutEnv {
  UC_WORKSPACE_IDS?: string | undefined;
  VERCEL_ENV?: string | undefined;
}

export interface UcWorkspaceList {
  /** `*` presente nell'elenco. */
  wildcard: boolean;
  /** UUID validi, in minuscolo. */
  ids: ReadonlySet<string>;
  /** Voci scartate (né UUID né `*`): servono solo a `uc-doctor`. */
  ignored: readonly string[];
}

/** Legge `UC_WORKSPACE_IDS` senza decidere nulla. */
export function parseUcWorkspaceIds(raw: string | null | undefined): UcWorkspaceList {
  const ids = new Set<string>();
  const ignored: string[] = [];
  let wildcard = false;
  for (const part of (raw ?? "").split(/[\s,;]+/)) {
    const token = part.trim();
    if (!token) continue;
    if (token === "*") wildcard = true;
    else if (UUID.test(token)) ids.add(token.toLowerCase());
    else ignored.push(token);
  }
  return { wildcard, ids, ignored };
}

/** Vero solo sul deploy di produzione di Vercel. */
export function isProductionEnv(env: Pick<UcRolloutEnv, "VERCEL_ENV">): boolean {
  return env.VERCEL_ENV === "production";
}

/** Il workspace ha la sezione Casi d'uso accesa? */
export function isUcWorkspaceEnabled(workspaceId: string | null | undefined, env: UcRolloutEnv): boolean {
  if (typeof workspaceId !== "string" || !UUID.test(workspaceId)) return false;
  const list = parseUcWorkspaceIds(env.UC_WORKSPACE_IDS);
  if (list.ids.has(workspaceId.toLowerCase())) return true;
  return list.wildcard && !isProductionEnv(env);
}
