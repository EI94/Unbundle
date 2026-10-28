import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Un `<details>` chiuso di default, con la freccia come «Ipotesi di calcolo». La freccia segue solo
 * il suo `<details>`: chiusa resta chiusa anche dentro un «Già a posto» aperto.
 */
export function Disclosure({
  summary,
  slot,
  children,
  className,
  summaryClassName,
}: {
  summary: ReactNode;
  slot?: string;
  children: ReactNode;
  className?: string;
  summaryClassName?: string;
}) {
  return (
    <details data-slot={slot} className={className}>
      <summary
        className={cn(
          "inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none select-none marker:hidden hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8 [&::-webkit-details-marker]:hidden",
          summaryClassName,
        )}
      >
        <ChevronRight aria-hidden className="size-4 shrink-0 transition-transform [[open]>summary>&]:rotate-90" />
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
