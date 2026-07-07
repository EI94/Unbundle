"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/redirect-to-login";
import {
  createWorkspaceIntegrationToken,
  revokeWorkspaceIntegrationToken,
} from "@/lib/db/queries/workspace-integrations";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { canManageWorkspaceSettings } from "@/lib/workspace-permissions";

const CLAUDE_MCP_TOKEN_EXPIRES_IN_DAYS = 180;

export type WorkspaceIntegrationActionState<Data = unknown> = {
  ok: boolean;
  message?: string | null;
  fieldErrors?: Record<string, string>;
  data?: Data;
};

export type CreateClaudeMcpTokenData = {
  tokenId: string;
  token: string;
  tokenPrefix: string;
  label: string;
  apiUrl: string;
  expiresAt: string;
  createdAt: string;
};

export type RevokeClaudeMcpTokenData = {
  tokenId: string;
  revokedAt: string;
};

const createTokenSchema = z.object({
  label: z
    .string()
    .trim()
    .min(2, "Dai un nome al token.")
    .max(80, "Nome troppo lungo."),
});

function normalizeBaseUrl(raw: string | undefined | null) {
  const value = raw?.trim();
  if (!value) return null;
  return value.startsWith("http://") || value.startsWith("https://")
    ? value.replace(/\/+$/, "")
    : `https://${value.replace(/\/+$/, "")}`;
}

async function getBaseUrl() {
  const configured =
    normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeBaseUrl(process.env.APP_URL) ??
    normalizeBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalizeBaseUrl(process.env.VERCEL_URL);
  if (configured) return configured;

  const headerStore = await headers();
  const host = headerStore.get("host") ?? "localhost:3000";
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

function errorState(message: string, fieldErrors: Record<string, string> = {}) {
  return { ok: false, message, fieldErrors };
}

async function assertWorkspaceIntegrationManager(workspaceId: string) {
  const session = await requireSession();

  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access) {
    return {
      ok: false as const,
      state: errorState("Workspace non trovato o non accessibile."),
    };
  }
  if (!canManageWorkspaceSettings(access.role)) {
    return {
      ok: false as const,
      state: errorState("Non hai i permessi per gestire le integrazioni."),
    };
  }

  return { ok: true as const, session, access };
}

export async function createClaudeMcpTokenAction(
  workspaceId: string,
  _prev: WorkspaceIntegrationActionState<CreateClaudeMcpTokenData>,
  formData: FormData
): Promise<WorkspaceIntegrationActionState<CreateClaudeMcpTokenData>> {
  const manager = await assertWorkspaceIntegrationManager(workspaceId);
  if (!manager.ok) return manager.state;

  const parsed = createTokenSchema.safeParse({
    label: String(formData.get("label") ?? "Claude team"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return errorState("Controlla i campi evidenziati.", fieldErrors);
  }

  const expiresAt = new Date(
    Date.now() + CLAUDE_MCP_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000
  );
  const { token, row } = await createWorkspaceIntegrationToken({
    workspaceId,
    label: parsed.data.label,
    createdByUserId: manager.session.user.id,
    expiresAt,
  });
  const apiUrl = await getBaseUrl();

  revalidatePath(`/dashboard/${workspaceId}/settings`);
  return {
    ok: true,
    message:
      "Setup Claude creato. Copia ora il kit: per sicurezza la chiave non sarà più mostrata in chiaro.",
    fieldErrors: {},
    data: {
      tokenId: row.id,
      token,
      tokenPrefix: row.tokenPrefix,
      label: row.label,
      apiUrl,
      expiresAt: expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    },
  };
}

export async function revokeClaudeMcpTokenAction(
  workspaceId: string,
  _prev: WorkspaceIntegrationActionState<RevokeClaudeMcpTokenData>,
  formData: FormData
): Promise<WorkspaceIntegrationActionState<RevokeClaudeMcpTokenData>> {
  const tokenId = String(formData.get("tokenId") ?? "");
  if (!tokenId) return errorState("Token non valido.");

  const manager = await assertWorkspaceIntegrationManager(workspaceId);
  if (!manager.ok) return manager.state;

  const revoked = await revokeWorkspaceIntegrationToken({ workspaceId, tokenId });
  if (!revoked) return errorState("Token non trovato.");

  revalidatePath(`/dashboard/${workspaceId}/settings`);
  return {
    ok: true,
    message: "Setup revocato. Claude non potrà più usarlo.",
    fieldErrors: {},
    data: {
      tokenId,
      revokedAt: (revoked.revokedAt ?? new Date()).toISOString(),
    },
  };
}
