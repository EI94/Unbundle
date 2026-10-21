import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { Button } from "@/components/ui/button";
import { StartRealizationForm } from "@/components/uc/shell/create-wizard";
import { SectionUnavailable } from "@/components/uc/shell/section-unavailable";
import { EmptyState } from "@/components/uc/ui/empty-state";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { UcAccessError, ensureUcAvailable, getUcUserContext, isUcEnabledFor } from "@/lib/db/queries/uc-access";
import { readStartContext } from "@/lib/db/queries/uc-realization";
import { listTemplatesForWorkspace } from "@/lib/db/queries/uc-templates";
import { realizationPrefillOf } from "@/lib/db/queries/use-case-dossiers";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { checkCaseCreator } from "@/lib/uc/permissions";
import { REALIZATION_TEXT, startDefaults } from "@/lib/uc/views/realization";
import { HUB_VIEWS, HUB_VIEW_PARAM, stubLogEntry } from "@/lib/use-cases/legacy-routes";
import { PREFILL_TEXT, type PrefillRow } from "@/lib/use-cases/realization-prefill";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { canManageWorkspaceSettings, canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import { UUID } from "@/lib/uc/ids";

/**
 * «Avvia la realizzazione» (DESIGN §3.2): una schermata, raggiunta dal capitolo
 * «Realizzazione» della scheda dello use case con `?useCaseId=`. Solo Lateral
 * Space (`checkCaseCreator` più `canReviewWorkspacePortfolio`), solo per uno
 * use case «Da costruire» approvato e senza dossier:
 * - con il dossier già avviato rimanda al dossier chi lo può aprire (membro, o
 *   chi gestisce il workspace), gli altri alla scheda dello use case;
 * - per una best practice, uno use case non approvato o chi non può avviare,
 *   rimanda alla scheda dello use case.
 * Senza `useCaseId` il redirect verso «Priorità» lo fa `src/proxy.ts` (307,
 * fuori da `loading.tsx`) con l'area «Use case» accesa; con uno use case che non
 * c'è o non è del workspace lo fa questa pagina (sotto `loading.tsx` è un 200 con
 * una meta refresh). Con l'area spenta dice dove si parte. Sezione spenta per il
 * workspace: 404.
 *
 * Una scheda arrivata dal connettore (`intake.contractVersion = 2`, decisione del
 * 19/10/2026) parte precompilata: «In una frase» con il problema (al massimo 500
 * caratteri) e, accanto, in sola lettura, i dati raccolti da Claude che entrano
 * nel dossier (`realizationPrefillOf`).
 */
export default async function StartRealizationPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  if (!isUcEnabledFor(workspaceId)) notFound();
  try {
    await ensureUcAvailable(workspaceId);
  } catch (error) {
    if (error instanceof UcAccessError && error.code === "non_disponibile") return <SectionUnavailable />;
    if (error instanceof UcAccessError && error.code === "disattivata") notFound();
    throw error;
  }
  const ws = `/dashboard/${workspaceId}`;
  const sp = await searchParams;
  const raw = Array.isArray(sp.useCaseId) ? sp.useCaseId[0] : sp.useCaseId;
  const useCaseId = typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : null;

  const executor = await getAppUcExecutor();
  const context = useCaseId ? await readStartContext(executor, { workspaceId, useCaseId, userId: session.user.id }) : null;
  if (!context && isUseCaseHubWorkspace(workspaceId)) {
    // Un dossier nasce solo da uno use case (DESIGN §2.3, §6.5): si sceglie in «Priorità».
    console.info(JSON.stringify(stubLogEntry("/casi-duso/nuovo")));
    redirect(`${ws}/use-cases?${HUB_VIEW_PARAM}=${HUB_VIEWS.priorita}`);
  }
  if (!context) {
    return (
      <PageContainer size="narrow">
        <h1 className="sr-only">{REALIZATION_TEXT.start}</h1>
        <EmptyState
          variant="page"
          title="Avvia la realizzazione dalla scheda di uno use case"
          action={
            <Button variant="outline" className="h-11 sm:h-8" render={<Link href={`${ws}/use-cases`} />} nativeButton={false}>
              Vai agli use case
            </Button>
          }
        >
          Un dossier parte da uno use case approvato, dal capitolo «Realizzazione» della sua scheda.
        </EmptyState>
      </PageContainer>
    );
  }

  const scheda = `${ws}/use-cases/${context.useCaseId}`;
  // Già avviato: al dossier chi lo apre (membro, o chi gestisce il workspace), alla scheda gli altri.
  if (context.existingCaseId) redirect(context.existingCaseMember || canManageWorkspaceSettings(access.role) ? `${ws}/casi-duso/${context.existingCaseId}` : scheda);
  const user = await getUcUserContext(session.user.id);
  const creator = user ? checkCaseCreator({ user, canReviewWorkspacePortfolio: canReviewWorkspacePortfolio(access.role) }) : null;
  if (!creator?.ok || context.kind !== "use_case_ai" || context.status !== "accepted") redirect(scheda);

  const codeMissing = context.hasCodeColumn && !context.code;
  const [templates, prefill] = await Promise.all([
    codeMissing ? [] : listTemplatesForWorkspace(executor, workspaceId),
    realizationPrefillOf(workspaceId, context.useCaseId),
  ]);
  const defaults = prefill ? { ...startDefaults(context.texts), oneLiner: prefill.oneLiner } : startDefaults(context.texts);
  const crumb = context.code ?? context.title;

  return (
    <PageContainer size="narrow">
      <nav aria-label="Percorso" className="mb-3 flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        <Link href={`${ws}/use-cases`} className="inline-flex min-h-11 shrink-0 items-center hover:text-foreground sm:min-h-0">
          Use case
        </Link>
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
        <Link href={scheda} className={`inline-flex min-h-11 min-w-0 items-center hover:text-foreground sm:min-h-0 ${context.code ? "shrink-0 font-mono" : "truncate"}`}>
          <span className="truncate">{crumb}</span>
        </Link>
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate text-foreground" aria-current="page">
          {REALIZATION_TEXT.start}
        </span>
      </nav>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">{REALIZATION_TEXT.start}</h1>
      {codeMissing ? (
        <EmptyState
          title={REALIZATION_TEXT.noPrefix}
          action={
            <Button variant="outline" className="h-11 sm:h-8" render={<Link href={`${ws}/settings`} />} nativeButton={false}>
              Apri le Impostazioni
            </Button>
          }
        />
      ) : (
        <StartRealizationForm
          workspaceId={workspaceId}
          useCase={{ id: context.useCaseId, code: context.code, title: context.title }}
          defaults={defaults}
          templates={[...templates]
            .sort((a, b) => Number(b.restricted) - Number(a.restricted) || a.name.localeCompare(b.name, "it"))
            .map((t) => ({ id: t.id, name: t.name, questions: t.questions, restricted: t.restricted }))}
        />
      )}
      {!codeMissing && prefill && prefill.rows.length > 0 ? <CollectedByClaude rows={prefill.rows} /> : null}
    </PageContainer>
  );
}

/** «Dati raccolti da Claude», in sola lettura accanto a «In una frase»: entrano così nel dossier. */
function CollectedByClaude({ rows }: { rows: readonly PrefillRow[] }) {
  return (
    <section aria-labelledby="dati-raccolti-titolo" data-slot="collected-by-claude" className="mt-6 min-w-0 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <h2 id="dati-raccolti-titolo" className="text-sm font-medium">
        {PREFILL_TEXT.title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{PREFILL_TEXT.hint}</p>
      <dl className="mt-4 grid min-w-0 gap-3">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className="mt-0.5 text-sm break-words whitespace-pre-line">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
