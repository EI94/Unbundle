/**
 * Import dei casi di prova da file (PIANO §3.11, WP12b): regole pure della route
 * `POST …/casi-duso/[caseId]/test-cases/import`. Origine della richiesta, corpo
 * letto con un limite di byte, file JSON o CSV in UTF-8. Mai un parser xlsx su
 * un file non fidato (PIANO §6.3).
 *
 * Modulo puro: import relativi `.ts`, nessun accesso al DB.
 */
import { fail, ok, type Result } from "../types.ts";
import { caseBasePath } from "./request.ts";

/** Indirizzo della route di import dei casi di prova (POST multipart, campo `file`). */
export function testCasesImportHref(workspaceId: string, caseId: string): string {
  return `${caseBasePath(workspaceId, caseId)}/test-cases/import`;
}

// ── Origine e corpo ───────────────────────────────────────────────────

/**
 * La POST arriva dal sito stesso (difesa CSRF: i cookie di sessione partono anche
 * da un'altra pagina). Si confronta l'host dell'`Origin` con l'host della
 * richiesta, come `src/app/api/auth/session/route.ts`: dietro il proxy di Vercel
 * il protocollo interno può essere http. In alternativa vale l'indirizzo
 * pubblico configurato. Senza `Origin` serve `Sec-Fetch-Site: same-origin`.
 */
export function sameSiteRequest(headers: { get(name: string): string | null }, publicUrl?: string | null): boolean {
  const origin = headers.get("origin");
  if (!origin) return headers.get("sec-fetch-site") === "same-origin";
  let originHost: string;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    originHost = parsed.host;
  } catch {
    return false;
  }
  const host = headers.get("host");
  if (host && originHost === host) return true;
  const configured = publicUrl?.trim();
  if (!configured) return false;
  try {
    return new URL(configured.startsWith("http") ? configured : `https://${configured}`).host === originHost;
  } catch {
    return false;
  }
}

/** Limite del file dei casi di prova: lo stesso di `parseTestCases`. */
export const TEST_CASES_MAX_BYTES = 2_000_000;
/** Margine per l'involucro multipart (intestazioni, confini). */
const MULTIPART_OVERHEAD = 64 * 1024;

/** Corpo letto a blocchi, fermandosi oltre il limite (un `content-length` falso non basta a superarlo). */
export async function readBoundedBody(request: Request, maxBytes: number): Promise<Result<Uint8Array>> {
  const tooLarge = () => fail<Uint8Array>("file_troppo_grande", "Il file è troppo grande: al massimo 2 MB.");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) return tooLarge();
  if (!request.body) return fail("file_mancante", "Scegli un file da importare.");
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
        return tooLarge();
      }
      chunks.push(value);
    }
  } catch {
    return fail("corpo_non_valido", "Il file non è arrivato per intero. Riprova.");
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

export type TestCasesFileFormat = "json" | "csv";

export interface TestCasesUpload {
  text: string;
  /** Assente: si riconosce dal contenuto (`parseTestCases`). */
  format?: TestCasesFileFormat;
}

function decodeUtf8(bytes: Uint8Array): Result<string> {
  try {
    return ok(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail("codifica_non_valida", "Il file deve essere in UTF-8: salvalo di nuovo come «CSV UTF-8» o JSON.");
  }
}

/** Formato dal nome del file: JSON o CSV (anche TSV). Un foglio Excel va salvato come CSV. */
export function formatFromFileName(name: string): Result<TestCasesFileFormat | undefined> {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim())?.[1]?.toLowerCase() ?? "";
  if (ext === "json") return ok("json");
  if (ext === "csv" || ext === "tsv") return ok("csv");
  if (ext === "txt" || ext === "") return ok(undefined);
  if (ext === "xlsx" || ext === "xls" || ext === "ods") {
    return fail("formato_non_supportato", "Salva il foglio come «CSV UTF-8» e caricalo di nuovo.");
  }
  return fail("formato_non_supportato", "Carica un file JSON o CSV.");
}

/**
 * Legge il file dei casi di prova: multipart (campo `file`, come un modulo con
 * `<input type="file">`) oppure il corpo grezzo `application/json`, `text/csv`,
 * `text/plain`. Mai un parser xlsx su un file non fidato (PIANO §6.3).
 */
export async function readTestCasesUpload(request: Request): Promise<Result<TestCasesUpload>> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const mediaType = contentType.split(";", 1)[0].trim();
  if (mediaType === "multipart/form-data") {
    const body = await readBoundedBody(request, TEST_CASES_MAX_BYTES + MULTIPART_OVERHEAD);
    if (!body.ok) return body;
    let form: FormData;
    try {
      form = await new Response(body.value as BodyInit, { headers: { "content-type": contentType } }).formData();
    } catch {
      return fail("corpo_non_valido", "Il file non è arrivato per intero. Riprova.");
    }
    const file = form.get("file");
    if (!file || typeof file === "string" || file.size === 0) return fail("file_mancante", "Scegli un file da importare.");
    if (file.size > TEST_CASES_MAX_BYTES) return fail("file_troppo_grande", "Il file è troppo grande: al massimo 2 MB.");
    const format = formatFromFileName(file.name ?? "");
    if (!format.ok) return format;
    const text = decodeUtf8(new Uint8Array(await file.arrayBuffer()));
    if (!text.ok) return text;
    return ok(format.value ? { text: text.value, format: format.value } : { text: text.value });
  }
  const rawFormats: Readonly<Record<string, TestCasesFileFormat | undefined>> = {
    "application/json": "json",
    "text/csv": "csv",
    "text/tab-separated-values": "csv",
    "text/plain": undefined,
  };
  if (!(mediaType in rawFormats)) return fail("formato_non_supportato", "Carica un file JSON o CSV.");
  const body = await readBoundedBody(request, TEST_CASES_MAX_BYTES);
  if (!body.ok) return body;
  if (body.value.byteLength === 0) return fail("file_mancante", "Scegli un file da importare.");
  const text = decodeUtf8(body.value);
  if (!text.ok) return text;
  const format = rawFormats[mediaType];
  return ok(format ? { text: text.value, format } : { text: text.value });
}
