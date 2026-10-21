/**
 * Regole di piattaforma della sezione «Casi d'uso» lette dall'ambiente
 * (DESIGN §7.1 P0-1, P0-2): modulo puro, l'ambiente arriva come parametro.
 *
 * - `ucSelfHealEnabled`: spento in produzione se `UC_SCHEMA_SELF_HEAL` non dice
 *   esplicitamente `on`. Spento, l'app esegue solo la sonda dello schema uc e
 *   risponde 503 se lo schema non è aggiornato; la 0018 si applica a mano
 *   (`docs/casi-duso/RUNBOOK.md`).
 * - `ucCronWorkspaceScope`: i workspace su cui girano i cron uc, dallo stesso
 *   `UC_WORKSPACE_IDS` delle pagine (`isUcWorkspaceEnabled`).
 * - `ucOnForEveryWorkspace`: vero solo con `*` fuori produzione; un controllo
 *   che non conosce il workspace vale solo così (azioni, cron).
 * - `parseHubWorkspaceList` e `parsePlainUuidList`: `USE_CASE_HUB_WORKSPACES`
 *   (`*` = ogni workspace, oppure UUID separati da virgole) e `USE_CASE_HUB_EXCLUDE`
 *   (solo UUID), lette senza importare nulla dall'hub (PIANO-LAVORI §3.4, C11), con le
 *   stesse regole di `src/lib/use-cases/rollout.ts` (una prova le confronta). Servono a
 *   `uc-doctor`.
 */
import { isProductionEnv, parseUcWorkspaceIds, type UcRolloutEnv } from "./rollout.ts";
import { UUID } from "./ids.ts";

/** Variabili lette qui; il chiamante passa `process.env`. */
export interface UcPlatformEnv extends UcRolloutEnv {
  readonly [name: string]: string | undefined;
  UC_ENABLED?: string | undefined;
  UC_SCHEMA_SELF_HEAL?: string | undefined;
}

/** Le due variabili dell'accensione per workspace, per `isUcWorkspaceEnabled`. */
export function rolloutEnv(env: UcPlatformEnv): UcRolloutEnv {
  return { UC_WORKSPACE_IDS: env.UC_WORKSPACE_IDS, VERCEL_ENV: env.VERCEL_ENV };
}

const OFF_VALUES = new Set(["off", "false", "0", "no"]);
const ON_VALUES = new Set(["on", "true", "1", "yes"]);

/**
 * Self-heal del DDL uc acceso? `off` (o `false`, `0`, `no`) lo spegne e `on` (o
 * `true`, `1`, `yes`) lo accende. Senza un valore riconosciuto è acceso fuori
 * produzione e spento in produzione (`VERCEL_ENV=production`): lì il DDL uc
 * parte da una richiesta solo con un `on` scritto a mano.
 */
export function ucSelfHealEnabled(env: UcPlatformEnv): boolean {
  const value = env.UC_SCHEMA_SELF_HEAL?.trim().toLowerCase();
  if (value && OFF_VALUES.has(value)) return false;
  if (value && ON_VALUES.has(value)) return true;
  return !isProductionEnv(env);
}

/**
 * Accensione per ogni workspace: `*`, che vale solo fuori produzione. Serve a
 * chi non conosce il workspace: con un elenco esplicito non vale per nessuno.
 */
export function ucOnForEveryWorkspace(env: UcPlatformEnv): boolean {
  return parseUcWorkspaceIds(env.UC_WORKSPACE_IDS).wildcard && !isProductionEnv(env);
}

/** Workspace dei cron: tutti (`*` fuori produzione) oppure un elenco, anche vuoto. */
export type UcCronWorkspaceScope = { kind: "tutti" } | { kind: "elenco"; ids: string[] };

export function ucCronWorkspaceScope(env: UcPlatformEnv): UcCronWorkspaceScope {
  if (ucOnForEveryWorkspace(env)) return { kind: "tutti" };
  return { kind: "elenco", ids: [...parseUcWorkspaceIds(env.UC_WORKSPACE_IDS).ids].sort() };
}

/** Filtro sui workspace per le query dei cron: `null` = tutti. */
export function cronWorkspaceFilter(scope: UcCronWorkspaceScope): readonly string[] | null {
  return scope.kind === "tutti" ? null : scope.ids;
}

export interface PlainUuidList {
  /** UUID validi, in minuscolo, senza doppioni. */
  ids: string[];
  /** Voci scartate (non UUID, `*` compreso). */
  ignored: string[];
}

/** Elenco di UUID separati da virgole; vuoto o assente = nessuno. Qui `*` è una voce scartata. */
export function parsePlainUuidList(raw: string | null | undefined): PlainUuidList {
  const ids: string[] = [];
  const ignored: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const token = part.trim();
    if (!token) continue;
    if (UUID.test(token)) {
      const id = token.toLowerCase();
      if (!ids.includes(id)) ids.push(id);
    } else {
      ignored.push(token);
    }
  }
  return { ids, ignored };
}

/** `USE_CASE_HUB_WORKSPACES`: `*` (ogni workspace) oppure UUID separati da virgole. */
export interface HubWorkspaceList extends PlainUuidList {
  /** C'è una voce `*`: area accesa per ogni workspace, tranne gli esclusi. */
  wildcard: boolean;
}

/** Come `hubRollout` dell'hub: `*` vale «tutti», gli UUID validi si tengono, il resto si scarta. */
export function parseHubWorkspaceList(raw: string | null | undefined): HubWorkspaceList {
  const parts = (raw ?? "").split(",").map((part) => part.trim());
  const wildcard = parts.includes("*");
  const rest = parsePlainUuidList(parts.filter((part) => part !== "*").join(","));
  return { wildcard, ids: rest.ids, ignored: rest.ignored };
}

/** Area «Use case» accesa per il workspace, con le regole di `isUseCaseHubWorkspace`. */
export function hubAreaOn(id: string, hub: HubWorkspaceList, excluded: PlainUuidList): boolean {
  const key = id.toLowerCase();
  if (excluded.ids.includes(key)) return false;
  return hub.wildcard || hub.ids.includes(key);
}
