/**
 * Letture comuni dei comandi di `connector-admin`: lo schema del connettore, il workspace,
 * la riga di `workspace_connector_configs` e la sua prontezza (cosa manca perché la rotta
 * risponda: guida, profilo del cliente, modello delle istruzioni, token).
 *
 * Modulo puro: il database arriva come `AdminDb` (letture di sola lettura).
 */
import { CONNECTOR_PROBE_SQL } from "../../db/connector-ddl.ts";
import { USE_CASE_CODE_MAX_SEQ, formatUseCaseCode } from "../../portfolio/use-case-code.ts";
import { validateInstructionsTemplate } from "../instructions.ts";
import { connectorProfileFromStored } from "../profile.ts";
import { AdminStop, type AdminDb, type AdminRow } from "./cli.ts";

/** Vero se tutto il DDL del connettore c'è, coda della 0019 compresa (stessa sonda del self-heal). */
export const SCHEMA_READY_SQL = `SELECT ${CONNECTOR_PROBE_SQL} AS ready`;

export const WORKSPACE_SQL = `SELECT id::text AS id, name, coalesce(esg_enabled, false) AS esg_enabled FROM workspaces WHERE id = $1::uuid`;

export const CONFIG_ROW_SQL = `SELECT c.slug, c.code_prefix, c.next_code_seq, c.enabled, c.identity_mode, c.auth_mode,
       c.workspace_display_name, c.allowed_domains, c.allowed_origins, c.limits,
       c.guide, c.guide_version, c.profile, c.instructions_template,
       md5(coalesce(c.guide::text, '')) AS guide_md5,
       md5(coalesce(c.profile::text, '')) AS profile_md5,
       md5(coalesce(c.instructions_template, '')) AS template_md5
  FROM workspace_connector_configs c
 WHERE c.workspace_id = $1::uuid`;

export const ACTIVE_TOKENS_SQL = `SELECT count(*)::int AS active
  FROM workspace_integration_tokens
 WHERE workspace_id = $1::uuid AND provider = 'claude_connector' AND revoked_at IS NULL
   AND (expires_at IS NULL OR expires_at > (now() AT TIME ZONE 'UTC'))`;

export interface WorkspaceRow {
  id: string;
  name: string;
  esgEnabled: boolean;
}

export interface ConfigRow {
  slug: string;
  codePrefix: string;
  nextCodeSeq: number;
  enabled: boolean;
  identityMode: string;
  authMode: string;
  workspaceDisplayName: string | null;
  allowedDomains: unknown;
  allowedOrigins: unknown;
  limits: unknown;
  guide: unknown;
  guideVersion: string | null;
  profile: unknown;
  instructionsTemplate: string | null;
  guideMd5: string;
  profileMd5: string;
  templateMd5: string;
}

const str = (value: unknown): string | null => (typeof value === "string" ? value : value === null || value === undefined ? null : String(value));

function json(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function configRowOf(row: AdminRow): ConfigRow {
  return {
    slug: String(row.slug),
    codePrefix: String(row.code_prefix),
    nextCodeSeq: Number(row.next_code_seq ?? 0),
    enabled: row.enabled === true || row.enabled === "t" || row.enabled === "true",
    identityMode: String(row.identity_mode),
    authMode: String(row.auth_mode),
    workspaceDisplayName: str(row.workspace_display_name),
    allowedDomains: json(row.allowed_domains),
    allowedOrigins: json(row.allowed_origins),
    limits: json(row.limits),
    guide: json(row.guide),
    guideVersion: str(row.guide_version),
    profile: json(row.profile),
    instructionsTemplate: str(row.instructions_template),
    guideMd5: String(row.guide_md5),
    profileMd5: String(row.profile_md5),
    templateMd5: String(row.template_md5),
  };
}

/** Si ferma se manca il DDL del connettore (0019 con le aggiunte in coda). */
export async function requireSchema(db: AdminDb): Promise<void> {
  const [row] = await db.read(SCHEMA_READY_SQL);
  const ready = row?.ready === true || row?.ready === "t" || row?.ready === "true";
  if (!ready) {
    throw new AdminStop("schema", "Manca lo schema del connettore: applica drizzle/0019_connettore_mcp.sql (con le aggiunte in coda) prima dello script.", { needs: "0019" });
  }
}

export async function readWorkspace(db: AdminDb, workspaceId: string): Promise<WorkspaceRow> {
  const [row] = await db.read(WORKSPACE_SQL, [workspaceId]);
  if (!row) throw new AdminStop("workspace", "Workspace non trovato.", { workspace: workspaceId });
  return { id: String(row.id), name: String(row.name), esgEnabled: row.esg_enabled === true || row.esg_enabled === "t" };
}

export async function readConfigRow(db: AdminDb, workspaceId: string): Promise<ConfigRow | null> {
  const [row] = await db.read(CONFIG_ROW_SQL, [workspaceId]);
  return row ? configRowOf(row) : null;
}

/** La riga deve esserci: i comandi dopo `config` lavorano su una riga esistente. */
export async function requireConfigRow(db: AdminDb, workspaceId: string): Promise<ConfigRow> {
  const row = await readConfigRow(db, workspaceId);
  if (!row) throw new AdminStop("config_mancante", "Il workspace non ha la riga del connettore: prima connector-admin config.", { workspace: workspaceId });
  return row;
}

export interface Readiness {
  slug: string;
  acceso: boolean;
  prefisso: string;
  prossimoCodice: string | null;
  guida: string | null;
  profilo: boolean;
  istruzioni: boolean;
  tokenAttivi: number;
  /** Cosa manca perché la rotta risponda (vuoto se nulla). */
  mancano: string[];
}

/** La prontezza della riga: cosa c'è e cosa manca, senza valori del cliente. */
export async function readiness(db: AdminDb, workspaceId: string, row: ConfigRow): Promise<Readiness> {
  const [tokens] = await db.read(ACTIVE_TOKENS_SQL, [workspaceId]);
  const active = Number(tokens?.active ?? 0);
  const profile = connectorProfileFromStored(row.profile).ok;
  const template = validateInstructionsTemplate(row.instructionsTemplate).ok;
  const hasGuide = !!row.guide && typeof row.guide === "object" && !Array.isArray(row.guide);
  const next = row.nextCodeSeq + 1;
  const mancano = [
    ...(hasGuide ? [] : ["guida (connector-admin guide)"]),
    ...(profile ? [] : ["profilo del cliente (connector-admin profile)"]),
    ...(template ? [] : ["modello delle istruzioni (connector-admin profile)"]),
    ...(active > 0 ? [] : ["token attivo (connector-admin token o scheda «Connettore Claude»)"]),
  ];
  return {
    slug: row.slug,
    acceso: row.enabled,
    prefisso: row.codePrefix,
    prossimoCodice: next <= USE_CASE_CODE_MAX_SEQ && /^[A-Z]{2,4}$/.test(row.codePrefix) ? formatUseCaseCode(row.codePrefix, next) : null,
    guida: hasGuide ? (row.guideVersion ?? "senza versione") : null,
    profilo: profile,
    istruzioni: template,
    tokenAttivi: active,
    mancano,
  };
}
