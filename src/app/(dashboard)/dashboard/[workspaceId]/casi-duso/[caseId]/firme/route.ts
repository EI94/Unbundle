import type { NextRequest } from "next/server";
import { notFound } from "next/navigation";
import { signaturesPanelHref } from "@/components/uc/approvals/approval-texts";
import { casePath } from "@/components/uc/catalog/paths";
import { findDossierAccess } from "@/components/uc/shell/case-data";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { UcAccessError } from "@/lib/db/queries/uc-access";
import { canOpenShellPage, landingSegment } from "@/lib/uc/views/case-shell";

/**
 * `/firme` (rilascio 10, §2.4 e §8.2): le firme sono un pannello (`?firma=1`) su ogni pagina della realizzazione. Questo
 * indirizzo, che arriva dai link di oggi (il passo della testata, la Panoramica, `/via`, le domande), porta con un 308
 * alla pagina d'arrivo di chi firma con il pannello aperto e la query di prima: la Panoramica, o Privacy per
 * l'approvatore privacy. Chi non firma riceve 404, come prima; senza sessione si passa dal login e si torna qui.
 *
 * È una route e non una pagina: sotto `loading.tsx` una pagina parte in streaming e il redirect diventerebbe un 200 con
 * meta refresh (`loading.md`, «Status codes»); la route risponde subito 308. Legge solo l'accesso al caso. Il 308
 * dipende da chi guarda (la pagina d'arrivo, o 404): `Cache-Control: private, no-store`, così il browser non lo ricorda.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string; caseId: string }> }) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  let landing: string | null | undefined = null;
  try {
    const caseAccess = await findDossierAccess({ workspaceId, caseId, userId: session.user.id, workspaceRole: access.role });
    if (!caseAccess || !canOpenShellPage("firme", caseAccess.roles)) notFound();
    landing = landingSegment(caseAccess.roles);
  } catch (error) {
    // «Sezione non disponibile»: la dice il guscio, alla radice della realizzazione.
    if (!(error instanceof UcAccessError)) throw error;
  }
  const location = signaturesPanelHref(casePath(workspaceId, caseId), landing, request.nextUrl.searchParams);
  return new Response(null, { status: 308, headers: { Location: location, "Cache-Control": "private, no-store" } });
}
