import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { WORDS } from "@/lib/uc/views/labels";
import { VALUE_TEXT, type CostRowView, type ValueView } from "@/lib/uc/views/roi";
import { PencilLink } from "./lever-list";
import { RowsToggle } from "./rows-toggle";

function Approved({ row }: { row: CostRowView }) {
  if (row.approved) return <>{row.approved}</>;
  return (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">da chiedere</span>
    </>
  );
}

function Amount({ row }: { row: CostRowView }) {
  return row.value ? <span className="tabular-nums">{row.value}</span> : <span className="text-muted-foreground">{row.valueNote}</span>;
}

/**
 * «Costi» (rilascio 10, §3.5; DESIGN §3.8): una riga per voce, con il valore e «approvata dal cliente»; la riga apre il
 * suo pannello, con «Come si stima»; il responsabile Lateral Space modifica con la matita. Al massimo tre righe, poi
 * «Vedi tutti (N)».
 */
export function CostList({ view, panelHref, canEdit }: { view: ValueView; panelHref: (id: string, edit?: boolean) => string; canEdit: boolean }) {
  if (view.costs.length === 0) return null;
  const rows = view.costs.map((row) => (
    <li key={row.id} className="flex min-w-0 items-center">
      <Link
        href={panelHref(row.id)}
        scroll={false}
        className="group flex min-h-11 min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <span className="min-w-0 font-medium break-words">{row.label}</span>
          <span className="text-sm text-muted-foreground sm:text-right">
            <Amount row={row} /> · {WORDS.approvataDalCliente}: <Approved row={row} />
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
      {canEdit && <PencilLink href={panelHref(row.id, true)} label={`Modifica il costo ${row.label}`} />}
    </li>
  ));
  return (
    <section aria-labelledby="valore-costi" className="space-y-3">
      <h2 id="valore-costi" className="text-base font-semibold">
        {VALUE_TEXT.costs}
      </h2>
      <RowsToggle items={rows} label={VALUE_TEXT.costs} showAll={VALUE_TEXT.showAll(rows.length)} showFewer={VALUE_TEXT.showFewer} />
    </section>
  );
}
