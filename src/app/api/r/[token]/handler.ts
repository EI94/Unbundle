import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { UcAccessError, ensureUcAvailable, isUcEnabled } from "@/lib/db/queries/uc-access";
import { refreshReadinessCache } from "@/lib/db/queries/uc-cases";
import { dispatchDue } from "@/lib/db/queries/uc-notifications-dispatch";
import { hitRateLimits, resolveRequestToken, type PublicOptions, type ResolvedLink } from "@/lib/db/queries/uc-public";
import { getAppUcExecutor, ucErrorCode, type UcExecutor } from "@/lib/db/uc-executor";
import {
  invalidLinkResponse,
  ipRateLimitRule,
  publicCallEnv,
  publicData,
  publicError,
  publicOriginAllowed,
  publicWritesAvailable,
  readPublicJson,
  retryAfter,
  tokenRateLimitRule,
  type RateLimitKind,
} from "@/lib/uc/http";
import type { PublicOutcome } from "@/lib/uc/public-view";
import { isUcWorkspaceEnabled } from "@/lib/uc/rollout";
import { looksLikeRequestToken } from "@/lib/uc/tokens";

/**
 * Schema comune delle API pubbliche a token `/api/r/[token]/…` (PIANO §5.5):
 *
 * 0. `UC_ENABLED` spento o token con la forma sbagliata → errore uniforme
 *    `link_non_valido` (mai un 404 diverso), senza toccare il database;
 * 1. scritture: in produzione senza `UC_SECRET` → 503 (DESIGN §7.1 P0-7);
 *    `Origin` dello stesso sito, corpo JSON ≤ 256 KB (2 MB per l'invio a
 *    gruppi; i caricamenti multipart leggono il corpo da sé, con il loro limite);
 * 2. tabelle uc pronte (`ensureUcAvailable`), altrimenti 503;
 * 3. scritture: limite per impronta dell'IP (120/min) prima di leggere il link;
 * 4. una sola SQL per il link (`resolveRequestToken`): sbagliato, scaduto o
 *    revocato, oppure di un workspace con la sezione spenta (`UC_WORKSPACE_IDS`,
 *    DESIGN §7.1 P0-1) → `link_non_valido`;
 * 5. scritture: limite per token (bozze 60/min, invii 20/min: un invio a gruppi
 *    conta una volta);
 * 6. comando; dopo una scrittura che cambia il catalogo, testata del caso
 *    invalidata e, dopo la risposta, cache della prontezza e coda delle notifiche.
 *
 * Le GET non scrivono nulla (PIANO §5.4 «nessuna scrittura in GET», nemmeno i
 * contatori dei limiti di frequenza): niente effetti collaterali sui prefetch o
 * sugli scanner dei link. Un token si indovina solo con 192 bit di fortuna.
 */

const CASE_LAYOUT_PATH = "/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]";

export interface PublicCall {
  executor: UcExecutor;
  link: ResolvedLink;
  body: unknown;
  opts: PublicOptions;
  /** La richiesta originale: serve solo con `body: "raw"` (caricamento multipart), il cui corpo non è ancora letto. */
  request: Request;
}

export interface PublicSpec {
  /** Scrive: `Origin`, corpo JSON, limiti di frequenza. */
  write: boolean;
  rate: RateLimitKind | null;
  /** Dopo l'esito riuscito: testata del caso, prontezza e coda delle notifiche. */
  refresh?: boolean;
  /**
   * Corpo della scrittura: `json` (default, ≤ 256 KB) oppure `raw`, letto dal
   * comando con i suoi limiti (caricamento dei file in multipart). L'`Origin`
   * si controlla comunque.
   */
  body?: "json" | "raw";
  /** Limite del corpo JSON, se diverso dai 256 KB (invio a gruppi). */
  maxBytes?: number;
}

/** Il link vale solo con la sezione accesa nel suo workspace (`UC_WORKSPACE_IDS`). */
export function publicWorkspaceEnabled(workspaceId: string): boolean {
  return isUcWorkspaceEnabled(workspaceId, { UC_WORKSPACE_IDS: process.env.UC_WORKSPACE_IDS, VERCEL_ENV: process.env.VERCEL_ENV });
}

function refreshCase(link: ResolvedLink): void {
  try {
    revalidatePath(CASE_LAYOUT_PATH, "layout");
  } catch {
    // Solo la cache delle pagine interne: la risposta al referente resta valida.
  }
  after(async () => {
    try {
      const executor = await getAppUcExecutor();
      await refreshReadinessCache(executor, link.workspaceId, link.caseId);
      await dispatchDue({ caseId: link.caseId });
    } catch (error) {
      console.error("[uc] aggiornamento dopo la risposta del referente non riuscito", error instanceof Error ? error.name : "errore");
    }
  });
}

export async function handlePublic(request: Request, token: string, spec: PublicSpec, run: (call: PublicCall) => Promise<Response>): Promise<Response> {
  try {
    if (!isUcEnabled()) return invalidLinkResponse();
    if (!looksLikeRequestToken(token)) return invalidLinkResponse();
    let body: unknown = null;
    if (spec.write) {
      if (!publicWritesAvailable(process.env)) return publicError("non_disponibile");
      if (!publicOriginAllowed(request.headers, process.env.NEXT_PUBLIC_APP_URL)) return publicError("origine_non_ammessa");
      if (spec.body !== "raw") {
        const read = await readPublicJson(request, spec.maxBytes);
        if (!read.ok) return publicError(read.code);
        body = read.value;
      }
    }
    try {
      await ensureUcAvailable();
    } catch (error) {
      if (error instanceof UcAccessError && error.code === "disattivata") return invalidLinkResponse();
      return publicError("non_disponibile");
    }
    const executor = await getAppUcExecutor();
    const now = new Date();
    const env = publicCallEnv(request.headers, process.env);
    if (spec.write) {
      const ipRule = ipRateLimitRule(env.ipHash);
      if (ipRule && (await hitRateLimits(executor, [ipRule]))) return publicError("troppe_richieste", { retryAfterSeconds: retryAfter(ipRule.unit, now) });
    }
    const link = await resolveRequestToken(executor, token);
    if (!link || !publicWorkspaceEnabled(link.workspaceId)) return invalidLinkResponse();
    if (spec.write && spec.rate) {
      const rule = tokenRateLimitRule(link.tokenId, spec.rate);
      if (await hitRateLimits(executor, [rule])) return publicError("troppe_richieste", { retryAfterSeconds: retryAfter(rule.unit, now) });
    }
    const opts: PublicOptions = { now, ...env };
    const response = await run({ executor, link, body, opts, request });
    if (spec.refresh && response.ok) refreshCase(link);
    return response;
  } catch (error) {
    const code = ucErrorCode(error);
    if (code === "link_non_valido") return invalidLinkResponse();
    console.error("[uc] API pubblica non riuscita", error instanceof Error ? error.name : "errore", code ?? "");
    return publicError("errore");
  }
}

/** Esito di un comando pubblico → risposta JSON uniforme. */
export function outcomeResponse<T>(outcome: PublicOutcome<T>): Response {
  if (!outcome.ok) return publicError(outcome.code, { message: outcome.message, issues: outcome.issues });
  return publicData(outcome.value);
}
