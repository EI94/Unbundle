import Link from "next/link";
import { ChevronRight, Pencil, Target } from "lucide-react";
import { LEVER_META } from "@/components/uc/common/lever-icons";
import { formatCountIt } from "@/lib/uc/views/format";
import { VALUE_TEXT, type LeverRowView, type ValueView } from "@/lib/uc/views/roi";
import { RowsToggle } from "./rows-toggle";

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
 * «Leve» (rilascio 10, §3.5; DESIGN §3.8): solo le leve attive, una riga ciascuna con il valore all'anno (o «da
 * stimare») e quanti KPI la misurano; la riga apre il pannello della leva. Al massimo tre righe, poi «Vedi tutti (N)».
 * Le leve non attive stanno chiuse sotto; il responsabile Lateral Space le accende e le spegne da «Cambia le leve»
 * (prima in Impostazioni del caso), in un pannello (`?apri=leve`).
 */
export function LeverList({ view, panelHref, canEdit, leversHref = null }: { view: ValueView; panelHref: (id: string, edit?: boolean) => string; canEdit: boolean; leversHref?: string | null }) {
  const inactive = view.inactiveLevers;
  if (view.levers.length === 0 && !leversHref) return null;
  const rows = view.levers.map((row) => (
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
      {canEdit && <PencilLink href={panelHref(row.id, true)} label={`Modifica il valore della leva ${row.label}`} />}
    </li>
  ));
  return (
    <section aria-labelledby="valore-leve" className="space-y-3">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="valore-leve" className="text-base font-semibold">
          {VALUE_TEXT.levers}
        </h2>
        {leversHref && (
          <Link href={leversHref} scroll={false} className="inline-flex min-h-11 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-0">
            {VALUE_TEXT.changeLevers}
            <ChevronRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
      {rows.length > 0 && <RowsToggle items={rows} label={VALUE_TEXT.levers} showAll={VALUE_TEXT.showAll(rows.length)} showFewer={VALUE_TEXT.showFewer} />}
      {inactive.length > 0 && (
        <details className="group text-sm text-muted-foreground">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 select-none hover:text-foreground sm:min-h-0 [&::-webkit-details-marker]:hidden">
            {VALUE_TEXT.inactiveLevers(inactive.length)}
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
          </summary>
          <p className="mt-1">{inactive.map((l) => l.label).join(" · ")}</p>
        </details>
      )}
    </section>
  );
}
