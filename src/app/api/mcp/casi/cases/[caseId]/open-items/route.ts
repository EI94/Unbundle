import { readOpenItems } from "@/lib/db/queries/uc-mcp";
import { handleCaseRead } from "../../../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `get_open_items` (scope `cases:read`): voci del gate G1 non a posto, con ruolo e scadenza. */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return handleCaseRead(request, {
    tool: "get_open_items",
    caseId,
    read: ({ executor, mcase, now }) => readOpenItems(executor, mcase, now),
  });
}
