import { removeReferentFile } from "@/lib/db/queries/use-case-referent-public";
import { handleReferentPublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `POST /api/rispondi/[token]/file-remove` `{ fileId }`: «Togli» un file non ancora inviato. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: true, rate: "bozza" }, async ({ link, body }) => outcomeResponse(await removeReferentFile(link, body, process.env)));
}
