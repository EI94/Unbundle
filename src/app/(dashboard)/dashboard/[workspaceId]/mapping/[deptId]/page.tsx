import { notFound } from "next/navigation";
import { ClassificationView } from "@/components/mappatura/classification/classification-view";
import { Companion } from "@/components/mappatura/companion/companion";
import { CompleteButton } from "@/components/mappatura/companion/complete-button";
import { UnitBoard } from "@/components/mappatura/board/unit-board";
import { BoardProvider } from "@/components/mappatura/store/use-board";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { getActiveConversation, getMessages } from "@/lib/db/queries/conversations";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { allSteps, withUseCaseLinks } from "@/lib/mappatura/board-model";
import { readBoard } from "@/lib/mappatura/board-store";
import { unitHasDocuments } from "@/lib/mappatura/units";
import { boardUseCaseLinks } from "@/lib/mappatura/use-case-links";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { getUnitTerm } from "@/lib/utils/unit-terminology";

/**
 * L'activity mapping di un'unità, S2 · La board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3–§1.5, §4.10).
 *
 * La pagina legge e monta, niente di più: la board per chi guarda (`readBoard`: un'unità di un altro workspace è un
 * 404), la conversazione dell'unità, se ci sono documenti, gli use case nati dalla mappatura che chi guarda può vedere
 * (una volta sola: le riletture dopo un salvataggio non li portano). Poi la board nel browser (`BoardProvider`) con la
 * vista della board e i tre slot del compagno. `?mode=chat` (i link di prima) apre la board con l'assistente aperto,
 * come un'unità ancora senza passi.
 */
export default async function UnitBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; deptId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { workspaceId, deptId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { mode } = await searchParams;

  const executor = await getAppUcExecutor();
  const read = await readBoard(executor, { workspaceId, departmentId: deptId }, { userId: session.user.id, role: access.role });
  if (!read) notFound();
  // L'id come lo scrive il database: la bozza sul dispositivo e le rotte usano sempre lo stesso.
  const departmentId = read.unit.id;

  const [conversation, hasDocuments, links] = await Promise.all([
    getActiveConversation(workspaceId, "activity_mapping", departmentId),
    unitHasDocuments(executor, { workspaceId, departmentId }),
    boardUseCaseLinks(workspaceId, viewerFromSession(session.user, access.role), new Set(allSteps(read).map((step) => step.id))),
  ]);
  const messages = conversation ? await getMessages(conversation.id) : [];
  const initialMessages = messages.map((message) => ({ id: message.id, role: message.role as "user" | "assistant", content: message.content }));
  const board = withUseCaseLinks(read, links);

  return (
    <BoardProvider workspaceId={workspaceId} departmentId={departmentId} userId={session.user.id} initial={board}>
      <UnitBoard
        workspaceId={workspaceId}
        workspaceName={access.workspace.name}
        unitTerm={getUnitTerm(access.workspace)}
        assistantDefaultOpen={mode === "chat" || allSteps(board).length === 0}
        assistant={
          <Companion
            workspaceId={workspaceId}
            departmentId={departmentId}
            unitName={board.unit.name}
            teamSize={board.unit.teamSize}
            initialMessages={initialMessages}
            hasDocuments={hasDocuments}
          />
        }
        classification={<ClassificationView workspaceId={workspaceId} useCaseHub={isUseCaseHubWorkspace(workspaceId)} />}
        headAction={<CompleteButton workspaceId={workspaceId} departmentId={departmentId} />}
      />
    </BoardProvider>
  );
}
