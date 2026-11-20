import { notFound } from "next/navigation";
import { PageContainer } from "@/components/dashboard/page-container";
import { AddressSheet } from "@/components/uc/catalog/address-sheet";
import { openCaseView } from "@/components/uc/catalog/case-page";
import { QuestionPanelBody, QuestionPanelHead } from "@/components/uc/catalog/item-sections";
import { casePath } from "@/components/uc/catalog/paths";
import { QuestionList } from "@/components/uc/catalog/question-list";
import { FilePanel } from "@/components/uc/documents/file-panel";
import { loadCaseHead } from "@/components/uc/shell/case-data";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadUploadPanel, type UploadPanelData } from "@/lib/db/queries/uc-files";
import { loadQuestionDocuments, loadQuestionsPage } from "@/lib/db/queries/uc-questions";
import { loadItemDetail } from "@/lib/db/queries/uc-views";
import { UUID } from "@/lib/uc/ids";
import { can } from "@/lib/uc/permissions";
import { questionQuery, withoutQuestionFilters } from "@/lib/uc/views/catalog-filter";
import { caseFileRows, datasetsWithoutFile } from "@/lib/uc/views/documents";
import { caseNextSteps, nextStepFor } from "@/lib/uc/views/next-step";
import { canOpenItem, canOpenPage } from "@/lib/uc/views/page-access";
import { questionFilterFields } from "@/lib/uc/views/question-bar";
import { clientPlainText } from "@/lib/uc/views/rows";
import { audienceFor } from "@/lib/uc/views/status-groups";
import { questionDetailModel } from "./question-model";

function firstParam(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() !== "" ? s.trim() : null;
}

/** Il pannello dell'archivio: `?apri=file` (lo apre anche il passo «Controlla N file» della testata). */
const FILE_PANEL = "file";

/**
 * Il pulsante pieno della testata porta già a «Verifica una alla volta»? Lo stesso passo del guscio (`nextStepFor`,
 * dati della testata già letti nella stessa richiesta): se sì, Domande non ripete il link (un solo «Verifica»).
 */
async function headerLeadsToReview(workspaceId: string, caseId: string, userId: string, workspaceRole: string): Promise<boolean> {
  const { caseAccess, header } = await loadCaseHead(workspaceId, caseId, userId, workspaceRole);
  return nextStepFor(caseNextSteps(header.nextStep, { roles: caseAccess.roles }))?.id === "verifica";
}

/**
 * Domande (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5): i segmenti, la barra «Cerca · Filtri (n) · Seleziona · File
 * (6)», gli argomenti chiusi con il solo conteggio (il gruppo «In attesa» in cima a «Da fare») e, con un filtro o una
 * ricerca, le righe. Due pannelli con il loro indirizzo, letti in parallelo alla lista: la domanda (`?apri=<id>`) e
 * l'archivio dei file (`?apri=file`, che ha preso il posto di `/domande/documenti`). Per lo sviluppatore le sole
 * domande a posto; per il cliente la sua vista (§3.6.8). Il solo pulsante pieno è il passo della testata.
 */
export default async function QuestionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor, viewer } = await openCaseView({ workspaceId, caseId, session, access, page: "voci" });
  const sp = await searchParams;
  const now = new Date();
  const apri = firstParam(sp.apri);
  const roles = viewer.roles;
  // In pausa, a caso chiuso e in sola lettura i controlli di scrittura non ci sono (§3.3).
  const writable = !viewer.readOnly && caseAccess.status !== "chiuso" && caseAccess.status !== "sospeso";
  const filesOpen = apri === FILE_PANEL;
  const uploader = filesOpen && writable && can(roles, "esiti_verifica");
  const [data, detail, documents, upload] = await Promise.all([
    loadQuestionsPage(executor, viewer, { searchParams: sp, status: caseAccess.status, now }),
    apri && UUID.test(apri) ? loadItemDetail(executor, viewer, apri) : Promise.resolve(null),
    filesOpen ? loadQuestionDocuments(executor, viewer) : Promise.resolve(null),
    uploader
      ? loadUploadPanel(
          executor,
          { workspaceId, caseId: caseAccess.caseId, itemId: null, userId: caseAccess.user.userId, roles, isLateralSpace: caseAccess.user.isLateralSpace, readOnly: viewer.readOnly },
          process.env,
        )
      : Promise.resolve(null as UploadPanelData | null),
  ]);
  if (!data) notFound();

  const { audience, filter, defaults } = data;
  // Argomenti e ruoli del template come li legge il cliente: senza articoli, sigle o chiavi (DESIGN §6.2).
  const plain = (t: string) => (audience === "cliente" ? clientPlainText(t) || t : t);
  const listWritable = writable && audience !== "sviluppatore";
  const permissions = {
    assign: listWritable && (roles.includes("ls_lead") || roles.includes("owner_cliente")),
    setDue: listWritable && can(roles, "assegnare"),
    outcomes: listWritable && can(roles, "esiti_verifica"),
    proposeNa: listWritable && can(roles, "proporre_na"),
    send: listWritable && can(roles, "inviare_richieste"),
  };
  const basePath = casePath(workspaceId, caseId, "domande");
  // «Apri a tutta pagina» porta i filtri e la pagina della lista: «‹ Domande» ci torna.
  const listQuery = questionQuery(filter, defaults, { pagina: filter.pagina });
  const panel = detail && canOpenItem(roles, detail.loaded.snapshot.status) ? questionDetailModel(detail, { workspaceId, caseId, roles, readOnly: viewer.readOnly, now, listQuery }) : null;
  const reviewing = audience === "ls" && filter.vista === "da-verificare" && data.total > 0 && writable && canOpenPage("verifica", roles);
  const reviewHref = reviewing && !(await headerLeadsToReview(workspaceId, caseId, session.user.id, access.role)) ? casePath(workspaceId, caseId, "domande/verifica") : null;
  const fields = questionFilterFields(filter, defaults, audience, {
    contacts: data.contacts.filter((c) => c.assignable || c.id === filter.referente).map((c) => ({ id: c.id, name: c.name })),
    modules: data.ctx.modules.map((m) => ({ key: m.key, title: plain(m.title) })),
    roles: Object.entries(data.ctx.roleLabels)
      .map(([key, label]) => ({ key, label: plain(label) }))
      .sort((a, b) => a.label.localeCompare(b.label, "it")),
    contract: data.counts.outOfContract > 0,
    catalogSize: data.catalogSize,
    kindCounts: data.kindCounts,
    unassigned: data.counts.unassigned,
  });

  // «Documenti richiesti (N)»: tutte le domande che chiedono un file, come la pagina Documenti di ieri.
  const documentsList = `${basePath}${questionQuery({ ...withoutQuestionFilters(filter), q: null }, defaults, { vista: "tutte", soloIndispensabili: false, documenti: true })}`;
  const filePanel = filesOpen && documents ? fileArchive(documents, upload, { audience: audienceFor(roles), writable, list: documentsList }) : null;

  return (
    <PageContainer>
      <QuestionList
        workspaceId={workspaceId}
        caseId={caseId}
        basePath={basePath}
        audience={audience}
        filter={filter}
        defaults={defaults}
        segments={data.segments}
        fields={fields}
        collapsed={data.collapsed}
        topics={data.topics}
        waiting={data.waiting}
        rows={data.rows}
        groups={data.groups}
        total={data.total}
        files={data.files}
        permissions={{ ...permissions, any: Object.values(permissions).some(Boolean) }}
        contacts={data.contacts}
        reviewHref={reviewHref}
        openId={panel?.itemId ?? null}
      />
      {panel && (
        <AddressSheet title={panel.title} description={<QuestionPanelHead model={panel} />}>
          <QuestionPanelBody model={panel} />
        </AddressSheet>
      )}
      {filePanel && <FilePanel workspaceId={workspaceId} caseId={caseId} questionsBase={basePath} {...filePanel} />}
    </PageContainer>
  );
}

/** I dati del pannello «File», dalle letture di oggi della pagina Documenti (DESIGN §3.6.6). */
function fileArchive(
  data: NonNullable<Awaited<ReturnType<typeof loadQuestionDocuments>>>,
  panel: UploadPanelData | null,
  i: { audience: "ls" | "cliente"; writable: boolean; list: string },
) {
  // In pausa e a caso chiuso niente caricamenti né azioni sui file (§3.3).
  const manage = i.writable && panel?.canManage ? panel : null;
  const sources = new Map(data.required.map((d) => [d.key, d.title]));
  return {
    files: caseFileRows(
      data.files,
      data.datasets,
      manage
        ? {
            datasetCandidates: new Set(manage.datasetCandidates.map((f) => f.id)),
            datasetsToDecide: new Map(manage.datasets.filter((d) => d.fileId).map((d) => [d.fileId as string, { datasetId: d.id, canDecide: d.canDecide }])),
            deletable: new Set(manage.deletable.map((f) => f.id)),
          }
        : null,
      i.audience,
    ),
    datasetsWithoutFile: datasetsWithoutFile(data.files, data.datasets, sources, i.audience),
    upload:
      i.writable && panel
        ? {
            allowed: panel.upload.allowed,
            reason: panel.upload.reason,
            clientMode: panel.upload.clientMode,
            targets: [
              { id: null, title: null, personal: false },
              ...data.required
                .filter((d) => d.privacyClass !== "escluso_sanitario")
                .map((d) => ({ id: d.id, title: (i.audience === "cliente" ? clientPlainText(d.title) : d.title) || d.key, personal: d.privacyClass === "personale" || d.privacyClass === "personale_equipaggio" })),
            ],
          }
        : null,
    manage: manage
      ? {
          reviews: manage.reviews,
          candidates: manage.datasetCandidates,
          controller: manage.dataControllerLabel,
          sources: data.required.filter((d) => d.kind === "fonte").map((d) => ({ key: d.key, title: d.title || d.key })),
        }
      : null,
    personalNote: data.personalZoneShown,
    required: { count: data.required.length, href: i.list },
  };
}
