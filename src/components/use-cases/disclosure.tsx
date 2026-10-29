import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { cn } from "@/lib/utils";

/**
 * Un `<details>` chiuso di default, con la freccia come «Ipotesi di calcolo». La freccia segue solo
 * il suo `<details>`: chiusa resta chiusa anche dentro un «Già a posto» aperto. `id`: un'ancora sul
 * `<details>` stesso, come «Realizzati» della Panoramica (`#panoramica-realizzati`). `defaultOpen`:
 * aperto quando la pagina si rende (un link che chiede quell'elenco, una ricerca in «Cosa serve»);
 * poi lo apre e lo chiude chi guarda, come ogni `<details>`. Un riassunto di testo non va a capo
 * dentro un numero né prima di un «·» (`keepTogether`).
 */
export function Disclosure({
  summary,
  slot,
  id,
  defaultOpen = false,
  children,
  className,
  summaryClassName,
}: {
  summary: ReactNode;
  slot?: string;
  id?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  summaryClassName?: string;
}) {
  return (
    <details id={id} data-slot={slot} className={className} open={defaultOpen || undefined}>
      <summary
        className={cn(
          "inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none select-none marker:hidden hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8 [&::-webkit-details-marker]:hidden",
          summaryClassName,
        )}
      >
        <ChevronRight aria-hidden className="size-4 shrink-0 transition-transform [[open]>summary>&]:rotate-90" />
        {typeof summary === "string" ? keepTogether(summary) : summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
