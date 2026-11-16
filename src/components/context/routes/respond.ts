import "server-only";
/**
 * Le risposte delle rotte di «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.5), in un posto solo:
 * mai in cache (`Cache-Control: no-store`), e gli errori sempre con la stessa forma, `{ error, message, fieldErrors? }`.
 *
 * - Chi chiama: senza sessione 401; senza accesso, o senza il permesso, 404 (non si dice che la risorsa c'è).
 * - L'archivio non è pronto (la 0038 non c'è ancora): 503.
 * - Gli esiti delle funzioni condivise (`ServiceResult`): dati non validi 422, versione superata 409, «riprova» 503.
 * I messaggi vengono da `CONTEXT_TEXT`: mai un codice interno a schermo.
 */
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { ServiceError } from "@/lib/use-cases/types";

export const NO_STORE: Readonly<Record<string, string>> = Object.freeze({ "Cache-Control": "no-store" });

export interface ErrorBody {
  error: string;
  message: string;
  fieldErrors?: Record<string, string>;
}

/** Una risposta JSON, mai in cache. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** Un errore, con la forma di sempre. */
export function failJson(status: number, error: string, message: string, fieldErrors?: Record<string, string>, headers: Record<string, string> = {}): Response {
  const body: ErrorBody = fieldErrors && Object.keys(fieldErrors).length > 0 ? { error, message, fieldErrors } : { error, message };
  return json(body, status, headers);
}

/** Chi chiama non c'è (401) o non può vedere la risorsa (404). */
export function actorFailure(status: 401 | 404): Response {
  return status === 401 ? failJson(401, "non_autenticato", CONTEXT_TEXT.errors.denied) : failJson(404, "non_trovato", CONTEXT_TEXT.errors.notFound);
}

/** Non trovato: anche quando la risorsa c'è ma chi chiama non la può vedere. */
export function notFoundJson(): Response {
  return failJson(404, "non_trovato", CONTEXT_TEXT.errors.notFound);
}

/** La 0038 non è ancora applicata: il contesto si sta preparando. */
export function notReadyJson(): Response {
  return failJson(503, "area_spenta", CONTEXT_TEXT.errors.notReady);
}

/** Il corpo non è JSON, o non è un oggetto. */
export function badBodyJson(): Response {
  return failJson(422, "dati_non_validi", CONTEXT_TEXT.errors.invalid);
}

const STATUS_OF: Readonly<Record<ServiceError, number>> = Object.freeze({
  // Il permesso mancante risponde come una risorsa che non c'è.
  permesso_mancante: 404,
  non_trovato: 404,
  versione_superata: 409,
  transizione_non_ammessa: 409,
  dati_non_validi: 422,
  area_spenta: 503,
  riprova: 503,
});

/** L'esito non riuscito di una funzione condivisa, come risposta. Il permesso mancante non dice che la risorsa c'è. */
export function serviceFailure(result: { error: ServiceError; message: string; fieldErrors?: Record<string, string> }): Response {
  if (result.error === "permesso_mancante") return notFoundJson();
  return failJson(STATUS_OF[result.error] ?? 503, result.error, result.message, result.fieldErrors);
}

/** Il corpo JSON di una richiesta, solo se è un oggetto; altrimenti null. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Un campo di testo del corpo: la stringa, o null se manca o non è una stringa. */
export function textField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" ? value : null;
}
