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

export function normalizeInviteEmail(email: string | null | undefined) {
  const trimmed = email?.trim().toLowerCase() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export type InviteRejection =
  | "revoked"
  | "expired"
  | "used"
  | "email_mismatch"
  | "email_unverified";

export type InviteAcceptanceDecision =
  | { kind: "already_member"; role: string; source: "organization" | "workspace" }
  | { kind: "reject"; reason: InviteRejection }
  | { kind: "claim"; upgradesLearner: boolean };

/**
 * Cosa succede quando una persona accetta un invito. Pura, coperta da test;
 * la scrittura atomica sta in acceptWorkspaceInvitation.
 *
 * - Chi è già nell'organizzazione o nel workspace con un ruolo da
 *   collaboratore entra e basta: l'invito non cambia il suo ruolo (non lo
 *   abbassa né lo alza) e non viene consumato.
 * - Un partecipante a un corso che accetta un invito da collaboratore diventa
 *   collaboratore: l'invito è un permesso dato esplicitamente da chi gestisce
 *   il workspace. Resta iscritto ai suoi corsi.
 * - Un invito riservato a un'email vale solo per chi ha dimostrato di
 *   controllare quella casella (Google, o email verificata).
 */
export function decideInviteAcceptance(params: {
  invitation: Pick<WorkspaceInvitation, "email" | "expiresAt" | "maxUses" | "revokedAt" | "usedCount">;
  user: { email: string | null; emailVerified: boolean };
  orgRole: string | null;
  workspaceRole: string | null;
  now?: Date;
}): InviteAcceptanceDecision {
  if (params.orgRole) return { kind: "already_member", role: params.orgRole, source: "organization" };
  if (params.workspaceRole && params.workspaceRole !== "learner") {
    return { kind: "already_member", role: params.workspaceRole, source: "workspace" };
  }
  const lifecycle = getWorkspaceInvitationLifecycle(params.invitation, params.now);
  if (lifecycle !== "active") return { kind: "reject", reason: lifecycle };
  const invited = normalizeInviteEmail(params.invitation.email);
  if (invited) {
    if (invited !== normalizeInviteEmail(params.user.email)) return { kind: "reject", reason: "email_mismatch" };
    if (!params.user.emailVerified) return { kind: "reject", reason: "email_unverified" };
  }
  return { kind: "claim", upgradesLearner: params.workspaceRole === "learner" };
}

/** n***@azienda.it: l'indirizzo riservato non va mostrato per intero a chi non ha ancora fatto l'accesso. */
export function maskInviteEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}
