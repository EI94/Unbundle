import { after } from "next/server";
import { appConnectorHandlerDeps } from "@/lib/connector/app-tools";
import { handleConnectorRequest } from "@/lib/connector/handler";

/**
 * Connettore MCP organizzativo «Unbundle» (prompt WP5): server MCP remoto, Streamable
 * HTTP senza stato, risposte JSON. URL pubblico `https://www.theunbundle.com/api/mcp/connettore/<slug>`.
 *
 * Tutto il lavoro è in `src/lib/connector/handler.ts`: igiene HTTP, autenticazione con
 * `Authorization: Bearer ub_mcp_…`, server nuovo a ogni richiesta, 4 tool, log senza
 * dati. Spento (404) finché `MCP_CONNECTOR_ENABLED` non vale `true`. Solo POST: ogni
 * altro metodo risponde 405 con `Allow: POST`, le intestazioni di igiene e una riga di
 * log. Per questo la rotta esporta tutti i metodi che Next gestisce (GET, HEAD, POST,
 * PUT, PATCH, DELETE, OPTIONS): un metodo non esportato lo gestirebbe Next da solo
 * (405 nudo, o OPTIONS 204 con un `Allow` che elenca anche GET e DELETE), anche con la
 * rotta spenta. Auto-ranking e notifiche di un invio partono con `after()`, dopo la
 * risposta.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ slug: string }> };

async function handle(request: Request, context: RouteContext): Promise<Response> {
  const { slug } = await context.params;
  return handleConnectorRequest(request, slug, appConnectorHandlerDeps({ schedule: (task) => after(task) }));
}

export async function POST(request: Request, context: RouteContext) {
  return handle(request, context);
}

export async function GET(request: Request, context: RouteContext) {
  return handle(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return handle(request, context);
}

export async function HEAD(request: Request, context: RouteContext) {
  return handle(request, context);
}

export async function PUT(request: Request, context: RouteContext) {
  return handle(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return handle(request, context);
}

export async function OPTIONS(request: Request, context: RouteContext) {
  return handle(request, context);
}
