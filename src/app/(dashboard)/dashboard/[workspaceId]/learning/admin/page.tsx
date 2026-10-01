import { getLearningAdminCatalog } from "@/lib/learning/admin";
import { learningEnabled } from "@/lib/learning/server";
import { LearningShell, LearningUnavailable } from "@/components/learning/learning-shell";
import { LearningAdminCatalog } from "@/components/learning/admin-catalog";

export default async function LearningAdminPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!learningEnabled()) return <LearningShell workspaceId={workspaceId} title="Gestisci formazione"><LearningUnavailable message="La formazione non è attiva in questo ambiente." /></LearningShell>;
  const catalog = await getLearningAdminCatalog(workspaceId);
  return <LearningShell workspaceId={workspaceId} title="Gestisci formazione">
    {catalog.canCreate || catalog.canManage ? <LearningAdminCatalog workspaceId={workspaceId} initial={catalog} /> : <LearningUnavailable message="Per gestire un corso serve un permesso esplicito del responsabile. Gli amministratori del workspace possono preparare un nuovo corso." />}
  </LearningShell>;
}
