import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import { READINESS_ANCHORS } from "@/lib/ai-readiness/dashboard-view";
import type { SemaforoColor } from "@/lib/uc/vocab";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { Fold } from "@/components/ui-10/fold";
import { InsightValidationActions } from "./insight-validation-actions";
import { IntelligenceActions } from "./intelligence-actions";
import { ShowAll } from "./show-all";

const I = READINESS_TEXT.insights;

export interface InsightView {
  id: string;
  /** Il tipo in parole («Sintesi», «Area più debole»), o null. */
  type: string | null;
  title: string;
  body: string;
  status: { label: string; tone: SemaforoColor };
  rawStatus: string;
  date: string;
}

export interface InsightsTabProps {
  workspaceId: string;
  assessmentId: string;
  /** Chi gestisce la rilevazione approva, segna come visto o scarta (come oggi). */
  manages: boolean;
  /** Chi valuta può generare la sintesi, quando le risposte bastano. */
  canGenerate: boolean;
  threshold: number;
  insights: readonly InsightView[];
  drafts: number;
  roadmap: ReadonlyArray<{ id: string; horizon: string; title: string; focus: string; metric: string }>;
  groups: ReadonlyArray<{ id: string; label: string; description: string; count: number }>;
  /** Il confronto, solo se attivo nella rilevazione. */
  comparison: string | null;
}

/**
 * «Insight» (rilascio 10, ondata 7b, §3.9; audit «Fuori» AD-8, §8.4): gli insight della sintesi, quelli da rivedere per
 * primi, con «Approva», «Segna come visto» e «Scarta» a chi gestisce; poi le tappe e i gruppi di use case in due pieghe
 * chiuse; il confronto solo se è attivo. Senza la riga «Evidence» in inglese di prima: la privacy si dice una volta, in
 * Impostazioni.
 */
export function InsightsTab(p: InsightsTabProps) {
  if (!p.insights.length) {
    return (
      <div data-slot="empty-state" className="space-y-3 rounded-xl border border-dashed p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">{p.canGenerate ? I.empty : I.emptyBelow(p.threshold)}</p>
        {p.canGenerate ? <IntelligenceActions workspaceId={p.workspaceId} assessmentId={p.assessmentId} /> : null}
      </div>
    );
  }
  return (
    <div className="space-y-8" data-slot="readiness-insights">
      <section id={READINESS_ANCHORS.insights} aria-labelledby="insight-titolo" className="scroll-mt-20 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="insight-titolo" className="text-base font-semibold">
            {I.listLabel}
            {p.drafts ? <span className="ml-2 text-sm font-normal text-muted-foreground">{I.toReview(p.drafts)}</span> : null}
          </h2>
          {p.canGenerate ? <IntelligenceActions workspaceId={p.workspaceId} assessmentId={p.assessmentId} /> : null}
        </div>
        <div className="space-y-3">
          <ShowAll items={p.insights} visible={3}>
            {(insight) => (
              <article key={insight.id} className="space-y-2 rounded-xl border bg-card p-4" data-insight-status={insight.rawStatus}>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{[insight.type, insight.date].filter(Boolean).join(" · ")}</span>
                  <StatusDot tone={insight.status.tone} label={insight.status.label} />
                </div>
                <h3 className="text-sm font-semibold break-words">{insight.title}</h3>
                <p className="text-sm text-muted-foreground break-words">{insight.body}</p>
                {p.manages ? <InsightValidationActions workspaceId={p.workspaceId} assessmentId={p.assessmentId} insightId={insight.id} status={insight.rawStatus} /> : null}
              </article>
            )}
          </ShowAll>
        </div>
      </section>

      <div>
        {p.roadmap.length ? (
          <Fold id={READINESS_ANCHORS.roadmap} title={I.roadmap} summary={I.roadmapSummary(p.roadmap.length)}>
            <ul className="mb-4 divide-y rounded-xl border bg-card">
              {p.roadmap.map((step) => (
                <li key={step.id} className="space-y-0.5 px-4 py-3 text-sm">
                  <p className="text-xs text-muted-foreground">{step.horizon}</p>
                  <p className="font-medium break-words">{step.title}</p>
                  <p className="text-muted-foreground break-words">{step.focus}</p>
                  {step.metric ? <p className="text-xs text-muted-foreground break-words">{I.metric(step.metric)}</p> : null}
                </li>
              ))}
            </ul>
          </Fold>
        ) : null}
        {p.groups.length ? (
          <Fold id="gruppi" title={I.groups} summary={I.groupsSummary(p.groups.length)}>
            <ul className="mb-4 divide-y rounded-xl border bg-card">
              {p.groups.map((group) => (
                <li key={group.id} className="space-y-0.5 px-4 py-3 text-sm">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-medium break-words">{group.label}</span>
                    <span className="text-muted-foreground">{I.groupCount(group.count)}</span>
                  </p>
                  <p className="text-muted-foreground break-words">{group.description}</p>
                </li>
              ))}
            </ul>
          </Fold>
        ) : null}
      </div>

      {p.comparison ? (
        <section aria-labelledby="confronto-titolo" className="space-y-1">
          <h2 id="confronto-titolo" className="text-base font-semibold">
            {I.comparison}
          </h2>
          <p className="text-sm text-muted-foreground">{p.comparison}</p>
        </section>
      ) : null}
    </div>
  );
}
