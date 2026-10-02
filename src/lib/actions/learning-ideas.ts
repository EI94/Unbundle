"use server";

import { z } from "zod";
import { saveMyLearningIdea, submitMyLearningIdea, type IdeaDTO } from "@/lib/learning/ideas";
import { LearningError } from "@/lib/learning/server";
import { ideaSaveRequestSchema, ideaSubmitRequestSchema, ideaValidationErrors } from "@/lib/learning/idea-contract";

type Result = { ok: true; data: IdeaDTO } | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };
function failure(error: unknown): Result {
  if (error instanceof LearningError) return { ok: false, code: error.code, message: error.message };
  if (error instanceof z.ZodError) return { ok: false, code: "invalid", message: "Completa o correggi i campi indicati. La proposta resta in bozza.", fieldErrors: ideaValidationErrors(error) };
  if (error instanceof Error && error.message === "conflict") return { ok: false, code: "conflict", message: "La bozza è cambiata o l’invio è già iniziato. Conserva il testo e riapri la versione sul server." };
  return { ok: false, code: "technical", message: "Operazione non confermata. Il testo resta qui. Riprova: un invio già avviato non creerà duplicati." };
}
export async function saveLearningIdea(input: unknown): Promise<Result> {
  try {
    const value = ideaSaveRequestSchema.parse(input);
    return { ok: true, data: await saveMyLearningIdea(value) };
  } catch (error) { return failure(error); }
}
export async function submitLearningIdea(input: unknown): Promise<Result> {
  try {
    const value = ideaSubmitRequestSchema.parse(input);
    return { ok: true, data: await submitMyLearningIdea(value) };
  } catch (error) { return failure(error); }
}
