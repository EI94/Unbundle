import "server-only";
import { and, eq, gt, gte, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { useCaseEvents, useCases, users, workspaceConnectorConfigs, workspaceIntegrationTokens } from "@/lib/db/schema";
import { appExposedTokenAlertDeps, appRateLimitExecutor } from "@/lib/connector/app-deps";
import { CONNECTOR_PUBLIC_ORIGIN } from "@/lib/connector/auth";
import { alertExposedToken, type ExposedTokenAlertDeps } from "@/lib/connector/exposed-token-alert";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { getUseCaseDetail, listHubItems } from "@/lib/db/queries/use-case-hub";
import { getUseCaseById } from "@/lib/db/queries/use-cases";
import { markIntegrationTokenExposed } from "@/lib/db/queries/workspace-integrations";
import {
  claimTeamMcpRequest,
  completeTeamMcpRequest,
  failTeamMcpRequest,
  readTeamMcpRequest,
  releaseTeamMcpRequest,
  saveTeamMcpProgress,
} from "@/lib/db/queries/team-mcp-requests";
import { logSafeError } from "@/lib/log/safe-error";
import { dispatchNewPortfolioNotifications } from "@/lib/notifications/portfolio-dispatch";
import { isLateralSpaceEmail } from "@/lib/uc/lateral-space";
import { phaseOfUseCase } from "@/lib/use-cases/phase";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { createUseCases, creationFollowUps, decideUseCase, saveValuation, setHiddenFromSearch, setWhen, updateUseCase } from "@/lib/use-cases/service";
import { phaseInputOf } from "@/lib/use-cases/views";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import type { UseCase } from "@/lib/db/schema";
import { TEAM_MCP_PROVIDER, type TeamAuthDeps } from "./auth";
import type { TeamHandlerDeps } from "./handler";
import { guideAreaOptions } from "./output";
import { TEAM_MCP_LOG_AREA, type TeamReadDeps, type TeamToolDeps } from "./tools";

/**
 * Dipendenze dell'app per la rotta del MCP del team (docs/use-case/DESIGN.md §9.4): Postgres
 * con il client Neon condiviso (dopo il self-heal), il servizio unico di scrittura, le letture
 * proiettate della pagina, il limite di richieste e l'avviso di un token esposto del connettore,
 * usati senza modifiche. La rotta passa lo scheduler (`after()` di Next): le notifiche delle
 * schede create partono dopo la risposta. I test d'integrazione usano queste stesse dipendenze
 * sul database locale, con notifiche e Slack finti.
 */

type Env = Readonly<Record<string, string | undefined>>;

const TOKEN_HASH = /^[0-9a-f]{64}$/;

/**
 * Il token del team con questo hash: provider del team, con proprietario, non revocato, non
 * scaduto e mai finito in un indirizzo. Un token personale arrivato nella query è compromesso
 * (`exposed_at`, con l'avviso a Lateral Space): da quel momento non entra più, nemmeno
 * nell'header. Rifarlo costa poco; il connettore invece non si ferma da solo, perché il suo
 * token serve a tutta l'organizzazione.
 */
async function findTeamToken(tokenHash: string) {
  if (!TOKEN_HASH.test(tokenHash)) return null;
  await ensureDbSchema();
  const now = new Date();
  const [row] = await db
    .select({
      id: workspaceIntegrationTokens.id,
      workspaceId: workspaceIntegrationTokens.workspaceId,
      ownerUserId: workspaceIntegrationTokens.ownerUserId,
      scopes: workspaceIntegrationTokens.scopes,
    })
    .from(workspaceIntegrationTokens)
    .where(
      and(
        eq(workspaceIntegrationTokens.tokenHash, tokenHash),
        eq(workspaceIntegrationTokens.provider, TEAM_MCP_PROVIDER),
        isNotNull(workspaceIntegrationTokens.ownerUserId),
        isNull(workspaceIntegrationTokens.revokedAt),
        isNull(workspaceIntegrationTokens.exposedAt),
        or(isNull(workspaceIntegrationTokens.expiresAt), gt(workspaceIntegrationTokens.expiresAt, now)),
      ),
    )
    .limit(1);
  return row?.ownerUserId ? { id: row.id, workspaceId: row.workspaceId, ownerUserId: row.ownerUserId, scopes: row.scopes } : null;
}

/** Autenticazione: token, ruolo del proprietario riletto adesso, email verificata per «Lateral Space». */
export const appTeamAuthDeps: TeamAuthDeps = {
  findToken: findTeamToken,
  async ownerAccess(userId, workspaceId) {
    const access = await getCollaboratorAccess(userId, workspaceId);
    return access ? { role: access.role, workspaceName: access.workspace.name ?? null } : null;
  },
  async ownerProfile(userId) {
    await ensureDbSchema();
    const [person] = await db.select({ email: users.email, emailVerified: users.emailVerified }).from(users).where(eq(users.id, userId)).limit(1);
    if (!person) return null;
    const emailVerified = person.emailVerified !== null;
    return { email: person.email, emailVerified, isLateralSpace: isLateralSpaceEmail({ email: person.email, emailVerified }, ucLsDomains()) };
  },
  async markUsed(tokenId) {
    const now = new Date();
    await db.update(workspaceIntegrationTokens).set({ lastUsedAt: now, updatedAt: now }).where(eq(workspaceIntegrationTokens.id, tokenId));
  },
};

/**
 * Le letture dei tool: le proiezioni della pagina, id, titoli e codici, il problema intero per
 * la ricerca, le aree della guida del connettore e, per una ripresa, la Storia e lo stato della
 * scheda.
 */
export const appTeamReadDeps: TeamReadDeps = {
  listItems: (workspaceId, viewer) => listHubItems(workspaceId, viewer),
  detail: (workspaceId, useCaseId, viewer) => getUseCaseDetail(workspaceId, useCaseId, viewer),
  async findUseCaseId(workspaceId, code) {
    await ensureDbSchema();
    const [row] = await db
      .select({ id: useCases.id })
      .from(useCases)
      .where(and(eq(useCases.workspaceId, workspaceId), eq(useCases.code, code)))
      .limit(1);
    return row?.id ?? null;
  },
  async titlesOf(workspaceId, useCaseIds) {
    if (useCaseIds.length === 0) return new Map();
    await ensureDbSchema();
    const rows = await db
      .select({ id: useCases.id, title: useCases.title, code: useCases.code })
      .from(useCases)
      .where(and(eq(useCases.workspaceId, workspaceId), inArray(useCases.id, [...useCaseIds])));
    return new Map(rows.map((row) => [row.id.toLowerCase(), { title: row.title, code: row.code ?? null }]));
  },
  async problemsOf(workspaceId, useCaseIds) {
    if (useCaseIds.length === 0) return new Map();
    await ensureDbSchema();
    const rows = await db
      .select({ id: useCases.id, description: useCases.description })
      .from(useCases)
      .where(and(eq(useCases.workspaceId, workspaceId), inArray(useCases.id, [...useCaseIds])));
    return new Map(rows.flatMap((row) => (row.description ? [[row.id.toLowerCase(), row.description] as const] : [])));
  },
  async areaOptions(workspaceId) {
    await ensureDbSchema();
    const [config] = await db
      .select({ guide: workspaceConnectorConfigs.guide })
      .from(workspaceConnectorConfigs)
      .where(eq(workspaceConnectorConfigs.workspaceId, workspaceId))
      .limit(1);
    return guideAreaOptions(config?.guide);
  },
  async savedBy(workspaceId, useCaseId, { since, userId, actions }) {
    if (actions.length === 0) return false;
    await ensureDbSchema();
    const [row] = await db
      .select({ id: useCaseEvents.id })
      .from(useCaseEvents)
      .where(
        and(
          eq(useCaseEvents.workspaceId, workspaceId),
          eq(useCaseEvents.useCaseId, useCaseId),
          eq(useCaseEvents.channel, "mcp_team"),
          eq(useCaseEvents.actorUserId, userId),
          inArray(useCaseEvents.action, [...actions]),
          gte(useCaseEvents.at, since),
        ),
      )
      .limit(1);
    return Boolean(row);
  },
  async cardState(workspaceId, useCaseId, viewer) {
    // La proiezione del revisore dà accesso, dossier e oggi; la fase si calcola dalla riga
    // come nella pagina (`phaseInputOf`, `phaseOfUseCase`), con lo stato per il cliente.
    const detail = await getUseCaseDetail(workspaceId, useCaseId, viewer);
    if (!detail || detail.projection === "contributore") return null;
    const [row] = await db
      .select({
        code: useCases.code,
        version: useCases.version,
        status: useCases.status,
        portfolioReviewStatus: useCases.portfolioReviewStatus,
        reviewedBy: useCases.reviewedBy,
        publicNote: useCases.publicNote,
        intake: useCases.intake,
        reviewBy: useCases.reviewBy,
        portfolioKind: useCases.portfolioKind,
        targetQuarter: useCases.targetQuarter,
      })
      .from(useCases)
      .where(and(eq(useCases.workspaceId, workspaceId), eq(useCases.id, useCaseId)))
      .limit(1);
    if (!row) return null;
    const phase = phaseOfUseCase(phaseInputOf(row, detail.useCase.dossier, detail.today));
    return {
      id: useCaseId,
      code: row.code ?? null,
      version: row.version,
      phase: phase.phase,
      subState: phase.subState,
      phaseLabel: phase.label,
      statusCode: phase.connector.statusCode,
      statusLabel: phase.connector.statusLabel,
      targetQuarter: row.targetQuarter ?? null,
    };
  },
};

/** L'origine pubblica per i link: `NEXT_PUBLIC_APP_URL` se è un indirizzo http(s), altrimenti il dominio di produzione. */
export function teamAppOrigin(env: Env): string {
  const raw = env.NEXT_PUBLIC_APP_URL?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // indirizzo non valido: si usa quello di produzione
    }
  }
  return CONNECTOR_PUBLIC_ORIGIN;
}

export interface TeamNotifyDeps {
  loadUseCase(useCaseId: string): Promise<UseCase | null>;
  notify(params: { useCase: UseCase; workspaceId: string; source: "claude" }): Promise<void>;
}

const appNotifyDeps: TeamNotifyDeps = {
  loadUseCase: (useCaseId) => getUseCaseById(useCaseId),
  notify: (params) => dispatchNewPortfolioNotifications(params),
};

/** Le dipendenze dei tool, con un esecutore SQL del limite e lo scheduler di chi chiama. */
export function appTeamToolDeps(opts: { schedule: (task: () => Promise<void>) => void; env?: Env; notify?: TeamNotifyDeps }): TeamToolDeps {
  const env = opts.env ?? process.env;
  const notify = opts.notify ?? appNotifyDeps;
  return {
    isAreaOn: (workspaceId) => isUseCaseHubWorkspace(workspaceId, env),
    rateLimitExec: appRateLimitExecutor,
    reads: appTeamReadDeps,
    service: {
      createUseCases,
      updateUseCase,
      setHiddenFromSearch,
      saveValuation,
      decideUseCase,
      setWhen,
      creationFollowUps: (writer) => creationFollowUps("team_mcp", writer),
    },
    requests: {
      read: readTeamMcpRequest,
      claim: claimTeamMcpRequest,
      progress: saveTeamMcpProgress,
      complete: completeTeamMcpRequest,
      fail: failTeamMcpRequest,
      release: releaseTeamMcpRequest,
    },
    notifyCreated(workspaceId, useCaseIds) {
      const ids = [...useCaseIds];
      opts.schedule(async () => {
        for (const useCaseId of ids) {
          try {
            const useCase = await notify.loadUseCase(useCaseId);
            if (useCase && useCase.workspaceId === workspaceId) await notify.notify({ useCase, workspaceId, source: "claude" });
          } catch (error) {
            logSafeError(TEAM_MCP_LOG_AREA, "notify_failed", error, { useCaseId });
          }
        }
      });
    },
    appOrigin: teamAppOrigin(env),
  };
}

/** Tutte le dipendenze della rotta; l'ambiente è quello del processo. */
export function appTeamMcpHandlerDeps(opts: {
  schedule: (task: () => Promise<void>) => void;
  env?: Env;
  notify?: TeamNotifyDeps;
  alertDeps?: ExposedTokenAlertDeps;
}): TeamHandlerDeps {
  const env = opts.env ?? process.env;
  const alertDeps = opts.alertDeps ?? appExposedTokenAlertDeps;
  return {
    env,
    auth: appTeamAuthDeps,
    async markTokenExposed(tokenHash) {
      const exposed = await markIntegrationTokenExposed(tokenHash);
      if (exposed) await alertExposedToken(exposed, alertDeps);
      return exposed;
    },
    tools: appTeamToolDeps({ schedule: opts.schedule, env, notify: opts.notify }),
  };
}
