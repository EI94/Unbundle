/**
 * Interruttore dell'area «Use case» per workspace (docs/use-case/DESIGN.md §12.1).
 *
 * `USE_CASE_HUB_WORKSPACES`:
 * - `*`: area accesa per **ogni** workspace, anche per quelli creati dopo, produzione
 *   compresa. Un `*` in mezzo ad altre voci vale lo stesso «tutti».
 * - Un elenco di UUID separati da virgole: area accesa solo per quelli. Le voci che non sono
 *   UUID («all», «true», testi, UUID tagliati) non accendono nulla.
 * - Vuota o assente: area spenta ovunque.
 *
 * `USE_CASE_HUB_EXCLUDE`: UUID separati da virgole per cui l'area resta spenta in ogni caso,
 * anche con `*`. È il ritorno indietro per un cliente (§12.3) senza togliere il `*`; un `*`
 * qui non spegne nulla (per spegnere tutto si svuota `USE_CASE_HUB_WORKSPACES`). Una voce che
 * non è un UUID intero (errore di battitura, UUID separati da spazi) si ignora e il cliente resta
 * acceso: dopo ogni esclusione `use-case-admin doctor` deve dire `areaAccesa: false`
 * (docs/casi-duso/RUNBOOK.md §5); `uc-doctor` avvisa delle voci ignorate.
 *
 * Modulo puro: nessun import, nessun `server-only`. Le variabili arrivano come
 * parametro, con `process.env` come valore predefinito.
 */

export const USE_CASE_HUB_WORKSPACES_ENV = "USE_CASE_HUB_WORKSPACES";
export const USE_CASE_HUB_EXCLUDE_ENV = "USE_CASE_HUB_EXCLUDE";

/** La voce che accende l'area per ogni workspace. */
export const USE_CASE_HUB_ALL = "*";

type Env = Readonly<Record<string, string | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Come si legge l'interruttore: tutti (`*`) o un elenco, meno gli esclusi. */
export interface HubRollout {
  /** `*` in `USE_CASE_HUB_WORKSPACES`: ogni workspace, tranne gli esclusi. */
  all: boolean;
  /** Gli UUID dell'elenco, in minuscolo (con `all` non servono, ma si leggono lo stesso). */
  ids: ReadonlySet<string>;
  /** Gli UUID di `USE_CASE_HUB_EXCLUDE`, in minuscolo: spenti in ogni caso. */
  excluded: ReadonlySet<string>;
}

function uuidList(raw: string | undefined): { ids: Set<string>; wildcard: boolean } {
  const ids = new Set<string>();
  let wildcard = false;
  for (const item of (raw ?? "").split(",")) {
    const id = item.trim();
    if (id === USE_CASE_HUB_ALL) wildcard = true;
    else if (UUID.test(id)) ids.add(id.toLowerCase());
  }
  return { ids, wildcard };
}

/** L'interruttore letto dalle due variabili. */
export function hubRollout(env: Env = process.env): HubRollout {
  const list = uuidList(env[USE_CASE_HUB_WORKSPACES_ENV]);
  return { all: list.wildcard, ids: list.ids, excluded: uuidList(env[USE_CASE_HUB_EXCLUDE_ENV]).ids };
}

/** Vero con `*`: l'area vale per ogni workspace (tranne gli esclusi), anche per quelli che nasceranno. */
export function hubOnForEveryWorkspace(env: Env = process.env): boolean {
  return hubRollout(env).all;
}

/**
 * Gli UUID **dell'elenco esplicito**, in minuscolo, senza gli esclusi. Con `*` l'elenco non
 * dice quali workspace sono accesi: chi deve enumerarli usa `hubWorkspacesAmong` sui
 * workspace che esistono (cron, script dell'operatore).
 */
export function hubWorkspaceIds(env: Env = process.env): ReadonlySet<string> {
  const rollout = hubRollout(env);
  return new Set([...rollout.ids].filter((id) => !rollout.excluded.has(id)));
}

/** Vero se l'area è accesa per il workspace: `*` o nell'elenco, e mai se è escluso. */
export function isUseCaseHubWorkspace(workspaceId: string | null | undefined, env: Env = process.env): boolean {
  if (typeof workspaceId !== "string") return false;
  const id = workspaceId.trim();
  if (!UUID.test(id)) return false;
  const key = id.toLowerCase();
  const rollout = hubRollout(env);
  if (rollout.excluded.has(key)) return false;
  return rollout.all || rollout.ids.has(key);
}

/** I workspace accesi tra quelli dati (per esempio tutti quelli del database), in minuscolo e nell'ordine dato. */
export function hubWorkspacesAmong(workspaceIds: Iterable<string>, env: Env = process.env): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of workspaceIds) {
    const id = String(raw).trim().toLowerCase();
    if (seen.has(id) || !isUseCaseHubWorkspace(id, env)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
