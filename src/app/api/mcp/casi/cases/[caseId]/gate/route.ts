import { readGateStatus } from "@/lib/db/queries/uc-mcp";
import { handleCaseRead } from "../../../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `get_gate_status` (scope `cases:read`): calcolo di G1 e storico delle decisioni (date e ruoli). */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return handleCaseRead(request, {
    tool: "get_gate_status",
    caseId,
    read: ({ executor, mcase, now }) => readGateStatus(executor, mcase, now),
  });
}
