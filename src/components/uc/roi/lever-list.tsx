import Link from "next/link";
import { ChevronRight, Pencil, Target } from "lucide-react";
import { LEVER_META } from "@/components/uc/common/lever-icons";
import { formatCountIt } from "@/lib/uc/views/format";
import type { LeverRowView, ValueView } from "@/lib/uc/views/roi";

const ROW = "group flex min-h-11 min-w-0 flex-1 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none";

/** Matita del responsabile Lateral Space: apre il pannello già in modifica. */
export function PencilLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={label}
      className="mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:size-8"
    >
      <Pencil className="size-4" aria-hidden />
    </Link>
  );
}

function LeverName({ row }: { row: LeverRowView }) {
  const Icon = row.lever ? LEVER_META[row.lever].icon : Target;
  return (
    <span className="flex min-w-0 items-center gap-2 font-medium">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 break-words">{row.label}</span>
    </span>
  );
}

/**
 * «Leve di valore» (DESIGN §3.8): solo le leve attive, una riga ciascuna con il
 * beneficio all'anno (o «da stimare») e quanti KPI la misurano; la riga apre il
 * pannello della leva. Le leve non attive stanno chiuse sotto.
 */
export function LeverList({ view, panelHref, canEdit }: { view: ValueView; panelHref: (id: string, edit?: boolean) => string; canEdit: boolean }) {
  if (view.levers.length === 0) return null;
  const inactive = view.inactiveLevers;
  return (
    <section aria-labelledby="valore-leve" className="space-y-3">
      <h2 id="valore-leve" className="text-base font-semibold">
        Leve di valore
      </h2>
      <ul className="divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {view.levers.map((row) => (
          <li key={row.id} className="flex min-w-0 items-center">
            <Link href={panelHref(row.id)} scroll={false} className={ROW}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
                <span className="min-w-0 sm:flex-1">
                  <LeverName row={row} />
                </span>
                <span className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 pl-6 text-sm text-muted-foreground sm:pl-0">
                  <span className="tabular-nums">{row.value ?? "da stimare"}</span>
                  {row.kpis.length > 0 && <span className="tabular-nums sm:w-16 sm:text-right">{formatCountIt(row.kpis.length)} KPI</span>}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            {canEdit && <PencilLink href={panelHref(row.id, true)} label={`Modifica il beneficio della leva ${row.label}`} />}
          </li>
        ))}
      </ul>
      {inactive.length > 0 && (
        <details className="group text-sm text-muted-foreground">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 select-none hover:text-foreground sm:min-h-0 [&::-webkit-details-marker]:hidden">
            Leve non attive ({inactive.length})
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
          </summary>
          <p className="mt-1">{inactive.map((l) => l.label).join(" · ")}</p>
        </details>
      )}
    </section>
  );
}
