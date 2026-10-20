import { notFound } from "next/navigation";
import { PageContainer } from "@/components/dashboard/page-container";
import { openCaseView } from "@/components/uc/catalog/case-page";
import { QuestionReviewCard } from "@/components/uc/catalog/item-sections";
import { casePath } from "@/components/uc/catalog/paths";
import { ReviewMode } from "@/components/uc/catalog/review-mode";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadReviewQueue } from "@/lib/db/queries/uc-questions";
import { loadItemDetail } from "@/lib/db/queries/uc-views";
import { reviewActionPlan } from "@/lib/uc/views/item-detail";
import { mineExcludedText, parseReviewSlot, reviewPosition } from "@/lib/uc/views/verification";
import { questionDetailModel } from "../question-model";

/**
 * «Verifica una alla volta» (DESIGN §3.6.4), la destinazione del primario
 * «Verifica 160 risposte»: solo per chi valida. La coda è quella dei quattro
 * occhi (le risposte di chi guarda le verifica un collega), dalla più vecchia;
 * la scheda aperta è `?voce=<id>`, con `?posto=` se nel frattempo è uscita
 * dalla coda. La testata del caso si riduce alla sola riga della verifica.
 */
export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor, viewer } = await openCaseView({ workspaceId, caseId, session, access, page: "verifica" });
  const sp = await searchParams;
  const requested = typeof sp.voce === "string" ? sp.voce : null;
  const queue = await loadReviewQueue(executor, viewer);
  const position = reviewPosition(queue.ids, requested, parseReviewSlot(sp.posto));
  const detail = position.currentId ? await loadItemDetail(executor, viewer, position.currentId) : null;
  if (position.currentId && !detail) notFound();
  const model = detail ? questionDetailModel(detail, { workspaceId, caseId, roles: viewer.roles, readOnly: viewer.readOnly, now: new Date() }) : null;
  const writable = !viewer.readOnly && caseAccess.status !== "chiuso" && caseAccess.status !== "sospeso";

  return (
    <PageContainer>
      {/* Solo la riga della verifica: testata e schede del caso si nascondono su questa pagina (§3.6.4). */}
      <style>{"[data-uc-case-head]{display:none}"}</style>
      <ReviewMode
        // Una scheda nuova riparte pulita: niente modulo aperto né testo della scheda di prima.
        key={position.currentId ?? "fine"}
        baseHref={casePath(workspaceId, caseId, "domande/verifica")}
        exitHref={`${casePath(workspaceId, caseId, "domande")}?vista=da-verificare`}
        panoramicaHref={casePath(workspaceId, caseId)}
        position={position}
        card={model ? <QuestionReviewCard model={model} /> : null}
        actions={writable && model?.actions ? { ...model.actions, plan: reviewActionPlan(model.actions.plan) } : null}
        canValidate={detail?.actions.validate?.ok === true}
        mineNote={mineExcludedText(queue.mine, "fine")}
      />
    </PageContainer>
  );
}
