"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, Eye, Link2, Play, Sparkles, type LucideIcon } from "lucide-react";
import { generateAiReadinessInsightsAction, updateAiReadinessAssessmentStatusAction, type AiReadinessActionState } from "@/lib/actions/ai-readiness";
import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import type { ReadinessStep, ReadinessStepKind } from "@/lib/ai-readiness/dashboard-view";
import type { SemaforoColor } from "@/lib/uc/vocab";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { NextStep, type NextStepItem } from "@/components/ui-10/next-step";
import { notifyDone } from "@/components/ui-10/toast";
import { AssessmentActions } from "./assessment-actions";
import { AssessmentSwitcher, type AssessmentOption } from "./assessment-switcher";
import { useOpenLink } from "./open-link";

const T = READINESS_TEXT;
const INITIAL: AiReadinessActionState = { ok: true };

/** L'icona del pulsante pieno, per passo: decorativa, il verbo dice tutto. */
const STEP_ICON: Readonly<Record<ReadinessStepKind, LucideIcon>> = {
  open: Play,
  create_link: Link2,
  copy_link: Copy,
  synthesis: Sparkles,
  review: Eye,
  report: Download,
};

export interface ReadinessHeaderProps {
  workspaceId: string;
  assessmentId: string;
  title: string;
  options: readonly AssessmentOption[];
  /** «Nuova rilevazione» (`?new=1`), solo per chi gestisce. */
  newHref: string | null;
  status: { label: string; tone: SemaforoColor };
  /** «46 risposte su 120 attese · bastano 5 per i risultati». */
  summary: string;
  /** Con la raccolta aperta (la pagina si aggiorna da sola): «aggiornato alle 10:42». */
  updated: string | null;
  step: ReadinessStep;
  /** Dove portano «Rivedi N insight» e la sintesi appena generata: la scheda Insight. */
  insightsHref: string;
  /** Il report in PDF (la rotta dell'export di oggi). */
  reportHref: string;
  menu: {
    status: string;
    respondentCount: number;
    completedCount: number;
    manages: boolean;
    reviews: boolean;
    questionsHref: string;
  };
}

/**
 * La testata della rilevazione (rilascio 10, ondata 7b, §3.9): il titolo è il menu delle rilevazioni con «Nuova
 * rilevazione»; accanto il «⋯»; sotto lo stato (puntino più parola) e la riga «46 risposte su 120 attese · bastano 5
 * per i risultati»; poi il prossimo passo, l'unico pulsante pieno della pagina, che segue lo stato
 * (`readinessNextStep`). Le azioni sono quelle di oggi: aprire la raccolta, il link per tutti, la sintesi (nessuna
 * chiamata a un modello: la sintesi è fatta di regole), il report.
 */
export function ReadinessHeader(p: ReadinessHeaderProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const link = useOpenLink({ workspaceId: p.workspaceId, assessmentId: p.assessmentId });
  const busy = pending || link.pending;

  function run(task: () => Promise<AiReadinessActionState<unknown>>, then?: () => void) {
    if (busy) return;
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        setError(result.message ?? T.step.failed);
        return;
      }
      if (result.message) notifyDone(result.message);
      then?.();
    });
  }

  const s = p.step;
  const item: NextStepItem = { label: busy && s.mine ? T.step.pending : s.label, icon: STEP_ICON[s.kind], why: s.why, mine: s.mine, turn: s.turn };
  if (s.mine) {
    if (s.kind === "open") item.onClick = () => run(() => updateAiReadinessAssessmentStatusAction(p.workspaceId, p.assessmentId, "open", INITIAL, new FormData()));
    else if (s.kind === "create_link") item.onClick = () => !busy && link.create();
    else if (s.kind === "copy_link") item.onClick = () => !busy && link.copy();
    else if (s.kind === "synthesis")
      item.onClick = () => run(() => generateAiReadinessInsightsAction(p.workspaceId, p.assessmentId, INITIAL, new FormData()), () => router.push(p.insightsHref, { scroll: false }));
    else if (s.kind === "review") item.href = p.insightsHref;
    // Il report: un link vero con `download`, mai un `<Link>` (il prefetch genererebbe il file a ogni visita).
    else item.link = <a href={p.reportHref} download />;
  }
  const message = error ?? link.error;

  return (
    <header className="space-y-5" data-slot="readiness-header">
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <AssessmentSwitcher title={p.title} currentId={p.assessmentId} options={p.options} newHref={p.newHref} />
          <AssessmentActions
            workspaceId={p.workspaceId}
            assessmentId={p.assessmentId}
            assessmentName={p.title}
            status={p.menu.status}
            respondentCount={p.menu.respondentCount}
            completedCount={p.menu.completedCount}
            manages={p.menu.manages}
            reviews={p.menu.reviews}
            questionsHref={p.menu.questionsHref}
          />
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground" data-slot="readiness-summary">
          <StatusDot tone={p.status.tone} label={p.status.label} size="md" />
          <span aria-hidden>·</span>
          <span>{p.summary}</span>
          {p.updated ? (
            <>
              <span aria-hidden>·</span>
              <span className="text-xs">{p.updated}</span>
            </>
          ) : null}
        </p>
      </div>
      <div className="space-y-2">
        <NextStep id="ai-readiness-passo" step={item} />
        {message ? (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        ) : null}
      </div>
      {link.dialog}
    </header>
  );
}
