import { BELL_TEXT } from "@/lib/notifications/bell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** La campanella (giorno 0: in arrivo). */
export async function GET(_req: Request, ctx: { params: Promise<{ workspaceId: string }> }): Promise<Response> {
  await ctx.params;
  return Response.json({ ok: false, code: "riprova", message: BELL_TEXT.errors.unavailable }, { status: 503, headers: HEADERS });
}

export async function POST(_req: Request, ctx: { params: Promise<{ workspaceId: string }> }): Promise<Response> {
  await ctx.params;
  return Response.json({ ok: false, code: "riprova", message: BELL_TEXT.errors.unavailable }, { status: 503, headers: HEADERS });
}
