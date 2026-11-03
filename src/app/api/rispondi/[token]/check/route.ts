import { saveReferentCheck } from "@/lib/db/queries/use-case-referent-public";
import { handleReferentPublic, outcomeResponse } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * (Rilascio 5) `POST /api/rispondi/[token]/check` `{ step: 1, confirm, note }` oppure `{ step: 2,
 * teamSeen, estimate, timesPerMonth, minutesEach }`: la bozza della conferma dello use case e della
 * stima del tempo. La nota passa dagli stessi controlli delle risposte; la stima si confronta con quella
 * del team di adesso (`stima_cambiata`: niente di scritto).
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleReferentPublic(request, token, { write: true, rate: "bozza" }, async ({ link, body, now }) => outcomeResponse(await saveReferentCheck(link, body, now)));
}
