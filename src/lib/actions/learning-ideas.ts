"use server";

import { z } from "zod";
import { saveMyLearningIdea, submitMyLearningIdea, type IdeaDTO } from "@/lib/learning/ideas";
import { LearningError } from "@/lib/learning/server";

type Result = { ok: true; data: IdeaDTO } | { ok: false; code: string; message: string };
const scope = { workspaceId: z.uuid(), programId: z.uuid() };
function failure(error: unknown): Result {
  if (error instanceof LearningError) return { ok: false, code: error.code, message: error.message };
  if (error instanceof z.ZodError) return { ok: false, code: "invalid", message: "Controlla i campi della proposta." };
  if (error instanceof Error && error.message === "conflict") return { ok: false, code: "conflict", message: "La bozza è cambiata o l’invio è già iniziato. Conserva il testo e riapri la versione sul server." };
  return { ok: false, code: "technical", message: "Operazione non confermata. Il testo resta qui. Riprova: un invio già avviato non creerà duplicati." };
}
export async function saveLearningIdea(input: unknown): Promise<Result> {
  try {
    const value = z.object({ ...scope, expectedRevision: z.number().int().positive().nullable(), fields: z.unknown() }).strict().parse(input);
    return { ok: true, data: await saveMyLearningIdea(value.workspaceId, value.programId, value.expectedRevision, value.fields) };
  } catch (error) { return failure(error); }
}
export async function submitLearningIdea(input: unknown): Promise<Result> {
  try {
    const value = z.object({ ...scope, draftId: z.uuid(), expectedRevision: z.number().int().positive(), idempotencyKey: z.uuid() }).strict().parse(input);
    return { ok: true, data: await submitMyLearningIdea(value.workspaceId, value.programId, value.draftId, value.expectedRevision, value.idempotencyKey) };
  } catch (error) { return failure(error); }
}
