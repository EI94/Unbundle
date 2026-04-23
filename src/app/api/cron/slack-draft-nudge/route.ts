import { NextResponse } from "next/server";
import { runSlackDraftNudgeCron } from "@/lib/slack/draft-nudge-cron";

/** Schedulato in `vercel.json` al massimo 1×/giorno (limite piano Vercel Hobby). */
export const maxDuration = 120;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await runSlackDraftNudgeCron();
  return NextResponse.json(result);
}
