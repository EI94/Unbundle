import { notFound } from "next/navigation";
import { PageContainer } from "@/components/dashboard/page-container";
import { CaseApprovals } from "@/components/uc/approvals/case-approvals";
import { loadCaseHead } from "@/components/uc/shell/case-data";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadCaseApprovals } from "@/lib/db/queries/uc-approvals";
import { canOpenShellPage } from "@/lib/uc/views/case-shell";

/**
 * Firme in attesa di chi guarda (DESIGN §3.11, WP9): il responsabile Lateral
 * Space, il responsabile del cliente e l'approvatore privacy; gli altri
 * ricevono 404. Elenco, poi una decisione alla volta («1 di 3») con lo stesso
 * `ApprovalRunner` del link di approvazione: stessi testi, stesse impronte,
 * stesso corpo al server (`{read: true, text_hash}`).
 *
 * Testata e accesso arrivano dal guscio (`loadCaseHead`, in cache per la
 * richiesta); le firme con i loro testi in un giro solo (`loadCaseApprovals`).
 * In pausa non si firma; a caso chiuso o in sola lettura non c'è nulla da firmare.
 */
export default async function SignaturesPage({ params }: { params: Promise<{ workspaceId: string; caseId: string }> }) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor, header } = await loadCaseHead(workspaceId, caseId, session.user.id, access.role);
  if (!canOpenShellPage("firme", caseAccess.roles)) notFound();
  const status = header.case.status;
  const paused = status === "sospeso";
  const signable = !caseAccess.readOnly && status !== "chiuso" && !paused;
  const loaded = signable ? await loadCaseApprovals(executor, { workspaceId, caseId, roles: caseAccess.roles }) : null;

  return (
    <PageContainer>
      <div className="max-w-2xl space-y-4">
        <h2 className="text-base font-semibold">Da firmare</h2>
        {paused ? (
          // In pausa non si firma: le firme in attesa restano, ma «Non ci sono firme» sarebbe falso. L'avviso della testata spiega la pausa.
          <p className="text-sm text-muted-foreground">Si firma di nuovo quando il caso riprende.</p>
        ) : (
          <CaseApprovals workspaceId={workspaceId} caseId={caseId} approvals={loaded?.approvals ?? []} roles={caseAccess.roles} />
        )}
      </div>
    </PageContainer>
  );
}
