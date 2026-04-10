import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getDepartmentById } from "@/lib/db/queries/workspaces";
import { getActivitiesByDepartment } from "@/lib/db/queries/activities";
import {
  getActiveConversation,
  getMessages,
} from "@/lib/db/queries/conversations";
import { ChatInterface } from "@/components/agent/chat-interface";
import { ActivitySidebar } from "@/components/dashboard/activity-sidebar";

export default async function DepartmentMappingPage({
  params,
}: {
  params: Promise<{ workspaceId: string; deptId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId, deptId } = await params;
  const department = await getDepartmentById(deptId);
  if (!department || department.workspaceId !== workspaceId) notFound();

  const activities = await getActivitiesByDepartment(deptId);

  const conversation = await getActiveConversation(
    workspaceId,
    "activity_mapping",
    deptId
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
          <h1 className="text-lg font-semibold">
            Mapping: {department.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Intervista per scomporre le attivita&apos; del dipartimento
            {department.teamSize
              ? ` (${department.teamSize} persone)`
              : ""}
          </p>
        </div>
        <ChatInterface
          workspaceId={workspaceId}
          conversationType="activity_mapping"
          departmentId={deptId}
          initialMessages={initialMessages}
        />
      </div>
      <ActivitySidebar activities={activities} />
    </div>
  );
}
