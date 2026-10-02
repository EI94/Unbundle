import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
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
    if (!await getWorkspaceAccessForUser(session.user.id, input.workspaceId)) return reply(403, "forbidden");
    return reply(200, "verified");
  } catch (error) {
    return reply(error instanceof LearningHttpError ? error.status : 503, "unavailable");
  }
}
