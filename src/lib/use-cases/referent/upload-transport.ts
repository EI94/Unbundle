/**
 * Caricamento dei file di «Chiedi al referente» dal browser (SPEC §2.1), per la pagina pubblica
 * (`/api/rispondi/<token>/upload*`) e per il capitolo «Cosa serve» della scheda
 * (`/dashboard/<ws>/use-cases/<id>/allegati/upload*`). Sul modello di
 * `src/components/uc/documents/upload-transport.ts`:
 *
 * - fino a 4 MB: modalità server (multipart `file`, `needId`, `declaration`);
 * - oltre 4 MB, con il caricamento diretto attivo (`clientMode`): `upload-token` crea la riga in
 *   quarantena e un token per un solo percorso, il browser carica su Vercel Blob privato,
 *   `upload-complete` avvia i controlli;
 * - oltre 4 MB senza caricamento diretto (harness): `modalita_non_disponibile`, senza chiamate.
 *
 * Le chiamate del referente partono senza cookie e senza `Referer` (il link sta solo
 * nell'indirizzo della chiamata, mai salvato). Il revisore manda anche `validate` («L'ho già
 * verificata», Parte 2). Nessun `server-only`: si usa nei componenti client.
 */
import { formatNumberIt } from "../../uc/views/format.ts";
import { REFERENT_API, REFERENT_LIMITS, referentApiBase, reviewerFilesBase, type ReferentUploadResult } from "./contract.ts";
import { REFERENT_ERROR_MESSAGES } from "./labels.ts";

export type ReferentUploadDestination =
  | { kind: "referente"; token: string; needId: string }
  | { kind: "revisore"; workspaceId: string; useCaseId: string; needId: string };

export type ReferentUploadOutcome = { ok: true; file: ReferentUploadResult } | { ok: false; code: string; message: string };

const NETWORK = "Connessione assente o instabile: il file non è partito. Riprova.";
const GENERIC = "Caricamento non riuscito. Riprova tra poco.";
const TOO_BIG_SERVER = "Il file supera il limite di 4 MB. Dividilo, oppure salvalo come CSV o XLSX.";

function baseOf(dest: ReferentUploadDestination): string {
  return dest.kind === "referente"
    ? referentApiBase(dest.token)
    : reviewerFilesBase(encodeURIComponent(dest.workspaceId), encodeURIComponent(dest.useCaseId));
}

function fetchInit(dest: ReferentUploadDestination, init: RequestInit): RequestInit {
  if (dest.kind === "referente") return { ...init, cache: "no-store", credentials: "omit", referrer: "", referrerPolicy: "same-origin" };
  return { ...init, cache: "no-store", credentials: "same-origin" };
}

type Parsed = { ok: true; data: unknown } | { ok: false; code: string; message: string };

async function parse(response: Response): Promise<Parsed> {
  let body: Record<string, unknown> = {};
  try {
    const json: unknown = await response.json();
    if (json && typeof json === "object" && !Array.isArray(json)) body = json as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (response.ok && body.ok === true) return { ok: true, data: body.data };
  const code = typeof body.error === "string" ? body.error : typeof body.code === "string" ? body.code : response.status === 413 ? "file_troppo_grande_server" : "errore";
  const message = typeof body.message === "string" && body.message.trim() ? body.message : response.status === 413 ? TOO_BIG_SERVER : GENERIC;
  return { ok: false, code, message };
}

/** Il risultato del server, solo i campi del contratto. */
export function asUploadResult(data: unknown): ReferentUploadResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.fileId !== "string" || typeof d.status !== "string") return null;
  const status = d.status === "pulito" || d.status === "in_revisione" || d.status === "rifiutato" ? d.status : null;
  if (!status) return null;
  return {
    fileId: d.fileId,
    fileName: typeof d.fileName === "string" ? d.fileName : "file",
    sizeBytes: typeof d.sizeBytes === "number" ? d.sizeBytes : null,
    status,
    usable: d.usable === true,
    message: typeof d.message === "string" ? d.message : null,
    warning: typeof d.warning === "string" ? d.warning : null,
    needsConfirmation: d.needsConfirmation === true,
  };
}

async function postJson(dest: ReferentUploadDestination, path: string, body: unknown): Promise<Parsed> {
  try {
    const response = await fetch(
      `${baseOf(dest)}/${path}`,
      fetchInit(dest, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) }),
    );
    return parse(response);
  } catch {
    return { ok: false, code: "rete", message: NETWORK };
  }
}

async function serverUpload(dest: ReferentUploadDestination, file: File, opts: { declaration: boolean; validate?: boolean }): Promise<ReferentUploadOutcome> {
  const form = new FormData();
  form.set("file", file, file.name);
  form.set("needId", dest.needId);
  form.set("declaration", opts.declaration ? "true" : "false");
  if (dest.kind === "revisore" && opts.validate) form.set("validate", "true");
  let result: Parsed;
  try {
    const response = await fetch(`${baseOf(dest)}/${REFERENT_API.upload}`, fetchInit(dest, { method: "POST", headers: { accept: "application/json" }, body: form }));
    result = await parse(response);
  } catch {
    return { ok: false, code: "rete", message: NETWORK };
  }
  if (!result.ok) return result;
  const uploaded = asUploadResult(result.data);
  return uploaded ? { ok: true, file: uploaded } : { ok: false, code: "errore", message: GENERIC };
}

async function clientUpload(dest: ReferentUploadDestination, file: File, opts: { declaration: boolean; validate?: boolean }): Promise<ReferentUploadOutcome> {
  const validate = dest.kind === "revisore" && opts.validate ? { validate: true } : {};
  const ticket = await postJson(dest, REFERENT_API.uploadToken, { needId: dest.needId, fileName: file.name, size: file.size, declaration: opts.declaration, ...validate });
  if (!ticket.ok) return ticket;
  const t = ticket.data as { fileId?: unknown; pathname?: unknown; clientToken?: unknown; contentType?: unknown } | null;
  if (!t || typeof t.fileId !== "string" || typeof t.pathname !== "string" || typeof t.clientToken !== "string") return { ok: false, code: "errore", message: GENERIC };
  try {
    const { put } = await import("@vercel/blob/client");
    await put(t.pathname, file, { access: "private", token: t.clientToken, contentType: typeof t.contentType === "string" ? t.contentType : undefined, multipart: file.size > 8 * 1024 * 1024 });
  } catch {
    return { ok: false, code: "rete", message: NETWORK };
  }
  const done = await postJson(dest, REFERENT_API.uploadComplete, { fileId: t.fileId, ...validate });
  if (!done.ok) return done;
  const uploaded = asUploadResult(done.data);
  return uploaded ? { ok: true, file: uploaded } : { ok: false, code: "errore", message: GENERIC };
}

/**
 * Carica un file: fino a 4 MB dal server, oltre direttamente su Blob se `clientMode`, altrimenti
 * `modalita_non_disponibile` senza nessuna chiamata.
 */
export function uploadReferentFile(
  dest: ReferentUploadDestination,
  file: File,
  opts: { declaration: boolean; clientMode: boolean; validate?: boolean },
): Promise<ReferentUploadOutcome> {
  if (file.size <= REFERENT_LIMITS.serverMaxBytes) return serverUpload(dest, file, opts);
  if (!opts.clientMode) return Promise.resolve({ ok: false, code: "modalita_non_disponibile", message: REFERENT_ERROR_MESSAGES.modalita_non_disponibile });
  return clientUpload(dest, file, opts);
}

/** «1,2 MB», «340 KB», «12 byte». */
export function formatFileSize(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} byte`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${formatNumberIt(bytes / (1024 * 1024))} MB`;
}
