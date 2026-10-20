import { notFound } from "next/navigation";
import { SegmentedNav } from "@/components/dashboard/segmented-nav";
import { PageContainer } from "@/components/dashboard/page-container";
import { openCaseView } from "@/components/uc/catalog/case-page";
import { casePath } from "@/components/uc/catalog/paths";
import { DocumentsView } from "@/components/uc/documents/documents-view";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadUploadPanel, type UploadPanelData } from "@/lib/db/queries/uc-files";
import { loadQuestionDocuments, loadQuestionSegments } from "@/lib/db/queries/uc-questions";
import { can } from "@/lib/uc/permissions";
import { questionQuery } from "@/lib/uc/views/catalog-filter";
import { caseFileRows, datasetsWithoutFile, requiredDocumentRows } from "@/lib/uc/views/documents";
import { audienceFor } from "@/lib/uc/views/status-groups";

/**
 * Documenti di Domande (DESIGN §3.6.6): documenti richiesti, file caricati
 * con anteprima mascherata e la scheda dataset fatta da quel file, le schede
 * il cui file non c'è più, e per Lateral Space il pannello «Carica un file» e
 * le azioni sui file. Il segmento «Documenti» di Domande porta qui: i segmenti
 * restano in alto.
 */
export default async function DocumentsPage({ params }: { params: Promise<{ workspaceId: string; caseId: string }> }) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor, viewer } = await openCaseView({ workspaceId, caseId, session, access, page: "documenti" });
  const roles = viewer.roles;
  const lsWriter = can(roles, "esiti_verifica");
  const [data, segments, panel] = await Promise.all([
    loadQuestionDocuments(executor, viewer),
    loadQuestionSegments(executor, viewer, caseAccess.status),
    lsWriter
      ? loadUploadPanel(
          executor,
          { workspaceId, caseId: caseAccess.caseId, itemId: null, userId: caseAccess.user.userId, roles, isLateralSpace: caseAccess.user.isLateralSpace, readOnly: viewer.readOnly },
          process.env,
        )
      : Promise.resolve(null as UploadPanelData | null),
  ]);
  if (!data) notFound();
  const questionsBase = casePath(workspaceId, caseId, "domande");
  // In pausa e a caso chiuso niente caricamenti né azioni sui file (§3.3).
  const writable = !viewer.readOnly && caseAccess.status !== "chiuso" && caseAccess.status !== "sospeso";
  const manage = writable && panel?.canManage ? panel : null;
  const audience = audienceFor(roles);
  const sources = new Map(data.required.map((d) => [d.key, d.title]));

  return (
    <PageContainer>
      <div className="min-w-0 space-y-6">
        {segments.segments.length > 0 && (
          <SegmentedNav
            ariaLabel="Domande per stato"
            active="documenti"
            items={segments.segments.map((s) => ({
              key: s.key,
              label: s.label,
              count: s.count,
              href: s.key === "documenti" ? casePath(workspaceId, caseId, "domande/documenti") : `${questionsBase}${questionQuery(segments.filter, segments.defaults, { vista: s.key })}`,
            }))}
          />
        )}
        <DocumentsView
          workspaceId={workspaceId}
          caseId={caseId}
          questionsBase={questionsBase}
          required={requiredDocumentRows(data.required, audience)}
          files={caseFileRows(
            data.files,
            data.datasets,
            manage
              ? {
                  datasetCandidates: new Set(manage.datasetCandidates.map((f) => f.id)),
                  datasetsToDecide: new Map(manage.datasets.filter((d) => d.fileId).map((d) => [d.fileId as string, { datasetId: d.id, canDecide: d.canDecide }])),
                  deletable: new Set(manage.deletable.map((f) => f.id)),
                }
              : null,
            audience,
          )}
          datasetsWithoutFile={datasetsWithoutFile(data.files, data.datasets, sources, audience)}
          upload={
            writable && panel
              ? {
                  allowed: panel.upload.allowed,
                  reason: panel.upload.reason,
                  clientMode: panel.upload.clientMode,
                  targets: [
                    { id: null, title: "Documento del caso", personal: false },
                    ...data.required.filter((d) => d.privacyClass !== "escluso_sanitario").map((d) => ({ id: d.id, title: d.title || d.key, personal: d.privacyClass === "personale" || d.privacyClass === "personale_equipaggio" })),
                  ],
                }
              : null
          }
          manage={
            manage
              ? {
                  reviews: manage.reviews,
                  candidates: manage.datasetCandidates,
                  controller: manage.dataControllerLabel,
                  sources: data.required.filter((d) => d.kind === "fonte").map((d) => ({ key: d.key, title: d.title || d.key })),
                }
              : null
          }
          personalNote={data.personalZoneShown ? "I file della zona personale mostrano solo i metadati: il contenuto resta cifrato." : null}
        />
      </div>
    </PageContainer>
  );
}
