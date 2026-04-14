import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getDepartmentById } from "@/lib/db/queries/workspaces";
import {
  getActivitiesByDepartment,
  getDependenciesByDepartment,
} from "@/lib/db/queries/activities";
import {
  getActiveConversation,
  getMessages,
} from "@/lib/db/queries/conversations";
import { db } from "@/lib/db";
import { uploadedDocuments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { ChatInterface } from "@/components/agent/chat-interface";
import { ActivitySidebar } from "@/components/dashboard/activity-sidebar";
import { DocumentUpload } from "@/components/dashboard/document-upload";
import { ActivityPreGenerator } from "@/components/dashboard/activity-pre-generator";
import { DepartmentDashboard } from "@/components/dashboard/department-dashboard";

export default async function DepartmentMappingPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; deptId: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId, deptId } = await params;
  const { mode } = await searchParams;

  const department = await getDepartmentById(deptId);
  if (!department || department.workspaceId !== workspaceId) notFound();

  const activities = await getActivitiesByDepartment(deptId);

  const isMapped =
    department.mappingStatus === "mapped" ||
    department.mappingStatus === "validated";

  const forceChat = mode === "chat";

  if (isMapped && !forceChat) {
    const dependencies = await getDependenciesByDepartment(deptId);
    return (
      <DepartmentDashboard
        departmentName={department.name}
        teamSize={department.teamSize}
        activities={activities}
        dependencies={dependencies}
        workspaceId={workspaceId}
        departmentId={deptId}
      />
    );
  }

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

  const deptDocs = await db
    .select({ id: uploadedDocuments.id })
    .from(uploadedDocuments)
    .where(
      and(
        eq(uploadedDocuments.workspaceId, workspaceId),
        eq(uploadedDocuments.departmentId, deptId)
      )
    );

  const hasDocuments = deptDocs.length > 0;

  const statusLabels: Record<string, string> = {
    not_started: "Non iniziato",
    in_progress: "In corso",
    mapped: "Mappato",
    validated: "Validato",
  };

  const statusLabel =
    statusLabels[department.mappingStatus] ?? department.mappingStatus;

  const welcome = `Iniziamo il mapping di **${department.name}**${department.teamSize ? ` (${department.teamSize} persone)` : ""}.

Scomporremo il lavoro in unit\u00e0 analizzabili. Per ogni attivit\u00e0 raccoglier\u00f2:
\u2014 **Cosa** si fa e con quale **frequenza**
\u2014 **Input/Output** del processo
\u2014 **Strumenti** utilizzati
\u2014 **Decision point** dove serve giudizio umano
\u2014 **Pain point** e frizioni

Ogni attivit\u00e0 verr\u00e0 classificata in uno dei 3 stream:
\u2014 **Automate** \u2014 lavoro che non dovrebbe esistere cos\u00ec
\u2014 **Differentiate** \u2014 dove concentrare l\u2019energia umana
\u2014 **Innovate** \u2014 valore che prima non esisteva

Alla fine del mapping, il sistema classificher\u00e0 automaticamente ogni attivit\u00e0 e calcolerai l\u2019AI Exposure con il framework O*NET.

${hasDocuments ? "Ho gi\u00e0 dei documenti a disposizione per questo dipartimento. Li user\u00f2 per fare domande pi\u00f9 precise.\n\n" : "Puoi caricare documenti (SOP, organigramma, procedure) con il pulsante in alto per accelerare il processo.\n\n"}**Descrivimi una settimana tipo: su cosa si passa pi\u00f9 tempo?**`;

  const suggestions = [
    "Le attivit\u00e0 principali sono 4-5",
    "Passiamo molto tempo su report e analisi",
    "Il lavoro \u00e8 molto frammentato",
    "Abbiamo molti processi manuali",
  ];

  return (
    <div className="flex h-[calc(100vh-1px)] overflow-hidden">
      <div className="flex-1 flex flex-col">
        <div className="border-b border-border px-6 py-3.5 flex items-center justify-between">
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
                ? ` \u00B7 ${department.teamSize} persone`
                : ""}
              {activities.length > 0
                ? ` \u00B7 ${activities.length} attivit\u00e0`
                : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DocumentUpload
              workspaceId={workspaceId}
              departmentId={deptId}
            />
            <ActivityPreGenerator
              workspaceId={workspaceId}
              departmentId={deptId}
              hasDocuments={hasDocuments}
            />
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
