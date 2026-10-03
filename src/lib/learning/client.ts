"use client";
import type * as AttemptActions from "@/lib/actions/learning";
import type * as IdeaActions from "@/lib/actions/learning-ideas";

type Actions = typeof AttemptActions & typeof IdeaActions;
type Result<K extends keyof Actions> = Awaited<ReturnType<Actions[K]>>;
async function invoke<K extends keyof Actions>(operation: K, input: unknown): Promise<Result<K>> {
  const response = await fetch("/api/learning", {
    method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ operation, input }),
  });
  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new Error("Risposta del server non valida. Le modifiche non sono confermate.");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("ok" in body)) throw new Error("Risposta del server non valida. Le modifiche non sono confermate.");
  if (body.ok === true && response.ok && "data" in body) return body as Result<K>;
  if (body.ok === false && "code" in body && typeof body.code === "string" && "message" in body && typeof body.message === "string") return body as Result<K>;
  throw new Error("Risposta del server non valida. Le modifiche non sono confermate.");
}
export async function startLearningAttempt(input: unknown): Promise<Result<"startLearningAttempt">> { return invoke("startLearningAttempt", input); }
export async function saveLearningDraft(input: unknown): Promise<Result<"saveLearningDraft">> { return invoke("saveLearningDraft", input); }
export async function submitLearningAttempt(input: unknown): Promise<Result<"submitLearningAttempt">> { return invoke("submitLearningAttempt", input); }
export async function submitLearningDecisions(input: unknown): Promise<Result<"submitLearningDecisions">> { return invoke("submitLearningDecisions", input); }
export async function startLearningRetake(input: unknown): Promise<Result<"startLearningRetake">> { return invoke("startLearningRetake", input); }
export async function exportLearningCsv(input: unknown): Promise<Result<"exportLearningCsv">> { return invoke("exportLearningCsv", input); }
export async function saveLearningIdea(input: unknown): Promise<Result<"saveLearningIdea">> { return invoke("saveLearningIdea", input); }
export async function submitLearningIdea(input: unknown): Promise<Result<"submitLearningIdea">> { return invoke("submitLearningIdea", input); }
