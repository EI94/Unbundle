import { readDataDictionary } from "@/lib/db/queries/uc-mcp";
import { handleCaseRead } from "../../../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `get_data_dictionary` (scope `cases:read`): entità e campi con tipi e classi, mai valori. */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return handleCaseRead(request, {
    tool: "get_data_dictionary",
    caseId,
    read: ({ executor, mcase }) => readDataDictionary(executor, mcase),
  });
}
