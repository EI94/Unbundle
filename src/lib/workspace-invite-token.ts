import { createHash, randomBytes } from "node:crypto";
import type { WorkspaceInvitation } from "./db/schema.ts";
export {
  WORKSPACE_INVITE_EXPIRES_IN_DAYS,
  WORKSPACE_INVITE_MAX_USES,
} from "./workspace-invite-config.ts";

export function createInviteToken() {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isInvitationActive(
  invitation: WorkspaceInvitation,
  now = new Date()
) {
  return (
    invitation.revokedAt == null &&
    invitation.expiresAt > now &&
    invitation.usedCount < invitation.maxUses
  );
}

export type WorkspaceInvitationLifecycle =
  | "active"
  | "expired"
  | "used"
  | "revoked";

export function getWorkspaceInvitationLifecycle(
  invitation: Pick<
    WorkspaceInvitation,
    "expiresAt" | "maxUses" | "revokedAt" | "usedCount"
  >,
  now = new Date()
): WorkspaceInvitationLifecycle {
  if (invitation.revokedAt != null) return "revoked";
  if (invitation.expiresAt <= now) return "expired";
  if (invitation.usedCount >= invitation.maxUses) return "used";
  return "active";
}
