import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Titolo di una sezione (DESIGN §5.1, §5.4): H2 `text-base font-semibold`, con
 * un'azione a destra come link («Dettagli ›»). È l'unico titolo di sezione del
 * dossier: niente H2 con il nome della scheda.
 */
export interface SectionHeadingProps {
  title: string;
  action?: { label: string; href: string };
  id?: string;
  as?: "h2" | "h3";
  className?: string;
}

export function SectionHeading({ title, action, id, as: Heading = "h2", className }: SectionHeadingProps) {
  return (
    <div data-slot="section-heading" className={cn("flex min-w-0 items-baseline justify-between gap-3", className)}>
      <Heading id={id} className="min-w-0 text-base font-semibold">
        {title}
      </Heading>
      {action && (
        <Link
          href={action.href}
          className="inline-flex min-h-11 shrink-0 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-0"
        >
          {action.label}
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}
