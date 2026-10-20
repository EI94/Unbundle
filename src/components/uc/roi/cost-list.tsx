import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { WORDS } from "@/lib/uc/views/labels";
import type { CostRowView, ValueView } from "@/lib/uc/views/roi";
import { PencilLink } from "./lever-list";

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
 * «Costi» (DESIGN §3.8): voce, valore e «Approvata dal cliente». La riga apre
 * il suo pannello, con «Come si stima»; il responsabile Lateral Space modifica
 * con la matita. Da `md` una tabella, sotto un elenco.
 */
export function CostList({ view, panelHref, canEdit }: { view: ValueView; panelHref: (id: string, edit?: boolean) => string; canEdit: boolean }) {
  if (view.costs.length === 0) return null;
  return (
    <section aria-labelledby="valore-costi" className="space-y-3">
      <h2 id="valore-costi" className="text-base font-semibold">
        Costi
      </h2>
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <table className="hidden w-full text-sm md:table">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-normal">
                Voce
              </th>
              <th scope="col" className="px-4 py-2 text-right font-normal">
                Valore
              </th>
              <th scope="col" className="px-4 py-2 font-normal">
                {WORDS.approvataDalCliente}
              </th>
              {canEdit && (
                <th scope="col" className="w-12">
                  <span className="sr-only">Modifica</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y">
            {view.costs.map((row) => (
              <tr key={row.id} className="hover:bg-muted/50">
                <td className="max-w-md px-4 py-2">
                  <Link
                    href={panelHref(row.id)}
                    scroll={false}
                    className="flex min-h-8 items-center gap-1 font-medium break-words hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {row.label}
                  </Link>
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <Amount row={row} />
                </td>
                <td className="px-4 py-2">
                  <Approved row={row} />
                </td>
                {canEdit && (
                  <td className="py-1 text-right">
                    <PencilLink href={panelHref(row.id, true)} label={`Modifica il costo ${row.label}`} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="divide-y md:hidden">
          {view.costs.map((row) => (
            <li key={row.id} className="flex min-w-0 items-center">
              <Link
                href={panelHref(row.id)}
                scroll={false}
                className="group flex min-h-11 min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-words">{row.label}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    <Amount row={row} /> · {WORDS.approvataDalCliente}: <Approved row={row} />
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
              {canEdit && <PencilLink href={panelHref(row.id, true)} label={`Modifica il costo ${row.label}`} />}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
