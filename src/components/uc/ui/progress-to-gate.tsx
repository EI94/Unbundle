import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCountIt } from "@/lib/uc/views/format";

/**
 * L'unico numero di avanzamento (DESIGN §0 e §5.1): «0 di 245 indispensabili
 * a posto». Verde per «a posto», giallo al 40% per «da verificare».
 *
 * - `sm`: card della Roadmap e capitolo «Realizzazione» («0 di 245 a posto»).
 * - `md`: testata del dossier («indispensabili» da `sm` in su), di solito come
 *   link a `/via`.
 * - `lg`: Panoramica e `/via`, con il numero grande.
 *
 * Senza domande indispensabili non si mostra nulla (lo zero non si mostra).
 */
export interface ProgressToGateProps {
  ok: number;
  required: number;
  /** Indispensabili in verifica: la parte gialla della barra. */
  inReview?: number;
  size?: "sm" | "md" | "lg";
  href?: string;
  audience?: "ls" | "cliente";
  className?: string;
}

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(max, Number.isFinite(n) ? Math.round(n) : 0));
}

export function ProgressToGate({ ok, required, inReview = 0, size = "md", href, audience = "ls", className }: ProgressToGateProps) {
  const total = Number.isFinite(required) ? Math.round(required) : 0;
  if (total <= 0) return null;
  const done = clamp(ok, total);
  const review = clamp(inReview, total - done);
  const okPct = (done / total) * 100;
  const reviewPct = (review / total) * 100;
  const count = `${formatCountIt(done)} di ${formatCountIt(total)}`;
  const reviewWord = audience === "cliente" ? "in verifica" : "da verificare";
  const aria = `${count} domande indispensabili a posto${review > 0 ? `, ${formatCountIt(review)} ${reviewWord}` : ""}`;

  const bar = (
    <span
      role="progressbar"
      aria-label="Domande indispensabili a posto"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={aria}
      className={cn("relative flex w-full min-w-12 overflow-hidden rounded-full bg-muted", size === "sm" ? "h-1.5" : size === "md" ? "h-2" : "h-2.5")}
    >
      <span className="h-full bg-uc-verde" style={{ width: `${okPct}%` }} />
      {review > 0 && <span className="h-full bg-uc-giallo/40" style={{ width: `${reviewPct}%` }} />}
    </span>
  );

  if (size === "lg") {
    return (
      <div data-slot="progress-to-gate" className={cn("min-w-0 space-y-2", className)}>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{count}</p>
        <p className="text-sm text-muted-foreground">domande indispensabili a posto</p>
        {bar}
      </div>
    );
  }

  const text = (
    <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:text-sm">
      <span className="font-medium text-foreground">{count}</span> {size === "md" && <span className="hidden sm:inline">indispensabili </span>}a posto
    </span>
  );
  const body = (
    <>
      <span className="flex min-w-0 flex-1 items-center">{bar}</span>
      {text}
      {href && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
    </>
  );
  const row = cn("flex min-w-0 items-center gap-3", className);
  if (href) {
    return (
      <Link href={href} data-slot="progress-to-gate" className={cn(row, "rounded-md hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none")}>
        {body}
      </Link>
    );
  }
  return (
    <div data-slot="progress-to-gate" className={row}>
      {body}
    </div>
  );
}
