import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import {
  getActiveConversation,
  getMessages,
} from "@/lib/db/queries/conversations";
import { ChatInterface } from "@/components/agent/chat-interface";
import { LeadershipSidebar } from "@/components/dashboard/leadership-sidebar";

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

  return (
    <div className="flex h-[calc(100vh-1px)] overflow-hidden">
      <div className="flex-1 flex flex-col">
        <div className="border-b border-border px-6 py-4">
          <h1 className="text-lg font-semibold">Setup con la Leadership</h1>
          <p className="text-sm text-muted-foreground">
            Intervista strategica per definire value thesis, confini del sistema
            e funzioni prioritarie
          </p>
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
