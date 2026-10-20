import "server-only";
import type { UploadResult } from "@/lib/db/queries/uc-files";
import { uploadStatusFor } from "@/lib/uc/files/multipart";
import { invalidLinkResponse, publicData, publicError } from "@/lib/uc/http";
import type { Result } from "@/lib/uc/types";

/**
 * Esito di un caricamento dal link → risposta uniforme delle API pubbliche.
 * Un file rifiutato (dati sanitari, dati personali…) è un esito con il suo
 * messaggio, non un errore: risponde 200 con `status: "rifiutato"`.
 */
export function uploadResponse(result: Result<UploadResult | object>): Response {
  if (result.ok) return publicData(result.value);
  if (result.code === "link_non_valido") return invalidLinkResponse();
  return publicError(result.code, { message: result.message, status: uploadStatusFor(result.code) });
}
