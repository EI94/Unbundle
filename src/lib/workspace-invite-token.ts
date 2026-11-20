import { createHash, randomBytes } from "node:crypto";
import { isCaseOnly } from "./auth/case-only.ts";
import { isLearnerOnly } from "./learning/learner-scope.ts";
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
  | "email_unverified"
  /** (8.0d) Un invito «Solo questo use case» a chi segue un corso nel workspace: serve un invito da collaboratore. */
  | "learner_case_only"
  /** (8.0d) Un invito «Solo questo use case» senza un'email riservata: non vale (lo crea solo Lateral Space, con l'email). */
  | "case_only_email";

/**
 * - `claim` con `caseOnly`: un invito «Solo questo use case» (8.0d): la membership `esterno_caso` (o quella che c'è già,
 *   se la persona è già «Solo questo use case» in un altro caso) e la concessione per il caso dell'invito, insieme.
 * - `claim` con `upgradesCaseOnly`: chi è «Solo questo use case» accetta un invito da collaboratore e sale; la
 *   concessione resta e vale con le regole della 8.0c.
 */
export type InviteAcceptanceDecision =
  | { kind: "already_member"; role: string; source: "organization" | "workspace" }
  | { kind: "reject"; reason: InviteRejection }
  | { kind: "claim"; upgradesLearner: boolean; upgradesCaseOnly?: true; caseOnly?: true };

/**
 * Chi è già dentro e resta com'è: un ruolo nell'organizzazione, o nel workspace un ruolo che non sia `learner` né
 * «Solo questo use case» (un collaboratore, o un ruolo che il codice non conosce: l'invito non lo cambia). Per lui
 * l'invito non cambia il ruolo e non si consuma. La usano la decisione e la pagina dell'invito.
 */
export function keepsCurrentRole(params: { orgRole: string | null; workspaceRole: string | null }): boolean {
  if (params.orgRole) return true;
  const role = params.workspaceRole;
  return Boolean(role) && !isLearnerOnly(role) && !isCaseOnly(role);
}

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
 * - (8.0d) Un invito «Solo questo use case» (ruolo `esterno_caso`): mai a un membro
 *   dell'organizzazione né a un collaboratore (resta il suo ruolo, il link non si
 *   consuma), mai a chi segue un corso nel workspace (`learner_case_only`), solo
 *   con l'email riservata e verificata. Chi è già «Solo questo use case» in un
 *   altro caso lo accetta e riceve anche questo caso.
 * - (8.0d) Chi è «Solo questo use case» e accetta un invito da collaboratore sale:
 *   la concessione resta e vale con le regole della 8.0c.
 */
export function decideInviteAcceptance(params: {
  invitation: Pick<WorkspaceInvitation, "email" | "expiresAt" | "maxUses" | "revokedAt" | "usedCount"> & { role?: string | null };
  user: { email: string | null; emailVerified: boolean };
  orgRole: string | null;
  workspaceRole: string | null;
  now?: Date;
}): InviteAcceptanceDecision {
  if (params.orgRole) return { kind: "already_member", role: params.orgRole, source: "organization" };
  if (params.workspaceRole && keepsCurrentRole({ orgRole: null, workspaceRole: params.workspaceRole })) {
    return { kind: "already_member", role: params.workspaceRole, source: "workspace" };
  }
  const caseOnlyInvite = isCaseOnly(params.invitation.role);
  if (caseOnlyInvite && isLearnerOnly(params.workspaceRole)) return { kind: "reject", reason: "learner_case_only" };
  const lifecycle = getWorkspaceInvitationLifecycle(params.invitation, params.now);
  if (lifecycle !== "active") return { kind: "reject", reason: lifecycle };
  const invited = normalizeInviteEmail(params.invitation.email);
  if (caseOnlyInvite && !invited) return { kind: "reject", reason: "case_only_email" };
  if (invited) {
    if (invited !== normalizeInviteEmail(params.user.email)) return { kind: "reject", reason: "email_mismatch" };
    if (!params.user.emailVerified) return { kind: "reject", reason: "email_unverified" };
  }
  if (caseOnlyInvite) return { kind: "claim", upgradesLearner: false, caseOnly: true };
  if (isCaseOnly(params.workspaceRole)) return { kind: "claim", upgradesLearner: false, upgradesCaseOnly: true };
  return { kind: "claim", upgradesLearner: isLearnerOnly(params.workspaceRole) };
}

/** n***@azienda.it: l'indirizzo riservato non va mostrato per intero a chi non ha ancora fatto l'accesso. */
export function maskInviteEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}
