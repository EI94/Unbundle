/**
 * Configurazione del connettore e interruttori (prompt WP4).
 *
 * - Interruttore globale: `MCP_CONNECTOR_ENABLED=true` accende la rotta; con
 *   qualsiasi altro valore, o senza variabile, la rotta risponde 404.
 * - Interruttore del workspace: `workspace_connector_configs.enabled = false` →
 *   ogni tool risponde `connector_disabled` (l'handshake MCP e `tools/list`
 *   restano possibili, così Claude sa che il servizio è sospeso e passa al piano B).
 * - La riga della configurazione si trova per slug (non è un segreto). Qui la si
 *   ripulisce: limiti con i valori predefiniti dove mancano o non sono validi,
 *   origini ammesse normalizzate, profilo del cliente e modello delle istruzioni
 *   validati (decisione 1 dell'arresto B: per workspace, nel database). Un profilo o
 *   un modello assente o non valido diventa null: la rotta allora risponde 500.
 *
 * Modulo puro: lo usano la rotta e i test con `node --test`.
 */
import { CONNECTOR_DEFAULT_LIMITS, type ConnectorLimits } from "../db/connector-ddl.ts";
import { connectorError, type ConnectorError, type IdentityMode } from "./contract.ts";
import { normalizeAllowedOrigins } from "./http-hygiene.ts";
import { validateInstructionsTemplate } from "./instructions.ts";
import { connectorProfileFromStored, type ConnectorProfile } from "./profile.ts";

export { CONNECTOR_DEFAULT_LIMITS, type ConnectorLimits };

/** Variabile d'ambiente che accende la rotta del connettore. */
export const CONNECTOR_ENABLED_ENV = "MCP_CONNECTOR_ENABLED";

/** Pattern dello slug (CHECK di `workspace_connector_configs.slug`). */
export const CONNECTOR_SLUG_PATTERN = /^[a-z0-9-]{3,40}$/;

/** Tetto di sicurezza per un limite letto dalla configurazione. */
const LIMIT_MAX = 1_000_000;

export type ConnectorAuthMode = "header" | "oauth";

/** Vero solo con `MCP_CONNECTOR_ENABLED` uguale a `true`. */
export function isConnectorRouteEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[CONNECTOR_ENABLED_ENV]?.trim() === "true";
}

export function isValidConnectorSlug(slug: unknown): slug is string {
  return typeof slug === "string" && CONNECTOR_SLUG_PATTERN.test(slug);
}

/** Riga di `workspace_connector_configs` (più `esg_enabled` del workspace), come arriva dal database. */
export interface ConnectorConfigRow {
  workspaceId: string;
  slug: string;
  enabled: boolean;
  codePrefix: string;
  identityMode: string;
  authMode: string;
  workspaceDisplayName: string | null;
  guide: unknown;
  guideVersion: string | null;
  allowedOrigins: unknown;
  limits: unknown;
  esgEnabled?: boolean | null;
  /** Profilo del cliente (`profile`, coda della 0019); assente prima del caricamento. */
  profile?: unknown;
  /** Modello delle istruzioni del server (`instructions_template`, coda della 0019). */
  instructionsTemplate?: string | null;
}

/** Configurazione pronta per la rotta e per i tool. */
export interface ConnectorRuntimeConfig {
  workspaceId: string;
  slug: string;
  enabled: boolean;
  codePrefix: string;
  identityMode: IdentityMode;
  authMode: ConnectorAuthMode;
  workspaceDisplayName: string | null;
  guide: Record<string, unknown> | null;
  guideVersion: string | null;
  /** Origini HTTP ammesse, normalizzate (`scheme://host[:porta]`). */
  allowedOrigins: string[];
  limits: ConnectorLimits;
  esgEnabled: boolean;
  /** Profilo del cliente validato; null se manca o non è valido (la rotta risponde 500). */
  profile: ConnectorProfile | null;
  /** Modello delle istruzioni validato; null se manca o non è valido (la rotta risponde 500). */
  instructionsTemplate: string | null;
  /** Campi sbagliati del profilo o del modello, per il log (mai i valori); vuoto se è tutto valido. */
  profileProblems: readonly string[];
}

/**
 * Limiti effettivi: per ogni chiave un intero da 0 a 1.000.000, altrimenti il
 * valore predefinito di fase 1 (200 invii e 3.000 letture l'ora per credenziale,
 * 1.000 invii al giorno per workspace; fase 2: 10 invii l'ora per persona).
 */
export function resolveConnectorLimits(raw: unknown): ConnectorLimits {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...CONNECTOR_DEFAULT_LIMITS } as ConnectorLimits;
  for (const key of Object.keys(CONNECTOR_DEFAULT_LIMITS) as Array<keyof ConnectorLimits>) {
    const value = source[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= LIMIT_MAX) out[key] = value;
  }
  return out;
}

export function toConnectorRuntimeConfig(row: ConnectorConfigRow): ConnectorRuntimeConfig {
  const guide = row.guide && typeof row.guide === "object" && !Array.isArray(row.guide) ? (row.guide as Record<string, unknown>) : null;
  const profile = connectorProfileFromStored(row.profile ?? null);
  const template = validateInstructionsTemplate(row.instructionsTemplate ?? null);
  const profileProblems = [
    ...(profile.ok ? [] : Object.keys(profile.fieldErrors).map((key) => (key === "profile" ? key : `profile.${key}`)).slice(0, 20)),
    ...(template.ok ? [] : ["instructions_template"]),
  ];
  return {
    workspaceId: row.workspaceId,
    slug: row.slug,
    enabled: row.enabled === true,
    codePrefix: row.codePrefix,
    identityMode: row.identityMode === "verificata" ? "verificata" : "dichiarata",
    authMode: row.authMode === "oauth" ? "oauth" : "header",
    workspaceDisplayName: row.workspaceDisplayName?.trim() || null,
    guide,
    guideVersion: row.guideVersion?.trim() || null,
    allowedOrigins: normalizeAllowedOrigins(row.allowedOrigins),
    limits: resolveConnectorLimits(row.limits),
    esgEnabled: row.esgEnabled === true,
    profile: profile.ok ? profile.profile : null,
    instructionsTemplate: template.ok ? template.template : null,
    profileProblems,
  };
}

/** `connector_disabled` se il connettore del workspace è sospeso, altrimenti null. */
export function connectorSuspendedError(config: Pick<ConnectorRuntimeConfig, "enabled">): ConnectorError | null {
  return config.enabled ? null : connectorError("connector_disabled");
}
