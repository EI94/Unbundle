import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const source = await readFile(
    join(process.cwd(), "mcp", "unbundle-portfolio-server.mjs"),
    "utf8"
  );

  return new Response(source, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-disposition": 'attachment; filename="unbundle-portfolio-server.mjs"',
      "content-type": "text/javascript; charset=utf-8",
    },
  });
}
