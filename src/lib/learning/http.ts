import { z } from "zod";

export const LEARNING_REQUEST_MAX_BYTES = 64 * 1024;
export const learningOperations = [
  "startLearningAttempt", "saveLearningDraft", "submitLearningAttempt", "submitLearningDecisions",
  "startLearningRetake", "exportLearningCsv", "saveLearningIdea", "submitLearningIdea",
] as const;
export type LearningOperation = typeof learningOperations[number];
const envelope = z.object({
  operation: z.enum(learningOperations),
  input: z.record(z.string(), z.unknown()),
}).strict();
export class LearningHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Next may normalize nextUrl's hostname internally; Host is the actual browser authority.
 * Do not trust forwarded-host headers supplied by a caller. Protocol comes from Next. */
export function learningRequestOrigin(request: Request, protocol: string): string {
  const host = request.headers.get("host");
  if (!["http:", "https:"].includes(protocol) || !host || /[\s/@?#\\,]/u.test(host)) throw new LearningHttpError(403, "Origine della richiesta non autorizzata.");
  try { return new URL(`${protocol}//${host}`).origin; }
  catch { throw new LearningHttpError(403, "Origine della richiesta non autorizzata."); }
}

/** Pure request boundary: no auth, DB, content or request body is logged here. */
export async function readLearningRequest(request: Request, expectedOrigin: string) {
  if (request.headers.get("origin") !== expectedOrigin) throw new LearningHttpError(403, "Origine della richiesta non autorizzata.");
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new LearningHttpError(415, "La richiesta deve contenere JSON.");
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > LEARNING_REQUEST_MAX_BYTES)) throw new LearningHttpError(413, "La richiesta supera il limite consentito.");
  if (!request.body) throw new LearningHttpError(400, "Richiesta vuota.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > LEARNING_REQUEST_MAX_BYTES) {
        await reader.cancel();
        throw new LearningHttpError(413, "La richiesta supera il limite consentito.");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof LearningHttpError) throw error;
    throw new LearningHttpError(400, "Corpo della richiesta non valido.");
  } finally { reader.releaseLock(); }
  try { return envelope.parse(JSON.parse(body)); }
  catch { throw new LearningHttpError(400, "Operazione o dati della richiesta non validi."); }
}
