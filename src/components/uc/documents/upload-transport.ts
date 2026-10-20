"use client";

import { formatNumberIt } from "@/lib/uc/views/format";

/**
 * Caricamento dei file dal browser (PIANO §6.2), per la pagina del referente
 * (`/api/r/[token]/upload*`) e per il pannello di Lateral Space
 * (`…/casi-duso/[caseId]/files/upload*`).
 *
 * - Fino a 4 MB, e sempre nella zona personale: modalità server (multipart).
 * - Oltre 4 MB nella zona standard: modalità client-Blob. `upload-token` crea
 *   la riga in quarantena e un token per un solo percorso; il browser carica su
 *   Vercel Blob privato; `upload-complete` avvia i controlli. Dove Blob non c'è
 *   (harness) la risposta è `modalita_non_disponibile` e il limite resta 4 MB.
 *
 * Il token del link sta solo nell'indirizzo della chiamata: mai salvato, mai
 * nei log. Le chiamate del referente partono senza cookie e senza `Referer`.
 */

export const SERVER_MAX_BYTES = 4 * 1024 * 1024;

export type UploadDestination =
  | { kind: "referente"; token: string; itemId: string }
  | { kind: "interno"; workspaceId: string; caseId: string; itemId: string | null };

/** Esito del server: solo metadati del file. */
export interface UploadedFile {
  fileId: string;
  fileName: string;
  sizeBytes: number | null;
  status: "pulito" | "in_quarantena" | "rifiutato";
  usable: boolean;
  zone: "standard" | "personale";
  message: string | null;
  duplicate: boolean;
}

export type UploadOutcome = { ok: true; file: UploadedFile } | { ok: false; code: string; message: string };

const NETWORK = "Connessione assente o instabile: il file non è partito. Riprova.";
const GENERIC = "Caricamento non riuscito. Riprova tra poco.";
const TOO_BIG_SERVER = "Il file supera il limite di 4 MB. Dividilo, oppure salvalo come CSV o XLSX.";

/** Tipi ammessi nel selettore (il contenuto si controlla comunque sul server). */
export const ACCEPTED_FILE_TYPES = ".pdf,.docx,.xlsx,.pptx,.csv,.tsv,.txt,.md";

function base(dest: UploadDestination): string {
  return dest.kind === "referente"
    ? `/api/r/${encodeURIComponent(dest.token)}`
    : `/dashboard/${encodeURIComponent(dest.workspaceId)}/casi-duso/${encodeURIComponent(dest.caseId)}/files`;
}

function fetchInit(dest: UploadDestination, init: RequestInit): RequestInit {
  if (dest.kind === "referente") {
    // Come `referente/api.ts`: niente cookie, `Origin` vero ovunque, nessun `Referer` con il link.
    return { ...init, cache: "no-store", credentials: "omit", referrerPolicy: "same-origin", referrer: "" };
  }
  return { ...init, cache: "no-store", credentials: "same-origin" };
}

async function parse(response: Response): Promise<{ ok: true; data: unknown } | { ok: false; code: string; message: string }> {
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

function asFile(data: unknown): UploadedFile | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.fileId !== "string" || typeof d.status !== "string") return null;
  const status = d.status === "pulito" || d.status === "rifiutato" ? d.status : "in_quarantena";
  return {
    fileId: d.fileId,
    fileName: typeof d.fileName === "string" ? d.fileName : "file",
    sizeBytes: typeof d.sizeBytes === "number" ? d.sizeBytes : null,
    status,
    usable: d.usable === true,
    zone: d.zone === "personale" ? "personale" : "standard",
    message: typeof d.message === "string" ? d.message : null,
    duplicate: d.duplicate === true,
  };
}

async function postJson(dest: UploadDestination, path: string, body: unknown): Promise<{ ok: true; data: unknown } | { ok: false; code: string; message: string }> {
  try {
    const response = await fetch(`${base(dest)}/${path}`, fetchInit(dest, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) }));
    return parse(response);
  } catch {
    return { ok: false, code: "rete", message: NETWORK };
  }
}

async function serverUpload(dest: UploadDestination, file: File, declaration: boolean): Promise<UploadOutcome> {
  const form = new FormData();
  form.set("file", file, file.name);
  form.set("declaration", declaration ? "true" : "false");
  if (dest.itemId) form.set("itemId", dest.itemId);
  let result: Awaited<ReturnType<typeof parse>>;
  try {
    const response = await fetch(`${base(dest)}/upload`, fetchInit(dest, { method: "POST", headers: { accept: "application/json" }, body: form }));
    result = await parse(response);
  } catch {
    return { ok: false, code: "rete", message: NETWORK };
  }
  if (!result.ok) return result;
  const uploaded = asFile(result.data);
  return uploaded ? { ok: true, file: uploaded } : { ok: false, code: "errore", message: GENERIC };
}

async function clientUpload(dest: UploadDestination, file: File, declaration: boolean): Promise<UploadOutcome> {
  const ticket = await postJson(dest, "upload-token", { itemId: dest.itemId, fileName: file.name, size: file.size, declaration });
  if (!ticket.ok) return ticket.code === "modalita_non_disponibile" ? { ok: false, code: "file_troppo_grande_server", message: TOO_BIG_SERVER } : ticket;
  const t = ticket.data as { fileId?: unknown; pathname?: unknown; clientToken?: unknown; contentType?: unknown } | null;
  if (!t || typeof t.fileId !== "string" || typeof t.pathname !== "string" || typeof t.clientToken !== "string") return { ok: false, code: "errore", message: GENERIC };
  try {
    const { put } = await import("@vercel/blob/client");
    await put(t.pathname, file, { access: "private", token: t.clientToken, contentType: typeof t.contentType === "string" ? t.contentType : undefined, multipart: file.size > 8 * 1024 * 1024 });
  } catch {
    return { ok: false, code: "rete", message: NETWORK };
  }
  const done = await postJson(dest, "upload-complete", { fileId: t.fileId });
  if (!done.ok) return done;
  const uploaded = asFile(done.data);
  return uploaded ? { ok: true, file: uploaded } : { ok: false, code: "errore", message: GENERIC };
}

/** Carica un file: modalità server fino a 4 MB (o nella zona personale), altrimenti diretta su Blob. */
export function uploadFile(dest: UploadDestination, file: File, opts: { declaration: boolean; personal?: boolean }): Promise<UploadOutcome> {
  if (file.size <= SERVER_MAX_BYTES || opts.personal) {
    if (file.size > SERVER_MAX_BYTES) return Promise.resolve({ ok: false, code: "file_troppo_grande_server", message: TOO_BIG_SERVER });
    return serverUpload(dest, file, opts.declaration);
  }
  return clientUpload(dest, file, opts.declaration);
}

/** «1,2 MB», «340 KB». */
export function formatSize(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} byte`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${formatNumberIt(bytes / (1024 * 1024))} MB`;
}
