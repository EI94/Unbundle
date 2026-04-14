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

const WELCOME = `L'AI sta cambiando le condizioni in cui opera la tua organizzazione. Attraverso questa conversazione, capiremo dove si sposta il valore e cosa significa per te.

Ti farò domande mirate su 4 aree:
— **Dove create valore** e quali sono i nodi strategici
— **Quali funzioni** includere nell'analisi
— **Dove il lavoro si blocca** e dove l'AI cambia le regole
— **Quali obiettivi** guidano le vostre decisioni

Ogni risposta viene salvata e alimenta tutti gli step successivi. Cominciamo.

**Raccontami la tua organizzazione: cosa fate, per chi, e qual è il vostro vantaggio competitivo oggi?**`;

const SUGGESTIONS = [
  "Siamo un'azienda B2B con circa 100 persone",
  "Gestiamo servizi professionali per enterprise",
  "Siamo una tech company in fase di scaling",
  "Operiamo nel manifatturiero avanzato",
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
            <span className="text-sm font-medium">Intervista strategica</span>
          </div>
          {hasStarted && (
            <span className="text-xs text-muted-foreground">
              {initialMessages.length} messaggi
            </span>
          )}
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
