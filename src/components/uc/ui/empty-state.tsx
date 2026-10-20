import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Stato vuoto (DESIGN §5.1): sostituisce `EmptyNote`, «Vuoto.» e «Nessun …».
 * `page` come lo stato vuoto di Use cases (riquadro tratteggiato al centro);
 * `inline` per una sezione dentro una pagina. Si usa solo quando il vuoto è
 * un'informazione: le sezioni vuote di solito si nascondono.
 */
export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  variant?: "page" | "inline";
  className?: string;
}

export function EmptyState({ icon: Icon, title, children, action, variant = "inline", className }: EmptyStateProps) {
  if (variant === "page") {
    return (
      <div data-slot="empty-state" className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center", className)}>
        {Icon && <Icon className="mb-4 size-10 text-muted-foreground" aria-hidden />}
        <p className="text-base font-semibold">{title}</p>
        {children && <div className="mt-2 max-w-sm text-sm text-muted-foreground">{children}</div>}
        {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
      </div>
    );
  }
  return (
    <div data-slot="empty-state" className={cn("flex flex-col gap-3 rounded-lg border border-dashed border-border p-4 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <div className="min-w-0 text-sm">
          <p className="font-medium">{title}</p>
          {children && <div className="mt-0.5 text-muted-foreground">{children}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}
