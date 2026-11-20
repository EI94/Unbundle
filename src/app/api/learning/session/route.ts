import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { workspaceDoor } from "@/lib/auth/case-only";
import { learningEnabled } from "@/lib/learning/server";
import { LearningHttpError, learningRequestOrigin } from "@/lib/learning/http";
import { readLearningSessionCheck } from "@/lib/learning/session-check";

export async function POST(request: NextRequest) {
  const reply = (status: number, code: string) => NextResponse.json({ code }, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Origin" } });
  try {
    const input = await readLearningSessionCheck(request, learningRequestOrigin(request, request.nextUrl.protocol));
    if (!learningEnabled()) return reply(403, "unavailable");
    const session = await auth();
    if (!session) return reply(401, "unauthenticated");
    if (session.user.id.toLowerCase() !== input.expectedUserId.toLowerCase()) return reply(403, "session_changed");
    // (8.0d-1) Per elenco: i collaboratori e chi segue un corso; mai «Solo questo use case» né un ruolo sconosciuto.
    const access = await getWorkspaceAccessForUser(session.user.id, input.workspaceId);
    if (!access || workspaceDoor(access.role, { allowLearner: true }) !== "aperta") return reply(403, "forbidden");
    return reply(200, "verified");
  } catch (error) {
    return reply(error instanceof LearningHttpError ? error.status : 503, "unavailable");
  }
}
