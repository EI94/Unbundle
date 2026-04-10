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
import { Badge } from "@/components/ui/badge";
import { GitBranch, Users } from "lucide-react";

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

  const hasStarted = initialMessages.length > 0;
  const statusLabels: Record<string, string> = {
    not_started: "Non iniziato",
    in_progress: "In corso",
    mapped: "Mappato",
    validated: "Validato",
  };

  return (
    <div className="flex h-[calc(100vh-1px)] overflow-hidden">
      <div className="flex-1 flex flex-col">
        <div className="border-b border-border bg-background/80 backdrop-blur-sm px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
              <GitBranch className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold">{department.name}</h1>
                <Badge variant="secondary" className="text-xs">
                  {statusLabels[department.mappingStatus] ??
                    department.mappingStatus}
                </Badge>
                {department.teamSize && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <Users className="h-3 w-3" />
                    {department.teamSize}
                  </Badge>
                )}
                {activities.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {activities.length} attivit&agrave;
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {department.description ??
                  "Leo, il Process Analyst, scompone le attività in unità analizzabili"}
              </p>
            </div>
          </div>
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
