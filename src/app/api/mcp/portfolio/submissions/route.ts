import { after } from "next/server";
import { handlePortfolioSubmissionPost } from "@/lib/portfolio/submission-http";

export const runtime = "nodejs";

/**
 * Invio di una best practice o di uno use case AI (server MCP stdio e client con
 * token `portfolio:submit`). Logica nel servizio condiviso
 * (src/lib/portfolio/submit-contribution.ts); auto-ranking e notifiche partono
 * con `after()`, dopo la risposta.
 */
export async function POST(request: Request) {
  return handlePortfolioSubmissionPost(request, { schedule: (task) => after(task) });
}
