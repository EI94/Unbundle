import { acknowledgePrivacy } from "@/lib/db/queries/uc-public";
import { handlePublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/r/[token]/privacy-ack` `{ version }`: «Ho letto» sull'informativa.
 * La prova sta sulla richiesta (`privacy_ack_at`, `privacy_notice_version`); sul
 * referente solo l'ultima vista. Senza, il link non salva bozze né risposte.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handlePublic(request, token, { write: true, rate: "apertura" }, async ({ executor, link, body, opts }) => outcomeResponse(await acknowledgePrivacy(executor, link, body, opts)));
}
