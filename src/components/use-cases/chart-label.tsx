import type { ReactNode } from "react";
import Link from "next/link";
import { titleAgent } from "@/lib/use-cases/agents";
import { formatInteger } from "@/lib/use-cases/format";
import { SCREEN_SEPARATOR, keepTogether } from "@/lib/use-cases/line-breaks";
import { labelWidthPx } from "@/lib/use-cases/matrix-labels";
import { cn } from "@/lib/utils";
import { Disclosure } from "./disclosure";

/** Un carattere del tag accanto ai punti: monospazio a 10 px, 6 px misurati nel browser. */
export const CHART_LABEL_CHAR_PX = 6;

/**
 * Il tag («LIBRA L1») o il codice accanto a un punto dei grafici del menu «⋯», dove
 * `placeMatrixLabels` l'ha trovato libero. È testo SVG con un alone del colore della pagina
 * (`paint-order: stroke`, il bordo sotto il riempimento): resta leggibile sopra la griglia e le
 * linee tratteggiate senza il riquadro opaco di prima, che copriva i punti vicini. Dentro il link
 * del punto: al passaggio del mouse passa al colore pieno. Nascosto ai lettori di schermo, che
 * sentono il titolo nel nome del link.
 */
export function ChartLabel({ text, dx, dy, slot, className }: { text: string; dx: number; dy: number; slot: string; className?: string }) {
  return (
    <svg
      aria-hidden
      data-slot={slot}
      width={labelWidthPx(text, CHART_LABEL_CHAR_PX)}
      height={13}
      className={cn("pointer-events-none absolute overflow-visible font-mono text-[10px]", className)}
      style={{ left: `calc(50% + ${dx}px)`, top: `calc(50% + ${dy}px)` }}
    >
      <text x={2} y={10} paintOrder="stroke" strokeWidth={3} strokeLinejoin="round" className="fill-muted-foreground stroke-background group-hover:fill-foreground">
        {text}
      </text>
    </svg>
  );
}

/**
 * Uno use case negli elenchi sotto i grafici (e al loro posto al telefono): il segno del grafico
 * (`marker`), il tag dell'agente o il codice, il titolo su due righe al massimo come nelle card
 * della Panoramica, sotto `detail`; a destra `aside` (una cifra). Apre il pannello e resta nella pagina.
 */
export function ChartUseCaseLink({
  href,
  code,
  title,
  marker,
  detail,
  aside,
}: {
  href: string;
  code: string | null;
  title: string;
  marker?: ReactNode;
  detail?: ReactNode;
  aside?: ReactNode;
}) {
  const agent = titleAgent(title);
  const ref = agent?.label ?? code;
  return (
    <Link
      href={href}
      scroll={false}
      data-slot="chart-use-case"
      className="flex min-h-11 items-start gap-2 rounded-md px-1 py-1.5 text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {marker ? <span className="flex h-5 shrink-0 items-center">{marker}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 break-words">
          {ref ? <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{ref}</span> : null}
          {ref ? " " : null}
          {agent ? (
            <>
              <span className="sr-only">· </span>
              {agent.rest}
            </>
          ) : (
            title
          )}
        </span>
        {detail ? <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      {aside ? <span className="shrink-0 pt-0.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{aside}</span> : null}
    </Link>
  );
}

/** «7 use case». */
export function useCaseCountText(count: number): string {
  return `${formatInteger(count)} use case`;
}

/**
 * Un gruppo chiuso degli elenchi sotto i grafici: «● LIBRA · 7 use case», «Se avanza tempo · 15
 * use case». Il `<details>` nativo, come gli altri elenchi della Panoramica: i link entrano nel Tab
 * solo da aperto. Il nome e il conto sono un testo solo, come i riassunti delle corsie: il «·» resta
 * con il nome e il numero con «use case» (`keepTogether`), la riga va a capo solo dopo il «·».
 */
export function ChartListSection({
  slot,
  marker,
  label,
  count,
  children,
  className,
}: {
  slot: string;
  marker?: ReactNode;
  label: ReactNode;
  count: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Disclosure
      slot={slot}
      className={className}
      summary={
        <span className="inline-flex min-w-0 items-center gap-x-1.5">
          {marker}
          <span className="min-w-0">
            <span className="text-foreground">{typeof label === "string" ? keepTogether(label) : label}</span>
            {SCREEN_SEPARATOR}
            <span className="whitespace-nowrap tabular-nums">{keepTogether(useCaseCountText(count))}</span>
          </span>
        </span>
      }
    >
      <ul className="space-y-0.5">{children}</ul>
    </Disclosure>
  );
}
