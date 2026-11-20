import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { SEMAFORO_TONE } from "@/components/uc/common/semaforo-tone";
import { StatusDot } from "@/components/uc/ui/status-dot";
import type { CaseHeadAlert, CaseTrail } from "@/lib/uc/views/case-shell";
import type { SemaforoColor } from "@/lib/uc/vocab";
import { cn } from "@/lib/utils";
import { CaseMenu, CaseStepButton, CaseTrailNav, type CaseMenuEntry, type CaseStepView } from "./case-menu";
import { CaseHeadProgress } from "./case-tabs";

/**
 * Testata del dossier (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5), uguale in
 * tutte le schede, con cinque elementi: il percorso «Use case › XX-0012 ›
 * Realizzazione», il titolo (sempre quello dello use case), lo stato a puntino
 * con la parola, il pulsante pieno del prossimo passo con icona e «?» (sotto
 * l'etichetta «Prossimo passo») e il menu «⋯». L'avanzamento è un numero
 * piccolo accanto allo stato, ma non sulla Panoramica, che ha il numero
 * grande. Al massimo un avviso, e solo se il pulsante pieno non dice già la
 * stessa cosa (`caseHeadAlert`). Il codice sta solo nel percorso.
 *
 * Componente server e solo presentazione: i dati arrivano da `uc-header.ts`
 * (un giro, prontezza in cache) attraverso il layout del caso.
 */
export interface CaseHeaderProps {
  trail: CaseTrail;
  title: string;
  status: { tone: SemaforoColor; label: string };
  /** Già completo: il link dell'avviso è un indirizzo intero. */
  alert: (Omit<CaseHeadAlert, "action"> & { action: { label: string; href: string } | null }) | null;
  /** L'avanzamento piccolo (dalla cache); null se chi guarda non apre la Panoramica o la cache manca. */
  progress: { ok: number; required: number; inReview: number; audience: "ls" | "cliente" } | null;
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
      {alert.action && (
        <Link href={alert.action.href} className="inline-flex min-h-11 shrink-0 items-center gap-0.5 font-medium underline-offset-4 hover:underline sm:min-h-0">
          {alert.action.label}
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}

export function CaseHeader({ trail, title, status, alert, progress, step, menu }: CaseHeaderProps) {
  return (
    <section id={CASE_HEADER_ID} aria-labelledby="uc-case-title" className="min-w-0 pt-6">
      {alert && <Alert alert={alert} />}

      <CaseTrailNav trail={trail} />

      <div className="mt-1 flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
          <h1 id="uc-case-title" className="min-w-0 text-2xl font-semibold tracking-tight break-words">
            {title}
          </h1>
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <StatusDot tone={status.tone} label={status.label} size="md" />
            {progress && <CaseHeadProgress ok={progress.ok} required={progress.required} inReview={progress.inReview} audience={progress.audience} />}
          </span>
        </div>
        {menu.length > 0 && <CaseMenu items={menu} className="shrink-0" />}
      </div>

      {step && <CaseStepButton step={step} withLabel className="mt-4" />}
    </section>
  );
}
