/**
 * Interruttore dell'area «Use case» per workspace (docs/use-case/DESIGN.md §12.1).
 *
 * `USE_CASE_HUB_WORKSPACES` è un elenco di UUID separati da virgole.
 * - Vuota o assente: area spenta ovunque.
 * - Niente `*`: un asterisco non accende nulla, come ogni voce che non è un UUID.
 * - Per tornare indietro si toglie il workspace dall'elenco (§12.3).
 *
 * Modulo puro: nessun import, nessun `server-only`. Le variabili arrivano come
 * parametro, con `process.env` come valore predefinito.
 */

export const USE_CASE_HUB_WORKSPACES_ENV = "USE_CASE_HUB_WORKSPACES";

type Env = Readonly<Record<string, string | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gli UUID validi dell'elenco, in minuscolo. Voci vuote, `*` e testi che non sono UUID si ignorano. */
export function hubWorkspaceIds(env: Env = process.env): ReadonlySet<string> {
  const raw = env[USE_CASE_HUB_WORKSPACES_ENV];
  const ids = new Set<string>();
  if (!raw) return ids;
  for (const item of raw.split(",")) {
    const id = item.trim();
    if (UUID.test(id)) ids.add(id.toLowerCase());
  }
  return ids;
}

/** Vero solo se il workspace è un UUID valido presente nell'elenco. */
export function isUseCaseHubWorkspace(workspaceId: string | null | undefined, env: Env = process.env): boolean {
  if (typeof workspaceId !== "string") return false;
  const id = workspaceId.trim();
  if (!UUID.test(id)) return false;
  return hubWorkspaceIds(env).has(id.toLowerCase());
}
