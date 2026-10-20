import { readCases } from "@/lib/db/queries/uc-mcp";
import { handleCaseRead } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `list_cases` (scope `cases:read`): il caso del token, con stato e prontezza.
 * Il server `unbundle-casi` chiama questa rotta anche per l'alias `list_use_cases`.
 */
export async function GET(request: Request) {
  return handleCaseRead(request, {
    tool: "list_cases",
    caseId: null,
    read: ({ executor, mcase, now }) => readCases(executor, mcase, now),
  });
}
