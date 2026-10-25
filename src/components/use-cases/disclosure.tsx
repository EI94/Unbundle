import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Un `<details>` chiuso di default, con la freccia come «Ipotesi di calcolo». */
export function Disclosure({ summary, slot, children, className }: { summary: string; slot?: string; children: ReactNode; className?: string }) {
  return (
    <details data-slot={slot} className={cn("group/disclosure", className)}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none select-none marker:hidden hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 shrink-0 transition-transform group-open/disclosure:rotate-90" />
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
