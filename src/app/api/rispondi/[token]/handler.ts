import "server-only";
import { hitRateLimits } from "@/lib/db/queries/uc-public";
import {
  logReferentPublicError,
  referentAskEnabled,
  referentPublicWritesAvailable,
  referentRateRule,
  referentStoreReady,
  resolveReferentToken,
  REFERENT_PUBLIC_STATUS,
  type ReferentLink,
} from "@/lib/db/queries/use-case-referent-public";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { uploadStatusFor } from "@/lib/uc/files/multipart";
import {
  invalidLinkResponse,
  ipRateLimitRule,
  publicData,
  publicError,
  publicOriginAllowed,
  publicStatusFor,
  readPublicJson,
  requestIpHash,
  retryAfter,
  type RateLimitKind,
} from "@/lib/uc/http";
import { REFERENT_API } from "@/lib/use-cases/referent/contract";
import { looksLikeReferentToken } from "@/lib/use-cases/referent/tokens";

/**
 * Schema comune delle API pubbliche di «Chiedi al referente» `/api/rispondi/[token]/…` (SPEC §4.2),
 * sul modello di `src/app/api/r/[token]/handler.ts`:
 *
 * 1. funzione spenta (`USE_CASE_REFERENTS=off`) o token con la forma sbagliata → `link_non_valido`
 *    uniforme, senza toccare il database;
 * 2. scritture: su Vercel (anteprime comprese) senza `UC_SECRET` → 503; `Origin` dello stesso sito;
 *    corpo JSON ≤ 256 KB (i caricamenti multipart leggono il corpo da sé, con il loro limite);
 * 3. archivi pronti (`referentStoreReady`), altrimenti 503;
 * 4. scritture: limite per impronta dell'IP (120 al minuto) prima di leggere il link;
 * 5. una sola lettura per il link (`resolveReferentToken`): sbagliato, scaduto, revocato, oppure di un
 *    workspace con la funzione spenta → `link_non_valido`, sempre la stessa risposta 404;
 * 6. scritture: limite per link e tipo di chiamata (`ucq:<link>:<tipo>`);
 * 7. il comando.
 *
 * La pagina non legge mai la sessione: vale uguale da disconnessi e da connessi, con qualsiasi ruolo.
 * Le GET non scrivono niente, nemmeno i contatori dei limiti. Nei log solo il tipo di chiamata e un
 * codice: mai il token, il corpo o un testo.
 */

export interface ReferentPublicSpec {
  /** Scrive: `UC_SECRET` su Vercel, `Origin`, corpo JSON, limiti di frequenza. */
  write: boolean;
  rate: RateLimitKind | null;
  /** `json` (default, ≤ 256 KB) oppure `raw`: il comando legge da sé il corpo (multipart). */
  body?: "json" | "raw";
  maxBytes?: number;
}

export interface ReferentPublicCall {
  link: ReferentLink;
  body: unknown;
  /** La richiesta originale: serve con `body: "raw"`, il cui corpo non è ancora letto. */
  request: Request;
  now: Date;
}

/** I tipi di chiamata, per il log: mai un pezzo dell'indirizzo che non sia uno di questi. */
const OPS = new Set<string>(Object.values(REFERENT_API));

function opOf(request: Request): string {
  try {
    const last = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
    return OPS.has(last) ? last : "vista";
  } catch {
    return "vista";
  }
}

export async function handleReferentPublic(request: Request, token: string, spec: ReferentPublicSpec, run: (call: ReferentPublicCall) => Promise<Response>): Promise<Response> {
  try {
    if (process.env.USE_CASE_REFERENTS?.trim() === "off" || !looksLikeReferentToken(token)) return invalidLinkResponse();
    let body: unknown = null;
    if (spec.write) {
      if (!referentPublicWritesAvailable(process.env)) return publicError("non_disponibile");
      if (!publicOriginAllowed(request.headers, process.env.NEXT_PUBLIC_APP_URL)) return publicError("origine_non_ammessa");
      if (spec.body !== "raw") {
        const read = await readPublicJson(request, spec.maxBytes);
        if (!read.ok) return publicError(read.code);
        body = read.value;
      }
    }
    if (!(await referentStoreReady())) return publicError("non_disponibile");
    const now = new Date();
    if (spec.write) {
      const ipRule = ipRateLimitRule(requestIpHash(request.headers, process.env.UC_SECRET));
      if (ipRule && (await hitRateLimits(await getAppUcExecutor(), [ipRule]))) return publicError("troppe_richieste", { retryAfterSeconds: retryAfter(ipRule.unit, now) });
    }
    const resolved = await resolveReferentToken(token, now);
    if (resolved.access !== "ok" || !referentAskEnabled(resolved.link.workspaceId, process.env)) return invalidLinkResponse();
    if (spec.write && spec.rate) {
      const rule = referentRateRule(resolved.link.tokenId, spec.rate);
      if (await hitRateLimits(await getAppUcExecutor(), [rule])) return publicError("troppe_richieste", { retryAfterSeconds: retryAfter(rule.unit, now) });
    }
    return await run({ link: resolved.link, body, request, now });
  } catch (error) {
    logReferentPublicError(opOf(request), error);
    return publicError("errore");
  }
}

/** L'esito di un comando pubblico (`{ ok, value }` oppure `{ ok: false, code, message, issues? }`). */
export type ReferentOutcome<T> = { ok: true; value: T } | { ok: false; code: string; message: string; issues?: { code: string; message: string; field?: string }[] };

/** Il codice HTTP di un codice d'esito: quelli della SPEC (§4.3), poi quelli comuni. */
export function referentStatusFor(code: string, fallback: (code: string) => number = publicStatusFor): number {
  return REFERENT_PUBLIC_STATUS[code] ?? fallback(code);
}

/** Esito di un comando → risposta JSON uniforme (`{ ok, data }` o `{ ok: false, error, message, issues? }`). */
export function outcomeResponse<T>(outcome: ReferentOutcome<T>): Response {
  if (outcome.ok) return publicData(outcome.value);
  if (outcome.code === "link_non_valido") return invalidLinkResponse();
  return publicError(outcome.code, { message: outcome.message, issues: outcome.issues, status: referentStatusFor(outcome.code) });
}

/**
 * Esito di un caricamento → risposta uniforme. Un file rifiutato (dati sanitari…) è un esito con il
 * suo messaggio, non un errore: risponde 200 con `status: "rifiutato"`.
 */
export function uploadOutcomeResponse<T>(result: { ok: true; value: T } | { ok: false; code: string; message: string }): Response {
  if (result.ok) return publicData(result.value);
  if (result.code === "link_non_valido") return invalidLinkResponse();
  return publicError(result.code, { message: result.message, status: referentStatusFor(result.code, uploadStatusFor) });
}
