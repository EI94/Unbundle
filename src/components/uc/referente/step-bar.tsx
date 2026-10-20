"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { progressValueText } from "@/lib/uc/views/referente-plan";
import { BackLink, TEXT_BUTTON_CLASS } from "./screen";
import { useKeyboardOpen, usePhone } from "./use-device";

/**
 * Barre del passo (DESIGN §4.3 R2, §4.7):
 * - in alto, 44 px: «‹ Argomenti» e «Rispondi dopo»; sotto, «Prezzi e sconti ·
 *   3 di 12» e «Salvato» (solo dopo la prima modifica), con l'avanzamento di
 *   3 px;
 * - in basso (`ActionBar`): fissa al telefono con lo spazio della zona sicura,
 *   di nuovo nel flusso quando la tastiera è aperta; sotto il campo dal
 *   computer.
 */
export function StepBar({
  backHref,
  backLabel = "Argomenti",
  context,
  n,
  total,
  saved,
  onSkip,
}: {
  backHref: string;
  backLabel?: string;
  /** Nome dell'argomento («Prezzi e sconti»). */
  context: string;
  n: number;
  total: number;
  /** «Salvato»: solo dopo la prima modifica di questa visita. */
  saved: boolean;
  onSkip?: () => void;
}) {
  const pct = total > 0 ? Math.round((100 * Math.min(n, total)) / total) : 0;
  return (
    <div className="space-y-1">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <BackLink href={backHref}>{backLabel}</BackLink>
        {onSkip ? (
          <Button type="button" variant="ghost" className={TEXT_BUTTON_CLASS} onClick={onSkip}>
            Rispondi dopo
          </Button>
        ) : null}
      </div>
      <div className="flex items-baseline justify-between gap-3 text-sm text-muted-foreground">
        <p className="min-w-0 break-words">
          {context} · {n} di {total}
        </p>
        <p className="shrink-0">{saved ? "Salvato" : ""}</p>
      </div>
      <div className="h-[3px] overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={n} aria-valuetext={`Domanda ${n} di ${total}`} aria-label="Domande dell'argomento">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Barra dell'avanzamento della Home, 6 px, con «36 risposte su 112» per i lettori di schermo. */
export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((100 * done) / total) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={progressValueText(done, total)} aria-label={label}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Barra delle azioni in basso. Al telefono è fissa, con
 * `padding-bottom: max(12px, env(safe-area-inset-bottom))`; con la tastiera
 * aperta torna nel flusso e non copre il campo. Dal computer sta sotto il campo.
 */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  const phone = usePhone();
  const keyboard = useKeyboardOpen();
  const fixed = phone && !keyboard;
  return (
    <>
      {fixed ? <div aria-hidden className="h-32" /> : null}
      <div
        data-uc-action-bar=""
        className={cn(
          fixed
            ? "fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/85"
            : "mt-6",
        )}
      >
        <div className={cn("mx-auto flex w-full max-w-xl min-w-0 items-center gap-3", className)}>{children}</div>
      </div>
    </>
  );
}
