import { authenticateWorkspaceIntegrationToken, PORTFOLIO_SUBMIT_SCOPE } from "@/lib/db/queries/workspace-integrations";
import { getOrCreateWorkspaceScoringModel } from "@/lib/db/queries/scoring-model";
import { buildWorkspaceIntakeRequirements } from "@/lib/portfolio/external-submission";

export const runtime = "nodejs";

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export async function GET(request: Request) {
  const auth = await authenticateWorkspaceIntegrationToken(bearerToken(request));
  if (!auth) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!auth.token.scopes?.includes(PORTFOLIO_SUBMIT_SCOPE)) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const model = await getOrCreateWorkspaceScoringModel(auth.workspace.id);
  return Response.json(
    buildWorkspaceIntakeRequirements({
      workspace: auth.workspace,
      config: model.resolvedConfig,
    })
  );
}
