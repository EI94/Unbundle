import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runClassificationAction } from "@/lib/actions/classify";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { workspaceId } = await req.json();
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId è richiesto" },
      { status: 400 }
    );
  }

  const result = await runClassificationAction(workspaceId);
  return NextResponse.json(result);
}
