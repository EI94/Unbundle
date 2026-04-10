import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import {
  getActiveConversation,
  getMessages,
} from "@/lib/db/queries/conversations";
import { ChatInterface } from "@/components/agent/chat-interface";
import { LeadershipSidebar } from "@/components/dashboard/leadership-sidebar";
import { Badge } from "@/components/ui/badge";
import { Compass } from "lucide-react";

export default async function LeadershipSetupPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const conversation = await getActiveConversation(
    workspaceId,
    "leadership_setup"
  );
  const existingMessages = conversation
    ? await getMessages(conversation.id)
    : [];

  const initialMessages = existingMessages.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const hasStarted = initialMessages.length > 0;

  return (
    <div className="flex h-[calc(100vh-1px)] overflow-hidden">
      <div className="flex-1 flex flex-col">
        <div className="border-b border-border bg-background/80 backdrop-blur-sm px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
              <Compass className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold">
                  Intervista Strategica
                </h1>
                <Badge
                  variant={hasStarted ? "secondary" : "outline"}
                  className="text-xs"
                >
                  {hasStarted
                    ? `${initialMessages.length} messaggi`
                    : "Non iniziata"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Mara, la Strategy Architect, ti guida a definire dove si
                concentra il valore nella tua organizzazione
              </p>
            </div>
          </div>
        </div>
        <ChatInterface
          workspaceId={workspaceId}
          conversationType="leadership_setup"
          initialMessages={initialMessages}
        />
      </div>
      <LeadershipSidebar workspaceId={workspaceId} />
    </div>
  );
}
