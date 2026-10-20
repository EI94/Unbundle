import { readValidatedCatalog } from "@/lib/db/queries/uc-mcp";
import { parseKindsParam, parseVersionParam } from "@/lib/uc/mcp-access";
import { handleCaseRead } from "../../../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `get_validated_catalog` (scope `cases:read_validated`): solo voci validate o non
 * applicabili firmate della versione congelata (`?version=N`, di default
 * l'ultima), mai la bozza. `?kinds=campo,regola` filtra per tipo di voce.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return handleCaseRead(request, {
    tool: "get_validated_catalog",
    caseId,
    read: async ({ executor, mcase, url }) => {
      const version = parseVersionParam(url.searchParams.get("version"));
      if (!version.ok) return version;
      const kinds = parseKindsParam(url.searchParams.get("kinds"));
      if (!kinds.ok) return kinds;
      return readValidatedCatalog(executor, mcase, { version: version.value, kinds: kinds.value });
    },
  });
}
