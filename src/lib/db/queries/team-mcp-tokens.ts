import { randomBytes } from "node:crypto";
import { and, count, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "..";
import { ensureDbSchema } from "../ensure-schema";
import { memberships, workspaceIntegrationTokens, workspaceMemberships, workspaces } from "../schema";
import { hashIntegrationToken } from "@/lib/connector/auth";
import { formatItalianDay, inDaysText, romeCalendarDaysBetween } from "@/lib/connector/settings-view";
import { logSafeError } from "@/lib/log/safe-error";
import { abilitiesForUseCase } from "@/lib/use-cases/permissions";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { PORTFOLIO_REVIEWER_ROLES } from "@/lib/workspace-permissions";
import { viewerFromSession } from "./use-case-hub";

/**
 * Token personali del MCP del team «Unbundle Use case» (docs/use-case/DESIGN.md §9.4
 * «Token personali», §1.2 punto 8, §11 «Token»; decisione D9; PIANO-LAVORI H5b).
 *
 * - Una riga di `workspace_integration_tokens` con `provider = 'unbundle_team_mcp'` e
 *   `owner_user_id` = la persona che lo crea, per sé. Scope `use_cases:read` e, se non è in
 *   sola lettura, `use_cases:write`. Nessun altro permesso nel token: il MCP del team
 *   rilegge ruolo e appartenenza del proprietario a ogni chiamata (H5a).
 * - Prefisso del team (`TEAM_MCP_TOKEN_PREFIX`), scadenza a 90 giorni, avviso da 14 giorni prima. In tabella solo
 *   l'hash (`hashIntegrationToken`, lo stesso delle altre credenziali di workspace); il
 *   token in chiaro esce solo da `createTeamMcpToken`, una volta.
 * - Ognuno elenca e revoca solo i propri token. Chi gestisce il workspace vede in più il
 *   numero dei token attivi del workspace e li revoca tutti insieme: un conteggio per
 *   workspace, mai per persona (art. 15.4), e nessun elenco dei token degli altri.
 *
 * Chi può fare cosa lo decidono le action (`src/lib/actions/team-mcp-tokens.ts`) con
 * `abilitiesForUseCase`; qui ogni scrittura è comunque legata a workspace, provider e,
 * per la revoca singola, al proprietario. Nessun token, hash o etichetta nei log.
 */

/** `workspace_integration_tokens.provider` dei token personali del MCP del team. */
export const TEAM_MCP_PROVIDER = "unbundle_team_mcp" as const;
/** Prefisso dei token personali (`DEFAULT_TOKEN_PREFIXES` del connettore lo riconosce in un indirizzo). */
export const TEAM_MCP_TOKEN_PREFIX = "ub_team_" as const;
export const TEAM_MCP_READ_SCOPE = "use_cases:read" as const;
export const TEAM_MCP_WRITE_SCOPE = "use_cases:write" as const;
/** Durata di un token personale (§1.2 punto 8). */
export const TEAM_MCP_TOKEN_TTL_DAYS = 90;
/** Giorni prima della scadenza da cui la card avvisa. */
export const TEAM_MCP_TOKEN_WARNING_DAYS = 14;
/** Etichetta proposta nel modulo e usata quando arriva vuota. */
export const TEAM_MCP_TOKEN_DEFAULT_LABEL = "Claude";
/** Indirizzo pubblico del MCP del team (§9.4): il workspace lo dà il token. */
export const TEAM_MCP_PUBLIC_URL = "https://www.theunbundle.com/api/mcp/use-case";
/** Nome del connettore in Claude: la skill «registra-ai-lab» cita i tool come «Unbundle Use case:<tool>». */
export const TEAM_MCP_CONNECTOR_NAME = "Unbundle Use case";
/** Nome del server in Claude Code (`claude mcp add`): senza spazi. */
export const TEAM_MCP_CLAUDE_CODE_NAME = "unbundle-use-case";
/** La skill dei conduttori degli AI Lab (`skills/registra-ai-lab`, zip con `scripts/use-case-skill-package.mjs`). */
export const TEAM_MCP_SKILL_NAME = "registra-ai-lab";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Scope di un token nuovo: lettura sempre, scrittura se non è in sola lettura. */
export function teamMcpScopes(readOnly: boolean): string[] {
  return readOnly ? [TEAM_MCP_READ_SCOPE] : [TEAM_MCP_READ_SCOPE, TEAM_MCP_WRITE_SCOPE];
}

/** Scadenza di un token creato adesso. */
export function teamMcpTokenExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + TEAM_MCP_TOKEN_TTL_DAYS * DAY_MS);
}

/** Vero se gli scope del token non comprendono la scrittura. */
export function isReadOnlyScopes(scopes: unknown): boolean {
  return !Array.isArray(scopes) || !scopes.includes(TEAM_MCP_WRITE_SCOPE);
}

function createTeamMcpSecret(): string {
  return `${TEAM_MCP_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** L'inizio del token che resta visibile nella card: il prefisso e 6 caratteri. */
function visiblePrefix(token: string): string {
  return `${token.slice(0, TEAM_MCP_TOKEN_PREFIX.length + 6)}...`;
}

// ─── Vista per la card ─────────────────────────────────────────────────

/** Le colonne di un token che la card legge: mai l'hash. */
export interface TeamMcpTokenRow {
  id: string;
  label: string;
  tokenPrefix: string;
  scopes: unknown;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  exposedAt: Date | null;
}

/** «attivo», «in_scadenza» (da 14 giorni prima), «scaduto», «revocato». */
export type TeamMcpTokenState = "attivo" | "in_scadenza" | "scaduto" | "revocato";

/** Un token come lo mostra la card: date già scritte in italiano (fuso di Roma), nessun segreto. */
export interface TeamMcpTokenView {
  id: string;
  label: string;
  tokenPrefix: string;
  readOnly: boolean;
  state: TeamMcpTokenState;
  /** Né revocato né scaduto. */
  active: boolean;
  /** «oggi», «domani», «tra N giorni» fino alla scadenza; null se non è attivo. */
  expiresIn: string | null;
  /** Arrivato dentro un indirizzo web: da revocare finché è attivo. */
  exposed: boolean;
  createdOn: string;
  expiresOn: string | null;
  lastUsedOn: string | null;
  revokedOn: string | null;
  exposedOn: string | null;
}

export function teamMcpTokenView(row: TeamMcpTokenRow, now: Date = new Date()): TeamMcpTokenView {
  const msLeft = row.expiresAt ? row.expiresAt.getTime() - now.getTime() : null;
  const state: TeamMcpTokenState = row.revokedAt
    ? "revocato"
    : msLeft !== null && msLeft <= 0
      ? "scaduto"
      : msLeft !== null && Math.ceil(msLeft / DAY_MS) <= TEAM_MCP_TOKEN_WARNING_DAYS
        ? "in_scadenza"
        : "attivo";
  const active = state === "attivo" || state === "in_scadenza";
  const daysLeft = active && row.expiresAt ? Math.max(0, romeCalendarDaysBetween(now, row.expiresAt)) : null;
  return {
    id: row.id,
    label: row.label,
    tokenPrefix: row.tokenPrefix,
    readOnly: isReadOnlyScopes(row.scopes),
    state,
    active,
    expiresIn: daysLeft === null ? null : inDaysText(daysLeft),
    exposed: row.exposedAt != null,
    createdOn: formatItalianDay(row.createdAt) ?? "",
    expiresOn: formatItalianDay(row.expiresAt),
    lastUsedOn: formatItalianDay(row.lastUsedAt),
    revokedOn: formatItalianDay(row.revokedAt),
    exposedOn: formatItalianDay(row.exposedAt),
  };
}

// ─── Query ─────────────────────────────────────────────────────────────

/** Le colonne di UTC dell'app: `now()` del database in UTC, qualunque sia il fuso della sessione. */
const utcNow = sql`(now() AT TIME ZONE 'UTC')`;

const ownColumns = {
  id: workspaceIntegrationTokens.id,
  label: workspaceIntegrationTokens.label,
  tokenPrefix: workspaceIntegrationTokens.tokenPrefix,
  scopes: workspaceIntegrationTokens.scopes,
  createdAt: workspaceIntegrationTokens.createdAt,
  expiresAt: workspaceIntegrationTokens.expiresAt,
  lastUsedAt: workspaceIntegrationTokens.lastUsedAt,
  revokedAt: workspaceIntegrationTokens.revokedAt,
  exposedAt: workspaceIntegrationTokens.exposedAt,
};

/** Token del MCP del team di questo workspace, non revocati e non scaduti. */
function activeTeamTokens(workspaceId: string, now: Date) {
  return and(
    eq(workspaceIntegrationTokens.workspaceId, workspaceId),
    eq(workspaceIntegrationTokens.provider, TEAM_MCP_PROVIDER),
    isNull(workspaceIntegrationTokens.revokedAt),
    or(isNull(workspaceIntegrationTokens.expiresAt), gt(workspaceIntegrationTokens.expiresAt, now))
  );
}

/**
 * Il ruolo di adesso del proprietario del token nel workspace del token, come lo legge
 * `getWorkspaceAccessForUser`: prima l'organizzazione, poi il workspace; '' se non c'è più.
 */
const ownerRoleNow = sql`coalesce(
  (SELECT m.role::text FROM ${memberships} m JOIN ${workspaces} w ON w.organization_id = m.organization_id
    WHERE w.id = ${workspaceIntegrationTokens.workspaceId} AND m.user_id = ${workspaceIntegrationTokens.ownerUserId} LIMIT 1),
  (SELECT wm.role::text FROM ${workspaceMemberships} wm
    WHERE wm.workspace_id = ${workspaceIntegrationTokens.workspaceId} AND wm.user_id = ${workspaceIntegrationTokens.ownerUserId} LIMIT 1),
  '')`;

/**
 * Il proprietario valuta ancora gli use case del workspace. Un token di chi ha perso il ruolo da
 * revisore o ha lasciato il workspace non vale più (il MCP del team lo rifiuta, H5a): non conta
 * tra i token attivi e si revoca quando il ruolo cambia (`revokeTeamMcpTokensOfOwner`).
 */
const ownerStillReviews = sql`${ownerRoleNow} IN (${sql.join(
  PORTFOLIO_REVIEWER_ROLES.map((role) => sql`${role}`),
  sql`, `
)})`;

/**
 * Crea un token personale e lo restituisce in chiaro, una volta sola. In tabella restano
 * l'hash, l'inizio visibile, gli scope, la scadenza e il proprietario.
 */
export async function createTeamMcpToken(params: {
  workspaceId: string;
  ownerUserId: string;
  label: string;
  readOnly: boolean;
  now?: Date;
}): Promise<{ token: string; row: TeamMcpTokenRow }> {
  await ensureDbSchema();
  const token = createTeamMcpSecret();
  const [row] = await db
    .insert(workspaceIntegrationTokens)
    .values({
      workspaceId: params.workspaceId,
      label: params.label.trim() || TEAM_MCP_TOKEN_DEFAULT_LABEL,
      provider: TEAM_MCP_PROVIDER,
      tokenHash: hashIntegrationToken(token),
      tokenPrefix: visiblePrefix(token),
      scopes: teamMcpScopes(params.readOnly),
      createdByUserId: params.ownerUserId,
      ownerUserId: params.ownerUserId,
      expiresAt: teamMcpTokenExpiresAt(params.now),
    })
    .returning(ownColumns);
  return { token, row };
}

/** I token del MCP del team di questa persona in questo workspace, i più recenti prima. Mai quelli degli altri. */
export async function listOwnTeamMcpTokens(params: { workspaceId: string; ownerUserId: string }): Promise<TeamMcpTokenRow[]> {
  await ensureDbSchema();
  return db
    .select(ownColumns)
    .from(workspaceIntegrationTokens)
    .where(
      and(
        eq(workspaceIntegrationTokens.workspaceId, params.workspaceId),
        eq(workspaceIntegrationTokens.provider, TEAM_MCP_PROVIDER),
        eq(workspaceIntegrationTokens.ownerUserId, params.ownerUserId)
      )
    )
    .orderBy(desc(workspaceIntegrationTokens.createdAt));
}

/**
 * Revoca un token del MCP del team, solo se è della persona, di questo workspace e non è
 * già revocato. Null altrimenti (id di un altro, di un altro workspace o di un'altra card).
 */
export async function revokeOwnTeamMcpToken(params: {
  workspaceId: string;
  ownerUserId: string;
  tokenId: string;
}): Promise<{ id: string } | null> {
  await ensureDbSchema();
  const [row] = await db
    .update(workspaceIntegrationTokens)
    .set({ revokedAt: utcNow, updatedAt: utcNow })
    .where(
      and(
        eq(workspaceIntegrationTokens.id, params.tokenId),
        eq(workspaceIntegrationTokens.workspaceId, params.workspaceId),
        eq(workspaceIntegrationTokens.provider, TEAM_MCP_PROVIDER),
        eq(workspaceIntegrationTokens.ownerUserId, params.ownerUserId),
        isNull(workspaceIntegrationTokens.revokedAt)
      )
    )
    .returning({ id: workspaceIntegrationTokens.id });
  return row ?? null;
}

/**
 * «Revoca tutti» di chi gestisce il workspace: ogni token attivo del MCP del team (non
 * revocato e non scaduto), di chiunque sia, anche di chi non valuta più. Restituisce solo
 * quanti ne ha revocati tra quelli che la card conta (`countActiveTeamMcpTokens`), mai di chi.
 */
export async function revokeAllTeamMcpTokens(params: { workspaceId: string; now?: Date }): Promise<number> {
  await ensureDbSchema();
  const rows = await db
    .update(workspaceIntegrationTokens)
    .set({ revokedAt: utcNow, updatedAt: utcNow })
    .where(activeTeamTokens(params.workspaceId, params.now ?? new Date()))
    .returning({ id: workspaceIntegrationTokens.id, counted: sql<boolean>`${ownerStillReviews}` });
  return rows.filter((row) => row.counted).length;
}

/**
 * Revoca i token del MCP del team di una persona in un workspace, quando perde il ruolo da
 * revisore o lascia il workspace (`src/lib/actions/workspace-collaboration.ts`). Restituisce
 * quanti ne ha revocati.
 */
export async function revokeTeamMcpTokensOfOwner(params: { workspaceId: string; ownerUserId: string }): Promise<number> {
  await ensureDbSchema();
  const rows = await db
    .update(workspaceIntegrationTokens)
    .set({ revokedAt: utcNow, updatedAt: utcNow })
    .where(
      and(
        eq(workspaceIntegrationTokens.workspaceId, params.workspaceId),
        eq(workspaceIntegrationTokens.provider, TEAM_MCP_PROVIDER),
        eq(workspaceIntegrationTokens.ownerUserId, params.ownerUserId),
        isNull(workspaceIntegrationTokens.revokedAt)
      )
    )
    .returning({ id: workspaceIntegrationTokens.id });
  return rows.length;
}

/**
 * Quanti token del MCP del team sono attivi nel workspace: un numero per workspace, mai per
 * persona. Solo quelli di chi valuta ancora: un token di chi ha perso il ruolo o ha lasciato il
 * workspace (anche dall'organizzazione) non vale e non conta.
 */
export async function countActiveTeamMcpTokens(workspaceId: string, now: Date = new Date()): Promise<number> {
  await ensureDbSchema();
  const [row] = await db
    .select({ active: count() })
    .from(workspaceIntegrationTokens)
    .where(and(activeTeamTokens(workspaceId, now), ownerStillReviews));
  return Number(row?.active ?? 0);
}

// ─── Card «Claude per il team» ─────────────────────────────────────────

/** Interruttore della rotta del MCP del team (§9.4): acceso solo con `MCP_TEAM_ENABLED` uguale a `true`. */
export const TEAM_MCP_ENABLED_ENV = "MCP_TEAM_ENABLED";

export function isTeamMcpRouteEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[TEAM_MCP_ENABLED_ENV]?.trim() === "true";
}

/** Tutto quello che la card riceve dalla pagina: valori già pronti, nessun segreto né hash. */
export interface TeamMcpCardData {
  /** `errore`: i token non si leggono ora; la card lo dice e il resto delle impostazioni resta. */
  status: "pronta" | "errore";
  /** Solo i token di chi guarda. */
  tokens: TeamMcpTokenView[];
  /** Token attivi nel workspace, solo per chi gestisce il workspace (null per gli altri). */
  workspaceActiveCount: number | null;
  /** «Revoca tutti»: chi gestisce il workspace. */
  canRevokeAll: boolean;
  /** `MCP_TEAM_ENABLED`: spento, l'indirizzo risponde 404. */
  routeEnabled: boolean;
  ttlDays: number;
  warningDays: number;
  defaultLabel: string;
  url: string;
  connectorName: string;
  claudeCodeName: string;
  /**
   * La skill «registra-ai-lab» (DESIGN §8.2), che trasforma gli appunti di un AI Lab in use case
   * con questo collegamento: la card la nomina solo a Lateral Space, che conduce gli AI Lab.
   */
  skillName: string | null;
}

/**
 * La card per chi guarda, oppure null quando non si mostra: area «Use case» spenta per il
 * workspace, oppure chi guarda non ha un ruolo da revisore (contributori e chi segue un
 * corso non la vedono, §1.2 punto 8). Ruolo e area si rileggono a ogni richiesta.
 */
export async function loadTeamMcpCard(params: {
  workspaceId: string;
  user: { id: string; email: string | null; emailVerified: boolean };
  role: string | null;
  now?: Date;
}): Promise<TeamMcpCardData | null> {
  if (!isUseCaseHubWorkspace(params.workspaceId)) return null;
  const abilities = abilitiesForUseCase(viewerFromSession(params.user, params.role));
  if (!abilities.canUseTeamMcp) return null;
  const now = params.now ?? new Date();
  const base = {
    canRevokeAll: abilities.managesWorkspace,
    routeEnabled: isTeamMcpRouteEnabled(),
    ttlDays: TEAM_MCP_TOKEN_TTL_DAYS,
    warningDays: TEAM_MCP_TOKEN_WARNING_DAYS,
    defaultLabel: TEAM_MCP_TOKEN_DEFAULT_LABEL,
    url: TEAM_MCP_PUBLIC_URL,
    connectorName: TEAM_MCP_CONNECTOR_NAME,
    claudeCodeName: TEAM_MCP_CLAUDE_CODE_NAME,
    skillName: abilities.isLateralSpace ? TEAM_MCP_SKILL_NAME : null,
  };
  try {
    const [own, workspaceActiveCount] = await Promise.all([
      listOwnTeamMcpTokens({ workspaceId: params.workspaceId, ownerUserId: params.user.id }),
      abilities.managesWorkspace ? countActiveTeamMcpTokens(params.workspaceId, now) : Promise.resolve(null),
    ]);
    return { ...base, status: "pronta", tokens: own.map((row) => teamMcpTokenView(row, now)), workspaceActiveCount };
  } catch (error) {
    // Un guasto della card non deve fermare il resto delle impostazioni.
    logSafeError("team-mcp-card", "load_failed", error);
    return { ...base, status: "errore", tokens: [], workspaceActiveCount: null };
  }
}
