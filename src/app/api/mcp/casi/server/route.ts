import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isUcEnabled } from "@/lib/db/queries/uc-access";
import { mcpError } from "../handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Il server MCP dei casi da scaricare (comando del pannello «Sviluppo con Claude»). */
export async function GET() {
  if (!isUcEnabled()) return mcpError("non_trovato");
  const source = await readFile(join(process.cwd(), "mcp", "unbundle-casi-server.mjs"), "utf8");
  return new Response(source, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-disposition": 'attachment; filename="unbundle-casi-server.mjs"',
      "content-type": "text/javascript; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
