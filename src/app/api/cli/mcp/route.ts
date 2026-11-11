import { handleCaseMcpRequest } from "@/lib/use-cases/cli/mcp";

/**
 * L'MCP del caso (rilascio 8.0b): server MCP remoto per un coding agent, con il token di un caso solo creato da
 * `unbundle mcp <ID>`. Tutto il lavoro è in `src/lib/use-cases/cli/mcp.ts`. Solo POST: ogni altro metodo risponde
 * 405; per questo la rotta esporta tutti i metodi che Next gestisce.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleCaseMcpRequest(request);
}

export async function GET(request: Request) {
  return handleCaseMcpRequest(request);
}

export async function DELETE(request: Request) {
  return handleCaseMcpRequest(request);
}
