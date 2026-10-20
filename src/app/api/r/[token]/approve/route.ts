import { decideApproval } from "@/lib/db/queries/uc-public";
import { handlePublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/r/[token]/approve` `{ kind, target_id, decision: "approvo" | "non_approvo", read: true, text_hash, reason? }`:
 * firma del firmatario designato dal link di approvazione (solo
 * `purpose = 'approvazioni'`); designazione ed email si ricontrollano al
 * momento della firma.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handlePublic(request, token, { write: true, rate: "invio", refresh: true }, async ({ executor, link, body, opts }) =>
    outcomeResponse(await decideApproval(executor, link, body, opts)),
  );
}
