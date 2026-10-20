import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SEMAFORO_TONE } from "@/components/uc/common/semaforo-tone";
import { ProgressToGate } from "@/components/uc/ui/progress-to-gate";
import { StatusDot } from "@/components/uc/ui/status-dot";
import type { CaseHeadAlert, CaseTrail } from "@/lib/uc/views/case-shell";
import type { SemaforoColor } from "@/lib/uc/vocab";
import { cn } from "@/lib/utils";
import { CaseMenu, CaseStepButton, CaseTrailNav, type CaseMenuEntry, type CaseStepView } from "./case-menu";

/**
 * Testata del dossier (DESIGN §3.3): percorso «Use case › XX-0012 ›
 * Realizzazione», titolo e stato, la frase, un solo numero di avanzamento, il
 * pulsante primario del motore del prossimo passo e il menu «⋯». Al massimo un
 * avviso. Il codice sta solo nel percorso.
 *
 * Componente server e solo presentazione: i dati arrivano da `uc-header.ts`
 * (un giro, prontezza in cache) attraverso il layout del caso.
 */
export interface CaseHeaderProps {
  trail: CaseTrail;
  /** «Realizzazione» porta alla Panoramica solo a chi la può aprire. */
  overviewLinkable: boolean;
  title: string;
  oneLiner: string | null;
  status: { tone: SemaforoColor; label: string };
  /** Configurazione da completare, per chi non gestisce il workspace. */
  readOnlyBadge: boolean;
  alert: (CaseHeadAlert & { href: string | null }) | null;
  progress: { ok: number; required: number; inReview: number; href: string | null; audience: "ls" | "cliente" } | null;
  step: CaseStepView | null;
  menu: readonly CaseMenuEntry[];
}

export const CASE_HEADER_ID = "uc-case-header";

function Alert({ alert }: { alert: NonNullable<CaseHeaderProps["alert"]> }) {
  const tone = SEMAFORO_TONE[alert.tone];
  return (
    <div role="status" className={cn("mb-3 flex flex-col gap-2 rounded-lg px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between", tone.bg)}>
      <p className="flex min-w-0 items-start gap-2">
        <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", tone.text)} aria-hidden />
        <span className="min-w-0 break-words">{alert.text}</span>
      </p>
      {alert.action && alert.href && (
        <Link href={alert.href} className="inline-flex min-h-11 shrink-0 items-center gap-0.5 font-medium underline-offset-4 hover:underline sm:min-h-0">
          {alert.action.label}
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}

export function CaseHeader({ trail, overviewLinkable, title, oneLiner, status, readOnlyBadge, alert, progress, step, menu }: CaseHeaderProps) {
  return (
    <section id={CASE_HEADER_ID} aria-labelledby="uc-case-title" className="min-w-0 pt-6">
      {alert && <Alert alert={alert} />}

      <div className="flex min-w-0 items-center justify-between gap-3">
        <CaseTrailNav trail={trail} overviewLinkable={overviewLinkable} />
        {menu.length > 0 && <CaseMenu items={menu} className="sm:hidden" />}
      </div>

      <div className="mt-1 grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
            <h1 id="uc-case-title" className="min-w-0 text-2xl font-semibold tracking-tight break-words sm:text-3xl">
              {title}
            </h1>
            <span className="flex items-center gap-2">
              <StatusDot tone={status.tone} label={status.label} size="md" />
              {readOnlyBadge && <Badge variant="outline">Sola lettura</Badge>}
            </span>
          </div>
          {oneLiner && (
            <p title={oneLiner} className="mt-1 line-clamp-2 max-w-3xl text-sm break-words text-muted-foreground sm:line-clamp-1">
              {oneLiner}
            </p>
          )}
        </div>

        {(step || menu.length > 0) && (
          <div className="order-last flex min-w-0 items-start gap-2 sm:order-none">
            {step && <CaseStepButton step={step} className="w-full sm:w-auto" />}
            {menu.length > 0 && <CaseMenu items={menu} className="hidden sm:inline-flex" />}
          </div>
        )}

        {progress && (
          <div className="min-w-0 sm:col-span-2 sm:max-w-xl">
            <ProgressToGate ok={progress.ok} required={progress.required} inReview={progress.inReview} size="md" href={progress.href ?? undefined} audience={progress.audience} />
          </div>
        )}
      </div>
    </section>
  );
}
