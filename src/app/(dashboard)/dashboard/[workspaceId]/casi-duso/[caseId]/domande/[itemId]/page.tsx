import { notFound } from "next/navigation";
import { PageContainer } from "@/components/dashboard/page-container";
import { openCaseView } from "@/components/uc/catalog/case-page";
import { QuestionPageBody } from "@/components/uc/catalog/item-sections";
import { UploadPanel } from "@/components/uc/documents/upload-panel";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadItemDetail } from "@/lib/db/queries/uc-views";
import { can } from "@/lib/uc/permissions";
import { canOpenItem } from "@/lib/uc/views/page-access";
import { expectsFile, questionDetailModel } from "../question-model";
import { UUID } from "@/lib/uc/ids";

/**
 * La domanda a tutta pagina (DESIGN §3.6.5): lo stesso contenuto del pannello,
 * da `lg` su due colonne, senza link indietro (le schede bastano). Lateral
 * Space carica qui il file di una domanda che lo prevede. Per lo sviluppatore
 * solo le domande a posto; per il cliente la sua vista (§3.6.8).
 */
export default async function QuestionPage({ params }: { params: Promise<{ workspaceId: string; caseId: string; itemId: string }> }) {
  const { workspaceId, caseId, itemId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor, viewer } = await openCaseView({ workspaceId, caseId, session, access, page: "voce" });
  if (!UUID.test(itemId)) notFound();
  const data = await loadItemDetail(executor, viewer, itemId);
  if (!data || !canOpenItem(viewer.roles, data.loaded.snapshot.status)) notFound();
  const model = questionDetailModel(data, { workspaceId, caseId, roles: viewer.roles, readOnly: viewer.readOnly, now: new Date() });
  const writable = !viewer.readOnly && caseAccess.status !== "chiuso" && caseAccess.status !== "sospeso";
  const upload = writable && can(viewer.roles, "esiti_verifica") && expectsFile(data);

  return (
    <PageContainer>
      <div className="max-w-4xl">
        <QuestionPageBody model={model} upload={upload ? <UploadPanel workspaceId={workspaceId} caseId={caseId} itemId={itemId} canUpload hint={data.loaded.extra.help} /> : undefined} />
      </div>
    </PageContainer>
  );
}
