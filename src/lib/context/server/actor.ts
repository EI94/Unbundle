import "server-only";
/**
 * Chi chiama le funzioni di «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.3): la persona, il
 * suo ruolo nel workspace riletto adesso, e se è di Lateral Space (e-mail verificata in `UC_LS_EMAIL_DOMAINS`).
 *
 * - rotte e azioni: `contextActorFromSession` (mai un reindirizzamento: 401 senza sessione, 404 senza accesso);
 * - pagine: `contextActorFor`, dopo `requireWorkspacePage`;
 * - MCP del team: `contextActorFromPrincipal`;
 * - Granola e il giro della notte: `contextActorForUser`, che rilegge la persona collegata a ogni giro.
 * Che cosa può fare lo dice `contextAbilities` (src/lib/context/visibility.ts).
 */
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { users } from "@/lib/db/schema";
import { isEmailVerifiedValue, isLateralSpaceEmail } from "@/lib/uc/lateral-space";
import { isUuid } from "@/lib/uc/ids";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import type { ContextActor } from "@/lib/context/visibility";

export type { ContextActor } from "@/lib/context/visibility";

export type ActorResult = { ok: true; actor: ContextActor } | { ok: false; status: 401 | 404 };

/** Per le pagine, dopo `requireWorkspacePage`: dalla sessione e dall'accesso già letti. Canale «web». */
export function contextActorFor(
  user: { id: string; email: string | null; emailVerified: boolean },
  access: { role: string },
  workspaceId: string,
): ContextActor {
  return {
    workspaceId,
    userId: user.id,
    role: access.role,
    isLateralSpace: isLateralSpaceEmail({ email: user.email, emailVerified: user.emailVerified === true }, ucLsDomains()),
    channel: "web",
  };
}

/**
 * Per rotte e azioni. `auth()` (mai un reindirizzamento): senza sessione 401. Poi `getCollaboratorAccess` (esclude chi
 * segue solo un corso): senza accesso 404. Canale «web».
 */
export async function contextActorFromSession(workspaceId: string): Promise<ActorResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, status: 401 };
  if (!isUuid(workspaceId)) return { ok: false, status: 404 };
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) return { ok: false, status: 404 };
  return { ok: true, actor: contextActorFor(session.user, access, workspaceId) };
}

/** La persona del token dell'MCP del team, canale «claude»: sta nel modulo puro, così il MCP non carica `auth()`. */
export { contextActorFromPrincipal } from "@/lib/context/visibility";

/** Per Granola e per la notte: la persona collegata, riletta adesso (ruolo e Lateral Space). null se non ha più accesso. */
export async function contextActorForUser(userId: string, workspaceId: string, channel: "granola" | "cron"): Promise<ContextActor | null> {
  if (!isUuid(userId) || !isUuid(workspaceId)) return null;
  const [user] = await db.select({ id: users.id, email: users.email, emailVerified: users.emailVerified }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  const access = await getCollaboratorAccess(user.id, workspaceId);
  if (!access) return null;
  return {
    workspaceId,
    userId: user.id,
    role: access.role,
    isLateralSpace: isLateralSpaceEmail({ email: user.email, emailVerified: isEmailVerifiedValue(user.emailVerified) }, ucLsDomains()),
    channel,
  };
}
