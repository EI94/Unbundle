import { notFound } from "next/navigation";
import { Interview } from "@/components/mappatura/interview/interview";
import { INTERVIEW_TEXT } from "@/components/mappatura/interview/text";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { getActiveConversation, getMessages } from "@/lib/db/queries/conversations";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";

export const metadata = { title: INTERVIEW_TEXT.title };

/**
 * L'«Intervista iniziale» (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7; prima «Discovery», stesso indirizzo): la
 * conversazione con cui l'azienda si racconta, nella chat dell'assistente della board, con il riepilogo accanto. Chi è
 * nel workspace, come prima. La conversazione è quella di sempre (`leadership_setup`): i messaggi salvati ripartono da
 * dove erano. `?apri=riepilogo` apre il riepilogo dove non sta accanto alla chat (al telefono).
 */
export default async function InterviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  await requireWorkspacePage(workspaceId);
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const conversation = await getActiveConversation(workspaceId, "leadership_setup");
  const saved = conversation ? await getMessages(conversation.id) : [];
  const initialMessages = saved.map((message) => ({
    id: message.id,
    role: message.role as "user" | "assistant",
    content: message.content,
  }));
  const { apri } = await searchParams;

  return <Interview workspaceId={workspaceId} initialMessages={initialMessages} initialSheet={typeof apri === "string" ? apri : null} />;
}
