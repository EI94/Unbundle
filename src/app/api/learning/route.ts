import type { NextRequest } from "next/server";
import {
  startLearningAttempt, saveLearningDraft, submitLearningAttempt, submitLearningDecisions,
  startLearningRetake, exportLearningCsv,
} from "@/lib/actions/learning";
import { saveLearningIdea, submitLearningIdea } from "@/lib/actions/learning-ideas";
import { LearningHttpError, learningRequestOrigin, readLearningRequest } from "@/lib/learning/http";

export const runtime = "nodejs";
const operations = {
  startLearningAttempt, saveLearningDraft, submitLearningAttempt, submitLearningDecisions,
  startLearningRetake, exportLearningCsv, saveLearningIdea, submitLearningIdea,
};
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const failureStatus: Record<string, number> = { unauthenticated: 401, forbidden: 403, invalid: 422, conflict: 409, closed: 409, unavailable: 503, technical: 503 };

/** Deliberately independent of dashboard rendering: a failed save never redirects the page. */
export async function POST(request: NextRequest) {
  try {
    const { operation, input } = await readLearningRequest(request, learningRequestOrigin(request, request.nextUrl.protocol));
    // Existing wrappers validate exact inputs, authenticate and check all DAL scopes.
    const result = await operations[operation](input);
    return Response.json(result, { status: result.ok ? 200 : failureStatus[result.code] ?? 503, headers });
  } catch (error) {
    if (error instanceof LearningHttpError) return Response.json({ ok: false, code: error.status === 403 ? "forbidden" : "invalid", message: error.message }, { status: error.status, headers });
    // Do not serialize thrown errors, database details, answers or content.
    return Response.json({ ok: false, code: "technical", message: "Operazione non confermata. Conserva questa pagina e riprova: le modifiche non confermate non sono salvate." }, { status: 503, headers });
  }
}
