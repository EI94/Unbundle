import "server-only";
import { UcAccessError, ensureUcAvailable, isUcEnabled, isUcEnabledFor } from "@/lib/db/queries/uc-access";
import { loadMcpCase, recordMcpRead, type McpCase, type McpRead } from "@/lib/db/queries/uc-mcp";
import { authenticateWorkspaceIntegrationToken } from "@/lib/db/queries/workspace-integrations";
import { getAppUcExecutor, type UcExecutor } from "@/lib/db/uc-executor";
import { ucLog, ucLogError } from "@/lib/uc/log";
import { MCP_ERROR_MESSAGES, checkMcpToolAccess, mcpErrorStatus, type McpCaseTool } from "@/lib/uc/mcp-access";
import { ipHashFromSecret } from "@/lib/uc/tokens";

/**
 * Schema comune delle rotte MCP dei casi (PIANO §5.8), come
 * `api/mcp/portfolio/requirements`:
 *
 * 0. `UC_ENABLED` spento → 404, prima di guardare il token.
 * 1. token Bearer (`authenticateWorkspaceIntegrationToken`) → 401;
 * 2. workspace del token fuori da `UC_WORKSPACE_IDS` (DESIGN §7.1 P0-1) → 404,
 *    come a sezione spenta;
 * 3. scope dello strumento e marcatore `uc:case:` del token → 403;
 * 4. caso del workspace del token, uguale al marcatore, non chiuso → 404;
 * 5. lettura (viste di `mcp-view.ts`);
 * 6. evento `catalogo.letto_mcp` con l'attore `mcp` e il token: se non si
 *    registra, la rotta non risponde con i dati (503);
 * 7. risposta JSON `no-store`, e una riga di log con strumento, esito e durata
 *    (mai il token né i valori).
 */

const HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: HEADERS });
}

export function mcpError(code: string, message?: string): Response {
  return json({ ok: false, error: code, message: message ?? MCP_ERROR_MESSAGES[code] ?? MCP_ERROR_MESSAGES.errore }, mcpErrorStatus(code));
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/** IP del chiamante (primo valore di `x-forwarded-for`, poi `x-real-ip`), solo come hash con chiave. */
function requestIpHash(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim() || null;
  return ipHashFromSecret(process.env.UC_SECRET, ip);
}

export interface CaseReadContext {
  executor: UcExecutor;
  mcase: McpCase;
  url: URL;
  now: Date;
}

/** Rotta di lettura di uno strumento MCP dei casi. `caseId` null solo per `list_cases`. */
export async function handleCaseRead(
  request: Request,
  i: { tool: McpCaseTool; caseId: string | null; read: (c: CaseReadContext) => Promise<McpRead> },
): Promise<Response> {
  if (!isUcEnabled()) return mcpError("non_trovato");
  const started = Date.now();
  const where: { workspaceId?: string; caseId?: string } = {};
  const done = (code: string, status: number): void => {
    ucLog({ level: status >= 500 ? "error" : "info", area: "uc.mcp", op: i.tool, code, durationMs: Date.now() - started, ...where });
  };
  const fail = (code: string, message?: string): Response => {
    const response = mcpError(code, message);
    done(code, response.status);
    return response;
  };
  try {
    try {
      await ensureUcAvailable();
    } catch (error) {
      if (error instanceof UcAccessError && error.code === "disattivata") return mcpError("non_trovato");
      return fail("non_disponibile");
    }

    const auth = await authenticateWorkspaceIntegrationToken(bearerToken(request));
    if (!auth) return fail("non_autorizzato");
    where.workspaceId = auth.workspace.id;
    // Workspace fuori elenco: come a sezione spenta, senza dire perché.
    if (!isUcEnabledFor(auth.workspace.id)) return fail("non_trovato");

    const access = checkMcpToolAccess({ scopes: auth.token.scopes, tool: i.tool, caseId: i.caseId });
    if (!access.ok) return fail(access.code, access.message);

    const executor = await getAppUcExecutor();
    const mcase = await loadMcpCase(executor, auth.workspace.id, access.value.caseId);
    if (!mcase) return fail("caso_non_trovato");
    where.caseId = mcase.id;

    const outcome = await i.read({ executor, mcase, url: new URL(request.url), now: new Date() });
    if (!outcome.ok) return fail(outcome.code, outcome.message);

    try {
      await recordMcpRead(executor, {
        workspaceId: auth.workspace.id,
        caseId: mcase.id,
        integrationTokenId: auth.token.id,
        tool: i.tool,
        version: outcome.event.version,
        items: outcome.event.items,
        ipHash: requestIpHash(request),
        userAgent: request.headers.get("user-agent"),
      });
    } catch (error) {
      ucLogError({ area: "uc.mcp", op: "registro", ...where }, error);
      return fail("registro_non_disponibile");
    }

    done("ok", 200);
    return json(outcome.body, 200);
  } catch (error) {
    ucLogError({ area: "uc.mcp", op: i.tool, ...where }, error);
    return mcpError("errore");
  }
}
