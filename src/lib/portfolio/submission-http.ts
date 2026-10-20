/**
 * Rotta REST `POST /api/mcp/portfolio/submissions` (server MCP stdio e client
 * esterni con token `portfolio:submit`). Autentica, valida e chiama il servizio
 * condiviso; risponde con le stesse forme di sempre, link relativi compresi.
 * Separata da route.ts per poterla provare con uno scheduler e dipendenze finte.
 */
import { dispatchNewPortfolioNotifications, wasPortfolioItemAnnounced } from "@/lib/notifications/portfolio-dispatch";
import {
  authenticateWorkspaceIntegrationToken,
  claimExternalContributionSubmission,
  completeExternalContributionSubmission,
  failExternalContributionSubmission,
  PORTFOLIO_SUBMIT_SCOPE,
  readExternalContributionSubmission,
  type AuthenticatedWorkspaceIntegrationToken,
} from "@/lib/db/queries/workspace-integrations";
import { createUseCaseOnce, getUseCaseById } from "@/lib/db/queries/use-cases";
import { autoScorePortfolioUseCase } from "@/lib/portfolio/ai-ranking";
import { buildExternalContributionResponse } from "@/lib/portfolio/external-submission";
import { tokenPrincipalKey } from "@/lib/portfolio/idempotency";
import {
  submitPortfolioContribution,
  type AfterResponseScheduler,
  type SubmitContributionDeps,
} from "@/lib/portfolio/submit-contribution";

/** Dipendenze dell'app per il servizio condiviso (Postgres, ranking AI, notifiche). */
export const appSubmitContributionDeps: SubmitContributionDeps = {
  claim: claimExternalContributionSubmission,
  complete: completeExternalContributionSubmission,
  fail: failExternalContributionSubmission,
  readSubmission: readExternalContributionSubmission,
  createUseCase: createUseCaseOnce,
  getUseCaseById,
  autoScore: autoScorePortfolioUseCase,
  notify: dispatchNewPortfolioNotifications,
  wasAnnounced: wasPortfolioItemAnnounced,
};

export type PortfolioSubmissionHttpDeps = SubmitContributionDeps & {
  authenticate(rawToken: string | null): Promise<AuthenticatedWorkspaceIntegrationToken | null>;
};

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function handlePortfolioSubmissionPost(
  request: Request,
  opts: { schedule: AfterResponseScheduler; deps?: Partial<PortfolioSubmissionHttpDeps> }
): Promise<Response> {
  const deps: PortfolioSubmissionHttpDeps = {
    ...appSubmitContributionDeps,
    authenticate: authenticateWorkspaceIntegrationToken,
    ...opts.deps,
  };

  const auth = await deps.authenticate(bearerToken(request));
  if (!auth) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!auth.token.scopes?.includes(PORTFOLIO_SUBMIT_SCOPE)) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = await parseJson(request);
  const result = await submitPortfolioContribution(
    {
      workspace: auth.workspace,
      principalKey: tokenPrincipalKey(auth.token.id),
      integrationTokenId: auth.token.id,
    },
    body,
    { deps, schedule: opts.schedule }
  );

  if (result.ok) {
    return Response.json(
      buildExternalContributionResponse({
        useCase: result.useCase,
        workspaceId: auth.workspace.id,
        duplicate: result.duplicate,
      }),
      result.duplicate ? undefined : { status: 201 }
    );
  }

  switch (result.error) {
    case "invalid_payload":
    case "missing_esg":
    case "missing_guardrails":
      return Response.json(
        { ok: false, error: result.error, fieldErrors: result.fieldErrors },
        { status: 422 }
      );
    case "idempotency_conflict":
      return Response.json(
        {
          ok: false,
          error: "idempotency_conflict",
          message: "Questo idempotencyKey è già stato usato con un payload diverso.",
        },
        { status: 409 }
      );
    case "idempotency_in_progress":
      return Response.json(
        {
          ok: false,
          error: "idempotency_in_progress",
          message:
            "Una submission con lo stesso idempotencyKey è già in corso o non si è chiusa correttamente. Usa un nuovo idempotencyKey solo se vuoi creare un nuovo contributo.",
        },
        { status: 409, headers: { "Retry-After": String(result.retryAfterSeconds) } }
      );
    case "submit_failed":
      return Response.json(
        {
          ok: false,
          error: "submit_failed",
          message: "Unbundle non è riuscito a salvare il contributo. Riprova tra poco.",
        },
        { status: 500 }
      );
  }
}
