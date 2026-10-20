import "server-only";
import type { Session } from "@/lib/auth";
import { requireDossierRole } from "@/components/uc/shell/case-data";
import type { CaseAccess } from "@/lib/db/queries/uc-access";
import type { UcViewer } from "@/lib/db/queries/uc-views";
import type { UcExecutor } from "@/lib/db/uc-executor";
import { UC_PAGE_ROLES, type UcViewPage } from "@/lib/uc/views/page-access";
import type { WorkspaceAccess } from "@/lib/workspace-access";

/**
 * Accesso a una pagina del caso costruita da WP9, dopo `requireWorkspacePage(`
 * (che ogni pagina chiama da sé): flag `UC_ENABLED`, caso del workspace, ruoli di
 * caso che valgono adesso e ruoli ammessi per la pagina (`UC_PAGE_ROLES`).
 * Altrimenti 404, come le altre pagine della sezione.
 */
export async function openCaseView(i: {
  workspaceId: string;
  caseId: string;
  session: Session;
  access: Pick<WorkspaceAccess, "role">;
  page: UcViewPage;
}): Promise<{ caseAccess: CaseAccess; executor: UcExecutor; viewer: UcViewer }> {
  // Lo stesso giro della testata (accesso e testata insieme), già fatto dal layout nella stessa richiesta.
  const { caseAccess, executor } = await requireDossierRole({
    workspaceId: i.workspaceId,
    caseId: i.caseId,
    userId: i.session.user.id,
    workspaceRole: i.access.role,
    allow: UC_PAGE_ROLES[i.page],
  });
  return {
    caseAccess,
    executor,
    viewer: { workspaceId: i.workspaceId, caseId: i.caseId, roles: caseAccess.roles, user: caseAccess.user, readOnly: caseAccess.readOnly },
  };
}
