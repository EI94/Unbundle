import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const source = await readFile(
    join(process.cwd(), "skills", "unbundle-portfolio", "SKILL.md"),
    "utf8"
  );

  return new Response(source, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-disposition": 'attachment; filename="SKILL.md"',
      "content-type": "text/markdown; charset=utf-8",
    },
  });
}
