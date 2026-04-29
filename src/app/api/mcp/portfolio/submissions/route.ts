import { dispatchNewPortfolioNotifications } from "@/lib/notifications/portfolio-dispatch";
import {
  authenticateWorkspaceIntegrationToken,
  claimExternalContributionSubmission,
  completeExternalContributionSubmission,
  failExternalContributionSubmission,
  PORTFOLIO_SUBMIT_SCOPE,
} from "@/lib/db/queries/workspace-integrations";
import { createUseCase, getUseCaseById } from "@/lib/db/queries/use-cases";
import {
  buildExternalContributionResponse,
  buildUseCaseDataFromExternalContribution,
  hashExternalContributionPayload,
  validateExternalContributionPayload,
} from "@/lib/portfolio/external-submission";
import { autoScorePortfolioUseCase } from "@/lib/portfolio/ai-ranking";

export const runtime = "nodejs";

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

export async function POST(request: Request) {
  const auth = await authenticateWorkspaceIntegrationToken(bearerToken(request));
  if (!auth) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!auth.token.scopes?.includes(PORTFOLIO_SUBMIT_SCOPE)) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = await parseJson(request);
  const validation = validateExternalContributionPayload(body, {
    esgEnabled: auth.workspace.esgEnabled === true,
  });
  if (!validation.ok) {
    return Response.json(
      {
        ok: false,
        error: validation.code,
        fieldErrors: validation.fieldErrors,
      },
      { status: 422 }
    );
  }

  const payload = validation.data;
  const requestHash = hashExternalContributionPayload(payload);
  const claim = await claimExternalContributionSubmission({
    workspaceId: auth.workspace.id,
    integrationTokenId: auth.token.id,
    idempotencyKey: payload.idempotencyKey,
    requestHash,
  });

  if (claim.status === "conflict") {
    return Response.json(
      {
        ok: false,
        error: "idempotency_conflict",
        message:
          "Questo idempotencyKey è già stato usato con un payload diverso.",
      },
      { status: 409 }
    );
  }

  if (claim.status === "duplicate") {
    if (claim.submission.status === "completed" && claim.submission.useCaseId) {
      const useCase = await getUseCaseById(claim.submission.useCaseId);
      if (useCase) {
        return Response.json(
          buildExternalContributionResponse({
            useCase,
            workspaceId: auth.workspace.id,
            duplicate: true,
          })
        );
      }
    }

    return Response.json(
      {
        ok: false,
        error: "idempotency_in_progress",
        message:
          "Una submission con lo stesso idempotencyKey è già in corso o non si è chiusa correttamente. Usa un nuovo idempotencyKey solo se vuoi creare un nuovo contributo.",
      },
      { status: 409 }
    );
  }

  try {
    const created = await createUseCase(
      buildUseCaseDataFromExternalContribution({
        payload,
        workspaceId: auth.workspace.id,
        esgEnabled: auth.workspace.esgEnabled === true,
      })
    );

    let useCase = created;
    try {
      useCase = await autoScorePortfolioUseCase({
        workspaceId: auth.workspace.id,
        useCaseId: created.id,
        reviewedBy: null,
        noteLabel: "Auto-ranking AI",
      });
    } catch (error) {
      console.error("[api/mcp/portfolio] autoScore failed:", error);
    }

    await completeExternalContributionSubmission({
      submissionId: claim.submission.id,
      useCaseId: useCase.id,
    });

    await dispatchNewPortfolioNotifications({
      useCase,
      workspaceId: auth.workspace.id,
      source: "claude",
    });

    return Response.json(
      buildExternalContributionResponse({
        useCase,
        workspaceId: auth.workspace.id,
        duplicate: false,
      }),
      { status: 201 }
    );
  } catch (error) {
    console.error("[api/mcp/portfolio] submit failed:", error);
    await failExternalContributionSubmission({
      submissionId: claim.submission.id,
      errorCode: "submit_failed",
    });
    return Response.json(
      {
        ok: false,
        error: "submit_failed",
        message:
          "Unbundle non è riuscito a salvare il contributo. Riprova tra poco.",
      },
      { status: 500 }
    );
  }
}
