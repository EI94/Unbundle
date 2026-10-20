import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Lock } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { Button } from "@/components/ui/button";
import { openCaseView } from "@/components/uc/catalog/case-page";
import { QuestionPanelBody } from "@/components/uc/catalog/item-sections";
import { casePath } from "@/components/uc/catalog/paths";
import { QuestionList } from "@/components/uc/catalog/question-list";
import { DetailSheet } from "@/components/uc/ui/detail-sheet";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadQuestionsPage } from "@/lib/db/queries/uc-questions";
import { loadItemDetail } from "@/lib/db/queries/uc-views";
import { can } from "@/lib/uc/permissions";
import { questionQuery } from "@/lib/uc/views/catalog-filter";
import { WORDS } from "@/lib/uc/views/labels";
import { canOpenItem, canOpenPage } from "@/lib/uc/views/page-access";
import { questionDetailModel } from "./question-model";
import { UUID } from "@/lib/uc/ids";
import { clientPlainText } from "@/lib/uc/views/rows";

function firstParam(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() !== "" ? s.trim() : null;
}

/**
 * Domande (DESIGN §3.6): segmenti, ricerca, filtri e selezione per Lateral
 * Space; «Domande a posto» per lo sviluppatore (§3.6.7); la vista del cliente
 * per il suo responsabile (§3.6.8). Una pagina è un batch (`uc-questions.ts`);
 * con `?apri=<id>` si apre anche il pannello della domanda, letto in parallelo.
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
  const [data, detail] = await Promise.all([
    loadQuestionsPage(executor, viewer, { searchParams: sp, status: caseAccess.status, now }),
    apri && UUID.test(apri) ? loadItemDetail(executor, viewer, apri) : Promise.resolve(null),
  ]);
  if (!data) notFound();

  const roles = viewer.roles;
  const { audience, filter, defaults } = data;
  // Argomenti e ruoli del template come li legge il cliente: senza articoli, sigle o chiavi (DESIGN §6.2).
  const plain = (t: string) => (audience === "cliente" ? clientPlainText(t) || t : t);
  // In pausa, a caso chiuso e in sola lettura i controlli di scrittura non ci sono (§3.3).
  const writable = !viewer.readOnly && caseAccess.status !== "chiuso" && caseAccess.status !== "sospeso" && audience !== "sviluppatore";
  const permissions = {
    assign: writable && (roles.includes("ls_lead") || roles.includes("owner_cliente")),
    setDue: writable && can(roles, "assegnare"),
    outcomes: writable && can(roles, "esiti_verifica"),
    proposeNa: writable && can(roles, "proporre_na"),
    send: writable && can(roles, "inviare_richieste"),
  };
  const basePath = casePath(workspaceId, caseId, "domande");
  const panel = detail && canOpenItem(roles, detail.loaded.snapshot.status) ? questionDetailModel(detail, { workspaceId, caseId, roles, readOnly: viewer.readOnly, now }) : null;
  const dev = audience === "sviluppatore";

  return (
    <PageContainer>
      {dev && (
        <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Domande a posto</h2>
          <Button variant="outline" className="min-h-11 sm:min-h-8" render={<Link href={`${basePath}${questionQuery(filter, defaults, { pagina: filter.pagina }, { extra: { esporta: "1" } })}`} scroll={false} />} nativeButton={false}>
            <Download aria-hidden />
            Scarica il catalogo validato
          </Button>
        </div>
      )}
      <QuestionList
        workspaceId={workspaceId}
        caseId={caseId}
        basePath={basePath}
        audience={audience}
        filter={filter}
        defaults={defaults}
        segments={data.segments}
        rows={data.rows}
        groups={data.groups}
        total={data.total}
        mine={data.counts.mine}
        unassigned={permissions.send ? { count: data.counts.unassigned, href: `${casePath(workspaceId, caseId, "persone")}?invia=1` } : null}
        options={{
          contacts: data.contacts.filter((c) => c.assignable || c.id === filter.referente).map((c) => ({ id: c.id, name: c.name })),
          modules: data.ctx.modules.map((m) => ({ key: m.key, title: plain(m.title) })),
          roles: Object.entries(data.ctx.roleLabels)
            .map(([key, label]) => ({ key, label: plain(label) }))
            .sort((a, b) => a.label.localeCompare(b.label, "it")),
          contract: data.counts.outOfContract > 0,
          catalogSize: data.catalogSize,
          kindCounts: data.kindCounts,
        }}
        permissions={{ ...permissions, any: Object.values(permissions).some(Boolean) }}
        contacts={data.contacts}
        reviewHref={writable && canOpenPage("verifica", roles) ? casePath(workspaceId, caseId, "domande/verifica") : null}
        documentsHref={casePath(workspaceId, caseId, "domande/documenti")}
        openId={panel?.itemId ?? null}
      />
      {panel && (
        <DetailSheet
          title={panel.title}
          status={{ tone: panel.status.tone, label: panel.status.sublabel ? `${panel.status.label} · ${panel.status.sublabel}` : panel.status.label }}
          chips={
            panel.must || panel.personal || panel.outOfContract ? (
              <>
                {panel.must && <span className="text-xs text-muted-foreground">{WORDS.indispensabile}</span>}
                {panel.outOfContract && <span className="text-xs text-muted-foreground">{WORDS.fuoriContratto}</span>}
                {panel.personal && (
                  <span title={WORDS.datoPersonale} className="inline-flex items-center gap-1 text-xs text-uc-lucchetto">
                    <Lock className="size-3.5" aria-hidden />
                    {WORDS.datoPersonale}
                  </span>
                )}
              </>
            ) : undefined
          }
          size="xl"
        >
          <QuestionPanelBody model={panel} />
        </DetailSheet>
      )}
    </PageContainer>
  );
}
