import { confirmReferentFile } from "@/lib/db/queries/use-case-referent-public";
import { handleReferentPublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/rispondi/[token]/file-confirm` `{ fileId }`: «Servono, lo lascio» su un file in cui
 * abbiamo trovato nomi, email o telefoni. Senza questa conferma il file non parte.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: true, rate: "bozza" }, async ({ link, body }) => outcomeResponse(await confirmReferentFile(link, body)));
}
