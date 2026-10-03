import { z } from "zod";
import { LearningHttpError } from "./http.ts";

const scope = z.object({ workspaceId: z.uuid(), expectedUserId: z.uuid() }).strict();

/** A small, read-only session probe; no names, tokens or course data returned. */
export async function readLearningSessionCheck(request: Request, expectedOrigin: string) {
  if (request.headers.get("origin") !== expectedOrigin) throw new LearningHttpError(403, "Origine non autorizzata.");
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new LearningHttpError(415, "Formato non valido.");
  if (!request.body) throw new LearningHttpError(400, "Richiesta vuota.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, body = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1024) { await reader.cancel(); throw new LearningHttpError(413, "Richiesta troppo grande."); }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof LearningHttpError) throw error;
    throw new LearningHttpError(400, "Richiesta non valida.");
  } finally { reader.releaseLock(); }
  try { return scope.parse(JSON.parse(body)); }
  catch { throw new LearningHttpError(400, "Richiesta non valida."); }
}
