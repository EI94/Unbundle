import { randomBytes, createHash } from "node:crypto";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "..";
import { ensureDbSchema } from "../ensure-schema";
import {
  externalContributionSubmissions,
  workspaceIntegrationTokens,
  workspaces,
  type ExternalContributionSubmission,
  type Workspace,
  type WorkspaceIntegrationToken,
} from "../schema";

export const CLAUDE_MCP_PROVIDER = "claude_mcp" as const;
export const PORTFOLIO_SUBMIT_SCOPE = "portfolio:submit" as const;

export type WorkspaceIntegrationTokenListItem = Pick<
  WorkspaceIntegrationToken,
  | "id"
  | "workspaceId"
  | "label"
  | "provider"
  | "tokenPrefix"
  | "scopes"
  | "lastUsedAt"
  | "expiresAt"
  | "revokedAt"
  | "createdAt"
>;

export type AuthenticatedWorkspaceIntegrationToken = {
  token: WorkspaceIntegrationToken;
  workspace: Workspace;
};

function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function createIntegrationTokenSecret() {
  return `ub_mcp_${randomBytes(32).toString("base64url")}`;
}

function tokenPrefix(token: string) {
  return `${token.slice(0, 14)}...`;
}

export async function createWorkspaceIntegrationToken(params: {
  workspaceId: string;
  label: string;
  createdByUserId: string;
  provider?: typeof CLAUDE_MCP_PROVIDER;
  scopes?: string[];
  expiresAt?: Date | null;
}) {
  await ensureDbSchema();
  const token = createIntegrationTokenSecret();
  const [row] = await db
    .insert(workspaceIntegrationTokens)
    .values({
      workspaceId: params.workspaceId,
      label: params.label.trim() || "Claude MCP",
      provider: params.provider ?? CLAUDE_MCP_PROVIDER,
      tokenHash: hashToken(token),
      tokenPrefix: tokenPrefix(token),
      scopes: params.scopes ?? [PORTFOLIO_SUBMIT_SCOPE],
      createdByUserId: params.createdByUserId,
      expiresAt: params.expiresAt ?? null,
    })
    .returning();

  return { token, row };
}

export async function getWorkspaceIntegrationTokens(workspaceId: string) {
  await ensureDbSchema();
  return db
    .select({
      id: workspaceIntegrationTokens.id,
      workspaceId: workspaceIntegrationTokens.workspaceId,
      label: workspaceIntegrationTokens.label,
      provider: workspaceIntegrationTokens.provider,
      tokenPrefix: workspaceIntegrationTokens.tokenPrefix,
      scopes: workspaceIntegrationTokens.scopes,
      lastUsedAt: workspaceIntegrationTokens.lastUsedAt,
      expiresAt: workspaceIntegrationTokens.expiresAt,
      revokedAt: workspaceIntegrationTokens.revokedAt,
      createdAt: workspaceIntegrationTokens.createdAt,
    })
    .from(workspaceIntegrationTokens)
    .where(eq(workspaceIntegrationTokens.workspaceId, workspaceId))
    .orderBy(desc(workspaceIntegrationTokens.createdAt));
}

export async function revokeWorkspaceIntegrationToken(params: {
  workspaceId: string;
  tokenId: string;
}) {
  await ensureDbSchema();
  const [row] = await db
    .update(workspaceIntegrationTokens)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(workspaceIntegrationTokens.id, params.tokenId),
        eq(workspaceIntegrationTokens.workspaceId, params.workspaceId)
      )
    )
    .returning();
  return row ?? null;
}

export async function authenticateWorkspaceIntegrationToken(
  rawToken: string | null | undefined
): Promise<AuthenticatedWorkspaceIntegrationToken | null> {
  await ensureDbSchema();
  const token = rawToken?.trim();
  if (!token) return null;

  const now = new Date();
  const [row] = await db
    .select({
      token: workspaceIntegrationTokens,
      workspace: workspaces,
    })
    .from(workspaceIntegrationTokens)
    .innerJoin(workspaces, eq(workspaces.id, workspaceIntegrationTokens.workspaceId))
    .where(
      and(
        eq(workspaceIntegrationTokens.tokenHash, hashToken(token)),
        isNull(workspaceIntegrationTokens.revokedAt),
        or(isNull(workspaceIntegrationTokens.expiresAt), gt(workspaceIntegrationTokens.expiresAt, now))
      )
    )
    .limit(1);

  if (!row) return null;

  await db
    .update(workspaceIntegrationTokens)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(eq(workspaceIntegrationTokens.id, row.token.id));

  return row;
}

export async function claimExternalContributionSubmission(params: {
  workspaceId: string;
  integrationTokenId: string;
  idempotencyKey: string;
  requestHash: string;
}): Promise<
  | { status: "claimed"; submission: ExternalContributionSubmission }
  | { status: "duplicate"; submission: ExternalContributionSubmission }
  | { status: "conflict"; submission: ExternalContributionSubmission }
> {
  await ensureDbSchema();
  const [existing] = await db
    .select()
    .from(externalContributionSubmissions)
    .where(
      and(
        eq(externalContributionSubmissions.workspaceId, params.workspaceId),
        eq(externalContributionSubmissions.integrationTokenId, params.integrationTokenId),
        eq(externalContributionSubmissions.idempotencyKey, params.idempotencyKey)
      )
    )
    .limit(1);

  if (existing) {
    return existing.requestHash === params.requestHash
      ? { status: "duplicate", submission: existing }
      : { status: "conflict", submission: existing };
  }

  const [submission] = await db
    .insert(externalContributionSubmissions)
    .values({
      workspaceId: params.workspaceId,
      integrationTokenId: params.integrationTokenId,
      idempotencyKey: params.idempotencyKey,
      requestHash: params.requestHash,
      status: "pending",
    })
    .returning();

  return { status: "claimed", submission };
}

export async function completeExternalContributionSubmission(params: {
  submissionId: string;
  useCaseId: string;
}) {
  await ensureDbSchema();
  const [row] = await db
    .update(externalContributionSubmissions)
    .set({
      status: "completed",
      useCaseId: params.useCaseId,
      errorCode: null,
      updatedAt: new Date(),
    })
    .where(eq(externalContributionSubmissions.id, params.submissionId))
    .returning();
  return row ?? null;
}

export async function failExternalContributionSubmission(params: {
  submissionId: string;
  errorCode: string;
}) {
  await ensureDbSchema();
  const [row] = await db
    .update(externalContributionSubmissions)
    .set({
      status: "failed",
      errorCode: params.errorCode.slice(0, 100),
      updatedAt: new Date(),
    })
    .where(eq(externalContributionSubmissions.id, params.submissionId))
    .returning();
  return row ?? null;
}
