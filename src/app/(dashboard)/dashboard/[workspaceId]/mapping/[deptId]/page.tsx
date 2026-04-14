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

  const statusLabels: Record<string, string> = {
    not_started: "Non iniziato",
    in_progress: "In corso",
    mapped: "Mappato",
    validated: "Validato",
  };

  const statusLabel =
    statusLabels[department.mappingStatus] ?? department.mappingStatus;

  const welcome = `Iniziamo il mapping di **${department.name}**${department.teamSize ? ` (${department.teamSize} persone)` : ""}.

Scomporremo il lavoro in unità analizzabili. Per ogni attività raccoglierò:
— **Cosa** si fa e con quale **frequenza**
— **Input/Output** del processo
— **Strumenti** utilizzati
— **Decision point** dove serve giudizio umano
— **Pain point** e frizioni

Ogni attività verrà classificata in uno dei 3 stream:
— **Automate** — lavoro che non dovrebbe esistere così
— **Differentiate** — dove concentrare l'energia umana
— **Innovate** — valore che prima non esisteva

**Descrivimi una settimana tipo: su cosa si passa più tempo?**`;

  const suggestions = [
    `Le attività principali sono 4-5`,
    `Passiamo molto tempo su report e analisi`,
    `Il lavoro è molto frammentato`,
    `Abbiamo molti processi manuali`,
  ];

  return (
    <div className="flex h-[calc(100vh-1px)] overflow-hidden">
      <div className="flex-1 flex flex-col">
        <div className="border-b border-border px-6 py-3.5 flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-medium">{department.name}</h1>
              <span className="text-xs text-muted-foreground">
                {statusLabel}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {department.description ?? "Activity Mapping"}
              {department.teamSize
                ? ` · ${department.teamSize} persone`
                : ""}
              {activities.length > 0
                ? ` · ${activities.length} attività`
                : ""}
            </p>
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
