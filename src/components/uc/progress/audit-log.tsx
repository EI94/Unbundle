import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ACTIVITY_PAGE_SIZE, auditQuery, type ActivityDay, type AuditFilter } from "@/lib/uc/views/audit";
import { cn } from "@/lib/utils";
import { formatCountIt } from "@/lib/uc/views/format";

/**
 * Attività del caso (DESIGN §3.12): una linea del tempo raggruppata per giorno,
 * una frase per evento («Luca Verdi (Lateral Space) ha validato «…»»), 50
 * eventi per pagina, il CSV con gli stessi filtri. Per i ruoli del cliente il
 * filtro dell'art. 15.4 è già nella query: qui non arrivano eventi dei
 * referenti né aperture di link, e le risposte ricevute si vedono solo contate
 * per giorno (barrette). Componenti server: le frasi le prepara `activityDays`.
 */


export function ActivityTimeline({ days }: { days: readonly ActivityDay[] }) {
  return (
    <div className="space-y-6">
      {days.map((day) => (
        <section key={day.key} aria-labelledby={`uc-attivita-${day.key}`} className="min-w-0">
          <h3 id={`uc-attivita-${day.key}`} className="text-xs tracking-wide text-muted-foreground">
            {day.label}
          </h3>
          <ol className="mt-1 divide-y">
            {day.lines.map((line) => (
              <li key={line.id} className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-3 py-2.5 text-sm">
                <span className="text-muted-foreground tabular-nums">{line.time}</span>
                <p className="min-w-0 break-words">
                  {line.who ? (
                    <>
                      <span className="font-medium">{line.who}</span> {line.text}
                    </>
                  ) : (
                    line.text
                  )}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function ActivityPagination({ basePath, filter, total }: { basePath: string; filter: AuditFilter; total: number }) {
  const pages = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
  if (pages <= 1) return null;
  const page = Math.min(filter.pagina, pages);
  return (
    <nav aria-label="Pagine dell'attività" className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">
        Pagina {formatCountIt(page)} di {formatCountIt(pages)}
      </span>
      <span className="flex gap-2">
        {page > 1 && (
          <Link href={`${basePath}${auditQuery(filter, { pagina: page - 1 })}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 sm:min-h-8")}>
            <ChevronLeft aria-hidden />
            Più recenti
          </Link>
        )}
        {page < pages && (
          <Link href={`${basePath}${auditQuery(filter, { pagina: page + 1 })}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 sm:min-h-8")}>
            Meno recenti
            <ChevronRight aria-hidden />
          </Link>
        )}
      </span>
    </nav>
  );
}

/**
 * Risposte dei referenti per giorno, solo per i ruoli del cliente: una barretta
 * per i giorni con almeno 5 risposte, gli altri insieme. Il numero è sempre
 * scritto: la barretta non dice nulla da sola.
 */
export function DailyAnswerBars({ bars }: { bars: readonly { key: string; label: string; count: number; percent: number }[] }) {
  if (bars.length === 0) {
    return <p className="text-sm text-muted-foreground">Ancora nessun giorno con almeno 5 risposte: i numeri più piccoli non si mostrano.</p>;
  }
  return (
    <ul className="space-y-2" aria-label="Risposte ricevute per giorno">
      {bars.map((bar) => (
        <li key={bar.key} className="grid min-w-0 grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground">{bar.label}</span>
          <span className="h-2 min-w-0 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className="block h-full rounded-full bg-uc-blu" style={{ width: `${bar.percent}%` }} />
          </span>
          <span className="tabular-nums">{bar.count === 1 ? "1 risposta" : `${formatCountIt(bar.count)} risposte`}</span>
        </li>
      ))}
    </ul>
  );
}

/** «Scarica CSV» con gli stessi filtri: `<a download>` nativo, così un prefetch non lo scarica e non scrive nell'attività. */
export function ActivityCsvLink({ href }: { href: string }) {
  return (
    <a href={href} download className={cn(buttonVariants({ variant: "outline" }), "min-h-11 sm:min-h-8")}>
      <Download aria-hidden />
      Scarica CSV
    </a>
  );
}
