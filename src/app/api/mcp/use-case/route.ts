import { after } from "next/server";
import { appTeamMcpHandlerDeps } from "@/lib/use-cases/mcp/app-deps";
import { handleTeamMcpRequest } from "@/lib/use-cases/mcp/handler";

/**
 * MCP del team «Unbundle Use case» (docs/use-case/DESIGN.md §9.4, D9): server MCP remoto,
 * Streamable HTTP senza stato, risposte JSON. URL pubblico
 * `https://www.theunbundle.com/api/mcp/use-case`; il workspace lo dà il token personale.
 *
 * Tutto il lavoro è in `src/lib/use-cases/mcp/handler.ts`: igiene HTTP, autenticazione con il
 * token personale del team e i permessi della persona riletti a ogni richiesta, server
 * nuovo a ogni richiesta, 6 tool, log senza dati. Spento (404) finché `MCP_TEAM_ENABLED` non vale
 * `true`. Solo POST: ogni altro metodo risponde 405 con `Allow: POST`, le intestazioni di igiene e
 * una riga di log; per questo la rotta esporta tutti i metodi che Next gestisce (un metodo non
 * esportato lo gestirebbe Next da solo, anche con la rotta spenta). Le notifiche delle schede
 * create partono con `after()`, dopo la risposta.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  return handleTeamMcpRequest(request, appTeamMcpHandlerDeps({ schedule: (task) => after(task) }));
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}

export async function DELETE(request: Request) {
  return handle(request);
}

export async function HEAD(request: Request) {
  return handle(request);
}

export async function PUT(request: Request) {
  return handle(request);
}

export async function PATCH(request: Request) {
  return handle(request);
}

export async function OPTIONS(request: Request) {
  return handle(request);
}
