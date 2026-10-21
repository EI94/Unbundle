/**
 * Autenticazione del MCP del team «Unbundle Use case» (docs/use-case/DESIGN.md §9.4, D9).
 *
 * - **Token personali.** Si legge solo l'header `Authorization` con lo schema `Bearer` e un
 *   token con il prefisso del team (`TEAM_MCP_TOKEN_PREFIX`). Il token vale se è del provider
 *   del team (`unbundle_team_mcp`), ha un proprietario (`owner_user_id`), non è revocato né
 *   scaduto e ha almeno lo scope di lettura. Un token v1 (provider `claude_mcp`) o del
 *   connettore non passa: ha un altro prefisso e un altro provider.
 * - **Permessi = quelli della persona, a ogni richiesta.** Ruolo e appartenenza del
 *   proprietario si rileggono adesso (`getCollaboratorAccess`, che esclude chi segue solo un
 *   corso). Se non è più nel workspace o non ha più un ruolo da revisore, 401: il token non
 *   porta permessi salvati oltre agli scope. Lateral Space si rilegge dall'email verificata.
 * - **Scope.** `use_cases:read` per tutto; `use_cases:write` per i tool di scrittura (un token
 *   «Solo lettura» non lo ha). Lo scope non dà permessi che la persona non ha.
 * - Il token si confronta solo come hash SHA-256 (`hashIntegrationToken` del connettore).
 *   `last_used_at` si aggiorna solo quando la richiesta passa.
 *
 * Modulo puro: il database arriva dalle dipendenze (`app-deps.ts`); gira con `node --test`.
 */
import { bearerTokenFromHeader, hashIntegrationToken, hasAllScopes } from "../../connector/auth.ts";
import { abilitiesForUseCase, type UseCaseAbilities, type UseCaseViewer } from "../permissions.ts";

/** `workspace_integration_tokens.provider` dei token personali del team. */
export const TEAM_MCP_PROVIDER = "unbundle_team_mcp";
/** Prefisso dei token personali del team (DESIGN §1.2 punto 8). */
export const TEAM_MCP_TOKEN_PREFIX = "ub_team_";
export const TEAM_MCP_READ_SCOPE = "use_cases:read";
export const TEAM_MCP_WRITE_SCOPE = "use_cases:write";
/** Gli scope di un token che non è in sola lettura. */
export const TEAM_MCP_SCOPES: readonly string[] = Object.freeze([TEAM_MCP_READ_SCOPE, TEAM_MCP_WRITE_SCOPE]);
/** Durata di un token personale del team (DESIGN §1.2 punto 8). */
export const TEAM_MCP_TOKEN_TTL_DAYS = 90;

/** Interruttore della rotta: spenta (404) se non vale `true`. */
export const TEAM_MCP_ENABLED_ENV = "MCP_TEAM_ENABLED";

type Env = Readonly<Record<string, string | undefined>>;

export function isTeamMcpEnabled(env: Env): boolean {
  return env[TEAM_MCP_ENABLED_ENV]?.trim() === "true";
}

/** La riga di un token del team già filtrata dal database (provider, proprietario, revoca, scadenza). */
export interface TeamTokenRecord {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  scopes: unknown;
}

/** L'accesso del proprietario al workspace, riletto adesso. */
export interface TeamOwnerAccess {
  role: string;
  /** Nome del workspace, per le istruzioni del server. */
  workspaceName: string | null;
}

/** Il proprietario come lo legge la tabella `users`. */
export interface TeamOwnerProfile {
  email: string | null;
  emailVerified: boolean;
  /** Email verificata in un dominio di Lateral Space (`UC_LS_EMAIL_DOMAINS`). */
  isLateralSpace: boolean;
}

export interface TeamAuthDeps {
  /** Il token del team con questo hash, se attivo; altrimenti null. Non scrive nulla. */
  findToken(tokenHash: string): Promise<TeamTokenRecord | null>;
  /** Ruolo del proprietario nel workspace (`getCollaboratorAccess`: `learner` escluso); null senza accesso. */
  ownerAccess(userId: string, workspaceId: string): Promise<TeamOwnerAccess | null>;
  ownerProfile(userId: string): Promise<TeamOwnerProfile | null>;
  /** `last_used_at` del token, solo per una richiesta accettata. */
  markUsed(tokenId: string): Promise<void>;
}

/** Chi chiama il MCP del team, per questa richiesta. */
export interface TeamPrincipal {
  tokenId: string;
  workspaceId: string;
  userId: string;
  /** `token:<id>`: la chiave dell'idempotenza (come il connettore in fase 1). */
  principalKey: string;
  scopes: string[];
  /** Ha lo scope di scrittura (il token non è «Solo lettura»). */
  canWrite: boolean;
  viewer: UseCaseViewer;
  abilities: UseCaseAbilities;
  workspaceName: string | null;
}

export type TeamAuthFailure = "no_token" | "unknown_token" | "scope" | "not_member" | "not_reviewer";

export type TeamAuthResult = { ok: true; principal: TeamPrincipal } | { ok: false; reason: TeamAuthFailure };

export function teamPrincipalKey(tokenId: string): string {
  return `token:${tokenId}`;
}

function scopeList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];
}

/**
 * Chi chiama, dall'header `Authorization`, con ruolo e appartenenza riletti adesso. Un header
 * senza un token del team (prefisso o forma) risponde senza toccare il database.
 */
export async function authenticateTeamRequest(authorization: string | null, deps: TeamAuthDeps): Promise<TeamAuthResult> {
  const raw = bearerTokenFromHeader(authorization, TEAM_MCP_TOKEN_PREFIX);
  if (!raw) return { ok: false, reason: "no_token" };
  const token = await deps.findToken(hashIntegrationToken(raw));
  if (!token) return { ok: false, reason: "unknown_token" };
  const scopes = scopeList(token.scopes);
  if (!hasAllScopes(scopes, [TEAM_MCP_READ_SCOPE])) return { ok: false, reason: "scope" };

  const [access, profile] = await Promise.all([
    deps.ownerAccess(token.ownerUserId, token.workspaceId),
    deps.ownerProfile(token.ownerUserId),
  ]);
  if (!access || !profile) return { ok: false, reason: "not_member" };
  const viewer: UseCaseViewer = {
    userId: token.ownerUserId,
    email: profile.email,
    emailVerified: profile.emailVerified === true,
    role: access.role,
    isLateralSpace: profile.isLateralSpace === true,
  };
  const abilities = abilitiesForUseCase(viewer);
  // Solo chi ha un ruolo da revisore usa il MCP del team (DESIGN §1.2 punto 8).
  if (!abilities.canUseTeamMcp) return { ok: false, reason: "not_reviewer" };

  await deps.markUsed(token.id);
  return {
    ok: true,
    principal: {
      tokenId: token.id,
      workspaceId: token.workspaceId,
      userId: token.ownerUserId,
      principalKey: teamPrincipalKey(token.id),
      scopes,
      canWrite: scopes.includes(TEAM_MCP_WRITE_SCOPE),
      viewer,
      abilities,
      workspaceName: access.workspaceName,
    },
  };
}
