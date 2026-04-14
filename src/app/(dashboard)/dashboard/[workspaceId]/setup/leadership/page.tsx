import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import {
  getActiveConversation,
  getMessages,
} from "@/lib/db/queries/conversations";
import { ChatInterface } from "@/components/agent/chat-interface";
import { LeadershipSidebar } from "@/components/dashboard/leadership-sidebar";
import { DocumentUpload } from "@/components/dashboard/document-upload";
import { Compass } from "lucide-react";

const WELCOME = `L'AI sta cambiando le condizioni in cui opera la tua organizzazione. Capiremo dove si sposta il valore e cosa significa per te.

Ti farò domande mirate su 4 aree:
— **Dove create valore** e quali sono i nodi strategici
— **Quali unità organizzative** includere nell'analisi
— **Dove il lavoro si blocca** e dove l'AI cambia le regole
— **Quali obiettivi** guidano le vostre decisioni

Cercherò informazioni sulla tua azienda online per rendere la conversazione più mirata. Puoi anche caricare documenti (strategia, organigramma, presentazioni) per accelerare il processo.

**Cominciamo: come si chiama la tua organizzazione e cosa fate?**`;

const SUGGESTIONS = [
  "Siamo [nome azienda], lavoriamo nel settore...",
  "Gestiamo servizi professionali per enterprise",
  "Siamo una tech company in fase di scaling",
  "Vorrei caricare dei documenti prima di iniziare",
];

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
        <div className="border-b border-border px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Compass className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Discovery</span>
          </div>
          <div className="flex items-center gap-3">
            <DocumentUpload workspaceId={workspaceId} />
            {hasStarted && (
              <span className="text-xs text-muted-foreground">
                {initialMessages.length} messaggi
              </span>
            )}
          </div>
        </div>
        <ChatInterface
          workspaceId={workspaceId}
          conversationType="leadership_setup"
          initialMessages={initialMessages}
          welcomeMessage={WELCOME}
          suggestions={SUGGESTIONS}
        />
      </div>
      <LeadershipSidebar workspaceId={workspaceId} />
    </div>
  );
}
