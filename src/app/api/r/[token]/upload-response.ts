import "server-only";
import type { UploadResult } from "@/lib/db/queries/uc-files";
import { uploadStatusFor } from "@/lib/uc/files/multipart";
import { invalidLinkResponse, publicData, publicError, publicStatusFor } from "@/lib/uc/http";
import type { Result } from "@/lib/uc/types";

/**
 * Esito di un caricamento dal link → risposta uniforme delle API pubbliche.
 * Un file rifiutato (dati sanitari, dati personali…) è un esito con il suo
 * messaggio, non un errore: risponde 200 con `status: "rifiutato"`.
 * (Ondata 0) L'informativa letta in una versione vecchia ha lo stato delle
 * altre scritture del link (`PUBLIC_ERRORS`, 503).
 */
export function uploadResponse(result: Result<UploadResult | object>): Response {
  if (result.ok) return publicData(result.value);
  if (result.code === "link_non_valido") return invalidLinkResponse();
  const status = result.code === "informativa_aggiornata" ? publicStatusFor(result.code) : uploadStatusFor(result.code);
  return publicError(result.code, { message: result.message, status });
}
