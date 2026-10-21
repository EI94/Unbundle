import { Hammer, Megaphone } from "lucide-react";
import { KIND_LABEL } from "@/lib/use-cases/labels";
import type { UseCaseKind } from "@/lib/use-cases/types";
import { cn } from "@/lib/utils";

const ICONS = { Hammer, Megaphone } as const;

export interface KindLabelProps {
  /** Il tipo nell'area: `kindOf(portfolio_kind)` («Da costruire» anche per `NULL`). */
  kind: UseCaseKind;
  className?: string;
}

/**
 * Il tipo di uno use case (docs/use-case/DESIGN.md §3.3): icona più parola, «Da costruire»
 * (martello) o «Da diffondere» (megafono). L'icona non è mai sola. Solo per i revisori.
 */
export function KindLabel({ kind, className }: KindLabelProps) {
  const { label, icon } = KIND_LABEL[kind];
  const Icon = ICONS[icon];
  return (
    <span
      data-slot="kind-label"
      data-kind={kind}
      className={cn("inline-flex min-w-0 items-center gap-1 align-middle text-xs whitespace-nowrap text-muted-foreground", className)}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}
