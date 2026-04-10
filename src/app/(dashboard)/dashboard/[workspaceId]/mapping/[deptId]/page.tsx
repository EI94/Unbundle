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

  const statusLabels: Record<string, string> = {
    not_started: "Non iniziato",
    in_progress: "In corso",
    mapped: "Mappato",
    validated: "Validato",
  };

  const welcome = `Iniziamo il mapping delle attività per **${department.name}**${department.teamSize ? ` (${department.teamSize} persone)` : ""}.

L'obiettivo è scomporre il lavoro del dipartimento in unità analizzabili. Per ogni attività raccoglierò:
- **Cosa** si fa concretamente e con quale **frequenza**
- **Input e output** del processo
- **Strumenti** utilizzati
- **Punti decisionali** dove serve giudizio umano
- **Pain points** e frizioni

Le attività verranno salvate automaticamente nella sidebar a destra.

**Descrivimi una settimana tipo in ${department.name}: su cosa si passa più tempo?**`;

  const suggestions = [
    `Le attività principali sono 4-5`,
    `Passiamo molto tempo su report e analisi`,
    `Il lavoro è molto frammentato`,
    `Abbiamo molti processi manuali`,
  ];

  return (
    <div className="flex h-[calc(100vh-1px)] overflow-hidden">
      <div className="flex-1 flex flex-col">
        <div className="border-b border-border px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white">
              <GitBranch className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold leading-tight">
                  {department.name}
                </h1>
                <Badge variant="outline" className="text-xs">
                  {statusLabels[department.mappingStatus] ??
                    department.mappingStatus}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {department.description ?? "Activity Mapping"}
                {department.teamSize
                  ? ` \u00b7 ${department.teamSize} persone`
                  : ""}
                {activities.length > 0
                  ? ` \u00b7 ${activities.length} attivit\u00e0`
                  : ""}
              </p>
            </div>
          </div>
        </div>
        <ChatInterface
          workspaceId={workspaceId}
          conversationType="activity_mapping"
          departmentId={deptId}
          initialMessages={initialMessages}
          welcomeMessage={welcome}
          suggestions={suggestions}
        />
      </div>
      <ActivitySidebar activities={activities} />
    </div>
  );
}
