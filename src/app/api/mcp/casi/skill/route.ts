import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isUcEnabled } from "@/lib/db/queries/uc-access";
import { mcpError } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lo SKILL per Claude che accompagna il server MCP dei casi. */
export async function GET() {
  if (!isUcEnabled()) return mcpError("non_trovato");
  const source = await readFile(join(process.cwd(), "mcp", "unbundle-casi-SKILL.md"), "utf8");
  return new Response(source, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-disposition": 'attachment; filename="SKILL.md"',
      "content-type": "text/markdown; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
