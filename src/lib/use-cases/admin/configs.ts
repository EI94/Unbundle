/**
 * `use-case-admin configs` (docs/use-case/DESIGN.md §10.6, D6): una riga di
 * `workspace_connector_configs` per ogni workspace che non ce l'ha, così ogni workspace può
 * ricevere i codici. Le righe esistenti (per esempio di `connector-admin config`) non si
 * toccano.
 *
 * - Prefisso proposto dal nome (`proposePrefix`), oppure quello del file `--prefixes`
 *   (`{ "<workspaceId>": "ABC" }`), che Pierpaolo corregge prima di `--apply`. Per un
 *   workspace col connettore il prefisso si decide prima dei codici.
 * - Slug proposto dal nome (`proposeSlug`), unico rispetto a tutti gli slug già usati e a
 *   quelli proposti prima nello stesso giro.
 * - `enabled = false`, `next_code_seq = 0`, il resto ai valori predefiniti della 0019.
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import { isValidCodePrefix, proposePrefix, proposeSlug } from "../prefix.ts";
import { isUuid } from "./cli.ts";

export interface WorkspaceForConfig {
  id: string;
  name: string;
}

export interface ExistingConfig {
  workspaceId: string;
  slug: string;
  codePrefix: string;
}

export interface PlannedConfig {
  workspaceId: string;
  name: string;
  prefix: string;
  /** Da dove viene il prefisso. */
  prefixFrom: "nome" | "file";
  slug: string;
}

export interface ConfigsPlan {
  create: PlannedConfig[];
  /** Workspace dell'ambito che hanno già la riga: restano come sono. */
  existing: Array<ExistingConfig & { name: string }>;
}

/** I workspace dell'ambito. Parametro facoltativo `$1`: il workspace. */
export function workspacesSql(withWorkspace: boolean): string {
  return `SELECT w.id, w.name FROM workspaces w${withWorkspace ? " WHERE w.id = $1::uuid" : ""} ORDER BY w.created_at, w.id`;
}

/** Tutte le righe esistenti: i loro slug sono già presi, in qualunque workspace. */
export const EXISTING_CONFIGS_SQL = `SELECT workspace_id, slug, code_prefix FROM workspace_connector_configs ORDER BY workspace_id`;

/** Crea le righe; un conflitto (riga o slug nati nel frattempo) non ferma le altre. */
export const INSERT_CONFIGS_SQL = `INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix, enabled, next_code_seq)
SELECT w.id, x.slug, x.code_prefix, false, 0
  FROM unnest($1::uuid[], $2::text[], $3::text[]) AS x(workspace_id, slug, code_prefix)
  JOIN workspaces w ON w.id = x.workspace_id
ON CONFLICT DO NOTHING
RETURNING workspace_id`;

/** Il file `--prefixes`: un oggetto `{ "<workspaceId>": "ABC" }`, prefissi di 2-4 lettere maiuscole. */
export function parsePrefixesFile(value: unknown): { ok: true; prefixes: Map<string, string> } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "--prefixes: il file deve essere un oggetto { \"<workspaceId>\": \"ABC\" }." };
  }
  const prefixes = new Map<string, string>();
  for (const [key, prefix] of Object.entries(value as Record<string, unknown>)) {
    if (!isUuid(key)) return { ok: false, message: `--prefixes: «${key.slice(0, 40)}» non è un id di workspace.` };
    if (!isValidCodePrefix(prefix)) return { ok: false, message: `--prefixes: il prefisso di ${key} deve avere da 2 a 4 lettere maiuscole.` };
    prefixes.set(key.toLowerCase(), prefix);
  }
  return { ok: true, prefixes };
}

/**
 * Il piano. Rifiuta un prefisso del file per un workspace fuori dall'ambito o che ha già la
 * riga (il prefisso di una riga esistente si cambia da Impostazioni › Valutazione).
 */
export function planConfigs(
  workspaces: readonly WorkspaceForConfig[],
  existing: readonly ExistingConfig[],
  prefixes: ReadonlyMap<string, string> = new Map(),
): { ok: true; plan: ConfigsPlan } | { ok: false; message: string } {
  const configured = new Map(existing.map((row) => [row.workspaceId.toLowerCase(), row]));
  const inScope = new Set(workspaces.map((ws) => ws.id.toLowerCase()));
  for (const id of prefixes.keys()) {
    if (!inScope.has(id)) return { ok: false, message: `--prefixes: il workspace ${id} non è nell'ambito del comando.` };
    if (configured.has(id)) return { ok: false, message: `--prefixes: il workspace ${id} ha già la sua riga; il prefisso si cambia da Impostazioni.` };
  }
  const taken = new Set(existing.map((row) => row.slug.toLowerCase()));
  const create: PlannedConfig[] = [];
  const kept: ConfigsPlan["existing"] = [];
  for (const ws of workspaces) {
    const id = ws.id.toLowerCase();
    const row = configured.get(id);
    if (row) {
      kept.push({ ...row, name: ws.name });
      continue;
    }
    const fromFile = prefixes.get(id);
    const slug = proposeSlug(ws.name, taken, ws.id);
    taken.add(slug);
    create.push({ workspaceId: ws.id, name: ws.name, prefix: fromFile ?? proposePrefix(ws.name), prefixFrom: fromFile ? "file" : "nome", slug });
  }
  return { ok: true, plan: { create, existing: kept } };
}
