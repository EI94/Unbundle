import Link from "next/link";
import { ChevronLeft, ChevronRight, Target } from "lucide-react";
import { LEVER_META } from "@/components/uc/common/lever-icons";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { cn } from "@/lib/utils";
import { formatCountIt } from "@/lib/uc/views/format";
import { KPI_GROUP_PAGE, KPI_READINESS_VIEW, type KpiGroupView } from "@/lib/uc/views/kpi";

const PAGE_LINK =
  "inline-flex min-h-11 items-center gap-0.5 rounded-md px-1 text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-8";

/**
 * KPI raggruppati per leva (DESIGN §3.8): ogni gruppo si apre e si chiude e da
 * chiuso mostra il conteggio. Aprire e chiudere è un indirizzo (`gruppi=`), un
 * gruppo alla volta, così il server manda solo le righe del gruppo aperto: con
 * 184 KPI la pagina resta corta e leggera. Un gruppo aperto mostra al massimo `KPI_GROUP_PAGE`
 * righe; le altre si leggono con «Successivi» (`pagine=`). Una riga per KPI,
 * con un puntino (Pronto, Da confermare, Da definire), il titolo e la frase;
 * la riga apre il pannello.
 */
export function KpiList({
  groups,
  toggleHref,
  rowHref,
  pageHref,
}: {
  groups: KpiGroupView[];
  /** Indirizzo che apre o chiude il gruppo; null quando i gruppi sono tutti aperti e non si chiudono. */
  toggleHref: ((key: string) => string) | null;
  rowHref: (id: string) => string;
  /** Indirizzo della pagina `page` del gruppo `key`. */
  pageHref: (key: string, page: number) => string;
}) {
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const Icon = g.lever ? LEVER_META[g.lever].icon : Target;
        const label = g.lever ? LEVER_META[g.lever].label : "Altri KPI";
        const isOpen = g.rows !== null;
        const listId = `kpi-gruppo-${g.key}`;
        const head = (
          <>
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 font-medium">{label}</span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {formatCountIt(g.total)}
              <span className="sr-only"> KPI</span>
            </span>
            {toggleHref && <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} aria-hidden />}
          </>
        );
        return (
          <section key={g.key} aria-label={label} className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            {toggleHref ? (
              <Link
                href={toggleHref(g.key)}
                scroll={false}
                aria-expanded={isOpen}
                aria-controls={isOpen ? listId : undefined}
                className="flex min-h-11 items-center gap-2 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                {head}
              </Link>
            ) : (
              <h3 className="flex min-h-11 items-center gap-2 px-4 py-3 text-base">{head}</h3>
            )}
            {g.rows && (
              <ul id={listId} className="divide-y border-t">
                {g.rows.map((k) => {
                  const dot = KPI_READINESS_VIEW[k.readiness];
                  return (
                    <li key={k.id}>
                      <Link
                        href={rowHref(k.id)}
                        scroll={false}
                        className="group/row flex min-h-11 min-w-0 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                      >
                        <StatusDot tone={dot.tone} label={dot.label} hideLabel size="md" className="shrink-0" />
                        <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-4">
                          <span className="min-w-0 text-sm font-medium break-words sm:w-2/5 sm:shrink-0">{k.title}</span>
                          {k.explanation && <span className="line-clamp-2 min-w-0 text-sm text-muted-foreground sm:line-clamp-1">{k.explanation}</span>}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/row:translate-x-0.5" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {g.rows && g.pages > 1 && (
              <nav aria-label={`Pagine di ${label}`} className="flex flex-wrap items-center justify-between gap-x-3 border-t px-4 py-1.5 text-sm">
                <span className="text-muted-foreground tabular-nums">
                  {formatCountIt(g.from)}–{formatCountIt(g.to)} di {formatCountIt(g.total)}
                </span>
                <span className="flex gap-3">
                  {g.page > 1 && (
                    <Link href={pageHref(g.key, g.page - 1)} scroll={false} className={PAGE_LINK}>
                      <ChevronLeft className="size-3.5" aria-hidden />
                      Precedenti
                    </Link>
                  )}
                  {g.page < g.pages && (
                    <Link href={pageHref(g.key, g.page + 1)} scroll={false} className={PAGE_LINK}>
                      Successivi {formatCountIt(Math.min(KPI_GROUP_PAGE, g.total - g.to))}
                      <ChevronRight className="size-3.5" aria-hidden />
                    </Link>
                  )}
                </span>
              </nav>
            )}
          </section>
        );
      })}
    </div>
  );
}
