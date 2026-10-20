import { Lock } from "lucide-react";
import { SEMAFORO_TONE } from "@/components/uc/common/semaforo-tone";
import { cn } from "@/lib/utils";
import type { SemaforoColor } from "@/lib/uc/vocab";

/**
 * Stato come puntino più parola (DESIGN §5.1): il colore sta solo nel puntino,
 * il testo resta `text-foreground`. Le bloccate hanno il lucchetto. Lo stato
 * non si comunica mai solo con il colore: con `hideLabel` la parola resta per i
 * lettori di schermo.
 *
 * È l'unico stato del dossier e del link del referente. Va bene nel tema scuro
 * e dentro `.survey-light`.
 */
export interface StatusDotProps {
  tone: SemaforoColor;
  label: string;
  /** Sotto-stato in grigio (per Lateral Space). */
  sublabel?: string;
  hideLabel?: boolean;
  size?: "sm" | "md";
  title?: string;
  className?: string;
}

export function StatusDot({ tone, label, sublabel, hideLabel = false, size = "sm", title, className }: StatusDotProps) {
  const t = SEMAFORO_TONE[tone];
  return (
    <span
      data-slot="status-dot"
      title={title ?? (hideLabel ? label : undefined)}
      className={cn("inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle", size === "md" ? "text-sm" : "text-xs", className)}
    >
      {tone === "lucchetto" ? (
        <Lock className={cn("shrink-0", t.text, size === "md" ? "size-3.5" : "size-3")} aria-hidden />
      ) : (
        <span className={cn("shrink-0 rounded-full", t.fill, size === "md" ? "size-2" : "size-1.5")} aria-hidden />
      )}
      <span className={cn(hideLabel ? "sr-only" : "truncate font-medium text-foreground")}>{label}</span>
      {sublabel && <span className={cn(hideLabel ? "sr-only" : "truncate text-muted-foreground")}>{hideLabel ? `, ${sublabel}` : sublabel}</span>}
    </span>
  );
}
