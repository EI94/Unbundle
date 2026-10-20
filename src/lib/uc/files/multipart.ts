/**
 * Corpo dei caricamenti in modalità server (PIANO §6.2): `multipart/form-data`
 * con il campo `file` e i campi di testo (`itemId`, `declaration`). Il corpo si
 * legge a blocchi fermandosi oltre il limite (un `content-length` falso non
 * basta a superarlo), poi si interpreta con le API web standard.
 *
 * Il nome del file arriva dal client: si ripulisce dopo (`safeFileName`), non
 * entra mai in un percorso.
 *
 * Modulo puro (solo API web).
 */
import { fail, ok, type Result } from "../types.ts";
import { UC_UPLOAD_LIMITS } from "./sniff.ts";

/** Margine per l'involucro multipart (confini, intestazioni, campi di testo). */
export const UPLOAD_FORM_OVERHEAD = 64 * 1024;

export interface UploadForm {
  file: { name: string; bytes: Uint8Array };
  fields: Record<string, string>;
}

export const FORM_MESSAGES = {
  formato_non_ammesso: "Il caricamento deve arrivare come modulo con il file.",
  file_troppo_grande_server: "Il file supera il limite di 4 MB. Dividilo, oppure salvalo come CSV o XLSX.",
  file_mancante: "Scegli un file da caricare.",
  corpo_non_valido: "Il file non è arrivato per intero. Riprova.",
} as const;

async function readBounded(request: Request, maxBytes: number): Promise<Result<Uint8Array<ArrayBuffer>>> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) return fail("file_troppo_grande_server", FORM_MESSAGES.file_troppo_grande_server);
  if (!request.body) return fail("file_mancante", FORM_MESSAGES.file_mancante);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return fail("file_troppo_grande_server", FORM_MESSAGES.file_troppo_grande_server);
      }
      chunks.push(value);
    }
  } catch {
    return fail("corpo_non_valido", FORM_MESSAGES.corpo_non_valido);
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return ok(out);
}

/** Legge il modulo del caricamento: un solo file, al massimo `maxFileBytes` (4 MB di default). */
export async function readUploadForm(request: Request, maxFileBytes: number = UC_UPLOAD_LIMITS.serverMaxBytes): Promise<Result<UploadForm>> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(type)) return fail("formato_non_ammesso", FORM_MESSAGES.formato_non_ammesso);
  const body = await readBounded(request, maxFileBytes + UPLOAD_FORM_OVERHEAD);
  if (!body.ok) return body;
  let form: FormData;
  try {
    form = await new Response(body.value, { headers: { "content-type": type } }).formData();
  } catch {
    return fail("corpo_non_valido", FORM_MESSAGES.corpo_non_valido);
  }
  const files = form.getAll("file").filter((v): v is File => typeof v === "object" && v !== null && typeof (v as Blob).arrayBuffer === "function");
  if (files.length !== 1) return fail("file_mancante", FORM_MESSAGES.file_mancante);
  const file = files[0];
  if (file.size > maxFileBytes) return fail("file_troppo_grande_server", FORM_MESSAGES.file_troppo_grande_server);
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (key === "file" || typeof value !== "string") continue;
    if (key.length <= 40 && value.length <= 1000) fields[key] = value;
  }
  return ok({ file: { name: typeof file.name === "string" ? file.name : "", bytes: new Uint8Array(await file.arrayBuffer()) }, fields });
}

/** Stato HTTP degli esiti di caricamento che non sono un rifiuto del file. */
export function uploadStatusFor(code: string): number {
  switch (code) {
    case "file_troppo_grande":
    case "file_troppo_grande_server":
      return 413;
    case "formato_non_ammesso":
    case "estensione_non_ammessa":
      return 415;
    case "file_mancante":
    case "nome_mancante":
    case "file_vuoto":
    case "dichiarazione_mancante":
    case "corpo_non_valido":
    case "dati_non_validi":
      return 422;
    case "attore_non_ammesso":
    case "zona_personale_negata":
      return 403;
    case "voce_non_trovata":
    case "voce_non_disponibile":
    case "caricamento_non_trovato":
    case "file_non_trovato":
      return 404;
    case "archivio_non_configurato":
    case "modalita_non_disponibile":
      return 503;
    default:
      return 409;
  }
}
