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

const WELCOME = `Benvenuto nell'Intervista Strategica. Attraverso questa conversazione definiremo insieme:

1. **Value Thesis** — dove la tua azienda crea valore e quali nodi sono strategici
2. **Perimetro di analisi** — cosa includere e cosa escludere
3. **Funzioni prioritarie** — i dipartimenti su cui concentrare l'analisi
4. **Obiettivi strategici** — OKR e KPI che guideranno la prioritizzazione

Tutte le informazioni che emergeranno verranno salvate automaticamente e utilizzate nelle fasi successive (Activity Mapping, Classificazione, Use Cases).

**Cominciamo: raccontami la tua azienda. Cosa fate, per chi, e come generate valore?**`;

const SUGGESTIONS = [
  "Siamo un'azienda B2B nel settore energetico",
  "Siamo una startup SaaS con 50 dipendenti",
  "Siamo un'azienda manifatturiera con 200+ persone",
  "Vorrei caricare dei documenti sull'azienda",
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
        <div className="border-b border-border px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Compass className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight">
                Intervista Strategica
              </h1>
              <p className="text-xs text-muted-foreground">
                Definisci value thesis, perimetro e funzioni prioritarie
              </p>
            </div>
          </div>
          <Badge
            variant={hasStarted ? "secondary" : "outline"}
            className="text-xs"
          >
            {hasStarted
              ? `${initialMessages.length} messaggi`
              : "Non iniziata"}
          </Badge>
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
